import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createDiskSettings } from "@disklizard/app/runtime"
import { createRoot } from "solid-js"
import { createDesktopStorage, createDiskLizardPlatform, desktopOS } from "./platform"

const renderer = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.tsx"), "utf8")

describe("desktop renderer initialization", () => {
  test("opens directly into the DiskLizard storage interface", () => {
    expect(renderer).toContain("<DiskUtilityPage")
    expect(renderer).toContain("DiskLizardRuntime")
    expect(renderer).toContain("loadRendererLanguage")
    expect(renderer).toContain("configureDiskLanguage")
    expect(renderer).not.toContain("LoadingSplash")
    expect(renderer).not.toContain("awaitInitialization")
  })

  test("builds a desktop-only platform without OpenCode servers or drafts", () => {
    let fullscreenListener: ((fullscreen: boolean) => void) | undefined
    let fullscreenUnsubscribed = false
    const api = {
      disklizard: {
        getDrives: async () => [],
        onDriveFacts: () => () => undefined,
        getStorageDiagnostics: async () => ({ access: { status: "not-applicable", probes: [] }, locations: [] }),
        openDiskAccessSettings: async () => false,
        scanPath: async () => null,
        cancelScan: async () => undefined,
        stopWatching: async () => undefined,
        authorizeDeletePaths: async (paths: readonly string[]) =>
          paths.map((path) => ({ path, authorization: `authorization:${path}` })),
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
      getWindowFullscreen: async () => true,
      onWindowFullscreenChanged: (cb: (fullscreen: boolean) => void) => {
        fullscreenListener = cb
        return () => {
          fullscreenUnsubscribed = true
        }
      },
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
    fullscreenListener?.(true)
    expect(platform.windowFullscreen?.()).toBe(true)
    platform.dispose?.()
    expect(fullscreenUnsubscribed).toBe(true)
  })

  test("keeps the cleanup gate closed when the desktop storage bridge rejects a read", async () => {
    const api = {
      storeGet: async (key: string) => {
        if (key === "cleanup-locks") throw new Error("settings unreadable")
        return null
      },
      storeSet: async () => undefined,
      storeDelete: async () => undefined,
      storeClear: async () => undefined,
      storeKeys: async () => [],
      storeLength: async () => 0,
    }
    ;(globalThis as { window?: { api: typeof api } }).window = { api }

    const storage = createDesktopStorage()()
    await expect(storage.getItem("cleanup-locks")).rejects.toThrow("settings unreadable")
    await expect(storage.getItem("pinned-locations")).resolves.toBeNull()

    await createRoot(async (dispose) => {
      const settings = createDiskSettings(storage, { os: "linux" })
      await settings.ready
      expect(settings.general.cleanupLocksStatus()).toBe("error")
      expect(settings.general.diskCleanupLocks()).toEqual([])
      expect(settings.general.persistenceError()).toBe("settings unreadable")
      dispose()
    })
  })
})
