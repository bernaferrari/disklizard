import { describe, expect, test } from "bun:test"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createRoot } from "solid-js"
import { dict as de } from "@/i18n/de"
import { DISK_CHOOSE_FOLDER_COMMAND } from "./choose-folder"
import {
  createDiskLanguage,
  createDiskLizardMenu,
  createPersistenceErrorDeduper,
  createDiskSettings,
  DISK_ACCESS_GUIDANCE,
  DISK_LANGUAGE_TEXT,
  diskLanguagePlural,
  diskLanguageText,
  resolveDiskLanguageLocale,
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

  test("keeps the public beta in English regardless of OS language", () => {
    expect(resolveDiskLanguageLocale(["not_a_locale", "de-DE"])).toEqual({ locale: "en", intl: "en" })
    expect(resolveDiskLanguageLocale(["zh-TW"])).toEqual({ locale: "en", intl: "en" })
    expect(resolveDiskLanguageLocale(["eo", "invalid"])).toEqual({ locale: "en", intl: "en" })
  })

  test("uses selected catalog entries with a typed English fallback", () => {
    const language = createDiskLanguage("de", de)
    expect(language.t("disk.accessGuidance.rescan")).toBe(de["disk.accessGuidance.rescan"])
    expect(language.t("disk.common.scan")).toBe(DISK_LANGUAGE_TEXT["disk.common.scan"])
  })

  test("uses the selected locale's plural category before the English fallback", () => {
    const language = createDiskLanguage("ru", {
      "disk.count.item.one": "one:{count}",
      "disk.count.item.few": "few:{count}",
      "disk.count.item.many": "many:{count}",
      "disk.count.item.other": "other:{count}",
    })
    expect(language.plural("disk.count.item", 1)).toBe("one:1")
    expect(language.plural("disk.count.item", 2)).toBe("few:2")
    expect(language.plural("disk.count.item", 5)).toBe("many:5")
    expect(language.plural("disk.count.item", 1.5)).toBe("other:1.5")

    const fallback = createDiskLanguage("fr")
    expect(fallback.plural("disk.count.item", 0)).toBe("0 items")
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

  test("keeps cleanup protections unavailable until hydration succeeds", async () => {
    const locks = deferred<string | null>()
    let writes = 0
    const storage = {
      getItem: (key: string) => (key === "cleanup-locks" ? locks.promise : Promise.resolve(null)),
      setItem: async () => {
        writes += 1
      },
      removeItem: async () => undefined,
    } as AsyncStorage

    await createRoot(async (dispose) => {
      const settings = createDiskSettings(storage, { os: "linux" })
      expect(settings.general.cleanupLocksStatus()).toBe("loading")
      await expect(
        settings.general.setDiskCleanupLocks([{ path: "/protected", label: "Protected" }]),
      ).resolves.toEqual({ ok: false, value: [] })
      expect(writes).toBe(0)

      locks.resolve(JSON.stringify([{ path: "/protected", label: "Protected" }]))
      await settings.ready
      expect(settings.general.cleanupLocksStatus()).toBe("ready")
      expect(settings.general.diskCleanupLocks()).toEqual([{ path: "/protected", label: "Protected" }])
      dispose()
    })
  })

  test("fails closed when saved cleanup protections are malformed or unreadable", async () => {
    for (const getItem of [
      async (key: string) => (key === "cleanup-locks" ? "not json" : null),
      async (key: string) => {
        if (key === "cleanup-locks") throw new Error("settings unreadable")
        return null
      },
    ]) {
      const storage = { getItem, setItem: async () => undefined, removeItem: async () => undefined } as AsyncStorage
      await createRoot(async (dispose) => {
        const settings = createDiskSettings(storage, { os: "macos" })
        await settings.ready
        expect(settings.general.cleanupLocksStatus()).toBe("error")
        expect(settings.general.diskCleanupLocks()).toEqual([])
        expect(settings.general.persistenceError()).toBeTruthy()
        dispose()
      })
    }
  })

  test("fails closed when any saved cleanup-protection entry must be discarded", async () => {
    const storage = {
      getItem: async (key: string) =>
        key === "cleanup-locks"
          ? JSON.stringify([
              { path: "/protected", label: "Protected" },
              { path: "/corrupt-label", label: "x".repeat(513) },
            ])
          : null,
      setItem: async () => undefined,
      removeItem: async () => undefined,
    } as AsyncStorage

    await createRoot(async (dispose) => {
      const settings = createDiskSettings(storage, { os: "linux" })
      await settings.ready
      expect(settings.general.cleanupLocksStatus()).toBe("error")
      expect(settings.general.diskCleanupLocks()).toEqual([])
      expect(settings.general.persistenceError()).toBe("Saved cleanup protections are invalid")
      dispose()
    })
  })

  test("can retry a failed cleanup-protection read without opening the gate early", async () => {
    let readable = false
    const storage = {
      getItem: async (key: string) => {
        if (key !== "cleanup-locks") return null
        if (!readable) throw new Error("temporarily unreadable")
        return JSON.stringify([{ path: "/protected", label: "Protected" }])
      },
      setItem: async () => undefined,
      removeItem: async () => undefined,
    } as AsyncStorage

    await createRoot(async (dispose) => {
      const settings = createDiskSettings(storage, { os: "linux" })
      await settings.ready
      expect(settings.general.cleanupLocksStatus()).toBe("error")
      readable = true
      const retry = settings.general.retryDiskCleanupLocks()
      expect(settings.general.cleanupLocksStatus()).toBe("loading")
      await expect(retry).resolves.toBe(true)
      expect(settings.general.cleanupLocksStatus()).toBe("ready")
      expect(settings.general.diskCleanupLocks()).toEqual([{ path: "/protected", label: "Protected" }])
      dispose()
    })
  })

  test("resets unreadable cleanup protections only after an empty list is durably saved", async () => {
    const saved = deferred<void>()
    const writes: Array<{ key: string; value: string }> = []
    const storage = {
      getItem: async (key: string) => (key === "cleanup-locks" ? "not json" : null),
      setItem: async (key: string, value: string) => {
        writes.push({ key, value })
        await saved.promise
      },
      removeItem: async () => undefined,
    } as AsyncStorage

    await createRoot(async (dispose) => {
      const settings = createDiskSettings(storage, { os: "linux" })
      await settings.ready
      expect(settings.general.cleanupLocksStatus()).toBe("error")

      const resetting = settings.general.resetDiskCleanupLocks()
      expect(settings.general.cleanupLocksStatus()).toBe("saving")
      expect(settings.general.diskCleanupLocks()).toEqual([])
      await expect(settings.general.resetDiskCleanupLocks()).resolves.toBe(false)
      await expect(
        settings.general.setDiskCleanupLocks([{ path: "/protected", label: "Protected" }]),
      ).resolves.toEqual({ ok: false, value: [] })
      await Promise.resolve()
      expect(writes).toEqual([{ key: "cleanup-locks", value: "[]" }])

      saved.resolve()
      await expect(resetting).resolves.toBe(true)
      expect(settings.general.cleanupLocksStatus()).toBe("ready")
      expect(settings.general.diskCleanupLocks()).toEqual([])
      await expect(settings.general.resetDiskCleanupLocks()).resolves.toBe(false)
      expect(writes).toHaveLength(1)
      dispose()
    })
  })

  test("keeps cleanup disabled when resetting saved protections fails", async () => {
    let canWrite = false
    const storage = {
      getItem: async (key: string) => (key === "cleanup-locks" ? "not json" : null),
      setItem: async () => {
        if (!canWrite) throw new Error("settings still unavailable")
      },
      removeItem: async () => undefined,
    } as AsyncStorage

    await createRoot(async (dispose) => {
      const settings = createDiskSettings(storage, { os: "macos" })
      await settings.ready
      await expect(settings.general.resetDiskCleanupLocks()).resolves.toBe(false)
      expect(settings.general.cleanupLocksStatus()).toBe("error")
      expect(settings.general.persistenceError()).toBe("settings still unavailable")

      canWrite = true
      await expect(settings.general.resetDiskCleanupLocks()).resolves.toBe(true)
      expect(settings.general.cleanupLocksStatus()).toBe("ready")
      expect(settings.general.persistenceError()).toBeUndefined()
      dispose()
    })
  })

  test("bounds tolerant pins and normalizes a fully valid cleanup-lock set during hydration", async () => {
    const pins = [
      { path: "relative", label: "Invalid" },
      ...Array.from({ length: 20 }, (_, index) => ({ path: `/pin/${index}/`, label: ` Pin ${index} ` })),
    ]
    const locks = [
      { path: "C:\\Work\\App", label: "App" },
      ...Array.from({ length: 23 }, (_, index) => ({ path: `/lock/${index}/`, label: ` ${index} ` })),
    ]
    const storage = {
      getItem: async (key: string) => JSON.stringify(key === "pinned-locations" ? pins : locks),
      setItem: async () => undefined,
      removeItem: async () => undefined,
    } as AsyncStorage

    await createRoot(async (dispose) => {
      const settings = createDiskSettings(storage)
      await settings.ready

      expect(settings.general.diskPinnedLocations()).toHaveLength(12)
      expect(settings.general.diskPinnedLocations()[0]).toEqual({ path: "/pin/0", label: "Pin 0" })
      expect(settings.general.diskCleanupLocks()).toHaveLength(24)
      expect(settings.general.diskCleanupLocks()[0]).toEqual({ path: "C:/Work/App", label: "App" })
      expect(settings.general.diskCleanupLocks()[1]).toEqual({ path: "/lock/0", label: "0" })
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
      const one = settings.general.setDiskPinnedLocations([{ path: "/one", label: "One" }])
      const two = settings.general.setDiskPinnedLocations([{ path: "/two", label: "Two" }])
      await Promise.resolve()
      expect(attempts).toBe(1)
      first.resolve()
      await Promise.all([one, two])
      expect(writes).toEqual([
        JSON.stringify([{ path: "/one", label: "One" }]),
        JSON.stringify([{ path: "/two", label: "Two" }]),
      ])
      expect(settings.general.persistenceError()).toBe("disk full")
      expect(settings.general.diskPinnedLocations()).toEqual([{ path: "/one", label: "One" }])
      dispose()
    })
  })

  test("keeps loaded locks active and the cleanup gate closed while an unlock is being saved", async () => {
    const write = deferred<void>()
    const storage = {
      getItem: async (key: string) =>
        key === "cleanup-locks" ? JSON.stringify([{ path: "/protected", label: "Protected" }]) : null,
      setItem: async () => write.promise,
      removeItem: async () => undefined,
    } as AsyncStorage

    await createRoot(async (dispose) => {
      const settings = createDiskSettings(storage, { os: "linux" })
      await settings.ready
      const unlocking = settings.general.setDiskCleanupLocks([])
      expect(settings.general.cleanupLocksStatus()).toBe("saving")
      expect(settings.general.diskCleanupLocks()).toEqual([{ path: "/protected", label: "Protected" }])
      write.resolve()
      await expect(unlocking).resolves.toEqual({ ok: true, value: [] })
      expect(settings.general.cleanupLocksStatus()).toBe("ready")
      expect(settings.general.diskCleanupLocks()).toEqual([])
      dispose()
    })
  })

  test("rolls back a failed lock write and does not clear its error after a pin succeeds", async () => {
    const persisted = new Map<string, string>()
    const storage = {
      getItem: async (key: string) => persisted.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        if (key === "cleanup-locks") throw new Error("lock store unavailable")
        persisted.set(key, value)
      },
      removeItem: async () => undefined,
    } as AsyncStorage

    await createRoot(async (dispose) => {
      const settings = createDiskSettings(storage, { os: "linux" })
      await settings.ready
      await expect(
        settings.general.setDiskCleanupLocks([{ path: "/protected", label: "Protected" }]),
      ).resolves.toEqual({ ok: false, value: [] })
      expect(settings.general.diskCleanupLocks()).toEqual([])
      expect(settings.general.persistenceError()).toBe("lock store unavailable")

      await expect(
        settings.general.setDiskPinnedLocations([{ path: "/saved", label: "Saved" }]),
      ).resolves.toEqual({ ok: true, value: [{ path: "/saved", label: "Saved" }] })
      expect(settings.general.persistenceError()).toBe("lock store unavailable")
      expect(persisted.has("cleanup-locks")).toBe(false)
      dispose()
    })
  })

  test("deduplicates persistence feedback until the error clears", () => {
    const nextError = createPersistenceErrorDeduper()
    expect(nextError("disk full")).toBe("disk full")
    expect(nextError("disk full")).toBeUndefined()
    expect(nextError("permission denied")).toBe("permission denied")
    expect(nextError(undefined)).toBeUndefined()
    expect(nextError("disk full")).toBe("disk full")
  })
})
