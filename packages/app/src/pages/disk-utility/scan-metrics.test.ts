import { describe, expect, it } from "bun:test"
import { formatScanDuration, formatScanRate, scanPerformance } from "./scan-metrics"

describe("scan performance", () => {
  it("derives a truthful rate only from a positive elapsed interval", () => {
    expect(scanPerformance(500, 2_000, 1_000, 3_000)).toEqual({
      elapsedMs: 2_000,
      filesPerSecond: 250,
      bytesPerSecond: 1_000,
    })
    expect(scanPerformance(500, 2_000, 3_000, 3_000)).toEqual({
      elapsedMs: 0,
      filesPerSecond: null,
      bytesPerSecond: null,
    })
  })

  it("formats compact, human-readable timing and throughput", () => {
    expect(formatScanDuration(450)).toBe("under 1s")
    expect(formatScanDuration(1_450)).toBe("1.4s")
    expect(formatScanDuration(75_100)).toBe("1m 15s")
    expect(formatScanRate(250, "files")).toBe("250 files/s")
    expect(formatScanRate(1_024, "bytes")).toBe("1.0 KB/s")
  })
})
