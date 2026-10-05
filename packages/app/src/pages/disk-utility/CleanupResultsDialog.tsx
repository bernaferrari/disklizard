import { Button } from "@/components/ui/button"
import { useEffect, useId, useState } from "react"
import { Check, ChevronRight, TriangleAlert } from "lucide-react"
import { formatBytes } from "./format"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
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
  const detailsId = useId()
  useEffect(() => setSelectedPath(null), [props.open, props.outcomes])
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
        className="flex max-h-[min(640px,calc(100dvh-48px))] w-full max-w-[520px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[520px]"
      >
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-start gap-3">
            <span
              className={
                failed === 0
                  ? "grid size-10 shrink-0 place-items-center rounded-full bg-[var(--dl-positive-soft)] text-[var(--dl-positive)]"
                  : "grid size-10 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--dl-warning)_16%,transparent)] text-[var(--dl-warning)]"
              }
            >
              {failed === 0 ? (
                <Check className="size-5" strokeWidth={2.5} aria-hidden />
              ) : (
                <TriangleAlert className="size-5" strokeWidth={2} aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle id="cleanup-results-title">
                {language.t("disk.results.heading")}
              </DialogTitle>
              <p className="mt-1 text-[13px] leading-5 text-text-weak">
                {language.t(
                  failed === 0
                    ? "disk.results.allMoved"
                    : "disk.results.summary",
                  { moved, failed, trash: props.trashName }
                )}
              </p>
            </div>
          </div>
          {movedBytes > 0 ? (
            <dl className="mt-5 flex items-baseline justify-between gap-3">
              <dt className="text-[12px] text-text-weak">
                {language.t("disk.results.movedSize")}
              </dt>
              <dd className="text-[28px] leading-8 font-semibold tracking-[-0.035em] text-text-strong tabular-nums">
                {formatBytes(movedBytes)}
              </dd>
            </dl>
          ) : null}
          {props.needsRecheck ? (
            <p
              className="mt-4 rounded-lg bg-[var(--dl-well)] px-3.5 py-2.5 text-[12.5px] leading-[1.55] text-text-weak"
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
                <div
                  className={
                    "mx-3 flex h-full min-w-0 items-center gap-3 rounded-lg px-3 hover:bg-[var(--dl-row-hover)]" +
                    (selectedPath === item.node.path
                      ? " bg-[var(--dl-well)]"
                      : "")
                  }
                >
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
                    aria-expanded={selectedPath === item.node.path}
                    aria-controls={
                      selectedPath === item.node.path ? detailsId : undefined
                    }
                    onClick={() =>
                      setSelectedPath((current) =>
                        current === item.node.path ? null : item.node.path
                      )
                    }
                  >
                    <span className="flex items-center gap-1.5 text-[13px] font-medium text-text-strong">
                      <span className="truncate">{identity.reviewTitle}</span>
                      <ChevronRight
                        className={
                          "size-3 shrink-0 text-text-weak " +
                          (selectedPath === item.node.path ? "rotate-90" : "")
                        }
                        aria-hidden
                      />
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
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
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
                    </Button>
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
        {selected ? (
          <div
            id={detailsId}
            className="max-h-36 shrink-0 overflow-y-auto border-b border-[var(--dl-separator)] px-6 py-3"
          >
            <p className="text-[12px] font-medium text-text-strong">
              {language.t("disk.results.originalLocation")}
            </p>
            <p className="mt-1 font-mono text-[11px] break-all text-text-weak select-text">
              {selected.node.path}
            </p>
            {selected.error ? (
              <details className="mt-2 text-[12px] text-text-weak">
                <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]">
                  {language.t("disk.results.technicalDetails")}
                </summary>
                <p className="mt-1 font-mono break-all select-text">
                  {selected.error}
                </p>
              </details>
            ) : null}
          </div>
        ) : null}
        <DialogFooter className="flex-row flex-wrap items-center gap-2 px-6 py-4">
          {moved > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="mr-auto"
              onClick={props.onOpenTrash}
            >
              {language.t("disk.toast.showTrash", { trash: props.trashName })}
            </Button>
          ) : null}
          {failed > 0 && props.onReviewFailures ? (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={props.onReviewFailures}
            >
              {language.t("disk.results.reviewFailures")}
            </Button>
          ) : null}
          {failed > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              onClick={props.onRescan}
            >
              {language.t("disk.common.rescan")}
            </Button>
          ) : null}
          <Button
            type="button"
            size="lg"
            className="px-5"
            onClick={props.onClose}
          >
            {language.t("disk.common.complete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
