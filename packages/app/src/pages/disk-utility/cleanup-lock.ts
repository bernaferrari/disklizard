import type { DiskCleanupLock, DiskScanNode } from "./types"
import { diskLanguageText } from "./runtime"

export const CLEANUP_LOCK_LIMIT = 24

function normalizedCleanupPath(path: string, os?: "macos" | "windows" | "linux") {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "") || "/"
  const windowsPath = os === "windows" || /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
  return windowsPath ? normalized.toLowerCase() : normalized
}

function pathCoveredByLock(path: string, lockPath: string, os?: "macos" | "windows" | "linux") {
  const candidate = normalizedCleanupPath(path, os)
  const root = normalizedCleanupPath(lockPath, os)
  return candidate === root || (root === "/" ? candidate.startsWith("/") : candidate.startsWith(`${root}/`))
}

/** The most specific user lock covering this path, if any. */
export function cleanupLockForPath(
  path: string,
  locks: readonly DiskCleanupLock[],
  os?: "macos" | "windows" | "linux",
): DiskCleanupLock | undefined {
  return locks
    .filter((lock) => pathCoveredByLock(path, lock.path, os))
    .sort(
      (left, right) => normalizedCleanupPath(right.path, os).length - normalizedCleanupPath(left.path, os).length,
    )[0]
}

export function isPathCleanupLocked(
  path: string,
  locks: readonly DiskCleanupLock[],
  os?: "macos" | "windows" | "linux",
) {
  return !!cleanupLockForPath(path, locks, os)
}

export function isCleanupLock(path: string, locks: readonly DiskCleanupLock[], os?: "macos" | "windows" | "linux") {
  return locks.some((lock) => normalizedCleanupPath(lock.path, os) === normalizedCleanupPath(path, os))
}

/**
 * Toggle a user lock. A lock covers the path and every descendant. Mapping and
 * inspection stay available; review and Trash do not.
 */
export function toggleCleanupLock(
  locks: readonly DiskCleanupLock[],
  candidate: DiskCleanupLock,
  os?: "macos" | "windows" | "linux",
  limit = CLEANUP_LOCK_LIMIT,
): DiskCleanupLock[] {
  if (!candidate.path.trim()) return [...locks]
  if (isCleanupLock(candidate.path, locks, os)) {
    return locks.filter((lock) => normalizedCleanupPath(lock.path, os) !== normalizedCleanupPath(candidate.path, os))
  }
  if (locks.length >= Math.max(1, limit)) return [...locks]
  return [...locks, { path: candidate.path, label: candidate.label.trim() || candidate.path }]
}

/** Drop review-basket items that now sit under a lock. */
export function withoutCleanupLockedNodes(
  nodes: readonly DiskScanNode[],
  locks: readonly DiskCleanupLock[],
  os?: "macos" | "windows" | "linux",
) {
  return nodes.filter((node) => !isPathCleanupLocked(node.path, locks, os))
}

export function cleanupLockMessage(lock: DiskCleanupLock) {
  return diskLanguageText("disk.cleanup.lockMessage", { name: lock.label })
}
