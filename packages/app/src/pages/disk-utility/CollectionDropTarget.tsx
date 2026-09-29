import { X } from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
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
        ? language.plural("disk.ui.collectorCount", props.count)
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
      style={{ borderRadius: 9999 }}
      ref={(element: HTMLDivElement | null) => {
        props.setElement?.(element)
      }}
      className={cn(
        "flex h-12 max-w-full min-w-0 items-center gap-3 rounded-full py-1.5 pr-1.5 pl-1.5 transition-[background-color,box-shadow] duration-200",
        (dragging || hasItems) &&
          "bg-[var(--dl-popover)] shadow-[0_0_0_0.5px_rgb(255_255_255/0.06),0_8px_28px_rgb(0_0_0/0.28)]",
        props.active &&
          !refused &&
          "shadow-[0_0_0_2px_var(--dl-accent),0_8px_28px_rgb(0_0_0/0.28)]"
      )}
      title={detail}
    >
      <button
        type="button"
        className={cn(
          "relative grid size-9 shrink-0 place-items-center rounded-full transition-transform duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]",
          props.active && !refused && "scale-110"
        )}
        aria-label={
          hasItems
            ? `${language.t("disk.collection.reviewSelected")} · ${title}`
            : language.t("disk.collection.instructions")
        }
        onClick={() => {
          if (hasItems) props.onReview()
        }}
      >
        <span
          className={cn(
            "absolute inset-0 rounded-full border-2 border-dashed transition-colors",
            refused
              ? "border-[var(--dl-danger)]"
              : props.active || hasItems
                ? "border-[var(--dl-accent)]"
                : "border-text-weaker/60"
          )}
          aria-hidden
        />
        <span
          className={cn(
            "size-4 rounded-full transition-[background-color,transform] duration-200",
            hasItems || props.active
              ? "scale-100 bg-[var(--dl-accent)]"
              : "scale-75 bg-text-weaker/50"
          )}
          aria-hidden
        />
        {hasItems ? (
          <span className="absolute -top-1 -right-1 grid h-4 min-w-4 place-items-center rounded-full bg-text-strong px-1 text-[10px] leading-none font-bold text-background-base tabular-nums">
            {props.count}
          </span>
        ) : null}
      </button>
      <span className="relative min-w-0 flex-1 leading-tight">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={dragging ? "drag" : hasItems ? "items" : "empty"}
            layout="position"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="block"
          >
            <span
              className={cn(
                "block truncate text-[13px]",
                hasItems || dragging
                  ? "font-medium text-text-strong"
                  : "text-text-weak"
              )}
            >
              {title}
            </span>
            {hasItems && !dragging ? (
              <span className="block truncate text-[12px] text-text-weak tabular-nums">
                {formatBytes(props.bytes)}
              </span>
            ) : null}
          </motion.span>
        </AnimatePresence>
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
            className={cn(primaryButton, "h-9 rounded-full px-4")}
            onClick={props.onReview}
          >
            {language.t("disk.ui.cleanup.review")}
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
