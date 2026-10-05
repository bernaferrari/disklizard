import {
  Check,
  Copy,
  Eye,
  File as FileIcon,
  Folder,
  FolderSearch,
  Info,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react"
import { Button } from "@/components/dl/button"
import { Button as ShadcnButton } from "@/components/ui/button"
import { Icon } from "@/components/dl/icon"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
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
import {
  itemIdentity,
  cleanupLocationLabels,
  abbreviateHomePath,
} from "./item-identity"

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
        className="block w-full max-w-md gap-0 p-5 sm:max-w-md"
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

/** Informational caveats. Moving to the Trash is reversible, so none of these gate the action. */
function CleanupNotes(props: { notes: (string | undefined)[] }) {
  const notes = props.notes.filter((note): note is string => !!note)
  if (!notes.length) return null
  return (
    <ul className="mx-6 mb-5 space-y-2 rounded-lg bg-[var(--dl-well)] px-3.5 py-3 text-[12.5px] leading-[1.55] text-text-weak">
      {notes.map((note) => (
        <li key={note} className="flex gap-2.5">
          <Info
            className="mt-[3px] size-3.5 shrink-0 text-text-weaker"
            aria-hidden
          />
          <span>{note}</span>
        </li>
      ))}
    </ul>
  )
}

import { ACCESS_LABEL, type AccessAssessment } from "./access-assessments"

export function CollectionDialog(props: {
  open: boolean
  items: DiskScanNode[]
  homePath?: string
  restrictionFor?: (node: DiskScanNode) => string | undefined
  accessFor?: (node: DiskScanNode) => AccessAssessment
  onObserve?: (node: DiskScanNode) => void
  onCheckAccess?: (node: DiskScanNode) => void
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
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (props.open) for (const node of props.items) props.onObserve?.(node)
  }, [props.open, props.items, props.onObserve])
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
  const sortedItems = useMemo(
    () => props.items.toSorted((a, b) => b.size - a.size),
    [props.items]
  )
  const locations = useMemo(
    () =>
      cleanupLocationLabels(
        props.items.map((item) => item.path),
        props.homePath
      ),
    [props.items, props.homePath]
  )
  const cautious =
    props.requiresDeepInventoryRefresh ||
    props.hasSharedPhysicalStorage ||
    props.hasUnverifiedPhysicalStorage
  const trash = { trash: props.trashName }
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose()
      }}
    >
      <DialogContent
        aria-labelledby="collection-title"
        aria-describedby="collection-description"
        showCloseButton={false}
        initialFocus={confirmRef}
        className="flex max-h-[min(720px,calc(100dvh-48px))] w-full max-w-[560px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]"
      >
        <span className="sr-only" role="status">
          {copyFailedPath
            ? language.t("disk.dialog.collection.copyFailed")
            : copiedPath
              ? language.t("disk.dialog.collection.copied")
              : ""}
        </span>
        <div className="flex items-start gap-6 px-6 pt-6 pb-5">
          <div className="min-w-0 flex-1">
            <DialogTitle id="collection-title">
              {language.plural(
                "disk.dialog.collection.title",
                props.items.length,
                trash
              )}
            </DialogTitle>
            <p
              id="collection-description"
              className="mt-1.5 text-[13px] leading-5 text-text-weak"
            >
              {props.requiresDeepInventoryRefresh
                ? language.t("disk.dialog.restore.rebuild", trash)
                : cautious
                  ? language.t("disk.dialog.restore.recompute", trash)
                  : language.t("disk.dialog.restore.space", trash)}
            </p>
          </div>
          <p className="shrink-0 pt-px text-[22px] leading-6 font-semibold tracking-[-0.03em] text-text-strong tabular-nums">
            {formatBytes(props.bytes)}
          </p>
        </div>

        <CleanupNotes
          notes={[
            props.requiresDeepInventoryRefresh
              ? language.t("disk.dialog.collection.deepWarning", trash)
              : props.hasSharedPhysicalStorage
                ? language.t("disk.dialog.collection.sharedWarning", trash)
                : props.hasUnverifiedPhysicalStorage
                  ? language.t(
                      "disk.dialog.collection.unverifiedWarning",
                      trash
                    )
                  : undefined,
            props.hasUnobservedContents
              ? language.t("disk.review.partialWarning")
              : undefined,
            ...new Set(
              props.items
                .map((node) => props.restrictionFor?.(node))
                .filter(Boolean)
            ),
          ]}
        />

        <div
          className="flex min-h-[64px] shrink flex-col border-y border-[var(--dl-separator)]"
          style={{ height: Math.min(props.items.length * 72 + 18, 420) }}
        >
          <VirtualRows
            items={sortedItems}
            ariaLabel={language.t("disk.dialog.collection.itemsLabel")}
            estimateSize={() => 72}
            itemKey={(item) => item.path}
            render={(item) => {
              const recognition =
                props.recognitionFor?.(item) ?? recognize(item)
              const identity = itemIdentity(item)
              const access = props.accessFor?.(item)
              const restriction = props.restrictionFor?.(item)
              const hint = recognition.hint
                ? language.t(recognition.hint)
                : undefined
              const name = locations.get(item.path) ?? identity.reviewTitle
              const copyLabel = language.t(
                copyFailedPath === item.path
                  ? "disk.dialog.collection.copyFailed"
                  : copiedPath === item.path
                    ? "disk.dialog.collection.copied"
                    : "disk.dialog.collection.copyPath"
              )
              const previewLabel = language.t(
                props.onQuickLook
                  ? "disk.dialog.collection.quickLook"
                  : "disk.dialog.collection.preview",
                { name }
              )
              const revealLabel = language.t("disk.dialog.collection.reveal", {
                name,
              })
              const removeLabel = language.t("disk.dialog.collection.remove", {
                name,
              })
              return (
                <div className="group mx-2 flex h-full items-center gap-3 rounded-lg pr-1 pl-3 hover:bg-[var(--dl-row-hover)]">
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
                    <span className="block truncate text-[13.5px] leading-5 font-medium text-text-strong">
                      {identity.reviewTitle}
                    </span>
                    <span className="block truncate text-[12px] leading-4 text-text-weak">
                      {locations.get(item.path) ??
                        abbreviateHomePath(item.path, props.homePath)}
                    </span>
                    {restriction || access ? (
                      <span className="block truncate text-[11px] text-text-weaker">
                        {restriction ?? language.t(ACCESS_LABEL[access!.state])}
                      </span>
                    ) : null}
                    {recognition.tag ? (
                      <span className="sr-only">
                        {language.t(recognition.tag)}
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center">
                    {access &&
                    ["denied", "read-only", "unknown"].includes(access.state) &&
                    props.onCheckAccess ? (
                      <ShadcnButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => props.onCheckAccess?.(item)}
                      >
                        {language.t("disk.cleanup.checkAgain")}
                      </ShadcnButton>
                    ) : null}
                    {!item.isOther && !item.isHidden ? (
                      <>
                        <ShadcnButton
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-text-weaker hover:text-text-strong"
                          disabled={props.deleting}
                          aria-label={previewLabel}
                          title={previewLabel}
                          onClick={() =>
                            props.onQuickLook
                              ? props.onQuickLook(item)
                              : props.onPreview(item)
                          }
                        >
                          <Eye className="size-3.5" aria-hidden />
                        </ShadcnButton>
                        <ShadcnButton
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-text-weaker hover:text-text-strong"
                          disabled={props.deleting}
                          aria-label={revealLabel}
                          title={revealLabel}
                          onClick={() => props.onReveal(item)}
                        >
                          <FolderSearch className="size-3.5" aria-hidden />
                        </ShadcnButton>
                      </>
                    ) : null}
                    <ShadcnButton
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-text-weaker hover:text-text-strong"
                      aria-label={copyLabel}
                      title={copyLabel}
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
                    </ShadcnButton>
                  </span>
                  <span className="w-[72px] shrink-0 text-right text-[13px] text-text-base tabular-nums">
                    {formatBytes(item.size)}
                  </span>
                  <ShadcnButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-text-weaker hover:text-text-strong"
                    disabled={props.deleting}
                    aria-label={removeLabel}
                    title={removeLabel}
                    onClick={() => props.onRemove(item)}
                  >
                    <X className="size-3.5" aria-hidden />
                  </ShadcnButton>
                </div>
              )
            }}
          />
        </div>

        <DialogFooter className="shrink-0 flex-row items-center gap-2 px-6 py-4">
          {props.progress ? (
            <div
              className="mr-auto flex min-w-0 items-center gap-2 text-[12.5px] text-text-weak tabular-nums"
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
          ) : null}
          <ShadcnButton
            type="button"
            variant="ghost"
            size="lg"
            className="px-3.5"
            disabled={props.deleting}
            onClick={props.onClose}
          >
            {language.t("disk.common.cancel")}
          </ShadcnButton>
          <ShadcnButton
            ref={confirmRef}
            type="button"
            variant="destructive"
            size="lg"
            className="px-3.5"
            disabled={
              props.deleting ||
              props.items.length === 0 ||
              props.items.some((node) => !!props.restrictionFor?.(node))
            }
            onClick={props.onConfirm}
          >
            <Trash2 className="size-4" aria-hidden />
            {props.progress
              ? language.t("disk.dialog.collection.movingCompact", {
                  current: props.progress.completed,
                  total: props.progress.total,
                })
              : language.t("disk.detail.moveTo", trash)}
          </ShadcnButton>
        </DialogFooter>
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
  homePath?: string
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
  const confirmRef = useRef<HTMLButtonElement | null>(null)
  const trash = { trash: props.trashName }
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        if (!next) props.onClose()
      }}
    >
      <DialogContent
        role="alertdialog"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
        showCloseButton={false}
        initialFocus={confirmRef}
        className="block w-full max-w-[460px] gap-0 overflow-hidden p-0 sm:max-w-[460px]"
      >
        <div className="px-6 pt-6 pb-5">
          <DialogTitle id="delete-title">
            {language.t("disk.dialog.delete.prompt", trash)}
          </DialogTitle>
          <p
            id="delete-description"
            className="mt-1.5 text-[13px] leading-5 text-text-weak"
          >
            {props.requiresDeepInventoryRefresh
              ? language.t("disk.dialog.delete.restoreRebuild", trash)
              : props.hasSharedPhysicalStorage ||
                  props.hasUnverifiedPhysicalStorage
                ? language.t("disk.dialog.delete.restoreRecompute", trash)
                : language.t("disk.dialog.delete.restoreSpace", trash)}
          </p>
        </div>
        <div className="mx-6 mb-5 flex items-center gap-3 rounded-xl bg-[var(--dl-well)] px-3.5 py-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--dl-well-strong)] text-text-weak">
            {props.node.isDir ? (
              <Folder className="size-4" strokeWidth={1.75} aria-hidden />
            ) : (
              <FileIcon className="size-4" strokeWidth={1.75} aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] leading-5 font-medium text-text-strong">
              {itemIdentity(props.node).reviewTitle}
            </p>
            <p
              className="truncate text-[12px] leading-4 text-text-weak select-text"
              title={props.node.path}
            >
              {abbreviateHomePath(props.node.path, props.homePath)}
            </p>
          </div>
          <p className="shrink-0 text-[15px] font-semibold text-text-strong tabular-nums">
            {formatBytes(props.node.size)}
          </p>
        </div>
        <CleanupNotes
          notes={[
            props.requiresDeepInventoryRefresh
              ? language.t("disk.dialog.delete.deepWarning")
              : props.hasSharedPhysicalStorage
                ? language.t("disk.dialog.delete.sharedWarning")
                : props.hasUnverifiedPhysicalStorage
                  ? language.t("disk.dialog.delete.unverifiedWarning")
                  : undefined,
            props.hasUnobservedContents
              ? language.t("disk.review.partialWarning")
              : undefined,
          ]}
        />
        <DialogFooter className="flex-row justify-end gap-2 border-t border-[var(--dl-separator)] px-6 py-4">
          <ShadcnButton
            type="button"
            variant="ghost"
            size="lg"
            className="px-3.5"
            disabled={props.deleting}
            onClick={props.onClose}
          >
            {language.t("disk.common.cancel")}
          </ShadcnButton>
          <ShadcnButton
            ref={confirmRef}
            type="button"
            variant="destructive"
            size="lg"
            className="px-3.5"
            disabled={props.deleting}
            onClick={props.onConfirm}
          >
            <Trash2 className="size-4" aria-hidden />
            {props.deleting
              ? language.t("disk.dialog.delete.moving")
              : language.t("disk.detail.moveTo", trash)}
          </ShadcnButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
