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
    <div class="dl-hover-card group flex min-w-0 items-center rounded-lg bg-surface-raised-base shadow-[inset_0_0_0_1px_rgb(127_127_127/0.1)] transition-colors duration-150">
      <button
        type="button"
        class="dl-touch-target flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg py-2.5 pl-3 pr-2 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak active:bg-background-base/55"
        onClick={props.onScan}
      >
        <span class="grid size-8 shrink-0 place-items-center rounded-md text-text-weak">
          <Icon name="folder" class="size-4" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-13-medium text-text-strong">{props.location.label}</span>
          <span class="mt-0.5 block truncate text-12-regular text-text-weaker" title={props.location.path}>
            {props.location.path}
          </span>
        </span>
        <span class="dl-hover-card-label flex shrink-0 items-center gap-1 text-13-semibold text-text-weak transition-colors duration-150">
          {language.t("disk.common.scan")} <Icon name="arrow-right" class="size-3" />
        </span>
      </button>
      <button
        type="button"
        class="dl-hover-quiet-button dl-touch-target mr-2 grid size-10 shrink-0 place-items-center rounded-md text-text-weaker opacity-55 outline-none transition-[color,opacity,background-color] duration-150 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-text-weak active:bg-background-base"
        onClick={props.onRemove}
        aria-label={props.removeLabel ?? language.t("disk.pinned.remove", { name: props.location.label })}
      >
        <Icon name="close-small" class="size-3" />
      </button>
    </div>
  )
}
