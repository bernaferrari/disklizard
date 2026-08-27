export type DiskBrowseHistory = Readonly<{
  past: readonly string[]
  current?: string
  future: readonly string[]
}>

export type DiskBrowseIntent =
  | { type: "reset"; path?: string }
  | { type: "visit"; path: string }
  | { type: "back" }
  | { type: "forward" }

export type DiskBrowseHistoryOptions = Readonly<{
  /** Maximum retained destinations in each direction. */
  limit?: number
  /** Platform-aware path identity, for example case-insensitive Windows paths. */
  equals?: (left: string, right: string) => boolean
}>

export type DiskBrowseDirection = "back" | "forward"

export const EMPTY_DISK_BROWSE_HISTORY: DiskBrowseHistory = Object.freeze({
  past: Object.freeze([]),
  future: Object.freeze([]),
})

const DEFAULT_HISTORY_LIMIT = 64

/**
 * Pure, bounded browse-history transition. The current path is the only value
 * callers need to resolve back into the latest immutable scan tree.
 */
export function transitionDiskBrowseHistory(
  history: DiskBrowseHistory,
  intent: DiskBrowseIntent,
  options: DiskBrowseHistoryOptions = {},
): DiskBrowseHistory {
  const limit = normalizeLimit(options.limit)
  const equals = options.equals ?? Object.is

  if (intent.type === "reset") {
    return intent.path ? { past: [], current: intent.path, future: [] } : EMPTY_DISK_BROWSE_HISTORY
  }

  if (intent.type === "visit") {
    if (!history.current) return { past: [], current: intent.path, future: [] }
    if (equals(history.current, intent.path)) return history
    return {
      past: appendBounded(history.past, history.current, limit),
      current: intent.path,
      future: [],
    }
  }

  if (intent.type === "back") {
    const current = history.current
    const target = history.past.at(-1)
    if (!current || !target) return history
    return {
      past: history.past.slice(0, -1),
      current: target,
      future: prependBounded(current, history.future, limit),
    }
  }

  const current = history.current
  const [target, ...future] = history.future
  if (!current || !target) return history
  return {
    past: appendBounded(history.past, current, limit),
    current: target,
    future,
  }
}

/**
 * Move to the nearest destination that still exists in the latest immutable
 * scan tree. Missing watcher/deletion-era entries are discarded as they are
 * crossed, so history can never revive a stale node object.
 */
export function resolveDiskBrowseHistoryMove(
  history: DiskBrowseHistory,
  direction: DiskBrowseDirection,
  isAvailable: (path: string) => boolean,
  options: DiskBrowseHistoryOptions = {},
): DiskBrowseHistory {
  const limit = normalizeLimit(options.limit)
  const current = history.current
  if (!current) return history

  if (direction === "back") {
    for (let index = history.past.length - 1; index >= 0; index--) {
      const target = history.past[index]
      if (!isAvailable(target)) continue
      return {
        past: history.past.slice(0, index),
        current: target,
        future: prependBounded(current, history.future, limit),
      }
    }
    return history.past.length ? { ...history, past: [] } : history
  }

  for (let index = 0; index < history.future.length; index++) {
    const target = history.future[index]
    if (!isAvailable(target)) continue
    return {
      past: appendBounded(history.past, current, limit),
      current: target,
      future: history.future.slice(index + 1),
    }
  }
  return history.future.length ? { ...history, future: [] } : history
}

function appendBounded(values: readonly string[], value: string, limit: number) {
  const start = Math.max(0, values.length - limit + 1)
  return [...values.slice(start), value]
}

function prependBounded(value: string, values: readonly string[], limit: number) {
  return [value, ...values.slice(0, limit - 1)]
}

function normalizeLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_HISTORY_LIMIT
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Browse history limit must be a positive integer")
  return value
}
