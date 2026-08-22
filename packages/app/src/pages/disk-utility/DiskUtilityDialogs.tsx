import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { createMemo, onCleanup, onMount, Show } from "solid-js"
import type { DiskScanNode } from "@/context/platform"
import { formatBytes, formatCount, shortBytes, truncatePath } from "./format"
import type { SurfacePhase } from "./motion"
import type { ReclaimSummary } from "./recognize"
import { SAFETY_ACCENT } from "./ui-tokens"
import { VirtualRows } from "./DiskUtilityVirtualList"

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
            <p class="text-13-semibold uppercase tracking-[0.14em] text-text-weaker">Review selected items</p>
            <h2 id="collection-title" class="mt-1 text-20-medium tracking-[-0.03em] text-text-strong">
              {requiresFullMapRebuild() ? "Selected file sizes: " : ""}
              {formatBytes(props.bytes)} across {props.items.length} {props.items.length === 1 ? "item" : "items"}
            </h2>
            <p class="mt-2 text-13-regular leading-relaxed text-text-weak">
              Check every item before anything leaves its original location.
            </p>
            <Show when={props.requiresDeepInventoryRefresh}>
              <p class="mt-2 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-13-regular leading-relaxed text-text-weak">
                A selected path changes data represented by the deep artifact inventory. It can move to {props.trashName},
                but its displayed size is not a reclaim estimate. DiskLizard will rebuild the full map afterward.
              </p>
            </Show>
            <Show when={!props.requiresDeepInventoryRefresh && props.hasSharedPhysicalStorage}>
              <p class="mt-2 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-13-regular leading-relaxed text-text-weak">
                Some selected paths share physical storage through APFS clones or hard links. They can move to
                {` ${props.trashName}`}, but their displayed allocation is not a promise of freed disk space.
                DiskLizard will recompute the map afterward.
              </p>
            </Show>
            <Show
              when={
                !props.requiresDeepInventoryRefresh && !props.hasSharedPhysicalStorage && props.hasUnverifiedPhysicalStorage
              }
            >
              <p class="mt-2 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-13-regular leading-relaxed text-text-weak">
                This scan could not verify filesystem clone metadata. The paths can move to {props.trashName}, but their
                displayed allocation is not a promise of freed disk space. DiskLizard will refresh the map afterward.
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
            aria-label="Close selected-item review"
          />
        </div>
        <VirtualRows
          items={props.items}
          ariaLabel="Items selected for review"
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
                  aria-label={`Quick Look ${item.name}`}
                  onClick={() => props.onQuickLook?.(item)}
                />
              </Show>
              <Button
                class="dl-touch-target"
                size="small"
                variant="ghost"
                icon="close-small"
                disabled={props.deleting}
                aria-label={`Remove ${item.name} from review`}
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
                  ? `Items can be restored from ${props.trashName}. DiskLizard will rebuild the full map after the move.`
                  : props.hasSharedPhysicalStorage || props.hasUnverifiedPhysicalStorage
                    ? `Items can be restored from ${props.trashName}. Storage allocation will be recomputed after the move.`
                  : `Items can be restored from ${props.trashName}. Space is freed after you empty it.`}
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
                Moving {progress().completed} of {progress().total}…
              </p>
            )}
          </Show>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <Button class="dl-touch-target" size="small" variant="ghost" disabled={props.deleting} onClick={props.onClose}>
              Back
            </Button>
            <Button class="dl-touch-target" size="small" variant="primary" icon="trash" disabled={props.deleting} onClick={props.onConfirm}>
              {props.progress
                ? `Moving ${props.progress.completed}/${props.progress.total}…`
                : `Move to ${props.trashName}`}
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
              <p class="text-13-semibold uppercase tracking-[0.14em] text-text-weaker">Recommendations</p>
              <h2 id="reclaim-title" class="mt-1 text-20-medium tracking-[-0.03em] text-text-strong">
                {formatBytes(props.reclaim.totalBytes)} worth reviewing
              </h2>
              <p class="mt-2 max-w-[38ch] text-13-regular leading-relaxed text-text-weak">
                DiskLizard thinks these can usually be recreated or downloaded again. They are recommendations, not
                permission—select only the items you want to review.
              </p>
            </div>
            <Button class="dl-touch-target" size="small" variant="ghost" icon="close" onClick={props.onClose} aria-label="Close review" />
          </div>
        </div>
        <VirtualRows
          items={rows()}
          ariaLabel="Recommended items"
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
                      ? `Remove ${row.item.node.name} from review`
                      : `Select ${row.item.node.name} for review`
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
              {formatCount(props.reclaim.totalCount)}{" "}
              {props.reclaim.totalCount === 1 ? "recommendation" : "recommendations"}
            </p>
            <p class="mt-0.5 truncate text-13-regular text-text-weak">
              {formatBytes(props.reclaim.totalBytes)} · Nothing moves until you review the selected items
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
            Select all for review
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
            <p class="text-13-semibold uppercase tracking-[0.14em] text-text-weaker">Confirm removal</p>
            <h3 id="delete-title" class="mt-1 text-18-medium tracking-[-0.025em] text-text-strong">
              Move this item to {props.trashName}?
            </h3>
            <div
              id="delete-description"
              class="mt-4 rounded-xl bg-background-base/65 p-3 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.1)]"
            >
              <p class="truncate text-12-semibold text-text-strong">{props.node.name}</p>
              <p class="mt-0.5 truncate text-13-mono text-text-weaker">{props.node.path}</p>
              <p class="mt-2 text-13-semibold tabular-nums text-text-strong">
                {requiresFullMapRebuild() ? "Selected file size: " : ""}
                {formatBytes(props.node.size)}
              </p>
            </div>
            <p class="mt-3 flex items-center gap-1.5 text-13-regular text-text-weak">
              <Icon name="shield" class="size-3.5" />
              {props.requiresDeepInventoryRefresh
                ? `You can restore it from ${props.trashName}. DiskLizard will rebuild the full map after the move.`
                : props.hasSharedPhysicalStorage || props.hasUnverifiedPhysicalStorage
                  ? `You can restore it from ${props.trashName}. Storage allocation will be recomputed after the move.`
                : `You can restore it from ${props.trashName}. Space is freed after you empty it.`}
            </p>
            <Show when={props.requiresDeepInventoryRefresh}>
              <p class="mt-2 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-13-regular leading-relaxed text-text-weak">
                This path changes data represented by the deep artifact inventory. Moving it does not make its displayed
                size a reclaim promise; DiskLizard will rebuild the full map afterward.
              </p>
            </Show>
            <Show when={!props.requiresDeepInventoryRefresh && props.hasSharedPhysicalStorage}>
              <p class="mt-2 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-13-regular leading-relaxed text-text-weak">
                This path shares physical storage through an APFS clone or hard link. Moving it does not guarantee
                that its displayed bytes become free; DiskLizard will recompute shared storage afterward.
              </p>
            </Show>
            <Show
              when={
                !props.requiresDeepInventoryRefresh && !props.hasSharedPhysicalStorage && props.hasUnverifiedPhysicalStorage
              }
            >
              <p class="mt-2 rounded-lg bg-surface-warning-weak/45 px-2.5 py-2 text-13-regular leading-relaxed text-text-weak">
                This scan could not verify filesystem clone metadata. Moving the path does not guarantee that its displayed
                bytes become free; DiskLizard will refresh the map afterward.
              </p>
            </Show>
          </div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <Button data-autofocus class="dl-touch-target" size="small" variant="ghost" disabled={props.deleting} onClick={props.onClose}>
            Keep it
          </Button>
          <Button
            class="dl-touch-target"
            size="small"
            variant="primary"
            disabled={props.deleting}
            icon="trash"
            onClick={props.onConfirm}
          >
            {props.deleting ? "Moving…" : `Move to ${props.trashName}`}
          </Button>
        </div>
      </div>
    </div>
  )
}
