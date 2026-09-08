import { useLayoutEffect, useRef } from "react"

/** FLIP existing descendants into their new positions when opening a directory.
 * Only transforms/opacity animate; layout and React stay out of the frame loop. */
export function useDirectoryMotion(path: string, layout: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const previous = useRef<{ path: string; boxes: Map<string, DOMRect> } | null>(null)
  const animations = useRef<Animation[]>([])
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const old = previous.current
    if (old?.path === path && animations.current.some((animation) => animation.playState === "running")) return
    animations.current.forEach((animation) => animation.cancel())
    animations.current = []
    const elements = [...root.querySelectorAll<HTMLElement>("[data-disk-tile-path], [data-disk-layer-path]")]
    const boxes = new Map(elements.map((element) => [element.dataset.diskTilePath ?? element.dataset.diskLayerPath!, element.getBoundingClientRect()]))
    previous.current = { path, boxes }
    if (!old || old.path === path) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !root.animate) return
    let count = 0
    for (const element of elements) {
      const key = element.dataset.diskTilePath ?? element.dataset.diskLayerPath!
      const to = boxes.get(key)!
      const from = old.boxes.get(key)
      if (!from || to.width < 12 || to.height < 12 || ++count > 120) continue
      const animation = element.animate([
        { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width}, ${from.height / to.height})`, transformOrigin: "0 0", opacity: 0.7 },
        { transform: "none", transformOrigin: "0 0", opacity: 1 },
      ], { duration: 260, easing: "cubic-bezier(0.22, 1, 0.36, 1)" })
      animations.current.push(animation)
    }
    if (!count) animations.current.push(root.animate([
      { transform: `scale(${old.path.startsWith(path + "/") ? 1.06 : 0.96})`, opacity: 0.3 },
      { transform: "none", opacity: 1 },
    ], { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }))
  }, [path, layout])
  useLayoutEffect(() => () => animations.current.forEach((animation) => animation.cancel()), [])
  return ref
}
