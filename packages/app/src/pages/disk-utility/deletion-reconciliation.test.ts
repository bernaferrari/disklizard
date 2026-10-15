import { expect, test } from "bun:test"
import { reconcileDeletedMaps } from "./deletion-reconciliation"
import { EMPTY_DISK_BROWSE_HISTORY } from "./browse-history"
import type { VolumeScanJob } from "./scan-jobs"
import type { ScanTab } from "./scan-tabs"
import type { DiskScanNode } from "./types"

function node(path: string, children: DiskScanNode[] = []): DiskScanNode {
  return {
    name: path.split("/").pop()!,
    path,
    size: children.length
      ? children.reduce((total, child) => total + child.size, 0)
      : 10,
    isDir: true,
    children,
    ext: "",
  }
}
function tab(tree: DiskScanNode, view = tree): ScanTab {
  return {
    id: "parked",
    sessionID: "parked-scan",
    label: tree.name,
    sourcePath: tree.path,
    tree,
    view,
    browseHistory: { past: [tree.path], current: view.path, future: [] },
  }
}
function job(id: string, tree?: DiskScanNode): VolumeScanJob {
  return {
    id,
    label: id,
    sourcePath: tree?.path ?? "/pending",
    tree,
    status: tree ? "complete" : "scanning",
    drive: {
      path: "/",
      name: "disk",
      label: "disk",
      total: 100,
      free: 50,
      used: 50,
      type: "local",
    },
    files: 1,
    bytes: tree?.size ?? 0,
    pct: tree ? 100 : 0,
    currentPath: "",
    startedAt: 0,
  }
}

test("confirmed removal patches active, parked and volume maps without resurrecting the removed view", () => {
  const removed = node("/work/build")
  const survivor = node("/work/src")
  const root = node("/work", [removed, survivor])
  const plan = reconcileDeletedMaps(
    {
      root,
      view: removed,
      tabs: [tab(root, removed)],
      jobs: [job("volume", root)],
      collection: [removed, survivor],
    },
    [removed],
    "linux"
  )
  expect(plan.kind).toBe("patch")
  if (plan.kind !== "patch") throw new Error("expected patch")
  expect(plan.root?.children.map((child) => child.path)).toEqual([
    survivor.path,
  ])
  expect(plan.view?.path).toBe(root.path)
  expect(plan.tabs[0].view.path).toBe(root.path)
  expect(plan.tabs[0].browseHistory).toEqual({
    ...EMPTY_DISK_BROWSE_HISTORY,
    current: root.path,
  })
  expect(plan.jobs[0].tree?.children.map((child) => child.path)).toEqual([
    survivor.path,
  ])
  expect(plan.jobs[0].bytes).toBe(survivor.size)
  expect(plan.collection).toEqual([survivor])
  expect(root.children).toEqual([removed, survivor])
})

test("removing a whole retained root drops its volume card and releases every removed session", () => {
  const root = node("/work")
  const plan = reconcileDeletedMaps(
    {
      root,
      view: root,
      tabs: [tab(root)],
      jobs: [job("volume", root)],
      collection: [root],
    },
    [root],
    "linux"
  )
  expect(plan.kind).toBe("patch")
  if (plan.kind !== "patch") throw new Error("expected patch")
  expect(plan.root).toBeNull()
  expect(plan.tabs).toEqual([])
  expect(plan.jobs).toEqual([])
  expect(plan.collection).toEqual([])
  expect(plan.invalidatedJobIDs).toEqual(["volume"])
  expect(plan.releaseSessionIDs).toEqual(["parked-scan", "volume"])
})

test("shared allocation invalidates all completed maps while preserving an in-flight scan", () => {
  const shared = {
    ...node("/work/cache"),
    clone: { state: "may-share-blocks" as const },
  }
  const root = node("/work", [shared])
  const unrelated = node("/elsewhere")
  const pending = job("pending")
  const plan = reconcileDeletedMaps(
    {
      root,
      view: root,
      tabs: [tab(unrelated)],
      jobs: [job("complete", unrelated), pending],
      collection: [unrelated],
    },
    [shared],
    "macos"
  )
  expect(plan.kind).toBe("rescan")
  expect(plan.collection).toEqual([])
  expect(plan.tabs).toEqual([])
  expect(plan.jobs).toEqual([pending])
  expect(plan.invalidatedJobIDs).toEqual(["complete"])
  expect(plan.releaseSessionIDs).toEqual(["parked-scan", "complete"])
})
