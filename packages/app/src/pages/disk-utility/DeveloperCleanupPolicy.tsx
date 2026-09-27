import { useState, type ReactNode } from "react"
import { DropdownMenu } from "@/components/dl/dropdown-menu"
import { Button } from "@/components/dl/button"
import { Icon } from "@/components/dl/icon"
import type { DeveloperArtifactInventory } from "@/core"
import { formatBytes } from "./format"
import {
  DEVELOPER_CLEANUP_AGE_PRESETS,
  developerCleanupAgeLabel,
  type DeveloperCleanupAge,
  type DeveloperCleanupAgePreset,
} from "./developer-cleanup"
import {
  artifactEcosystemLabel,
  type ArtifactEcosystem,
  type ArtifactEcosystemFilter,
} from "./recognize"
import {
  diskLanguagePlural,
  diskLanguageText,
  useLanguage,
  type DiskLanguageKey,
} from "./runtime"

const AGE_LABELS = {
  all: "disk.developer.age.any",
  "30": "disk.developer.age.30",
  "60": "disk.developer.age.60",
  "90": "disk.developer.age.90",
  "180": "disk.developer.age.180",
  custom: "disk.developer.age.custom",
} as const satisfies Record<DeveloperCleanupAgePreset, DiskLanguageKey>

type InventoryIssueRow = { label: string; count: number; paths: string[] }

export function developerInventoryCoverage(
  inventory: DeveloperArtifactInventory
): string {
  const { status } = inventory
  const observed = diskLanguageText("disk.developer.inventory.observed", {
    artifacts: diskLanguagePlural(
      "disk.count.artifact",
      status.matchedDirectories
    ),
    folders: diskLanguagePlural("disk.count.folder", status.scannedDirectories),
  })
  if (status.state === "complete")
    return diskLanguageText("disk.developer.inventory.complete", { observed })
  const skippedDirectoryCount = status.skippedDirectoryCount ?? 0
  const unavailableDirectoryIdentityCount =
    status.unavailableDirectoryIdentityCount ?? 0
  const gaps = [
    status.truncated
      ? diskLanguageText("disk.developer.inventory.capGap", {
          count: inventory.items.length.toLocaleString(),
          max: status.maxItems.toLocaleString(),
        })
      : undefined,
    status.unreadableCount
      ? diskLanguageText("disk.developer.inventory.unreadableGap", {
          count: status.unreadableCount.toLocaleString(),
        })
      : undefined,
    status.excludedCount
      ? diskLanguageText("disk.developer.inventory.excludedGap", {
          count: status.excludedCount.toLocaleString(),
        })
      : undefined,
    status.skippedSymlinkCount
      ? diskLanguagePlural(
          "disk.count.symlinkSkipped",
          status.skippedSymlinkCount
        )
      : undefined,
    skippedDirectoryCount
      ? diskLanguagePlural("disk.count.folderSkipped", skippedDirectoryCount)
      : undefined,
    unavailableDirectoryIdentityCount
      ? diskLanguagePlural(
          "disk.count.artifactRefresh",
          unavailableDirectoryIdentityCount
        )
      : undefined,
  ].filter((value): value is string => !!value)
  return diskLanguageText("disk.developer.inventory.partial", {
    observed,
    gaps: gaps.length
      ? ` · ${gaps.join(" · ")}`
      : diskLanguageText("disk.developer.inventory.incomplete"),
  })
}

export function developerInventoryIssueRows(
  inventory: DeveloperArtifactInventory
): InventoryIssueRow[] {
  const { status } = inventory
  return [
    {
      label: diskLanguageText("disk.developer.inventory.issueUnreadable"),
      count: status.unreadableCount,
      paths: status.unreadableSamplePaths,
    },
    {
      label: diskLanguageText("disk.developer.inventory.issueExcluded"),
      count: status.excludedCount,
      paths: status.excludedSamplePaths,
    },
    {
      label: diskLanguageText("disk.developer.inventory.issueSymlinks"),
      count: status.skippedSymlinkCount,
      paths: status.skippedSymlinkSamplePaths,
    },
    {
      label: diskLanguageText("disk.developer.inventory.issueFolders"),
      count: status.skippedDirectoryCount ?? 0,
      paths: status.skippedDirectorySamplePaths ?? [],
    },
    {
      label: diskLanguageText("disk.developer.inventory.issueRefresh"),
      count: status.unavailableDirectoryIdentityCount ?? 0,
      paths: status.unavailableDirectoryIdentitySamplePaths ?? [],
    },
  ].filter((issue) => issue.count > 0)
}

export function DeveloperCleanupPolicy(props: {
  categoryControl?: ReactNode
  expanded?: boolean
  preset: DeveloperCleanupAgePreset
  customDays: string
  age: DeveloperCleanupAge
  eligibleCount: number
  eligibleBytes: number
  excludedCount: number
  ecosystems: readonly ArtifactEcosystem[]
  ecosystem: ArtifactEcosystemFilter
  /** Root-only coverage from the opt-in deep artifact scan, if requested. */
  inventory?: DeveloperArtifactInventory
  unavailable?: boolean
  reviewReady?: boolean
  filtersActive?: boolean
  onPresetChange: (preset: DeveloperCleanupAgePreset) => void
  onCustomDaysChange: (days: string) => void
  onEcosystemChange: (ecosystem: ArtifactEcosystemFilter) => void
  onSelectEligible: () => void
  onClearFilters?: () => void
}) {
  const language = useLanguage()
  const inventory = props.inventory
  const inventoryCoverage = inventory
    ? developerInventoryCoverage(inventory)
    : undefined
  const inventoryIssueRows = inventory
    ? developerInventoryIssueRows(inventory)
    : []
  const status = (() => {
    if (props.unavailable) return language.t("disk.developer.policy.bulkWaits")
    if (!props.age.valid) return developerCleanupAgeLabel(props.age)
    if (props.eligibleCount === 0)
      return props.excludedCount > 0
        ? language.t("disk.developer.policy.noneEligible")
        : language.t("disk.developer.policy.noneMatch")
    const eligible = language.plural("disk.count.item", props.eligibleCount)
    const excluded =
      props.excludedCount > 0
        ? language.t("disk.developer.policy.excluded", {
            count: props.excludedCount,
          })
        : ""
    return language.t("disk.developer.policy.status", {
      eligible,
      size: formatBytes(props.eligibleBytes),
      excluded,
    })
  })()
  const hasEligibleResults =
    !props.unavailable && props.age.valid && props.eligibleCount > 0

  const content = (
    <section
      className="overflow-hidden rounded-2xl border border-border-weaker-base bg-surface-raised-base/60"
      aria-label={language.t("disk.developer.policy.heading")}
    >
      <div className="flex flex-wrap items-center justify-between gap-5 px-5 py-4 @min-[760px]:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-12-semibold text-text-weak">
            {language.t("disk.developer.policy.heading")}
          </p>
          {hasEligibleResults ? (
            <>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <strong className="text-[clamp(24px,2.6cqw,32px)] leading-none font-medium tracking-[-0.04em] text-text-strong tabular-nums">
                  {formatBytes(props.eligibleBytes)}
                </strong>
                <span className="text-13-regular text-text-weak tabular-nums">
                  {language.plural("disk.count.item", props.eligibleCount)}
                </span>
              </div>
            </>
          ) : null}
          <p
            className={
              hasEligibleResults
                ? "sr-only"
                : "text-13-regular mt-1.5 max-w-[72ch] leading-relaxed text-text-base"
            }
            role="status"
          >
            {status}
          </p>
        </div>
        {hasEligibleResults ? (
          <Button
            className="min-h-10 shrink-0"
            size="small"
            variant={props.reviewReady ? "secondary" : "primary"}
            onClick={props.onSelectEligible}
          >
            {language.t("disk.developer.policy.select")}
          </Button>
        ) : null}
      </div>

      <div
        className={`grid grid-cols-1 gap-3 border-t border-border-weaker-base px-5 py-4 @min-[560px]:grid-cols-2 @min-[760px]:px-6 ${props.categoryControl ? "@min-[900px]:grid-cols-3" : ""}`}
      >
        {props.categoryControl ? (
          <div className="min-w-0">
            <p className="mb-1.5 truncate text-xs text-text-weak">
              {language.t("disk.explore.developerCategories")}
            </p>
            {props.categoryControl}
          </div>
        ) : null}
        <div className="min-w-0">
          <PolicyChoice
            label={language.t("disk.developer.policy.minimum")}
            value={props.preset}
            options={DEVELOPER_CLEANUP_AGE_PRESETS.map((value) => ({
              value,
              label: language.t(AGE_LABELS[value]),
            }))}
            onChange={props.onPresetChange}
          />
          {props.preset === "custom" && (
            <label className="mt-2 flex items-center justify-between gap-4 text-xs text-text-weak">
              {language.t("disk.developer.policy.customLabel")}
              <input
                className="h-10 w-24 rounded-md border border-border-weaker-base bg-background-base px-3 text-right text-base text-text-strong tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
                type="number"
                min="1"
                max="3650"
                step="1"
                value={props.customDays}
                aria-invalid={!props.age.valid}
                onChange={(event) =>
                  props.onCustomDaysChange(event.currentTarget.value)
                }
              />
            </label>
          )}
        </div>
        {props.ecosystems.length > 0 && (
          <div className="min-w-0">
            <PolicyChoice
              label={language.t("disk.developer.policy.toolchain")}
              value={props.ecosystem}
              options={[
                {
                  value: "all" as const,
                  label: language.t("disk.common.allEcosystems"),
                },
                ...props.ecosystems.map((value) => ({
                  value,
                  label: artifactEcosystemLabel(value),
                })),
              ]}
              onChange={props.onEcosystemChange}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-1 border-t border-border-weaker-base px-5 py-2 @min-[760px]:px-6">
        <details className="group min-w-0">
          <summary className="flex min-h-8 w-fit cursor-pointer list-none items-center gap-2 text-xs text-text-weak outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
            {language.t("disk.developer.policy.explanation")}
            <Icon
              name="chevron-down"
              className="size-3 group-open:rotate-180"
            />
          </summary>
          <div className="max-w-[70ch] space-y-2 pb-2 text-xs leading-relaxed text-text-weak">
            <p>{language.t("disk.developer.policy.body")}</p>
            <p>{language.t("disk.developer.sizeExplanation")}</p>
            <p>{language.t("disk.developer.operationSizeNote")}</p>
            <p>{language.t("disk.developer.meanings")}</p>
          </div>
        </details>
        {inventory && (
          <details className="group min-w-0">
            <summary className="flex min-h-8 w-fit cursor-pointer list-none items-center gap-2 text-xs text-text-weak outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
              {language.t("disk.developer.policy.coverageDetails")}
              <Icon
                name="chevron-down"
                className="size-3 group-open:rotate-180"
              />
            </summary>
            <div className="space-y-3 pb-2 text-xs leading-relaxed text-text-weak">
              <p>{inventoryCoverage}</p>
              {inventoryIssueRows.map((issue) => (
                <div key={issue.label}>
                  <p className="font-medium">
                    {issue.label} · {issue.count.toLocaleString()}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {issue.paths.slice(0, 3).map((path) => (
                      <li
                        key={path}
                        className="truncate text-text-weaker"
                        title={path}
                      >
                        {path}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        )}
        {props.onClearFilters && props.filtersActive ? (
          <Button
            size="small"
            variant="ghost"
            className="min-h-8 shrink-0 @min-[900px]:ml-auto"
            onClick={props.onClearFilters}
          >
            {language.t("disk.cleanup.clearFilters")}
          </Button>
        ) : null}
      </div>
    </section>
  )
  if (props.expanded) return content
  return (
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer items-center text-xs text-text-weak">
        {language.t("disk.developer.policy.heading")}
      </summary>
      {content}
    </details>
  )
}

function PolicyChoice<T extends string>(props: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="truncate text-xs text-text-weak" title={props.label}>
        {props.label}
      </span>
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
        placement="bottom-end"
        gutter={4}
      >
        <DropdownMenu.Trigger
          as={Button}
          variant="secondary"
          size="small"
          aria-label={props.label}
          className="h-10 w-full min-w-0 justify-between gap-2 rounded-lg border-transparent bg-background-base px-3 text-text-strong ring-1 ring-border-weaker-base hover:bg-surface-raised-base"
        >
          <span className="truncate">
            {
              props.options.find((option) => option.value === props.value)
                ?.label
            }
          </span>
          <Icon name="chevron-down" className="size-3 shrink-0" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.RadioGroup
              value={props.value}
              onChange={(value) => {
                const option = props.options.find(
                  (option) => option.value === value
                )
                if (option) {
                  props.onChange(option.value)
                  setOpen(false)
                }
              }}
            >
              {props.options.map((option) => (
                <DropdownMenu.RadioItem key={option.value} value={option.value}>
                  <DropdownMenu.ItemLabel>
                    {option.label}
                  </DropdownMenu.ItemLabel>
                  <DropdownMenu.ItemIndicator>
                    <Icon name="check" />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  )
}
