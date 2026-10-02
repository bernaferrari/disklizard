import { useId, useMemo, useState, type KeyboardEvent } from "react"
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Info,
  Lock,
  Sparkles,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CleanupFilters } from "./CleanupFilters"
import { CleanupInspector } from "./CleanupInspector"
import { formatBytes } from "./format"
import { useLanguage } from "./runtime"
import type { DiskScanNode } from "./types"
import type { ArtifactEcosystem, ArtifactEcosystemFilter } from "./recognize"
import { itemIdentity } from "./item-identity"
import type { DeveloperCleanupAgePreset } from "./developer-cleanup"
import type { BaselineChange } from "./scan-baseline"
import { primaryButton, quietButton } from "./ExplorerChrome"
import {
  partitionCleanupGroups,
  type CleanupSummary,
  type CleanupItem,
  type CleanupGroup,
} from "./cleanup-summary"

const PREVIEW_ROWS = 4
export function CleanupView(props: {
  summary: CleanupSummary
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
  const { ready, review } = useMemo(
    () => partitionCleanupGroups(props.summary),
    [props.summary]
  )
  const groups = useMemo(() => [...ready, ...review], [ready, review])
  const [inspectedPath, setInspectedPath] = useState<string>()
  const activeGroup =
    groups.find((group) =>
      group.items.some((item) => item.node.path === inspectedPath)
    ) ?? groups[0]
  const active =
    activeGroup?.items.find((item) => item.node.path === inspectedPath) ??
    activeGroup?.items[0]
  const allSafeSelected =
    props.summary.safe.length > 0 &&
    props.summary.safe.every(
      (item) =>
        props.isCollected(item.node.path) || !!props.coveredBy(item.node.path)
    )
  const selectedElsewhere =
    props.collectionCount >
    groups.reduce(
      (sum, group) =>
        sum +
        group.items.filter((item) => props.isCollected(item.node.path)).length,
      0
    )
  const filtered = props.agePreset !== "all" || props.ecosystem !== "all"
  const empty = props.summary.count === 0
  const rows = {
    isCollected: props.isCollected,
    coveredBy: props.coveredBy,
    canModify: props.canModify,
    onToggle: props.onToggle,
    activePath: active?.node.path,
    inspectorId,
    listKeysId,
    onInspect: (item: CleanupItem) => setInspectedPath(item.node.path),
  }
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-[1180px] flex-1 flex-col px-6 pt-6 max-[760px]:px-4 max-[760px]:pt-4">
      <header className="flex shrink-0 items-start justify-between gap-4 pb-5">
        <div>
          <h1 className="text-[24px] leading-8 font-medium tracking-[-0.03em] text-text-strong">
            {language.t("disk.ui.cleanup.title")}
          </h1>
          <div className="mt-1 flex items-center gap-1 text-[12px] text-text-weak tabular-nums">
            {language.t("disk.ui.cleanup.summary", {
              size: formatBytes(props.summary.bytes),
              count: language.plural("disk.count.item", props.summary.count),
            })}
            <Popover>
              <PopoverTrigger
                className="grid size-7 place-items-center rounded-md text-text-weaker outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
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
        {!empty || filtered ? (
          <CleanupFilters
            age={props.agePreset}
            ecosystem={props.ecosystem}
            ecosystems={props.ecosystems}
            onAge={props.onAgePreset}
            onEcosystem={props.onEcosystem}
          />
        ) : null}
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden border-t border-[var(--dl-separator)] max-[760px]:flex-col">
        <div
          data-cleanup-list
          role="region"
          aria-label={language.t("disk.ui.cleanup.list")}
          className="min-h-0 min-w-0 flex-1 [scrollbar-width:thin] overflow-y-auto pt-4 pr-5 pb-6 max-[760px]:pr-0"
        >
          <p id={listKeysId} className="sr-only">
            {language.t("disk.ui.cleanup.listKeys")}
          </p>
          {empty ? (
            <div className="grid min-h-[260px] place-content-center px-4 text-center">
              <Sparkles
                className="mx-auto size-6 text-text-weaker"
                aria-hidden
              />
              <p className="mt-3 text-[15px] font-medium text-text-strong">
                {language.t(
                  filtered
                    ? "disk.ui.cleanup.filteredTitle"
                    : "disk.ui.cleanup.emptyTitle"
                )}
              </p>
              {filtered ? (
                <button
                  type="button"
                  className={cn(quietButton, "mx-auto mt-3")}
                  onClick={() => {
                    props.onAgePreset("all")
                    props.onEcosystem("all")
                  }}
                >
                  {language.t("disk.cleanup.clearFilters")}
                </button>
              ) : (
                <p className="mt-2 max-w-sm text-[13px] leading-5 text-text-weak">
                  {language.t("disk.ui.cleanup.emptyBody")}
                </p>
              )}
            </div>
          ) : null}
          {ready.length > 0 ? (
            <Section
              title={language.t("disk.ui.cleanup.ready")}
              action={
                <button
                  type="button"
                  className={quietButton}
                  disabled={allSafeSelected}
                  onClick={() =>
                    props.onCollect(props.summary.safe.map((item) => item.node))
                  }
                >
                  {language.t(
                    allSafeSelected
                      ? "disk.ui.cleanup.selectedAll"
                      : "disk.ui.cleanup.selectReady"
                  )}
                </button>
              }
            >
              {ready.map((group) => (
                <GroupRow key={group.key} group={group} {...rows} />
              ))}
            </Section>
          ) : null}
          {review.length > 0 ? (
            <Section title={language.t("disk.ui.cleanup.individual")}>
              {review.map((group) => (
                <GroupRow key={group.key} group={group} {...rows} />
              ))}
            </Section>
          ) : null}
          {props.summary.locked.length > 0 ? (
            <ProtectedItems
              items={props.summary.locked}
              restriction={props.restriction}
            />
          ) : null}
        </div>
        {active ? (
          <CleanupInspector
            id={inspectorId}
            item={active}
            category={language.t(activeGroup.labelKey)}
            collected={props.isCollected(active.node.path)}
            coveredBy={props.coveredBy(active.node.path)}
            restriction={
              props.canModify(active.node)
                ? undefined
                : props.restriction(active.node)
            }
            selectionCount={props.collectionCount}
            change={props.changeFor?.(active.node.path)}
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
      {props.collectionCount > 0 ? (
        <div className="flex h-16 shrink-0 items-center gap-3 border-t border-[var(--dl-separator)]">
          <p
            className="min-w-0 flex-1 text-[13px] leading-5 tabular-nums"
            role="status"
            aria-live="polite"
          >
            <span className="font-medium text-text-strong">
              {language.t("disk.ui.cleanup.footerSelected", {
                size: formatBytes(props.collectionBytes),
              })}
            </span>
            <span className="text-text-weak">
              {" "}
              · {language.plural("disk.count.item", props.collectionCount)}
            </span>
            {selectedElsewhere ? (
              <span className="block truncate text-[12px] text-text-weak">
                {language.t("disk.ui.cleanup.selectedElsewhere")}
              </span>
            ) : null}
          </p>
          <button type="button" className={quietButton} onClick={props.onClear}>
            {language.t("disk.ui.collectorClear")}
          </button>
          <button
            type="button"
            className={primaryButton}
            onClick={props.onReview}
          >
            {language.t("disk.ui.cleanup.review")}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function Section(props: {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-label={props.title} className="mb-5">
      {props.title ? (
        <div className="mb-2 flex min-h-8 items-center justify-between gap-3 px-3">
          <h2 className="text-[12px] font-medium text-text-weak">
            {props.title}
          </h2>
          {props.action}
        </div>
      ) : null}
      {props.children}
    </section>
  )
}

type RowProps = {
  activePath?: string
  inspectorId: string
  listKeysId: string
  isCollected: (path: string) => boolean
  coveredBy: (path: string) => string | undefined
  canModify: (node: DiskScanNode) => boolean
  onToggle: (node: DiskScanNode) => void
  onInspect: (item: CleanupItem) => void
}

function GroupRow(props: RowProps & { group: CleanupGroup }) {
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
        <ItemRow {...props} item={group.items[0]} />
      </ul>
    )
  const selected = group.items.filter((item) =>
    props.isCollected(item.node.path)
  ).length
  const containsInspection = group.items.some(
    (item) => item.node.path === props.activePath
  )
  const FolderIcon = open ? FolderOpen : Folder
  const DisclosureIcon = open ? ChevronDown : ChevronRight
  const count = language.plural("disk.count.item", group.items.length)
  return (
    <div data-cleanup-group>
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
        className={cn(
          "flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]",
          !open && containsInspection
            ? "bg-[var(--dl-well-strong)]"
            : "hover:bg-[var(--dl-row-hover)]"
        )}
      >
        <FolderIcon
          className="size-4 shrink-0 text-text-weak"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] leading-5 font-medium text-text-strong">
            {language.t(group.labelKey)}
          </span>
          <span className="block truncate text-[12px] leading-4 text-text-weak tabular-nums">
            {selected
              ? language.t("disk.ui.cleanup.groupCount", { count, selected })
              : count}
          </span>
        </span>
        <span className="w-20 shrink-0 text-right text-[13px] text-text-base tabular-nums">
          {formatBytes(group.bytes)}
        </span>
        <DisclosureIcon
          className="size-3.5 shrink-0 text-text-weaker"
          aria-hidden
        />
      </button>
      <div id={id} hidden={!open}>
        {open ? (
          <>
            <ul className="ml-5 border-l border-[var(--dl-separator)] pl-2">
              {group.items.slice(0, limit).map((item) => (
                <ItemRow key={item.node.path} item={item} {...props} />
              ))}
            </ul>
            <div className="mt-1 ml-8 flex items-center gap-1">
              {group.items.length > limit ? (
                <button
                  type="button"
                  className={quietButton}
                  onClick={() => setLimit((value) => value + 24)}
                >
                  {language.t("disk.ui.cleanup.moreItems", {
                    count: Math.min(24, group.items.length - limit),
                  })}
                </button>
              ) : null}
              {Math.min(limit, group.items.length) > PREVIEW_ROWS ? (
                <button
                  type="button"
                  className={quietButton}
                  onClick={() => setLimit(PREVIEW_ROWS)}
                >
                  {language.t("disk.ui.cleanup.showFewer")}
                </button>
              ) : null}
            </div>
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

function ItemRow(props: RowProps & { item: CleanupItem }) {
  const language = useLanguage()
  const id = useId()
  const { item } = props
  const identity = itemIdentity(item.node)
  const collected = props.isCollected(item.node.path)
  const included = props.coveredBy(item.node.path)
  const active = props.activePath === item.node.path
  const location = item.node.path.replace(/^\/Users\/[^/]+/, "~")
  return (
    <li
      className={cn(
        "flex h-[52px] items-center gap-3 rounded-lg pl-3",
        active ? "bg-[var(--dl-well-strong)]" : "hover:bg-[var(--dl-row-hover)]"
      )}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={collected || !!included}
        aria-describedby={id}
        aria-label={language.t(
          collected ? "disk.explore.removeReview" : "disk.explore.selectReview",
          { name: identity.reviewTitle }
        )}
        disabled={!props.canModify(item.node) || !!included}
        onClick={() => {
          props.onInspect(item)
          props.onToggle(item.node)
        }}
        className={cn(
          "relative grid size-4 shrink-0 place-items-center rounded-[4px] outline-none before:absolute before:-inset-2 focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background-base)] disabled:opacity-35",
          collected || included
            ? "bg-[var(--dl-accent)] text-white"
            : "shadow-[inset_0_0_0_1.5px_var(--text-weaker)] hover:shadow-[inset_0_0_0_1.5px_var(--text-weak)]"
        )}
      >
        {collected || included ? (
          <Check className="size-2.5" strokeWidth={3} aria-hidden />
        ) : null}
      </button>
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
        onKeyDown={moveInspection}
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
              : location}
          </span>
        </span>
        <span className="w-20 shrink-0 text-right text-[13px] text-text-base tabular-nums">
          {formatBytes(item.bytes)}
        </span>
        <span className="w-3.5 shrink-0" aria-hidden />
      </button>
    </li>
  )
}

function ProtectedItems(props: {
  items: CleanupItem[]
  restriction: (node: DiskScanNode) => string | undefined
}) {
  const language = useLanguage()
  return (
    <details className="group mt-5 border-t border-[var(--dl-separator)] pt-3">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-[12px] text-text-weak outline-none hover:bg-[var(--dl-row-hover)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] [&::-webkit-details-marker]:hidden">
        <Lock className="size-3.5" aria-hidden />
        <span className="flex-1">
          {language.t("disk.ui.cleanup.protected")}
        </span>
        <span className="tabular-nums">{props.items.length}</span>
        <ChevronRight className="size-3.5 group-open:rotate-90" aria-hidden />
      </summary>
      <ul>
        {props.items.map((item) => (
          <li
            key={item.node.path}
            className="flex min-h-11 items-center gap-3 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-text-base">
                {itemIdentity(item.node).reviewTitle}
              </p>
              <p
                className="truncate text-[12px] text-text-weak"
                title={item.node.path}
              >
                {props.restriction(item.node) ?? item.node.path}
              </p>
            </div>
            <span className="text-[12px] text-text-weak tabular-nums">
              {formatBytes(item.bytes)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
