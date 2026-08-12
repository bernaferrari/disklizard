import { shortBytes } from "./format"

export type ScanPerformance = {
  elapsedMs: number
  filesPerSecond: number | null
  bytesPerSecond: number | null
}

/**
 * Keep scan performance visible in product UI without claiming a benchmark.
 * The values describe this exact scan, including the filesystem and access
 * limits the user actually encountered.
 */
export function scanPerformance(files: number, bytes: number, startedAt: number, completedAt = Date.now()): ScanPerformance {
  const elapsedMs = Math.max(0, completedAt - startedAt)
  if (!Number.isFinite(elapsedMs) || elapsedMs < 1) {
    return { elapsedMs: 0, filesPerSecond: null, bytesPerSecond: null }
  }
  const seconds = elapsedMs / 1_000
  return {
    elapsedMs,
    filesPerSecond: Number.isFinite(files) && files >= 0 ? files / seconds : null,
    bytesPerSecond: Number.isFinite(bytes) && bytes >= 0 ? bytes / seconds : null,
  }
}

export function formatScanDuration(elapsedMs: number): string {
  const seconds = Math.max(0, elapsedMs) / 1_000
  if (seconds < 1) return "under 1s"
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

export function formatScanRate(perSecond: number | null, unit: "files" | "bytes"): string {
  if (perSecond === null || !Number.isFinite(perSecond) || perSecond < 0) return "—"
  if (unit === "bytes") return `${shortBytes(perSecond)}/s`
  if (perSecond < 1) return "<1 file/s"
  return `${Math.round(perSecond).toLocaleString()} files/s`
}
