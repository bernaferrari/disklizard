const DEFAULT_MAX_DEPTH = 5
const DEFAULT_MAX_ENTRIES = 32
const DEFAULT_MAX_NODES = 256
const DEFAULT_MAX_STRING_LENGTH = 2_048
const DEFAULT_MAX_LOG_LINES = 1_000
const DEFAULT_MAX_LOG_LENGTH = 1024 * 1024

const SAFE_DIAGNOSTIC_CODES = new Set([
  "ABORT_ERR",
  "EACCES",
  "EAGAIN",
  "EBUSY",
  "ECONNREFUSED",
  "ECONNRESET",
  "EEXIST",
  "EIO",
  "EISDIR",
  "EMFILE",
  "ENFILE",
  "ENOENT",
  "ENOMEM",
  "ENOSPC",
  "ENOTDIR",
  "ENOTEMPTY",
  "ENOTFOUND",
  "EPERM",
  "EROFS",
  "ETIMEDOUT",
])

const DIAGNOSTIC_AREAS = [
  ["scan", /\bscan(?:ner|ning|ned)?\b/i],
  ["delete", /\b(?:delete|deletion|trash)\b/i],
  ["preview", /\bpreview\b/i],
  ["update", /\b(?:update|updater|download|install)\b/i],
  ["startup", /\b(?:startup|launch|window|renderer)\b/i],
  ["storage", /\b(?:filesystem|disk|storage|volume)\b/i],
  ["worker", /\bworker\b/i],
  ["crash", /\bcrash\b/i],
] as const

const REDACTED_PATH = "[REDACTED_PATH]"
const REDACTED_URL = "[REDACTED_URL]"
const REDACTED_FILE = "[REDACTED_FILE]"
const REDACTED_VALUE = "[REDACTED]"
const TRUNCATED = "[TRUNCATED]"
const CIRCULAR = "[CIRCULAR]"

const SENSITIVE_PATH_KEYS = new Set([
  "crashdumps",
  "currentrun",
  "cwd",
  "dir",
  "directory",
  "directories",
  "file",
  "filepath",
  "filename",
  "filenames",
  "files",
  "homedir",
  "logpath",
  "logs",
  "netlog",
  "output",
  "path",
  "paths",
  "preloadpath",
  "root",
  "roots",
  "serverlogs",
  "sourceid",
  "userdata",
])

const SENSITIVE_URL_KEYS = new Set([
  "currenturl",
  "deeplink",
  "deeplinks",
  "href",
  "link",
  "links",
  "uri",
  "uris",
  "url",
  "urls",
])

export type SanitizedDiagnosticValue =
  | null
  | boolean
  | number
  | string
  | SanitizedDiagnosticValue[]
  | { [key: string]: SanitizedDiagnosticValue }

export type DiagnosticSanitizerOptions = {
  maxDepth?: number
  maxEntries?: number
  maxNodes?: number
  maxStringLength?: number
}

type SanitizerState = Required<DiagnosticSanitizerOptions> & {
  remainingNodes: number
  ancestors: WeakSet<object>
}

/**
 * Removes local identifiers from arbitrary diagnostic data while bounding the
 * amount of work and output. It is deliberately lossy: diagnostics retain the
 * kind of failure and runtime evidence, never a user's local filesystem shape.
 */
export function sanitizeDiagnosticValue(
  value: unknown,
  options: DiagnosticSanitizerOptions = {},
): SanitizedDiagnosticValue {
  const state: SanitizerState = {
    maxDepth: clampInteger(options.maxDepth, DEFAULT_MAX_DEPTH, 0, 12),
    maxEntries: clampInteger(options.maxEntries, DEFAULT_MAX_ENTRIES, 1, 128),
    maxNodes: clampInteger(options.maxNodes, DEFAULT_MAX_NODES, 1, 4_096),
    maxStringLength: clampInteger(options.maxStringLength, DEFAULT_MAX_STRING_LENGTH, 32, 64 * 1024),
    remainingNodes: 0,
    ancestors: new WeakSet(),
  }
  state.remainingNodes = state.maxNodes
  return sanitizeValue(value, state, 0)
}

/** Sanitizes free-form log text, including paths embedded in Error stacks. */
export function sanitizeDiagnosticText(value: string, maxLength = DEFAULT_MAX_STRING_LENGTH): string {
  const bounded = value
    .slice(0, Math.max(32, Math.min(maxLength, 64 * 1024 * 1024)))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "�")

  const sanitized = bounded
    // URLs are removed before filesystem paths so file:// and URL paths are one token.
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/giu, REDACTED_URL)
    .replace(/\bwww\.[^\s<>"'`]+/giu, REDACTED_URL)
    // UNC, drive-letter, home-relative, absolute POSIX, and multi-segment relative paths.
    .replace(/\\\\[^\\/\s<>"'`]+[\\/][^\s<>"'`]+/gu, REDACTED_PATH)
    .replace(/\b[A-Z]:[\\/][^\s<>"'`]+/giu, REDACTED_PATH)
    .replace(/~[\\/][^\s<>"'`]+/gu, REDACTED_PATH)
    .replace(
      /(^|[\s("'=:[{])\/(?:[^/\s<>"'`()[\]{}]+\/)*[^/\s<>"'`()[\]{}]*/gu,
      (_match, prefix) => `${prefix}${REDACTED_PATH}`,
    )
    .replace(
      /(^|[\s("'=:[{])(?:\.{1,2}[\\/])?(?:[\p{L}\p{N}_@+.-]+[\\/]){1,}[\p{L}\p{N}_@+.-]+/giu,
      (_match, prefix) => `${prefix}${REDACTED_PATH}`,
    )
    // A bare filename can still identify a user's document even without its directory.
    .replace(
      /(^|[\s("'=:[{])(?:\.[\p{L}][\p{L}\p{N}_-]*(?:\.[\p{L}\p{N}_-]+)*|[\p{L}\p{N}_@+()-][\p{L}\p{N} ._@+()-]*\.[\p{L}][\p{L}\p{N}]{0,15})(?=$|[\s)"',:;}\]])/giu,
      (_match, prefix) => `${prefix}${REDACTED_FILE}`,
    )

  return value.length > bounded.length ? `${sanitized}${TRUNCATED}` : sanitized
}

/** Sanitizes a bounded log tail for local presentation and Error stacks. */
export function sanitizeDiagnosticLog(value: string, maxLines = DEFAULT_MAX_LOG_LINES): string {
  const lines = value.split(/\r?\n/).slice(-Math.max(1, Math.min(maxLines, 10_000)))
  const output: string[] = []
  let length = 0

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? ""
    const sanitized = sanitizeDiagnosticText(line)
    if (length + sanitized.length + 1 > DEFAULT_MAX_LOG_LENGTH) {
      output.unshift(TRUNCATED)
      break
    }
    output.unshift(sanitized)
    length += sanitized.length + 1
  }

  return output.join("\n")
}

/**
 * Converts free-form application logs into an allowlisted JSONL summary for
 * user-initiated export. No original words, scopes, paths, or filenames cross
 * this boundary: only fixed enums, known OS error codes, timestamps, and
 * redaction counts survive. This is intentionally more conservative than the
 * local write-time sanitizer because an extensionless filename is otherwise
 * indistinguishable from ordinary prose.
 */
export function summarizeDiagnosticLogForExport(value: string, maxLines = DEFAULT_MAX_LOG_LINES): string {
  const lines = value.split(/\r?\n/).slice(-Math.max(1, Math.min(maxLines, 10_000)))
  const output: string[] = []
  let length = 0

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue
    const sanitized = sanitizeDiagnosticText(line)
    const timestamp = sanitized.match(
      /\b\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d:[0-5]\d(?:\.\d{1,6})?Z?\b/,
    )?.[0]
    const level = sanitized.match(/(?:^|[\s[\]])(error|warn|info|debug|verbose|silly)(?=$|[\s[\]])/i)?.[1]
    const codes = [...new Set(sanitized.match(/\b[A-Z][A-Z0-9_]{2,31}\b/g) ?? [])].filter((code) =>
      SAFE_DIAGNOSTIC_CODES.has(code),
    )
    const areas = DIAGNOSTIC_AREAS.filter(([, pattern]) => pattern.test(sanitized)).map(([area]) => area)
    const summary = JSON.stringify({
      schema: 1,
      sequence: index + 1,
      ...(timestamp ? { timestamp } : {}),
      ...(level ? { level: level.toLowerCase() } : {}),
      ...(codes.length ? { codes } : {}),
      ...(areas.length ? { areas } : {}),
      redactions: {
        path: countOccurrences(sanitized, REDACTED_PATH),
        url: countOccurrences(sanitized, REDACTED_URL),
        file: countOccurrences(sanitized, REDACTED_FILE),
      },
      content: "redacted",
      ...(sanitized.includes(TRUNCATED) ? { truncated: true } : {}),
    })
    if (length + summary.length + 1 > DEFAULT_MAX_LOG_LENGTH) {
      output.push(JSON.stringify({ schema: 1, truncated: true }))
      break
    }
    output.push(summary)
    length += summary.length + 1
  }

  return output.join("\n")
}

function countOccurrences(value: string, token: string) {
  let count = 0
  let offset = 0
  while ((offset = value.indexOf(token, offset)) >= 0) {
    count += 1
    offset += token.length
  }
  return count
}

function sanitizeValue(value: unknown, state: SanitizerState, depth: number): SanitizedDiagnosticValue {
  if (value === null) return null
  if (typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value)
  if (typeof value === "string") return sanitizeDiagnosticText(value, state.maxStringLength)
  if (typeof value === "bigint") return `${value}n`
  if (typeof value === "undefined") return "[UNDEFINED]"
  if (typeof value === "function") return "[FUNCTION]"
  if (typeof value === "symbol") return "[SYMBOL]"

  if (depth >= state.maxDepth || state.remainingNodes <= 0) return TRUNCATED
  if (state.ancestors.has(value)) return CIRCULAR
  state.remainingNodes -= 1
  state.ancestors.add(value)

  try {
    if (value instanceof Error) return sanitizeError(value, state, depth)
    if (value instanceof Date) return Number.isNaN(value.valueOf()) ? "Invalid Date" : value.toISOString()
    if (ArrayBuffer.isView(value)) return `[BINARY ${value.byteLength} bytes]`
    if (value instanceof ArrayBuffer) return `[BINARY ${value.byteLength} bytes]`

    if (Array.isArray(value)) {
      const result = value.slice(0, state.maxEntries).map((entry) => sanitizeValue(entry, state, depth + 1))
      if (value.length > state.maxEntries) result.push(TRUNCATED)
      return result
    }

    if (value instanceof Map) {
      return sanitizeValue(Object.fromEntries([...value.entries()].slice(0, state.maxEntries)), state, depth + 1)
    }
    if (value instanceof Set) return sanitizeValue([...value].slice(0, state.maxEntries), state, depth + 1)

    const result: Record<string, SanitizedDiagnosticValue> = {}
    const keys = Object.keys(value).slice(0, state.maxEntries)
    for (const [index, key] of keys.entries()) {
      const safeKey = sanitizeKey(key, index)
      let item: unknown
      try {
        item = Reflect.get(value, key)
      } catch {
        result[safeKey] = "[UNREADABLE]"
        continue
      }

      const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase()
      const hasSensitivePayload = typeof item === "string" || typeof item === "object"
      if (SENSITIVE_URL_KEYS.has(normalizedKey) && hasSensitivePayload) {
        result[safeKey] = REDACTED_URL
      } else if (SENSITIVE_PATH_KEYS.has(normalizedKey) && hasSensitivePayload) {
        result[safeKey] = REDACTED_PATH
      } else {
        result[safeKey] = sanitizeValue(item, state, depth + 1)
      }
    }
    if (Object.keys(value).length > keys.length) result.__truncated__ = TRUNCATED
    return result
  } catch {
    return "[UNREADABLE]"
  } finally {
    state.ancestors.delete(value)
  }
}

function sanitizeError(error: Error, state: SanitizerState, depth: number): SanitizedDiagnosticValue {
  const result: Record<string, SanitizedDiagnosticValue> = {
    kind: sanitizeDiagnosticText(error.name || "Error", 128),
    message: sanitizeDiagnosticText(error.message || "", state.maxStringLength),
  }

  if (error.stack) result.stack = sanitizeDiagnosticLog(error.stack, 32)

  const candidate = error as Error & { code?: unknown; cause?: unknown }
  if (typeof candidate.code === "string" || typeof candidate.code === "number") {
    result.code = sanitizeValue(candidate.code, state, depth + 1)
  }
  if (candidate.cause !== undefined) result.cause = sanitizeValue(candidate.cause, state, depth + 1)
  return result
}

function sanitizeKey(key: string, index: number) {
  const sanitized = sanitizeDiagnosticText(key, 128)
  return sanitized.includes("[REDACTED_") || sanitized.includes(TRUNCATED) ? `redacted_${index + 1}` : sanitized
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(value)))
}

export const diagnosticRedactionTokens = {
  path: REDACTED_PATH,
  url: REDACTED_URL,
  file: REDACTED_FILE,
  value: REDACTED_VALUE,
  truncated: TRUNCATED,
  circular: CIRCULAR,
} as const
