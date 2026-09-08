import * as React from "react"
import type { AsyncStorage, SyncStorage } from "@/lib/storage"
import { DESKTOP_NATIVE_LOCALE_TAGS, resolveDiskLizardReleaseLocale, type DesktopNativeLocale } from "../../i18n/desktop-native"
import {
  diskCleanupLocksDefault,
  diskPinnedLocationsDefault,
  type DiskAccessGuidanceKey,
  type DiskCleanupLock,
  type DiskPinnedLocation,
  type DiskUtilityAPI,
} from "./types"
import {
  CLEANUP_LOCK_LIMIT,
  decodeSavedPaths,
  PINNED_LOCATION_LIMIT,
  sanitizeSavedPaths,
  type SavedPath,
  type SavedPathOptions,
} from "./saved-paths"
import {
  DISK_ACCESS_GUIDANCE,
  DISK_LANGUAGE_PLURALS,
  DISK_LANGUAGE_TEXT,
  type DiskLanguageKey,
  type DiskLanguageMessageKey,
  type DiskLanguagePluralCategory,
  type DiskLanguagePluralKey,
} from "./runtime-language"

export type DiskLizardOS = "macos" | "windows" | "linux"

export type DiskLizardUpdaterState =
  | { status: "disabled" }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "downloading"; version: string; percent?: number }
  | { status: "ready"; version: string }
  | { status: "up-to-date" }
  | { status: "installing"; version: string }
  | { status: "error"; message: string }

export type DiskLizardMenu = {
  register(id: string, handler: () => unknown): () => void
  run(id: string): unknown
}

export function createDiskLizardMenu(): DiskLizardMenu {
  const handlers = new Map<string, () => unknown>()
  return {
    register(id, handler) {
      handlers.set(id, handler)
      return () => {
        if (handlers.get(id) === handler) handlers.delete(id)
      }
    },
    run(id) {
      return handlers.get(id)?.()
    },
  }
}

export type DiskLizardPlatform = {
  platform: "desktop"
  os?: DiskLizardOS
  version?: string
  diskUtility: DiskUtilityAPI
  menu?: DiskLizardMenu
  getPathForFile?: (file: File) => string
  storage?: (name?: string) => SyncStorage | AsyncStorage
  updater?: {
    state: DiskLizardUpdaterState
    check(): Promise<DiskLizardUpdaterState>
    install(): Promise<void>
  }
  restart?: () => Promise<void>
  exportDiagnostics?: () => Promise<string>
  openExternal?: (url: string) => void
  windowFullscreen?: boolean
  dispose?: () => void
}

export { DISK_ACCESS_GUIDANCE }
export type { DiskAccessGuidanceKey, DiskLanguageKey, DiskLanguageMessageKey, DiskLanguagePluralCategory, DiskLanguagePluralKey }
export { DISK_LANGUAGE_TEXT, DISK_LANGUAGE_PLURALS }

type Placeholder<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholder<Rest>
  : never
type TextParams<Key extends DiskLanguageKey> = Record<Placeholder<(typeof DISK_LANGUAGE_TEXT)[Key]>, string | number>
type TextArgs<Key extends DiskLanguageKey> = [Placeholder<(typeof DISK_LANGUAGE_TEXT)[Key]>] extends [never]
  ? []
  : [params: TextParams<Key>]
type PluralTemplate<Key extends DiskLanguagePluralKey> =
  | (typeof DISK_LANGUAGE_PLURALS)[Key]["one"]
  | (typeof DISK_LANGUAGE_PLURALS)[Key]["other"]
type PluralParams<Key extends DiskLanguagePluralKey> = Record<
  Exclude<Placeholder<PluralTemplate<Key>>, "count">,
  string | number
>
type PluralArgs<Key extends DiskLanguagePluralKey> = [Exclude<Placeholder<PluralTemplate<Key>>, "count">] extends [
  never,
]
  ? []
  : [params: PluralParams<Key>]

function interpolate(template: string, params: Readonly<Record<string, string | number>>) {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}|\{\s*([^{}]+?)\s*\}/g, (match, double, single) => {
    const name = String(double ?? single)
    return params[name] === undefined ? match : String(params[name])
  })
}

export function resolveDiskLanguageLocale(languages: readonly string[]) {
  const locale = resolveDiskLizardReleaseLocale(languages)
  return {
    locale,
    intl: DESKTOP_NATIVE_LOCALE_TAGS[locale],
  } as const
}

export function createDiskLanguage(
  locale: DesktopNativeLocale,
  messages: Readonly<Partial<Record<DiskLanguageMessageKey, string>>> = {},
) {
  const intl = DESKTOP_NATIVE_LOCALE_TAGS[locale]
  const rules = new Intl.PluralRules(intl)
  const englishRules = new Intl.PluralRules(DESKTOP_NATIVE_LOCALE_TAGS.en)

  return {
    locale,
    intl,
    t<Key extends DiskLanguageKey>(key: Key, ...args: TextArgs<Key>) {
      return interpolate(messages[key] ?? DISK_LANGUAGE_TEXT[key], args[0] ?? {})
    },
    plural<Key extends DiskLanguagePluralKey>(key: Key, count: number, ...args: PluralArgs<Key>) {
      const category = rules.select(count) as DiskLanguagePluralCategory
      const localized = messages[`${key}.${category}`] ?? messages[`${key}.other`]
      const englishCategory = englishRules.select(count)
      const english = DISK_LANGUAGE_PLURALS[key][englishCategory === "one" ? "one" : "other"]
      return interpolate(localized ?? english, { count, ...args[0] })
    },
  }
}

export type DiskLanguage = ReturnType<typeof createDiskLanguage>

let activeDiskLanguage = createDiskLanguage("en")
let languageVersion = 0
const languageListeners = new Set<() => void>()

function subscribeLanguage(listener: () => void) {
  languageListeners.add(listener)
  return () => languageListeners.delete(listener)
}

export function configureDiskLanguage(locale: DesktopNativeLocale, messages: Readonly<Record<string, string>> = {}) {
  activeDiskLanguage = createDiskLanguage(locale, messages)
  languageVersion += 1
  for (const listener of [...languageListeners]) listener()
  return activeDiskLanguage
}

export function diskLanguageText<Key extends DiskLanguageKey>(key: Key, ...args: TextArgs<Key>) {
  return activeDiskLanguage.t(key, ...args)
}

export function diskLanguagePlural<Key extends DiskLanguagePluralKey>(
  key: Key,
  count: number,
  ...args: PluralArgs<Key>
) {
  return activeDiskLanguage.plural(key, count, ...args)
}

const PINNED_STORAGE_NAME = "disklizard.dat"
const PINNED_STORAGE_KEY = "pinned-locations"
const CLEANUP_LOCK_STORAGE_KEY = "cleanup-locks"

const PlatformContext = React.createContext<DiskLizardPlatform | undefined>(undefined)

export function usePlatform() {
  const platform = React.useContext(PlatformContext)
  if (!platform) throw new Error("usePlatform must be used within DiskLizardRuntime")
  return platform
}

/**
 * Reactive language hook. Plain values (no accessors): `locale`, `intl`,
 * `t(key, params)`, `plural(key, count, params)`.
 */
export function useLanguage() {
  const version = React.useSyncExternalStore(
    subscribeLanguage,
    () => languageVersion,
    () => languageVersion,
  )
  return React.useMemo(
    () => ({
      locale: activeDiskLanguage.locale,
      intl: activeDiskLanguage.intl,
      t: diskLanguageText,
      plural: diskLanguagePlural,
    }),
    [version],
  )
}

type DiskSettingsStorage = SyncStorage | AsyncStorage
export type DiskCleanupLocksStatus = "loading" | "saving" | "ready" | "error"

export type DiskSettingsWriteResult<T extends SavedPath> = {
  ok: boolean
  /** The in-memory value after persistence succeeds or a failed write rolls back. */
  value: T[]
}

type DiskSettingsOptions = {
  os?: DiskLizardOS
}

function storageErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Preview copy that names the platform's system previewer: Quick Look on
 * macOS, the default app elsewhere. Falls back to neutral wording when the
 * platform is unknown.
 */
export function diskPreviewTooLargeBody(os?: DiskLizardOS) {
  return diskLanguageText(os === "macos" ? "disk.preview.tooLarge.body" : "disk.preview.tooLarge.bodyDefault")
}

export type DiskSettingsSnapshot = {
  locations: DiskPinnedLocation[]
  locks: DiskCleanupLock[]
  cleanupLocksStatus: DiskCleanupLocksStatus
  persistenceError: string | undefined
}

export type DiskSettingsStore = {
  ready: Promise<void>
  subscribe(listener: () => void): () => void
  getSnapshot(): DiskSettingsSnapshot
  general: {
    diskPinnedLocations(): DiskPinnedLocation[]
    setDiskPinnedLocations(next: DiskPinnedLocation[]): Promise<DiskSettingsWriteResult<DiskPinnedLocation>>
    diskCleanupLocks(): DiskCleanupLock[]
    setDiskCleanupLocks(next: DiskCleanupLock[]): Promise<DiskSettingsWriteResult<DiskCleanupLock>>
    cleanupLocksStatus(): DiskCleanupLocksStatus
    retryDiskCleanupLocks(): Promise<boolean>
    resetDiskCleanupLocks(): Promise<boolean>
    persistenceError(): string | undefined
  }
}

type DiskSettingsState = {
  locations: DiskPinnedLocation[]
  locks: DiskCleanupLock[]
  cleanupLocksStatus: DiskCleanupLocksStatus
  pinsError: string | undefined
  locksError: string | undefined
}

/**
 * Persisted settings store (pinned locations + cleanup locks) with the same
 * write-serialization and rollback semantics as v1, exposed as a
 * subscribe/snapshot store for `useSyncExternalStore`.
 */
export function createDiskSettings(storage?: DiskSettingsStorage, options: DiskSettingsOptions = {}): DiskSettingsStore {
  let state: DiskSettingsState = {
    locations: [...diskPinnedLocationsDefault] as DiskPinnedLocation[],
    locks: [...diskCleanupLocksDefault] as DiskCleanupLock[],
    cleanupLocksStatus: storage ? "loading" : "ready",
    pinsError: undefined,
    locksError: undefined,
  }
  const listeners = new Set<() => void>()

  let snapshot: DiskSettingsSnapshot = {
    locations: state.locations,
    locks: state.locks,
    cleanupLocksStatus: state.cleanupLocksStatus,
    persistenceError: undefined,
  }

  function commit(patch: Partial<DiskSettingsState>) {
    state = { ...state, ...patch }
    snapshot = {
      locations: state.locations,
      locks: state.locks,
      cleanupLocksStatus: state.cleanupLocksStatus,
      persistenceError: state.locksError ?? state.pinsError,
    }
    for (const listener of [...listeners]) listener()
  }

  const errorPatch = (kind: "pins" | "locks", error: string | undefined) =>
    kind === "locks" ? { locksError: error } : { pinsError: error }

  let pinsRevision = 0
  let locksRevision = 0
  let writes: Promise<unknown> = Promise.resolve()

  const read = async (
    kind: "pins" | "locks",
    key: string,
    pathOptions: SavedPathOptions,
    revision: number,
    apply: (value: SavedPath[]) => void,
  ) => {
    if (!storage) {
      if (kind === "locks") commit({ cleanupLocksStatus: "ready" })
      return true
    }
    try {
      const parsed = decodeSavedPaths(await storage.getItem(key), pathOptions)
      if (parsed.status === "invalid") {
        throw new Error(kind === "locks" ? "Saved cleanup protections are invalid" : "Saved scan locations are invalid")
      }
      if (revision === (kind === "locks" ? locksRevision : pinsRevision)) apply(parsed.status === "valid" ? parsed.value : [])
      commit(errorPatch(kind, undefined))
      if (kind === "locks") commit({ cleanupLocksStatus: "ready" })
      return true
    } catch (error) {
      commit(errorPatch(kind, storageErrorMessage(error)))
      if (kind === "locks") commit({ cleanupLocksStatus: "error" })
      return false
    }
  }

  const pinnedPathOptions = { limit: PINNED_LOCATION_LIMIT, os: options.os } satisfies SavedPathOptions
  const cleanupLockPathOptions = {
    limit: CLEANUP_LOCK_LIMIT,
    os: options.os,
    foldWindowsCase: true,
    rejectDiscardedEntries: true,
  } satisfies SavedPathOptions

  const ready = Promise.all([
    read("pins", PINNED_STORAGE_KEY, pinnedPathOptions, pinsRevision, (value) => commit({ locations: value })),
    read("locks", CLEANUP_LOCK_STORAGE_KEY, cleanupLockPathOptions, locksRevision, (value) => commit({ locks: value })),
  ]).then(() => undefined)

  const write = (kind: "pins" | "locks", key: string, value: unknown) => {
    if (!storage) {
      commit(errorPatch(kind, undefined))
      return Promise.resolve(true)
    }
    const operation = writes.then(async () => {
      try {
        await storage.setItem(key, JSON.stringify(value))
        commit(errorPatch(kind, undefined))
        return true
      } catch (error) {
        commit(errorPatch(kind, storageErrorMessage(error)))
        return false
      }
    })
    writes = operation
    return operation
  }

  const persistPins = async (next: DiskPinnedLocation[]): Promise<DiskSettingsWriteResult<DiskPinnedLocation>> => {
    const sanitized = sanitizeSavedPaths(next, pinnedPathOptions)
    const previous = [...state.locations]
    const revision = ++pinsRevision
    commit({ locations: sanitized })
    const ok = await write("pins", PINNED_STORAGE_KEY, sanitized)
    if (!ok && revision === pinsRevision) commit({ locations: previous })
    return { ok, value: [...state.locations] }
  }
  const persistLocks = async (next: DiskCleanupLock[]): Promise<DiskSettingsWriteResult<DiskCleanupLock>> => {
    if (state.cleanupLocksStatus !== "ready") return { ok: false, value: [...state.locks] }
    const sanitized = sanitizeSavedPaths(next, cleanupLockPathOptions)
    const revision = ++locksRevision
    commit({ cleanupLocksStatus: "saving" })
    const ok = await write("locks", CLEANUP_LOCK_STORAGE_KEY, sanitized)
    if (ok && revision === locksRevision) commit({ locks: sanitized })
    if (revision === locksRevision) commit({ cleanupLocksStatus: "ready" })
    return { ok, value: [...state.locks] }
  }

  const retryCleanupLocks = async () => {
    if (!storage || state.cleanupLocksStatus !== "error") return false
    commit({ cleanupLocksStatus: "loading", locksError: undefined })
    return read("locks", CLEANUP_LOCK_STORAGE_KEY, cleanupLockPathOptions, locksRevision, (value) =>
      commit({ locks: value }),
    )
  }

  const resetCleanupLocks = async () => {
    if (!storage || state.cleanupLocksStatus !== "error") return false
    const revision = ++locksRevision
    commit({ cleanupLocksStatus: "saving", locksError: undefined })
    const ok = await write("locks", CLEANUP_LOCK_STORAGE_KEY, [])
    if (revision !== locksRevision) return false
    if (!ok) {
      commit({ cleanupLocksStatus: "error" })
      return false
    }
    commit({ locks: [], cleanupLocksStatus: "ready" })
    return true
  }

  return {
    ready,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot() {
      return snapshot
    },
    general: {
      diskPinnedLocations: () => state.locations,
      setDiskPinnedLocations: persistPins,
      diskCleanupLocks: () => state.locks,
      setDiskCleanupLocks: persistLocks,
      cleanupLocksStatus: () => state.cleanupLocksStatus,
      retryDiskCleanupLocks: retryCleanupLocks,
      resetDiskCleanupLocks: resetCleanupLocks,
      persistenceError: () => state.locksError ?? state.pinsError,
    },
  }
}

export function createPersistenceErrorDeduper() {
  let previous: string | undefined
  return (error: string | undefined) => {
    if (!error) {
      previous = undefined
      return
    }
    if (error === previous) return
    previous = error
    return error
  }
}

/**
 * Reactive settings hook over the platform-backed settings store. Returns a
 * stable snapshot plus the write operations.
 */
export function useSettings() {
  const platform = usePlatform()
  const store = React.useMemo(
    () => createDiskSettings(platform.storage?.(PINNED_STORAGE_NAME), { os: platform.os }),
    [platform.storage, platform.os],
  )
  const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
  return { store, ...snapshot }
}

export function DiskLizardRuntime(props: { platform: DiskLizardPlatform; children?: React.ReactNode }) {
  const value = React.useMemo(() => props.platform, [props.platform])
  return <PlatformContext.Provider value={value}>{props.children}</PlatformContext.Provider>
}
