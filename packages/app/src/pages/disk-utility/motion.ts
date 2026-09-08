import { useEffect, useRef, useState } from "react"

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

export type SurfacePresenceOptions = {
  exitMs?: number
  reducedMotion?: () => boolean
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}

const SURFACE_EXIT_MS = 160

/**
 * Keep a transient surface mounted long enough to animate out. Opening on the
 * next frame gives CSS transitions a real start pose; reopening during exit
 * retargets from the live pose instead of replaying a keyframe.
 */
function createSurfacePresenceStore(
  getOptions: () => SurfacePresenceOptions,
  onPhase: (phase: SurfacePhase) => void,
): SurfacePresence {
  let phase: SurfacePhase = "closed"
  let frame: number | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let afterClose: (() => void) | undefined

  const writePhase = (next: SurfacePhase) => {
    phase = next
    onPhase(next)
  }

  const clearSchedule = () => {
    if (frame !== undefined) {
      ;(getOptions().cancelFrame ?? cancelAnimationFrame)(frame)
      frame = undefined
    }
    clearTimeout(timer)
    timer = undefined
  }

  const finishClose = () => {
    timer = undefined
    writePhase("closed")
    const callback = afterClose
    afterClose = undefined
    callback?.()
  }

  const reducedMotion = () =>
    getOptions().reducedMotion?.() ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches

  const close = (callback?: () => void) => {
    if (phase === "closed") {
      callback?.()
      return
    }
    if (phase === "closing") return
    clearSchedule()
    afterClose = callback
    if (reducedMotion()) {
      finishClose()
      return
    }
    writePhase("closing")
    timer = setTimeout(finishClose, getOptions().exitMs ?? SURFACE_EXIT_MS)
  }

  return {
    phase: () => phase,
    mounted: () => phase !== "closed",
    open() {
      if (phase === "open" || phase === "opening") return
      clearSchedule()
      afterClose = undefined
      if (phase === "closing" || reducedMotion()) {
        writePhase("open")
        return
      }
      writePhase("opening")
      frame = (getOptions().requestFrame ?? requestAnimationFrame)(() => {
        frame = undefined
        writePhase("open")
      })
    },
    close: () => close(),
    closeThen: close,
    /** Clear any pending exit frame/timer; call when the owner goes away. */
    dispose: clearSchedule,
  }
}

/** Accessor surface of one presence machine; stable function identities. */
export interface SurfacePresence {
  phase(): SurfacePhase
  mounted(): boolean
  open(): void
  close(): void
  closeThen(callback?: () => void): void
  /** Clear any pending exit frame/timer; call when the owner goes away. */
  dispose(): void
}

/**
 * Framework-free surface machine with the v1 accessor surface. Pass an
 * `onPhase` observer to mirror transitions into external state.
 */
export function createSurfacePresence(options: SurfacePresenceOptions = {}, onPhase: () => void = () => {}) {
  return createSurfacePresenceStore(() => options, onPhase)
}

/**
 * React hook over the same machine: `phase` is plain state and the pending
 * exit frame/timer is cleared when the owning component unmounts. Options are
 * read lazily at each action, so fresh option objects are safe to pass inline.
 */
export function useSurfacePresence(options: SurfacePresenceOptions = {}) {
  const [phase, setPhase] = useState<SurfacePhase>("closed")
  const optionsRef = useRef(options)
  optionsRef.current = options
  const [surface] = useState(() => createSurfacePresenceStore(() => optionsRef.current, setPhase))
  useEffect(() => surface.dispose, [surface])
  return {
    phase,
    mounted: phase !== "closed",
    open: surface.open,
    close: surface.close,
    closeThen: surface.closeThen,
  }
}
