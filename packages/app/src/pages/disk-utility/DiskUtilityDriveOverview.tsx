import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
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
          <div class="mx-auto w-full max-w-[880px]">
          <section aria-label={language.t("disk.drive.volumes")}>
            <h3 class="px-4 pt-5 pb-1 text-13-semibold text-text-strong sm:px-5">
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
            <StorageDiagnostics
              diagnostics={props.diagnostics}
              onScan={props.onScanStorageLocation}
              onOpenAccessSettings={props.onOpenAccessSettings}
            />

            <section class="border-t border-border-weaker-base py-5">
              <div class="mb-3 flex items-baseline justify-between gap-4">
                <h3 class="text-13-semibold text-text-strong">{language.t("disk.drive.protected")}</h3>
                <Show when={(props.cleanupLocks ?? []).length > 0}>
                  <span class="text-13-regular text-text-weaker">{language.t("disk.drive.lockHint")}</span>
                </Show>
              </div>
              <Show
                when={(props.cleanupLocks ?? []).length > 0}
                fallback={
                  <p class="py-2 text-13-regular leading-relaxed text-text-weaker">
                    {language.t("disk.drive.lockHint")}
                  </p>
                }
              >
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
              </Show>
            </section>

            <section class="border-t border-border-weaker-base py-5">
              <div class="mb-3 flex items-baseline justify-between gap-4">
                <h3 class="text-13-semibold text-text-strong">{language.t("disk.drive.saved")}</h3>
                <Show when={props.pinnedLocations.length > 0}>
                  <span class="text-13-regular text-text-weaker">{language.t("disk.drive.deviceOnly")}</span>
                </Show>
              </div>
              <Show
                when={props.pinnedLocations.length > 0}
                fallback={
                  <p class="py-2 text-13-regular leading-relaxed text-text-weaker">
                    {language.t("disk.drive.savedEmpty")}
                  </p>
                }
              >
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
              </Show>
            </section>
          </div>

          <Show
            when={
              props.drives.length <= 1 &&
              props.pinnedLocations.length === 0 &&
              (props.cleanupLocks ?? []).length === 0
            }
          >
            <div class="flex flex-col items-center px-8 py-10 text-center">
              <span class="grid size-11 place-items-center rounded-full bg-surface-raised-base text-text-weak">
                <Icon name="folder" class="size-4" />
              </span>
              <h3 class="mt-4 text-14-medium tracking-[-0.015em] text-text-strong">
                {language.t("disk.drive.firstRun.title")}
              </h3>
              <p class="mt-1 max-w-[30ch] text-13-regular leading-relaxed text-text-weak">
                {language.t("disk.drive.firstRun.body")}
              </p>
              <Button class="dl-touch-target mt-4" variant="secondary" size="small" onClick={props.onChooseFolder}>
                {language.t("disk.drive.scanFolder")}
              </Button>
            </div>
          </Show>
          </div>
        </Show>
      </ScrollView>

      <footer class="dl-volume-footer flex h-12 shrink-0 items-center px-3 sm:px-4">
        <Button class="dl-touch-target" variant="ghost" size="small" icon="folder-add-left" onClick={props.onChooseFolder}>
          {language.t("disk.drive.scanFolder")}
        </Button>
        <span class="ml-3 hidden text-12-regular text-text-weaker sm:inline">
          {language.t("disk.drop.restingHint")}
        </span>
      </footer>
    </div>
  )
}
