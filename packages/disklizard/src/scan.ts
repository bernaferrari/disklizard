/**
 * DiskLizard scanner — shared by Desktop + TUI.
 * High-concurrency traversal; worker offload optional.
 */

import { readdir, stat, rm, access } from "node:fs/promises"
import { basename, sep } from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { platform, homedir, cpus } from "node:os"
import { constants as fsConstants, type Dirent } from "node:fs"
import { Worker } from "node:worker_threads"
import type { DiskNode, DriveInfo, ScanOptions, ScanProgress } from "./types"

export type { DiskNode, DriveInfo, ScanOptions, ScanProgress }

const execFileAsync = promisify(execFile)
const IS_WIN = platform() === "win32"
const CPU_COUNT = Math.max(4, cpus()?.length ?? 8)

// Saturate NVMe/SSD without melting HDDs; scale with cores
const DEFAULT_CONCURRENCY = Math.min(512, Math.max(128, CPU_COUNT * 48))

const SKIP_NAMES = new Set([
  "$recycle.bin",
  "system volume information",
  "pagefile.sys",
  "hiberfil.sys",
  "swapfile.sys",
  ".trash",
  ".trashes",
  "thumbs.db",
  "desktop.ini",
])

// Windows system dirs that burn time and aren't useful in viz
const SKIP_PREFIX_WIN = IS_WIN
  ? new Set(["$windows.~bt", "$windows.~ws", "windows.old", "recovery", "config.msi"])
  : null

const EMPTY_CHILDREN: DiskNode[] = Object.freeze([]) as unknown as DiskNode[]

// ── Fast path join (avoid path.join overhead in hot loop) ─────────────────

function joinPath(parent: string, name: string): string {
  if (!parent) return name
  const last = parent.charCodeAt(parent.length - 1)
  if (last === 47 /* / */ || last === 92 /* \ */) return parent + name
  return parent + sep + name
}

function shouldSkipName(name: string): boolean {
  // Fast path: most names aren't skipped
  const c0 = name.charCodeAt(0)
  if (c0 !== 36 /* $ */ && c0 !== 46 /* . */ && c0 !== 116 /* t */ && c0 !== 84 /* T */ && c0 !== 100 /* d */ && c0 !== 68) {
    if (!SKIP_PREFIX_WIN) return false
  }
  const lower = name.toLowerCase()
  if (SKIP_NAMES.has(lower)) return true
  if (SKIP_PREFIX_WIN?.has(lower)) return true
  return false
}

// ── Concurrency pool ──────────────────────────────────────────────────────

class Pool {
  active = 0
  queue: Array<() => void> = []
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
      const next = this.queue.shift()
      if (next) next()
    }
  }
}

function sortBySizeDesc(a: DiskNode, b: DiskNode) {
  return b.size - a.size
}

// ── Core fast scanner ─────────────────────────────────────────────────────

type WalkState = {
  pool: Pool
  maxDepth: number
  maxChildren: number
  filesScanned: number
  dirsScanned: number
  lastProgressAt: number
  progressIntervalMs: number
  onProgress?: (p: ScanProgress) => void
  rootPath: string
  /** Shared counter for in-flight progress size estimate */
  scannedBytes: number
}

function emitProgress(st: WalkState, currentPath: string, size: number, force = false) {
  if (!st.onProgress) return
  const now = performance.now()
  if (!force && now - st.lastProgressAt < st.progressIntervalMs) return
  st.lastProgressAt = now
  st.onProgress({
    filesScanned: st.filesScanned,
    dirsScanned: st.dirsScanned,
    currentPath,
    size: size || st.scannedBytes,
  })
}

/**
 * Size-only fast pass: no DiskNode children allocated. Used past maxDepth / deep prune.
 */
async function sizeOnly(dirPath: string, st: WalkState, depth: number): Promise<number> {
  if (depth > st.maxDepth + 8) return 0 // hard safety

  let entries: Dirent[]
  try {
    entries = await st.pool.run(() => readdir(dirPath, { withFileTypes: true }))
  } catch {
    return 0
  }

  st.dirsScanned++
  let total = 0
  const tasks: Promise<void>[] = []

  for (let i = 0; i < entries.length; i++) {
    const ent = entries[i]
    const name = ent.name
    if (shouldSkipName(name)) continue

    // Prefer Dirent type checks — no extra syscall
    if (ent.isSymbolicLink()) continue

    const childPath = joinPath(dirPath, name)

    if (ent.isDirectory()) {
      tasks.push(
        sizeOnly(childPath, st, depth + 1).then((sz) => {
          total += sz
        }),
      )
    } else if (ent.isFile()) {
      tasks.push(
        st.pool.run(() => stat(childPath)).then(
          (s) => {
            total += s.size
            st.filesScanned++
            st.scannedBytes += s.size
          },
          () => {},
        ),
      )
    } else if (ent.isFIFO?.() || ent.isSocket?.() || ent.isCharacterDevice?.() || ent.isBlockDevice?.()) {
      // skip specials
    } else {
      // Unknown type (some FS): one stat to classify
      tasks.push(
        st.pool.run(() => stat(childPath)).then(
          async (s) => {
            if (s.isDirectory()) {
              total += await sizeOnly(childPath, st, depth + 1)
            } else if (s.isFile()) {
              total += s.size
              st.filesScanned++
              st.scannedBytes += s.size
            }
          },
          () => {},
        ),
      )
    }
  }

  if (tasks.length) await Promise.all(tasks)
  emitProgress(st, dirPath, total)
  return total
}

async function walkDir(dirPath: string, name: string, st: WalkState, depth: number): Promise<DiskNode> {
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
    node.size = await sizeOnly(dirPath, st, depth)
    return node
  }

  let entries: Dirent[]
  try {
    entries = await st.pool.run(() => readdir(dirPath, { withFileTypes: true }))
  } catch {
    return node
  }

  st.dirsScanned++
  emitProgress(st, dirPath, st.scannedBytes)

  const fileTasks: Promise<DiskNode | null>[] = []
  const dirTasks: Promise<DiskNode>[] = []

  for (let i = 0; i < entries.length; i++) {
    const ent = entries[i]
    const entName = ent.name
    if (shouldSkipName(entName)) continue
    if (ent.isSymbolicLink()) continue

    const childPath = joinPath(dirPath, entName)

    if (ent.isDirectory()) {
      dirTasks.push(walkDir(childPath, entName, st, depth + 1))
    } else if (ent.isFile()) {
      // Fast ext extract without path.extname alloc when possible
      fileTasks.push(
        st.pool.run(() => stat(childPath)).then(
          (s) => {
            st.filesScanned++
            st.scannedBytes += s.size
            const dot = entName.lastIndexOf(".")
            const ext = dot > 0 && dot < entName.length - 1 ? entName.slice(dot + 1).toLowerCase() : ""
            const fileNode: DiskNode = {
              name: entName,
              path: childPath,
              size: s.size,
              isDir: false,
              children: EMPTY_CHILDREN,
              ext,
            }
            return fileNode
          },
          () => null,
        ),
      )
    } else {
      // Rare: need stat to classify
      fileTasks.push(
        st.pool.run(() => stat(childPath)).then(
          async (s) => {
            if (s.isDirectory()) return walkDir(childPath, entName, st, depth + 1)
            if (s.isFile()) {
              st.filesScanned++
              st.scannedBytes += s.size
              const fileNode: DiskNode = {
                name: entName,
                path: childPath,
                size: s.size,
                isDir: false,
                children: EMPTY_CHILDREN,
                ext: "",
              }
              return fileNode
            }
            return null
          },
          () => null,
        ),
      )
    }
  }

  // Dirs + files fully parallel; pool already caps syscall concurrency
  const [dirNodes, fileNodes] = await Promise.all([
    dirTasks.length ? Promise.all(dirTasks) : Promise.resolve([] as DiskNode[]),
    fileTasks.length ? Promise.all(fileTasks) : Promise.resolve([] as (DiskNode | null)[]),
  ])

  const all: DiskNode[] = []
  let totalSize = 0
  for (const d of dirNodes) {
    if (d.size > 0 || d.children.length > 0) {
      all.push(d)
      totalSize += d.size
    }
  }
  for (const f of fileNodes) {
    if (f && f.size > 0) {
      all.push(f)
      totalSize += f.size
    }
  }

  const k = st.maxChildren
  if (all.length <= k) {
    all.sort(sortBySizeDesc)
    node.children = all
  } else {
    all.sort(sortBySizeDesc)
    const top = all.slice(0, k)
    let restSize = 0
    const restCount = all.length - k
    for (let i = k; i < all.length; i++) restSize += all[i].size
    if (restSize > 0) {
      top.push({
        name: `Other (${restCount} items)`,
        path: joinPath(dirPath, "__other__"),
        size: restSize,
        isDir: true,
        children: all.slice(k, k + 12),
        ext: "",
        isOther: true,
      })
    }
    node.children = top
  }

  node.size = totalSize
  emitProgress(st, dirPath, totalSize)
  return node
}

export async function scanPathSync(targetPath: string, options: ScanOptions = {}): Promise<DiskNode> {
  const {
    onProgress,
    maxDepth = 10,
    concurrency = DEFAULT_CONCURRENCY,
    maxChildren = 48,
    progressIntervalMs = 100,
  } = options

  const name = basename(targetPath) || targetPath
  const st: WalkState = {
    pool: new Pool(concurrency),
    maxDepth,
    maxChildren,
    filesScanned: 0,
    dirsScanned: 0,
    lastProgressAt: 0,
    progressIntervalMs,
    onProgress,
    rootPath: targetPath,
    scannedBytes: 0,
  }

  const t0 = performance.now()
  const root = await walkDir(targetPath, name, st, 0)
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
const { platform, cpus } = require("node:os");
const { sep } = require("node:path");

const IS_WIN = platform() === "win32";
const CPU_COUNT = Math.max(4, (cpus() || []).length || 8);
const DEFAULT_CONCURRENCY = Math.min(512, Math.max(128, CPU_COUNT * 48));
const SKIP_NAMES = new Set(["$recycle.bin","system volume information","pagefile.sys","hiberfil.sys","swapfile.sys",".trash",".trashes","thumbs.db","desktop.ini"]);
const SKIP_PREFIX_WIN = IS_WIN ? new Set(["$windows.~bt","$windows.~ws","windows.old","recovery","config.msi"]) : null;
const EMPTY_CHILDREN = Object.freeze([]);

function joinPath(parent, name) {
  if (!parent) return name;
  const last = parent.charCodeAt(parent.length - 1);
  if (last === 47 || last === 92) return parent + name;
  return parent + sep + name;
}
function shouldSkipName(name) {
  const lower = name.toLowerCase();
  if (SKIP_NAMES.has(lower)) return true;
  if (SKIP_PREFIX_WIN && SKIP_PREFIX_WIN.has(lower)) return true;
  return false;
}
class Pool {
  constructor(limit) { this.limit = limit; this.active = 0; this.queue = []; }
  async run(fn) {
    if (this.active >= this.limit) await new Promise(r => this.queue.push(r));
    this.active++;
    try { return await fn(); }
    finally { this.active--; const n = this.queue.shift(); if (n) n(); }
  }
}
function sortBySizeDesc(a,b){ return b.size - a.size; }

async function sizeOnly(dirPath, st, depth) {
  if (depth > st.maxDepth + 8) return 0;
  let entries;
  try { entries = await st.pool.run(() => readdir(dirPath, { withFileTypes: true })); }
  catch { return 0; }
  st.dirsScanned++;
  let total = 0;
  const tasks = [];
  for (const ent of entries) {
    if (shouldSkipName(ent.name) || ent.isSymbolicLink()) continue;
    const childPath = joinPath(dirPath, ent.name);
    if (ent.isDirectory()) tasks.push(sizeOnly(childPath, st, depth+1).then(sz => { total += sz; }));
    else if (ent.isFile()) tasks.push(st.pool.run(() => stat(childPath)).then(s => { total += s.size; st.filesScanned++; st.scannedBytes += s.size; }, () => {}));
  }
  if (tasks.length) await Promise.all(tasks);
  return total;
}

async function walkDir(dirPath, name, st, depth) {
  const node = { name, path: dirPath, size: 0, isDir: true, children: [], ext: "" };
  if (depth > st.maxDepth) { node.size = await sizeOnly(dirPath, st, depth); return node; }
  let entries;
  try { entries = await st.pool.run(() => readdir(dirPath, { withFileTypes: true })); }
  catch { return node; }
  st.dirsScanned++;
  if (st.onTick && performance.now() - st.lastTick > st.progressIntervalMs) {
    st.lastTick = performance.now();
    parentPort.postMessage({ type: "progress", filesScanned: st.filesScanned, dirsScanned: st.dirsScanned, currentPath: dirPath, size: st.scannedBytes });
  }
  const fileTasks = [];
  const dirTasks = [];
  for (const ent of entries) {
    if (shouldSkipName(ent.name) || ent.isSymbolicLink()) continue;
    const childPath = joinPath(dirPath, ent.name);
    if (ent.isDirectory()) dirTasks.push(walkDir(childPath, ent.name, st, depth+1));
    else if (ent.isFile()) fileTasks.push(st.pool.run(() => stat(childPath)).then(s => {
      st.filesScanned++; st.scannedBytes += s.size;
      const dot = ent.name.lastIndexOf(".");
      const ext = dot > 0 ? ent.name.slice(dot+1).toLowerCase() : "";
      return { name: ent.name, path: childPath, size: s.size, isDir: false, children: EMPTY_CHILDREN, ext };
    }, () => null));
  }
  const [dirNodes, fileNodes] = await Promise.all([
    dirTasks.length ? Promise.all(dirTasks) : [],
    fileTasks.length ? Promise.all(fileTasks) : [],
  ]);
  const all = [];
  let totalSize = 0;
  for (const d of dirNodes) { if (d.size > 0 || d.children.length) { all.push(d); totalSize += d.size; } }
  for (const f of fileNodes) { if (f && f.size > 0) { all.push(f); totalSize += f.size; } }
  const k = st.maxChildren;
  if (all.length <= k) { all.sort(sortBySizeDesc); node.children = all; }
  else {
    all.sort(sortBySizeDesc);
    const top = all.slice(0, k);
    let restSize = 0;
    for (let i = k; i < all.length; i++) restSize += all[i].size;
    if (restSize > 0) top.push({ name: "Other (" + (all.length-k) + " items)", path: joinPath(dirPath,"__other__"), size: restSize, isDir: true, children: all.slice(k, k+12), ext: "", isOther: true });
    node.children = top;
  }
  node.size = totalSize;
  return node;
}

(async () => {
  const { targetPath, maxDepth, concurrency, maxChildren, progressIntervalMs } = worker stabilData;
  const name = basename(targetPath) || targetPath;
  const st = { pool: new Pool(concurrency || DEFAULT_CONCURRENCY), maxDepth: maxDepth ?? 10, maxChildren: maxChildren ?? 48, filesScanned: 0, dirsScanned: 0, scannedBytes: 0, lastTick: 0, progressIntervalMs: progressIntervalMs ?? 100, onTick: true };
  try {
    const root = await walkDir(targetPath, name, st, 0);
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
    progressIntervalMs = 100,
  } = options

  return new Promise((resolve, reject) => {
    // eval worker from inline source — no extra file to ship
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { targetPath, maxDepth, concurrency, maxChildren, progressIntervalMs },
    })

    worker.on("message", (msg: { type: string; root?: DiskNode; filesScanned?: number; dirsScanned?: number; currentPath?: string; size?: number; message?: string }) => {
      if (msg.type === "progress") {
        onProgress?.({
          filesScanned: msg.filesScanned ?? 0,
          dirsScanned: msg.dirsScanned ?? 0,
          currentPath: msg.currentPath ?? targetPath,
          size: msg.size ?? 0,
        })
      } else if (msg.type === "done" && msg.root) {
        onProgress?.({
          filesScanned: msg.filesScanned ?? 0,
          dirsScanned: msg.dirsScanned ?? 0,
          currentPath: targetPath,
          size: msg.root.size,
          done: true,
        })
        resolve(msg.root)
        void worker.terminate()
      } else if (msg.type === "error") {
        reject(new Error(msg.message || "Worker scan failed"))
        void worker.terminate()
      }
    })

    worker.on("error", (err) => {
      reject(err)
    })

    worker.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Scan worker exited with code ${code}`))
    })
  })
}

/** Public entry — worker offload by default for responsiveness + same fast algorithm */
export async function scanPath(targetPath: string, options: ScanOptions = {}): Promise<DiskNode> {
  const useWorker = options.useWorker !== false && typeof Worker !== "undefined"

  if (useWorker) {
    try {
      return await scanInWorker(targetPath, options)
    } catch (err) {
      // Fallback to in-process if worker fails (packaging / policy)
      if (process.env.DISKLIZARD_SCAN_DEBUG) console.warn("[disklizard] worker failed, in-process fallback", err)
    }
  }

  return scanPathSync(targetPath, options)
}

// ── Drives (fast Windows path: WMIC is slower; prefer PowerShell once) ────

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
      const data = JSON.parse(stdout.trim() || "[]")
      const items = Array.isArray(data) ? data : [data]
      return items
        .filter((d: { DeviceID?: string; DriveType?: number }) => d.DeviceID && d.DriveType !== 5)
        .map((d: { DeviceID: string; VolumeName?: string; Size?: number; FreeSpace?: number; DriveType?: number }) => ({
          path: d.DeviceID + "\\",
          name: d.VolumeName || `Drive ${d.DeviceID}`,
          label: `${d.VolumeName ? d.VolumeName + " " : ""}(${d.DeviceID})`,
          total: Number(d.Size) || 0,
          free: Number(d.FreeSpace) || 0,
          used: (Number(d.Size) || 0) - (Number(d.FreeSpace) || 0),
          type: (d.DriveType === 2 ? "removable" : d.DriveType === 4 ? "network" : "local") as DriveInfo["type"],
        }))
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

  // macOS / Linux — fast local volumes only (no network mount walk)
  const home = homedir()
  const drives: DriveInfo[] = []

  try {
    const { stdout } = await execFileAsync("df", ["-kP"], { maxBuffer: 1024 * 1024 })
    const lines = stdout.trim().split("\n").slice(1)
    for (const line of lines) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 6) continue
      const totalK = Number(parts[1]) || 0
      const usedK = Number(parts[2]) || 0
      const freeK = Number(parts[3]) || 0
      const mount = parts[parts.length - 1]
      // Skip pseudo / tiny mounts
      if (!mount.startsWith("/")) continue
      if (mount.startsWith("/dev") || mount.startsWith("/System/Volumes/VM")) continue
      if (mount.startsWith("/System/Volumes/Preboot") || mount.startsWith("/System/Volumes/Update")) continue
      if (mount === "/private/var/vm") continue
      if (totalK < 1024 * 100) continue // < ~100MB

      const total = totalK * 1024
      const free = freeK * 1024
      const used = usedK * 1024
      const name = mount === "/" ? "Macintosh HD" : mount.split("/").filter(Boolean).pop() || mount
      drives.push({
        path: mount,
        name,
        label: mount === "/" ? `${name} (/)` : `${name} (${mount})`,
        total,
        free,
        used,
        type: mount.startsWith("/Volumes/") ? "removable" : "local",
      })
    }
  } catch {
    /* fall through */
  }

  if (drives.length === 0) {
    drives.push({ path: "/", name: "System", label: "System (/)", total: 0, free: 0, used: 0, type: "local" })
  }

  // Always offer home as a quick scan target if not already listed as a mount root
  if (!drives.some((d) => d.path === home)) {
    drives.push({ path: home, name: "Home", label: `Home (${home})`, total: 0, free: 0, used: 0, type: "local" })
  }

  return drives
}

export async function deleteDiskPath(targetPath: string) {
  await rm(targetPath, { recursive: true, force: true })
  return { ok: true }
}
