import { describe, expect, it } from "bun:test"
import type { DiskScanNode } from "./types"
import { refreshScanTabsForWatcherUpdate, visibleScanTabCount, type RetainedScanTab } from "./scan-tabs"

function dir(name: string, path: string, children: DiskScanNode[] = []): DiskScanNode {
  return { name, path, size: children.reduce((sum, child) => sum + child.size, 0), isDir: true, children, ext: "" }
}

describe("retained scan tabs", () => {
  it("counts the active volume scan once when its current-scan pill is visible", () => {
    expect(
      visibleScanTabCount({
        retainedCount: 2,
        volumeJobIDs: ["active", "background"],
        activeID: "active",
        hasCurrentScan: true,
      }),
    ).toBe(4)
  })

  it("rebases only the watcher-matched background tab and restores its nearest valid view", () => {
    const oldPackage = dir("package", "/repo/node_modules/package")
    const oldTree = dir("repo", "/repo", [dir("node_modules", "/repo/node_modules", [oldPackage])])
    const activeTree = dir("other", "/other")
    const tabs: RetainedScanTab[] = [
      { id: "background", sessionID: "scan-a", tree: oldTree, view: oldPackage },
      { id: "other", sessionID: "scan-b", tree: activeTree, view: activeTree },
    ]
    const refreshedPackage = dir("package", "/repo/node_modules/package")
    const refreshedTree = dir("repo", "/repo", [dir("node_modules", "/repo/node_modules", [refreshedPackage])])

    const next = refreshScanTabsForWatcherUpdate(tabs, "scan-a", () => refreshedTree, "linux")

    expect(next[0]).toMatchObject({ id: "background", tree: refreshedTree, view: refreshedPackage })
    expect(next[1]).toBe(tabs[1])
  })

  it("falls back to the fresh root when a background tab's old view disappeared", () => {
    const oldBuild = dir("build", "/repo/build")
    const oldTree = dir("repo", "/repo", [oldBuild])
    const tabs: RetainedScanTab[] = [{ id: "background", sessionID: "scan-a", tree: oldTree, view: oldBuild }]
    const refreshedTree = dir("repo", "/repo", [dir("src", "/repo/src")])

    const next = refreshScanTabsForWatcherUpdate(tabs, "scan-a", () => refreshedTree, "linux")

    expect(next[0].view).toBe(refreshedTree)
  })
})
