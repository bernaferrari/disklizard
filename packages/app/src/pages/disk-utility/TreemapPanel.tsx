/**
 * Treemap view — "dive into the squares." Squarified rects colored by the
 * shared primarySegmentColor(index), synced bidirectionally with the list.
 * Renders as absolutely-positioned HTML divs (percent-based) so it fills any
 * container without measuring or SVG type friction.
 */

import { For, createMemo, Show } from "solid-js"
import type { DiskScanNode } from "@/context/platform"
import { layoutTreemap } from "./treemap"
import { primarySegmentColor } from "./sunburst"

export function Treemap(props: {
  children: DiskScanNode[]
  hoveredPath: string | null
  selectedPath?: string
  onHover: (path: string | null) => void
  onSelect: (path: string) => void
  onDrill: (node: DiskScanNode) => void
}) {
  const rects = createMemo(() => layoutTreemap(props.children))
  return (
    <div class="relative size-full overflow-hidden rounded-xl">
      <For each={rects()}>
        {(r) => (
          <div
            class="absolute cursor-pointer border border-background-base transition-opacity duration-150"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
              background: primarySegmentColor(r.index),
              opacity: props.hoveredPath && props.hoveredPath !== r.node.path ? "0.35" : "1",
            }}
            onMouseEnter={() => props.onHover(r.node.path)}
            onMouseLeave={() => props.onHover(props.selectedPath ?? null)}
            onClick={() => props.onSelect(r.node.path)}
            onDblClick={() => {
              if (r.node.isDir && !r.node.isOther) props.onDrill(r.node)
            }}
          >
            <Show when={r.w > 0.08 && r.h > 0.06}>
              <span class="block truncate px-1.5 py-1 text-11-medium text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]">
                {r.node.name}
              </span>
            </Show>
          </div>
        )}
      </For>
      <Show when={props.hoveredPath}>
        <div class="pointer-events-none absolute bottom-3 left-3 rounded-md bg-background-base/80 px-3 py-1.5 text-12-semibold text-text-strong backdrop-blur-sm">
          {rects().find((r) => r.node.path === props.hoveredPath)?.node.name}
        </div>
      </Show>
    </div>
  )
}
