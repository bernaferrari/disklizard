/**
 * Treemap view — "dive into the squares." Squarified rects colored by the
 * shared primarySegmentColor(index), synced bidirectionally with the list.
 * Renders as absolutely-positioned HTML divs (percent-based) so it fills any
 * container without measuring or SVG type friction.
 */

import { For, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import type { DiskScanNode } from "@/context/platform"
import { formatBytes } from "./format"
import { recognize } from "./recognize"
import { collapseTreemapChildren, layoutTreemap } from "./treemap"
import { primarySegmentColor } from "./sunburst"

export function Treemap(props: {
  children: DiskScanNode[]
  hoveredPath: string | null
  selectedPath?: string
  onHover: (node: DiskScanNode | null) => void
  onSelect: (path: string) => void
  onDrill: (node: DiskScanNode) => void
  onShowAll: () => void
  canCollect: (node: DiskScanNode) => boolean
  onCollectDragStart: (event: DragEvent, node: DiskScanNode) => void
  onCollectDragEnd: () => void
}) {
  const rects = createMemo(() => layoutTreemap(collapseTreemapChildren(props.children), undefined, true))
  const [bounds, setBounds] = createSignal({ width: 0, height: 0 })
  let root!: HTMLDivElement

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setBounds({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(root)
    onCleanup(() => observer.disconnect())
  })

  return (
    <div
      ref={root}
      class="relative size-full overflow-hidden rounded-[20px] bg-background-base p-1 shadow-[0_0_0_1px_rgb(127_127_127/0.1),0_16px_50px_rgb(0_0_0/0.08)]"
      role="group"
      aria-label="Storage mosaic. Small tiles remain available in the adjacent index."
    >
      <For each={rects()}>
        {(r) => {
          const interactive = () => r.w * bounds().width - 8 >= 44 && r.h * bounds().height - 8 >= 44
          const style = () => ({
            left: `calc(${r.x * 100}% + 4px)`,
            top: `calc(${r.y * 100}% + 4px)`,
            width: `calc(${r.w * 100}% - 8px)`,
            height: `calc(${r.h * 100}% - 8px)`,
            background: primarySegmentColor(r.index),
            opacity: props.hoveredPath && props.hoveredPath !== r.node.path ? "0.28" : "1",
          })
          const recognition = () => recognize(r.node)
          const content = () => (
            <Show when={r.w > 0.08 && r.h > 0.06}>
              <span class="flex h-full flex-col justify-between p-2.5 text-white">
                <span
                  class="inline-flex max-w-full self-start rounded-full px-2 py-1 backdrop-blur-md"
                  style={{ color: "rgb(0 0 0 / 0.82)", background: "rgb(255 255 255 / 0.52)" }}
                >
                  <span class="block truncate text-10-semibold">{r.node.name}</span>
                </span>
                <Show when={r.w > 0.14 && r.h > 0.1}>
                  <span
                    class="inline-flex max-w-[46%] self-start truncate rounded-full px-2 py-1 text-9-regular backdrop-blur-md"
                    style={{ color: "rgb(0 0 0 / 0.82)", background: "rgb(255 255 255 / 0.52)" }}
                  >
                    {r.node.path.startsWith("disklizard:mosaic-more:") ? (
                      "Open complete Index"
                    ) : (
                      <>
                        <span class="font-semibold tabular-nums">{formatBytes(r.node.size)}</span>
                        <Show when={recognition().tag}>
                          {(tag) => <span class="ml-1.5 opacity-75">· {tag()}</span>}
                        </Show>
                      </>
                    )}
                  </span>
                </Show>
              </span>
            </Show>
          )
          return (
            <Show
              when={interactive()}
              fallback={
                <div
                  aria-hidden="true"
                  class="pointer-events-none absolute overflow-hidden rounded-[5px] transition-opacity duration-150"
                  style={style()}
                >
                  {content()}
                </div>
              }
            >
              <button
                type="button"
                draggable={props.canCollect(r.node)}
                aria-pressed={props.selectedPath === r.node.path}
                aria-label={
                  r.node.path.startsWith("disklizard:mosaic-more:")
                    ? `${r.node.name}, open the complete Index`
                    : `${r.node.name}, select for details${r.node.isDir && !r.node.isOther ? ", select again to explore" : ""}`
                }
                class="absolute cursor-pointer overflow-hidden rounded-[5px] text-left outline-none transition-[opacity,filter,transform] duration-150 hover:brightness-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-white active:scale-[0.98]"
                style={style()}
                onPointerEnter={() => props.onHover(r.node)}
                onPointerLeave={() => props.onHover(null)}
                onFocus={() => props.onHover(r.node)}
                onBlur={() => props.onHover(null)}
                onDragStart={(event) => props.onCollectDragStart(event, r.node)}
                onDragEnd={props.onCollectDragEnd}
                onClick={() => {
                  if (r.node.path.startsWith("disklizard:mosaic-more:")) {
                    props.onShowAll()
                    return
                  }
                  if (props.selectedPath === r.node.path && r.node.isDir && !r.node.isOther) {
                    props.onDrill(r.node)
                    return
                  }
                  props.onSelect(r.node.path)
                }}
              >
                {content()}
              </button>
            </Show>
          )
        }}
      </For>
      <Show when={props.hoveredPath}>
        <div class="pointer-events-none absolute bottom-4 left-4 rounded-full bg-background-base/84 px-3 py-1.5 text-10-semibold text-text-strong shadow-[0_0_0_1px_rgb(127_127_127/0.12),0_8px_24px_rgb(0_0_0/0.1)] backdrop-blur-xl">
          {(() => {
            const node = rects().find((r) => r.node.path === props.hoveredPath)?.node
            return node ? `${node.name} · ${formatBytes(node.size)}` : ""
          })()}
        </div>
      </Show>
    </div>
  )
}
