import { For, createMemo } from "solid-js"
import type { DiskScanNode } from "./types"
import { layoutIcicle } from "./icicle"
import { primarySegmentColor, primarySegmentForeground } from "./sunburst"
import { diskNodeDisplayName } from "./node-display"
import { formatBytes } from "./format"
import { useLanguage } from "./runtime"

export function IciclePanel(props: {
  root: DiskScanNode
  selectedPath?: string
  onSelect: (path: string) => void
  onHover: (node: DiskScanNode | null) => void
  onReveal: (node: DiskScanNode) => void
  onPreview: (node: DiskScanNode) => void
  onDrill: (node: DiskScanNode) => void
  canCollect: (node: DiskScanNode) => boolean
  onDragStart: (event: DragEvent, node: DiskScanNode) => void
  onDragEnd: () => void
}) {
  const language = useLanguage()
  const cells = createMemo(() => layoutIcicle(props.root))
  return (
    <div
      class="flex h-full min-h-0 flex-col justify-center gap-4"
      role="group"
      aria-label={language.t("disk.icicle.label")}
    >
      <div class="flex items-baseline justify-between gap-3 text-13-medium text-text-strong">
        <span class="truncate">{diskNodeDisplayName(props.root)}</span>
        <span class="shrink-0 tabular-nums">{formatBytes(props.root.size)}</span>
      </div>
      <div class="relative h-[min(70%,360px)] min-h-[220px]">
        <For each={cells()}>
          {(cell) => (
            <button
              type="button"
              data-disk-layer-path={cell.node.path}
              class="dl-layer-cell absolute overflow-hidden rounded-[5px] text-left outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-text-strong"
              style={{
                left: `${cell.x * 100}%`,
                width: `max(1px, calc(${cell.width * 100}% - 2px))`,
                top: `${cell.depth * 25}%`,
                height: "calc(25% - 3px)",
                background: cell.node.isOther
                  ? "var(--surface-raised-strong)"
                  : primarySegmentColor(cell.colorIndex, 1, cell.depth > 0 || cell.node.isDir),
                "background-image": cell.depth
                  ? `linear-gradient(rgb(0 0 0 / ${cell.depth * 0.07}), rgb(0 0 0 / ${cell.depth * 0.07}))`
                  : undefined,
                color: cell.node.isOther
                  ? "var(--text-strong)"
                  : primarySegmentForeground(cell.depth > 0 || cell.node.isDir),
                "box-shadow":
                  props.selectedPath === cell.node.path
                    ? "inset 0 0 0 2px var(--text-strong)"
                    : "inset 0 1px 0 rgb(255 255 255 / 0.12)",
              }}
              aria-label={`${diskNodeDisplayName(cell.node)} · ${formatBytes(cell.node.size)}`}
              title={`${cell.node.path}\n${formatBytes(cell.node.size)}`}
              aria-pressed={props.selectedPath === cell.node.path}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey) props.onReveal(cell.node)
                else if (cell.node.isDir) props.onDrill(cell.node)
                else props.onSelect(cell.node.path)
              }}
              onKeyDown={(event) => {
                if (event.key === " " && !cell.node.isOther && !cell.node.isHidden) {
                  event.preventDefault()
                  props.onPreview(cell.node)
                }
                if (event.key === "Enter" && cell.node.isDir && !cell.node.isOther) {
                  event.preventDefault()
                  props.onDrill(cell.node)
                }
              }}
              onFocus={() => props.onHover(cell.node)}
              onBlur={() => props.onHover(null)}
              onMouseEnter={() => props.onHover(cell.node)}
              onMouseLeave={() => props.onHover(null)}
              draggable={props.canCollect(cell.node)}
              onDragStart={(event) => props.onDragStart(event, cell.node)}
              onDragEnd={props.onDragEnd}
            >
              <span class="dl-layer-label block truncate px-2 text-12-medium">{diskNodeDisplayName(cell.node)}</span>
              <span class="dl-layer-size mt-1 block truncate px-2 text-12-regular tabular-nums">
                {formatBytes(cell.node.size)}
              </span>
            </button>
          )}
        </For>
      </div>
      <p class="text-12-regular text-text-weak">{language.t("disk.icicle.hint")}</p>
    </div>
  )
}
