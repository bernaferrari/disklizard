import {
  sanitizeDiagnosticValue,
  summarizeDiagnosticLogForExport,
  type SanitizedDiagnosticValue,
} from "./diagnostic-sanitizer"

const MAX_EXPORT_LOG_FILES = 16

export const LOCAL_DIAGNOSTIC_EXPORT_POLICY = {
  initiatedBy: "explicit-user-action",
  destination: "local-file",
  automaticUpload: false,
  rawCrashCollection: false,
  sanitized: true,
  contents: {
    currentRunApplicationLogSummaries: true,
    rawApplicationLogText: false,
    previousRunLogs: false,
    networkLogs: false,
    crashDumps: false,
    inheritedServerLogs: false,
    heapSnapshots: false,
  },
} as const

export type LocalDiagnosticManifestInput = {
  generatedAt: string
  name: string
  version: string
  packaged: boolean
  platform: string
  arch: string
  electronVersion?: string
  chromeVersion?: string
  nodeVersion?: string
  uptimeSeconds: number
  logFiles: number
}

export type LocalDiagnosticExportManifestInput = Omit<LocalDiagnosticManifestInput, "logFiles">

export function createLocalDiagnosticManifest(input: LocalDiagnosticManifestInput): SanitizedDiagnosticValue {
  return sanitizeDiagnosticValue({
    schemaVersion: 1,
    privacy: LOCAL_DIAGNOSTIC_EXPORT_POLICY,
    generatedAt: input.generatedAt,
    application: {
      name: input.name,
      version: input.version,
      packaged: input.packaged,
    },
    runtime: {
      platform: input.platform,
      arch: input.arch,
      versions: {
        electron: input.electronVersion,
        chrome: input.chromeVersion,
        node: input.nodeVersion,
      },
      uptimeSeconds: Math.max(0, Math.round(input.uptimeSeconds)),
    },
    logFiles: Math.max(0, Math.trunc(input.logFiles)),
  })
}

export type DiagnosticLogCandidate = {
  name: string
  isFile: boolean
  size: number
  modifiedAt: number
}

export type LocalDiagnosticLogCandidate = DiagnosticLogCandidate & {
  contents: string
}

export type LocalDiagnosticExportEntry = {
  name: string
  contents: string
}

/** Only application .log files from this process run are eligible for export. */
export function isCurrentRunDiagnosticLog(candidate: DiagnosticLogCandidate, now = Date.now()) {
  if (!candidate.isFile) return false
  if (!/^[a-z0-9_.-]+\.log$/i.test(candidate.name)) return false
  if (!Number.isSafeInteger(candidate.size) || candidate.size < 0 || candidate.size > 5 * 1024 * 1024) return false
  if (!Number.isFinite(candidate.modifiedAt)) return false
  return candidate.modifiedAt >= now - 24 * 60 * 60 * 1000 && candidate.modifiedAt <= now + 60_000
}

/**
 * Builds the entire diagnostic archive payload. Callers cannot supply archive
 * names, binary attachments, or non-log artifacts; all log text crosses the
 * sanitizer again here.
 */
export function createLocalDiagnosticExport(
  manifest: LocalDiagnosticExportManifestInput,
  candidates: readonly LocalDiagnosticLogCandidate[],
  now = Date.now(),
): LocalDiagnosticExportEntry[] {
  const logs = candidates
    .filter((candidate) => isCurrentRunDiagnosticLog(candidate, now))
    .slice(0, MAX_EXPORT_LOG_FILES)
    .map((candidate, index) => ({
      name: `logs/log-${String(index + 1).padStart(2, "0")}.jsonl`,
      contents: summarizeDiagnosticLogForExport(candidate.contents),
    }))

  return [
    {
      name: "manifest.json",
      contents: JSON.stringify(createLocalDiagnosticManifest({ ...manifest, logFiles: logs.length }), null, 2),
    },
    ...logs,
  ]
}

/**
 * Main-process export variant. Yield before every potentially large log
 * summary so a user exporting diagnostics cannot monopolize Electron's UI
 * event loop across the complete bounded archive.
 */
export async function createLocalDiagnosticExportAsync(
  manifest: LocalDiagnosticExportManifestInput,
  candidates: readonly LocalDiagnosticLogCandidate[],
  now = Date.now(),
  yieldControl: () => Promise<void> = () => new Promise((resolve) => setImmediate(resolve)),
): Promise<LocalDiagnosticExportEntry[]> {
  const eligible = candidates.filter((candidate) => isCurrentRunDiagnosticLog(candidate, now)).slice(0, MAX_EXPORT_LOG_FILES)
  const logs: LocalDiagnosticExportEntry[] = []
  for (const [index, candidate] of eligible.entries()) {
    await yieldControl()
    logs.push({
      name: `logs/log-${String(index + 1).padStart(2, "0")}.jsonl`,
      contents: summarizeDiagnosticLogForExport(candidate.contents),
    })
  }
  return [
    {
      name: "manifest.json",
      contents: JSON.stringify(createLocalDiagnosticManifest({ ...manifest, logFiles: logs.length }), null, 2),
    },
    ...logs,
  ]
}
