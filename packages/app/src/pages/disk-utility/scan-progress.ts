/** Electron wraps rejected IPC errors, so cancellation has to be recognized from the complete message. */
export function isScanCancellation(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /\b(?:scan\s+)?cancel(?:led|ed)\b|superseded by a new scan|scan window closed/i.test(message)
}
