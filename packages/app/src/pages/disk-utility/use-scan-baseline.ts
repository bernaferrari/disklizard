import { useEffect, useRef, useState } from "react"
import type { AsyncStorage, SyncStorage } from "@/lib/storage"
import {
  baselineStorageKey,
  captureBaseline,
  compareBaselines,
  decodeBaseline,
  type BaselineComparison,
  type ScanBaseline,
} from "./scan-baseline"
import type { DiskScanNode } from "./types"

/**
 * Compare the open scan with the fingerprint saved by the previous session
 * for the same root, then save the new fingerprint. The previous baseline is
 * read once per session, so live updates and in-app cleanup keep diffing
 * against “last time”, not against a moment ago.
 */
export function useScanBaseline(
  storage: SyncStorage | AsyncStorage | undefined,
  root: DiskScanNode | null,
  sessionKey: string | undefined,
  scanning: boolean
) {
  const [comparison, setComparison] = useState<BaselineComparison | null>(null)
  const previous = useRef<{
    session: string
    rootPath: string
    baseline: Promise<ScanBaseline | undefined>
  } | null>(null)

  useEffect(() => {
    if (!storage || !root || !sessionKey || scanning) return undefined
    let alive = true
    const key = baselineStorageKey(root.path)
    if (
      previous.current?.session !== sessionKey ||
      previous.current.rootPath !== root.path
    ) {
      previous.current = {
        session: sessionKey,
        rootPath: root.path,
        baseline: Promise.resolve(storage.getItem(key)).then(
          decodeBaseline,
          () => undefined
        ),
      }
      setComparison(null)
    }
    const pending = previous.current.baseline
    const timer = setTimeout(() => {
      const current = captureBaseline(root)
      void pending.then(async (baseline) => {
        if (!alive) return
        setComparison(baseline ? compareBaselines(baseline, current) : null)
        try {
          await storage.setItem(key, JSON.stringify(current))
        } catch {
          // A missing fingerprint only disables the comparison next time.
        }
      })
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [storage, root, sessionKey, scanning])

  return comparison
}
