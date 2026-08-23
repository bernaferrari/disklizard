import { describe, expect, test } from "bun:test"
import {
  cloudStorageCandidates,
  cloudStorageProvider,
  diskAccessSettingsUrl,
  getDiskStorageDiagnostics,
} from "./disk-platform"

describe("disk platform diagnostics", () => {
  test("recognizes the mounted cloud storage providers without credentials", () => {
    expect(cloudStorageProvider("GoogleDrive-Work")).toBe("google-drive")
    expect(cloudStorageProvider("OneDrive-Acme")).toBe("onedrive")
    expect(cloudStorageProvider("com~apple~CloudDocs")).toBe("icloud")
    expect(cloudStorageProvider("Acme Sync")).toBe("other")
  })

  test("builds platform-correct cloud root candidates", () => {
    expect(cloudStorageCandidates("/Users/ada", "darwin")).toContainEqual({
      path: "/Users/ada/Library/Mobile Documents/com~apple~CloudDocs",
      name: "iCloud Drive",
      provider: "icloud",
    })
    expect(cloudStorageCandidates("C:\\Users\\Ada", "win32", { OneDrive: "D:\\Cloud\\OneDrive" })).toContainEqual({
      path: "D:\\Cloud\\OneDrive",
      name: "OneDrive",
      provider: "onedrive",
    })
  })

  test("lists accessible mounted cloud roots and network drives without probing remote services", async () => {
    const checked: string[] = []
    const diagnostics = await getDiskStorageDiagnostics({
      platform: "darwin",
      homePath: "/Users/ada",
      drives: [
        { path: "/Volumes/Team", name: "Team", label: "Team (/Volumes/Team)", type: "network" },
        { path: "/", name: "Macintosh HD", label: "Macintosh HD (/)", type: "local" },
      ],
      readDirectory: async (path) => (path.endsWith("CloudStorage") ? ["Dropbox", "GoogleDrive-Work"] : []),
      checkAccess: async (path) => {
        checked.push(path)
      },
      readProtectedDirectory: async (path) => {
        checked.push(path)
        if (path.endsWith("Library/Mail")) throw Object.assign(new Error("denied"), { code: "EACCES" })
        return []
      },
    })

    expect(diagnostics.access.status).toBe("limited")
    expect(diagnostics.access.probes).toContainEqual({ name: "Mail", status: "denied" })
    expect(diagnostics.locations).toEqual(
      expect.arrayContaining([
        { path: "/Users/ada/Library/CloudStorage/Dropbox", name: "Dropbox", kind: "cloud", provider: "dropbox" },
        {
          path: "/Users/ada/Library/CloudStorage/GoogleDrive-Work",
          name: "GoogleDrive-Work",
          kind: "cloud",
          provider: "google-drive",
        },
        { path: "/Volumes/Team", name: "Team", kind: "network", provider: "network" },
      ]),
    )
    expect(checked).toContain("/Users/ada/Library/Mail")
  })

  test("does not infer a permission grant from ordinary readable locations", async () => {
    const diagnostics = await getDiskStorageDiagnostics({
      platform: "darwin",
      homePath: "/Users/ada",
      readDirectory: async () => [],
      checkAccess: async () => undefined,
      readProtectedDirectory: async () => [],
    })

    expect(diagnostics.access).toMatchObject({ status: "inconclusive" })
    expect(diagnostics.access.wholeVolume).toMatchObject({
      capability: "macos-full-disk-access",
      status: "inconclusive",
      mapCoverage: "unknown",
    })
  })

  test("uses protected-directory enumeration rather than metadata access for macOS denial evidence", async () => {
    let metadataChecks = 0
    const diagnostics = await getDiskStorageDiagnostics({
      platform: "darwin",
      homePath: "/Users/ada",
      readDirectory: async () => [],
      checkAccess: async () => {
        metadataChecks++
      },
      readProtectedDirectory: async (path) => {
        if (path.endsWith("Library/Safari")) throw Object.assign(new Error("denied"), { code: "EPERM" })
        return []
      },
    })

    expect(metadataChecks).toBeGreaterThan(0)
    expect(diagnostics.access.wholeVolume).toMatchObject({
      status: "limited",
      mapCoverage: "may-be-incomplete",
      evidence: { source: "protected-directory-probes" },
    })
  })

  test("reports a high-integrity Windows administrator token as granted capability evidence", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = []
    const diagnostics = await getDiskStorageDiagnostics({
      platform: "win32",
      homePath: "C:\\Users\\Ada",
      readDirectory: async () => [],
      checkAccess: async () => undefined,
      runCommand: async (file, args) => {
        calls.push({ file, args })
        return '"Administrateurs","S-1-5-32-544"\n"Niveau obligatoire élevé","S-1-16-12288"'
      },
    })

    expect(calls).toEqual([{ file: "whoami.exe", args: ["/groups", "/fo", "csv", "/nh"] }])
    expect(diagnostics.access.wholeVolume).toEqual({
      capability: "windows-elevated-token",
      status: "granted",
      mapCoverage: "not-known-to-be-permission-limited",
      evidence: {
        source: "windows-token-groups",
        integrityLevel: "high",
        administratorsGroup: "present",
      },
    })
  })

  test("reports a filtered or standard Windows token as limited even when the account is an administrator", async () => {
    const diagnostics = await getDiskStorageDiagnostics({
      platform: "win32",
      homePath: "C:\\Users\\Ada",
      readDirectory: async () => [],
      checkAccess: async () => undefined,
      runCommand: async () => '"Administrators","S-1-5-32-544"\n"Medium","S-1-16-8192"',
    })

    expect(diagnostics.access.wholeVolume).toMatchObject({
      status: "limited",
      mapCoverage: "may-be-incomplete",
      evidence: {
        integrityLevel: "medium",
        administratorsGroup: "present",
      },
    })
  })

  test("keeps Windows capability inconclusive when token evidence is unavailable or contradictory", async () => {
    const unavailable = await getDiskStorageDiagnostics({
      platform: "win32",
      homePath: "C:\\Users\\Ada",
      readDirectory: async () => [],
      checkAccess: async () => undefined,
      runCommand: async () => {
        throw new Error("unavailable")
      },
    })
    const highWithoutAdmin = await getDiskStorageDiagnostics({
      platform: "win32",
      homePath: "C:\\Users\\Ada",
      readDirectory: async () => [],
      checkAccess: async () => undefined,
      runCommand: async () => '"High","S-1-16-12288"',
    })
    const conflictingIntegrity = await getDiskStorageDiagnostics({
      platform: "win32",
      homePath: "C:\\Users\\Ada",
      readDirectory: async () => [],
      checkAccess: async () => undefined,
      runCommand: async () =>
        '"Administrators","S-1-5-32-544"\n"Medium","S-1-16-8192"\n"High","S-1-16-12288"',
    })

    expect(unavailable.access.wholeVolume).toMatchObject({ status: "inconclusive", mapCoverage: "unknown" })
    expect(highWithoutAdmin.access.wholeVolume).toMatchObject({
      status: "inconclusive",
      mapCoverage: "unknown",
    })
    expect(conflictingIntegrity.access.wholeVolume).toMatchObject({
      status: "inconclusive",
      mapCoverage: "unknown",
      evidence: { integrityLevel: "unknown" },
    })
  })

  test("exposes native privacy settings only where the OS has a relevant destination", () => {
    expect(diskAccessSettingsUrl("darwin")).toContain("Privacy_AllFiles")
    expect(diskAccessSettingsUrl("win32")).toBe("ms-settings:privacy-broadfilesystemaccess")
    expect(diskAccessSettingsUrl("linux")).toBeUndefined()
  })
})
