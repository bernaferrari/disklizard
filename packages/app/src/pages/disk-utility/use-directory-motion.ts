import { useLayoutEffect, useRef } from "react"

/** FLIP existing descendants into their new positions when opening a directory.
 * Only transforms/opacity animate; layout and React stay out of the frame loop. */
export function useDirectoryMotion(path: string, layout: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const previous = useRef<{
    path: string
    boxes: Map<string, DOMRect>
    bounds: DOMRect
  } | null>(null)
  const animations = useRef<Animation[]>([])
  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const old = previous.current
    animations.current.forEach((animation) => animation.cancel())
    animations.current = []
    const elements = [
      ...root.querySelectorAll<HTMLElement>("[data-disk-tile-path]"),
    ]
    const boxes = new Map(
      elements.map((element) => [
        element.dataset.diskTilePath!,
        element.getBoundingClientRect(),
      ])
    )
    const bounds = root.getBoundingClientRect()
    previous.current = { path, boxes, bounds }
    if (!old) return
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !root.animate
    )
      return
    let count = 0
    for (const element of elements) {
      const key = element.dataset.diskTilePath!
      const to = boxes.get(key)!
      const parent = old.boxes.get(path)
      // Newly revealed descendants originate inside the directory that was
      // clicked, even when they were too small to render in the previous view.
      const destination = boxes.get(old.path)
      const from =
        key === old.path
          ? old.bounds
          : (old.boxes.get(key) ??
            (destination
              ? {
                  x:
                    old.bounds.x +
                    ((to.x - destination.x) * old.bounds.width) /
                      Math.max(1, destination.width),
                  y:
                    old.bounds.y +
                    ((to.y - destination.y) * old.bounds.height) /
                      Math.max(1, destination.height),
                  width:
                    (to.width * old.bounds.width) /
                    Math.max(1, destination.width),
                  height:
                    (to.height * old.bounds.height) /
                    Math.max(1, destination.height),
                }
              : parent
                ? {
                    x:
                      parent.x +
                      ((to.x - bounds.x) * parent.width) /
                        Math.max(1, bounds.width),
                    y:
                      parent.y +
                      ((to.y - bounds.y) * parent.height) /
                        Math.max(1, bounds.height),
                    width:
                      (to.width * parent.width) / Math.max(1, bounds.width),
                    height:
                      (to.height * parent.height) / Math.max(1, bounds.height),
                  }
                : undefined))
      if (!from || to.width < 12 || to.height < 12 || ++count > 120) continue
      const animation = element.animate(
        [
          {
            transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width}, ${from.height / to.height})`,
            transformOrigin: "0 0",
            opacity: 1,
          },
          { transform: "none", transformOrigin: "0 0", opacity: 1 },
        ],
        { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
      )
      animations.current.push(animation)
    }
    if (!count && old.path !== path)
      animations.current.push(
        root.animate(
          [
            {
              transform: `scale(${old.path.startsWith(path + "/") ? 1.06 : 0.96})`,
              opacity: 0.3,
            },
            { transform: "none", opacity: 1 },
          ],
          { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        )
      )
  }, [path, layout])
  useLayoutEffect(
    () => () => animations.current.forEach((animation) => animation.cancel()),
    []
  )
  return ref
}
