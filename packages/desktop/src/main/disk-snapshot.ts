import { createHash, randomUUID } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { StringDecoder } from "node:string_decoder"
import type ParcelWatcher from "@parcel/watcher"
import {
  MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS,
  normalizeDeveloperArtifactInventoryOptions,
} from "../../../disklizard/src/developer-artifacts"
import { normalizeScanOptions } from "../../../disklizard/src/scan"
import type { DiskNode, ScanOptions } from "../../../disklizard/src/types"
import { MAX_MATERIALIZED_DISK_TREE_NODES } from "./disk-tree-budget"

// Clone-group normalization changes physical accounting. Old persisted trees
// cannot safely be restored as if they had been produced by this model.
// v5 added direct artifact-directory identities used to guard deep inventory
// cleanup; v6 ensures identity-less native Windows inventories are not
// restored before desktop-side bigint-lstat enrichment can run. v7 makes the
// metadata point at an immutable tree generation, so a process interruption
// cannot pair an older checkpoint with a replacement tree. v8 replaces the
// monolithic V8 blob with bounded records so persistence, parsing, and
// validation can yield to Electron's main event loop.
const SNAPSHOT_SCHEMA = 8
const MAX_DELTA_EVENTS = 2_000
const MAX_DELTA_ROOTS = 32
const MAX_SNAPSHOTS = 8
const CHECKPOINT_FILE_NAME = /^events-\d+-[0-9a-f-]+\.snapshot$/
const TREE_FILE_NAME = /^tree-\d+-[0-9a-f-]+\.ndjson$/
const LEGACY_TREE_FILE_NAME = /^tree-\d+-[0-9a-f-]+\.bin$/
const SNAPSHOT_FORMAT = 1
const SNAPSHOT_WRITE_BATCH_BYTES = 256 * 1024
const MAX_SNAPSHOT_RECORD_BYTES = 256 * 1024
const SNAPSHOT_YIELD_INTERVAL = 256

type Watcher = Pick<typeof ParcelWatcher, "getEventsSince" | "subscribe" | "writeSnapshot">
type WatchEvent = ParcelWatcher.Event
type Scan = (targetPath: string, options: ScanOptions) => Promise<DiskNode>
type ScanOwner = number | string

type SnapshotMetadata = {
  schema: number
  rootPath: string
  optionsHash: string
  savedAt: number
  checkpoint: string
  tree: string
}

type CheckpointLease = {
  path: string
  release: () => void
}

type LoadedSnapshot = {
  root: DiskNode
  checkpoint: CheckpointLease
}

type ActiveScan = {
  owner: ScanOwner
  rootPath: string
  options: ScanOptions
  root?: DiskNode
  subscription?: ParcelWatcher.AsyncSubscription
  pending: Map<string, WatchEvent>
  timer?: ReturnType<typeof setTimeout>
  refreshAbort?: AbortController
  stopped: boolean
  refreshing: boolean
  refreshFailures: number
  onUpdate: (update: DiskSnapshotUpdate) => void
}

export type DiskSnapshotUpdate = {
  rootPath: string
  root: DiskNode
  changedPaths: string[]
  watchError?: string
}

export type DiskSnapshotResult = {
  root: DiskNode
  source: "scan" | "snapshot" | "delta"
  changedPaths: string[]
}

type ManagerOptions = {
  cacheDir: string
  scan: Scan
  watcher?: Watcher
  platform?: NodeJS.Platform
  debounceMs?: number
}

function comparable(value: string) {
  return path.resolve(value)
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function isAncestor(parent: string, child: string) {
  return parent !== child && isWithin(parent, child)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function comparableAbsolutePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || !path.isAbsolute(value)) return undefined
  try {
    return comparable(value)
  } catch {
    return undefined
  }
}

function isScopedPath(value: unknown, rootPath: string) {
  const candidate = comparableAbsolutePath(value)
  return candidate !== undefined && isWithin(rootPath, candidate)
}

function isScopedPathArray(value: unknown, rootPath: string) {
  return isStringArray(value) && value.every((entry) => isScopedPath(entry, rootPath))
}

function isDeveloperArtifactDirectoryIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.platform === "posix" || value.platform === "windows") &&
    typeof value.device === "string" &&
    value.device.length > 0 &&
    value.device !== "0" &&
    typeof value.fileId === "string" &&
    value.fileId.length > 0 &&
    value.fileId !== "0" &&
    isNonNegativeSafeInteger(value.modifiedAt)
  )
}

function isCloneEvidence(value: unknown): boolean {
  if (!isRecord(value) || typeof value.state !== "string") return false
  if (value.state === "unavailable") {
    return value.reason === "platform" || value.reason === "filesystem" || value.reason === "scanner"
  }
  if (value.state === "unknown" || value.state === "not-shared") return true
  if (value.state === "may-share-blocks") return value.cloneId === undefined || typeof value.cloneId === "string"
  if (value.state === "shares-all-blocks") {
    return (
      (value.cloneId === undefined || typeof value.cloneId === "string") &&
      (value.reportedFullCloneCount === undefined ||
        (isNonNegativeInteger(value.reportedFullCloneCount) && value.reportedFullCloneCount > 0))
    )
  }
  return false
}

function isCompleteCloneEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.state === "shares-all-blocks" &&
    typeof value.cloneId === "string" &&
    value.cloneId.length > 0 &&
    isNonNegativeInteger(value.reportedFullCloneCount) &&
    value.reportedFullCloneCount > 1
  )
}

function isCloneMetadataCapability(value: unknown): boolean {
  if (!isRecord(value) || typeof value.state !== "string") return false
  if (value.state === "available" || value.state === "unknown") return true
  return (
    value.state === "unavailable" &&
    (value.reason === "platform" || value.reason === "filesystem" || value.reason === "scanner")
  )
}

function isDeveloperArtifact(value: unknown, rootPath: string): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.name === "string" &&
    isScopedPath(value.path, rootPath) &&
    isNonNegativeInteger(value.size) &&
    (value.logicalSize === undefined || isNonNegativeInteger(value.logicalSize)) &&
    (value.modifiedAt === undefined || isNonNegativeFiniteNumber(value.modifiedAt)) &&
    (value.directoryIdentity === undefined || isDeveloperArtifactDirectoryIdentity(value.directoryIdentity)) &&
    value.isDir === true &&
    (value.signatures === undefined || isStringArray(value.signatures)) &&
    (value.kind === "dependencies" || value.kind === "build-output" || value.kind === "toolchain-cache") &&
    (value.ecosystem === "node" ||
      value.ecosystem === "python" ||
      value.ecosystem === "rust" ||
      value.ecosystem === "jvm" ||
      value.ecosystem === "cpp" ||
      value.ecosystem === "go" ||
      value.ecosystem === "dotnet" ||
      value.ecosystem === "dart" ||
      value.ecosystem === "apple" ||
      value.ecosystem === "web" ||
      value.ecosystem === "containers" ||
      value.ecosystem === "tooling" ||
      value.ecosystem === "generic" ||
      value.ecosystem === "agent" ||
      value.ecosystem === "git") &&
    (value.confidence === "verified" || value.confidence === "likely" || value.confidence === "ambiguous") &&
    (value.cleanup === "eligible" || value.cleanup === "review") &&
    isStringArray(value.evidence) &&
    value.inventoryOnly === true
  )
}

function yieldToMainEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

async function isDeveloperArtifactInventory(value: unknown, rootPath: string, expectedMaxItems: number) {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.status)) return false
  const status = value.status
  if (
    (status.state !== "complete" && status.state !== "partial") ||
    !isNonNegativeSafeInteger(status.maxItems) ||
    status.maxItems < 1 ||
    status.maxItems > MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS ||
    status.maxItems !== expectedMaxItems ||
    value.items.length > status.maxItems ||
    !isNonNegativeInteger(status.scannedDirectories) ||
    !isNonNegativeInteger(status.matchedDirectories) ||
    status.scannedDirectories < status.matchedDirectories ||
    status.matchedDirectories < value.items.length ||
    (!status.truncated && status.matchedDirectories !== value.items.length) ||
    (status.truncated && status.matchedDirectories <= value.items.length) ||
    typeof status.truncated !== "boolean" ||
    !isNonNegativeInteger(status.unreadableCount) ||
    !isScopedPathArray(status.unreadableSamplePaths, rootPath) ||
    !isNonNegativeInteger(status.skippedSymlinkCount) ||
    !isScopedPathArray(status.skippedSymlinkSamplePaths, rootPath) ||
    (status.skippedDirectoryCount !== undefined && !isNonNegativeInteger(status.skippedDirectoryCount)) ||
    (status.skippedDirectorySamplePaths !== undefined &&
      !isScopedPathArray(status.skippedDirectorySamplePaths, rootPath)) ||
    (status.unavailableDirectoryIdentityCount !== undefined &&
      !isNonNegativeInteger(status.unavailableDirectoryIdentityCount)) ||
    (status.unavailableDirectoryIdentitySamplePaths !== undefined &&
      !isScopedPathArray(status.unavailableDirectoryIdentitySamplePaths, rootPath)) ||
    !isNonNegativeInteger(status.excludedCount) ||
    !isScopedPathArray(status.excludedSamplePaths, rootPath)
  ) {
    return false
  }
  for (let index = 0; index < value.items.length; index++) {
    if (!isDeveloperArtifact(value.items[index], rootPath)) return false
    if ((index + 1) % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
  }
  const mustBePartial =
    status.truncated ||
    status.unreadableCount > 0 ||
    status.skippedSymlinkCount > 0 ||
    (status.skippedDirectoryCount ?? 0) > 0 ||
    (status.unavailableDirectoryIdentityCount ?? 0) > 0 ||
    status.excludedCount > 0
  return !mustBePartial || status.state === "partial"
}

function isScanIssueSummary(value: unknown, rootPath: string): boolean {
  return (
    isRecord(value) &&
    isNonNegativeSafeInteger(value.unreadableCount) &&
    isScopedPathArray(value.samplePaths, rootPath)
  )
}

/**
 * A cache is a persistence boundary, not a trusted scanner response. Keep the
 * validator iterative and cooperative so a large or corrupted payload cannot
 * recurse indefinitely or monopolize Electron's main event loop.
 */
async function isCachedDiskTree(value: unknown, rootPath: string, options: ScanOptions) {
  const normalizedRoot = comparable(rootPath)
  const expectedInventory = normalizeDeveloperArtifactInventoryOptions(options.developerArtifactInventory)
  if (!isRecord(value)) return false

  type PendingNode = { value: unknown; parentPath?: string; isRoot: boolean }
  const pending: PendingNode[] = [{ value, isRoot: true }]
  const seenNodes = new WeakSet<object>()
  const seenPaths = new Set<string>()
  let visited = 0

  try {
    while (pending.length > 0) {
      const current = pending.pop()!
      if (!isRecord(current.value) || seenNodes.has(current.value)) return false
      seenNodes.add(current.value)
      if (++visited > MAX_MATERIALIZED_DISK_TREE_NODES) return false
      if (visited % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()

      const node = current.value
      const nodePath = comparableAbsolutePath(node.path)
      if (!nodePath || !isWithin(normalizedRoot, nodePath) || seenPaths.has(nodePath)) return false
      if (current.isRoot) {
        if (nodePath !== normalizedRoot) return false
      } else if (!current.parentPath || !isAncestor(current.parentPath, nodePath)) {
        return false
      }
      seenPaths.add(nodePath)

      if (
        typeof node.name !== "string" ||
        !isNonNegativeInteger(node.size) ||
        (node.logicalSize !== undefined && !isNonNegativeInteger(node.logicalSize)) ||
        (node.modifiedAt !== undefined && !isNonNegativeFiniteNumber(node.modifiedAt)) ||
        (node.hardLink !== undefined && node.hardLink !== "primary" && node.hardLink !== "secondary") ||
        (node.clone !== undefined && !isCloneEvidence(node.clone)) ||
        (node.cloneAccounting !== undefined &&
          ((node.cloneAccounting !== "primary" && node.cloneAccounting !== "secondary") ||
            !isCompleteCloneEvidence(node.clone))) ||
        typeof node.isDir !== "boolean" ||
        !Array.isArray(node.children) ||
        (!node.isDir && node.children.length > 0) ||
        typeof node.ext !== "string" ||
        (node.isOther !== undefined && typeof node.isOther !== "boolean") ||
        (node.isOther === true && !node.isDir) ||
        (node.isHidden !== undefined && typeof node.isHidden !== "boolean") ||
        (node.isCollapsed !== undefined && (typeof node.isCollapsed !== "boolean" || !node.isDir)) ||
        (node.signatures !== undefined && !isStringArray(node.signatures)) ||
        (node.scanIssues !== undefined && !isScanIssueSummary(node.scanIssues, normalizedRoot)) ||
        (node._label !== undefined && typeof node._label !== "string")
      ) {
        return false
      }

      if (current.isRoot) {
        if (
          (node.cloneMetadata !== undefined && !isCloneMetadataCapability(node.cloneMetadata)) ||
          (node.sharedStorageEvidence !== undefined &&
            node.sharedStorageEvidence !== "complete" &&
            node.sharedStorageEvidence !== "partial") ||
          (node.developerArtifactInventory !== undefined &&
            !(await isDeveloperArtifactInventory(
              node.developerArtifactInventory,
              normalizedRoot,
              expectedInventory?.maxItems ?? 0,
            ))) ||
          (expectedInventory !== undefined) !== (node.developerArtifactInventory !== undefined)
        ) {
          return false
        }
      } else if (
        node.cloneMetadata !== undefined ||
        node.sharedStorageEvidence !== undefined ||
        node.developerArtifactInventory !== undefined
      ) {
        return false
      }

      // An aggregate "Other" node has a synthetic path (`__other__`), while
      // its materialized children remain real descendants of the aggregate's
      // parent. Preserve that legitimate shape without permitting an arbitrary
      // in-root path to be smuggled beneath an aggregate.
      const childParentPath = node.isOther === true ? current.parentPath : nodePath
      for (let index = 0; index < node.children.length; index++) {
        const child = node.children[index]!
        pending.push({
          value: child,
          parentPath: childParentPath,
          isRoot: false,
        })
        if ((index + 1) % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
      }
      if (pending.length > MAX_MATERIALIZED_DISK_TREE_NODES) return false
    }
  } catch {
    return false
  }
  return true
}

async function writeDiskTreeSnapshot(targetPath: string, root: DiskNode) {
  const file = await open(targetPath, "wx")
  let batch: string[] = []
  let batchBytes = 0
  const flush = async () => {
    if (!batch.length) return
    const bytes = Buffer.from(batch.join(""))
    let offset = 0
    while (offset < bytes.length) {
      const written = await file.write(bytes, offset, bytes.length - offset)
      if (written.bytesWritten === 0) throw new Error("Snapshot cache write made no progress")
      offset += written.bytesWritten
    }
    batch = []
    batchBytes = 0
  }
  const append = async (record: Record<string, unknown>) => {
    const line = `${JSON.stringify(record)}\n`
    const bytes = Buffer.byteLength(line)
    if (bytes > MAX_SNAPSHOT_RECORD_BYTES) throw new Error("Snapshot record exceeds the cache format limit")
    if (batchBytes + bytes > SNAPSHOT_WRITE_BATCH_BYTES) await flush()
    batch.push(line)
    batchBytes += bytes
  }

  try {
    await append({ type: "disklizard-tree", format: SNAPSHOT_FORMAT })
    const pending: Array<{ node: DiskNode; parent: number | null }> = [{ node: root, parent: null }]
    const seen = new WeakSet<object>()
    let nodeCount = 0
    while (pending.length > 0) {
      const { node, parent } = pending.pop()!
      if (seen.has(node)) throw new Error("Snapshot tree contains a cycle or shared node")
      seen.add(node)
      if (++nodeCount > MAX_MATERIALIZED_DISK_TREE_NODES) throw new Error("Snapshot tree exceeds the node limit")
      const { children, developerArtifactInventory, ...data } = node
      if (node !== root && developerArtifactInventory !== undefined) {
        throw new Error("Snapshot inventory is only valid on the root node")
      }
      await append({ type: "node", parent, node: data })
      for (let index = children.length - 1; index >= 0; index--) {
        pending.push({ node: children[index]!, parent: nodeCount - 1 })
        if ((children.length - index) % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
      }
      if (nodeCount % SNAPSHOT_YIELD_INTERVAL === 0) {
        await flush()
        await yieldToMainEventLoop()
      }
    }

    const inventory = root.developerArtifactInventory
    if (inventory) {
      await append({ type: "inventory", status: inventory.status })
      for (let index = 0; index < inventory.items.length; index++) {
        await append({ type: "inventory-item", item: inventory.items[index] })
        if ((index + 1) % SNAPSHOT_YIELD_INTERVAL === 0) {
          await flush()
          await yieldToMainEventLoop()
        }
      }
    }
    await append({
      type: "end",
      nodes: nodeCount,
      inventoryItems: inventory?.items.length ?? 0,
    })
    await flush()
  } finally {
    await file.close()
  }
}

async function readDiskTreeSnapshot(targetPath: string): Promise<DiskNode> {
  const decoder = new StringDecoder("utf8")
  const nodes: DiskNode[] = []
  const inventoryItems: unknown[] = []
  let inventoryStatus: unknown
  let pending = ""
  let records = 0
  let sawHeader = false
  let sawEnd = false
  let nodeSectionEnded = false

  const consume = async (line: string) => {
    if (Buffer.byteLength(line) > MAX_SNAPSHOT_RECORD_BYTES) {
      throw new Error("Snapshot record exceeds the cache format limit")
    }
    const record = JSON.parse(line) as unknown
    if (!isRecord(record) || typeof record.type !== "string" || sawEnd) throw new Error("Invalid snapshot record")
    if (!sawHeader) {
      if (record.type !== "disklizard-tree" || record.format !== SNAPSHOT_FORMAT) {
        throw new Error("Unsupported snapshot format")
      }
      sawHeader = true
      return
    }

    if (record.type === "node") {
      if (nodeSectionEnded || !isRecord(record.node) || "children" in record.node || "developerArtifactInventory" in record.node) {
        throw new Error("Invalid snapshot node record")
      }
      const parent = record.parent
      if (
        (nodes.length === 0 && parent !== null) ||
        (nodes.length > 0 && (!isNonNegativeSafeInteger(parent) || parent >= nodes.length)) ||
        nodes.length >= MAX_MATERIALIZED_DISK_TREE_NODES
      ) {
        throw new Error("Invalid snapshot parent index")
      }
      const node = { ...record.node, children: [] } as unknown as DiskNode
      if (nodes.length > 0) nodes[parent as number]!.children.push(node)
      nodes.push(node)
    } else if (record.type === "inventory") {
      if (nodes.length === 0 || inventoryStatus !== undefined || !isRecord(record.status)) {
        throw new Error("Invalid snapshot inventory record")
      }
      nodeSectionEnded = true
      inventoryStatus = record.status
    } else if (record.type === "inventory-item") {
      if (inventoryStatus === undefined || inventoryItems.length >= MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS) {
        throw new Error("Invalid snapshot inventory item")
      }
      inventoryItems.push(record.item)
    } else if (record.type === "end") {
      if (
        nodes.length === 0 ||
        !isNonNegativeSafeInteger(record.nodes) ||
        record.nodes !== nodes.length ||
        !isNonNegativeSafeInteger(record.inventoryItems) ||
        record.inventoryItems !== inventoryItems.length
      ) {
        throw new Error("Invalid snapshot footer")
      }
      sawEnd = true
    } else {
      throw new Error("Unknown snapshot record")
    }

    if (++records % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
  }

  for await (const chunk of createReadStream(targetPath, { highWaterMark: 64 * 1024 })) {
    pending += decoder.write(chunk as Buffer)
    let newline = pending.indexOf("\n")
    while (newline !== -1) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (!line) throw new Error("Empty snapshot record")
      await consume(line)
      newline = pending.indexOf("\n")
    }
    if (Buffer.byteLength(pending) > MAX_SNAPSHOT_RECORD_BYTES) {
      throw new Error("Snapshot record exceeds the cache format limit")
    }
  }
  pending += decoder.end()
  if (pending) await consume(pending)
  if (!sawHeader || !sawEnd || nodes.length === 0) throw new Error("Incomplete snapshot")

  const root = nodes[0]!
  if (inventoryStatus !== undefined) {
    root.developerArtifactInventory = {
      status: inventoryStatus,
      items: inventoryItems,
    } as DiskNode["developerArtifactInventory"]
  }
  return root
}

function cacheFilePath(dir: string, name: string, pattern: RegExp): string | undefined {
  if (!pattern.test(name) || path.basename(name) !== name) return undefined
  const resolvedDir = comparable(dir)
  const candidate = path.resolve(resolvedDir, name)
  return path.dirname(candidate) === resolvedDir && isWithin(resolvedDir, candidate) ? candidate : undefined
}

async function isRegularCacheFile(targetPath: string) {
  try {
    const info = await lstat(targetPath)
    return info.isFile() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

async function isCacheDirectory(targetPath: string) {
  try {
    const info = await lstat(targetPath)
    return info.isDirectory() && !info.isSymbolicLink()
  } catch {
    return false
  }
}

function isSnapshotMetadata(value: unknown): value is SnapshotMetadata {
  return (
    isRecord(value) &&
    value.schema === SNAPSHOT_SCHEMA &&
    typeof value.rootPath === "string" &&
    typeof value.optionsHash === "string" &&
    /^[0-9a-f]{32}$/.test(value.optionsHash) &&
    isNonNegativeSafeInteger(value.savedAt) &&
    typeof value.checkpoint === "string" &&
    typeof value.tree === "string"
  )
}

function stableScanOptions(options: ScanOptions) {
  const normalizedOptions = normalizeScanOptions(options)
  const developerArtifactInventory = normalizeDeveloperArtifactInventoryOptions(normalizedOptions.developerArtifactInventory)
  return {
    maxDepth: normalizedOptions.maxDepth,
    concurrency: normalizedOptions.concurrency,
    maxChildren: normalizedOptions.maxChildren,
    progressIntervalMs: normalizedOptions.progressIntervalMs,
    preserveNames: [...(normalizedOptions.preserveNames ?? [])].sort(),
    collapseNames: [...(normalizedOptions.collapseNames ?? [])].sort(),
    signatureNames: [...(normalizedOptions.signatureNames ?? [])].sort(),
    sizeMode: normalizedOptions.sizeMode ?? "physical",
    excludePaths: [...(normalizedOptions.excludePaths ?? [])].map(comparable).sort(),
    // Use the scanner's exact clamp/default behavior. Without this, `true`,
    // `{}`, and out-of-range values could describe the same scan while
    // needlessly fragmenting the cache (or, worse, restoring a different cap).
    developerArtifactInventory: developerArtifactInventory ?? false,
  }
}

export function diskSnapshotKey(rootPath: string, options: ScanOptions) {
  return createHash("sha256")
    .update(JSON.stringify([comparable(rootPath), stableScanOptions(options)]))
    .digest("hex")
    .slice(0, 32)
}

function watcherOptions(options: ScanOptions, platform: NodeJS.Platform): ParcelWatcher.Options {
  return {
    ignore: options.excludePaths,
    ...(platform === "darwin" ? { backend: "fs-events" as const } : {}),
  }
}

async function loadNativeWatcher(): Promise<Watcher | undefined> {
  try {
    const imported = await import("@parcel/watcher")
    return ((imported as { default?: Watcher }).default ?? imported) as Watcher
  } catch {
    return undefined
  }
}

function indexTree(root: DiskNode) {
  const nodes = new Map<string, DiskNode>()
  const parents = new Map<string, string>()
  const visit = (node: DiskNode, parent?: DiskNode) => {
    const nodePath = comparable(node.path)
    if (!node.isOther) nodes.set(nodePath, node)
    if (parent) parents.set(nodePath, comparable(parent.path))
    for (const child of node.children) visit(child, node)
  }
  visit(root)
  return { nodes, parents }
}

/**
 * Turn file-level events into the smallest set of materialized subtrees that can
 * be rescanned and safely spliced into the lossy, max-children scan tree.
 */
export function deltaRoots(root: DiskNode, events: readonly WatchEvent[]) {
  if (events.length > MAX_DELTA_EVENTS) return [comparable(root.path)]
  const rootPath = comparable(root.path)
  const { nodes, parents } = indexTree(root)
  const candidates: string[] = []
  const normalizedEvents = events
    .map((event) => ({ ...event, path: comparable(event.path) }))
    .filter((event) => isWithin(rootPath, event.path))

  for (const event of normalizedEvents) {
    const eventPath = event.path
    // FSEvents commonly emits both a changed file and "update" for each of its
    // ancestor directories. The specific event is sufficient and prevents a
    // single file save from degenerating into a whole-volume rescan.
    if (
      event.type === "update" &&
      nodes.get(eventPath)?.isDir &&
      normalizedEvents.some((other) => other !== event && isAncestor(eventPath, other.path))
    ) {
      continue
    }
    let candidate = event.type === "update" && nodes.has(eventPath) ? eventPath : path.dirname(eventPath)
    let resolved: string | undefined
    while (isWithin(rootPath, candidate)) {
      const node = nodes.get(candidate)
      if (node) {
        if (!node.isDir) {
          resolved = candidate
          break
        }
        if (!node.isCollapsed && !node.isOther) {
          resolved = candidate
          break
        }
        candidate = parents.get(candidate) ?? path.dirname(candidate)
        continue
      }
      if (candidate === rootPath) break
      candidate = path.dirname(candidate)
    }
    candidates.push(resolved ?? rootPath)
  }

  const roots = [...new Set(candidates)].sort((a, b) => a.length - b.length)
  const coalesced = roots.filter(
    (candidate, index) => !roots.slice(0, index).some((parent) => isAncestor(parent, candidate)),
  )
  return coalesced.length > MAX_DELTA_ROOTS ? [rootPath] : coalesced
}

function replaceNode(root: DiskNode, targetPath: string, replacement: DiskNode): DiskNode {
  if (comparable(root.path) === targetPath) return replacement
  let changed = false
  const children = root.children.map((child) => {
    if (!isWithin(comparable(child.path), targetPath)) return child
    const next = replaceNode(child, targetPath, replacement)
    changed ||= next !== child
    return next
  })
  if (!changed) return root
  children.sort((a, b) => b.size - a.size)
  const size = children.reduce((total, child) => total + child.size, 0)
  const logicalSize = children.reduce((total, child) => total + (child.logicalSize ?? child.size), 0)
  // Do not retain an ancestor's old apparent size after a localized refresh.
  // It can differ from allocated bytes for sparse files, hard links, and now
  // complete clone groups.
  const { logicalSize: _previousLogicalSize, ...unchanged } = root
  return {
    ...unchanged,
    children,
    size,
    ...(logicalSize !== size ? { logicalSize } : {}),
    modifiedAt: children.reduce<number | undefined>(
      (latest, child) => Math.max(latest ?? 0, child.modifiedAt ?? 0) || undefined,
      undefined,
    ),
  }
}

function findNode(root: DiskNode, targetPath: string): DiskNode | undefined {
  if (comparable(root.path) === targetPath) return root
  for (const child of root.children) {
    if (!isWithin(comparable(child.path), targetPath)) continue
    const match = findNode(child, targetPath)
    if (match) return match
  }
}

/**
 * A local physical refresh cannot safely retain ownership decisions that may
 * cross the changed subtree. Hard links and APFS clone evidence both have
 * that property, so ask the root scanner to rebuild their accounting.
 */
function containsCrossSubtreePhysicalSharing(root: DiskNode): boolean {
  return (
    !!root.hardLink ||
    !!root.cloneAccounting ||
    root.clone?.state === "may-share-blocks" ||
    root.clone?.state === "shares-all-blocks" ||
    root.children.some(containsCrossSubtreePhysicalSharing)
  )
}

function requiresWholeRootPhysicalRefresh(
  rootPath: string,
  targetPath: string,
  replacement: DiskNode,
  options: ScanOptions,
) {
  return (
    (options.sizeMode ?? "physical") === "physical" &&
    comparable(targetPath) !== rootPath &&
    (containsCrossSubtreePhysicalSharing(replacement) || replacement.sharedStorageEvidence !== "complete")
  )
}

export async function applyDiskDelta(root: DiskNode, events: readonly WatchEvent[], scan: Scan, options: ScanOptions) {
  const changedPaths = deltaRoots(root, events)
  const rootPath = comparable(root.path)
  // The deep artifact index is root-wide and deliberately independent from
  // materialized tree nodes. Local watcher refreshes must not rebuild that
  // inventory on every filesystem event, but they also must never retain its
  // stale cleanup candidates. Omitting it makes the renderer drop those
  // candidates, and the cache validator will require a fresh root scan before
  // an inventory-enabled snapshot can be restored again.
  const { developerArtifactInventory: _developerArtifactInventory, ...localOptions } = options
  const scanDeltaTarget = (targetPath: string) =>
    scan(targetPath, comparable(targetPath) === rootPath ? options : localOptions)
  const invalidateDeveloperArtifactInventory = (node: DiskNode) => {
    if (!node.developerArtifactInventory) return node
    const { developerArtifactInventory: _inventory, ...next } = node
    return next
  }
  let next = root
  for (const changedPath of changedPaths) {
    options.signal?.throwIfAborted()
    const previous = findNode(next, comparable(changedPath))
    if (
      (options.sizeMode ?? "physical") === "physical" &&
      comparable(changedPath) !== rootPath &&
      previous &&
      containsCrossSubtreePhysicalSharing(previous)
    ) {
      return { root: await scanDeltaTarget(rootPath), changedPaths: [rootPath] }
    }
    try {
      const replacement = await scanDeltaTarget(changedPath)
      if (requiresWholeRootPhysicalRefresh(rootPath, changedPath, replacement, options)) {
        return { root: await scanDeltaTarget(rootPath), changedPaths: [rootPath] }
      }
      const localized = comparable(changedPath) !== rootPath
      if (localized) next = invalidateDeveloperArtifactInventory(next)
      next = replaceNode(
        next,
        comparable(changedPath),
        localized ? invalidateDeveloperArtifactInventory(replacement) : replacement,
      )
    } catch (error) {
      options.signal?.throwIfAborted()
      // A target can disappear between an FSEvent and the rescan. Refresh its
      // surviving parent so the deleted child is removed from the snapshot.
      const parent = path.dirname(changedPath)
      if (!isWithin(comparable(root.path), parent)) throw error
      const replacement = await scanDeltaTarget(parent)
      if (requiresWholeRootPhysicalRefresh(rootPath, parent, replacement, options)) {
        return { root: await scanDeltaTarget(rootPath), changedPaths: [rootPath] }
      }
      const localized = comparable(parent) !== rootPath
      if (localized) next = invalidateDeveloperArtifactInventory(next)
      next = replaceNode(
        next,
        comparable(parent),
        localized ? invalidateDeveloperArtifactInventory(replacement) : replacement,
      )
    }
  }
  return { root: next, changedPaths }
}

export class DiskSnapshotManager {
  private readonly cacheDir: string
  private readonly scanTree: Scan
  private readonly platform: NodeJS.Platform
  private readonly debounceMs: number
  private readonly suppliedWatcher?: Watcher
  private watcherPromise?: Promise<Watcher | undefined>
  private readonly active = new Map<ScanOwner, ActiveScan>()
  /** Serializes cache reads/writes for one root+options key. */
  private readonly cacheLocks = new Map<string, Promise<void>>()
  /** Reference-counted leases for checkpoints that a live scan still needs. */
  private readonly checkpointReferences = new Map<string, Map<string, number>>()

  constructor(options: ManagerOptions) {
    this.cacheDir = options.cacheDir
    this.scanTree = options.scan
    this.platform = options.platform ?? process.platform
    this.debounceMs = options.debounceMs ?? 450
    this.suppliedWatcher = options.watcher
  }

  private watcher() {
    if (this.suppliedWatcher) return Promise.resolve(this.suppliedWatcher)
    this.watcherPromise ??= loadNativeWatcher()
    return this.watcherPromise
  }

  private paths(rootPath: string, options: ScanOptions) {
    const key = diskSnapshotKey(rootPath, options)
    const dir = path.join(this.cacheDir, key)
    return {
      key,
      dir,
      metadata: path.join(dir, "metadata.json"),
    }
  }

  private async withCacheKey<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.cacheLocks.get(key) ?? Promise.resolve()
    let release!: () => void
    const completion = new Promise<void>((resolve) => {
      release = resolve
    })
    const next = previous.catch(() => undefined).then(() => completion)
    this.cacheLocks.set(key, next)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (this.cacheLocks.get(key) === next) this.cacheLocks.delete(key)
    }
  }

  private retainCheckpoint(key: string, checkpoint: string): CheckpointLease {
    const name = path.basename(checkpoint)
    const references = this.checkpointReferences.get(key) ?? new Map<string, number>()
    this.checkpointReferences.set(key, references)
    references.set(name, (references.get(name) ?? 0) + 1)
    let released = false
    return {
      path: checkpoint,
      release: () => {
        if (released) return
        released = true
        const current = this.checkpointReferences.get(key)
        const count = current?.get(name) ?? 0
        if (count <= 1) current?.delete(name)
        else current?.set(name, count - 1)
        if (current?.size === 0) this.checkpointReferences.delete(key)
      },
    }
  }

  private protectedCheckpoints(key: string) {
    return new Set(this.checkpointReferences.get(key)?.keys() ?? [])
  }

  private hasCheckpointReferences(key: string) {
    return (this.checkpointReferences.get(key)?.size ?? 0) > 0
  }

  private async load(rootPath: string, options: ScanOptions): Promise<LoadedSnapshot | undefined> {
    const paths = this.paths(rootPath, options)
    return this.withCacheKey(paths.key, async () => {
      try {
        if (!(await isCacheDirectory(paths.dir)) || !(await isRegularCacheFile(paths.metadata))) return undefined
        const metadata = JSON.parse(await readFile(paths.metadata, "utf8")) as unknown
        if (
          !isSnapshotMetadata(metadata) ||
          metadata.rootPath !== comparable(rootPath) ||
          metadata.optionsHash !== paths.key
        ) {
          return undefined
        }
        const checkpoint = cacheFilePath(paths.dir, metadata.checkpoint, CHECKPOINT_FILE_NAME)
        const tree = cacheFilePath(paths.dir, metadata.tree, TREE_FILE_NAME)
        if (!checkpoint || !tree || !(await isRegularCacheFile(checkpoint)) || !(await isRegularCacheFile(tree))) {
          return undefined
        }
        const rootInfo = await stat(rootPath)
        const root = await readDiskTreeSnapshot(tree)
        if (!(await isCachedDiskTree(root, rootPath, options)) || root.isDir !== rootInfo.isDirectory()) return undefined
        return { root, checkpoint: this.retainCheckpoint(paths.key, checkpoint) }
      } catch {
        return undefined
      }
    })
  }

  private async checkpoint(rootPath: string, options: ScanOptions, watcher: Watcher): Promise<CheckpointLease> {
    const paths = this.paths(rootPath, options)
    return this.withCacheKey(paths.key, async () => {
      await mkdir(paths.dir, { recursive: true })
      if (!(await isCacheDirectory(paths.dir))) throw new Error("Snapshot cache entry is not a directory")
      const checkpoint = path.join(paths.dir, `events-${Date.now()}-${randomUUID()}.snapshot`)
      await watcher.writeSnapshot(rootPath, checkpoint, watcherOptions(options, this.platform))
      if (!(await isRegularCacheFile(checkpoint))) throw new Error("Snapshot checkpoint was not written")
      return this.retainCheckpoint(paths.key, checkpoint)
    })
  }

  private async persist(rootPath: string, options: ScanOptions, root: DiskNode, checkpoint: string) {
    const paths = this.paths(rootPath, options)
    await this.withCacheKey(paths.key, async () => {
      await mkdir(paths.dir, { recursive: true })
      if (!(await isCacheDirectory(paths.dir))) throw new Error("Snapshot cache entry is not a directory")
      const checkpointName = path.basename(checkpoint)
      const checkpointPath = cacheFilePath(paths.dir, checkpointName, CHECKPOINT_FILE_NAME)
      if (!checkpointPath || comparable(checkpoint) !== checkpointPath || !(await isRegularCacheFile(checkpointPath))) {
        throw new Error("Snapshot checkpoint is outside its cache entry")
      }

      const nonce = randomUUID()
      const treeName = `tree-${Date.now()}-${nonce}.ndjson`
      const tree = cacheFilePath(paths.dir, treeName, TREE_FILE_NAME)!
      const treeTemp = `${tree}.${randomUUID()}.tmp`
      const metadataTemp = `${paths.metadata}.${randomUUID()}.tmp`
      const metadata: SnapshotMetadata = {
        schema: SNAPSHOT_SCHEMA,
        rootPath: comparable(rootPath),
        optionsHash: paths.key,
        savedAt: Date.now(),
        checkpoint: checkpointName,
        tree: treeName,
      }
      try {
        await writeDiskTreeSnapshot(treeTemp, root)
        await writeFile(metadataTemp, JSON.stringify(metadata))
        // Publish the immutable tree before its metadata pointer. Readers hold
        // the same key lock, so they can only observe one complete generation.
        await rename(treeTemp, tree)
        await rename(metadataTemp, paths.metadata)
        await this.cleanupSnapshotFiles(paths.dir, paths.key, metadata.checkpoint, metadata.tree)
      } finally {
        await Promise.all([rm(treeTemp, { force: true }), rm(metadataTemp, { force: true })])
      }
    })
    void this.prune().catch(() => undefined)
  }

  private async cleanupSnapshotFiles(dir: string, key: string, keepCheckpoint: string, keepTree: string) {
    if (!(await isCacheDirectory(dir))) return
    const entries = await readdir(dir).catch(() => [])
    const protectedCheckpoints = this.protectedCheckpoints(key)
    protectedCheckpoints.add(keepCheckpoint)
    await Promise.all(
      entries
        .filter(
          (entry) =>
            (CHECKPOINT_FILE_NAME.test(entry) && !protectedCheckpoints.has(entry)) ||
            (TREE_FILE_NAME.test(entry) && entry !== keepTree) ||
            LEGACY_TREE_FILE_NAME.test(entry) ||
            (entry.startsWith("tree-") && entry.endsWith(".tmp")) ||
            (entry.startsWith("metadata.json.") && entry.endsWith(".tmp")),
        )
        .map((entry) => rm(path.join(dir, entry), { force: true })),
    )
  }

  private async prune() {
    const entries = await readdir(this.cacheDir, { withFileTypes: true }).catch(() => [])
    const snapshots = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const dir = path.join(this.cacheDir, entry.name)
          return {
            key: entry.name,
            dir,
            modified: (await stat(path.join(dir, "metadata.json")).catch(() => undefined))?.mtimeMs ?? 0,
          }
        }),
    )
    snapshots.sort((a, b) => b.modified - a.modified)
    await Promise.all(
      snapshots.slice(MAX_SNAPSHOTS).map(({ key, dir }) =>
        this.withCacheKey(key, async () => {
          // A candidate checkpoint may belong to another active window using
          // this exact root/options key. Do not evict its directory until the
          // owner has finished consuming it.
          if (this.hasCheckpointReferences(key)) return
          await rm(dir, { recursive: true, force: true })
        }),
      ),
    )
  }

  private queue(active: ActiveScan, error: Error | null, events: WatchEvent[]) {
    if (active.stopped) return
    if (error) {
      active.pending.set(active.rootPath, { path: active.rootPath, type: "update" })
    } else {
      for (const event of events) active.pending.set(event.path, event)
    }
    if (!active.root) return
    this.scheduleRefresh(active, this.debounceMs)
  }

  private scheduleRefresh(active: ActiveScan, delay: number) {
    if (active.stopped || active.timer) return
    active.timer = setTimeout(() => {
      active.timer = undefined
      void this.refresh(active)
    }, delay)
  }

  private async refresh(active: ActiveScan) {
    if (active.stopped || active.refreshing || !active.root) return
    active.refreshing = true
    const controller = new AbortController()
    active.refreshAbort = controller
    let loaded: LoadedSnapshot | undefined
    let candidate: CheckpointLease | undefined
    let capturedPending: Array<[string, WatchEvent]> = []
    try {
      const watcher = await this.watcher()
      if (!watcher) throw new Error("Filesystem watcher is unavailable")
      loaded = await this.load(active.rootPath, active.options)
      candidate = await this.checkpoint(active.rootPath, active.options, watcher)
      const historical = loaded
        ? await watcher.getEventsSince(
            active.rootPath,
            loaded.checkpoint.path,
            watcherOptions(active.options, this.platform),
          )
        : []
      capturedPending = [...active.pending.entries()]
      const events = [...historical, ...capturedPending.map(([, event]) => event)]
      if (!events.length) return
      const delta = await applyDiskDelta(active.root, events, this.scanTree, {
        ...active.options,
        onProgress: undefined,
        signal: controller.signal,
      })
      if (active.stopped) return
      active.root = delta.root
      // A localized refresh deliberately invalidates root-wide developer
      // inventory. Do not publish that incomplete tree under an
      // inventory-enabled cache key: the next manual/open scan must rebuild it.
      const cacheable =
        !normalizeDeveloperArtifactInventoryOptions(active.options.developerArtifactInventory) ||
        !!active.root.developerArtifactInventory
      if (cacheable) await this.persist(active.rootPath, active.options, active.root, candidate.path)
      else {
        const paths = this.paths(active.rootPath, active.options)
        await this.withCacheKey(paths.key, () => rm(paths.metadata, { force: true }))
      }
      active.refreshFailures = 0
      active.onUpdate({ rootPath: active.rootPath, root: active.root, changedPaths: delta.changedPaths })
      for (const [eventPath, event] of capturedPending) {
        if (active.pending.get(eventPath) === event) active.pending.delete(eventPath)
      }
    } catch (error) {
      active.refreshFailures++
      if (!active.stopped && active.refreshFailures <= 2) {
        this.scheduleRefresh(active, Math.min(5_000, this.debounceMs * 2 ** active.refreshFailures))
      } else if (!active.stopped) {
        try {
          const root = await this.scanTree(active.rootPath, {
            ...active.options,
            onProgress: undefined,
            signal: controller.signal,
          })
          if (active.stopped) return
          active.root = root
          if (candidate) await this.persist(active.rootPath, active.options, root, candidate.path)
          for (const [eventPath, event] of capturedPending) {
            if (active.pending.get(eventPath) === event) active.pending.delete(eventPath)
          }
          active.refreshFailures = 0
          active.onUpdate({ rootPath: active.rootPath, root, changedPaths: [active.rootPath] })
        } catch (recoveryError) {
          const message = recoveryError instanceof Error ? recoveryError.message : String(recoveryError ?? error)
          active.onUpdate({
            rootPath: active.rootPath,
            root: active.root,
            changedPaths: [],
            watchError: message,
          })
          this.scheduleRefresh(active, Math.max(5_000, this.debounceMs * 8))
        }
      }
    } finally {
      loaded?.checkpoint.release()
      candidate?.release()
      if (active.refreshAbort === controller) active.refreshAbort = undefined
      active.refreshing = false
      if (active.pending.size && !active.stopped) this.scheduleRefresh(active, this.debounceMs)
    }
  }

  async scan(
    owner: ScanOwner,
    rootPath: string,
    options: ScanOptions,
    onUpdate: (update: DiskSnapshotUpdate) => void,
    forceFresh = false,
  ): Promise<DiskSnapshotResult> {
    await this.stop(owner)
    options.signal?.throwIfAborted()
    const normalizedRoot = await realpath(rootPath).catch(() => comparable(rootPath))
    const active: ActiveScan = {
      owner,
      rootPath: normalizedRoot,
      options,
      pending: new Map(),
      stopped: false,
      refreshing: false,
      refreshFailures: 0,
      onUpdate,
    }
    this.active.set(owner, active)

    // @parcel/watcher ships native backends for macOS, Linux, and Windows.
    // Snapshot APIs give every platform the same cache/delta lifecycle; a
    // backend that cannot watch a particular root still falls through to a
    // normal scan via the guarded setup below.
    const watcher = await this.watcher()
    let candidate: CheckpointLease | undefined
    if (watcher) {
      try {
        const subscription = await watcher.subscribe(
          normalizedRoot,
          (error, events) => this.queue(active, error, events),
          watcherOptions(options, this.platform),
        )
        if (active.stopped) {
          await subscription.unsubscribe()
          options.signal?.throwIfAborted()
          throw new Error("Snapshot watch stopped")
        }
        active.subscription = subscription
        candidate = await this.checkpoint(normalizedRoot, options, watcher)
        options.signal?.throwIfAborted()
      } catch {
        candidate?.release()
        candidate = undefined
        await active.subscription?.unsubscribe().catch(() => undefined)
        active.subscription = undefined
      }
    }

    let cached: LoadedSnapshot | undefined
    try {
      // Used after a mutation whose allocated-byte ownership cannot be inferred
      // from the old tree (for example, a clone-accounted pathname removal).
      cached = !forceFresh && candidate ? await this.load(normalizedRoot, options) : undefined
      if (cached && watcher && candidate) {
        const events = [
          ...(await watcher.getEventsSince(normalizedRoot, cached.checkpoint.path, watcherOptions(options, this.platform))),
          ...active.pending.values(),
        ]
        active.pending.clear()
        if (!events.length) {
          active.root = cached.root
          await this.persist(normalizedRoot, options, cached.root, candidate.path).catch(() => undefined)
          if (active.pending.size) this.queue(active, null, [])
          return { root: cached.root, source: "snapshot", changedPaths: [] }
        }
        const delta = await applyDiskDelta(cached.root, events, this.scanTree, options)
        active.root = delta.root
        await this.persist(normalizedRoot, options, delta.root, candidate.path).catch(() => undefined)
        if (active.pending.size) this.queue(active, null, [])
        return { ...delta, source: "delta" }
      }

      let root = await this.scanTree(normalizedRoot, options)
      let changedPaths: string[] = []
      if (candidate && watcher) {
        const events = [
          ...(await watcher.getEventsSince(normalizedRoot, candidate.path, watcherOptions(options, this.platform))),
          ...active.pending.values(),
        ]
        active.pending.clear()
        if (events.length) {
          const delta = await applyDiskDelta(root, events, this.scanTree, options)
          root = delta.root
          changedPaths = delta.changedPaths
        }
        await this.persist(normalizedRoot, options, root, candidate.path).catch(() => undefined)
      }
      active.root = root
      if (active.pending.size) this.queue(active, null, [])
      return { root, source: "scan", changedPaths }
    } catch (error) {
      await this.stopActive(owner, active)
      throw error
    } finally {
      cached?.checkpoint.release()
      candidate?.release()
    }
  }

  async stop(owner: ScanOwner) {
    await this.stopActive(owner)
  }

  private async stopActive(owner: ScanOwner, expected?: ActiveScan) {
    const active = this.active.get(owner)
    if (!active || (expected && active !== expected)) return
    active.stopped = true
    if (active.timer) clearTimeout(active.timer)
    active.refreshAbort?.abort(new Error("Snapshot watch stopped"))
    this.active.delete(owner)
    await active.subscription?.unsubscribe().catch(() => undefined)
  }

  activeOwners() {
    return [...this.active.keys()]
  }

  async stopAll() {
    await Promise.all([...this.active.keys()].map((owner) => this.stop(owner)))
  }
}
