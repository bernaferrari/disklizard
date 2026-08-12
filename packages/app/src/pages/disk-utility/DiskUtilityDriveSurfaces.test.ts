import { describe, expect, it } from "bun:test"
import { volumeCompletionLabel } from "./DiskUtilityDriveSurfaces"

describe("volume completion copy", () => {
  it("does not describe cached maps as fresh throughput", () => {
    expect(volumeCompletionLabel("snapshot")).toBe("Restored local map")
    expect(volumeCompletionLabel("delta")).toBe("Updated cached map")
  })

  it("shows a rate only for a completed fresh traversal", () => {
    expect(volumeCompletionLabel("scan", { elapsedMs: 2_000, filesPerSecond: 40, bytesPerSecond: 2_048 })).toBe(
      "2.0s · 40 files/s",
    )
    expect(volumeCompletionLabel(undefined, { elapsedMs: 2_000, filesPerSecond: 40, bytesPerSecond: 2_048 })).toBe(
      "Map ready",
    )
  })
})
