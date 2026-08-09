/**
 * DiskLizard scanner — shared by Desktop + TUI.
 * High-concurrency traversal; worker offload optional.
 */

import { readdir, stat, rm, access, lstat, realpath } from "node:fs/promises"
import { basename, sep } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { homedir, platform, cpus } from "node:os"
import { constants as fsConstants, type Dirent, type Stats } from "node:fs"
import { Worker } from "node:worker_threads"
import type { DiskNode, DriveInfo, ScanDiscovery, ScanOptions, ScanProgress } from "./types"
import { deletionBlockReason, type DiskPlatform } from "./safety"

export type { DiskNode, DriveInfo, ScanDiscovery, ScanOptions, ScanProgress }

const execFileAsync = promisify(execFile)
const OS = platform()
const IS_WIN = OS === "win32"
const CPU_COUNT = Math.max(4, cpus()?.length ?? 8)

// Saturate NVMe/SSD without melting HDDs; scale with cores
const DEFAULT_CONCURRENCY = Math.min(512, Math.max(128, CPU_COUNT * 48))

const EMPTY_CHILDREN: DiskNode[] = []
Object.freeze(EMPTY_CHILDREN)
const MAX_SCAN_DISCOVERIES = 96
const MAX_SCAN_FILE_DISCOVERIES = 24

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
  return b.size - a.size
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
  excludedPaths: Set<string>
  unreadableCount: number
  issueSamples: string[]
  discoveriesEmitted: number
  fileDiscoveriesEmitted: number
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

function measureFile(st: WalkState, stats: Stats) {
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
  }

  return {
    size,
    logicalSize: logicalSize === size ? undefined : logicalSize,
    hardLink,
    modifiedAt: Number.isFinite(stats.mtimeMs) && stats.mtimeMs > 0 ? stats.mtimeMs : undefined,
  }
}

/**
 * Size-only fast pass: no DiskNode children allocated. Used past maxDepth / deep prune.
 */
async function sizeOnly(
  dirPath: string,
  st: WalkState,
  depth: number,
  captureSignatures = false,
): Promise<{ size: number; modifiedAt?: number; signatures?: string[] }> {
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
  let modifiedAt = 0
  const signatures: string[] = []
  const tasks: Promise<void>[] = []

  for (let i = 0; i < entries.length; i++) {
    checkAborted(st)
    const ent = entries[i]
    const name = ent.name
    const normalizedName = name.toLowerCase()

    // Prefer Dirent type checks — no extra syscall
    if (ent.isSymbolicLink()) continue

    const childPath = joinPath(dirPath, name)
    if (isExcluded(st, childPath)) continue
    if (captureSignatures && st.signatureNames.has(normalizedName)) signatures.push(normalizedName)

    if (ent.isDirectory()) {
      tasks.push(
        sizeOnly(childPath, st, depth + 1).then((measured) => {
          total += measured.size
          modifiedAt = Math.max(modifiedAt, measured.modifiedAt ?? 0)
        }),
      )
    } else if (ent.isFile()) {
      tasks.push(
        st.pool
          .run(() => stat(childPath))
          .then(
            (s) => {
              const measured = measureFile(st, s)
              total += measured.size
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
                const measured = await sizeOnly(childPath, st, depth + 1)
                total += measured.size
                modifiedAt = Math.max(modifiedAt, measured.modifiedAt ?? 0)
              } else if (s.isFile()) {
                const measured = measureFile(st, s)
                total += measured.size
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
  return {
    size: total,
    modifiedAt: modifiedAt || undefined,
    signatures: signatures.length > 0 ? signatures.sort() : undefined,
  }
}

async function walkCollapsedDir(dirPath: string, name: string, st: WalkState, depth: number): Promise<DiskNode> {
  const measured = await sizeOnly(dirPath, st, depth, true)
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

async function walkDir(dirPath: string, name: string, st: WalkState, depth: number): Promise<DiskNode> {
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
    const measured = await sizeOnly(dirPath, st, depth)
    node.size = measured.size
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
  const dirTasks: Promise<DiskNode>[] = []

  for (let i = 0; i < entries.length; i++) {
    checkAborted(st)
    const ent = entries[i]
    const entName = ent.name
    if (ent.isSymbolicLink()) continue

    const childPath = joinPath(dirPath, entName)
    if (isExcluded(st, childPath)) continue

    if (ent.isDirectory()) {
      dirTasks.push(
        trackRootDiscovery(
          st,
          depth,
          st.collapseNames.has(entName.toLowerCase())
            ? walkCollapsedDir(childPath, entName, st, depth + 1)
            : walkDir(childPath, entName, st, depth + 1),
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
                const measured = measureFile(st, s)
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
                  return st.collapseNames.has(entName.toLowerCase())
                    ? walkCollapsedDir(childPath, entName, st, depth + 1)
                    : walkDir(childPath, entName, st, depth + 1)
                }
                if (s.isFile()) {
                  const measured = measureFile(st, s)
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
  let modifiedAt = 0
  for (const d of dirNodes) {
    if (d.size > 0 || d.children.length > 0) {
      all.push(d)
      totalSize += d.size
      modifiedAt = Math.max(modifiedAt, d.modifiedAt ?? 0)
    }
  }
  for (const f of fileNodes) {
    if (f && (f.size > 0 || f.hardLink)) {
      all.push(f)
      totalSize += f.size
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
    let restModifiedAt = 0
    for (let i = k; i < all.length; i++) {
      const child = all[i]
      if (containsPreservedNode(child, st.preserveNames)) top.push(child)
      else {
        rest.push(child)
        restSize += child.size
        restModifiedAt = Math.max(restModifiedAt, child.modifiedAt ?? 0)
      }
    }
    if (restSize > 0) {
      top.push({
        name: `Other (${rest.length} items)`,
        path: joinPath(dirPath, "__other__"),
        size: restSize,
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
  node.modifiedAt = modifiedAt || undefined
  emitProgress(st, dirPath)
  return node
}

export async function scanPathSync(targetPath: string, options: ScanOptions = {}): Promise<DiskNode> {
  const {
    onProgress,
    maxDepth = 10,
    concurrency = DEFAULT_CONCURRENCY,
    maxChildren = 48,
    preserveNames = [],
    collapseNames = [],
    signatureNames = [],
    progressIntervalMs = 100,
    signal,
    sizeMode = "physical",
    excludePaths = [],
  } = options

  const name = basename(targetPath) || targetPath
  const st: WalkState = {
    pool: new Pool(concurrency),
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
    excludedPaths: new Set(excludePaths.map(comparablePath)),
    unreadableCount: 0,
    issueSamples: [],
    discoveriesEmitted: 0,
    fileDiscoveriesEmitted: 0,
  }

  const t0 = performance.now()
  const rootStats = await stat(targetPath)
  let root: DiskNode
  if (rootStats.isFile()) {
    const measured = measureFile(st, rootStats)
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
    root = await walkDir(targetPath, name, st, 0)
  } else {
    throw new Error(`Unsupported scan target: ${targetPath}`)
  }
  if (st.unreadableCount > 0) {
    root.scanIssues = { unreadableCount: st.unreadableCount, samplePaths: st.issueSamples }
  }
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

const CPU_COUNT = Math.max(4, (cpus() || []).length || 8);
const DEFAULT_CONCURRENCY = Math.min(512, Math.max(128, CPU_COUNT * 48));
const EMPTY_CHILDREN = Object.freeze([]);
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
function sortBySizeDesc(a,b){ return b.size - a.size; }
function measureFile(st, stats) {
  const logicalSize = stats.size;
  const allocatedSize = st.sizeMode === "physical" && !IS_WIN && typeof stats.blocks === "number" ? stats.blocks * 512 : logicalSize;
  let size = allocatedSize;
  let hardLink;
  if (st.sizeMode === "physical" && stats.nlink > 1 && stats.ino > 0) {
    const key = stats.dev + ":" + stats.ino;
    if (st.claimedHardLinks.has(key)) { size = 0; hardLink = "secondary"; }
    else { st.claimedHardLinks.add(key); hardLink = "primary"; }
  }
  return { size, logicalSize: logicalSize === size ? undefined : logicalSize, hardLink, modifiedAt: Number.isFinite(stats.mtimeMs) && stats.mtimeMs > 0 ? stats.mtimeMs : undefined };
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
  let modifiedAt = 0;
  const signatures = [];
  const tasks = [];
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;
    const normalizedName = ent.name.toLowerCase();
    const childPath = joinPath(dirPath, ent.name);
    if (isExcluded(st, childPath)) continue;
    if (captureSignatures && st.signatureNames.has(normalizedName)) signatures.push(normalizedName);
    if (ent.isDirectory()) tasks.push(sizeOnly(childPath, st, depth+1).then(measured => { total += measured.size; modifiedAt = Math.max(modifiedAt, measured.modifiedAt || 0); }));
    else if (ent.isFile()) tasks.push(st.pool.run(() => stat(childPath)).then(s => { const measured = measureFile(st, s); total += measured.size; modifiedAt = Math.max(modifiedAt, measured.modifiedAt || 0); st.filesScanned++; st.scannedBytes += measured.size; }, () => recordUnreadable(st, childPath)));
    else if (ent.isFIFO?.() || ent.isSocket?.() || ent.isCharacterDevice?.() || ent.isBlockDevice?.()) continue;
    else tasks.push(st.pool.run(() => stat(childPath)).then(async s => {
      if (s.isDirectory()) { const measured = await sizeOnly(childPath, st, depth+1); total += measured.size; modifiedAt = Math.max(modifiedAt, measured.modifiedAt || 0); }
      else if (s.isFile()) { const measured = measureFile(st, s); total += measured.size; modifiedAt = Math.max(modifiedAt, measured.modifiedAt || 0); st.filesScanned++; st.scannedBytes += measured.size; }
    }, () => recordUnreadable(st, childPath)));
  }
  if (tasks.length) await Promise.all(tasks);
  tick(st, dirPath);
  return { size: total, modifiedAt: modifiedAt || undefined, signatures: signatures.length ? signatures.sort() : undefined };
}

async function walkCollapsedDir(dirPath, name, st, depth) {
  const measured = await sizeOnly(dirPath, st, depth, true);
  return { name, path: dirPath, ...measured, isDir: true, isCollapsed: true, children: [], ext: "" };
}

async function walkDir(dirPath, name, st, depth) {
  const node = { name, path: dirPath, size: 0, isDir: true, children: [], ext: "" };
  if (depth > st.maxDepth) { const measured = await sizeOnly(dirPath, st, depth); node.size = measured.size; node.modifiedAt = measured.modifiedAt; return node; }
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
      const measured = measureFile(st, s);
      st.filesScanned++; st.scannedBytes += measured.size;
      const dot = ent.name.lastIndexOf(".");
      const ext = dot > 0 ? ent.name.slice(dot+1).toLowerCase() : "";
      return { name: ent.name, path: childPath, ...measured, isDir: false, children: EMPTY_CHILDREN, ext };
    }, () => { recordUnreadable(st, childPath); return null; })));
    else fileTasks.push(trackRootDiscovery(st, depth, st.pool.run(() => stat(childPath)).then(async s => {
      if (s.isDirectory()) return st.collapseNames.has(ent.name.toLowerCase()) ? walkCollapsedDir(childPath, ent.name, st, depth+1) : walkDir(childPath, ent.name, st, depth+1);
      if (s.isFile()) {
        const measured = measureFile(st, s);
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
  let modifiedAt = 0;
  for (const d of dirNodes) { if (d.size > 0 || d.children.length) { all.push(d); totalSize += d.size; modifiedAt = Math.max(modifiedAt, d.modifiedAt || 0); } }
  for (const f of fileNodes) { if (f && (f.size > 0 || f.hardLink)) { all.push(f); totalSize += f.size; modifiedAt = Math.max(modifiedAt, f.modifiedAt || 0); } }
  const k = st.maxChildren;
  if (all.length <= k) { all.sort(sortBySizeDesc); node.children = all; }
  else {
    all.sort(sortBySizeDesc);
    const top = all.slice(0, k);
    const rest = [];
    let restSize = 0;
    let restModifiedAt = 0;
    for (let i = k; i < all.length; i++) {
      const child = all[i];
      if (containsPreservedNode(child, st.preserveNames)) top.push(child);
      else { rest.push(child); restSize += child.size; restModifiedAt = Math.max(restModifiedAt, child.modifiedAt || 0); }
    }
    if (restSize > 0) top.push({ name: "Other (" + rest.length + " items)", path: joinPath(dirPath,"__other__"), size: restSize, modifiedAt: restModifiedAt || undefined, isDir: true, children: rest.slice(0,12), ext: "", isOther: true });
    node.children = top;
  }
  node.size = totalSize;
  node.modifiedAt = modifiedAt || undefined;
  tick(st, dirPath);
  return node;
}

(async () => {
  const { targetPath, maxDepth, concurrency, maxChildren, preserveNames, collapseNames, signatureNames, progressIntervalMs, sizeMode, excludePaths } = workerData;
  const name = basename(targetPath) || targetPath;
  const st = { pool: new Pool(concurrency || DEFAULT_CONCURRENCY), maxDepth: maxDepth ?? 10, maxChildren: maxChildren ?? 48, preserveNames: new Set((preserveNames ?? []).map(name => name.toLowerCase())), collapseNames: new Set((collapseNames ?? []).map(name => name.toLowerCase())), signatureNames: new Set((signatureNames ?? []).map(name => name.toLowerCase())), filesScanned: 0, dirsScanned: 0, scannedBytes: 0, lastTick: 0, progressIntervalMs: progressIntervalMs ?? 100, onTick: true, sizeMode: sizeMode ?? "physical", claimedHardLinks: new Set(), excludedPaths: new Set((excludePaths ?? []).map(comparablePath)), unreadableCount: 0, issueSamples: [], discoveriesEmitted: 0, fileDiscoveriesEmitted: 0 };
  try {
    const rootStats = await stat(targetPath);
    let root;
    if (rootStats.isFile()) {
      const measured = measureFile(st, rootStats);
      const dot = name.lastIndexOf(".");
      root = { name, path: targetPath, ...measured, isDir: false, children: EMPTY_CHILDREN, ext: dot > 0 && dot < name.length - 1 ? name.slice(dot+1).toLowerCase() : "" };
      st.filesScanned = 1;
      st.scannedBytes = measured.size;
    } else if (rootStats.isDirectory()) root = await walkDir(targetPath, name, st, 0);
    else throw new Error("Unsupported scan target: " + targetPath);
    if (st.unreadableCount > 0) root.scanIssues = { unreadableCount: st.unreadableCount, samplePaths: st.issueSamples };
    parentPort.postMessage({ type: "done", root, filesScanned: st.filesScanned, dirsScanned: st.dirsScanned });
  } catch (err) {
    parentPort.postMessage({ type: "error", message: err && err.message ? err.message : String(err) });
  }
})();
`

function scanInWorker(targetPath: string, options: ScanOptions): Promise<DiskNode> {
  const {
    onProgress,
    maxDepth = 10,
    concurrency = DEFAULT_CONCURRENCY,
    maxChildren = 48,
    preserveNames = [],
    collapseNames = [],
    signatureNames = [],
    progressIntervalMs = 100,
    sizeMode = "physical",
    excludePaths = [],
  } = options

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(options.signal.reason)
      return
    }

    // eval worker from inline source — no extra file to ship
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        targetPath,
        maxDepth,
        concurrency,
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

    const cleanup = () => options.signal?.removeEventListener("abort", onAbort)
    const finish = (result: { root: DiskNode } | { error: unknown }) => {
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate()
      if ("root" in result) resolve(result.root)
      else reject(result.error)
    }
    const onAbort = () => finish({ error: options.signal?.reason ?? new Error("Scan cancelled") })

    options.signal?.addEventListener("abort", onAbort, { once: true })
    if (options.signal?.aborted) {
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
  options.signal?.throwIfAborted()
  const useWorker = options.useWorker !== false && typeof Worker !== "undefined"

  if (useWorker) {
    try {
      return await scanInWorker(targetPath, options)
    } catch (err) {
      options.signal?.throwIfAborted()
      // Fallback to in-process if worker fails (packaging / policy)
      if (process.env.DISKLIZARD_SCAN_DEBUG) console.warn("[disklizard] worker failed, in-process fallback", err)
    }
  }

  return scanPathSync(targetPath, options)
}

// ── Drives (fast Windows path: WMIC is slower; prefer PowerShell once) ────

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

export async function getDrives(): Promise<DriveInfo[]> {
  if (IS_WIN) {
    try {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "[Console]::OutputEncoding=[Text.UTF8Encoding]::UTF8; Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,Size,FreeSpace,DriveType | ConvertTo-Json -Compress",
        ],
        { windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      )
      const drives = parseWindowsDriveOutput(stdout)
      if (drives.length) return drives
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
    return drives
  }

  // macOS / Linux — `df -P` is portable and does not touch mount contents.
  try {
    const { stdout } = await execFileAsync("df", ["-kP"], { maxBuffer: 1024 * 1024 })
    const drives = parseDfOutput(stdout, OS)
    if (drives.length) return drives
  } catch {
    /* fall through */
  }

  return [{ path: "/", name: "System", label: "System (/)", total: 0, free: 0, used: 0, type: "local" }]
}

export function parseWindowsDriveOutput(stdout: string): DriveInfo[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim() || "[]")
  } catch {
    return []
  }

  const items = Array.isArray(parsed) ? parsed : [parsed]
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

export function parseDfOutput(stdout: string, os: NodeJS.Platform): DriveInfo[] {
  const seen = new Set<string>()
  const drives: DriveInfo[] = []
  for (const line of stdout.trim().split("\n").slice(1)) {
    const match = line.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/)
    if (!match) continue
    const source = match[1]
    const totalK = Number(match[2]) || 0
    const freeK = Number(match[4]) || 0
    const mount = match[5].replace(/\\040/g, " ").replace(/\\011/g, "\t").replace(/\\134/g, "\\")
    if (!mount.startsWith("/") || seen.has(mount) || totalK < 1024 * 100) continue

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

export async function assertSafeDeletionPath(targetPath: string) {
  const diskPlatform: DiskPlatform = OS === "darwin" || OS === "win32" ? OS : "linux"
  const drives = await getDrives()
  const options = { homePath: homedir(), mountRoots: drives.map((drive) => drive.path) }
  const blocked = deletionBlockReason(targetPath, diskPlatform, options)
  if (blocked) throw new Error(blocked)

  try {
    const info = await lstat(targetPath)
    if (!info.isSymbolicLink()) {
      const resolved = await realpath(targetPath)
      const resolvedBlock = deletionBlockReason(resolved, diskPlatform, options)
      if (resolvedBlock) throw new Error(resolvedBlock)
    }
  } catch (error) {
    if (error instanceof Error && !Reflect.has(error, "code")) throw error
  }
}

export async function deleteDiskPath(targetPath: string) {
  await assertSafeDeletionPath(targetPath)
  await rm(targetPath, { recursive: true, force: true })
  return { ok: true }
}
