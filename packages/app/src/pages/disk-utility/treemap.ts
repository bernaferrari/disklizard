/**
 * Squarified treemap layout — pure, no DOM. Pairs with `primarySegmentColor(i)`
 * from sunburst.ts so the treemap shares the map/list color contract.
 *
 * Coordinates are normalized 0..1 over the input box; the renderer scales them
 * to pixels. Areas are proportional to each child's size, packed with good
 * aspect ratios (Bruls/Huiying/van Wijk "squarify").
 */

import type { DiskScanNode } from "./types"

export type TreemapRect = {
  node: DiskScanNode
  /** Sorted index — feed to primarySegmentColor(i) for color sync with the list/map. */
  index: number
  x: number
  y: number
  w: number
  h: number
}

type Item = { node: DiskScanNode; size: number; index: number }
type Box = { x: number; y: number; w: number; h: number }

export function collapseTreemapChildren(children: DiskScanNode[], maxTiles = 320): DiskScanNode[] {
  const visible = children.filter((child) => child.size > 0).toSorted((a, b) => b.size - a.size)
  if (visible.length <= maxTiles) return visible
  if (maxTiles < 2) {
    return [
      {
        name: `${visible.length} smaller items`,
        path: `disklizard:mosaic-more:${visible[0]?.path ?? "unknown"}`,
        size: visible.reduce((sum, child) => sum + child.size, 0),
        isDir: true,
        isOther: true,
        children: [],
        ext: "",
      },
    ]
  }
  const kept = visible.slice(0, maxTiles - 1)
  const remainder = visible.slice(maxTiles - 1)
  return [
    ...kept,
    {
      name: `${remainder.length} smaller items`,
      path: `disklizard:mosaic-more:${remainder[0]?.path ?? "unknown"}`,
      size: remainder.reduce((sum, child) => sum + child.size, 0),
      isDir: true,
      isOther: true,
      children: [],
      ext: "",
    },
  ]
}

/** Worst (max) aspect ratio of a row laid along side `s`, row areas `row`. */
function worstRatio(row: Item[], s: number): number {
  if (!row.length) return Infinity
  const sum = row.reduce((acc, r) => acc + r.size, 0)
  const rmax = Math.max(...row.map((r) => r.size))
  const rmin = Math.min(...row.map((r) => r.size))
  const s2 = s * s
  const sum2 = sum * sum
  return Math.max((s2 * rmax) / sum2, sum2 / (s2 * rmin))
}

/** Lay a finished row as a strip along the box's shorter side; shrink the box. */
function layoutRow(row: Item[], box: Box, out: TreemapRect[]) {
  const horizontal = box.w >= box.h // strip occupies the left edge, items stack vertically
  const stripLen = horizontal ? box.h : box.w // the side items divide among themselves
  const sum = row.reduce((acc, r) => acc + r.size, 0)
  const thickness = sum / stripLen // strip depth (perpendicular to stripLen)
  let offset = 0
  for (const r of row) {
    const len = (r.size / sum) * stripLen
    if (horizontal) {
      out.push({ node: r.node, index: r.index, x: box.x, y: box.y + offset, w: thickness, h: len })
    } else {
      out.push({ node: r.node, index: r.index, x: box.x + offset, y: box.y, w: len, h: thickness })
    }
    offset += len
  }
  if (horizontal) {
    box.x += thickness
    box.w = Math.max(0, box.w - thickness)
  } else {
    box.y += thickness
    box.h = Math.max(0, box.h - thickness)
  }
}

/**
 * Squarify `children` into the box (default unit square). Sizes <= 0 are skipped.
 */
export function layoutTreemap(
  children: DiskScanNode[],
  box: Box = { x: 0, y: 0, w: 1, h: 1 },
  preserveRankedIndices = false,
): TreemapRect[] {
  const items: Item[] = children
    .map((node, index) => ({ node, size: node.size, index }))
    .filter((it) => it.size > 0)
    .sort((a, b) => b.size - a.size)
  // Key index to sorted order so colors match the ranked list (also sorted desc),
  // mirroring the sunburst's primarySegmentColor(index).
  if (!preserveRankedIndices) items.forEach((it, i) => (it.index = i))
  // Scale sizes so their sum equals the box area — squarify's geometry assumes that.
  const totalArea = box.w * box.h
  const total = items.reduce((acc, it) => acc + it.size, 0)
  if (total <= 0 || !items.length) return []
  for (const it of items) it.size = (it.size / total) * totalArea

  const out: TreemapRect[] = []
  const area: Box = { ...box }
  const remaining = [...items]
  let row: Item[] = []

  while (remaining.length) {
    const shortest = Math.min(area.w, area.h)
    const next = remaining[0]
    const withNext = [...row, next]
    if (row.length === 0 || worstRatio(withNext, shortest) <= worstRatio(row, shortest)) {
      row = withNext
      remaining.shift()
    } else {
      layoutRow(row, area, out)
      row = []
    }
  }
  layoutRow(row, area, out)
  return out
}
