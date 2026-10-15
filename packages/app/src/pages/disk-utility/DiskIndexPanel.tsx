import { FreeSpaceRow, ScanIssuesNotice } from "./ExplorerChrome"
import { FolderContext } from "./FolderContext"
import { StorageRow } from "./StorageRow"
import { Icon } from "@/components/dl/icon"
import { ScrollView } from "@/components/dl/scroll-view"
import { IndexEmpty } from "./DiskUtilityEmptyStates"
import { DiskUtilitySearchTools } from "./DiskUtilitySearchTools"
import { VirtualIndex } from "./DiskUtilityVirtualList"
import { formatBytes } from "./format"
import { itemIdentity } from "./item-identity"
import { nativeRevealLabel, scanAccessGuidance } from "./navigation"
import { diskNodeDisplayName } from "./node-display"
import { diskPathEquals } from "./storage"
import type {
  RefObject,
  Dispatch,
  SetStateAction,
  KeyboardEvent as ReactKeyboardEvent,
} from "react"
import type { usePlatform, useLanguage } from "./runtime"
import type { createSpectrum } from "./spectrum"
import type { ScanInvestigationEntry } from "./scan-investigation"
import type { IndexFilter } from "./use-disk-investigation"
import type {
  DiskScanNode,
  DiskDriveInfo,
  DiskStorageDiagnostics,
} from "./types"
import type { PointerDragSource } from "./pointer-drag"
import type { DiskEntrySortKey, DiskEntrySortDirection } from "./entry-view"

export type DiskIndexPanelProps = {
  platform: ReturnType<typeof usePlatform>
  language: ReturnType<typeof useLanguage>
  reveal: (path: string) => Promise<void>
  storageDiagnostics: DiskStorageDiagnostics | undefined
  openDiskAccessSettings: () => Promise<void>
  rescanCurrent: (forceFresh?: boolean) => Promise<void>
  indexFilter: IndexFilter
  isCollected: (path: string) => boolean
  coveringCollectedNode: (path: string) => DiskScanNode | undefined
  canModifyNode: (node: DiskScanNode) => boolean
  treeRoot: DiskScanNode | null
  toggleCollect: (node: DiskScanNode) => void
  hoveredPath: string | null
  viewNode: DiskScanNode | null
  spectrum: ReturnType<typeof createSpectrum>
  selectedPath: string | undefined
  hoverEntry: (path: string | null, node?: DiskScanNode | null) => void
  selectPath: (path: string) => void
  drill: (
    node: DiskScanNode,
    instant?: boolean,
    restoreListFocus?: boolean
  ) => void
  canDragNode: (node: DiskScanNode) => boolean
  beginCollectionDrag: (
    event: PointerDragSource,
    node: DiskScanNode | null,
    onStart?: () => void
  ) => void
  rootSpectrum: ReturnType<typeof createSpectrum>
  indexSize: number
  query: string
  indexCount: number
  searchVisible: boolean
  groupDeveloper: "category" | "none" | "project"
  setGroupDeveloper: Dispatch<SetStateAction<"category" | "none" | "project">>
  updateQuery: (value: string) => void
  updateSort: (key: DiskEntrySortKey, direction: DiskEntrySortDirection) => void
  closeSearch: () => void
  searchTriggerRef: RefObject<HTMLButtonElement | null>
  openSearch: () => void
  entries: ScanInvestigationEntry[]
  entryRowHeight: (entry: { node: DiskScanNode }) => 46 | 36
  scrollIndexIntoViewRef: RefObject<((index: number) => void) | undefined>
  listPageSizeRef: RefObject<() => number>
  DEFAULT_LIST_PAGE_SIZE: number
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
  entryLocation: (node: DiskScanNode) => string | undefined
  selectEntry: (
    node: DiskScanNode,
    index: number,
    _extendRange?: boolean,
    _currentIndex?: number
  ) => void
  setFocusIdx: Dispatch<SetStateAction<number>>
  handleEntryKeyDown: (
    event: ReactKeyboardEvent,
    node: DiskScanNode,
    index: number
  ) => void
  setQuery: Dispatch<SetStateAction<string>>
  showVolumeCapacity: boolean
  physicalCloneAccountingWarning: string | undefined
  scanDrive: DiskDriveInfo | undefined
}

export function DiskIndexPanel({
  platform,
  language,
  reveal,
  storageDiagnostics,
  openDiskAccessSettings,
  rescanCurrent,
  indexFilter,
  isCollected,
  coveringCollectedNode,
  canModifyNode,
  treeRoot,
  toggleCollect,
  hoveredPath,
  viewNode,
  spectrum,
  selectedPath,
  hoverEntry,
  selectPath,
  drill,
  canDragNode,
  beginCollectionDrag,
  rootSpectrum,
  indexSize,
  query,
  indexCount,
  searchVisible,
  groupDeveloper,
  setGroupDeveloper,
  updateQuery,
  updateSort,
  closeSearch,
  searchTriggerRef,
  openSearch,
  entries,
  entryRowHeight,
  scrollIndexIntoViewRef,
  listPageSizeRef,
  DEFAULT_LIST_PAGE_SIZE,
  moveFocus,
  moveFocusByPage,
  moveFocusToBoundary,
  entryLocation,
  selectEntry,
  setFocusIdx,
  handleEntryKeyDown,
  setQuery,
  showVolumeCapacity,
  physicalCloneAccountingWarning,
  scanDrive,
}: DiskIndexPanelProps) {
  return (
    <aside className="[container-type:inline-size] relative flex min-h-0 w-[clamp(300px,26vw,360px)] shrink-0 flex-col overflow-hidden border-l border-[var(--dl-separator)] bg-[var(--dl-sidebar)] max-[840px]:w-full max-[840px]:border-t max-[840px]:border-l-0">
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <div className="shrink-0 px-5 pt-5 pb-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2
                className="line-clamp-2 text-[18px] leading-6 font-medium tracking-[-0.02em] [overflow-wrap:anywhere] text-text-strong"
                title={viewNode?.path}
              >
                {query.trim()
                  ? language.t("disk.search.results")
                  : viewNode?._label ||
                    (viewNode
                      ? diskNodeDisplayName(viewNode)
                      : language.t("disk.common.contents"))}
              </h2>
              <div className="mt-0.5 flex items-center gap-2">
                <p className="text-[12.5px] text-text-weak tabular-nums">
                  {language.plural("disk.count.item", indexCount)}
                </p>
              </div>
            </div>
            {!query.trim() ? (
              <p className="shrink-0 pt-0.5 text-[13px] leading-6 text-text-weak tabular-nums">
                {formatBytes(indexSize)}
              </p>
            ) : null}
          </div>
          <div className="mt-3">
            {searchVisible ? (
              <DiskUtilitySearchTools
                compact
                developer={false}
                grouped={groupDeveloper}
                onGroup={setGroupDeveloper}
                query={query}
                label={language.t("disk.search.label")}
                placeholder={language.t("disk.search.placeholder")}
                sortKey={indexFilter.sortKey}
                sortDirection={indexFilter.sortDirection}
                showSort
                onQuery={updateQuery}
                onSort={updateSort}
                onDismiss={closeSearch}
              />
            ) : (
              <button
                ref={searchTriggerRef}
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-text-weaker transition-colors outline-none hover:bg-[var(--dl-well-strong)] hover:text-text-weak focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
                aria-label={language.t("disk.search.label")}
                aria-expanded={false}
                onClick={() => openSearch()}
              >
                <Icon name="magnifying-glass" className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">
                  {language.t("disk.search.placeholder")}
                </span>
                <kbd className="font-sans text-[11px] text-text-weaker">
                  {platform.os === "macos" ? "⌘F" : "Ctrl F"}
                </kbd>
              </button>
            )}
          </div>
        </div>

        {entries.length > 0 ? (
          <VirtualIndex
            footer={
              viewNode &&
              treeRoot &&
              !diskPathEquals(viewNode.path, treeRoot.path, platform.os) &&
              !query.trim() ? (
                <FolderContext
                  node={viewNode}
                  root={treeRoot}
                  color={
                    spectrum.color(viewNode) ??
                    rootSpectrum.color(viewNode) ??
                    "var(--dl-accent)"
                  }
                  revealLabel={nativeRevealLabel(platform.os)}
                  onReveal={() => void reveal(viewNode.path)}
                />
              ) : undefined
            }
            rowHeight={entryRowHeight}
            entries={entries}
            bindScrollToIndex={(fn) => {
              scrollIndexIntoViewRef.current = fn
            }}
            bindPageSize={(fn) => {
              listPageSizeRef.current = fn ?? (() => DEFAULT_LIST_PAGE_SIZE)
            }}
            onMoveFocus={moveFocus}
            onPageFocus={moveFocusByPage}
            onMoveFocusToBoundary={moveFocusToBoundary}
            render={(entry, i) => (
              <StorageRow
                node={entry.node}
                index={i()}
                size={entry.displaySize}
                color={
                  spectrum.color(entry.node) ??
                  rootSpectrum.color(entry.node) ??
                  "var(--text-weaker)"
                }
                query={query}
                location={entryLocation(entry.node)}
                active={selectedPath === entry.node.path}
                hovered={hoveredPath === entry.node.path}
                collected={isCollected(entry.node.path)}
                includedBy={
                  coveringCollectedNode(entry.node.path)
                    ? itemIdentity(coveringCollectedNode(entry.node.path)!)
                        .reviewTitle
                    : undefined
                }
                canCollect={canModifyNode(entry.node)}
                draggable={canDragNode(entry.node)}
                onActivate={(event) => {
                  if (entry.node.isDir && !event.shiftKey) drill(entry.node)
                  else selectEntry(entry.node, i(), event.shiftKey)
                }}
                onFocus={() => {
                  setFocusIdx(i())
                  selectPath(entry.node.path)
                }}
                onKeyDown={(event) =>
                  handleEntryKeyDown(event, entry.node, i())
                }
                onHover={(hovered) =>
                  hovered
                    ? hoverEntry(entry.node.path, entry.node)
                    : hoverEntry(selectedPath ?? null)
                }
                onToggleCollect={() => toggleCollect(entry.node)}
                onDragStart={(event) => beginCollectionDrag(event, entry.node)}
              />
            )}
          />
        ) : (
          <ScrollView className="min-h-0 flex-1">
            <IndexEmpty
              title={
                query.trim()
                  ? language.t("disk.empty.queryTitle", {
                      query: query.trim(),
                    })
                  : treeRoot?.scanIssues
                    ? language.t("disk.empty.partialTitle")
                    : undefined
              }
              body={
                query.trim()
                  ? language.t("disk.empty.search.body")
                  : treeRoot?.scanIssues
                    ? language.t("disk.empty.partialBody")
                    : undefined
              }
              actionLabel={
                query.trim() ? language.t("disk.search.clear") : undefined
              }
              kind={query.trim() ? "search" : "folder"}
              onReset={() => setQuery("")}
            />
          </ScrollView>
        )}

        {showVolumeCapacity ||
        treeRoot?.scanIssues ||
        physicalCloneAccountingWarning ? (
          <div className="shrink-0 border-t border-[var(--dl-separator)] px-2 py-2">
            {showVolumeCapacity && scanDrive ? (
              <FreeSpaceRow drive={scanDrive} />
            ) : null}
            <ScanIssuesNotice
              unreadableCount={treeRoot?.scanIssues?.unreadableCount}
              samplePaths={treeRoot?.scanIssues?.samplePaths}
              guidance={language.t(scanAccessGuidance(platform.os))}
              accountingWarning={physicalCloneAccountingWarning}
              onRescan={() => void rescanCurrent(true)}
              onOpenPrivacy={
                storageDiagnostics?.access.status === "limited"
                  ? () => void openDiskAccessSettings()
                  : undefined
              }
            />
          </div>
        ) : null}
      </div>
    </aside>
  )
}
