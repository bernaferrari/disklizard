import { describe, expect, it } from "bun:test"
import { cleanupFailureReason } from "./CleanupResultsDialog"

describe("cleanup result reasons", () => {
  it("keeps different failures distinguishable in one batch", () => {
    expect(cleanupFailureReason("EACCES: permission denied")).toBe(
      "disk.results.accessDenied"
    )
    expect(cleanupFailureReason("Item changed since scanning")).toBe(
      "disk.results.changed"
    )
    expect(cleanupFailureReason("EROFS: read-only file system")).toBe(
      "disk.results.readOnly"
    )
  })
})
