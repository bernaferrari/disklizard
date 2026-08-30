import { Icon } from "@opencode-ai/ui/icon"
import { createEffect, onCleanup, Show } from "solid-js"
import type { DiskDriveInfo, DiskScanNode } from "./types"
import { formatBytes, formatCount, shortBytes } from "./format"
import { animateCount } from "./motion"
import { formatScanDuration, formatScanRate, scanPerformance, type ScanPerformance } from "./scan-metrics"
import { usageStroke } from "./ui-tokens"
import { diskLanguageText, useLanguage } from "./runtime"
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
  if (status === "scanning") return diskLanguageText("disk.drive.action.cancel")
  if (status === "complete") return diskLanguageText("disk.drive.action.view")
  if (status === "failed") return diskLanguageText("disk.drive.action.retry")
  return diskLanguageText("disk.common.scan")
}

export function volumeKindLabel(type: DiskDriveInfo["type"]): string | undefined {
  if (type === "removable") return diskLanguageText("disk.drive.kind.removable")
  if (type === "network") return diskLanguageText("disk.drive.kind.network")
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
  if (isStartupVolume(drive.path)) parts.push(diskLanguageText("disk.drive.startup"))
  else {
    const kind = volumeKindLabel(drive.type)
    if (kind) parts.push(kind)
  }
  if (drive.sharedFree !== undefined) {
    parts.push(diskLanguageText("disk.drive.sharedContainerFree", { size: formatBytes(drive.sharedFree) }))
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
  const language = useLanguage()
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
    if (complete()) return language.t("disk.drive.ready")
    if (scanning()) return `${Math.round(props.job?.pct ?? 0)}%`
    return hasTotal() ? formatBytes(props.drive.free) : "—"
  }
  const readoutFree = () => !props.job && hasTotal()
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
    if (props.job?.status === "failed") return props.job.error || language.t("disk.drive.stopped")
    if (props.job?.status === "complete") return volumeCompletionLabel(props.job.source, completedPerformance())
    if (props.job?.status === "scanning") {
      return language.t("disk.drive.scanningSummary", {
        files: formatCount(props.job.files),
        bytes: shortBytes(props.job.bytes),
      })
    }
    return volumeSubtitle(props.drive)
  }

  return (
    <div
      id={props.job ? `disklizard-volume-${props.job.id}` : undefined}
      class="dl-hover-drive dl-volume-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 sm:gap-5 sm:px-5"
      style={{
        "--dl-volume-ink": ink(),
        // Readout text rides on the same hue but leans on --text-strong so it
        // clears 4.5:1 in both themes; the bar fill keeps the vivid ink.
        "--dl-volume-readout": `color-mix(in oklch, ${ink()} 45%, var(--text-strong))`,
      }}
    >
      <VolumeGlyph type={props.drive.type} startup={isStartupVolume(props.drive.path)} />
      <div class="min-w-0">
        <p class="truncate text-14-medium tracking-[-0.015em] text-text-strong">{props.drive.name}</p>
        <p
          class="mt-0.5 truncate text-13-regular text-text-weaker"
          title={
            props.job?.status === "complete" && completedPerformance()
              ? language.t("disk.drive.completedTitle", {
                  duration: formatScanDuration(completedPerformance()!.elapsedMs),
                  rate: formatScanRate(completedPerformance()!.filesPerSecond, "files"),
                })
              : (props.job?.currentPath ?? props.drive.path)
          }
        >
          {subtitle()}
        </p>
      </div>
      <div class="flex shrink-0 items-center gap-3 sm:gap-4">
        <div class="hidden w-[148px] sm:block">
          <div class="dl-volume-bar" aria-hidden="true">
            <div
              class="dl-volume-bar-fill"
              data-settled={complete() ? "" : undefined}
              style={{ width: `${Math.round(fill() * 1000) / 10}%` }}
            />
          </div>
        </div>
        <p
          class="w-[4.75rem] text-right text-14-medium tabular-nums tracking-[-0.02em]"
          style={{ color: "var(--dl-volume-readout, var(--dl-volume-ink))" }}
        >
          {readout()}
          <Show when={readoutFree()}>{` ${language.t("disk.drive.freeSuffix")}`}</Show>
        </p>
        <button
          type="button"
          data-disk-primary-action={props.primary ? "" : undefined}
          classList={{
            "dl-volume-view outline-none focus-visible:ring-2 focus-visible:ring-text-weak": true,
            "dl-volume-view-primary": props.primary && !scanning(),
          }}
          disabled={disabled()}
          title={disabled() ? language.t("disk.drive.scanLimit") : undefined}
          aria-label={
            scanning()
              ? language.t("disk.drive.cancelLabel", { name: props.drive.name })
              : complete()
                ? language.t("disk.drive.viewLabel", { name: props.drive.name })
                : hasTotal()
                  ? language.t("disk.drive.scanFreeLabel", {
                      name: props.drive.name,
                      free: formatBytes(props.drive.free),
                    })
                  : language.t("disk.drive.scanLabel", { name: props.drive.name })
          }
          onClick={activate}
        >
          {volumeActionLabel(props.job?.status)}
        </button>
      </div>
      <Show when={(props.drive.snapshotCount ?? 0) > 0}>
        <ApfsSnapshotEvidenceList
          class="col-start-2 col-end-4 pb-3"
          snapshotCount={props.drive.snapshotCount}
          purgeableSnapshotCount={props.drive.purgeableSnapshotCount}
          timeMachineSnapshotCount={props.drive.timeMachineSnapshotCount}
          snapshots={props.drive.apfsSnapshots}
        />
      </Show>
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
        <rect
          x="9"
          y="11"
          width="8"
          height="2"
          rx="1"
          fill="color-mix(in oklch, var(--text-strong) 28%, transparent)"
        />
        <circle
          cx="22"
          cy="16"
          r="1.6"
          fill={props.startup ? "var(--dl-volume-ink)" : "color-mix(in oklch, var(--text-strong) 28%, transparent)"}
        />
      </svg>
    </span>
  )
}

/** Never turn a cached-map restore or a delta refresh into an invented speed claim. */
export function volumeCompletionLabel(source: VolumeScanJob["source"], performance?: ScanPerformance): string {
  if (source === "snapshot") return diskLanguageText("disk.drive.restored")
  if (source === "delta") return diskLanguageText("disk.drive.updated")
  if (source === "scan" && performance) {
    return diskLanguageText("disk.drive.performance", {
      duration: formatScanDuration(performance.elapsedMs),
      rate: formatScanRate(performance.filesPerSecond, "files"),
    })
  }
  return diskLanguageText("disk.drive.mapReady")
}

/** Recommendations live with the inspector controls instead of obscuring the map. */
export function ReclaimBanner(props: { bytes: number; count: number; onReview: () => void }) {
  const language = useLanguage()
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
      aria-label={language.t("disk.drive.reviewLabel", {
        bytes: formatBytes(props.bytes),
        count: formatCount(props.count),
      })}
    >
      <span class="dl-accent-text grid size-7 shrink-0 place-items-center">
        <Icon name="models" class="size-3.5" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-13-semibold text-text-strong">{language.t("disk.common.recommendations")}</span>
        <span class="mt-0.5 block truncate text-13-regular tabular-nums text-text-weak">
          <span ref={valueElement}>{formatBytes(0)}</span>
          {` · ${language.plural("disk.drive.itemCount", props.count, { formattedCount: formatCount(props.count) })}`}
        </span>{" "}
      </span>
      <span class="flex shrink-0 items-center gap-1.5 text-13-semibold text-text-strong">
        {language.t("disk.common.review")} <Icon name="chevron-right" class="size-3" />
      </span>
    </button>
  )
}
