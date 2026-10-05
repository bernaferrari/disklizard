import { ChevronRight } from "lucide-react"
import type { DiskScanNode } from "./types"
import { motion } from "framer-motion"
import { formatBytes } from "./format"
import { diskNodeDisplayName } from "./node-display"
import { useLanguage } from "./runtime"
import { collapseTreemapChildren } from "./treemap"

/** A map hover previews retained children without changing location or scanning. */
export function DiskUtilityHoverContents(props: {
  node: DiskScanNode
  colorForNode: (node: DiskScanNode) => string | undefined
  onLeave: () => void
  onHover: (node: DiskScanNode) => void
  onOpen: (node: DiskScanNode) => void
  onDismiss: () => void
}) {
  const language = useLanguage()
  // This is a contextual glimpse from the parent map. Opening the folder
  // gives its children the full sidebar and map instead of repeating a long
  // scrollable list here.
  const children = collapseTreemapChildren(props.node.children ?? [], 4)

  return (
    <motion.div
      className="relative z-10 flex shrink-0 flex-col border-b border-[var(--dl-separator)] bg-[var(--dl-sidebar)]"
      data-hover-contents={props.node.path}
      role="region"
      aria-label={diskNodeDisplayName(props.node)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
      onMouseLeave={props.onLeave}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.stopPropagation()
        props.onDismiss()
      }}
    >
      <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0 flex-1">
          <h2
            className="truncate text-[18px] leading-6 font-medium tracking-[-0.02em] text-text-strong"
            title={props.node.path}
          >
            {diskNodeDisplayName(props.node)}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-text-weak tabular-nums">
            {language.plural("disk.count.item", props.node.children.length)}
          </p>
        </div>
        <p className="shrink-0 pt-1 text-[13px] leading-5 text-text-weak tabular-nums">
          {formatBytes(props.node.size)}
        </p>
      </div>
      <div className="max-h-[148px] [scrollbar-width:thin] overflow-y-auto overscroll-contain px-2 pt-1 pb-2">
        {children.map((child) => (
          <button
            key={child.path}
            type="button"
            className="group flex h-[34px] w-full items-center gap-3 rounded-md pr-2 pl-3 text-left transition-colors duration-100 outline-none hover:bg-[var(--dl-row-hover)] focus-visible:bg-[var(--dl-row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
            title={child.isOther ? props.node.path : child.path}
            onMouseEnter={() =>
              props.onHover(child.isOther ? props.node : child)
            }
            onFocus={() => props.onHover(child.isOther ? props.node : child)}
            onClick={() => props.onOpen(child.isOther ? props.node : child)}
          >
            <span
              className={`size-2.5 shrink-0 ${child.isDir ? "rounded-full" : "rounded-[3px]"}`}
              style={{
                background: props.colorForNode(child) ?? "var(--text-weaker)",
              }}
              aria-hidden="true"
            />
            <span
              className={`min-w-0 flex-1 truncate text-[13.5px] ${child.isOther ? "text-text-weak" : "text-text-strong"}`}
            >
              {diskNodeDisplayName(child)}
            </span>
            <span className="shrink-0 text-[13px] text-text-base tabular-nums">
              {formatBytes(child.size)}
            </span>
            <ChevronRight
              className="size-3.5 shrink-0 text-text-weak"
              aria-hidden
            />
          </button>
        ))}
      </div>
    </motion.div>
  )
}
