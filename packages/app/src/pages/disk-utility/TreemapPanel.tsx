import { storageTileColor } from "./visual-palette"
import { useTileCamera } from "./use-tile-camera"
/**
 * Treemap view — "dive into the squares." Squarified rects colored by the
 * shared primarySegmentColor(index), synced bidirectionally with the list.
 * Renders as absolutely-positioned HTML divs (percent-based) so it fills any
 * container without measuring or SVG type friction.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import type { DiskScanNode } from "./types"
import { formatBytes } from "./format"
import { layoutNestedTreemap } from "./nested-treemap"
import { primarySegmentForeground } from "./sunburst"
import { useLanguage } from "./runtime"
import { diskNodeDisplayName } from "./node-display"
import { surfaceRing } from "./ui-tokens"

export function Treemap(props: {
  rootPath: string
  colorForPath: (path: string) => string | undefined
  children: DiskScanNode[]
  hoveredPath: string | null
  draggingNode?: DiskScanNode | null
  selectedPath?: string
  queuedPaths?: readonly string[]
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
    () =>
      layoutNestedTreemap(
        props.children,
        bounds.width,
        bounds.height,
        props.rootPath
      ),
    [props.children, props.rootPath, bounds.width, bounds.height]
  )
  // Keep the native drag source mounted while the rest of the view reflows.
  const previousLayout = useRef(rects)
  const source = useRef<(typeof rects)[number] | undefined>(undefined)
  if (props.draggingNode)
    source.current =
      previousLayout.current.find(
        (item) => item.node.path === props.draggingNode?.path
      ) ?? source.current
  else source.current = undefined
  previousLayout.current = rects
  const retained =
    source.current &&
    !rects.some((item) => item.node.path === source.current!.node.path)
      ? source.current
      : undefined
  const rendered = retained ? [...rects, retained] : rects
  const repeatedNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const node of props.children) {
      const name = diskNodeDisplayName(node).toLocaleLowerCase()
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return new Set(
      [...counts].filter(([, count]) => count > 1).map(([name]) => name)
    )
  }, [props.children])
  const rootRef = useTileCamera(props.rootPath, rects)

  useLayoutEffect(() => {
    const element = rootRef.current
    if (!element) return undefined
    const initialBounds = element.getBoundingClientRect()
    setBounds({ width: initialBounds.width, height: initialBounds.height })
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setBounds({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={rootRef}
      className="relative size-full overflow-hidden rounded-2xl bg-background-base p-0.5 shadow-[0_0_0_1px_rgb(127_127_127/0.1)]"
      style={{ backgroundColor: props.colorForPath(props.rootPath) }}
      role="group"
      aria-label={language.t("disk.treemap.label")}
    >
      {rendered.map((r) => {
        const openAggregate = () => props.onShowAll(r.node)
        const queued = props.queuedPaths?.some(
          (path) =>
            r.node.path === path ||
            r.node.path.startsWith(
              path.replace(/[\\/]+$/, "") + (path.includes("\\") ? "\\" : "/")
            )
        )
        const style = {
          left: `${r.x}px`,
          top: `${r.y}px`,
          width: `${r.w}px`,
          height: `${r.h}px`,
          opacity: retained === r ? 0 : 1,
          pointerEvents: retained === r ? ("none" as const) : undefined,
          backgroundColor: r.node.isOther
            ? r.depth === 0
              ? "oklch(0.7 0.008 250)"
              : `color-mix(in oklab, ${props.colorForPath(r.parent?.path ?? props.rootPath) ?? storageTileColor(r.index, r.depth)} 70%, oklch(0.87 0 0))`
            : (props.colorForPath(r.node.path) ??
              props.colorForPath(props.rootPath) ??
              storageTileColor(r.index, r.depth)),
          color: primarySegmentForeground(r.depth > 0 || r.node.isDir),
          boxShadow:
            props.selectedPath === r.node.path
              ? `inset 0 0 0 3px ${surfaceRing()}, inset 0 0 0 5px var(--background-base)`
              : queued
                ? `inset 0 0 0 2px ${surfaceRing()}`
                : props.hoveredPath === r.node.path
                  ? "inset 0 0 0 1px currentColor"
                  : "inset 0 0 0 1px oklch(0.2 0.02 250 / 0.18)",
        }
        const content =
          r.w >= 76 && r.h >= 44 ? (
            <span
              className={
                r.expanded
                  ? "absolute inset-x-0 top-0 flex h-[34px] items-center justify-between gap-2 px-2.5"
                  : "flex h-full flex-col justify-between p-2.5"
              }
            >
              <span className="block max-w-full min-w-0">
                <span className="text-13-semibold block truncate tracking-[-0.01em]">
                  {diskNodeDisplayName(r.node)}
                </span>
                {repeatedNames.has(
                  diskNodeDisplayName(r.node).toLocaleLowerCase()
                ) &&
                r.w >= 145 &&
                r.h >= 68 ? (
                  <span
                    className="text-12-regular mt-1 block truncate opacity-80"
                    title={r.node.path}
                  >
                    {r.node.path
                      .replace(/[\\/][^\\/]+$/, "")
                      .replace(props.rootPath, "")
                      .replace(/^[\\/]+/, "") || props.rootPath}
                  </span>
                ) : null}
              </span>
              {r.w >= (r.expanded ? 220 : 120) && (r.expanded || r.h >= 76) ? (
                <span className="text-12-regular inline-flex max-w-full shrink-0 truncate tabular-nums">
                  {r.node.isOther ? (
                    formatBytes(r.node.size)
                  ) : (
                    <span className="text-13-semibold">
                      {formatBytes(r.node.size)}
                    </span>
                  )}
                </span>
              ) : null}
            </span>
          ) : null
        return (
          <button
            type="button"
            key={r.node.path}
            draggable={props.canCollect(r.node)}
            aria-pressed={props.selectedPath === r.node.path}
            aria-label={
              r.node.isOther
                ? language.t("disk.treemap.moreLabel", {
                    name: diskNodeDisplayName(r.node),
                  })
                : language.t(
                    r.node.isDir
                      ? "disk.treemap.folderLabel"
                      : "disk.treemap.fileLabel",
                    {
                      name: `${diskNodeDisplayName(r.node)} · ${r.node.path}`,
                    }
                  )
            }
            data-disk-tile-path={r.node.path}
            title={`${diskNodeDisplayName(r.node)} · ${formatBytes(r.node.size)}${queued ? `\n${language.t("disk.review.queued")}` : ""}`}
            className="absolute cursor-pointer overflow-hidden rounded-[7px] text-left transition-[box-shadow] duration-150 outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-text-weak"
            style={style}
            onPointerEnter={() => props.onHover(r.node)}
            onPointerLeave={() => props.onHover(null)}
            onFocus={() => props.onHover(r.node)}
            onBlur={() => props.onHover(null)}
            onDragStart={(event) =>
              props.onCollectDragStart(event.nativeEvent, r.node)
            }
            onDragEnd={props.onCollectDragEnd}
            onKeyDown={(event) => {
              // Aggregates open their retained children in the sidebar.
              if (event.key === "Enter") {
                event.preventDefault()
                if (r.node.isOther) openAggregate()
                else if (r.node.isDir) props.onDrill(r.node, true)
                else props.onSelect(r.node.path)
                return
              }
              if (event.key === " " && !r.node.isOther && !r.node.isHidden) {
                event.preventDefault()
                props.onPreview?.(r.node)
              }
            }}
            onClick={() => {
              if (r.node.isOther) {
                openAggregate()
                return
              }
              if (r.node.isDir) props.onDrill(r.node)
              else props.onSelect(r.node.path)
            }}
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}
