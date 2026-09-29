import { describe, expect, it } from "bun:test"
import {
  volumeAvailableBytes,
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
    expect(volumeActionLabel(undefined, true)).toBe("View")
    expect(volumeActionLabel("scanning", true)).toBe("Cancel")
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
      sharedFree: 20 * 1024 ** 3,
      snapshotCount: 1,
    }
    expect(volumeSubtitle(drive)).toBe(
      "994 GB startup disk 21.5 GB shared container free"
    )
    expect(
      volumeSubtitle({ ...drive, path: "/Volumes/Backup", type: "removable" })
    ).toBe("994 GB removable disk 21.5 GB shared container free")
  })
})

describe("volume completion copy", () => {
  it("does not describe cached maps as fresh throughput", () => {
    expect(volumeCompletionLabel("snapshot")).toBe("Restored local map")
    expect(volumeCompletionLabel("delta")).toBe("Updated cached map")
  })

  it("shows a rate only for a completed fresh traversal", () => {
    expect(
      volumeCompletionLabel("scan", {
        elapsedMs: 2_000,
        filesPerSecond: 40,
        bytesPerSecond: 2_048,
      })
    ).toBe("2.0s · 40 files/s")
    expect(
      volumeCompletionLabel(undefined, {
        elapsedMs: 2_000,
        filesPerSecond: 40,
        bytesPerSecond: 2_048,
      })
    ).toBe("Map ready")
  })
})

// Overview availability must include the OS reclaimable estimate without changing scan accounting.
it("uses macOS availability for the overview and preserves physical free bytes", () => {
  const drive = { total: 994, free: 14, available: 60 }
  expect(volumeAvailableBytes(drive)).toBe(60)
  expect(drive.free).toBe(14)
  expect(volumeAvailableBytes({ total: 994, free: 14 })).toBe(14)
  expect(volumeAvailableBytes({ ...drive, available: -1 })).toBe(14)
  expect(volumeAvailableBytes({ ...drive, available: 2000 })).toBe(994)
})
