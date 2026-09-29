import { useMemo, useState } from "react"
import {
  ArrowDownRight,
  ArrowUpRight,
  File,
  Folder,
  HardDrive,
  Minus,
  Plus,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { formatBytes } from "./format"
import { consolidateHistoryChanges } from "./history-presentation"
import { diskNodeDisplayName } from "./node-display"
import { useLanguage } from "./runtime"
import type { ScanHistoryEntry } from "./scan-history"
import type { BaselineChange, BaselineComparison } from "./scan-baseline"
import type { DiskScanNode } from "./types"
import { segmentedItem, segmentedTrack, signedBytes } from "./ExplorerChrome"

function relativeWhen(at: number) {
  const seconds = Math.round((at - Date.now()) / 1000)
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ]
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  return format.format(0, "minute")
}

function prettyParent(path: string) {
  return (
    path
      .replace(/[\\/][^\\/]+$/, "")
      .replace(/^\/Users\/[^/]+/, "~")
      .replace(/^\/home\/[^/]+/, "~")
      .replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~") || "/"
  )
}

const KIND_ICON = {
  added: Plus,
  grew: ArrowUpRight,
  shrank: ArrowDownRight,
  removed: Minus,
} as const

type Tab = "since" | "live" | "today"

/**
 * What changed, three ways: against your previous scan (git-style), live
 * while the map is open, and files touched today.
 */
export function ChangesPanel(props: {
  entries: readonly ScanHistoryEntry[]
  recent: readonly DiskScanNode[]
  sinceLast?: BaselineComparison | null
  onClear: () => void
  onReveal: (path: string) => void
  onShow: (path: string) => void
}) {
  const language = useLanguage()
  const rows = useMemo(() => consolidateHistoryChanges(props.entries), [props.entries])
  const [tab, setTab] = useState<Tab>(
    props.sinceLast?.changes.length
      ? "since"
      : rows.length
        ? "live"
        : props.sinceLast
          ? "since"
          : props.recent.length
            ? "today"
            : "since"
  )
  const net = rows.reduce((sum, row) => sum + row.deltaBytes, 0)
  const tabs: Array<[Tab, string]> = [
    ["since", language.t("disk.ui.sinceLast")],
    ["live", language.t("disk.ui.changesLive")],
    ["today", language.t("disk.history.modifiedToday")],
  ]
  return (
    <div className="flex max-h-[inherit] min-h-0 flex-col">
      <div className="px-4 pt-3.5 pb-3">
        <div className={cn(segmentedTrack, "flex w-full")}>
          {tabs.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={cn(segmentedItem, "flex-1 px-2 text-[12px]")}
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === "since" && props.sinceLast ? (
          <div className="mt-3 flex items-end justify-between gap-3">
            <p className="text-[12px] text-text-weak">
              {language.t("disk.ui.sinceWhen", {
                when: relativeWhen(props.sinceLast.previousAt),
              })}
            </p>
            {props.sinceLast.changes.length ? (
              <p
                className={cn(
                  "text-[20px] leading-none font-semibold tracking-[-0.02em] tabular-nums",
                  props.sinceLast.netBytes > 0
                    ? "text-[var(--dl-warning)]"
                    : "text-[var(--dl-positive)]"
                )}
              >
                {signedBytes(props.sinceLast.netBytes)}
              </p>
            ) : null}
          </div>
        ) : null}
        {tab === "live" && rows.length ? (
          <p className="mt-3 text-[12px] text-text-weak tabular-nums">
            {language.t("disk.history.netValue", { value: signedBytes(net) })}
          </p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--dl-separator)] px-1.5 py-1.5 [scrollbar-width:thin]">
        {tab === "since" ? (
          props.sinceLast?.changes.length ? (
            <ul>
              {props.sinceLast.changes.map((change) => (
                <SinceRow
                  key={change.path}
                  change={change}
                  onShow={() =>
                    change.kind === "removed"
                      ? undefined
                      : props.onShow(change.path)
                  }
                />
              ))}
            </ul>
          ) : (
            <Empty>
              {props.sinceLast
                ? language.t("disk.ui.sinceNone", {
                    when: relativeWhen(props.sinceLast.previousAt),
                  })
                : language.t("disk.ui.sinceFirst")}
            </Empty>
          )
        ) : tab === "live" ? (
          rows.length ? (
            <ul>
              {rows.slice(0, 200).map((row) => {
                const Glyph = row.aggregate ? HardDrive : row.isDir ? Folder : File
                return (
                  <li key={row.path}>
                    <button
                      type="button"
                      disabled={row.kind === "removed" || row.aggregate}
                      className="flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left outline-none enabled:hover:bg-[var(--dl-row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
                      title={row.path}
                      onClick={() => props.onReveal(row.path)}
                    >
                      <Glyph className="size-4 shrink-0 text-text-weak" strokeWidth={1.75} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-text-strong">
                          {row.aggregate ? language.t("disk.history.volume") : row.name}
                        </span>
                        <span className="block truncate text-[11.5px] text-text-weak">
                          {language.t(`disk.history.kind.${row.kind}`)} ·{" "}
                          {new Date(row.recordedAt).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </span>
                      <Delta bytes={row.deltaBytes} />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <Empty>{language.t("disk.ui.changesNone")}</Empty>
          )
        ) : props.recent.length ? (
          <ul>
            {props.recent.slice(0, 200).map((node) => (
              <li key={node.path}>
                <button
                  type="button"
                  className="flex h-11 w-full items-center gap-3 rounded-lg px-2.5 text-left outline-none hover:bg-[var(--dl-row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
                  title={node.path}
                  onClick={() => props.onShow(node.path)}
                >
                  {node.isDir ? (
                    <Folder className="size-4 shrink-0 text-text-weak" strokeWidth={1.75} aria-hidden />
                  ) : (
                    <File className="size-4 shrink-0 text-text-weak" strokeWidth={1.75} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-text-strong">
                      {diskNodeDisplayName(node)}
                    </span>
                    <span className="block truncate text-[11.5px] text-text-weak">
                      {prettyParent(node.path)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[12.5px] text-text-base tabular-nums">
                    {formatBytes(node.size)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{language.t("disk.ui.changesTodayNone")}</Empty>
        )}
      </div>
      {tab === "live" && rows.length ? (
        <div className="flex justify-end border-t border-[var(--dl-separator)] px-3 py-2">
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[12px] text-text-weak hover:bg-[var(--dl-well)] hover:text-text-strong"
            onClick={props.onClear}
          >
            {language.t("disk.history.clear")}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function SinceRow(props: { change: BaselineChange; onShow: () => void }) {
  const language = useLanguage()
  const { change } = props
  const Glyph = KIND_ICON[change.kind]
  const growing = change.deltaBytes > 0
  return (
    <li>
      <button
        type="button"
        disabled={change.kind === "removed"}
        className="group flex h-12 w-full items-center gap-3 rounded-lg px-2.5 text-left outline-none enabled:hover:bg-[var(--dl-row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
        title={change.path}
        onClick={props.onShow}
      >
        <span
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-lg",
            growing
              ? "bg-[color-mix(in_oklch,var(--dl-warning)_14%,transparent)] text-[var(--dl-warning)]"
              : "bg-[var(--dl-positive-soft)] text-[var(--dl-positive)]"
          )}
        >
          <Glyph className="size-3.5" strokeWidth={2.25} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-text-strong">
              {change.name}
            </span>
            <span className="shrink-0 text-[11px] text-text-weaker">
              {language.t(`disk.ui.kind.${change.kind}`)}
            </span>
          </span>
          <span className="block truncate text-[11.5px] text-text-weak">
            {prettyParent(change.path)}
            {change.kind === "grew" || change.kind === "shrank"
              ? ` · ${language.t("disk.ui.fromTo", {
                  before: formatBytes(change.beforeBytes),
                  after: formatBytes(change.afterBytes),
                })}`
              : ""}
          </span>
        </span>
        <Delta bytes={change.deltaBytes} />
      </button>
    </li>
  )
}

function Delta(props: { bytes: number }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-0.5 text-[12.5px] font-semibold tabular-nums",
        props.bytes > 0
          ? "text-[var(--dl-warning)]"
          : props.bytes < 0
            ? "text-[var(--dl-positive)]"
            : "text-text-weak"
      )}
    >
      {signedBytes(props.bytes)}
    </span>
  )
}

function Empty(props: { children: React.ReactNode }) {
  return (
    <p className="px-6 py-10 text-center text-[12.5px] leading-relaxed text-text-weak">
      {props.children}
    </p>
  )
}
