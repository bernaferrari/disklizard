import { Icon } from "@opencode-ai/ui/icon"
import type { DiskPinnedLocation } from "./types"
import { useLanguage } from "./runtime"

export function PinnedLocationCard(props: {
  location: DiskPinnedLocation
  onScan: () => void
  onRemove: () => void
  removeLabel?: string
}) {
  const language = useLanguage()
  return (
    <div class="dl-hover-card group flex min-w-0 items-center rounded-2xl bg-surface-raised-strong shadow-[0_0_0_1px_rgb(127_127_127/0.11),0_8px_28px_-22px_rgb(0_0_0/0.22)] transition-colors duration-150">
      <button
        type="button"
        class="dl-touch-target flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-2xl py-3 pl-4 pr-2 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak active:bg-background-base/55"
        onClick={props.onScan}
      >
        <span class="dl-accent-text grid size-9 shrink-0 place-items-center rounded-full bg-[oklch(0.72_0.12_176/0.12)]">
          <Icon name="folder" class="size-4" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-12-semibold text-text-strong">{props.location.label}</span>
          <span class="mt-0.5 block truncate text-13-mono text-text-weaker" title={props.location.path}>
            {props.location.path}
          </span>
        </span>
        <span class="dl-hover-card-label flex shrink-0 items-center gap-1 text-13-semibold text-text-weak transition-colors duration-150">
          {language.t("disk.common.scan")} <Icon name="arrow-right" class="size-3" />
        </span>
      </button>
      <button
        type="button"
        class="dl-hover-quiet-button dl-touch-target mr-2 grid size-10 shrink-0 place-items-center rounded-full text-text-weaker opacity-55 outline-none transition-[color,opacity,background-color] duration-150 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-text-weak active:bg-background-base"
        onClick={props.onRemove}
        aria-label={props.removeLabel ?? language.t("disk.pinned.remove", { name: props.location.label })}
      >
        <Icon name="close-small" class="size-3" />
      </button>
    </div>
  )
}
