import { describe, expect, it } from "bun:test"
import { ScanScheduler } from "./scan-scheduler"

describe("ScanScheduler", () => {
  it("bounds traversal work to the configured width", async () => {
    const scheduler = new ScanScheduler(3)
    let active = 0
    let peak = 0

    await scheduler.forEach(
      Array.from({ length: 11 }, (_, index) => index),
      async () => {
        active++
        peak = Math.max(peak, active)
        await Bun.sleep(2)
        active--
      },
    )

    expect(peak).toBe(3)
    expect(active).toBe(0)
  })

  it("rejects queued work on abort without starting its operation", async () => {
    const controller = new AbortController()
    const scheduler = new ScanScheduler(1, controller.signal)
    let releaseActive!: () => void
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve
    })
    const active = scheduler.run(() => activeGate)
    let queuedStarted = false
    const queued = scheduler.run(async () => {
      queuedStarted = true
    })
    const reason = new Error("scheduler cancellation fixture")

    controller.abort(reason)

    await expect(queued).rejects.toBe(reason)
    expect(queuedStarted).toBe(false)
    releaseActive()
    await active
  })
})
