import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { createEffect, onCleanup, Show } from "solid-js"
import type { DiskDriveInfo, DiskScanNode } from "@/context/platform"
import { formatBytes, formatCount, shortBytes } from "./format"
import { animateCount } from "./motion"
import { formatScanDuration, formatScanRate, scanPerformance, type ScanPerformance } from "./scan-metrics"
import { usageStroke } from "./ui-tokens"
import { ApfsSnapshotEvidenceList } from "./ApfsSnapshotEvidence"

export type VolumeScanJob = {
  id: string
  status: "scanning" | "complete" | "failed"
  label: string
  sourcePath: string
  drive: DiskDriveInfo
  files: number
  bytes: number
  pct: number
  currentPath: string
  startedAt: number
  completedAt?: number
  /** Only a fresh traversal earns a throughput measurement. */
  source?: "scan" | "snapshot" | "delta"
  tree?: DiskScanNode
  error?: string
}

/** A volume remains actionable while other volumes scan in parallel. */
export function DriveRow(props: {
  drive: DiskDriveInfo
  job?: VolumeScanJob
  canStart: boolean
  onScan: () => void
  onCancel: (id: string) => void
  onOpen: (job: VolumeScanJob) => void
}) {
  const hasTotal = () => props.drive.total > 0
  const usedPct = () => (hasTotal() ? Math.min(100, Math.max(0, (props.drive.used / props.drive.total) * 100)) : 0)
  const barColor = () => (hasTotal() ? usageStroke(props.drive.used, props.drive.total) : "oklch(0.65 0.13 270)")
  const scanning = () => props.job?.status === "scanning"
  const complete = () => props.job?.status === "complete"
  const failed = () => props.job?.status === "failed"
  const completedPerformance = () => {
    const job = props.job
    if (!job?.completedAt || job.source !== "scan") return
    return scanPerformance(job.files, job.bytes, job.startedAt, job.completedAt)
  }
  return (
    <div
      id={props.job ? `disklizard-volume-${props.job.id}` : undefined}
      class="dl-hover-drive group grid min-h-32 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border-weaker-base px-5 py-5 text-left transition-colors duration-150 last:border-b-0 sm:grid-cols-[minmax(220px,1fr)_minmax(210px,0.7fr)_96px] sm:px-7"
    >
      <span class="flex min-w-0 items-center gap-3">
        <span class="dl-hover-drive-icon grid size-10 shrink-0 place-items-center rounded-full border border-border-weaker-base bg-surface-raised-strong/45 text-text-weak transition-colors duration-150">
          <Icon name="server" class="size-4" />
        </span>
        <span class="min-w-0">
          <span class="block truncate text-14-medium tracking-[-0.02em] text-text-strong">{props.drive.name}</span>
          <span class="mt-1 block truncate text-13-mono text-text-weaker">{props.drive.path}</span>
          <DriveStorageTruth drive={props.drive} />
          <span class="mt-2 flex min-h-9 items-center gap-2">
            <Show
              when={scanning() && props.job}
              fallback={
                <Button
                  class="dl-touch-target"
                  size="small"
                  variant={complete() ? "primary" : "secondary"}
                  icon={failed() ? "reset" : "arrow-right"}
                  disabled={!complete() && !props.canStart}
                  title={!complete() && !props.canStart ? "Three scans are already running" : undefined}
                  onClick={() => (complete() && props.job ? props.onOpen(props.job) : props.onScan())}
                >
                  {complete() ? "Open map" : failed() ? "Try again" : "Scan volume"}
                </Button>
              }
            >
              {(job) => (
                <Button class="dl-touch-target" size="small" variant="secondary" icon="close" onClick={() => props.onCancel(job().id)}>
                  Cancel
                </Button>
              )}
            </Show>
          </span>
        </span>
      </span>

      <span class="hidden min-w-0 sm:block">
        <Show
          when={props.job}
          fallback={
            <Show when={hasTotal()} fallback={<span class="text-13-regular text-text-weak">Ready to scan</span>}>
              <span class="flex items-end justify-between gap-4 tabular-nums">
                <span>
                  <span class="block text-13-semibold uppercase tracking-[0.13em] text-text-weaker">available</span>
                  <span class="mt-1 block text-14-medium tracking-[-0.02em] text-text-strong">
                    {formatBytes(props.drive.free)}
                  </span>
                </span>
                <span class="pb-0.5 text-13-regular text-text-weak">
                  {formatBytes(props.drive.used)} used of {formatBytes(props.drive.total)}
                </span>
              </span>
            </Show>
          }
        >
          {(job) => (
            <span>
              <span class="flex items-end justify-between gap-4 tabular-nums">
                <span>
                  <span class="block text-13-semibold uppercase tracking-[0.13em] text-text-weaker">
                    {job().status === "complete"
                      ? job().source === "snapshot"
                        ? "cached map"
                        : job().source === "delta"
                          ? "updated map"
                          : "map ready"
                      : job().status === "failed"
                        ? "scan stopped"
                        : "scanning"}
                  </span>
                  <span class="mt-1 block text-14-medium tracking-[-0.02em] text-text-strong">
                    {job().status === "failed" ? "Couldn’t finish" : shortBytes(job().bytes)}
                  </span>
                </span>
                <span
                  class="max-w-[180px] truncate pb-0.5 text-13-regular text-text-weak"
                  title={
                    job().status === "complete" && completedPerformance()
                      ? `Completed in ${formatScanDuration(completedPerformance()!.elapsedMs)} at ${formatScanRate(
                          completedPerformance()!.filesPerSecond,
                          "files",
                        )}`
                      : (job().error ?? job().currentPath)
                  }
                >
                  {job().status === "failed"
                    ? job().error
                    : job().status === "complete"
                      ? volumeCompletionLabel(job().source, completedPerformance())
                      : `${formatCount(job().files)} files scanned`}
                </span>
              </span>
            </span>
          )}
        </Show>
      </span>

      <span class="relative grid size-20 place-items-center justify-self-end">
        <svg class="absolute inset-0 size-full -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
          <circle cx="40" cy="40" r="34" fill="none" stroke="var(--surface-raised-strong)" stroke-width="6" />
          <Show when={hasTotal() || props.job}>
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke={
                failed()
                  ? "oklch(0.68 0.17 28)"
                  : complete()
                    ? "oklch(0.72 0.15 148)"
                    : props.job
                      ? "oklch(0.74 0.13 176)"
                      : barColor()
              }
              stroke-width="6"
              pathLength="100"
              stroke-dasharray={`${props.job ? (complete() ? 100 : Math.max(1, props.job.pct)) : usedPct()} 100`}
            />
          </Show>
        </svg>
        <span class="relative text-center">
          <span class="block text-12-medium tabular-nums text-text-strong">
            {props.job
              ? complete()
                ? props.job?.source === "snapshot"
                  ? "Cached"
                  : props.job?.source === "delta"
                    ? "Updated"
                    : "Ready"
                : failed()
                  ? "—"
                  : hasTotal()
                    ? `${Math.round(props.job.pct)}%`
                    : "Live"
              : shortBytes(props.drive.free)}
          </span>
          <span class="mt-0.5 block text-13-semibold uppercase tracking-[0.12em] text-text-weaker">
            {props.job ? (complete() ? "map" : failed() ? "retry" : "scanned") : "free"}
          </span>
        </span>
      </span>
    </div>
  )
}

/** Never turn a cached-map restore or a delta refresh into an invented speed claim. */
export function volumeCompletionLabel(source: VolumeScanJob["source"], performance?: ScanPerformance): string {
  if (source === "snapshot") return "Restored local map"
  if (source === "delta") return "Updated cached map"
  if (source === "scan" && performance) {
    return `${formatScanDuration(performance.elapsedMs)} · ${formatScanRate(performance.filesPerSecond, "files")}`
  }
  return "Map ready"
}

/** APFS is a shared, dynamic pool; surface the caveat without pretending snapshots are reclaimable files. */
export function DriveStorageTruth(props: { drive: DiskDriveInfo }) {
  const isApfs = () => props.drive.filesystem === "apfs"
  const snapshots = () => props.drive.snapshotCount ?? 0
  if (!isApfs()) return null
  return (
    <details class="group mt-2 max-w-[32rem]">
      <summary class="dl-touch-target flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-13-regular text-text-weaker marker:content-none outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
        <Icon name="help" class="size-3 shrink-0" />
        <span class="truncate">
          APFS storage details
          <Show when={props.drive.sharedFree !== undefined}>{` · ${formatBytes(props.drive.sharedFree ?? 0)} free`}</Show>
          <Show when={snapshots() > 0}>{` · ${snapshots()} ${snapshots() === 1 ? "snapshot" : "snapshots"}`}</Show>
        </span>
        <Icon name="chevron-down" class="size-3 shrink-0 transition-transform duration-150 group-open:rotate-180" />
      </summary>
      <div class="border-l border-border-weaker-base py-1 pl-3 text-13-regular leading-relaxed text-text-weaker">
        <p>
          macOS shares capacity between APFS volumes. Purgeable space is system-managed, so DiskLizard never presents it
          as cleanup-ready space.
        </p>
        <Show when={snapshots() === 0}>
          <p class="mt-2">Local snapshots are system-managed and never treated as cleanup candidates.</p>
        </Show>
        <ApfsSnapshotEvidenceList
          embedded
          snapshotCount={snapshots()}
          snapshots={props.drive.apfsSnapshots}
          class="mt-3 max-w-[32rem]"
        />
      </div>
    </details>
  )
}

/** Recommendations live with the inspector controls instead of obscuring the map. */
export function ReclaimBanner(props: { bytes: number; count: number; onReview: () => void }) {
  let valueElement!: HTMLSpanElement
  let displayed = 0

  createEffect(() => {
    const total = props.bytes
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayed = total
      valueElement.textContent = formatBytes(total)
      return
    }
    const cancel = animateCount(displayed, total, 240, (value) => {
      displayed = value
      valueElement.textContent = formatBytes(value)
    })
    onCleanup(cancel)
  })

  return (
    <button
      type="button"
      class="dl-hover-row dl-touch-target mt-2 flex min-h-12 w-full items-center gap-2.5 border-b border-border-weaker-base px-1 py-2 text-left outline-none transition-[color,background-color,transform] duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak active:scale-[0.99]"
      onClick={props.onReview}
      aria-label={`Review ${formatBytes(props.bytes)} across ${formatCount(props.count)} recommendations`}
    >
      <span class="dl-accent-text grid size-7 shrink-0 place-items-center">
        <Icon name="models" class="size-3.5" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-13-semibold text-text-strong">Recommendations</span>
        <span class="mt-0.5 block truncate text-13-regular tabular-nums text-text-weak">
          <span ref={valueElement}>{formatBytes(0)}</span>
          {` · ${props.count === 1 ? "1 item" : `${formatCount(props.count)} items`}`}
        </span>{" "}
      </span>
      <span class="flex shrink-0 items-center gap-1.5 text-13-semibold text-text-strong">
        Review <Icon name="chevron-right" class="size-3" />
      </span>
    </button>
  )
}
