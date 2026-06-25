/**
 * @opencode-ai/disklizard — shared core for Desktop (Electron) + TUI
 *
 *   import { scanPath, formatBytes, buildCrumbs } from "@opencode-ai/disklizard"
 *   bun packages/disklizard/bin/disklizard.ts   # terminal UI
 */

export type { DiskNode, DriveInfo, ScanProgress, ScanOptions, Crumb } from "./types"
export { formatBytes, formatPct, truncate, pad } from "./format"
export { buildCrumbs, findParent, findNode, sortedChildren, canDrill } from "./tree"
export { scanPath, scanPathSync, getDrives, deleteDiskPath } from "./scan"
export { renderTuiBars, renderTuiHeader, renderTuiHelp } from "./tui/render"
