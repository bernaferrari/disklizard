import { describe, expect, it } from "bun:test"
import type { DiskScanNode } from "./types"
import { recentChangeNodes } from "./recent-changes"

const now = Date.UTC(2026, 7, 11, 12)
const day = 24 * 60 * 60 * 1000

function node(name: string, size: number, modifiedAt: number, children: DiskScanNode[] = []): DiskScanNode {
  return { name, path: `/${name}`, size, modifiedAt, isDir: children.length > 0, children, ext: "" }
}

describe("recentChangeNodes", () => {
  it("surfaces the largest changed leaves without double-counting parent aggregate mtimes", () => {
    const latest = node("latest.mov", 700, now - day)
    const root = node("root", 1_000, now - day, [node("folder", 700, now - day, [latest]), node("old.zip", 300, now - 9 * day)])

    expect(recentChangeNodes(root, now).map((item) => item.name)).toEqual(["latest.mov"])
  })

  it("keeps an unexpanded recent folder inspectable as one honest result", () => {
    const collapsed: DiskScanNode = {
      ...node("node_modules", 900, now - day),
      isDir: true,
      isCollapsed: true,
    }
    expect(recentChangeNodes(collapsed, now)).toEqual([collapsed])
  })

  it("excludes stale and visual aggregate nodes", () => {
    const root = node("root", 100, now, [
      node("old", 80, now - 8 * day),
      { ...node("Other", 20, now), isOther: true },
    ])
    expect(recentChangeNodes(root, now)).toEqual([])
  })
})
