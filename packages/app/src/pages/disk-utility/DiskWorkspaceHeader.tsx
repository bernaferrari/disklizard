import { ChangesPanel } from "./ChangesPanel"
import { DiskAppMenu } from "./DiskAppMenu"
import { ChangesButton, ViewSwitch, WorkspaceSwitch } from "./ExplorerChrome"
import { LocationNavigation } from "./LocationNavigation"
import type { createDiskBrowseHistoryController } from "./browse-history-controller"
import type { ScanInvestigationLens } from "./scan-investigation"
import type { ScanMode } from "./use-disk-visualization"
import type { SunburstEntryIntent } from "./sunburst"
import type { ScanHistoryEntry } from "./scan-history"
import type { Crumb } from "./navigation"
import type { BaselineComparison } from "./scan-baseline"
import type { DiskScanNode } from "./types"

export type DiskWorkspaceHeaderProps = {
  activeDialog: string | null
  view: "drives" | "scan"
  scanning: boolean
  currentScanPinned: boolean
  currentScanLocked: boolean
  pinMutationPending: boolean
  deleting: boolean
  cleanupProtectionsReady: () => boolean
  cleanupLockMutationPending: boolean
  togglePinnedLocation: (path: string, label: string) => Promise<void>
  scanSourcePath: string
  scanLabel: string
  toggleProtectedTree: (path: string, label: string) => Promise<void>
  crumbs: Crumb[]
  browseHistory: ReturnType<typeof createDiskBrowseHistoryController>
  backToDrives: (preserveCurrent?: boolean) => void
  cleanupWorkspace: boolean
  chooseLens: (lens: ScanInvestigationLens | "recent") => void
  goToCrumb: (crumb: Crumb) => void
  focusedScan: { label: string } | null
  scanMode: ScanMode
  chooseScanMode: (
    mode: ScanMode,
    intent?: Exclude<SunburstEntryIntent, "scan-complete">,
    focusContent?: boolean
  ) => void
  historyChangeCount: number
  sinceLastScan: BaselineComparison | null
  homePath: string | undefined
  currentHistoryEntries: ScanHistoryEntry[]
  recentChanges: DiskScanNode[]
  clearCurrentHistory: () => void
  reveal: (path: string) => Promise<void>
  showPathInMap: (path: string) => void
}

export function DiskWorkspaceHeader({
  activeDialog,
  view,
  scanning,
  currentScanPinned,
  currentScanLocked,
  pinMutationPending,
  deleting,
  cleanupProtectionsReady,
  cleanupLockMutationPending,
  togglePinnedLocation,
  scanSourcePath,
  scanLabel,
  toggleProtectedTree,
  crumbs,
  browseHistory,
  backToDrives,
  cleanupWorkspace,
  chooseLens,
  goToCrumb,
  focusedScan,
  scanMode,
  chooseScanMode,
  historyChangeCount,
  sinceLastScan,
  homePath,
  currentHistoryEntries,
  recentChanges,
  clearCurrentHistory,
  reveal,
  showPathInMap,
}: DiskWorkspaceHeaderProps) {
  return (
    <header
      className="dl-topbar relative z-20 flex h-[52px] shrink-0 items-center gap-2 px-3"
      data-tauri-drag-region
      inert={activeDialog ? true : undefined}
      aria-hidden={activeDialog ? "true" : undefined}
    >
      <DiskAppMenu
        scan={
          view === "scan" && !scanning
            ? {
                pinned: currentScanPinned,
                protected: currentScanLocked,
                pinPending: pinMutationPending,
                canProtect:
                  !deleting &&
                  cleanupProtectionsReady() &&
                  !cleanupLockMutationPending,
                onPin: () =>
                  void togglePinnedLocation(scanSourcePath, scanLabel),
                onProtect: () =>
                  void toggleProtectedTree(scanSourcePath, scanLabel),
              }
            : undefined
        }
      />

      {view === "scan" && crumbs.length > 0 && (
        <LocationNavigation
          locations={crumbs.map((crumb, index) => ({
            name: crumb.name,
            key: crumb.node?.path ?? String(index),
          }))}
          canBack={browseHistory.canMove("back")}
          canForward={browseHistory.canMove("forward")}
          onBack={() => browseHistory.move("back")}
          onForward={() => browseHistory.move("forward")}
          onHome={() => backToDrives(true)}
          onLocation={(index) => {
            if (cleanupWorkspace) chooseLens("all")
            goToCrumb(crumbs[index])
          }}
        />
      )}
      {view === "drives" ? <div className="flex-1" /> : null}
      {view === "scan" && (!scanning || !!focusedScan) ? (
        <div
          className="flex shrink-0 items-center gap-2 pl-2"
          inert={scanning ? true : undefined}
        >
          {!cleanupWorkspace ? (
            <ViewSwitch
              value={scanMode}
              onChange={(value, keyboard) =>
                chooseScanMode(value, keyboard ? "keyboard" : "pointer", false)
              }
            />
          ) : null}
          <ChangesButton count={historyChangeCount} sinceLast={sinceLastScan}>
            {(close) => (
              <ChangesPanel
                homePath={homePath}
                entries={currentHistoryEntries}
                recent={recentChanges}
                sinceLast={sinceLastScan}
                onClear={clearCurrentHistory}
                onReveal={(path) => void reveal(path)}
                onShow={(path) => {
                  close()
                  showPathInMap(path)
                }}
              />
            )}
          </ChangesButton>
          <span
            className="mx-0.5 h-5 w-px bg-[var(--dl-separator)]"
            aria-hidden
          />
          <WorkspaceSwitch
            value={cleanupWorkspace ? "cleanup" : "explore"}
            onChange={(value) =>
              chooseLens(value === "cleanup" ? "developer" : "all")
            }
          />
        </div>
      ) : null}
    </header>
  )
}
