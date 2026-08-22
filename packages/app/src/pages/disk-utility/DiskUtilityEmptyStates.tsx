import { Button } from "@opencode-ai/ui/button"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"
import type { DiskScanNode } from "@/context/platform"
import { formatBytes, formatPct } from "./format"

export function DriveFallback(props: { loading: boolean; error?: string; onChoose: () => void }) {
  return (
    <div class="flex min-h-[520px] flex-1 flex-col items-center justify-center text-center">
      <Show
        when={!props.loading}
        fallback={
          <>
            <span class="dl-spin size-8 rounded-full border-2 border-border-weaker-base border-t-[oklch(0.67_0.13_176)]" />
            <p class="mt-5 text-13-medium text-text-strong">Finding your volumes</p>
            <p class="mt-1 text-13-regular text-text-weak">This should only take a moment.</p>
          </>
        }
      >
        <span class="dl-mark dl-accent-text grid size-12 place-items-center rounded-full">
          <span class="size-3 rounded-full bg-current" />
        </span>
        <h2 class="mt-5 text-20-medium tracking-[-0.025em] text-text-strong">
          {props.error ? "Volumes could not be read" : "Choose where to begin"}
        </h2>
        <p class="mt-2 max-w-sm text-12-regular leading-relaxed text-text-weak">
          {props.error ?? "Pick any folder and DiskLizard will map it without changing a thing."}
        </p>
        <Button data-disk-primary-action class="dl-touch-target mt-5" variant="primary" size="small" icon="folder-add-left" onClick={props.onChoose}>
          Scan a folder
        </Button>
      </Show>
    </div>
  )
}

export function IndexEmpty(props: { filtered: boolean; onReset: () => void }) {
  return (
    <div class="flex min-h-full flex-col items-center justify-center px-8 py-16 text-center">
      <span class="grid size-11 place-items-center rounded-full bg-surface-raised-base text-text-weak">
        <Icon name={props.filtered ? "magnifying-glass" : "folder"} class="size-4" />
      </span>
      <h3 class="mt-4 text-13-semibold text-text-strong">
        {props.filtered ? "Nothing matches these filters" : "This folder is empty"}
      </h3>
      <p class="mt-1 max-w-[30ch] text-13-regular leading-relaxed text-text-weak">
        {props.filtered
          ? "Clear the filters to show every item in this folder."
          : "There are no files or folders here."}
      </p>
      <Show when={props.filtered}>
        <Button class="dl-touch-target mt-4" size="small" variant="secondary" onClick={props.onReset}>
          Show everything
        </Button>
      </Show>
    </div>
  )
}

export function Placeholder(props: { icon: IconProps["name"]; title: string; body: string }) {
  return (
    <div class="flex h-full items-center justify-center px-6">
      <div class="max-w-md text-center">
        <div class="mx-auto mb-5 grid size-12 place-items-center rounded-full bg-surface-raised-base shadow-[0_0_0_1px_rgb(127_127_127/0.1),0_8px_24px_rgb(0_0_0/0.06)]">
          <Icon name={props.icon} class="size-5 text-text-weak" />
        </div>
        <h2 class="text-20-medium tracking-[-0.025em] text-text-strong">{props.title}</h2>
        <p class="mt-2 text-12-regular leading-relaxed text-text-weak">{props.body}</p>
      </div>
    </div>
  )
}

export type CenterOverlayBehavior = {
  canOpen: boolean
  inventoryOnly: boolean
  reviewOnlyCopy?: string
}

/**
 * Deep inventory records deliberately have no materialized map subtree. Keep
 * their overlay actionless instead of advertising an Enter/Open path which
 * cannot resolve to a visual child tree.
 */
export function centerOverlayBehavior(
  node: DiskScanNode | null,
  canOpen: boolean,
  inventoryOnly: boolean,
): CenterOverlayBehavior {
  const isInventoryOnly = inventoryOnly && !!node
  return {
    canOpen: !!node?.isDir && !node.isOther && !isInventoryOnly && canOpen,
    inventoryOnly: isInventoryOnly,
    ...(isInventoryOnly
      ? { reviewOnlyCopy: "Deep inventory result · review it from the results list. It can’t be opened in the map." }
      : {}),
  }
}

/** Center overlay for the sunburst — shows the focused node's identity + size. */
export function CenterOverlay(props: {
  node: DiskScanNode | null
  parentSize: number
  canOpen: boolean
  inventoryOnly: boolean
  onOpen: () => void
}) {
  const behavior = () => centerOverlayBehavior(props.node, props.canOpen, props.inventoryOnly)
  return (
    <div class="pointer-events-none absolute inset-0 grid place-items-center">
      <div class="max-w-[70%] text-center">
        <Show when={props.node}>
          <p class="truncate text-13-semibold tracking-[-0.01em] text-text-strong">{props.node!.name}</p>
          <p
            class="mt-1.5 text-[clamp(22px,2.8vw,38px)] font-medium leading-none tracking-[-0.05em] tabular-nums text-text-strong"
            style={{ "text-wrap": "balance" }}
          >
            {formatBytes(props.node!.size)}
          </p>
          <Show when={props.parentSize && props.node!.path}>
            <p class="mt-2 text-13-regular tabular-nums text-text-weaker">
              {formatPct(props.node!.size, props.parentSize)} of this level
            </p>
          </Show>
          <Show when={behavior().canOpen}>
            <button
              type="button"
              class="dl-center-open dl-touch-target pointer-events-auto mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-background-base/88 px-3 text-13-semibold text-text-strong shadow-[0_0_0_1px_rgb(127_127_127/0.15),0_3px_10px_rgb(0_0_0/0.1)] outline-none transition-[background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]"
              onClick={props.onOpen}
            >
              Open folder <Icon name="arrow-right" class="size-3" />
            </button>
          </Show>
          <Show when={behavior().inventoryOnly}>
            <p class="mx-auto mt-3 max-w-[28ch] text-13-regular leading-relaxed text-text-weaker">
              {behavior().reviewOnlyCopy}
            </p>
          </Show>
        </Show>
      </div>
    </div>
  )
}
