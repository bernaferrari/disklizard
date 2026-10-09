import { useEffect, useRef } from "react"

/**
 * Pinch-to-navigate: the views behave like a camera over a canvas, so a
 * trackpad pinch (reported by Chromium as a ctrl+wheel) or ⌘/Ctrl+scroll
 * zooms into the folder under the pointer, and the opposite gesture zooms
 * back out to the parent. Each step is one discrete navigation; the camera
 * animation does the continuous part.
 */

/** Accumulated wheel delta that commits one level of zoom. */
export const PINCH_THRESHOLD = 60
/** Ignore further input while the camera is still moving to the last level. */
export const PINCH_COOLDOWN_MS = 560

export type PinchStep = "in" | "out"

export function createPinchAccumulator(
  threshold = PINCH_THRESHOLD,
  cooldownMs = PINCH_COOLDOWN_MS
) {
  let total = 0
  let lockedUntil = 0
  return {
    /** Feed one wheel event; returns a step once the gesture is decisive. */
    push(deltaY: number, now: number): PinchStep | undefined {
      if (now < lockedUntil) return undefined
      // A reversal mid-gesture starts a new intent instead of cancelling out.
      if (Math.sign(deltaY) !== Math.sign(total)) total = 0
      total += deltaY
      if (Math.abs(total) < threshold) return undefined
      const step = total < 0 ? "in" : "out"
      total = 0
      lockedUntil = now + cooldownMs
      return step
    },
    reset() {
      total = 0
    },
  }
}

export function isZoomWheel(event: Pick<WheelEvent, "ctrlKey" | "metaKey">) {
  return event.ctrlKey || event.metaKey
}

/** Attach pinch navigation to an element; handlers may change every render. */
export function usePinchNavigation(
  element: HTMLElement | null,
  handlers: {
    onZoomIn: (clientX: number, clientY: number) => void
    onZoomOut: () => void
  }
) {
  const latest = useRef(handlers)
  latest.current = handlers
  useEffect(() => {
    if (!element) return undefined
    const accumulator = createPinchAccumulator()
    const onWheel = (event: WheelEvent) => {
      if (!isZoomWheel(event)) {
        accumulator.reset()
        return
      }
      // Without this the browser would zoom the whole window instead.
      event.preventDefault()
      const step = accumulator.push(event.deltaY, performance.now())
      if (step === "in") latest.current.onZoomIn(event.clientX, event.clientY)
      else if (step === "out") latest.current.onZoomOut()
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [element])
}
