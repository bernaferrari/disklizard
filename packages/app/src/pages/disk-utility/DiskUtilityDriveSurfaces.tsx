import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { ChevronDown, Eject, FolderOpen, Info, RotateCw } from "lucide-react"
import { Popover } from "@/components/dl/popover"
import { Network } from "lucide-react"
import { useEffect, useId, useState } from "react"
import type { DiskDriveInfo, DiskScanNode } from "./types"
import { formatBytes, formatCount, shortBytes } from "./format"
import {
  formatScanDuration,
  formatScanRate,
  scanPerformance,
  type ScanPerformance,
} from "./scan-metrics"
import { diskLanguageText, useLanguage, usePlatform } from "./runtime"
import { ApfsSnapshotEvidenceList } from "./ApfsSnapshotEvidence"
import type { ScanDiscovery } from "./live-scan"

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
  /** Top-level items the scanner has finished, in arrival order. */
  discoveries?: readonly ScanDiscovery[]
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

export function volumeActionLabel(
  status?: VolumeScanJob["status"],
  hasRetainedMap = false
): string {
  if (status === "scanning") return diskLanguageText("disk.drive.action.cancel")
  if (status === "complete" || hasRetainedMap)
    return diskLanguageText("disk.drive.action.view")
  if (status === "failed") return diskLanguageText("disk.drive.action.retry")
  return diskLanguageText("disk.common.scan")
}

export function volumeKindLabel(
  type: DiskDriveInfo["type"]
): string | undefined {
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
  if (isStartupVolume(drive.path))
    parts.push(diskLanguageText("disk.drive.startup"))
  else {
    const kind = volumeKindLabel(drive.type)
    if (kind) parts.push(kind)
  }
  if (drive.sharedFree !== undefined) {
    parts.push(
      diskLanguageText("disk.drive.sharedContainerFree", {
        size: formatBytes(drive.sharedFree),
      })
    )
  }
  return parts.join(" ")
}

/** Available capacity is a display estimate; physical free/used remain scan facts. */
export function volumeAvailableBytes(drive: {
  total: number
  free: number
  available?: number
}) {
  const estimate = drive.available
  return Math.min(
    drive.total,
    Math.max(
      drive.free,
      Number.isFinite(estimate) && estimate! >= 0 ? estimate! : drive.free
    )
  )
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
  hasRetainedMap?: boolean
  onOpenRetainedMap?: () => void
}) {
  const language = useLanguage()
  const api = usePlatform().diskUtility
  const [volumeInfo, setVolumeInfo] = useState<{
    icon?: string
    canEject: boolean
  } | null>(null)
  const [ejecting, setEjecting] = useState(false)
  const [ejected, setEjected] = useState(false)
  const [actionError, setActionError] = useState(false)
  useEffect(() => {
    let current = true
    void api
      ?.getVolumeInfo?.(props.drive.path)
      .then((info) => {
        if (current) setVolumeInfo(info)
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [api, props.drive.path])
  const eject = async () => {
    if (!api?.ejectVolume) return
    setEjecting(true)
    setActionError(false)
    try {
      const success = await api.ejectVolume(props.drive.path)
      setEjected(success)
      setActionError(!success)
    } catch {
      setActionError(true)
    } finally {
      setEjecting(false)
    }
  }
  const hasTotal = props.drive.total > 0
  const available = volumeAvailableBytes(props.drive)
  const displayUsed = Math.max(0, props.drive.total - available)
  const used = volumeUsedRatio(displayUsed, props.drive.total)
  const scanning = props.job?.status === "scanning"
  const complete = props.job?.status === "complete"
  const failed = props.job?.status === "failed"
  const canView = complete || (!scanning && !!props.hasRetainedMap)
  const fill = canView
    ? 1
    : scanning
      ? Math.max(0, Math.min(1, (props.job?.pct ?? 0) / 100))
      : used
  const completedPerformance = (() => {
    const job = props.job
    if (!job?.completedAt || job.source !== "scan") return undefined
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
    if (props.hasRetainedMap) {
      props.onOpenRetainedMap?.()
      return
    }
    if (props.canStart) props.onScan()
  }
  const disabled = !scanning && !canView && !failed && !props.canStart
  const subtitle =
    props.job?.status === "failed"
      ? props.job.error || language.t("disk.drive.stopped")
      : props.job?.status === "complete"
        ? volumeCompletionLabel(props.job.source, completedPerformance)
        : canView && !props.job
          ? language.t("disk.drive.mapReady")
        : props.job?.status === "scanning"
          ? language.t("disk.drive.scanningSummary", {
              files: formatCount(props.job.files),
              bytes: shortBytes(props.job.bytes),
            })
          : volumeSubtitle({ ...props.drive, sharedFree: undefined })

  if (ejected) return null
  const pressure = volumePressure(displayUsed, props.drive.total)
  const barFill = failed
    ? "var(--dl-danger)"
    : scanning
      ? undefined
      : canView
        ? "linear-gradient(90deg, oklch(0.8 0.17 150), oklch(0.74 0.14 200), oklch(0.66 0.18 256))"
        : pressure === "critical"
          ? "linear-gradient(90deg, oklch(0.78 0.16 60), oklch(0.64 0.21 27))"
          : pressure === "tight"
            ? "linear-gradient(90deg, oklch(0.78 0.15 150), oklch(0.8 0.15 85))"
            : "linear-gradient(90deg, oklch(0.8 0.17 150), oklch(0.74 0.14 200), oklch(0.66 0.18 256))"
  const left =
    scanning || canView || failed
      ? subtitle
      : hasTotal
        ? language.t("disk.ui.home.used", {
            used: formatBytes(displayUsed),
            total: formatBytes(props.drive.total),
          })
        : volumeSubtitle({ ...props.drive, sharedFree: undefined })
  const right = scanning
    ? `${Math.floor(props.job?.pct ?? 0)}%`
    : hasTotal && !canView && !failed
      ? language.t("disk.ui.home.free", { free: formatBytes(available) })
      : undefined
  return (
    <div
      id={props.job ? `disklizard-volume-${props.job.id}` : undefined}
      className="group relative flex items-center gap-5 rounded-2xl bg-[var(--dl-well)] px-5 py-5 shadow-[inset_0_0_0_0.5px_var(--dl-separator)] transition-colors duration-150 hover:bg-[var(--dl-well-strong)] max-sm:flex-wrap"
    >
      {volumeInfo?.icon ? (
        <img
          src={volumeInfo.icon}
          alt=""
          className="size-14 shrink-0 object-contain"
        />
      ) : (
        <VolumeGlyph
          type={props.drive.type}
          startup={isStartupVolume(props.drive.path)}
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[17px] font-semibold tracking-[-0.015em] text-text-strong">
            {props.drive.name}
          </p>
          <span className="shrink-0 truncate text-[12.5px] text-text-weaker">
            {volumeSubtitle({ ...props.drive, sharedFree: undefined })}
          </span>
          {(props.drive.snapshotCount ?? 0) > 0 ||
          props.drive.sharedFree !== undefined ||
          props.drive.available !== undefined ? (
            <Popover
              placement="bottom-start"
              portal={false}
              title={language.t("disk.drive.details")}
              className="w-[320px] max-w-[calc(100vw-32px)]"
              style={{ backgroundColor: "var(--dl-popover)" }}
              triggerAs="button"
              triggerProps={{
                type: "button",
                "aria-label": language.t("disk.drive.details"),
                className:
                  "grid size-6 shrink-0 place-items-center rounded-md text-text-weaker outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]",
              }}
              trigger={<Info className="size-3.5" aria-hidden />}
            >
              {props.drive.available !== undefined && (
                <p className="mt-2 text-[12px] text-text-weak">
                  {language.t("disk.drive.availableDetails", {
                    free: formatBytes(props.drive.free),
                    reclaimable: formatBytes(
                      Math.max(0, available - props.drive.free)
                    ),
                  })}
                </p>
              )}
              {props.drive.sharedFree !== undefined ? (
                <p className="mt-2 text-[12px] text-text-weak">
                  {language.t("disk.drive.sharedContainerFree", {
                    size: formatBytes(props.drive.sharedFree ?? 0),
                  })}
                </p>
              ) : null}
              <ApfsSnapshotEvidenceList
                embedded
                className="mt-2 border-t border-[var(--dl-separator)] pt-3"
                snapshotCount={props.drive.snapshotCount}
                purgeableSnapshotCount={props.drive.purgeableSnapshotCount}
                timeMachineSnapshotCount={props.drive.timeMachineSnapshotCount}
                snapshots={props.drive.apfsSnapshots}
              />
            </Popover>
          ) : null}
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--dl-well-strong)]"
          role={scanning ? "progressbar" : undefined}
          aria-label={scanning ? props.drive.name : undefined}
          aria-valuemin={scanning ? 0 : undefined}
          aria-valuemax={scanning ? 100 : undefined}
          aria-valuenow={
            scanning ? Math.floor(props.job?.pct ?? 0) : undefined
          }
        >
          <div
            className="dl-volume-bar-fill h-full rounded-[inherit] transition-[width] duration-300 ease-out"
            data-settled={canView ? "" : undefined}
            data-scanning={scanning ? "" : undefined}
            style={{
              width: `${scanning ? Math.round(fill * 1000) / 10 : Math.max(1.5, Math.round(fill * 1000) / 10)}%`,
              background: barFill,
            }}
          />
        </div>
        <div
          className="mt-2 flex items-center justify-between gap-3 text-[12.5px] tabular-nums"
          title={
            props.job?.status === "complete" && completedPerformance
              ? language.t("disk.drive.completedTitle", {
                  duration: formatScanDuration(completedPerformance.elapsedMs),
                  rate: formatScanRate(
                    completedPerformance.filesPerSecond,
                    "files"
                  ),
                })
              : (props.job?.currentPath ?? props.drive.path)
          }
        >
          <span
            className={`min-w-0 truncate ${failed ? "text-[var(--dl-danger)]" : "text-text-weak"}`}
          >
            {left}
          </span>
          {right ? (
            <span className="shrink-0 font-medium text-text-base">{right}</span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 max-sm:ml-auto">
        <button
          type="button"
          data-disk-primary-action={props.primary ? "" : undefined}
          className={
            (props.primary && !scanning) || canView
              ? "inline-flex h-9 min-w-[88px] items-center justify-center rounded-full bg-[var(--dl-accent)] px-5 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.25)] transition-[filter,transform] outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] active:scale-[0.97] disabled:opacity-40"
              : "inline-flex h-9 min-w-[88px] items-center justify-center rounded-full bg-[var(--dl-well-strong)] px-5 text-[13px] font-semibold text-text-strong transition-[filter,transform] outline-none hover:brightness-125 focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] active:scale-[0.97] disabled:opacity-40"
          }
          disabled={disabled}
          title={disabled ? language.t("disk.drive.scanLimit") : undefined}
          aria-label={
            scanning
              ? language.t("disk.drive.cancelLabel", { name: props.drive.name })
              : canView
                ? language.t("disk.drive.viewLabel", { name: props.drive.name })
                : hasTotal
                  ? language.t("disk.drive.scanFreeLabel", {
                      name: props.drive.name,
                      free: formatBytes(available),
                    })
                  : language.t("disk.drive.scanLabel", {
                      name: props.drive.name,
                    })
          }
          onClick={activate}
        >
          {volumeActionLabel(props.job?.status, props.hasRetainedMap)}
        </button>
        {(api?.revealVolume || canView || volumeInfo?.canEject) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={language.t("disk.volume.actions")}
              className="grid size-9 place-items-center rounded-full text-text-weak hover:bg-[var(--dl-well-strong)] hover:text-text-strong"
            >
              <ChevronDown className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canView && (
                <DropdownMenuItem
                  disabled={!props.canStart}
                  onClick={props.onScan}
                >
                  <RotateCw className="size-4" />
                  {language.t("disk.volume.rescan")}
                </DropdownMenuItem>
              )}
              {api?.revealVolume && (
                <>
                  {canView && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onClick={() => {
                      void api.revealVolume!(props.drive.path)
                        .then((ok) => setActionError(!ok))
                        .catch(() => setActionError(true))
                    }}
                  >
                    <FolderOpen className="size-4" />
                    {language.t("disk.volume.finder")}
                  </DropdownMenuItem>
                </>
              )}
              {volumeInfo?.canEject && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={scanning || ejecting}
                    onClick={() => void eject()}
                  >
                    <Eject className="size-4" />
                    {language.t("disk.volume.eject", {
                      name: props.drive.name,
                    })}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {actionError && (
        <p role="alert" className="w-full text-xs text-text-weak">
          {language.t("disk.volume.ejectFailed")}
        </p>
      )}
    </div>
  )
}

function VolumeGlyph(props: { type: DiskDriveInfo["type"]; startup: boolean }) {
  const gradient = useId()
  return (
    <span
      className="grid h-14 w-11 shrink-0 place-items-center"
      aria-hidden="true"
    >
      {props.type === "network" ? (
        <Network className="size-7 text-text-weak" strokeWidth={1.4} />
      ) : (
        <svg width="36" height="49" viewBox="0 0 28 38" fill="none">
          <defs>
            <linearGradient
              id={gradient}
              x1="3"
              y1="2"
              x2="25"
              y2="36"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#e2e5ea" />
              <stop offset="0.5" stopColor="#a5aab3" />
              <stop offset="1" stopColor="#747b87" />
            </linearGradient>
          </defs>
          <rect
            x="3"
            y="2"
            width="22"
            height="33"
            rx="3"
            fill={`url(#${gradient})`}
            stroke="#ffffff"
            strokeOpacity="0.25"
          />
          <rect
            x="5"
            y="4"
            width="18"
            height="27"
            rx="1.5"
            stroke="#ffffff"
            strokeOpacity="0.2"
          />
          <path
            d="M8 32.5h7"
            stroke="#343944"
            strokeOpacity="0.7"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
          <circle cx="20" cy="32.5" r="0.8" fill="#e1e8ed" />
        </svg>
      )}
    </span>
  )
}

/** Never turn a cached-map restore or a delta refresh into an invented speed claim. */
export function volumeCompletionLabel(
  source: VolumeScanJob["source"],
  performance?: ScanPerformance
): string {
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
