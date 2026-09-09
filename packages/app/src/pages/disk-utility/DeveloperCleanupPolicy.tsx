import { useState } from "react"
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

  const content = <div className="space-y-4">
    <PolicyChoice label={language.t("disk.developer.policy.minimum")} value={props.preset}
      options={DEVELOPER_CLEANUP_AGE_PRESETS.map(value => ({value, label: language.t(AGE_LABELS[value])}))}
      onChange={props.onPresetChange} />
    {props.preset === "custom" && <label className="flex items-center justify-between gap-4 text-xs text-text-weak">
      {language.t("disk.developer.policy.customLabel")}
      <input className="h-10 w-24 rounded-md border border-border-weaker-base bg-background-base px-3 text-right tabular-nums text-text-strong outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
        type="number" min="1" max="3650" step="1" value={props.customDays} aria-invalid={!props.age.valid}
        onChange={event => props.onCustomDaysChange(event.currentTarget.value)} />
    </label>}
    {props.ecosystems.length > 0 && <PolicyChoice label={language.t("disk.developer.policy.toolchain")}
      value={props.ecosystem} options={[{value: "all" as const, label: language.t("disk.common.allEcosystems")},
        ...props.ecosystems.map(value => ({value, label: artifactEcosystemLabel(value)}))]}
      onChange={props.onEcosystemChange} />}

    <div className="border-t border-border-weaker-base pt-3">
      <p className="mb-3 text-xs leading-relaxed text-text-weak" role="status">{status}</p>
      <Button className="h-10 w-full" size="small" variant="secondary"
        disabled={props.unavailable || !props.age.valid || props.eligibleCount === 0}
        onClick={props.onSelectEligible}>{language.t("disk.developer.policy.select")}</Button>
    </div>

    <details className="group border-t border-border-weaker-base pt-1">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between text-xs text-text-weak outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
        {language.t("disk.developer.policy.explanation")}<Icon name="chevron-down" className="size-3 group-open:rotate-180" />
      </summary>
      <div className="space-y-2 pb-2 text-xs leading-relaxed text-text-weak">
        <p>{language.t("disk.developer.policy.body")}</p>
        <p>{language.t("disk.developer.sizeExplanation")}</p>
        <p>{language.t("disk.developer.meanings")}</p>
      </div>
    </details>
    {inventory && <details className="group">
      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between text-xs text-text-weak outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
        {language.t("disk.developer.policy.coverageDetails")}<Icon name="chevron-down" className="size-3 group-open:rotate-180" />
      </summary>
      <div className="space-y-3 pb-2 text-xs leading-relaxed text-text-weak">
        <p>{inventoryCoverage}</p>
        {inventoryIssueRows.filter(issue => issue.count > 0).map(issue => <div key={issue.label}>
          <p className="font-medium">{issue.label} · {issue.count.toLocaleString()}</p>
          <ul className="mt-1 space-y-1">{issue.paths.slice(0, 3).map(path => <li key={path} className="truncate text-text-weaker" title={path}>{path}</li>)}</ul>
        </div>)}
      </div>
    </details>}
  </div>
  if (props.expanded) return content
  return <details className="group">
    <summary className="flex min-h-11 cursor-pointer items-center text-xs text-text-weak">{language.t("disk.developer.policy.heading")}</summary>
    {content}
  </details>
}

function PolicyChoice<T extends string>(props: {label: string; value: T; options: {value: T; label: string}[]; onChange: (value: T) => void}) {
  const [open, setOpen] = useState(false)
  return <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-center gap-3">
    <span className="text-xs text-text-weak">{props.label}</span>
    <DropdownMenu open={open} onOpenChange={setOpen} placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger as={Button} variant="secondary" size="small" aria-label={props.label} className="h-10 min-w-0 justify-between gap-2 rounded-md px-3">
        <span className="truncate">{props.options.find(option => option.value === props.value)?.label}</span>
        <Icon name="chevron-down" className="size-3 shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content>
        <DropdownMenu.RadioGroup value={props.value} onChange={value => {
          const option = props.options.find(option => option.value === value)
          if (option) { props.onChange(option.value); setOpen(false) }
        }}>
          {props.options.map(option => <DropdownMenu.RadioItem key={option.value} value={option.value}>
            <DropdownMenu.ItemLabel>{option.label}</DropdownMenu.ItemLabel>
            <DropdownMenu.ItemIndicator><Icon name="check" /></DropdownMenu.ItemIndicator>
          </DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu>
  </div>
}
