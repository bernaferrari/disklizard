import { describe, expect, it } from "bun:test"
import { EMPTY_DISK_BROWSE_HISTORY, resolveDiskBrowseHistoryMove, transitionDiskBrowseHistory } from "./browse-history"

describe("disk browse history", () => {
  it("resets and records visits without duplicating the current path", () => {
    const root = transitionDiskBrowseHistory(EMPTY_DISK_BROWSE_HISTORY, { type: "reset", path: "/" })
    const folder = transitionDiskBrowseHistory(root, { type: "visit", path: "/folder" })

    expect(folder).toEqual({ past: ["/"], current: "/folder", future: [] })
    expect(transitionDiskBrowseHistory(folder, { type: "visit", path: "/folder" })).toBe(folder)
    expect(transitionDiskBrowseHistory(folder, { type: "reset" })).toBe(EMPTY_DISK_BROWSE_HISTORY)
  })

  it("moves backward and forward while preserving both trails", () => {
    let history = transitionDiskBrowseHistory(EMPTY_DISK_BROWSE_HISTORY, { type: "visit", path: "/" })
    history = transitionDiskBrowseHistory(history, { type: "visit", path: "/a" })
    history = transitionDiskBrowseHistory(history, { type: "visit", path: "/a/b" })
    history = transitionDiskBrowseHistory(history, { type: "back" })
    history = transitionDiskBrowseHistory(history, { type: "back" })

    expect(history).toEqual({ past: [], current: "/", future: ["/a", "/a/b"] })
    history = transitionDiskBrowseHistory(history, { type: "forward" })
    expect(history).toEqual({ past: ["/"], current: "/a", future: ["/a/b"] })
  })

  it("clears the forward branch after a new visit", () => {
    let history = transitionDiskBrowseHistory(EMPTY_DISK_BROWSE_HISTORY, { type: "visit", path: "/" })
    history = transitionDiskBrowseHistory(history, { type: "visit", path: "/old" })
    history = transitionDiskBrowseHistory(history, { type: "back" })
    history = transitionDiskBrowseHistory(history, { type: "visit", path: "/new" })

    expect(history).toEqual({ past: ["/"], current: "/new", future: [] })
    expect(transitionDiskBrowseHistory(history, { type: "forward" })).toBe(history)
  })

  it("bounds both directions to the configured memory budget", () => {
    let history = transitionDiskBrowseHistory(EMPTY_DISK_BROWSE_HISTORY, { type: "visit", path: "/0" })
    for (let index = 1; index <= 5; index++) {
      history = transitionDiskBrowseHistory(history, { type: "visit", path: `/${index}` }, { limit: 2 })
    }
    expect(history).toEqual({ past: ["/3", "/4"], current: "/5", future: [] })

    history = transitionDiskBrowseHistory(history, { type: "back" }, { limit: 2 })
    history = transitionDiskBrowseHistory(history, { type: "back" }, { limit: 2 })
    expect(history).toEqual({ past: [], current: "/3", future: ["/4", "/5"] })
  })

  it("accepts platform-aware path equality and rejects invalid budgets", () => {
    const history = transitionDiskBrowseHistory(EMPTY_DISK_BROWSE_HISTORY, { type: "visit", path: "C:\\Work" })
    expect(
      transitionDiskBrowseHistory(
        history,
        { type: "visit", path: "c:\\work" },
        { equals: (left, right) => left.toLowerCase() === right.toLowerCase() },
      ),
    ).toBe(history)
    expect(() => transitionDiskBrowseHistory(history, { type: "back" }, { limit: 0 })).toThrow(RangeError)
  })

  it("skips destinations removed by a watcher without reviving stale state", () => {
    const history = { past: ["/", "/removed", "/also-removed"], current: "/current", future: ["/gone", "/next"] }
    const available = new Set(["/", "/current", "/next"])

    const back = resolveDiskBrowseHistoryMove(history, "back", (path) => available.has(path))
    expect(back).toEqual({ past: [], current: "/", future: ["/current", "/gone", "/next"] })

    const forward = resolveDiskBrowseHistoryMove(history, "forward", (path) => available.has(path))
    expect(forward).toEqual({ past: ["/", "/removed", "/also-removed", "/current"], current: "/next", future: [] })
  })

  it("prunes an exhausted stale direction while leaving the current location unchanged", () => {
    const history = { past: ["/gone"], current: "/current", future: ["/also-gone"] }
    expect(resolveDiskBrowseHistoryMove(history, "back", () => false)).toEqual({
      past: [],
      current: "/current",
      future: ["/also-gone"],
    })
    expect(resolveDiskBrowseHistoryMove(history, "forward", () => false)).toEqual({
      past: ["/gone"],
      current: "/current",
      future: [],
    })
  })
})
