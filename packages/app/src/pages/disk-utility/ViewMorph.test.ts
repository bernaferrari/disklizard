import { describe, it, expect } from "bun:test"
import type { DiskScanNode } from "./types"
import { quadPoint, rectCorners, ViewMorph, wedgeCorners, type MorphPose, type MorphTile } from "./ViewMorph"

const TAU = Math.PI * 2

const node = (name: string): DiskScanNode => ({ name, path: `/${name}`, size: 10, isDir: true, children: [], ext: "" })

const pose = (wedgeStart: number, wedgeEnd: number): MorphPose => ({
  wedge: { start: wedgeStart, end: wedgeEnd, inner: 100, outer: 200 },
  rect: { x: 10, y: 20, w: 300, h: 150 },
})

describe("wedgeCorners", () => {
  it("orders corners inner@start, inner@end, outer@end, outer@start", () => {
    const [innerStart, innerEnd, outerEnd, outerStart] = wedgeCorners(
      { start: 0, end: Math.PI / 2, inner: 100, outer: 200 },
      0,
      0,
    )
    expect(innerStart[0]).toBeCloseTo(100)
    expect(innerStart[1]).toBeCloseTo(0)
    expect(innerEnd[0]).toBeCloseTo(0)
    expect(innerEnd[1]).toBeCloseTo(100)
    expect(outerEnd[0]).toBeCloseTo(0)
    expect(outerEnd[1]).toBeCloseTo(200)
    expect(outerStart[0]).toBeCloseTo(200)
    expect(outerStart[1]).toBeCloseTo(0)
  })
  it("translates by the wheel center", () => {
    const [c] = wedgeCorners({ start: -Math.PI / 2, end: 0, inner: 50, outer: 50 }, 30, -40)
    expect(c[0]).toBeCloseTo(30)
    expect(c[1]).toBeCloseTo(-90)
  })
  it("wraps angles past 2π onto the same ray", () => {
    const [a] = wedgeCorners({ start: 0, end: 0, inner: 80, outer: 80 }, 0, 0)
    const [b] = wedgeCorners({ start: TAU, end: TAU, inner: 80, outer: 80 }, 0, 0)
    expect(a[0]).toBeCloseTo(b[0])
    expect(a[1]).toBeCloseTo(b[1])
  })
})

describe("rectCorners", () => {
  it("orders corners TL, TR, BR, BL", () => {
    const [tl, tr, br, bl] = rectCorners({ x: 10, y: 20, w: 300, h: 150 })
    expect(tl).toEqual([10, 20])
    expect(tr).toEqual([310, 20])
    expect(br).toEqual([310, 170])
    expect(bl).toEqual([10, 170])
  })
})

describe("quadPoint", () => {
  const p0: [number, number] = [0, 0]
  const pc: [number, number] = [50, 120]
  const p1: [number, number] = [200, 40]
  it("is exact at both endpoints", () => {
    expect(quadPoint(p0, pc, p1, 0)).toEqual([0, 0])
    expect(quadPoint(p0, pc, p1, 1)).toEqual([200, 40])
  })
  it("weights the control point half at the midpoint", () => {
    const mid = quadPoint(p0, pc, p1, 0.5)
    expect(mid[0]).toBeCloseTo(0.25 * 0 + 0.5 * 50 + 0.25 * 200)
    expect(mid[1]).toBeCloseTo(0.25 * 0 + 0.5 * 120 + 0.25 * 40)
  })
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

  function countingCtx(): CanvasRenderingContext2D {
    return new Proxy({} as CanvasRenderingContext2D, {
      get(target, property, receiver) {
        if (property === "clearRect") {
          return () => {
            clearRectCount++
            drawsThisFrame++
          }
        }
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
    })) as typeof getComputedStyle
    globals.window = { devicePixelRatio: 1 }
    const centerCalls: Array<{ cx: number; cy: number; maxR: number }> = []
    const morph = new ViewMorph(
      { width: 64, height: 64 } as HTMLCanvasElement,
      countingCtx(),
      () => {
        const center = { cx: 32, cy: 32, maxR: 30 }
        centerCalls.push(center)
        return center
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
    return { morph, clock, centerCalls, restore }
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
      expect(clock.tick(200)).toBe(1)
      expect(completions).toEqual(["a", "b", "c"])
      expect(clock.pending).toBe(0)
      expect(morph.active).toBe(false)
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
  it("consults the live center each frame so a resize retargets mid-flight", () => {
    const { morph, clock, centerCalls, restore } = harness()
    try {
      morph.play(tiles(), "toGrid", () => undefined)
      clock.tick(100)
      const consultedAfterFirstFrame = centerCalls.length
      clock.tick(100)
      clock.tick(100)
      // One getCenter read per drawn frame — never a cached pose.
      expect(centerCalls.length).toBeGreaterThanOrEqual(consultedAfterFirstFrame + 2)
      expect(morph.active).toBe(true)
      clock.tick(600)
      expect(morph.active).toBe(false)
    } finally {
      restore()
    }
  })
})
