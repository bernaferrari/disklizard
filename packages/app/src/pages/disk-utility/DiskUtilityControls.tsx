import { Icon, type IconProps } from "@/components/dl/icon"
import { cn } from "@/lib/utils"
import { formatBytes, shortBytes } from "./format"
import { useLanguage } from "./runtime"

export function SegmentedButton(props: {
  active: boolean
  onClick?: () => void
  icon: IconProps["name"]
  label: string
  shortcut?: string
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-11 min-w-11 items-center gap-1.5 rounded-[6px] px-3 text-13-semibold font-medium outline-none transition-[background-color,color,box-shadow] duration-100 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96] hover:bg-surface-raised-base aria-pressed:bg-surface-raised-strong aria-pressed:shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_1px_3px_rgb(0_0_0/0.2)]",
        props.active ? "text-text-strong" : "hover:text-text-strong text-text-weak",
      )}
      onClick={props.onClick}
      aria-pressed={props.active}
      aria-keyshortcuts={props.shortcut}
    >
      <svg
        className="size-4"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden="true"
      >
        {props.icon === "dot-grid" ? (
          <>
            <circle cx="10" cy="10" r="7" />
            <path d="M10 3v7l5 5M10 10H3" />
          </>
        ) : props.icon === "file-tree" ? (
          <path d="M3 3h14v14H3zM10 3v14M10 10h7" />
        ) : props.icon === "code-lines" ? (
          <path d="M3 4h14v3H3zM3 9h8v3H3zM4 14h4v3H4zM12 9h5v3h-5z" />
        ) : (
          <path d="M3 3h14v4H3zM3 10h8v3H3zM13 10h4v3h-4zM3 16h5M10 16h7" />
        )}
      </svg>
      <span>{props.label}</span>
      {props.shortcut ? <kbd className="hidden ml-0.5 text-13-regular opacity-45">{props.shortcut}</kbd> : null}
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
  const explanationID = props.disabled && props.title ? `disklizard-lens-${props.label.toLowerCase()}-reason` : undefined
  return (
    <span className="contents">
      <button
        type="button"
        aria-pressed={props.active}
        aria-disabled={props.disabled ? "true" : undefined}
        aria-describedby={explanationID}
        className={cn(
          "flex min-w-0 min-h-8 items-center justify-center px-2 text-xs font-medium leading-none rounded-md outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring hover:text-text-strong aria-pressed:bg-surface-raised-base",

          props.active && "text-text-strong shadow-sm",
          !props.active && "text-text-weak",
          props.disabled && "cursor-not-allowed opacity-50",
        )}
        onClick={() => {
          if (props.disabled) return
          props.onClick()
        }}
      >
        <Icon name={props.icon} className="hidden size-3.5" />
        {props.label}
      </button>
      {explanationID ? <span id={explanationID} className="sr-only">{props.title}</span> : null}
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
  const language = useLanguage()
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
      className={cn(
        "flex min-h-11 min-w-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-13-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]",
        props.active
          ? "bg-[oklch(0.74_0.13_252/0.12)] text-text-strong shadow-[inset_0_0_0_1px_oklch(0.74_0.13_252/0.28)]"
          : "hover:text-text-strong bg-background-base/45 text-text-weak",
      )}
      onClick={props.onClick}
    >
      <span>{props.label}</span>
      <span className="tabular-nums text-text-weaker">{shortBytes(props.bytes)}</span>
    </button>
  )
}
