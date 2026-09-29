import { useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import {
  Check,
  ChevronDown,
  Eye,
  File as FileIcon,
  FolderOpen,
  Info,
  Layers,
  Lock,
  Minus,
  Package,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
} from "@/components/dl/dropdown-menu"
import { formatBytes, formatLastChanged, shortBytes } from "./format"
import { useLanguage, type DiskLanguageKey } from "./runtime"
import type { DiskScanNode } from "./types"
import type {
  ArtifactEcosystem,
  ArtifactEcosystemFilter,
  DeveloperItem,
  ReclaimBucket,
  Recognition,
  Safety,
} from "./recognize"
import { artifactEcosystemLabel } from "./recognize"
import { itemIdentity } from "./item-identity"
import {
  DEVELOPER_CLEANUP_AGE_PRESETS,
  type DeveloperCleanupAgePreset,
} from "./developer-cleanup"
import { spectrumHue, spectrumTone, toneCss } from "./spectrum"
import type { BaselineChange } from "./scan-baseline"
import { primaryButton, quietButton } from "./ExplorerChrome"

const SAFETY_LABEL = {
  regenerable: "disk.safety.regenerable",
  cache: "disk.safety.cache",
  logs: "disk.safety.logs",
  trash: "disk.safety.trash",
  media: "disk.safety.media",
  "version-control": "disk.safety.versionControl",
  system: "disk.safety.system",
  unknown: "disk.safety.unknown",
} as const satisfies Record<Safety, DiskLanguageKey>

const AGE_SHORT = {
  all: "disk.developer.age.any",
  "30": "disk.developer.age.30",
  "60": "disk.developer.age.60",
  "90": "disk.developer.age.90",
  "180": "disk.developer.age.180",
  custom: "disk.developer.age.custom",
} as const satisfies Record<DeveloperCleanupAgePreset, DiskLanguageKey>

type CleanupItem = {
  node: DiskScanNode
  bytes: number
  recognition: Recognition
  safe: boolean
}

type CleanupGroup = {
  key: string
  label: string
  bytes: number
  items: CleanupItem[]
  color: string
}

const PREVIEW_ROWS = 4

export function CleanupView(props: {
  developerItems: readonly DeveloperItem[]
  suggestions: readonly ReclaimBucket[]
  isSafe: (node: DiskScanNode, recognition: Recognition) => boolean
  isCollected: (path: string) => boolean
  coveredBy: (path: string) => string | undefined
  canModify: (node: DiskScanNode) => boolean
  restriction: (node: DiskScanNode) => string | undefined
  collectionCount: number
  collectionBytes: number
  trashName: string
  agePreset: DeveloperCleanupAgePreset
  ecosystems: readonly ArtifactEcosystem[]
  ecosystem: ArtifactEcosystemFilter
  inventoryNote?: string
  onAgePreset: (preset: DeveloperCleanupAgePreset) => void
  onEcosystem: (ecosystem: ArtifactEcosystemFilter) => void
  onToggle: (node: DiskScanNode) => void
  onCollect: (nodes: readonly DiskScanNode[]) => void
  onUncollect: (nodes: readonly DiskScanNode[]) => void
  onReview: () => void
  onReveal: (node: DiskScanNode) => void
  onPreview?: (node: DiskScanNode) => void
  /** Growth since the previous scan of this root, keyed by path. */
  changeFor?: (path: string) => BaselineChange | undefined
}) {
  const language = useLanguage()

  const { developer, suggestions, total, safe, locked } = useMemo(() => {
    const byTag = new Map<string, CleanupItem[]>()
    const developerPaths: string[] = []
    const locked: CleanupItem[] = []
    for (const item of props.developerItems) {
      if (!props.canModify(item.node)) {
        locked.push({
          node: item.node,
          bytes: item.bytes,
          recognition: item.recognition,
          safe: false,
        })
        continue
      }
      const key = item.recognition.tag ?? item.recognition.developer ?? "other"
      const list = byTag.get(key) ?? []
      list.push({
        node: item.node,
        bytes: item.bytes,
        recognition: item.recognition,
        safe: props.isSafe(item.node, item.recognition),
      })
      byTag.set(key, list)
      developerPaths.push(item.node.path)
    }
    const covered = (path: string) =>
      developerPaths.some(
        (root) => path === root || path.startsWith(root + "/") || root.startsWith(path + "/")
      )
    const developer = [...byTag].map(([key, items]) => ({
      key: `dev:${key}`,
      label: items[0].recognition.tag
        ? language.t(items[0].recognition.tag)
        : key,
      bytes: items.reduce((sum, item) => sum + item.bytes, 0),
      items: items.toSorted((a, b) => b.bytes - a.bytes),
      color: "",
    }))
    const suggestions = props.suggestions
      .map((bucket) => {
        const items = bucket.items
          .filter(({ node }) => !covered(node.path) && props.canModify(node))
          .map(({ node, recognition }) => ({
            node,
            bytes: node.size,
            recognition,
            safe: false,
          }))
        return {
          key: `rec:${bucket.safety}`,
          label: language.t(SAFETY_LABEL[bucket.safety]),
          bytes: items.reduce((sum, item) => sum + item.bytes, 0),
          items: items.toSorted((a, b) => b.bytes - a.bytes),
          color: "",
        }
      })
      .filter((group) => group.items.length > 0)
    const all = [...developer, ...suggestions].toSorted((a, b) => b.bytes - a.bytes)
    all.forEach((group, index) => {
      group.color = toneCss(
        spectrumTone(spectrumHue((index + 0.5) / Math.max(all.length, 1)), 0)
      )
    })
    developer.sort((a, b) => b.bytes - a.bytes)
    suggestions.sort((a, b) => b.bytes - a.bytes)
    const items = all.flatMap((group) => group.items)
    return {
      developer,
      suggestions,
      total: {
        bytes: items.reduce((sum, item) => sum + item.bytes, 0),
        count: items.length,
        groups: all,
      },
      safe: items.filter((item) => item.safe),
      locked: locked.toSorted((a, b) => b.bytes - a.bytes),
    }
  }, [props.developerItems, props.suggestions, props.isSafe, props.canModify, language])

  const safeBytes = safe.reduce((sum, item) => sum + item.bytes, 0)
  const allSafeSelected =
    safe.length > 0 && safe.every((item) => props.isCollected(item.node.path) || !!props.coveredBy(item.node.path))
  const filtered = props.agePreset !== "all" || props.ecosystem !== "all"
  const empty = total.count === 0
  const clearable = useMemo(
    () =>
      total.groups
        .flatMap((group) => group.items)
        .map((item) => item.node)
        .filter((node) => props.isCollected(node.path)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [total.groups, props.collectionCount, props.isCollected]
  )

  const filters = (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      {safe.length > 0 ? (
        <button
          type="button"
          className={cn(quietButton, "text-[var(--dl-accent)] disabled:opacity-60")}
          disabled={allSafeSelected}
          onClick={() => props.onCollect(safe.map((item) => item.node))}
        >
          {allSafeSelected ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : null}
          {allSafeSelected
            ? language.t("disk.ui.cleanup.allSelected")
            : `${language.t("disk.ui.cleanup.selectSafe")} · ${shortBytes(safeBytes)}`}
        </button>
      ) : null}
      <DropdownMenu placement="bottom-end" gutter={6}>
        <DropdownMenu.Trigger as="button" type="button" className={quietButton}>
          <span className="text-text-weak">{language.t("disk.ui.cleanup.unchangedFor")}</span>
          {language.t(AGE_SHORT[props.agePreset])}
          <ChevronDown className="size-3.5 text-text-weak" aria-hidden />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            {DEVELOPER_CLEANUP_AGE_PRESETS.filter((preset) => preset !== "custom" && preset !== "60").map((preset) => (
              <DropdownMenu.Item key={preset} onSelect={() => props.onAgePreset(preset)}>
                <DropdownMenu.ItemLabel>{language.t(AGE_SHORT[preset])}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
      {props.ecosystems.length > 1 ? (
        <DropdownMenu placement="bottom-end" gutter={6}>
          <DropdownMenu.Trigger as="button" type="button" className={quietButton}>
            {props.ecosystem === "all"
              ? language.t("disk.common.allEcosystems")
              : artifactEcosystemLabel(props.ecosystem)}
            <ChevronDown className="size-3.5 text-text-weak" aria-hidden />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Item onSelect={() => props.onEcosystem("all")}>
                <DropdownMenu.ItemLabel>{language.t("disk.common.allEcosystems")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              {props.ecosystems.map((ecosystem) => (
                <DropdownMenu.Item key={ecosystem} onSelect={() => props.onEcosystem(ecosystem)}>
                  <DropdownMenu.ItemLabel>{artifactEcosystemLabel(ecosystem)}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      ) : null}
    </div>
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <div className="mx-auto w-full max-w-[720px] px-4 pt-6 pb-28">
          <header className="flex flex-wrap items-end gap-x-4 gap-y-3 px-3">
            <div className="min-w-0 flex-1">
              <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em] text-text-strong tabular-nums">
                {total.bytes > 0
                  ? language.t("disk.ui.cleanup.headline", { size: formatBytes(total.bytes) })
                  : language.t("disk.ui.cleanup.headlineNone")}
              </h1>
              {total.count > 0 ? (
                <p className="mt-0.5 text-[13px] text-text-weak">
                  {language.plural("disk.ui.cleanup.itemsSafe", total.count)}
                  {safeBytes > 0 ? (
                    <>
                      {" · "}
                      <span className="text-[var(--dl-positive)]">
                        {language.t("disk.ui.cleanup.safeNow", { size: formatBytes(safeBytes) })}
                      </span>
                    </>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger
                      className="ml-1.5 inline-grid size-5 translate-y-[3px] place-items-center rounded-full text-text-weaker outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
                      aria-label={language.t("disk.ui.cleanup.coverage")}
                    >
                      <Info className="size-3.5" aria-hidden />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="max-w-sm items-start py-2 leading-relaxed">
                      <span>
                        {language.t("disk.ui.cleanup.explain", { trash: props.trashName })}
                        {props.inventoryNote ? ` ${props.inventoryNote}` : ""}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                </p>
              ) : null}
            </div>
            {!empty || filtered ? filters : null}
          </header>

          {total.groups.length > 1 ? (
            <div className="mx-3 mt-4 flex h-1.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
              {total.groups.map((group) => (
                <motion.span
                  key={group.key}
                  className="h-full rounded-[1px] first:rounded-l-full last:rounded-r-full"
                  style={{ background: group.color }}
                  initial={{ flexGrow: 0 }}
                  animate={{ flexGrow: Math.max(group.bytes, total.bytes * 0.004) }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  title={`${group.label} · ${formatBytes(group.bytes)}`}
                />
              ))}
            </div>
          ) : null}

          {empty ? (
            <div className="mt-16 grid place-items-center px-6 py-12 text-center">
              <Sparkles className="size-6 text-text-weaker" aria-hidden />
              <p className="mt-3 text-[15px] font-medium text-text-strong">
                {language.t(filtered ? "disk.ui.cleanup.filteredTitle" : "disk.ui.cleanup.emptyTitle")}
              </p>
              {filtered ? (
                <button
                  type="button"
                  className={cn(quietButton, "mt-4")}
                  onClick={() => {
                    props.onAgePreset("all")
                    props.onEcosystem("all")
                  }}
                >
                  {language.t("disk.cleanup.clearFilters")}
                </button>
              ) : (
                <p className="mt-1 max-w-sm text-[13px] text-text-weak">
                  {language.t("disk.ui.cleanup.emptyBody")}
                </p>
              )}
            </div>
          ) : null}

          {developer.length > 0 ? (
            <Section title={suggestions.length > 0 ? language.t("disk.ui.cleanup.developer") : undefined}>
              <GroupList
                groups={developer}
                defaultOpen={developer.find((candidate) => candidate.items.length > 1)}
                {...props}
              />
            </Section>
          ) : null}
          {suggestions.length > 0 ? (
            <Section title={language.t("disk.ui.cleanup.suggestions")}>
              <GroupList
                groups={suggestions}
                defaultOpen={
                  developer.length === 0
                    ? suggestions.find((candidate) => candidate.items.length > 1)
                    : undefined
                }
                {...props}
              />
            </Section>
          ) : null}
          {locked.length > 0 ? <LockedSection items={locked} {...props} /> : null}
        </div>
      </div>

      <CleanupFooter
        count={props.collectionCount}
        bytes={props.collectionBytes}
        trashName={props.trashName}
        onReview={props.onReview}
        onClear={() => props.onUncollect(clearable)}
      />
    </div>
  )
}

function Section(props: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      {props.title ? (
        <h2 className="mb-1 px-3 text-[12px] font-medium text-text-weak">{props.title}</h2>
      ) : null}
      <div className="flex flex-col">{props.children}</div>
    </section>
  )
}

const GROUP_PREVIEW = 6

type GroupProps0 = Parameters<typeof CleanupView>[0]

function GroupList(props: GroupProps0 & { groups: CleanupGroup[]; defaultOpen?: CleanupGroup }) {
  const language = useLanguage()
  const [all, setAll] = useState(false)
  const shown = all ? props.groups : props.groups.slice(0, GROUP_PREVIEW)
  const hidden = props.groups.length - shown.length
  const hiddenBytes = props.groups.slice(GROUP_PREVIEW).reduce((sum, group) => sum + group.bytes, 0)
  return (
    <>
      {shown.map((group, index) => (
        <GroupCard
          key={group.key}
          {...props}
          group={group}
          index={index}
          defaultOpen={group === props.defaultOpen}
        />
      ))}
      {props.groups.length > GROUP_PREVIEW ? (
        <button
          type="button"
          className="mt-1 flex h-9 items-center rounded-md px-3 text-left text-[13px] text-text-weak outline-none hover:bg-[var(--dl-row-hover)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
          onClick={() => setAll((value) => !value)}
        >
          {all
            ? language.t("disk.ui.cleanup.showFewer")
            : `${language.plural("disk.ui.cleanup.moreGroups", hidden)} · ${formatBytes(hiddenBytes)}`}
        </button>
      ) : null}
    </>
  )
}

function LockedSection(props: GroupProps0 & { items: CleanupItem[] }) {
  const language = useLanguage()
  return (
    <details className="group/locked mt-6">
      <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-[13px] text-text-weak outline-none select-none hover:bg-[var(--dl-row-hover)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] [&::-webkit-details-marker]:hidden">
        <Lock className="size-3.5" aria-hidden />
        <span className="flex-1">
          {language.plural("disk.ui.cleanup.locked", props.items.length, { trash: props.trashName })}
        </span>
        <ChevronDown className="size-3.5 transition-transform group-open/locked:rotate-180" aria-hidden />
      </summary>
      <ul>
        {props.items.map((item) => (
          <li key={item.node.path} className="flex h-11 items-center gap-3 rounded-md px-3" title={item.node.path}>
            <Lock className="size-3.5 shrink-0 text-text-weaker" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] leading-5 text-text-base">{itemIdentity(item.node).title}</p>
              <p className="truncate text-[11.5px] leading-4 text-text-weaker">
                {props.restriction(item.node) ?? item.node.path}
              </p>
            </div>
            <span className="shrink-0 text-[13px] text-text-weak tabular-nums">{formatBytes(item.bytes)}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

type GroupProps = GroupProps0 & {
  group: CleanupGroup
  index: number
  defaultOpen?: boolean
}

function Tile(props: { color?: string; children: React.ReactNode }) {
  return (
    <span
      className="grid size-9 shrink-0 place-items-center rounded-[10px]"
      style={{
        background: `color-mix(in oklch, ${props.color ?? "var(--text-weak)"} 18%, transparent)`,
        color: `color-mix(in oklch, ${props.color ?? "var(--text-weak)"} 80%, var(--text-strong))`,
      }}
      aria-hidden
    >
      {props.children}
    </span>
  )
}

const rowSurface = "rounded-md transition-colors duration-100 hover:bg-[var(--dl-row-hover)]"

function GroupCard(props: GroupProps) {
  const language = useLanguage()
  const { group } = props
  const [open, setOpen] = useState(!!props.defaultOpen)
  const [expanded, setExpanded] = useState(false)
  if (group.items.length === 1)
    return (
      <ul>
        <CleanupRow {...props} item={group.items[0]} color={group.color} top />
      </ul>
    )
  const actionable = group.items.filter(
    (item) => props.canModify(item.node) && !props.coveredBy(item.node.path)
  )
  const selected = actionable.filter((item) => props.isCollected(item.node.path))
  const state =
    actionable.length > 0 && selected.length === actionable.length
      ? "all"
      : selected.length > 0
        ? "some"
        : "none"
  const selectedBytes = selected.reduce((sum, item) => sum + item.bytes, 0)
  const rows = expanded ? group.items : group.items.slice(0, PREVIEW_ROWS)

  return (
    <div>
      <div className={cn("flex h-14 items-center gap-3 pl-3", rowSurface)}>
        <Checkbox
          state={state}
          disabled={actionable.length === 0}
          label={language.t("disk.ui.cleanup.selectGroup", { name: group.label })}
          onChange={() =>
            state === "all"
              ? props.onUncollect(actionable.map((item) => item.node))
              : props.onCollect(actionable.map((item) => item.node))
          }
        />
        <button
          type="button"
          className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-md pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] focus-visible:ring-inset"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Tile color={group.color}>
            <Layers className="size-4" strokeWidth={1.75} />
          </Tile>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] leading-5 font-medium text-text-strong">{group.label}</span>
            <span className="block truncate text-[11.5px] leading-4 text-text-weaker tabular-nums">
              {language.plural("disk.count.item", group.items.length)}
              {selected.length > 0 ? ` · ${formatBytes(selectedBytes)} ${language.t("disk.detail.selected").toLocaleLowerCase()}` : ""}
            </span>
          </span>
          <span className="shrink-0 text-[14px] font-medium text-text-strong tabular-nums">{formatBytes(group.bytes)}</span>
          <ChevronDown
            className={cn("size-3.5 shrink-0 text-text-weaker transition-transform duration-200", open && "rotate-180")}
            aria-hidden
          />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <ul className="ml-[21px] border-l border-[var(--dl-separator)] pl-2">
              {rows.map((item) => (
                <CleanupRow key={item.node.path} item={item} {...props} />
              ))}
            </ul>
            {group.items.length > PREVIEW_ROWS ? (
              <button
                type="button"
                className="mt-0.5 ml-[29px] flex h-8 items-center rounded-md px-3 text-[12px] text-text-weak outline-none hover:bg-[var(--dl-row-hover)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded
                  ? language.t("disk.ui.cleanup.showFewer")
                  : language.t("disk.ui.cleanup.showAll", { count: group.items.length })}
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

function CleanupRow(props: GroupProps & { item: CleanupItem; color?: string; top?: boolean }) {
  const language = useLanguage()
  const { item } = props
  const collected = props.isCollected(item.node.path)
  const coveredBy = props.coveredBy(item.node.path)
  const change = props.changeFor?.(item.node.path)
  const restriction = props.canModify(item.node) ? undefined : props.restriction(item.node)
  const identity = itemIdentity(item.node)
  const where =
    item.node.path
      .replace(/[\\/][^\\/]+$/, "")
      .replace(/^\/Users\/[^/]+/, "~") || "/"
  const selectable = !restriction && !coveredBy
  return (
    <li
      className={cn(
        "group relative flex items-center gap-3 pr-3",
        props.top ? "h-14" : "h-11",
        props.top ? "pl-3" : "pl-2",
        rowSurface,
        selectable && "cursor-pointer",
        collected && "bg-[color-mix(in_oklch,var(--dl-accent)_9%,transparent)] hover:bg-[color-mix(in_oklch,var(--dl-accent)_13%,transparent)]"
      )}
      onClick={(event) => {
        if (!selectable || (event.target as HTMLElement).closest("button")) return
        props.onToggle(item.node)
      }}
    >
      <Checkbox
        state={collected || coveredBy ? "all" : "none"}
        disabled={!!restriction || !!coveredBy}
        label={item.node.name}
        onChange={() => props.onToggle(item.node)}
      />
      {props.top ? (
        <Tile color={props.color}>
          {item.node.isDir ? (
            <Package className="size-4" strokeWidth={1.75} />
          ) : (
            <FileIcon className="size-4" strokeWidth={1.75} />
          )}
        </Tile>
      ) : null}
      <div className="min-w-0 flex-1" title={item.node.path}>
        <p className={cn("truncate leading-5 text-text-strong", props.top ? "text-[14px] font-medium" : "text-[13.5px]")}>
          {identity.title}
          {identity.title !== identity.artifact ? (
            <span className="text-text-weak"> · {identity.artifact}</span>
          ) : null}
        </p>
        <p className="truncate text-[11.5px] leading-4 text-text-weaker">
          {restriction ? (
            <span className="text-[var(--dl-warning)]">{restriction}</span>
          ) : coveredBy ? (
            language.t("disk.review.includedWith", { name: coveredBy })
          ) : (
            <>
              {where}
              {" · "}
              {formatLastChanged(item.node.modifiedAt)}
            </>
          )}
        </p>
      </div>
      {change && change.deltaBytes > 0 ? (
        <span
          className="hidden shrink-0 text-[11px] font-medium text-[var(--dl-accent)] tabular-nums sm:inline"
          title={language.t("disk.ui.sinceLast")}
        >
          {change.kind === "added" ? language.t("disk.ui.kind.added") : `+${shortBytes(change.deltaBytes)}`}
        </span>
      ) : null}
      {item.safe ? null : (
        <span className="hidden shrink-0 rounded-full bg-[color-mix(in_oklch,var(--dl-warning)_16%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--dl-warning)] sm:inline">
          {language.t("disk.ui.cleanup.check")}
        </span>
      )}
      <span
        className={cn(
          "w-[4.5rem] shrink-0 text-right tabular-nums",
          props.top ? "text-[14px] font-medium text-text-strong" : "text-[13px] text-text-base"
        )}
      >
        {formatBytes(item.bytes)}
      </span>
      <span className="-mr-1.5 flex shrink-0 items-center">
        {props.onPreview ? (
          <IconAction
            label={language.t("disk.common.quickLook")}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-sm:hidden"
            onClick={() => props.onPreview?.(item.node)}
          >
            <Eye className="size-3.5" aria-hidden />
          </IconAction>
        ) : null}
        <IconAction label={language.t("disk.common.reveal")} onClick={() => props.onReveal(item.node)}>
          <FolderOpen className="size-3.5" aria-hidden />
        </IconAction>
      </span>
      <span className="sr-only">{collected ? language.t("disk.detail.selected") : ""}</span>
    </li>
  )
}

function IconAction(props: { label: string; className?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-7 place-items-center rounded-md text-text-weaker outline-none transition-[color,background-color,opacity] hover:bg-[var(--dl-well-strong)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]",
        props.className
      )}
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function Checkbox(props: {
  state: "all" | "some" | "none"
  disabled?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={props.state === "all" ? true : props.state === "some" ? "mixed" : false}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={props.onChange}
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-full outline-none transition-[background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-transparent disabled:opacity-35",
        props.state === "none"
          ? "shadow-[inset_0_0_0_1.5px_var(--text-weaker)] hover:shadow-[inset_0_0_0_1.5px_var(--text-weak)]"
          : "bg-[var(--dl-accent)] text-white"
      )}
    >
      <AnimatePresence initial={false} mode="wait">
        {props.state === "all" ? (
          <motion.span key="all" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.12 }}>
            <Check className="size-2.5" strokeWidth={4} aria-hidden />
          </motion.span>
        ) : props.state === "some" ? (
          <motion.span key="some" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.12 }}>
            <Minus className="size-2.5" strokeWidth={4} aria-hidden />
          </motion.span>
        ) : null}
      </AnimatePresence>
    </button>
  )
}

/** Mirrors the map's collector pill so both surfaces read as one control. */
function CleanupFooter(props: {
  count: number
  bytes: number
  trashName: string
  onReview: () => void
  onClear: () => void
}) {
  const language = useLanguage()
  const active = props.count > 0
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4">
      <div className="pointer-events-auto flex h-12 w-full max-w-[720px] items-center gap-2 rounded-full bg-[var(--dl-popover)] py-1.5 pr-1.5 pl-5 shadow-[0_0_0_0.5px_rgb(255_255_255/0.06),0_8px_28px_rgb(0_0_0/0.28)]">
        <p className="min-w-0 flex-1 truncate text-[13px] tabular-nums">
          {active ? (
            <>
              <span className="font-medium text-text-strong">
                {language.t("disk.ui.cleanup.footerSelected", { size: formatBytes(props.bytes) })}
              </span>
              <span className="text-text-weak"> · {language.plural("disk.count.item", props.count)}</span>
            </>
          ) : (
            <span className="text-text-weak">
              {language.t("disk.ui.cleanup.footerIdle", { trash: props.trashName })}
            </span>
          )}
        </p>
        {active ? (
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-full px-3.5 text-[13px] font-medium text-text-weak outline-none hover:bg-[var(--dl-well)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
            onClick={props.onClear}
          >
            {language.t("disk.ui.collectorClear")}
          </button>
        ) : null}
        <button
          type="button"
          className={cn(primaryButton, "h-9 rounded-full px-4")}
          disabled={!active}
          onClick={props.onReview}
        >
          {language.t("disk.ui.cleanup.review")}
        </button>
      </div>
    </div>
  )
}
