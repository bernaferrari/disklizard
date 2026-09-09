import type { DiskScanNode, DiskScanUpdate } from "./types"

export type ScanHistoryChange = {
  path: string
  name: string
  kind: "added" | "removed" | "changed"
  beforeBytes: number
  afterBytes: number
  deltaBytes: number
  isDir: boolean
}

export type ScanHistoryEntry = {
  id: string
  scanId: string
  rootPath: string
  recordedAt: number
  changedPaths: string[]
  changes: ScanHistoryChange[]
  totalDeltaBytes: number
}

export function filterScanHistoryEntries(entries: readonly ScanHistoryEntry[], scanId: string | undefined, query = "") {
  if (!scanId) return []
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return entries.flatMap((entry): ScanHistoryEntry[] => {
    if (entry.scanId !== scanId) return []
    if (!normalizedQuery) return [entry]
    const changes = entry.changes.filter((change) =>
      `${change.name}\n${change.path}\n${change.kind}`.toLocaleLowerCase().includes(normalizedQuery),
    )
    if (changes.length === 0) return []
    return [{ ...entry, changes, totalDeltaBytes: changes.reduce((total, change) => total + change.deltaBytes, 0) }]
  })
}

type ScanHistoryOptions = {
  os?: "macos" | "windows" | "linux"
  maxEntries?: number
  maxChangesPerEntry?: number
  now?: () => number
}

function normalizePath(path: string, os?: ScanHistoryOptions["os"]) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "") || "/"
  return os === "windows" ? normalized.toLowerCase() : normalized
}

function isWithinPath(path: string, parent: string) {
  return path === parent || (parent === "/" ? path.startsWith("/") : path.startsWith(`${parent}/`))
}

/**
 * Watch backends can report both a directory and one of its descendants for
 * the same transaction. Keep only the shallowest roots so byte deltas are not
 * counted twice.
 */
export function disjointChangedPaths(paths: readonly string[], os?: ScanHistoryOptions["os"]) {
  const unique = new Map<string, string>()
  for (const path of paths) {
    const normalized = normalizePath(path, os)
    if (!unique.has(normalized)) unique.set(normalized, path)
  }
  const ordered = [...unique].sort(
    ([left], [right]) => left.split("/").length - right.split("/").length || left.localeCompare(right),
  )
  const accepted: Array<[string, string]> = []
  for (const candidate of ordered) {
    if (accepted.some(([parent]) => isWithinPath(candidate[0], parent))) continue
    accepted.push(candidate)
  }
  return accepted.map(([, original]) => original)
}

function nodesAtPaths(root: DiskScanNode, paths: readonly string[], os?: ScanHistoryOptions["os"]) {
  const targets = new Set(paths.map((path) => normalizePath(path, os)))
  const found = new Map<string, DiskScanNode>()
  const stack = [root]
  while (stack.length && found.size < targets.size) {
    const node = stack.pop()!
    const normalized = normalizePath(node.path, os)
    if (targets.has(normalized)) found.set(normalized, node)
    for (const child of node.children) stack.push(child)
  }
  return found
}

export function summarizeScanChanges(
  previous: DiskScanNode,
  next: DiskScanNode,
  changedPaths: readonly string[],
  options: Pick<ScanHistoryOptions, "os" | "maxChangesPerEntry"> = {},
) {
  const disjoint = disjointChangedPaths(changedPaths, options.os)
  const before = nodesAtPaths(previous, disjoint, options.os)
  const after = nodesAtPaths(next, disjoint, options.os)
  const changes = disjoint.flatMap((path): ScanHistoryChange[] => {
    const key = normalizePath(path, options.os)
    const oldNode = before.get(key)
    const newNode = after.get(key)
    if (!oldNode && !newNode) return []
    const beforeBytes = oldNode?.size ?? 0
    const afterBytes = newNode?.size ?? 0
    return [
      {
        path: newNode?.path ?? oldNode!.path,
        name: newNode?.name ?? oldNode!.name,
        kind: !oldNode ? "added" : !newNode ? "removed" : "changed",
        beforeBytes,
        afterBytes,
        deltaBytes: afterBytes - beforeBytes,
        isDir: newNode?.isDir ?? oldNode!.isDir,
      },
    ]
  })
  // A watcher may invalidate the whole volume. Resolve that notification to
  // changed retained branches, but keep the aggregate if coverage is lossy.
  if (disjoint.length === 1 && normalizePath(disjoint[0], options.os) === normalizePath(next.path, options.os)) {
    let budget = 20_000
    const descend = (oldNode: DiskScanNode | undefined, newNode: DiskScanNode | undefined): ScanHistoryChange[] => {
      const node = newNode ?? oldNode!
      const delta = (newNode?.size ?? 0) - (oldNode?.size ?? 0)
      if (oldNode && newNode && --budget > 0 && oldNode.children.length && newNode.children.length) {
        const oldChildren = new Map(oldNode.children.map(child => [normalizePath(child.path, options.os), child]))
        const newChildren = new Map(newNode.children.map(child => [normalizePath(child.path, options.os), child]))
        const details: ScanHistoryChange[] = []
        for (const key of new Set([...oldChildren.keys(), ...newChildren.keys()])) {
          const beforeChild = oldChildren.get(key), afterChild = newChildren.get(key)
          if (beforeChild === afterChild) continue
          details.push(...descend(beforeChild, afterChild))
          if (budget <= 0) break
        }
        if (budget > 0 && details.reduce((sum, change) => sum + change.deltaBytes, 0) === delta) return details
      }
      if (oldNode && newNode && delta === 0) return []
      return [{ path: node.path, name: node.name, isDir: node.isDir,
        kind: !oldNode ? "added" : !newNode ? "removed" : "changed",
        beforeBytes: oldNode?.size ?? 0, afterBytes: newNode?.size ?? 0, deltaBytes: delta }]
    }
    changes.splice(0, changes.length, ...descend(previous, next))
  }
  changes.sort(
    (left, right) =>
      Math.abs(right.deltaBytes) - Math.abs(left.deltaBytes) ||
      normalizePath(left.path, options.os).localeCompare(normalizePath(right.path, options.os)),
  )
  const totalDeltaBytes = changes.reduce((total, change) => total + change.deltaBytes, 0)
  return {
    changedPaths: disjoint,
    changes: changes.slice(0, Math.max(1, options.maxChangesPerEntry ?? 128)),
    totalDeltaBytes,
  }
}

/**
 * In-memory, bounded watcher history. It stores summaries rather than trees;
 * one authoritative previous root per live scan is retained for the next diff.
 */
export function createScanHistory(options: ScanHistoryOptions = {}) {
  const roots = new Map<string, DiskScanNode>()
  let entries: ScanHistoryEntry[] = []
  let sequence = 0
  const limit = Math.max(1, options.maxEntries ?? 30)
  const now = options.now ?? Date.now

  return {
    seed(scanId: string, root: DiskScanNode) {
      roots.set(scanId, root)
    },
    forget(scanId: string) {
      roots.delete(scanId)
    },
    record(update: DiskScanUpdate): ScanHistoryEntry | undefined {
      const previous = roots.get(update.scanId)
      roots.set(update.scanId, update.root)
      if (!previous || update.watchError || update.changedPaths.length === 0) return
      const summary = summarizeScanChanges(previous, update.root, update.changedPaths, options)
      if (summary.changes.length === 0) return
      const recordedAt = now()
      const entry: ScanHistoryEntry = {
        id: `${update.scanId}:${recordedAt}:${++sequence}`,
        scanId: update.scanId,
        rootPath: update.rootPath,
        recordedAt,
        ...summary,
      }
      entries = [entry, ...entries].slice(0, limit)
      return entry
    },
    entries() {
      return entries
    },
    clear(scanId?: string) {
      entries = scanId ? entries.filter((entry) => entry.scanId !== scanId) : []
    },
  }
}
