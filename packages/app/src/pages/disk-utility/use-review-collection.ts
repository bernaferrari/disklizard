import { useMemo, useState } from "react"
import type { DiskLizardOS } from "./runtime"
import type { DiskScanNode } from "./types"
import {
  diskPathEquals,
  diskPathIsWithin,
  normalizedDiskPath,
  uniqueDeletionRoots,
} from "./storage"
import { containsSharedPhysicalStorage } from "./recognize"

/** Owns the scan-wide review basket. Filters change the workspace, never the
 * selection. Parent replacement and path identity use the platform's policy. */
export function useReviewCollection(options: {
  os?: DiskLizardOS
  canCollect: (node: DiskScanNode) => boolean
  needsRescan: (node: DiskScanNode) => boolean
  onNeedsRescan: (node: DiskScanNode) => void
  onParentReplaced: (node: DiskScanNode, count: number) => void
  onEmpty: () => void
}) {
  const [items, setItems] = useState<DiskScanNode[]>([])
  const membership = useMemo(
    () =>
      new Set(items.map((node) => normalizedDiskPath(node.path, options.os))),
    [items, options.os]
  )
  const effectiveItems = useMemo(
    () =>
      uniqueDeletionRoots(
        items.filter((node) => !options.needsRescan(node)),
        options.os
      ),
    [items, options.os, options.needsRescan]
  )
  const paths = useMemo(
    () => effectiveItems.map((node) => node.path),
    [effectiveItems]
  )
  const bytes = effectiveItems.reduce((sum, node) => sum + node.size, 0)
  const shared = effectiveItems.some(containsSharedPhysicalStorage)

  function toggle(node: DiskScanNode) {
    if (
      items.some((item) => diskPathEquals(item.path, node.path, options.os))
    ) {
      setItems((current) =>
        current.filter(
          (item) => !diskPathEquals(item.path, node.path, options.os)
        )
      )
      return
    }
    if (options.needsRescan(node)) {
      options.onNeedsRescan(node)
      return
    }
    if (!options.canCollect(node)) return
    const children = items.filter(
      (item) =>
        !diskPathEquals(item.path, node.path, options.os) &&
        diskPathIsWithin(item.path, node.path, options.os)
    )
    if (children.length) options.onParentReplaced(node, children.length)
    setItems((current) =>
      current.some((item) => diskPathEquals(item.path, node.path, options.os))
        ? current.filter(
            (item) => !diskPathEquals(item.path, node.path, options.os)
          )
        : uniqueDeletionRoots([...current, node], options.os)
    )
  }
  function add(nodes: readonly DiskScanNode[]) {
    const actionable = nodes.filter(options.canCollect)
    if (actionable.length)
      setItems((current) =>
        uniqueDeletionRoots([...current, ...actionable], options.os)
      )
  }
  function uncollect(nodes: readonly DiskScanNode[]) {
    setItems((current) =>
      current.filter(
        (item) =>
          !nodes.some((node) =>
            diskPathEquals(item.path, node.path, options.os)
          )
      )
    )
  }
  function remove(node: DiskScanNode) {
    const next = items.filter(
      (item) => !diskPathEquals(item.path, node.path, options.os)
    )
    setItems(next)
    if (!uniqueDeletionRoots(next, options.os).length) options.onEmpty()
  }
  return {
    items,
    setItems,
    effectiveItems,
    paths,
    bytes,
    shared,
    toggle,
    add,
    uncollect,
    remove,
    clear: () => setItems([]),
    isCollected: (path: string) =>
      membership.has(normalizedDiskPath(path, options.os)),
    coveringNode: (path: string) =>
      items.find(
        (node) =>
          !diskPathEquals(node.path, path, options.os) &&
          diskPathIsWithin(path, node.path, options.os)
      ),
  }
}
