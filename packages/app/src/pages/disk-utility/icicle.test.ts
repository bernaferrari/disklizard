import { expect, it } from "bun:test"
import { layoutIcicle } from "./icicle"
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
it("aligns children under parents without changing their weights or colors", () => {
  const root = node("root", 100, [
    node("large", 80, [node("nested", 40)]),
    node("small", 20),
  ])
  const cells = layoutIcicle(root)
  expect(
    cells
      .filter((cell) => cell.depth === 0)
      .reduce((sum, cell) => sum + cell.width, 0)
  ).toBe(1)
  const parent = cells.find((cell) => cell.node.name === "large")!
  const child = cells.find((cell) => cell.node.name === "nested")!
  expect(child.parent).toBe(parent.node)
  expect(child.x).toBe(parent.x)
  expect(child.width).toBe(0.4)
  expect(child.colorIndex).toBe(parent.colorIndex)
  expect(child.depth).toBe(1)
})
it("bounds depth and handles empty folders", () => {
  expect(layoutIcicle(node("empty", 0))).toEqual([])
  const root = node("root", 1, [node("a", 1, [node("b", 1, [node("c", 1)])])])
  expect(layoutIcicle(root, 2).map((cell) => cell.depth)).toEqual([0, 1])
})
it("groups narrow siblings while preserving every byte and the grouped children", () => {
  const children = Array.from({ length: 100 }, (_, i) => node("file-" + i, 1))
  const cells = layoutIcicle(node("root", 100, children), 5, 600)
  expect(cells.length).toBeLessThan(12)
  expect(cells.reduce((sum, cell) => sum + cell.node.size, 0)).toBe(100)
  expect(cells.find((cell) => cell.node.isOther)?.node.children).toHaveLength(
    100
  )
  expect(cells.find((cell) => cell.node.isOther)?.parent.path).toBe("root")
})

it("keeps substantial folders visible and recalculates small items after zoom", () => {
  const folder = node(
    "Downloads",
    359,
    [55, 34, 33, 27, 25, 23, 20, 8, 7, 6, 5, 4, ...Array(112).fill(1)].map(
      (size, i) => node(`folder-${i}`, size)
    )
  )
  const overview = layoutIcicle(node("disk", 1200, [folder]), 5, 600)
  const zoomed = layoutIcicle(folder, 5, 600).filter((cell) => cell.depth === 0)
  expect(
    zoomed.filter((cell) => !cell.node.isOther).length
  ).toBeGreaterThanOrEqual(5)
  expect(zoomed.find((cell) => cell.node.isOther)!.node.size).toBeLessThan(180)
  expect(
    overview.filter((cell) => cell.depth === 1 && !cell.node.isOther).length
  ).toBeLessThan(zoomed.filter((cell) => !cell.node.isOther).length)
})
