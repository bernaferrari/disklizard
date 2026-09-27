import { Icon } from "@/components/dl/icon"
import { cn } from "@/lib/utils"
import type { DiskScanNode } from "./types"
import { formatBytes } from "./format"
import { useLanguage } from "./runtime"

/**
 * A cleanup destination that appears when the user collects or drags an item.
 * Deletion remains behind a separate review.
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
  setElement?: (element: HTMLElement | null) => void
  onReview: () => void
  onDragEnter: (event: DragEvent) => void
  onDragOver: (event: DragEvent) => void
  onDragLeave: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
}) {
  const language = useLanguage()
  const hasItems = props.count > 0
  const allocationMayRemain =
    props.requiresDeepInventoryRefresh ||
    props.hasSharedPhysicalStorage ||
    props.hasUnverifiedPhysicalStorage
  const title = (() => {
    if (props.node && !props.acceptsNode)
      return language.t("disk.collection.unavailable")
    if (props.active && props.node)
      return language.t("disk.collection.release", { name: props.node.name })
    if (props.node)
      return language.t("disk.collection.drag", { name: props.node.name })
    if (hasItems) return language.plural("disk.count.itemSelected", props.count)
    return language.t("disk.collection.none")
  })()
  const detail = (() => {
    if (props.node)
      return allocationMayRemain
        ? language.t("disk.collection.selectedRebuild", {
            size: formatBytes(props.node.size),
          })
        : language.t("disk.collection.selectedApprove", {
            size: formatBytes(props.node.size),
          })
    if (hasItems)
      return allocationMayRemain
        ? language.t("disk.collection.selectedRebuild", {
            size: formatBytes(props.bytes),
          })
        : language.t("disk.collection.reviewTrash", {
            size: formatBytes(props.bytes),
            trash: props.trashName,
          })
    return language.t("disk.collection.instructions")
  })()

  return (
    <button
      type="button"
      ref={(element) => {
        props.setElement?.(element)
      }}
      className={cn(
        "relative flex min-h-11 max-w-[min(300px,58vw)] min-w-11 items-center gap-2 rounded-xl border border-border-weaker-base bg-surface-raised-base px-3 text-text-strong shadow-[0_8px_24px_rgb(0_0_0/0.12)] transition-[background-color,border-color] duration-150 outline-none hover:bg-surface-raised-strong focus-visible:ring-2 focus-visible:ring-text-weak motion-reduce:transition-none",
        props.node && "border-text-weak/45",
        props.active && "border-text-strong/70 bg-surface-raised-strong"
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
      <Icon name="trash" className="text-icon-weak size-4 shrink-0" />
      <span className="text-12-medium min-w-0 truncate">
        {props.node
          ? title
          : language.plural("disk.count.itemSelected", props.count)}
      </span>
      {hasItems ? (
        <span className="text-12-regular shrink-0 text-text-weak tabular-nums">
          {formatBytes(props.bytes)}
        </span>
      ) : null}
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {props.active
          ? title
          : hasItems
            ? language.plural("disk.count.itemSelected", props.count)
            : language.t("disk.collection.noneStatus")}
      </span>
    </button>
  )
}
