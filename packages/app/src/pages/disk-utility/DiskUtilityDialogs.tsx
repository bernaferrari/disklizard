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
        className="block w-full max-w-md gap-0 rounded-2xl bg-surface-raised-strong p-5 shadow-[0_0_0_1px_rgb(127_127_127/0.13),0_24px_80px_rgb(0_0_0/0.24)] ring-0 sm:max-w-md"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[oklch(0.62_0.2_25/0.12)] text-[color-mix(in_oklch,oklch(0.62_0.2_25)_50%,var(--text-strong))]">
            <Icon name="shield" className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-13-semibold tracking-[0.14em] text-text-weaker uppercase">
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
                  <Spin className="size-3.5 rounded-full border border-border-weaker-base border-t-current" />
                  {language.t("disk.cleanup.resetting")}
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            data-autofocus
            className="min-h-11 min-w-11"
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
              className="min-h-11 min-w-11 text-[color-mix(in_oklch,oklch(0.62_0.2_25)_50%,var(--text-strong))]"
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
              className="min-h-11 min-w-11"
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
  const coverageKey = props.items.map((item) => item.path).join("\u0000")
  useEffect(() => setAcknowledgedPartialScan(false), [props.open, coverageKey])
  const locations = useMemo(
    () => distinguishingPathLabels(props.items.map((item) => item.path)),
    [props.items]
  )
  const summary = language.t("disk.dialog.collection.summary", {
    count: language.plural("disk.count.item", props.items.length),
    size: formatBytes(props.bytes),
  })
  const open = props.open
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
        className="flex max-h-[min(680px,calc(100dvh-32px))] w-full max-w-[640px] flex-col gap-0 overflow-hidden rounded-2xl bg-surface-raised-strong p-0 shadow-[0_0_0_1px_rgb(127_127_127/0.13),0_24px_80px_rgb(0_0_0/0.24)] ring-0 sm:max-w-[640px]"
      >
        <div className="flex items-start gap-3 border-b border-border-weaker-base p-5">
          <div className="min-w-0 flex-1">
            <h2
              id="collection-title"
              className="text-20-medium tracking-[-0.02em] text-text-strong"
            >
              {language.t("disk.dialog.collection.heading")}
            </h2>
            <p className="text-13-regular mt-2 text-text-weak">
              {props.requiresDeepInventoryRefresh ||
              props.hasSharedPhysicalStorage ||
              props.hasUnverifiedPhysicalStorage ||
              props.hasUnobservedContents
                ? language.t("disk.dialog.collection.selectedSizes", {
                    summary,
                  })
                : summary}
            </p>
            <p className="sr-only">
              {language.t("disk.dialog.collection.body")}
            </p>
            {props.requiresDeepInventoryRefresh ? (
              <details className="group mt-3 border-l-2 border-icon-warning-base/55 pl-3 text-text-strong">
                <summary className="text-13-medium flex min-h-9 cursor-pointer list-none items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-icon-warning-base [&::-webkit-details-marker]:hidden">
                  {language.t("disk.dialog.collection.deepWarningSummary")}
                  <Icon
                    name="chevron-down"
                    className="size-3 shrink-0 transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="text-12-regular max-w-[68ch] pb-2 leading-relaxed text-text-weak">
                  {language.t("disk.dialog.collection.deepWarning", {
                    trash: props.trashName,
                  })}
                </p>
              </details>
            ) : null}
            {props.hasUnobservedContents ? (
              <label className="text-13-regular mt-3 flex items-start gap-2 rounded-lg bg-surface-warning-weak/45 p-3 leading-relaxed text-text-strong">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0"
                  checked={acknowledgedPartialScan}
                  disabled={props.deleting}
                  onChange={(event) =>
                    setAcknowledgedPartialScan(event.currentTarget.checked)
                  }
                />
                <span>
                  {language.t("disk.review.partialWarning")}{" "}
                  <strong>
                    {language.t("disk.review.partialAcknowledge")}
                  </strong>
                </span>
              </label>
            ) : null}
            {!props.requiresDeepInventoryRefresh &&
            props.hasSharedPhysicalStorage ? (
              <p className="text-13-regular mt-2 rounded-lg border border-icon-warning-base/35 bg-surface-warning-weak/45 px-2.5 py-2 leading-relaxed text-text-strong">
                {language.t("disk.dialog.collection.sharedWarning", {
                  trash: props.trashName,
                })}
              </p>
            ) : null}
            {!props.requiresDeepInventoryRefresh &&
            !props.hasSharedPhysicalStorage &&
            props.hasUnverifiedPhysicalStorage ? (
              <p className="text-13-regular mt-2 rounded-lg border border-icon-warning-base/35 bg-surface-warning-weak/45 px-2.5 py-2 leading-relaxed text-text-strong">
                {language.t("disk.dialog.collection.unverifiedWarning", {
                  trash: props.trashName,
                })}
              </p>
            ) : null}
          </div>
          <Button
            className="min-h-11 min-w-11"
            size="small"
            variant="ghost"
            icon="close"
            disabled={props.deleting}
            onClick={props.onClose}
            aria-label={language.t("disk.dialog.collection.close")}
          />
        </div>
        <VirtualRows
          items={props.items}
          ariaLabel={language.t("disk.dialog.collection.itemsLabel")}
          estimateSize={() => 136}
          itemKey={(item) => item.path}
          render={(item) => {
            const recognition = props.recognitionFor?.(item) ?? recognize(item)
            const identity = itemIdentity(item)
            return (
              <div className="mx-3 flex h-full flex-col justify-center gap-1 border-b border-border-weaker-base px-2 py-2 last:border-b-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-raised-base text-text-weak">
                    <Icon
                      name={item.isDir ? "folder" : "code-lines"}
                      className="size-3.5"
                    />
                  </span>
                  <span className="min-w-0 flex-1" title={item.path}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="text-13-semibold truncate text-text-strong">
                        {identity.reviewTitle}
                      </span>
                      {recognition.tag ? (
                        <span className="sr-only">
                          {language.t(recognition.tag)}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-13-semibold shrink-0 text-text-strong tabular-nums">
                    {shortBytes(item.size)}
                  </span>
                  {!item.isOther && !item.isHidden ? (
                    <>
                      {props.onQuickLook ? (
                        <Button
                          className="min-h-11 min-w-11"
                          size="small"
                          variant="ghost"
                          icon="eye"
                          disabled={props.deleting}
                          aria-label={language.t(
                            "disk.dialog.collection.quickLook",
                            { name: item.name }
                          )}
                          onClick={() => props.onQuickLook?.(item)}
                        />
                      ) : (
                        <Button
                          className="min-h-11 min-w-11"
                          size="small"
                          variant="ghost"
                          icon="bullet-list"
                          disabled={props.deleting}
                          aria-label={language.t(
                            "disk.dialog.collection.preview",
                            { name: item.name }
                          )}
                          onClick={() => props.onPreview(item)}
                        />
                      )}
                      <Button
                        className="min-h-11 min-w-11"
                        size="small"
                        variant="ghost"
                        icon="square-arrow-top-right"
                        disabled={props.deleting}
                        aria-label={language.t(
                          "disk.dialog.collection.reveal",
                          {
                            name: item.name,
                          }
                        )}
                        onClick={() => props.onReveal(item)}
                      />
                    </>
                  ) : null}
                  <Button
                    className="min-h-11 min-w-11"
                    size="small"
                    variant="ghost"
                    icon="close-small"
                    disabled={props.deleting}
                    aria-label={language.t("disk.dialog.collection.remove", {
                      name: item.name,
                    })}
                    onClick={() => props.onRemove(item)}
                  />
                </div>
                <div className="ml-10 flex min-w-0 items-center gap-3">
                  <span
                    className="text-12-regular hidden min-w-0 flex-1 truncate font-mono text-text-weak sm:block"
                    title={item.path}
                  >
                    {item.path}
                  </span>
                  <span
                    className="text-12-regular min-w-0 flex-1 truncate font-mono text-text-weak sm:hidden"
                    title={item.path}
                  >
                    {locations.get(item.path) ?? item.path}
                  </span>
                  <button
                    type="button"
                    className="text-12-regular min-h-11 shrink-0 rounded px-1 text-text-weak underline underline-offset-2 outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-text-weak"
                    onClick={() => {
                      void navigator.clipboard?.writeText(item.path).then(
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
                    {language.t(
                      copyFailedPath === item.path
                        ? "disk.dialog.collection.copyFailed"
                        : copiedPath === item.path
                          ? "disk.dialog.collection.copied"
                          : "disk.dialog.collection.copyPath"
                    )}
                  </button>
                </div>
                {recognition.hint ? (
                  <span
                    className="text-12-regular ml-10 block truncate text-text-weaker"
                    title={language.t(recognition.hint)}
                  >
                    {language.t(recognition.hint)}
                  </span>
                ) : null}
              </div>
            )
          }}
        />
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-weaker-base bg-background-base/55 p-4">
          {props.progress ? (
            <p
              className="text-13-regular flex items-center gap-1.5 text-text-weak tabular-nums"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <Spin className="size-3.5 rounded-full border border-border-weaker-base border-t-current" />
              {language.t("disk.dialog.collection.moving", {
                current: props.progress.completed,
                total: props.progress.total,
              })}
              …
            </p>
          ) : (
            <div className="text-13-regular flex items-center gap-1.5 text-text-weak">
              <Icon name="shield" className="size-3.5" />
              {props.requiresDeepInventoryRefresh
                ? language.t("disk.dialog.restore.rebuild", {
                    trash: props.trashName,
                  })
                : props.hasSharedPhysicalStorage ||
                    props.hasUnverifiedPhysicalStorage
                  ? language.t("disk.dialog.restore.recompute", {
                      trash: props.trashName,
                    })
                  : language.t("disk.dialog.restore.space", {
                      trash: props.trashName,
                    })}
            </div>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button
              className="min-h-11 min-w-11"
              size="small"
              variant="ghost"
              disabled={props.deleting}
              onClick={props.onClose}
            >
              {language.t("disk.common.back")}
            </Button>
            <Button
              className="min-h-11 min-w-11"
              size="small"
              variant="primary"
              icon="trash"
              disabled={
                props.deleting ||
                (props.hasUnobservedContents && !acknowledgedPartialScan)
              }
              onClick={props.onConfirm}
            >
              {props.progress
                ? language.t("disk.dialog.collection.movingCompact", {
                    current: props.progress.completed,
                    total: props.progress.total,
                  })
                : language.t("disk.detail.moveTo", { trash: props.trashName })}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Slide-over drawer reviewing reclaimable items by category. */
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
        className="gap-0 overflow-hidden rounded-2xl bg-surface-raised-strong shadow-[0_0_0_1px_rgb(127_127_127/0.13),0_24px_80px_rgb(0_0_0/0.24)] data-[side=right]:inset-y-2 data-[side=right]:right-2 data-[side=right]:h-auto data-[side=right]:w-[calc(100%-16px)] data-[side=right]:max-w-md data-[side=right]:border-l-0 data-[side=right]:sm:max-w-md"
      >
        <div className="shrink-0 border-b border-border-weaker-base px-5 pt-5 pb-5">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[oklch(0.72_0.12_176/0.14)] text-[color-mix(in_oklch,var(--dl-accent-strong)_54%,var(--text-strong))]">
              <Icon name="shield" className="size-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-13-semibold tracking-[0.14em] text-text-weaker uppercase">
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
              className="min-h-11 min-w-11"
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
                  "mx-4 flex h-full items-center gap-3 border-b border-border-weaker-base bg-background-base px-3 py-2",
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
                    className="text-13-mono mt-0.5 truncate text-text-weaker"
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
                  className="min-h-11 min-w-11"
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
                  className="min-h-11 min-w-11"
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
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-weaker-base bg-background-base/55 p-4">
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
            className="ml-auto min-h-11 min-w-11 shrink-0"
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
        className="block w-full max-w-md gap-0 rounded-2xl bg-surface-raised-strong p-5 shadow-[0_0_0_1px_rgb(127_127_127/0.13),0_24px_80px_rgb(0_0_0/0.24)] ring-0 sm:max-w-md"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[oklch(0.62_0.2_25/0.12)] text-[color-mix(in_oklch,oklch(0.62_0.2_25)_50%,var(--text-strong))]">
            <Icon name="trash" className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-13-semibold tracking-[0.14em] text-text-weaker uppercase">
              {language.t("disk.dialog.delete.heading")}
            </p>
            <h3
              id="delete-title"
              className="text-18-medium mt-1 tracking-[-0.025em] text-text-strong"
            >
              {language.t("disk.dialog.delete.prompt", {
                trash: props.trashName,
              })}
            </h3>
            <div
              id="delete-description"
              className="mt-4 rounded-xl bg-background-base/65 p-3 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.1)]"
            >
              <p className="text-12-semibold truncate text-text-strong">
                {itemIdentity(props.node).reviewTitle}
              </p>
              <p className="text-13-mono mt-0.5 truncate text-text-weaker">
                {props.node.path}
              </p>
              <p className="text-13-semibold mt-2 text-text-strong tabular-nums">
                {props.requiresDeepInventoryRefresh ||
                props.hasSharedPhysicalStorage ||
                props.hasUnverifiedPhysicalStorage ||
                props.hasUnobservedContents
                  ? language.t("disk.dialog.delete.selectedSize", {
                      size: formatBytes(props.node.size),
                    })
                  : formatBytes(props.node.size)}
              </p>
            </div>
            <div className="text-13-regular mt-3 flex items-center gap-1.5 text-text-weak">
              <Icon name="shield" className="size-3.5" />
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
            </div>
            {props.requiresDeepInventoryRefresh ? (
              <p className="text-13-regular mt-2 rounded-lg border border-icon-warning-base/35 bg-surface-warning-weak/45 px-2.5 py-2 leading-relaxed text-text-strong">
                {language.t("disk.dialog.delete.deepWarning")}
              </p>
            ) : null}
            {props.hasUnobservedContents ? (
              <label className="text-13-regular mt-3 flex items-start gap-2 rounded-lg bg-surface-warning-weak/45 p-3 leading-relaxed text-text-strong">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0"
                  checked={acknowledgedPartialScan}
                  disabled={props.deleting}
                  onChange={(event) =>
                    setAcknowledgedPartialScan(event.currentTarget.checked)
                  }
                />
                <span>
                  {language.t("disk.review.partialWarning")}{" "}
                  <strong>
                    {language.t("disk.review.partialAcknowledge")}
                  </strong>
                </span>
              </label>
            ) : null}
            {!props.requiresDeepInventoryRefresh &&
            props.hasSharedPhysicalStorage ? (
              <p className="text-13-regular mt-2 rounded-lg border border-icon-warning-base/35 bg-surface-warning-weak/45 px-2.5 py-2 leading-relaxed text-text-strong">
                {language.t("disk.dialog.delete.sharedWarning")}
              </p>
            ) : null}
            {!props.requiresDeepInventoryRefresh &&
            !props.hasSharedPhysicalStorage &&
            props.hasUnverifiedPhysicalStorage ? (
              <p className="text-13-regular mt-2 rounded-lg border border-icon-warning-base/35 bg-surface-warning-weak/45 px-2.5 py-2 leading-relaxed text-text-strong">
                {language.t("disk.dialog.delete.unverifiedWarning")}
              </p>
            ) : null}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            data-autofocus
            className="min-h-11 min-w-11"
            size="small"
            variant="ghost"
            disabled={props.deleting}
            onClick={props.onClose}
          >
            {language.t("disk.dialog.delete.keep")}
          </Button>
          <Button
            className="min-h-11 min-w-11"
            size="small"
            variant="primary"
            disabled={
              props.deleting ||
              (props.hasUnobservedContents && !acknowledgedPartialScan)
            }
            icon="trash"
            onClick={props.onConfirm}
          >
            {props.deleting
              ? language.t("disk.dialog.delete.moving")
              : language.t("disk.detail.moveTo", { trash: props.trashName })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
