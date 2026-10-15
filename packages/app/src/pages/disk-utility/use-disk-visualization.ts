import { useCallback, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { aggregateTone, toneCss, type createSpectrum } from "./spectrum"
import {
  primaryHueForIndex,
  Sunburst,
  sunburstEntryDuration,
  sunburstSegmentPadding,
  type SunburstEntryIntent,
} from "./sunburst"
import { ViewMorph, type MorphTile } from "./ViewMorph"
import type { DiskScanNode } from "./types"

export type ScanMode = "map" | "grid"
type VisualizationOptions = {
  treeRoot: DiskScanNode | null
  viewNode: DiskScanNode | null
  queuedPaths: string[]
  excludedPaths: ReadonlySet<string>
  spectrum: ReturnType<typeof createSpectrum>
  canDrag(node: DiskScanNode): boolean
  onHover(node: DiskScanNode | null): void
  onActivate(node: DiskScanNode): void
  onUp(): void
  onModeChange(): void
  onKeyboardFocus(mode: ScanMode): void
}

/** Owns the canvas and tile camera. Callers never retain a renderer or animation. */
export function useDiskVisualization(options: VisualizationOptions) {
  const { treeRoot, viewNode, spectrum } = options
  const [scanMode, setScanMode] = useState<ScanMode>("map")
  const orbitEntryIntentRef = useRef<SunburstEntryIntent>("scan-complete")
  const landscapeElRef = useRef<HTMLElement | null>(null)
  const [landscapeEl, setLandscapeEl] = useState<HTMLElement | null>(null)
  /** False while the canvas morph owns the view; the Treemap DOM mounts only when true. */
  const [gridInteractive, setGridInteractive] = useState(false)
  const [gridVisible, setGridVisible] = useState(false)
  const [morphing, setMorphing] = useState(false)
  const morphRef = useRef<ViewMorph | null>(null)
  const gridOverlayRef = useRef<HTMLDivElement | null>(null)
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)
  const sunburstRef = useRef<Sunburst | undefined>(undefined)
  const tileCameraPrepareRef = useRef<((path: string) => void) | null>(null)
  const registerTileCamera = useCallback(
    (prepare: ((path: string) => void) | null) => {
      tileCameraPrepareRef.current = prepare
    },
    []
  )

  /** The morph draws on the sunburst's own canvas; both live and die with it. */
  function ensureMorph(el: HTMLCanvasElement): ViewMorph {
    if (!morphRef.current || morphRef.current.canvas !== el) {
      const ctx = el.getContext("2d", { alpha: true })!
      morphRef.current = new ViewMorph(
        el,
        ctx,
        () => {
          const sb = sunburstRef.current
          return {
            cx: sb?.cx ?? el.width / 2,
            cy: sb?.cy ?? el.height / 2,
            maxR: sb?.maxR ?? 0,
          }
        },
        () => sunburstRef.current?.reducedMotion ?? false
      )
    }
    return morphRef.current
  }

  const viewTransitionVersionRef = useRef(0)
  const queuedModeRef = useRef<ScanMode | null>(null)

  function chooseScanMode(
    mode: ScanMode,
    intent: Exclude<SunburstEntryIntent, "scan-complete"> = "pointer",
    focusContent = true
  ) {
    if (morphing) {
      queuedModeRef.current = mode
      return
    }
    if (mode === scanMode) return
    const version = ++viewTransitionVersionRef.current
    const sb = sunburstRef.current
    const canvas = canvasEl
    const landscape = landscapeElRef.current
    if (
      !sb ||
      !canvas ||
      !landscape ||
      intent === "keyboard" ||
      sb.reducedMotion
    ) {
      applyScanMode(mode, intent, focusContent)
      return
    }
    const previous = scanMode
    const segments = sb.morphSegments()
    const readRects = () => {
      const bounds = canvas.getBoundingClientRect()
      const sx = canvas.width / Math.max(1, bounds.width)
      const sy = canvas.height / Math.max(1, bounds.height)
      return new Map(
        [
          ...landscape.querySelectorAll<HTMLElement>("[data-disk-tile-path]"),
        ].map((el) => {
          const r = el.getBoundingClientRect()
          return [
            el.dataset.diskTilePath!,
            {
              x: (r.left - bounds.left) * sx,
              y: (r.top - bounds.top) * sy,
              w: r.width * sx,
              h: r.height * sy,
              color: getComputedStyle(el).backgroundColor,
            },
          ]
        })
      )
    }
    const source = readRects()
    morphRef.current?.abort()
    sb.setMorphing(true)
    if (previous !== "map") {
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        for (const element of landscape.querySelectorAll<HTMLElement>(
          "[data-disk-tile-path]"
        )) {
          const rect = source.get(element.dataset.diskTilePath!)
          if (!rect) continue
          ctx.fillStyle = getComputedStyle(element).backgroundColor
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
        }
      }
    }
    setMorphing(true)
    setScanMode(mode)
    setGridVisible(mode === "grid" || previous === "grid")
    setGridInteractive(false)
    latest.current.onModeChange()
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (version !== viewTransitionVersionRef.current) return
        const target = readRects()
        const overlay = gridOverlayRef.current
        if (overlay) overlay.style.opacity = mode === "grid" ? "0" : "1"
        // A shared transition in two steps. Only top-level folders travel —
        // they are the same thing in both views. Detail steps aside first
        // (deeper rings or nested tiles fade where they are), the shared
        // shapes then unroll or roll up, and the destination's detail
        // settles in last.
        const toGrid = mode !== "map"
        const tiles: MorphTile[] = []
        const travelling = new Set<string>()
        for (const seg of segments) {
          const fromRect = source.get(seg.path)
          const toRect = target.get(seg.path)
          const pad = sunburstSegmentPadding(seg, sb.options.padAngle)
          const wedge = {
            start: seg.start + pad,
            end: seg.end - pad,
            inner: seg.inner,
            outer: seg.outer,
          }
          const colorIndex =
            Array.from({ length: 10 }, (_, i) => i).find(
              (i) => primaryHueForIndex(i) === seg.hue
            ) ?? 0
          const mapColor = seg.tone
            ? toneCss(seg.tone)
            : (spectrum.color(seg.node) ?? toneCss(aggregateTone(seg.depth)))
          const tileRect = toGrid ? toRect : fromRect
          if (seg.depth === 0 && tileRect) {
            travelling.add(seg.path)
            const arc = { shape: "arc" as const, wedge, rect: tileRect }
            const rect = { shape: "rect" as const, wedge, rect: tileRect }
            tiles.push({
              path: seg.path,
              node: seg.node,
              depth: seg.depth,
              colorIndex,
              fromColor: toGrid ? mapColor : tileRect.color,
              toColor: toGrid ? tileRect.color : mapColor,
              from: toGrid ? arc : rect,
              to: toGrid ? rect : arc,
              move: toGrid ? [0.22, 1] : [0, 0.78],
            })
            continue
          }
          const still = {
            shape: "arc" as const,
            wedge,
            rect: { x: 0, y: 0, w: 0, h: 0 },
          }
          tiles.push({
            path: seg.path,
            node: seg.node,
            depth: seg.depth,
            colorIndex,
            fromColor: mapColor,
            toColor: mapColor,
            fromOpacity: toGrid ? 1 : 0,
            toOpacity: toGrid ? 0 : 1,
            from: still,
            to: still,
            fade: toGrid ? [0, 0.34] : [0.66, 1],
          })
        }
        // Nested tiles: arriving ones settle in last, departing ones leave first.
        const otherRects = toGrid ? target : source
        for (const [path, rect] of otherRects) {
          if (travelling.has(path) || !viewNode) continue
          const wedge = { start: 0, end: 0.01, inner: 0, outer: 1 }
          const pose = { shape: "rect" as const, wedge, rect }
          tiles.push({
            path,
            node: viewNode,
            colorIndex: 0,
            fromColor: rect.color,
            toColor: rect.color,
            fromOpacity: toGrid ? 0 : 1,
            toOpacity: toGrid ? 1 : 0,
            from: pose,
            to: pose,
            fade: toGrid ? [0.64, 1] : [0, 0.32],
          })
        }
        ensureMorph(canvas).play(
          tiles,
          mode === "map" ? "toMap" : "toGrid",
          () => {
            if (version !== viewTransitionVersionRef.current) return
            // Commit the destination before releasing canvas ownership: otherwise
            // a map redraw can briefly cover the arriving tiles or layers.
            flushSync(() => {
              setMorphing(false)
              setGridVisible(mode === "grid")
              setGridInteractive(mode === "grid")
            })
            if (overlay) overlay.style.opacity = ""
            sb.setMorphing(false)
            const queued = queuedModeRef.current
            queuedModeRef.current = null
            if (queued && queued !== mode)
              requestAnimationFrame(() => latest.current.chooseScanMode(queued))
          },
          (fraction) => {
            const reveal = Math.max(0, Math.min(1, (fraction - 0.72) / 0.28))
            if (overlay) {
              overlay.style.opacity = String(
                mode === "grid" ? reveal : 1 - Math.min(1, fraction / 0.28)
              )
              if (mode === "grid" && fraction >= 0.9)
                overlay.dataset.labelsVisible = "true"
            }
          }
        )
      })
    )
  }

  function applyScanMode(
    mode: ScanMode,
    intent: Exclude<SunburstEntryIntent, "scan-complete"> = "pointer",
    focusContent = true
  ) {
    ++viewTransitionVersionRef.current
    queuedModeRef.current = null
    morphRef.current?.abort()
    sunburstRef.current?.setMorphing(false)
    setMorphing(false)
    if (mode === "map") orbitEntryIntentRef.current = intent
    setScanMode(mode)
    latest.current.onModeChange()
    setGridVisible(mode === "grid")
    setGridInteractive(mode === "grid")
    if (intent === "keyboard" && focusContent)
      latest.current.onKeyboardFocus(mode)
  }

  const latest = useRef({ ...options, chooseScanMode })
  latest.current = { ...options, chooseScanMode }
  // (Re)create the sunburst when its canvas mounts. The canvas persists across
  // map⇄grid now, so this runs once per mount — never rebuild for a mode switch.
  useEffect(() => {
    ++viewTransitionVersionRef.current
    // A workspace change can interrupt a morph after another view was queued.
    // Settle on the last user intent before releasing the old canvas.
    const destination = queuedModeRef.current ?? scanMode
    queuedModeRef.current = null
    setScanMode(destination)
    setMorphing(false)
    setGridVisible(destination === "grid")
    setGridInteractive(destination === "grid")
    if (gridOverlayRef.current) gridOverlayRef.current.style.opacity = ""
    const el = canvasEl
    if (!el) {
      sunburstRef.current = undefined
      morphRef.current?.abort()
      morphRef.current = null
      return () => undefined
    }
    if (sunburstRef.current) return () => undefined
    const sb = new Sunburst(el, {
      rings: 7,
      maxSegments: 900,
      padAngle: 0.0018,
      ringGap: 0.006,
      enterAnimMs: sunburstEntryDuration(orbitEntryIntentRef.current),
      canDrag: (node) => latest.current.canDrag(node),
      toneForNode: (node) => latest.current.spectrum.tone(node),
      onHover: (seg) => {
        latest.current.onHover(seg?.node ?? null)
      },
      onClick: (seg) => {
        latest.current.onActivate(seg.node)
      },
      onCenterClick: () => latest.current.onUp(),
    })
    sb.setQueuedPaths(latest.current.queuedPaths)
    sb.setExcludedPaths(latest.current.excludedPaths)
    const root = latest.current.treeRoot
    if (root)
      sb.setData(
        root,
        latest.current.viewNode,
        orbitEntryIntentRef.current === "keyboard"
      )
    orbitEntryIntentRef.current = "scan-complete"
    sunburstRef.current = sb
    return () => {
      ++viewTransitionVersionRef.current
      morphRef.current?.abort()
      morphRef.current = null
      sb.destroy()
      if (sunburstRef.current === sb) sunburstRef.current = undefined
    }
  }, [canvasEl])

  // Re-feed data when a fresh scan completes while the canvas is already mounted.
  useEffect(() => {
    const root = treeRoot
    const sb = sunburstRef.current
    if (root && sb && sb.root !== root) sb.updateData(root, viewNode)
  }, [treeRoot, viewNode, canvasEl])

  useEffect(() => {
    sunburstRef.current?.setQueuedPaths(options.queuedPaths)
  }, [options.queuedPaths])
  useEffect(() => {
    sunburstRef.current?.setExcludedPaths(options.excludedPaths)
  }, [options.excludedPaths])

  const map = {
    enterScan() {
      orbitEntryIntentRef.current = "scan-complete"
    },
    navigateTo(node: DiskScanNode, instant = false) {
      if (!instant && scanMode === "grid" && gridInteractive)
        tileCameraPrepareRef.current?.(node.path)
      sunburstRef.current?.navigateTo(node, instant)
    },
    reconcileAndNavigate(
      root: DiskScanNode,
      node: DiskScanNode,
      tone: ReturnType<typeof createSpectrum>["tone"]
    ) {
      sunburstRef.current?.reconcileAndNavigate(root, node, tone)
    },
    select(path: string) {
      sunburstRef.current?.setSelected(path)
    },
    highlight(path: string | null) {
      sunburstRef.current?.setHighlight(path)
    },
    nodeAtPoint(x: number, y: number) {
      return sunburstRef.current?.nodeAtPoint(x, y)
    },
    suppressNextClick() {
      sunburstRef.current?.suppressNextClick()
    },
    color(path: string) {
      const tone = sunburstRef.current?.segments.find(
        (segment) => segment.path === path
      )?.tone
      return tone ? toneCss(tone) : undefined
    },
  }
  return {
    scanMode,
    morphing,
    gridVisible,
    gridInteractive,
    canvasEl,
    setCanvasEl,
    landscapeEl,
    setLandscapeEl,
    landscapeElRef,
    gridOverlayRef,
    registerTileCamera,
    chooseScanMode,
    applyScanMode,
    map,
  }
}
