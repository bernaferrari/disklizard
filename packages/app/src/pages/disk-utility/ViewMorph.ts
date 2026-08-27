/**
 * ViewMorph — the map⇄tiles transition.
 *
 * One persistent canvas carries both views: every primary sunburst wedge owns
 * a treemap tile twin, and switching modes flies each shape's four corners to
 * their counterpart along quadratic béziers. Control points sit on the wheel
 * rim at each corner's original angle, so segments peel off the disc instead
 * of cutting across it. DOM tiles mount only after the flight lands — canvas
 * and DOM share geometry and `primarySegmentColor(index)` fills, so the hand-
 * off is invisible.
 */

import type { DiskScanNode } from "./types"
import { primarySegmentColor } from "./sunburst"

/** A segment's wheel pose (polar, canvas pixels) and its tile pose (axis-aligned rect, canvas pixels). */
export type MorphPose = {
  wedge: { start: number; end: number; inner: number; outer: number }
  rect: { x: number; y: number; w: number; h: number }
}

/** One flying shape; callers swap `from`/`to` for the reverse direction. */
export type MorphTile = {
  path: string
  node: DiskScanNode
  colorIndex: number
  from: MorphPose
  to: MorphPose
}

export type MorphDirection = "toGrid" | "toMap"

type Corner = [number, number]

const TO_GRID_MS = 480
const TO_MAP_MS = 420

function easeOutQuart(t: number) {
  return 1 - Math.pow(1 - t, 4)
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * The four corners of an annular sector, tracing its boundary:
 * inner@start, inner@end, outer@end, outer@start.
 */
export function wedgeCorners(wedge: MorphPose["wedge"], cx: number, cy: number): [Corner, Corner, Corner, Corner] {
  return [
    [cx + wedge.inner * Math.cos(wedge.start), cy + wedge.inner * Math.sin(wedge.start)],
    [cx + wedge.inner * Math.cos(wedge.end), cy + wedge.inner * Math.sin(wedge.end)],
    [cx + wedge.outer * Math.cos(wedge.end), cy + wedge.outer * Math.sin(wedge.end)],
    [cx + wedge.outer * Math.cos(wedge.start), cy + wedge.outer * Math.sin(wedge.start)],
  ]
}

/** The four corners of a rect: top-left, top-right, bottom-right, bottom-left. */
export function rectCorners(rect: MorphPose["rect"]): [Corner, Corner, Corner, Corner] {
  const { x, y, w, h } = rect
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]
}

/** Point on the quadratic bézier through p0 → pc → p1 at parameter t. */
export function quadPoint(p0: Corner, pc: Corner, p1: Corner, t: number): Corner {
  const u = 1 - t
  return [
    u * u * p0[0] + 2 * u * t * pc[0] + t * t * p1[0],
    u * u * p0[1] + 2 * u * t * pc[1] + t * t * p1[1],
  ]
}

/** Project a point radially onto the wheel rim — the bézier control point. */
function rimControl(corner: Corner, cx: number, cy: number, maxR: number): Corner {
  const dx = corner[0] - cx
  const dy = corner[1] - cy
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return [cx + maxR, cy]
  return [cx + (dx / len) * maxR, cy + (dy / len) * maxR]
}

/** Trace a closed polygon, optionally rounding corners via arcTo. */
function traceCorners(ctx: CanvasRenderingContext2D, pts: Corner[], radius: number) {
  const n = pts.length
  ctx.beginPath()
  if (radius < 0.5) {
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1])
    ctx.closePath()
    return
  }
  let firstEntry: Corner | null = null
  for (let i = 0; i < n; i++) {
    const prev = pts[(i + n - 1) % n]
    const cur = pts[i]
    const next = pts[(i + 1) % n]
    const dPrev = Math.hypot(cur[0] - prev[0], cur[1] - prev[1])
    const dNext = Math.hypot(next[0] - cur[0], next[1] - cur[1])
    const r = Math.min(radius, dPrev / 2, dNext / 2)
    const entry: Corner = [cur[0] + ((prev[0] - cur[0]) / dPrev) * r, cur[1] + ((prev[1] - cur[1]) / dPrev) * r]
    const exit: Corner = [cur[0] + ((next[0] - cur[0]) / dNext) * r, cur[1] + ((next[1] - cur[1]) / dNext) * r]
    if (i === 0) {
      firstEntry = entry
      ctx.moveTo(entry[0], entry[1])
    } else {
      ctx.lineTo(entry[0], entry[1])
    }
    ctx.arcTo(cur[0], cur[1], exit[0], exit[1], r)
  }
  if (firstEntry) ctx.lineTo(firstEntry[0], firstEntry[1])
  ctx.closePath()
}

/**
 * Corner pairing between poses: wedge inner@start → TL, inner@end → TR,
 * outer@end → BR, outer@start → BL. Each corner flies its own bézier whose
 * control point sits on the wheel rim at that corner's original angle.
 */
function sourceCorners(tile: MorphTile, dir: MorphDirection, cx: number, cy: number): Corner[] {
  const pose = dir === "toGrid" ? tile.from : tile.to
  return dir === "toGrid" ? wedgeCorners(pose.wedge, cx, cy) : rectCorners(pose.rect)
}

function destinationCorners(tile: MorphTile, dir: MorphDirection, cx: number, cy: number): Corner[] {
  const pose = dir === "toGrid" ? tile.to : tile.from
  return dir === "toGrid" ? rectCorners(pose.rect) : wedgeCorners(pose.wedge, cx, cy)
}

export class ViewMorph {
  private tiles: MorphTile[] = []
  private dir: MorphDirection = "toGrid"
  private startTime = 0
  private duration = 1
  private controls: Corner[][] = []
  private raf: number | null = null
  private finished: (() => void) | null = null
  private _active = false
  /** Tile separator color, read once per flight from the live theme. */
  private border = "#0c0c14"
  private canvasEl!: HTMLCanvasElement
  private drawCtx!: CanvasRenderingContext2D
  private getCenter: () => { cx: number; cy: number; maxR: number }
  private reducedMotion: () => boolean

  constructor(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    getCenter: () => { cx: number; cy: number; maxR: number },
    reducedMotion: () => boolean,
  ) {
    this.canvasEl = canvas
    this.drawCtx = ctx
    this.getCenter = getCenter
    this.reducedMotion = reducedMotion
  }

  /** The canvas this morph draws on; lets a caller rebind when the canvas remounts. */
  get canvas() {
    return this.canvasEl
  }

  /** True while a morph is in flight. */
  get active() {
    return this._active
  }

  play(tiles: MorphTile[], dir: MorphDirection, done: () => void): void {
    if (!tiles.length) {
      done()
      return
    }
    this.cancel()
    this.tiles = tiles
    this.dir = dir
    // One layout-free theme read per flight: a 500ms window tolerates a theme
    // flip mid-morph, while per-frame getComputedStyle would thrash layout.
    this.border =
      getComputedStyle(this.canvasEl).getPropertyValue("--border-weaker-base").trim() || "#0c0c14"
    this.finished = done
    this.duration = this.reducedMotion() ? 1 : dir === "toGrid" ? TO_GRID_MS : TO_MAP_MS
    const { cx, cy, maxR } = this.getCenter()
    this.controls = tiles.map((tile) =>
      sourceCorners(tile, dir, cx, cy).map((corner) => rimControl(corner, cx, cy, maxR)),
    )
    this._active = true
    this.startTime = performance.now()
    this.raf = requestAnimationFrame((now) => this.frame(now))
  }

  /** Hard-stop without landing: kill the frame loop, clear the canvas, and drop the caller's continuation. */
  abort() {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
    if (!this._active) return
    this._active = false
    this.finished = null
    this.drawCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height)
  }

  /** Stop mid-flight, clear the canvas, and release the caller's continuation. */
  cancel() {
    if (!this._active) return
    this._active = false
    this.drawCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height)
    const cb = this.finished
    this.finished = null
    cb?.()
  }

  private frame(now: number) {
    // cancel()/abort() drop the loop; a stale scheduled frame must not revive it.
    if (!this._active) {
      this.raf = null
      return
    }
    const raw = this.duration > 0 ? Math.min(1, (now - this.startTime) / this.duration) : 1
    this.draw(raw)
    if (raw >= 1) {
      this.raf = null
      this.cancel()
      return
    }
    this.raf = requestAnimationFrame((next) => this.frame(next))
  }

  private draw(raw: number) {
    const ctx = this.drawCtx
    const t = this.dir === "toGrid" ? easeOutQuart(raw) : easeInOutCubic(raw)
    const { cx, cy, maxR } = this.getCenter()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height)

    // The wheel rim dissolves (toGrid) or gathers (toMap) while shapes fly.
    const rimAlpha = this.dir === "toGrid" ? 0.35 * (1 - t) : 0.35 * t
    if (rimAlpha > 0.004) {
      ctx.beginPath()
      ctx.arc(cx, cy, maxR, 0, Math.PI * 2)
      ctx.strokeStyle = `oklch(0.6 0.01 0 / ${rimAlpha.toFixed(3)})`
      ctx.lineWidth = 1 * dpr
      ctx.stroke()
    }

    const roundRadius = raw > 0.6 ? ((raw - 0.6) / 0.4) * 4 * dpr : 0
    for (let i = 0; i < this.tiles.length; i++) {
      const tile = this.tiles[i]
      const from = sourceCorners(tile, this.dir, cx, cy)
      const to = destinationCorners(tile, this.dir, cx, cy)
      const ctrls = this.controls[i]
      const pts: Corner[] = from.map((corner, j) => quadPoint(corner, ctrls[j], to[j], t))
      traceCorners(ctx, pts, roundRadius)
      ctx.fillStyle = primarySegmentColor(tile.colorIndex, 1, tile.node.isDir)
      ctx.fill()
      ctx.strokeStyle = this.border
      ctx.lineWidth = 0.8 * dpr
      ctx.stroke()
    }
  }
}

