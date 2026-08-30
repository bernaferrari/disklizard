/** Electron wraps rejected IPC errors, so cancellation has to be recognized from the complete message. */
export function isScanCancellation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /\b(?:scan\s+)?cancel(?:led|ed)\b|superseded by a new scan|scan window closed/i.test(message)
}

/** A missing or invalid estimate stays indeterminate instead of implying made-up progress. */
export function determinateScanProgress(pct: number | null) {
  if (pct === null || !Number.isFinite(pct)) return null
  return Math.max(0, Math.min(100, pct))
}
