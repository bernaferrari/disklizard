import { Button } from "@/components/dl/button"
import { Icon } from "@/components/dl/icon"
import { ScrollView } from "@/components/dl/scroll-view"
import type { DiskDriveInfo, DiskStorageDiagnostics as StorageDiagnosticsValue, DiskStorageLocation } from "./types"
import type { DiskCleanupLock, DiskPinnedLocation } from "./types"
import { DriveFallback } from "./DiskUtilityEmptyStates"
import { VolumeRow, type VolumeScanJob } from "./DiskUtilityDriveSurfaces"
import { PinnedLocationCard } from "./PinnedLocationCard"
import { StorageDiagnostics, shouldShowStorageDiagnostics } from "./StorageDiagnostics"
import { useLanguage } from "./runtime"

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
  onScanStorageLocation: (location: DiskStorageLocation) => void
  onOpenAccessSettings: () => void
  onRetryDiagnostics: () => void
  onOpenMap: (map: OpenMapSummary) => void
  onCloseMap: (map: OpenMapSummary) => void
  onScanPinnedLocation: (location: DiskPinnedLocation) => void
  onRemovePinnedLocation: (location: DiskPinnedLocation) => void
  cleanupLocks?: readonly DiskCleanupLock[]
  onUnlockCleanupLock?: (location: DiskCleanupLock) => void
}) {
  const language = useLanguage()
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollView className="min-h-0 flex-1">
        {!props.loading && props.drives.length > 0 ? (
          <div className="mx-auto w-full max-w-[760px] px-6 py-8 sm:py-10">
            <section aria-label={language.t("disk.drive.volumes")}>
              <div className="mb-5 flex items-center justify-between gap-4">
                <h3 className="text-20-medium tracking-[-0.02em] text-text-strong">{language.t("disk.drive.volumes")}</h3>
                <button
                  type="button"
                  className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-13-medium text-text-weak outline-none hover:bg-surface-raised-base hover:text-text-strong focus-visible:ring-2 focus-visible:ring-text-weak"
                  title={language.t("disk.drop.restingHint")}
                  onClick={props.onChooseFolder}
                >
                  <Icon name="folder" className="size-4" />
                  {language.t("disk.drive.scanFolder")}
                </button>
              </div>
              {props.drives.map((drive, index) => (
                <VolumeRow
                  key={drive.path}
                  drive={drive}
                  job={props.jobForDrive(drive)}
                  primary={index === 0}
                  canStart={props.runningScans < props.maxParallelScans}
                  onScan={() => props.onScanDrive(drive)}
                  onCancel={props.onCancelDrive}
                  onOpen={props.onOpenDrive}
                />
              ))}
            </section>

            <div className="mt-6">
              {props.openMaps.length > 0 ? (
                <section className="py-4" aria-labelledby="disk-open-maps-heading">
                  <div className="mb-3 flex flex-col gap-1">
                    <h3 id="disk-open-maps-heading" className="text-13-semibold text-text-strong">
                      {language.t("disk.drive.openMaps")}
                    </h3>
                    <span className="text-13-regular text-text-weaker">{language.t("disk.drive.openMapsHint")}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {props.openMaps.map((map) => (
                      <article
                        key={map.id}
                        className="flex min-h-16 min-w-0 items-center gap-3 rounded-xl bg-surface-raised-base px-3.5 py-2 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.12)]"
                      >
                        <span
                          className="grid size-9 shrink-0 place-items-center rounded-full bg-background-base text-text-weak"
                          aria-hidden="true"
                        >
                          <Icon name="folder" className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-13-semibold text-text-strong">{map.label}</span>
                          <span className="mt-0.5 block truncate text-12-regular text-text-weaker" title={map.sourcePath}>
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
                            {language.t("disk.common.open")}
                          </Button>
                          <Button
                            className="min-h-11 min-w-11"
                            variant="ghost"
                            size="small"
                            icon="close-small"
                            aria-label={language.t("disk.drive.closeMap", { name: map.label })}
                            title={language.t("disk.drive.closeMap", { name: map.label })}
                            onClick={() => props.onCloseMap(map)}
                          />
                        </span>
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {shouldShowStorageDiagnostics(props.diagnostics, props.diagnosticsError) ? (
                <>
                  <StorageDiagnostics
                    diagnostics={props.diagnostics}
                    error={props.diagnosticsError}
                    onScan={props.onScanStorageLocation}
                    onOpenAccessSettings={props.onOpenAccessSettings}
                    onRetry={props.onRetryDiagnostics}
                  />
                </>
              ) : null}

              {props.pinnedLocations.length > 0 ? (
                <section className="py-4">
                  <div className="mb-3 flex flex-col gap-1">
                    <h3 className="text-13-semibold text-text-strong">{language.t("disk.drive.saved")}</h3>
                    <span className="text-13-regular text-text-weaker">{language.t("disk.drive.deviceOnly")}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {props.pinnedLocations.map((location) => (
                      <PinnedLocationCard
                        key={location.path}
                        location={location}
                        onScan={() => props.onScanPinnedLocation(location)}
                        onRemove={() => props.onRemovePinnedLocation(location)}
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </div>
        ) : (
          <DriveFallback loading={props.loading} error={props.error} onChoose={props.onChooseFolder} />
        )}
      </ScrollView>
    </div>
  )
}
