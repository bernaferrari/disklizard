import { Button } from "@opencode-ai/ui/button"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"
import type { DiskScanNode } from "./types"
import { formatBytes, formatPct } from "./format"
import { diskLanguageText, useLanguage } from "./runtime"
import { diskNodeDisplayName } from "./node-display"

export function DriveFallback(props: { loading: boolean; error?: string; onChoose: () => void }) {
  const language = useLanguage()
  return (
    <div class="flex min-h-full flex-col items-center justify-center px-8 py-16 text-center">
      <Show
        when={!props.loading}
        fallback={
          <div class="dl-volume-row flex items-center gap-4">
            <span class="dl-volume-glyph size-9 animate-pulse" />
            <span class="min-w-0 flex-1">
              <span class="block h-3.5 w-36 rounded-sm bg-surface-raised-base" />
              <span class="mt-2 block h-3 w-52 rounded-sm bg-surface-raised-base/70" />
            </span>
            <span class="hidden h-1.5 w-[148px] rounded-full bg-surface-raised-base sm:block" />
            <span class="text-13-regular text-text-weaker">{language.t("disk.drive.reading")}</span>
          </div>
        }
      >
        <span class="grid size-11 place-items-center rounded-full bg-surface-raised-base text-text-weak">
          <Icon name="folder" class="size-4" />
        </span>
        <h2 class="mt-4 text-14-medium tracking-[-0.015em] text-text-strong">
          {props.error ? language.t("disk.drive.readFailed") : language.t("disk.drive.none")}
        </h2>
        <p class="mt-1 max-w-[30ch] text-13-regular leading-relaxed text-text-weak">
          {props.error ?? language.t("disk.drive.pickFolder")}
        </p>
        <Button
          data-disk-primary-action
          class="dl-touch-target mt-4"
          variant="secondary"
          size="small"
          icon="folder-add-left"
          onClick={props.onChoose}
        >
          {language.t("disk.drive.scanFolder")}
        </Button>
      </Show>
    </div>
  )
}

export function IndexEmpty(props: { filtered: boolean; onReset: () => void }) {
  const language = useLanguage()
  return (
    <div class="flex min-h-full flex-col items-center justify-center px-8 py-16 text-center">
      <span class="grid size-11 place-items-center rounded-full bg-surface-raised-base text-text-weak">
        <Icon name={props.filtered ? "magnifying-glass" : "folder"} class="size-4" />
      </span>
      <h3 class="mt-4 text-14-medium tracking-[-0.015em] text-text-strong">
        {props.filtered ? language.t("disk.drive.emptyFiltered") : language.t("disk.drive.emptyFolder")}
      </h3>
      <p class="mt-1 max-w-[30ch] text-13-regular leading-relaxed text-text-weak">
        {props.filtered ? language.t("disk.drive.clearFilters") : language.t("disk.drive.noItems")}
      </p>
      <Show when={props.filtered}>
        <Button class="dl-touch-target mt-4" size="small" variant="secondary" onClick={props.onReset}>
          {language.t("disk.drive.showEverything")}
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
        <h2 class="text-14-medium tracking-[-0.015em] text-text-strong">{props.title}</h2>
        <p class="mt-1 text-13-regular leading-relaxed text-text-weak">{props.body}</p>
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
    canOpen: !!node?.isDir && !isInventoryOnly && canOpen,
    inventoryOnly: isInventoryOnly,
    ...(isInventoryOnly ? { reviewOnlyCopy: diskLanguageText("disk.drive.inventoryOnly") } : {}),
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
  const language = useLanguage()
  const behavior = () => centerOverlayBehavior(props.node, props.canOpen, props.inventoryOnly)
  return (
    <div class="pointer-events-none absolute inset-0 grid place-items-center">
      <div class="max-w-[70%] text-center">
        <Show when={props.node}>
          <p class="truncate text-13-semibold tracking-[-0.01em] text-text-strong">
            {diskNodeDisplayName(props.node!)}
          </p>
          <p
            class="mt-1.5 text-[clamp(22px,2.8vw,38px)] font-medium leading-none tracking-[-0.05em] tabular-nums text-text-strong"
            style={{ "text-wrap": "balance" }}
          >
            {formatBytes(props.node!.size)}
          </p>
          <Show when={props.parentSize && props.node!.path}>
            <p class="mt-2 text-13-regular tabular-nums text-text-weaker">
              {formatPct(props.node!.size, props.parentSize)} {language.t("disk.drive.ofLevel")}
            </p>
          </Show>
          <Show when={behavior().canOpen}>
            <button
              type="button"
              class="dl-center-open dl-touch-target pointer-events-auto mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-background-base/88 px-3 text-13-semibold text-text-strong shadow-[0_0_0_1px_rgb(127_127_127/0.15),0_3px_10px_rgb(0_0_0/0.1)] outline-none transition-[background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]"
              onClick={props.onOpen}
            >
              {language.t(props.node!.isOther ? "disk.common.showMore" : "disk.common.openFolder")}
              <Icon name="arrow-right" class="size-3" />
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
