import { useMemo, useReducer, useRef } from "react"
import { diskLanguageText } from "./runtime"
import { createForegroundScans } from "./foreground-scans"
import {
  foregroundProgress,
  EMPTY_FOREGROUND_PROGRESS,
} from "./foreground-progress"
import type { VolumeScanJob } from "./scan-jobs"
import type { DiskScanProgress, DiskUtilityAPI } from "./types"

/** Owns foreground request generations and their atomic progress snapshot. */
export function useForegroundScan(api: DiskUtilityAPI | undefined) {
  const controller = useMemo(() => createForegroundScans(), [])
  const [progress, dispatch] = useReducer(
    foregroundProgress,
    EMPTY_FOREGROUND_PROGRESS
  )
  const active = useRef<{ id: string; focused: boolean } | undefined>(undefined)
  function invalidate() {
    controller.invalidate()
    const request = active.current
    active.current = undefined
    if (!request) return
    void api?.cancelScan(request.id)
    if (request.focused) void api?.stopWatching(request.id)
  }
  function begin(
    id: string,
    options: {
      total?: number
      keepSource?: boolean
      waitForCompletionSource?: boolean
      onProgress?: (progress: DiskScanProgress) => void
    } = {}
  ) {
    if (!api) throw new Error(diskLanguageText("disk.top.scannerDisconnected"))
    invalidate()
    active.current = { id, focused: options.keepSource === true }
    dispatch({
      type: "begin",
      total: options.total ?? 0,
      keepSource: options.keepSource,
    })
    const session = controller.begin(api, id, {
      waitForCompletionSource: options.waitForCompletionSource,
      onProgress: (next) => {
        dispatch({ type: "report", progress: next })
        options.onProgress?.(next)
      },
    })
    return {
      ...session,
      finish: () => {
        session.finish()
        if (active.current?.id === id) active.current = undefined
      },
    }
  }
  return {
    progress,
    begin,
    invalidate,
    complete: () => dispatch({ type: "complete" }),
    restore: (job: VolumeScanJob) => {
      invalidate()
      dispatch({ type: "restore", job })
    },
    setSource: (source: DiskScanProgress["source"]) =>
      dispatch({ type: "source", source }),
  }
}
