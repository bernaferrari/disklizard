import type { DiskScanNode } from "./types"
import { rankedDiskChildren } from "./entry-view"
import { collapseTreemapChildren } from "./treemap"

export type IcicleCell = {
  node: DiskScanNode
  x: number
  width: number
  depth: number
  colorIndex: number
}

/** Descendants retain their parent's horizontal span and color family. */
export function layoutIcicle(
  root: DiskScanNode,
  levels = 5,
  viewportWidth = 900
): IcicleCell[] {
  const cells: IcicleCell[] = []
  const queue = [{ parent: root, x: 0, width: 1, depth: 0, colorIndex: 0 }]
  const walk = (
    parent: DiskScanNode,
    x: number,
    width: number,
    depth: number,
    colorIndex: number
  ) => {
    if (depth >= levels || width < 0.001 || cells.length >= 800) return
    const ranked = rankedDiskChildren(parent)
    const totalBytes = Math.max(
      parent.size,
      ranked.reduce((sum, child) => sum + child.node.size, 0)
    )
    const readable = ranked.filter(
      ({ node }) =>
        (width * viewportWidth * node.size) / Math.max(1, totalBytes) >= 32
    ).length
    const children = collapseTreemapChildren(
      ranked.map(({ node }) => node),
      Math.max(1, Math.min(12, readable + 1))
    ).map((node) => ({ node }))
    const total = Math.max(
      parent.size,
      children.reduce((sum, child) => sum + child.node.size, 0)
    )
    if (!total) return
    let offset = x
    for (let i = 0; i < children.length; i++) {
      const node = children[i].node
      const span = (width * node.size) / total
      const color = depth === 0 ? i : colorIndex
      if (span > 0 && cells.length < 800)
        cells.push({ node, x: offset, width: span, depth, colorIndex: color })
      if (!node.isOther && node.children?.length && span * viewportWidth >= 64)
        queue.push({
          parent: node,
          x: offset,
          width: span,
          depth: depth + 1,
          colorIndex: color,
        })
      offset += span
    }
  }
  for (let i = 0; i < queue.length && cells.length < 800; i++) {
    const next = queue[i]
    walk(next.parent, next.x, next.width, next.depth, next.colorIndex)
  }
  return cells
}
