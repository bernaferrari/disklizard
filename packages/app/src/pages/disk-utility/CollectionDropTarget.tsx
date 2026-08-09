import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import type { DiskScanNode } from "@/context/platform"
import { formatBytes } from "./format"

/**
 * A persistent cleanup destination. It stays visible before drag begins so the
 * interaction is discoverable, while keeping deletion behind a separate review.
 */
export function CollectionDropTarget(props: {
  node: DiskScanNode | null
  active: boolean
  count: number
  bytes: number
  trashName: string
  onReview: () => void
  onClear: () => void
  onDragEnter: (event: DragEvent) => void
  onDragOver: (event: DragEvent) => void
  onDragLeave: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
}) {
  const hasItems = () => props.count > 0
  const title = () => {
    if (props.active && props.node) return `Drop to add ${props.node.name}`
    if (props.node) return `Add ${props.node.name} to cleanup`
    if (hasItems()) return `${props.count} ${props.count === 1 ? "item" : "items"} ready`
    return "Cleanup basket"
  }
  const detail = () => {
    if (props.node) return `${formatBytes(props.node.size)} · Staged for review—nothing moves yet`
    if (hasItems()) return `${formatBytes(props.bytes)} · Review before moving anything to ${props.trashName}`
    return "Drag items here, or select one and press C"
  }

  return (
    <section
      class="dl-cleanup-dock flex min-h-[72px] min-w-0 items-center gap-3 rounded-[14px] px-3.5 py-2.5"
      classList={{
        "dl-cleanup-dock-active": props.active,
        "dl-cleanup-dock-filled": hasItems() && !props.node,
      }}
      onDragEnter={props.onDragEnter}
      onDragOver={props.onDragOver}
      onDragLeave={props.onDragLeave}
      onDrop={props.onDrop}
      aria-label="Cleanup basket drop area"
    >
      <span
        class="dl-cleanup-dock-icon relative grid size-11 shrink-0 place-items-center rounded-full"
        aria-hidden="true"
      >
        <Icon name={props.active ? "arrow-down-to-line" : hasItems() ? "checklist" : "trash"} class="size-[18px]" />
        {hasItems() && !props.node ? (
          <span class="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-text-strong px-1 text-[10px] font-semibold tabular-nums text-background-base">
            {props.count > 99 ? "99+" : props.count}
          </span>
        ) : null}
      </span>

      <span class="min-w-0 flex-1">
        <span class="block truncate text-12-semibold tracking-[-0.01em] text-text-strong">{title()}</span>
        <span class="mt-0.5 block truncate text-10-regular tabular-nums text-text-weak" title={detail()}>
          {detail()}
        </span>
      </span>

      {hasItems() && !props.node ? (
        <span class="flex shrink-0 items-center gap-1">
          <Button
            class="dl-touch-target"
            size="small"
            variant="ghost"
            onClick={props.onClear}
            aria-label="Clear cleanup basket"
          >
            Clear
          </Button>
          <Button class="dl-touch-target" size="small" variant="primary" icon="arrow-right" onClick={props.onReview}>
            Review
          </Button>
        </span>
      ) : (
        <kbd class="dl-shortcut-key shrink-0" aria-label="Keyboard shortcut C">
          C
        </kbd>
      )}

      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {props.active ? title() : hasItems() ? `${props.count} items in cleanup basket` : "Cleanup basket empty"}
      </span>
    </section>
  )
}
