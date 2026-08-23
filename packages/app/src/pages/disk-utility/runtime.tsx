import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import { createEffect, createMemo, createSignal, type Accessor, type ParentProps } from "solid-js"
import {
  diskCleanupLocksDefault,
  diskPinnedLocationsDefault,
  type DiskAccessGuidanceKey,
  type DiskCleanupLock,
  type DiskPinnedLocation,
  type DiskUtilityAPI,
} from "./types"

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
  openPath?: (path: string, app?: string) => Promise<void>
  getPathForFile?: (file: File) => string
  storage?: (name?: string) => SyncStorage | AsyncStorage
  updater?: {
    state: Accessor<DiskLizardUpdaterState>
    check(): Promise<DiskLizardUpdaterState>
    install(): Promise<void>
  }
  restart?: () => Promise<void>
  openExternal?: (url: string) => void
  revealPath?: (path: string) => Promise<boolean>
}

export const DISK_ACCESS_GUIDANCE: Record<DiskAccessGuidanceKey, string> = {
  "disk.accessGuidance.macos": "Grant Full Disk Access to DiskLizard in System Settings, then scan again.",
  "disk.accessGuidance.windows": "Use an account with access to this drive, or scan a folder your account can read.",
  "disk.accessGuidance.linux": "Review folder and mount permissions, then scan again.",
  "disk.accessGuidance.default": "Review access to these folders, then scan again.",
  "disk.accessGuidance.rescan": "Use Rescan in the top bar after changing access.",
}

export function diskLanguageText(key: string) {
  return DISK_ACCESS_GUIDANCE[key as DiskAccessGuidanceKey] ?? key
}

const PINNED_STORAGE_NAME = "disklizard.dat"
const PINNED_STORAGE_KEY = "pinned-locations"
const CLEANUP_LOCK_STORAGE_KEY = "cleanup-locks"

function parsePathList<T extends { path: string; label: string }>(
  raw: string | null | undefined,
): T[] | undefined {
  if (!raw) return
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return
    const locations = value.filter(
      (item): item is T =>
        !!item && typeof item === "object" && typeof item.path === "string" && typeof item.label === "string",
    )
    return locations
  } catch {
    return
  }
}

export const { use: usePlatform, provider: DiskLizardPlatformProvider } = createSimpleContext({
  name: "DiskLizardPlatform",
  init: (props: { value: DiskLizardPlatform }) => props.value,
})

export function useLanguage() {
  return {
    t: diskLanguageText,
  }
}

export function useSettings() {
  const platform = usePlatform()
  const [locations, setLocations] = createSignal<DiskPinnedLocation[]>(diskPinnedLocationsDefault)
  const [locks, setLocks] = createSignal<DiskCleanupLock[]>(diskCleanupLocksDefault)
  const storage = platform.storage?.(PINNED_STORAGE_NAME)

  createEffect(() => {
    if (!storage) return
    void Promise.resolve(storage.getItem(PINNED_STORAGE_KEY)).then((raw) => {
      const parsed = parsePathList<DiskPinnedLocation>(raw)
      if (parsed) setLocations(parsed)
    })
    void Promise.resolve(storage.getItem(CLEANUP_LOCK_STORAGE_KEY)).then((raw) => {
      const parsed = parsePathList<DiskCleanupLock>(raw)
      if (parsed) setLocks(parsed)
    })
  })

  const persistPins = (next: DiskPinnedLocation[]) => {
    setLocations(next)
    void storage?.setItem(PINNED_STORAGE_KEY, JSON.stringify(next))
  }
  const persistLocks = (next: DiskCleanupLock[]) => {
    setLocks(next)
    void storage?.setItem(CLEANUP_LOCK_STORAGE_KEY, JSON.stringify(next))
  }

  return {
    general: {
      diskPinnedLocations: createMemo(() => locations()),
      setDiskPinnedLocations: persistPins,
      diskCleanupLocks: createMemo(() => locks()),
      setDiskCleanupLocks: persistLocks,
    },
  }
}

export function DiskLizardRuntime(props: ParentProps<{ platform: DiskLizardPlatform }>) {
  return <DiskLizardPlatformProvider value={props.platform}>{props.children}</DiskLizardPlatformProvider>
}
