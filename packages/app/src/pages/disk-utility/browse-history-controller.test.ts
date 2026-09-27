import { describe, expect, it } from "bun:test"
import { createDiskBrowseHistoryController } from "./browse-history-controller"
import type { DiskScanNode } from "./types"

function node(path: string): DiskScanNode {
  return {
    name: path.split("/").at(-1) || "/",
    path,
    size: 1,
    isDir: true,
    ext: "",
    children: [],
  }
}

function setup(paths = ["/", "/a", "/b", "/c"]) {
  const available = new Map(paths.map((path) => [path, node(path)]))
  const moves: string[] = []
  let blocked = false
  const controller = createDiskBrowseHistoryController({
    equals: Object.is,
    resolve: (path) => available.get(path),
    onMove: (target) => moves.push(target.path),
    blocked: () => blocked,
  })
  return {
    available,
    controller,
    moves,
    setBlocked: (value: boolean) => (blocked = value),
  }
}

describe("disk browse history controller", () => {
  it("owns reset and visit transitions without duplicating equal paths", () => {
    const { controller } = setup()
    controller.reset("/")
    controller.visit("/a")
    controller.visit("/a")

    expect(controller.history()).toEqual({
      past: ["/"],
      current: "/a",
      future: [],
    })
  })

  it("reports only moves that resolve to a current scan node", () => {
    const { available, controller } = setup()
    controller.reset("/")
    controller.visit("/a")
    controller.visit("/b")
    available.delete("/a")

    expect(controller.canMove("back")).toBe(true)
    controller.move("back")

    expect(controller.history()).toEqual({
      past: [],
      current: "/",
      future: ["/b"],
    })
    available.delete("/b")
    expect(controller.canMove("forward")).toBe(false)
  })

  it("prunes stale destinations and calls onMove only for the surviving target", () => {
    const { available, controller, moves } = setup()
    controller.replace({ past: ["/", "/a"], current: "/b", future: ["/c"] })
    available.delete("/a")

    controller.move("back")
    expect(moves).toEqual(["/"])
    expect(controller.history()).toEqual({
      past: [],
      current: "/",
      future: ["/b", "/c"],
    })

    available.delete("/b")
    controller.move("forward")
    expect(moves).toEqual(["/", "/c"])
    expect(controller.history()).toEqual({
      past: ["/"],
      current: "/c",
      future: [],
    })
  })

  it("does not mutate or dispatch moves while blocked", () => {
    const { controller, moves, setBlocked } = setup()
    controller.replace({ past: ["/"], current: "/a", future: [] })
    setBlocked(true)

    controller.move("back")

    expect(controller.history()).toEqual({
      past: ["/"],
      current: "/a",
      future: [],
    })
    expect(moves).toEqual([])
  })
})
