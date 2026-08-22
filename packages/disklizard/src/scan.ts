/**
 * DiskLizard scanner — shared by Desktop + TUI.
 * High-concurrency traversal; worker offload optional.
 */

import { readdir, stat, rm, access, lstat, realpath, readFile } from "node:fs/promises"
import { basename, dirname, sep } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { homedir, platform, cpus } from "node:os"
import { constants as fsConstants, type Dirent, type Stats } from "node:fs"
import { Worker } from "node:worker_threads"
import type {
  ApfsSnapshotEvidence,
  DeveloperArtifact,
  DeveloperArtifactDirectoryIdentity,
  DiskNode,
  DriveFacts,
  DriveInfo,
  ScanDiscovery,
  ScanOptions,
  ScanProgress,
} from "./types"
import { deletionBlockReason, type DiskPlatform } from "./safety"
import {
  DEVELOPER_ARTIFACT_EVIDENCE_NAMES,
  classifyDeveloperArtifact,
  normalizeDeveloperArtifactInventoryOptions,
} from "./developer-artifacts"

export type { DiskNode, DriveInfo, ScanDiscovery, ScanOptions, ScanProgress }

const execFileAsync = promisify(execFile)
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
    progressIntervalMs: normalizedInteger(options.progressIntervalMs, DEFAULT_PROGRESS_INTERVAL_MS, MIN_PROGRESS_INTERVAL_MS),
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
const MAC_DRIVE_FACT_CACHE_MS = 15_000
const MAC_DRIVE_ENRICHMENT_BUDGET_MS = 400
const macDriveFactsCache = new Map<string, { expiresAt: number; facts: MacDriveFacts }>()
const macDriveFactsInFlight = new Map<string, Promise<MacDriveFacts>>()

// ── Fast path join (avoid path.join overhead in hot loop) ─────────────────

function joinPath(parent: string, name: string): string {
  if (!parent) return name
  const last = parent.charCodeAt(parent.length - 1)
  if (last === 47 /* / */ || last === 92 /* \ */) return parent + name
  return parent + sep + name
}

// ── Concurrency pool ──────────────────────────────────────────────────────

class Pool {
  active = 0
  queue: Array<() => void> = []
  queueHead = 0
  limit: number

  constructor(limit: number) {
    this.limit = limit
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      const next = this.queueHead < this.queue.length ? this.queue[this.queueHead++] : undefined
      // Array.shift() moves every queued syscall on every completion. On a
      // volume scan that turned the scheduler itself into an O(n²) hot path.
      // Compact occasionally while keeping dequeue O(1) in the common case.
      if (this.queueHead === this.queue.length) {
        this.queue = []
        this.queueHead = 0
      } else if (this.queueHead > 4096 && this.queueHead * 2 > this.queue.length) {
        this.queue = this.queue.slice(this.queueHead)
        this.queueHead = 0
      }
      if (next) next()
    }
  }
}

function sortBySizeDesc(a: DiskNode, b: DiskNode) {
  if (a.size !== b.size) return b.size - a.size
  // JavaScript's string order is UTF-16 code-unit order. Keeping it explicit
  // makes top-K retention and Other samples stable across traversal timing.
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function apparentBytes(node: Pick<DiskNode, "size" | "logicalSize">) {
  return node.logicalSize ?? node.size
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// ── Core fast scanner ─────────────────────────────────────────────────────

type WalkState = {
  pool: Pool
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

function recordUnreadable(st: WalkState, targetPath: string) {
  st.unreadableCount++
  if (st.issueSamples.length < 12) st.issueSamples.push(targetPath)
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
async function childInventoryScope(
  st: WalkState,
  parentScopeAllowed: boolean,
  targetPath: string,
): Promise<boolean> {
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
) {
  const inventory = st.artifactInventory
  if (!inventory) return
  const classification = classifyDeveloperArtifact(name, basename(dirname(dirPath)), signatures)
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
      unreadableSamplePaths: [...st.issueSamples],
      skippedSymlinkCount: st.skippedSymlinkCount,
      skippedSymlinkSamplePaths: [...st.skippedSymlinkSamples],
      skippedDirectoryCount: st.skippedDirectoryCount,
      skippedDirectorySamplePaths: [...st.skippedDirectorySamples],
      unavailableDirectoryIdentityCount,
      unavailableDirectoryIdentitySamplePaths: unavailableDirectoryIdentityItems
        .slice(0, 12)
        .map((item) => item.path),
      excludedCount: st.excludedCount,
      excludedSamplePaths: [...st.excludedSamples],
    },
  }
}

/** Keep the ancestry of named artifacts so a small project is not lost inside `Other`. */
function containsPreservedNode(node: DiskNode, preserveNames: ReadonlySet<string>): boolean {
  if (preserveNames.has(node.name.toLowerCase())) return true
  for (const child of node.children) if (containsPreservedNode(child, preserveNames)) return true
  return false
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
    if (affectedDirectories.has(node)) node.children.sort(sortBySizeDesc)
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
    recordUnreadable(st, dirPath)
    return { size: 0 }
  }

  st.dirsScanned++
  let total = 0
  let totalLogicalSize = 0
  let modifiedAt = 0
  const signatures: string[] = []
  const artifactSignatures: string[] = []
  const tasks: Promise<void>[] = []

  for (let i = 0; i < entries.length; i++) {
    checkAborted(st)
    const ent = entries[i]
    const name = ent.name
    const normalizedName = name.toLowerCase()

    const childPath = joinPath(dirPath, name)
    // Prefer Dirent type checks — no extra syscall. Symlinks are deliberately
    // not followed; inventory status makes that omitted scope explicit.
    if (ent.isSymbolicLink()) {
      recordSkippedSymlink(st, childPath)
      continue
    }
    if (isExcluded(st, childPath)) {
      recordExcludedPath(st, childPath)
      continue
    }
    if (captureSignatures && st.signatureNames.has(normalizedName)) signatures.push(normalizedName)
    if (st.artifactInventory && DEVELOPER_ARTIFACT_EVIDENCE_NAMES.has(normalizedName)) {
      artifactSignatures.push(normalizedName)
    }

    if (ent.isDirectory()) {
      tasks.push(
        (async () => {
          const childScopeAllowed = await childInventoryScope(st, inventoryScopeAllowed, childPath)
          const measured = await sizeOnly(childPath, st, depth + 1, false, childScopeAllowed)
          total += measured.size
          totalLogicalSize += apparentBytes(measured)
          modifiedAt = Math.max(modifiedAt, measured.modifiedAt ?? 0)
        })(),
      )
    } else if (ent.isFile()) {
      tasks.push(
        st.pool
          .run(() => stat(childPath))
          .then(
            (s) => {
              const measured = measureFile(st, s)
              total += measured.size
              totalLogicalSize += apparentBytes(measured)
              modifiedAt = Math.max(modifiedAt, measured.modifiedAt ?? 0)
              st.filesScanned++
              st.scannedBytes += measured.size
            },
            () => recordUnreadable(st, childPath),
          ),
      )
    } else if (ent.isFIFO?.() || ent.isSocket?.() || ent.isCharacterDevice?.() || ent.isBlockDevice?.()) {
      // skip specials
    } else {
      // Unknown type (some FS): one stat to classify
      tasks.push(
        st.pool
          .run(() => stat(childPath))
          .then(
            async (s) => {
              if (s.isDirectory()) {
                const childScopeAllowed = await childInventoryScope(st, inventoryScopeAllowed, childPath)
                const measured = await sizeOnly(childPath, st, depth + 1, false, childScopeAllowed)
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
            },
            () => recordUnreadable(st, childPath),
          ),
      )
    }
  }

  if (tasks.length) await Promise.all(tasks)
  checkAborted(st)
  emitProgress(st, dirPath)
  const result = {
    size: total,
    ...(totalLogicalSize === total ? {} : { logicalSize: totalLogicalSize }),
    modifiedAt: modifiedAt || undefined,
    signatures: signatures.length > 0 ? signatures.sort() : undefined,
    artifactSignatures: artifactSignatures.length > 0 ? [...new Set(artifactSignatures)].sort() : undefined,
  }
  if (inventoryScopeAllowed) {
    await recordDeveloperArtifact(st, dirPath, basename(dirPath), result, result.artifactSignatures)
  }
  return result
}

async function walkCollapsedDir(
  dirPath: string,
  name: string,
  st: WalkState,
  depth: number,
  inventoryScopeAllowed = false,
): Promise<DiskNode> {
  const measured = await sizeOnly(dirPath, st, depth, true, inventoryScopeAllowed)
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
    const measured = await sizeOnly(dirPath, st, depth, false, inventoryScopeAllowed)
    node.size = measured.size
    node.logicalSize = measured.logicalSize
    node.modifiedAt = measured.modifiedAt
    return node
  }

  let entries: Dirent[]
  try {
    entries = await st.pool.run(() => readdir(dirPath, { withFileTypes: true }))
  } catch {
    recordUnreadable(st, dirPath)
    return node
  }

  st.dirsScanned++
  emitProgress(st, dirPath)

  const fileTasks: Promise<DiskNode | null>[] = []
  const dirTasks: Promise<DiskNode | null>[] = []
  const artifactSignatures: string[] = []

  for (let i = 0; i < entries.length; i++) {
    checkAborted(st)
    const ent = entries[i]
    const entName = ent.name
    const childPath = joinPath(dirPath, entName)
    if (ent.isSymbolicLink()) {
      recordSkippedSymlink(st, childPath)
      continue
    }
    if (isExcluded(st, childPath)) {
      recordExcludedPath(st, childPath)
      continue
    }
    const normalizedName = entName.toLowerCase()
    if (st.artifactInventory && DEVELOPER_ARTIFACT_EVIDENCE_NAMES.has(normalizedName)) {
      artifactSignatures.push(normalizedName)
    }

    if (ent.isDirectory()) {
      dirTasks.push(
        trackRootDiscovery(
          st,
          depth,
          (async () => {
            const childScopeAllowed = await childInventoryScope(st, inventoryScopeAllowed, childPath)
            return st.collapseNames.has(entName.toLowerCase())
              ? walkCollapsedDir(childPath, entName, st, depth + 1, childScopeAllowed)
              : walkDir(childPath, entName, st, depth + 1, childScopeAllowed)
          })(),
        ),
      )
    } else if (ent.isFile()) {
      // Fast ext extract without path.extname alloc when possible
      fileTasks.push(
        trackRootDiscovery(
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
      fileTasks.push(
        trackRootDiscovery(
          st,
          depth,
          st.pool
            .run(() => stat(childPath))
            .then(
            async (s) => {
              if (s.isDirectory()) {
                const childScopeAllowed = await childInventoryScope(st, inventoryScopeAllowed, childPath)
                return st.collapseNames.has(entName.toLowerCase())
                  ? walkCollapsedDir(childPath, entName, st, depth + 1, childScopeAllowed)
                  : walkDir(childPath, entName, st, depth + 1, childScopeAllowed)
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
  }

  // Dirs + files fully parallel; pool already caps syscall concurrency
  const [dirNodes, fileNodes] = await Promise.all([
    dirTasks.length ? Promise.all(dirTasks) : Promise.resolve([] as DiskNode[]),
    fileTasks.length ? Promise.all(fileTasks) : Promise.resolve([] as (DiskNode | null)[]),
  ])
  checkAborted(st)

  const all: DiskNode[] = []
  let totalSize = 0
  let totalLogicalSize = 0
  let modifiedAt = 0
  for (const d of dirNodes) {
    if (!d) continue
    if (d.size > 0 || d.children.length > 0) {
      all.push(d)
      totalSize += d.size
      totalLogicalSize += apparentBytes(d)
      modifiedAt = Math.max(modifiedAt, d.modifiedAt ?? 0)
    }
  }
  for (const f of fileNodes) {
    if (f && (f.size > 0 || f.hardLink)) {
      all.push(f)
      totalSize += f.size
      totalLogicalSize += apparentBytes(f)
      modifiedAt = Math.max(modifiedAt, f.modifiedAt ?? 0)
    }
  }

  const k = st.maxChildren
  if (all.length <= k) {
    all.sort(sortBySizeDesc)
    node.children = all
  } else {
    all.sort(sortBySizeDesc)
    const top = all.slice(0, k)
    const rest: DiskNode[] = []
    let restSize = 0
    let restLogicalSize = 0
    let restModifiedAt = 0
    for (let i = k; i < all.length; i++) {
      const child = all[i]
      if (containsPreservedNode(child, st.preserveNames)) top.push(child)
      else {
        rest.push(child)
        restSize += child.size
        restLogicalSize += apparentBytes(child)
        restModifiedAt = Math.max(restModifiedAt, child.modifiedAt ?? 0)
      }
    }
    if (restSize > 0) {
      top.push({
        name: `Other (${rest.length} items)`,
        path: joinPath(dirPath, "__other__"),
        size: restSize,
        ...(restLogicalSize === restSize ? {} : { logicalSize: restLogicalSize }),
        modifiedAt: restModifiedAt || undefined,
        isDir: true,
        children: rest.slice(0, 12),
        ext: "",
        isOther: true,
      })
    }
    node.children = top
  }

  node.size = totalSize
  node.logicalSize = totalLogicalSize === totalSize ? undefined : totalLogicalSize
  node.modifiedAt = modifiedAt || undefined
  if (inventoryScopeAllowed) {
    await recordDeveloperArtifact(st, dirPath, name, node, [...new Set(artifactSignatures)].sort())
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
    pool: new Pool(normalizeScanConcurrency(concurrency)),
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

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { readdir, stat } = require("node:fs/promises");
const { basename } = require("node:path");
const { cpus, platform } = require("node:os");
const { sep } = require("node:path");

const CPU_COUNT = Math.max(1, (cpus() || []).length || 1);
function defaultScanConcurrency(cpuCount) {
  const cores = Math.max(1, Math.floor(cpuCount) || 1);
  return Math.min(12, Math.max(4, cores + 2));
}
const DEFAULT_CONCURRENCY = defaultScanConcurrency(CPU_COUNT);
const EMPTY_CHILDREN = Object.freeze([]);
const CLONE_METADATA_UNAVAILABLE = Object.freeze({ state: "unavailable", reason: "scanner" });
const MAX_SCAN_DISCOVERIES = 96;
const MAX_SCAN_FILE_DISCOVERIES = 24;
const IS_WIN = platform() === "win32";

function joinPath(parent, name) {
  if (!parent) return name;
  const last = parent.charCodeAt(parent.length - 1);
  if (last === 47 || last === 92) return parent + name;
  return parent + sep + name;
}
function comparablePath(value) {
  const normalized = value.length > 1 ? value.replace(/[\\\\/]+$/, "") : value;
  return IS_WIN ? normalized.toLowerCase() : normalized;
}
function isExcluded(st, targetPath) { return st.excludedPaths.has(comparablePath(targetPath)); }
class Pool {
  constructor(limit) { this.limit = limit; this.active = 0; this.queue = []; this.queueHead = 0; }
  async run(fn) {
    if (this.active >= this.limit) await new Promise(r => this.queue.push(r));
    this.active++;
    try { return await fn(); }
    finally {
      this.active--;
      const n = this.queueHead < this.queue.length ? this.queue[this.queueHead++] : undefined;
      if (this.queueHead === this.queue.length) {
        this.queue = [];
        this.queueHead = 0;
      } else if (this.queueHead > 4096 && this.queueHead * 2 > this.queue.length) {
        this.queue = this.queue.slice(this.queueHead);
        this.queueHead = 0;
      }
      if (n) n();
    }
  }
}
function sortBySizeDesc(a,b){
  if (a.size !== b.size) return b.size - a.size;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
function apparentBytes(node) { return node.logicalSize ?? node.size; }
function measureFile(st, stats, nodePath) {
  const logicalSize = stats.size;
  const allocatedSize = st.sizeMode === "physical" && !IS_WIN && typeof stats.blocks === "number" ? stats.blocks * 512 : logicalSize;
  let size = allocatedSize;
  let hardLink;
  if (st.sizeMode === "physical" && stats.nlink > 1 && stats.ino > 0) {
    const key = stats.dev + ":" + stats.ino;
    if (st.claimedHardLinks.has(key)) { size = 0; hardLink = "secondary"; }
    else { st.claimedHardLinks.add(key); hardLink = "primary"; }
    if (nodePath && Number.isSafeInteger(stats.dev) && Number.isSafeInteger(stats.ino) && Number.isSafeInteger(stats.nlink) && Number.isSafeInteger(allocatedSize) && allocatedSize >= 0) {
      st.hardLinkMetadata.set(nodePath, { identity: key, reportedCount: stats.nlink, physicalSize: allocatedSize });
    }
  }
  return { size, logicalSize: logicalSize === size ? undefined : logicalSize, hardLink, modifiedAt: Number.isFinite(stats.mtimeMs) && stats.mtimeMs > 0 ? stats.mtimeMs : undefined };
}
function isSafeByteCount(value) { return Number.isSafeInteger(value) && value >= 0; }
function nodeAt(root, indices) {
  let node = root;
  for (const index of indices) {
    const child = node.children[index];
    if (!child) return undefined;
    node = child;
  }
  return node;
}
function compareLexicalPaths(left, right) { return left === right ? 0 : (left < right ? -1 : 1); }
// Normalize only exact, fully retained groups. The inline worker intentionally
// mirrors the in-process fallback so its parallel traversal cannot choose a
// different persistent hard-link primary.
function normalizeCompleteHardLinkGroups(root, metadata) {
  const groups = new Map();
  const indices = [];
  const affectedDirectories = new Set();
  const collect = node => {
    if (!node.isDir) {
      const info = metadata.get(node.path);
      if (info && node.hardLink) {
        const logicalSize = apparentBytes(node);
        if (isSafeByteCount(node.size) && isSafeByteCount(logicalSize) && isSafeByteCount(info.physicalSize) && Number.isSafeInteger(info.reportedCount) && info.reportedCount > 1) {
          const candidate = { ...info, indices: indices.slice(), sortKey: node.path, logicalSize, chargedSize: node.size, hardLink: node.hardLink };
          const members = groups.get(info.identity);
          if (members) members.push(candidate); else groups.set(info.identity, [candidate]);
        }
      }
    }
    for (let index = 0; index < node.children.length; index++) {
      indices.push(index);
      collect(node.children[index]);
      indices.pop();
    }
  };
  const canTransferCharge = (source, destination, size) => {
    if (!isSafeByteCount(root.size) || root.size < size) return false;
    let sourceNode = root;
    for (const index of source) {
      const child = sourceNode.children[index];
      if (!child) return false;
      sourceNode = child;
      if (sourceNode.isDir && (!isSafeByteCount(sourceNode.size) || sourceNode.size < size)) return false;
    }
    let destinationNode = root;
    let sharedPrefix = true;
    for (let depth = 0; depth < destination.length; depth++) {
      const index = destination[depth];
      const child = destinationNode.children[index];
      if (!child) return false;
      destinationNode = child;
      sharedPrefix = sharedPrefix && source[depth] === index;
      if (destinationNode.isDir && !sharedPrefix && (!isSafeByteCount(destinationNode.size) || destinationNode.size > Number.MAX_SAFE_INTEGER - size)) return false;
    }
    return true;
  };
  const adjustDirectorySize = (node, delta) => {
    const logicalSize = apparentBytes(node);
    node.size += delta;
    node.logicalSize = logicalSize === node.size ? undefined : logicalSize;
  };
  const subtractCharge = (path, size) => {
    if (root.isDir) adjustDirectorySize(root, -size);
    let node = root;
    for (const index of path) { node = node.children[index]; if (node.isDir) adjustDirectorySize(node, -size); }
  };
  const addCharge = (path, size) => {
    if (root.isDir) adjustDirectorySize(root, size);
    let node = root;
    for (const index of path) { node = node.children[index]; if (node.isDir) adjustDirectorySize(node, size); }
  };
  const markAffectedDirectories = path => {
    let node = root;
    if (node.isDir) affectedDirectories.add(node);
    for (let depth = 0; depth + 1 < path.length; depth++) {
      const child = node.children[path[depth]];
      if (!child || !child.isDir) return;
      node = child;
      affectedDirectories.add(node);
    }
  };
  const sortAffectedDirectories = node => {
    for (const child of node.children) sortAffectedDirectories(child);
    if (affectedDirectories.has(node)) node.children.sort(sortBySizeDesc);
  };
  collect(root);
  for (const members of groups.values()) {
    const first = members[0];
    if (!first) continue;
    const expectedCount = first.reportedCount;
    const physicalSize = first.physicalSize;
    const logicalSize = first.logicalSize;
    const distinctPaths = new Set(members.map(member => member.indices.join("/")));
    const primaryCount = members.filter(member => member.hardLink === "primary").length;
    if (members.length !== expectedCount || distinctPaths.size !== members.length || primaryCount !== 1 || members.some(member => member.reportedCount !== expectedCount || member.physicalSize !== physicalSize || member.logicalSize !== logicalSize || member.chargedSize !== (member.hardLink === "primary" ? physicalSize : 0))) continue;
    const currentPrimary = members.find(member => member.hardLink === "primary");
    const desiredPrimary = members.slice().sort((left, right) => compareLexicalPaths(left.sortKey, right.sortKey))[0];
    if (!currentPrimary || !desiredPrimary) continue;
    if (currentPrimary.indices.join("/") !== desiredPrimary.indices.join("/")) {
      if (!canTransferCharge(currentPrimary.indices, desiredPrimary.indices, physicalSize)) continue;
      subtractCharge(currentPrimary.indices, physicalSize);
      addCharge(desiredPrimary.indices, physicalSize);
      markAffectedDirectories(currentPrimary.indices);
      markAffectedDirectories(desiredPrimary.indices);
    }
    const primaryPath = desiredPrimary.indices.join("/");
    for (const member of members) {
      const node = nodeAt(root, member.indices);
      if (!node) continue;
      const isPrimary = member.indices.join("/") === primaryPath;
      node.size = isPrimary ? physicalSize : 0;
      node.logicalSize = logicalSize === node.size ? undefined : logicalSize;
      node.hardLink = isPrimary ? "primary" : "secondary";
    }
  }
  if (affectedDirectories.size > 0) sortAffectedDirectories(root);
}
function tick(st, currentPath) {
  if (!st.onTick || performance.now() - st.lastTick <= st.progressIntervalMs) return;
  st.lastTick = performance.now();
  parentPort.postMessage({ type: "progress", filesScanned: st.filesScanned, dirsScanned: st.dirsScanned, currentPath, size: st.scannedBytes });
}
function discover(st, node) {
  if (!st.onTick || node.size <= 0 || st.discoveriesEmitted >= MAX_SCAN_DISCOVERIES || (!node.isDir && st.fileDiscoveriesEmitted >= MAX_SCAN_FILE_DISCOVERIES)) return;
  st.discoveriesEmitted++;
  if (!node.isDir) st.fileDiscoveriesEmitted++;
  parentPort.postMessage({
    type: "progress",
    filesScanned: st.filesScanned,
    dirsScanned: st.dirsScanned,
    currentPath: node.path,
    size: st.scannedBytes,
    discovery: { name: node.name, path: node.path, size: node.size, modifiedAt: node.modifiedAt, isDir: node.isDir },
  });
}
function trackRootDiscovery(st, depth, task) {
  if (depth !== 0) return task;
  return task.then(node => { if (node) discover(st, node); return node; });
}
function recordUnreadable(st, targetPath) {
  st.unreadableCount++;
  if (st.issueSamples.length < 12) st.issueSamples.push(targetPath);
}
function containsPreservedNode(node, preserveNames) {
  if (preserveNames.has(node.name.toLowerCase())) return true;
  for (const child of node.children) if (containsPreservedNode(child, preserveNames)) return true;
  return false;
}

async function sizeOnly(dirPath, st, depth, captureSignatures = false) {
  let entries;
  try { entries = await st.pool.run(() => readdir(dirPath, { withFileTypes: true })); }
  catch { recordUnreadable(st, dirPath); return { size: 0 }; }
  st.dirsScanned++;
  let total = 0;
  let totalLogicalSize = 0;
  let modifiedAt = 0;
  const signatures = [];
  const tasks = [];
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;
    const normalizedName = ent.name.toLowerCase();
    const childPath = joinPath(dirPath, ent.name);
    if (isExcluded(st, childPath)) continue;
    if (captureSignatures && st.signatureNames.has(normalizedName)) signatures.push(normalizedName);
    if (ent.isDirectory()) tasks.push(sizeOnly(childPath, st, depth+1).then(measured => { total += measured.size; totalLogicalSize += apparentBytes(measured); modifiedAt = Math.max(modifiedAt, measured.modifiedAt || 0); }));
    else if (ent.isFile()) tasks.push(st.pool.run(() => stat(childPath)).then(s => { const measured = measureFile(st, s); total += measured.size; totalLogicalSize += apparentBytes(measured); modifiedAt = Math.max(modifiedAt, measured.modifiedAt || 0); st.filesScanned++; st.scannedBytes += measured.size; }, () => recordUnreadable(st, childPath)));
    else if (ent.isFIFO?.() || ent.isSocket?.() || ent.isCharacterDevice?.() || ent.isBlockDevice?.()) continue;
    else tasks.push(st.pool.run(() => stat(childPath)).then(async s => {
      if (s.isDirectory()) { const measured = await sizeOnly(childPath, st, depth+1); total += measured.size; totalLogicalSize += apparentBytes(measured); modifiedAt = Math.max(modifiedAt, measured.modifiedAt || 0); }
      else if (s.isFile()) { const measured = measureFile(st, s); total += measured.size; totalLogicalSize += apparentBytes(measured); modifiedAt = Math.max(modifiedAt, measured.modifiedAt || 0); st.filesScanned++; st.scannedBytes += measured.size; }
    }, () => recordUnreadable(st, childPath)));
  }
  if (tasks.length) await Promise.all(tasks);
  tick(st, dirPath);
  return { size: total, ...(totalLogicalSize === total ? {} : { logicalSize: totalLogicalSize }), modifiedAt: modifiedAt || undefined, signatures: signatures.length ? signatures.sort() : undefined };
}

async function walkCollapsedDir(dirPath, name, st, depth) {
  const measured = await sizeOnly(dirPath, st, depth, true);
  return { name, path: dirPath, ...measured, isDir: true, isCollapsed: true, children: [], ext: "" };
}

async function walkDir(dirPath, name, st, depth) {
  const node = { name, path: dirPath, size: 0, isDir: true, children: [], ext: "" };
  if (depth > st.maxDepth) { const measured = await sizeOnly(dirPath, st, depth); node.size = measured.size; node.logicalSize = measured.logicalSize; node.modifiedAt = measured.modifiedAt; return node; }
  let entries;
  try { entries = await st.pool.run(() => readdir(dirPath, { withFileTypes: true })); }
  catch { recordUnreadable(st, dirPath); return node; }
  st.dirsScanned++;
  tick(st, dirPath);
  const fileTasks = [];
  const dirTasks = [];
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;
    const childPath = joinPath(dirPath, ent.name);
    if (isExcluded(st, childPath)) continue;
    if (ent.isDirectory()) dirTasks.push(trackRootDiscovery(st, depth, st.collapseNames.has(ent.name.toLowerCase()) ? walkCollapsedDir(childPath, ent.name, st, depth+1) : walkDir(childPath, ent.name, st, depth+1)));
    else if (ent.isFile()) fileTasks.push(trackRootDiscovery(st, depth, st.pool.run(() => stat(childPath)).then(s => {
      const measured = measureFile(st, s, childPath);
      st.filesScanned++; st.scannedBytes += measured.size;
      const dot = ent.name.lastIndexOf(".");
      const ext = dot > 0 ? ent.name.slice(dot+1).toLowerCase() : "";
      return { name: ent.name, path: childPath, ...measured, isDir: false, children: EMPTY_CHILDREN, ext };
    }, () => { recordUnreadable(st, childPath); return null; })));
    else fileTasks.push(trackRootDiscovery(st, depth, st.pool.run(() => stat(childPath)).then(async s => {
      if (s.isDirectory()) return st.collapseNames.has(ent.name.toLowerCase()) ? walkCollapsedDir(childPath, ent.name, st, depth+1) : walkDir(childPath, ent.name, st, depth+1);
      if (s.isFile()) {
        const measured = measureFile(st, s, childPath);
        st.filesScanned++; st.scannedBytes += measured.size;
        return { name: ent.name, path: childPath, ...measured, isDir: false, children: EMPTY_CHILDREN, ext: "" };
      }
      return null;
    }, () => { recordUnreadable(st, childPath); return null; })));
  }
  const [dirNodes, fileNodes] = await Promise.all([
    dirTasks.length ? Promise.all(dirTasks) : [],
    fileTasks.length ? Promise.all(fileTasks) : [],
  ]);
  const all = [];
  let totalSize = 0;
  let totalLogicalSize = 0;
  let modifiedAt = 0;
  for (const d of dirNodes) { if (d.size > 0 || d.children.length) { all.push(d); totalSize += d.size; totalLogicalSize += apparentBytes(d); modifiedAt = Math.max(modifiedAt, d.modifiedAt || 0); } }
  for (const f of fileNodes) { if (f && (f.size > 0 || f.hardLink)) { all.push(f); totalSize += f.size; totalLogicalSize += apparentBytes(f); modifiedAt = Math.max(modifiedAt, f.modifiedAt || 0); } }
  const k = st.maxChildren;
  if (all.length <= k) { all.sort(sortBySizeDesc); node.children = all; }
  else {
    all.sort(sortBySizeDesc);
    const top = all.slice(0, k);
    const rest = [];
    let restSize = 0;
    let restLogicalSize = 0;
    let restModifiedAt = 0;
    for (let i = k; i < all.length; i++) {
      const child = all[i];
      if (containsPreservedNode(child, st.preserveNames)) top.push(child);
      else { rest.push(child); restSize += child.size; restLogicalSize += apparentBytes(child); restModifiedAt = Math.max(restModifiedAt, child.modifiedAt || 0); }
    }
    if (restSize > 0) top.push({ name: "Other (" + rest.length + " items)", path: joinPath(dirPath,"__other__"), size: restSize, ...(restLogicalSize === restSize ? {} : { logicalSize: restLogicalSize }), modifiedAt: restModifiedAt || undefined, isDir: true, children: rest.slice(0,12), ext: "", isOther: true });
    node.children = top;
  }
  node.size = totalSize;
  node.logicalSize = totalLogicalSize === totalSize ? undefined : totalLogicalSize;
  node.modifiedAt = modifiedAt || undefined;
  tick(st, dirPath);
  return node;
}

(async () => {
  const { targetPath, maxDepth, concurrency, maxChildren, preserveNames, collapseNames, signatureNames, progressIntervalMs, sizeMode, excludePaths } = workerData;
  const name = basename(targetPath) || targetPath;
  const st = { pool: new Pool(concurrency || DEFAULT_CONCURRENCY), maxDepth: maxDepth ?? 10, maxChildren: maxChildren ?? 48, preserveNames: new Set((preserveNames ?? []).map(name => name.toLowerCase())), collapseNames: new Set((collapseNames ?? []).map(name => name.toLowerCase())), signatureNames: new Set((signatureNames ?? []).map(name => name.toLowerCase())), filesScanned: 0, dirsScanned: 0, scannedBytes: 0, lastTick: 0, progressIntervalMs: progressIntervalMs ?? 100, onTick: true, sizeMode: sizeMode ?? "physical", claimedHardLinks: new Set(), hardLinkMetadata: new Map(), excludedPaths: new Set((excludePaths ?? []).map(comparablePath)), unreadableCount: 0, issueSamples: [], discoveriesEmitted: 0, fileDiscoveriesEmitted: 0 };
  try {
    const rootStats = await stat(targetPath);
    let root;
    if (rootStats.isFile()) {
      const measured = measureFile(st, rootStats, targetPath);
      const dot = name.lastIndexOf(".");
      root = { name, path: targetPath, ...measured, isDir: false, children: EMPTY_CHILDREN, ext: dot > 0 && dot < name.length - 1 ? name.slice(dot+1).toLowerCase() : "" };
      st.filesScanned = 1;
      st.scannedBytes = measured.size;
    } else if (rootStats.isDirectory()) root = await walkDir(targetPath, name, st, 0);
    else throw new Error("Unsupported scan target: " + targetPath);
    if ((sizeMode ?? "physical") === "physical") {
      normalizeCompleteHardLinkGroups(root, st.hardLinkMetadata);
      root.sharedStorageEvidence = "partial";
    }
    root.cloneMetadata = CLONE_METADATA_UNAVAILABLE;
    if (st.unreadableCount > 0) root.scanIssues = { unreadableCount: st.unreadableCount, samplePaths: st.issueSamples };
    parentPort.postMessage({ type: "done", root, filesScanned: st.filesScanned, dirsScanned: st.dirsScanned });
  } catch (err) {
    parentPort.postMessage({ type: "error", message: err && err.message ? err.message : String(err) });
  }
})();
`

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

    // eval worker from inline source — no extra file to ship
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
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
            discovery: msg.discovery,
          })
        } else if (msg.type === "done" && msg.root) {
          onProgress?.({
            filesScanned: msg.filesScanned ?? 0,
            dirsScanned: msg.dirsScanned ?? 0,
            currentPath: targetPath,
            size: msg.root.size,
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

// ── Drives (fast Windows path: WMIC is slower; prefer PowerShell once) ────

/**
 * Drive-picker entries and the stricter mount evidence required by permanent
 * deletion. `drives` may intentionally omit support/system mounts; `mountRoots`
 * must not. `complete` is false whenever the platform enumeration fell back or
 * any discovery row could not be understood.
 */
export type DriveDiscovery = {
  drives: DriveInfo[]
  mountRoots: string[]
  complete: boolean
}

export function mountExclusions(targetPath: string, drives: readonly DriveInfo[], os: NodeJS.Platform = OS): string[] {
  const normalize = (value: string) => {
    const normalized = value.length > 1 ? value.replace(/[\\/]+$/, "") : value
    return os === "win32" ? normalized.toLowerCase() : normalized
  }
  const target = normalize(targetPath)
  const boundary = target.endsWith("/") || target.endsWith("\\") ? target : target + (os === "win32" ? "\\" : "/")
  return drives
    .map((drive) => ({ original: drive.path, normalized: normalize(drive.path) }))
    .filter(({ normalized }) => normalized !== target && normalized.startsWith(boundary))
    .map(({ original }) => original)
}

type MacDriveFacts = DriveFacts

const MAX_APFS_SNAPSHOT_EVIDENCE = 48

function plistScalar(xml: string, key: string) {
  const keyPattern = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return xml.match(new RegExp(`<key>${keyPattern}</key>\\s*<(?:string|integer)>([^<]*)</(?:string|integer)>`))?.[1]?.trim()
}

/** Parse the tiny, stable subset of `diskutil info -plist` used for capacity caveats. */
export function parseMacDriveInfoPlist(xml: string): Pick<DriveInfo, "filesystem" | "sharedFree"> {
  const filesystem = plistScalar(xml, "FilesystemType")?.toLowerCase()
  const containerFree = Number(plistScalar(xml, "APFSContainerFree"))
  return {
    ...(filesystem ? { filesystem } : {}),
    ...(filesystem === "apfs" && Number.isFinite(containerFree) && containerFree >= 0 ? { sharedFree: containerFree } : {}),
  }
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function plistBoolean(xml: string, key: string) {
  const keyPattern = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const value = xml.match(new RegExp(`<key>${keyPattern}</key>\\s*<(true|false)\\s*/>`, "i"))?.[1]
  if (value !== undefined) return value.toLowerCase() === "true"

  // Older diskutil builds have emitted the same value as a string. Accept the
  // explicit spelling, but leave every other value unknown rather than
  // treating it as false.
  const scalar = plistScalar(xml, key)?.toLowerCase()
  if (scalar === "true" || scalar === "yes" || scalar === "1") return true
  if (scalar === "false" || scalar === "no" || scalar === "0") return false
  return undefined
}

function explicitBoolean(value: string | undefined) {
  if (!value) return undefined
  if (/^(?:yes|true|1)$/i.test(value)) return true
  if (/^(?:no|false|0)$/i.test(value)) return false
  return undefined
}

function isTimeMachineSnapshot(snapshot: ApfsSnapshotEvidence) {
  // Snapshot names are user-visible and can be arbitrary. Only recognize the
  // documented Apple namespaces, not a loose substring in a custom name.
  return /^com\.apple\.(?:TimeMachine|backupd)(?:\.|$)/i.test(snapshot.name ?? "")
}

function snapshotFacts(snapshots: ApfsSnapshotEvidence[], count = snapshots.length): Pick<
  DriveInfo,
  "snapshotCount" | "purgeableSnapshotCount" | "timeMachineSnapshotCount" | "apfsSnapshots"
> {
  const normalized = snapshots.map((snapshot) => ({
    ...snapshot,
    ...(isTimeMachineSnapshot(snapshot) ? { isTimeMachine: true } : {}),
  }))
  const purgeableSnapshotCount = normalized.filter((snapshot) => snapshot.purgeable).length
  const timeMachineSnapshotCount = normalized.filter((snapshot) => snapshot.isTimeMachine).length
  return {
    snapshotCount: count,
    apfsSnapshots: normalized.slice(0, MAX_APFS_SNAPSHOT_EVIDENCE),
    ...(purgeableSnapshotCount ? { purgeableSnapshotCount } : {}),
    ...(timeMachineSnapshotCount ? { timeMachineSnapshotCount } : {}),
  }
}

/** Parse `diskutil apfs listSnapshots -plist` without turning snapshot identities into a size estimate. */
export function parseApfsSnapshotPlist(xml: string): Pick<
  DriveInfo,
  "snapshotCount" | "purgeableSnapshotCount" | "timeMachineSnapshotCount" | "apfsSnapshots"
> {
  const keyedArray = xml.match(/<key>Snapshots<\/key>\s*<array(?:\s[^>]*)?>([\s\S]*?)<\/array>/i)?.[1]
  // `diskutil` has used both a keyed dictionary and a top-level array for
  // plist subcommands. Only accept a top-level array as a fallback, never an
  // arbitrary nested one from an unrelated plist value.
  const rootArray = xml.match(/<plist(?:\s[^>]*)?>\s*<array(?:\s[^>]*)?>([\s\S]*?)<\/array>\s*<\/plist>/i)?.[1]
  const emptyKeyedArray = /<key>Snapshots<\/key>\s*<array(?:\s[^>]*)?\s*\/>/i.test(xml)
  const emptyRootArray = /<plist(?:\s[^>]*)?>\s*<array(?:\s[^>]*)?\s*\/>\s*<\/plist>/i.test(xml)
  const array = keyedArray ?? rootArray ?? (emptyKeyedArray || emptyRootArray ? "" : undefined)
  if (array === undefined) return {}
  const snapshots = (array.match(/<dict>[\s\S]*?<\/dict>/gi) ?? []).map((entry) => {
    const name = plistScalar(entry, "SnapshotName") ?? plistScalar(entry, "Name")
    const uuid = plistScalar(entry, "SnapshotUUID") ?? plistScalar(entry, "UUID")
    const purgeable = plistBoolean(entry, "SnapshotPurgeable") ?? plistBoolean(entry, "Purgeable")
    return {
      ...(name ? { name: decodeXml(name) } : {}),
      ...(uuid ? { uuid: decodeXml(uuid) } : {}),
      ...(purgeable === undefined ? {} : { purgeable }),
    }
  })
  return snapshotFacts(snapshots)
}

/** Parse the human-readable `diskutil` fallback while preserving only read-only snapshot facts. */
export function parseApfsSnapshotOutput(stdout: string): Pick<
  DriveInfo,
  "snapshotCount" | "purgeableSnapshotCount" | "timeMachineSnapshotCount" | "apfsSnapshots"
> {
  const entries = stdout.split(/^\+--\s+/m).slice(1)
  const reportedCount = Number(stdout.match(/\((\d+)\s+found\)/i)?.[1])
  const count = Number.isSafeInteger(reportedCount) && reportedCount >= 0 ? reportedCount : entries.length
  if (entries.length === 0) {
    if (!/Snapshot(?:s)?\s+for\b/i.test(stdout)) return {}
    return snapshotFacts([], 0)
  }
  const snapshots = entries.map((entry) => {
    const [header = "", ...bodyLines] = entry.split("\n")
    const body = bodyLines.join("\n")
    const value = (key: string) => body.match(new RegExp(`^\\s*${key}:\\s*(.*?)\\s*$`, "im"))?.[1]?.trim()
    const uuid = value("UUID") ?? value("Snapshot UUID") ?? (/^[0-9a-f-]{36}$/i.test(header) ? header : undefined)
    const name = value("Name") ?? value("Snapshot Name")
    const purgeable = explicitBoolean(value("Purgeable"))
    return {
      ...(name ? { name } : {}),
      ...(uuid ? { uuid } : {}),
      ...(purgeable === undefined ? {} : { purgeable }),
    }
  })
  return snapshotFacts(snapshots, count)
}

function applyMacDriveFacts(drive: DriveInfo, facts: MacDriveFacts): DriveInfo {
  return {
    ...drive,
    ...facts,
    // Facts are cached. Keep callers from accidentally mutating the cached
    // read-only evidence list or its entries between drive refreshes.
    ...(facts.apfsSnapshots ? { apfsSnapshots: facts.apfsSnapshots.map((snapshot) => ({ ...snapshot })) } : {}),
  }
}

function copyMacDriveFacts(facts: MacDriveFacts): MacDriveFacts {
  return {
    ...facts,
    ...(facts.apfsSnapshots ? { apfsSnapshots: facts.apfsSnapshots.map((snapshot) => ({ ...snapshot })) } : {}),
  }
}

async function collectMacDriveFacts(drive: Pick<DriveInfo, "path">): Promise<MacDriveFacts> {
  try {
    const { stdout } = await execFileAsync("diskutil", ["info", "-plist", drive.path], {
      maxBuffer: 1024 * 1024,
      timeout: 3_000,
    })
    const facts: MacDriveFacts = parseMacDriveInfoPlist(stdout)
    if (facts.filesystem === "apfs") {
      try {
        const snapshots = await execFileAsync("diskutil", ["apfs", "listSnapshots", "-plist", drive.path], {
          maxBuffer: 1024 * 1024,
          timeout: 3_000,
        })
        Object.assign(facts, parseApfsSnapshotPlist(snapshots.stdout))
      } catch {
        // Some APFS mounts (notably sealed system volumes) decline a snapshot listing; the filesystem fact is still useful.
      }
    }
    return facts
  } catch {
    // Cache the absence briefly too: a machine where DiskManagement is
    // unavailable should not launch a fresh failed process on every refresh.
    return {}
  }
}

function loadMacDriveFacts(drive: Pick<DriveInfo, "path">): Promise<MacDriveFacts> {
  const cached = macDriveFactsCache.get(drive.path)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.facts)

  let inFlight = macDriveFactsInFlight.get(drive.path)
  if (!inFlight) {
    inFlight = collectMacDriveFacts(drive)
      .then((facts) => {
        macDriveFactsCache.set(drive.path, { facts, expiresAt: Date.now() + MAC_DRIVE_FACT_CACHE_MS })
        return facts
      })
      .finally(() => macDriveFactsInFlight.delete(drive.path))
    macDriveFactsInFlight.set(drive.path, inFlight)
  }
  return inFlight
}

async function enrichMacDrive(drive: DriveInfo): Promise<DriveInfo> {
  return applyMacDriveFacts(drive, await loadMacDriveFacts(drive))
}

/**
 * Resolve optional filesystem/snapshot facts for one already-discovered drive.
 *
 * `getDrives()` intentionally returns after a short first-paint budget. A
 * desktop host can call this afterwards and publish an IPC/UI update when it
 * resolves; concurrent calls join the same in-flight `diskutil` work. The
 * result is evidence only and never includes a snapshot byte estimate.
 */
export async function getDriveFacts(path: string): Promise<DriveFacts> {
  if (OS !== "darwin") return {}
  return copyMacDriveFacts(await loadMacDriveFacts({ path }))
}

function enrichMacDrivesWithinBudget(drives: DriveInfo[]): Promise<DriveInfo[]> {
  // Network mounts cannot be APFS volumes and are most likely to stall a
  // metadata command. Start only local/removable enrichment in the background.
  const enrichment = Promise.all(drives.map((drive) => (drive.type === "network" ? drive : enrichMacDrive(drive))))
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: DriveInfo[]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => finish(drives), MAC_DRIVE_ENRICHMENT_BUDGET_MS)
    void enrichment.then(finish, () => finish(drives))
  })
}

const WINDOWS_DRIVE_DISCOVERY_SCRIPT = [
  "$drives = @(Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,Size,FreeSpace,DriveType)",
  "$complete = $true",
  "$mountRoots = @()",
  "try { $mountRoots = @(Get-Partition -ErrorAction Stop | ForEach-Object { $_.AccessPaths }) } catch { $complete = $false }",
  "[pscustomobject]@{ Drives = $drives; MountRoots = @($mountRoots | Where-Object { $_ } | Sort-Object -Unique); Complete = $complete } | ConvertTo-Json -Compress -Depth 4",
].join("; ")

function fallbackSystemDrive(): DriveInfo {
  return { path: "/", name: "System", label: "System (/)", total: 0, free: 0, used: 0, type: "local" }
}

export async function getDriveDiscovery(): Promise<DriveDiscovery> {
  if (IS_WIN) {
    try {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `[Console]::OutputEncoding=[Text.UTF8Encoding]::UTF8; ${WINDOWS_DRIVE_DISCOVERY_SCRIPT}`,
        ],
        { windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      )
      const discovery = parseWindowsDriveDiscoveryOutput(stdout)
      if (discovery.drives.length) return discovery
    } catch {
      /* letter probe */
    }

    const letters = "CDEFGHIJKLMNOPQRSTUVWXYZ"
    const drives: DriveInfo[] = []
    const probes = letters.split("").map(async (letter) => {
      const p = `${letter}:\\`
      try {
        await access(p, fsConstants.R_OK)
        return {
          path: p,
          name: `Drive ${letter}:`,
          label: `(${letter}:)`,
          total: 0,
          free: 0,
          used: 0,
          type: "local" as const,
        }
      } catch {
        return null
      }
    })
    for (const d of await Promise.all(probes)) if (d) drives.push(d)
    return { drives, mountRoots: drives.map((drive) => drive.path), complete: false }
  }

  // `df -P` provides display capacity. Linux deletion safety uses mountinfo
  // separately because `df` may suppress bind and zero-sized mounts.
  let dfOutput: string | undefined
  let drives: DriveInfo[] = []
  try {
    const { stdout } = await execFileAsync("df", ["-kP"], { maxBuffer: 1024 * 1024 })
    dfOutput = stdout
    drives = parseDfOutput(stdout, OS)
  } catch {
    /* keep the picker fallback separate from mount-safety evidence */
  }

  let mountDiscovery: Pick<DriveDiscovery, "mountRoots" | "complete">
  if (OS === "linux") {
    try {
      mountDiscovery = parseLinuxMountInfo(await readFile("/proc/self/mountinfo", "utf8"))
    } catch {
      mountDiscovery = { mountRoots: [], complete: false }
    }
  } else {
    mountDiscovery = dfOutput ? parseDfMountDiscovery(dfOutput) : { mountRoots: [], complete: false }
  }

  if (drives.length || mountDiscovery.mountRoots.length) {
    return {
      drives: drives.length
        ? OS === "darwin"
          ? await enrichMacDrivesWithinBudget(drives)
          : drives
        : [fallbackSystemDrive()],
      ...mountDiscovery,
    }
  }

  return { drives: [fallbackSystemDrive()], mountRoots: ["/"], complete: false }
}

/** Drive-picker compatibility wrapper. Safety-sensitive code uses getDriveDiscovery(). */
export async function getDrives(): Promise<DriveInfo[]> {
  return (await getDriveDiscovery()).drives
}

function parseJson(stdout: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim() || "[]")
  } catch {
    return undefined
  }
  return parsed
}

function parseWindowsDrives(parsed: unknown): DriveInfo[] {
  const value = isRecord(parsed) && Reflect.has(parsed, "Drives") ? parsed.Drives : parsed
  const items = Array.isArray(value) ? value : [value]
  return items.flatMap((item) => {
    if (!isRecord(item)) return []
    const drive = item
    const id = typeof drive.DeviceID === "string" ? drive.DeviceID.toUpperCase() : ""
    const driveType = Number(drive.DriveType)
    if (!/^[A-Z]:$/.test(id) || driveType === 5) return []

    const total = Math.max(0, Number(drive.Size) || 0)
    const free = Math.max(0, Number(drive.FreeSpace) || 0)
    const volumeName = typeof drive.VolumeName === "string" ? drive.VolumeName.trim() : ""
    return [
      {
        path: `${id}\\`,
        name: volumeName || `Drive ${id}`,
        label: `${volumeName ? `${volumeName} ` : ""}(${id})`,
        total,
        free,
        used: Math.max(0, total - free),
        type: driveType === 2 ? "removable" : driveType === 4 ? "network" : "local",
      } satisfies DriveInfo,
    ]
  })
}

export function parseWindowsDriveOutput(stdout: string): DriveInfo[] {
  return parseWindowsDrives(parseJson(stdout))
}

function normalizeWindowsMountRoot(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const path = value.trim().replace(/\//g, "\\")
  if (/^[a-z]:\\/i.test(path)) return path
  if (/^\\\\(?![?.]\\)[^\\]+\\[^\\]+/i.test(path)) return path
  return undefined
}

export function parseWindowsDriveDiscoveryOutput(stdout: string): DriveDiscovery {
  const parsed = parseJson(stdout)
  const drives = parseWindowsDrives(parsed)
  const reportedRoots = isRecord(parsed)
    ? Array.isArray(parsed.MountRoots)
      ? parsed.MountRoots
      : [parsed.MountRoots]
    : []
  const mountRoots: string[] = []
  const seen = new Set<string>()
  for (const candidate of [...drives.map((drive) => drive.path), ...reportedRoots]) {
    const root = normalizeWindowsMountRoot(candidate)
    if (!root) continue
    const key = root.toLowerCase().replace(/[\\]+$/, "")
    if (seen.has(key)) continue
    seen.add(key)
    mountRoots.push(root)
  }

  return {
    drives,
    mountRoots,
    complete: isRecord(parsed) && parsed.Complete === true && drives.length > 0 && mountRoots.length > 0,
  }
}

type DfRow = {
  source: string
  totalK: number
  freeK: number
  mount: string
}

function decodeDfMount(value: string): string {
  return value.replace(/\\040/g, " ").replace(/\\011/g, "\t").replace(/\\134/g, "\\")
}

function parseDfRows(stdout: string): { rows: DfRow[]; complete: boolean } {
  const lines = stdout.trim().split("\n")
  const dataLines = lines.slice(1).filter((line) => line.trim())
  const rows: DfRow[] = []
  let complete = lines.length > 1 && dataLines.length > 0
  for (const line of dataLines) {
    const match = line.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/)
    if (!match) {
      complete = false
      continue
    }
    const mount = decodeDfMount(match[5])
    if (!mount.startsWith("/")) {
      complete = false
      continue
    }
    rows.push({ source: match[1], totalK: Number(match[2]) || 0, freeK: Number(match[4]) || 0, mount })
  }
  if (!rows.some((row) => row.mount === "/")) complete = false
  return { rows, complete }
}

export function parseDfMountDiscovery(stdout: string): Pick<DriveDiscovery, "mountRoots" | "complete"> {
  const parsed = parseDfRows(stdout)
  return { mountRoots: [...new Set(parsed.rows.map((row) => row.mount))], complete: parsed.complete }
}

function decodeLinuxMountInfoPath(value: string): string {
  const escaped: Record<string, string> = { "040": " ", "011": "\t", "012": "\n", "134": "\\" }
  return value.replace(/\\(040|011|012|134)/g, (_match, code: string) => escaped[code])
}

/** Parse the kernel's complete, per-process Linux mount table. */
export function parseLinuxMountInfo(stdout: string): Pick<DriveDiscovery, "mountRoots" | "complete"> {
  const lines = stdout.split("\n").filter((line) => line.trim())
  const roots: string[] = []
  let complete = lines.length > 0
  for (const line of lines) {
    const separator = line.indexOf(" - ")
    const fields = (separator === -1 ? line : line.slice(0, separator)).split(" ")
    if (separator === -1 || fields.length < 6) {
      complete = false
      continue
    }
    const mount = decodeLinuxMountInfoPath(fields[4])
    if (!mount.startsWith("/")) {
      complete = false
      continue
    }
    roots.push(mount)
  }
  const mountRoots = [...new Set(roots)]
  if (!mountRoots.includes("/")) complete = false
  return { mountRoots, complete }
}

export function parseDfOutput(stdout: string, os: NodeJS.Platform): DriveInfo[] {
  const seen = new Set<string>()
  const drives: DriveInfo[] = []
  for (const { source, totalK, freeK, mount } of parseDfRows(stdout).rows) {
    if (seen.has(mount) || totalK < 1024 * 100) continue

    const baseName = mount.split("/").filter(Boolean).pop() || ""
    if (os === "darwin") {
      if (mount !== "/" && mount.startsWith("/System/Volumes/")) continue
      if (mount.startsWith("/private/") || mount.startsWith("/dev")) continue
      if (mount.startsWith(`${homedir()}/Library/Developer/`)) continue
      if (
        /^(com\.apple\..+|SimRuntimeBundle.*|Recovery|Preboot|Update|VM|Hardware|xarts|iSCPreboot|iOS_.*)$/i.test(
          baseName,
        )
      )
        continue
    }
    if (os === "linux") {
      if (/^\/(proc|sys|dev)(\/|$)/.test(mount)) continue
      if (mount.startsWith("/run/") && !mount.startsWith("/run/media/")) continue
      if (/^\/var\/lib\/(docker|containers|kubelet)(\/|$)/.test(mount) || mount.startsWith("/snap/")) continue
    }

    seen.add(mount)
    const total = totalK * 1024
    const free = freeK * 1024
    const network = source.startsWith("//") || (!source.startsWith("/dev/") && source.includes(":"))
    const removable =
      (os === "darwin" && mount.startsWith("/Volumes/")) ||
      (os === "linux" && /^(\/media|\/run\/media|\/mnt)(\/|$)/.test(mount))
    const name = mount === "/" ? (os === "darwin" ? "Macintosh HD" : "System") : baseName || source
    drives.push({
      path: mount,
      name,
      label: mount === "/" ? `${name} (/)` : `${name} (${mount})`,
      total,
      free,
      used: Math.max(0, total - free),
      type: network ? "network" : removable ? "removable" : "local",
    })
  }
  return drives.sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.name.localeCompare(b.name)))
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
