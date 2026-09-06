import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import type { DeveloperArtifactInventory } from "@disklizard/core"
import { For, Show } from "solid-js"
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
  const inventoryCoverage = () => (props.inventory ? developerInventoryCoverage(props.inventory) : undefined)
  const inventoryIssueRows = () => (props.inventory ? developerInventoryIssueRows(props.inventory) : [])

  const status = () => {
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
  }

  return (
    <section
      class="mt-3 rounded-xl border border-border-weaker-base bg-surface-raised-base/35 px-3 py-3"
      aria-labelledby="developer-cleanup-policy-title"
    >
      <div class="dl-touch-target flex min-h-11 items-center gap-2 rounded-lg">
        <span
          class="grid size-7 shrink-0 place-items-center rounded-lg bg-[oklch(0.74_0.13_252/0.12)] text-text-weak"
          aria-hidden="true"
        >
          <Icon name="shield" class="size-3.5" />
        </span>
        <span class="min-w-0 flex-1">
          <span id="developer-cleanup-policy-title" class="block text-13-semibold text-text-strong">
            {language.t("disk.developer.policy.heading")}
          </span>
          <span
            id="developer-cleanup-policy-status"
            class="mt-0.5 block truncate text-13-regular text-text-weak"
            aria-live="polite"
          >
            {status()}
          </span>
        </span>
      </div>

      <div>
          <fieldset class="mt-3" aria-describedby="developer-cleanup-policy-status">
            <legend class="sr-only">{language.t("disk.developer.policy.minimum")}</legend>
            <div
              class="flex max-w-full gap-1.5 overflow-x-auto pb-0.5"
              role="group"
              aria-label={language.t("disk.developer.policy.minimum")}
            >
              <For each={DEVELOPER_CLEANUP_AGE_PRESETS}>
                {(preset) => (
                  <button
                    type="button"
                    class="dl-touch-target shrink-0 rounded-full px-3 py-2 text-13-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]"
                    classList={{
                      "bg-[oklch(0.74_0.13_252/0.12)] text-text-strong shadow-[inset_0_0_0_1px_oklch(0.74_0.13_252/0.28)]":
                        props.preset === preset,
                      "dl-hover-text bg-background-base/45 text-text-weak": props.preset !== preset,
                    }}
                    aria-pressed={props.preset === preset}
                    onClick={() => props.onPresetChange(preset)}
                  >
                    {language.t(AGE_LABELS[preset])}
                  </button>
                )}
              </For>
            </div>
          </fieldset>

          <Show when={props.ecosystems.length > 0}>
            <fieldset class="mt-3" aria-describedby="developer-cleanup-policy-status">
              <legend class="text-13-semibold text-text-weak">{language.t("disk.developer.policy.toolchain")}</legend>
              <div
                class="mt-1.5 flex max-w-full gap-1.5 overflow-x-auto pb-0.5"
                role="group"
                aria-label={language.t("disk.developer.policy.toolchainLabel")}
              >
                <button
                  type="button"
                  class="dl-touch-target shrink-0 rounded-full px-3 py-2 text-13-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]"
                  classList={{
                    "bg-[oklch(0.74_0.13_252/0.12)] text-text-strong shadow-[inset_0_0_0_1px_oklch(0.74_0.13_252/0.28)]":
                      props.ecosystem === "all",
                    "dl-hover-text bg-background-base/45 text-text-weak": props.ecosystem !== "all",
                  }}
                  aria-pressed={props.ecosystem === "all"}
                  onClick={() => props.onEcosystemChange("all")}
                >
                  {language.t("disk.common.allEcosystems")}
                </button>
                <For each={props.ecosystems}>
                  {(ecosystem) => (
                    <button
                      type="button"
                      class="dl-touch-target shrink-0 rounded-full px-3 py-2 text-13-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]"
                      classList={{
                        "bg-[oklch(0.74_0.13_252/0.12)] text-text-strong shadow-[inset_0_0_0_1px_oklch(0.74_0.13_252/0.28)]":
                          props.ecosystem === ecosystem,
                        "dl-hover-text bg-background-base/45 text-text-weak": props.ecosystem !== ecosystem,
                      }}
                      aria-pressed={props.ecosystem === ecosystem}
                      onClick={() => props.onEcosystemChange(ecosystem)}
                    >
                      {artifactEcosystemLabel(ecosystem)}
                    </button>
                  )}
                </For>
              </div>
            </fieldset>
          </Show>

          <Show when={props.preset === "custom"}>
            <label class="mt-3 flex min-h-11 items-center gap-2 rounded-[10px] bg-background-base/65 px-3 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.14)] focus-within:shadow-[inset_0_0_0_1px_rgb(127_127_127/0.34),0_0_0_3px_rgb(127_127_127/0.08)]">
              <span class="shrink-0 text-13-semibold text-text-weak">
                {language.t("disk.developer.policy.customPrefix")}
              </span>
              <input
                class="dl-smart-age-input min-w-0 flex-1 bg-transparent text-right text-12-regular tabular-nums text-text-strong outline-none"
                type="number"
                min="1"
                max="3650"
                step="1"
                inputmode="numeric"
                value={props.customDays}
                aria-invalid={!props.age.valid}
                aria-label={language.t("disk.developer.policy.customLabel")}
                onInput={(event) => props.onCustomDaysChange(event.currentTarget.value)}
              />
              <span class="shrink-0 text-13-regular text-text-weak">{language.t("disk.common.days")}</span>
            </label>
          </Show>

          <Show when={props.inventory}>
            {(inventory) => (
              <div
                class="mt-3 rounded-[10px] bg-background-base/45 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.12)]"
                role="status"
                aria-live="polite"
                aria-label={language.t("disk.developer.policy.inventoryLabel", { coverage: inventoryCoverage() ?? "" })}
              >
                <div class="flex min-w-0 items-start gap-2">
                  <Icon
                    name={inventory().status.state === "complete" ? "circle-check" : "warning"}
                    class="mt-0.5 size-3.5 shrink-0 text-text-weak"
                    aria-hidden="true"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="text-13-semibold text-text-strong">
                      {language.t("disk.developer.policy.inventoryHeading", {
                        state:
                          inventory().status.state === "complete"
                            ? language.t("disk.common.complete")
                            : language.t("disk.common.partial"),
                      })}
                    </p>
                    <p class="mt-0.5 text-13-regular leading-relaxed text-text-weak">{inventoryCoverage()}</p>
                  </div>
                </div>
                <Show when={inventory().status.state === "partial"}>
                  <details class="group mt-2">
                    <summary class="dl-touch-target flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-13-semibold text-text-weak outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
                      <span class="flex-1">{language.t("disk.developer.policy.coverageDetails")}</span>
                      <Icon
                        name="chevron-down"
                        class="size-3 transition-transform duration-150 group-open:rotate-180"
                      />
                    </summary>
                    <div class="border-t border-border-weaker-base/60 pb-1 pt-2">
                      <Show when={inventory().status.truncated}>
                        <p class="text-13-regular leading-relaxed text-text-weak">
                          {language.t("disk.developer.policy.cap", {
                            count: inventory().status.maxItems.toLocaleString(),
                          })}
                        </p>
                      </Show>
                      <For each={inventoryIssueRows()}>
                        {(issue) => (
                          <div class="mt-2">
                            <p class="text-13-semibold text-text-weak">
                              {issue.label} · {issue.count.toLocaleString()}
                            </p>
                            <Show when={issue.paths.length > 0}>
                              <ul
                                class="mt-1 space-y-0.5"
                                aria-label={language.t("disk.developer.policy.samplePaths", { label: issue.label })}
                              >
                                <For each={issue.paths.slice(0, 3)}>
                                  {(path) => (
                                    <li class="truncate text-13-mono text-text-weaker" title={path}>
                                      {path}
                                    </li>
                                  )}
                                </For>
                              </ul>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </details>
                </Show>
              </div>
            )}
          </Show>
      </div>

      <details class="group mt-3">
        <summary class="dl-touch-target flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-13-semibold text-text-weak outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
          <span class="flex-1">{language.t("disk.developer.policy.explanation")}</span>
          <Icon
            name="chevron-down"
            class="size-3 transition-transform duration-150 group-open:rotate-180"
          />
        </summary>
        <div class="pt-1">
          <p class="max-w-[58ch] text-13-regular leading-relaxed text-text-weak">
            {language.t("disk.developer.policy.body")}
          </p>
        </div>
      </details>

      <div class="mt-3 flex justify-end">
        <Button
          class="dl-touch-target shrink-0"
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
    </section>
  )
}
