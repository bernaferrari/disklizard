import type { DiskScanNode } from "@/context/platform"
import { formatBytes, formatPct } from "./format"

export type Crumb = { name: string; path: string; node: DiskScanNode }

export type StorageNodeCapabilities = {
  canPreview?: boolean
  canReview?: boolean
  requiresRescanBeforeReview?: boolean
}

type DesktopOS = "macos" | "windows" | "linux"

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
export function shouldHandleDiskShortcut(target: EventTarget | null, defaultPrevented: boolean): boolean {
  if (defaultPrevented) return false
  return !(target instanceof Element && target.closest(INTERACTIVE_SELECTOR))
}

/** A short recovery instruction for scans that hit OS access boundaries. */
export function scanAccessGuidance(os?: DesktopOS): string {
  if (os === "macos") return "Grant Full Disk Access to OpenCode in System Settings, then scan again."
  if (os === "windows") return "Use an account with access to this drive, or scan a folder your account can read."
  if (os === "linux") return "Review folder and mount permissions, then scan again."
  return "Review access to these folders, then scan again."
}

/** Use the operating system's own name for its recoverable deletion destination. */
export function nativeTrashName(os?: DesktopOS): "Recycle Bin" | "Trash" {
  return os === "windows" ? "Recycle Bin" : "Trash"
}

/** A concise screen-reader update for keyboard navigation inside the canvas map. */
export function describeStorageNode(
  node: DiskScanNode | null,
  parentSize: number,
  capabilities: StorageNodeCapabilities = {},
): string {
  if (!node) return ""
  const share = parentSize > 0 ? `, ${formatPct(node.size, parentSize)} of this level` : ""
  const canPreview = !node.isOther && !node.isHidden && capabilities.canPreview !== false
  const canReview = !node.isOther && capabilities.canReview !== false
  const inventoryOnly = (node as DiskScanNode & { inventoryOnly?: boolean }).inventoryOnly === true
  const action =
    inventoryOnly
      ? " Deep inventory result; it cannot be explored from the map."
      : node.isDir && !node.isOther
        ? " Press Enter to explore."
        : canPreview
          ? " Press Space to preview."
          : ""
  const cleanup = canReview
    ? " Press C to add it to review."
    : capabilities.requiresRescanBeforeReview
      ? " Rescan before adding it to review."
      : ""
  return `${node.name}, ${formatBytes(node.size)}${share}.${action}${cleanup}`
}

/**
 * Follow the retained scan tree instead of rebuilding paths from separators.
 * That keeps breadcrumbs correct for POSIX, Windows drive paths, UNC shares,
 * and synthetic roots alike.
 */
export function buildCrumbs(root: DiskScanNode | null, view: DiskScanNode | null): Crumb[] {
  if (!root || !view) return []

  const chain: DiskScanNode[] = []
  const targetPath = view.path
  function visit(node: DiskScanNode): boolean {
    chain.push(node)
    if (node.path === targetPath) return true
    for (const child of node.children ?? []) {
      if (visit(child)) return true
    }
    chain.pop()
    return false
  }

  if (!visit(root)) return [{ name: root._label || root.name || root.path, path: root.path, node: root }]
  return chain.map((node, index) => ({
    name: index === 0 ? root._label || root.name || root.path : node.name,
    path: node.path,
    node,
  }))
}
