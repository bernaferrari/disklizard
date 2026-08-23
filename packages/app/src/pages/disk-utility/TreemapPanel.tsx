/**
 * Treemap view — "dive into the squares." Squarified rects colored by the
 * shared primarySegmentColor(index), synced bidirectionally with the list.
 * Renders as absolutely-positioned HTML divs (percent-based) so it fills any
 * container without measuring or SVG type friction.
 */

import { For, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import type { DiskScanNode } from "./types"
import { formatBytes } from "./format"
import { collapseTreemapChildren, layoutTreemap } from "./treemap"
import { primarySegmentColor, primarySegmentForeground } from "./sunburst"
import { useLanguage } from "./runtime"

export function Treemap(props: {
  children: DiskScanNode[]
  hoveredPath: string | null
  selectedPath?: string
  onHover: (node: DiskScanNode | null) => void
  onSelect: (path: string) => void
  onReveal?: (node: DiskScanNode) => void
  onPreview?: (node: DiskScanNode) => void
  onDrill: (node: DiskScanNode, restoreListFocus?: boolean) => void
  onShowAll: (restoreListFocus?: boolean) => void
  canCollect: (node: DiskScanNode) => boolean
  onCollectDragStart: (event: DragEvent, node: DiskScanNode) => void
  onCollectDragEnd: () => void
}) {
  const language = useLanguage()
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
      class="relative size-full overflow-hidden rounded-2xl bg-background-base p-0.5 shadow-[0_0_0_1px_rgb(127_127_127/0.1)]"
      role="group"
      aria-label={language.t("disk.treemap.label")}
    >
      <For each={rects()}>
        {(r) => {
          const interactive = () => r.w * bounds().width - 8 >= 44 && r.h * bounds().height - 8 >= 44
          const style = () => ({
            left: `calc(${r.x * 100}% + 4px)`,
            top: `calc(${r.y * 100}% + 4px)`,
            width: `calc(${r.w * 100}% - 8px)`,
            height: `calc(${r.h * 100}% - 8px)`,
            background: primarySegmentColor(r.index, 1, r.node.isDir),
            color: primarySegmentForeground(r.node.isDir),
            "box-shadow": props.hoveredPath === r.node.path ? "inset 0 0 0 2px currentColor" : undefined,
          })
          const content = () => (
            <Show when={r.w > 0.08 && r.h > 0.06}>
              <span class="flex h-full flex-col justify-between p-3">
                <span class="block max-w-full truncate text-13-semibold tracking-[-0.01em]">{r.node.name}</span>
                <Show when={r.w > 0.14 && r.h > 0.1}>
                  <span class="inline-flex max-w-full self-start truncate text-13-regular tabular-nums">
                    {r.node.path.startsWith("disklizard:mosaic-more:") ? (
                      language.t("disk.treemap.openList")
                    ) : (
                      <span class="text-13-semibold">{formatBytes(r.node.size)}</span>
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
                  class="pointer-events-none absolute overflow-hidden rounded-[3px] transition-[box-shadow] duration-150"
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
                    ? language.t("disk.treemap.moreLabel", { name: r.node.name })
                    : language.t(
                        r.node.isDir && !r.node.isOther ? "disk.treemap.folderLabel" : "disk.treemap.fileLabel",
                        { name: r.node.name },
                      )
                }
                data-disk-tile-path={r.node.path}
                class="absolute cursor-pointer overflow-hidden rounded-[3px] text-left outline-none transition-[box-shadow] duration-150 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-white"
                style={style()}
                onPointerEnter={() => props.onHover(r.node)}
                onPointerLeave={() => props.onHover(null)}
                onFocus={() => props.onHover(r.node)}
                onBlur={() => props.onHover(null)}
                onDragStart={(event) => props.onCollectDragStart(event, r.node)}
                onDragEnd={props.onCollectDragEnd}
                onKeyDown={(event) => {
                  // Align Tiles with the map and list: keyboard actions open
                  // or preview, while pointer activation remains selection.
                  if (event.key === "Enter") {
                    event.preventDefault()
                    if (r.node.path.startsWith("disklizard:mosaic-more:")) props.onShowAll(true)
                    else if (r.node.isDir && !r.node.isOther) props.onDrill(r.node, true)
                    return
                  }
                  if (event.key === " " && !r.node.isOther && !r.node.isHidden) {
                    event.preventDefault()
                    props.onPreview?.(r.node)
                  }
                }}
                onClick={(event) => {
                  if (r.node.path.startsWith("disklizard:mosaic-more:")) {
                    props.onShowAll()
                    return
                  }
                  if (event.metaKey || event.ctrlKey) {
                    props.onReveal?.(r.node)
                    return
                  }
                  props.onSelect(r.node.path)
                }}
                onDblClick={() => {
                  if (r.node.isDir && !r.node.isOther) props.onDrill(r.node)
                }}
              >
                {content()}
              </button>
            </Show>
          )
        }}
      </For>
      <Show when={props.hoveredPath}>
        <div class="pointer-events-none absolute bottom-4 left-4 rounded-full bg-background-base/84 px-3 py-1.5 text-13-semibold text-text-strong shadow-[0_0_0_1px_rgb(127_127_127/0.12),0_8px_24px_rgb(0_0_0/0.1)] backdrop-blur-xl">
          {(() => {
            const node = rects().find((r) => r.node.path === props.hoveredPath)?.node
            return node ? `${node.name} · ${formatBytes(node.size)}` : ""
          })()}
        </div>
      </Show>
    </div>
  )
}
