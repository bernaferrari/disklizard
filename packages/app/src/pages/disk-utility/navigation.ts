import type { DiskScanNode } from "./types"
import { formatBytes, formatPct } from "./format"
import { diskLanguageText } from "./runtime"
import { diskNodeDisplayName } from "./node-display"

export type Crumb = { name: string; path: string; node: DiskScanNode }

export type StorageNodeCapabilities = {
  canPreview?: boolean
  canReview?: boolean
  requiresRescanBeforeReview?: boolean
}

type DesktopOS = "macos" | "windows" | "linux"

export type ScanAccessGuidanceKey =
  | "disk.accessGuidance.macos"
  | "disk.accessGuidance.windows"
  | "disk.accessGuidance.linux"
  | "disk.accessGuidance.default"

const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  "summary",
  "iframe",
  "audio",
  "video",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menuitem"]',
  '[role="slider"]',
  '[role="tab"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  "dialog",
  "[data-disk-shortcut-ignore]",
].join(", ")

/** Global spatial-navigation shortcuts must never steal keys from controls. */
export function shouldHandleDiskShortcut(
  target: EventTarget | null,
  defaultPrevented: boolean
): boolean {
  if (defaultPrevented) return false
  return !(target instanceof Element && target.closest(INTERACTIVE_SELECTOR))
}

/** A short recovery instruction for scans that hit OS access boundaries. */
export function scanAccessGuidance(os?: DesktopOS): ScanAccessGuidanceKey {
  if (os === "macos") return "disk.accessGuidance.macos"
  if (os === "windows") return "disk.accessGuidance.windows"
  if (os === "linux") return "disk.accessGuidance.linux"
  return "disk.accessGuidance.default"
}

/** Use the operating system's own name for its recoverable deletion destination. */
export function nativeTrashName(os?: DesktopOS): string {
  return os === "windows"
    ? diskLanguageText("disk.common.recycleBin")
    : diskLanguageText("disk.common.trash")
}

/** Name the exact system file browser instead of the ambiguous verb "Reveal". */
export function nativeRevealLabel(os?: DesktopOS): string {
  if (os === "macos") return diskLanguageText("disk.detail.revealFinder")
  if (os === "windows") return diskLanguageText("disk.detail.revealExplorer")
  if (os === "linux") return diskLanguageText("disk.detail.revealFiles")
  return diskLanguageText("disk.detail.revealManager")
}

/** A concise screen-reader update for keyboard navigation inside the canvas map. */
export function describeStorageNode(
  node: DiskScanNode | null,
  parentSize: number,
  capabilities: StorageNodeCapabilities = {}
): string {
  if (!node) return ""
  const share =
    parentSize > 0
      ? diskLanguageText("disk.node.share", {
          value: formatPct(node.size, parentSize),
        })
      : ""
  const canPreview =
    !node.isOther && !node.isHidden && capabilities.canPreview !== false
  const canReview = !node.isOther && capabilities.canReview !== false
  const inventoryOnly =
    (node as DiskScanNode & { inventoryOnly?: boolean }).inventoryOnly === true
  const action = inventoryOnly
    ? diskLanguageText("disk.node.inventoryAction")
    : node.isOther && !node.isHidden
      ? diskLanguageText("disk.node.moreAction")
      : node.isDir
        ? diskLanguageText("disk.node.exploreAction")
        : canPreview
          ? diskLanguageText("disk.node.previewAction")
          : ""
  const cleanup = canReview
    ? diskLanguageText("disk.node.reviewAction")
    : capabilities.requiresRescanBeforeReview
      ? diskLanguageText("disk.node.rescanAction")
      : ""
  return diskLanguageText("disk.node.description", {
    name: diskNodeDisplayName(node),
    size: formatBytes(node.size),
    share,
    action,
    cleanup,
  })
}

/**
 * Follow the retained scan tree instead of rebuilding paths from separators.
 * That keeps breadcrumbs correct for POSIX, Windows drive paths, UNC shares,
 * and synthetic roots alike.
 */
function retainedTrail(
  root: DiskScanNode,
  targetPath: string
): DiskScanNode[] | null {
  const chain: DiskScanNode[] = []
  const normalizedTarget =
    targetPath.replaceAll("\\", "/").replace(/\/+$/, "") || "/"
  function visit(node: DiskScanNode): boolean {
    chain.push(node)
    if (
      node.path === targetPath ||
      node.path.replaceAll("\\", "/").replace(/\/+$/, "") ===
        normalizedTarget
    )
      return true
    for (const child of node.children ?? []) {
      const childPath =
        child.path.replaceAll("\\", "/").replace(/\/+$/, "") || "/"
      if (
        (normalizedTarget === childPath ||
          normalizedTarget.startsWith(
            childPath.endsWith("/") ? childPath : `${childPath}/`
          )) &&
        visit(child)
      )
        return true
    }
    chain.pop()
    return false
  }

  return visit(root) ? chain : null
}

/** Resolve a retained node by its path without walking unrelated subtrees. */
export function findRetainedNode(
  root: DiskScanNode,
  targetPath: string
): DiskScanNode | undefined {
  return retainedTrail(root, targetPath)?.at(-1)
}

export function buildCrumbs(
  root: DiskScanNode | null,
  view: DiskScanNode | null
): Crumb[] {
  if (!root || !view) return []
  const chain = retainedTrail(root, view.path)
  if (!chain)
    return [
      {
        name: root._label || root.name || root.path,
        path: root.path,
        node: root,
      },
    ]
  return chain.map((node, index) => ({
    name:
      index === 0
        ? root._label || root.name || root.path
        : diskNodeDisplayName(node),
    path: node.path,
    node,
  }))
}
