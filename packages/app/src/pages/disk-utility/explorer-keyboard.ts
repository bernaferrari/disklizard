import type { KeyboardEvent as ReactKeyboardEvent } from "react"
import type { DiskScanNode } from "./types"
import type { createDiskPreviewController } from "./preview-controller"
import type { createDiskBrowseHistoryController } from "./browse-history-controller"
import { isDeveloperInventoryNode } from "./developer-inventory"
import { shouldHandleDiskShortcut } from "./navigation"

type ExplorerKeyboardContext = {
  view: "drives" | "scan"
  scanning: boolean
  indexFilter: { lens: string }
  browseHistory: Pick<
    ReturnType<typeof createDiskBrowseHistoryController>,
    "move"
  >
  preview: Pick<
    ReturnType<typeof createDiskPreviewController>,
    "show" | "supportsSystemPreview" | "openSystemPreview"
  >
  listPageSize: () => number
  moveFocus: (
    delta: number,
    extendRange?: boolean,
    startIndex?: number
  ) => number
  moveFocusByPage: (
    direction: -1 | 1,
    pageSize: number,
    extendRange?: boolean,
    startIndex?: number
  ) => number
  moveFocusToBoundary: (
    boundary: "first" | "last",
    extendRange?: boolean,
    startIndex?: number
  ) => number
  focusListEntry: (index: number) => void
  goUp: (instant?: boolean, restoreListFocus?: boolean) => void
  drill: (
    node: DiskScanNode,
    instant?: boolean,
    restoreListFocus?: boolean
  ) => void
  reveal: (path: string) => void | Promise<void>
  requestDelete: (node: DiskScanNode) => void
  canModifyNode: (node: DiskScanNode) => boolean
  toggleCollect: (node: DiskScanNode) => void
  toggleProtectedTree: (path: string, label: string) => void | Promise<void>
  rescanCurrent: () => void | Promise<void>
  chooseScanMode: (mode: "map" | "grid", source: "keyboard") => void
  chooseLens: (lens: "all") => void
  openSearch: () => void
  cancelScan: () => void
  focusedEntryNode: () => DiskScanNode | null
  openFocused: () => void
}

/** Routes entry and global shortcuts through the same explorer commands.
 * The page handles modal ownership before handing an event to this controller. */
export function createExplorerKeyboard(context: () => ExplorerKeyboardContext) {
  function handleEntryKeyDown(
    event: ReactKeyboardEvent,
    node: DiskScanNode,
    index: number
  ) {
    const {
      browseHistory,
      moveFocus,
      moveFocusByPage,
      moveFocusToBoundary,
      listPageSize,
      focusListEntry,
      goUp,
      drill,
      reveal,
      preview,
      requestDelete,
      canModifyNode,
      toggleCollect,
      toggleProtectedTree,
      rescanCurrent,
      chooseScanMode,
    } = context()
    if (event.defaultPrevented) return
    const supportsRangeNavigation =
      !event.metaKey && !event.ctrlKey && !event.altKey
    const isPlainShortcut = supportsRangeNavigation && !event.shiftKey
    if (
      event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault()
      browseHistory.move(event.key === "ArrowLeft" ? "back" : "forward")
      return
    }
    if (
      supportsRangeNavigation &&
      (event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        (isPlainShortcut && (event.key === "j" || event.key === "k")))
    ) {
      event.preventDefault()
      const next = moveFocus(
        event.key === "ArrowDown" || event.key === "j" ? 1 : -1,
        event.shiftKey,
        index
      )
      if (next >= 0) focusListEntry(next)
      return
    }
    if (
      supportsRangeNavigation &&
      (event.key === "PageDown" || event.key === "PageUp")
    ) {
      event.preventDefault()
      const next = moveFocusByPage(
        event.key === "PageDown" ? 1 : -1,
        listPageSize(),
        event.shiftKey,
        index
      )
      if (next >= 0) focusListEntry(next)
      return
    }
    if (
      supportsRangeNavigation &&
      (event.key === "Home" || event.key === "End")
    ) {
      event.preventDefault()
      const next = moveFocusToBoundary(
        event.key === "Home" ? "first" : "last",
        event.shiftKey,
        index
      )
      if (next >= 0) focusListEntry(next)
      return
    }
    if (isPlainShortcut && event.key === "ArrowLeft") {
      event.preventDefault()
      goUp(true, true)
      return
    }
    if (isPlainShortcut && event.key === "ArrowRight") {
      if (!node.isDir || isDeveloperInventoryNode(node)) return
      event.preventDefault()
      drill(node, true, true)
      return
    }
    if (isPlainShortcut && event.key === "Enter") {
      event.preventDefault()
      if (node.isDir) {
        if (isDeveloperInventoryNode(node)) void reveal(node.path)
        else drill(node, true, true)
        return
      }
      if (!node.isOther) void preview.show(node)
      return
    }
    if (isPlainShortcut && event.key === " ") {
      event.preventDefault()
      if (node.isOther || node.isHidden) return
      if (preview.supportsSystemPreview()) {
        void preview.openSystemPreview(node)
        return
      }
      void preview.show(node)
      return
    }
    if (
      event.key === "Backspace" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey
    ) {
      event.preventDefault()
      requestDelete(node)
      return
    }
    if (isPlainShortcut && event.key === "Delete") {
      event.preventDefault()
      requestDelete(node)
      return
    }
    if (isPlainShortcut && event.key.toLowerCase() === "c") {
      if (!canModifyNode(node)) return
      event.preventDefault()
      toggleCollect(node)
      return
    }
    if (isPlainShortcut && event.key.toLowerCase() === "l") {
      if (node.isOther || node.isHidden) return
      event.preventDefault()
      void toggleProtectedTree(node.path, node.name)
      return
    }
    if (
      event.key.toLowerCase() === "r" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey
    ) {
      event.preventDefault()
      void rescanCurrent()
      return
    }
    if (isPlainShortcut && event.key === "1") {
      event.preventDefault()
      chooseScanMode("map", "keyboard")
      return
    }
    if (isPlainShortcut && event.key === "2") {
      event.preventDefault()
      chooseScanMode("grid", "keyboard")
      return
    }
    if (
      isPlainShortcut &&
      (event.key === "Escape" || event.key === "Backspace")
    ) {
      event.preventDefault()
      // Going up is one deliberate step, not rapid browsing: let it zoom out
      // like the pointer does (reduced motion still settles instantly).
      goUp(false, true)
    }
  }

  function handleGlobalKeyDown(e: KeyboardEvent) {
    const {
      view,
      scanning,
      indexFilter,
      openSearch,
      cancelScan,
      browseHistory,
      moveFocus,
      moveFocusByPage,
      moveFocusToBoundary,
      listPageSize,
      goUp,
      drill,
      preview,
      focusedEntryNode,
      openFocused,
      requestDelete,
      canModifyNode,
      toggleCollect,
      toggleProtectedTree,
      rescanCurrent,
      chooseScanMode,
      chooseLens,
    } = context()
    if (
      view === "scan" &&
      !scanning &&
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      e.key.toLowerCase() === "f"
    ) {
      e.preventDefault()
      openSearch()
      return
    }
    if (!shouldHandleDiskShortcut(e.target, e.defaultPrevented)) return
    if (view !== "scan") return
    if (
      !scanning &&
      (indexFilter.lens === "developer" ||
        indexFilter.lens === "recommendations")
    ) {
      // Clean Up is a page of its own: Escape returns to the map, Cmd+R
      // rescans, and map navigation keys stay inert.
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        chooseLens("all")
      } else if (
        e.key.toLowerCase() === "r" &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey
      ) {
        e.preventDefault()
        void rescanCurrent()
      }
      return
    }
    const supportsRangeNavigation = !e.metaKey && !e.ctrlKey && !e.altKey
    const isPlainShortcut = supportsRangeNavigation && !e.shiftKey
    if (scanning) {
      if (isPlainShortcut && (e.key === "Escape" || e.key === "Backspace")) {
        e.preventDefault()
        cancelScan()
      }
      return
    }
    if (
      e.altKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey &&
      (e.key === "ArrowLeft" || e.key === "ArrowRight")
    ) {
      e.preventDefault()
      browseHistory.move(e.key === "ArrowLeft" ? "back" : "forward")
      return
    }
    if (
      supportsRangeNavigation &&
      (e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        (isPlainShortcut && (e.key === "j" || e.key === "k")))
    ) {
      e.preventDefault()
      moveFocus(e.key === "ArrowDown" || e.key === "j" ? 1 : -1, e.shiftKey)
      return
    }
    if (
      supportsRangeNavigation &&
      (e.key === "PageDown" || e.key === "PageUp")
    ) {
      e.preventDefault()
      moveFocusByPage(e.key === "PageDown" ? 1 : -1, listPageSize(), e.shiftKey)
      return
    }
    if (supportsRangeNavigation && (e.key === "Home" || e.key === "End")) {
      e.preventDefault()
      moveFocusToBoundary(e.key === "Home" ? "first" : "last", e.shiftKey)
      return
    }
    if (isPlainShortcut && e.key === "ArrowLeft") {
      e.preventDefault()
      goUp(true)
      return
    }
    if (isPlainShortcut && e.key === "ArrowRight") {
      const node = focusedEntryNode()
      if (!node?.isDir || isDeveloperInventoryNode(node)) return
      e.preventDefault()
      drill(node, true)
      return
    }
    if (isPlainShortcut && e.key === "Enter") {
      e.preventDefault()
      openFocused()
      return
    }
    if (isPlainShortcut && e.key === " ") {
      const node = focusedEntryNode()
      if (!node || node.isOther || node.isHidden) return
      e.preventDefault()
      if (preview.supportsSystemPreview()) {
        void preview.openSystemPreview(node)
        return
      }
      void preview.show(node)
      return
    }
    if (e.key === "Backspace" && (e.metaKey || e.ctrlKey) && !e.altKey) {
      const node = focusedEntryNode()
      if (!node) return
      e.preventDefault()
      requestDelete(node)
      return
    }
    if (isPlainShortcut && (e.key === "Escape" || e.key === "Backspace")) {
      e.preventDefault()
      goUp(true)
      return
    }
    if (isPlainShortcut && e.key === "Delete") {
      const node = focusedEntryNode()
      if (!node) return
      e.preventDefault()
      requestDelete(node)
      return
    }
    if (isPlainShortcut && e.key.toLowerCase() === "c") {
      const node = focusedEntryNode()
      if (!node || !canModifyNode(node)) return
      e.preventDefault()
      toggleCollect(node)
      return
    }
    if (isPlainShortcut && e.key.toLowerCase() === "l") {
      const node = focusedEntryNode()
      if (!node || node.isOther || node.isHidden) return
      e.preventDefault()
      void toggleProtectedTree(node.path, node.name)
      return
    }
    if (e.key.toLowerCase() === "r" && (e.metaKey || e.ctrlKey) && !e.altKey) {
      e.preventDefault()
      void rescanCurrent()
      return
    }
    if (isPlainShortcut && e.key === "1") {
      e.preventDefault()
      chooseScanMode("map", "keyboard")
      return
    }
    if (isPlainShortcut && e.key === "2") {
      e.preventDefault()
      chooseScanMode("grid", "keyboard")
      return
    }
  }

  return { handleEntryKeyDown, handleGlobalKeyDown }
}
