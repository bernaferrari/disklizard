import { describe, expect, it } from "bun:test"
import { storageProviderLabel, shouldShowStorageDiagnostics } from "./StorageDiagnostics"

describe("storage diagnostics presentation", () => {
  it("uses product names for mounted storage providers", () => {
    expect(storageProviderLabel("google-drive")).toBe("Google Drive")
    expect(storageProviderLabel("icloud")).toBe("iCloud Drive")
    expect(storageProviderLabel("network")).toBe("Network location")
  })

  it("only surfaces evidence that gives the user an action", () => {
    expect(
      shouldShowStorageDiagnostics({ access: { status: "inconclusive", probes: [] }, locations: [] }),
    ).toBe(false)
    expect(
      shouldShowStorageDiagnostics({
        access: { status: "limited", probes: [{ name: "Mail", status: "denied" }] },
        locations: [],
      }),
    ).toBe(true)
    expect(
      shouldShowStorageDiagnostics({
        access: { status: "not-applicable", probes: [] },
        locations: [{ path: "/Volumes/Team", name: "Team", kind: "network", provider: "network" }],
      }),
    ).toBe(true)
  })
})
