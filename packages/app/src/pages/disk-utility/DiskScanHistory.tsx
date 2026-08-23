import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, Show } from "solid-js"
import { formatBytes, formatCount, truncatePath } from "./format"
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
  const rows = createMemo<HistoryRow[]>(() =>
    props.entries.flatMap((entry) => [
      { type: "event" as const, key: `event:${entry.id}`, entry },
      ...entry.changes.map((change) => ({
        type: "change" as const,
        key: `change:${entry.id}:${change.path}`,
        change,
      })),
    ]),
  )

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Show
        when={rows().length > 0}
        fallback={
          <div class="grid min-h-0 flex-1 place-items-center px-6 py-10 text-center" role="status">
            <div class="max-w-xs">
              <span class="mx-auto grid size-11 place-items-center rounded-full bg-surface-raised-base text-text-weak">
                <Icon name="arrow-undo-down" class="size-4" />
              </span>
              <p class="mt-4 text-14-semibold text-text-strong">
                {props.filtered ? language.t("disk.history.empty.filtered") : language.t("disk.history.empty.title")}
              </p>
              <p class="mt-1.5 text-13-regular leading-relaxed text-text-weak">
                {language.t("disk.history.empty.body")}
              </p>
            </div>
          </div>
        }
      >
        <div class="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-border-weaker-base px-4">
          <p class="text-12-regular text-text-weak">
            {language.t("disk.history.eventSummary", {
              events: language.plural("disk.count.event", props.entries.length),
              changes: language.plural(
                "disk.count.change",
                props.entries.reduce((total, entry) => total + entry.changes.length, 0),
              ),
            })}
          </p>
          <Button class="dl-touch-target" size="small" variant="ghost" onClick={props.onClear}>
            {language.t("disk.history.clear")}
          </Button>
        </div>
        <VirtualRows
          items={rows()}
          ariaLabel={language.t("disk.history.list")}
          estimateSize={(row) => (row.type === "event" ? 48 : 68)}
          itemKey={(row) => row.key}
          isFocusable={(row) => row.type === "change"}
          render={(row) =>
            row.type === "event" ? (
              <div class="flex h-full items-end gap-3 px-4 pb-2 text-12-regular text-text-weaker">
                <time dateTime={new Date(row.entry.recordedAt).toISOString()}>
                  {new Date(row.entry.recordedAt).toLocaleString()}
                </time>
                <span class="ml-auto tabular-nums" classList={{ "dl-accent-text": row.entry.totalDeltaBytes !== 0 }}>
                  {language.t("disk.history.netValue", { value: signedBytes(row.entry.totalDeltaBytes) })}
                </span>
              </div>
            ) : (
              <div class="mx-3 flex h-full items-center gap-3 border-b border-border-weaker-base px-2 py-2">
                <span
                  class="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-raised-base text-text-weak"
                  aria-hidden="true"
                >
                  <Icon name={row.change.isDir ? "folder" : "code-lines"} class="size-3.5" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="truncate text-12-semibold text-text-strong">{row.change.name}</span>
                    <span class="shrink-0 rounded-full bg-surface-raised-base px-1.5 py-0.5 text-12-semibold text-text-weak">
                      {language.t(`disk.history.kind.${row.change.kind}`)}
                    </span>
                  </span>
                  <span class="mt-1 block truncate font-mono text-12-regular text-text-weaker" title={row.change.path}>
                    {truncatePath(row.change.path, 92)}
                  </span>
                </span>
                <span class="shrink-0 text-right text-12-regular tabular-nums text-text-weak">
                  <span class="block text-12-semibold text-text-strong">{signedBytes(row.change.deltaBytes)}</span>
                  <span class="mt-0.5 block">
                    {formatBytes(row.change.beforeBytes)} <span aria-hidden="true">→</span>{" "}
                    {formatBytes(row.change.afterBytes)}
                  </span>
                </span>
              </div>
            )
          }
        />
      </Show>
    </div>
  )
}
