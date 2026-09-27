import { useState } from "react"
import { Button } from "@/components/dl/button"
import { Icon } from "@/components/dl/icon"
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
  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent
        aria-labelledby="cleanup-results-title"
        showCloseButton={false}
        className="flex max-h-[min(720px,calc(100dvh-32px))] w-full max-w-[720px] flex-col gap-0 overflow-hidden rounded-2xl bg-surface-raised-strong p-0 sm:max-w-[720px]"
      >
        <div className="border-b border-border-weaker-base p-5">
          <h2
            id="cleanup-results-title"
            className="text-20-medium text-text-strong"
          >
            {language.t("disk.results.heading")}
          </h2>
          <p className="text-13-regular mt-1 text-text-weak">
            {language.t("disk.results.summary", {
              moved,
              failed,
              trash: props.trashName,
            })}
          </p>
          {props.needsRecheck ? (
            <p
              className="text-12-regular mt-3 rounded-md border border-icon-warning-base/35 bg-surface-warning-base/45 px-3 py-2 text-text-strong"
              role="status"
            >
              {language.t("disk.results.needsRecheck")}
            </p>
          ) : null}
        </div>
        <VirtualRows
          items={props.outcomes}
          ariaLabel={language.t("disk.results.heading")}
          estimateSize={() => 84}
          itemKey={(item) => item.node.path}
          render={(item) => {
            const identity = itemIdentity(item.node)
            const reason = cleanupFailureReason(item.error ?? "")
            return (
              <div className="mx-4 flex h-full min-w-0 items-center gap-3 border-b border-border-weaker-base py-2">
                <Icon
                  name={item.status === "moved" ? "circle-check" : "warning"}
                  className={
                    item.status === "moved"
                      ? "size-4 shrink-0 text-icon-success-base"
                      : "size-4 shrink-0 text-icon-warning-base"
                  }
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
                  onClick={() => setSelectedPath(item.node.path)}
                >
                  <span className="text-13-medium block truncate text-text-strong">
                    {identity.reviewTitle}
                  </span>
                  <span
                    className="text-12-regular block truncate font-mono text-text-weak"
                    title={item.node.path}
                  >
                    {item.node.path}
                  </span>
                  <span className="text-12-regular block text-text-weak">
                    {item.status === "moved"
                      ? language.t("disk.results.moved", {
                          trash: props.trashName,
                        })
                      : language.t(reason)}
                  </span>
                </button>
                {item.status === "failed" ? (
                  <Button
                    size="small"
                    variant="ghost"
                    className="min-h-11 min-w-11 shrink-0"
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
                ) : null}
              </div>
            )
          }}
        />
        {selected ? (
          <div className="border-t border-border-weaker-base bg-background-base/45 px-5 py-3">
            <p className="text-12-regular font-mono break-all text-text-weak">
              {selected.node.path}
            </p>
            {selected.error ? (
              <details className="text-12-regular mt-2 text-text-weak">
                <summary className="cursor-pointer">
                  {language.t("disk.results.technicalDetails")}
                </summary>
                <p className="mt-1 font-mono break-all">{selected.error}</p>
              </details>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border-weaker-base p-4">
          {moved > 0 ? (
            <Button size="small" variant="ghost" onClick={props.onOpenTrash}>
              {language.t("disk.toast.showTrash", { trash: props.trashName })}
            </Button>
          ) : null}
          {failed > 0 ? (
            <Button size="small" variant="secondary" onClick={props.onRescan}>
              {language.t("disk.common.rescan")}
            </Button>
          ) : null}
          {failed > 0 && props.onReviewFailures ? (
            <Button
              size="small"
              variant="secondary"
              onClick={props.onReviewFailures}
            >
              {language.t("disk.results.reviewFailures")}
            </Button>
          ) : null}
          <Button size="small" variant="primary" onClick={props.onClose}>
            {language.t("disk.common.complete")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
