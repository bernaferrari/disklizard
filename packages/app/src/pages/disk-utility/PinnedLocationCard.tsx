import { Icon } from "@/components/dl/icon"
import type { DiskPinnedLocation } from "./types"
import { useLanguage } from "./runtime"

export function PinnedLocationCard(props: {
  location: DiskPinnedLocation
  canView: boolean
  onActivate: () => void
  onRemove: () => void
  removeLabel?: string
}) {
  const language = useLanguage()
  return (
    <div className="group flex min-w-0 items-center rounded-lg bg-surface-raised-base shadow-[inset_0_0_0_1px_rgb(127_127_127/0.1)] transition-colors duration-150 hover:bg-[color-mix(in_oklch,var(--surface-raised-base)_35%,transparent)]">
      <button
        type="button"
        className="flex min-h-11 min-w-11 flex-1 items-center gap-3 rounded-lg py-2.5 pr-2 pl-3 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-text-weak focus-visible:ring-inset active:bg-[color-mix(in_oklch,var(--background-base)_60%,var(--dl-popover))]"
        onClick={props.onActivate}
        aria-label={
          props.canView
            ? language.t("disk.drive.viewLabel", { name: props.location.label })
            : undefined
        }
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-md text-text-weak">
          <Icon name="folder" className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-13-medium block truncate text-text-strong">
            {props.location.label}
          </span>
          <span
            className="text-12-regular mt-0.5 block truncate text-text-weaker"
            title={props.location.path}
          >
            {props.location.path}
          </span>
        </span>
        <span className="text-13-semibold flex shrink-0 items-center gap-1 text-text-weak transition-colors duration-150 group-hover:text-text-strong">
          {language.t(
            props.canView ? "disk.drive.action.view" : "disk.common.scan"
          )}{" "}
          <Icon name="arrow-right" className="size-3" />
        </span>
      </button>
      <button
        type="button"
        className="mr-2 grid size-10 min-h-11 min-w-11 shrink-0 place-items-center rounded-md text-text-weaker opacity-55 transition-[color,opacity,background-color] duration-150 outline-none hover:bg-[color-mix(in_oklch,var(--background-base)_70%,transparent)] hover:text-text-strong hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-text-weak active:bg-background-base"
        onClick={props.onRemove}
        aria-label={
          props.removeLabel ??
          language.t("disk.pinned.remove", { name: props.location.label })
        }
      >
        <Icon name="close-small" className="size-3" />
      </button>
    </div>
  )
}
