import { describe, expect, it } from "bun:test"
import type { DeveloperArtifactInventory } from "@disklizard/core"
import type { DiskDriveInfo, DiskScanNode } from "./types"
import {
  actionableReclaimSummary,
  asBrowseableRoot,
  canActOnNode,
  driveForPath,
  includeHiddenSpace,
  hasUnverifiedPhysicalCloneAccounting,
  isPhysicalByteAccounting,
  isPinnedScanLocation,
  replaceScanSubtree,
  removeScanSubtrees,
  runDeletionBatch,
  togglePinnedScanLocation,
  uniqueDeletionRoots,
  withoutDeletedNodes,
} from "./storage"
import { computeReclaim } from "./recognize"
import { buildCrumbs } from "./navigation"

const root: DiskScanNode = {
  name: "System",
  path: "/",
  size: 60,
  isDir: true,
  children: [],
  ext: "",
}

const drive: DiskDriveInfo = {
  path: "/",
  name: "System",
  label: "System (/)",
  total: 200,
  free: 100,
  used: 100,
  type: "local",
}

describe("includeHiddenSpace", () => {
  it("withholds physical reclaim claims until clone capability and shared-storage visibility are verified", () => {
    expect(isPhysicalByteAccounting("macos", drive)).toBe(true)
    expect(isPhysicalByteAccounting("macos")).toBe(true)
    expect(isPhysicalByteAccounting("linux")).toBe(true)
    expect(isPhysicalByteAccounting("windows", drive)).toBe(false)
    expect(isPhysicalByteAccounting("windows")).toBe(false)
    expect(isPhysicalByteAccounting("macos", { ...drive, type: "network" })).toBe(false)
    expect(isPhysicalByteAccounting("linux", { ...drive, type: "network" })).toBe(false)
    expect(hasUnverifiedPhysicalCloneAccounting({ ...root }, "macos")).toBe(true)
    expect(hasUnverifiedPhysicalCloneAccounting({ ...root }, "linux")).toBe(true)
    expect(hasUnverifiedPhysicalCloneAccounting({ ...root }, "macos", drive)).toBe(true)
    expect(hasUnverifiedPhysicalCloneAccounting({ ...root, cloneMetadata: { state: "unknown" } }, "macos", drive)).toBe(true)
    expect(hasUnverifiedPhysicalCloneAccounting({ ...root, cloneMetadata: { state: "available" } }, "macos", drive)).toBe(true)
    expect(
      hasUnverifiedPhysicalCloneAccounting(
        { ...root, cloneMetadata: { state: "available" }, sharedStorageEvidence: "partial" },
        "macos",
        drive,
      ),
    ).toBe(true)
    expect(
      hasUnverifiedPhysicalCloneAccounting(
        { ...root, cloneMetadata: { state: "available" }, sharedStorageEvidence: "complete" },
        "macos",
        drive,
      ),
    ).toBe(false)
    expect(hasUnverifiedPhysicalCloneAccounting({ ...root }, "windows", drive)).toBe(false)
  })

  it("toggles a bounded pinned-scan list with native path equality and no silent eviction", () => {
    const initial = [{ path: "C:\\Code\\App", label: "App" }]
    expect(isPinnedScanLocation(initial, "c:\\code\\app\\", "windows")).toBe(true)
    expect(togglePinnedScanLocation(initial, { path: "c:\\CODE\\app", label: "Duplicate" }, "windows")).toEqual([])

    const locations = Array.from({ length: 12 }, (_, index) => ({ path: `/work/${index}`, label: `${index}` }))
    const next = togglePinnedScanLocation(locations, { path: "/work/latest", label: "  Latest  " }, "linux")
    expect(next).toEqual(locations)

    expect(togglePinnedScanLocation([], { path: "/work/latest", label: "  Latest  " }, "linux")).toEqual([
      { path: "/work/latest", label: "Latest" },
    ])
  })

  it("wraps a dropped file in a navigable one-item landscape", () => {
    const file = {
      ...root,
      path: "/home/alex/video.mov",
      name: "video.mov",
      isDir: false,
      size: 25,
      cloneMetadata: { state: "available" as const },
      sharedStorageEvidence: "complete" as const,
    }
    const result = asBrowseableRoot(file)

    expect(result).toMatchObject({
      name: "Selected file",
      size: 25,
      isDir: true,
      cloneMetadata: { state: "available" },
      sharedStorageEvidence: "complete",
    })
    expect(result.children).toEqual([file])
    expect(asBrowseableRoot(root)).toBe(root)
  })

  it("adds the unaccounted difference without mutating the scanned tree", () => {
    const result = includeHiddenSpace(root, drive)

    expect(result).not.toBe(root)
    expect(root.size).toBe(60)
    expect(result.size).toBe(100)
    expect(result.children[0]).toMatchObject({ name: "Hidden space", size: 40, isHidden: true, isOther: true })
    expect(canActOnNode(result.children[0])).toBe(false)
  })

  it("does not invent hidden space for folder scans or stale smaller drive totals", () => {
    expect(includeHiddenSpace(root)).toBe(root)
    expect(includeHiddenSpace(root, { ...drive, used: 50 })).toBe(root)
    expect(includeHiddenSpace({ ...root, path: "/Users/alex/project" }, drive)).toMatchObject({ size: 60 })
  })

  it("expands a focused subtree without losing ancestors or mutating the original scan", () => {
    const collapsed = {
      ...root,
      name: "target",
      path: "/work/app/target",
      size: 40,
      modifiedAt: 20,
      isCollapsed: true,
    }
    const sibling = { ...root, name: "src", path: "/work/app/src", size: 60, modifiedAt: 30 }
    const project = { ...root, name: "app", path: "/work/app", size: 100, children: [collapsed, sibling] }
    const expanded = {
      ...collapsed,
      size: 55,
      modifiedAt: 50,
      isCollapsed: undefined,
      children: [{ ...root, name: "debug", path: "/work/app/target/debug", size: 55, modifiedAt: 50 }],
    }

    const result = replaceScanSubtree(project, collapsed.path, expanded, "linux")

    expect(result).not.toBe(project)
    expect(project.children[0]).toBe(collapsed)
    expect(result).toMatchObject({ name: "app", path: "/work/app", size: 115, modifiedAt: 50 })
    expect(result.children.map((child) => child.name)).toEqual(["src", "target"])
    expect(result.children[1]).toBe(expanded)
    expect(buildCrumbs(result, expanded).map((crumb) => crumb.name)).toEqual(["app", "target"])
  })

  it("matches focused Windows paths case-insensitively and leaves missing paths untouched", () => {
    const collapsed = { ...root, name: "node_modules", path: "C:\\Code\\App\\node_modules", isCollapsed: true }
    const project = { ...root, path: "C:\\Code\\App", children: [collapsed] }
    const expanded = { ...collapsed, isCollapsed: undefined, children: [{ ...root, name: "pkg", path: "pkg" }] }

    expect(replaceScanSubtree(project, "c:\\code\\app\\NODE_MODULES", expanded, "windows").children[0]).toBe(expanded)
    expect(replaceScanSubtree(project, "C:\\Code\\Missing", expanded, "windows")).toBe(project)
  })

  it("keeps scan-boundary metadata root-only when a focused subtree is grafted into the map", () => {
    const inventory: DeveloperArtifactInventory = {
      items: [],
      status: {
        state: "complete",
        maxItems: 2_000,
        scannedDirectories: 1,
        matchedDirectories: 0,
        truncated: false,
        unreadableCount: 0,
        unreadableSamplePaths: [],
        skippedSymlinkCount: 0,
        skippedSymlinkSamplePaths: [],
        excludedCount: 0,
        excludedSamplePaths: [],
      },
    }
    const collapsed = { ...root, name: "target", path: "/work/app/target", isCollapsed: true }
    const project: DiskScanNode = {
      ...root,
      name: "app",
      path: "/work/app",
      children: [collapsed],
      developerArtifactInventory: inventory,
      cloneMetadata: { state: "available" },
      sharedStorageEvidence: "complete",
    }
    const focusedInventory: DeveloperArtifactInventory = { ...inventory, status: { ...inventory.status } }
    const expanded: DiskScanNode = {
      ...collapsed,
      isCollapsed: undefined,
      developerArtifactInventory: focusedInventory,
      cloneMetadata: { state: "available" },
      sharedStorageEvidence: "complete",
    }

    const result = replaceScanSubtree(project, collapsed.path, expanded, "linux")

    expect(result.developerArtifactInventory).toBe(inventory)
    expect(result.cloneMetadata).toEqual({ state: "available" })
    expect(result.sharedStorageEvidence).toBe("partial")
    expect(hasUnverifiedPhysicalCloneAccounting(result, "linux")).toBe(true)
    expect(result.children[0].developerArtifactInventory).toBeUndefined()
    expect(result.children[0].cloneMetadata).toBeUndefined()
    expect(result.children[0].sharedStorageEvidence).toBeUndefined()
  })

  it("keeps complete physical evidence when the authoritative scan root itself is replaced", () => {
    const replacement: DiskScanNode = {
      ...root,
      cloneMetadata: { state: "available" },
      sharedStorageEvidence: "complete",
    }

    expect(replaceScanSubtree(root, root.path, replacement, "linux")).toBe(replacement)
  })

  it("reconciles apparent bytes when focused subtrees change or are removed", () => {
    const sparse = {
      ...root,
      name: "sparse.img",
      path: "/work/sparse.img",
      size: 10,
      logicalSize: 100,
      isDir: false,
    }
    const sibling = { ...root, name: "docs", path: "/work/docs", size: 30, logicalSize: 40 }
    const project = { ...root, name: "work", path: "/work", size: 40, logicalSize: 140, children: [sparse, sibling] }
    const expanded = { ...sparse, size: 20, logicalSize: 160 }

    const replaced = replaceScanSubtree(project, sparse.path, expanded, "linux")
    expect(replaced).toMatchObject({ size: 50, logicalSize: 200 })

    const removed = removeScanSubtrees(project, [sparse], "linux")!
    expect(removed).toMatchObject({ size: 30, logicalSize: 40, children: [sibling] })
  })

  it("removes confirmed subtrees and updates every ancestor without mutating unaffected branches", () => {
    const cache = { ...root, name: ".cache", path: "/home/alex/.cache", size: 40, modifiedAt: 20 }
    const downloads = { ...root, name: "Downloads", path: "/home/alex/Downloads", size: 60, modifiedAt: 30 }
    const home = { ...root, name: "alex", path: "/home/alex", size: 100, children: [cache, downloads] }
    const filesystem = { ...root, path: "/", size: 120, children: [home, { ...root, path: "/var", size: 20 }] }

    const result = removeScanSubtrees(filesystem, [cache], "linux")!

    expect(filesystem.children[0]).toBe(home)
    expect(result).toMatchObject({ path: "/", size: 80, modifiedAt: 30 })
    expect(result.children[0]).not.toBe(home)
    expect(result.children[0]).toMatchObject({ path: "/home/alex", size: 60, children: [downloads] })
    expect(result.children[1]).toBe(filesystem.children[1])
  })

  it("removes Windows parents once, including nested selections, and can remove the scan root", () => {
    const child = { ...root, path: "C:\\Code\\App\\target\\debug", size: 30 }
    const target = { ...root, path: "C:\\Code\\App\\target", size: 30, children: [child] }
    const project = { ...root, path: "C:\\Code\\App", size: 50, children: [target] }

    expect(removeScanSubtrees(project, [{ ...target, path: "c:\\code\\app\\TARGET" }, child], "windows")).toMatchObject(
      {
        path: "C:\\Code\\App",
        size: 20,
        children: [],
      },
    )
    expect(removeScanSubtrees(project, [project], "windows")).toBeNull()
    expect(removeScanSubtrees(project, [{ ...root, path: "C:\\Missing" }], "windows")).toBe(project)
  })

  it("matches chosen folders to their deepest containing local or network volume", () => {
    const archive = { ...drive, path: "/Volumes/Archive", name: "Archive", type: "network" as const }
    expect(driveForPath("/Volumes/Archive/projects/app", [drive, archive], "macos")).toBe(archive)
    expect(
      driveForPath("z:\\team\\project", [{ ...drive, path: "Z:\\", name: "Team", type: "network" }], "windows")?.name,
    ).toBe("Team")
  })

  it("keeps protected OS paths visible but non-actionable", () => {
    expect(canActOnNode({ ...root, path: "/System/Library" }, "macos")).toBe(false)
    expect(canActOnNode({ ...root, path: "C:\\Windows\\System32" }, "windows")).toBe(false)
    expect(canActOnNode({ ...root, path: "/Users/alex" }, "macos")).toBe(false)
    expect(canActOnNode({ ...root, path: "/home/alex" }, "linux")).toBe(false)
    expect(canActOnNode({ ...root, path: "C:\\Users\\Alex" }, "windows")).toBe(false)
    expect(canActOnNode({ ...root, path: "/home/alex/Downloads" }, "linux")).toBe(true)
    expect(
      canActOnNode({ ...root, path: "/home/alex/xai/node_modules" }, "linux", [{ path: "/home/alex/xai", label: "xai" }]),
    ).toBe(false)
    expect(canActOnNode({ ...root, path: "/home/alex/scratch/cache" }, "linux", [{ path: "/home/alex/xai", label: "xai" }])).toBe(
      true,
    )
  })

  it("does not advertise recognized cleanup inside protected operating-system paths", () => {
    const protectedLogs = { ...root, name: "log", path: "/var/log", size: 100 }
    const userLogs = { ...root, name: "Logs", path: "/home/alex/Logs", size: 5 }
    const userCache = { ...root, name: ".cache", path: "/home/alex/.cache", size: 40 }
    const summary = actionableReclaimSummary(
      computeReclaim({ ...root, size: 145, children: [protectedLogs, userLogs, userCache] }),
      "linux",
    )

    expect(summary).toMatchObject({ totalBytes: 45, totalCount: 2 })
    expect(summary.buckets.map((bucket) => bucket.bytes)).toEqual([40, 5])
    expect(summary.buckets.flatMap((bucket) => bucket.items.map((item) => item.node.path))).toEqual([
      "/home/alex/.cache",
      "/home/alex/Logs",
    ])
  })

  it("removes clone-shared paths from the actionable reclaim total", () => {
    const clone = {
      ...root,
      name: "cache.bin",
      path: "/home/alex/.cache/cache.bin",
      size: 100,
      isDir: false,
      clone: { state: "shares-all-blocks" as const, cloneId: "clone-1", reportedFullCloneCount: 2 },
      cloneAccounting: "primary" as const,
    }
    const cache = { ...root, name: ".cache", path: "/home/alex/.cache", size: 100, children: [clone] }

    expect(actionableReclaimSummary(computeReclaim({ ...root, size: 100, children: [cache] }), "linux")).toEqual({
      totalBytes: 0,
      totalCount: 0,
      buckets: [],
    })
  })

  it("removes hard-link-shared paths from the actionable reclaim total", () => {
    const linked = {
      ...root,
      name: "cache.bin",
      path: "/home/alex/.cache/cache.bin",
      size: 100,
      isDir: false,
      hardLink: "primary" as const,
    }
    const cache = { ...root, name: ".cache", path: "/home/alex/.cache", size: 100, children: [linked] }

    expect(actionableReclaimSummary(computeReclaim({ ...root, size: 100, children: [cache] }), "linux")).toEqual({
      totalBytes: 0,
      totalCount: 0,
      buckets: [],
    })
  })

  it("collapses nested collection items into one deletion root", () => {
    const parent = { ...root, path: "/Users/alex/Downloads", size: 100 }
    const child = { ...root, path: "/Users/alex/Downloads/archive", size: 60 }
    const sibling = { ...root, path: "/Users/alex/Desktop/video.mov", size: 80 }

    expect(uniqueDeletionRoots([child, sibling, parent], "macos")).toEqual([parent, sibling])
    expect(
      uniqueDeletionRoots(
        [
          { ...child, path: "C:\\Users\\Alex\\Downloads\\archive" },
          { ...parent, path: "c:\\users\\alex\\downloads" },
        ],
        "windows",
      ),
    ).toHaveLength(1)
  })

  it("deduplicates large collections without pairwise root comparisons", () => {
    const parent = { ...root, path: "/home/alex/project", size: 100 }
    const nodes = Array.from({ length: 4_000 }, (_, index) => ({
      ...root,
      path: `/home/alex/cache-${index}`,
      size: index,
    }))
    const result = uniqueDeletionRoots([...nodes, { ...root, path: "/home/alex/project/target" }, parent], "linux")

    expect(result).toHaveLength(4_001)
    expect(result).toContain(parent)
  })

  it("removes stale collected descendants after a parent is deleted", () => {
    const parent = { ...root, path: "C:\\Users\\Alex\\project", size: 100 }
    const child = { ...root, path: "c:\\users\\alex\\project\\node_modules", size: 60 }
    const sibling = { ...root, path: "C:\\Users\\Alex\\other", size: 80 }

    expect(withoutDeletedNodes([child, sibling], [parent], "windows")).toEqual([sibling])
  })

  it("continues a batch after one native deletion fails", async () => {
    const first = { ...root, path: "/home/alex/first", size: 10 }
    const second = { ...root, path: "/home/alex/second", size: 20 }
    const calls: string[] = []
    const result = await runDeletionBatch(
      [first, second],
      async (node) => {
        calls.push(node.path)
        if (node === first) throw new Error("busy")
      },
      "linux",
    )

    expect(calls).toEqual([first.path, second.path])
    expect(result.removed).toEqual([second])
    expect(result.failed).toEqual([{ node: first, error: new Error("busy") }])
  })

  it("skips user-locked trees in a deletion batch", async () => {
    const locked = { ...root, path: "/home/alex/xai/node_modules", size: 40 }
    const open = { ...root, path: "/home/alex/scratch/cache", size: 12 }
    const calls: string[] = []
    const result = await runDeletionBatch(
      [locked, open],
      async (node) => {
        calls.push(node.path)
      },
      "linux",
      [{ path: "/home/alex/xai", label: "xai" }],
    )

    expect(calls).toEqual([open.path])
    expect(result.removed).toEqual([open])
    expect(result.failed).toEqual([])
  })
})
