import type { DiskDriveInfo, DiskScanNode } from "@/context/platform"
import type { DiskPinnedLocation } from "@/context/settings"
import { canDeletePath } from "@opencode-ai/disklizard/safety"
import type { ReclaimSummary } from "./recognize"

function normalizedDiskPath(path: string, os?: "macos" | "windows" | "linux") {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/"
  const windowsPath = os === "windows" || /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
  return windowsPath ? normalized.toLowerCase() : normalized
}

export function diskPathEquals(a: string, b: string, os?: "macos" | "windows" | "linux") {
  return normalizedDiskPath(a, os) === normalizedDiskPath(b, os)
}

export function isPinnedScanLocation(
  locations: readonly DiskPinnedLocation[],
  path: string,
  os?: "macos" | "windows" | "linux",
) {
  return locations.some((location) => diskPathEquals(location.path, path, os))
}

/** Toggle a bounded persistent scan shortcut list without leaking platform path quirks into the UI. */
export function togglePinnedScanLocation(
  locations: readonly DiskPinnedLocation[],
  candidate: DiskPinnedLocation,
  os?: "macos" | "windows" | "linux",
  limit = 12,
): DiskPinnedLocation[] {
  if (!candidate.path.trim()) return [...locations]
  if (isPinnedScanLocation(locations, candidate.path, os)) {
    return locations.filter((location) => !diskPathEquals(location.path, candidate.path, os))
  }
  if (locations.length >= Math.max(1, limit)) return [...locations]
  const next = [...locations, { path: candidate.path, label: candidate.label.trim() || candidate.path }]
  return next
}

export function driveForPath(
  path: string,
  drives: readonly DiskDriveInfo[],
  os?: "macos" | "windows" | "linux",
): DiskDriveInfo | undefined {
  const candidate = normalizedDiskPath(path, os)
  return [...drives]
    .sort((a, b) => normalizedDiskPath(b.path, os).length - normalizedDiskPath(a.path, os).length)
    .find((drive) => {
      const root = normalizedDiskPath(drive.path, os)
      return candidate === root || (root === "/" ? candidate.startsWith("/") : candidate.startsWith(`${root}/`))
    })
}

/**
 * Account for bytes the filesystem reports as used but a metadata scan cannot
 * attribute to visible files (permissions, snapshots, metadata, or clones).
 */
export function includeHiddenSpace(root: DiskScanNode, drive?: DiskDriveInfo): DiskScanNode {
  if (!drive || !diskPathEquals(root.path, drive.path) || drive.used <= root.size) return root
  const hiddenSize = drive.used - root.size
  const hidden: DiskScanNode = {
    name: "Hidden space",
    path: `disklizard:hidden:${root.path}`,
    size: hiddenSize,
    isDir: true,
    isOther: true,
    isHidden: true,
    children: [],
    ext: "",
  }

  return {
    ...root,
    size: drive.used,
    children: [...root.children, hidden].sort((a, b) => b.size - a.size),
  }
}

export function asBrowseableRoot(node: DiskScanNode): DiskScanNode {
  if (node.isDir) return node
  return {
    name: "Selected file",
    path: `disklizard:selection:${node.path}`,
    size: node.size,
    isDir: true,
    children: [node],
    ext: "",
  }
}

/** Replace a focused subtree without losing its retained ancestors or scan-root identity. */
export function replaceScanSubtree(
  root: DiskScanNode,
  targetPath: string,
  replacement: DiskScanNode,
  os?: "macos" | "windows" | "linux",
): DiskScanNode {
  if (diskPathEquals(root.path, targetPath, os)) return replacement

  const children = root.children.map((child) => replaceScanSubtree(child, targetPath, replacement, os))
  if (children.every((child, index) => child === root.children[index])) return root

  const previousSize = root.children.reduce((sum, child) => sum + child.size, 0)
  const nextSize = children.reduce((sum, child) => sum + child.size, 0)
  const modifiedAt = children.reduce((latest, child) => Math.max(latest, child.modifiedAt ?? 0), 0)
  return {
    ...root,
    size: Math.max(0, root.size + nextSize - previousSize),
    modifiedAt: modifiedAt || undefined,
    children: children.toSorted((a, b) => b.size - a.size),
  }
}

/** Remove confirmed filesystem deletions while preserving unaffected tree object identity. */
export function removeScanSubtrees(
  root: DiskScanNode,
  removed: readonly DiskScanNode[],
  os?: "macos" | "windows" | "linux",
): DiskScanNode | null {
  const targets = new Set(uniqueDeletionRoots(removed, os).map((node) => normalizedDiskPath(node.path, os)))

  function visit(node: DiskScanNode): DiskScanNode | null {
    if (targets.has(normalizedDiskPath(node.path, os))) return null
    const children = node.children.map(visit).filter((child): child is DiskScanNode => child !== null)
    if (children.length === node.children.length && children.every((child, index) => child === node.children[index]))
      return node

    const previousSize = node.children.reduce((sum, child) => sum + child.size, 0)
    const nextSize = children.reduce((sum, child) => sum + child.size, 0)
    const modifiedAt = children.reduce((latest, child) => Math.max(latest, child.modifiedAt ?? 0), 0)
    return {
      ...node,
      size: Math.max(0, node.size + nextSize - previousSize),
      modifiedAt: modifiedAt || undefined,
      children: children.toSorted((a, b) => b.size - a.size),
    }
  }

  return visit(root)
}

export function canActOnNode(node: DiskScanNode, os?: "macos" | "windows" | "linux") {
  const platform = os === "macos" ? "darwin" : os === "windows" ? "win32" : "linux"
  return !node.isOther && !node.isHidden && canDeletePath(node.path, platform)
}

/** Keep the cleanup promise aligned with the path policy enforced by Electron. */
export function actionableReclaimSummary(summary: ReclaimSummary, os?: "macos" | "windows" | "linux"): ReclaimSummary {
  const buckets = summary.buckets
    .flatMap((bucket) => {
      const items = bucket.items.filter(({ node }) => canActOnNode(node, os))
      if (!items.length) return []
      return [{ ...bucket, items, count: items.length, bytes: items.reduce((sum, item) => sum + item.node.size, 0) }]
    })
    .sort((a, b) => b.bytes - a.bytes)
  return {
    totalBytes: buckets.reduce((sum, bucket) => sum + bucket.bytes, 0),
    totalCount: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    buckets,
  }
}

/** Collapse nested selections so a parent and its child are never charged or removed twice. */
export function uniqueDeletionRoots(
  nodes: readonly DiskScanNode[],
  os?: "macos" | "windows" | "linux",
): DiskScanNode[] {
  const key = (node: DiskScanNode) => {
    const normalized = node.path.replace(/\\/g, "/").replace(/\/+$/, "")
    return os === "windows" ? normalized.toLowerCase() : normalized
  }
  const sorted = [...nodes].sort((a, b) => key(a).length - key(b).length)
  const roots: DiskScanNode[] = []
  const selected = new Set<string>()
  for (const node of sorted) {
    const candidate = key(node)
    if (selected.has(candidate)) continue

    let separator = candidate.lastIndexOf("/")
    let nested = false
    while (separator >= 0) {
      const ancestor = separator === 0 ? "/" : candidate.slice(0, separator)
      if (selected.has(ancestor)) {
        nested = true
        break
      }
      if (separator === 0) break
      separator = candidate.lastIndexOf("/", separator - 1)
    }
    if (nested) continue

    selected.add(candidate)
    roots.push(node)
  }
  return roots
}

/** Remove stale collection entries that were inside an item deleted elsewhere. */
export function withoutDeletedNodes(
  nodes: readonly DiskScanNode[],
  deleted: readonly DiskScanNode[],
  os?: "macos" | "windows" | "linux",
): DiskScanNode[] {
  const key = (node: DiskScanNode) => {
    const normalized = node.path.replace(/\\/g, "/").replace(/\/+$/, "")
    return os === "windows" ? normalized.toLowerCase() : normalized
  }
  const roots = uniqueDeletionRoots(deleted, os).map(key)
  return nodes.filter((node) => {
    const candidate = key(node)
    return !roots.some((root) => candidate === root || candidate.startsWith(`${root}/`))
  })
}

export async function runDeletionBatch(
  nodes: readonly DiskScanNode[],
  remove: (node: DiskScanNode) => Promise<unknown>,
  os?: "macos" | "windows" | "linux",
) {
  const removed: DiskScanNode[] = []
  const failed: Array<{ node: DiskScanNode; error: unknown }> = []
  for (const node of uniqueDeletionRoots(nodes, os)) {
    if (!canActOnNode(node, os)) continue
    try {
      await remove(node)
      removed.push(node)
    } catch (error) {
      failed.push({ node, error })
    }
  }
  return { removed, failed }
}
