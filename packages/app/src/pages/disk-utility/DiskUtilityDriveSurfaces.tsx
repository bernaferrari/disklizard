import { Popover } from "@/components/dl/popover"
import { Icon } from "@/components/dl/icon"
import { Button } from "@/components/ui/button"
import { Network } from "lucide-react"
import { useEffect, useRef, useId, type CSSProperties } from "react"
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

/** Available capacity is a display estimate; physical free/used remain scan facts. */
export function volumeAvailableBytes(drive: { total: number; free: number; available?: number }) {
  const estimate = drive.available
  return Math.min(drive.total, Math.max(drive.free, Number.isFinite(estimate) && estimate! >= 0 ? estimate! : drive.free))
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
  const hasTotal = props.drive.total > 0
  const available = volumeAvailableBytes(props.drive)
  const displayUsed = Math.max(0, props.drive.total - available)
  const used = volumeUsedRatio(displayUsed, props.drive.total)
  const scanning = props.job?.status === "scanning"
  const complete = props.job?.status === "complete"
  const failed = props.job?.status === "failed"
  const ink = failed
    ? "oklch(0.68 0.17 28)"
    : complete
      ? "oklch(0.72 0.15 148)"
      : scanning
        ? "oklch(0.74 0.13 176)"
        : hasTotal
          ? usageStroke(displayUsed, props.drive.total)
          : "oklch(0.62 0.01 0)"
  const fill = complete ? 1 : scanning ? Math.max(0, Math.min(1, (props.job?.pct ?? 0) / 100)) : used
  const readout = failed
    ? "—"
    : complete
      ? language.t("disk.drive.ready")
      : scanning
        ? `${Math.floor(props.job?.pct ?? 0)}%`
        : hasTotal
          ? formatBytes(available)
          : "—"
  const readoutFree = !props.job && hasTotal
  const completedPerformance = (() => {
    const job = props.job
    if (!job?.completedAt || job.source !== "scan") return
    return scanPerformance(job.files, job.bytes, job.startedAt, job.completedAt)
  })()
  const activate = () => {
    if (scanning && props.job) {
      props.onCancel(props.job.id)
      return
    }
    if (complete && props.job) {
      props.onOpen(props.job)
      return
    }
    if (props.canStart) props.onScan()
  }
  const disabled = !scanning && !complete && !failed && !props.canStart
  const subtitle =
    props.job?.status === "failed"
      ? props.job.error || language.t("disk.drive.stopped")
      : props.job?.status === "complete"
        ? volumeCompletionLabel(props.job.source, completedPerformance)
        : props.job?.status === "scanning"
          ? language.t("disk.drive.scanningSummary", {
              files: formatCount(props.job.files),
              bytes: shortBytes(props.job.bytes),
            })
          : volumeSubtitle({ ...props.drive, sharedFree: undefined })

  return (
    <div
      id={props.job ? `disklizard-volume-${props.job.id}` : undefined}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-2 border-b border-border-weaker-base/50 last:border-b-0 px-5 py-3 max-sm:grid-cols-[auto_minmax(0,1fr)_auto]"
      style={
        {
          "--dl-volume-ink": ink,
          // Readout text rides on the same hue but leans on --text-strong so it
          // clears 4.5:1 in both themes; the bar fill keeps the vivid ink.
          "--dl-volume-readout": `color-mix(in oklch, ${ink} 45%, var(--text-strong))`,
        } as CSSProperties
      }
    >
      <VolumeGlyph type={props.drive.type} startup={isStartupVolume(props.drive.path)} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-[15px] font-medium tracking-[-0.01em] text-text-strong">{props.drive.name}</p>
          {(props.drive.snapshotCount ?? 0) > 0 || props.drive.sharedFree !== undefined || props.drive.available !== undefined ? (
            <Popover
              placement="bottom-start"
              portal={false}
              title={language.t("disk.drive.details")}
              className="w-[320px] max-w-[calc(100vw-32px)]"
              style={{ backgroundColor: "var(--surface-raised-base)" }}
              triggerAs="button"
              triggerProps={{
                type: "button",
                "aria-label": language.t("disk.drive.details"),
                className:
                  "grid size-7 shrink-0 place-items-center rounded-md text-text-weaker outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-text-weak",
              }}
              trigger={
                <svg
                  aria-hidden="true"
                  viewBox="0 0 20 20"
                  className="size-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                >
                  <circle cx="10" cy="10" r="7" />
                  <path d="M10 9v5" />
                  <circle cx="10" cy="6.5" r=".6" fill="currentColor" stroke="none" />
                </svg>
              }
            >
              {props.drive.available !== undefined && (
                <p className="mt-2 text-12-regular text-text-weak">
                  {language.t("disk.drive.availableDetails", { free: formatBytes(props.drive.free), reclaimable: formatBytes(Math.max(0, available - props.drive.free)) })}
                </p>
              )}
              {props.drive.sharedFree !== undefined ? (
                <p className="mt-2 text-12-regular text-text-weak">
                  {language.t("disk.drive.sharedContainerFree", {
                    size: formatBytes(props.drive.sharedFree ?? 0),
                  })}
                </p>
              ) : null}
              <ApfsSnapshotEvidenceList
                embedded
                className="mt-2 border-t border-border-weaker-base pt-3"
                snapshotCount={props.drive.snapshotCount}
                purgeableSnapshotCount={props.drive.purgeableSnapshotCount}
                timeMachineSnapshotCount={props.drive.timeMachineSnapshotCount}
                snapshots={props.drive.apfsSnapshots}
              />
            </Popover>
          ) : null}
        </div>
        <p
          className="mt-0.5 truncate text-12-regular leading-5 text-text-weaker"
          title={
            props.job?.status === "complete" && completedPerformance
              ? language.t("disk.drive.completedTitle", {
                  duration: formatScanDuration(completedPerformance.elapsedMs),
                  rate: formatScanRate(completedPerformance.filesPerSecond, "files"),
                })
              : (props.job?.currentPath ?? props.drive.path)
          }
        >
          {volumeSubtitle({ ...props.drive, sharedFree: undefined })}
        </p>
      </div>
      <div className="flex h-10 w-48 flex-col justify-center gap-1.5 max-sm:col-start-2 max-sm:row-start-2 max-sm:w-full" title={subtitle}>
        <div className="min-w-12 shrink-0">
          <div
            className="h-[5px] rounded-full bg-[color-mix(in_oklch,var(--text-strong)_10%,transparent)]"
            role={scanning ? "progressbar" : undefined}
            aria-label={scanning ? props.drive.name : undefined}
            aria-valuemin={scanning ? 0 : undefined}
            aria-valuemax={scanning ? 100 : undefined}
            aria-valuenow={scanning ? Math.floor(props.job?.pct ?? 0) : undefined}
          >
            <div
              className="dl-volume-bar-fill h-full rounded-[inherit] bg-(--dl-volume-ink) transition-[width,background-color] duration-200"
              data-settled={complete ? "" : undefined}
              data-scanning={scanning ? "" : undefined}
              style={{ width: `${Math.round(fill * 1000) / 10}%` }}
            />
          </div>
        </div>
        <p
          className={`whitespace-nowrap text-right text-12-regular leading-5 tabular-nums ${
            failed ? "text-text-strong" : "text-text-weak"
          }`}
        >
          {readout}
          {readoutFree ? ` ${language.t(props.drive.available !== undefined ? "disk.drive.availableSuffix" : "disk.drive.freeSuffix")}` : undefined}
        </p>
      </div>
      <div className="flex shrink-0 items-center max-sm:col-start-3 max-sm:row-span-2 max-sm:row-start-1">
        <Button
          type="button"
          data-disk-primary-action={props.primary ? "" : undefined}
          size="default"
          variant={props.primary && !scanning ? "default" : "secondary"}
          className="h-8 min-w-[80px] rounded-md px-4 text-[13px] font-medium"
          disabled={disabled}
          title={disabled ? language.t("disk.drive.scanLimit") : undefined}
          aria-label={
            scanning
              ? language.t("disk.drive.cancelLabel", { name: props.drive.name })
              : complete
                ? language.t("disk.drive.viewLabel", { name: props.drive.name })
                : hasTotal
                  ? language.t("disk.drive.scanFreeLabel", {
                      name: props.drive.name,
                      free: formatBytes(available),
                    })
                  : language.t("disk.drive.scanLabel", { name: props.drive.name })
          }
          onClick={activate}
        >
          {volumeActionLabel(props.job?.status)}
        </Button>
      </div>
    </div>
  )
}

function VolumeGlyph(props: { type: DiskDriveInfo["type"]; startup: boolean }) {
  const gradient = useId()
  return <span className="grid h-12 w-9 shrink-0 place-items-center" aria-hidden="true">
    {props.type === "network" ? <Network className="size-7 text-text-weak" strokeWidth={1.4} /> :
      <svg width="28" height="38" viewBox="0 0 28 38" fill="none">
        <defs><linearGradient id={gradient} x1="3" y1="2" x2="25" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e2e5ea" /><stop offset="0.5" stopColor="#a5aab3" /><stop offset="1" stopColor="#747b87" />
        </linearGradient></defs>
        <rect x="3" y="2" width="22" height="33" rx="3" fill={`url(#${gradient})`} stroke="#ffffff" strokeOpacity="0.25" />
        <rect x="5" y="4" width="18" height="27" rx="1.5" stroke="#ffffff" strokeOpacity="0.2" />
        <path d="M8 32.5h7" stroke="#343944" strokeOpacity="0.7" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="20" cy="32.5" r="0.8" fill="#e1e8ed" />
      </svg>}
  </span>
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
  const valueRef = useRef<HTMLSpanElement | null>(null)
  const displayedRef = useRef(0)

  useEffect(() => {
    const total = props.bytes
    const valueElement = valueRef.current
    if (!valueElement) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayedRef.current = total
      valueElement.textContent = formatBytes(total)
      return
    }
    const cancel = animateCount(displayedRef.current, total, 240, (value) => {
      displayedRef.current = value
      valueElement.textContent = formatBytes(value)
    })
    return cancel
  }, [props.bytes])

  return (
    <button
      type="button"
      className="mt-2 flex min-h-11 min-w-11 w-full items-center gap-2.5 border-b border-border-weaker-base px-1 py-2 text-left outline-none transition-[color,background-color,transform] duration-150 hover:bg-[color-mix(in_oklch,var(--surface-raised-base)_45%,transparent)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak active:scale-[0.99]"
      onClick={props.onReview}
      aria-label={language.t("disk.drive.reviewLabel", {
        bytes: formatBytes(props.bytes),
        count: formatCount(props.count),
      })}
    >
      <span className="grid size-7 shrink-0 place-items-center text-[color-mix(in_oklch,var(--dl-accent-strong)_54%,var(--text-strong))]">
        <Icon name="models" className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-13-semibold text-text-strong">{language.t("disk.common.recommendations")}</span>
        <span className="mt-0.5 block truncate text-13-regular tabular-nums text-text-weak">
          <span ref={valueRef}>{formatBytes(0)}</span>
          {` · ${language.plural("disk.drive.itemCount", props.count, { formattedCount: formatCount(props.count) })}`}
        </span>{" "}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-13-semibold text-text-strong">
        {language.t("disk.common.review")} <Icon name="chevron-right" className="size-3" />
      </span>
    </button>
  )
}
