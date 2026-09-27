import type { DiskScanNode } from "./types"

export const RECENT_CHANGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Return recently modified leaf items without counting every parent directory
 * whose aggregate mtime only reflects the same descendant change. Collapsed
 * folders remain a useful single result because their interiors are not in the
 * active scan tree yet.
 */
export function recentChangeNodes(
  root: DiskScanNode | null | undefined,
  now = Date.now(),
  windowMs = RECENT_CHANGE_WINDOW_MS
) {
  if (!root) return []
  const cutoff = now - windowMs
  const result: DiskScanNode[] = []
  const visit = (node: DiskScanNode) => {
    if (node.isOther || node.isHidden) return
    const children = node.children ?? []
    if (node.isDir && !node.isCollapsed && children.length > 0) {
      children.forEach(visit)
      return
    }
    if ((node.modifiedAt ?? 0) >= cutoff) result.push(node)
  }
  visit(root)
  return result.toSorted(
    (a, b) => b.size - a.size || (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0)
  )
}
