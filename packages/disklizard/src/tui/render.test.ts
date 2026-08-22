import { describe, expect, it } from "bun:test"
import type { DiskNode } from "../types"
import { renderTuiBars, renderTuiHeader, renderTuiHelp } from "./render"

function directory(name: string, size: number): DiskNode {
  return { name, path: `/root/${name}`, size, isDir: true, children: [], ext: "" }
}

describe("renderTuiBars", () => {
  it("keeps every sibling navigable while rendering a bounded viewport", () => {
    const children = Array.from({ length: 12 }, (_, index) => directory(`item-${index}`, 12 - index))
    const root = directory("root", children.reduce((sum, child) => sum + child.size, 0))
    root.children = children

    const result = renderTuiBars(root, { selected: 10, cols: 100, maxRows: 4 })

    expect(result.items).toEqual(children)
    expect(result.lines.some((line) => line.includes("↑ 7 more above"))).toBe(true)
    expect(result.lines.some((line) => line.includes("↓ 1 more below"))).toBe(true)
    expect(result.lines.some((line) => line.includes("item-10"))).toBe(true)
  })
})

describe("TUI safety and product identity", () => {
  it("describes the terminal UI as read-only and keeps cleanup in the guarded desktop flow", () => {
    expect(renderTuiHelp(100).join("\n")).toContain("Read-only by design")
    expect(renderTuiHelp(100).join("\n")).not.toContain("delete selected")
  })

  it("does not present the terminal product as OpenCode", () => {
    expect(renderTuiHeader({ title: "root", path: "/", size: 0, cols: 80 })).not.toContain("opencode")
  })
})
