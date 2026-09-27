import type { DiskScanNode } from "./types"
import { formatBytes } from "./format"
import { diskNodeDisplayName } from "./node-display"
import { useLanguage } from "./runtime"

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
  const children = (props.node.children ?? []).toSorted(
    (a, b) => b.size - a.size
  )

  return (
    <div
      className="absolute inset-0 z-10 flex min-h-0 flex-col bg-background-base"
      data-hover-contents={props.node.path}
      role="region"
      aria-label={diskNodeDisplayName(props.node)}
      onMouseLeave={props.onLeave}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.stopPropagation()
        props.onDismiss()
      }}
    >
      <div className="flex shrink-0 items-baseline justify-between gap-3 px-4 pt-3 pb-2">
        <h2
          className="text-18-semibold min-w-0 truncate text-text-strong"
          title={props.node.path}
        >
          {diskNodeDisplayName(props.node)}
        </h2>
        <span className="text-12-regular shrink-0 text-text-weak tabular-nums">
          {formatBytes(props.node.size)} ·{" "}
          {language.plural("disk.count.item", children.length)}
        </span>
      </div>
      <div className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto overscroll-contain px-2 pb-3">
        {children.map((child) => (
          <button
            key={child.path}
            type="button"
            className="group flex h-[30px] w-full items-center gap-2.5 rounded-md px-2 text-left transition-colors duration-150 outline-none hover:bg-surface-raised-base focus-visible:bg-surface-raised-base focus-visible:ring-2 focus-visible:ring-text-weak"
            title={child.path}
            onMouseEnter={() => props.onHover(child)}
            onFocus={() => props.onHover(child)}
            onClick={() => props.onOpen(child)}
          >
            <span
              className="size-2 shrink-0 rounded-full"
              style={{
                background: props.colorForNode(child) ?? "var(--text-weaker)",
              }}
              aria-hidden="true"
            />
            <span className="text-13-medium min-w-0 flex-1 truncate text-text-strong">
              {diskNodeDisplayName(child)}
            </span>
            <span className="text-12-regular shrink-0 text-text-weak tabular-nums">
              {formatBytes(child.size)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
