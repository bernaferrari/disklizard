import { useLayoutEffect, useRef } from "react"
import type { CameraBox } from "./directory-camera"

type TilePose = { box: CameraBox; element: HTMLElement }
type Scene = { path: string; bounds: CameraBox; tiles: Map<string, TilePose> }

function project(box: CameraBox, from: CameraBox, to: CameraBox): CameraBox {
  const sx = to.width / Math.max(1, from.width), sy = to.height / Math.max(1, from.height)
  return { x: to.x + (box.x - from.x) * sx, y: to.y + (box.y - from.y) * sy, width: box.width * sx, height: box.height * sy }
}
function transform(from: CameraBox, to: CameraBox) {
  return `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / Math.max(1, to.width)}, ${from.height / Math.max(1, to.height)})`
}

/** Shared tiles retain their screen positions; new detail emerges inside the
 * selected folder. No whole-scene fade, and no frame-by-frame React work. */
export function useTileCamera(path: string, layout: unknown) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scene = useRef<Scene | null>(null)
  const active = useRef<Animation[]>([])
  const stop = () => { active.current.forEach(animation => animation.cancel()); active.current = [] }
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const old = scene.current
    // Read the previous animation's presentation transform before cancellation.
    // Its stored layout box remains valid even if React has moved the element.
    const presented = new Map<string, CameraBox>()
    if (old) for (const [key, tile] of old.tiles) {
      const css = getComputedStyle(tile.element).transform
      const matrix = css && css !== "none" ? new DOMMatrixReadOnly(css) : undefined
      presented.set(key, matrix ? { x: tile.box.x + matrix.e, y: tile.box.y + matrix.f,
        width: tile.box.width * matrix.a, height: tile.box.height * matrix.d } : tile.box)
    }
    stop()
    const bounds = root.getBoundingClientRect()
    const elements = [...root.querySelectorAll<HTMLElement>("[data-disk-tile-path]")]
    const tiles = new Map(elements.map(element => [element.dataset.diskTilePath!, { box: element.getBoundingClientRect(), element }]))
    scene.current = { path, bounds, tiles }
    if (!old || !bounds.width || !bounds.height || matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const opening = presented.get(path)
    const returning = tiles.get(old.path)?.box
    if (old.path !== path && !opening && !returning) return
    const animations: Animation[] = []
    for (const [key, tile] of tiles) {
      const from = key === old.path ? old.bounds : presented.get(key) ?? (opening
        ? project(tile.box, bounds, opening)
        : project(tile.box, returning ?? bounds, old.bounds))
      animations.push(tile.element.animate([
        { transform: transform(from, tile.box), transformOrigin: "0 0", opacity: 1 },
        { transform: "none", transformOrigin: "0 0", opacity: 1 },
      ], { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }))
    }
    active.current = animations
    void Promise.all(animations.map(animation => animation.finished)).then(() => {
      if (active.current === animations) stop()
    }).catch(() => undefined)
  }, [path, layout])
  useLayoutEffect(() => stop, [])
  return rootRef
}
