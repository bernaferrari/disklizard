import { describe, expect, it } from "bun:test"
import { snapshotEvidenceCaption, snapshotEvidenceLabel } from "./ApfsSnapshotEvidence"

describe("APFS snapshot evidence", () => {
  it("uses an observed name before a UUID", () => {
    expect(snapshotEvidenceLabel({ name: "com.apple.os.update", uuid: "abc" })).toBe("com.apple.os.update")
    expect(snapshotEvidenceLabel({ uuid: "abc" })).toBe("abc")
  })

  it("makes bounded or unavailable identity evidence explicit", () => {
    expect(snapshotEvidenceCaption(3, 2)).toBe("3 APFS snapshots are present; showing 2 read-only identities.")
    expect(snapshotEvidenceCaption(1, 0)).toBe("1 APFS snapshot is present; macOS did not provide an identity.")
  })
})
