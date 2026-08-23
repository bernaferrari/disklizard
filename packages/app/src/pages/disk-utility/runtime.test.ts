import { describe, expect, test } from "bun:test"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createRoot } from "solid-js"
import { DISK_CHOOSE_FOLDER_COMMAND } from "./choose-folder"
import {
  createDiskLizardMenu,
  createDiskSettings,
  DISK_ACCESS_GUIDANCE,
  DISK_LANGUAGE_TEXT,
  diskLanguagePlural,
  diskLanguageText,
} from "./runtime"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("DiskLizard runtime language", () => {
  test("resolves the shipped access-guidance copy", () => {
    expect(diskLanguageText("disk.accessGuidance.rescan")).toBe(DISK_ACCESS_GUIDANCE["disk.accessGuidance.rescan"])
    expect(diskLanguageText("disk.accessGuidance.macos")).toContain("Full Disk Access")
    expect(diskLanguageText("disk.sort.key.modified")).toBe("Modified")
    expect(DISK_LANGUAGE_TEXT["disk.search.label"]).toBe("Search this scan")
    expect(diskLanguageText("disk.toast.driveReady", { name: "Archive" })).toBe("Archive is ready")
    expect(diskLanguagePlural("disk.count.item", 1)).toBe("1 item")
    expect(diskLanguagePlural("disk.count.item", 2)).toBe("2 items")
  })

  test("runs the registered Scan Folder handler and forgets it after unbind", async () => {
    const menu = createDiskLizardMenu()
    const runs: string[] = []
    const unbind = menu.register(DISK_CHOOSE_FOLDER_COMMAND, () => {
      runs.push("scan")
    })
    await menu.run(DISK_CHOOSE_FOLDER_COMMAND)
    unbind()
    await menu.run(DISK_CHOOSE_FOLDER_COMMAND)
    expect(runs).toEqual(["scan"])
  })

  test("does not let late hydration overwrite a user mutation", async () => {
    const pins = deferred<string | null>()
    const locks = deferred<string | null>()
    const storage = {
      getItem: (key: string) => (key === "pinned-locations" ? pins.promise : locks.promise),
      setItem: async () => undefined,
      removeItem: async () => undefined,
    } as AsyncStorage

    await createRoot(async (dispose) => {
      const settings = createDiskSettings(storage)
      const next = [{ path: "/new", label: "New" }]
      await settings.general.setDiskPinnedLocations(next)
      pins.resolve(JSON.stringify([{ path: "/old", label: "Old" }]))
      locks.resolve("[]")
      await settings.ready
      expect(settings.general.diskPinnedLocations()).toEqual(next)
      dispose()
    })
  })

  test("serializes storage writes and exposes persistence failures", async () => {
    const first = deferred<void>()
    const writes: string[] = []
    let attempts = 0
    const storage = {
      getItem: async () => null,
      setItem: async (_key: string, value: string) => {
        attempts += 1
        if (attempts === 1) await first.promise
        writes.push(value)
        if (attempts === 2) throw new Error("disk full")
      },
      removeItem: async () => undefined,
    } as AsyncStorage

    await createRoot(async (dispose) => {
      const settings = createDiskSettings(storage)
      await settings.ready
      const one = settings.general.setDiskCleanupLocks([{ path: "/one", label: "One" }])
      const two = settings.general.setDiskCleanupLocks([{ path: "/two", label: "Two" }])
      await Promise.resolve()
      expect(attempts).toBe(1)
      first.resolve()
      await Promise.all([one, two])
      expect(writes).toEqual([
        JSON.stringify([{ path: "/one", label: "One" }]),
        JSON.stringify([{ path: "/two", label: "Two" }]),
      ])
      expect(settings.general.persistenceError()).toBe("disk full")
      dispose()
    })
  })
})
