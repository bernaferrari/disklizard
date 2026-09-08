import { Button } from "@/components/dl/button"
import { Icon } from "@/components/dl/icon"
import { cn } from "@/lib/utils"
import { useMemo } from "react"
import { formatBytes, truncatePath } from "./format"
import { useLanguage } from "./runtime"
import type { ScanHistoryChange, ScanHistoryEntry } from "./scan-history"
import { VirtualRows } from "./DiskUtilityVirtualList"

type HistoryRow =
  | { type: "event"; key: string; entry: ScanHistoryEntry }
  | { type: "change"; key: string; change: ScanHistoryChange }

function signedBytes(bytes: number) {
  if (bytes === 0) return formatBytes(0)
  return `${bytes > 0 ? "+" : "−"}${formatBytes(Math.abs(bytes))}`
}

export function DiskScanHistory(props: {
  entries: readonly ScanHistoryEntry[]
  filtered: boolean
  onClear: () => void
}) {
  const language = useLanguage()
  const rows = useMemo<HistoryRow[]>(
    () =>
      props.entries.flatMap((entry) => [
        { type: "event" as const, key: `event:${entry.id}`, entry },
        ...entry.changes.map((change) => ({
          type: "change" as const,
          key: `change:${entry.id}:${change.path}`,
          change,
        })),
      ]),
    [props.entries],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {rows.length > 0 ? (
        <>
          <div className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-border-weaker-base px-4">
            <p className="text-12-regular text-text-weak">
              {language.t("disk.history.eventSummary", {
                events: language.plural("disk.count.event", props.entries.length),
                changes: language.plural(
                  "disk.count.change",
                  props.entries.reduce((total, entry) => total + entry.changes.length, 0),
                ),
              })}
            </p>
            <Button className="min-h-11 min-w-11" size="small" variant="ghost" onClick={props.onClear}>
              {language.t("disk.history.clear")}
            </Button>
          </div>
          <VirtualRows
            items={rows}
            ariaLabel={language.t("disk.history.list")}
            estimateSize={(row) => (row.type === "event" ? 48 : 68)}
            itemKey={(row) => row.key}
            isFocusable={(row) => row.type === "change"}
            render={(row) =>
              row.type === "event" ? (
                <div className="flex h-full items-end gap-3 px-4 pb-2 text-12-regular text-text-weaker">
                  <time dateTime={new Date(row.entry.recordedAt).toISOString()}>
                    {new Date(row.entry.recordedAt).toLocaleString()}
                  </time>
                  <span
                    className={cn(
                      "ml-auto tabular-nums",
                      row.entry.totalDeltaBytes !== 0 &&
                        "text-[color-mix(in_oklch,var(--dl-accent-strong)_54%,var(--text-strong))]",
                    )}
                  >
                    {language.t("disk.history.netValue", { value: signedBytes(row.entry.totalDeltaBytes) })}
                  </span>
                </div>
              ) : (
                <div className="mx-3 flex h-full items-center gap-3 border-b border-border-weaker-base px-2 py-2">
                  <span
                    className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-raised-base text-text-weak"
                    aria-hidden="true"
                  >
                    <Icon name={row.change.isDir ? "folder" : "code-lines"} className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-12-semibold text-text-strong">{row.change.name}</span>
                      <span className="shrink-0 rounded-full bg-surface-raised-base px-1.5 py-0.5 text-12-semibold text-text-weak">
                        {language.t(`disk.history.kind.${row.change.kind}`)}
                      </span>
                    </span>
                    <span
                      className="mt-1 block truncate font-mono text-12-regular text-text-weaker"
                      title={row.change.path}
                    >
                      {truncatePath(row.change.path, 92)}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-12-regular tabular-nums text-text-weak">
                    <span className="block text-12-semibold text-text-strong">{signedBytes(row.change.deltaBytes)}</span>
                    <span className="mt-0.5 block">
                      {formatBytes(row.change.beforeBytes)} <span aria-hidden="true">→</span>{" "}
                      {formatBytes(row.change.afterBytes)}
                    </span>
                  </span>
                </div>
              )
            }
          />
        </>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center px-6 py-10 text-center" role="status">
          <div className="max-w-xs">
            <span className="mx-auto grid size-11 place-items-center rounded-full bg-surface-raised-base text-text-weak">
              <Icon name="arrow-undo-down" className="size-4" />
            </span>
            <p className="mt-4 text-14-semibold text-text-strong">
              {props.filtered ? language.t("disk.history.empty.filtered") : language.t("disk.history.empty.title")}
            </p>
            <p className="mt-1.5 text-13-regular leading-relaxed text-text-weak">
              {language.t("disk.history.empty.body")}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
