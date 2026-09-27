import { ArrowLeft } from "lucide-react"
import { useLanguage } from "./runtime"

/** Exposed parent surface around a zoomed visualization. Never overlaps its tiles. */
export function ParentFrame(props: {
  name: string
  onUp: () => void
  showLabel?: boolean
  color?: string
}) {
  const language = useLanguage()
  const label = language.t("disk.navigation.parent", { name: props.name })
  return (
    <>
      <button
        type="button"
        onClick={props.onUp}
        tabIndex={-1}
        aria-hidden="true"
        style={props.color ? { backgroundColor: props.color } : undefined}
        className="absolute inset-x-2 top-1 bottom-16 rounded-2xl bg-surface-raised-base/60 ring-1 ring-border-weaker-base transition-colors duration-150 ring-inset hover:bg-surface-raised-strong motion-reduce:transition-none"
      />
      {props.showLabel && (
        <button
          type="button"
          onClick={props.onUp}
          aria-label={label}
          style={props.color ? { color: "oklch(0.2 0.02 250)" } : undefined}
          className="absolute top-2 left-5 z-10 flex h-8 max-w-[calc(100%-40px)] items-center gap-2 rounded-md px-2.5 text-xs font-medium text-text-weak hover:bg-surface-raised-strong hover:text-text-strong focus-visible:outline-2 focus-visible:outline-text-strong"
        >
          <ArrowLeft aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      )}
    </>
  )
}
