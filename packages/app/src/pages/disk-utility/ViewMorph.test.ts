import { describe, it, expect } from "bun:test"
import type { DiskScanNode } from "./types"
import { ViewMorph, type MorphPose, type MorphTile } from "./ViewMorph"

const node = (name: string): DiskScanNode => ({ name, path: `/${name}`, size: 10, isDir: true, children: [], ext: "" })

const pose = (wedgeStart: number, wedgeEnd: number): MorphPose => ({
  wedge: { start: wedgeStart, end: wedgeEnd, inner: 100, outer: 200 },
  rect: { x: 10, y: 20, w: 300, h: 150 },
})

describe("MorphTile poses", () => {
  it("round-trip through from/to without mutation", () => {
    const from = pose(0, 1)
    const to = pose(2, 3)
    const tile: MorphTile = { path: "/big", node: node("big"), colorIndex: 4, from, to }
    // Reverse direction is the caller swapping from/to — poses must survive intact.
    const swapped: MorphTile = { ...tile, from: to, to: from }
    expect(swapped.from.wedge.start).toBe(2)
    expect(swapped.to.rect.x).toBe(10)
    expect(tile.from.wedge.inner).toBe(100)
    expect(tile.colorIndex).toBe(4)
    expect(tile.node.name).toBe("big")
  })
})

describe("ViewMorph lifecycle", () => {
  /**
   * rAF-style clock: callbacks scheduled during a tick run on the next tick,
   * mirroring the browser. `pending` is the live frame-chain count.
   */
  class FrameClock {
    private queue = new Map<number, (now: number) => void>()
    private nextId = 1
    now = 0
    readonly request = (callback: (now: number) => void): number => {
      const id = this.nextId++
      this.queue.set(id, callback)
      return id
    }
    readonly cancel = (id: number): void => {
      this.queue.delete(id)
    }
    get pending(): number {
      return this.queue.size
    }
    pendingCallbacks(): Array<(now: number) => void> {
      return [...this.queue.values()]
    }
    tick(milliseconds: number): number {
      this.now += milliseconds
      const scheduled = [...this.queue.entries()]
      this.queue.clear()
      let draws = 0
      for (const [, callback] of scheduled) {
        const before = drawsThisFrame
        callback(this.now)
        if (drawsThisFrame > before) draws++
      }
      return draws
    }
  }

  let drawsThisFrame = 0
  let clearRectCount = 0
  let drawnPoints: number[][] = []

  function countingCtx(): CanvasRenderingContext2D {
    return new Proxy({} as CanvasRenderingContext2D, {
      get(target, property, receiver) {
        if (property === "clearRect") {
          return () => {
            clearRectCount++
            drawsThisFrame++
          }
        }
        if (property === "moveTo" || property === "lineTo") return (x: number, y: number) => drawnPoints.push([x, y])
        const value = Reflect.get(target, property, receiver)
        // The morph only calls ctx methods; stub every read as a no-op
        // function so property sets and calls both succeed.
        return typeof value === "function" || value === undefined ? () => undefined : value
      },
    })
  }

  function harness(options: { reducedMotion?: boolean } = {}) {
    const clock = new FrameClock()
    const previousRaf = globalThis.requestAnimationFrame
    const previousCancel = globalThis.cancelAnimationFrame
    const previousComputedStyle = globalThis.getComputedStyle
    // play() stamps performance.now(); route it through the synthetic clock
    // so flight progress is driven entirely by tick().
    const previousNow = performance.now.bind(performance)
    performance.now = () => clock.now
    // Bun has no DOM; the morph reads devicePixelRatio through `window`.
    const globals: { window?: unknown } = globalThis
    const previousWindow = globals.window
    globalThis.requestAnimationFrame = clock.request as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = clock.cancel as typeof cancelAnimationFrame
    globalThis.getComputedStyle = (() => ({
      getPropertyValue: () => "",
    })) as unknown as typeof getComputedStyle
    globals.window = { devicePixelRatio: 1 }
    const centerCalls: number = 0
    const center = { cx: 32, cy: 32, maxR: 30 }
    let centerReads = 0
    const morph = new ViewMorph(
      { width: 64, height: 64 } as HTMLCanvasElement,
      countingCtx(),
      () => {
        centerReads++
        return { ...center }
      },
      () => options.reducedMotion ?? false,
    )
    const restore = () => {
      globalThis.requestAnimationFrame = previousRaf
      globalThis.cancelAnimationFrame = previousCancel
      globalThis.getComputedStyle = previousComputedStyle
      performance.now = previousNow
      globals.window = previousWindow
    }
    return { morph, clock, restore, center, centerReads: () => centerReads, centerCalls }
  }

  const tiles = (): MorphTile[] => [
    {
      path: "/big",
      node: node("big"),
      colorIndex: 2,
      from: pose(0, 1),
      to: pose(2, 3),
    },
    {
      path: "/small",
      node: node("small"),
      colorIndex: 5,
      from: pose(1, 2),
      to: pose(3, 0.5),
    },
  ]

  it("rectangle layouts start at their real source instead of becoming arcs", () => {
    const { morph, clock, restore } = harness()
    try {
      const tile = tiles()[0]
      tile.from = { ...tile.from, shape: "rect", rect: { x: 2, y: 3, w: 12, h: 8 } }
      tile.to = { ...tile.to, shape: "rect", rect: { x: 20, y: 25, w: 30, h: 15 } }
      morph.play([tile], "toGrid", () => {})
      drawnPoints = []
      clock.tick(0)
      expect(drawnPoints.length).toBeGreaterThan(0)
      expect(drawnPoints.every(([x, y]) => x >= 2 && x <= 14 && y >= 3 && y <= 11)).toBe(true)
      clock.tick(240)
      expect(morph.active).toBe(false)
      expect(clock.pending).toBe(0)
    } finally { restore() }
  })

  it("restarts keep exactly one frame chain and fire each continuation once", () => {
    const { morph, clock, restore } = harness()
    try {
      const completions: string[] = []
      morph.play(tiles(), "toGrid", () => completions.push("a"))
      clock.tick(100)
      expect(clock.pending).toBe(1)

      // Interrupt mid-flight, then again before the second flight lands.
      morph.play(tiles(), "toMap", () => completions.push("b"))
      expect(completions).toEqual(["a"])
      expect(clock.pending).toBe(1)
      clock.tick(100)
      expect(clock.pending).toBe(1)
      morph.play(tiles(), "toGrid", () => completions.push("c"))
      expect(completions).toEqual(["a", "b"])
      expect(clock.pending).toBe(1)

      // Two interrupted flights must not have duplicated the frame chain:
      // exactly one draw per tick from here to landing.
      clock.tick(100)
      expect(clock.tick(100)).toBe(1)
      expect(clock.tick(100)).toBe(1)
      expect(clock.tick(200)).toBe(0)
      expect(completions).toEqual(["a", "b", "c"])
      expect(clock.pending).toBe(0)
      expect(morph.active).toBe(false)
    } finally {
      restore()
    }
  })

  it("a stale first-frame callback cannot hijack a newer flight", () => {
    const { morph, clock, restore } = harness()
    try {
      const completions: string[] = []
      morph.play(tiles(), "toGrid", () => completions.push("a"))
      const stale = clock.pendingCallbacks()[0]!
      clock.tick(16)

      morph.play(tiles(), "toMap", () => completions.push("b"))
      expect(completions).toEqual(["a"])

      // A browser that fires the cancelled callback anyway: the callback
      // carries flight a's generation and must neither draw nor reschedule
      // while claiming flight b's identity.
      const drawsBefore = clearRectCount
      const pendingBefore = clock.pending
      stale(clock.now + 16)

      expect(clearRectCount).toBe(drawsBefore)
      expect(clock.pending).toBe(pendingBefore)
      expect(morph.active).toBe(true)

      clock.tick(200)
      clock.tick(200)
      clock.tick(100)
      expect(completions).toEqual(["a", "b"])
      expect(clock.pending).toBe(0)
    } finally {
      restore()
    }
  })

  it("cancel drops the scheduled frame, completes once, and stops drawing", () => {
    const { morph, clock, restore } = harness()
    try {
      let completions = 0
      morph.play(tiles(), "toGrid", () => completions++)
      clock.tick(100)
      expect(clock.pending).toBe(1)

      morph.cancel()

      expect(completions).toBe(1)
      expect(clock.pending).toBe(0)
      expect(morph.active).toBe(false)
      const before = clearRectCount
      clock.tick(100)
      expect(clock.pending).toBe(0)
      expect(clearRectCount).toBe(before)
    } finally {
      restore()
    }
  })

  it("an empty flight first cancels whatever was airborne", () => {
    const { morph, clock, restore } = harness()
    try {
      const completions: string[] = []
      morph.play(tiles(), "toGrid", () => completions.push("airborne"))
      clock.tick(100)

      morph.play([], "toMap", () => completions.push("empty"))

      expect(completions).toEqual(["airborne", "empty"])
      expect(clock.pending).toBe(0)
      expect(morph.active).toBe(false)
    } finally {
      restore()
    }
  })

  it("abort releases the continuation without completing and leaves no frame", () => {
    const { morph, clock, restore } = harness()
    try {
      let completions = 0
      morph.play(tiles(), "toGrid", () => completions++)
      clock.tick(100)

      morph.abort()

      expect(completions).toBe(0)
      expect(clock.pending).toBe(0)
      expect(morph.active).toBe(false)
      clock.tick(500)
      expect(completions).toBe(0)
    } finally {
      restore()
    }
  })

  it("reduced motion lands on the first frame", () => {
    const { morph, clock, restore } = harness({ reducedMotion: true })
    try {
      let completions = 0
      morph.play(tiles(), "toGrid", () => completions++)
      expect(morph.active).toBe(true)

      clock.tick(16)

      expect(completions).toBe(1)
      expect(clock.pending).toBe(0)
      expect(morph.active).toBe(false)
    } finally {
      restore()
    }
  })

  it("retargets to a moved center each frame after a resize", () => {
    const { morph, clock, restore, center, centerReads } = harness()
    try {
      let completions = 0
      morph.play(tiles(), "toGrid", () => completions++)
      clock.tick(100)
      expect(centerReads()).toBeGreaterThan(0)

      // The window reshapes: the wheel moves. Later frames must consult the
      // new center rather than a cached pose, and the flight still lands.
      center.cx = 45
      center.cy = 21
      const readsAfterResize = centerReads()
      clock.tick(40)
      clock.tick(40)
      expect(centerReads()).toBeGreaterThan(readsAfterResize)
      expect(morph.active).toBe(true)
      clock.tick(600)
      expect(morph.active).toBe(false)
      expect(completions).toBe(1)
    } finally {
      restore()
    }
  })
})
