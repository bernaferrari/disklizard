import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, onCleanup, onMount, Show } from "solid-js"
import type { DiskScanNode } from "./types"
import { formatBytes, shortBytes, truncatePath } from "./format"
import type { SurfacePhase } from "./motion"
import type { ReclaimSummary } from "./recognize"
import { SAFETY_ACCENT } from "./ui-tokens"
import { VirtualRows } from "./DiskUtilityVirtualList"
import { useLanguage } from "./runtime"

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

function createDialogFocusRestoration() {
  let panel: HTMLElement | undefined
  let restoreFocus: HTMLElement | undefined

  onMount(() => {
    const active = document.activeElement
    restoreFocus = active instanceof HTMLElement ? active : undefined
    queueMicrotask(() => {
      const target = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel
      target?.focus({ preventScroll: true })
    })
  })
  onCleanup(() => restoreFocus?.isConnected && restoreFocus.focus({ preventScroll: true }))

  return (element: HTMLElement) => {
    panel = element
  }
}

function trapDialogFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return
  const dialog = event.currentTarget
  if (!(dialog instanceof HTMLElement)) return
  const focusable = [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.getClientRects().length > 0)
  if (!focusable.length) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault()
    last.focus()
    return
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

export function CollectionDialog(props: {
  phase: SurfacePhase
  items: DiskScanNode[]
  bytes: number
  hasSharedPhysicalStorage: boolean
  hasUnverifiedPhysicalStorage: boolean
  /** Deep-index entries are not materialized map nodes, so removal needs a full fresh map. */
  requiresDeepInventoryRefresh: boolean
  deleting: boolean
  progress: DeletionProgress | null
  trashName: string
  onClose: () => void
  onRemove: (node: DiskScanNode) => void
  onQuickLook?: (node: DiskScanNode) => void
  onConfirm: () => void
}) {
  const language = useLanguage()
  const focusDialog = createDialogFocusRestoration()
  const requiresFullMapRebuild = () =>
    props.requiresDeepInventoryRefresh || props.hasSharedPhysicalStorage || props.hasUnverifiedPhysicalStorage
  return (
    <div
      class="dl-dialog-surface fixed inset-0 z-50 grid place-items-center bg-background-base/62 p-4 backdrop-blur-sm"
      data-state={props.phase}
      onClick={props.onClose}
      role="presentation"
    >
      <div
        class="dl-dialog-panel flex max-h-[min(680px,calc(100dvh-32px))] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-raised-strong shadow-[0_0_0_1px_rgb(127_127_127/0.13),0_24px_80px_rgb(0_0_0/0.24)]"
        ref={focusDialog}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapDialogFocus}
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-title"
      >
        <div class="flex items-start gap-3 border-b border-border-weaker-base p-5">
          <span class="dl-accent-text grid size-10 shrink-0 place-items-center rounded-full bg-[oklch(0.72_0.12_176/0.14)]">
            <Icon name="checklist" class="size-4" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-13-semibold uppercase tracking-[0.14em] text-text-weaker">
              {language.t("disk.dialog.collection.heading")}
            </p>
            <h2 id="collection-title" class="mt-1 text-20-medium tracking-[-0.03em] text-text-strong">
              {(() => {
                const summary = language.t("disk.dialog.collection.summary", {
                  count: language.plural("disk.count.item", props.items.length),
                  size: formatBytes(props.bytes),
                })
                return requiresFullMapRebuild()
                  ? language.t("disk.dialog.collection.selectedSizes", { summary })
                  : summary
              })()}
            </h2>
            <p class="mt-2 text-13-regular leading-relaxed text-text-weak">
              {language.t("disk.dialog.collection.body")}
            </p>
            <Show when={props.requiresDeepInventoryRefresh}>
              <p class="mt-2 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-13-regular leading-relaxed text-text-weak">
                {language.t("disk.dialog.collection.deepWarning", { trash: props.trashName })}
              </p>
            </Show>
            <Show when={!props.requiresDeepInventoryRefresh && props.hasSharedPhysicalStorage}>
              <p class="mt-2 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-13-regular leading-relaxed text-text-weak">
                {language.t("disk.dialog.collection.sharedWarning", { trash: props.trashName })}
              </p>
            </Show>
            <Show
              when={
                !props.requiresDeepInventoryRefresh && !props.hasSharedPhysicalStorage && props.hasUnverifiedPhysicalStorage
              }
            >
              <p class="mt-2 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-13-regular leading-relaxed text-text-weak">
                {language.t("disk.dialog.collection.unverifiedWarning", { trash: props.trashName })}
              </p>
            </Show>
          </div>
          <Button
            class="dl-touch-target"
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
          estimateSize={() => 64}
          itemKey={(item) => item.path}
          render={(item) => (
            <div class="mx-3 flex h-full items-center gap-3 border-b border-border-weaker-base px-2 py-2 last:border-b-0">
              <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-raised-base text-text-weak">
                <Icon name={item.isDir ? "folder" : "code-lines"} class="size-3.5" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-12-semibold text-text-strong">{item.name}</span>
                <span class="mt-0.5 block truncate text-13-mono text-text-weaker" title={item.path}>
                  {item.path}
                </span>
              </span>
              <span class="shrink-0 text-13-semibold tabular-nums text-text-strong">{shortBytes(item.size)}</span>
              <Show when={props.onQuickLook && !item.isOther && !item.isHidden}>
                <Button
                  class="dl-touch-target"
                  size="small"
                  variant="ghost"
                  icon="eye"
                  disabled={props.deleting}
                  aria-label={language.t("disk.dialog.collection.quickLook", { name: item.name })}
                  onClick={() => props.onQuickLook?.(item)}
                />
              </Show>
              <Button
                class="dl-touch-target"
                size="small"
                variant="ghost"
                icon="close-small"
                disabled={props.deleting}
                aria-label={language.t("disk.dialog.collection.remove", { name: item.name })}
                onClick={() => props.onRemove(item)}
              />
            </div>
          )}
        />
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-weaker-base bg-background-base/55 p-4">
          <Show
            when={props.progress}
            fallback={
              <p class="flex items-center gap-1.5 text-13-regular text-text-weak">
                <Icon name="shield" class="size-3.5" />
                {props.requiresDeepInventoryRefresh
                  ? language.t("disk.dialog.restore.rebuild", { trash: props.trashName })
                  : props.hasSharedPhysicalStorage || props.hasUnverifiedPhysicalStorage
                    ? language.t("disk.dialog.restore.recompute", { trash: props.trashName })
                    : language.t("disk.dialog.restore.space", { trash: props.trashName })}
              </p>
            }
          >
            {(progress) => (
              <p
                class="flex items-center gap-1.5 text-13-regular tabular-nums text-text-weak"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <span class="dl-spin size-3.5 rounded-full border border-border-weaker-base border-t-current" />
                {language.t("disk.dialog.collection.moving", {
                  current: progress().completed,
                  total: progress().total,
                })}
                …
              </p>
            )}
          </Show>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <Button class="dl-touch-target" size="small" variant="ghost" disabled={props.deleting} onClick={props.onClose}>
              {language.t("disk.common.back")}
            </Button>
            <Button class="dl-touch-target" size="small" variant="primary" icon="trash" disabled={props.deleting} onClick={props.onConfirm}>
              {props.progress
                ? language.t("disk.dialog.collection.movingCompact", {
                    current: props.progress.completed,
                    total: props.progress.total,
                  })
                : language.t("disk.detail.moveTo", { trash: props.trashName })}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Slide-over drawer reviewing reclaimable items by category. */
export function ReclaimDrawer(props: {
  phase: SurfacePhase
  reclaim: ReclaimSummary
  onClose: () => void
  onCollectAll: () => void
  onToggle: (node: DiskScanNode) => void
  isSelected: (node: DiskScanNode) => boolean
  deleting: boolean
}) {
  const language = useLanguage()
  const focusDialog = createDialogFocusRestoration()
  const rows = createMemo<ReclaimReviewRow[]>(() =>
    props.reclaim.buckets.flatMap((bucket) => [
      { type: "header" as const, key: `header:${bucket.safety}`, bucket },
      ...bucket.items.map((item, index) => ({
        type: "item" as const,
        key: `item:${item.node.path}`,
        item,
        first: index === 0,
        last: index === bucket.items.length - 1,
      })),
    ]),
  )

  return (
    <div
      class="dl-drawer-surface fixed inset-0 z-40 flex justify-end"
      data-state={props.phase}
      onClick={props.onClose}
      role="presentation"
    >
      <div class="dl-drawer-backdrop absolute inset-0 bg-background-base/58 backdrop-blur-sm" />
      <div
        class="dl-drawer-panel relative m-2 flex h-[calc(100%-16px)] w-[calc(100%-16px)] max-w-md flex-col overflow-hidden rounded-2xl bg-surface-raised-strong shadow-[0_0_0_1px_rgb(127_127_127/0.13),0_24px_80px_rgb(0_0_0/0.24)]"
        ref={focusDialog}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapDialogFocus}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reclaim-title"
      >
        <div class="shrink-0 border-b border-border-weaker-base px-5 pb-5 pt-5">
          <div class="flex items-start gap-3">
            <span class="dl-accent-text grid size-10 shrink-0 place-items-center rounded-full bg-[oklch(0.72_0.12_176/0.14)]">
              <Icon name="shield" class="size-4.5" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-13-semibold uppercase tracking-[0.14em] text-text-weaker">
                {language.t("disk.common.recommendations")}
              </p>
              <h2 id="reclaim-title" class="mt-1 text-20-medium tracking-[-0.03em] text-text-strong">
                {language.t("disk.dialog.reclaim.summary", { count: formatBytes(props.reclaim.totalBytes) })}
              </h2>
              <p class="mt-2 max-w-[38ch] text-13-regular leading-relaxed text-text-weak">
                {language.t("disk.dialog.reclaim.body")}
              </p>
            </div>
            <Button
              class="dl-touch-target"
              size="small"
              variant="ghost"
              icon="close"
              onClick={props.onClose}
              aria-label={language.t("disk.dialog.reclaim.close")}
            />
          </div>
        </div>
        <VirtualRows
          items={rows()}
          ariaLabel={language.t("disk.dialog.reclaim.itemsLabel")}
          estimateSize={(row) => (row.type === "header" ? 46 : 64)}
          itemKey={(row) => row.key}
          isFocusable={(row) => row.type === "item"}
          render={(row) => {
            if (row.type === "header") {
              return (
                <div class="flex h-full items-end gap-2 px-5 pb-2">
                  <span class={`mb-0.5 size-2 rounded-full ${SAFETY_ACCENT[row.bucket.safety].dot}`} />
                  <h3 class="text-13-semibold uppercase tracking-[0.14em] text-text-weak">
                    {row.bucket.safety.replace("-", " ")}
                  </h3>
                  <span class="ml-auto text-13-semibold tabular-nums text-text-strong">
                    {formatBytes(row.bucket.bytes)}
                  </span>
                </div>
              )
            }
            return (
              <div
                class="mx-4 flex h-full items-center gap-3 border-b border-border-weaker-base bg-background-base px-3 py-2"
                classList={{
                  "rounded-t-xl": row.first,
                  "rounded-b-xl border-b-0 shadow-[0_4px_16px_rgb(0_0_0/0.04)]": row.last,
                }}
              >
                <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-raised-base text-text-weak">
                  <Icon name={row.item.node.isDir ? "folder" : "code-lines"} class="size-3.5" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-12-semibold text-text-strong">{row.item.node.name}</p>
                  <p
                    class="mt-0.5 truncate text-13-mono text-text-weaker"
                    title={row.item.recognition.hint ?? row.item.node.path}
                  >
                    {row.item.recognition.hint ?? truncatePath(row.item.node.path, 44)}
                  </p>
                </div>
                <span class="shrink-0 text-13-semibold tabular-nums text-text-strong">
                  {shortBytes(row.item.node.size)}
                </span>
                <Button
                  class="dl-touch-target"
                  size="small"
                  variant="ghost"
                  icon={props.isSelected(row.item.node) ? "circle-check" : "plus-small"}
                  aria-pressed={props.isSelected(row.item.node)}
                  aria-label={
                    props.isSelected(row.item.node)
                      ? language.t("disk.dialog.reclaim.remove", { name: row.item.node.name })
                      : language.t("disk.dialog.reclaim.select", { name: row.item.node.name })
                  }
                  disabled={props.deleting}
                  onClick={() => props.onToggle(row.item.node)}
                />
              </div>
            )
          }}
        />
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-weaker-base bg-background-base/55 p-4">
          <div class="min-w-0">
            <p class="text-13-semibold text-text-strong">
              {language.plural("disk.count.recommendation", props.reclaim.totalCount)}
            </p>
            <p class="mt-0.5 truncate text-13-regular text-text-weak">
              {language.t("disk.dialog.reclaim.action", { action: formatBytes(props.reclaim.totalBytes) })}
            </p>
          </div>
          <Button
            class="dl-touch-target ml-auto shrink-0"
            size="small"
            variant="secondary"
            icon="checklist"
            disabled={props.deleting || props.reclaim.totalCount === 0}
            onClick={props.onCollectAll}
          >
            {language.t("disk.dialog.reclaim.selectAll")}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function DeleteConfirmDialog(props: {
  phase: SurfacePhase
  node: DiskScanNode
  hasSharedPhysicalStorage: boolean
  hasUnverifiedPhysicalStorage: boolean
  /** The selected path is only represented by the deep inventory, not map children. */
  requiresDeepInventoryRefresh: boolean
  deleting: boolean
  trashName: string
  onClose: () => void
  onConfirm: () => void
}) {
  const language = useLanguage()
  const focusDialog = createDialogFocusRestoration()
  const requiresFullMapRebuild = () =>
    props.requiresDeepInventoryRefresh || props.hasSharedPhysicalStorage || props.hasUnverifiedPhysicalStorage
  return (
    <div
      class="dl-dialog-surface fixed inset-0 z-50 grid place-items-center bg-background-base/62 p-4 backdrop-blur-sm"
      data-state={props.phase}
      onClick={props.onClose}
      role="presentation"
    >
      <div
        class="dl-dialog-panel w-full max-w-md rounded-2xl bg-surface-raised-strong p-5 shadow-[0_0_0_1px_rgb(127_127_127/0.13),0_24px_80px_rgb(0_0_0/0.24)]"
        ref={focusDialog}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapDialogFocus}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-description"
      >
        <div class="flex items-start gap-3">
          <div class="dl-critical-text grid size-10 shrink-0 place-items-center rounded-full bg-[oklch(0.62_0.2_25/0.12)]">
            <Icon name="trash" class="size-4" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-13-semibold uppercase tracking-[0.14em] text-text-weaker">
              {language.t("disk.dialog.delete.heading")}
            </p>
            <h3 id="delete-title" class="mt-1 text-18-medium tracking-[-0.025em] text-text-strong">
              {language.t("disk.dialog.delete.prompt", { trash: props.trashName })}
            </h3>
            <div
              id="delete-description"
              class="mt-4 rounded-xl bg-background-base/65 p-3 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.1)]"
            >
              <p class="truncate text-12-semibold text-text-strong">{props.node.name}</p>
              <p class="mt-0.5 truncate text-13-mono text-text-weaker">{props.node.path}</p>
              <p class="mt-2 text-13-semibold tabular-nums text-text-strong">
                {requiresFullMapRebuild()
                  ? language.t("disk.dialog.delete.selectedSize", { size: formatBytes(props.node.size) })
                  : formatBytes(props.node.size)}
              </p>
            </div>
            <p class="mt-3 flex items-center gap-1.5 text-13-regular text-text-weak">
              <Icon name="shield" class="size-3.5" />
              {props.requiresDeepInventoryRefresh
                ? language.t("disk.dialog.delete.restoreRebuild", { trash: props.trashName })
                : props.hasSharedPhysicalStorage || props.hasUnverifiedPhysicalStorage
                  ? language.t("disk.dialog.delete.restoreRecompute", { trash: props.trashName })
                  : language.t("disk.dialog.delete.restoreSpace", { trash: props.trashName })}
            </p>
            <Show when={props.requiresDeepInventoryRefresh}>
              <p class="mt-2 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-13-regular leading-relaxed text-text-weak">
                {language.t("disk.dialog.delete.deepWarning")}
              </p>
            </Show>
            <Show when={!props.requiresDeepInventoryRefresh && props.hasSharedPhysicalStorage}>
              <p class="mt-2 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-13-regular leading-relaxed text-text-weak">
                {language.t("disk.dialog.delete.sharedWarning")}
              </p>
            </Show>
            <Show
              when={
                !props.requiresDeepInventoryRefresh && !props.hasSharedPhysicalStorage && props.hasUnverifiedPhysicalStorage
              }
            >
              <p class="mt-2 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-13-regular leading-relaxed text-text-weak">
                {language.t("disk.dialog.delete.unverifiedWarning")}
              </p>
            </Show>
          </div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <Button data-autofocus class="dl-touch-target" size="small" variant="ghost" disabled={props.deleting} onClick={props.onClose}>
            {language.t("disk.dialog.delete.keep")}
          </Button>
          <Button
            class="dl-touch-target"
            size="small"
            variant="primary"
            disabled={props.deleting}
            icon="trash"
            onClick={props.onConfirm}
          >
            {props.deleting
              ? language.t("disk.dialog.delete.moving")
              : language.t("disk.detail.moveTo", { trash: props.trashName })}
          </Button>
        </div>
      </div>
    </div>
  )
}
