import { describe, expect, it } from "bun:test"
import { findRetainedLocation } from "./retained-location"
import type { DiskScanNode } from "./types"

function folder(path: string, children: DiskScanNode[] = []): DiskScanNode {
  return {
    name: path.split(/[/\\]/).at(-1) || path,
    path,
    size: 1,
    isDir: true,
    children,
    ext: "",
  }
}

describe("retained location lookup", () => {
  it("reopens a cached nested folder and prefers its dedicated scan", () => {
    const nested = folder("/work/.git", [folder("/work/.git/objects")])
    const parent = folder("/work", [nested])
    const dedicated = folder("/work/.git", [folder("/work/.git/refs")])
    const result = findRetainedLocation("/work/.git", [
      { kind: "tab", id: "parent", tree: parent },
      { kind: "volume", id: "git", tree: dedicated },
    ])
    expect(result?.candidate.id).toBe("git")
    expect(result?.node).toBe(dedicated)
  })

  it("uses a retained branch without recursively scanning unrelated siblings", () => {
    const cached = folder("/work/packages/app")
    const tree = folder("/work", [
      folder("/work/other"),
      folder("/work/packages", [cached]),
    ])
    expect(
      findRetainedLocation("/work/packages/app", [
        { kind: "tab", id: "work", tree },
      ])?.node
    ).toBe(cached)
  })

  it("does not call an unexpanded placeholder a viewable map", () => {
    const placeholder = { ...folder("/work/.git"), isCollapsed: true }
    const tree = folder("/work", [placeholder])
    expect(
      findRetainedLocation("/work/.git", [{ kind: "tab", id: "work", tree }])
    ).toBeUndefined()
  })

  it("keeps case-distinct Windows folders separate", () => {
    const tree = folder("C:\\Work", [folder("C:\\Work\\Git")])
    expect(
      findRetainedLocation(
        "C:\\Work\\git",
        [{ kind: "tab", id: "work", tree }],
        "windows"
      )
    ).toBeUndefined()
  })
})
