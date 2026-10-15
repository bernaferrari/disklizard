import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react"
import {
  hideCollectionDragPreview,
  moveCollectionDragPreview,
  showCollectionDragPreview,
} from "./collection-drag-preview"
import { trackPointerDrag, type PointerDragSource } from "./pointer-drag"
import { diskNodeDisplayName } from "./node-display"
import { shortBytes } from "./format"
import { aggregateTone, toneCss } from "./spectrum"
import type { DiskScanNode } from "./types"

type CanvasPointerEvent = ReactPointerEvent<HTMLCanvasElement>
type CollectionDragOptions = {
  canDrag(node: DiskScanNode): boolean
  canModify(node: DiskScanNode): boolean
  collect(nodes: readonly DiskScanNode[]): void
  color(node: DiskScanNode): string | undefined
  nodeAtPoint(x: number, y: number): DiskScanNode | undefined
  suppressNextClick(): void
}

/** Owns one pointer session for rows, previews, tiles and map wedges. */
export function useCollectionDrag(options: CollectionDragOptions) {
  const latest = useRef(options)
  latest.current = options
  const [collectionDragNode, setCollectionDragNode] =
    useState<DiskScanNode | null>(null)
  const [collectionDropActive, setCollectionDropActive] = useState(false)
  const collectionDragPreviewRef = useRef<HTMLDivElement | null>(null)
  const collectionDropElementRef = useRef<HTMLElement | undefined>(undefined)
  const cancelCollectionDragRef = useRef<(() => void) | undefined>(undefined)
  function showDragToken(node: DiskScanNode, x: number, y: number) {
    const color = latest.current.color(node)
    showCollectionDragPreview(
      collectionDragPreviewRef.current!,
      diskNodeDisplayName(node),
      shortBytes(node.size),
      color ?? toneCss(aggregateTone(0))
    )
    moveCollectionDragPreview(collectionDragPreviewRef.current!, x, y)
  }
  function endCollectionDrag() {
    cancelCollectionDragRef.current = undefined
    if (collectionDragPreviewRef.current)
      hideCollectionDragPreview(collectionDragPreviewRef.current)
    setCollectionDragNode(null)
    setCollectionDropActive(false)
  }
  /** One pointer-driven drag for map wedges, tiles, rows, and previews. */
  function beginCollectionDrag(
    event: PointerDragSource,
    node: DiskScanNode | null,
    onStart?: () => void
  ) {
    if (event.button !== 0 || !node || !latest.current.canDrag(node)) return
    cancelCollectionDragRef.current?.()
    cancelCollectionDragRef.current = trackPointerDrag(event, {
      threshold: event.pointerType === "touch" ? 18 : 6,
      onStart: (x, y) => {
        onStart?.()
        setCollectionDragNode(node)
        setCollectionDropActive(false)
        showDragToken(node, x, y)
      },
      onMove: (x, y) => {
        if (collectionDragPreviewRef.current)
          moveCollectionDragPreview(collectionDragPreviewRef.current, x, y)
        setCollectionDropActive(
          latest.current.canModify(node) && pointerInsideCollectionTarget(x, y)
        )
      },
      onEnd: (x, y, cancelled) => {
        if (
          !cancelled &&
          latest.current.canModify(node) &&
          pointerInsideCollectionTarget(x, y)
        )
          latest.current.collect([node])
        endCollectionDrag()
      },
    })
  }

  function beginMapDrag(event: CanvasPointerEvent) {
    const node = latest.current.nodeAtPoint(event.clientX, event.clientY)
    beginCollectionDrag(event, node ?? null, () =>
      latest.current.suppressNextClick()
    )
  }

  function pointerInsideCollectionTarget(x: number, y: number) {
    const rect = collectionDropElementRef.current?.getBoundingClientRect()
    const slop = 16
    return (
      !!rect &&
      x >= rect.left - slop &&
      x <= rect.right + slop &&
      y >= rect.top - slop &&
      y <= rect.bottom + slop
    )
  }

  function cancel() {
    cancelCollectionDragRef.current?.()
    endCollectionDrag()
  }
  useEffect(() => () => cancelCollectionDragRef.current?.(), [])
  return {
    collectionDragNode,
    collectionDropActive,
    collectionDragPreviewRef,
    collectionDropElementRef,
    beginCollectionDrag,
    beginMapDrag,
    cancel,
  }
}
