import { withoutCollected } from "./collection-map"
import { createBranchIdentity } from "./tile-identity"
import { STORAGE_HUES, storageTone } from "./visual-palette"
/**
 * DiskLizard Sunburst — the visual centerpiece.
 *
 * Concentric ring map (DaisyDisk-style) with seamless morph transitions between
 * levels. Colors are picked in OKLCH space (perceptually uniform) then converted
 * to sRGB for crisp flat canvas fills. A ResizeObserver keeps it pixel-perfect
 * inside flex panels; a single rAF loop drives the hover springs + animations.
 */

import type { DiskScanNode } from "./types"
import { surfaceRing } from "./ui-tokens"

/** Keep the complete center summary inside the quiet disc at every desktop size. */
const INNER_HOLE_RATIO = 0.29

/** Node shape the engine consumes — identical to DiskScanNode, aliased for seamless interop. */
export type SunNode = DiskScanNode

export type Segment = {
  id: string
  node: SunNode
  depth: number
  hue: number
  path: string
  /** Angular enter stagger (ms) — segments sweep in around the compass. */
  delay: number
  // interpolated pose
  start: number
  end: number
  inner: number
  outer: number
  opacity: number
  hover: number
  targetHover: number
  tone?: { L: number; C: number; h: number }
  fromTone?: { L: number; C: number; h: number }
  toTone?: { L: number; C: number; h: number }
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
export function sunburstEntryDuration(intent: SunburstEntryIntent, navigationMs = 240, revealMs = 560) {
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
  enterMs = 560,
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
// Arc edges share an unwrapped angular domain. Wrapping each edge independently
// makes wide wedges shrink through zero and then snap to a full circle.
const START_ANGLE = -Math.PI / 2
const FULL_CIRCLE = Math.PI * 2
function projectAngle(angle: number, start: number, end: number) {
  return START_ANGLE + Math.max(0, Math.min(1, (angle - start) / Math.max(0.0001, end - start))) * FULL_CIRCLE
}

/** Smaller arcs become hard to distinguish and target in a normal-size window. */
export const MIN_VISIBLE_SEGMENT_ANGLE = 0.008

function collapseVisualChildren(node: SunNode, maxChildren: number, parentSpan: number): SunNode[] {
  const children = (node.children ?? []).filter((child) => child.size > 0)
  if (maxChildren < 2) {
    return [
      {
        name: "",
        path: `disklizard:orbit-more:${node.path}`,
        size: children.reduce((sum, child) => sum + child.size, 0),
        isDir: true,
        isOther: true,
        otherCount: children.length,
        children,
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
      name: "",
      path: `disklizard:orbit-more:${node.path}`,
      size: remainder.reduce((sum, child) => sum + child.size, 0),
      isDir: true,
      isOther: true,
      otherCount: remainder.length,
      children: remainder,
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
      const perBranchLimit = parent.depth === 0 ? 24 : parent.depth === 1 ? 12 : 8
      const children = collapseVisualChildren(
        parent.node,
        Math.min(perBranchLimit, remainingBudget),
        parent.end - parent.start,
      )
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

export function layoutSunburstSegments(node: SunNode, rings = 6, maxSegments = 720): LayoutSeg[] {
  const result: LayoutSeg[] = []
  layoutTree(node, -Math.PI / 2, Math.PI * 1.5, result, rings, maxSegments)
  return result
}

const PRIMARY_HUES = STORAGE_HUES

/** A curated spectral sequence keeps large neighboring branches vivid and distinguishable. */
export function primaryHueForIndex(i: number): number {
  return PRIMARY_HUES[((i % PRIMARY_HUES.length) + PRIMARY_HUES.length) % PRIMARY_HUES.length]
}

/**
 * Folder hues are positional, never a safety verdict. Files carry a dimmed,
 * desaturated tint of their branch hue so the map keeps its chroma while
 * hierarchy still reads before decoration.
 */
export function primarySegmentColor(i: number, alpha = 1, isDir = true, depth = 0): string {
  const hue = primaryHueForIndex(i)
  const { L, C } = storageTone(hue, depth, isDir)
  return alpha >= 1 ? `oklch(${L} ${C} ${hue.toFixed(1)})` : `oklch(${L} ${C} ${hue.toFixed(1)} / ${alpha})`
}
/** Text paired with the segment fills; both branches meet normal-text AA contrast. */
export function primarySegmentForeground(isDir = true): string {
  return "oklch(0.18 0.015 255)"
}

// ── The engine ───────────────────────────────────────────────────────────────

export class Sunburst {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  options: Required<
    Pick<SunburstOptions, "rings" | "maxSegments" | "padAngle" | "ringGap" | "animMs" | "enterAnimMs">
  > &
    SunburstOptions

  excludedPaths = new Set<string>()
  centerHovered = false
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
  /** True while a full-reveal (mode "enter") transition is in flight. */
  private enterMode = false
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
  /** True while a ViewMorph owns the canvas; drawing and pointer handling yield. */
  morphing = false
  theme = {
    background: "#0c0c14",
    surface: "#0c0c14",
    border: "rgba(127,127,127,0.16)",
    ring: "rgba(255,255,255,0.86)",
  }
  /** Cached canvas bounding rect — invalidated by resize/scroll, read lazily in _hitTest. */
  rect: DOMRect | null = null
  lastMoveX = -1
  lastMoveY = -1
  suppressClickUntil = 0

  constructor(canvas: HTMLCanvasElement, options: SunburstOptions = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext("2d", { alpha: true })!
    this.motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    this.reducedMotion = this.motionQuery.matches
    this.options = {
      rings: 6,
      maxSegments: 560,
      padAngle: 0.0016,
      ringGap: 0.004,
      animMs: 240,
      enterAnimMs: 560,
      ...options,
    }
    this.motionQuery.addEventListener("change", this._onMotionPreference)

    canvas.addEventListener("pointermove", this._onMouseMove)
    canvas.addEventListener("pointerleave", this._onMouseLeave)
    canvas.addEventListener("click", this._onClick)
    canvas.addEventListener("dblclick", this._onDoubleClick)
    window.addEventListener("scroll", this._onScroll, { passive: true })
    this.ro = new ResizeObserver(this._onResize)
    this.ro.observe(canvas)
    this.themeObserver = new MutationObserver(() => {
      this._refreshTheme()
      this.requestFrame()
    })
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-color-scheme", "style"],
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
    window.removeEventListener("scroll", this._onScroll)
    this.ro?.disconnect()
    this.themeObserver?.disconnect()
    if (this.raf) cancelAnimationFrame(this.raf)
    this.motionQuery.removeEventListener("change", this._onMotionPreference)
  }

  _resize() {
    const rect = this.canvas.getBoundingClientRect()
    this.rect = rect
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.max(1, Math.round(rect.width * this.dpr))
    this.canvas.height = Math.max(1, Math.round(rect.height * this.dpr))
    this.cx = this.canvas.width / 2
    this.cy = this.canvas.height / 2
    this.maxR = (Math.min(this.canvas.width, this.canvas.height) / 2) * 0.80
    this.innerHole = this.maxR * INNER_HOLE_RATIO
    this._applyRadiiToTargets()
    // Resizing clears the backing store. Native live resize may pause RAF,
    // so restore the current map before returning to the compositor.
    this._draw()
  }

  private _onResize = () => {
    this._resize()
    this.requestFrame()
  }

  private _onScroll = () => {
    this.rect = null
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
    // Taper the outer detail rings while preserving the full radial extent.
    const weights = Array.from({ length: rings }, (_, i) => Math.pow(0.86, i))
    const unit = usable / weights.reduce((sum, weight) => sum + weight, 0)
    const d = Math.min(depth, rings - 1)
    const inner = this.innerHole + unit * weights.slice(0, d).reduce((sum, weight) => sum + weight, 0) + d * gap
    return { inner, outer: inner + weights[d] * unit }
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

  setExcludedPaths(paths: ReadonlySet<string>) {
    if (this.excludedPaths?.size === paths.size && [...paths].every(path => this.excludedPaths.has(path))) return
    this.excludedPaths = new Set(paths)
    if (this.viewNode) this._transitionTo(this.viewNode, "update")
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
    const previousPath = this.viewNode?.path
    const parentPrefix = node.path.replaceAll("\\", "/").replace(/\/+$/, "") + "/"
    const goingUp = !!node.children?.some(child => child.path === previousPath) ||
      !!previousPath?.replaceAll("\\", "/").startsWith(parentPrefix)
    this.viewNode = node
    this.hovered = null
    this.selectedPath = null
    this._transitionTo(node, goingUp ? "up" : "drill", instant, previousPath)
  }

  goUp(instant = false): SunNode | null {
    if (!this.viewNode || !this.root) return null
    const parent = this._findParent(this.root, this.viewNode.path)
    if (!parent) return null
    const previousPath = this.viewNode.path
    this.viewNode = parent
    this.hovered = null
    this.selectedPath = null
    this._transitionTo(parent, "up", instant, previousPath)
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
   * Preserve the visible pose by path, opening the clicked angular domain.
   * Unmatched detail enters at the rim; siblings close toward the domain edges.
   */
  _transitionTo(node: SunNode, mode: SunburstTransitionMode, instant = false, previousPath?: string) {
    const identity = createBranchIdentity(this.root)
    const layout = layoutSunburstSegments(withoutCollected(node, this.excludedPaths ?? new Set()), this.options.rings, this.options.maxSegments)
    for (const segment of layout) {
      const branch = identity(segment.path)
      if (branch) segment.hue = primaryHueForIndex(branch.index)
    }

    const focus = mode === "drill" ? this.segments.find(s => s.path === node.path && s.toOpacity > 0) : undefined
    const destination = mode === "up" ? layout.find(s => s.path === previousPath) : undefined
    // Include still-visible exits when interrupted; keep their actual painted pose.
    const prevById = new Map(this.segments.filter(s => s.opacity > 0.008 || s.toOpacity > 0).map(s => [s.id, s]))
    const next: Segment[] = []

    for (const L of layout) {
      const r = this._radiiForDepth(L.depth)
      const prev = prevById.get(L.id)
      const isPrimary = L.depth === 0
      const targetOp = isPrimary ? 1 : Math.max(0.9, 0.98 - L.depth * 0.016)

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
      } else if (mode === "drill" && focus) {
        // Newly revealed detail grows out of the clicked branch's outer edge.
        const span = focus.end - focus.start
        fromStart = focus.start + (L.start - START_ANGLE) / FULL_CIRCLE * span
        fromEnd = focus.start + (L.end - START_ANGLE) / FULL_CIRCLE * span
        fromInner = this.maxR
        fromOuter = this.maxR
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

      const base = storageTone(L.hue, identity(L.path)?.depth ?? L.depth, L.node.isDir)
      const toTone = { ...base, C: L.node.isOther ? 0.012 : base.C, h: L.hue }
      const fromTone = prev?.tone ?? focus?.tone ?? toTone
      next.push({
        tone: { ...fromTone },
        fromTone: { ...fromTone },
        toTone,
        id: L.id,
        node: L.node,
        depth: L.depth,
        hue: L.hue,
        path: L.path,
        // Angular enter stagger: the reveal sweeps around the compass like a clock.
        delay: mode === "enter" ? (L.start / (Math.PI * 2)) * 220 : 0,
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

    // Close outgoing siblings around the focus, keeping their radial structure.
    const exits = [...prevById.values()].sort((a, b) => b.opacity - a.opacity).slice(0, this.options.maxSegments)
    for (const prev of exits) {
      if (prev.depth > 0 && prev.toOpacity < 0.3) continue
      const mid = (prev.start + prev.end) / 2
      const focusedParent = focus?.path === prev.path
      const toStart = focus ? projectAngle(prev.start, focus.start, focus.end)
        : destination ? destination.start + (prev.start - START_ANGLE) / FULL_CIRCLE * (destination.end - destination.start) : mid
      const toEnd = focus ? projectAngle(prev.end, focus.start, focus.end)
        : destination ? destination.start + (prev.end - START_ANGLE) / FULL_CIRCLE * (destination.end - destination.start) : mid
      next.push({
        ...prev,
        fromTone: prev.tone ? { ...prev.tone } : undefined,
        toTone: prev.tone ? { ...prev.tone } : undefined,
        fromStart: prev.start,
        fromEnd: prev.end,
        fromInner: prev.inner,
        fromOuter: prev.outer,
        fromOpacity: prev.opacity,
        delay: 0,
        toStart,
        toEnd,
        toInner: focusedParent ? 0 : destination ? this.maxR : prev.inner,
        toOuter: focusedParent ? this.innerHole * 0.92 : destination ? this.maxR : prev.outer,
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
    this.enterMode = mode === "enter"
    this.entering = shouldPulseSunburstEntry(mode, this.reducedMotion, instant)
    this.pulseT = 0
    this.requestFrame()
  }

  _tick(now: number) {
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 1 / 60
    this.lastFrame = now
    if (this.animating) {
      this.animT = Math.min(1, (now - this.animStart) / this.activeAnimMs)
      // Enter sweeps in around the compass; every other mode shares one clock.
      const staggered = this.enterMode && !this.reducedMotion
      for (const s of this.segments) {
        const t = staggered
          ? Math.min(1, Math.max(0, (now - this.animStart - s.delay) / this.activeAnimMs))
          : this.animT
        if (t <= 0) {
          s.opacity = 0
          continue
        }
        const e = this.enterMode ? easeOutExpo(t) : easeOutCubic(t)
        s.start = lerp(s.fromStart, s.toStart, e)
        s.end = lerp(s.fromEnd, s.toEnd, e)
        s.inner = lerp(s.fromInner, s.toInner, e)
        s.outer = lerp(s.fromOuter, s.toOuter, e)
        s.opacity = lerp(s.fromOpacity, s.toOpacity, e)
        if (s.tone && s.fromTone && s.toTone) {
          s.tone.L = lerp(s.fromTone.L, s.toTone.L, e)
          s.tone.C = lerp(s.fromTone.C, s.toTone.C, e)
          const hueDelta = ((s.toTone.h - s.fromTone.h + 540) % 360) - 180
          s.tone.h = s.fromTone.h + hueDelta * e
        }
      }
      if (this.animT >= 1) {
        this.animating = false
        this.enterMode = false
        this.segments = this.segments.filter((s) => s.toOpacity > 0.01)
        for (const s of this.segments) {
          if (s.toTone) s.tone = { ...s.toTone }
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
    if (this.morphing) return
    const ctx = this.ctx
    const w = this.canvas.width
    const h = this.canvas.height
    ctx.clearRect(0, 0, w, h)
    if (this.centerHovered) {
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, safeCanvasRadius(this.innerHole * 0.94), 0, Math.PI * 2)
      ctx.fillStyle = "rgba(127,127,127,0.14)"
      ctx.fill()
    }

    // Draw deeper rings first so primary hover lift sits on top.
    for (const s of this.segments) {
      if (s.opacity < 0.008) continue
      this._drawSegment(s)
    }

    // Enter pulse ring
    if (this.entering && this.pulseT < 1) {
      const p = easeOutCubic(this.pulseT)
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, safeCanvasRadius(lerp(this.innerHole * 0.4, this.maxR * 1.02, p)), 0, Math.PI * 2)
      ctx.strokeStyle = oklchCss(0.78, 0.11, 252, 1 - p)
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

    const base = s.tone ?? storageTone(s.hue, s.depth, s.node.isDir)
    const isPrimary = s.depth === 0
    const isHi = s.hover > 0.02
    const L = base.L + (isHi ? 0.025 : 0)
    const C = s.node.isOther ? 0.012 : base.C
    const isSel = this.selectedPath === s.path
    const dimOthers = this.hovered && this.hovered.path !== s.path && !this.highlightPath
    const dimHi = this.highlightPath && this.highlightPath !== s.path

    const lift = s.hover * (isPrimary ? 6 : 3) * this.dpr
    const inner = safeCanvasRadius(s.inner - lift * 0.25)
    const outer = safeCanvasRadius(s.outer + lift)
    const alpha = s.opacity * (dimOthers ? 0.9 : dimHi ? 0.9 : 1)

    ctx.save()
    ctx.globalAlpha = alpha

    ctx.beginPath()
    ctx.arc(this.cx, this.cy, outer, start, end)
    ctx.arc(this.cx, this.cy, inner, end, start, true)
    ctx.closePath()
    ctx.fillStyle = oklchCss(L, C, s.tone?.h ?? s.hue)
    ctx.fill()

    // A true separator, not a glow: storage branches stay readable at high density.
    ctx.strokeStyle = this.theme.border
    ctx.lineWidth = 0.55 * this.dpr
    ctx.stroke()

    if (isPrimary) {
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, safeCanvasRadius(outer - 0.5 * this.dpr), start, end)
      ctx.strokeStyle = `rgba(255,255,255,${0.1 + s.hover * 0.3})`
      ctx.lineWidth = (1 + s.hover) * this.dpr
      ctx.stroke()
    }

    if (isSel) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(this.cx, this.cy, safeCanvasRadius(outer + 2.5 * this.dpr), start, end)
      ctx.shadowColor = this.theme.ring
      ctx.shadowBlur = 6 * this.dpr
      ctx.strokeStyle = this.theme.ring
      ctx.lineWidth = 2.5 * this.dpr
      ctx.stroke()
      ctx.restore()
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
      // Accent ring in the shell's blue family — visible on both themes, never a hard monochrome arc.
      ring: surfaceRing(),
      border: style.getPropertyValue("--border-weaker-base").trim() || "rgba(127,127,127,0.16)",
    }
  }

  _hitTest(mx: number, my: number) {
    const rect = this.rect ?? (this.rect = this.canvas.getBoundingClientRect())
    const x = (mx - rect.left) * (this.canvas.width / rect.width)
    const y = (my - rect.top) * (this.canvas.height / rect.height)
    const dx = x - this.cx
    const dy = y - this.cy
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist < this.innerHole) return { type: "center" as const }
    if (dist > this.maxR + 4 * this.dpr) return null

    const angle = Math.atan2(dy, dx)
    for (const s of this.segments) {
      if (s.toOpacity === 0 || s.opacity <= 0.25 || dist < s.inner - 3 * this.dpr || dist > s.outer + 4 * this.dpr) continue
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
    if (this.morphing) return
    if (e.clientX === this.lastMoveX && e.clientY === this.lastMoveY) return
    this.lastMoveX = e.clientX
    this.lastMoveY = e.clientY
    const hit = this._hitTest(e.clientX, e.clientY)
    const prev = this.hovered
    this.centerHovered = hit?.type === "center" && this._canGoUp()
    let cursor: string
    if (!hit || hit.type === "center") {
      this.hovered = null
      cursor = hit?.type === "center" && this._canGoUp() ? "pointer" : "default"
      if (prev) this.options.onHover?.(null)
    } else {
      this.hovered = hit.segment
      cursor = this.options.canDrag?.(hit.segment.node) ? "grab" : hit.segment.node.isDir ? "pointer" : "default"
      if (prev?.path !== hit.segment.path) this.options.onHover?.(hit.segment)
    }
    // One style write + one frame request per move instead of scattered writes.
    this.canvas.style.cursor = cursor
    this.requestFrame()
  }

  private _onMouseLeave = () => {
    this.centerHovered = false
    this.hovered = null
    this.canvas.style.cursor = "default"
    this.options.onHover?.(null)
    this.requestFrame()
  }

  _canGoUp() {
    return !!(this.viewNode && this.root && this.viewNode.path !== this.root.path)
  }

  private _onClick = (e: MouseEvent) => {
    if (this.morphing) return
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
    if (this.morphing) return
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

  /** Depth-0 wedges visible enough to morph into treemap tiles. */
  morphSegments(): Segment[] {
    return this.segments.filter((s) => s.toOpacity > 0.3).slice(0, 360)
  }

  primarySegments(): Segment[] {
    return this.segments.filter((s) => s.depth === 0 && s.toOpacity > 0.3)
  }

  /** Freeze the last frame while ViewMorph prepares its destination layout. */
  setMorphing(active: boolean) {
    this.morphing = active
    if (active) {
      this.hovered = null
      if (this.raf) cancelAnimationFrame(this.raf)
      this.running = false
      this.raf = null
      return
    }
    this._draw()
    this.requestFrame()
  }
}
