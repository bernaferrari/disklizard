/**
 * DiskLizard Sunburst — the visual centerpiece.
 *
 * Concentric ring map (DaisyDisk-style) with seamless morph transitions between
 * levels. Colors are picked in OKLCH space (perceptually uniform) then converted
 * to sRGB for crisp flat canvas fills. A ResizeObserver keeps it pixel-perfect
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
  maxSegments?: number
  padAngle?: number
  ringGap?: number
  /** Repeated drill/up motion. Keep this short enough for rapid exploration. */
  animMs?: number
  /** One-time reveal after a scan. This can be slightly more expressive. */
  enterAnimMs?: number
  onHover?: (seg: Segment | null) => void
  onClick?: (seg: Segment) => void
  onMetaClick?: (seg: Segment) => void
  onDoubleClick?: (seg: Segment) => void
  onCenterClick?: () => void
  /** Whether a segment can be dragged into the cleanup basket. */
  canDrag?: (node: SunNode) => boolean
}

export type SunburstTransitionMode = "enter" | "drill" | "up" | "update"
export type SunburstEntryIntent = "scan-complete" | "pointer" | "keyboard"

/** Reserve the expressive reveal for scan completion; repeated mode switches must feel immediate. */
export function sunburstEntryDuration(intent: SunburstEntryIntent, navigationMs = 240, revealMs = 340) {
  if (intent === "keyboard") return 1
  return intent === "pointer" ? navigationMs : revealMs
}

export function shouldPulseSunburstEntry(mode: SunburstTransitionMode, reducedMotion: boolean, instant: boolean) {
  return mode === "enter" && !reducedMotion && !instant
}

export function sunburstTransitionDuration(
  mode: SunburstTransitionMode,
  reducedMotion: boolean,
  navigationMs = 240,
  enterMs = 340,
  instant = false,
) {
  if (reducedMotion || instant) return 1
  return mode === "enter" ? enterMs : navigationMs
}

/** Pick colors in perceptual OKLCH space; render oklch() directly (Chromium 111+). */
function oklchCss(L: number, C: number, hDeg: number, alpha = 1): string {
  const h = ((hDeg % 360) + 360) % 360
  return alpha >= 1
    ? `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)})`
    : `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h.toFixed(1)} / ${alpha})`
}

/** One chromatic family carried through depth; hierarchy comes from measured lightness. */
function baseForDepth(depth: number): { L: number; C: number } {
  if (depth === 0) return { L: 0.7, C: 0.115 }
  if (depth === 1) return { L: 0.65, C: 0.095 }
  if (depth === 2) return { L: 0.6, C: 0.078 }
  return { L: 0.55, C: 0.06 }
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
export function safeCanvasRadius(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

/** A segment below this angle would be less than one visible device pixel in the normal map shell. */
export const MIN_VISIBLE_SEGMENT_ANGLE = 0.0016

function collapseVisualChildren(node: SunNode, maxChildren: number, parentSpan: number): SunNode[] {
  const children = (node.children ?? []).filter((child) => child.size > 0)
  if (maxChildren < 2) {
    return [
      {
        name: `${children.length} smaller items`,
        path: `disklizard:orbit-more:${node.path}`,
        size: children.reduce((sum, child) => sum + child.size, 0),
        isDir: true,
        isOther: true,
        children: [],
        ext: "",
      },
    ]
  }
  const sorted = children.toSorted((a, b) => b.size - a.size)
  const total = sorted.reduce((sum, child) => sum + child.size, 0)
  const kept = sorted
    .slice(0, maxChildren - 1)
    .filter((child) => parentSpan * (child.size / total) >= MIN_VISIBLE_SEGMENT_ANGLE)
  const keptPaths = new Set(kept.map((child) => child.path))
  const remainder = sorted.filter((child) => !keptPaths.has(child.path))
  if (!remainder.length) return kept
  return [
    ...kept,
    {
      name: `${remainder.length} smaller items`,
      path: `disklizard:orbit-more:${node.path}`,
      size: remainder.reduce((sum, child) => sum + child.size, 0),
      isDir: true,
      isOther: true,
      children: [],
      ext: "",
    },
  ]
}

// ── Layout: assign angular spans + OKLCH hues recursively ────────────────────

export type LayoutSeg = {
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
  startAngle: number,
  endAngle: number,
  out: LayoutSeg[],
  rings: number,
  maxSegments: number,
) {
  type Parent = { node: SunNode; depth: number; start: number; end: number; hue: number }
  let level: Parent[] = [{ node, depth: 0, start: startAngle, end: endAngle, hue: 0 }]

  // Breadth-first layout guarantees that every visible parent ring is complete
  // before detail is spent on a deeper ring. The hard budget keeps canvas paint
  // predictable even for pathological trees with tens of thousands of branches.
  while (level.length && out.length < maxSegments) {
    const next: Parent[] = []
    for (const parent of level) {
      const remainingBudget = maxSegments - out.length
      // A storage map should reveal hierarchy, not reproduce every inode as a
      // hairline. Keep the largest branches legible and roll the long tail into
      // one truthful aggregate that remains available in the list.
      const perBranchLimit = parent.depth === 0 ? 120 : 40
      const children = collapseVisualChildren(parent.node, Math.min(perBranchLimit, remainingBudget), parent.end - parent.start)
      if (!children?.length) continue
      const total = children.reduce((sum, child) => sum + Math.max(0, child.size || 0), 0)
      if (total === 0) continue

      const span = parent.end - parent.start
      let angle = parent.start
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (!child.size || child.size <= 0) continue
        const segmentSpan = span * (child.size / total)
        const segmentStart = angle
        angle += segmentSpan
        if (out.length >= maxSegments) return

        // Hue is keyed to the original child index so the index and map stay synced.
        const hue = parent.depth === 0 ? primaryHueForIndex(i) : parent.hue

        out.push({
          id: child.path,
          node: child,
          depth: parent.depth,
          hue,
          start: segmentStart,
          end: angle,
          path: child.path,
        })

        if (parent.depth < rings - 1 && child.isDir && !child.isOther && child.children?.length) {
          next.push({ node: child, depth: parent.depth + 1, start: segmentStart, end: angle, hue })
        }
      }
    }
    level = next
  }
}

export function layoutSunburstSegments(node: SunNode, rings = 3, maxSegments = 720): LayoutSeg[] {
  const result: LayoutSeg[] = []
  layoutTree(node, -Math.PI / 2, Math.PI * 1.5, result, rings, maxSegments)
  return result
}

const PRIMARY_HUES = [252, 318, 32, 205, 342, 66, 276, 15, 224, 292] as const

/** A curated spectral sequence keeps large neighboring branches vivid and distinguishable. */
export function primaryHueForIndex(i: number): number {
  return PRIMARY_HUES[((i % PRIMARY_HUES.length) + PRIMARY_HUES.length) % PRIMARY_HUES.length]
}

/**
 * Folder hues are positional, never a safety verdict. Files intentionally recede
 * into a neutral treatment so the map exposes hierarchy before decoration.
 */
export function primarySegmentColor(i: number, alpha = 1, isDir = true): string {
  if (!isDir) return alpha >= 1 ? "oklch(0.56 0.018 255)" : `oklch(0.56 0.018 255 / ${alpha})`
  const hue = primaryHueForIndex(i)
  return alpha >= 1 ? `oklch(0.7 0.115 ${hue.toFixed(1)})` : `oklch(0.7 0.115 ${hue.toFixed(1)} / ${alpha})`
}

// ── The engine ───────────────────────────────────────────────────────────────

export class Sunburst {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  options: Required<
    Pick<SunburstOptions, "rings" | "maxSegments" | "padAngle" | "ringGap" | "animMs" | "enterAnimMs">
  > &
    SunburstOptions

  root: SunNode | null = null
  viewNode: SunNode | null = null
  segments: Segment[] = []
  hovered: Segment | null = null
  selectedPath: string | null = null
  highlightPath: string | null = null

  animT = 1
  animStart = 0
  activeAnimMs = 240
  animating = false
  entering = false
  pulseT = 0
  lastFrame = 0

  dpr = 1
  cx = 0
  cy = 0
  maxR = 0
  innerHole = 0
  raf: number | null = null
  ro: ResizeObserver | null = null
  themeObserver: MutationObserver | null = null
  motionQuery: MediaQueryList
  reducedMotion = false
  theme = { background: "#0c0c14", surface: "#0c0c14", border: "rgba(127,127,127,0.16)" }
  suppressClickUntil = 0

  constructor(canvas: HTMLCanvasElement, options: SunburstOptions = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext("2d", { alpha: true })!
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    this.reducedMotion = this.motionQuery.matches
    this.options = {
      rings: 4,
      maxSegments: 560,
      padAngle: 0.0016,
      ringGap: 0.004,
      animMs: 240,
      enterAnimMs: 340,
      ...options,
    }

    canvas.addEventListener("pointermove", this._onMouseMove)
    canvas.addEventListener("pointerleave", this._onMouseLeave)
    canvas.addEventListener("click", this._onClick)
    canvas.addEventListener("dblclick", this._onDoubleClick)
    this.motionQuery.addEventListener("change", this._onMotionPreference)
    this.ro = new ResizeObserver(this._onResize)
    this.ro.observe(canvas)
    this.themeObserver = new MutationObserver(() => {
      this._refreshTheme()
      this.requestFrame()
    })
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    })

    this._refreshTheme()
    this._resize()
    this.requestFrame()
  }

  destroy() {
    this.running = false
    this.canvas.removeEventListener("pointermove", this._onMouseMove)
    this.canvas.removeEventListener("pointerleave", this._onMouseLeave)
    this.canvas.removeEventListener("click", this._onClick)
    this.canvas.removeEventListener("dblclick", this._onDoubleClick)
    this.motionQuery.removeEventListener("change", this._onMotionPreference)
    this.ro?.disconnect()
    this.themeObserver?.disconnect()
    if (this.raf) cancelAnimationFrame(this.raf)
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect()
    const size = Math.max(1, Math.min(rect.width, rect.height))
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.max(1, Math.round(size * this.dpr))
    this.canvas.height = Math.max(1, Math.round(size * this.dpr))
    this.cx = this.canvas.width / 2
    this.cy = this.canvas.height / 2
    this.maxR = (this.canvas.width / 2) * 0.93
    this.innerHole = this.maxR * 0.255
    this._applyRadiiToTargets()
  }

  private _onResize = () => {
    this._resize()
    this.requestFrame()
  }

  private _onMotionPreference = (event: MediaQueryListEvent) => {
    this.reducedMotion = event.matches
    if (event.matches) {
      this.activeAnimMs = 1
      this.entering = false
      if (this.animating) this.animStart = performance.now() - 1
      for (const segment of this.segments) segment.hover = segment.targetHover
    }
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

  setData(rootNode: SunNode, viewNode: SunNode | null = null, instant = false) {
    this.root = rootNode
    this.viewNode = viewNode || rootNode
    this._transitionTo(this.viewNode, "enter", instant)
  }

  /** Reconcile a changed scan in place so remaining segments keep spatial continuity. */
  updateData(rootNode: SunNode, viewNode: SunNode | null = null) {
    this.root = rootNode
    this.viewNode = viewNode || rootNode
    this.hovered = null
    this.selectedPath = null
    this._transitionTo(this.viewNode, "update")
  }

  navigateTo(node: SunNode, instant = false) {
    if (!node) return
    this.viewNode = node
    this.hovered = null
    this.selectedPath = null
    this._transitionTo(node, "drill", instant)
  }

  goUp(instant = false): SunNode | null {
    if (!this.viewNode || !this.root) return null
    const parent = this._findParent(this.root, this.viewNode.path)
    if (!parent) return null
    this.viewNode = parent
    this.hovered = null
    this.selectedPath = null
    this._transitionTo(parent, "up", instant)
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

  suppressNextClick() {
    this.suppressClickUntil = performance.now() + 350
  }

  /**
   * Seamless transition: match segments by path id across levels. Unmatched old
   * segments collapse inward; new ones expand from the center wedge.
   */
  _transitionTo(node: SunNode, mode: SunburstTransitionMode, instant = false) {
    const layout = layoutSunburstSegments(node, this.options.rings, this.options.maxSegments)

    const prevById = new Map(this.segments.filter((s) => s.depth === 0 || s.toOpacity > 0).map((s) => [s.id, s]))
    const next: Segment[] = []

    for (const L of layout) {
      const r = this._radiiForDepth(L.depth)
      const prev = prevById.get(L.id)
      const isPrimary = L.depth === 0
      const targetOp = isPrimary ? 1 : Math.max(0.7, 0.92 - L.depth * 0.07)

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

    this.segments = next.sort((a, b) => b.depth - a.depth)
    this.animStart = performance.now()
    this.activeAnimMs = sunburstTransitionDuration(
      mode,
      this.reducedMotion,
      this.options.animMs,
      this.options.enterAnimMs,
      instant,
    )
    this.animT = 0
    this.animating = true
    this.entering = shouldPulseSunburstEntry(mode, this.reducedMotion, instant)
    this.pulseT = 0
    this.requestFrame()
  }

  _tick(now: number) {
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 1 / 60
    this.lastFrame = now
    if (this.animating) {
      this.animT = Math.min(1, (now - this.animStart) / this.activeAnimMs)
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
      this.pulseT = Math.min(1, (now - this.animStart) / 850)
      if (this.pulseT >= 1 && !this.animating) this.entering = false
    }

    // Every visible ring is inspectable; depth is information, not decoration.
    const hoverBlend = 1 - Math.exp(-dt / 0.07)
    for (const s of this.segments) {
      const target = this.highlightPath === s.path || this.hovered?.path === s.path ? 1 : 0
      s.targetHover = target
      s.hover = this.reducedMotion ? target : lerp(s.hover, s.targetHover, hoverBlend)
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
      this.lastFrame = 0
    }
  }

  /** True when there is animation, an enter pulse, or an unsettled hover spring. */
  private _needsFrame(): boolean {
    if (this.animating || this.entering) return true
    for (const s of this.segments) {
      if (Math.abs(s.hover - s.targetHover) > 0.001) return true
    }
    return false
  }

  _draw() {
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    ctx.clearRect(0, 0, w, h)

    // Quiet outer boundary; the data carries the color.
    ctx.beginPath()
    ctx.arc(this.cx, this.cy, safeCanvasRadius(this.maxR), 0, Math.PI * 2)
    ctx.strokeStyle = oklchCss(0.6, 0.01, 0, 0.12)
    ctx.lineWidth = 1 * this.dpr
    ctx.stroke()

    // Draw deeper rings first so primary hover lift sits on top.
    for (const s of this.segments) {
      if (s.opacity < 0.008) continue
      this._drawSegment(s)
    }

    // Center disc stays flat so labels remain the focal point.
    const surface = this.theme.surface
    ctx.beginPath()
    ctx.arc(this.cx, this.cy, safeCanvasRadius(this.innerHole - 1), 0, Math.PI * 2)
    ctx.fillStyle = surface
    ctx.fill()

    ctx.beginPath()
    ctx.arc(this.cx, this.cy, safeCanvasRadius(this.innerHole - 1), 0, Math.PI * 2)
    ctx.strokeStyle = this.theme.border
    ctx.lineWidth = 1 * this.dpr
    ctx.stroke()

    // Enter pulse ring
    if (this.entering && this.pulseT < 1) {
      const p = easeOutCubic(this.pulseT)
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, safeCanvasRadius(lerp(this.innerHole * 0.4, this.maxR * 1.02, p)), 0, Math.PI * 2)
      ctx.strokeStyle = oklchCss(0.78, 0.11, 176, 1 - p)
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
    const isHi = s.hover > 0.02
    const isSel = this.selectedPath === s.path
    const dimOthers = this.hovered && this.hovered.path !== s.path && !this.highlightPath
    const dimHi = this.highlightPath && this.highlightPath !== s.path

    const lift = s.hover * (isPrimary ? 6 : 3) * this.dpr
    const inner = safeCanvasRadius(s.inner - lift * 0.25)
    const outer = safeCanvasRadius(s.outer + lift)
    const alpha = s.opacity * (dimOthers ? 0.58 : dimHi ? 0.68 : 1)

    const L = (s.node.isDir ? base.L : 0.54 - Math.min(s.depth, 2) * 0.035) + (isHi ? 0.04 : 0)
    const C = (s.node.isDir ? base.C : 0.018) + (isHi ? 0.018 : 0)

    ctx.save()
    ctx.globalAlpha = alpha

    ctx.beginPath()
    ctx.arc(this.cx, this.cy, outer, start, end)
    ctx.arc(this.cx, this.cy, inner, end, start, true)
    ctx.closePath()
    ctx.fillStyle = oklchCss(L, C, s.hue)
    ctx.fill()

    // A true separator, not a glow: storage branches stay readable at high density.
    ctx.strokeStyle = this.theme.background
    ctx.lineWidth = 0.8 * this.dpr
    ctx.stroke()

    if (isPrimary) {
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, safeCanvasRadius(outer - 0.5 * this.dpr), start, end)
      ctx.strokeStyle = `rgba(255,255,255,${0.1 + s.hover * 0.3})`
      ctx.lineWidth = (1 + s.hover) * this.dpr
      ctx.stroke()
    }

    if (isSel) {
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, safeCanvasRadius(outer + 3.5 * this.dpr), start, end)
      ctx.strokeStyle = "rgba(255,255,255,0.86)"
      ctx.lineWidth = 2 * this.dpr
      ctx.stroke()
    }

    ctx.restore()
  }

  _refreshTheme() {
    const style = getComputedStyle(document.documentElement)
    const background = style.getPropertyValue("--background-base").trim() || "#0c0c14"
    this.theme = {
      background,
      surface:
        style.getPropertyValue("--surface-panel").trim() ||
        style.getPropertyValue("--surface-base").trim() ||
        background,
      border: style.getPropertyValue("--border-weaker-base").trim() || "rgba(127,127,127,0.16)",
    }
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
    for (const s of this.segments) {
      if (s.opacity <= 0.25 || dist < s.inner - 3 * this.dpr || dist > s.outer + 4 * this.dpr) continue
      let a = angle
      let start = s.start
      let end = s.end
      if (end < start) end += Math.PI * 2
      if (a < start) a += Math.PI * 2
      if (a >= start && a <= end) return { type: "segment" as const, segment: s }
    }
    return null
  }

  private _onMouseMove = (e: PointerEvent) => {
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
    this.canvas.style.cursor = this.options.canDrag?.(hit.segment.node)
      ? "grab"
      : hit.segment.node.isDir
        ? "pointer"
        : "default"
    if (prev?.path !== hit.segment.path) this.options.onHover?.(hit.segment)
    this.requestFrame()
  }

  private _onMouseLeave = () => {
    this.hovered = null
    this.canvas.style.cursor = "default"
    this.options.onHover?.(null)
    this.requestFrame()
  }

  _canGoUp() {
    return !!(this.viewNode && this.root && this.viewNode.path !== this.root.path)
  }

  private _onClick = (e: MouseEvent) => {
    if (performance.now() < this.suppressClickUntil) return
    const hit = this._hitTest(e.clientX, e.clientY)
    if (!hit) return
    if (hit.type === "center") {
      this.options.onCenterClick?.()
      return
    }
    if (e.metaKey || e.ctrlKey) {
      this.options.onMetaClick?.(hit.segment)
      return
    }
    this.selectedPath = hit.segment.path
    this.options.onClick?.(hit.segment)
    this.requestFrame()
  }

  private _onDoubleClick = (e: MouseEvent) => {
    if (performance.now() < this.suppressClickUntil) return
    const hit = this._hitTest(e.clientX, e.clientY)
    if (!hit || hit.type === "center") return
    this.options.onDoubleClick?.(hit.segment)
  }

  /** Resolve the direct branch under a desktop pointer for native drag-to-collect. */
  nodeAtPoint(clientX: number, clientY: number): SunNode | null {
    const hit = this._hitTest(clientX, clientY)
    return hit?.type === "segment" ? hit.segment.node : null
  }

  getViewNode() {
    return this.viewNode
  }

  getPrimarySegments(): Segment[] {
    return this.segments.filter((s) => s.depth === 0 && s.toOpacity > 0.5).sort((a, b) => b.node.size - a.node.size)
  }
}
