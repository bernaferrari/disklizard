import { describe, it, expect } from "bun:test"
import type { DiskScanNode } from "./types"
import { quadPoint, rectCorners, wedgeCorners, type MorphPose, type MorphTile } from "./ViewMorph"

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
