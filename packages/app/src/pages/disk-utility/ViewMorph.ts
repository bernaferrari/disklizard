/**
 * ViewMorph — the map and tiles transition.
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
  sectorPolygon,
  unwrapSector,
  type Point,
  type Rect,
  type Wedge,
} from "./morph-geometry"
export type MorphPose = {
  shape?: "arc" | "rect"
  wedge: Wedge
  /** Canvas backing-store coordinates — apply `frameRect` before building a tile. */
  rect: Rect
}

/** One flying shape; callers swap `from`/`to` for the reverse direction. */
export type MorphTile = {
  path: string
  node: DiskScanNode
  depth?: number
  colorIndex: number
  fromColor?: string
  toColor?: string
  fromOpacity?: number
  toOpacity?: number
  from: MorphPose
  to: MorphPose
  /** Part of the flight (0–1) during which this shape travels. */
  move?: readonly [number, number]
  /** Part of the flight during which its opacity changes. */
  fade?: readonly [number, number]
}

function windowed(raw: number, range: readonly [number, number] | undefined) {
  if (!range) return raw
  return Math.max(0, Math.min(1, (raw - range[0]) / (range[1] - range[0])))
}

export type MorphDirection = "toGrid" | "toMap"

// Two readable steps (detail steps aside, then the shared shapes travel),
// so the flight needs a little more time than a single crossfade.
const TO_GRID_MS = 460
const TO_MAP_MS = 460
/** Tessellation stays within this many backing-store pixels of the true arc. */
const MAX_SAGITTA = 0.5

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
  private pendingFirstFrame = false
  private duration = 1
  private plans: FlightPlan[] = []
  private sources: Point[][] = []
  private destinations: Point[][] = []
  private points: Point[][] = []
  private colors: string[] = []
  private geometryCenter = { cx: NaN, cy: NaN, maxR: NaN }
  private raf: number | null = null
  private finished: (() => void) | null = null
  private progress: ((fraction: number) => void) | null = null
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
    reducedMotion: () => boolean
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

  play(
    tiles: MorphTile[],
    dir: MorphDirection,
    done: () => void,
    onProgress?: (fraction: number) => void
  ): void {
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
      getComputedStyle(this.canvasEl)
        .getPropertyValue("--border-weaker-base")
        .trim() || "#0c0c14"
    this.finished = done
    this.progress = onProgress ?? null
    this.duration = this.reducedMotion()
      ? 1
      : dir === "toGrid"
        ? TO_GRID_MS
        : TO_MAP_MS
    const { cx, cy, maxR } = this.getCenter()
    this.plans = tiles.map((tile) => this.planFlight(tile))
    this.prepareGeometry(cx, cy, maxR)
    this.colors = tiles.map((tile) =>
      tile.node.isOther
        ? getComputedStyle(this.canvasEl)
            .getPropertyValue("--surface-raised-strong")
            .trim()
        : primarySegmentColor(
            tile.colorIndex,
            1,
            tile.node.isDir,
            tile.depth ?? 0
          )
    )
    this._active = true
    const generation = ++this.generation
    // The caller mounts and measures the destination before we run. Preserve
    // the exact source pixels until the first paint, then start the clock.
    this.pendingFirstFrame = true
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
    if (!runCompletion)
      this.drawCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height)
    const cb = runCompletion ? this.finished : null
    this.finished = null
    this.progress = null
    cb?.()
  }

  private frame(now: number, generation: number) {
    // Staleness first: an obsolete callback must not touch this.raf, which
    // tracks the current flight's scheduled frame.
    if (!this._active || generation !== this.generation) return
    this.raf = null
    if (this.pendingFirstFrame) {
      this.pendingFirstFrame = false
      this.startTime = now - (this.duration <= 1 ? this.duration : 0)
    }
    const raw =
      this.duration > 0
        ? Math.min(1, (now - this.startTime) / this.duration)
        : 1
    this.draw(raw)
    this.progress?.(raw)
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
    const pointCount =
      2 * (arcSegments(wedge.end - wedge.start, wedge.outer, MAX_SAGITTA) + 1)
    return {
      pointCount,
      rectPolygon: matchingRectPolygon(rect, pointCount),
      anchors: new Set(anchorIndices(pointCount)),
    }
  }

  /** The boundary this tile flies from, retessellated against the live center. */
  private boundary(
    tile: MorphTile,
    index: number,
    cx: number,
    cy: number
  ): Point[] {
    const plan = this.plans[index]
    if (!plan) return []
    if (tile.from.shape === "rect")
      return matchingRectPolygon(tile.from.rect, plan.pointCount)
    if (tile.from.shape === "arc" || this.dir === "toGrid") {
      return sectorPolygon(
        tile.from.wedge,
        cx,
        cy,
        MAX_SAGITTA,
        plan.pointCount / 2 - 1
      )
    }
    return plan.rectPolygon
  }

  /** Cache curved boundaries and reuse point buffers; resize is the only invalidation. */
  private prepareGeometry(cx: number, cy: number, maxR: number) {
    this.geometryCenter = { cx, cy, maxR }
    this.sources = this.tiles.map((tile, i) => this.boundary(tile, i, cx, cy))
    this.destinations = this.tiles.map((tile, i) =>
      tile.to.shape === "rect" ||
      (tile.to.shape !== "arc" && this.dir === "toGrid")
        ? this.plans[i].rectPolygon
        : sectorPolygon(
            tile.to.wedge,
            cx,
            cy,
            MAX_SAGITTA,
            this.plans[i].pointCount / 2 - 1
          )
    )
    this.points = this.sources.map((points) => points.map((): Point => [0, 0]))
  }

  private draw(raw: number) {
    const ctx = this.drawCtx
    const t = easeInOutCubic(raw)
    const { cx, cy, maxR } = this.getCenter()
    if (
      cx !== this.geometryCenter.cx ||
      cy !== this.geometryCenter.cy ||
      maxR !== this.geometryCenter.maxR
    ) {
      this.prepareGeometry(cx, cy, maxR)
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    ctx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height)

    for (let i = 0; i < this.tiles.length; i++) {
      const source = this.sources[i]
      const destination = this.destinations[i]
      const pts = this.points[i]
      const tile = this.tiles[i]
      const localRaw = windowed(raw, tile.move)
      const local = tile.move ? easeInOutCubic(localRaw) : t
      const fromArc =
        tile.from.shape === "arc" ||
        (tile.from.shape === undefined && this.dir === "toGrid")
      const toArc =
        tile.to.shape === "arc" ||
        (tile.to.shape === undefined && this.dir === "toMap")
      const roundRadius =
        fromArc === toArc
          ? fromArc
            ? 0
            : 4 * dpr
          : fromArc
            ? Math.min(1, Math.max(0, (localRaw - 0.55) / 0.45)) * 4 * dpr
            : Math.min(1, Math.max(0, (0.45 - localRaw) / 0.45)) * 4 * dpr
      if (fromArc !== toArc) {
        unwrapSector(
          pts,
          fromArc ? tile.from.wedge : tile.to.wedge,
          fromArc ? tile.to.rect : tile.from.rect,
          cx,
          cy,
          fromArc ? local : 1 - local
        )
      } else {
        for (let j = 0; j < pts.length; j++) {
          pts[j][0] = source[j][0] + (destination[j][0] - source[j][0]) * local
          pts[j][1] = source[j][1] + (destination[j][1] - source[j][1]) * local
        }
      }
      tracePolygon(ctx, pts, this.plans[i].anchors, roundRadius)
      const fade = tile.fade ? easeInOutCubic(windowed(raw, tile.fade)) : t
      ctx.globalAlpha =
        (tile.fromOpacity ?? 1) +
        ((tile.toOpacity ?? 1) - (tile.fromOpacity ?? 1)) * fade
      const fromColor = tile.fromColor ?? this.colors[i]
      const toColor = tile.toColor ?? this.colors[i]
      ctx.fillStyle =
        fromColor === toColor
          ? fromColor
          : `color-mix(in oklab, ${fromColor} ${(1 - local) * 100}%, ${toColor})`
      ctx.fill()
      // The map has gaps, but no outline. The separator belongs to the tile
      // pose and must fade in or out according to the direction of travel.
      const separator =
        this.dir === "toGrid"
          ? Math.min(1, Math.max(0, (raw - 0.25) / 0.45))
          : Math.min(1, Math.max(0, (0.75 - raw) / 0.45))
      if (separator > 0) {
        ctx.strokeStyle = this.border
        ctx.lineWidth = 0.8 * dpr * separator
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }
  }
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
  radius: number
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
    ctx.lineTo(
      corner[0] + (inDx / inLength) * trim,
      corner[1] + (inDy / inLength) * trim
    )
    ctx.arcTo(
      corner[0],
      corner[1],
      corner[0] + (outDx / outLength) * trim,
      corner[1] + (outDy / outLength) * trim,
      trim
    )
  }
  ctx.closePath()
}
