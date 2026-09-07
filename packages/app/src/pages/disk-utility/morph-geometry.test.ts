import { describe, expect, it } from "bun:test"
import {
  anchorIndices,
  arcSegments,
  canvasFrameFor,
  frameRect,
  matchingRectPolygon,
  polygonArea,
  quadPoint,
  rectCorners,
  sectorPolygon,
  wedgeCorners,
  type Point,
} from "./morph-geometry"

const TAU = Math.PI * 2

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
  const p0: Point = [0, 0]
  const pc: Point = [50, 120]
  const p1: Point = [200, 40]
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

describe("canvas framing (map⇄tiles coordinate contract)", () => {
  // A wide landscape with a centered square canvas stage, the layout the
  // disk-utility surface actually renders.
  const landscape = { left: 100, top: 50 }
  const canvasRect = { left: 250, top: 50, width: 700, height: 700 }

  it.each([1, 1.25, 1.5, 2].map((scale) => [`${scale}x device pixel ratio`, scale] as const))(
    "lands a landscape-CSS tile under its DOM counterpart at %s",
    (_name, scale) => {
      const frame = canvasFrameFor(landscape, canvasRect, 700 * scale, 700 * scale)
      // A DOM tile at viewport (400, 200), 120×90 CSS px — in landscape-CSS
      // coordinates that is (300, 150).
      const framed = frameRect(frame, { x: 300, y: 150, w: 120, h: 90 })
      const expected = { x: 150 * scale, y: 150 * scale, w: 120 * scale, h: 90 * scale }
      const tolerance = scale // one CSS pixel, expressed in backing pixels
      expect(Math.abs(framed.x - expected.x)).toBeLessThanOrEqual(tolerance)
      expect(Math.abs(framed.y - expected.y)).toBeLessThanOrEqual(tolerance)
      expect(Math.abs(framed.w - expected.w)).toBeLessThanOrEqual(tolerance)
      expect(Math.abs(framed.h - expected.h)).toBeLessThanOrEqual(tolerance)
    },
  )

  it("accounts for the canvas sitting off the landscape origin", () => {
    // Canvas at the landscape's top-left would map (0,0)→(0,0); centered, the
    // landscape's left half maps to negative canvas x.
    const frame = canvasFrameFor(landscape, canvasRect, 700, 700)
    expect(frame.originX).toBeCloseTo(-150)
    expect(frame.originY).toBeCloseTo(0)
    expect(frame.scaleX).toBeCloseTo(1)
    expect(frame.scaleY).toBeCloseTo(1)
  })
})

describe("tessellated annular sectors", () => {
  const cx = 400
  const cy = 400
  const inner = 120
  const outer = 390
  const sectorArea = (start: number, end: number) =>
    ((end - start) / 2) * (outer * outer - inner * inner)

  const toleranceFor = (start: number, end: number, polygon: Point[]) => {
    // Chords cut corners within MAX_SAGITTA of the arcs, so the area error is
    // bounded by (arc length + chord count term) × sagitta; keep it generous
    // relative to 0.5px but far below the analytic area.
    return 0.5 * (2 * (inner + outer) * (end - start) + polygon.length) + 1
  }

  it("keeps a half-disk wedge's area instead of collapsing onto the diagonal", () => {
    const wedge = { start: 0, end: Math.PI, inner, outer }
    const polygon = sectorPolygon(wedge, cx, cy)
    expect(polygonArea(polygon)).toBeGreaterThan(sectorArea(0, Math.PI) * 0.995)
    expect(Math.abs(polygonArea(polygon) - sectorArea(0, Math.PI))).toBeLessThanOrEqual(
      toleranceFor(0, Math.PI, polygon),
    )
  })

  it("represents two equal quarter-ring sectors symmetrically", () => {
    const first = sectorPolygon({ start: 0, end: Math.PI / 2, inner, outer }, cx, cy)
    const second = sectorPolygon({ start: Math.PI / 2, end: Math.PI, inner, outer }, cx, cy)
    expect(polygonArea(first)).toBeCloseTo(polygonArea(second), 6)
    expect(polygonArea(first)).toBeGreaterThan(sectorArea(0, Math.PI / 2) * 0.995)
  })

  it("keeps a tiny sector beside a near-full-circle sector accurate", () => {
    const tiny = sectorPolygon({ start: 0, end: 0.02, inner, outer }, cx, cy)
    const huge = sectorPolygon({ start: 0.02, end: TAU - 0.001, inner, outer }, cx, cy)
    expect(polygonArea(tiny)).toBeGreaterThan(0)
    expect(polygonArea(huge)).toBeGreaterThan(sectorArea(0.02, TAU - 0.001) * 0.99)
  })

  it("places the four semantic corners at the anchor indices", () => {
    const wedge = { start: 0.3, end: 1.9, inner, outer }
    const polygon = sectorPolygon(wedge, cx, cy)
    const [tl, tr, br, bl] = anchorIndices(polygon.length)
    const corners = wedgeCorners(wedge, cx, cy)
    expect(polygon[tl]).toEqual(corners[0])
    expect(polygon[tr]).toEqual(corners[1])
    expect(polygon[br]).toEqual(corners[2])
    expect(polygon[bl]).toEqual(corners[3])
  })

  it("bounds chord error by the requested sagitta", () => {
    for (const angle of [0.05, 0.7, 1.6, 3.0, 6.0]) {
      const segments = arcSegments(angle, outer, 0.5)
      if (segments >= 96) continue // capped: bound only holds uncapped
      const sagitta = outer * (1 - Math.cos(angle / (2 * segments)))
      expect(sagitta).toBeLessThanOrEqual(0.5 + 1e-9)
    }
  })
})

describe("matching rect polygons", () => {
  it("matches the sector's point count and corner correspondence", () => {
    const wedge = { start: 0.3, end: 1.9, inner: 120, outer: 390 }
    const sector = sectorPolygon(wedge, 400, 400)
    const rect = matchingRectPolygon({ x: 10, y: 20, w: 300, h: 150 }, sector.length)
    expect(rect.length).toBe(sector.length)
    const [tl, tr, br, bl] = anchorIndices(rect.length)
    const corners = rectCorners({ x: 10, y: 20, w: 300, h: 150 })
    expect(rect[tl]).toEqual(corners[0])
    expect(rect[tr]).toEqual(corners[1])
    expect(rect[br]).toEqual(corners[2])
    expect(rect[bl]).toEqual(corners[3])
  })

  it("distributes edge points uniformly along top and bottom edges", () => {
    const rect = matchingRectPolygon({ x: 0, y: 0, w: 100, h: 50 }, 10)
    expect(rect.length).toBe(10)
    // Top edge: 5 points left→right; bottom edge: 5 points right→left.
    expect(rect[0]).toEqual([0, 0])
    expect(rect[4]).toEqual([100, 0])
    expect(rect[5]).toEqual([100, 50])
    expect(rect[9]).toEqual([0, 50])
    expect(rect[2][0]).toBeCloseTo(50)
    expect(rect[7][0]).toBeCloseTo(50)
  })
})
