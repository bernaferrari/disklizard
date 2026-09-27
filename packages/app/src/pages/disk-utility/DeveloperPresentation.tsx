import { useState, type ReactNode } from "react"
import { ChevronDown, SlidersHorizontal, CircleAlert } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { daysSinceChanged, formatBytes } from "./format"
import type { DiskScanNode } from "./types"
import { itemIdentity } from "./item-identity"
import { useLanguage } from "./runtime"
import { SearchHighlight } from "./SearchHighlight"

export function DeveloperDisclosure(props: {
  label: string
  children: ReactNode
  compact?: boolean
  warning?: boolean
  iconOnly?: boolean
}) {
  if (!props.compact) return <>{props.children}</>
  const Glyph = props.warning ? CircleAlert : SlidersHorizontal
  return (
    <Popover>
      <PopoverTrigger
        aria-label={props.label}
        title={props.label}
        className={`${props.iconOnly ? "size-9 justify-center" : "mt-2 mr-2 min-h-9"} inline-flex max-w-full items-center gap-2 rounded-md px-2 text-xs text-text-weak transition-colors hover:bg-surface-raised-base hover:text-text-strong focus-visible:outline-2 focus-visible:outline-text-weak`}
      >
        <Glyph
          className={`size-3.5 shrink-0 ${props.warning ? "text-icon-warning-base" : ""}`}
        />
        {!props.iconOnly && <span className="truncate">{props.label}</span>}
        {!props.iconOnly && (
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(380px,calc(100vw-32px))] gap-0 rounded-xl bg-surface-raised-base p-4 text-text-strong shadow-xl ring-border-weaker-base"
      >
        <PopoverTitle className="mb-3 text-sm font-semibold">
          {props.label}
        </PopoverTitle>
        <ScrollArea className="max-h-[min(540px,70vh)] [&_[data-slot=scroll-area-viewport]]:max-h-[min(540px,70vh)]">
          {props.children}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}

export function DeveloperCategories(props: {
  allLabel: string
  label: string
  value: string
  categories: { value: string; label: string; bytes: number }[]
  onChange: (value: string) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const options = [
    {
      value: "all",
      label: props.allLabel,
      bytes: props.categories.reduce((sum, item) => sum + item.bytes, 0),
    },
    ...props.categories,
  ]
  const selected =
    options.find((option) => option.value === props.value) ?? options[0]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={props.label}
        className={`text-13-medium flex min-h-10 w-full items-center gap-3 rounded-lg bg-background-base px-3 text-left text-text-strong ring-1 ring-border-weaker-base transition-colors hover:bg-surface-raised-base focus-visible:outline-2 focus-visible:outline-text-weak ${props.compact ? "" : "mt-3"}`}
      >
        <span className="min-w-0 flex-1 truncate">{selected.label}</span>
        <span className="shrink-0 text-xs text-text-weak tabular-nums">
          {formatBytes(selected.bytes)}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-text-weak" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(340px,calc(100vw-32px))] rounded-xl bg-surface-raised-base p-2 text-text-strong"
      >
        <PopoverTitle className="sr-only">{props.label}</PopoverTitle>
        <div role="group" aria-label={props.label} className="grid gap-1">
          {options.map((category) => (
            <button
              key={category.value}
              type="button"
              aria-pressed={props.value === category.value}
              onClick={() => {
                props.onChange(category.value)
                setOpen(false)
              }}
              className="flex min-h-10 items-center gap-4 rounded-md px-3 text-left text-xs text-text-weak hover:bg-surface-raised-strong focus-visible:outline-2 focus-visible:outline-text-weak aria-pressed:bg-surface-raised-strong aria-pressed:text-text-strong"
            >
              <span className="min-w-0 flex-1">{category.label}</span>
              <span className="shrink-0 tabular-nums">
                {formatBytes(category.bytes)}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Give repeated build-directory names a useful project identity. */
export function developerEntryIdentity(node: DiskScanNode) {
  return itemIdentity(node)
}

export function DeveloperEntryContent(props: {
  node: DiskScanNode
  bytes: number
  contributionBytes?: number
  scope: string
  artifactType?: string
  disposition: string
  color: string
  location: string
  restriction?: string
  metadataMatch?: string
  query?: string
}) {
  const language = useLanguage()
  const identity = developerEntryIdentity(props.node)
  const age = daysSinceChanged(props.node.modifiedAt)
  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-3"
      title={`${props.node.path}
${props.disposition}`}
    >
      <span
        aria-hidden
        className="h-7 w-[3px] shrink-0 rounded-full"
        style={{ background: props.color }}
      />
      <span className="min-w-0 flex-1">
        <span className="text-14-medium block truncate text-text-strong">
          <SearchHighlight
            text={identity.reviewTitle}
            query={props.query ?? ""}
          />
        </span>
        {props.query?.trim() &&
        props.node.path
          .toLocaleLowerCase()
          .includes(props.query.trim().toLocaleLowerCase()) ? (
          <span
            className="text-12-regular mt-0.5 block truncate font-mono text-text-weak"
            title={props.node.path}
          >
            <SearchHighlight text={props.location} query={props.query} />
          </span>
        ) : null}
        <span
          className="text-12-regular mt-0.5 block truncate text-text-weak"
          title={`${props.scope} · ${props.disposition}`}
        >
          {props.artifactType ?? props.scope} ·{" "}
          {age === null
            ? language.t("disk.developer.ageUnknown")
            : language.plural("disk.developer.unchangedDays", age)}{" "}
          · {props.disposition}
        </span>
        {props.restriction ? (
          <span
            className="text-12-regular mt-0.5 block truncate text-icon-warning-base"
            title={props.restriction}
          >
            {props.restriction}
          </span>
        ) : null}
        {props.metadataMatch ? (
          <span className="text-12-regular mt-0.5 block truncate text-text-weak">
            {language.t("disk.developer.metadataMatch", {
              type: props.metadataMatch,
            })}
          </span>
        ) : null}
      </span>
      <span className="text-13-medium w-[5.5rem] shrink-0 text-right text-text-strong tabular-nums">
        {formatBytes(props.bytes)}
        {props.contributionBytes !== undefined &&
        props.contributionBytes !== props.bytes ? (
          <span
            className="text-12-regular mt-1 block text-text-weak"
            title={language.t("disk.developer.categoryContribution", {
              size: formatBytes(props.contributionBytes),
            })}
          >
            {language.t("disk.developer.categoryContribution", {
              size: formatBytes(props.contributionBytes),
            })}
          </span>
        ) : null}
      </span>
    </span>
  )
}
