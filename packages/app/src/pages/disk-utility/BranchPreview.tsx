import type { PointerDragSource } from "./pointer-drag"
import { X } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useLanguage } from "./runtime"
import { useEffect, useMemo, useState } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import type { DiskScanNode } from "./types"
import { diskNodeDisplayName } from "./node-display"
import { formatBytes } from "./format"

/** Hover and smaller-item groups share a bounded, scrollable directory preview. */
export function BranchPreview(props: {
  canDrag: (node: DiskScanNode) => boolean
  onDragStart: (event: PointerDragSource, node: DiskScanNode) => void
  onDismiss?: () => void
  node: DiskScanNode
  onOpen: (node: DiskScanNode) => void
  colorForNode: (node: DiskScanNode) => string
}) {
  const language = useLanguage()
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (viewport) viewport.scrollTop = 0
  }, [viewport, props.node.path])
  const children = useMemo(
    () =>
      [...props.node.children].sort(
        (a, b) => Number(!!a.isOther) - Number(!!b.isOther) || b.size - a.size
      ),
    [props.node]
  )
  const rows = useVirtualizer<HTMLDivElement, HTMLButtonElement>({
    count: children.length,
    getScrollElement: () => viewport,
    estimateSize: () => 30,
    overscan: 5,
    getItemKey: (index) => children[index].path,
  })
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-5">
      <div className="text-13-medium mb-3 flex items-baseline justify-between gap-4 px-5 text-text-strong">
        <span className="truncate" title={props.node.path}>
          {diskNodeDisplayName(props.node)}
        </span>
        <span className="ml-auto shrink-0 tabular-nums">
          {formatBytes(props.node.size)}
        </span>
        {props.onDismiss && (
          <button
            type="button"
            onClick={props.onDismiss}
            aria-label={language.t("disk.preview.close")}
            className="grid size-7 shrink-0 place-items-center rounded-md text-text-weak hover:bg-surface-raised-strong focus-visible:outline-2"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {props.node.isOther && !children.length ? (
        <p className="text-13-regular px-5 leading-relaxed text-text-weak">
          {language.t("disk.smaller.summary")}
        </p>
      ) : null}
      <ScrollArea
        viewportRef={setViewport}
        className="min-h-0 flex-1"
        viewportClassName="px-3 pb-3"
      >
        <div
          className="relative"
          style={{ height: `${rows.getTotalSize()}px` }}
        >
          {rows.getVirtualItems().map((row) => {
            const child = children[row.index]
            return (
              <button
                key={row.key}
                onPointerDown={(event) => {
                  if (props.canDrag(child)) props.onDragStart(event, child)
                }}
                type="button"
                className="text-13-regular absolute top-0 left-0 flex h-[30px] w-full items-center gap-3 rounded-md px-2 text-left text-text-strong hover:bg-surface-raised-strong focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text-weak"
                title={child.path}
                aria-posinset={row.index + 1}
                aria-setsize={children.length}
                style={{ transform: `translateY(${row.start}px)` }}
                onClick={() => props.onOpen(child)}
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full"
                  style={{ background: props.colorForNode(child) }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {diskNodeDisplayName(child)}
                </span>
                <span className="shrink-0 text-text-weak tabular-nums">
                  {formatBytes(child.size)}
                </span>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}
