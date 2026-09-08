import { ArrowLeft } from "lucide-react"
import { useDirectoryMotion } from "./use-directory-motion"
import { useMemo, useState } from "react"
import type { DiskScanNode } from "./types"
import { layoutIcicle } from "./icicle"
import { primarySegmentColor, primarySegmentForeground } from "./sunburst"
import { diskNodeDisplayName } from "./node-display"
import { formatBytes } from "./format"
import { useLanguage } from "./runtime"

export function IciclePanel(props: {
  flame?: boolean
  onUp: () => void
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
  const [zoom, setZoom] = useState(1)
  const cells = useMemo(() => layoutIcicle(props.root, props.flame ? 32 : 4), [props.root, props.flame])
  const motionRef = useDirectoryMotion(props.root.path, cells)
  const rows = Math.max(1, ...cells.map((cell) => cell.depth + 1))
  return (
    <div
      className={`flex h-full min-h-0 flex-col gap-4 ${props.flame ? "justify-start" : "justify-center"}`}
      role="group"
      aria-label={language.t(props.flame ? "disk.flame.label" : "disk.icicle.label")}
    >
      <div className="flex items-baseline justify-between gap-3 text-13-medium text-text-strong">
        <button type="button" onClick={props.onUp} className="flex min-h-10 min-w-0 items-center gap-2 rounded-md px-2 hover:bg-surface-raised-strong focus-visible:outline" aria-label={language.t("disk.common.back")}><ArrowLeft className="size-4 shrink-0" /><span className="truncate">{diskNodeDisplayName(props.root)}</span></button>
        <span className="shrink-0 tabular-nums">{formatBytes(props.root.size)}</span>
      </div>
      {props.flame && <label className="flex items-center gap-3 text-12-regular text-text-weak">
        {language.t("disk.flame.zoom")}
        <input type="range" min="1" max="8" step="0.5" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-32 accent-current" />
        <span className="tabular-nums">{zoom}×</span>
      </label>}
      <div className={props.flame ? "min-h-0 flex-1 overflow-auto" : "contents"}>
      <div ref={motionRef} className={props.flame ? "relative" : "relative"} style={props.flame ? {width: `${zoom * 100}%`, height: rows * 30} : {height: Math.min(rows, 4) * 72}}>
        {cells.map((cell) => (
          <button
            type="button"
            key={cell.node.path}
            data-disk-layer-path={cell.node.path}
            className="@container absolute overflow-hidden rounded-[5px] text-left outline-none transition-[filter] duration-100 shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:z-10 hover:brightness-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-text-strong"
            style={{
              left: `${cell.x * 100}%`,
              width: `max(1px, calc(${cell.width * 100}% - 2px))`,
              top: props.flame ? cell.depth * 30 : cell.depth * 72,
              height: props.flame ? 27 : 69,
              background: cell.node.isOther
                ? "var(--surface-raised-strong)"
                : primarySegmentColor(cell.colorIndex, 1, cell.node.isDir, cell.depth),
              color: cell.node.isOther
                ? "var(--text-strong)"
                : primarySegmentForeground(cell.depth > 0 || cell.node.isDir),
              boxShadow:
                props.selectedPath === cell.node.path
                  ? "inset 0 0 0 2px var(--text-strong)"
                  : "inset 0 1px 0 rgb(255 255 255 / 0.12)",
            }}
            aria-label={`${diskNodeDisplayName(cell.node)} · ${formatBytes(cell.node.size)}`}
            title={`${cell.node.path}\n${formatBytes(cell.node.size)}`}
            aria-pressed={props.selectedPath === cell.node.path}
            onClick={(event) => {
              if ((event.metaKey || event.ctrlKey) && !cell.node.isOther) props.onReveal(cell.node)
              else if (cell.node.isDir || cell.node.isOther) props.onDrill(cell.node)
              else props.onSelect(cell.node.path)
            }}
            onKeyDown={(event) => {
              if (event.key === " " && !cell.node.isOther && !cell.node.isHidden) {
                event.preventDefault()
                props.onPreview(cell.node)
              }
              if (event.key === "Enter" && (cell.node.isDir || cell.node.isOther)) {
                event.preventDefault()
                props.onDrill(cell.node)
              }
            }}
            onFocus={() => props.onHover(cell.node)}
            onBlur={() => props.onHover(null)}
            onMouseEnter={() => props.onHover(cell.node)}
            onMouseLeave={() => props.onHover(null)}
            draggable={props.canCollect(cell.node)}
            onDragStart={(event) => props.onDragStart(event.nativeEvent, cell.node)}
            onDragEnd={props.onDragEnd}
          >
            <span className="@max-[55px]:hidden block truncate px-2 text-12-medium">{diskNodeDisplayName(cell.node)}</span>
            <span className={`${props.flame ? "hidden" : ""} @max-[90px]:hidden mt-1 block truncate px-2 text-12-regular tabular-nums`}>
              {formatBytes(cell.node.size)}
            </span>
          </button>
        ))}
      </div>
      </div>
      <p className="text-12-regular text-text-weak">{language.t(props.flame ? "disk.flame.hint" : "disk.icicle.hint")}</p>
    </div>
  )
}
