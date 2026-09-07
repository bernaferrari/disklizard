/**
 * ViewMorph — the map⇄tiles transition.
 *
 * One persistent canvas carries both views: every primary sunburst wedge owns
 * a treemap tile twin, and switching modes flies each boundary point to (or
 * from) its tile pose on that canvas. Sector boundaries are tessellated so a
 * half-disk wedge keeps its curved shape instead of collapsing onto a
 * diagonal, and tile poses arrive already expressed in the canvas backing
 * store through the shared `morph-geometry` contract.
 *
 * Lifecycle: `play` supersedes any in-flight transition (an empty tile set
 * cancels first, then completes immediately), `cancel` stops and completes,
 * `abort` stops without completing. Every stop path cancels the scheduled
 * frame; a frame callback carries the generation of the flight that scheduled
 * it, so a stale callback that somehow still runs can neither draw nor
 * disturb the current flight's bookkeeping.
 */

import type { DiskScanNode } from "./types"
import { primarySegmentColor } from "./sunburst"
import {
  anchorIndices,
  arcSegments,
  matchingRectPolygon,
  quadPoint,
  sectorPolygon,
  type Point,
  type Rect,
  type Wedge,
} from "./morph-geometry"
export type MorphPose = {
  wedge: Wedge
  /** Canvas backing-store coordinates — apply `frameRect` before building a tile. */
  rect: Rect
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

const TO_GRID_MS = 480
const TO_MAP_MS = 420
/** Tessellation stays within this many backing-store pixels of the true arc. */
const MAX_SAGITTA = 0.5

function easeOutQuart(t: number) {
  return 1 - Math.pow(1 - t, 4)
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/** Per-tile precomputed flight plan: destination rect boundary plus anchors. */
type FlightPlan = {
  pointCount: number
  rectPolygon: Point[]
  anchors: ReadonlySet<number>
}

export class ViewMorph {
  private tiles: MorphTile[] = []
  private dir: MorphDirection = "toGrid"
  private startTime = 0
  private duration = 1
  private plans: FlightPlan[] = []
  private controls: Point[][] = []
  private raf: number | null = null
  private finished: (() => void) | null = null
  private _active = false
  /**
   * Monotonic per-flight token. `play` captures the incremented value in a
   * local and closes over it, so a callback always carries the generation of
   * the flight that scheduled it — never whatever `this.generation` holds
   * when the callback happens to run.
   */
  private generation = 0
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
    // An empty flight still supersedes whatever is airborne: cancel it (its
    // continuation runs, restoring the caller's pre-morph state) before
    // reporting the empty transition complete.
    this.cancel()
    if (!tiles.length) {
      done()
      return
    }
    this.tiles = tiles
    this.dir = dir
    // One layout-free theme read per flight: a 500ms window tolerates a theme
    // flip mid-morph, while per-frame getComputedStyle would thrash layout.
    this.border =
      getComputedStyle(this.canvasEl).getPropertyValue("--border-weaker-base").trim() || "#0c0c14"
    this.finished = done
    this.duration = this.reducedMotion() ? 1 : dir === "toGrid" ? TO_GRID_MS : TO_MAP_MS
    const { cx, cy, maxR } = this.getCenter()
    this.plans = tiles.map((tile) => this.planFlight(tile))
    this.controls = this.tiles.map((tile, index) =>
      this.boundary(tile, index, cx, cy).map((point) => rimControl(point, cx, cy, maxR)),
    )
    this._active = true
    const generation = ++this.generation
    this.startTime = performance.now()
    this.raf = requestAnimationFrame((now) => this.frame(now, generation))
  }

  /**
   * Stop mid-flight, clear the canvas, and release the caller's continuation
   * without completing: used when the surface unmounts or is rebound, or when
   * a caller must guarantee a stale completion never fires.
   */
  abort() {
    this.settle(false)
  }

  /**
   * Stop the flight and run its continuation exactly once. Completing at the
   * destination and an operator-driven cancel share this path — both leave
   * the canvas clear and hand control back to the caller — but only `frame`
   * reaches here after drawing the final pose.
   */
  cancel() {
    this.settle(true)
  }

  /** One stop path: drop the scheduled frame, then optionally complete. */
  private settle(runCompletion: boolean) {
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
    if (!this._active) return
    this._active = false
    this.drawCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height)
    const cb = runCompletion ? this.finished : null
    this.finished = null
    cb?.()
  }

  private frame(now: number, generation: number) {
    // Staleness first: an obsolete callback must not touch this.raf, which
    // tracks the current flight's scheduled frame.
    if (!this._active || generation !== this.generation) return
    this.raf = null
    const raw = this.duration > 0 ? Math.min(1, (now - this.startTime) / this.duration) : 1
    this.draw(raw)
    if (raw >= 1) {
      this.settle(true)
      return
    }
    this.raf = requestAnimationFrame((next) => this.frame(next, generation))
  }

  /** The tessellation density and rect boundary for one tile's flight. */
  private planFlight(tile: MorphTile): FlightPlan {
    const wedge = this.dir === "toGrid" ? tile.from.wedge : tile.to.wedge
    const rect = this.dir === "toGrid" ? tile.to.rect : tile.from.rect
    const pointCount = 2 * (arcSegments(wedge.end - wedge.start, wedge.outer, MAX_SAGITTA) + 1)
    return {
      pointCount,
      rectPolygon: matchingRectPolygon(rect, pointCount),
      anchors: new Set(anchorIndices(pointCount)),
    }
  }

  /** The boundary this tile flies from, retessellated against the live center. */
  private boundary(tile: MorphTile, index: number, cx: number, cy: number): Point[] {
    const plan = this.plans[index]
    if (!plan) return []
    if (this.dir === "toGrid") {
      return sectorPolygon(tile.from.wedge, cx, cy, MAX_SAGITTA, plan.pointCount / 2 - 1)
    }
    return plan.rectPolygon
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
      const source = this.boundary(this.tiles[i], i, cx, cy)
      const destination = this.dir === "toGrid"
        ? this.plans[i].rectPolygon
        : sectorPolygon(
            this.tiles[i].to.wedge,
            cx,
            cy,
            MAX_SAGITTA,
            this.plans[i].pointCount / 2 - 1,
          )
      const ctrls = this.controls[i]
      const pts: Point[] = source.map((point, j) => quadPoint(point, ctrls[j], destination[j], t))
      tracePolygon(ctx, pts, this.plans[i].anchors, roundRadius)
      ctx.fillStyle = primarySegmentColor(this.tiles[i].colorIndex, 1, this.tiles[i].node.isDir)
      ctx.fill()
      ctx.strokeStyle = this.border
      ctx.lineWidth = 0.8 * dpr
      ctx.stroke()
    }
  }
}

/** Project a point radially onto the wheel rim — the bézier control point. */
function rimControl(point: Point, cx: number, cy: number, maxR: number): Point {
  const dx = point[0] - cx
  const dy = point[1] - cy
  const length = Math.hypot(dx, dy) || 1
  return [cx + (dx / length) * maxR, cy + (dy / length) * maxR]
}

/**
 * Trace a closed polygon, rounding only the semantic corner anchors via
 * arcTo. Tessellation points along the arcs stay sharp so the curved
 * boundaries keep their shape.
 */
function tracePolygon(
  ctx: CanvasRenderingContext2D,
  pts: Point[],
  anchors: ReadonlySet<number>,
  radius: number,
) {
  if (pts.length < 3) return
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) {
    if (!anchors.has(i) || radius <= 0) {
      ctx.lineTo(pts[i][0], pts[i][1])
      continue
    }
    const previous = pts[i - 1]
    const corner = pts[i]
    const next = pts[(i + 1) % pts.length]
    const inDx = previous[0] - corner[0]
    const inDy = previous[1] - corner[1]
    const outDx = next[0] - corner[0]
    const outDy = next[1] - corner[1]
    const inLength = Math.hypot(inDx, inDy) || 1
    const outLength = Math.hypot(outDx, outDy) || 1
    const trim = Math.min(radius, inLength / 2, outLength / 2)
    ctx.lineTo(corner[0] + (inDx / inLength) * trim, corner[1] + (inDy / inLength) * trim)
    ctx.arcTo(
      corner[0],
      corner[1],
      corner[0] + (outDx / outLength) * trim,
      corner[1] + (outDy / outLength) * trim,
      trim,
    )
  }
  ctx.closePath()
}