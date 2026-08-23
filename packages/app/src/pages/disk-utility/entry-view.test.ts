import { describe, expect, it } from "bun:test"
import type { DiskScanNode } from "./types"
import {
  diskEntrySortDirection,
  diskEntrySortKey,
  filterIndexedDiskEntries,
  indexRetainedDiskTree,
  sortDiskEntries,
} from "./entry-view"

function node(
  name: string,
  path: string,
  size: number,
  children: DiskScanNode[] = [],
  modifiedAt?: number,
): DiskScanNode {
  return { name, path, size, modifiedAt, isDir: children.length > 0, children, ext: name.split(".").at(-1) ?? "" }
}

describe("retained scan search", () => {
  it("finds nested names, paths, and recognition text across the whole retained tree", () => {
    const target = node("bundle.js", "/repo/packages/app/dist/bundle.js", 20)
    const root = node("repo", "/repo", 100, [
      node("README.md", "/repo/README.md", 10),
      node("packages", "/repo/packages", 90, [node("app", "/repo/packages/app", 90, [target])]),
    ])
    const indexed = indexRetainedDiskTree(root, (item) => (item === target ? "Build output" : undefined))

    expect(filterIndexedDiskEntries(indexed, "bundle").map((entry) => entry.node.path)).toEqual([target.path])
    expect(filterIndexedDiskEntries(indexed, "packages/app").map((entry) => entry.node.path)).toContain(target.path)
    expect(filterIndexedDiskEntries(indexed, "build output").map((entry) => entry.node.path)).toEqual([target.path])
  })

  it("keeps each node's local size rank as its color identity", () => {
    const root = node("root", "/", 60, [node("small", "/small", 10), node("large", "/large", 50)])
    const indexed = indexRetainedDiskTree(root)
    expect(indexed.map((entry) => [entry.node.name, entry.colorIndex])).toEqual([
      ["large", 0],
      ["small", 1],
    ])
  })
})

describe("storage entry sorting", () => {
  const entries = [
    { node: node("zeta.ts", "/zeta.ts", 20, [], 20), displaySize: 20, sourceIndex: 0 },
    { node: node("alpha.log", "/alpha.log", 20, [], 10), displaySize: 20, sourceIndex: 1 },
    { node: node("unknown.md", "/unknown.md", 5), displaySize: 5, sourceIndex: 2 },
  ]

  it("sorts by every requested key and direction", () => {
    expect(sortDiskEntries(entries, "size", "ascending").map((entry) => entry.node.name)).toEqual([
      "unknown.md",
      "zeta.ts",
      "alpha.log",
    ])
    expect(sortDiskEntries(entries, "name", "ascending").map((entry) => entry.node.name)).toEqual([
      "alpha.log",
      "unknown.md",
      "zeta.ts",
    ])
    expect(sortDiskEntries(entries, "modified", "descending").map((entry) => entry.node.name)).toEqual([
      "zeta.ts",
      "alpha.log",
      "unknown.md",
    ])
    expect(sortDiskEntries(entries, "type", "ascending").map((entry) => entry.node.name)).toEqual([
      "alpha.log",
      "unknown.md",
      "zeta.ts",
    ])
  })

  it("parses only the values exposed by the sort controls", () => {
    expect(diskEntrySortKey("modified")).toBe("modified")
    expect(diskEntrySortKey("unexpected")).toBe("size")
    expect(diskEntrySortDirection("ascending")).toBe("ascending")
    expect(diskEntrySortDirection("unexpected")).toBe("descending")
  })

  it("preserves retained order when the selected key ties", () => {
    expect(sortDiskEntries(entries.slice(0, 2), "size", "descending").map((entry) => entry.node.name)).toEqual([
      "zeta.ts",
      "alpha.log",
    ])
  })

  it("groups folders ahead of file extensions when type is ascending", () => {
    const folder = node("src", "/src", 30, [node("main.ts", "/src/main.ts", 30)])
    expect(
      sortDiskEntries(
        [...entries, { node: folder, displaySize: folder.size, sourceIndex: 3 }],
        "type",
        "ascending",
      ).map((entry) => entry.node.name),
    ).toEqual(["src", "alpha.log", "unknown.md", "zeta.ts"])
  })
})
