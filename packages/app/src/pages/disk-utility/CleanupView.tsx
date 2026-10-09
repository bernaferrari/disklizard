import { Button } from "@/components/ui/button"
import { useId, useMemo, useState, useEffect, type KeyboardEvent } from "react"
import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Folder,
  Hammer,
  Info,
  Lock,
  Minus,
  Package,
  ScrollText,
  Search,
  Sparkles,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { CleanupFilters, cleanupToolbarControl } from "./CleanupFilters"
import { CleanupInspector } from "./CleanupInspector"
import { formatBytes } from "./format"
import { useLanguage, type DiskLanguageKey } from "./runtime"
import type { DiskScanNode, DiskCleanupLock } from "./types"
import type { ArtifactEcosystem, ArtifactEcosystemFilter } from "./recognize"
import {
  itemIdentity,
  cleanupLocationLabels,
  abbreviateHomePath,
} from "./item-identity"
import type { DeveloperCleanupAgePreset } from "./developer-cleanup"
import type { BaselineChange } from "./scan-baseline"
import {
  organizeCleanupGroups,
  type CleanupGrouping,
  type CleanupSort,
  type CleanupSummary,
  type CleanupItem,
  type CleanupGroup,
} from "./cleanup-summary"

import { ACCESS_LABEL, type AccessAssessment } from "./access-assessments"
import { formatLastChanged } from "./format"
import { uniqueDeletionRoots } from "./storage"

const PREVIEW_ROWS = 4

/** Categories read as kinds of files, not as folders on disk. */
const CATEGORY_ICON: Partial<Record<DiskLanguageKey, LucideIcon>> = {
  "disk.ui.cleanup.dependencies": Package,
  "disk.ui.cleanup.buildOutput": Hammer,
  "disk.ui.cleanup.category.caches": Database,
  "disk.ui.cleanup.category.logs": ScrollText,
  "disk.ui.cleanup.category.tools": Wrench,
  "disk.ui.cleanup.category.other": Folder,
}

export function CleanupView(props: {
  summary: CleanupSummary
  homePath?: string
  onInspect?: (node: DiskScanNode) => void
  onObserve?: (node: DiskScanNode) => void
  accessFor?: (node: DiskScanNode) => AccessAssessment
  onCheckAccess?: (node: DiskScanNode) => void
  onRescan?: () => void
  protectionFor?: (node: DiskScanNode) => DiskCleanupLock | undefined
  onUnprotect?: (lock: DiskCleanupLock) => void
  customAgeDays?: string
  onCustomAgeDays?: (days: string) => void
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
  /** Release several items at once (a category checkbox). */
  onRelease?: (nodes: readonly DiskScanNode[]) => void
  onReview: () => void
  onClear: () => void
  onReveal: (node: DiskScanNode) => void
  onPreview?: (node: DiskScanNode) => void
  /** Growth since the previous scan of this root, keyed by path. */
  changeFor?: (path: string) => BaselineChange | undefined
}) {
  const language = useLanguage()
  const inspectorId = useId()
  const listKeysId = useId()
  const [search, setSearch] = useState("")
  const [grouping, setGrouping] = useState<CleanupGrouping>("artifact")
  const [groupLimit, setGroupLimit] = useState(24)
  const [sort, setSort] = useState<CleanupSort>("largest")
  const { ready, review } = useMemo(
    () =>
      organizeCleanupGroups(props.summary, { query: search, grouping, sort }),
    [props.summary, search, grouping, sort]
  )
  const locked = props.summary.locked.filter((item) =>
    item.node.path
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase())
  )
  const locations = useMemo(
    () =>
      cleanupLocationLabels(
        [
          ...props.summary.groups.flatMap((group) =>
            group.items.map((item) => item.node.path)
          ),
          ...props.summary.locked.map((item) => item.node.path),
        ],
        props.homePath
      ),
    [props.summary, props.homePath]
  )
  const groups = useMemo(() => [...ready, ...review], [ready, review])
  const [inspectedPath, setInspectedPath] = useState<string>()
  const activeGroup =
    groups.find((group) =>
      group.items.some((item) => item.node.path === inspectedPath)
    ) ??
    (locked.some((item) => item.node.path === inspectedPath)
      ? undefined
      : groups[0])
  const active =
    [...groups.flatMap((group) => group.items), ...locked].find(
      (item) => item.node.path === inspectedPath
    ) ??
    activeGroup?.items[0] ??
    locked[0]
  useEffect(() => {
    if (active) {
      setInspectedPath(active.node.path)
      props.onInspect?.(active.node)
    }
  }, [active?.node, props.onInspect])
  const readyItems = ready.flatMap((group) => group.items)
  const allSafeSelected =
    readyItems.length > 0 &&
    readyItems.every(
      (item) =>
        props.isCollected(item.node.path) || !!props.coveredBy(item.node.path)
    )
  const matchedItems = groups.flatMap((group) => group.items)
  const matchedBytes = uniqueDeletionRoots(
    matchedItems.map((item) => item.node),
    props.summary.os
  ).reduce((sum, node) => sum + node.size, 0)
  const readyBytes = uniqueDeletionRoots(
    ready.flatMap((group) => group.items.map((item) => item.node)),
    props.summary.os
  ).reduce((sum, node) => sum + node.size, 0)
  const selectedElsewhere =
    props.collectionCount >
    groups.reduce(
      (sum, group) =>
        sum +
        group.items.filter((item) => props.isCollected(item.node.path)).length,
      0
    )
  // Past the scanner's attribution bound every folder is flagged. Say so once
  // instead of repeating the same caveat on each item.
  const allItems = groups.flatMap((group) => group.items)
  const blanketIncomplete =
    allItems.length > 1 && allItems.every((item) => item.unobserved)
  const filtered =
    props.agePreset !== "all" || props.ecosystem !== "all" || !!search.trim()
  const empty = groups.length === 0 && locked.length === 0
  const rows = {
    locations,
    restriction: props.restriction,
    accessFor: props.accessFor,
    onObserve: props.onObserve,
    isCollected: props.isCollected,
    coveredBy: props.coveredBy,
    canModify: props.canModify,
    onToggle: props.onToggle,
    onCollect: props.onCollect,
    onRelease: props.onRelease,
    activePath: active?.node.path,
    flagIncomplete: !blanketIncomplete,
    inspectorId,
    listKeysId,
    onInspect: (item: CleanupItem) => setInspectedPath(item.node.path),
  }
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col px-6 pt-6 pb-6 max-[760px]:px-4 max-[760px]:pt-4 max-[760px]:pb-4">
      <header className="flex shrink-0 items-end justify-between gap-4 pb-4">
        <div className="min-w-0">
          <h1 className="text-[24px] leading-8 font-semibold tracking-[-0.03em] text-text-strong">
            {language.t("disk.ui.cleanup.title")}
          </h1>
          <div className="mt-0.5 flex items-center gap-0.5 text-[13px] text-text-weak tabular-nums">
            {language.t("disk.ui.cleanup.summary", {
              size: formatBytes(matchedBytes),
              count: language.plural("disk.count.item", matchedItems.length),
            })}
            <Popover>
              <PopoverTrigger
                className="grid size-6 place-items-center rounded-md text-text-weaker outline-none hover:bg-[var(--dl-well)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] data-[popup-open]:bg-[var(--dl-well)]"
                aria-label={language.t("disk.ui.cleanup.coverage")}
              >
                <Info className="size-3.5" aria-hidden />
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 gap-2 p-4">
                <p className="text-[13px] font-medium">
                  {language.t("disk.ui.cleanup.coverage")}
                </p>
                <p className="text-[13px] leading-5 text-text-weak">
                  {language.t("disk.ui.cleanup.explain", {
                    trash: props.trashName,
                  })}
                </p>
                {props.inventoryNote ? (
                  <p className="text-[12px] leading-5 text-text-weak">
                    {props.inventoryNote}
                  </p>
                ) : null}
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </header>
      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
        <label className="relative flex h-9 min-w-48 flex-1 items-center">
          <Search
            className="pointer-events-none absolute left-3 size-3.5 text-text-weaker"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={language.t("disk.ui.cleanup.search")}
            placeholder={language.t("disk.ui.cleanup.search")}
            className="h-full w-full rounded-lg border border-[var(--dl-separator)] bg-transparent pr-3 pl-8.5 text-[13px] text-text-strong transition-[border-color,box-shadow] outline-none placeholder:text-text-weaker hover:border-[var(--dl-well-strong)] focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
          />
        </label>
        <ToolbarSelect
          label={language.t("disk.ui.cleanup.groupBy")}
          value={grouping}
          onValueChange={setGrouping}
          options={[
            {
              value: "artifact",
              label: language.t("disk.ui.cleanup.groupArtifact"),
            },
            {
              value: "project",
              label: language.t("disk.ui.cleanup.groupProject"),
            },
          ]}
        />
        <ToolbarSelect
          label={language.t("disk.ui.cleanup.sortBy")}
          value={sort}
          onValueChange={setSort}
          options={[
            {
              value: "largest",
              label: language.t("disk.ui.cleanup.sortLargest"),
            },
            {
              value: "oldest",
              label: language.t("disk.ui.cleanup.sortOldest"),
            },
          ]}
        />
        {!empty || filtered ? (
          <CleanupFilters
            age={props.agePreset}
            ecosystem={props.ecosystem}
            ecosystems={props.ecosystems}
            customDays={props.customAgeDays}
            onCustomDays={props.onCustomAgeDays}
            onAge={props.onAgePreset}
            onEcosystem={props.onEcosystem}
          />
        ) : null}
      </div>
      {props.summary.groups
        .flatMap((group) => group.items)
        .some(
          (item) => item.accountingContributionBytes !== item.operationBytes
        ) ? (
        <p className="mb-3 text-[12px] text-text-weak">
          {language.t("disk.ui.cleanup.overlap")}
        </p>
      ) : null}
      {blanketIncomplete ? (
        <p className="mb-3 flex shrink-0 items-start gap-2 rounded-lg bg-[var(--dl-well)] px-3.5 py-2.5 text-[12.5px] leading-[1.55] text-text-weak">
          <Info
            className="mt-[3px] size-3.5 shrink-0 text-text-weaker"
            aria-hidden
          />
          {language.t("disk.ui.cleanup.partialScan")}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-t-xl border border-b-0 border-[var(--dl-separator)] max-[760px]:flex-col">
        <div
          data-cleanup-list
          role="region"
          aria-label={language.t("disk.ui.cleanup.list")}
          className="min-h-0 min-w-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-2 pt-2 pb-6"
        >
          <p id={listKeysId} className="sr-only">
            {language.t("disk.ui.cleanup.listKeys")}
          </p>
          {empty ? (
            <div className="grid min-h-[300px] place-content-center px-4 text-center">
              <span className="mx-auto grid size-11 place-items-center rounded-full bg-[var(--dl-well)] text-text-weak">
                <Sparkles className="size-5" aria-hidden />
              </span>
              <p className="mt-4 text-[15px] font-medium text-text-strong">
                {language.t(
                  filtered
                    ? "disk.ui.cleanup.filteredTitle"
                    : "disk.ui.cleanup.emptyTitle"
                )}
              </p>
              {filtered ? (
                <Button
                  type="button"
                  variant="secondary"
                  className="mx-auto mt-4"
                  onClick={() => {
                    setSearch("")
                    props.onAgePreset("all")
                    props.onEcosystem("all")
                  }}
                >
                  {language.t("disk.cleanup.clearFilters")}
                </Button>
              ) : (
                <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-5 text-text-weak">
                  {language.t("disk.ui.cleanup.emptyBody")}
                </p>
              )}
            </div>
          ) : null}
          {ready.length > 0 ? (
            <Section
              title={language.t("disk.ui.cleanup.ready")}
              meta={formatBytes(readyBytes)}
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={allSafeSelected}
                  onClick={() =>
                    props.onCollect(
                      ready.flatMap((group) =>
                        group.items.map((item) => item.node)
                      )
                    )
                  }
                >
                  {allSafeSelected ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : null}
                  {language.t(
                    allSafeSelected
                      ? "disk.ui.cleanup.selectedAll"
                      : "disk.ui.cleanup.selectAll"
                  )}
                </Button>
              }
            >
              {ready.slice(0, groupLimit).map((group) => (
                <GroupRow key={group.key} group={group} bulk {...rows} />
              ))}
            </Section>
          ) : null}
          {review.length > 0 ? (
            <Section
              title={language.t("disk.ui.cleanup.individual")}
              description={language.t("disk.ui.cleanup.individualDescription")}
            >
              {review.slice(0, groupLimit).map((group) => (
                <GroupRow key={group.key} group={group} {...rows} />
              ))}
            </Section>
          ) : null}
          {Math.max(ready.length, review.length) > groupLimit ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setGroupLimit((value) => value + 24)}
            >
              {language.plural(
                "disk.ui.cleanup.moreGroups",
                Math.min(24, Math.max(ready.length, review.length) - groupLimit)
              )}
            </Button>
          ) : null}
          {locked.length > 0 ? (
            <ProtectedItems items={locked} {...rows} />
          ) : null}
        </div>
        {active ? (
          <CleanupInspector
            id={inspectorId}
            item={active}
            category={
              activeGroup?.label
                ? abbreviateHomePath(activeGroup.label, props.homePath)
                : language.t(
                    activeGroup?.labelKey ?? "disk.ui.cleanup.unavailable"
                  )
            }
            collected={props.isCollected(active.node.path)}
            coveredBy={props.coveredBy(active.node.path)}
            restriction={
              props.canModify(active.node)
                ? undefined
                : props.restriction(active.node)
            }
            change={props.changeFor?.(active.node.path)}
            flagIncomplete={!blanketIncomplete}
            access={props.accessFor?.(active.node)}
            onCheckAccess={props.onCheckAccess}
            onRescan={props.onRescan}
            protection={props.protectionFor?.(active.node)}
            onUnprotect={props.onUnprotect}
            onToggle={props.onToggle}
            onReveal={props.onReveal}
            onPreview={props.onPreview}
          />
        ) : null}
      </div>
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {active
          ? language.t("disk.ui.cleanup.inspecting", {
              name: itemIdentity(active.node).reviewTitle,
            })
          : ""}
      </span>
      {!empty || props.collectionCount > 0 ? (
        <div className="flex h-16 shrink-0 items-center gap-3 rounded-b-xl border border-[var(--dl-separator)] bg-[var(--dl-chrome)] px-4">
          <div
            className="min-w-0 flex-1 text-[13px] leading-5 tabular-nums"
            role="status"
            aria-live="polite"
          >
            {props.collectionCount > 0 ? (
              <>
                <p className="truncate">
                  <span className="font-medium text-text-strong">
                    {language.t("disk.ui.cleanup.footerSelected", {
                      size: formatBytes(props.collectionBytes),
                    })}
                  </span>
                  <span className="text-text-weak">
                    {" · "}
                    {language.plural("disk.count.item", props.collectionCount)}
                  </span>
                </p>
                {selectedElsewhere ? (
                  <p className="truncate text-[12px] text-text-weak">
                    {language.t("disk.ui.cleanup.selectedElsewhere")}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="truncate text-text-weak">
                {language.t("disk.ui.cleanup.footerIdle", {
                  trash: props.trashName,
                })}
              </p>
            )}
          </div>
          {props.collectionCount > 0 ? (
            <Button type="button" variant="ghost" onClick={props.onClear}>
              {language.t("disk.ui.collectorClear")}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={props.collectionCount === 0}
            onClick={props.onReview}
          >
            <Trash2 className="size-3.5" aria-hidden />
            {language.t("disk.ui.moveToTrashEllipsis", {
              trash: props.trashName,
            })}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** A labeled toolbar choice. The label stays visible so "Artifact type" never
 * reads as a filter value when it is really how the list is grouped. */
function ToolbarSelect<T extends string>(props: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onValueChange: (value: T) => void
}) {
  const current = props.options.find((option) => option.value === props.value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cleanupToolbarControl}>
        <span className="text-text-weak">{props.label}</span>
        <span className="font-medium text-text-strong">{current?.label}</span>
        <ChevronDown className="size-3.5 text-text-weaker" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-auto">
        <DropdownMenuRadioGroup
          value={props.value}
          onValueChange={(value) => {
            const option = props.options.find(
              (candidate) => candidate.value === value
            )
            if (option) props.onValueChange(option.value)
          }}
        >
          {props.options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Section(props: {
  title: string
  description?: string
  meta?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-label={props.title} className="mt-2 mb-4">
      <div className="flex min-h-9 items-center gap-3 px-3 pt-1 pb-1.5">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-baseline gap-2 text-[11px] font-semibold tracking-[0.06em] text-text-weak uppercase">
            {props.title}
            {props.meta ? (
              <span className="font-medium tracking-normal text-text-weaker normal-case tabular-nums">
                {props.meta}
              </span>
            ) : null}
          </h2>
          {props.description ? (
            <p className="mt-0.5 truncate text-[12px] text-text-weaker">
              {props.description}
            </p>
          ) : null}
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  )
}

type RowProps = {
  locations: Map<string, string>
  restriction: (node: DiskScanNode) => string | undefined
  accessFor?: (node: DiskScanNode) => AccessAssessment
  onObserve?: (node: DiskScanNode) => void
  activePath?: string
  /** Mark folders the scan could not fully read. */
  flagIncomplete: boolean
  inspectorId: string
  listKeysId: string
  isCollected: (path: string) => boolean
  coveredBy: (path: string) => string | undefined
  canModify: (node: DiskScanNode) => boolean
  onToggle: (node: DiskScanNode) => void
  onCollect: (nodes: readonly DiskScanNode[]) => void
  onRelease?: (nodes: readonly DiskScanNode[]) => void
  onInspect: (item: CleanupItem) => void
}

/** Shared 16px box so items, categories, and the select-all action align. */
function CheckBox(props: {
  state: "on" | "off" | "mixed"
  disabled?: boolean
  label: string
  describedBy?: string
  onClick: () => void
}) {
  const filled = props.state !== "off"
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={props.state === "mixed" ? "mixed" : props.state === "on"}
      aria-describedby={props.describedBy}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={(event) => {
        event.stopPropagation()
        props.onClick()
      }}
      className={cn(
        "relative grid size-4 shrink-0 place-items-center rounded-[4px] transition-[background-color,box-shadow] outline-none before:absolute before:-inset-2 focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background-base)] disabled:opacity-35",
        filled
          ? "bg-[var(--dl-accent)] text-white"
          : "shadow-[inset_0_0_0_1.5px_var(--text-weaker)] hover:shadow-[inset_0_0_0_1.5px_var(--text-weak)]"
      )}
    >
      {props.state === "on" ? (
        <Check className="size-3" strokeWidth={3} aria-hidden />
      ) : props.state === "mixed" ? (
        <Minus className="size-3" strokeWidth={3} aria-hidden />
      ) : null}
    </button>
  )
}

function GroupRow(props: RowProps & { group: CleanupGroup; bulk?: boolean }) {
  const language = useLanguage()
  const { group } = props
  const id = useId()
  const [open, setOpen] = useState(() =>
    group.items.some((item) => item.node.path === props.activePath)
  )
  const [limit, setLimit] = useState(PREVIEW_ROWS)
  if (group.items.length === 1)
    return (
      <ul>
        <ItemRow
          {...props}
          item={group.items[0]}
          category={group.label ?? language.t(group.labelKey)}
        />
      </ul>
    )
  const selected = group.items.filter((item) =>
    props.isCollected(item.node.path)
  ).length
  const selectable = group.items.filter(
    (item) => props.canModify(item.node) && !props.coveredBy(item.node.path)
  )
  const groupState =
    selected === 0
      ? "off"
      : selectable.every((item) => props.isCollected(item.node.path))
        ? "on"
        : "mixed"
  const containsInspection = group.items.some(
    (item) => item.node.path === props.activePath
  )
  const CategoryIcon = CATEGORY_ICON[group.labelKey] ?? Box
  const count = language.plural("disk.count.item", group.items.length)
  const label = group.label ?? language.t(group.labelKey)
  return (
    <div data-cleanup-group>
      <div
        className={cn(
          "flex h-12 items-center gap-3 rounded-lg pl-3",
          !open && containsInspection
            ? "bg-[var(--dl-well-strong)]"
            : "hover:bg-[var(--dl-row-hover)]"
        )}
      >
        {props.bulk ? (
          <CheckBox
            state={groupState}
            disabled={selectable.length === 0}
            label={language.t("disk.ui.cleanup.selectGroup", { name: label })}
            onClick={() =>
              groupState === "on"
                ? props.onRelease?.(selectable.map((item) => item.node))
                : props.onCollect(selectable.map((item) => item.node))
            }
          />
        ) : (
          <CategoryIcon
            className="size-4 shrink-0 text-text-weaker"
            strokeWidth={1.75}
            aria-hidden
          />
        )}
        <button
          type="button"
          data-cleanup-navigation
          data-cleanup-group-toggle
          aria-expanded={open}
          aria-controls={id}
          aria-current={!open && containsInspection ? "true" : undefined}
          aria-describedby={props.listKeysId}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.altKey || event.metaKey || event.ctrlKey) return
            if (event.key === "ArrowRight") {
              event.preventDefault()
              if (!open) setOpen(true)
              else {
                const first = document
                  .getElementById(id)
                  ?.querySelector<HTMLButtonElement>("[data-cleanup-item]")
                first?.focus()
                first?.click()
              }
            } else if (event.key === "ArrowLeft") {
              event.preventDefault()
              setOpen(false)
            } else moveInspection(event)
          }}
          className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-md pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] focus-visible:ring-inset"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] leading-5 font-medium text-text-strong">
              {label}
            </span>
            <span className="block truncate text-[12px] leading-4 text-text-weak tabular-nums">
              {selected
                ? language.t("disk.ui.cleanup.groupCount", { count, selected })
                : count}
            </span>
          </span>
          <span className="w-20 shrink-0 text-right text-[13px] font-medium text-text-base tabular-nums">
            {formatBytes(group.bytes)}
          </span>
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-text-weaker transition-transform duration-150",
              open && "rotate-90"
            )}
            aria-hidden
          />
        </button>
      </div>
      <div id={id} hidden={!open}>
        {open ? (
          <>
            <ul className="relative ml-5 pl-1 before:absolute before:inset-y-1.5 before:left-0 before:w-px before:bg-[var(--dl-well-strong)]">
              {group.items.slice(0, limit).map((item) => (
                <ItemRow key={item.node.path} item={item} nested {...props} />
              ))}
            </ul>
            {group.items.length > limit ||
            Math.min(limit, group.items.length) > PREVIEW_ROWS ? (
              <div className="mt-0.5 mb-1 ml-[30px] flex items-center gap-1">
                {group.items.length > limit ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-text-weak"
                    onClick={() => setLimit((value) => value + 24)}
                  >
                    {language.t("disk.ui.cleanup.moreItems", {
                      count: Math.min(24, group.items.length - limit),
                    })}
                  </Button>
                ) : null}
                {Math.min(limit, group.items.length) > PREVIEW_ROWS ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-text-weak"
                    onClick={() => setLimit(PREVIEW_ROWS)}
                  >
                    {language.t("disk.ui.cleanup.showFewer")}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}

function moveInspection(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.altKey || event.metaKey || event.ctrlKey) return
  if (
    event.key === "ArrowLeft" &&
    event.currentTarget.hasAttribute("data-cleanup-item")
  ) {
    const group = event.currentTarget
      .closest("[data-cleanup-group]")
      ?.querySelector<HTMLButtonElement>("[data-cleanup-group-toggle]")
    if (group) {
      event.preventDefault()
      group.focus()
    }
    return
  }
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return
  const buttons = [
    ...event.currentTarget
      .closest("[data-cleanup-list]")!
      .querySelectorAll<HTMLButtonElement>("[data-cleanup-navigation]"),
  ]
  const index = buttons.indexOf(event.currentTarget)
  const next =
    event.key === "Home"
      ? buttons[0]
      : event.key === "End"
        ? buttons.at(-1)
        : buttons[index + (event.key === "ArrowDown" ? 1 : -1)]
  event.preventDefault()
  if (!next) return
  next.focus()
  if (next.hasAttribute("data-cleanup-item")) next.click()
}

function ItemRow(
  props: RowProps & {
    item: CleanupItem
    /** Lone items sit at category level, so they name their category. */
    category?: string
    nested?: boolean
  }
) {
  const language = useLanguage()
  const id = useId()
  const { item } = props
  const identity = itemIdentity(item.node)
  const collected = props.isCollected(item.node.path)
  const included = props.coveredBy(item.node.path)
  const active = props.activePath === item.node.path
  const location = props.locations.get(item.node.path) ?? item.node.path
  const restriction = props.restriction(item.node)
  const access = props.accessFor?.(item.node)
  const accessProblem =
    access?.state === "denied" ||
    access?.state === "read-only" ||
    access?.state === "unknown"
  useEffect(() => {
    props.onObserve?.(item.node)
  }, [item.node, props.onObserve])
  return (
    <li
      className={cn(
        "flex min-h-[52px] items-center gap-3 rounded-lg py-1",
        props.nested ? "pl-4" : "pl-3",
        active ? "bg-[var(--dl-well)]" : "hover:bg-[var(--dl-row-hover)]"
      )}
    >
      <CheckBox
        state={collected || included ? "on" : "off"}
        describedBy={id}
        label={language.t(
          collected ? "disk.explore.removeReview" : "disk.explore.selectReview",
          { name: identity.reviewTitle }
        )}
        disabled={(!props.canModify(item.node) && !collected) || !!included}
        onClick={() => {
          props.onInspect(item)
          props.onToggle(item.node)
        }}
      />
      <button
        type="button"
        data-cleanup-item
        data-cleanup-navigation
        aria-current={active ? "true" : undefined}
        aria-controls={props.inspectorId}
        aria-label={language.t("disk.ui.cleanup.inspect", {
          name: identity.reviewTitle,
        })}
        aria-describedby={`${id} ${props.listKeysId}`}
        onKeyDown={(event) => {
          // Space selects, as in Mail or Finder lists; Enter inspects.
          if (event.key === " " && !event.metaKey && !event.ctrlKey) {
            event.preventDefault()
            if ((collected || props.canModify(item.node)) && !included) {
              props.onInspect(item)
              props.onToggle(item.node)
            }
            return
          }
          moveInspection(event)
        }}
        onClick={() => props.onInspect(item)}
        className="flex h-full min-w-0 flex-1 items-center gap-3 rounded-md pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] focus-visible:ring-inset"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] leading-5 text-text-strong">
            {identity.title}
          </span>
          <span
            id={id}
            className="block truncate text-[12px] leading-4 text-text-weak"
            title={item.node.path}
          >
            {included
              ? language.t("disk.review.includedWith", { name: included })
              : props.category && props.category !== identity.title
                ? `${props.category} · ${location}`
                : location}
          </span>
          {/* Only problems earn a line; "not checked yet" on every row is
              noise. The inspector still shows the full access state. */}
          {restriction || accessProblem ? (
            <span className="block truncate text-[11px] leading-4 text-[var(--dl-warning)]">
              {restriction ?? language.t(ACCESS_LABEL[access!.state])}
            </span>
          ) : null}
          <span className="block truncate text-[11px] leading-4 text-text-weak min-[1000px]:hidden">
            {formatLastChanged(item.node.modifiedAt)}
          </span>
        </span>
        <span className="hidden w-28 shrink-0 truncate text-right text-[11px] text-text-weak min-[1000px]:block">
          {formatLastChanged(item.node.modifiedAt)}
        </span>
        {props.flagIncomplete && item.unobserved ? (
          <span
            className="shrink-0 rounded-full bg-[var(--dl-well)] px-2 py-0.5 text-[11px] text-text-weak"
            title={language.t("disk.ui.cleanup.reason.incomplete")}
          >
            {language.t("disk.ui.cleanup.partlyRead")}
          </span>
        ) : null}
        <span className="w-20 shrink-0 text-right text-[13px] text-text-strong tabular-nums">
          {formatBytes(item.bytes)}
        </span>
        <span className="w-3.5 shrink-0" aria-hidden />
      </button>
    </li>
  )
}

function ProtectedItems(props: RowProps & { items: CleanupItem[] }) {
  const language = useLanguage()
  const containsInspection = props.items.some(
    (item) => item.node.path === props.activePath
  )
  const [open, setOpen] = useState(containsInspection)
  const [limit, setLimit] = useState(PREVIEW_ROWS)
  useEffect(() => {
    if (containsInspection) setOpen(true)
  }, [containsInspection])
  return (
    <details
      className="group mt-2 border-t border-[var(--dl-separator)] pt-2"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex h-10 cursor-pointer list-none items-center gap-3 rounded-lg px-3 text-[13px] text-text-weak outline-none hover:bg-[var(--dl-row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] [&::-webkit-details-marker]:hidden">
        <Lock
          className="size-4 text-text-weaker"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="flex-1">
          {language.t("disk.ui.cleanup.unavailable")}
        </span>
        <span className="text-[12px] text-text-weaker tabular-nums">
          {props.items.length}
        </span>
        <ChevronRight
          className="size-3.5 text-text-weaker transition-transform duration-150 group-open:rotate-90"
          aria-hidden
        />
      </summary>
      <ul className="ml-5 pl-2">
        {open
          ? props.items
              .slice(0, limit)
              .map((item) => (
                <ItemRow key={item.node.path} {...props} item={item} />
              ))
          : null}
      </ul>
      {open && props.items.length > limit ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setLimit((value) => value + 24)}
        >
          {language.t("disk.ui.cleanup.moreItems", {
            count: Math.min(24, props.items.length - limit),
          })}
        </Button>
      ) : null}
    </details>
  )
}
