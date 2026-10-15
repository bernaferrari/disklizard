import { expect, test } from "bun:test"
import { EMPTY_SCAN_WORKSPACE, transitionScanWorkspace } from "./scan-workspace"
import type { DiskScanNode } from "./types"

function tree(path: string): DiskScanNode {
  return { name: path, path, size: 1, isDir: true, children: [], ext: "" }
}

test("a superseded scan cannot replace an opened retained map", () => {
  const started = transitionScanWorkspace(EMPTY_SCAN_WORKSPACE, {
    type: "begin",
    id: "old",
    location: { label: "old", sourcePath: "/old" },
  })
  const root = tree("/retained")
  const opened = transitionScanWorkspace(started, {
    type: "open",
    scan: {
      root,
      node: root,
      activeID: "retained",
      sourcePath: root.path,
      label: "retained",
    },
  })
  expect(
    transitionScanWorkspace(opened, {
      type: "complete",
      id: "old",
      root: tree("/old"),
    })
  ).toBe(opened)
  expect(transitionScanWorkspace(opened, { type: "fail", id: "old" })).toBe(
    opened
  )
  expect(transitionScanWorkspace(opened, { type: "finish", id: "old" })).toBe(
    opened
  )
})

test("focused cancellation keeps the trusted root and active watcher identity", () => {
  const root = tree("/work")
  const ready = transitionScanWorkspace(EMPTY_SCAN_WORKSPACE, {
    type: "open",
    scan: {
      root,
      node: root,
      activeID: "root",
      sourcePath: root.path,
      label: "work",
    },
  })
  const expanding = transitionScanWorkspace(ready, {
    type: "expand",
    id: "child",
    label: "cache",
  })
  const cancelled = transitionScanWorkspace(expanding, {
    type: "cancel",
    id: "child",
  })
  expect(cancelled).toEqual(ready)
  expect(
    transitionScanWorkspace(cancelled, {
      type: "complete",
      id: "child",
      root: tree("/stale"),
    })
  ).toBe(cancelled)
})

test("root replacement clears the old tree atomically and commits only the matching request", () => {
  const old = tree("/old")
  const ready = transitionScanWorkspace(EMPTY_SCAN_WORKSPACE, {
    type: "open",
    scan: {
      root: old,
      node: old,
      activeID: "old",
      sourcePath: old.path,
      label: "old",
    },
  })
  const started = transitionScanWorkspace(ready, {
    type: "begin",
    id: "new",
    location: { sourcePath: "/new", label: "new" },
  })
  expect(started.phase).toBe("scanning")
  expect(started.root).toBeNull()
  expect(started.node).toBeNull()
  expect(started.activeID).toBe("new")
  const root = tree("/new")
  const completed = transitionScanWorkspace(started, {
    type: "complete",
    id: "new",
    root,
  })
  expect(completed.phase).toBe("ready")
  expect(completed.root).toBe(root)
  expect(completed.node).toBe(root)
  expect(completed.foregroundID).toBeUndefined()
  expect(
    transitionScanWorkspace(completed, { type: "finish", id: "new" })
  ).toBe(completed)
})
