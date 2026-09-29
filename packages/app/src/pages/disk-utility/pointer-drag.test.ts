import { describe, expect, test } from "bun:test"
import { trackPointerDrag } from "./pointer-drag"

function fire(type: string, x: number, y: number) {
  window.dispatchEvent(
    Object.assign(new Event(type, { cancelable: true }), {
      clientX: x,
      clientY: y,
      pointerId: 1,
    })
  )
}

function start(log: string[], threshold = 6) {
  return trackPointerDrag(
    {
      button: 0,
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      pointerType: "mouse",
      currentTarget: null,
    },
    {
      threshold,
      onStart: () => log.push("start"),
      onMove: (x) => log.push(`move:${x}`),
      onEnd: (x, _y, cancelled) => log.push(`end:${x}:${cancelled}`),
    }
  )
}

describe("trackPointerDrag", () => {
  test("stays quiet below the threshold", () => {
    const log: string[] = []
    start(log)
    fire("pointermove", 3, 0)
    fire("pointerup", 3, 0)
    expect(log).toEqual([])
  })

  test("starts, moves, and ends at the release point", () => {
    const log: string[] = []
    start(log)
    fire("pointermove", 10, 0)
    fire("pointermove", 20, 0)
    fire("pointerup", 25, 0)
    expect(log).toEqual(["start", "move:10", "move:20", "end:25:false"])
  })

  test("Escape cancels and later events are ignored", () => {
    const log: string[] = []
    start(log)
    fire("pointermove", 10, 0)
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    fire("pointermove", 30, 0)
    expect(log).toEqual(["start", "move:10", "end:10:true"])
  })

  test("the returned canceller ends an active drag exactly once", () => {
    const log: string[] = []
    const cancel = start(log)
    fire("pointermove", 10, 0)
    cancel()
    cancel()
    expect(log).toEqual(["start", "move:10", "end:10:true"])
  })

  test("swallows the click that follows a drag, but not the next one", async () => {
    const log: string[] = []
    let clicks = 0
    const listener = () => clicks++
    document.body.addEventListener("click", listener)
    start(log)
    fire("pointermove", 10, 0)
    fire("pointerup", 10, 0)
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(clicks).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 5))
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    expect(clicks).toBe(1)
    document.body.removeEventListener("click", listener)
  })
})
