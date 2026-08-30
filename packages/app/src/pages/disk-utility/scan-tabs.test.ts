import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import type { DiskScanNode } from "./types"
import {
  closeScanTab,
  limitRetainedScanTabs,
  MAX_RETAINED_SCAN_TABS,
  refreshScanTabsForWatcherUpdate,
  restoreScanTab,
  saveCurrentScanTab,
  visibleScanTabCount,
  type RetainedScanTab,
  type ScanTab,
} from "./scan-tabs"

function dir(name: string, path: string, children: DiskScanNode[] = []): DiskScanNode {
  return { name, path, size: children.reduce((sum, child) => sum + child.size, 0), isDir: true, children, ext: "" }
}

describe("retained scan tabs", () => {
  it("presents parked maps as ordinary saved-map buttons rather than an incomplete tab pattern", () => {
    const page = readFileSync(new URL("./index.tsx", import.meta.url), "utf8")
    expect(page).toContain('role="group"')
    expect(page).not.toContain('role="tablist"')
    expect(page).not.toContain('role="tab"')
    expect(page).not.toContain('aria-selected="false"')
  })

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

  it("updates an already-retained session instead of saving a duplicate tab", () => {
    const oldTree = dir("repo", "/repo", [dir("old", "/repo/old")])
    const freshView = dir("src", "/repo/src")
    const freshTree = dir("repo", "/repo", [freshView])
    const existing: ScanTab = {
      id: "kept-id",
      sessionID: "scan-a",
      label: "Repository",
      sourcePath: "/repo",
      tree: oldTree,
      view: oldTree,
      browseHistory: { past: [], current: "/repo", future: [] },
    }

    const next = saveCurrentScanTab(
      [existing],
      {
        sessionID: "scan-a",
        label: "Repository",
        sourcePath: "/repo",
        tree: freshTree,
        view: freshView,
        browseHistory: { past: ["/repo"], current: "/repo/src", future: [] },
      },
      { newTabID: "must-not-be-used", volumeJobSessionIDs: [], os: "linux" },
    )

    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ id: "kept-id", sessionID: "scan-a", tree: freshTree, view: freshView })
  })

  it("repairs duplicate retained owners for one session while saving its latest state", () => {
    const oldTree = dir("repo", "/repo")
    const latestTree = dir("repo", "/repo", [dir("src", "/repo/src")])
    const duplicate = (id: string): ScanTab => ({
      id,
      sessionID: "scan-a",
      label: "Repository",
      sourcePath: "/repo",
      tree: oldTree,
      view: oldTree,
      browseHistory: { past: [], current: "/repo", future: [] },
    })

    const next = saveCurrentScanTab(
      [duplicate("first-owner"), duplicate("stale-owner")],
      {
        sessionID: "scan-a",
        label: "Repository",
        sourcePath: "/repo",
        tree: latestTree,
        view: latestTree,
        browseHistory: { past: [], current: "/repo", future: [] },
      },
      { newTabID: "unused", volumeJobSessionIDs: [], os: "linux" },
    )

    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ id: "first-owner", tree: latestTree })
  })

  it("does not duplicate a sessionless map when the same immutable tree is saved twice", () => {
    const tree = dir("repo", "/repo")
    const current = {
      label: "Repository",
      sourcePath: "/repo",
      tree,
      view: tree,
      browseHistory: { past: [], current: "/repo", future: [] },
    }

    const first = saveCurrentScanTab([], current, {
      newTabID: "first",
      volumeJobSessionIDs: [],
      os: "linux",
    })
    const second = saveCurrentScanTab(first, current, {
      newTabID: "duplicate",
      volumeJobSessionIDs: [],
      os: "linux",
    })

    expect(second.map((tab) => tab.id)).toEqual(["first"])
  })

  it("keeps tab identity unique when two saves receive the same generated ID", () => {
    const firstTree = dir("first", "/first")
    const secondTree = dir("second", "/second")
    const first: ScanTab = {
      id: "tab-100",
      sessionID: "scan-a",
      label: "First",
      sourcePath: "/first",
      tree: firstTree,
      view: firstTree,
      browseHistory: { past: [], current: "/first", future: [] },
    }

    const next = saveCurrentScanTab(
      [first],
      {
        sessionID: "scan-b",
        label: "Second",
        sourcePath: "/second",
        tree: secondTree,
        view: secondTree,
        browseHistory: { past: [], current: "/second", future: [] },
      },
      { newTabID: "tab-100", volumeJobSessionIDs: [], os: "linux" },
    )

    expect(next.map((tab) => tab.id)).toEqual(["tab-100", "tab-100-2"])
  })

  it("evicts the oldest parked maps at the cap and releases only final watcher owners", () => {
    const tree = dir("repo", "/repo")
    const tab = (id: string, sessionID?: string): ScanTab => ({
      id,
      sessionID,
      label: id,
      sourcePath: `/${id}`,
      tree,
      view: tree,
      browseHistory: { past: [], current: tree.path, future: [] },
    })
    const tabs = [
      tab("oldest", "release-me"),
      tab("active-owner", "active"),
      tab("volume-owner", "volume"),
      tab("sessionless"),
      tab("recent-a", "recent-a"),
      tab("recent-b", "recent-b"),
    ]

    const limited = limitRetainedScanTabs(tabs, {
      limit: 3,
      activeSessionID: "active",
      volumeJobSessionIDs: ["volume"],
    })
    expect(limited.tabs.map((item) => item.id)).toEqual(["sessionless", "recent-a", "recent-b"])
    expect(limited.releaseSessionIDs).toEqual(["release-me"])
    expect(MAX_RETAINED_SCAN_TABS).toBe(4)
    expect(() => limitRetainedScanTabs(tabs, { limit: -1, volumeJobSessionIDs: [] })).toThrow(
      "Invalid retained scan tab limit",
    )
  })

  it("does not save an absent map or a session already owned by a volume job", () => {
    const tree = dir("repo", "/repo")
    const options = { newTabID: "unused", volumeJobSessionIDs: ["scan-a"], os: "linux" as const }
    const absent = saveCurrentScanTab(
      [],
      {
        sessionID: "scan-missing",
        label: "",
        sourcePath: "",
        tree: null,
        view: null,
        browseHistory: { past: [], future: [] },
      },
      options,
    )
    const volumeOwned = saveCurrentScanTab(
      [],
      {
        sessionID: "scan-a",
        label: "Repository",
        sourcePath: "/repo",
        tree,
        view: tree,
        browseHistory: { past: [], current: "/repo", future: [] },
      },
      options,
    )

    expect(absent).toEqual([])
    expect(volumeOwned).toEqual([])
  })

  it("restores the root and resets history when a parked view no longer exists", () => {
    const restoredTree = dir("repo", "/repo", [dir("src", "/repo/src")])
    const missingView = dir("build", "/repo/build")
    const parked: ScanTab = {
      id: "parked",
      sessionID: "scan-parked",
      label: "Repository",
      sourcePath: "/repo",
      tree: restoredTree,
      view: missingView,
      browseHistory: { past: ["/repo"], current: "/repo/build", future: ["/repo/src"] },
    }
    const currentTree = dir("home", "/home")

    const transition = restoreScanTab(
      [parked],
      "parked",
      {
        sessionID: "scan-current",
        label: "Home",
        sourcePath: "/home",
        tree: currentTree,
        view: currentTree,
        browseHistory: { past: [], current: "/home", future: [] },
      },
      { newTabID: "saved-current", volumeJobSessionIDs: [], os: "linux" },
    )

    expect(transition.restored?.view).toBe(restoredTree)
    expect(transition.restored?.browseHistory).toEqual({ past: [], current: "/repo", future: [] })
    expect(transition.tabs.map((tab) => tab.id)).toEqual(["saved-current"])
  })

  it("rebases a restored view by path and ignores an unknown tab without saving the current map", () => {
    const freshView = dir("src", "/repo/src")
    const tree = dir("repo", "/repo", [freshView])
    const staleView = dir("src", "/repo/src")
    const parked: ScanTab = {
      id: "parked",
      sessionID: "scan-a",
      label: "Repository",
      sourcePath: "/repo",
      tree,
      view: staleView,
      browseHistory: { past: ["/repo"], current: "/repo/src", future: [] },
    }
    const currentTree = dir("home", "/home")
    const current = {
      sessionID: "scan-current",
      label: "Home",
      sourcePath: "/home",
      tree: currentTree,
      view: currentTree,
      browseHistory: { past: [], current: "/home", future: [] },
    }
    const options = { newTabID: "saved-current", volumeJobSessionIDs: [], os: "linux" as const }

    const restored = restoreScanTab([parked], "parked", current, options)
    expect(restored.restored?.view).toBe(freshView)
    expect(restored.restored?.browseHistory).toEqual({ past: ["/repo"], current: "/repo/src", future: [] })

    const missing = restoreScanTab([parked], "missing", current, options)
    expect(missing.tabs).toEqual([parked])
    expect(missing.restored).toBeUndefined()
  })

  it("removes every duplicate owner of the session that becomes active on restore", () => {
    const parkedTree = dir("repo", "/repo")
    const parked = (id: string): ScanTab => ({
      id,
      sessionID: "scan-parked",
      label: "Repository",
      sourcePath: "/repo",
      tree: parkedTree,
      view: parkedTree,
      browseHistory: { past: [], current: "/repo", future: [] },
    })
    const currentTree = dir("home", "/home")

    const transition = restoreScanTab(
      [parked("stale-copy"), parked("selected")],
      "selected",
      {
        sessionID: "scan-current",
        label: "Home",
        sourcePath: "/home",
        tree: currentTree,
        view: currentTree,
        browseHistory: { past: [], current: "/home", future: [] },
      },
      { newTabID: "saved-current", volumeJobSessionIDs: [], os: "linux" },
    )

    expect(transition.tabs.map((tab) => tab.id)).toEqual(["saved-current"])
    expect(transition.restored?.sessionID).toBe("scan-parked")
  })

  it("releases a watcher only after its final scan owner closes", () => {
    const tree = dir("repo", "/repo")
    const parked = (id: string, sessionID: string): ScanTab => ({
      id,
      sessionID,
      label: "Repository",
      sourcePath: "/repo",
      tree,
      view: tree,
      browseHistory: { past: [], current: "/repo", future: [] },
    })

    const finalOwner = closeScanTab([parked("only", "scan-a")], "only", {
      activeSessionID: "scan-current",
      volumeJobSessionIDs: [],
    })
    expect(finalOwner).toMatchObject({ tabs: [], releaseSessionID: "scan-a" })

    const duplicateOwner = closeScanTab([parked("first", "scan-a"), parked("second", "scan-a")], "first", {
      activeSessionID: "scan-current",
      volumeJobSessionIDs: [],
    })
    expect(duplicateOwner.tabs.map((tab) => tab.id)).toEqual(["second"])
    expect(duplicateOwner.releaseSessionID).toBeUndefined()

    expect(
      closeScanTab([parked("active-copy", "scan-a")], "active-copy", {
        activeSessionID: "scan-a",
        volumeJobSessionIDs: [],
      }).releaseSessionID,
    ).toBeUndefined()
    expect(
      closeScanTab([parked("volume-copy", "scan-a")], "volume-copy", {
        activeSessionID: "scan-current",
        volumeJobSessionIDs: ["scan-a"],
      }).releaseSessionID,
    ).toBeUndefined()
  })

  it("treats an unknown close and a sessionless tab as watcher-free", () => {
    const tree = dir("repo", "/repo")
    const sessionless: ScanTab = {
      id: "sessionless",
      label: "Repository",
      sourcePath: "/repo",
      tree,
      view: tree,
      browseHistory: { past: [], current: "/repo", future: [] },
    }
    const options = { activeSessionID: "scan-current", volumeJobSessionIDs: [] }

    const missing = closeScanTab([sessionless], "missing", options)
    expect(missing.tabs).toEqual([sessionless])
    expect(missing.releaseSessionID).toBeUndefined()

    const closed = closeScanTab([sessionless], "sessionless", options)
    expect(closed.tabs).toEqual([])
    expect(closed.releaseSessionID).toBeUndefined()
  })
})
