import { describe, expect, test } from "bun:test"
import { DISK_ACCESS_GUIDANCE, diskLanguageText } from "./runtime"

describe("DiskLizard runtime language", () => {
  test("resolves the shipped access-guidance copy", () => {
    expect(diskLanguageText("disk.accessGuidance.rescan")).toBe(DISK_ACCESS_GUIDANCE["disk.accessGuidance.rescan"])
    expect(diskLanguageText("disk.accessGuidance.macos")).toContain("Full Disk Access")
    expect(diskLanguageText("unknown.key")).toBe("unknown.key")
  })
})
