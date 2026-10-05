/**
 * DiskLizard scanner — shared by Desktop + TUI.
 * High-concurrency traversal; worker offload optional.
 */

import { readdir, stat, rm, lstat, realpath } from "./physical-fs"
import { basename, dirname, sep } from "node:path"
import { homedir, platform, cpus } from "node:os"
import type { Dirent, Stats } from "node:fs"
import { Worker } from "node:worker_threads"
import type {
  DeveloperArtifact,
  DeveloperArtifactDirectoryIdentity,
  DiskNode,
  DriveInfo,
  ScanDiscovery,
  ScanOptions,
  ScanProgress,
} from "./types"
import { deletionBlockReason, type DiskPlatform } from "./safety"
import {
  DEVELOPER_ARTIFACT_EVIDENCE_NAMES,
  classifyDeveloperArtifact,
  developerProjectMarkers,
  normalizeDeveloperArtifactInventoryOptions,
} from "./developer-artifacts"
import { ChildRetention, apparentBytes, compareNodesBySize } from "./scan-retention"
import { ScanScheduler } from "./scan-scheduler"
import { traversalWorkWeights } from "./work-progress"
import { getDriveDiscovery, type DriveDiscovery } from "./drive-discovery"

export type { DiskNode, DriveInfo, ScanDiscovery, ScanOptions, ScanProgress }
export {
  getDriveDiscovery,
  getDriveFacts,
  getDrives,
  mountExclusions,
  parseApfsSnapshotOutput,
  parseApfsSnapshotPlist,
  parseDfMountDiscovery,
  parseDfOutput,
  parseLinuxMountInfo,
  parseMacDriveInfoPlist,
  parseWindowsDriveDiscoveryOutput,
  parseWindowsDriveOutput,
  type DriveDiscovery,
} from "./drive-discovery"

const OS = platform()
const IS_WIN = OS === "win32"
const CPU_COUNT = Math.max(1, cpus()?.length ?? 1)
const MAX_SCAN_CONCURRENCY = 64
const DEFAULT_MAX_DEPTH = 10
const MAX_SCAN_DEPTH = 64
const DEFAULT_MAX_CHILDREN = 48
const MAX_SCAN_CHILDREN = 10_000
const DEFAULT_PROGRESS_INTERVAL_MS = 100
const MIN_PROGRESS_INTERVAL_MS = 16

/**
 * The portable walker performs metadata I/O, not CPU work. Keep its default
 * deliberately modest so HDDs, network mounts, and the Electron fallback do
 * not fan out hundreds of simultaneous stats. Callers can still opt in to a
 * different value through `ScanOptions.concurrency`.
 */
export function defaultScanConcurrency(cpuCount: number): number {
  const cores = Math.max(1, Math.floor(cpuCount) || 1)
  return Math.min(12, Math.max(4, cores + 2))
}

const DEFAULT_CONCURRENCY = defaultScanConcurrency(CPU_COUNT)

/**
 * Keep every host-facing scanner path within the same bounded concurrency
 * contract. The portable pool cannot make progress with a zero/negative limit,
 * while JSON cannot represent non-finite values for the native sidecar.
 */
export function normalizeScanConcurrency(value: number | undefined, cpuCount = CPU_COUNT): number {
  if (value === undefined || !Number.isFinite(value)) return defaultScanConcurrency(cpuCount)
  const normalized = Math.floor(value)
  if (normalized < 1) return defaultScanConcurrency(cpuCount)
  return Math.min(MAX_SCAN_CONCURRENCY, normalized)
}

function normalizedInteger(value: number | undefined, fallback: number, minimum: number, maximum?: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  const normalized = Math.floor(value)
  return Math.min(maximum ?? Number.MAX_SAFE_INTEGER, Math.max(minimum, normalized))
}

/**
 * Apply one conservative options contract before the desktop native sidecar,
 * in-process fallback, worker fallback, and snapshot cache see a scan request.
 */
export function normalizeScanOptions(options: ScanOptions): ScanOptions {
  return {
    ...options,
    maxDepth: normalizedInteger(options.maxDepth, DEFAULT_MAX_DEPTH, 0, MAX_SCAN_DEPTH),
    concurrency: normalizeScanConcurrency(options.concurrency),
    maxChildren: normalizedInteger(options.maxChildren, DEFAULT_MAX_CHILDREN, 1, MAX_SCAN_CHILDREN),
    progressIntervalMs: normalizedInteger(
      options.progressIntervalMs,
      DEFAULT_PROGRESS_INTERVAL_MS,
      MIN_PROGRESS_INTERVAL_MS,
    ),
  }
}

const EMPTY_CHILDREN: DiskNode[] = []
Object.freeze(EMPTY_CHILDREN)
// This belongs only on the returned scan root. Per-file clone data is omitted
// in the portable scanner so a large fallback payload stays compact, while the
// root still makes its capability boundary explicit to the UI.
const CLONE_METADATA_UNAVAILABLE = Object.freeze({ state: "unavailable" as const, reason: "scanner" as const })
const MAX_SCAN_DISCOVERIES = 96
const MAX_SCAN_FILE_DISCOVERIES = 24

// ── Fast path join (avoid path.join overhead in hot loop) ─────────────────

function joinPath(parent: string, name: string): string {
  if (!parent) return name
  const last = parent.charCodeAt(parent.length - 1)
  if (last === 47 /* / */ || last === 92 /* \ */) return parent + name
  return parent + sep + name
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// ── Core fast scanner ─────────────────────────────────────────────────────

type WalkState = {
  pool: ScanScheduler
  maxDepth: number
  maxChildren: number
  preserveNames: Set<string>
  collapseNames: Set<string>
  signatureNames: Set<string>
  filesScanned: number
  dirsScanned: number
  lastProgressAt: number
  progressIntervalMs: number
  onProgress?: (p: ScanProgress) => void
  rootPath: string
  /** Shared counter for in-flight progress size estimate */
  scannedBytes: number
  workProgress: number
  signal?: AbortSignal
  sizeMode: "physical" | "logical"
  claimedHardLinks: Set<string>
  /** Sparse, scanner-only metadata for retained hard-link pathnames. */
  hardLinkMetadata: Map<string, HardLinkMetadata>
  excludedPaths: Set<string>
  unreadableCount: number
  issueSamples: string[]
  skippedSymlinkCount: number
  skippedSymlinkSamples: string[]
  skippedDirectoryCount: number
  skippedDirectorySamples: string[]
  excludedCount: number
  excludedSamples: string[]
  /** Inventory-only directory identities, used to avoid deep alias/cycle scope. */
  inventoryDirectoryIdentities?: Set<string>
  inventoryRootDevice?: bigint
  /** False means the scan root did not supply a safe dev/inode boundary. */
  inventoryDirectoryScopeAvailable?: boolean
  /**
   * Kept private to the scanner so tests can model filesystems that do not
   * expose stable directory identifiers. It is never part of ScanOptions.
   */
  inventoryIdentityReader?: InventoryIdentityReader
  artifactInventory?: {
    maxItems: number
    items: DeveloperArtifact[]
    matchedDirectories: number
    truncated: boolean
  }
  discoveriesEmitted: number
  fileDiscoveriesEmitted: number
}

type InventoryDirectoryStat = {
  isDirectory(): boolean
  isSymbolicLink(): boolean
  dev: bigint
  ino: bigint
  mtimeMs: number | bigint
}

type InventoryIdentityReader = (targetPath: string) => Promise<InventoryDirectoryStat>

/**
 * Internal-only test seam. Keeping this out of ScanOptions ensures callers
 * cannot change production traversal semantics; production always uses lstat.
 */
type InternalScanOptions = ScanOptions & {
  inventoryIdentityReader?: InventoryIdentityReader
}

type HardLinkMetadata = {
  identity: string
  reportedCount: number
  physicalSize: number
}

type HardLinkCandidate = HardLinkMetadata & {
  indices: number[]
  sortKey: string
  logicalSize: number
  chargedSize: number
  hardLink: NonNullable<DiskNode["hardLink"]>
}

function checkAborted(st: WalkState) {
  st.signal?.throwIfAborted()
}

function comparablePath(value: string) {
  const normalized = value.length > 1 ? value.replace(/[\\/]+$/, "") : value
  return IS_WIN ? normalized.toLowerCase() : normalized
}

function isExcluded(st: WalkState, targetPath: string) {
  return st.excludedPaths.has(comparablePath(targetPath))
}

/** Kept well past display needs so the renderer can attribute partial coverage per folder. */
const MAX_UNREADABLE_SAMPLES = 4096

function recordUnreadable(st: WalkState, targetPath: string) {
  st.unreadableCount++
  if (st.issueSamples.length < MAX_UNREADABLE_SAMPLES) st.issueSamples.push(targetPath)
}

function recordSkippedSymlink(st: WalkState, targetPath: string) {
  if (!st.artifactInventory) return
  st.skippedSymlinkCount++
  if (st.skippedSymlinkSamples.length < 12) st.skippedSymlinkSamples.push(targetPath)
}

function recordSkippedDirectory(st: WalkState, targetPath: string) {
  if (!st.artifactInventory) return
  st.skippedDirectoryCount++
  if (st.skippedDirectorySamples.length < 12) st.skippedDirectorySamples.push(targetPath)
}

function recordExcludedPath(st: WalkState, targetPath: string) {
  if (!st.artifactInventory) return
  st.excludedCount++
  if (st.excludedSamples.length < 12) st.excludedSamples.push(targetPath)
}

async function readInventoryDirectoryStat(st: WalkState, targetPath: string): Promise<InventoryDirectoryStat> {
  const reader = st.inventoryIdentityReader ?? ((path: string) => lstat(path, { bigint: true }))
  return st.pool.run(() => reader(targetPath))
}

async function initializeInventoryDirectoryScope(st: WalkState, targetPath: string): Promise<boolean> {
  if (!st.artifactInventory) return false
  st.inventoryDirectoryScopeAvailable = false
  try {
    const info = await readInventoryDirectoryStat(st, targetPath)
    if (!info.isDirectory() || info.isSymbolicLink() || info.dev <= 0n || info.ino <= 0n) {
      recordSkippedDirectory(st, targetPath)
      return false
    }
    st.inventoryRootDevice = info.dev
    st.inventoryDirectoryIdentities = new Set([`${info.dev}:${info.ino}`])
    st.inventoryDirectoryScopeAvailable = true
    return true
  } catch {
    recordUnreadable(st, targetPath)
    recordSkippedDirectory(st, targetPath)
    return false
  }
}

/** Pure identity gate shared by the walker and focused fallback tests. */
export function canClaimDeveloperArtifactInventoryDirectory(
  scopeAvailable: boolean | undefined,
  rootDevice: bigint | undefined,
  claimed: ReadonlySet<string>,
  device: bigint,
  fileId: bigint,
): boolean {
  if (!scopeAvailable || rootDevice === undefined || device <= 0n || fileId <= 0n || device !== rootDevice) {
    return false
  }
  return !claimed.has(`${device}:${fileId}`)
}

/**
 * Claim a deep inventory directory before recursing. Missing identifiers are
 * not treated as safe: they are an explicit partial-coverage boundary, while
 * proven cross-device/repeated identities are skipped.
 */
async function claimInventoryDirectory(st: WalkState, targetPath: string): Promise<boolean> {
  if (!st.artifactInventory) return true
  try {
    const info = await readInventoryDirectoryStat(st, targetPath)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      recordSkippedDirectory(st, targetPath)
      return false
    }
    const identities = (st.inventoryDirectoryIdentities ??= new Set())
    if (
      !canClaimDeveloperArtifactInventoryDirectory(
        st.inventoryDirectoryScopeAvailable,
        st.inventoryRootDevice,
        identities,
        info.dev,
        info.ino,
      )
    ) {
      recordSkippedDirectory(st, targetPath)
      return false
    }
    identities.add(`${info.dev}:${info.ino}`)
    return true
  } catch {
    recordUnreadable(st, targetPath)
    recordSkippedDirectory(st, targetPath)
    return false
  }
}

/**
 * Inventory scope is intentionally independent from the visual map walk.
 * When identity proof ends at a directory, its normal map subtree still
 * contributes bytes and children; only deep artifact discovery stops there.
 */
async function childInventoryScope(st: WalkState, parentScopeAllowed: boolean, targetPath: string): Promise<boolean> {
  return parentScopeAllowed && (await claimInventoryDirectory(st, targetPath))
}

function compareDeveloperArtifactRetention(left: DeveloperArtifact, right: DeveloperArtifact): number {
  if (left.size !== right.size) return left.size > right.size ? -1 : 1
  // Keep the native and TypeScript bounded inventories byte-for-byte stable:
  // JavaScript's relational string comparison is UTF-16 code-unit order,
  // while `localeCompare` is intentionally locale-sensitive.
  if (left.path === right.path) return 0
  return left.path < right.path ? -1 : 1
}

/** The heap root is the least useful retained item: smallest, then last path. */
function isWorseDeveloperArtifact(left: DeveloperArtifact, right: DeveloperArtifact): boolean {
  return compareDeveloperArtifactRetention(left, right) > 0
}

function siftDeveloperArtifactWorstUp(items: DeveloperArtifact[], index: number) {
  let child = index
  while (child > 0) {
    const parent = Math.floor((child - 1) / 2)
    if (!isWorseDeveloperArtifact(items[child]!, items[parent]!)) break
    ;[items[child], items[parent]] = [items[parent]!, items[child]!]
    child = parent
  }
}

function siftDeveloperArtifactWorstDown(items: DeveloperArtifact[], index: number) {
  let parent = index
  while (true) {
    const left = parent * 2 + 1
    const right = left + 1
    let worst = parent
    if (left < items.length && isWorseDeveloperArtifact(items[left]!, items[worst]!)) worst = left
    if (right < items.length && isWorseDeveloperArtifact(items[right]!, items[worst]!)) worst = right
    if (worst === parent) return
    ;[items[parent], items[worst]] = [items[worst]!, items[parent]!]
    parent = worst
  }
}

function retainDeveloperArtifact(inventory: NonNullable<WalkState["artifactInventory"]>, artifact: DeveloperArtifact) {
  inventory.matchedDirectories++
  if (inventory.items.length < inventory.maxItems) {
    inventory.items.push(artifact)
    siftDeveloperArtifactWorstUp(inventory.items, inventory.items.length - 1)
    return
  }
  inventory.truncated = true
  const worst = inventory.items[0]
  if (!worst || compareDeveloperArtifactRetention(artifact, worst) >= 0) return
  inventory.items[0] = artifact
  siftDeveloperArtifactWorstDown(inventory.items, 0)
}

async function artifactDirectoryIdentity(
  st: WalkState,
  dirPath: string,
): Promise<DeveloperArtifactDirectoryIdentity | undefined> {
  try {
    const info = await readInventoryDirectoryStat(st, dirPath)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      // The branch was previously admitted to inventory scope, but changed
      // before its candidate record could be sealed. Do not claim complete
      // coverage or attach a weak destructive identity.
      recordSkippedDirectory(st, dirPath)
      return undefined
    }
    // Do not manufacture a weak `0:0` identity. The record remains useful
    // for review, but deep cleanup must wait for a fresh identity-bearing
    // scan rather than falling back to name/classifier matching.
    if (info.dev <= 0n || info.ino <= 0n) {
      recordSkippedDirectory(st, dirPath)
      return undefined
    }
    const modifiedAt = Number(info.mtimeMs)
    if (!Number.isFinite(modifiedAt) || modifiedAt < 0) {
      recordSkippedDirectory(st, dirPath)
      return undefined
    }
    return {
      platform: IS_WIN ? "windows" : "posix",
      device: info.dev.toString(),
      fileId: info.ino.toString(),
      // Native entry metadata has millisecond precision. Normalize the
      // portable scanner to the same exact precondition representation.
      modifiedAt: Math.floor(modifiedAt),
    }
  } catch {
    // The tree could be read before a concurrent rename/permission change.
    // Keep the candidate visible but mark coverage partial and withhold its
    // destructive precondition rather than manufacturing an identity.
    recordUnreadable(st, dirPath)
    return undefined
  }
}

/**
 * A deep inventory record without this direct identity is useful for review,
 * but cannot support the stale-result precondition required before Trash.
 * Keep the check deliberately aligned with the compact bridge validator so a
 * scanner never reports complete coverage for a retained unsafe record.
 */
function hasUsableDeveloperArtifactDirectoryIdentity(
  identity: DeveloperArtifact["directoryIdentity"],
): identity is DeveloperArtifactDirectoryIdentity {
  return (
    identity !== undefined &&
    (identity.platform === "posix" || identity.platform === "windows") &&
    identity.device.length > 0 &&
    identity.device !== "0" &&
    identity.fileId.length > 0 &&
    identity.fileId !== "0" &&
    Number.isSafeInteger(identity.modifiedAt) &&
    identity.modifiedAt >= 0
  )
}

async function recordDeveloperArtifact(
  st: WalkState,
  dirPath: string,
  name: string,
  measured: Pick<DeveloperArtifact, "size" | "logicalSize" | "modifiedAt">,
  signatures: readonly string[] = [],
  siblingMarkers: readonly string[] = [],
) {
  const inventory = st.artifactInventory
  if (!inventory) return
  const classification = classifyDeveloperArtifact(name, basename(dirname(dirPath)), signatures, siblingMarkers)
  if (!classification) return
  const directoryIdentity = await artifactDirectoryIdentity(st, dirPath)
  retainDeveloperArtifact(inventory, {
    name,
    path: dirPath,
    size: measured.size,
    ...(measured.logicalSize === undefined ? {} : { logicalSize: measured.logicalSize }),
    ...(measured.modifiedAt === undefined ? {} : { modifiedAt: measured.modifiedAt }),
    ...(directoryIdentity === undefined ? {} : { directoryIdentity }),
    isDir: true,
    ...(signatures.length > 0 ? { signatures: [...signatures] } : {}),
    ...classification,
    inventoryOnly: true,
  })
}

function attachDeveloperArtifactInventory(root: DiskNode, st: WalkState) {
  const inventory = st.artifactInventory
  if (!inventory) return
  inventory.items.sort(compareDeveloperArtifactRetention)
  // This is calculated from the final bounded top-K, rather than every
  // observed match: it tells the UI exactly which retained records cannot be
  // safely deleted without a fresh identity-bearing rescan.
  const unavailableDirectoryIdentityItems = inventory.items.filter(
    (item) => !hasUsableDeveloperArtifactDirectoryIdentity(item.directoryIdentity),
  )
  const unavailableDirectoryIdentityCount = unavailableDirectoryIdentityItems.length
  const partial =
    inventory.truncated ||
    st.unreadableCount > 0 ||
    st.skippedSymlinkCount > 0 ||
    st.skippedDirectoryCount > 0 ||
    st.excludedCount > 0 ||
    unavailableDirectoryIdentityCount > 0
  root.developerArtifactInventory = {
    items: inventory.items,
    status: {
      state: partial ? "partial" : "complete",
      maxItems: inventory.maxItems,
      scannedDirectories: st.dirsScanned,
      matchedDirectories: inventory.matchedDirectories,
      truncated: inventory.truncated,
      unreadableCount: st.unreadableCount,
      unreadableSamplePaths: st.issueSamples.slice(0, 12),
      skippedSymlinkCount: st.skippedSymlinkCount,
      skippedSymlinkSamplePaths: [...st.skippedSymlinkSamples],
      skippedDirectoryCount: st.skippedDirectoryCount,
      skippedDirectorySamplePaths: [...st.skippedDirectorySamples],
      unavailableDirectoryIdentityCount,
      unavailableDirectoryIdentitySamplePaths: unavailableDirectoryIdentityItems.slice(0, 12).map((item) => item.path),
      excludedCount: st.excludedCount,
      excludedSamplePaths: [...st.excludedSamples],
    },
  }
}

function emitProgress(st: WalkState, currentPath: string, force = false) {
  if (!st.onProgress) return
  const now = performance.now()
  if (!force && now - st.lastProgressAt < st.progressIntervalMs) return
  st.lastProgressAt = now
  st.onProgress({
    filesScanned: st.filesScanned,
    dirsScanned: st.dirsScanned,
    currentPath,
    size: st.scannedBytes,
    percent: st.workProgress * 100,
  })
}

/** Stream only compact root children. This makes progress spatial without cloning partial trees over IPC. */
function emitDiscovery(st: WalkState, node: DiskNode) {
  if (
    !st.onProgress ||
    node.size <= 0 ||
    st.discoveriesEmitted >= MAX_SCAN_DISCOVERIES ||
    (!node.isDir && st.fileDiscoveriesEmitted >= MAX_SCAN_FILE_DISCOVERIES)
  )
    return
  st.discoveriesEmitted++
  if (!node.isDir) st.fileDiscoveriesEmitted++
  st.onProgress({
    filesScanned: st.filesScanned,
    dirsScanned: st.dirsScanned,
    currentPath: node.path,
    size: st.scannedBytes,
    percent: st.workProgress * 100,
    discovery: {
      name: node.name,
      path: node.path,
      size: node.size,
      modifiedAt: node.modifiedAt,
      isDir: node.isDir,
    },
  })
}

function trackRootDiscovery<T extends DiskNode | null>(st: WalkState, depth: number, task: Promise<T>): Promise<T> {
  if (depth !== 0) return task
  return task.then((node) => {
    if (node) emitDiscovery(st, node)
    return node
  })
}

function measureFile(st: WalkState, stats: Stats, nodePath?: string) {
  const logicalSize = stats.size
  const allocatedSize =
    st.sizeMode === "physical" && !IS_WIN && typeof stats.blocks === "number" ? stats.blocks * 512 : logicalSize
  let size = allocatedSize
  let hardLink: DiskNode["hardLink"]

  if (st.sizeMode === "physical" && stats.nlink > 1 && stats.ino > 0) {
    const key = `${stats.dev}:${stats.ino}`
    if (st.claimedHardLinks.has(key)) {
      size = 0
      hardLink = "secondary"
    } else {
      st.claimedHardLinks.add(key)
      hardLink = "primary"
    }
    // Retain only hard-link metadata, and only while this pathname will be
    // materialized in the returned tree. It is used after traversal to remove
    // scheduler timing from the primary marker; it is never serialized.
    if (
      nodePath &&
      Number.isSafeInteger(stats.dev) &&
      Number.isSafeInteger(stats.ino) &&
      Number.isSafeInteger(stats.nlink) &&
      Number.isSafeInteger(allocatedSize) &&
      allocatedSize >= 0
    ) {
      st.hardLinkMetadata.set(nodePath, {
        identity: key,
        reportedCount: stats.nlink,
        physicalSize: allocatedSize,
      })
    }
  }

  return {
    size,
    logicalSize: logicalSize === size ? undefined : logicalSize,
    hardLink,
    modifiedAt: Number.isFinite(stats.mtimeMs) && stats.mtimeMs > 0 ? stats.mtimeMs : undefined,
  }
}

function isSafeByteCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0
}

function nodeAt(root: DiskNode, indices: readonly number[]): DiskNode | undefined {
  let node = root
  for (const index of indices) {
    const child = node.children[index]
    if (!child) return undefined
    node = child
  }
  return node
}

function compareLexicalPaths(left: string, right: string) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * Parallel `stat` calls race to claim an inode. Reassign that one physical
 * charge to the lexical first pathname only when every filesystem-reported
 * hard-link member is still represented in this retained tree. A cutoff,
 * collapsed subtree, unreadable path, or inconsistent metadata leaves the
 * existing one-charge accounting untouched.
 */
function normalizeCompleteHardLinkGroups(root: DiskNode, metadata: ReadonlyMap<string, HardLinkMetadata>) {
  const groups = new Map<string, HardLinkCandidate[]>()
  const indices: number[] = []
  const affectedDirectories = new Set<DiskNode>()

  const collect = (node: DiskNode) => {
    if (!node.isDir) {
      const info = metadata.get(node.path)
      if (info && node.hardLink) {
        const logicalSize = apparentBytes(node)
        if (
          isSafeByteCount(node.size) &&
          isSafeByteCount(logicalSize) &&
          isSafeByteCount(info.physicalSize) &&
          Number.isSafeInteger(info.reportedCount) &&
          info.reportedCount > 1
        ) {
          const members = groups.get(info.identity)
          const candidate: HardLinkCandidate = {
            ...info,
            indices: [...indices],
            sortKey: node.path,
            logicalSize,
            chargedSize: node.size,
            hardLink: node.hardLink,
          }
          if (members) members.push(candidate)
          else groups.set(info.identity, [candidate])
        }
      }
    }
    for (let index = 0; index < node.children.length; index++) {
      indices.push(index)
      collect(node.children[index])
      indices.pop()
    }
  }

  const canTransferCharge = (source: readonly number[], destination: readonly number[], size: number) => {
    if (!isSafeByteCount(root.size) || root.size < size) return false

    let sourceNode = root
    for (const index of source) {
      const child = sourceNode.children[index]
      if (!child) return false
      sourceNode = child
      if (sourceNode.isDir && (!isSafeByteCount(sourceNode.size) || sourceNode.size < size)) return false
    }

    // Shared directory ancestors are reduced before they are increased, so
    // only destination-only directories can overflow.
    let destinationNode = root
    let sharedPrefix = true
    for (let depth = 0; depth < destination.length; depth++) {
      const index = destination[depth]
      const child = destinationNode.children[index]
      if (!child) return false
      destinationNode = child
      sharedPrefix = sharedPrefix && source[depth] === index
      if (
        destinationNode.isDir &&
        !sharedPrefix &&
        (!isSafeByteCount(destinationNode.size) || destinationNode.size > Number.MAX_SAFE_INTEGER - size)
      ) {
        return false
      }
    }
    return true
  }

  const adjustDirectorySize = (node: DiskNode, delta: number) => {
    const logicalSize = apparentBytes(node)
    node.size += delta
    node.logicalSize = logicalSize === node.size ? undefined : logicalSize
  }

  const subtractCharge = (path: readonly number[], size: number) => {
    if (root.isDir) adjustDirectorySize(root, -size)
    let node = root
    for (const index of path) {
      node = node.children[index]
      if (node.isDir) adjustDirectorySize(node, -size)
    }
  }

  const addCharge = (path: readonly number[], size: number) => {
    if (root.isDir) adjustDirectorySize(root, size)
    let node = root
    for (const index of path) {
      node = node.children[index]
      if (node.isDir) adjustDirectorySize(node, size)
    }
  }

  const markAffectedDirectories = (path: readonly number[]) => {
    let node = root
    if (node.isDir) affectedDirectories.add(node)
    // A leaf's parent holds its changed charge. Every ancestor directory also
    // needs re-sorting because one of its descendant branch totals moved.
    for (let depth = 0; depth + 1 < path.length; depth++) {
      const child = node.children[path[depth]]
      if (!child || !child.isDir) return
      node = child
      affectedDirectories.add(node)
    }
  }

  const sortAffectedDirectories = (node: DiskNode) => {
    for (const child of node.children) sortAffectedDirectories(child)
    if (affectedDirectories.has(node)) node.children.sort(compareNodesBySize)
  }

  collect(root)
  for (const members of groups.values()) {
    const first = members[0]
    if (!first) continue
    const expectedCount = first.reportedCount
    const physicalSize = first.physicalSize
    const logicalSize = first.logicalSize
    const distinctPaths = new Set(members.map((member) => member.indices.join("/")))
    const primaryCount = members.filter((member) => member.hardLink === "primary").length
    if (
      members.length !== expectedCount ||
      distinctPaths.size !== members.length ||
      primaryCount !== 1 ||
      members.some(
        (member) =>
          member.reportedCount !== expectedCount ||
          member.physicalSize !== physicalSize ||
          member.logicalSize !== logicalSize ||
          member.chargedSize !== (member.hardLink === "primary" ? physicalSize : 0),
      )
    ) {
      continue
    }

    const currentPrimary = members.find((member) => member.hardLink === "primary")
    const desiredPrimary = [...members].sort((left, right) => compareLexicalPaths(left.sortKey, right.sortKey))[0]
    if (!currentPrimary || !desiredPrimary) continue
    if (currentPrimary.indices.join("/") !== desiredPrimary.indices.join("/")) {
      if (!canTransferCharge(currentPrimary.indices, desiredPrimary.indices, physicalSize)) continue
      subtractCharge(currentPrimary.indices, physicalSize)
      addCharge(desiredPrimary.indices, physicalSize)
      markAffectedDirectories(currentPrimary.indices)
      markAffectedDirectories(desiredPrimary.indices)
    }

    const primaryPath = desiredPrimary.indices.join("/")
    for (const member of members) {
      const node = nodeAt(root, member.indices)
      if (!node) continue
      const isPrimary = member.indices.join("/") === primaryPath
      node.size = isPrimary ? physicalSize : 0
      node.logicalSize = logicalSize === node.size ? undefined : logicalSize
      node.hardLink = isPrimary ? "primary" : "secondary"
    }
  }
  if (affectedDirectories.size > 0) sortAffectedDirectories(root)
}

/**
 * Size-only fast pass: no DiskNode children allocated. Used past maxDepth / deep prune.
 */
async function sizeOnly(
  dirPath: string,
  st: WalkState,
  depth: number,
  captureSignatures = false,
  inventoryScopeAllowed = false,
  siblingMarkers: readonly string[] = [],
  reportWork: (fraction: number) => void = (fraction) => {
    st.workProgress = fraction
  },
): Promise<{
  size: number
  logicalSize?: number
  modifiedAt?: number
  signatures?: string[]
  artifactSignatures?: string[]
}> {
  checkAborted(st)

  let entries: Dirent[]
  try {
    entries = await st.pool.run(() => readdir(dirPath, { withFileTypes: true }))
  } catch {
    checkAborted(st)
    recordUnreadable(st, dirPath)
    return { size: 0 }
  }

  st.dirsScanned++
  let total = 0
  let totalLogicalSize = 0
  let modifiedAt = 0
  const signatures: string[] = []
  const artifactSignatures: string[] = []
  // Sibling project markers for records made inside child directories.
  const childMarkers = st.artifactInventory ? developerProjectMarkers(entries.map((ent) => ent.name)) : []

  const weights = traversalWorkWeights(entries, (entry) => {
    if (entry.isSymbolicLink() || isExcluded(st, joinPath(dirPath, entry.name))) return "skip"
    return entry.isDirectory() ? "directory" : "file"
  })
  const workByEntry = new Map(entries.map((entry, index) => [entry, weights[index]!]))
  let completedWork = 0
  if (!entries.length) reportWork(1)
  await st.pool.forEach(entries, async (ent) => {
    let childWork = 0
    const advanceWork = (fraction: number) => {
      const next = Math.max(childWork, Math.min(1, fraction))
      completedWork += (next - childWork) * workByEntry.get(ent)!
      childWork = next
      reportWork(Math.min(1, completedWork))
    }
    try {
      checkAborted(st)
      const name = ent.name
      const normalizedName = name.toLowerCase()

      const childPath = joinPath(dirPath, name)
      // Prefer Dirent type checks — no extra syscall. Symlinks are deliberately
      // not followed; inventory status makes that omitted scope explicit.
      if (ent.isSymbolicLink()) {
        recordSkippedSymlink(st, childPath)
        return
      }
      if (isExcluded(st, childPath)) {
        recordExcludedPath(st, childPath)
        return
      }
      if (captureSignatures && st.signatureNames.has(normalizedName)) signatures.push(normalizedName)
      if (st.artifactInventory && DEVELOPER_ARTIFACT_EVIDENCE_NAMES.has(normalizedName)) {
        artifactSignatures.push(normalizedName)
      }
      if (ent.isDirectory()) {
        const childScopeAllowed = await childInventoryScope(st, inventoryScopeAllowed, childPath)
        const measured = await sizeOnly(childPath, st, depth + 1, false, childScopeAllowed, childMarkers, advanceWork)
        total += measured.size
        totalLogicalSize += apparentBytes(measured)
        modifiedAt = Math.max(modifiedAt, measured.modifiedAt ?? 0)
      } else if (ent.isFile()) {
        try {
          const s = await st.pool.run(() => stat(childPath))
          const measured = measureFile(st, s)
          total += measured.size
          totalLogicalSize += apparentBytes(measured)
          modifiedAt = Math.max(modifiedAt, measured.modifiedAt ?? 0)
          st.filesScanned++
          st.scannedBytes += measured.size
        } catch {
          checkAborted(st)
          recordUnreadable(st, childPath)
        }
      } else if (ent.isFIFO?.() || ent.isSocket?.() || ent.isCharacterDevice?.() || ent.isBlockDevice?.()) {
        // skip specials
      } else {
        // Unknown type (some FS): one stat to classify
        try {
          const s = await st.pool.run(() => stat(childPath))
          if (s.isDirectory()) {
            const childScopeAllowed = await childInventoryScope(st, inventoryScopeAllowed, childPath)
            const measured = await sizeOnly(
              childPath,
              st,
              depth + 1,
              false,
              childScopeAllowed,
              childMarkers,
              advanceWork,
            )
            total += measured.size
            totalLogicalSize += apparentBytes(measured)
            modifiedAt = Math.max(modifiedAt, measured.modifiedAt ?? 0)
          } else if (s.isFile()) {
            const measured = measureFile(st, s)
            total += measured.size
            totalLogicalSize += apparentBytes(measured)
            modifiedAt = Math.max(modifiedAt, measured.modifiedAt ?? 0)
            st.filesScanned++
            st.scannedBytes += measured.size
          }
        } catch {
          checkAborted(st)
          recordUnreadable(st, childPath)
        }
      }
    } finally {
      advanceWork(1)
    }
  })
  checkAborted(st)
  reportWork(1)
  emitProgress(st, dirPath)
  const result = {
    size: total,
    ...(totalLogicalSize === total ? {} : { logicalSize: totalLogicalSize }),
    modifiedAt: modifiedAt || undefined,
    signatures: signatures.length > 0 ? signatures.sort() : undefined,
    artifactSignatures: artifactSignatures.length > 0 ? [...new Set(artifactSignatures)].sort() : undefined,
  }
  if (inventoryScopeAllowed) {
    await recordDeveloperArtifact(st, dirPath, basename(dirPath), result, result.artifactSignatures, siblingMarkers)
  }
  return result
}

async function walkCollapsedDir(
  dirPath: string,
  name: string,
  st: WalkState,
  depth: number,
  inventoryScopeAllowed = false,
  siblingMarkers: readonly string[] = [],
  reportWork: (fraction: number) => void = (fraction) => {
    st.workProgress = fraction
  },
): Promise<DiskNode> {
  const measured = await sizeOnly(dirPath, st, depth, true, inventoryScopeAllowed, siblingMarkers, reportWork)
  return {
    name,
    path: dirPath,
    ...measured,
    isDir: true,
    isCollapsed: true,
    children: [],
    ext: "",
  }
}
async function walkDir(
  dirPath: string,
  name: string,
  st: WalkState,
  depth: number,
  inventoryScopeAllowed = false,
  siblingMarkers: readonly string[] = [],
  reportWork: (fraction: number) => void = (fraction) => {
    st.workProgress = fraction
  },
): Promise<DiskNode> {
  checkAborted(st)
  const node: DiskNode = {
    name,
    path: dirPath,
    size: 0,
    isDir: true,
    children: [],
    ext: "",
  }

  // Past viz depth: size-only, no tree — deadly fast for deep junk
  if (depth > st.maxDepth) {
    const measured = await sizeOnly(dirPath, st, depth, false, inventoryScopeAllowed, siblingMarkers, reportWork)
    node.size = measured.size
    node.logicalSize = measured.logicalSize
    node.modifiedAt = measured.modifiedAt
    return node
  }

  let entries: Dirent[]
  try {
    entries = await st.pool.run(() => readdir(dirPath, { withFileTypes: true }))
  } catch {
    checkAborted(st)
    recordUnreadable(st, dirPath)
    return node
  }

  st.dirsScanned++
  emitProgress(st, dirPath)

  const artifactSignatures: string[] = []
  // Sibling project markers for records made inside child directories.
  const childMarkers = st.artifactInventory ? developerProjectMarkers(entries.map((ent) => ent.name)) : []
  const retainedChildren = new ChildRetention(dirPath, st.maxChildren, st.preserveNames)

  const weights = traversalWorkWeights(entries, (entry) => {
    if (entry.isSymbolicLink() || isExcluded(st, joinPath(dirPath, entry.name))) return "skip"
    return entry.isDirectory() ? "directory" : "file"
  })
  const workByEntry = new Map(entries.map((entry, index) => [entry, weights[index]!]))
  let completedWork = 0
  if (!entries.length) reportWork(1)
  await st.pool.forEach(entries, async (ent) => {
    let childWork = 0
    const advanceWork = (fraction: number) => {
      const next = Math.max(childWork, Math.min(1, fraction))
      completedWork += (next - childWork) * workByEntry.get(ent)!
      childWork = next
      reportWork(Math.min(1, completedWork))
    }
    try {
      checkAborted(st)
      const entName = ent.name
      const childPath = joinPath(dirPath, entName)
      if (ent.isSymbolicLink()) {
        recordSkippedSymlink(st, childPath)
        return
      }
      if (isExcluded(st, childPath)) {
        recordExcludedPath(st, childPath)
        return
      }
      const normalizedName = entName.toLowerCase()
      if (st.artifactInventory && DEVELOPER_ARTIFACT_EVIDENCE_NAMES.has(normalizedName)) {
        artifactSignatures.push(normalizedName)
      }

      if (ent.isDirectory()) {
        retainedChildren.add(
          await trackRootDiscovery(
            st,
            depth,
            (async () => {
              const childScopeAllowed = await childInventoryScope(st, inventoryScopeAllowed, childPath)
              return st.collapseNames.has(entName.toLowerCase())
                ? walkCollapsedDir(childPath, entName, st, depth + 1, childScopeAllowed, childMarkers, advanceWork)
                : walkDir(childPath, entName, st, depth + 1, childScopeAllowed, childMarkers, advanceWork)
            })(),
          ),
        )
      } else if (ent.isFile()) {
        // Fast ext extract without path.extname alloc when possible
        retainedChildren.add(
          await trackRootDiscovery(
            st,
            depth,
            st.pool
              .run(() => stat(childPath))
              .then(
                (s) => {
                  const measured = measureFile(st, s, childPath)
                  st.filesScanned++
                  st.scannedBytes += measured.size
                  const dot = entName.lastIndexOf(".")
                  const ext = dot > 0 && dot < entName.length - 1 ? entName.slice(dot + 1).toLowerCase() : ""
                  const fileNode: DiskNode = {
                    name: entName,
                    path: childPath,
                    ...measured,
                    isDir: false,
                    children: EMPTY_CHILDREN,
                    ext,
                  }
                  return fileNode
                },
                () => {
                  recordUnreadable(st, childPath)
                  return null
                },
              ),
          ),
        )
      } else {
        // Rare: need stat to classify
        retainedChildren.add(
          await trackRootDiscovery(
            st,
            depth,
            st.pool
              .run(() => stat(childPath))
              .then(
                async (s) => {
                  if (s.isDirectory()) {
                    const childScopeAllowed = await childInventoryScope(st, inventoryScopeAllowed, childPath)
                    return st.collapseNames.has(entName.toLowerCase())
                      ? walkCollapsedDir(
                          childPath,
                          entName,
                          st,
                          depth + 1,
                          childScopeAllowed,
                          childMarkers,
                          advanceWork,
                        )
                      : walkDir(childPath, entName, st, depth + 1, childScopeAllowed, childMarkers, advanceWork)
                  }
                  if (s.isFile()) {
                    const measured = measureFile(st, s, childPath)
                    st.filesScanned++
                    st.scannedBytes += measured.size
                    const fileNode: DiskNode = {
                      name: entName,
                      path: childPath,
                      ...measured,
                      isDir: false,
                      children: EMPTY_CHILDREN,
                      ext: "",
                    }
                    return fileNode
                  }
                  return null
                },
                () => {
                  recordUnreadable(st, childPath)
                  return null
                },
              ),
          ),
        )
      }
    } finally {
      advanceWork(1)
    }
  })
  checkAborted(st)

  reportWork(1)
  Object.assign(node, retainedChildren.finish())
  if (inventoryScopeAllowed) {
    await recordDeveloperArtifact(st, dirPath, name, node, [...new Set(artifactSignatures)].sort(), siblingMarkers)
  }
  emitProgress(st, dirPath)
  return node
}

export async function scanPathSync(targetPath: string, options: ScanOptions = {}): Promise<DiskNode> {
  const normalizedOptions = normalizeScanOptions(options)
  const internalOptions = normalizedOptions as InternalScanOptions
  const {
    onProgress,
    maxDepth = DEFAULT_MAX_DEPTH,
    concurrency = DEFAULT_CONCURRENCY,
    maxChildren = DEFAULT_MAX_CHILDREN,
    preserveNames = [],
    collapseNames = [],
    signatureNames = [],
    progressIntervalMs = DEFAULT_PROGRESS_INTERVAL_MS,
    signal,
    sizeMode = "physical",
    excludePaths = [],
    developerArtifactInventory,
  } = normalizedOptions

  const name = basename(targetPath) || targetPath
  const artifactInventoryOptions = normalizeDeveloperArtifactInventoryOptions(developerArtifactInventory)
  const st: WalkState = {
    pool: new ScanScheduler(normalizeScanConcurrency(concurrency), signal),
    maxDepth,
    maxChildren,
    preserveNames: new Set(preserveNames.map((name) => name.toLowerCase())),
    collapseNames: new Set(collapseNames.map((name) => name.toLowerCase())),
    signatureNames: new Set(signatureNames.map((name) => name.toLowerCase())),
    filesScanned: 0,
    dirsScanned: 0,
    lastProgressAt: 0,
    progressIntervalMs,
    onProgress,
    rootPath: targetPath,
    scannedBytes: 0,
    workProgress: 0,
    signal,
    sizeMode,
    claimedHardLinks: new Set(),
    hardLinkMetadata: new Map(),
    excludedPaths: new Set(excludePaths.map(comparablePath)),
    unreadableCount: 0,
    issueSamples: [],
    skippedSymlinkCount: 0,
    skippedSymlinkSamples: [],
    skippedDirectoryCount: 0,
    skippedDirectorySamples: [],
    excludedCount: 0,
    excludedSamples: [],
    ...(artifactInventoryOptions && internalOptions.inventoryIdentityReader
      ? { inventoryIdentityReader: internalOptions.inventoryIdentityReader }
      : {}),
    ...(artifactInventoryOptions
      ? {
          artifactInventory: {
            maxItems: artifactInventoryOptions.maxItems,
            items: [],
            matchedDirectories: 0,
            truncated: false,
          },
        }
      : {}),
    discoveriesEmitted: 0,
    fileDiscoveriesEmitted: 0,
  }

  const t0 = performance.now()
  const rootStats = await stat(targetPath)
  let root: DiskNode
  if (rootStats.isFile()) {
    const measured = measureFile(st, rootStats, targetPath)
    const dot = name.lastIndexOf(".")
    root = {
      name,
      path: targetPath,
      ...measured,
      isDir: false,
      children: EMPTY_CHILDREN,
      ext: dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "",
    }
    st.filesScanned = 1
    st.scannedBytes = measured.size
  } else if (rootStats.isDirectory()) {
    const inventoryScopeAllowed = await initializeInventoryDirectoryScope(st, targetPath)
    root = await walkDir(targetPath, name, st, 0, inventoryScopeAllowed)
  } else {
    throw new Error(`Unsupported scan target: ${targetPath}`)
  }
  if (sizeMode === "physical") {
    normalizeCompleteHardLinkGroups(root, st.hardLinkMetadata)
    // The portable scanner deliberately does not claim APFS clone metadata,
    // so even a fully walked fallback tree cannot promise complete shared
    // physical-storage evidence to a cleanup UI.
    root.sharedStorageEvidence = "partial"
  }
  root.cloneMetadata = CLONE_METADATA_UNAVAILABLE
  if (st.unreadableCount > 0) {
    root.scanIssues = { unreadableCount: st.unreadableCount, samplePaths: st.issueSamples }
  }
  attachDeveloperArtifactInventory(root, st)
  const ms = performance.now() - t0

  onProgress?.({
    filesScanned: st.filesScanned,
    dirsScanned: st.dirsScanned,
    currentPath: targetPath,
    size: root.size,
    percent: 100,
    done: true,
  })

  if (process.env.DISKLIZARD_SCAN_DEBUG) {
    console.log(
      `[disklizard] scanned ${st.filesScanned} files, ${st.dirsScanned} dirs in ${ms.toFixed(0)}ms (${(st.filesScanned / (ms / 1000)).toFixed(0)} files/s)`,
    )
  }

  return root
}

// ── Worker offload ────────────────────────────────────────────────────────

export function scanWorkerHref() {
  return new URL("./scan-worker.ts", import.meta.url)
}

function scanInWorker(targetPath: string, options: ScanOptions): Promise<DiskNode> {
  const normalizedOptions = normalizeScanOptions(options)
  const {
    onProgress,
    maxDepth = DEFAULT_MAX_DEPTH,
    concurrency = DEFAULT_CONCURRENCY,
    maxChildren = DEFAULT_MAX_CHILDREN,
    preserveNames = [],
    collapseNames = [],
    signatureNames = [],
    progressIntervalMs = DEFAULT_PROGRESS_INTERVAL_MS,
    sizeMode = "physical",
    excludePaths = [],
  } = normalizedOptions

  return new Promise((resolve, reject) => {
    if (normalizedOptions.signal?.aborted) {
      reject(normalizedOptions.signal.reason)
      return
    }

    const worker = new Worker(scanWorkerHref(), {
      workerData: {
        targetPath,
        maxDepth,
        concurrency: normalizeScanConcurrency(concurrency),
        maxChildren,
        preserveNames,
        collapseNames,
        signatureNames,
        progressIntervalMs,
        sizeMode,
        excludePaths,
      },
    })
    let settled = false

    const cleanup = () => normalizedOptions.signal?.removeEventListener("abort", onAbort)
    const finish = (result: { root: DiskNode } | { error: unknown }) => {
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate()
      if ("root" in result) resolve(result.root)
      else reject(result.error)
    }
    const onAbort = () => finish({ error: normalizedOptions.signal?.reason ?? new Error("Scan cancelled") })

    normalizedOptions.signal?.addEventListener("abort", onAbort, { once: true })
    if (normalizedOptions.signal?.aborted) {
      onAbort()
      return
    }

    worker.on(
      "message",
      (msg: {
        type: string
        root?: DiskNode
        filesScanned?: number
        dirsScanned?: number
        currentPath?: string
        size?: number
        percent?: number
        discovery?: ScanDiscovery
        message?: string
      }) => {
        if (settled) return
        if (msg.type === "progress") {
          onProgress?.({
            filesScanned: msg.filesScanned ?? 0,
            dirsScanned: msg.dirsScanned ?? 0,
            currentPath: msg.currentPath ?? targetPath,
            size: msg.size ?? 0,
            percent: msg.percent,
            discovery: msg.discovery,
          })
        } else if (msg.type === "done" && msg.root) {
          onProgress?.({
            filesScanned: msg.filesScanned ?? 0,
            dirsScanned: msg.dirsScanned ?? 0,
            currentPath: targetPath,
            size: msg.root.size,
            percent: 100,
            done: true,
          })
          finish({ root: msg.root })
        } else if (msg.type === "error") {
          finish({ error: new Error(msg.message || "Worker scan failed") })
        }
      },
    )

    worker.on("error", (err) => {
      finish({ error: err })
    })

    worker.on("exit", (code) => {
      if (!settled && code !== 0) finish({ error: new Error(`Scan worker exited with code ${code}`) })
    })
  })
}

/** Public entry — worker offload by default for responsiveness + same fast algorithm */
export async function scanPath(targetPath: string, options: ScanOptions = {}): Promise<DiskNode> {
  const normalizedOptions = normalizeScanOptions(options)
  normalizedOptions.signal?.throwIfAborted()
  // The inline worker intentionally remains a lightweight map-only fallback.
  // An opt-in inventory needs root-only status and records, so keep this path
  // in process rather than silently returning a tree without the requested
  // inventory. Native desktop scans retain their parallel inventory support.
  if (normalizedOptions.developerArtifactInventory)
    return scanPathSync(targetPath, { ...normalizedOptions, useWorker: false })
  const useWorker = normalizedOptions.useWorker !== false && typeof Worker !== "undefined"

  if (useWorker) {
    try {
      return await scanInWorker(targetPath, normalizedOptions)
    } catch (err) {
      normalizedOptions.signal?.throwIfAborted()
      // Fallback to in-process if worker fails (packaging / policy)
      if (process.env.DISKLIZARD_SCAN_DEBUG) console.warn("[disklizard] worker failed, in-process fallback", err)
    }
  }

  return scanPathSync(targetPath, normalizedOptions)
}

function isMissingPathError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT"
}

/**
 * Prove a permanent-deletion target is neither protected nor a mount root.
 * A supplied discovery lets callers reuse a fresh result and keeps the safety
 * policy deterministic in tests; incomplete discovery is always rejected.
 */
export async function assertSafeDeletionPath(targetPath: string, knownDiscovery?: DriveDiscovery) {
  const diskPlatform: DiskPlatform = OS === "darwin" || OS === "win32" ? OS : "linux"
  const blocked = deletionBlockReason(targetPath, diskPlatform, { homePath: homedir() })
  if (blocked) throw new Error(blocked)

  let info: Stats
  try {
    info = await lstat(targetPath)
  } catch (error) {
    if (isMissingPathError(error)) return
    throw error
  }

  const discovery = knownDiscovery ?? (await getDriveDiscovery())
  if (!discovery.complete || discovery.mountRoots.length === 0) {
    throw new Error("Permanent deletion is unavailable because mounted volumes could not be verified.")
  }

  const options = { homePath: homedir(), mountRoots: discovery.mountRoots }
  const mountBlock = deletionBlockReason(targetPath, diskPlatform, options)
  if (mountBlock) throw new Error(mountBlock)
  // Removing a symlink removes the link itself, not the directory it names.
  if (info.isSymbolicLink()) return

  let resolved: string
  try {
    resolved = await realpath(targetPath)
  } catch (error) {
    if (isMissingPathError(error)) return
    throw error
  }
  const resolvedBlock = deletionBlockReason(resolved, diskPlatform, options)
  if (resolvedBlock) throw new Error(resolvedBlock)

  let resolvedInfo: Stats
  let parentInfo: Stats
  try {
    resolvedInfo = await lstat(resolved)
    parentInfo = await lstat(dirname(resolved))
  } catch (error) {
    if (isMissingPathError(error)) return
    throw error
  }
  if (info.dev !== resolvedInfo.dev || info.ino !== resolvedInfo.ino) {
    throw new Error("The deletion target changed while it was being validated.")
  }
  if (resolvedInfo.dev !== parentInfo.dev) throw new Error("A mounted volume cannot be removed.")
}

export async function deleteDiskPath(targetPath: string) {
  await assertSafeDeletionPath(targetPath)
  await rm(targetPath, { recursive: true, force: true })
  return { ok: true }
}
