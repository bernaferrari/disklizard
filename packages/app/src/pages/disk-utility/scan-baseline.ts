import type { DiskScanNode } from "./types"

/**
 * “Since last scan”: a compact fingerprint of the significant folders in a
 * scan, persisted per root so the next scan can answer the git-style
 * question — what grew, what's new, what went away.
 *
 * The fingerprint keeps only folders and files large enough to matter
 * (relative to the root and in absolute bytes), bounded in count, so storing
 * one per scanned location stays small.
 */

export type ScanBaseline = {
  version: 1
  rootPath: string
  recordedAt: number
  totalBytes: number
  /** path → [bytes, isDir ? 1 : 0] */
  entries: Record<string, [number, 0 | 1]>
}

export type BaselineChange = {
  path: string
  name: string
  kind: "added" | "removed" | "grew" | "shrank"
  beforeBytes: number
  afterBytes: number
  deltaBytes: number
  isDir: boolean
}

export type BaselineComparison = {
  previousAt: number
  previousBytes: number
  currentBytes: number
  netBytes: number
  changes: BaselineChange[]
}

const MB = 1024 * 1024

export function baselineThreshold(totalBytes: number) {
  return Math.max(25 * MB, totalBytes * 0.0004)
}

function captureEntries(
  root: DiskScanNode,
  options: { maxEntries: number; maxDepth: number; minBytes: number }
) {
  const entries: Record<string, [number, 0 | 1]> = {}
  let count = 0
  // Breadth-first by size keeps the largest structure when the budget runs out.
  let level: DiskScanNode[] = [root]
  for (let depth = 0; depth <= options.maxDepth && level.length; depth++) {
    const next: DiskScanNode[] = []
    for (const node of level.toSorted((a, b) => b.size - a.size)) {
      if (count >= options.maxEntries) return entries
      if (node.isHidden || node.size < options.minBytes) continue
      if (!node.isOther) {
        entries[node.path] = [node.size, node.isDir ? 1 : 0]
        count++
      }
      if (node.isDir && !node.isOther) next.push(...node.children)
    }
    level = next
  }
  return entries
}

export function captureBaseline(
  root: DiskScanNode,
  recordedAt = Date.now(),
  options: Partial<{ maxEntries: number; maxDepth: number }> = {}
): ScanBaseline {
  return {
    version: 1,
    rootPath: root.path,
    recordedAt,
    totalBytes: root.size,
    entries: captureEntries(root, {
      maxEntries: options.maxEntries ?? 4000,
      maxDepth: options.maxDepth ?? 8,
      minBytes: baselineThreshold(root.size),
    }),
  }
}

function parentPath(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "")
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"))
  return index <= 0 ? (index === 0 ? "/" : "") : trimmed.slice(0, index)
}

function baseName(path: string) {
  const trimmed = path.replace(/[\\/]+$/, "")
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || trimmed
}

/**
 * Compare two fingerprints. A change is reported at the deepest level that
 * still explains most of it, so `~/Projects/app/node_modules  +1.4 GB`
 * surfaces instead of `Users +1.4 GB`, `alex +1.4 GB`, `Projects +1.4 GB`.
 */
export function compareBaselines(
  previous: ScanBaseline,
  current: ScanBaseline,
  options: { limit?: number } = {}
): BaselineComparison {
  const threshold = baselineThreshold(Math.max(previous.totalBytes, current.totalBytes))
  const raw = new Map<string, BaselineChange>()
  const paths = new Set([
    ...Object.keys(previous.entries),
    ...Object.keys(current.entries),
  ])
  for (const path of paths) {
    if (path === current.rootPath || path === previous.rootPath) continue
    const before = previous.entries[path]
    const after = current.entries[path]
    const beforeBytes = before?.[0] ?? 0
    const afterBytes = after?.[0] ?? 0
    const delta = afterBytes - beforeBytes
    if (Math.abs(delta) < threshold) continue
    // One side below the capture threshold means its size is unknown (under
    // the threshold), so only clearly large appearances/disappearances count.
    if ((!before || !after) && Math.max(beforeBytes, afterBytes) < threshold * 2)
      continue
    if (!after && !current.entries[parentPath(path)]) continue
    if (before && after && Math.abs(delta) < Math.max(beforeBytes, afterBytes) * 0.04)
      continue
    const kind: BaselineChange["kind"] = !before
      ? "added"
      : !after
        ? "removed"
        : delta > 0
          ? "grew"
          : "shrank"
    raw.set(path, {
      path,
      name: baseName(path),
      kind,
      beforeBytes,
      afterBytes,
      deltaBytes: delta,
      isDir: (after ?? before)[1] === 1,
    })
  }
  // A brand-new (or vanished) folder is the answer itself; its contents are detail.
  for (const change of raw.values()) {
    let parent = parentPath(change.path)
    while (parent && parent !== current.rootPath) {
      const ancestor = raw.get(parent)
      if (ancestor && (ancestor.kind === "added" || ancestor.kind === "removed") && ancestor.kind === change.kind) {
        raw.delete(change.path)
        break
      }
      parent = parentPath(parent)
    }
  }
  // Like `git diff --dirstat`: name the child when one child dominates a
  // folder's change, and roll up to the folder when many children share it.
  const nearest = new Map<string, BaselineChange[]>()
  for (const change of raw.values()) {
    let parent = parentPath(change.path)
    while (parent && parent !== current.rootPath && !raw.has(parent))
      parent = parentPath(parent)
    if (!parent || parent === current.rootPath) continue
    nearest.set(parent, [...(nearest.get(parent) ?? []), change])
  }
  const explained = new Set<string>()
  const absorbing = new Set<string>()
  for (const [path, children] of nearest) {
    const ancestor = raw.get(path)!
    const same = children.filter(
      (child) => Math.sign(child.deltaBytes) === Math.sign(ancestor.deltaBytes)
    )
    const largest = Math.max(0, ...same.map((child) => Math.abs(child.deltaBytes)))
    if (largest >= Math.abs(ancestor.deltaBytes) * 0.6) explained.add(path)
    else if (same.length >= 3) absorbing.add(path)
  }
  const absorbed = (path: string) => {
    let parent = parentPath(path)
    while (parent && parent !== current.rootPath) {
      if (absorbing.has(parent) && !explained.has(parent)) return true
      parent = parentPath(parent)
    }
    return false
  }
  for (const path of raw.keys())
    if (absorbed(path)) explained.add(path)
  const changes = [...raw.values()]
    .filter((change) => !explained.has(change.path))
    .sort((a, b) => Math.abs(b.deltaBytes) - Math.abs(a.deltaBytes))
    .slice(0, options.limit ?? 60)
  return {
    previousAt: previous.recordedAt,
    previousBytes: previous.totalBytes,
    currentBytes: current.totalBytes,
    netBytes: current.totalBytes - previous.totalBytes,
    changes,
  }
}

export function baselineStorageKey(rootPath: string) {
  return `baseline:${rootPath.replaceAll("\\", "/").replace(/\/+$/, "") || "/"}`
}

export function decodeBaseline(value: string | null | undefined) {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as ScanBaseline
    return parsed?.version === 1 && parsed.entries ? parsed : undefined
  } catch {
    return undefined
  }
}
