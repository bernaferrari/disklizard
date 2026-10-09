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

it("keeps folder labels and visible children in the same spatial group", () => {
  const children = [
    node("a", 80, [node("a/b", 60, [node("a/b/c", 60)]), node("a/c", 20)]),
    node("d", 20),
  ]
  const cells = layoutNestedTreemap(children, 900, 650)
  const outer = layoutTreemap(children)
  const first = cells.find((tile) => tile.node.path === "a")!
  expect(first.expanded).toBe(true)
  expect(first.x).toBeCloseTo(outer[0].x * 900 + 2)
  expect(cells.map((tile) => tile.depth)).toEqual([0, 1, 1, 0])
  for (const child of cells.filter((tile) => tile.parent)) {
    const parent = cells.find((tile) => tile.node === child.parent)!
    expect(child.x).toBeGreaterThan(parent.x)
    expect(child.y).toBeGreaterThanOrEqual(
      parent.y + (parent.depth === 0 ? 34 : 28)
    )
    expect(child.x + child.w).toBeLessThan(parent.x + parent.w)
    expect(child.y + child.h).toBeLessThan(parent.y + parent.h)
  }
})

it("keeps small tiles simple and unmeasured layouts empty", () => {
  expect(
    layoutNestedTreemap([node("a", 100, [node("a/b", 100)])], 100, 80)
  ).toHaveLength(1)
  expect(layoutNestedTreemap([node("a", 100)], 0, 80)).toEqual([])
})

it("uses a large third-level folder for its contents rather than an empty block", () => {
  const deep = node("a/b/c", 80, [node("a/b/c/d", 50), node("a/b/c/e", 30)])
  const branch = node("a", 100, [
    node("a/b", 90, [deep, node("a/b/other", 10)]),
    node("a/other", 10),
  ])
  const roomy = layoutNestedTreemap([branch], 900, 650)
  expect(roomy.find((tile) => tile.node === deep)?.expanded).toBe(true)
  expect(roomy.find((tile) => tile.node.path === "a/b/c/d")?.depth).toBe(3)
  const compact = layoutNestedTreemap([branch], 150, 100)
  expect(compact.some((tile) => tile.node.path === "a/b/c/d")).toBe(false)
})

it("compresses one-child chains to show the first meaningful split", () => {
  const branch = node("level-0", 100, [
    node("level-1", 100, [
      node("level-2", 100, [node("a", 60), node("b", 40)]),
    ]),
  ])
  const cells = layoutNestedTreemap([branch], 900, 650)
  expect(cells.map((tile) => tile.node.name)).toEqual(["level-0", "a", "b"])
  expect(cells[0].displayName).toBe("level-0 / level-1 / level-2")
  expect(cells[0].drillNode?.name).toBe("level-2")
  expect(cells[1].parent).toBe(branch)
})

it("reveals more children when a folder has room and preserves the remainder", () => {
  const children = Array.from({ length: 500 }, (_, index) =>
    node(`parent/${index}`, (500 - index) * 1_000)
  )
  const total = children.reduce((sum, child) => sum + child.size, 0)
  const parent = node("parent", total, children)
  const cells = layoutNestedTreemap([parent], 900, 650)
  const compact = layoutNestedTreemap([parent], 320, 240)
  expect(cells.find((cell) => cell.node.isOther)?.parent).toBe(parent)
  expect(cells.filter((cell) => cell.depth === 1).length).toBeLessThanOrEqual(
    192
  )
  expect(cells.filter((cell) => cell.depth === 1).length).toBeGreaterThan(
    compact.filter((cell) => cell.depth === 1).length
  )
  expect(
    cells
      .filter((cell) => cell.depth === 1)
      .reduce((sum, cell) => sum + cell.node.size, 0)
  ).toBe(total)
})

it("caps root density while retaining the complete remainder", () => {
  const children = Array.from({ length: 300 }, (_, index) =>
    node(`item-${index}`, 1_000 + index)
  )
  const cells = layoutNestedTreemap(children, 900, 650, "/root")
  expect(cells.length).toBeLessThanOrEqual(320)
  const compact = layoutNestedTreemap(children, 320, 240, "/root")
  expect(cells.length).toBeGreaterThan(compact.length)
  expect(cells.reduce((sum, cell) => sum + cell.node.size, 0)).toBe(
    children.reduce((sum, child) => sum + child.size, 0)
  )
})

it("groups tiny root items only when their rectangles are too small", () => {
  const children = [
    ...Array.from({ length: 5 }, (_, index) => node(`large-${index}`, 100_000)),
    ...Array.from({ length: 15 }, (_, index) => node(`small-${index}`, 4_096)),
  ]
  const cells = layoutNestedTreemap(children, 320, 240, "/repo")
  const summary = cells.find(
    (cell) => cell.node.path === "disklizard:list-more:/repo"
  )
  expect(summary?.node.otherCount).toBe(15)
  expect(summary?.node.size).toBe(15 * 4_096)
  expect(
    layoutNestedTreemap(children, 900, 650, "/repo").some(
      (cell) => cell.node.isOther
    )
  ).toBe(false)
})

it("opens a dense smaller-items group into as many members as the view fits", () => {
  const children = Array.from({ length: 2_526 }, (_, index) =>
    node(`/root/item-${index}`, 1_000 + index)
  )
  const cells = layoutNestedTreemap(
    children,
    900,
    800,
    "disklizard:group:/root",
    children.reduce((sum, child) => sum + child.size, 0),
    true
  )
  // Roughly one 40×40 tile per member, then a single remainder.
  expect(cells.length).toBe(Math.floor((900 * 800) / 1_600))
  const summaries = cells.filter((cell) => cell.node.isOther)
  expect(summaries).toHaveLength(1)
  expect(summaries[0].node.otherCount).toBe(2_526 - (cells.length - 1))
  expect(cells.reduce((sum, cell) => sum + cell.node.size, 0)).toBe(
    children.reduce((sum, child) => sum + child.size, 0)
  )
})

it("does not add a second summary to an already grouped small set", () => {
  const children = Array.from({ length: 12 }, (_, index) =>
    node(`/root/item-${index}`, 1_000)
  )
  const cells = layoutNestedTreemap(
    children,
    900,
    800,
    "disklizard:group:/root",
    12_000,
    true
  )
  expect(cells).toHaveLength(12)
  expect(cells.some((cell) => cell.node.isOther)).toBe(false)
})
