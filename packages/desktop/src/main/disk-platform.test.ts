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
        if (path.endsWith("Library/Mail")) throw Object.assign(new Error("denied"), { code: "EACCES" })
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
    })

    expect(diagnostics.access).toMatchObject({ status: "inconclusive" })
  })

  test("exposes native privacy settings only where the OS has a relevant destination", () => {
    expect(diskAccessSettingsUrl("darwin")).toContain("Privacy_AllFiles")
    expect(diskAccessSettingsUrl("win32")).toBe("ms-settings:privacy-broadfilesystemaccess")
    expect(diskAccessSettingsUrl("linux")).toBeUndefined()
  })
})
