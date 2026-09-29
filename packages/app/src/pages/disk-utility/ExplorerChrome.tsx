import { useState, type ReactNode } from "react"
import {
  History,
  ChartPie,
  Layers,
  LayoutGrid,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { formatBytes, shortBytes } from "./format"
import { useLanguage } from "./runtime"
import type { DiskDriveInfo } from "./types"
import type { BaselineComparison } from "./scan-baseline"

/**
 * Small, quiet pieces of explorer chrome. Each owns one idea so the page
 * shell only arranges them; nothing here knows about scan state.
 */

export const segmentedTrack =
  "inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg bg-[var(--dl-well)] p-0.5"
export const segmentedItem =
  "inline-flex h-7 min-w-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-text-weak outline-none transition-[background-color,color,box-shadow] duration-150 hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] aria-pressed:bg-[var(--dl-raised)] aria-pressed:text-text-strong aria-pressed:shadow-[0_1px_2px_rgb(0_0_0/0.18),inset_0_0_0_0.5px_rgb(255_255_255/0.06)]"

export function WorkspaceSwitch(props: {
  value: "explore" | "cleanup"
  reclaimableBytes: number
  onChange: (value: "explore" | "cleanup") => void
}) {
  const language = useLanguage()
  return (
    <div
      className={segmentedTrack}
      role="group"
      aria-label={language.t("disk.ui.workspace")}
    >
      <button
        type="button"
        className={segmentedItem}
        aria-pressed={props.value === "explore"}
        onClick={() => props.onChange("explore")}
      >
        {language.t("disk.common.explore")}
      </button>
      <button
        type="button"
        className={segmentedItem}
        aria-pressed={props.value === "cleanup"}
        onClick={() => props.onChange("cleanup")}
      >
        {language.t("disk.ui.cleanUp")}
        {props.reclaimableBytes > 0 ? (
          <span className="rounded-[5px] bg-[var(--dl-positive-soft)] px-1.5 py-px text-[11px] font-semibold text-[var(--dl-positive)] tabular-nums">
            {shortBytes(props.reclaimableBytes)}
          </span>
        ) : null}
      </button>
    </div>
  )
}

export type ExplorerViewMode = "map" | "grid" | "icicle"

export function ViewSwitch(props: {
  value: string
  onChange: (value: ExplorerViewMode, keyboard: boolean) => void
}) {
  const language = useLanguage()
  const views = [
    { value: "map", key: "1", icon: ChartPie, label: "disk.common.map" },
    { value: "grid", key: "2", icon: LayoutGrid, label: "disk.common.tiles" },
    { value: "icicle", key: "3", icon: Layers, label: "disk.common.icicle" },
  ] as const
  return (
    <div
      className={segmentedTrack}
      role="group"
      aria-label={language.t("disk.ui.viewAs")}
    >
      {views.map((view) => {
        const label = language.t(view.label)
        const Glyph = view.icon
        return (
          <button
            key={view.value}
            type="button"
            className={cn(segmentedItem, "px-2")}
            aria-pressed={props.value === view.value}
            aria-label={label}
            aria-keyshortcuts={view.key}
            title={language.t("disk.ui.viewShortcut", {
              view: label,
              key: view.key,
            })}
            onClick={(event) => props.onChange(view.value, event.detail === 0)}
          >
            <Glyph className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}

const popoverSurface =
  "w-[380px] gap-0 rounded-xl border-0 bg-[var(--dl-popover)] p-0 text-text-base shadow-[0_0_0_0.5px_rgb(255_255_255/0.08),0_0_0_1px_rgb(0_0_0/0.3),0_18px_48px_rgb(0_0_0/0.35)]"

export const toolbarIconButton =
  "relative grid size-8 shrink-0 place-items-center rounded-lg text-text-weak outline-none transition-colors duration-150 hover:bg-[var(--dl-well)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] data-[popup-open]:bg-[var(--dl-well)] data-[popup-open]:text-text-strong"

/**
 * Live activity and the since-last-scan comparison share one toolbar
 * affordance. When the disk moved since last time, the button says by how
 * much, so the most interesting fact is visible without opening anything.
 */
export function ChangesButton(props: {
  count: number
  sinceLast?: BaselineComparison | null
  children: (close: () => void) => ReactNode
}) {
  const language = useLanguage()
  const [open, setOpen] = useState(false)
  const news = (props.sinceLast?.changes.length ?? 0) > 0
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={toolbarIconButton}
        aria-label={language.t("disk.ui.changes")}
        title={language.t("disk.ui.changes")}
      >
        <History className="size-4" strokeWidth={1.75} aria-hidden />
        {news && props.count === 0 ? (
          <span
            className="absolute top-1 right-1 size-2 rounded-full bg-[var(--dl-accent)] ring-2 ring-[var(--dl-chrome,var(--background-base))]"
            aria-hidden
          />
        ) : null}
        {props.count > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--dl-accent)] px-1 text-[10px] leading-none font-semibold text-white tabular-nums">
            {props.count > 99 ? "99+" : props.count}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className={cn(
          popoverSurface,
          "max-h-[min(600px,72vh)] w-[420px] overflow-hidden"
        )}
      >
        {props.children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  )
}

export function signedBytes(bytes: number) {
  return `${bytes > 0 ? "+" : bytes < 0 ? "−" : ""}${shortBytes(Math.abs(bytes))}`
}

/**
 * Coverage caveats are real but rarely actionable, so they sit as one quiet
 * line at the bottom of the list and open into details on demand.
 */
export function ScanIssuesNotice(props: {
  unreadableCount?: number
  samplePaths?: readonly string[]
  guidance: string
  accountingWarning?: string
  onRescan: () => void
  onOpenPrivacy?: () => void
}) {
  const language = useLanguage()
  const unreadable = props.unreadableCount ?? 0
  if (!unreadable && !props.accountingWarning) return null
  const samples = (props.samplePaths ?? []).slice(0, 6)
  return (
    <Popover>
      <PopoverTrigger className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[12px] text-text-weak transition-colors outline-none hover:bg-[var(--dl-well)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] data-[popup-open]:bg-[var(--dl-well)]">
        {unreadable ? (
          <TriangleAlert
            className="size-3.5 shrink-0 text-[var(--dl-warning)]"
            strokeWidth={2}
            aria-hidden
          />
        ) : (
          <ShieldAlert
            className="size-3.5 shrink-0 text-[var(--dl-warning)]"
            strokeWidth={2}
            aria-hidden
          />
        )}
        <span className="min-w-0 truncate">
          {unreadable
            ? language.plural("disk.ui.unreadable", unreadable)
            : language.t("disk.ui.accountingTitle")}
        </span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={6}
        className={popoverSurface}
      >
        <div className="px-4 pt-4 pb-3">
          {unreadable ? (
            <>
              <p className="text-[13px] font-semibold text-text-strong">
                {language.t("disk.ui.issuesTitle")}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-text-weak">
                {props.guidance} {language.t("disk.ui.issuesTotals")}
              </p>
              <ul className="mt-3 space-y-0.5 rounded-lg bg-[var(--dl-well)] px-3 py-2">
                {samples.map((path) => (
                  <li
                    key={path}
                    className="truncate font-mono text-[11px] leading-5 text-text-weak"
                    title={path}
                  >
                    {path}
                  </li>
                ))}
                {unreadable > samples.length ? (
                  <li className="text-[11px] leading-5 text-text-weaker">
                    {language.t("disk.ui.issuesMore", {
                      count: (unreadable - samples.length).toLocaleString(),
                    })}
                  </li>
                ) : null}
              </ul>
            </>
          ) : null}
          {props.accountingWarning ? (
            <div className={unreadable ? "mt-4" : undefined}>
              <p className="text-[13px] font-semibold text-text-strong">
                {language.t("disk.ui.accountingTitle")}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-text-weak">
                {props.accountingWarning}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--dl-separator)] px-3 py-2.5">
          {props.onOpenPrivacy ? (
            <button
              type="button"
              className={quietButton}
              onClick={props.onOpenPrivacy}
            >
              {language.t("disk.explore.openPrivacy")}
            </button>
          ) : null}
          <button
            type="button"
            className={quietButton}
            onClick={props.onRescan}
          >
            {language.t("disk.common.rescan")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export const quietButton =
  "inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--dl-well)] px-2.5 text-[12px] font-medium text-text-strong outline-none transition-colors hover:bg-[var(--dl-well-strong)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] disabled:opacity-40"

export const primaryButton =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[var(--dl-accent)] px-3.5 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.25)] outline-none transition-[filter,transform] duration-150 hover:brightness-110 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background-base)] disabled:pointer-events-none disabled:opacity-40"

/** Free space closes the list the way a ledger closes with its balance. */
export function FreeSpaceRow(props: { drive: DiskDriveInfo }) {
  const language = useLanguage()
  const free = Math.max(0, Math.min(props.drive.total, props.drive.free))
  const available =
    props.drive.available !== undefined && props.drive.available > free
      ? Math.min(props.drive.total, props.drive.available)
      : undefined
  return (
    <div
      className="flex h-8 items-center gap-3 px-3 text-[13px] text-text-weak"
      title={
        available
          ? language.t("disk.drive.availableDetails", {
              free: formatBytes(free),
              reclaimable: formatBytes(available - free),
            })
          : undefined
      }
    >
      <span
        className="size-2.5 shrink-0 rounded-full border border-text-weaker"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">
        {language.t("disk.capacity.free")}
      </span>
      <span className="shrink-0 tabular-nums">{formatBytes(free)}</span>
    </div>
  )
}
