import { Plus, Layers, Trash2, X } from "lucide-react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"
import type { DiskScanNode } from "./types"
import { formatBytes } from "./format"
import { useLanguage } from "./runtime"
import { primaryButton } from "./ExplorerChrome"

/**
 * The collector: a permanent drop well in the corner of the map. Dragging a
 * wedge, tile, or row here stages it; nothing moves to the Trash until the
 * user reviews the collection.
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
  onClear?: () => void
}) {
  const language = useLanguage()
  const hasItems = props.count > 0
  const dragging = !!props.node
  const refused = dragging && !props.acceptsNode
  const allocationMayRemain =
    props.requiresDeepInventoryRefresh ||
    props.hasSharedPhysicalStorage ||
    props.hasUnverifiedPhysicalStorage
  const title = refused
    ? language.t("disk.collection.unavailable")
    : dragging
      ? language.t("disk.ui.collectorDrop")
      : hasItems
        ? language.t("disk.ui.collectorSelected", {
            size: formatBytes(props.bytes),
            count: language.plural("disk.count.item", props.count),
          })
        : language.t("disk.ui.collectorEmpty")
  const detail = hasItems
    ? allocationMayRemain
      ? language.t("disk.collection.selectedRebuild", {
          size: formatBytes(props.bytes),
        })
      : language.t("disk.collection.reviewTrash", {
          size: formatBytes(props.bytes),
          trash: props.trashName,
        })
    : language.t("disk.collection.instructions")

  return (
    <motion.div
      layout
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      style={{ borderRadius: 12 }}
      ref={(element: HTMLDivElement | null) => {
        props.setElement?.(element)
      }}
      className={cn(
        "flex h-11 max-w-full min-w-0 items-center gap-2 rounded-xl p-1.5 transition-[background-color,box-shadow] duration-200",
        // Idle, it is a drop well with a hint, not a button.
        !dragging &&
          !hasItems &&
          "pr-3.5 outline-1 -outline-offset-1 outline-[var(--dl-well-strong)] outline-dashed",
        (dragging || hasItems) &&
          "bg-[var(--dl-popover)] shadow-[0_0_0_0.5px_rgb(255_255_255/0.06),0_8px_28px_rgb(0_0_0/0.28)]",
        props.active &&
          !refused &&
          "shadow-[0_0_0_2px_var(--dl-accent),0_8px_28px_rgb(0_0_0/0.28)]"
      )}
      title={detail}
    >
      <span
        className="grid size-8 shrink-0 place-items-center text-text-weaker"
        aria-hidden
      >
        {hasItems ? <Layers className="size-4" /> : <Plus className="size-4" />}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] tabular-nums">
        <span
          className={
            hasItems || dragging ? "text-text-strong" : "text-text-weak"
          }
        >
          {title}
        </span>
        {!hasItems && !dragging ? (
          <span className="text-text-weaker max-[1279px]:hidden">
            {" · "}
            {language.t("disk.collection.instructions")}
          </span>
        ) : null}
      </span>
      {hasItems && !dragging ? (
        <span className="flex shrink-0 items-center gap-1">
          {props.onClear ? (
            <button
              type="button"
              className="grid size-8 place-items-center rounded-full text-text-weak outline-none hover:bg-[var(--dl-well)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
              aria-label={language.t("disk.collection.clear")}
              title={language.t("disk.collection.clear")}
              onClick={props.onClear}
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            className={cn(primaryButton, "h-8 gap-1.5 rounded-lg px-3")}
            onClick={props.onReview}
          >
            <Trash2 className="size-3.5" aria-hidden />
            {language.t("disk.ui.moveToTrashEllipsis", {
              trash: props.trashName,
            })}
          </button>
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
    </motion.div>
  )
}
