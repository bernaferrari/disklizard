import { describe, expect, it } from "bun:test"
import { determinateScanProgress, isScanCancellation } from "./scan-progress"

describe("live scan landscape", () => {
  it("treats direct and Electron-wrapped cancellation errors as intentional", () => {
    expect(isScanCancellation(new Error("Scan cancelled"))).toBe(true)
    expect(
      isScanCancellation(
        "Error invoking remote method 'disklizard:scan-path': Error: Scan cancelled"
      )
    ).toBe(true)
    expect(isScanCancellation(new Error("Superseded by a new scan"))).toBe(true)
    expect(isScanCancellation(new Error("Permission denied"))).toBe(false)
  })
})

describe("scan progress presentation", () => {
  it("stays indeterminate until the scanner reports real progress", () => {
    expect(determinateScanProgress(null)).toBeNull()
    expect(determinateScanProgress(Number.NaN)).toBeNull()
    expect(determinateScanProgress(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it("preserves real zero progress and clamps scanner estimates", () => {
    expect(determinateScanProgress(0)).toBe(0)
    expect(determinateScanProgress(37.5)).toBe(37.5)
    expect(determinateScanProgress(-4)).toBe(0)
    expect(determinateScanProgress(104)).toBe(100)
  })
})
