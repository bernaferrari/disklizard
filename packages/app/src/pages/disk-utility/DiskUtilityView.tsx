import { Button } from "@/components/dl/button"
import { Icon } from "@/components/dl/icon"
import { Placeholder } from "./DiskUtilityEmptyStates"
import { PopIn, Pulse } from "./motion-ui"
import { ScanFormation } from "./ScanFormation"
import { diskPathEquals } from "./storage"
import { DISK_UTILITY_STYLES } from "./styles"
import type {
  RefObject,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
} from "react"
import type { usePlatform, useLanguage } from "./runtime"
import type { DiskScanNode, DiskDriveInfo, DiskUtilityAPI } from "./types"
import type { ScanTab } from "./scan-tabs"
import {
  DiskWorkspaceHeader,
  type DiskWorkspaceHeaderProps,
} from "./DiskWorkspaceHeader"
import {
  DiskProtectionNotice,
  type DiskProtectionNoticeProps,
} from "./DiskProtectionNotice"
import {
  DiskWorkspaceOverview,
  type DiskWorkspaceOverviewProps,
} from "./DiskWorkspaceOverview"
import {
  DiskCleanupWorkspace,
  type DiskCleanupWorkspaceProps,
} from "./DiskCleanupWorkspace"
import { DiskLandscape, type DiskLandscapeProps } from "./DiskLandscape"
import { DiskIndexPanel, type DiskIndexPanelProps } from "./DiskIndexPanel"
import {
  DiskWorkspaceDialogs,
  type DiskWorkspaceDialogsProps,
} from "./DiskWorkspaceDialogs"
export type DiskUtilityViewProps = {
  platform: ReturnType<typeof usePlatform>
  scanCompletionSource: "scan" | "snapshot" | "delta" | undefined
  onDragEnter: (event: ReactDragEvent) => void
  onDragOver: (event: ReactDragEvent) => void
  onDragLeave: (event: ReactDragEvent) => void
  onDrop: (event: ReactDragEvent) => Promise<void>
  collectionDragPreviewRef: RefObject<HTMLDivElement | null>
  dropActive: boolean
  language: ReturnType<typeof useLanguage>
  activeDialog: string | null
  view: "drives" | "scan"
  scanning: boolean
  scanSourcePath: string
  scanLabel: string
  cleanupWorkspace: boolean
  focusedScan: { label: string } | null
  isDesktop: boolean
  disk: DiskUtilityAPI | undefined
  tabs: ScanTab[]
  switchToTab: (id: string, target?: DiskScanNode) => void
  closeTab: (id: string) => void
  announcedSelection: string
  openContextMenu: (event: ReactMouseEvent<HTMLElement>) => void
  scanFiles: number
  scanDrive: DiskDriveInfo | undefined
  scanProgressRegionRef: RefObject<HTMLDivElement | undefined>
  scanDiscoveries: readonly Pick<
    DiskScanNode,
    "name" | "size" | "path" | "isDir" | "modifiedAt"
  >[]
  scanBytes: number
  scanTail: string
  scanTotal: number
  scanPct: number
  cancelScan: ({ confirmed }?: { confirmed?: boolean }) => void
  showNativeAppMenu: boolean
  exportDiagnostics: () => Promise<void>
  header: DiskWorkspaceHeaderProps
  protectionNotice: DiskProtectionNoticeProps
  overview: DiskWorkspaceOverviewProps
  cleanup: DiskCleanupWorkspaceProps
  landscape: DiskLandscapeProps
  indexPanel: DiskIndexPanelProps
  dialogs: DiskWorkspaceDialogsProps
}
/** Composes independently typed screen regions from one render snapshot. */
export function DiskUtilityView({ model }: { model: DiskUtilityViewProps }) {
  const {
    platform,
    scanCompletionSource,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    collectionDragPreviewRef,
    dropActive,
    language,
    activeDialog,
    view,
    scanning,
    scanSourcePath,
    scanLabel,
    cleanupWorkspace,
    focusedScan,
    isDesktop,
    disk,
    tabs,
    switchToTab,
    closeTab,
    announcedSelection,
    openContextMenu,
    scanFiles,
    scanDrive,
    scanProgressRegionRef,
    scanDiscoveries,
    scanBytes,
    scanTail,
    scanTotal,
    scanPct,
    cancelScan,
    showNativeAppMenu,
    exportDiagnostics,
    header,
    protectionNotice,
    overview,
    cleanup,
    landscape,
    indexPanel,
    dialogs,
  } = model
  return (
    <div
      className="dl-shell relative isolate flex size-full min-h-0 flex-col overflow-hidden bg-background-base text-text-base tabular-nums antialiased"
      data-os={platform.os}
      data-scan-source={scanCompletionSource}
      data-fullscreen={platform.windowFullscreen ? "true" : undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(event) => void onDrop(event)}
    >
      <style>{DISK_UTILITY_STYLES}</style>
      <div
        ref={(el) => {
          collectionDragPreviewRef.current = el
        }}
        className="pointer-events-none fixed -top-[9999px] -left-[9999px] z-[80] flex w-[76px] flex-col items-center font-sans text-xs leading-[1.2] font-semibold tabular-nums"
        aria-hidden="true"
      />

      {dropActive ? (
        <PopIn
          className="pointer-events-none absolute inset-3 z-60 grid place-items-center rounded-[26px] bg-background-base/88 shadow-[inset_0_0_0_2px_oklch(0.72_0.13_176/0.7),0_24px_80px_rgb(0_0_0/0.24)] backdrop-blur-xl"
          role="status"
          aria-live="polite"
          animate={{ opacity: 1, scale: 1, y: 0 }}
        >
          <div className="text-center">
            <Pulse className="mx-auto grid size-16 place-items-center rounded-full bg-[oklch(0.72_0.12_176/0.14)] text-[color-mix(in_oklch,var(--dl-accent-strong)_54%,var(--text-strong))]">
              <Icon name="folder-add-left" className="size-6" />
            </Pulse>
            <p className="text-20-medium mt-5 tracking-[-0.03em] text-text-strong">
              {language.t("disk.drop.title")}
            </p>
            <p className="text-12-regular mt-2 text-text-weak">
              {language.t("disk.drop.body")}
            </p>
          </div>
        </PopIn>
      ) : null}

      <DiskWorkspaceHeader {...header} />

      <DiskProtectionNotice {...protectionNotice} />

      <main
        className="relative min-h-0 flex-1 overflow-hidden"
        inert={activeDialog ? true : undefined}
        aria-hidden={activeDialog ? "true" : undefined}
      >
        {isDesktop ? (
          disk ? (
            <>
              {view === "drives" ? (
                <DiskWorkspaceOverview {...overview} />
              ) : null}

              {view === "scan" ? (
                !scanning || !!focusedScan ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <span
                      className="sr-only"
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {announcedSelection}
                    </span>
                    {tabs.length > 0 ? (
                      <div
                        className="flex shrink-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto border-b border-[var(--dl-separator)] px-3 py-1.5 [&::-webkit-scrollbar]:hidden"
                        role="group"
                        aria-label={language.t("disk.drive.openMaps")}
                      >
                        <span
                          className="flex h-7 max-w-[220px] min-w-0 shrink-0 items-center gap-2 rounded-md bg-[var(--dl-well-strong)] px-2.5 text-[12px] font-medium text-text-strong"
                          aria-current="page"
                          title={scanSourcePath}
                        >
                          <span className="truncate">{scanLabel}</span>
                        </span>
                        {tabs.map((tab) => (
                          <span
                            key={tab.id}
                            className="group flex h-7 max-w-[220px] min-w-0 shrink-0 items-center rounded-md text-text-weak hover:bg-[var(--dl-well)] hover:text-text-strong"
                          >
                            <button
                              type="button"
                              data-disk-tab={tab.id}
                              className="h-full min-w-0 flex-1 truncate rounded-md pr-1 pl-2.5 text-left text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
                              title={tab.sourcePath}
                              onClick={() => switchToTab(tab.id)}
                              onAuxClick={(event) => {
                                if (event.button === 1) {
                                  event.preventDefault()
                                  closeTab(tab.id)
                                }
                              }}
                            >
                              {tab.label}
                            </button>
                            <button
                              type="button"
                              className="mr-1 grid size-5 shrink-0 place-items-center rounded text-text-weaker opacity-0 outline-none group-hover:opacity-100 hover:bg-[var(--dl-well-strong)] hover:text-text-strong focus-visible:opacity-100"
                              aria-label={language.t("disk.pinned.remove", {
                                name: tab.label,
                              })}
                              onClick={() => closeTab(tab.id)}
                            >
                              <Icon name="close-small" className="size-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {cleanupWorkspace ? (
                      <DiskCleanupWorkspace {...cleanup} />
                    ) : (
                      <div
                        onContextMenu={openContextMenu}
                        className="relative flex min-h-0 w-full flex-1 overflow-hidden max-[840px]:grid max-[840px]:grid-rows-[minmax(260px,45%)_minmax(0,1fr)]"
                      >
                        <DiskLandscape {...landscape} />

                        <DiskIndexPanel {...indexPanel} />
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    ref={(el) => {
                      scanProgressRegionRef.current = el ?? undefined
                    }}
                    className="relative flex h-full items-center justify-center overflow-auto px-5 py-8 outline-none focus-visible:ring-2 focus-visible:ring-text-weak focus-visible:ring-inset sm:px-8 sm:py-10"
                    tabIndex={0}
                    role="region"
                    data-scan-files={scanFiles}
                    aria-label={language.t("disk.scan.label", {
                      label: scanLabel,
                    })}
                  >
                    <ScanFormation
                      discoveries={scanDiscoveries}
                      totalBytes={
                        scanDrive &&
                        diskPathEquals(
                          scanSourcePath,
                          scanDrive.path,
                          platform.os
                        )
                          ? scanDrive.used
                          : 0
                      }
                      label={scanLabel}
                      files={scanFiles}
                      bytes={scanBytes}
                      currentPath={scanTail}
                      pct={scanTotal > 0 ? scanPct : null}
                      onCancel={() => cancelScan({ confirmed: true })}
                    />
                  </div>
                )
              ) : null}
            </>
          ) : (
            <Placeholder
              icon="folder"
              title={language.t("disk.top.scannerDisconnected")}
              body={language.t("disk.top.disconnectedBody")}
              actions={
                <>
                  {showNativeAppMenu && platform.restart ? (
                    <Button
                      className="min-h-8 min-w-8"
                      size="small"
                      variant="primary"
                      onClick={() => void platform.restart?.()}
                    >
                      {language.t("disk.top.restart")}
                    </Button>
                  ) : null}
                  {showNativeAppMenu && platform.exportDiagnostics ? (
                    <Button
                      className="min-h-8 min-w-8"
                      size="small"
                      variant="secondary"
                      onClick={() => void exportDiagnostics()}
                    >
                      {language.t("disk.app.exportDiagnostics")}
                    </Button>
                  ) : null}
                </>
              }
            />
          )
        ) : (
          <Placeholder
            icon="folder"
            title={language.t("disk.top.openDesktop")}
            body={language.t("disk.top.desktopBody")}
          />
        )}
      </main>

      <DiskWorkspaceDialogs {...dialogs} />
    </div>
  )
}
