import { useMemo, useRef, useSyncExternalStore } from "react"
import { createDiskBrowseHistoryController } from "./browse-history-controller"
import { diskPathEquals } from "./storage"
import type { DiskLizardOS } from "./runtime"
import type { DiskScanNode } from "./types"

type BrowseOptions = {
  os?: DiskLizardOS
  resolve(path: string): DiskScanNode | undefined
  blocked: boolean
  onMove(node: DiskScanNode): void
}

/** React adapter: history commands always resolve against the current tree. */
export function useDiskBrowseHistory(options: BrowseOptions) {
  const latest = useRef(options)
  latest.current = options
  const controller = useMemo(
    () =>
      createDiskBrowseHistoryController({
        equals: (left, right) => diskPathEquals(left, right, latest.current.os),
        resolve: (path) => latest.current.resolve(path),
        blocked: () => latest.current.blocked,
        onMove: (node) => latest.current.onMove(node),
      }),
    []
  )
  const history = useSyncExternalStore(controller.subscribe, controller.history)
  return { controller, history }
}
