import type { PointerDragSource } from "./pointer-drag"
import { ArrowLeft } from "lucide-react"
/**
 * Treemap view: tiles zoom within a persistent, clickable parent surface.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react"
import type { DiskScanNode } from "./types"
import { formatBytes, shortBytes } from "./format"
import { layoutNestedTreemap } from "./nested-treemap"
import { useLanguage } from "./runtime"
import { diskNodeDisplayName } from "./node-display"
import { surfaceRing } from "./ui-tokens"
import { storageSummaryColor, storageTileColor } from "./visual-palette"
import { useTileCamera } from "./use-tile-camera"
import { AggregatePreview } from "./AggregatePreview"

export function Treemap(props: {
  rootPath: string
  parent?: { node: DiskScanNode; onUp: () => void }
  rootIsAggregate?: boolean
  colorForPath: (path: string) => string | undefined
  colorForNode: (node: DiskScanNode) => string | undefined
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
  onCollectDragStart: (event: PointerDragSource, node: DiskScanNode) => void
  onPrepareNavigation?: (prepare: ((path: string) => void) | null) => void
}) {
  const language = useLanguage()
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const hasParent = !!props.parent
  const insetX = 0
  const insetTop = hasParent ? 42 : 0
  const insetBottom = 0
  const rects = useMemo(
    () =>
      layoutNestedTreemap(
        props.children,
        Math.max(0, bounds.width - insetX * 2),
        Math.max(0, bounds.height - insetTop - insetBottom),
        props.rootPath,
        undefined,
        props.rootIsAggregate
      ).map((rect) =>
        hasParent
          ? {
              ...rect,
              x: rect.x + insetX,
              y: rect.y + insetTop,
            }
          : rect
      ),
    [
      props.children,
      props.rootPath,
      props.rootIsAggregate,
      hasParent,
      bounds.width,
      bounds.height,
    ]
  )
  const siblingRailRef = useRef<HTMLDivElement>(null)
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
  // The exposed frame carries the clicked tile's color into its descendants.
  const rootColor = props.colorForPath(props.rootPath)
  const parentColor = props.parent
    ? (props.colorForNode(props.parent.node) ??
      props.colorForPath(props.parent.node.path))
    : undefined
  const parentName = props.parent
    ? props.parent.node._label || diskNodeDisplayName(props.parent.node)
    : ""
  const siblings = useMemo(
    () =>
      props.parent?.node.children
        .filter((node) => node.size > 0)
        .toSorted((a, b) => b.size - a.size) ?? [],
    [props.parent?.node]
  )
  const siblingIndex = useMemo(
    () => siblings.findIndex((node) => node.path === props.rootPath),
    [siblings, props.rootPath]
  )
  const nearbySiblings = useMemo(
    () =>
      siblingIndex < 0
        ? []
        : siblings.slice(
            Math.max(0, siblingIndex - 2),
            Math.min(siblings.length, siblingIndex + 3)
          ),
    [siblings, siblingIndex]
  )
  useLayoutEffect(() => {
    const rail = siblingRailRef.current
    const current = rail?.querySelector<HTMLElement>(
      "[data-disk-current-sibling]"
    )
    if (!rail || !current) return
    const railBox = rail.getBoundingClientRect()
    const currentBox = current.getBoundingClientRect()
    rail.scrollLeft +=
      currentBox.left - railBox.left - (railBox.width - currentBox.width) / 2
  }, [props.rootPath, nearbySiblings, bounds.width])
  const { rootRef, prepareNavigation } = useTileCamera(
    props.rootPath,
    rects,
    nearbySiblings
  )
  const prepareRef = useRef(prepareNavigation)
  prepareRef.current = prepareNavigation
  useLayoutEffect(() => {
    props.onPrepareNavigation?.((path) => prepareRef.current(path))
    return () => props.onPrepareNavigation?.(null)
  }, [props.onPrepareNavigation])

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
      className="dl-treemap relative size-full overflow-hidden"
      role="group"
      aria-label={language.t("disk.treemap.label")}
    >
      {props.parent ? (
        <div className="dl-treemap-chrome absolute inset-x-0 top-0 z-10 flex h-[42px] items-center gap-2 bg-background-base">
          <button
            type="button"
            onClick={() => {
              props.parent?.onUp()
            }}
            aria-label={language.t("disk.navigation.parent", {
              name: parentName,
            })}
            className="flex h-9 max-w-[40%] min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-[12px] font-medium text-text-weak transition-colors duration-150 outline-none hover:bg-[var(--dl-well)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
          >
            <ArrowLeft aria-hidden className="size-3.5 shrink-0" />
            <span
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: parentColor ?? "var(--dl-accent)" }}
              aria-hidden
            />
            <span className="min-w-0 truncate">{parentName}</span>
          </button>
          {nearbySiblings.length > 1 ? (
            <div
              ref={siblingRailRef}
              className="ml-auto flex min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden"
            >
              {nearbySiblings.map((node) => {
                const current = node.path === props.rootPath
                const color = props.colorForNode(node) ?? "var(--text-weaker)"
                const label = diskNodeDisplayName(node)
                const content = (
                  <>
                    <span
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                    <span className="min-w-0 truncate">{label}</span>
                  </>
                )
                return current ? (
                  <span
                    key={node.path}
                    data-disk-current-sibling
                    aria-current="location"
                    className="flex h-7 max-w-28 shrink-0 items-center gap-1.5 rounded-md bg-[var(--dl-well)] px-2 text-[12px] font-medium text-text-strong"
                    title={`${label} · ${formatBytes(node.size)}`}
                  >
                    {content}
                  </span>
                ) : (
                  <button
                    key={node.path}
                    type="button"
                    data-disk-sibling-path={node.path}
                    className="flex h-7 max-w-28 shrink-0 items-center gap-1.5 rounded-md px-2 text-left text-[12px] text-text-weak transition-colors duration-150 outline-none hover:bg-[var(--dl-well)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
                    title={`${label} · ${formatBytes(node.size)}`}
                    aria-label={language.t(
                      node.isOther
                        ? "disk.treemap.moreLabel"
                        : node.isDir
                          ? "disk.treemap.folderLabel"
                          : "disk.treemap.fileLabel",
                      { name: `${label} · ${node.path}` }
                    )}
                    onPointerEnter={() => props.onHover(node)}
                    onPointerLeave={() => props.onHover(null)}
                    onFocus={() => props.onHover(node)}
                    onBlur={() => props.onHover(null)}
                    onClick={() => {
                      if (node.isOther) props.onShowAll(node)
                      else if (node.isDir) props.onDrill(node)
                      else props.onSelect(node.path)
                    }}
                  >
                    {content}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      <div data-disk-tile-scene className="absolute inset-0">
        <div data-disk-tile-content className="absolute inset-0">
          {rendered.map((r) => {
            // Summaries take the same tone the list and map give them, so
            // "N smaller items" reads as one thing across every view.
            const tileColor = r.node.isOther
              ? (props.colorForNode(r.node) ??
                props.colorForPath(r.parent?.path ?? props.rootPath) ??
                parentColor ??
                rootColor ??
                props.colorForNode(r.node.children[0]) ??
                storageSummaryColor(r.index, r.depth, "tile"))
              : (props.colorForNode(r.node) ??
                rootColor ??
                storageTileColor(r.index, r.depth))
            const hasPreview =
              props.rootIsAggregate &&
              r.node.isOther &&
              r.node.children.length > 0 &&
              r.w >= 140 &&
              r.h >= 100
            const previewFillsRoot = hasPreview && props.rootIsAggregate
            const sizeLabel =
              !r.expanded && r.w < 112
                ? shortBytes(r.node.size)
                : formatBytes(r.node.size)
            // Budget one line of 12px tabular text plus the tile padding.
            // Narrow, tall tiles can still explain their size without crowding the name.
            // Nested headers name their folder only; the tiles inside already
            // carry sizes, so repeating one per level is just more chrome.
            const sizeFits = r.expanded
              ? r.depth === 0 && r.w >= 260
              : r.h >= 64 &&
                r.w >= sizeLabel.length * 7.5 + (r.w < 100 ? 12 : 20)
            // Label a tile only when a meaningful part of its name fits;
            // stubs like "Libr…" add noise without telling anyone anything.
            const tileName = r.displayName ?? diskNodeDisplayName(r.node)
            const nameFits =
              r.expanded ||
              (r.h >= 30 &&
                r.w - (r.w < 100 ? 12 : 20) >=
                  Math.min(tileName.length, 9) * 8.2)
            const queued = props.queuedPaths?.some(
              (path) =>
                r.node.path === path ||
                r.node.path.startsWith(
                  path.replace(/[\\/]+$/, "") +
                    (path.includes("\\") ? "\\" : "/")
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
                ? hasPreview
                  ? "transparent"
                  : `color-mix(in oklab, ${tileColor} var(--dl-tile-summary-mix), var(--background-base))`
                : r.expanded
                  ? `color-mix(in oklab, ${tileColor} var(--dl-tile-shell-mix), var(--background-base))`
                  : `color-mix(in oklab, ${tileColor} var(--dl-tile-fill-mix), var(--background-base))`,
              color: "var(--text-strong)",
              boxShadow:
                props.selectedPath === r.node.path
                  ? `inset 0 0 0 2px ${surfaceRing()}`
                  : queued
                    ? `inset 0 0 0 2px ${surfaceRing()}`
                    : undefined,
            }
            const content = hasPreview ? (
              !previewFillsRoot ? (
                <span className="dl-treemap-text pointer-events-none absolute right-1.5 bottom-1.5 z-[1] inline-flex max-w-[calc(100%-12px)] items-center gap-2 rounded-md bg-background-base/90 px-2 py-1 text-[12px] font-medium text-text-strong">
                  <span className="min-w-0 truncate">
                    {diskNodeDisplayName(r.node)}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatBytes(r.node.size)}
                  </span>
                </span>
              ) : null
            ) : nameFits ? (
              <span
                className={
                  r.expanded
                    ? "dl-treemap-text pointer-events-none absolute inset-x-0 top-0 z-[1] flex items-center justify-between gap-2 px-2.5"
                    : `dl-treemap-text pointer-events-none relative z-[1] flex h-full flex-col justify-between gap-1 ${r.w < 100 ? "p-1.5" : "p-2.5"}`
                }
                style={
                  r.expanded ? { height: r.depth === 0 ? 34 : 28 } : undefined
                }
              >
                <span className="block max-w-full min-w-0 flex-1">
                  <span
                    className={
                      !r.expanded && r.w >= 120 && r.h >= 88
                        ? "line-clamp-2 text-[13px] leading-[18px] font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]"
                        : "block truncate text-[13px] leading-5 font-semibold tracking-[-0.01em]"
                    }
                  >
                    {r.displayName ?? diskNodeDisplayName(r.node)}
                  </span>
                  {repeatedNames.has(
                    diskNodeDisplayName(r.node).toLocaleLowerCase()
                  ) &&
                  !r.expanded &&
                  r.w >= 145 &&
                  r.h >= 90 ? (
                    <span
                      className="mt-1 block truncate text-[11px] leading-4 opacity-70"
                      title={r.node.path}
                    >
                      {r.node.path
                        .replace(/[\\/][^\\/]+$/, "")
                        .replace(props.rootPath, "")
                        .replace(/^[\\/]+/, "") || props.rootPath}
                    </span>
                  ) : null}
                </span>
                {sizeFits ? (
                  <span className="inline-flex max-w-full shrink-0 truncate text-[12px] leading-5 font-medium tabular-nums">
                    {sizeLabel}
                  </span>
                ) : null}
              </span>
            ) : null
            return (
              <button
                type="button"
                key={r.node.path}
                aria-pressed={props.selectedPath === r.node.path}
                aria-label={
                  r.node.isOther && props.rootIsAggregate
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
                title={`${r.displayName ?? diskNodeDisplayName(r.node)} · ${formatBytes(r.node.size)}\n${r.node.path}${queued ? `\n${language.t("disk.review.queued")}` : ""}`}
                className={`group absolute z-[2] cursor-pointer overflow-hidden rounded-[3px] text-left transition-[box-shadow] duration-150 outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]`}
                style={style}
                onPointerEnter={() => props.onHover(r.node)}
                onPointerLeave={() => props.onHover(null)}
                onFocus={() => props.onHover(r.node)}
                onBlur={() => props.onHover(null)}
                onPointerDown={(event) => {
                  if (props.canCollect(r.node))
                    props.onCollectDragStart(event, r.node)
                }}
                onKeyDown={(event) => {
                  // Aggregates open their retained children in the sidebar.
                  if (event.key === "Enter") {
                    event.preventDefault()
                    if (r.node.isOther) props.onShowAll(r.node)
                    else if (r.node.isDir)
                      props.onDrill(r.drillNode ?? r.node, true)
                    else props.onSelect(r.node.path)
                    return
                  }
                  if (
                    event.key === " " &&
                    !r.node.isOther &&
                    !r.node.isHidden
                  ) {
                    event.preventDefault()
                    props.onPreview?.(r.node)
                  }
                }}
                onClick={() => {
                  if (r.node.isOther) {
                    props.onShowAll(r.node)
                    return
                  }
                  if (r.node.isDir) props.onDrill(r.drillNode ?? r.node)
                  else props.onSelect(r.node.path)
                }}
              >
                {hasPreview ? (
                  <AggregatePreview
                    children={r.node.children}
                    width={r.w}
                    height={r.h}
                    color={tileColor}
                  />
                ) : null}
                {content}
                {!hasPreview ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 bg-[oklch(1_0_0_/_0)] transition-colors duration-150 group-hover:bg-[var(--dl-tile-hover)]"
                    style={
                      props.hoveredPath === r.node.path
                        ? { backgroundColor: "var(--dl-tile-hover)" }
                        : undefined
                    }
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
      <div
        data-disk-tile-ghost-host
        className="pointer-events-none absolute inset-0 z-[3]"
        aria-hidden="true"
        inert
      />
    </div>
  )
}
