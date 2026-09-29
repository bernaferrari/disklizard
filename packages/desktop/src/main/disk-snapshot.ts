import { createHash, randomUUID } from "node:crypto"
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "../../../disklizard/src/physical-fs"
import path from "node:path"
import type ParcelWatcher from "@parcel/watcher"
import { normalizeDeveloperArtifactInventoryOptions } from "../../../disklizard/src/developer-artifacts"
import { normalizeScanOptions } from "../../../disklizard/src/scan"
import type { DiskNode, ScanOptions } from "../../../disklizard/src/types"
import {
  decodeDiskSnapshotMetadata,
  decodeDiskSnapshotTree,
  encodeDiskSnapshotMetadata,
  encodeDiskSnapshotTree,
  type DiskSnapshotMetadata,
} from "./disk-snapshot-codec"
import { MAX_MATERIALIZED_DISK_TREE_NODES } from "./disk-tree-budget"

// Clone-group normalization changes physical accounting. Old persisted trees
// cannot safely be restored as if they had been produced by this model.
// v5 added direct artifact-directory identities used to guard deep inventory
// cleanup; v6 ensures identity-less native Windows inventories are not
// restored before desktop-side bigint-lstat enrichment can run. v7 makes the
// metadata point at an immutable tree generation, so a process interruption
// cannot pair an older checkpoint with a replacement tree. The wire codec owns
// the current schema and its backward-compatible validation rules.
const MAX_DELTA_EVENTS = 2_000
const MAX_DELTA_ROOTS = 32
const MAX_SNAPSHOTS = 8
const CHECKPOINT_FILE_NAME = /^events-\d+-[0-9a-f-]+\.snapshot$/
const TREE_FILE_NAME = /^tree-\d+-[0-9a-f-]+\.ndjson$/
const LEGACY_TREE_FILE_NAME = /^tree-\d+-[0-9a-f-]+\.bin$/
const SNAPSHOT_YIELD_INTERVAL = 256

type Watcher = Pick<typeof ParcelWatcher, "getEventsSince" | "subscribe" | "writeSnapshot">
type WatchEvent = ParcelWatcher.Event
type Scan = (targetPath: string, options: ScanOptions) => Promise<DiskNode>
type ScanOwner = number | string

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
  /** Bumped on every published tree change; drives the renderer's `revision` hint. */
  revision: number
  onUpdate: (update: DiskSnapshotUpdate) => void
}

export type DiskSnapshotUpdate = {
  rootPath: string
  root: DiskNode
  changedPaths: string[]
  watchError?: string
  /**
   * Additive renderer hint: the tree generation changed, so a previously
   * received `root` for this rootPath is stale and must not be reused as a
   * clone source. Absent on the first update after each scan.
   */
  revision?: number
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

function yieldToMainEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve))
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

function stableScanOptions(options: ScanOptions) {
  const normalizedOptions = normalizeScanOptions(options)
  const developerArtifactInventory = normalizeDeveloperArtifactInventoryOptions(
    normalizedOptions.developerArtifactInventory,
  )
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

async function indexTree(root: DiskNode, signal?: AbortSignal) {
  const nodes = new Map<string, DiskNode>()
  const parents = new Map<string, string>()
  const pending: Array<{ node: DiskNode; parentPath?: string }> = [{ node: root }]
  let work = 0
  let visited = 0
  while (pending.length > 0) {
    signal?.throwIfAborted()
    const { node, parentPath } = pending.pop()!
    if (++visited > MAX_MATERIALIZED_DISK_TREE_NODES) throw new Error("Delta tree exceeds the node limit")
    const nodePath = comparable(node.path)
    if (!node.isOther) nodes.set(nodePath, node)
    if (parentPath) parents.set(nodePath, parentPath)
    for (let index = node.children.length - 1; index >= 0; index--) {
      pending.push({ node: node.children[index]!, parentPath: nodePath })
      if (++work % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
    }
    if (++work % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
  }
  return { nodes, parents }
}

/**
 * Turn file-level events into the smallest set of materialized subtrees that can
 * be rescanned and safely spliced into the lossy, max-children scan tree.
 */
export async function deltaRoots(root: DiskNode, events: readonly WatchEvent[], signal?: AbortSignal) {
  if (events.length > MAX_DELTA_EVENTS) return [comparable(root.path)]
  const rootPath = comparable(root.path)
  const { nodes, parents } = await indexTree(root, signal)
  const candidates: string[] = []
  const normalizedEvents: WatchEvent[] = []
  let work = 0
  for (const event of events) {
    const normalized = { ...event, path: comparable(event.path) }
    if (isWithin(rootPath, normalized.path)) normalizedEvents.push(normalized)
    if (++work % SNAPSHOT_YIELD_INTERVAL === 0) {
      signal?.throwIfAborted()
      await yieldToMainEventLoop()
    }
  }

  // FSEvents commonly emits both a changed file and "update" for each of its
  // ancestor directories. Indexing every event's ancestor chain once turns
  // the former O(E²) pairwise descendant probe into O(E·depth): an update on
  // a directory can be skipped whenever that directory lies on some other
  // event's ancestor chain.
  const ancestorsWithSpecificDescendant = new Set<string>()
  for (const event of normalizedEvents) {
    let ancestor = path.dirname(event.path)
    while (isWithin(rootPath, ancestor)) {
      if (ancestorsWithSpecificDescendant.has(ancestor)) break
      ancestorsWithSpecificDescendant.add(ancestor)
      if (ancestor === rootPath) break
      ancestor = path.dirname(ancestor)
    }
    if (++work % SNAPSHOT_YIELD_INTERVAL === 0) {
      signal?.throwIfAborted()
      await yieldToMainEventLoop()
    }
  }

  for (const event of normalizedEvents) {
    signal?.throwIfAborted()
    const eventPath = event.path
    if (event.type === "update" && nodes.get(eventPath)?.isDir && ancestorsWithSpecificDescendant.has(eventPath)) {
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
  const coalesced: string[] = []
  for (const candidate of roots) {
    let nested = false
    for (const parent of coalesced) {
      if (isAncestor(parent, candidate)) {
        nested = true
        break
      }
      if (++work % SNAPSHOT_YIELD_INTERVAL === 0) {
        signal?.throwIfAborted()
        await yieldToMainEventLoop()
      }
    }
    if (!nested) coalesced.push(candidate)
  }
  return coalesced.length > MAX_DELTA_ROOTS ? [rootPath] : coalesced
}

async function sortDiskNodesBySize(children: DiskNode[], signal?: AbortSignal) {
  if (children.length < 2) return children
  let source = children
  let target = new Array<DiskNode>(children.length)
  let work = 0
  for (let width = 1; width < children.length; width *= 2) {
    for (let start = 0; start < children.length; start += width * 2) {
      const middle = Math.min(start + width, children.length)
      const end = Math.min(start + width * 2, children.length)
      let left = start
      let right = middle
      let output = start
      while (left < middle || right < end) {
        if (right >= end || (left < middle && source[left]!.size >= source[right]!.size)) {
          target[output++] = source[left++]!
        } else {
          target[output++] = source[right++]!
        }
        if (++work % SNAPSHOT_YIELD_INTERVAL === 0) {
          signal?.throwIfAborted()
          await yieldToMainEventLoop()
        }
      }
    }
    const previousSource = source
    source = target
    target = previousSource
  }
  return source
}

async function replaceNode(
  root: DiskNode,
  targetPath: string,
  replacement: DiskNode,
  signal?: AbortSignal,
): Promise<DiskNode> {
  if (comparable(root.path) === targetPath) return replacement
  let changed = false
  const nextChildren: DiskNode[] = []
  for (let index = 0; index < root.children.length; index++) {
    signal?.throwIfAborted()
    const child = root.children[index]!
    const next = isWithin(comparable(child.path), targetPath)
      ? await replaceNode(child, targetPath, replacement, signal)
      : child
    changed ||= next !== child
    nextChildren.push(next)
    if ((index + 1) % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
  }
  if (!changed) return root
  const children = await sortDiskNodesBySize(nextChildren, signal)
  let size = 0
  let logicalSize = 0
  let modifiedAt: number | undefined
  for (let index = 0; index < children.length; index++) {
    const child = children[index]!
    size += child.size
    logicalSize += child.logicalSize ?? child.size
    modifiedAt = Math.max(modifiedAt ?? 0, child.modifiedAt ?? 0) || undefined
    if ((index + 1) % SNAPSHOT_YIELD_INTERVAL === 0) {
      signal?.throwIfAborted()
      await yieldToMainEventLoop()
    }
  }
  // Do not retain an ancestor's old apparent size after a localized refresh.
  // It can differ from allocated bytes for sparse files, hard links, and now
  // complete clone groups.
  const { logicalSize: _previousLogicalSize, ...unchanged } = root
  return {
    ...unchanged,
    children,
    size,
    ...(logicalSize !== size ? { logicalSize } : {}),
    modifiedAt,
  }
}

async function findNode(root: DiskNode, targetPath: string, signal?: AbortSignal): Promise<DiskNode | undefined> {
  const pending = [root]
  let work = 0
  while (pending.length > 0) {
    signal?.throwIfAborted()
    const node = pending.pop()!
    if (comparable(node.path) === targetPath) return node
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index]!
      if (isWithin(comparable(child.path), targetPath)) pending.push(child)
      if (++work % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
    }
  }
}

/**
 * A local physical refresh cannot safely retain ownership decisions that may
 * cross the changed subtree. Hard links and APFS clone evidence both have
 * that property, so ask the root scanner to rebuild their accounting.
 */
async function containsCrossSubtreePhysicalSharing(root: DiskNode, signal?: AbortSignal) {
  const pending = [root]
  let work = 0
  while (pending.length > 0) {
    signal?.throwIfAborted()
    const node = pending.pop()!
    if (
      node.hardLink ||
      node.cloneAccounting ||
      node.clone?.state === "may-share-blocks" ||
      node.clone?.state === "shares-all-blocks"
    ) {
      return true
    }
    for (const child of node.children) {
      pending.push(child)
      if (++work % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
    }
    if (++work % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
  }
  return false
}

async function requiresWholeRootPhysicalRefresh(
  rootPath: string,
  targetPath: string,
  replacement: DiskNode,
  options: ScanOptions,
) {
  return (
    (options.sizeMode ?? "physical") === "physical" &&
    comparable(targetPath) !== rootPath &&
    (await containsCrossSubtreePhysicalSharing(replacement, options.signal))
  )
}

export async function applyDiskDelta(root: DiskNode, events: readonly WatchEvent[], scan: Scan, options: ScanOptions) {
  const changedPaths = await deltaRoots(root, events, options.signal)
  const rootPath = comparable(root.path)
  // The deep artifact index is root-wide and deliberately independent from
  // materialized tree nodes. Local watcher refreshes must not rebuild that
  // inventory on every filesystem event, but they also must never retain its
  // stale cleanup candidates. Omitting it makes the renderer drop those
  // candidates, and the cache validator will require a fresh root scan before
  // an inventory-enabled snapshot can be restored again.
  const { developerArtifactInventory: _developerArtifactInventory, ...localOptions } = options
  let completedTargets = 0
  const scanDeltaTarget = async (targetPath: string) => {
    const wholeRoot = comparable(targetPath) === rootPath
    // Keep a share for a possible whole-root accounting refresh after a delta.
    const start = completedTargets / (changedPaths.length + 1)
    const end = wholeRoot ? 1 : (completedTargets + 1) / (changedPaths.length + 1)
    const targetOptions = wholeRoot ? options : localOptions
    const result = await scan(targetPath, {
      ...targetOptions,
      onProgress: (progress) => {
        const fraction = Math.max(0, Math.min(100, progress.percent ?? 0)) / 100
        options.onProgress?.({ ...progress, percent: (start + (end - start) * fraction) * 100 })
      },
    })
    completedTargets++
    return result
  }
  const invalidateDeveloperArtifactInventory = (node: DiskNode) => {
    if (!node.developerArtifactInventory) return node
    const { developerArtifactInventory: _inventory, ...next } = node
    return next
  }
  const withoutRootOnlyEvidence = (node: DiskNode) => {
    const {
      developerArtifactInventory: _inventory,
      cloneMetadata: _cloneMetadata,
      sharedStorageEvidence: _sharedStorageEvidence,
      ...child
    } = node
    return child
  }
  let next = root
  for (const changedPath of changedPaths) {
    options.signal?.throwIfAborted()
    const previous = await findNode(next, comparable(changedPath), options.signal)
    if (
      (options.sizeMode ?? "physical") === "physical" &&
      comparable(changedPath) !== rootPath &&
      previous &&
      (await containsCrossSubtreePhysicalSharing(previous, options.signal))
    ) {
      return { root: await scanDeltaTarget(rootPath), changedPaths: [rootPath] }
    }
    try {
      const replacement = await scanDeltaTarget(changedPath)
      if (await requiresWholeRootPhysicalRefresh(rootPath, changedPath, replacement, options)) {
        return { root: await scanDeltaTarget(rootPath), changedPaths: [rootPath] }
      }
      const localized = comparable(changedPath) !== rootPath
      if (localized) next = invalidateDeveloperArtifactInventory(next)
      next = await replaceNode(
        next,
        comparable(changedPath),
        localized ? withoutRootOnlyEvidence(replacement) : replacement,
        options.signal,
      )
      // A partial local scan cannot uphold a prior whole-root proof, but it
      // does not require another traversal just to report that uncertainty.
      if (localized && (options.sizeMode ?? "physical") === "physical" &&
          replacement.sharedStorageEvidence !== "complete") {
        next = { ...next, sharedStorageEvidence: "partial" }
      }
    } catch (error) {
      options.signal?.throwIfAborted()
      // A target can disappear between an FSEvent and the rescan. Refresh its
      // surviving parent so the deleted child is removed from the snapshot.
      const parent = path.dirname(changedPath)
      if (!isWithin(comparable(root.path), parent)) throw error
      const replacement = await scanDeltaTarget(parent)
      if (await requiresWholeRootPhysicalRefresh(rootPath, parent, replacement, options)) {
        return { root: await scanDeltaTarget(rootPath), changedPaths: [rootPath] }
      }
      const localized = comparable(parent) !== rootPath
      if (localized) next = invalidateDeveloperArtifactInventory(next)
      next = await replaceNode(
        next,
        comparable(parent),
        localized ? withoutRootOnlyEvidence(replacement) : replacement,
        options.signal,
      )
      if (localized && (options.sizeMode ?? "physical") === "physical" &&
          replacement.sharedStorageEvidence !== "complete") {
        next = { ...next, sharedStorageEvidence: "partial" }
      }
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
        const metadata = decodeDiskSnapshotMetadata(await readFile(paths.metadata, "utf8"), {
          rootPath: comparable(rootPath),
          optionsHash: paths.key,
        })
        if (!metadata) return undefined
        const checkpoint = cacheFilePath(paths.dir, metadata.checkpoint, CHECKPOINT_FILE_NAME)
        const tree = cacheFilePath(paths.dir, metadata.tree, TREE_FILE_NAME)
        if (!checkpoint || !tree || !(await isRegularCacheFile(checkpoint)) || !(await isRegularCacheFile(tree))) {
          return undefined
        }
        const rootInfo = await stat(rootPath)
        const root = await decodeDiskSnapshotTree(tree, {
          rootPath,
          options,
          rootIsDirectory: rootInfo.isDirectory(),
        })
        if (!root) return undefined
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
      const metadata = {
        rootPath: comparable(rootPath),
        optionsHash: paths.key,
        savedAt: Date.now(),
        checkpoint: checkpointName,
        tree: treeName,
      } satisfies Omit<DiskSnapshotMetadata, "schema">
      try {
        await encodeDiskSnapshotTree(treeTemp, root)
        await writeFile(metadataTemp, encodeDiskSnapshotMetadata(metadata))
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
    let candidate: CheckpointLease | undefined
    let capturedPending: Array<[string, WatchEvent]> = []
    try {
      const watcher = await this.watcher()
      if (!watcher) throw new Error("Filesystem watcher is unavailable")
      // The subscription stays active from before the initial scan until stop.
      // Journal replay is for reopening a saved scan, not each live update:
      // replaying it here reloads the whole tree and repeats old no-op events.
      candidate = await this.checkpoint(active.rootPath, active.options, watcher)
      capturedPending = [...active.pending.entries()]
      const events = capturedPending.map(([, event]) => event)
      if (!events.length) return
      const delta = await applyDiskDelta(active.root, events, this.scanTree, {
        ...active.options,
        onProgress: undefined,
        signal: controller.signal,
      })
      if (active.stopped) return
      // Skip the whole-tree broadcast when the delta scan produced no tree
      // change: parked tabs and history would otherwise re-clone an identical
      // multi-megabyte structure on every debounced watcher tick.
      if (delta.root === active.root && delta.changedPaths.length === 0) {
        active.refreshFailures = 0
        for (const [eventPath, event] of capturedPending) {
          if (active.pending.get(eventPath) === event) active.pending.delete(eventPath)
        }
        return
      }
      const treeChanged = delta.root !== active.root || delta.changedPaths.length > 0
      if (treeChanged) active.revision++
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
      active.onUpdate({
        rootPath: active.rootPath,
        root: active.root,
        changedPaths: delta.changedPaths,
        revision: active.revision,
      })
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
          active.revision++
          active.root = root
          if (candidate) await this.persist(active.rootPath, active.options, root, candidate.path)
          for (const [eventPath, event] of capturedPending) {
            if (active.pending.get(eventPath) === event) active.pending.delete(eventPath)
          }
          active.refreshFailures = 0
          active.onUpdate({
            rootPath: active.rootPath,
            root,
            changedPaths: [active.rootPath],
            revision: active.revision,
          })
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
    const report = options.onProgress
    let phase: "scan" | "reconcile" | "save" = "scan"
    let percent = 0
    let latest = { filesScanned: 0, dirsScanned: 0, currentPath: rootPath, size: 0 }
    const stage = (next: typeof phase, floor: number) => {
      phase = next
      percent = Math.max(percent, floor)
      report?.({ ...latest, percent, phase, done: false })
    }
    options = {
      ...options,
      onProgress: (progress) => {
        // Reconciliation rescans changed subtrees, whose counters start at zero.
        // Keep the operation-wide count from jumping backwards at the 85% phase boundary.
        latest = {
          ...progress,
          filesScanned: Math.max(latest.filesScanned, progress.filesScanned),
          dirsScanned: Math.max(latest.dirsScanned, progress.dirsScanned),
        }
        const fraction = Math.max(0, Math.min(100, progress.percent ?? 0)) / 100
        const estimate = phase === "scan" ? fraction * 85 : phase === "reconcile" ? 85 + fraction * 10 : 98
        percent = Math.max(percent, estimate)
        report?.({ ...latest, percent, phase, done: false })
      },
    }
    stage("scan", 0)
    const normalizedRoot = await realpath(rootPath).catch(() => comparable(rootPath))
    const active: ActiveScan = {
      owner,
      rootPath: normalizedRoot,
      options,
      pending: new Map(),
      stopped: false,
      refreshing: false,
      refreshFailures: 0,
      revision: 0,
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
          ...(await watcher.getEventsSince(
            normalizedRoot,
            cached.checkpoint.path,
            watcherOptions(options, this.platform),
          )),
          ...active.pending.values(),
        ]
        active.pending.clear()
        if (!events.length) {
          active.root = cached.root
          stage("save", 98)
          await this.persist(normalizedRoot, options, cached.root, candidate.path).catch(() => undefined)
          if (active.pending.size) this.queue(active, null, [])
          return { root: cached.root, source: "snapshot", changedPaths: [] }
        }
        stage("reconcile", 85)
        const delta = await applyDiskDelta(cached.root, events, this.scanTree, options)
        active.root = delta.root
        stage("save", 98)
        await this.persist(normalizedRoot, options, delta.root, candidate.path).catch(() => undefined)
        if (active.pending.size) this.queue(active, null, [])
        return { ...delta, source: "delta" }
      }

      let root = await this.scanTree(normalizedRoot, options)
      stage("reconcile", 85)
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
        stage("save", 98)
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
