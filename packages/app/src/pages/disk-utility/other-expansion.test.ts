import { describe, expect, it } from "bun:test"
import { planOtherExpansion } from "./other-expansion"
import type { DiskScanNode } from "./types"

function directory(path: string, children: DiskScanNode[] = []): DiskScanNode {
  return { name: path.split(/[/\\]/).at(-1) || path, path, size: 1, isDir: true, children, ext: "" }
}

function other(path: string, otherCount?: number): DiskScanNode {
  return {
    name: "copy must not be parsed (999999 items)",
    path,
    size: 1,
    isDir: true,
    isOther: true,
    ...(otherCount === undefined ? {} : { otherCount }),
    children: [],
    ext: "",
  }
}

describe("Other expansion planning", () => {
  it("rescans the real parent and initially widens a dense directory to 192 entries", () => {
    const aggregate = other("/work/__other__", 952)
    const retained = Array.from({ length: 48 }, (_, index) => directory(`/work/folder-${index}`))
    const root = directory("/work", [...retained, aggregate])

    expect(planOtherExpansion(root, aggregate)).toEqual({ parent: root, maxChildren: 192, representedCount: 952 })
  })

  it("uses exact metadata to finish a smaller directory without parsing its name", () => {
    const aggregate = other("/work/__other__", 12)
    const root = directory("/work", [directory("/work/a"), aggregate])

    expect(planOtherExpansion(root, aggregate)?.maxChildren).toBe(13)
  })

  it("progressively grows retained results and stops at the desktop safety cap", () => {
    const aggregate = other("/work/__other__", 30_000)
    const root = directory("/work", [
      ...Array.from({ length: 3_000 }, (_, index) => directory(`/work/folder-${index}`)),
      aggregate,
    ])

    expect(planOtherExpansion(root, aggregate)?.maxChildren).toBe(10_000)
    expect(
      planOtherExpansion(
        directory("/work", [
          ...Array.from({ length: 10_000 }, (_, index) => directory(`/work/folder-${index}`)),
          aggregate,
        ]),
        aggregate,
      ),
    ).toBeUndefined()
  })

  it("supports legacy aggregates and Windows path identity but rejects non-aggregate and hidden nodes", () => {
    const aggregate = other("C:\\Work\\__other__")
    const equivalent = { ...aggregate, path: "c:\\work\\__OTHER__" }
    const root = directory("C:\\Work", [directory("C:\\Work\\a"), aggregate])

    expect(planOtherExpansion(root, equivalent, "windows")?.maxChildren).toBe(192)
    expect(planOtherExpansion(root, directory("C:\\Work\\a"), "windows")).toBeUndefined()
    expect(planOtherExpansion(root, { ...aggregate, isHidden: true }, "windows")).toBeUndefined()
  })

  it("rejects invalid custom bounds", () => {
    const aggregate = other("/work/__other__", 2)
    const root = directory("/work", [aggregate])
    expect(() => planOtherExpansion(root, aggregate, undefined, { maxChildren: 0 })).toThrow(RangeError)
  })
})
