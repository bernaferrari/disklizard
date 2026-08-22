import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createDiskLizardPlatform, desktopOS } from "./platform"

const renderer = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.tsx"), "utf8")

describe("desktop renderer initialization", () => {
  test("opens directly into the DiskLizard storage interface", () => {
    expect(renderer).toContain("<DiskUtilityPage")
    expect(renderer).toContain("DiskLizardRuntime")
    expect(renderer).not.toContain("LoadingSplash")
    expect(renderer).not.toContain("awaitInitialization")
  })

  test("builds a desktop-only platform without OpenCode servers or drafts", () => {
    const api = {
      disklizard: {
        getDrives: async () => [],
        onDriveFacts: () => () => undefined,
        getStorageDiagnostics: async () => ({ access: { status: "not-applicable", probes: [] }, locations: [] }),
        openDiskAccessSettings: async () => false,
        scanPath: async () => null,
        cancelScan: async () => undefined,
        stopWatching: async () => undefined,
        deletePath: async () => ({ ok: true as const }),
        previewPath: async () => ({ kind: "unsupported" as const, bytes: 0, reason: "format" as const }),
        systemPreviewPath: async () => undefined,
        openTrash: async () => undefined,
        revealPath: async () => undefined,
        chooseFolder: async () => null,
        onScanProgress: () => () => undefined,
        onScanUpdate: () => () => undefined,
      },
      storeGet: async () => null,
      storeSet: async () => undefined,
      storeDelete: async () => undefined,
      storeClear: async () => undefined,
      storeKeys: async () => [],
      storeLength: async () => 0,
      updater: { check: async () => ({ status: "disabled" as const }), install: async () => undefined },
      openPath: async () => undefined,
      getPathForFile: () => "",
      openExternal: () => undefined,
      revealPath: async () => false,
      relaunch: () => undefined,
    }
    ;(globalThis as { window?: { api: typeof api } }).window = { api }
    const platform = createDiskLizardPlatform(() => ({ status: "disabled" }))
    expect(platform.platform).toBe("desktop")
    expect(platform.diskUtility).toBeDefined()
    expect(platform.menu).toBeDefined()
    expect(platform).not.toHaveProperty("wslServers")
    expect(platform).not.toHaveProperty("draftStore")
    expect(platform).not.toHaveProperty("getDefaultServer")
    expect(["macos", "windows", "linux", undefined]).toContain(desktopOS())
  })
})
