import { describe, expect, it } from "bun:test"
import {
  isStartupVolume,
  volumeActionLabel,
  volumeCompletionLabel,
  volumeKindLabel,
  volumePathVisible,
  volumePressure,
  volumeSubtitle,
  volumeUsedRatio,
} from "./DiskUtilityDriveSurfaces"
import type { DiskDriveInfo } from "./types"

describe("volume presentation", () => {
  it("treats a nearly full disk as critical pressure", () => {
    expect(volumeUsedRatio(914, 926)).toBeCloseTo(914 / 926)
    expect(volumePressure(914, 926)).toBe("critical")
    expect(volumePressure(80, 100)).toBe("tight")
    expect(volumePressure(20, 100)).toBe("ok")
    expect(volumeUsedRatio(10, 0)).toBe(0)
  })

  it("uses short row actions like a volume picker", () => {
    expect(volumeActionLabel(undefined)).toBe("Scan")
    expect(volumeActionLabel("scanning")).toBe("Cancel")
    expect(volumeActionLabel("complete")).toBe("View")
    expect(volumeActionLabel("failed")).toBe("Retry")
  })

  it("labels only non-local volume kinds", () => {
    expect(volumeKindLabel("local")).toBeUndefined()
    expect(volumeKindLabel("removable")).toBe("removable disk")
    expect(volumeKindLabel("network")).toBe("network volume")
  })

  it("hides a root or name-identical path", () => {
    expect(volumePathVisible("/", "Macintosh HD")).toBe(false)
    expect(volumePathVisible("Macintosh HD", "Macintosh HD")).toBe(false)
    expect(volumePathVisible("/Volumes/Backup", "Backup")).toBe(true)
  })

  it("describes a volume the way a person would", () => {
    expect(isStartupVolume("/")).toBe(true)
    expect(isStartupVolume("C:\\")).toBe(true)
    expect(isStartupVolume("/Volumes/Backup")).toBe(false)
    const drive: DiskDriveInfo = {
      path: "/",
      name: "Macintosh HD",
      label: "Macintosh HD",
      total: 926 * 1024 ** 3,
      free: 13 * 1024 ** 3,
      used: 913 * 1024 ** 3,
      type: "local",
      filesystem: "apfs",
      snapshotCount: 1,
    }
    expect(volumeSubtitle(drive)).toBe("926 GB startup disk")
    expect(volumeSubtitle({ ...drive, path: "/Volumes/Backup", type: "removable" })).toBe("926 GB removable disk")
  })
})

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
