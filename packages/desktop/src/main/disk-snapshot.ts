import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { deserialize, serialize } from "node:v8"
import type ParcelWatcher from "@parcel/watcher"
import type { DiskNode, ScanOptions } from "../../../disklizard/src/types"

const SNAPSHOT_SCHEMA = 2
const MAX_DELTA_EVENTS = 2_000
const MAX_DELTA_ROOTS = 32
const MAX_SNAPSHOTS = 8

type Watcher = Pick<typeof ParcelWatcher, "getEventsSince" | "subscribe" | "writeSnapshot">
type WatchEvent = ParcelWatcher.Event
type Scan = (targetPath: string, options: ScanOptions) => Promise<DiskNode>

type SnapshotMetadata = {
  schema: number
  rootPath: string
  optionsHash: string
  savedAt: number
  checkpoint: string
}

type ActiveScan = {
  owner: number
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

function stableScanOptions(options: ScanOptions) {
  return {
    maxDepth: options.maxDepth ?? 10,
    concurrency: options.concurrency,
    maxChildren: options.maxChildren ?? 48,
    preserveNames: [...(options.preserveNames ?? [])].sort(),
    collapseNames: [...(options.collapseNames ?? [])].sort(),
    signatureNames: [...(options.signatureNames ?? [])].sort(),
    sizeMode: options.sizeMode ?? "physical",
    excludePaths: [...(options.excludePaths ?? [])].map(comparable).sort(),
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
  return {
    ...root,
    children,
    size: children.reduce((total, child) => total + child.size, 0),
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

function containsHardLink(root: DiskNode): boolean {
  return !!root.hardLink || root.children.some(containsHardLink)
}

export async function applyDiskDelta(root: DiskNode, events: readonly WatchEvent[], scan: Scan, options: ScanOptions) {
  const changedPaths = deltaRoots(root, events)
  const rootPath = comparable(root.path)
  let next = root
  for (const changedPath of changedPaths) {
    options.signal?.throwIfAborted()
    const previous = findNode(next, comparable(changedPath))
    if (
      (options.sizeMode ?? "physical") === "physical" &&
      comparable(changedPath) !== rootPath &&
      previous &&
      containsHardLink(previous)
    ) {
      return { root: await scan(rootPath, options), changedPaths: [rootPath] }
    }
    try {
      const replacement = await scan(changedPath, options)
      if (
        (options.sizeMode ?? "physical") === "physical" &&
        comparable(changedPath) !== rootPath &&
        containsHardLink(replacement)
      ) {
        return { root: await scan(rootPath, options), changedPaths: [rootPath] }
      }
      next = replaceNode(next, comparable(changedPath), replacement)
    } catch (error) {
      options.signal?.throwIfAborted()
      // A target can disappear between an FSEvent and the rescan. Refresh its
      // surviving parent so the deleted child is removed from the snapshot.
      const parent = path.dirname(changedPath)
      if (!isWithin(comparable(root.path), parent)) throw error
      const replacement = await scan(parent, options)
      next = replaceNode(next, comparable(parent), replacement)
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
  private readonly active = new Map<number, ActiveScan>()

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
    const dir = path.join(this.cacheDir, diskSnapshotKey(rootPath, options))
    return {
      dir,
      metadata: path.join(dir, "metadata.json"),
      tree: path.join(dir, "tree.bin"),
    }
  }

  private async load(rootPath: string, options: ScanOptions) {
    const paths = this.paths(rootPath, options)
    try {
      const metadata = JSON.parse(await readFile(paths.metadata, "utf8")) as SnapshotMetadata
      if (
        metadata.schema !== SNAPSHOT_SCHEMA ||
        metadata.rootPath !== comparable(rootPath) ||
        metadata.optionsHash !== diskSnapshotKey(rootPath, options)
      ) {
        return undefined
      }
      await stat(rootPath)
      const root = deserialize(await readFile(paths.tree)) as DiskNode
      if (!root || comparable(root.path) !== comparable(rootPath)) return undefined
      return { root, checkpoint: path.join(paths.dir, metadata.checkpoint) }
    } catch {
      return undefined
    }
  }

  private async checkpoint(rootPath: string, options: ScanOptions, watcher: Watcher) {
    const paths = this.paths(rootPath, options)
    await mkdir(paths.dir, { recursive: true })
    const checkpoint = path.join(paths.dir, `events-${Date.now()}-${randomUUID()}.snapshot`)
    await watcher.writeSnapshot(rootPath, checkpoint, watcherOptions(options, this.platform))
    return checkpoint
  }

  private async persist(rootPath: string, options: ScanOptions, root: DiskNode, checkpoint: string) {
    const paths = this.paths(rootPath, options)
    await mkdir(paths.dir, { recursive: true })
    const nonce = randomUUID()
    const treeTemp = `${paths.tree}.${nonce}.tmp`
    const metadataTemp = `${paths.metadata}.${nonce}.tmp`
    const metadata: SnapshotMetadata = {
      schema: SNAPSHOT_SCHEMA,
      rootPath: comparable(rootPath),
      optionsHash: diskSnapshotKey(rootPath, options),
      savedAt: Date.now(),
      checkpoint: path.basename(checkpoint),
    }
    await writeFile(treeTemp, serialize(root))
    await writeFile(metadataTemp, JSON.stringify(metadata))
    await rename(treeTemp, paths.tree)
    await rename(metadataTemp, paths.metadata)
    await this.cleanupCheckpoints(paths.dir, metadata.checkpoint)
    void this.prune()
  }

  private async cleanupCheckpoints(dir: string, keep: string) {
    const entries = await readdir(dir).catch(() => [])
    await Promise.all(
      entries
        .filter((entry) => entry.startsWith("events-") && entry.endsWith(".snapshot") && entry !== keep)
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
          return { dir, modified: (await stat(path.join(dir, "metadata.json")).catch(() => undefined))?.mtimeMs ?? 0 }
        }),
    )
    snapshots.sort((a, b) => b.modified - a.modified)
    await Promise.all(snapshots.slice(MAX_SNAPSHOTS).map(({ dir }) => rm(dir, { recursive: true, force: true })))
  }

  private queue(active: ActiveScan, error: Error | null, events: WatchEvent[]) {
    if (active.stopped) return
    if (error) {
      active.pending.set(active.rootPath, { path: active.rootPath, type: "update" })
    } else {
      for (const event of events) active.pending.set(event.path, event)
    }
    if (!active.root || active.timer) return
    active.timer = setTimeout(() => {
      active.timer = undefined
      void this.refresh(active)
    }, this.debounceMs)
  }

  private async refresh(active: ActiveScan) {
    if (active.stopped || active.refreshing || !active.root) return
    active.refreshing = true
    const controller = new AbortController()
    active.refreshAbort = controller
    try {
      const watcher = await this.watcher()
      if (!watcher) return
      const loaded = await this.load(active.rootPath, active.options)
      const candidate = await this.checkpoint(active.rootPath, active.options, watcher)
      const historical = loaded
        ? await watcher.getEventsSince(
            active.rootPath,
            loaded.checkpoint,
            watcherOptions(active.options, this.platform),
          )
        : []
      const events = [...historical, ...active.pending.values()]
      active.pending.clear()
      if (!events.length) return
      const delta = await applyDiskDelta(active.root, events, this.scanTree, {
        ...active.options,
        onProgress: undefined,
        signal: controller.signal,
      })
      if (active.stopped) return
      active.root = delta.root
      await this.persist(active.rootPath, active.options, active.root, candidate)
      active.refreshFailures = 0
      active.onUpdate({ rootPath: active.rootPath, root: active.root, changedPaths: delta.changedPaths })
    } catch {
      // Live refresh is best effort. The older checkpoint remains authoritative,
      // so the next manual/open scan will catch up or perform a full scan.
      active.refreshFailures++
      if (!active.stopped && active.refreshFailures <= 2) {
        active.pending.set(active.rootPath, { path: active.rootPath, type: "update" })
      }
    } finally {
      if (active.refreshAbort === controller) active.refreshAbort = undefined
      active.refreshing = false
      if (active.pending.size && !active.stopped) this.queue(active, null, [])
    }
  }

  async scan(
    owner: number,
    rootPath: string,
    options: ScanOptions,
    onUpdate: (update: DiskSnapshotUpdate) => void,
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
    let candidate: string | undefined
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
        active.subscription = undefined
        candidate = undefined
      }
    }

    const cached = candidate ? await this.load(normalizedRoot, options) : undefined
    try {
      if (cached && watcher && candidate) {
        const events = [
          ...(await watcher.getEventsSince(normalizedRoot, cached.checkpoint, watcherOptions(options, this.platform))),
          ...active.pending.values(),
        ]
        active.pending.clear()
        if (!events.length) {
          active.root = cached.root
          await this.persist(normalizedRoot, options, cached.root, candidate).catch(() => undefined)
          if (active.pending.size) this.queue(active, null, [])
          return { root: cached.root, source: "snapshot", changedPaths: [] }
        }
        const delta = await applyDiskDelta(cached.root, events, this.scanTree, options)
        active.root = delta.root
        await this.persist(normalizedRoot, options, delta.root, candidate).catch(() => undefined)
        if (active.pending.size) this.queue(active, null, [])
        return { ...delta, source: "delta" }
      }

      let root = await this.scanTree(normalizedRoot, options)
      let changedPaths: string[] = []
      if (candidate && watcher) {
        const events = [
          ...(await watcher.getEventsSince(normalizedRoot, candidate, watcherOptions(options, this.platform))),
          ...active.pending.values(),
        ]
        active.pending.clear()
        if (events.length) {
          const delta = await applyDiskDelta(root, events, this.scanTree, options)
          root = delta.root
          changedPaths = delta.changedPaths
        }
        await this.persist(normalizedRoot, options, root, candidate).catch(() => undefined)
      }
      active.root = root
      if (active.pending.size) this.queue(active, null, [])
      return { root, source: "scan", changedPaths }
    } catch (error) {
      await this.stop(owner)
      throw error
    }
  }

  async stop(owner: number) {
    const active = this.active.get(owner)
    if (!active) return
    active.stopped = true
    if (active.timer) clearTimeout(active.timer)
    active.refreshAbort?.abort(new Error("Snapshot watch stopped"))
    this.active.delete(owner)
    await active.subscription?.unsubscribe().catch(() => undefined)
  }

  async stopAll() {
    await Promise.all([...this.active.keys()].map((owner) => this.stop(owner)))
  }
}
