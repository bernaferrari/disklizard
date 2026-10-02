import {
  Check,
  Copy,
  Eye,
  File as FileIcon,
  Folder,
  FolderSearch,
  RotateCcw,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react"
import { Button } from "@/components/dl/button"
import { Icon } from "@/components/dl/icon"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { useEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { DiskScanNode } from "./types"
import { formatBytes, shortBytes, truncatePath } from "./format"
import { Spin } from "./motion-ui"
import {
  recognize,
  type Recognition,
  type ReclaimSummary,
  type Safety,
} from "./recognize"
import { SAFETY_ACCENT } from "./ui-tokens"
import { VirtualRows } from "./DiskUtilityVirtualList"
import { useLanguage, type DiskLanguageKey } from "./runtime"
import { distinguishingPathLabels, itemIdentity } from "./item-identity"

const SAFETY_LABEL = {
  regenerable: "disk.safety.regenerable",
  cache: "disk.safety.cache",
  logs: "disk.safety.logs",
  trash: "disk.safety.trash",
  media: "disk.safety.media",
  "version-control": "disk.safety.versionControl",
  system: "disk.safety.system",
  unknown: "disk.safety.unknown",
} as const satisfies Record<Safety, DiskLanguageKey>

export type DeletionProgress = { completed: number; total: number }
type ReclaimReviewRow =
  | { type: "header"; key: string; bucket: ReclaimSummary["buckets"][number] }
  | {
      type: "item"
      key: string
      item: ReclaimSummary["buckets"][number]["items"][number]
      first: boolean
      last: boolean
    }

/**
 * Bridge while index.tsx migrates these surfaces from the `phase` machine to a
 * boolean `open`: prefer `open`; otherwise derive it from the v1 phase.
 */
export function CleanupProtectionsResetDialog(props: {
  open: boolean
  onClose: () => void
  onReset: () => Promise<boolean>
}) {
  const language = useLanguage()
  const [step, setStep] = useState<"review" | "confirm">("review")
  const [resetting, setResetting] = useState(false)
  const [failed, setFailed] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const focusFinalAction = () => {
    queueMicrotask(() =>
      panelRef.current
        ?.querySelector<HTMLElement>("[data-reset-confirm]")
        ?.focus({ preventScroll: true })
    )
  }

  useEffect(() => {
    if (step === "confirm") focusFinalAction()
  }, [step])

  const close = () => {
    if (!resetting) props.onClose()
  }

  const reset = async () => {
    if (step !== "confirm" || resetting) return
    setFailed(false)
    setResetting(true)
    const ok = await props.onReset()
    setResetting(false)
    if (ok) {
      props.onClose()
      return
    }
    setFailed(true)
    focusFinalAction()
  }

  const open = props.open
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
      }}
    >
      <DialogContent
        role="alertdialog"
        aria-labelledby="cleanup-reset-title"
        aria-describedby="cleanup-reset-description"
        aria-busy={resetting ? "true" : undefined}
        showCloseButton={false}
        ref={panelRef}
        initialFocus={() =>
          panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ??
          panelRef.current
        }
        className="block w-full max-w-md gap-0 rounded-2xl border-0 bg-[var(--dl-popover)] p-5 shadow-[0_0_0_0.5px_rgb(255_255_255/0.1),0_30px_90px_rgb(0_0_0/0.5)] ring-0 sm:max-w-md"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklch,var(--dl-danger)_14%,transparent)] text-[var(--dl-danger)]">
            <Icon name="shield" className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium text-text-weak">
              {language.t("disk.cleanup.resetHeading")}
            </p>
            <h2
              id="cleanup-reset-title"
              className="text-18-medium mt-1 tracking-[-0.025em] text-text-strong"
            >
              {language.t(
                step === "review"
                  ? "disk.cleanup.resetTitle"
                  : "disk.cleanup.resetFinalTitle"
              )}
            </h2>
            <div
              id="cleanup-reset-description"
              className="text-13-regular mt-3 leading-relaxed text-text-weak"
              role={failed ? "alert" : "status"}
              aria-live={step === "confirm" || failed ? "assertive" : "polite"}
              aria-atomic="true"
            >
              <p>
                {language.t(
                  step === "review"
                    ? "disk.cleanup.resetBody"
                    : "disk.cleanup.resetFinalBody"
                )}
              </p>
              {failed ? (
                <p className="mt-3 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-text-strong">
                  <span className="text-13-semibold">
                    {language.t("disk.cleanup.resetFailedTitle")}.{" "}
                  </span>
                  {language.t("disk.cleanup.resetFailed")}
                </p>
              ) : null}
              {resetting ? (
                <p className="mt-3 flex items-center gap-2 text-text-strong">
                  <Spin className="size-3.5 rounded-full border border-[var(--dl-separator)] border-t-current" />
                  {language.t("disk.cleanup.resetting")}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            data-autofocus
            className="min-h-8 min-w-8"
            size="small"
            variant="ghost"
            disabled={resetting}
            onClick={close}
          >
            {language.t("disk.cleanup.resetCancel")}
          </Button>
          {step === "confirm" ? (
            <Button
              data-reset-confirm
              className="min-h-8 min-w-8 text-[color-mix(in_oklch,oklch(0.62_0.2_25)_50%,var(--text-strong))]"
              size="small"
              variant="primary"
              icon="reset"
              disabled={resetting}
              onClick={() => void reset()}
            >
              {resetting
                ? language.t("disk.cleanup.resetting")
                : language.t("disk.cleanup.resetConfirm")}
            </Button>
          ) : (
            <Button
              className="min-h-8 min-w-8"
              size="small"
              variant="secondary"
              onClick={() => setStep("confirm")}
            >
              {language.t("disk.cleanup.resetContinue")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CollectionDialog(props: {
  open: boolean
  items: DiskScanNode[]
  recognitionFor?: (node: DiskScanNode) => Recognition
  bytes: number
  hasSharedPhysicalStorage: boolean
  hasUnverifiedPhysicalStorage: boolean
  hasUnobservedContents: boolean
  /** Deep-index entries are not materialized map nodes, so removal needs a full fresh map. */
  requiresDeepInventoryRefresh: boolean
  deleting: boolean
  progress: DeletionProgress | null
  trashName: string
  onClose: () => void
  onRemove: (node: DiskScanNode) => void
  onQuickLook?: (node: DiskScanNode) => void
  onPreview: (node: DiskScanNode) => void
  onReveal: (node: DiskScanNode) => void
  onConfirm: () => void
}) {
  const language = useLanguage()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [acknowledgedPartialScan, setAcknowledgedPartialScan] = useState(false)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [copyFailedPath, setCopyFailedPath] = useState<string | null>(null)
  useEffect(() => {
    if (!copiedPath) return undefined
    const timeout = setTimeout(() => setCopiedPath(null), 1500)
    return () => clearTimeout(timeout)
  }, [copiedPath])
  useEffect(() => {
    if (!props.open) {
      setCopiedPath(null)
      setCopyFailedPath(null)
    }
  }, [props.open])
  const coverageKey = props.items.map((item) => item.path).join("\u0000")
  useEffect(() => setAcknowledgedPartialScan(false), [props.open, coverageKey])
  const sortedItems = useMemo(
    () => props.items.toSorted((a, b) => b.size - a.size),
    [props.items]
  )
  const locations = useMemo(
    () => distinguishingPathLabels(props.items.map((item) => item.path)),
    [props.items]
  )
  const summary = language.t("disk.dialog.collection.summary", {
    count: language.plural("disk.count.item", props.items.length),
    size: formatBytes(props.bytes),
  })
  const open = props.open
  const cautious =
    props.requiresDeepInventoryRefresh ||
    props.hasSharedPhysicalStorage ||
    props.hasUnverifiedPhysicalStorage
  const blocked =
    props.deleting || (props.hasUnobservedContents && !acknowledgedPartialScan)
  const iconAction =
    "grid size-8 place-items-center rounded-md text-text-weak outline-none transition-colors hover:bg-[var(--dl-well-strong)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] disabled:opacity-40"
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose()
      }}
    >
      <DialogContent
        aria-labelledby="collection-title"
        showCloseButton={false}
        ref={panelRef}
        initialFocus={() => panelRef.current}
        className="flex max-h-[min(720px,calc(100dvh-48px))] w-full max-w-[600px] flex-col gap-0 overflow-hidden rounded-2xl border-0 bg-[var(--dl-popover)] p-0 shadow-[0_0_0_0.5px_rgb(255_255_255/0.1),0_30px_90px_rgb(0_0_0/0.5)] ring-0 sm:max-w-[600px]"
      >
        <span className="sr-only" role="status">
          {copyFailedPath
            ? language.t("disk.dialog.collection.copyFailed")
            : copiedPath
              ? language.t("disk.dialog.collection.copied")
              : ""}
        </span>
        <div className="flex items-start gap-4 px-6 pt-6 pb-4">
          <div className="min-w-0 flex-1">
            <h2
              id="collection-title"
              className="text-[20px] leading-6 font-semibold tracking-[-0.02em] text-text-strong"
            >
              {language.t("disk.dialog.collection.heading")}
            </h2>
            <p className="mt-2 text-[13px] text-text-weak">
              {cautious || props.hasUnobservedContents
                ? language.t("disk.dialog.collection.selectedSizes", {
                    summary,
                  })
                : summary}
            </p>
            <p className="sr-only">
              {language.t("disk.dialog.collection.body")}
            </p>
          </div>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-full text-text-weak outline-none hover:bg-[var(--dl-well-strong)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] disabled:opacity-40"
            disabled={props.deleting}
            onClick={props.onClose}
            aria-label={language.t("disk.dialog.collection.close")}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {props.requiresDeepInventoryRefresh ||
        props.hasSharedPhysicalStorage ||
        props.hasUnverifiedPhysicalStorage ||
        props.hasUnobservedContents ? (
          <div
            className={cn(
              "mx-6 mb-4 shrink-0 overflow-hidden rounded-xl text-[12px] leading-relaxed text-text-weak",
              props.hasUnobservedContents
                ? "bg-[color-mix(in_oklch,var(--dl-warning)_9%,transparent)] shadow-[inset_0_0_0_0.5px_color-mix(in_oklch,var(--dl-warning)_35%,transparent)]"
                : "bg-[var(--dl-well)]"
            )}
          >
            {props.requiresDeepInventoryRefresh ||
            props.hasSharedPhysicalStorage ||
            props.hasUnverifiedPhysicalStorage ? (
              <div className="px-3.5 py-2.5">
                {props.requiresDeepInventoryRefresh ? (
                  <>
                    <p className="text-[12.5px] font-medium text-text-strong">
                      {language.t("disk.dialog.collection.deepWarningSummary")}
                    </p>
                    <p className="mt-0.5">
                      {language.t("disk.dialog.collection.deepWarning", {
                        trash: props.trashName,
                      })}
                    </p>
                  </>
                ) : props.hasSharedPhysicalStorage ? (
                  <p>
                    {language.t("disk.dialog.collection.sharedWarning", {
                      trash: props.trashName,
                    })}
                  </p>
                ) : (
                  <p>
                    {language.t("disk.dialog.collection.unverifiedWarning", {
                      trash: props.trashName,
                    })}
                  </p>
                )}
              </div>
            ) : null}
            {props.hasUnobservedContents ? (
              <label
                className={
                  "flex cursor-pointer items-start gap-2.5 px-3.5 py-2.5 " +
                  (cautious
                    ? "border-t border-[color-mix(in_oklch,var(--dl-warning)_25%,transparent)]"
                    : "")
                }
              >
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-[var(--dl-accent)]"
                  checked={acknowledgedPartialScan}
                  disabled={props.deleting}
                  onChange={(event) =>
                    setAcknowledgedPartialScan(event.currentTarget.checked)
                  }
                />
                <span>
                  <span className="block">
                    {language.t("disk.review.partialWarning")}
                  </span>
                  <span className="mt-1 block font-medium text-text-strong">
                    {language.t("disk.review.partialAcknowledge", {
                      trash: props.trashName,
                    })}
                  </span>
                </span>
              </label>
            ) : null}
          </div>
        ) : null}

        <div
          className="flex min-h-[112px] shrink flex-col border-y border-[var(--dl-separator)]"
          style={{ height: Math.min(props.items.length * 56 + 18, 460) }}
        >
          <VirtualRows
            items={sortedItems}
            ariaLabel={language.t("disk.dialog.collection.itemsLabel")}
            estimateSize={() => 56}
            itemKey={(item) => item.path}
            render={(item) => {
              const recognition =
                props.recognitionFor?.(item) ?? recognize(item)
              const identity = itemIdentity(item)
              const hint = recognition.hint
                ? language.t(recognition.hint)
                : undefined
              return (
                <div className="group mx-3 flex h-full items-center gap-3 rounded-lg px-3 hover:bg-[var(--dl-row-hover)]">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--dl-well)] text-text-weak">
                    {item.isDir ? (
                      <Folder
                        className="size-4"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    ) : (
                      <FileIcon
                        className="size-4"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                    )}
                  </span>
                  <span
                    className="min-w-0 flex-1"
                    title={hint ? `${item.path}\n${hint}` : item.path}
                  >
                    <span className="block truncate text-[13.5px] font-medium text-text-strong">
                      {identity.reviewTitle}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-text-weak">
                      <span className="hidden sm:inline">{item.path}</span>
                      <span className="sm:hidden">
                        {locations.get(item.path) ?? item.path}
                      </span>
                    </span>
                    {recognition.tag ? (
                      <span className="sr-only">
                        {language.t(recognition.tag)}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center opacity-0 transition-opacity group-focus-within/review-row:opacity-100 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                    {!item.isOther && !item.isHidden ? (
                      <>
                        <button
                          type="button"
                          className={iconAction}
                          disabled={props.deleting}
                          aria-label={language.t(
                            props.onQuickLook
                              ? "disk.dialog.collection.quickLook"
                              : "disk.dialog.collection.preview",
                            {
                              name:
                                locations.get(item.path) ??
                                identity.reviewTitle,
                            }
                          )}
                          title={language.t(
                            props.onQuickLook
                              ? "disk.dialog.collection.quickLook"
                              : "disk.dialog.collection.preview",
                            {
                              name:
                                locations.get(item.path) ??
                                identity.reviewTitle,
                            }
                          )}
                          onClick={() =>
                            props.onQuickLook
                              ? props.onQuickLook(item)
                              : props.onPreview(item)
                          }
                        >
                          <Eye className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={iconAction}
                          disabled={props.deleting}
                          aria-label={language.t(
                            "disk.dialog.collection.reveal",
                            {
                              name:
                                locations.get(item.path) ??
                                identity.reviewTitle,
                            }
                          )}
                          title={language.t("disk.dialog.collection.reveal", {
                            name:
                              locations.get(item.path) ?? identity.reviewTitle,
                          })}
                          onClick={() => props.onReveal(item)}
                        >
                          <FolderSearch className="size-3.5" aria-hidden />
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className={iconAction}
                      aria-label={language.t(
                        copyFailedPath === item.path
                          ? "disk.dialog.collection.copyFailed"
                          : copiedPath === item.path
                            ? "disk.dialog.collection.copied"
                            : "disk.dialog.collection.copyPath"
                      )}
                      title={language.t(
                        copyFailedPath === item.path
                          ? "disk.dialog.collection.copyFailed"
                          : copiedPath === item.path
                            ? "disk.dialog.collection.copied"
                            : "disk.dialog.collection.copyPath"
                      )}
                      onClick={() => {
                        if (!navigator.clipboard) {
                          setCopyFailedPath(item.path)
                          setCopiedPath(null)
                          return
                        }
                        void navigator.clipboard.writeText(item.path).then(
                          () => {
                            setCopiedPath(item.path)
                            setCopyFailedPath(null)
                          },
                          () => {
                            setCopyFailedPath(item.path)
                            setCopiedPath(null)
                          }
                        )
                      }}
                    >
                      {copyFailedPath === item.path ? (
                        <TriangleAlert
                          className="size-3.5 text-[var(--dl-warning)]"
                          aria-hidden
                        />
                      ) : copiedPath === item.path ? (
                        <Check className="size-3.5" aria-hidden />
                      ) : (
                        <Copy className="size-3.5" aria-hidden />
                      )}
                    </button>
                  </span>
                  <span className="w-16 shrink-0 text-right text-[13px] text-text-base tabular-nums">
                    {shortBytes(item.size)}
                  </span>
                  <button
                    type="button"
                    className={iconAction}
                    disabled={props.deleting}
                    aria-label={language.t("disk.dialog.collection.remove", {
                      name: locations.get(item.path) ?? identity.reviewTitle,
                    })}
                    title={language.t("disk.dialog.collection.remove", {
                      name: locations.get(item.path) ?? identity.reviewTitle,
                    })}
                    onClick={() => props.onRemove(item)}
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </div>
              )
            }}
          />
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3 px-6 py-4">
          {props.progress ? (
            <div
              className="flex min-w-0 flex-1 items-center gap-2 text-[12.5px] text-text-weak tabular-nums"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <Spin className="size-3.5 rounded-full border-2 border-[var(--dl-well-strong)] border-t-[var(--dl-accent)]" />
              {language.t("disk.dialog.collection.moving", {
                current: props.progress.completed,
                total: props.progress.total,
              })}
              …
            </div>
          ) : (
            <p className="flex min-w-0 flex-1 items-center gap-2 text-[12px] leading-snug text-text-weak">
              <RotateCcw className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0">
                {props.requiresDeepInventoryRefresh
                  ? language.t("disk.dialog.restore.rebuild", {
                      trash: props.trashName,
                    })
                  : cautious
                    ? language.t("disk.dialog.restore.recompute", {
                        trash: props.trashName,
                      })
                    : language.t("disk.dialog.restore.space", {
                        trash: props.trashName,
                      })}
              </span>
            </p>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center rounded-lg px-3.5 text-[13px] font-medium text-text-strong outline-none hover:bg-[var(--dl-well-strong)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] disabled:opacity-40"
              disabled={props.deleting}
              onClick={props.onClose}
            >
              {language.t("disk.common.back")}
            </button>
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--dl-danger-action)] px-4 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.3)] transition-[background-color,transform] outline-none hover:bg-[var(--dl-danger-action-hover)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
              disabled={blocked}
              onClick={props.onConfirm}
            >
              <Trash2 className="size-4" aria-hidden />
              {props.progress
                ? language.t("disk.dialog.collection.movingCompact", {
                    current: props.progress.completed,
                    total: props.progress.total,
                  })
                : language.t("disk.detail.moveTo", { trash: props.trashName })}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ReclaimDrawer(props: {
  open: boolean
  reclaim: () => ReclaimSummary
  onClose: () => void
  onCollectAll: () => void
  onToggle: (node: DiskScanNode) => void
  isSelected: (node: DiskScanNode) => boolean
  onInspect: (node: DiskScanNode) => void
  deleting: boolean
}) {
  const language = useLanguage()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const rows = useMemo<ReclaimReviewRow[]>(
    () =>
      props.reclaim().buckets.flatMap((bucket) => [
        { type: "header" as const, key: `header:${bucket.safety}`, bucket },
        ...bucket.items.map((item, index) => ({
          type: "item" as const,
          key: `item:${item.node.path}`,
          item,
          first: index === 0,
          last: index === bucket.items.length - 1,
        })),
      ]),
    [props.reclaim]
  )

  const open = props.open
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose()
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        aria-labelledby="reclaim-title"
        ref={panelRef}
        initialFocus={() => panelRef.current}
        className="gap-0 overflow-hidden rounded-2xl border-0 bg-[var(--dl-popover)] shadow-[0_0_0_0.5px_rgb(255_255_255/0.1),0_30px_90px_rgb(0_0_0/0.5)] data-[side=right]:inset-y-2 data-[side=right]:right-2 data-[side=right]:h-auto data-[side=right]:w-[calc(100%-16px)] data-[side=right]:max-w-md data-[side=right]:border-l-0 data-[side=right]:sm:max-w-md"
      >
        <div className="shrink-0 border-b border-[var(--dl-separator)] px-5 pt-5 pb-5">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--dl-well)] text-text-weak">
              <Icon name="shield" className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-text-weak">
                {language.t("disk.common.recommendations")}
              </p>
              <h2
                id="reclaim-title"
                className="text-20-medium mt-1 tracking-[-0.03em] text-text-strong"
              >
                {language.t("disk.dialog.reclaim.summary", {
                  count: formatBytes(props.reclaim().totalBytes),
                })}
              </h2>
              <p className="text-13-regular mt-2 max-w-[38ch] leading-relaxed text-text-weak">
                {language.t("disk.dialog.reclaim.body")}
              </p>
            </div>
            <Button
              className="min-h-8 min-w-8"
              size="small"
              variant="ghost"
              icon="close"
              onClick={props.onClose}
              aria-label={language.t("disk.dialog.reclaim.close")}
            />
          </div>
        </div>
        <VirtualRows
          items={rows}
          ariaLabel={language.t("disk.dialog.reclaim.itemsLabel")}
          estimateSize={(row) => (row.type === "header" ? 46 : 64)}
          itemKey={(row) => row.key}
          isFocusable={(row) => row.type === "item"}
          render={(row) => {
            if (row.type === "header") {
              return (
                <div className="flex h-full items-end gap-2 px-5 pb-2">
                  <span
                    className={`mb-0.5 size-2 rounded-full ${SAFETY_ACCENT[row.bucket.safety].dot}`}
                  />
                  <h3 className="text-13-semibold tracking-[0.14em] text-text-weak uppercase">
                    {language.t(SAFETY_LABEL[row.bucket.safety])}
                  </h3>
                  <span className="text-13-semibold ml-auto text-text-strong tabular-nums">
                    {formatBytes(row.bucket.bytes)}
                  </span>
                </div>
              )
            }
            return (
              <div
                className={cn(
                  "mx-4 flex h-full items-center gap-3 border-b border-[var(--dl-separator)] bg-background-base px-3 py-2",
                  row.first && "rounded-t-xl",
                  row.last &&
                    "rounded-b-xl border-b-0 shadow-[0_4px_16px_rgb(0_0_0/0.04)]"
                )}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-raised-base text-text-weak">
                  <Icon
                    name={row.item.node.isDir ? "folder" : "code-lines"}
                    className="size-3.5"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-12-semibold truncate text-text-strong">
                    {row.item.node.name}
                  </p>
                  <p
                    className="mt-0.5 truncate font-mono text-[11px] text-text-weak"
                    title={
                      row.item.recognition.hint
                        ? language.t(row.item.recognition.hint)
                        : row.item.node.path
                    }
                  >
                    {row.item.recognition.hint
                      ? language.t(row.item.recognition.hint)
                      : truncatePath(row.item.node.path, 44)}
                  </p>
                </div>
                <span className="text-13-semibold shrink-0 text-text-strong tabular-nums">
                  {shortBytes(row.item.node.size)}
                </span>
                <Button
                  className="min-h-8 min-w-8"
                  size="small"
                  variant="ghost"
                  icon="eye"
                  aria-label={language.t("disk.dialog.reclaim.inspect", {
                    name: row.item.node.name,
                  })}
                  disabled={
                    props.deleting ||
                    row.item.node.isOther ||
                    row.item.node.isHidden
                  }
                  onClick={() => props.onInspect(row.item.node)}
                />
                <Button
                  className="min-h-8 min-w-8"
                  size="small"
                  variant="ghost"
                  icon={
                    props.isSelected(row.item.node)
                      ? "circle-check"
                      : "plus-small"
                  }
                  aria-pressed={props.isSelected(row.item.node)}
                  aria-label={
                    props.isSelected(row.item.node)
                      ? language.t("disk.dialog.reclaim.remove", {
                          name: row.item.node.name,
                        })
                      : language.t("disk.dialog.reclaim.select", {
                          name: row.item.node.name,
                        })
                  }
                  disabled={props.deleting}
                  onClick={() => props.onToggle(row.item.node)}
                />
              </div>
            )
          }}
        />
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--dl-separator)] bg-[color-mix(in_oklch,var(--background-base)_60%,var(--dl-popover))] p-4">
          <div className="min-w-0">
            <p className="text-13-semibold text-text-strong">
              {language.plural(
                "disk.count.recommendation",
                props.reclaim().totalCount
              )}
            </p>
            <p className="text-13-regular mt-0.5 truncate text-text-weak">
              {language.t("disk.dialog.reclaim.action", {
                action: formatBytes(props.reclaim().totalBytes),
              })}
            </p>
          </div>
          <Button
            className="ml-auto min-h-8 min-w-8 shrink-0"
            size="small"
            variant="secondary"
            icon="checklist"
            disabled={props.deleting || props.reclaim().totalCount === 0}
            onClick={props.onCollectAll}
          >
            {language.t("disk.dialog.reclaim.selectAll")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

export function DeleteConfirmDialog(props: {
  open: boolean
  node: DiskScanNode
  hasSharedPhysicalStorage: boolean
  hasUnverifiedPhysicalStorage: boolean
  hasUnobservedContents: boolean
  /** The selected path is only represented by the deep inventory, not map children. */
  requiresDeepInventoryRefresh: boolean
  deleting: boolean
  trashName: string
  onClose: () => void
  onConfirm: () => void
}) {
  const language = useLanguage()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [acknowledgedPartialScan, setAcknowledgedPartialScan] = useState(false)
  useEffect(
    () => setAcknowledgedPartialScan(false),
    [props.open, props.node.path]
  )
  const open = props.open
  const cautious =
    props.requiresDeepInventoryRefresh ||
    props.hasSharedPhysicalStorage ||
    props.hasUnverifiedPhysicalStorage ||
    props.hasUnobservedContents
  const warning = props.requiresDeepInventoryRefresh
    ? language.t("disk.dialog.delete.deepWarning")
    : props.hasSharedPhysicalStorage
      ? language.t("disk.dialog.delete.sharedWarning")
      : props.hasUnverifiedPhysicalStorage
        ? language.t("disk.dialog.delete.unverifiedWarning")
        : undefined
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) props.onClose()
      }}
    >
      <DialogContent
        role="alertdialog"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
        showCloseButton={false}
        ref={panelRef}
        initialFocus={() =>
          panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ??
          panelRef.current
        }
        className="block w-full max-w-[440px] gap-0 overflow-hidden rounded-2xl border-0 bg-[var(--dl-popover)] p-0 shadow-[0_0_0_0.5px_rgb(255_255_255/0.1),0_30px_90px_rgb(0_0_0/0.5)] ring-0 sm:max-w-[440px]"
      >
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[color-mix(in_oklch,var(--dl-danger)_16%,transparent)] text-[var(--dl-danger)]">
              <Trash2 className="size-[18px]" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2
                id="delete-title"
                className="text-[20px] leading-6 font-semibold tracking-[-0.02em] text-text-strong"
              >
                {language.t("disk.dialog.delete.prompt", {
                  trash: props.trashName,
                })}
              </h2>
            </div>
          </div>
          <div
            id="delete-description"
            className="mt-5 flex items-center gap-3 rounded-xl bg-[var(--dl-well)] px-4 py-3"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--dl-well-strong)] text-text-weak">
              {props.node.isDir ? (
                <Folder className="size-4" strokeWidth={1.75} aria-hidden />
              ) : (
                <FileIcon className="size-4" strokeWidth={1.75} aria-hidden />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium text-text-strong">
                {itemIdentity(props.node).reviewTitle}
              </p>
              <p
                className="mt-0.5 font-mono text-[11px] leading-4 [overflow-wrap:anywhere] text-text-weak select-text"
                title={props.node.path}
              >
                {props.node.path}
              </p>
            </div>
            <p
              className="shrink-0 text-[15px] font-semibold text-text-strong tabular-nums"
              title={
                cautious
                  ? language.t("disk.dialog.delete.selectedSize", {
                      size: formatBytes(props.node.size),
                    })
                  : undefined
              }
            >
              {formatBytes(props.node.size)}
            </p>
          </div>
          {warning || props.hasUnobservedContents ? (
            <div className="mt-3 space-y-2 rounded-xl bg-[color-mix(in_oklch,var(--dl-warning)_9%,transparent)] px-3.5 py-3 text-[12.5px] leading-relaxed text-text-base shadow-[inset_0_0_0_0.5px_color-mix(in_oklch,var(--dl-warning)_35%,transparent)]">
              {warning ? <p>{warning}</p> : null}
              {props.hasUnobservedContents ? (
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-[var(--dl-accent)]"
                    checked={acknowledgedPartialScan}
                    disabled={props.deleting}
                    onChange={(event) =>
                      setAcknowledgedPartialScan(event.currentTarget.checked)
                    }
                  />
                  <span>
                    <span className="block">
                      {language.t("disk.review.partialWarning")}
                    </span>
                    <span className="mt-1 block font-medium text-text-strong">
                      {language.t("disk.review.partialAcknowledge", {
                        trash: props.trashName,
                      })}
                    </span>
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}
          <p className="mt-3 flex items-center gap-2 text-[12px] text-text-weak">
            <RotateCcw className="size-3.5 shrink-0" aria-hidden />
            {props.requiresDeepInventoryRefresh
              ? language.t("disk.dialog.delete.restoreRebuild", {
                  trash: props.trashName,
                })
              : props.hasSharedPhysicalStorage ||
                  props.hasUnverifiedPhysicalStorage
                ? language.t("disk.dialog.delete.restoreRecompute", {
                    trash: props.trashName,
                  })
                : language.t("disk.dialog.delete.restoreSpace", {
                    trash: props.trashName,
                  })}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--dl-separator)] px-6 py-4">
          <button
            type="button"
            data-autofocus
            className="inline-flex h-9 items-center rounded-lg px-3.5 text-[13px] font-medium text-text-strong outline-none hover:bg-[var(--dl-well-strong)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] disabled:opacity-40"
            disabled={props.deleting}
            onClick={props.onClose}
          >
            {language.t("disk.dialog.delete.keep")}
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--dl-danger-action)] px-4 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(0_0_0/0.3)] transition-[background-color,transform] outline-none hover:bg-[var(--dl-danger-action-hover)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
            disabled={
              props.deleting ||
              (props.hasUnobservedContents && !acknowledgedPartialScan)
            }
            onClick={props.onConfirm}
          >
            <Trash2 className="size-4" aria-hidden />
            {props.deleting
              ? language.t("disk.dialog.delete.moving")
              : language.t("disk.detail.moveTo", { trash: props.trashName })}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
