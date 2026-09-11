import { expect, test } from "bun:test"
import { withoutCollected } from "./collection-map"
import type { DiskScanNode } from "./types"
const node = (path: string, size: number, children: DiskScanNode[] = []): DiskScanNode => ({path, name: path, size, children, isDir: true, ext: ""})
test("drag projection subtracts descendants once and cancellation restores the original scan", () => {
  const child = node("/a/b", 20)
  const sibling = node("/c", 30)
  const root = node("/", 100, [node("/a", 60, [child]), sibling])
  const projected = withoutCollected(root, new Set(["/a", "/a/b"]))
  expect(projected.size).toBe(40)
  expect(projected.children).toEqual([sibling])
  expect(projected.children[0]).toBe(sibling)
  expect(root.size).toBe(100)
  expect(withoutCollected(root, new Set())).toBe(root)
  expect(withoutCollected(root, new Set([child.path])).size).toBe(80)
})
