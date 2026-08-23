import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import type { DiskScanNode } from "./types"
import { formatBytes } from "./format"
import { useLanguage } from "./runtime"

/**
 * A persistent cleanup destination. It stays visible before drag begins so the
 * interaction is discoverable, while keeping deletion behind a separate review.
 */
export function CollectionDropTarget(props: {
  node: DiskScanNode | null
  active: boolean
  count: number
  bytes: number
  hasSharedPhysicalStorage: boolean
  hasUnverifiedPhysicalStorage: boolean
  requiresDeepInventoryRefresh: boolean
  trashName: string
  setElement?: (element: HTMLElement) => void
  onReview: () => void
  onClear: () => void
  onDragEnter: (event: DragEvent) => void
  onDragOver: (event: DragEvent) => void
  onDragLeave: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
}) {
  const language = useLanguage()
  const hasItems = () => props.count > 0
  const allocationMayRemain = () =>
    props.requiresDeepInventoryRefresh || props.hasSharedPhysicalStorage || props.hasUnverifiedPhysicalStorage
  const title = () => {
    if (props.active && props.node) return language.t("disk.collection.release", { name: props.node.name })
    if (props.node) return language.t("disk.collection.drag", { name: props.node.name })
    if (hasItems()) return language.plural("disk.count.itemSelected", props.count)
    return language.t("disk.collection.none")
  }
  const detail = () => {
    if (props.node)
      return allocationMayRemain()
        ? language.t("disk.collection.selectedRebuild", { size: formatBytes(props.node.size) })
        : language.t("disk.collection.selectedApprove", { size: formatBytes(props.node.size) })
    if (hasItems())
      return allocationMayRemain()
        ? language.t("disk.collection.selectedRebuild", { size: formatBytes(props.bytes) })
        : language.t("disk.collection.reviewTrash", { size: formatBytes(props.bytes), trash: props.trashName })
    return language.t("disk.collection.instructions")
  }

  return (
    <section
      ref={(element) => props.setElement?.(element)}
      class="dl-cleanup-dock flex min-h-16 min-w-0 items-center gap-3 rounded-xl px-3.5 py-2"
      classList={{
        "dl-cleanup-dock-active": props.active,
        "dl-cleanup-dock-filled": hasItems() && !props.node,
        "dl-cleanup-dock-empty": !hasItems() && !props.node,
      }}
      onDragEnter={props.onDragEnter}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      aria-label={language.t("disk.collection.label")}
    >
      <span
        class="dl-cleanup-dock-icon relative grid size-10 shrink-0 place-items-center rounded-full"
        aria-hidden="true"
      >
        <Icon name={props.active ? "arrow-down-to-line" : hasItems() ? "checklist" : "trash"} class="size-[18px]" />
        {hasItems() && !props.node ? (
          <span class="absolute -right-1 -top-1 grid min-h-6 min-w-6 place-items-center rounded-full bg-text-strong px-1 text-13-semibold tabular-nums text-background-base">
            {props.count > 99 ? "99+" : props.count}
          </span>
        ) : null}
      </span>

      <span class="min-w-0 flex-1">
        <span class="block truncate text-12-semibold tracking-[-0.01em] text-text-strong">{title()}</span>
        <span class="mt-0.5 block truncate text-13-regular tabular-nums text-text-weak" title={detail()}>
          {detail()}
        </span>
      </span>

      {hasItems() && !props.node ? (
        <span class="flex shrink-0 items-center gap-1">
          <Button
            class="dl-touch-target"
            size="small"
            variant="ghost"
            onClick={props.onClear}
            aria-label={language.t("disk.collection.clear")}
          >
            {language.t("disk.collection.clear")}
          </Button>
          <Button class="dl-touch-target" size="small" variant="primary" icon="arrow-right" onClick={props.onReview}>
            {language.t("disk.collection.reviewSelected")}
          </Button>
        </span>
      ) : (
        <kbd class="dl-shortcut-key shrink-0" aria-label={language.t("disk.collection.shortcutC")}>
          C
        </kbd>
      )}

      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {props.active
          ? title()
          : hasItems()
            ? language.plural("disk.count.itemSelected", props.count)
            : language.t("disk.collection.noneStatus")}
      </span>
    </section>
  )
}
