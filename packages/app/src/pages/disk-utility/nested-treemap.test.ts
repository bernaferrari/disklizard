import { expect, it } from "bun:test"
import { layoutNestedTreemap } from "./nested-treemap"
import { layoutTreemap } from "./treemap"
import type { DiskScanNode } from "./types"
const node = (
  name: string,
  size: number,
  children: DiskScanNode[] = []
): DiskScanNode => ({
  name,
  path: name,
  size,
  children,
  isDir: true,
  ext: "",
})
it("preserves morph destinations and contains descendants below parent headers", () => {
  const children = [
    node("a", 80, [node("a/b", 60, [node("a/b/c", 60)]), node("a/c", 20)]),
    node("d", 20),
  ]
  const cells = layoutNestedTreemap(children, 900, 650)
  const outer = layoutTreemap(children)
  for (const cell of cells) {
    if (cell.depth === 0) {
      const rect = outer.find((r) => r.node.path === cell.node.path)!
      expect(cell.x).toBeCloseTo(rect.x * 900 + 4)
      expect(cell.w).toBeCloseTo(rect.w * 900 - 8)
    } else {
      const parent = cells.find((r) => r.node === cell.parent)!
      expect(cell.index).toBe(parent.index)
      expect(cell.x).toBeGreaterThan(parent.x)
      expect(cell.y).toBeGreaterThanOrEqual(parent.y + 34)
      expect(cell.x + cell.w).toBeLessThan(parent.x + parent.w)
      expect(cell.y + cell.h).toBeLessThan(parent.y + parent.h)
    }
  }
  expect(cells.some((cell) => cell.depth === 2)).toBe(true)
  expect(cells.every((cell) => cell.depth <= 2)).toBe(true)
})
it("keeps small tiles simple and unmeasured layouts empty", () => {
  const children = [node("a", 100, [node("a/b", 100)])]
  expect(layoutNestedTreemap(children, 100, 80)).toHaveLength(1)
  expect(layoutNestedTreemap(children, 0, 80)).toEqual([])
})
it("reveals four descendant levels when a large branch has room", () => {
  let branch = node("leaf", 100)
  for (let depth = 4; depth >= 0; depth--)
    branch = node(`level-${depth}`, 100, [branch])
  const cells = layoutNestedTreemap([branch], 900, 650)
  expect(cells.map((cell) => cell.depth)).toEqual([0, 1, 2, 3, 4])
  expect(cells.at(-1)?.node.name).toBe("level-4")
  expect(cells.every((cell) => cell.w > 0 && cell.h > 0)).toBe(true)
})
it("keeps remainder navigation attached to its containing folder", () => {
  const parent = node(
    "parent",
    100,
    Array.from({ length: 50 }, (_, i) => node(`parent/${i}`, 2))
  )
  const cells = layoutNestedTreemap([parent], 900, 650)
  expect(cells.find((cell) => cell.node.isOther)?.parent).toBe(parent)
  expect(
    cells
      .filter((cell) => cell.depth === 1)
      .reduce((sum, cell) => sum + cell.node.size, 0)
  ).toBe(100)
})
