import { cn } from "@/lib/utils"
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
import { artifactEcosystemLabel, type ArtifactEcosystem, type ArtifactEcosystemFilter } from "./recognize"
import { diskLanguagePlural, diskLanguageText, useLanguage, type DiskLanguageKey } from "./runtime"

const AGE_LABELS = {
  all: "disk.developer.age.any",
  "30": "disk.developer.age.30",
  "60": "disk.developer.age.60",
  "90": "disk.developer.age.90",
  "180": "disk.developer.age.180",
  custom: "disk.developer.age.custom",
} as const satisfies Record<DeveloperCleanupAgePreset, DiskLanguageKey>

type InventoryIssueRow = { label: string; count: number; paths: string[] }

export function developerInventoryCoverage(inventory: DeveloperArtifactInventory): string {
  const { status } = inventory
  const observed = diskLanguageText("disk.developer.inventory.observed", {
    artifacts: diskLanguagePlural("disk.count.artifact", status.matchedDirectories),
    folders: diskLanguagePlural("disk.count.folder", status.scannedDirectories),
  })
  if (status.state === "complete") return diskLanguageText("disk.developer.inventory.complete", { observed })
  const skippedDirectoryCount = status.skippedDirectoryCount ?? 0
  const unavailableDirectoryIdentityCount = status.unavailableDirectoryIdentityCount ?? 0
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
      ? diskLanguageText("disk.developer.inventory.excludedGap", { count: status.excludedCount.toLocaleString() })
      : undefined,
    status.skippedSymlinkCount
      ? diskLanguagePlural("disk.count.symlinkSkipped", status.skippedSymlinkCount)
      : undefined,
    skippedDirectoryCount ? diskLanguagePlural("disk.count.folderSkipped", skippedDirectoryCount) : undefined,
    unavailableDirectoryIdentityCount
      ? diskLanguagePlural("disk.count.artifactRefresh", unavailableDirectoryIdentityCount)
      : undefined,
  ].filter((value): value is string => !!value)
  return diskLanguageText("disk.developer.inventory.partial", {
    observed,
    gaps: gaps.length ? ` · ${gaps.join(" · ")}` : diskLanguageText("disk.developer.inventory.incomplete"),
  })
}

export function developerInventoryIssueRows(inventory: DeveloperArtifactInventory): InventoryIssueRow[] {
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
  onPresetChange: (preset: DeveloperCleanupAgePreset) => void
  onCustomDaysChange: (days: string) => void
  onEcosystemChange: (ecosystem: ArtifactEcosystemFilter) => void
  onSelectEligible: () => void
}) {
  const language = useLanguage()
  const inventory = props.inventory
  const inventoryCoverage = inventory ? developerInventoryCoverage(inventory) : undefined
  const inventoryIssueRows = inventory ? developerInventoryIssueRows(inventory) : []
  const status = (() => {
    if (props.unavailable) return language.t("disk.developer.policy.bulkWaits")
    if (!props.age.valid) return developerCleanupAgeLabel(props.age)
    if (props.eligibleCount === 0)
      return props.excludedCount > 0
        ? language.t("disk.developer.policy.noneEligible")
        : language.t("disk.developer.policy.noneMatch")
    const eligible = language.plural("disk.count.item", props.eligibleCount)
    const excluded =
      props.excludedCount > 0 ? language.t("disk.developer.policy.excluded", { count: props.excludedCount }) : ""
    return language.t("disk.developer.policy.status", {
      eligible,
      size: formatBytes(props.eligibleBytes),
      excluded,
    })
  })()

  return (
    <details
      className="group mt-3 rounded-lg border border-border-weaker-base bg-transparent px-2.5 py-2"
      aria-labelledby="developer-cleanup-policy-title"
    >
      <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg bg-[oklch(0.74_0.13_252/0.12)] text-text-weak"
          aria-hidden="true"
        >
          <Icon name="shield" className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span id="developer-cleanup-policy-title" className="block text-13-semibold text-text-strong">
            {language.t("disk.developer.policy.heading")}
          </span>
          <span
            id="developer-cleanup-policy-status"
            className="mt-0.5 block truncate text-13-regular text-text-weak"
            aria-live="polite"
          >
            {status}
          </span>
        </span>
        <Icon name="chevron-down" className="size-3 shrink-0 text-icon-weak group-open:rotate-180" />
      </summary>

      <div>
        <fieldset className="mt-3" aria-describedby="developer-cleanup-policy-status">
          <legend className="sr-only">{language.t("disk.developer.policy.minimum")}</legend>
          <div
            className="flex max-w-full gap-1.5 overflow-x-auto pb-0.5"
            role="group"
            aria-label={language.t("disk.developer.policy.minimum")}
          >
            {DEVELOPER_CLEANUP_AGE_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset}
                className={cn(
                  "min-h-11 min-w-11 shrink-0 rounded-full px-3 py-2 text-13-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]",
                  props.preset === preset
                    ? "bg-[oklch(0.74_0.13_252/0.12)] text-text-strong shadow-[inset_0_0_0_1px_oklch(0.74_0.13_252/0.28)]"
                    : "hover:text-text-strong bg-background-base/45 text-text-weak",
                )}
                aria-pressed={props.preset === preset}
                onClick={() => props.onPresetChange(preset)}
              >
                {language.t(AGE_LABELS[preset])}
              </button>
            ))}
          </div>
        </fieldset>

        {props.ecosystems.length > 0 ? (
          <fieldset className="mt-3" aria-describedby="developer-cleanup-policy-status">
            <legend className="text-13-semibold text-text-weak">{language.t("disk.developer.policy.toolchain")}</legend>
            <div
              className="mt-1.5 flex max-w-full gap-1.5 overflow-x-auto pb-0.5"
              role="group"
              aria-label={language.t("disk.developer.policy.toolchainLabel")}
            >
              <button
                type="button"
                className={cn(
                  "min-h-11 min-w-11 shrink-0 rounded-full px-3 py-2 text-13-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]",
                  props.ecosystem === "all"
                    ? "bg-[oklch(0.74_0.13_252/0.12)] text-text-strong shadow-[inset_0_0_0_1px_oklch(0.74_0.13_252/0.28)]"
                    : "hover:text-text-strong bg-background-base/45 text-text-weak",
                )}
                aria-pressed={props.ecosystem === "all"}
                onClick={() => props.onEcosystemChange("all")}
              >
                {language.t("disk.common.allEcosystems")}
              </button>
              {props.ecosystems.map((ecosystem) => (
                <button
                  type="button"
                  key={ecosystem}
                  className={cn(
                    "min-h-11 min-w-11 shrink-0 rounded-full px-3 py-2 text-13-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]",
                    props.ecosystem === ecosystem
                      ? "bg-[oklch(0.74_0.13_252/0.12)] text-text-strong shadow-[inset_0_0_0_1px_oklch(0.74_0.13_252/0.28)]"
                      : "hover:text-text-strong bg-background-base/45 text-text-weak",
                  )}
                  aria-pressed={props.ecosystem === ecosystem}
                  onClick={() => props.onEcosystemChange(ecosystem)}
                >
                  {artifactEcosystemLabel(ecosystem)}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}

        {props.preset === "custom" ? (
          <label className="mt-3 flex min-h-11 items-center gap-2 rounded-[10px] bg-background-base/65 px-3 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.14)] focus-within:shadow-[inset_0_0_0_1px_rgb(127_127_127/0.34),0_0_0_3px_rgb(127_127_127/0.08)]">
            <span className="shrink-0 text-13-semibold text-text-weak">
              {language.t("disk.developer.policy.customPrefix")}
            </span>
            <input
              className="dl-smart-age-input min-w-0 flex-1 bg-transparent text-right text-12-regular tabular-nums text-text-strong outline-none"
              type="number"
              min="1"
              max="3650"
              step="1"
              value={props.customDays}
              aria-invalid={!props.age.valid}
              aria-label={language.t("disk.developer.policy.customLabel")}
              inputMode="numeric"
              onChange={(event) => props.onCustomDaysChange(event.currentTarget.value)}
            />
            <span className="shrink-0 text-13-regular text-text-weak">{language.t("disk.common.days")}</span>
          </label>
        ) : null}

        {inventory ? (
          <div
            className="mt-3 rounded-[10px] bg-background-base/45 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.12)]"
            role="status"
            aria-live="polite"
            aria-label={language.t("disk.developer.policy.inventoryLabel", { coverage: inventoryCoverage ?? "" })}
          >
            <div className="flex min-w-0 items-start gap-2">
              <Icon
                name={inventory.status.state === "complete" ? "circle-check" : "warning"}
                className="mt-0.5 size-3.5 shrink-0 text-text-weak"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-13-semibold text-text-strong">
                  {language.t("disk.developer.policy.inventoryHeading", {
                    state:
                      inventory.status.state === "complete"
                        ? language.t("disk.common.complete")
                        : language.t("disk.common.partial"),
                  })}
                </p>
                <p className="mt-0.5 text-13-regular leading-relaxed text-text-weak">{inventoryCoverage}</p>
              </div>
            </div>
            {inventory.status.state === "partial" ? (
              <details className="group mt-2">
                <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-13-semibold text-text-weak outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
                  <span className="flex-1">{language.t("disk.developer.policy.coverageDetails")}</span>
                  <Icon name="chevron-down" className="size-3 transition-transform duration-150 group-open:rotate-180" />
                </summary>
                <div className="border-t border-border-weaker-base/60 pb-1 pt-2">
                  {inventory.status.truncated ? (
                    <p className="text-13-regular leading-relaxed text-text-weak">
                      {language.t("disk.developer.policy.cap", {
                        count: inventory.status.maxItems.toLocaleString(),
                      })}
                    </p>
                  ) : null}
                  {inventoryIssueRows.map((issue) => (
                    <div className="mt-2" key={issue.label}>
                      <p className="text-13-semibold text-text-weak">
                        {issue.label} · {issue.count.toLocaleString()}
                      </p>
                      {issue.paths.length > 0 ? (
                        <ul
                          className="mt-1 space-y-0.5"
                          aria-label={language.t("disk.developer.policy.samplePaths", { label: issue.label })}
                        >
                          {issue.paths.slice(0, 3).map((path) => (
                            <li className="truncate text-13-mono text-text-weaker" title={path} key={path}>
                              {path}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>

      <details className="group mt-3">
        <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-13-semibold text-text-weak outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
          <span className="flex-1">{language.t("disk.developer.policy.explanation")}</span>
          <Icon name="chevron-down" className="size-3 transition-transform duration-150 group-open:rotate-180" />
        </summary>
        <div className="pt-1">
          <p className="max-w-[58ch] text-13-regular leading-relaxed text-text-weak">
            {language.t("disk.developer.policy.body")}
          </p>
        </div>
      </details>

      <div className="mt-3 flex justify-end">
        <Button
          className="min-h-11 min-w-11 shrink-0"
          size="small"
          variant="secondary"
          icon="checklist"
          disabled={props.unavailable || !props.age.valid || props.eligibleCount === 0}
          title={
            props.unavailable
              ? language.t("disk.developer.policy.requiresVerified")
              : !props.age.valid
                ? developerCleanupAgeLabel(props.age)
                : undefined
          }
          onClick={props.onSelectEligible}
        >
          {language.t("disk.developer.policy.select")}
        </Button>
      </div>
    </details>
  )
}
