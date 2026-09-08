import { expect, it } from "bun:test"
import { layoutIcicle } from "./icicle"
import type { DiskScanNode } from "./types"
const node = (name: string, size: number, children: DiskScanNode[] = []): DiskScanNode => ({
  name,
  path: name,
  size,
  children,
  isDir: true,
  ext: "",
})
it("aligns children under parents without changing their weights or colors", () => {
  const root = node("root", 100, [node("large", 80, [node("nested", 40)]), node("small", 20)])
  const cells = layoutIcicle(root)
  expect(cells.filter((cell) => cell.depth === 0).reduce((sum, cell) => sum + cell.width, 0)).toBe(1)
  const parent = cells.find((cell) => cell.node.name === "large")!
  const child = cells.find((cell) => cell.node.name === "nested")!
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
