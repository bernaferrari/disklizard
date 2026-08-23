import { describe, expect, it } from "bun:test"
import { storageAccessGuidance, storageProviderLabel, shouldShowStorageDiagnostics } from "./StorageDiagnostics"

const wholeVolume = {
  capability: "not-applicable" as const,
  status: "not-applicable" as const,
  mapCoverage: "not-applicable" as const,
  evidence: { source: "none" as const },
}

describe("storage diagnostics presentation", () => {
  it("uses product names for mounted storage providers", () => {
    expect(storageProviderLabel("google-drive")).toBe("Google Drive")
    expect(storageProviderLabel("icloud")).toBe("iCloud Drive")
    expect(storageProviderLabel("network")).toBe("Network location")
  })

  it("surfaces limited and inconclusive whole-volume coverage without claiming permission was granted", () => {
    expect(
      shouldShowStorageDiagnostics({
        access: {
          status: "inconclusive",
          probes: [],
          wholeVolume: {
            capability: "macos-full-disk-access",
            status: "inconclusive",
            mapCoverage: "unknown",
            evidence: { source: "protected-directory-probes", probes: [] },
          },
        },
        locations: [],
      }),
    ).toBe(true)
    expect(
      shouldShowStorageDiagnostics({
        access: {
          status: "limited",
          probes: [{ name: "Mail", status: "denied" }],
          wholeVolume: {
            capability: "macos-full-disk-access",
            status: "limited",
            mapCoverage: "may-be-incomplete",
            evidence: { source: "protected-directory-probes", probes: [{ name: "Mail", status: "denied" }] },
          },
        },
        locations: [],
      }),
    ).toBe(true)
    const macGuidance = storageAccessGuidance({
      access: {
        status: "inconclusive",
        probes: [],
        wholeVolume: {
          capability: "macos-full-disk-access",
          status: "granted",
          mapCoverage: "not-known-to-be-permission-limited",
          evidence: { source: "protected-directory-probes", probes: [] },
        },
      },
      locations: [],
    })
    expect(macGuidance).toBeUndefined()
  })

  it("still surfaces mounted locations when permission diagnostics do not apply", () => {
    expect(
      shouldShowStorageDiagnostics({
        access: { status: "not-applicable", probes: [], wholeVolume },
        locations: [{ path: "/Volumes/Team", name: "Team", kind: "network", provider: "network" }],
      }),
    ).toBe(true)
  })
})
