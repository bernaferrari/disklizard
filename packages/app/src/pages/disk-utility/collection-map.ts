import type { DiskScanNode } from "./types"

/** A reversible visual projection. The scan and deletion metadata remain intact. */
export function withoutCollected(node: DiskScanNode, paths: ReadonlySet<string>): DiskScanNode {
  if (!paths.size) return node
  if (paths.has(node.path)) return { ...node, size: 0, children: [] }
  let removed = 0
  let changed = false
  const children: DiskScanNode[] = []
  for (const child of node.children) {
    const next = withoutCollected(child, paths)
    removed += Math.max(0, child.size - next.size)
    changed ||= next !== child
    if (next.size > 0 || !paths.has(child.path)) children.push(next)
  }
  return changed ? { ...node, size: Math.max(0, node.size - removed), children } : node
}
