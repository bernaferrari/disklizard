import type { DiskScanNode } from "./types"
import {
  collapseTreemapChildren,
  groupSmallChildren,
  layoutTreemap,
} from "./treemap"

export type NestedTile = {
  node: DiskScanNode
  displayName?: string
  drillNode?: DiskScanNode
  index: number
  depth: number
  x: number
  y: number
  w: number
  h: number
  expanded: boolean
  parent?: DiskScanNode
}

/** Reveal child tiles under quiet folder labels, without drawing parent boxes. */
export function layoutNestedTreemap(
  children: DiskScanNode[],
  width: number,
  height: number,
  rootPath = "",
  rootSize = children.reduce((sum, child) => sum + child.size, 0),
  rootIsAggregate = false
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
    // A run of almost-identical single-child folders is one visual branch.
    // Keep the original node as the click target, but spend the area on the
    // first useful split instead of drawing concentric rectangles.
    let source = node
    const chain = [node]
    while (
      chain.length < 4 &&
      source.isDir &&
      source.children.length === 1 &&
      source.children[0].isDir &&
      !source.children[0].isOther &&
      source.children[0].size >= source.size * 0.96
    ) {
      source = source.children[0]
      chain.push(source)
    }
    // Available area decides how much detail to show. Depth is only a safety
    // bound; a roomy branch should not become blank after three levels.
    const expanded =
      depth < 8 &&
      node.isDir &&
      !node.isOther &&
      // Below this a nested header plus children is mostly chrome; a plain
      // tile with name and size says more with less.
      w >= 168 &&
      h >= 128 &&
      source.children.some((child) => child.size > 0) &&
      result.length < 640
    result.push({
      node,
      index,
      depth,
      x,
      y,
      w,
      h,
      expanded,
      parent,
      displayName:
        chain.length > 1
          ? chain.map((item) => item.name).join(" / ")
          : undefined,
      drillNode: chain.length > 1 ? source : undefined,
    })
    if (!expanded) return
    const inset = depth === 0 ? 4 : 3
    const header = depth === 0 ? 34 : 28
    const inner = {
      x: x + inset,
      y: y + header,
      w: w - inset * 2,
      h: h - header - inset,
    }
    const accounted = source.children.reduce(
      (sum, child) => sum + Math.max(0, child.size),
      0
    )
    inner.h *= Math.min(1, accounted / Math.max(node.size, accounted))
    // Use the available pixels before rolling children into a remainder. A
    // fixed limit of 24 made a screen-sized folder devote half its area to one
    // anonymous "smaller items" tile even though more children fit directly.
    const tileBudget = Math.max(
      12,
      Math.min(192, Math.floor((inner.w * inner.h) / 1_600))
    )
    for (const rect of layoutTreemap(
      groupSmallChildren(
        collapseTreemapChildren(source.children, tileBudget),
        source.path,
        source.size,
        (source.size * 1_600) / Math.max(1, inner.w * inner.h)
      ),
      inner
    )) {
      visit(
        rect.node,
        index,
        depth + 1,
        rect.x + 1.5,
        rect.y + 1.5,
        rect.w - 3,
        rect.h - 3,
        node
      )
    }
  }
  // An opened "smaller items" group already is the tail. Grouping its tail
  // again creates recursive summary boxes and hundreds of unreadable dots.
  let rootChildren: DiskScanNode[]
  if (rootIsAggregate) {
    if (children.length <= 24) {
      rootChildren = children.filter((child) => child.size > 0)
    } else {
      const aggregateChildren = collapseTreemapChildren(children, 8)
      const aggregateTail = aggregateChildren.at(-1)
      rootChildren =
        aggregateTail?.isOther && aggregateTail.size > rootSize * 0.9
          ? collapseTreemapChildren(children, 1)
          : aggregateChildren
    }
  } else {
    rootChildren = groupSmallChildren(
      collapseTreemapChildren(
        children,
        Math.max(12, Math.min(320, Math.floor((width * height) / 1_600)))
      ),
      rootPath,
      rootSize,
      (rootSize * 1_600) / Math.max(1, width * height)
    )
  }
  for (const rect of layoutTreemap(rootChildren, undefined, true)) {
    visit(
      rect.node,
      rect.index,
      0,
      rect.x * width + 2,
      rect.y * height + 2,
      rect.w * width - 4,
      rect.h * height - 4
    )
  }
  return result
}
