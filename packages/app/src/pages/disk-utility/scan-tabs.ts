import type { DiskScanNode } from "@/context/platform"
import { diskPathEquals } from "./storage"

export type RetainedScanTab = {
  id: string
  sessionID?: string
  tree: DiskScanNode
  view: DiskScanNode
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
