import { useRef, useState } from "react"
import { showToast } from "@/components/dl/toast"
import { useLanguage, usePlatform, useSettings } from "./runtime"
import { isCleanupLock, toggleCleanupLock } from "./cleanup-lock"
import { isPinnedScanLocation, togglePinnedScanLocation } from "./storage"
import type { DiskCleanupLock } from "./types"

/** Owns saved-location and cleanup-protection persistence and mutation exclusion. */
export function useWorkspaceProtections({
  deleting,
  onLocksChanged,
}: {
  deleting: boolean
  onLocksChanged(locks: DiskCleanupLock[]): void
}) {
  const platform = usePlatform()
  const language = useLanguage()
  const settings = useSettings()
  const pinnedLocations = settings.locations
  const cleanupLocks = settings.locks
  const cleanupLocksStatus = settings.cleanupLocksStatus
  const cleanupProtectionsReady = () => cleanupLocksStatus === "ready"
  const [pinMutationPending, setPinMutationPending] = useState(false)
  const [cleanupLockMutationPending, setCleanupLockMutationPending] =
    useState(false)
  const pinBusy = useRef(false)
  const lockBusy = useRef(false)
  async function togglePinnedLocation(path: string, label: string) {
    if (pinBusy.current) return
    pinBusy.current = true
    setPinMutationPending(true)
    try {
      const wasPinned = isPinnedScanLocation(pinnedLocations, path, platform.os)
      const next = togglePinnedScanLocation(
        pinnedLocations,
        { path, label },
        platform.os
      )
      if (!wasPinned && !isPinnedScanLocation(next, path, platform.os)) {
        showToast({
          variant: "default",
          title: language.t("disk.toast.savedFull"),
          description: language.t("disk.toast.savedFullBody"),
        })
        return
      }
      const result = await settings.store.general.setDiskPinnedLocations(next)
      if (!result.ok) return
      const pinned = isPinnedScanLocation(result.value, path, platform.os)
      if (pinned === wasPinned) return
      showToast({
        variant: "default",
        title: pinned
          ? language.t("disk.toast.savedAdded")
          : language.t("disk.toast.savedRemoved"),
        description: label,
      })
    } finally {
      pinBusy.current = false
      setPinMutationPending(false)
    }
  }

  function showCleanupProtectionsUnavailable() {
    const status = cleanupLocksStatus
    const title =
      status === "loading"
        ? "disk.cleanup.protectionsLoadingTitle"
        : status === "saving"
          ? "disk.cleanup.protectionsSavingTitle"
          : "disk.cleanup.protectionsErrorTitle"
    const description =
      status === "loading"
        ? "disk.cleanup.protectionsLoading"
        : status === "saving"
          ? "disk.cleanup.protectionsSaving"
          : "disk.cleanup.protectionsError"
    showToast({
      variant: status === "error" ? "error" : "default",
      title: language.t(title),
      description: language.t(description),
    })
  }

  function ensureCleanupProtectionsReady() {
    if (cleanupProtectionsReady()) return true
    showCleanupProtectionsUnavailable()
    return false
  }

  async function toggleProtectedTree(path: string, label: string) {
    if (deleting || !ensureCleanupProtectionsReady() || lockBusy.current) return
    lockBusy.current = true
    setCleanupLockMutationPending(true)
    try {
      const wasLocked = isCleanupLock(path, cleanupLocks, platform.os)
      const next = toggleCleanupLock(cleanupLocks, { path, label }, platform.os)
      if (!wasLocked && !isCleanupLock(path, next, platform.os)) {
        showToast({
          variant: "default",
          title: language.t("disk.toast.protectedFull"),
          description: language.t("disk.toast.protectedFullBody"),
        })
        return
      }
      const result = await settings.store.general.setDiskCleanupLocks(next)
      if (!result.ok) return
      const locked = isCleanupLock(path, result.value, platform.os)
      if (locked === wasLocked) return
      onLocksChanged(result.value)
      showToast({
        variant: "default",
        title: locked
          ? language.t("disk.toast.cleanupProtected")
          : language.t("disk.toast.cleanupUnlocked"),
        description: locked
          ? language.t("disk.toast.cleanupProtectedBodyLegacy", { name: label })
          : language.t("disk.toast.cleanupUnlockedBodyLegacy", { name: label }),
      })
    } finally {
      lockBusy.current = false
      setCleanupLockMutationPending(false)
    }
  }

  return {
    pinMutationPending,
    cleanupLockMutationPending,
    cleanupProtectionsReady,
    ensureCleanupProtectionsReady,
    togglePinnedLocation,
    toggleProtectedTree,
  }
}
