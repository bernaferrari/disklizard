import { expect, test } from "bun:test"
import { createTileIdentity } from "./tile-identity"
import type { DiskScanNode } from "./types"
const node = (
  path: string,
  size: number,
  children: DiskScanNode[] = []
): DiskScanNode => ({
  path,
  name: path.split("/").at(-1)!,
  size,
  ext: "",
  isDir: true,
  children,
})
test("tile identity does not change when a descendant becomes the viewport root", () => {
  const root = node("/", 100, [node("/yellow", 60), node("/green", 40)])
  const color = createTileIdentity(root)
  expect(color("/yellow/a")).toBe(color("/yellow/b"))
  expect(color("/yellow/a")).not.toBe(color("/green/a"))
  expect(color("/yellow/a/b/c/d")).not.toBe(color("/yellow/a"))
  expect(color("/yellowish")).toBeUndefined()
  expect(color("/")).toBeUndefined()
})
test("branch hues remain stable as sizes change during a scan", () => {
  const first = createTileIdentity(
    node("/work", 100, [node("/work/a", 60), node("/work/b", 40)])
  )
  const a = first("/work/a")
  const b = first("/work/b")
  const updated = createTileIdentity(
    node("/work", 120, [node("/work/b", 90), node("/work/a", 30)])
  )
  expect(updated("/work/a")).toBe(a)
  expect(updated("/work/b")).toBe(b)
})
