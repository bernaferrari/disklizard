import { describe, expect, it } from "bun:test"
import {
  APFS_SNAPSHOT_EVIDENCE_LIMIT,
  boundedSnapshotEvidence,
  snapshotEvidenceCaption,
  snapshotEvidenceCountSummary,
  snapshotEvidenceLabel,
} from "./ApfsSnapshotEvidence"

describe("APFS snapshot evidence", () => {
  it("uses an observed name before a UUID", () => {
    expect(
      snapshotEvidenceLabel({ name: "com.apple.os.update", uuid: "abc" })
    ).toBe("com.apple.os.update")
    expect(snapshotEvidenceLabel({ uuid: "abc" })).toBe("abc")
  })

  it("makes bounded or unavailable identity evidence explicit", () => {
    expect(snapshotEvidenceCaption(3, 2)).toBe(
      "3 APFS snapshots are present; showing 2 read-only identities."
    )
    expect(snapshotEvidenceCaption(1, 0)).toBe(
      "1 APFS snapshot is present; macOS did not provide an identity."
    )
  })

  it("summarizes snapshot and Time Machine evidence without inventing bytes", () => {
    expect(snapshotEvidenceCountSummary(2, 1)).toBe(
      "2 purgeable · 1 Time Machine"
    )
    expect(snapshotEvidenceCountSummary(0, 0)).toBe("")
    expect(snapshotEvidenceCountSummary(2, 1)).not.toMatch(
      /\d+\s?(?:KB|MB|GB|TB)/
    )
  })

  it("bounds the read-only identity list", () => {
    const snapshots = Array.from({ length: 12 }, (_, index) => ({
      uuid: `snapshot-${index}`,
    }))
    expect(boundedSnapshotEvidence(snapshots)).toHaveLength(
      APFS_SNAPSHOT_EVIDENCE_LIMIT
    )
    expect(boundedSnapshotEvidence(undefined)).toEqual([])
  })
})
