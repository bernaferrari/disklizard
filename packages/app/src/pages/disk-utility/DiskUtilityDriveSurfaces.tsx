import { Icon } from "@opencode-ai/ui/icon"
import { createEffect, onCleanup, Show } from "solid-js"
import type { DiskDriveInfo, DiskScanNode } from "./types"
import { formatBytes, formatCount, shortBytes } from "./format"
import { animateCount } from "./motion"
import { formatScanDuration, formatScanRate, scanPerformance, type ScanPerformance } from "./scan-metrics"
import { usageStroke } from "./ui-tokens"

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

export type VolumePressure = "ok" | "tight" | "critical"

export function volumeUsedRatio(used: number, total: number): number {
  if (!total || total <= 0) return 0
  return Math.min(1, Math.max(0, used / total))
}

export function volumePressure(used: number, total: number): VolumePressure {
  const ratio = volumeUsedRatio(used, total)
  if (ratio >= 0.9) return "critical"
  if (ratio >= 0.75) return "tight"
  return "ok"
}

export function volumeActionLabel(status?: VolumeScanJob["status"]): string {
  if (status === "scanning") return "Cancel"
  if (status === "complete") return "View"
  if (status === "failed") return "Retry"
  return "Scan"
}

export function volumeKindLabel(type: DiskDriveInfo["type"]): string | undefined {
  if (type === "removable") return "removable disk"
  if (type === "network") return "network volume"
  return undefined
}

export function volumePathVisible(path: string, name: string): boolean {
  const trimmed = path.replace(/[/\\]+$/, "")
  return trimmed.length > 0 && trimmed !== name && path !== "/" && path !== "\\"
}

export function isStartupVolume(path: string): boolean {
  return path === "/" || /^[a-zA-Z]:\\?$/.test(path)
}

export function volumeSubtitle(drive: DiskDriveInfo): string {
  const parts: string[] = []
  if (drive.total > 0) parts.push(formatBytes(drive.total))
  if (isStartupVolume(drive.path)) parts.push("startup disk")
  else {
    const kind = volumeKindLabel(drive.type)
    if (kind) parts.push(kind)
  }
  return parts.join(" ")
}

/** A volume remains actionable while other volumes scan in parallel. */
export function VolumeRow(props: {
  drive: DiskDriveInfo
  job?: VolumeScanJob
  canStart: boolean
  primary?: boolean
  onScan: () => void
  onCancel: (id: string) => void
  onOpen: (job: VolumeScanJob) => void
}) {
  const hasTotal = () => props.drive.total > 0
  const used = () => volumeUsedRatio(props.drive.used, props.drive.total)
  const scanning = () => props.job?.status === "scanning"
  const complete = () => props.job?.status === "complete"
  const failed = () => props.job?.status === "failed"
  const ink = () => {
    if (failed()) return "oklch(0.68 0.17 28)"
    if (complete()) return "oklch(0.72 0.15 148)"
    if (scanning()) return "oklch(0.74 0.13 176)"
    return hasTotal() ? usageStroke(props.drive.used, props.drive.total) : "oklch(0.62 0.01 0)"
  }
  const fill = () => {
    if (complete()) return 1
    if (scanning()) return Math.max(0.02, Math.min(1, (props.job?.pct ?? 0) / 100))
    if (failed()) return used()
    return used()
  }
  const readout = () => {
    if (failed()) return "—"
    if (complete()) return "Ready"
    if (scanning()) return `${Math.round(props.job?.pct ?? 0)}%`
    return hasTotal() ? formatBytes(props.drive.free) : "—"
  }
  const completedPerformance = () => {
    const job = props.job
    if (!job?.completedAt || job.source !== "scan") return
    return scanPerformance(job.files, job.bytes, job.startedAt, job.completedAt)
  }
  const activate = () => {
    if (scanning() && props.job) {
      props.onCancel(props.job.id)
      return
    }
    if (complete() && props.job) {
      props.onOpen(props.job)
      return
    }
    if (props.canStart) props.onScan()
  }
  const disabled = () => !scanning() && !complete() && !failed() && !props.canStart
  const subtitle = () => {
    if (props.job?.status === "failed") return props.job.error || "Scan stopped"
    if (props.job?.status === "complete") return volumeCompletionLabel(props.job.source, completedPerformance())
    if (props.job?.status === "scanning") {
      return `${formatCount(props.job.files)} files · ${shortBytes(props.job.bytes)}`
    }
    return volumeSubtitle(props.drive)
  }

  return (
    <div
      id={props.job ? `disklizard-volume-${props.job.id}` : undefined}
      class="dl-hover-drive dl-volume-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 sm:gap-5 sm:px-5"
      style={{ "--dl-volume-ink": ink() }}
    >
      <VolumeGlyph type={props.drive.type} startup={isStartupVolume(props.drive.path)} />
      <div class="min-w-0">
        <p class="truncate text-14-medium tracking-[-0.015em] text-text-strong">{props.drive.name}</p>
        <p
          class="mt-0.5 truncate text-13-regular text-text-weaker"
          title={
            props.job?.status === "complete" && completedPerformance()
              ? `Completed in ${formatScanDuration(completedPerformance()!.elapsedMs)} at ${formatScanRate(
                  completedPerformance()!.filesPerSecond,
                  "files",
                )}`
              : (props.job?.currentPath ?? props.drive.path)
          }
        >
          {subtitle()}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-3 sm:gap-4">
        <div class="hidden w-[148px] sm:block">
          <div class="dl-volume-bar" aria-hidden="true">
            <div class="dl-volume-bar-fill" style={{ width: `${Math.round(fill() * 1000) / 10}%` }} />
          </div>
        </div>
        <p class="dl-volume-free w-[4.75rem] text-right text-14-medium tabular-nums tracking-[-0.02em]">{readout()}</p>
        <button
          type="button"
          data-disk-primary-action={props.primary ? "" : undefined}
          class="dl-volume-view outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
          disabled={disabled()}
          title={disabled() ? "Three scans are already running" : undefined}
          aria-label={
            scanning()
              ? `Cancel scan of ${props.drive.name}`
              : complete()
                ? `View map of ${props.drive.name}`
                : `Scan ${props.drive.name}${hasTotal() ? `, ${formatBytes(props.drive.free)} left` : ""}`
          }
          onClick={activate}
        >
          {volumeActionLabel(props.job?.status)}
        </button>
      </div>
    </div>
  )
}

function VolumeGlyph(props: { type: DiskDriveInfo["type"]; startup: boolean }) {
  if (props.type === "network") {
    return (
      <span class="dl-volume-glyph grid size-9 place-items-center text-text-weak">
        <Icon name="server" class="size-4" />
      </span>
    )
  }
  return (
    <span class="dl-volume-glyph grid size-9 place-items-center text-text-weak" aria-hidden="true">
      <svg viewBox="0 0 32 32" class="size-7">
        <rect
          x="5"
          y="7"
          width="22"
          height="18"
          rx="4.5"
          fill="color-mix(in oklch, var(--text-strong) 10%, transparent)"
          stroke="color-mix(in oklch, var(--text-strong) 28%, transparent)"
          stroke-width="1.25"
        />
        <rect x="9" y="11" width="8" height="2" rx="1" fill="color-mix(in oklch, var(--text-strong) 28%, transparent)" />
        <circle cx="22" cy="16" r="1.6" fill={props.startup ? "var(--dl-volume-ink)" : "color-mix(in oklch, var(--text-strong) 28%, transparent)"} />
      </svg>
    </span>
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
