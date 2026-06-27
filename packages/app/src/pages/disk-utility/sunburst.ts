/**
 * DiskLizard Sunburst — the visual centerpiece.
 *
 * Concentric ring map (DaisyDisk-style) with seamless morph transitions between
 * levels. Colors are picked in OKLCH space (perceptually uniform) then converted
 * to sRGB for crisp canvas gradients. A ResizeObserver keeps it pixel-perfect
 * inside flex panels; a single rAF loop drives the hover springs + animations.
 */

import type { DiskScanNode } from "@/context/platform"

/** Node shape the engine consumes — identical to DiskScanNode, aliased for seamless interop. */
export type SunNode = DiskScanNode

export type Segment = {
  id: string
  node: SunNode
  depth: number
  hue: number
  colorCss: string
  path: string
  // interpolated pose
  start: number
  end: number
  inner: number
  outer: number
  opacity: number
  hover: number
  targetHover: number
  // animation from/to
  fromStart: number
  fromEnd: number
  fromInner: number
  fromOuter: number
  fromOpacity: number
  toStart: number
  toEnd: number
  toInner: number
  toOuter: number
  toOpacity: number
}

export type SunburstOptions = {
  rings?: number
  padAngle?: number
  ringGap?: number
  animMs?: number
  onHover?: (seg: Segment | null) => void
  onClick?: (seg: Segment) => void
  onCenterClick?: () => void
}

/** Pick colors in perceptual OKLCH space; render oklch() directly (Chromium 111+). */
function oklchCss(L: number, C: number, hDeg: number, alpha = 1): string {
  const h = ((hDeg % 360) + 360) % 360
  return alpha >= 1
    ? `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)})`
    : `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)} / ${alpha})`
}

/** Base lightness/chroma per ring depth — inner ring a touch brighter. */
function baseForDepth(depth: number): { L: number; C: number } {
  return depth === 0 ? { L: 0.7, C: 0.158 } : { L: 0.62, C: 0.128 }
}

// ── Easing & math ────────────────────────────────────────────────────────────

function easeOutExpo(t: number) {
  return t >= 1 ? 1 : 1 - Math.pow(2, -11 * t)
}
function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3)
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

// ── Layout: assign angular spans + OKLCH hues recursively ────────────────────

type LayoutSeg = {
  id: string
  node: SunNode
  depth: number
  hue: number
  start: number
  end: number
  path: string
}

function layoutTree(
  node: SunNode,
  depth: number,
  startAngle: number,
  endAngle: number,
  parentHue: number,
  out: LayoutSeg[],
  rings: number,
) {
  const children = node.children
  if (!children?.length) return
  const total = children.reduce((sum, c) => sum + (c.size || 0), 0)
  if (total === 0) return

  const span = endAngle - startAngle
  let angle = startAngle
  const n = children.length

  for (let i = 0; i < n; i++) {
    const child = children[i]
    if (!child.size || child.size <= 0) continue
    const segSpan = span * (child.size / total)
    if (segSpan < 0.0016) continue

    // Hue is keyed to the ORIGINAL child index (not the render-skipping counter)
    // so the ranked list can compute the exact same color from its index.
    let hue: number
    if (depth === 0) {
      hue = primaryHueForIndex(i)
    } else {
      const t = n > 1 ? (i / (n - 1) - 0.5) * 2 : 0
      hue = (parentHue + t * 16 + 360) % 360
    }

    out.push({
      id: child.path,
      node: child,
      depth,
      hue,
      start: angle,
      end: angle + segSpan,
      path: child.path,
    })

    if (depth < rings - 1 && child.isDir && !child.isOther && child.children?.length) {
      layoutTree(child, depth + 1, angle, angle + segSpan, hue, out, rings)
    }
    angle += segSpan
  }
}

/** Golden-angle hue for the i-th child — shared with the ranked list for perfect color sync. */
export function primaryHueForIndex(i: number): number {
  return (i * 137.508 + 24) % 360
}

/** OKLCH color for the i-th primary segment — matches the sunburst exactly. */
export function primarySegmentColor(i: number, alpha = 1): string {
  const hue = primaryHueForIndex(i)
  return alpha >= 1 ? `oklch(0.7 0.158 ${hue.toFixed(1)})` : `oklch(0.7 0.158 ${hue.toFixed(1)} / ${alpha})`
}

// ── The engine ───────────────────────────────────────────────────────────────

export class Sunburst {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  options: Required<Pick<SunburstOptions, "rings" | "padAngle" | "ringGap" | "animMs">> &
    SunburstOptions

  root: SunNode | null = null
  viewNode: SunNode | null = null
  segments: Segment[] = []
  hovered: Segment | null = null
  selectedPath: string | null = null
  highlightPath: string | null = null

  animT = 1
  animStart = 0
  animating = false
  entering = false
  pulseT = 0

  dpr = 1
  cx = 0
  cy = 0
  maxR = 0
  innerHole = 0
  raf: number | null = null
  ro: ResizeObserver | null = null

  constructor(canvas: HTMLCanvasElement, options: SunburstOptions = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext("2d", { alpha: true })!
    this.options = { rings: 2, padAngle: 0.005, ringGap: 0.014, animMs: 560, ...options }

    this._onMouseMove = this._onMouseMove.bind(this)
    this._onMouseLeave = this._onMouseLeave.bind(this)
    this._onClick = this._onClick.bind(this)
    this._onResize = this._onResize.bind(this)

    canvas.addEventListener("mousemove", this._onMouseMove)
    canvas.addEventListener("mouseleave", this._onMouseLeave)
    canvas.addEventListener("click", this._onClick)
    this.ro = new ResizeObserver(this._onResize)
    this.ro.observe(canvas)

    this._resize()
    this.requestFrame()
  }

  destroy() {
    this.running = false
    this.canvas.removeEventListener("mousemove", this._onMouseMove)
    this.canvas.removeEventListener("mouseleave", this._onMouseLeave)
    this.canvas.removeEventListener("click", this._onClick)
    this.ro?.disconnect()
    if (this.raf) cancelAnimationFrame(this.raf)
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect()
    const size = Math.max(1, Math.min(rect.width, rect.height))
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1)
    this.canvas.width = Math.max(1, Math.round(size * this.dpr))
    this.canvas.height = Math.max(1, Math.round(size * this.dpr))
    this.cx = this.canvas.width / 2
    this.cy = this.canvas.height / 2
    this.maxR = (this.canvas.width / 2) * 0.93
    this.innerHole = this.maxR * 0.33
    this._applyRadiiToTargets()
  }

  _onResize() {
    this._resize()
    this.requestFrame()
  }

  _radiiForDepth(depth: number) {
    const rings = this.options.rings
    const gap = this.options.ringGap * this.maxR
    const usable = this.maxR - this.innerHole - gap * (rings - 1)
    const ringW = usable / rings
    const d = Math.min(depth, rings - 1)
    return {
      inner: this.innerHole + d * (ringW + gap),
      outer: this.innerHole + d * (ringW + gap) + ringW,
    }
  }

  _applyRadiiToTargets() {
    for (const s of this.segments) {
      const r = this._radiiForDepth(s.depth)
      s.toInner = r.inner
      s.toOuter = r.outer
      if (this.animT >= 1) {
        s.inner = r.inner
        s.outer = r.outer
        s.fromInner = r.inner
        s.fromOuter = r.outer
      }
    }
  }

  setData(rootNode: SunNode, viewNode: SunNode | null = null) {
    this.root = rootNode
    this.viewNode = viewNode || rootNode
    this._transitionTo(this.viewNode, "enter")
  }

  navigateTo(node: SunNode) {
    if (!node) return
    this.viewNode = node
    this.hovered = null
    this.selectedPath = null
    this._transitionTo(node, "drill")
  }

  goUp(): SunNode | null {
    if (!this.viewNode || !this.root) return null
    const parent = this._findParent(this.root, this.viewNode.path)
    if (!parent) return null
    this.viewNode = parent
    this.hovered = null
    this.selectedPath = null
    this._transitionTo(parent, "up")
    return parent
  }

  _findParent(node: SunNode, targetPath: string): SunNode | null {
    for (const child of node.children ?? []) {
      if (child.path === targetPath) return node
      const found = this._findParent(child, targetPath)
      if (found) return found
    }
    return null
  }

  setHighlight(path: string | null) {
    this.highlightPath = path
    this.requestFrame()
  }

  setSelected(path: string | null) {
    this.selectedPath = path
    this.requestFrame()
  }

  /**
   * Seamless transition: match segments by path id across levels. Unmatched old
   * segments collapse inward; new ones expand from the center wedge.
   */
  _transitionTo(node: SunNode, mode: "enter" | "drill" | "up") {
    const startAngle = -Math.PI / 2
    const endAngle = startAngle + Math.PI * 2
    const layout: LayoutSeg[] = []
    layoutTree(node, 0, startAngle, endAngle, 0, layout, this.options.rings)

    const prevById = new Map(
      this.segments.filter((s) => s.depth === 0 || s.toOpacity > 0).map((s) => [s.id, s]),
    )
    const next: Segment[] = []

    for (const L of layout) {
      const r = this._radiiForDepth(L.depth)
      const prev = prevById.get(L.id)
      const isPrimary = L.depth === 0
      const targetOp = isPrimary ? 1 : 0.5
      const base = baseForDepth(L.depth)

      let fromStart: number
      let fromEnd: number
      let fromInner: number
      let fromOuter: number
      let fromOp: number

      if (prev && mode !== "enter") {
        fromStart = prev.start
        fromEnd = prev.end
        fromInner = prev.inner
        fromOuter = prev.outer
        fromOp = prev.opacity
        prevById.delete(L.id)
      } else if (mode === "drill") {
        const mid = (L.start + L.end) / 2
        fromStart = mid
        fromEnd = mid
        fromInner = this.innerHole * 0.85
        fromOuter = this.innerHole * 0.85
        fromOp = 0
      } else if (mode === "up") {
        fromStart = L.start
        fromEnd = L.end
        fromInner = this.maxR * 0.92
        fromOuter = this.maxR
        fromOp = 0
      } else {
        const mid = (L.start + L.end) / 2
        fromStart = mid
        fromEnd = mid
        fromInner = 0
        fromOuter = 0
        fromOp = 0
      }

      next.push({
        id: L.id,
        node: L.node,
        depth: L.depth,
        hue: L.hue,
        colorCss: oklchCss(base.L, base.C, L.hue),
        path: L.path,
        fromStart,
        fromEnd,
        fromInner,
        fromOuter,
        fromOpacity: fromOp,
        toStart: L.start,
        toEnd: L.end,
        toInner: r.inner,
        toOuter: r.outer,
        toOpacity: targetOp,
        start: fromStart,
        end: fromEnd,
        inner: fromInner,
        outer: fromOuter,
        opacity: fromOp,
        hover: 0,
        targetHover: 0,
      })
    }

    // Orphan previous segments collapse toward center (drill) or outer (up).
    for (const [, prev] of prevById) {
      if (prev.depth > 0 && prev.toOpacity < 0.3) continue
      const mid = (prev.start + prev.end) / 2
      next.push({
        ...prev,
        fromStart: prev.start,
        fromEnd: prev.end,
        fromInner: prev.inner,
        fromOuter: prev.outer,
        fromOpacity: prev.opacity,
        toStart: mid,
        toEnd: mid,
        toInner: mode === "up" ? this.maxR : this.innerHole * 0.5,
        toOuter: mode === "up" ? this.maxR : this.innerHole * 0.5,
        toOpacity: 0,
        start: prev.start,
        end: prev.end,
        inner: prev.inner,
        outer: prev.outer,
        opacity: prev.opacity,
        hover: 0,
        targetHover: 0,
      })
    }

    this.segments = next
    this.animStart = performance.now()
    this.animT = 0
    this.animating = true
    this.entering = mode === "enter"
    this.pulseT = 0
    this.requestFrame()
  }

  _tick(now: number) {
    if (this.animating) {
      this.animT = Math.min(1, (now - this.animStart) / this.options.animMs)
      const e = easeOutExpo(this.animT)
      for (const s of this.segments) {
        s.start = lerpAngle(s.fromStart, s.toStart, e)
        s.end = lerpAngle(s.fromEnd, s.toEnd, e)
        s.inner = lerp(s.fromInner, s.toInner, e)
        s.outer = lerp(s.fromOuter, s.toOuter, e)
        s.opacity = lerp(s.fromOpacity, s.toOpacity, e)
      }
      if (this.animT >= 1) {
        this.animating = false
        this.segments = this.segments.filter((s) => s.toOpacity > 0.01)
        for (const s of this.segments) {
          s.start = s.toStart
          s.end = s.toEnd
          s.inner = s.toInner
          s.outer = s.toOuter
          s.opacity = s.toOpacity
          s.fromStart = s.start
          s.fromEnd = s.end
          s.fromInner = s.inner
          s.fromOuter = s.outer
          s.fromOpacity = s.opacity
        }
      }
    }

    if (this.entering) {
      this.pulseT = Math.min(1, this.pulseT + 0.018)
      if (this.pulseT >= 1 && !this.animating) this.entering = false
    }

    // Hover spring (primary ring only)
    for (const s of this.segments) {
      if (s.depth !== 0) continue
      const target = this.highlightPath === s.path || this.hovered?.path === s.path ? 1 : 0
      s.targetHover = target
      s.hover = lerp(s.hover, s.targetHover, 0.22)
    }
  }

  private running = false

  /** Schedule a frame iff one isn't already pending. Idempotent — call from every state change. */
  private requestFrame() {
    if (this.running) return
    this.running = true
    this.raf = requestAnimationFrame((t) => this._frame(t))
  }

  private _frame(t: number) {
    this._tick(t)
    this._draw()
    if (this._needsFrame()) {
      this.raf = requestAnimationFrame((n) => this._frame(n))
    } else {
      this.running = false
      this.raf = null
    }
  }

  /** True when there is animation, an enter pulse, or an unsettled hover spring. */
  private _needsFrame(): boolean {
    if (this.animating || this.entering) return true
    for (const s of this.segments) {
      if (s.depth === 0 && Math.abs(s.hover - s.targetHover) > 0.001) return true
    }
    return false
  }

  _draw() {
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    ctx.clearRect(0, 0, w, h)

    // Soft outer halo
    ctx.save()
    ctx.beginPath()
    ctx.arc(this.cx, this.cy, this.maxR + 3 * this.dpr, 0, Math.PI * 2)
    ctx.strokeStyle = oklchCss(0.7, 0.06, 260, 0.16)
    ctx.lineWidth = 2 * this.dpr
    ctx.stroke()
    ctx.restore()

    // Outer ring faint track
    ctx.beginPath()
    ctx.arc(this.cx, this.cy, this.maxR, 0, Math.PI * 2)
    ctx.strokeStyle = oklchCss(0.6, 0.01, 0, 0.12)
    ctx.lineWidth = 1 * this.dpr
    ctx.stroke()

    // Draw deeper rings first so primary hover lift sits on top.
    const sorted = [...this.segments].sort((a, b) => b.depth - a.depth)
    for (const s of sorted) {
      if (s.opacity < 0.008) continue
      this._drawSegment(s)
    }

    // Center disc — theme background with subtle radial wash
    const bg = this._cssVar("--background-base") || "#0c0c14"
    const surface = this._cssVar("--surface-panel") || this._cssVar("--surface-base") || bg
    ctx.beginPath()
    ctx.arc(this.cx, this.cy, this.innerHole - 1, 0, Math.PI * 2)
    const grd = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.innerHole)
    grd.addColorStop(0, surface)
    grd.addColorStop(1, bg)
    ctx.fillStyle = grd
    ctx.fill()

    ctx.beginPath()
    ctx.arc(this.cx, this.cy, this.innerHole - 1, 0, Math.PI * 2)
    ctx.strokeStyle = "rgba(255,255,255,0.08)"
    ctx.lineWidth = 1.5 * this.dpr
    ctx.stroke()

    // Enter pulse ring
    if (this.entering && this.pulseT < 1) {
      const p = easeOutCubic(this.pulseT)
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, lerp(this.innerHole * 0.4, this.maxR * 1.02, p), 0, Math.PI * 2)
      ctx.strokeStyle = oklchCss(0.78, 0.13, 265, 1 - p)
      ctx.lineWidth = (4 * (1 - p) + 1) * this.dpr
      ctx.stroke()
    }
  }

  _drawSegment(s: Segment) {
    const ctx = this.ctx
    const pad = this.options.padAngle
    const start = s.start + pad
    const end = s.end - pad
    if (end - start < 0.0008) return

    const base = baseForDepth(s.depth)
    const isPrimary = s.depth === 0
    const isHi = isPrimary && s.hover > 0.02
    const isSel = isPrimary && this.selectedPath === s.path
    const dimOthers = isPrimary && this.hovered && this.hovered.path !== s.path && !this.highlightPath
    const dimHi = isPrimary && this.highlightPath && this.highlightPath !== s.path

    const lift = isPrimary ? s.hover * 7 * this.dpr : 0
    const inner = Math.max(0, s.inner - lift * 0.25)
    const outer = s.outer + lift
    const alpha = s.opacity * (dimOthers || dimHi ? 0.34 : 1)

    const L = base.L + (isHi ? 0.04 : 0)
    const C = base.C + (isHi ? 0.03 : 0)

    ctx.save()
    ctx.globalAlpha = alpha

    const mid = (start + end) / 2
    const gr = (inner + outer) / 2
    const gx = this.cx + Math.cos(mid) * gr
    const gy = this.cy + Math.sin(mid) * gr
    const grad = ctx.createRadialGradient(gx, gy, 0, this.cx, this.cy, Math.max(1, outer))
    grad.addColorStop(0, oklchCss(Math.min(0.92, L + 0.1), C, s.hue))
    grad.addColorStop(0.5, oklchCss(L, C, s.hue))
    grad.addColorStop(1, oklchCss(Math.max(0.2, L - 0.16), Math.max(0.02, C - 0.04), s.hue))

    ctx.beginPath()
    ctx.arc(this.cx, this.cy, outer, start, end)
    ctx.arc(this.cx, this.cy, inner, end, start, true)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    if (isPrimary) {
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, outer - 0.5 * this.dpr, start, end)
      ctx.strokeStyle = `rgba(255,255,255,${0.1 + s.hover * 0.3})`
      ctx.lineWidth = (1 + s.hover) * this.dpr
      ctx.stroke()
    }

    if (isSel) {
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, outer + 3.5 * this.dpr, start, end)
      ctx.strokeStyle = "rgba(255,255,255,0.8)"
      ctx.lineWidth = 2.2 * this.dpr
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, outer + 3.5 * this.dpr, start, end)
      ctx.strokeStyle = oklchCss(L, C, s.hue, 0.4)
      ctx.lineWidth = 5 * this.dpr
      ctx.stroke()
    }

    if (isHi && isPrimary) {
      ctx.shadowColor = oklchCss(L, C, s.hue)
      ctx.shadowBlur = 22 * this.dpr * s.hover
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, outer, start, end)
      ctx.arc(this.cx, this.cy, inner, end, start, true)
      ctx.closePath()
      ctx.fillStyle = `rgba(255,255,255,${0.06 * s.hover})`
      ctx.fill()
      ctx.shadowBlur = 0
    }

    ctx.restore()
  }

  _cssVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }

  _hitTest(mx: number, my: number) {
    const rect = this.canvas.getBoundingClientRect()
    const x = (mx - rect.left) * (this.canvas.width / rect.width)
    const y = (my - rect.top) * (this.canvas.height / rect.height)
    const dx = x - this.cx
    const dy = y - this.cy
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < this.innerHole) return { type: "center" as const }
    if (dist > this.maxR + 4 * this.dpr) return null

    const angle = Math.atan2(dy, dx)
    const segs = this.segments.filter((s) => s.depth === 0 && s.opacity > 0.25)
    for (const s of segs) {
      let a = angle
      let start = s.start
      let end = s.end
      if (end < start) end += Math.PI * 2
      if (a < start) a += Math.PI * 2
      if (a >= start && a <= end) return { type: "segment" as const, segment: s }
    }
    return null
  }

  _onMouseMove(e: MouseEvent) {
    const hit = this._hitTest(e.clientX, e.clientY)
    const prev = this.hovered
    if (!hit || hit.type === "center") {
      this.hovered = null
      this.canvas.style.cursor = hit?.type === "center" && this._canGoUp() ? "pointer" : "default"
      if (prev) this.options.onHover?.(null)
      this.requestFrame()
      return
    }
    this.hovered = hit.segment
    this.canvas.style.cursor = hit.segment.node.isDir ? "pointer" : "grab"
    if (prev?.path !== hit.segment.path) this.options.onHover?.(hit.segment)
    this.requestFrame()
  }

  _onMouseLeave() {
    this.hovered = null
    this.canvas.style.cursor = "default"
    this.options.onHover?.(null)
    this.requestFrame()
  }

  _canGoUp() {
    return !!(this.viewNode && this.root && this.viewNode.path !== this.root.path)
  }

  _onClick(e: MouseEvent) {
    const hit = this._hitTest(e.clientX, e.clientY)
    if (!hit) return
    if (hit.type === "center") {
      this.options.onCenterClick?.()
      return
    }
    this.selectedPath = hit.segment.path
    this.options.onClick?.(hit.segment)
    this.requestFrame()
  }

  getViewNode() {
    return this.viewNode
  }

  getPrimarySegments(): Segment[] {
    return this.segments
      .filter((s) => s.depth === 0 && s.toOpacity > 0.5)
      .sort((a, b) => b.node.size - a.node.size)
  }
}

export function isDiskScanNode(n: unknown): n is DiskScanNode {
  return typeof n === "object" && n !== null && "path" in n && "size" in n && "children" in n
}
