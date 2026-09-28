import { describe, expect, it } from "bun:test"
import type { DiskScanNode } from "./types"
import {
  diskEntrySortDirection,
  diskEntrySortKey,
  filterIndexedDiskEntries,
  groupSmallEntryTail,
  indexRetainedDiskTree,
  sortDiskEntries,
} from "./entry-view"

function node(
  name: string,
  path: string,
  size: number,
  children: DiskScanNode[] = [],
  modifiedAt?: number
): DiskScanNode {
  return {
    name,
    path,
    size,
    modifiedAt,
    isDir: children.length > 0,
    children,
    ext: name.split(".").at(-1) ?? "",
  }
}

describe("retained scan search", () => {
  it("finds nested names, paths, and recognition text across the whole retained tree", () => {
    const target = node("bundle.js", "/repo/packages/app/dist/bundle.js", 20)
    const root = node("repo", "/repo", 100, [
      node("README.md", "/repo/README.md", 10),
      node("packages", "/repo/packages", 90, [
        node("app", "/repo/packages/app", 90, [target]),
      ]),
    ])
    const indexed = indexRetainedDiskTree(root, (item) =>
      item === target ? "Build output" : undefined
    )

    expect(
      filterIndexedDiskEntries(indexed, "bundle").map(
        (entry) => entry.node.path
      )
    ).toEqual([target.path])
    expect(
      filterIndexedDiskEntries(indexed, "packages/app").map(
        (entry) => entry.node.path
      )
    ).toContain(target.path)
    expect(
      filterIndexedDiskEntries(indexed, "build output").map(
        (entry) => entry.node.path
      )
    ).toEqual([target.path])
  })

  it("keeps each node's local size rank as its color identity", () => {
    const root = node("root", "/", 60, [
      node("small", "/small", 10),
      node("large", "/large", 50),
    ])
    const indexed = indexRetainedDiskTree(root)
    expect(indexed.map((entry) => [entry.node.name, entry.colorIndex])).toEqual(
      [
        ["large", 0],
        ["small", 1],
      ]
    )
  })
})

describe("small retained entries", () => {
  it("groups only a tiny file tail and keeps its exact contents ready to open", () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, index) => ({
        node: node(`folder-${index}`, `/repo/folder-${index}`, 100_000, [
          node("child", `/repo/folder-${index}/child`, 1),
        ]),
        displaySize: 100_000,
        colorIndex: index,
        sourceIndex: index,
      })),
      ...Array.from({ length: 7 }, (_, index) => ({
        node: node(`file-${index}`, `/repo/file-${index}`, 4_096),
        displaySize: 4_096,
        colorIndex: index + 5,
        sourceIndex: index + 5,
      })),
    ]
    const grouped = groupSmallEntryTail(entries, "/repo", 528_672)
    expect(grouped).toHaveLength(6)
    expect(grouped.at(-1)?.node.isOther).toBe(true)
    expect(grouped.at(-1)?.node.children.map((child) => child.path)).toEqual(
      entries.slice(5).map((entry) => entry.node.path)
    )
    expect(grouped.at(-1)?.displaySize).toBe(7 * 4_096)
    expect(entries).toHaveLength(12)
  })

  it("leaves a short list and a larger file tail visible", () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      node: node(`file-${index}`, `/repo/file-${index}`, 100_000 - index),
      displaySize: 100_000 - index,
      colorIndex: index,
      sourceIndex: index,
    }))
    expect(groupSmallEntryTail(entries, "/repo", 1_200_000)).toEqual(entries)
  })

  it("groups tiny entries even when a tiny folder interrupts the file tail", () => {
    const entries = [
      ...Array.from({ length: 5 }, (_, index) => ({
        node: node(`large-${index}`, `/repo/large-${index}`, 100_000),
        displaySize: 100_000,
        colorIndex: index,
        sourceIndex: index,
      })),
      ...Array.from({ length: 9 }, (_, index) => ({
        node: node(`file-${index}`, `/repo/file-${index}`, 4_096),
        displaySize: 4_096,
        colorIndex: index + 5,
        sourceIndex: index + 5,
      })),
      {
        node: node("scripts", "/repo/scripts", 4_096, [
          node("run", "/repo/scripts/run", 4_096),
        ]),
        displaySize: 4_096,
        colorIndex: 14,
        sourceIndex: 14,
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        node: node(`tail-${index}`, `/repo/tail-${index}`, 4_096),
        displaySize: 4_096,
        colorIndex: index + 15,
        sourceIndex: index + 15,
      })),
    ]
    const grouped = groupSmallEntryTail(entries, "/repo", 561_440)
    expect(grouped).toHaveLength(6)
    expect(grouped.at(-1)?.node.otherCount).toBe(16)
    expect(
      grouped.at(-1)?.node.children.some((child) => child.name === "scripts")
    ).toBe(true)
    expect(grouped.at(-1)?.node.path).toBe("disklizard:list-more:/repo")
  })
})

describe("storage entry sorting", () => {
  const entries = [
    {
      node: node("zeta.ts", "/zeta.ts", 20, [], 20),
      displaySize: 20,
      sourceIndex: 0,
    },
    {
      node: node("alpha.log", "/alpha.log", 20, [], 10),
      displaySize: 20,
      sourceIndex: 1,
    },
    {
      node: node("unknown.md", "/unknown.md", 5),
      displaySize: 5,
      sourceIndex: 2,
    },
  ]

  it("sorts by every requested key and direction", () => {
    expect(
      sortDiskEntries(entries, "size", "ascending").map(
        (entry) => entry.node.name
      )
    ).toEqual(["unknown.md", "zeta.ts", "alpha.log"])
    expect(
      sortDiskEntries(entries, "name", "ascending").map(
        (entry) => entry.node.name
      )
    ).toEqual(["alpha.log", "unknown.md", "zeta.ts"])
    expect(
      sortDiskEntries(entries, "modified", "descending").map(
        (entry) => entry.node.name
      )
    ).toEqual(["zeta.ts", "alpha.log", "unknown.md"])
    expect(
      sortDiskEntries(entries, "type", "ascending").map(
        (entry) => entry.node.name
      )
    ).toEqual(["alpha.log", "unknown.md", "zeta.ts"])
  })

  it("parses only the values exposed by the sort controls", () => {
    expect(diskEntrySortKey("modified")).toBe("modified")
    expect(diskEntrySortKey("unexpected")).toBe("size")
    expect(diskEntrySortDirection("ascending")).toBe("ascending")
    expect(diskEntrySortDirection("unexpected")).toBe("descending")
  })

  it("preserves retained order when the selected key ties", () => {
    expect(
      sortDiskEntries(entries.slice(0, 2), "size", "descending").map(
        (entry) => entry.node.name
      )
    ).toEqual(["zeta.ts", "alpha.log"])
  })

  it("groups folders ahead of file extensions when type is ascending", () => {
    const folder = node("src", "/src", 30, [
      node("main.ts", "/src/main.ts", 30),
    ])
    expect(
      sortDiskEntries(
        [
          ...entries,
          { node: folder, displaySize: folder.size, sourceIndex: 3 },
        ],
        "type",
        "ascending"
      ).map((entry) => entry.node.name)
    ).toEqual(["src", "alpha.log", "unknown.md", "zeta.ts"])
  })
})

it("keeps combined remainders after real entries in every sort order", () => {
  const remainder = {
    node: { ...node("smaller items", "/other", 16000), isOther: true },
    displaySize: 16000,
    sourceIndex: 0,
  }
  const folder = {
    node: node("sdk", "/sdk", 9900),
    displaySize: 9900,
    sourceIndex: 1,
  }
  for (const key of ["size", "name", "modified", "type"] as const) {
    for (const direction of ["ascending", "descending"] as const) {
      expect(sortDiskEntries([remainder, folder], key, direction).at(-1)).toBe(
        remainder
      )
    }
  }
})

it("sorts developer categories without mixing build output and toolchains", () => {
  const entries = [
    {
      node: node("CoreSimulator", "/Library/CoreSimulator", 50),
      displaySize: 50,
      sourceIndex: 0,
      category: "toolchains",
    },
    {
      node: node("target", "/a/target", 10),
      displaySize: 10,
      sourceIndex: 1,
      category: "build-output",
    },
    {
      node: node("target", "/b/target", 20),
      displaySize: 20,
      sourceIndex: 2,
      category: "build-output",
    },
  ]
  expect(diskEntrySortKey("category")).toBe("category")
  expect(
    sortDiskEntries(entries, "category", "ascending").map(
      (entry) => entry.node.path
    )
  ).toEqual(["/b/target", "/a/target", "/Library/CoreSimulator"])
})
