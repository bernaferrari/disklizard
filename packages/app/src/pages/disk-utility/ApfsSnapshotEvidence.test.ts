import { describe, expect, it } from "bun:test"
import { createComponent } from "solid-js"
import { renderToString } from "solid-js/web"
import { ApfsSnapshotEvidenceList, snapshotEvidenceCaption, snapshotEvidenceLabel } from "./ApfsSnapshotEvidence"

describe("APFS snapshot evidence", () => {
  it("uses an observed name before a UUID", () => {
    expect(snapshotEvidenceLabel({ name: "com.apple.os.update", uuid: "abc" })).toBe("com.apple.os.update")
    expect(snapshotEvidenceLabel({ uuid: "abc" })).toBe("abc")
  })

  it("makes bounded or unavailable identity evidence explicit", () => {
    expect(snapshotEvidenceCaption(3, 2)).toBe("3 APFS snapshots are present; showing 2 read-only identities.")
    expect(snapshotEvidenceCaption(1, 0)).toBe("1 APFS snapshot is present; macOS did not provide an identity.")
  })

  it("renders bounded identities and truthful counts without inventing snapshot bytes", () => {
    const html = renderToString(
      () =>
        createComponent(ApfsSnapshotEvidenceList, {
          snapshotCount: 4,
          purgeableSnapshotCount: 2,
          timeMachineSnapshotCount: 1,
          snapshots: [{ name: "com.apple.TimeMachine.2026", isTimeMachine: true }],
          embedded: true,
        }),
    )
    const host = document.createElement("div")
    host.innerHTML = html
    expect(host.textContent).toContain("4 APFS snapshots are present; showing 1 read-only identities.")
    expect(host.textContent).toContain("2 purgeable · 1 Time Machine")
    expect(host.textContent).toContain("read-only evidence, not a size estimate or a deletion action")
    expect(host.textContent).not.toMatch(/\d+\s?(?:KB|MB|GB|TB)/)
  })
})
