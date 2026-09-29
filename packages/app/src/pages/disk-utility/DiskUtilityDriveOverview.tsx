import { Button } from "@/components/dl/button"
import { FolderPlus, Info, ShieldAlert } from "lucide-react"
import { Icon } from "@/components/dl/icon"
import { ScrollView } from "@/components/dl/scroll-view"
import type {
  DiskDriveInfo,
  DiskStorageDiagnostics as StorageDiagnosticsValue,
  DiskStorageLocation,
} from "./types"
import type { DiskCleanupLock, DiskPinnedLocation } from "./types"
import { DriveFallback } from "./DiskUtilityEmptyStates"
import { VolumeRow, type VolumeScanJob } from "./DiskUtilityDriveSurfaces"
import { PinnedLocationCard } from "./PinnedLocationCard"
import { StorageDiagnostics, storageAccessGuidance } from "./StorageDiagnostics"
import { useLanguage, usePlatform } from "./runtime"
import { diskPathEquals } from "./storage"

export type OpenMapSummary = {
  id: string
  label: string
  sourcePath: string
}

/** The volume landing surface is presentation-only; scan/session ownership stays in the page controller. */
export function DriveOverview(props: {
  drives: readonly DiskDriveInfo[]
  loading: boolean
  error?: string
  runningScans: number
  maxParallelScans: number
  diagnostics?: StorageDiagnosticsValue
  diagnosticsError?: boolean
  openMaps: readonly OpenMapSummary[]
  pinnedLocations: readonly DiskPinnedLocation[]
  jobForDrive: (drive: DiskDriveInfo) => VolumeScanJob | undefined
  onChooseFolder: () => void
  onScanDrive: (drive: DiskDriveInfo) => void
  onCancelDrive: (id: string) => void
  onOpenDrive: (job: VolumeScanJob) => void
  canViewLocation: (path: string) => boolean
  onActivateStorageLocation: (location: DiskStorageLocation) => void
  onOpenAccessSettings: () => void
  onRetryDiagnostics: () => void
  onOpenMap: (map: OpenMapSummary) => void
  onCloseMap: (map: OpenMapSummary) => void
  onActivatePinnedLocation: (location: DiskPinnedLocation) => void
  onRemovePinnedLocation: (location: DiskPinnedLocation) => void
  cleanupLocks?: readonly DiskCleanupLock[]
  onUnlockCleanupLock?: (location: DiskCleanupLock) => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const accessGuidance = props.diagnostics
    ? storageAccessGuidance(props.diagnostics)
    : undefined
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollView className="min-h-0 flex-1">
        {!props.loading && props.drives.length > 0 ? (
          <div className="mx-auto w-full max-w-[760px] px-6 pt-12 pb-10">
            <header className="slide-in-from-bottom-1.5 mb-8 animate-in duration-[260ms] fade-in">
              <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.03em] text-text-strong">
                {language.t("disk.ui.home.title")}
              </h1>
              <p className="mt-1.5 text-[14px] text-text-weak">
                {language.t("disk.ui.home.subtitle")}
              </p>
            </header>
            <section aria-label={language.t("disk.drive.volumes")}>
              <h3 className="mb-3 px-1 text-[12px] font-semibold tracking-[0.06em] text-text-weaker uppercase">
                {language.t("disk.ui.home.disks")}
              </h3>
              <div className="flex flex-col gap-3">
                {props.drives.map((drive, index) => {
                  const retainedMap = props.openMaps.find((map) =>
                    diskPathEquals(map.sourcePath, drive.path, platform.os)
                  )
                  return (
                    <div
                      key={drive.path}
                      className="animate-in duration-[240ms] fill-mode-both fade-in slide-in-from-bottom-2"
                      style={{ animationDelay: `${Math.min(90, index * 30)}ms` }}
                    >
                      <VolumeRow
                        drive={drive}
                        job={props.jobForDrive(drive)}
                        primary={index === 0}
                        canStart={props.runningScans < props.maxParallelScans}
                        onScan={() => props.onScanDrive(drive)}
                        onCancel={props.onCancelDrive}
                        onOpen={props.onOpenDrive}
                        hasRetainedMap={!!retainedMap}
                        onOpenRetainedMap={() => {
                          if (retainedMap) props.onOpenMap(retainedMap)
                        }}
                      />
                    </div>
                  )
                })}
                <button
                  type="button"
                  className="group flex items-center gap-4 rounded-2xl border-[1.5px] border-dashed border-[var(--dl-well-strong)] px-5 py-4 text-left transition-colors outline-none hover:border-[var(--dl-accent)] hover:bg-[var(--dl-well)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
                  title={language.t("disk.drop.restingHint")}
                  onClick={props.onChooseFolder}
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--dl-well)] text-text-weak transition-colors group-hover:text-[var(--dl-accent)]">
                    <FolderPlus
                      className="size-5"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium text-text-strong">
                      {language.t("disk.ui.home.folder")}
                    </span>
                    <span className="block text-[12.5px] text-text-weak">
                      {language.t("disk.ui.home.dropHint")}
                    </span>
                  </span>
                </button>
              </div>
            </section>
            {accessGuidance?.attention ? (
              <div className="mt-6 flex items-center gap-4 rounded-2xl bg-[color-mix(in_oklch,var(--dl-warning)_9%,transparent)] px-5 py-4 shadow-[inset_0_0_0_0.5px_color-mix(in_oklch,var(--dl-warning)_35%,transparent)]">
                <ShieldAlert
                  className="size-5 shrink-0 text-[var(--dl-warning)]"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-text-strong">
                    {accessGuidance.title}
                  </p>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-text-weak">
                    {accessGuidance.body}
                  </p>
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 shrink-0 items-center rounded-full bg-[var(--dl-well-strong)] px-4 text-[12.5px] font-semibold text-text-strong hover:brightness-125"
                  onClick={props.onOpenAccessSettings}
                >
                  {language.t("disk.explore.openPrivacy")}
                </button>
              </div>
            ) : null}
            {accessGuidance && !accessGuidance.attention ? (
              <div role="note" className="mt-5 flex items-start gap-3 rounded-xl bg-[var(--dl-well)] px-4 py-3.5 text-text-weak">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-text-strong">
                    {accessGuidance.title}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-relaxed">
                    {accessGuidance.body}
                  </p>
                </div>
              </div>
            ) : null}
            {props.diagnostics?.locations.length ? (
              <section
                className="mt-8"
                aria-label={language.t("disk.storage.connected")}
              >
                <h3 className="mb-3 px-1 text-[12px] font-semibold tracking-[0.06em] text-text-weaker uppercase">
                  {language.t("disk.storage.connected")}
                </h3>
                <StorageDiagnostics
                  diagnostics={props.diagnostics}
                  onActivate={props.onActivateStorageLocation}
                  canView={(location) => props.canViewLocation(location.path)}
                />
              </section>
            ) : null}

            <div className="mt-6">
              {props.openMaps.length > 0 ? (
                <section
                  className="py-4"
                  aria-labelledby="disk-open-maps-heading"
                >
                  <div className="mb-3 flex flex-col gap-1">
                    <h3
                      id="disk-open-maps-heading"
                      className="text-[12px] font-semibold tracking-[0.06em] text-text-weaker uppercase"
                    >
                      {language.t("disk.drive.openMaps")}
                    </h3>
                    <span className="text-13-regular text-text-weaker">
                      {language.t("disk.drive.openMapsHint")}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {props.openMaps.map((map) => (
                      <article
                        key={map.id}
                        className="flex min-h-14 min-w-0 items-center gap-3 rounded-xl bg-[var(--dl-well)] px-3.5 py-2"
                      >
                        <span
                          className="grid size-9 shrink-0 place-items-center rounded-full bg-background-base text-text-weak"
                          aria-hidden="true"
                        >
                          <Icon name="folder" className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-13-semibold block truncate text-text-strong">
                            {map.label}
                          </span>
                          <span
                            className="text-12-regular mt-0.5 block truncate text-text-weaker"
                            title={map.sourcePath}
                          >
                            {map.sourcePath}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <Button
                            className="min-h-11 min-w-11"
                            variant="secondary"
                            size="small"
                            onClick={() => props.onOpenMap(map)}
                          >
                            {language.t("disk.drive.action.view")}
                          </Button>
                          <Button
                            className="min-h-11 min-w-11"
                            variant="ghost"
                            size="small"
                            icon="close-small"
                            aria-label={language.t("disk.drive.closeMap", {
                              name: map.label,
                            })}
                            title={language.t("disk.drive.closeMap", {
                              name: map.label,
                            })}
                            onClick={() => props.onCloseMap(map)}
                          />
                        </span>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {props.pinnedLocations.length > 0 ? (
                <section className="py-4">
                  <div className="mb-3 flex flex-col gap-1">
                    <h3 className="text-[12px] font-semibold tracking-[0.06em] text-text-weaker uppercase">
                      {language.t("disk.drive.saved")}
                    </h3>
                    <span className="text-13-regular text-text-weaker">
                      {language.t("disk.drive.deviceOnly")}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {props.pinnedLocations.map((location) => (
                      <PinnedLocationCard
                        key={location.path}
                        location={location}
                        canView={props.canViewLocation(location.path)}
                        onActivate={() =>
                          props.onActivatePinnedLocation(location)
                        }
                        onRemove={() => props.onRemovePinnedLocation(location)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        ) : (
          <DriveFallback
            loading={props.loading}
            error={props.error}
            onChoose={props.onChooseFolder}
          />
        )}
      </ScrollView>
    </div>
  )
}
