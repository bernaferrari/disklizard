import { Button } from "@opencode-ai/ui/button"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { For, Show } from "solid-js"
import type {
  DiskDriveInfo,
  DiskStorageDiagnostics as StorageDiagnosticsValue,
  DiskStorageLocation,
} from "./types"
import type { DiskPinnedLocation } from "./types"
import { DriveFallback } from "./DiskUtilityEmptyStates"
import { DriveRow, type VolumeScanJob } from "./DiskUtilityDriveSurfaces"
import { PinnedLocationCard } from "./PinnedLocationCard"
import { StorageDiagnostics } from "./StorageDiagnostics"
import { formatBytes } from "./format"

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
}) {
  return (
    <ScrollView class="h-full">
      <div class="mx-auto flex min-h-full w-full max-w-7xl flex-col px-5 py-7 sm:px-7 sm:py-8 lg:px-10 lg:py-10">
        <Show
          when={!props.loading && props.drives.length > 0}
          fallback={<DriveFallback loading={props.loading} error={props.error} onChoose={props.onChooseFolder} />}
        >
          <section class="pb-6 sm:pb-8">
            <div class="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p class="text-12-semibold uppercase tracking-[0.16em] text-text-weaker">Storage</p>
                <h2 class="mt-2 text-[clamp(30px,3.2vw,44px)] font-medium leading-none tracking-[-0.05em] text-text-strong [text-wrap:balance]">
                  Find space you can act on.
                </h2>
                <p class="mt-3 max-w-[52ch] text-12-regular leading-relaxed text-text-weak">
                  Scan a volume to see what is largest, understand what it is, and decide what to review.
                </p>
                <Show when={props.runningScans > 0}>
                  <span class="mt-5 inline-flex items-center gap-2 text-12-semibold text-text-weak">
                    <span class="dl-scan-beacon size-1.5 rounded-full bg-[oklch(0.74_0.13_176)]" />
                    {props.runningScans} {props.runningScans === 1 ? "scan" : "scans"} running
                  </span>
                </Show>
              </div>
              <div class="flex items-center gap-5">
                <p class="text-right">
                  <span class="block text-18-medium tabular-nums tracking-[-0.025em] text-text-strong">
                    {formatBytes(props.freeBytes)}
                  </span>
                  <span class="mt-1 block text-12-semibold uppercase tracking-[0.13em] text-text-weaker">available</span>
                </p>
                <Button
                  class="dl-touch-target"
                  variant="primary"
                  size="large"
                  icon="folder-add-left"
                  onClick={props.onChooseFolder}
                >
                  Scan a folder
                </Button>
              </div>
            </div>
          </section>

          <section class="overflow-hidden rounded-[22px] border border-border-weaker-base bg-background-base shadow-[0_1px_2px_rgb(0_0_0/0.04),0_14px_34px_-30px_rgb(0_0_0/0.28)]">
            <For each={props.drives}>
              {(drive) => (
                <DriveRow
                  drive={drive}
                  job={props.jobForDrive(drive)}
                  canStart={props.runningScans < props.maxParallelScans}
                  onScan={() => props.onScanDrive(drive)}
                  onCancel={props.onCancelDrive}
                  onOpen={props.onOpenDrive}
                />
              )}
            </For>
          </section>

          <StorageDiagnostics
            diagnostics={props.diagnostics}
            onScan={props.onScanStorageLocation}
            onOpenAccessSettings={props.onOpenAccessSettings}
          />

          <Show when={props.pinnedLocations.length > 0}>
            <section class="py-7">
              <div class="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p class="text-12-semibold uppercase tracking-[0.14em] text-text-weaker">Saved locations</p>
                  <h3 class="mt-1 text-18-medium tracking-[-0.02em] text-text-strong">Scan them again in one click.</h3>
                </div>
                <span class="text-12-regular text-text-weaker">Saved only on this device</span>
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
        </Show>
      </div>
    </ScrollView>
  )
}
