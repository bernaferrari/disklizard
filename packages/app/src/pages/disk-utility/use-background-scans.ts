import { useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import {
  createBackgroundScans,
  type BackgroundScanOptions,
} from "./background-scans"
import type { VolumeScanJob } from "./scan-jobs"
export { MAX_PARALLEL_VOLUME_SCANS } from "./background-scans"

export function useBackgroundScans(options: BackgroundScanOptions) {
  const current = useRef(options)
  current.current = options
  const controller = useMemo(
    () => createBackgroundScans(() => current.current),
    []
  )
  const jobs = useSyncExternalStore(controller.subscribe, controller.snapshot)
  const list = useMemo(
    () => Object.values(jobs).filter((job): job is VolumeScanJob => !!job),
    [jobs]
  )
  useEffect(() => () => controller.dispose(), [controller])
  return {
    ...controller,
    jobs,
    list,
    running: list.filter((job) => job.status === "scanning").length,
  }
}
