import { Button } from "@opencode-ai/ui/button"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { For, Show } from "solid-js"
import type {
  DiskDriveInfo,
  DiskStorageDiagnostics as StorageDiagnosticsValue,
  DiskStorageLocation,
} from "./types"
import type { DiskCleanupLock, DiskPinnedLocation } from "./types"
import { DriveFallback } from "./DiskUtilityEmptyStates"
import { VolumeRow, type VolumeScanJob } from "./DiskUtilityDriveSurfaces"
import { PinnedLocationCard } from "./PinnedLocationCard"
import { StorageDiagnostics } from "./StorageDiagnostics"
import { useLanguage } from "./runtime"

/** The volume landing surface is presentation-only; scan/session ownership stays in the page controller. */
export function DriveOverview(props: {
  drives: readonly DiskDriveInfo[]
  loading: boolean
  error?: string
  freeBytes: number
  runningScans: number
  maxParallelScans: number
  diagnostics?: StorageDiagnosticsValue
  pinnedLocations: readonly DiskPinnedLocation[]
  jobForDrive: (drive: DiskDriveInfo) => VolumeScanJob | undefined
  onChooseFolder: () => void
  onScanDrive: (drive: DiskDriveInfo) => void
  onCancelDrive: (id: string) => void
  onOpenDrive: (job: VolumeScanJob) => void
  onScanStorageLocation: (location: DiskStorageLocation) => void
  onOpenAccessSettings: () => void
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
          <section aria-label={language.t("disk.drive.volumes")}>
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
            <StorageDiagnostics
              diagnostics={props.diagnostics}
              onScan={props.onScanStorageLocation}
              onOpenAccessSettings={props.onOpenAccessSettings}
            />

            <Show when={(props.cleanupLocks ?? []).length > 0}>
              <section class="border-t border-border-weaker-base py-5">
                <div class="mb-3 flex items-baseline justify-between gap-4">
                  <h3 class="text-13-semibold text-text-strong">{language.t("disk.drive.protected")}</h3>
                  <span class="text-13-regular text-text-weaker">{language.t("disk.drive.lockHint")}</span>
                </div>
                <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <For each={props.cleanupLocks}>
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
        </Show>
      </ScrollView>

      <footer class="dl-volume-footer flex h-12 shrink-0 items-center px-3 sm:px-4">
        <Button class="dl-touch-target" variant="ghost" size="small" icon="folder-add-left" onClick={props.onChooseFolder}>
          {language.t("disk.drive.scanFolder")}
        </Button>
      </footer>
    </div>
  )
}
