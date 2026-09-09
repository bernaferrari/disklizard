import { useState, type ReactNode } from "react"
import { ChevronDown, SlidersHorizontal, CircleAlert, FolderCode } from "lucide-react"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatBytes } from "./format"
import type { DiskScanNode } from "./types"
import { diskNodeDisplayName } from "./node-display"

export function DeveloperDisclosure(props: { label: string; children: ReactNode; compact?: boolean; warning?: boolean; iconOnly?: boolean }) {
  if (!props.compact) return <>{props.children}</>
  const Glyph = props.warning ? CircleAlert : SlidersHorizontal
  return <Popover>
    <PopoverTrigger aria-label={props.label} title={props.label} className={`${props.iconOnly ? "size-9 justify-center" : "mt-2 mr-2 min-h-9"} inline-flex max-w-full items-center gap-2 rounded-md px-2 text-xs text-text-weak transition-colors hover:bg-surface-raised-base hover:text-text-strong focus-visible:outline-2 focus-visible:outline-text-weak`}>
      <Glyph className={`size-3.5 shrink-0 ${props.warning ? "text-icon-warning-base" : ""}`} />
      {!props.iconOnly && <span className="truncate">{props.label}</span>}
      {!props.iconOnly && <ChevronDown className="size-3 shrink-0 opacity-50" />}
    </PopoverTrigger>
    <PopoverContent align="end" className="w-[min(380px,calc(100vw-32px))] gap-0 rounded-xl bg-surface-raised-base p-4 text-text-strong shadow-xl ring-border-weaker-base">
      <PopoverTitle className="mb-3 text-sm font-semibold">{props.label}</PopoverTitle>
      <ScrollArea className="max-h-[min(540px,70vh)] [&_[data-slot=scroll-area-viewport]]:max-h-[min(540px,70vh)]">
        {props.children}
      </ScrollArea>
    </PopoverContent>
  </Popover>
}

export function DeveloperCategories(props: {
  allLabel: string
  label: string
  value: string
  categories: { value: string; label: string; bytes: number }[]
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const options = [{ value: "all", label: props.allLabel, bytes: props.categories.reduce((sum, item) => sum + item.bytes, 0) }, ...props.categories]
  const selected = options.find(option => option.value === props.value) ?? options[0]
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger aria-label={props.label} className="mt-3 flex min-h-10 w-full items-center gap-3 rounded-lg bg-background-base px-3 text-left text-13-medium text-text-strong ring-1 ring-border-weaker-base transition-colors hover:bg-surface-raised-base focus-visible:outline-2 focus-visible:outline-text-weak">
      <span className="min-w-0 flex-1 truncate">{selected.label}</span>
      <span className="shrink-0 text-xs tabular-nums text-text-weak">{formatBytes(selected.bytes)}</span>
      <ChevronDown className="size-3.5 shrink-0 text-text-weak" />
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[min(340px,calc(100vw-32px))] rounded-xl bg-surface-raised-base p-2 text-text-strong">
      <PopoverTitle className="sr-only">{props.label}</PopoverTitle>
      <div role="group" aria-label={props.label} className="grid gap-1">
        {options.map(category => <button key={category.value} type="button" aria-pressed={props.value === category.value}
          onClick={() => { props.onChange(category.value); setOpen(false) }}
          className="flex min-h-10 items-center gap-4 rounded-md px-3 text-left text-xs text-text-weak hover:bg-surface-raised-strong focus-visible:outline-2 focus-visible:outline-text-weak aria-pressed:bg-surface-raised-strong aria-pressed:text-text-strong">
          <span className="min-w-0 flex-1">{category.label}</span>
          <span className="shrink-0 tabular-nums">{formatBytes(category.bytes)}</span>
        </button>)}
      </div>
    </PopoverContent>
  </Popover>
}

/** Give repeated build-directory names a useful project identity. */
export function developerEntryIdentity(node: DiskScanNode) {
  const parts = node.path.replaceAll("\\", "/").split("/").filter(Boolean)
  const parent = parts.at(-2)
  const projectArtifact = ["target", "node_modules", "build", "dist", ".next", ".nuxt", ".turbo"].includes(node.name)
  return { title: projectArtifact && parent ? parent : diskNodeDisplayName(node), artifact: diskNodeDisplayName(node) }
}

export function DeveloperEntryContent(props: { node: DiskScanNode; bytes: number; scope: string; disposition: string; color: string }) {
  const identity = developerEntryIdentity(props.node)
  return <span className="flex min-w-0 flex-1 items-center gap-3" title={props.node.path}>
    <span className="grid size-6 shrink-0 place-items-center" style={{color: props.color}}>
      <FolderCode className="size-4" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate text-13-semibold text-text-strong">{identity.title}</span>
        <span className="shrink-0 text-12-semibold tabular-nums text-text-strong">{formatBytes(props.bytes)}</span>
      </span>
      <span className="mt-1 flex items-baseline gap-2 text-12-regular text-text-weak">
        <span className="min-w-0 flex-1 truncate">{identity.title !== identity.artifact ? identity.artifact : props.scope}</span>
        <span className="shrink-0 text-[11px] text-text-weak">{props.disposition}</span>
      </span>
    </span>
  </span>
}
