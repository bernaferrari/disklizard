import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"
import { formatBytes, shortBytes } from "./format"
import { useLanguage } from "./runtime"

export function SegmentedButton(props: {
  active: boolean
  onClick?: () => void
  icon: IconProps["name"]
  label: string
  shortcut?: string
}) {
  const language = useLanguage()
  return (
    <button
      type="button"
      class="dl-segmented dl-touch-target flex min-h-10 items-center gap-1.5 rounded-full px-3 text-13-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]"
      classList={{
        "bg-surface-raised-base text-text-strong shadow-[0_0_0_1px_rgb(127_127_127/0.14),0_2px_7px_rgb(0_0_0/0.12)]":
          props.active,
        "dl-hover-text text-text-weak": !props.active,
      }}
      onClick={props.onClick}
      aria-pressed={props.active}
      aria-keyshortcuts={props.shortcut}
    >
      <Icon name={props.icon} class="size-3" />
      {props.label}
      <Show when={props.shortcut}>
        <kbd class="ml-0.5 text-13-regular opacity-45">{props.shortcut}</kbd>
      </Show>
    </button>
  )
}

export function IndexLensButton(props: {
  active: boolean
  onClick: () => void
  icon: IconProps["name"]
  label: string
  disabled?: boolean
  title?: string
}) {
  const explanationID = () => (props.disabled && props.title ? `disklizard-lens-${props.label.toLowerCase()}-reason` : undefined)
  return (
    <span class="contents">
      <button
        type="button"
        aria-pressed={props.active}
        aria-disabled={props.disabled ? "true" : undefined}
        aria-describedby={explanationID()}
        class="dl-touch-target flex min-h-11 items-center justify-center gap-1.5 px-2 text-13-semibold outline-none transition-[color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak active:scale-[0.98]"
        classList={{
          "text-text-strong shadow-[inset_0_-2px_0_var(--dl-accent)]": props.active,
          "dl-hover-text text-text-weak": !props.active,
          "cursor-not-allowed opacity-50": props.disabled,
        }}
        onClick={() => {
          if (props.disabled) return
          props.onClick()
        }}
      >
        <Icon name={props.icon} class="size-3.5" />
        {props.label}
      </button>
      <Show when={explanationID()}>
        {(id) => (
          <span id={id()} class="sr-only">
            {props.title}
          </span>
        )}
      </Show>
    </span>
  )
}

export function DeveloperCategoryButton(props: {
  active: boolean
  label: string
  bytes: number
  description?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      aria-label={
        props.description
          ? language.t("disk.explore.categoryDescription", {
              label: props.label,
              description: props.description,
              size: formatBytes(props.bytes),
            })
          : undefined
      }
      title={props.description}
      class="dl-touch-target flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-13-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]"
      classList={{
        "bg-[oklch(0.74_0.13_252/0.12)] text-text-strong shadow-[inset_0_0_0_1px_oklch(0.74_0.13_252/0.28)]":
          props.active,
        "dl-hover-text bg-background-base/45 text-text-weak": !props.active,
      }}
      onClick={props.onClick}
    >
      <span>{props.label}</span>
      <span class="tabular-nums text-text-weaker">{shortBytes(props.bytes)}</span>
    </button>
  )
}
