import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { For, Show } from "solid-js"
import type { DiskDriveInfo, DiskStorageDiagnostics as StorageDiagnosticsValue, DiskStorageLocation } from "./types"
import type { DiskCleanupLock, DiskPinnedLocation } from "./types"
import { DriveFallback } from "./DiskUtilityEmptyStates"
import { VolumeRow, type VolumeScanJob } from "./DiskUtilityDriveSurfaces"
import { PinnedLocationCard } from "./PinnedLocationCard"
import { StorageDiagnostics } from "./StorageDiagnostics"
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
          <div class="mx-auto w-full max-w-[880px]">
            <section aria-label={language.t("disk.drive.volumes")}>
              <h3 class="px-4 pb-1 pt-5 text-13-semibold text-text-strong sm:px-5">
                {language.t("disk.drive.volumes")}
              </h3>
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

            <div class="px-4 sm:px-5">
              <Show when={props.openMaps.length > 0}>
                <section class="border-t border-border-weaker-base py-5" aria-labelledby="disk-open-maps-heading">
                  <div class="mb-3 flex items-baseline justify-between gap-4">
                    <h3 id="disk-open-maps-heading" class="text-13-semibold text-text-strong">
                      {language.t("disk.drive.openMaps")}
                    </h3>
                    <span class="text-13-regular text-text-weaker">{language.t("disk.drive.openMapsHint")}</span>
                  </div>
                  <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
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

              <StorageDiagnostics
                diagnostics={props.diagnostics}
                error={props.diagnosticsError}
                onScan={props.onScanStorageLocation}
                onOpenAccessSettings={props.onOpenAccessSettings}
                onRetry={props.onRetryDiagnostics}
              />

              <Show when={(props.cleanupLocks ?? []).length > 0}>
                <section class="border-t border-border-weaker-base py-5">
                  <div class="mb-3 flex items-baseline justify-between gap-4">
                    <h3 class="text-13-semibold text-text-strong">{language.t("disk.drive.protected")}</h3>
                    <span class="text-13-regular text-text-weaker">{language.t("disk.drive.lockHint")}</span>
                  </div>
                  <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <For each={props.cleanupLocks ?? []}>
                      {(location) => (
                        <PinnedLocationCard
                          location={location}
                          onScan={() => props.onScanPinnedLocation(location)}
                          onRemove={() => props.onUnlockCleanupLock?.(location)}
                          removeLabel={language.t("disk.drive.allowCleanup", { name: location.label })}
                        />
                      )}
                    </For>
                  </div>
                </section>
              </Show>

              <Show when={props.pinnedLocations.length > 0}>
                <section class="border-t border-border-weaker-base py-5">
                  <div class="mb-3 flex items-baseline justify-between gap-4">
                    <h3 class="text-13-semibold text-text-strong">{language.t("disk.drive.saved")}</h3>
                    <span class="text-13-regular text-text-weaker">{language.t("disk.drive.deviceOnly")}</span>
                  </div>
                  <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
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

      <footer class="dl-volume-footer flex h-12 shrink-0 items-center px-3 sm:px-4">
        <Button
          class="dl-touch-target"
          variant="secondary"
          size="small"
          icon="folder-add-left"
          onClick={props.onChooseFolder}
        >
          {language.t("disk.drive.scanFolder")}
        </Button>
        <span class="ml-3 hidden text-12-regular text-text-weaker sm:inline">
          {language.t("disk.drop.restingHint")}
        </span>
      </footer>
    </div>
  )
}
