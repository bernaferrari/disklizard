import type { DiskScanNode } from "./types"
import {
  collapseTreemapChildren,
  groupSmallChildren,
  layoutTreemap,
} from "./treemap"

export type NestedTile = {
  node: DiskScanNode
  index: number
  depth: number
  x: number
  y: number
  w: number
  h: number
  expanded: boolean
  parent?: DiskScanNode
}

/** Keep the outer rectangles identical to the map morph; reveal depth only
 * when there is room for a folder header and usable child targets. */
export function layoutNestedTreemap(
  children: DiskScanNode[],
  width: number,
  height: number,
  rootPath = "",
  rootSize = children.reduce((sum, child) => sum + child.size, 0)
): NestedTile[] {
  if (width <= 0 || height <= 0) return []
  const result: NestedTile[] = []
  const visit = (
    node: DiskScanNode,
    index: number,
    depth: number,
    x: number,
    y: number,
    w: number,
    h: number,
    parent?: DiskScanNode
  ) => {
    if (w <= 0 || h <= 0) return
    const expanded =
      depth < 4 &&
      node.isDir &&
      !node.isOther &&
      w >= 128 &&
      h >= 100 &&
      node.children.some((child) => child.size > 0) &&
      result.length < 640
    result.push({ node, index, depth, x, y, w, h, expanded, parent })
    if (!expanded) return
    // Reserve a header for opening/selecting the parent. Descendants are sibling
    // buttons in the DOM, never interactive elements nested inside a button.
    const inner = { x: x + 5, y: y + 34, w: w - 10, h: h - 39 }
    const accounted = node.children.reduce(
      (sum, child) => sum + Math.max(0, child.size),
      0
    )
    inner.h *= Math.min(1, accounted / Math.max(node.size, accounted))
    for (const rect of layoutTreemap(
      groupSmallChildren(
        collapseTreemapChildren(node.children, 32),
        node.path,
        node.size
      ),
      inner
    )) {
      visit(
        rect.node,
        index,
        depth + 1,
        rect.x + 1,
        rect.y + 1,
        rect.w - 2,
        rect.h - 2,
        node
      )
    }
  }
  for (const rect of layoutTreemap(
    groupSmallChildren(collapseTreemapChildren(children), rootPath, rootSize),
    undefined,
    true
  )) {
    visit(
      rect.node,
      rect.index,
      0,
      rect.x * width + 4,
      rect.y * height + 4,
      rect.w * width - 8,
      rect.h * height - 8
    )
  }
  return result
}
