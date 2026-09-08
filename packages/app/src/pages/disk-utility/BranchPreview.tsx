import { createMemo, createSignal, For } from "solid-js"
import { createVirtualizer } from "@tanstack/solid-virtual"
import type { DiskScanNode } from "./types"
import { diskNodeDisplayName } from "./node-display"
import { formatBytes } from "./format"

/** Hover and smaller-item groups share a bounded, scrollable directory preview. */
export function BranchPreview(props: { node: DiskScanNode; onOpen: (node: DiskScanNode) => void }) {
  const [viewport, setViewport] = createSignal<HTMLDivElement>()
  const children = createMemo(() => [...props.node.children].sort(
    (a, b) => Number(!!a.isOther) - Number(!!b.isOther) || b.size - a.size,
  ))
  const rows = createVirtualizer<HTMLDivElement, HTMLButtonElement>({
    get count() { return children().length },
    getScrollElement: () => viewport() ?? null,
    estimateSize: () => 40,
    overscan: 5,
    getItemKey: (index) => children()[index].path,
  })
  return (
    <div class="flex min-h-0 flex-1 flex-col px-5 py-5">
      <div class="mb-4 flex items-baseline justify-between gap-4 text-15-medium text-text-strong">
        <span class="truncate">{diskNodeDisplayName(props.node)}</span>
        <span class="shrink-0 tabular-nums">{formatBytes(props.node.size)}</span>
      </div>
      <div ref={setViewport} class="min-h-0 flex-1 overflow-auto">
        <div class="relative" style={{ height: `${rows.getTotalSize()}px` }}>
          <For each={rows.getVirtualItems()}>{(row) => {
            const child = () => children()[row.index]
            return (
              <button type="button"
                class="dl-hover-row absolute top-0 left-0 flex h-10 w-full items-center justify-between gap-4 rounded-md px-2 text-left text-13-regular text-text-weak"
                style={{ transform: `translateY(${row.start}px)` }}
                onClick={() => props.onOpen(child())}>
                <span class="truncate">{diskNodeDisplayName(child())}</span>
                <span class="shrink-0 tabular-nums">{formatBytes(child().size)}</span>
              </button>
            )
          }}</For>
        </div>
      </div>
    </div>
  )
}
