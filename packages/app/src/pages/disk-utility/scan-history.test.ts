import { describe, expect, test } from "bun:test"
import { createScanHistory, disjointChangedPaths, filterScanHistoryEntries, summarizeScanChanges } from "./scan-history"
import type { DiskScanNode } from "./types"

const file = (path: string, size: number): DiskScanNode => ({
  name: path.split("/").at(-1) || path,
  path,
  size,
  isDir: false,
  children: [],
  ext: ".bin",
})

const root = (children: DiskScanNode[]): DiskScanNode => ({
  name: "root",
  path: "/scan",
  size: children.reduce((total, child) => total + child.size, 0),
  isDir: true,
  children,
  ext: "",
})

describe("scan history", () => {
  test("records truthful before/after bytes for additions, removals, and changes", () => {
    const before = root([file("/scan/grown.bin", 10), file("/scan/removed.bin", 8)])
    const after = root([file("/scan/grown.bin", 16), file("/scan/added.bin", 5)])
    const summary = summarizeScanChanges(before, after, ["/scan/grown.bin", "/scan/removed.bin", "/scan/added.bin"])

    expect(summary.totalDeltaBytes).toBe(3)
    expect(summary.changes).toEqual([
      {
        path: "/scan/removed.bin",
        name: "removed.bin",
        kind: "removed",
        beforeBytes: 8,
        afterBytes: 0,
        deltaBytes: -8,
        isDir: false,
      },
      {
        path: "/scan/grown.bin",
        name: "grown.bin",
        kind: "changed",
        beforeBytes: 10,
        afterBytes: 16,
        deltaBytes: 6,
        isDir: false,
      },
      {
        path: "/scan/added.bin",
        name: "added.bin",
        kind: "added",
        beforeBytes: 0,
        afterBytes: 5,
        deltaBytes: 5,
        isDir: false,
      },
    ])
  })

  test("deduplicates nested watcher paths and Windows path casing", () => {
    expect(disjointChangedPaths(["C:\\Work\\cache", "c:/work/cache/item.bin", "C:/WORK/cache"], "windows")).toEqual([
      "C:\\Work\\cache",
    ])
  })

  test("retains a bounded newest-first summary without recording errors", () => {
    let timestamp = 100
    const history = createScanHistory({ maxEntries: 2, maxChangesPerEntry: 1, now: () => ++timestamp })
    history.seed("scan", root([file("/scan/a.bin", 1), file("/scan/b.bin", 1)]))

    const firstRoot = root([file("/scan/a.bin", 2), file("/scan/b.bin", 1)])
    const first = history.record({ scanId: "scan", rootPath: "/scan", root: firstRoot, changedPaths: ["/scan/a.bin"] })
    expect(first?.totalDeltaBytes).toBe(1)

    const errorRoot = root([file("/scan/a.bin", 3), file("/scan/b.bin", 1)])
    expect(
      history.record({
        scanId: "scan",
        rootPath: "/scan",
        root: errorRoot,
        changedPaths: ["/scan/a.bin"],
        watchError: "watch paused",
      }),
    ).toBeUndefined()

    const secondRoot = root([file("/scan/a.bin", 4), file("/scan/b.bin", 7)])
    const second = history.record({
      scanId: "scan",
      rootPath: "/scan",
      root: secondRoot,
      changedPaths: ["/scan/a.bin", "/scan/b.bin"],
    })
    expect(second?.changes).toHaveLength(1)
    expect(second?.totalDeltaBytes).toBe(7)

    const thirdRoot = root([file("/scan/a.bin", 4), file("/scan/b.bin", 9)])
    history.record({ scanId: "scan", rootPath: "/scan", root: thirdRoot, changedPaths: ["/scan/b.bin"] })

    expect(history.entries()).toHaveLength(2)
    expect(history.entries().map((entry) => entry.recordedAt)).toEqual([103, 102])
    history.clear()
    expect(history.entries()).toEqual([])
  })

  test("filters one scan without losing event grouping", () => {
    const entries = [
      {
        id: "scan-a:1",
        scanId: "scan-a",
        rootPath: "/scan",
        recordedAt: 1,
        changedPaths: ["/scan/alpha.bin", "/scan/beta.bin"],
        totalDeltaBytes: 3,
        changes: [
          {
            path: "/scan/alpha.bin",
            name: "alpha.bin",
            kind: "changed" as const,
            beforeBytes: 1,
            afterBytes: 2,
            deltaBytes: 1,
            isDir: false,
          },
          {
            path: "/scan/beta.bin",
            name: "beta.bin",
            kind: "added" as const,
            beforeBytes: 0,
            afterBytes: 2,
            deltaBytes: 2,
            isDir: false,
          },
        ],
      },
      {
        id: "scan-b:1",
        scanId: "scan-b",
        rootPath: "/other",
        recordedAt: 2,
        changedPaths: ["/other/alpha.bin"],
        totalDeltaBytes: 1,
        changes: [],
      },
    ]

    const filtered = filterScanHistoryEntries(entries, "scan-a", "beta")
    expect(filtered).toHaveLength(1)
    expect(filtered[0].changes.map((change) => change.name)).toEqual(["beta.bin"])
    expect(filterScanHistoryEntries(entries, undefined)).toEqual([])
  })
})

test("whole-volume notifications identify changed descendants without double-counting parents", () => {
  const before = root([file("/scan/a", 10), file("/scan/b", 20)])
  const after = root([file("/scan/a", 14), file("/scan/b", 17)])
  const result = summarizeScanChanges(before, after, ["/scan"])
  expect(result.changes.map(change => change.path)).toEqual(["/scan/a", "/scan/b"])
  expect(result.totalDeltaBytes).toBe(1)
})

test("keeps a truthful volume fallback when retained children cannot explain the delta", () => {
  const before = root([file("/scan/a", 10)])
  const after = { ...root([file("/scan/a", 14)]), size: 30 }
  const result = summarizeScanChanges(before, after, ["/scan"])
  expect(result.changes.map(change => change.path)).toEqual(["/scan"])
  expect(result.totalDeltaBytes).toBe(20)
})
