import { useDirectoryMotion } from "./use-directory-motion"
/**
 * Treemap view — "dive into the squares." Squarified rects colored by the
 * shared primarySegmentColor(index), synced bidirectionally with the list.
 * Renders as absolutely-positioned HTML divs (percent-based) so it fills any
 * container without measuring or SVG type friction.
 */

import { useEffect, useMemo, useState } from "react"
import type { DiskScanNode } from "./types"
import { formatBytes } from "./format"
import { layoutNestedTreemap } from "./nested-treemap"
import { primarySegmentColor, primarySegmentForeground } from "./sunburst"
import { diskLanguageText, useLanguage } from "./runtime"
import { diskNodeDisplayName } from "./node-display"

export function Treemap(props: {
  rootPath: string
  children: DiskScanNode[]
  hoveredPath: string | null
  selectedPath?: string
  onHover: (node: DiskScanNode | null) => void
  onSelect: (path: string) => void
  onReveal?: (node: DiskScanNode) => void
  onPreview?: (node: DiskScanNode) => void
  onDrill: (node: DiskScanNode, restoreListFocus?: boolean) => void
  onShowAll: (node: DiskScanNode) => void
  canCollect: (node: DiskScanNode) => boolean
  onCollectDragStart: (event: DragEvent, node: DiskScanNode) => void
  onCollectDragEnd: () => void
}) {
  const language = useLanguage()
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const rects = useMemo(
    () => layoutNestedTreemap(props.children, bounds.width, bounds.height),
    [props.children, bounds.width, bounds.height],
  )
  const rootRef = useDirectoryMotion(props.rootPath, rects)

  useEffect(() => {
    const element = rootRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setBounds({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={rootRef}
      className="relative size-full overflow-hidden rounded-2xl bg-background-base p-0.5 shadow-[0_0_0_1px_rgb(127_127_127/0.1)]"
      role="group"
      aria-label={language.t("disk.treemap.label")}
    >
      {rects.map((r) => {
        const openAggregate = () => props.onShowAll(r.node)
        const interactive = r.w >= 44 && r.h >= 32
        const style = {
          left: `${r.x}px`,
          top: `${r.y}px`,
          width: `${r.w}px`,
          height: `${r.h}px`,
          background: r.node.isOther
            ? "var(--surface-raised-strong)"
            : primarySegmentColor(r.index, 1, r.node.isDir, r.depth),
          color: r.node.isOther ? "var(--text-strong)" : primarySegmentForeground(r.depth > 0 || r.node.isDir),
          boxShadow:
            props.hoveredPath === r.node.path || props.selectedPath === r.node.path
              ? "inset 0 0 0 2px currentColor"
              : "inset 0 1px 0 rgb(255 255 255 / 0.12)",
        }
        const content =
          r.w >= 60 && r.h >= 30 ? (
            <span
              className={
                r.expanded
                  ? "flex h-[34px] items-center justify-between gap-2 px-2.5"
                  : "flex h-full flex-col justify-between p-2.5"
              }
            >
              <span className="block max-w-full truncate text-13-semibold tracking-[-0.01em]">
                {diskNodeDisplayName(r.node)}
              </span>
              {r.w >= 120 && (r.expanded || r.h >= 65) ? (
                <span className="inline-flex max-w-full shrink-0 truncate text-12-regular tabular-nums">
                  {r.node.isOther ? (
                    formatBytes(r.node.size)
                  ) : (
                    <span className="text-13-semibold">{formatBytes(r.node.size)}</span>
                  )}
                </span>
              ) : null}
            </span>
          ) : null
        return interactive ? (
          <button
            type="button"
            key={r.node.path}
            draggable={props.canCollect(r.node)}
            aria-pressed={props.selectedPath === r.node.path}
            aria-label={
              r.node.isOther
                ? language.t("disk.treemap.moreLabel", { name: diskNodeDisplayName(r.node) })
                : language.t(r.node.isDir ? "disk.treemap.folderLabel" : "disk.treemap.fileLabel", {
                    name: diskNodeDisplayName(r.node),
                  })
            }
            title={`${r.node.path} · ${formatBytes(r.node.size)}`}
            data-disk-tile-path={r.node.path}
            className="absolute cursor-pointer overflow-hidden rounded-[7px] text-left outline-none transition-[box-shadow] duration-150 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-text-weak"
            style={style}
            onPointerEnter={() => props.onHover(r.node)}
            onPointerLeave={() => props.onHover(null)}
            onFocus={() => props.onHover(r.node)}
            onBlur={() => props.onHover(null)}
            onDragStart={(event) => props.onCollectDragStart(event.nativeEvent, r.node)}
            onDragEnd={props.onCollectDragEnd}
            onKeyDown={(event) => {
              // Align Tiles with the map and list: keyboard actions open
              // or preview, while pointer activation remains selection.
              if (event.key === "Enter") {
                event.preventDefault()
                if (r.node.isOther) openAggregate()
                else if (r.node.isDir) props.onDrill(r.node, true)
                return
              }
              if (event.key === " " && !r.node.isOther && !r.node.isHidden) {
                event.preventDefault()
                props.onPreview?.(r.node)
              }
            }}
            onClick={(event) => {
              if (r.node.isOther) {
                openAggregate()
                return
              }
              if (event.metaKey || event.ctrlKey) {
                props.onReveal?.(r.node)
                return
              }
              if (r.node.isDir) props.onDrill(r.node)
              else props.onSelect(r.node.path)
            }}
          >
            {content}
          </button>
        ) : (
          <div
            key={r.node.path}
            aria-hidden="true"
            className="pointer-events-none absolute overflow-hidden rounded-[7px] transition-[box-shadow] duration-150"
            style={style}
          >
            {content}
          </div>
        )
      })}
      {props.hoveredPath ? (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-full bg-background-base/84 px-3 py-1.5 text-13-semibold text-text-strong shadow-[0_0_0_1px_rgb(127_127_127/0.12),0_8px_24px_rgb(0_0_0/0.1)] backdrop-blur-xl">
          {(() => {
            const node = rects.find((r) => r.node.path === props.hoveredPath)?.node
            return node
              ? diskLanguageText("disk.treemap.hover", {
                  name: diskNodeDisplayName(node),
                  size: formatBytes(node.size),
                })
              : ""
          })()}
        </div>
      ) : null}
    </div>
  )
}
