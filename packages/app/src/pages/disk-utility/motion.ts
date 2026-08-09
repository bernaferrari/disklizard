import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"

/**
 * Animate a number from `from` to `to` over `ms`, calling `onUpdate` each frame
 * with an eased value. Returns a cancel function. Great for count-up stats.
 */
export function animateCount(from: number, to: number, ms: number, onUpdate: (v: number) => void) {
  const start = performance.now()
  let raf = 0
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    const e = 1 - Math.pow(1 - t, 3)
    onUpdate(from + (to - from) * e)
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}

export type SurfacePhase = "closed" | "opening" | "open" | "closing"

const SURFACE_EXIT_MS = 160

/**
 * Keep a transient surface mounted long enough to animate out. Opening on the
 * next frame gives CSS transitions a real start pose; reopening during exit
 * retargets from the live pose instead of replaying a keyframe.
 */
export function createSurfacePresence(
  options: {
    exitMs?: number
    reducedMotion?: () => boolean
    requestFrame?: (callback: FrameRequestCallback) => number
    cancelFrame?: (handle: number) => void
  } = {},
) {
  const [state, setState] = createStore({ phase: "closed" as SurfacePhase })
  let frame: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let afterClose: (() => void) | undefined

  const clearSchedule = () => {
    if (frame !== undefined) (options.cancelFrame ?? cancelAnimationFrame)(frame)
    if (timer !== undefined) clearTimeout(timer)
    frame = undefined
    timer = undefined
  }

  const finishClose = () => {
    timer = undefined
    setState("phase", "closed")
    const callback = afterClose
    afterClose = undefined
    callback?.()
  }

  const reducedMotion = () => options.reducedMotion?.() ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches

  onCleanup(clearSchedule)

  const close = (callback?: () => void) => {
    if (state.phase === "closed") {
      callback?.()
      return
    }
    if (state.phase === "closing") return
    clearSchedule()
    afterClose = callback
    if (reducedMotion()) {
      finishClose()
      return
    }
    setState("phase", "closing")
    timer = setTimeout(finishClose, options.exitMs ?? SURFACE_EXIT_MS)
  }

  return {
    phase: () => state.phase,
    mounted: () => state.phase !== "closed",
    open() {
      if (state.phase === "open" || state.phase === "opening") return
      clearSchedule()
      afterClose = undefined
      if (state.phase === "closing" || reducedMotion()) {
        setState("phase", "open")
        return
      }
      setState("phase", "opening")
      frame = (options.requestFrame ?? requestAnimationFrame)(() => {
        frame = undefined
        setState("phase", "open")
      })
    },
    close: () => close(),
    closeThen: close,
  }
}
