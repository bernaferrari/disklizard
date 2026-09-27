import { Button } from "@/components/dl/button"
import {
  ArrowUpRight,
  ArrowDownRight,
  Folder,
  File,
  Activity,
  RotateCcw,
} from "lucide-react"
import { useMemo } from "react"
import { formatBytes } from "./format"
import { useLanguage } from "./runtime"
import type { ScanHistoryEntry } from "./scan-history"
import { consolidateHistoryChanges } from "./history-presentation"
import { VirtualRows } from "./DiskUtilityVirtualList"

function signedBytes(bytes: number) {
  return `${bytes > 0 ? "+" : bytes < 0 ? "−" : ""}${formatBytes(Math.abs(bytes))}`
}

export function DiskScanHistory(props: {
  entries: readonly ScanHistoryEntry[]
  filtered: boolean
  onClear: () => void
  onReveal?: (path: string) => void
}) {
  const language = useLanguage()
  const rows = useMemo(
    () => consolidateHistoryChanges(props.entries),
    [props.entries]
  )
  const growth = props.entries.reduce(
    (sum, entry) =>
      sum +
      entry.changes.reduce(
        (total, change) => total + Math.max(0, change.deltaBytes),
        0
      ),
    0
  )
  const shrink = props.entries.reduce(
    (sum, entry) =>
      sum +
      entry.changes.reduce(
        (total, change) => total + Math.max(0, -change.deltaBytes),
        0
      ),
    0
  )
  const aggregateOnly = rows.length > 0 && rows.every((row) => row.aggregate)
  const latest = rows[0]?.recordedAt
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {rows.length ? (
        <>
          <div className="shrink-0 px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-text-weak">
                  {language.t("disk.history.period")}
                </p>
                <p className="mt-2 text-3xl font-medium tracking-tight text-text-strong tabular-nums">
                  {signedBytes(
                    props.entries.reduce(
                      (sum, entry) => sum + entry.totalDeltaBytes,
                      0
                    )
                  )}
                </p>
              </div>
              <Button
                size="small"
                variant="ghost"
                onClick={props.onClear}
                aria-label={language.t("disk.history.clear")}
                title={language.t("disk.history.clear")}
              >
                <RotateCcw className="size-3.5 text-text-weaker" />
              </Button>
            </div>
            {aggregateOnly ? (
              <div className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-text-weak">
                <Activity className="mt-0.5 size-3.5 shrink-0 text-text-weaker" />
                <div>
                  <p>{language.t("disk.history.aggregate")}</p>
                  <time
                    className="mt-1 block text-[11px] text-text-weaker"
                    dateTime={new Date(latest).toISOString()}
                  >
                    {new Date(latest).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
              </div>
            ) : growth > 0 && shrink > 0 ? (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-weak">
                <span className="flex items-center gap-1.5">
                  <ArrowUpRight className="size-3.5 text-orange-300" />
                  {formatBytes(growth)} {language.t("disk.history.growth")}
                </span>
                <span className="flex items-center gap-1.5">
                  <ArrowDownRight className="size-3.5 text-emerald-400" />
                  {formatBytes(shrink)} {language.t("disk.history.shrink")}
                </span>
              </div>
            ) : null}
          </div>
          {!aggregateOnly && (
            <div className="px-5 pb-2 text-[11px] text-text-weaker">
              {language.plural("disk.count.item", rows.length)}
            </div>
          )}
          {!aggregateOnly && (
            <VirtualRows
              items={rows}
              ariaLabel={language.t("disk.history.list")}
              estimateSize={() => 76}
              itemKey={(row) => row.path}
              isFocusable={() => false}
              render={(row) => {
                const name = row.aggregate
                  ? language.t("disk.history.volume")
                  : row.name
                const Glyph = row.aggregate
                  ? Activity
                  : row.isDir
                    ? Folder
                    : File
                const content = (
                  <>
                    <Glyph className="mt-0.5 size-4 shrink-0 text-text-weaker" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-13-medium truncate text-text-strong">
                          {name}
                        </span>
                        <span
                          className={`text-13-semibold shrink-0 tabular-nums ${row.deltaBytes > 0 ? "text-orange-300" : row.deltaBytes < 0 ? "text-emerald-400" : "text-text-weak"}`}
                        >
                          {signedBytes(row.deltaBytes)}
                        </span>
                      </span>
                      <span
                        className="mt-1 block truncate text-xs text-text-weak"
                        title={row.path}
                      >
                        {row.aggregate
                          ? language.t("disk.history.aggregate")
                          : row.path.replace(/[\\/][^\\/]+$/, "") || row.path}
                      </span>
                      <span className="mt-1 flex items-center justify-between gap-3 text-[11px] text-text-weaker">
                        <span>
                          {language.t(`disk.history.kind.${row.kind}`)}
                        </span>
                        <time
                          dateTime={new Date(row.recordedAt).toISOString()}
                          title={new Date(row.recordedAt).toLocaleString()}
                        >
                          {new Date(row.recordedAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </span>
                    </span>
                  </>
                )
                const className =
                  "flex h-full w-full items-start gap-3 rounded-lg px-3 py-2 text-left"
                return row.kind !== "removed" &&
                  !row.aggregate &&
                  props.onReveal ? (
                  <button
                    className={`${className} hover:bg-surface-raised-base focus-visible:outline-2 focus-visible:outline-text-weak`}
                    onClick={() => props.onReveal?.(row.path)}
                    aria-label={language.t("disk.history.reveal", { name })}
                  >
                    {content}
                  </button>
                ) : (
                  <div className={className}>{content}</div>
                )
              }}
            />
          )}
        </>
      ) : (
        <div
          className="grid min-h-0 flex-1 place-items-center px-6 py-10 text-center"
          role="status"
        >
          <div className="max-w-xs">
            <Activity className="mx-auto size-6 text-text-weaker" />
            <p className="text-14-semibold mt-4 text-text-strong">
              {language.t(
                props.filtered
                  ? "disk.history.empty.filtered"
                  : "disk.history.empty.title"
              )}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-text-weak">
              {language.t("disk.history.empty.body")}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
