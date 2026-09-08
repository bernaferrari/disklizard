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
    <button
      type="button"
      ref={(element) => props.setElement?.(element)}
      class="dl-trash-target relative grid size-12 place-items-center rounded-xl border border-border-weaker-base bg-surface-raised-base text-text-weak shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
      classList={{ "dl-trash-target-active": props.active }}
      onClick={() => {
        if (hasItems()) props.onReview()
      }}
      onDragEnter={props.onDragEnter}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      aria-label={
        hasItems()
          ? `${language.t("disk.collection.reviewSelected")} · ${title()}`
          : language.t("disk.collection.instructions")
      }
      title={hasItems() ? detail() : language.t("disk.collection.instructions")}
    >
      <Icon name="trash" class="size-5" />
      {hasItems() ? (
        <span class="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-text-strong px-1 text-12-medium tabular-nums text-background-base">
          {props.count > 99 ? "99+" : props.count}
        </span>
      ) : null}
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {props.active
          ? title()
          : hasItems()
            ? language.plural("disk.count.itemSelected", props.count)
            : language.t("disk.collection.noneStatus")}
      </span>
    </button>
  )
}
