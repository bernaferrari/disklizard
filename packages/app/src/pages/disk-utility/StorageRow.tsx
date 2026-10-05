import type { KeyboardEvent, MouseEvent } from "react"
import { Check, ChevronRight, Plus } from "lucide-react"
import type { PointerDragSource } from "./pointer-drag"
import { cn } from "@/lib/utils"
import { SearchHighlight } from "./SearchHighlight"
import { formatBytes } from "./format"
import { diskNodeDisplayName } from "./node-display"
import { itemIdentity } from "./item-identity"
import { useLanguage } from "./runtime"
import type { DiskScanNode } from "./types"

/**
 * One line of the storage ledger: color dot, name, size. Everything else —
 * the location line, the collect toggle, the drill chevron — appears only
 * when it carries information for this row.
 */
export function StorageRow(props: {
  node: DiskScanNode
  index: number
  size: number
  color: string
  query: string
  location?: string
  active: boolean
  hovered: boolean
  collected: boolean
  includedBy?: string
  canCollect: boolean
  draggable: boolean
  onActivate: (event: MouseEvent<HTMLButtonElement>) => void
  onFocus: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  onHover: (hovered: boolean) => void
  onToggleCollect: () => void
  onDragStart: (event: PointerDragSource) => void
}) {
  const language = useLanguage()
  const name = diskNodeDisplayName(props.node)
  const aggregate = !!props.node.isOther
  const reviewName = itemIdentity(props.node).reviewTitle
  return (
    <div
      className={cn(
        "group relative flex h-full items-center rounded-md transition-colors duration-100",
        !props.active &&
          (props.hovered
            ? "bg-[var(--dl-row-hover)]"
            : "hover:bg-[var(--dl-row-hover)]")
      )}
      style={
        props.active
          ? {
              backgroundColor: `color-mix(in oklab, ${props.color} 18%, var(--background-base))`,
            }
          : undefined
      }
      onMouseEnter={() => props.onHover(true)}
      onMouseLeave={() => props.onHover(false)}
    >
      <button
        type="button"
        data-disk-index={props.index}
        aria-current={props.active ? "true" : undefined}
        onPointerDown={(event) => {
          if (props.draggable) props.onDragStart(event)
        }}
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-md pr-2 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] focus-visible:ring-inset"
        title={props.node.path}
        onClick={props.onActivate}
        onFocus={props.onFocus}
        onKeyDown={props.onKeyDown}
      >
        <span
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            !props.node.isDir && !aggregate && "rounded-[3px]"
          )}
          style={{ background: props.color }}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-[13.5px] leading-5",
              aggregate || props.collected || props.includedBy
                ? "text-text-weak"
                : "text-text-strong"
            )}
          >
            <SearchHighlight text={name} query={props.query} />
          </span>
          {props.location ? (
            <span
              className={cn(
                "block truncate text-[11.5px] leading-4 group-focus-within:text-text-weak group-hover:text-text-weak",
                props.active || props.hovered
                  ? "text-text-weak"
                  : "text-text-weaker"
              )}
            >
              <SearchHighlight text={props.location} query={props.query} />
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span
            className={cn(
              "text-[13px] leading-5 tabular-nums",
              aggregate ? "text-text-weak" : "text-text-base"
            )}
          >
            {formatBytes(props.size)}
          </span>
          {props.includedBy ? (
            <span className="max-w-32 truncate text-[11px] leading-4 text-text-weak">
              {language.t("disk.review.includedWith", {
                name: props.includedBy,
              })}
            </span>
          ) : null}
        </span>
        <span className="w-6 shrink-0" aria-hidden />
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-text-weaker",
            props.node.isDir && !aggregate ? "opacity-60" : "opacity-0"
          )}
          aria-hidden
        />
      </button>
      {props.canCollect && !props.includedBy ? (
        <button
          type="button"
          className={cn(
            "absolute top-1/2 right-[34px] grid size-6 -translate-y-1/2 place-items-center rounded-full transition-[opacity,background-color,color] duration-150 outline-none before:absolute before:-inset-1 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]",
            props.collected
              ? "bg-[var(--dl-accent)] text-white opacity-100"
              : "bg-[var(--dl-raised)] text-text-strong opacity-0 shadow-[0_1px_3px_rgb(0_0_0/0.3)] group-focus-within:opacity-100 group-hover:opacity-100 hover:brightness-110 [@media(hover:none)]:opacity-100"
          )}
          aria-pressed={props.collected}
          aria-label={language.t(
            props.collected
              ? "disk.explore.removeReview"
              : "disk.explore.selectReview",
            { name: reviewName }
          )}
          title={language.t(
            props.collected
              ? "disk.explore.removeReview"
              : "disk.explore.selectReview",
            { name: reviewName }
          )}
          onClick={props.onToggleCollect}
        >
          {props.collected ? (
            <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
          ) : (
            <Plus className="size-3.5" strokeWidth={2.25} aria-hidden />
          )}
        </button>
      ) : null}
    </div>
  )
}
