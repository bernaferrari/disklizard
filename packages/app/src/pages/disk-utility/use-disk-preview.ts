import { useEffect, useMemo, useRef, useState } from "react"
import { showToast } from "@/components/dl/toast"
import { createDiskPreviewController } from "./preview-controller"
import { diskPathEquals } from "./storage"
import { findRetainedNode } from "./navigation"
import type { useLanguage, DiskLizardOS } from "./runtime"
import type { DiskScanNode, DiskUtilityAPI } from "./types"

type PreviewOptions = {
  disk?: DiskUtilityAPI
  os?: DiskLizardOS
  language: ReturnType<typeof useLanguage>
  treeRoot: DiskScanNode | null
  entries: readonly { node: DiskScanNode }[]
  select(path: string): void
}

/** Owns preview subscriptions, entry identity, reconciliation and disposal. */
export function useDiskPreview(options: PreviewOptions) {
  const nodes = useMemo(
    () => options.entries.map(({ node }) => node),
    [options.entries]
  )
  const latest = useRef({ ...options, nodes })
  latest.current = { ...options, nodes }
  const controller = useMemo(
    () =>
      createDiskPreviewController({
        api: () => latest.current.disk,
        entries: () => latest.current.nodes,
        isPathCurrent: (path) => {
          const { treeRoot: root, os } = latest.current
          return (
            !!root &&
            (!!findRetainedNode(root, path) ||
              !!root.developerArtifactInventory?.items.some((item) =>
                diskPathEquals(item.path, path, os)
              ))
          )
        },
        os: options.os,
        select: (path) => latest.current.select(path),
        onOperationError: (operation, message) =>
          showToast({
            variant: "error",
            title: latest.current.language.t(
              operation === "open"
                ? "disk.toast.openFileFailed"
                : "disk.toast.quickLookFailed"
            ),
            description: message,
          }),
      }),
    []
  )
  // Entries are external to the controller store, so read on both notifications
  // and entry generations rather than pretending its snapshot is independent.
  const [view, setView] = useState(() => controller.view())
  useEffect(() => {
    const update = () => setView(controller.view())
    update()
    return controller.subscribe(update)
  }, [controller, nodes])
  useEffect(() => {
    controller.reconcile()
  }, [controller, options.treeRoot])
  useEffect(() => () => controller.dispose(), [controller])
  return { controller, view }
}
