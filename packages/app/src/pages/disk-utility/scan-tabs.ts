import { EMPTY_DISK_BROWSE_HISTORY, transitionDiskBrowseHistory, type DiskBrowseHistory } from "./browse-history"
import type { DiskDriveInfo, DiskScanNode } from "./types"
import { diskPathEquals } from "./storage"

type DiskOS = "macos" | "windows" | "linux"

/** Active map + four parked maps keeps watcher/tree memory explicitly bounded. */
export const MAX_RETAINED_SCAN_TABS = 4

export type ScanTabSnapshot = {
  sessionID?: string
  label: string
  sourcePath: string
  tree: DiskScanNode
  view: DiskScanNode
  browseHistory: DiskBrowseHistory
  drive?: DiskDriveInfo
}

export type ScanTab = ScanTabSnapshot & {
  id: string
}

export type RetainedScanTab = Pick<ScanTab, "id" | "sessionID" | "tree" | "view">

export type CurrentScanTabState = Omit<ScanTabSnapshot, "tree" | "view"> & {
  tree: DiskScanNode | null
  view: DiskScanNode | null
}

export type SaveCurrentScanTabOptions = {
  newTabID: string
  volumeJobSessionIDs: readonly string[]
  os?: DiskOS
}

/**
 * Retain the active map as a background tab. Session identity is authoritative:
 * saving the same scan twice refreshes its parked state instead of creating a
 * second UI owner (and, consequently, a second watcher owner).
 */
export function saveCurrentScanTab(
  tabs: ScanTab[],
  current: CurrentScanTabState,
  options: SaveCurrentScanTabOptions,
): ScanTab[] {
  if (!current.tree) return tabs
  if (current.sessionID && options.volumeJobSessionIDs.includes(current.sessionID)) return tabs

  const snapshot = normalizeScanSnapshot(current, options.os)
  const matchesCurrent = (tab: ScanTab) =>
    current.sessionID ? tab.sessionID === current.sessionID : !tab.sessionID && tab.tree === current.tree
  const existingIndex = tabs.findIndex(matchesCurrent)
  if (existingIndex < 0) return [...tabs, { id: uniqueTabID(tabs, options.newTabID), ...snapshot }]

  const existingID = tabs[existingIndex]!.id
  return [...tabs.filter((tab) => !matchesCurrent(tab)), { id: existingID, ...snapshot }]
}

export type LimitRetainedScanTabsOptions = CloseScanTabOptions & { limit?: number }

export type LimitRetainedScanTabsResult = {
  tabs: ScanTab[]
  /** Sessions whose final tree/watcher owner was evicted. */
  releaseSessionIDs: string[]
}

/** Evict least-recently parked maps and identify every watcher that lost its final owner. */
export function limitRetainedScanTabs(
  tabs: readonly ScanTab[],
  options: LimitRetainedScanTabsOptions,
): LimitRetainedScanTabsResult {
  const limit = options.limit ?? MAX_RETAINED_SCAN_TABS
  if (!Number.isSafeInteger(limit) || limit < 0) throw new TypeError("Invalid retained scan tab limit")
  if (tabs.length <= limit) return { tabs: [...tabs], releaseSessionIDs: [] }

  const evicted = tabs.slice(0, tabs.length - limit)
  const retained = tabs.slice(tabs.length - limit)
  const retainedSessions = new Set(retained.flatMap((tab) => (tab.sessionID ? [tab.sessionID] : [])))
  const releaseSessionIDs = [...new Set(evicted.flatMap((tab) => (tab.sessionID ? [tab.sessionID] : [])))].filter(
    (sessionID) =>
      sessionID !== options.activeSessionID &&
      !options.volumeJobSessionIDs.includes(sessionID) &&
      !retainedSessions.has(sessionID),
  )
  return { tabs: retained, releaseSessionIDs }
}

export type RestoreScanTabResult = {
  tabs: ScanTab[]
  restored?: ScanTabSnapshot
}

/**
 * Atomically decide the retained-tab result for a switch. The selected tab is
 * resolved before the current map is parked, so a stale ID cannot accidentally
 * save the active map. Restored node pointers are always rebased into the tab's
 * immutable tree.
 */
export function restoreScanTab(
  tabs: ScanTab[],
  tabID: string,
  current: CurrentScanTabState,
  options: SaveCurrentScanTabOptions,
): RestoreScanTabResult {
  const selected = tabs.find((tab) => tab.id === tabID)
  if (!selected) return { tabs }

  const withCurrent = saveCurrentScanTab(tabs, current, options)
  const matchesRestored = (tab: ScanTab) =>
    selected.sessionID ? tab.sessionID === selected.sessionID : !tab.sessionID && tab.tree === selected.tree
  return {
    tabs: withCurrent.filter((tab) => !matchesRestored(tab)),
    restored: normalizeScanSnapshot(selected, options.os),
  }
}

export type CloseScanTabOptions = {
  activeSessionID?: string
  volumeJobSessionIDs: readonly string[]
}

export type CloseScanTabResult = {
  tabs: ScanTab[]
  /** The caller may forget history and stop this session's filesystem watcher. */
  releaseSessionID?: string
}

/**
 * Remove one parked tab and decide whether its session still has an owner. A
 * watcher belongs to the session, not the visual tab: another parked tab, the
 * active map, or a volume job all keep it alive.
 */
export function closeScanTab(
  tabs: ScanTab[],
  tabID: string,
  options: CloseScanTabOptions,
): CloseScanTabResult {
  const closed = tabs.find((tab) => tab.id === tabID)
  if (!closed) return { tabs }

  const next = tabs.filter((tab) => tab.id !== tabID)
  const sessionID = closed.sessionID
  const sessionStillOwned =
    !sessionID ||
    options.activeSessionID === sessionID ||
    options.volumeJobSessionIDs.includes(sessionID) ||
    next.some((tab) => tab.sessionID === sessionID)
  return {
    tabs: next,
    ...(sessionStillOwned ? {} : { releaseSessionID: sessionID }),
  }
}

function normalizeScanSnapshot(
  current: CurrentScanTabState | ScanTabSnapshot,
  os?: DiskOS,
): ScanTabSnapshot {
  const tree = current.tree
  if (!tree) throw new TypeError("A retained scan requires a tree")
  const requestedView = current.view ? findNodeInTree(tree, current.view.path, os) : undefined
  const view = requestedView ?? tree
  const historyCurrent = current.browseHistory.current
  const historyCurrentIsView =
    !!historyCurrent &&
    !!findNodeInTree(tree, historyCurrent, os) &&
    diskPathEquals(historyCurrent, view.path, os)
  const browseHistory = historyCurrentIsView
    ? {
        past: [...current.browseHistory.past],
        current: historyCurrent,
        future: [...current.browseHistory.future],
      }
    : !historyCurrent
      ? {
          past: [...current.browseHistory.past],
          current: view.path,
          future: [...current.browseHistory.future],
        }
      : transitionDiskBrowseHistory(EMPTY_DISK_BROWSE_HISTORY, { type: "reset", path: view.path })

  return {
    sessionID: current.sessionID,
    label: current.label || tree.name,
    sourcePath: current.sourcePath || tree.path,
    tree,
    view,
    browseHistory,
    drive: current.drive,
  }
}

function uniqueTabID(tabs: readonly Pick<ScanTab, "id">[], preferred: string) {
  const ids = new Set(tabs.map((tab) => tab.id))
  if (!ids.has(preferred)) return preferred
  let suffix = 2
  while (ids.has(`${preferred}-${suffix}`)) suffix++
  return `${preferred}-${suffix}`
}

/** Match the tabs that are actually rendered: the active volume job is represented by the current-scan pill. */
export function visibleScanTabCount(input: {
  retainedCount: number
  volumeJobIDs: readonly string[]
  activeID?: string
  hasCurrentScan: boolean
}) {
  return (
    input.retainedCount +
    input.volumeJobIDs.filter((id) => id !== input.activeID).length +
    (input.hasCurrentScan ? 1 : 0)
  )
}

function findNodeInTree(
  root: DiskScanNode,
  targetPath: string,
  os?: "macos" | "windows" | "linux",
): DiskScanNode | undefined {
  if (diskPathEquals(root.path, targetPath, os)) return root
  for (const child of root.children) {
    const match = findNodeInTree(child, targetPath, os)
    if (match) return match
  }
  return undefined
}

/**
 * A filesystem watcher keeps running for parked tabs. Rebase the matching
 * tab's tree and its view pointer together so opening the tab cannot revive a
 * stale root-only inventory or a node from the previous map.
 */
export function refreshScanTabsForWatcherUpdate<T extends RetainedScanTab>(
  tabs: readonly T[],
  scanID: string,
  nextTreeForTab: (tab: T) => DiskScanNode,
  os?: "macos" | "windows" | "linux",
): T[] {
  let changed = false
  const next = tabs.map((tab) => {
    if (tab.sessionID !== scanID) return tab
    changed = true
    const tree = nextTreeForTab(tab)
    return {
      ...tab,
      tree,
      view: findNodeInTree(tree, tab.view.path, os) ?? tree,
    }
  })
  return changed ? next : [...tabs]
}
