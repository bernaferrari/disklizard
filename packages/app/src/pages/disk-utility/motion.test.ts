import { describe, expect, it, vi } from "bun:test"
import { createSurfacePresence } from "./motion"

describe("createSurfacePresence", () => {
  it("keeps a closing surface mounted through its exit transition", () => {
    vi.useFakeTimers()
    try {
      let openFrame: FrameRequestCallback | undefined
      const surface = createSurfacePresence({
        exitMs: 160,
        reducedMotion: () => false,
        requestFrame: (callback) => {
          openFrame = callback
          return 1
        },
        cancelFrame: () => {},
      })

      surface.open()
      expect(surface.phase()).toBe("opening")
      openFrame?.(performance.now())
      expect(surface.phase()).toBe("open")

      surface.close()
      expect(surface.phase()).toBe("closing")
      expect(surface.mounted()).toBe(true)
      vi.advanceTimersByTime(159)
      expect(surface.mounted()).toBe(true)
      vi.advanceTimersByTime(1)
      expect(surface.phase()).toBe("closed")
      expect(surface.mounted()).toBe(false)
      surface.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it("reverses an interrupted exit instead of unmounting later", () => {
    vi.useFakeTimers()
    try {
      const surface = createSurfacePresence({ exitMs: 160, reducedMotion: () => false, requestFrame: () => 1, cancelFrame: () => {} })
      let closed = false

      surface.open()
      vi.advanceTimersByTime(20)
      surface.closeThen(() => {
        closed = true
      })
      surface.open()
      vi.advanceTimersByTime(200)

      expect(surface.phase()).toBe("open")
      expect(surface.mounted()).toBe(true)
      expect(closed).toBe(false)
      surface.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it("skips every transition when reduced motion is requested", () => {
    const surface = createSurfacePresence({ reducedMotion: () => true })
    let closed = false

    surface.open()
    expect(surface.phase()).toBe("open")
    surface.closeThen(() => {
      closed = true
    })

    expect(surface.phase()).toBe("closed")
    expect(closed).toBe(true)
    surface.dispose()
  })
})
