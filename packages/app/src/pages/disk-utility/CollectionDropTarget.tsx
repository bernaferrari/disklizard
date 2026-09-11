import { Icon } from "@/components/dl/icon"
import { cn } from "@/lib/utils"
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
  acceptsNode: boolean
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
  const hasItems = props.count > 0
  const allocationMayRemain =
    props.requiresDeepInventoryRefresh || props.hasSharedPhysicalStorage || props.hasUnverifiedPhysicalStorage
  const title = (() => {
    if (props.node && !props.acceptsNode) return language.t("disk.collection.unavailable")
    if (props.active && props.node) return language.t("disk.collection.release", { name: props.node.name })
    if (props.node) return language.t("disk.collection.drag", { name: props.node.name })
    if (hasItems) return language.plural("disk.count.itemSelected", props.count)
    return language.t("disk.collection.none")
  })()
  const detail = (() => {
    if (props.node)
      return allocationMayRemain
        ? language.t("disk.collection.selectedRebuild", { size: formatBytes(props.node.size) })
        : language.t("disk.collection.selectedApprove", { size: formatBytes(props.node.size) })
    if (hasItems)
      return allocationMayRemain
        ? language.t("disk.collection.selectedRebuild", { size: formatBytes(props.bytes) })
        : language.t("disk.collection.reviewTrash", { size: formatBytes(props.bytes), trash: props.trashName })
    return language.t("disk.collection.instructions")
  })()

  return (
    <button
      type="button"
      ref={(element) => {
        if (element) props.setElement?.(element)
      }}
      className={cn(
        "relative grid size-12 place-items-center rounded-full border border-border-weaker-base bg-surface-raised-base text-text-weak shadow-sm outline-none transition-[background-color,transform] duration-150 motion-reduce:transition-none hover:bg-surface-raised-strong hover:text-text-strong hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-text-weak",
        props.node && "ring-4 ring-text-weak/15",
        props.active && "scale-110 bg-surface-raised-strong text-text-strong ring-4 ring-text-weak/40",
      )}
      onClick={() => {
        if (hasItems) props.onReview()
      }}
      onDragEnter={(event) => props.onDragEnter(event.nativeEvent)}
      onDragOver={(event) => props.onDragOver(event.nativeEvent)}
      onDragLeave={(event) => props.onDragLeave(event.nativeEvent)}
      onDrop={(event) => props.onDrop(event.nativeEvent)}
      aria-label={
        hasItems
          ? `${language.t("disk.collection.reviewSelected")} · ${title}`
          : language.t("disk.collection.instructions")
      }
      title={hasItems ? detail : language.t("disk.collection.instructions")}
    >
      <Icon name="trash" className="size-5" />
      {props.node && <span aria-hidden="true" className="pointer-events-none absolute bottom-full left-0 mb-3 max-w-[240px] truncate rounded-lg bg-surface-raised-strong px-3 py-2 text-xs font-medium text-text-strong shadow-md">{title}</span>}
      {hasItems ? (
        <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-text-strong px-1 text-12-medium tabular-nums text-background-base">
          {props.count > 99 ? "99+" : props.count}
        </span>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {props.active
          ? title
          : hasItems
            ? language.plural("disk.count.itemSelected", props.count)
            : language.t("disk.collection.noneStatus")}
      </span>
    </button>
  )
}
