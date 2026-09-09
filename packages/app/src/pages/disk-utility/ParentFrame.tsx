import { ArrowUpLeft } from "lucide-react"
import { useLanguage } from "./runtime"

/** Exposed parent surface around a zoomed visualization. Never overlaps its tiles. */
export function ParentFrame(props: { name: string; onUp: () => void; showLabel?: boolean }) {
  const language = useLanguage()
  return <button type="button" onClick={props.onUp}
    aria-label={language.t("disk.navigation.parent", {name: props.name})}
    className="group absolute inset-x-2 top-1 bottom-16 rounded-2xl bg-surface-raised-base/60 text-text-weak ring-1 ring-inset ring-border-weaker-base transition-colors duration-150 hover:bg-surface-raised-strong focus-visible:outline-2 focus-visible:outline-text-weak motion-reduce:transition-none">
    {props.showLabel && <span className="absolute left-4 top-1 flex max-w-[80%] items-center gap-1.5 text-xs"><ArrowUpLeft className="size-3 shrink-0"/><span className="truncate">{props.name}</span></span>}
  </button>
}
