import { useEffect, useRef, useState } from "react"
import { showToast } from "@/components/dl/toast"
import { diskPathEquals } from "./storage"
import {
  diskLanguageText,
  type DiskLizardOS,
  type useLanguage,
} from "./runtime"
import type {
  DiskDriveInfo,
  DiskDriveFactsUpdate,
  DiskStorageDiagnostics,
  DiskUtilityAPI,
} from "./types"

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            diskLanguageText("disk.error.timeout", {
              operation: label,
              milliseconds: ms,
            })
          )
        ),
      ms
    )
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

/** Owns discovery and capacity updates independently from scan/navigation state. */
export function useDriveDiscovery({
  disk,
  os,
  language,
  visible,
}: {
  disk?: DiskUtilityAPI
  os?: DiskLizardOS
  language: ReturnType<typeof useLanguage>
  visible: boolean
}) {
  const platform = { os }
  const [homePath, setHomePath] = useState<string>()
  const active = useRef(0)
  const receivedDriveFactsRef = useRef<DiskDriveFactsUpdate[]>([])
  const [drives, setDrives] = useState<DiskDriveInfo[]>([])
  const [drivesLoading, setDrivesLoading] = useState(false)
  const [drivesError, setDrivesError] = useState<string | undefined>()
  const [storageDiagnostics, setStorageDiagnostics] = useState<
    DiskStorageDiagnostics | undefined
  >()
  const [storageDiagnosticsError, setStorageDiagnosticsError] = useState(false)
  const refreshingDrivesRef = useRef<number | undefined>(undefined)
  async function loadDrives(quiet = false) {
    const api = disk
    if (!api || refreshingDrivesRef.current === active.current) return
    const lifetime = active.current
    refreshingDrivesRef.current = lifetime
    if (!quiet) setDrivesLoading(true)
    setDrivesError(undefined)
    if (!quiet) setStorageDiagnostics(undefined)
    setStorageDiagnosticsError(false)
    try {
      const list = await withTimeout(
        api.getDrives(),
        8000,
        language.t("disk.toast.listingDrives")
      )
      if (lifetime !== active.current) return
      setDrives(
        list.map((drive) => {
          const facts = receivedDriveFactsRef.current.find((candidate) =>
            diskPathEquals(candidate.path, drive.path, platform.os)
          )
          return facts ? { ...drive, ...facts.facts } : drive
        })
      )
      // Diagnostics are helpful context, not a dependency for the main drive
      // chooser. Let it settle independently so a permission probe never
      // delays the first useful screen.
      void loadStorageDiagnostics()
    } catch (err) {
      if (lifetime !== active.current) return
      const message = err instanceof Error ? err.message : String(err)
      if (quiet) return
      setDrivesError(message)
      setDrives([])
      showToast({
        variant: "error",
        title: language.t("disk.toast.listFailed"),
        description: message,
      })
    } finally {
      if (refreshingDrivesRef.current === lifetime)
        refreshingDrivesRef.current = undefined
      if (lifetime === active.current) setDrivesLoading(false)
    }
  }

  async function loadStorageDiagnostics() {
    const api = disk
    if (!api) return
    const lifetime = active.current
    setStorageDiagnosticsError(false)
    try {
      const result = await withTimeout(
        api.getStorageDiagnostics(),
        8000,
        language.t("disk.toast.checkingStorage")
      )
      if (lifetime === active.current) setStorageDiagnostics(result)
    } catch {
      if (lifetime !== active.current) return
      setStorageDiagnostics(undefined)
      setStorageDiagnosticsError(true)
    }
  }

  function applyDriveFacts(update: DiskDriveFactsUpdate) {
    receivedDriveFactsRef.current = [
      ...receivedDriveFactsRef.current.filter(
        (candidate) => !diskPathEquals(candidate.path, update.path, platform.os)
      ),
      update,
    ]
    setDrives((current) =>
      current.map((drive) =>
        diskPathEquals(drive.path, update.path, platform.os)
          ? { ...drive, ...update.facts }
          : drive
      )
    )
  }

  const latest = useRef({ visible, loadDrives })
  latest.current = { visible, loadDrives }
  useEffect(() => {
    if (!disk) return undefined
    const lifetime = active.current
    void disk
      .getHomePath?.()
      .then((path) => {
        if (lifetime === active.current) setHomePath(path)
      })
      .catch(() => undefined)
    const unsubscribe = disk.onDriveFacts(applyDriveFacts)
    void latest.current.loadDrives()
    const refresh = () => {
      if (latest.current.visible && document.visibilityState === "visible")
        void latest.current.loadDrives(true)
    }
    const timer = setInterval(refresh, 30000)
    window.addEventListener("focus", refresh)
    return () => {
      ++active.current
      unsubscribe()
      clearInterval(timer)
      window.removeEventListener("focus", refresh)
    }
  }, [disk])
  return {
    homePath,
    drives,
    drivesLoading,
    drivesError,
    storageDiagnostics,
    storageDiagnosticsError,
    loadDrives,
    loadStorageDiagnostics,
  }
}
