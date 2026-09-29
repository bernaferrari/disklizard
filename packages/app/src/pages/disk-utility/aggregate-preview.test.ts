import { expect, test } from "bun:test"
import { aggregatePreviewCells } from "./aggregate-preview"
import type { DiskScanNode } from "./types"

const child = (index: number): DiskScanNode => ({
  name: `item-${index}`,
  path: `/root/item-${index}`,
  size: index + 1,
  isDir: false,
  children: [],
  ext: "bin",
})

test("summary detail grows with its visible area and preserves every byte", () => {
  const children = Array.from({ length: 2_500 }, (_, index) => child(index))
  const small = aggregatePreviewCells(children, 260, 200)
  const large = aggregatePreviewCells(children, 900, 700)
  expect(small.length).toBeLessThan(large.length)
  expect(large).toHaveLength(children.length)
  expect(large.every((node) => !node.isOther)).toBe(true)
  const total = children.reduce((sum, node) => sum + node.size, 0)
  expect(small.reduce((sum, node) => sum + node.size, 0)).toBe(total)
  expect(large.reduce((sum, node) => sum + node.size, 0)).toBe(total)
  expect(small.some((node) => node.path === children.at(-1)?.path)).toBe(true)
})

test("a screen-sized summary resolves into real packages instead of anonymous bins", () => {
  const children = Array.from({ length: 2_853 }, (_, index) => child(index))
  const cells = aggregatePreviewCells(children, 525, 890)
  expect(cells).toHaveLength(children.length)
  expect(cells.every((cell) => !cell.isOther)).toBe(true)
})

test("small summaries expose their actual members", () => {
  const children = Array.from({ length: 12 }, (_, index) => child(index))
  expect(aggregatePreviewCells(children, 400, 300)).toEqual(
    children.toSorted((a, b) => b.size - a.size)
  )
})
