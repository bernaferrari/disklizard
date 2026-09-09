/**
 * The one coordinate and boundary contract for the map⇄tiles transition.
 *
 * The sunburst canvas positions everything in backing-store pixels (CSS size
 * multiplied by the device pixel ratio) centered on its own square stage,
 * while the treemap lays tiles out in the landscape's CSS pixels. Every
 * conversion between those frames lives here so the renderers cannot each
 * invent their own.
 */

/** A point in canvas backing-store coordinates. */
export type Point = [number, number]

/** Axis-aligned rectangle in the coordinate space of its owner. */
export type Rect = { x: number; y: number; w: number; h: number }

/** Annular sector pose: angles in radians, radii in backing-store pixels. */
export type Wedge = { start: number; end: number; inner: number; outer: number }

/** Maps a container's CSS pixels onto the canvas backing store. */
export type CanvasFrame = {
  scaleX: number
  scaleY: number
  /** Backing-store coordinates of the container's top-left corner. */
  originX: number
  originY: number
}

/**
 * Derive the container→canvas mapping from live element rectangles. Drawing a
 * point that must appear at container CSS `(x, y)` uses `framePoint` on the
 * result; a rect drawn through this frame lands under its DOM counterpart at
 * any device pixel ratio and any container/canvas relative placement.
 */
export function canvasFrameFor(
  container: { left: number; top: number },
  canvas: { left: number; top: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
): CanvasFrame {
  const scaleX = canvasWidth / Math.max(1, canvas.width)
  const scaleY = canvasHeight / Math.max(1, canvas.height)
  return {
    scaleX,
    scaleY,
    originX: (container.left - canvas.left) * scaleX,
    originY: (container.top - canvas.top) * scaleY,
  }
}

/** Convert a container-space rect into canvas backing-store coordinates. */
export function frameRect(frame: CanvasFrame, rect: Rect): Rect {
  return {
    x: frame.originX + rect.x * frame.scaleX,
    y: frame.originY + rect.y * frame.scaleY,
    w: rect.w * frame.scaleX,
    h: rect.h * frame.scaleY,
  }
}

/**
 * Chord count for one arc so the tessellation never deviates more than
 * `maxSagitta` backing-store pixels from the true curve. The outer radius
 * bounds the error: for a fixed angle, sagitta grows with radius.
 */
export function arcSegments(
  angle: number,
  outerRadius: number,
  maxSagitta: number,
  maxSegments = 96,
): number {
  const radius = Math.max(1, outerRadius)
  const ratio = Math.min(0.5, Math.max(1e-6, maxSagitta / radius))
  const maxAngle = 2 * Math.acos(1 - ratio)
  if (!(maxAngle > 1e-6)) return maxSegments
  return Math.max(1, Math.min(maxSegments, Math.ceil(angle / maxAngle)))
}

/**
 * The annular sector's boundary as a polygon: inner arc traced start→end,
 * then the outer arc traced end→start. The four semantic corners
 * (inner@start, inner@end, outer@end, outer@start) sit at the indices
 * reported by `anchorIndices`, and intermediate points preserve the curved
 * boundaries — a half-ring keeps its area instead of collapsing onto the
 * diagonal chord.
 */
export function sectorPolygon(
  wedge: Wedge,
  cx: number,
  cy: number,
  maxSagitta = 0.5,
  segments = arcSegments(wedge.end - wedge.start, wedge.outer, maxSagitta),
): Point[] {
  const inner = [wedge.inner, wedge.outer].reduce((a, b) => Math.max(1, Math.min(a, b)))
  const outer = Math.max(inner, wedge.outer)
  const polygon: Point[] = []
  for (let i = 0; i <= segments; i++) {
    const angle = wedge.start + ((wedge.end - wedge.start) * i) / segments
    polygon.push([cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner])
  }
  for (let i = segments; i >= 0; i--) {
    const angle = wedge.start + ((wedge.end - wedge.start) * i) / segments
    polygon.push([cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer])
  }
  return polygon
}

/**
 * A rect boundary with a point-for-point correspondence to a sector polygon
 * of the same length: the top edge carries the inner arc's points (start→end,
 * TL→TR) and the bottom edge carries the outer arc's reversed points
 * (end→start, BR→BL). The radial sector edges map to the rect's side edges.
 */
export function matchingRectPolygon(rect: Rect, sectorPointCount: number): Point[] {
  const perEdge = Math.max(2, Math.floor(sectorPointCount / 2))
  const polygon: Point[] = []
  for (let i = 0; i < perEdge; i++) {
    const t = i / (perEdge - 1)
    polygon.push([rect.x + rect.w * t, rect.y])
  }
  for (let i = 0; i < perEdge; i++) {
    const t = i / (perEdge - 1)
    polygon.push([rect.x + rect.w * (1 - t), rect.y + rect.h])
  }
  return polygon
}

/**
 * Semantic corner indices shared by both boundary representations: inner@start
 * (TL), inner@end (TR), outer@end (BR), outer@start (BL).
 */
export function anchorIndices(polygonLength: number): [number, number, number, number] {
  const perEdge = Math.max(2, Math.floor(polygonLength / 2))
  return [0, perEdge - 1, perEdge, polygonLength - 1]
}

/** The four corners of a rect: top-left, top-right, bottom-right, bottom-left. */
export function rectCorners(rect: Rect): [Point, Point, Point, Point] {
  return [
    [rect.x, rect.y],
    [rect.x + rect.w, rect.y],
    [rect.x + rect.w, rect.y + rect.h],
    [rect.x, rect.y + rect.h],
  ]
}

/**
 * The four corners of an annular sector, tracing its boundary: inner@start,
 * inner@end, outer@end, outer@start. Kept for pose-level reasoning; the
 * morph itself draws the tessellated `sectorPolygon`.
 */
export function wedgeCorners(
  wedge: Wedge,
  cx: number,
  cy: number,
): [Point, Point, Point, Point] {
  const cosA = Math.cos(wedge.start)
  const sinA = Math.sin(wedge.start)
  const cosB = Math.cos(wedge.end)
  const sinB = Math.sin(wedge.end)
  return [
    [cx + cosA * wedge.inner, cy + sinA * wedge.inner],
    [cx + cosB * wedge.inner, cy + sinB * wedge.inner],
    [cx + cosB * wedge.outer, cy + sinB * wedge.outer],
    [cx + cosA * wedge.outer, cy + sinA * wedge.outer],
  ]
}

/** Point on the quadratic bézier through p0 → pc → p1 at parameter t. */
export function quadPoint(p0: Point, pc: Point, p1: Point, t: number): Point {
  const u = 1 - t
  return [
    u * u * p0[0] + 2 * u * t * pc[0] + t * t * p1[0],
    u * u * p0[1] + 2 * u * t * pc[1] + t * t * p1[1],
  ]
}

/** Shoelace area of a closed polygon (absolute value). */
export function polygonArea(polygon: readonly Point[]): number {
  let doubled = 0
  for (let i = 0; i < polygon.length; i++) {
    const [x0, y0] = polygon[i]
    const [x1, y1] = polygon[(i + 1) % polygon.length]
    doubled += x0 * y1 - x1 * y0
  }
  return Math.abs(doubled) / 2
}

/** Unbend an annular ribbon without folding its opposing edges through each
 * other. Reuses the caller's point buffer; thickness stays positive throughout. */
export function unwrapSector(points: Point[], wedge: Wedge, rect: Rect, cx: number, cy: number, t: number) {
  const middle = (wedge.start + wedge.end) / 2
  const radius = (wedge.inner + wedge.outer) / 2
  const span = wedge.end - wedge.start
  const bend = span * (1 - t)
  const length = radius * span * (1 - t) + rect.w * t
  const thickness = (wedge.outer - wedge.inner) * (1 - t) + rect.h * t
  const turn = Math.atan2(Math.sin(-Math.PI / 2 - middle), Math.cos(-Math.PI / 2 - middle))
  const orientation = middle + turn * t
  const cos = Math.cos(orientation), sin = Math.sin(orientation)
  const centerX = (cx + Math.cos(middle) * radius) * (1 - t) + (rect.x + rect.w / 2) * t
  const centerY = (cy + Math.sin(middle) * radius) * (1 - t) + (rect.y + rect.h / 2) * t
  const perEdge = points.length / 2
  for (let i = 0; i < points.length; i++) {
    const inner = i < perEdge
    const u = inner ? i / (perEdge - 1) : (points.length - 1 - i) / (perEdge - 1)
    const angle = (u - 0.5) * bend
    const offset = (inner ? -1 : 1) * thickness / 2
    const r = bend > 0.00001 ? length / bend : 0
    const x = r ? (r + offset) * Math.sin(angle) : (u - 0.5) * length
    const y = r ? -2 * r * Math.sin(angle / 2) ** 2 + offset * Math.cos(angle) : offset
    points[i][0] = centerX - sin * x + cos * y
    points[i][1] = centerY + cos * x + sin * y
  }
}
