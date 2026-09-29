/** What a pointerdown must expose to start a drag; React and DOM events both fit. */
export type PointerDragSource = {
  button: number
  clientX: number
  clientY: number
  pointerId: number
  pointerType: string
  currentTarget: EventTarget | null
}

export type PointerDragHandlers = {
  /** Movement needed before a press becomes a drag. */
  threshold: number
  onStart: (x: number, y: number) => void
  onMove: (x: number, y: number) => void
  /** Always called once after onStart, however the drag ends. */
  onEnd: (x: number, y: number, cancelled: boolean) => void
}

/**
 * Tracks one pointer drag with window listeners, so it survives the source
 * element unmounting mid-drag (virtualized rows, reflowing tiles, navigation).
 * Native HTML5 drag was dropped because `dragend` never reaches a detached
 * source, which left the drag token and collector stuck. Returns a canceller.
 */
export function trackPointerDrag(
  event: PointerDragSource,
  handlers: PointerDragHandlers
): () => void {
  const { pointerId, clientX: startX, clientY: startY } = event
  const source = event.currentTarget
  let active = false
  let done = false
  let lastX = startX
  let lastY = startY
  const root = document.documentElement
  const previousSelect = root.style.userSelect
  const previousCursor = root.style.cursor

  const matches = (candidate: PointerEvent) =>
    typeof candidate.pointerId !== "number" || candidate.pointerId === pointerId

  const finish = (cancelled: boolean) => {
    if (done) return
    done = true
    window.removeEventListener("pointermove", onMove, true)
    window.removeEventListener("pointerup", onUp, true)
    window.removeEventListener("pointercancel", onCancel, true)
    window.removeEventListener("keydown", onKey, true)
    window.removeEventListener("blur", onCancel)
    if (!active) return
    root.style.userSelect = previousSelect
    root.style.cursor = previousCursor
    if (source instanceof Element && source.hasPointerCapture?.(pointerId))
      source.releasePointerCapture(pointerId)
    // The click synthesized after a drag must not activate what is underneath.
    const swallow = (click: Event) => {
      click.stopPropagation()
      click.preventDefault()
    }
    window.addEventListener("click", swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener("click", swallow, true), 0)
    handlers.onEnd(lastX, lastY, cancelled)
  }

  function onMove(move: PointerEvent) {
    if (!matches(move)) return
    lastX = move.clientX
    lastY = move.clientY
    if (!active) {
      if (Math.hypot(lastX - startX, lastY - startY) < handlers.threshold)
        return
      active = true
      root.style.userSelect = "none"
      root.style.cursor = "grabbing"
      // Capture keeps hover states elsewhere from flickering during the drag.
      if (source instanceof Element)
        try {
          source.setPointerCapture(pointerId)
        } catch {
          // The source may already be gone; window listeners still work.
        }
      handlers.onStart(lastX, lastY)
    }
    move.preventDefault()
    handlers.onMove(lastX, lastY)
  }
  function onUp(up: PointerEvent) {
    if (!matches(up)) return
    lastX = up.clientX
    lastY = up.clientY
    finish(false)
  }
  function onCancel() {
    finish(true)
  }
  function onKey(key: KeyboardEvent) {
    if (key.key === "Escape") {
      key.preventDefault()
      finish(true)
    }
  }

  window.addEventListener("pointermove", onMove, true)
  window.addEventListener("pointerup", onUp, true)
  window.addEventListener("pointercancel", onCancel, true)
  window.addEventListener("keydown", onKey, true)
  window.addEventListener("blur", onCancel)
  return onCancel
}
