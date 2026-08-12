import { describe, expect, it } from "bun:test"
import { isScanCancellation } from "./scan-progress"

describe("live scan landscape", () => {
  it("treats direct and Electron-wrapped cancellation errors as intentional", () => {
    expect(isScanCancellation(new Error("Scan cancelled"))).toBe(true)
    expect(isScanCancellation("Error invoking remote method 'disklizard:scan-path': Error: Scan cancelled")).toBe(true)
    expect(isScanCancellation(new Error("Superseded by a new scan"))).toBe(true)
    expect(isScanCancellation(new Error("Permission denied"))).toBe(false)
  })
})
