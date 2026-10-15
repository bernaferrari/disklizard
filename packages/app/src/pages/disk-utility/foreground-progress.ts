import { mergeDiscovery, type ScanDiscovery } from "./live-scan"
import type { VolumeScanJob } from "./scan-jobs"
import type { DiskScanProgress } from "./types"

export type ForegroundProgress = {
  files: number
  total: number
  pct: number
  bytes: number
  tail: string
  discoveries: readonly ScanDiscovery[]
  source?: DiskScanProgress["source"]
}
export type ForegroundProgressEvent =
  | { type: "begin"; total: number; keepSource?: boolean }
  | { type: "report"; progress: DiskScanProgress }
  | { type: "complete" }
  | { type: "source"; source: DiskScanProgress["source"] }
  | { type: "restore"; job: VolumeScanJob }
export const EMPTY_FOREGROUND_PROGRESS: ForegroundProgress = {
  files: 0,
  total: 0,
  pct: 0,
  bytes: 0,
  tail: "",
  discoveries: [],
}
export function foregroundProgress(
  state: ForegroundProgress,
  event: ForegroundProgressEvent
): ForegroundProgress {
  switch (event.type) {
    case "begin":
      return {
        ...EMPTY_FOREGROUND_PROGRESS,
        total: event.total,
        source: event.keepSource ? state.source : undefined,
      }
    case "report": {
      const progress = event.progress
      return {
        ...state,
        files: progress.filesScanned,
        tail: progress.currentPath,
        bytes: Math.max(state.bytes, progress.size),
        pct: Math.max(state.pct, progress.percent ?? 0),
        discoveries:
          mergeDiscovery(state.discoveries, progress.discovery) ??
          state.discoveries,
        source:
          progress.done && progress.source ? progress.source : state.source,
      }
    }
    case "complete":
      return { ...state, pct: 100 }
    case "source":
      return { ...state, source: event.source }
    case "restore":
      return {
        ...EMPTY_FOREGROUND_PROGRESS,
        source: event.job.source,
        files: event.job.files,
        bytes: event.job.bytes,
        total: event.job.kind === "folder" ? 0 : event.job.drive.used,
        pct: 100,
      }
  }
  const exhaustive: never = event
  return exhaustive
}
