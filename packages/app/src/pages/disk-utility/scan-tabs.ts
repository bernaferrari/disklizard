import type { DiskScanNode } from "./types"
import { diskPathEquals } from "./storage"

export type RetainedScanTab = {
  id: string
  sessionID?: string
  tree: DiskScanNode
  view: DiskScanNode
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
