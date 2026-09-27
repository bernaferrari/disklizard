import {
  EMPTY_DISK_BROWSE_HISTORY,
  resolveDiskBrowseHistoryMove,
  transitionDiskBrowseHistory,
  type DiskBrowseDirection,
  type DiskBrowseHistory,
} from "./browse-history"
import type { DiskScanNode } from "./types"

/**
 * Owns browse-history state and resolves every destination back into the
 * latest immutable scan tree before it can be shown. The page only supplies
 * path identity, current-tree lookup, and the callback that displays a move.
 *
 * Framework-free subscribe/snapshot store: `history()` returns one cached
 * snapshot object per transition, so React consumers can render it through
 * `useSyncExternalStore(controller.subscribe, controller.history)`. Options
 * are captured once — read fresh page state from refs inside the callbacks.
 */
export function createDiskBrowseHistoryController(options: {
  equals(left: string, right: string): boolean
  resolve(path: string): DiskScanNode | undefined
  onMove(node: DiskScanNode): void
  blocked?: () => boolean
}) {
  const listeners = new Set<() => void>()
  let history: DiskBrowseHistory = EMPTY_DISK_BROWSE_HISTORY

  function replace(next: DiskBrowseHistory) {
    history = {
      past: [...next.past],
      current: next.current,
      future: [...next.future],
    }
    for (const listener of listeners) listener()
  }

  function reset(path?: string) {
    replace(
      transitionDiskBrowseHistory(EMPTY_DISK_BROWSE_HISTORY, {
        type: "reset",
        ...(path ? { path } : {}),
      })
    )
  }

  function visit(path: string) {
    const current = history
    const next = transitionDiskBrowseHistory(
      current,
      { type: "visit", path },
      { equals: options.equals }
    )
    if (next !== current) replace(next)
  }

  function resolvedMove(direction: DiskBrowseDirection) {
    const current = history
    return {
      current,
      next: resolveDiskBrowseHistoryMove(
        current,
        direction,
        (path) => !!options.resolve(path)
      ),
    }
  }

  function canMove(direction: DiskBrowseDirection) {
    const { current, next } = resolvedMove(direction)
    return (
      !!next.current && !options.equals(next.current, current.current ?? "")
    )
  }

  function move(direction: DiskBrowseDirection) {
    if (options.blocked?.()) return
    const { current, next } = resolvedMove(direction)
    if (next !== current) replace(next)
    if (!next.current || options.equals(next.current, current.current ?? ""))
      return
    const node = options.resolve(next.current)
    if (node) options.onMove(node)
  }

  return {
    history: () => history,
    replace,
    reset,
    visit,
    canMove,
    move,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
