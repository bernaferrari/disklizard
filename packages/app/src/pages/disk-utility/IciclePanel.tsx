import { ArrowUp } from "lucide-react"
import { useDirectoryMotion } from "./use-directory-motion"
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import type { DiskScanNode } from "./types"
import { layoutIcicle } from "./icicle"
import { primarySegmentColor, primarySegmentForeground } from "./sunburst"
import { diskNodeDisplayName } from "./node-display"
import { formatBytes } from "./format"
import { useLanguage } from "./runtime"

export function IciclePanel(props: {
  parentName?: string
  onUp: () => void
  root: DiskScanNode
  colorForNode: (node: DiskScanNode) => string | undefined
  draggingNode?: DiskScanNode | null
  selectedPath?: string
  queuedPaths?: readonly string[]
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
  const [width, setWidth] = useState(0)
  const cells = useMemo(
    () => (width > 0 ? layoutIcicle(props.root, 5, width) : []),
    [props.root, width]
  )
  // Keep the native drag source mounted while the rest of the view reflows.
  const previousLayout = useRef(cells)
  const source = useRef<(typeof cells)[number] | undefined>(undefined)
  if (props.draggingNode)
    source.current =
      previousLayout.current.find(
        (item) => item.node.path === props.draggingNode?.path
      ) ?? source.current
  else source.current = undefined
  previousLayout.current = cells
  const retained =
    source.current &&
    !cells.some((item) => item.node.path === source.current!.node.path)
      ? source.current
      : undefined
  const rendered = retained ? [...cells, retained] : cells
  const motionRef = useDirectoryMotion(props.root.path, cells)
  useLayoutEffect(() => {
    const element = motionRef.current
    if (!element) return undefined
    setWidth(element.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const rows = Math.max(1, ...cells.map((cell) => cell.depth + 1))
  return (
    <div
      className="relative flex h-full min-h-0 flex-col justify-center gap-5"
      role="group"
      aria-label={language.t("disk.icicle.label")}
    >
      <div className="text-13-medium flex items-baseline justify-between gap-3 text-text-strong">
        <div className="min-w-0">
          {props.parentName && (
            <button
              type="button"
              onClick={props.onUp}
              className="mb-1 flex min-h-9 max-w-full items-center gap-2 rounded-md px-2 text-xs text-text-weak hover:bg-surface-raised-strong focus-visible:outline"
              aria-label={language.t("disk.navigation.parent", {
                name: props.parentName,
              })}
            >
              <ArrowUp className="size-3.5 shrink-0" />
              <span className="truncate">{props.parentName}</span>
            </button>
          )}
          <span className="block truncate px-2">
            {diskNodeDisplayName(props.root)}
          </span>
        </div>
        <span className="shrink-0 tabular-nums">
          {formatBytes(props.root.size)}
        </span>
      </div>
      <div className="min-h-0 overflow-y-auto">
        <div ref={motionRef} className="relative" style={{ height: rows * 68 }}>
          {rendered.map((cell) => (
            <button
              type="button"
              key={cell.node.path}
              data-disk-layer-path={cell.node.path}
              className="@container absolute overflow-hidden rounded-lg text-left shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] transition-[filter] duration-100 outline-none hover:z-10 hover:brightness-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-text-strong"
              style={{
                left: `${cell.x * 100}%`,
                width: `max(1px, calc(${cell.width * 100}% - 4px))`,
                top: cell.depth * 68,
                height: 60,
                opacity: retained === cell ? 0 : 1,
                pointerEvents: retained === cell ? "none" : undefined,
                backgroundColor: cell.node.isOther
                  ? cell.depth === 0
                    ? "oklch(0.7 0.008 250)"
                    : `color-mix(in oklab, ${primarySegmentColor(cell.colorIndex, 1, true, cell.depth)} 70%, oklch(0.87 0 0))`
                  : (props.colorForNode(cell.node) ??
                    primarySegmentColor(
                      cell.colorIndex,
                      1,
                      cell.node.isDir,
                      cell.depth
                    )),
                color: primarySegmentForeground(),
                boxShadow:
                  props.selectedPath === cell.node.path
                    ? "inset 0 0 0 2px var(--text-strong)"
                    : props.queuedPaths?.some(
                          (path) =>
                            cell.node.path === path ||
                            cell.node.path.startsWith(
                              path.replace(/[\\/]+$/, "") +
                                (path.includes("\\") ? "\\" : "/")
                            )
                        )
                      ? "inset 0 0 0 2px var(--text-strong)"
                      : "inset 0 1px 0 rgb(255 255 255 / 0.12)",
              }}
              aria-label={`${diskNodeDisplayName(cell.node)} · ${formatBytes(cell.node.size)}`}
              title={`${cell.node.path}\n${formatBytes(cell.node.size)}`}
              aria-pressed={props.selectedPath === cell.node.path}
              onClick={() => {
                if (cell.node.isDir || cell.node.isOther)
                  props.onDrill(cell.node)
                else props.onSelect(cell.node.path)
              }}
              onKeyDown={(event) => {
                if (
                  event.key === " " &&
                  !cell.node.isOther &&
                  !cell.node.isHidden
                ) {
                  event.preventDefault()
                  props.onPreview(cell.node)
                }
                if (event.key === "Enter") {
                  event.preventDefault()
                  if (cell.node.isDir || cell.node.isOther)
                    props.onDrill(cell.node)
                  else props.onSelect(cell.node.path)
                }
              }}
              onFocus={() => props.onHover(cell.node)}
              onBlur={() => props.onHover(null)}
              onMouseEnter={() => props.onHover(cell.node)}
              onMouseLeave={() => props.onHover(null)}
              draggable={props.canCollect(cell.node)}
              onDragStart={(event) =>
                props.onDragStart(event.nativeEvent, cell.node)
              }
              onDragEnd={props.onDragEnd}
            >
              <span className="text-13-semibold block truncate px-3 @max-[45px]:hidden">
                {diskNodeDisplayName(cell.node)}
              </span>
              <span className="text-12-regular mt-1.5 block truncate px-3 tabular-nums opacity-75 @max-[75px]:hidden">
                {formatBytes(cell.node.size)}
              </span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-12-regular text-text-weak">
        {language.t("disk.icicle.hint")}
      </p>
    </div>
  )
}
