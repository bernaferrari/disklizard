import { useState } from "react"
import { Check, TriangleAlert } from "lucide-react"
import { formatBytes } from "./format"
import { primaryButton, quietButton } from "./ExplorerChrome"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import type { DiskScanNode } from "./types"
import { itemIdentity } from "./item-identity"
import { VirtualRows } from "./DiskUtilityVirtualList"
import { useLanguage, type DiskLanguageKey } from "./runtime"

export type CleanupOutcome = {
  node: DiskScanNode
  status: "moved" | "failed"
  error?: string
}

export function cleanupFailureReason(error: string): DiskLanguageKey {
  if (/EACCES|EPERM|access denied|permission denied/i.test(error))
    return "disk.results.accessDenied"
  if (/EROFS|read.only/i.test(error)) return "disk.results.readOnly"
  if (/changed|expired|active scan|rescan|identity/i.test(error))
    return "disk.results.changed"
  if (/trash|recycle bin/i.test(error)) return "disk.results.trashUnavailable"
  return "disk.results.failed"
}

export function CleanupResultsDialog(props: {
  open: boolean
  outcomes: CleanupOutcome[]
  needsRecheck: boolean
  trashName: string
  onClose: () => void
  onReveal: (node: DiskScanNode) => void
  onRescan: () => void
  onOpenTrash: () => void
  onReviewFailures?: () => void
}) {
  const language = useLanguage()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const moved = props.outcomes.filter((item) => item.status === "moved").length
  const failed = props.outcomes.length - moved
  const selected = props.outcomes.find(
    (item) => item.node.path === selectedPath
  )
  const movedBytes = props.outcomes
    .filter((item) => item.status === "moved")
    .reduce((sum, item) => sum + item.node.size, 0)
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        aria-labelledby="cleanup-results-title"
        showCloseButton={false}
        className="flex max-h-[min(640px,calc(100dvh-48px))] w-full max-w-[520px] flex-col gap-0 overflow-hidden rounded-2xl border-0 bg-[var(--dl-popover)] p-0 shadow-[0_0_0_0.5px_rgb(255_255_255/0.1),0_30px_90px_rgb(0_0_0/0.5)] ring-0 sm:max-w-[520px]"
      >
        <div className="flex flex-col items-center px-6 pt-8 pb-5 text-center">
          <span
            className={
              failed === 0
                ? "grid size-14 place-items-center rounded-full bg-[var(--dl-positive-soft)] text-[var(--dl-positive)]"
                : "grid size-14 place-items-center rounded-full bg-[color-mix(in_oklch,var(--dl-warning)_16%,transparent)] text-[var(--dl-warning)]"
            }
          >
            {failed === 0 ? (
              <Check className="size-7" strokeWidth={2.5} aria-hidden />
            ) : (
              <TriangleAlert className="size-6" strokeWidth={2} aria-hidden />
            )}
          </span>
          {movedBytes > 0 ? (
            <div className="mt-4">
              <p className="text-[32px] leading-none font-semibold tracking-[-0.035em] text-text-strong tabular-nums">
                {formatBytes(movedBytes)}
              </p>
              <p className="mt-1.5 text-[12px] text-text-weak">
                {language.t("disk.results.movedSize")}
              </p>
            </div>
          ) : null}
          <h2
            id="cleanup-results-title"
            className={
              movedBytes > 0
                ? "mt-2 text-[14px] font-medium text-text-weak"
                : "mt-4 text-[18px] font-semibold text-text-strong"
            }
          >
            {language.t("disk.results.heading")}
          </h2>
          <p className="mt-1 max-w-[40ch] text-[12.5px] text-text-weak">
            {language.t(
              failed === 0 ? "disk.results.allMoved" : "disk.results.summary",
              {
                moved,
                failed,
                trash: props.trashName,
              }
            )}
          </p>
          {props.needsRecheck ? (
            <p
              className="mt-3 rounded-lg bg-[color-mix(in_oklch,var(--dl-warning)_10%,transparent)] px-3 py-2 text-[12px] text-text-base"
              role="status"
            >
              {language.t("disk.results.needsRecheck")}
            </p>
          ) : null}
        </div>
        <div
          className="flex min-h-[64px] shrink flex-col border-y border-[var(--dl-separator)]"
          style={{ height: Math.min(props.outcomes.length * 52 + 18, 300) }}
        >
          <VirtualRows
            items={props.outcomes}
            ariaLabel={language.t("disk.results.heading")}
            estimateSize={() => 52}
            itemKey={(item) => item.node.path}
            render={(item) => {
              const identity = itemIdentity(item.node)
              const reason = cleanupFailureReason(item.error ?? "")
              return (
                <div className="mx-3 flex h-full min-w-0 items-center gap-3 rounded-lg px-3 hover:bg-[var(--dl-row-hover)]">
                  {item.status === "moved" ? (
                    <Check
                      className="size-4 shrink-0 text-[var(--dl-positive)]"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  ) : (
                    <TriangleAlert
                      className="size-4 shrink-0 text-[var(--dl-warning)]"
                      aria-hidden
                    />
                  )}
                  <button
                    type="button"
                    className="h-full min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] focus-visible:ring-inset"
                    title={item.node.path}
                    onClick={() => setSelectedPath(item.node.path)}
                  >
                    <span className="block truncate text-[13px] font-medium text-text-strong">
                      {identity.reviewTitle}
                    </span>
                    <span className="block truncate text-[11.5px] text-text-weak">
                      {item.status === "moved"
                        ? language.t("disk.results.moved", {
                            trash: props.trashName,
                          })
                        : language.t(reason)}
                    </span>
                  </button>
                  {item.status === "failed" ? (
                    <button
                      type="button"
                      className="h-8 shrink-0 rounded-md bg-[var(--dl-well)] px-2.5 text-[12px] font-medium text-text-strong outline-none hover:bg-[var(--dl-well-strong)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
                      onClick={
                        reason === "disk.results.changed"
                          ? props.onRescan
                          : () => props.onReveal(item.node)
                      }
                    >
                      {language.t(
                        reason === "disk.results.changed"
                          ? "disk.common.rescan"
                          : "disk.common.reveal"
                      )}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[12.5px] text-text-weak tabular-nums">
                      {formatBytes(item.node.size)}
                    </span>
                  )}
                </div>
              )
            }}
          />
        </div>
        {selected?.error ? (
          <div className="border-b border-[var(--dl-separator)] px-6 py-3">
            <p className="font-mono text-[11px] break-all text-text-weak">
              {selected.node.path}
            </p>
            <details className="mt-2 text-[12px] text-text-weak">
              <summary className="cursor-pointer">
                {language.t("disk.results.technicalDetails")}
              </summary>
              <p className="mt-1 font-mono break-all">{selected.error}</p>
            </details>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2 px-6 py-4">
          {moved > 0 ? (
            <button
              type="button"
              className={quietButton + " mr-auto h-9"}
              onClick={props.onOpenTrash}
            >
              {language.t("disk.toast.showTrash", { trash: props.trashName })}
            </button>
          ) : null}
          {failed > 0 && props.onReviewFailures ? (
            <button
              type="button"
              className={quietButton + " h-9"}
              onClick={props.onReviewFailures}
            >
              {language.t("disk.results.reviewFailures")}
            </button>
          ) : null}
          {failed > 0 ? (
            <button
              type="button"
              className={quietButton + " h-9"}
              onClick={props.onRescan}
            >
              {language.t("disk.common.rescan")}
            </button>
          ) : null}
          <button
            type="button"
            className={primaryButton + " h-9 px-5"}
            onClick={props.onClose}
          >
            {language.t("disk.common.complete")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
