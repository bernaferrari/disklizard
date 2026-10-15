import {
  EMPTY_DISK_BROWSE_HISTORY,
  transitionDiskBrowseHistory,
} from "./browse-history"
import { developerInventoryRootsNeedRefresh } from "./developer-inventory"
import type { VolumeScanJob } from "./scan-jobs"
import { buildCrumbs } from "./navigation"
import { containsSharedPhysicalStorage } from "./recognize"
import type { DiskLizardOS } from "./runtime"
import type { ScanTab } from "./scan-tabs"
import {
  diskPathEquals,
  removeScanSubtrees,
  withoutDeletedNodes,
} from "./storage"
import type { DiskScanNode } from "./types"

type RetainedMaps = {
  root: DiskScanNode | null
  view: DiskScanNode | null
  tabs: readonly ScanTab[]
  jobs: readonly VolumeScanJob[]
  collection: readonly DiskScanNode[]
}

function survivingView(
  root: DiskScanNode,
  nextRoot: DiskScanNode,
  view: DiskScanNode,
  removed: readonly DiskScanNode[],
  os?: DiskLizardOS
) {
  const survivor = withoutDeletedNodes(
    buildCrumbs(root, view).map((crumb) => crumb.node),
    removed,
    os
  ).at(-1)
  return survivor
    ? (buildCrumbs(nextRoot, survivor).at(-1)?.node ?? nextRoot)
    : nextRoot
}

/** One immutable plan patches every retained map after confirmed filesystem removal.
 * Shared allocation cannot be patched locally: invalidate all completed maps and rescan.
 * This module does no I/O; the workspace commits the plan and releases its sessions. */
export function reconcileDeletedMaps(
  state: RetainedMaps,
  removed: readonly DiskScanNode[],
  os?: DiskLizardOS
) {
  const shared = removed.some(containsSharedPhysicalStorage)
  const deep = developerInventoryRootsNeedRefresh(
    [
      state.root,
      ...state.tabs.map((tab) => tab.tree),
      ...state.jobs.map((job) => job.tree),
    ],
    removed,
    os
  )
  const collection =
    shared || deep ? [] : withoutDeletedNodes(state.collection, removed, os)
  if (shared) {
    const jobs = state.jobs.filter((job) => !job.tree)
    const invalidatedJobs = state.jobs.filter((job) => !!job.tree)
    return {
      kind: "rescan" as const,
      collection,
      tabs: [],
      jobs,
      invalidatedJobIDs: invalidatedJobs.map((job) => job.id),
      releaseSessionIDs: [
        ...new Set([
          ...state.tabs.flatMap((tab) =>
            tab.sessionID && !state.jobs.some((job) => job.id === tab.sessionID)
              ? [tab.sessionID]
              : []
          ),
          ...invalidatedJobs.map((job) => job.id),
        ]),
      ],
    }
  }
  const tabs = state.tabs.flatMap((tab) => {
    const tree = removeScanSubtrees(tab.tree, removed, os)
    if (!tree) return []
    if (tree === tab.tree) return [tab]
    const view = survivingView(tab.tree, tree, tab.view, removed, os)
    return [
      {
        ...tab,
        tree,
        view,
        browseHistory: diskPathEquals(view.path, tab.view.path, os)
          ? tab.browseHistory
          : transitionDiskBrowseHistory(EMPTY_DISK_BROWSE_HISTORY, {
              type: "reset",
              path: view.path,
            }),
      },
    ]
  })
  const jobs = state.jobs.flatMap((job) => {
    if (!job.tree) return [job]
    const tree = removeScanSubtrees(job.tree, removed, os)
    if (!tree) return []
    return [
      tree !== job.tree
        ? {
            ...job,
            tree,
            ...(job.status === "complete" ? { bytes: tree.size } : {}),
          }
        : job,
    ]
  })
  const root =
    state.root && state.view
      ? removeScanSubtrees(state.root, removed, os)
      : state.root
  const view =
    root && state.root && state.view && root !== state.root
      ? survivingView(state.root, root, state.view, removed, os)
      : state.view
  const invalidatedJobIDs = state.jobs
    .filter((job) => !jobs.some((next) => next.id === job.id))
    .map((job) => job.id)
  const releaseSessionIDs = [
    ...new Set([
      ...state.tabs.flatMap((tab) =>
        tab.sessionID &&
        !tabs.some((next) => next.sessionID === tab.sessionID) &&
        !jobs.some((job) => job.id === tab.sessionID)
          ? [tab.sessionID]
          : []
      ),
      ...invalidatedJobIDs,
    ]),
  ]
  return {
    kind: "patch" as const,
    collection,
    tabs,
    jobs,
    root,
    view,
    invalidatedJobIDs,
    releaseSessionIDs,
  }
}
