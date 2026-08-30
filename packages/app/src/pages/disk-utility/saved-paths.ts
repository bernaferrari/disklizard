export const PINNED_LOCATION_LIMIT = 12
export const CLEANUP_LOCK_LIMIT = 24

const MAX_PATH_BYTES = 64 * 1024
const MAX_LABEL_BYTES = 512

export type SavedPath = {
  path: string
  label: string
}

export type SavedPathOptions = {
  limit: number
  /** Runtime platform. When omitted, path syntax is inferred for isolated helpers/tests. */
  os?: "macos" | "windows" | "linux"
  /** Cleanup locks intentionally deduplicate Windows paths conservatively. */
  foldWindowsCase?: boolean
  /** Fail hydration when any persisted entry cannot be retained safely. */
  rejectDiscardedEntries?: boolean
}

export type SavedPathParseResult =
  | { status: "missing" }
  | { status: "valid"; value: SavedPath[] }
  | { status: "invalid" }

const encoder = new TextEncoder()

function byteLength(value: string) {
  return encoder.encode(value).byteLength
}

function hasLexicalTraversal(path: string, separator: RegExp) {
  return path.split(separator).some((segment) => segment === "." || segment === "..")
}

function normalizeWindowsAbsolutePath(path: string): { path: string; windows: true } | undefined {
  if (hasLexicalTraversal(path, /[\\/]/)) return

  if (/^[a-z]:[\\/]/i.test(path)) {
    const normalized = path.replace(/\\/g, "/")
    if (/^[a-z]:\/\/+/i.test(normalized) || normalized.slice(3).includes("//")) return
    const root = normalized.slice(0, 3)
    const rest = normalized.slice(3).replace(/\/+$/, "")
    return { path: rest ? `${root}${rest}` : root, windows: true }
  }

  if (path.startsWith("\\\\") || path.startsWith("//")) {
    const normalized = path.replace(/\\/g, "/")
    if (!normalized.startsWith("//") || normalized.startsWith("///")) return
    const segments = normalized.replace(/\/+$/, "").slice(2).split("/")
    if (segments.length < 2 || !segments[0] || !segments[1] || segments.some((segment) => !segment)) return
    if (segments[0] === "." || segments[0] === "?") return
    return { path: `//${segments.join("/")}`, windows: true }
  }

  return
}

function normalizePosixAbsolutePath(path: string): { path: string; windows: false } | undefined {
  if (!path.startsWith("/") || hasLexicalTraversal(path, /\//)) return
  const normalized = path.replace(/\/+/g, "/")
  return { path: normalized === "/" ? normalized : normalized.replace(/\/+$/, ""), windows: false }
}

function normalizeAbsolutePath(
  path: string,
  os?: SavedPathOptions["os"],
): { path: string; windows: boolean } | undefined {
  if (!path || path.includes("\0") || byteLength(path) > MAX_PATH_BYTES) return

  if (os === "windows") return normalizeWindowsAbsolutePath(path)
  if (os === "macos" || os === "linux") return normalizePosixAbsolutePath(path)
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\")
    ? normalizeWindowsAbsolutePath(path)
    : normalizePosixAbsolutePath(path)
}

export function sanitizeSavedPaths(input: readonly unknown[], options: SavedPathOptions): SavedPath[] {
  const limit = Number.isSafeInteger(options.limit) && options.limit >= 0 ? options.limit : 0
  if (limit === 0) return []

  const result: SavedPath[] = []
  const seen = new Set<string>()

  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const candidate = item as Partial<SavedPath>
    if (typeof candidate.path !== "string" || typeof candidate.label !== "string") continue

    const normalized = normalizeAbsolutePath(candidate.path, options.os)
    if (!normalized) continue

    const label = candidate.label.trim() || normalized.path
    if (label.includes("\0") || byteLength(label) > MAX_LABEL_BYTES) continue

    const key = normalized.windows && options.foldWindowsCase ? normalized.path.toLocaleLowerCase("en-US") : normalized.path
    if (seen.has(key)) continue
    seen.add(key)
    result.push({ path: normalized.path, label })
    if (result.length === limit) break
  }

  return result
}

export function decodeSavedPaths(
  raw: string | null | undefined,
  options: SavedPathOptions,
): SavedPathParseResult {
  if (raw === null || raw === undefined) return { status: "missing" }
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return { status: "invalid" }
    const sanitized = sanitizeSavedPaths(value, options)
    if (options.rejectDiscardedEntries && sanitized.length !== value.length) return { status: "invalid" }
    return { status: "valid", value: sanitized }
  } catch {
    return { status: "invalid" }
  }
}

export function parseSavedPaths(raw: string | null | undefined, options: SavedPathOptions): SavedPath[] | undefined {
  const result = decodeSavedPaths(raw, options)
  return result.status === "valid" ? result.value : undefined
}
