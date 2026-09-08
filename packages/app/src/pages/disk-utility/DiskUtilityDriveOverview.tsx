import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { For, Show } from "solid-js"
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
    <div class="flex h-full min-h-0 flex-col">
      <ScrollView class="min-h-0 flex-1">
        <Show
          when={!props.loading && props.drives.length > 0}
          fallback={<DriveFallback loading={props.loading} error={props.error} onChoose={props.onChooseFolder} />}
        >
          <div class="mx-auto w-full max-w-[760px] px-6 py-8 sm:py-10">
            <section aria-label={language.t("disk.drive.volumes")}>
              <div class="mb-5 flex items-center justify-between gap-4">
                <h3 class="text-20-medium tracking-[-0.02em] text-text-strong">{language.t("disk.drive.volumes")}</h3>
                <button
                  type="button"
                  class="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-13-medium text-text-weak outline-none hover:bg-surface-raised-base hover:text-text-strong focus-visible:ring-2 focus-visible:ring-text-weak"
                  title={language.t("disk.drop.restingHint")}
                  onClick={props.onChooseFolder}
                >
                  <Icon name="folder" class="size-4" />
                  {language.t("disk.drive.scanFolder")}
                </button>
              </div>
              <For each={props.drives}>
                {(drive, index) => (
                  <VolumeRow
                    drive={drive}
                    job={props.jobForDrive(drive)}
                    primary={index() === 0}
                    canStart={props.runningScans < props.maxParallelScans}
                    onScan={() => props.onScanDrive(drive)}
                    onCancel={props.onCancelDrive}
                    onOpen={props.onOpenDrive}
                  />
                )}
              </For>
            </section>

            <div class="mt-6">
              <Show when={props.openMaps.length > 0}>
                <section class="py-4" aria-labelledby="disk-open-maps-heading">
                  <div class="mb-3 flex flex-col gap-1">
                    <h3 id="disk-open-maps-heading" class="text-13-semibold text-text-strong">
                      {language.t("disk.drive.openMaps")}
                    </h3>
                    <span class="text-13-regular text-text-weaker">{language.t("disk.drive.openMapsHint")}</span>
                  </div>
                  <div class="grid grid-cols-1 gap-2">
                    <For each={props.openMaps}>
                      {(map) => (
                        <article class="flex min-h-16 min-w-0 items-center gap-3 rounded-xl bg-surface-raised-base px-3.5 py-2 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.12)]">
                          <span
                            class="grid size-9 shrink-0 place-items-center rounded-full bg-background-base text-text-weak"
                            aria-hidden="true"
                          >
                            <Icon name="folder" class="size-4" />
                          </span>
                          <span class="min-w-0 flex-1">
                            <span class="block truncate text-13-semibold text-text-strong">{map.label}</span>
                            <span class="mt-0.5 block truncate text-12-regular text-text-weaker" title={map.sourcePath}>
                              {map.sourcePath}
                            </span>
                          </span>
                          <span class="flex shrink-0 items-center gap-1">
                            <Button
                              class="dl-touch-target"
                              variant="secondary"
                              size="small"
                              onClick={() => props.onOpenMap(map)}
                            >
                              {language.t("disk.common.open")}
                            </Button>
                            <Button
                              class="dl-touch-target"
                              variant="ghost"
                              size="small"
                              icon="close-small"
                              aria-label={language.t("disk.drive.closeMap", { name: map.label })}
                              title={language.t("disk.drive.closeMap", { name: map.label })}
                              onClick={() => props.onCloseMap(map)}
                            />
                          </span>
                        </article>
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={shouldShowStorageDiagnostics(props.diagnostics, props.diagnosticsError)}>
                <details class="group py-2">
                  <summary class="cursor-pointer text-13-medium text-text-weak">
                    {language.t("disk.storage.connected")}
                  </summary>
                  <StorageDiagnostics
                    diagnostics={props.diagnostics}
                    error={props.diagnosticsError}
                    onScan={props.onScanStorageLocation}
                    onOpenAccessSettings={props.onOpenAccessSettings}
                    onRetry={props.onRetryDiagnostics}
                  />
                </details>
              </Show>

              <Show when={props.pinnedLocations.length > 0}>
                <section class="py-4">
                  <div class="mb-3 flex flex-col gap-1">
                    <h3 class="text-13-semibold text-text-strong">{language.t("disk.drive.saved")}</h3>
                    <span class="text-13-regular text-text-weaker">{language.t("disk.drive.deviceOnly")}</span>
                  </div>
                  <div class="grid grid-cols-1 gap-2">
                    <For each={props.pinnedLocations}>
                      {(location) => (
                        <PinnedLocationCard
                          location={location}
                          onScan={() => props.onScanPinnedLocation(location)}
                          onRemove={() => props.onRemovePinnedLocation(location)}
                        />
                      )}
                    </For>
                  </div>
                </section>
              </Show>
            </div>
          </div>
        </Show>
      </ScrollView>
    </div>
  )
}
