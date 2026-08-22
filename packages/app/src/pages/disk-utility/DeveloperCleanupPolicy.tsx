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

const AGE_LABELS: Record<DeveloperCleanupAgePreset, string> = {
  all: "Any age",
  "30": "30d+",
  "60": "60d+",
  "90": "90d+",
  "180": "180d+",
  custom: "Custom",
}

type InventoryIssueRow = { label: string; count: number; paths: string[] }

export function developerInventoryCoverage(inventory: DeveloperArtifactInventory): string {
  const { status } = inventory
  const observed = `${status.matchedDirectories.toLocaleString()} ${status.matchedDirectories === 1 ? "artifact" : "artifacts"} found across ${status.scannedDirectories.toLocaleString()} ${status.scannedDirectories === 1 ? "folder" : "folders"}`
  if (status.state === "complete") return `Complete · ${observed}`
  const skippedDirectoryCount = status.skippedDirectoryCount ?? 0
  const unavailableDirectoryIdentityCount = status.unavailableDirectoryIdentityCount ?? 0
  const gaps = [
    status.truncated ? `kept ${inventory.items.length.toLocaleString()} at the ${status.maxItems.toLocaleString()}-item cap` : undefined,
    status.unreadableCount ? `${status.unreadableCount.toLocaleString()} unreadable` : undefined,
    status.excludedCount ? `${status.excludedCount.toLocaleString()} excluded` : undefined,
    status.skippedSymlinkCount ? `${status.skippedSymlinkCount.toLocaleString()} symlink${status.skippedSymlinkCount === 1 ? "" : "s"} skipped` : undefined,
    skippedDirectoryCount
      ? `${skippedDirectoryCount.toLocaleString()} folder${skippedDirectoryCount === 1 ? "" : "s"} skipped (other device, cycle, or unavailable identity)`
      : undefined,
    unavailableDirectoryIdentityCount
      ? `${unavailableDirectoryIdentityCount.toLocaleString()} retained artifact${unavailableDirectoryIdentityCount === 1 ? " needs" : "s need"} a fresh scan before Trash`
      : undefined,
  ].filter((value): value is string => !!value)
  return `Partial · ${observed}${gaps.length ? ` · ${gaps.join(" · ")}` : " · scanner reported an incomplete scope"}`
}

export function developerInventoryIssueRows(inventory: DeveloperArtifactInventory): InventoryIssueRow[] {
  const { status } = inventory
  return [
    {
      label: "Unreadable folders",
      count: status.unreadableCount,
      paths: status.unreadableSamplePaths,
    },
    {
      label: "Excluded folders",
      count: status.excludedCount,
      paths: status.excludedSamplePaths,
    },
    {
      label: "Skipped symlinks",
      count: status.skippedSymlinkCount,
      paths: status.skippedSymlinkSamplePaths,
    },
    {
      label: "Skipped folders (other device, cycle, or unavailable identity)",
      count: status.skippedDirectoryCount ?? 0,
      paths: status.skippedDirectorySamplePaths ?? [],
    },
    {
      label: "Retained artifacts needing a fresh scan before Trash",
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
  const inventoryCoverage = () => (props.inventory ? developerInventoryCoverage(props.inventory) : undefined)
  const inventoryIssueRows = () => (props.inventory ? developerInventoryIssueRows(props.inventory) : [])

  const status = () => {
    if (props.unavailable) return "Bulk selection waits for a verified storage map."
    if (!props.age.valid) return developerCleanupAgeLabel(props.age)
    if (props.eligibleCount === 0)
      return props.excludedCount > 0
        ? "No automatically eligible results in this policy. Other artifacts remain inspectable."
        : "No developer artifacts match this policy."
    const eligible = `${props.eligibleCount} ${props.eligibleCount === 1 ? "item" : "items"} · ${formatBytes(props.eligibleBytes)}`
    const excluded = props.excludedCount > 0 ? ` · ${props.excludedCount} not auto-selected` : ""
    return `${eligible}${excluded} · modified time is not last-used time`
  }

  return (
    <section
      class="mt-3 rounded-xl border border-border-weaker-base bg-surface-raised-base/35 px-3 py-3"
      aria-labelledby="developer-cleanup-policy-title"
    >
      <div class="flex min-w-0 items-start gap-2">
        <span class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-[oklch(0.74_0.13_252/0.12)] text-text-weak" aria-hidden="true">
          <Icon name="shield" class="size-3.5" />
        </span>
        <div class="min-w-0 flex-1">
          <p id="developer-cleanup-policy-title" class="text-13-semibold text-text-strong">
            Smart cleanup policy
          </p>
          <p class="mt-0.5 max-w-[58ch] text-13-regular leading-relaxed text-text-weak">
            Find rebuildable or redownloadable developer storage by modification date. This is not evidence that a folder
            was last used then.
          </p>
        </div>
      </div>

      <fieldset class="mt-3" aria-describedby="developer-cleanup-policy-status">
        <legend class="sr-only">Minimum unchanged time</legend>
        <div class="flex max-w-full gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Minimum unchanged time">
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
                {AGE_LABELS[preset]}
              </button>
            )}
          </For>
        </div>
      </fieldset>

      <Show when={props.ecosystems.length > 0}>
        <fieldset class="mt-3" aria-describedby="developer-cleanup-policy-status">
          <legend class="text-13-semibold text-text-weak">Language &amp; toolchain</legend>
          <div class="mt-1.5 flex max-w-full gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Language and toolchain">
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
              All ecosystems
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
          <span class="shrink-0 text-13-semibold text-text-weak">Unchanged for at least</span>
          <input
            class="dl-smart-age-input min-w-0 flex-1 bg-transparent text-right text-12-regular tabular-nums text-text-strong outline-none"
            type="number"
            min="1"
            max="3650"
            step="1"
            inputmode="numeric"
            value={props.customDays}
            aria-invalid={!props.age.valid}
            aria-label="Custom unchanged time in days"
            onInput={(event) => props.onCustomDaysChange(event.currentTarget.value)}
          />
          <span class="shrink-0 text-13-regular text-text-weak">days</span>
        </label>
      </Show>

      <Show when={props.inventory}>
        {(inventory) => (
          <div
            class="mt-3 rounded-[10px] bg-background-base/45 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.12)]"
            role="status"
            aria-live="polite"
            aria-label={`Deep developer artifact inventory. ${inventoryCoverage()}`}
          >
            <div class="flex min-w-0 items-start gap-2">
              <Icon
                name={inventory().status.state === "complete" ? "circle-check" : "warning"}
                class="mt-0.5 size-3.5 shrink-0 text-text-weak"
                aria-hidden="true"
              />
              <div class="min-w-0 flex-1">
                <p class="text-13-semibold text-text-strong">
                  Deep artifact inventory · {inventory().status.state === "complete" ? "Complete" : "Partial"}
                </p>
                <p class="mt-0.5 text-13-regular leading-relaxed text-text-weak">{inventoryCoverage()}</p>
              </div>
            </div>
            <Show when={inventory().status.state === "partial"}>
              <details class="group mt-2">
                <summary class="dl-touch-target flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-13-semibold text-text-weak outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
                  <span class="flex-1">Coverage details</span>
                  <Icon name="chevron-down" class="size-3 transition-transform duration-150 group-open:rotate-180" />
                </summary>
                <div class="border-t border-border-weaker-base/60 pb-1 pt-2">
                  <Show when={inventory().status.truncated}>
                    <p class="text-13-regular leading-relaxed text-text-weak">
                      Results are capped at {inventory().status.maxItems.toLocaleString()} retained items. Matching continues for
                      coverage accounting, but paths beyond the cap are not listed.
                    </p>
                  </Show>
                  <For each={inventoryIssueRows()}>
                    {(issue) => (
                      <div class="mt-2">
                        <p class="text-13-semibold text-text-weak">
                          {issue.label} · {issue.count.toLocaleString()}
                        </p>
                        <Show when={issue.paths.length > 0}>
                          <ul class="mt-1 space-y-0.5" aria-label={`${issue.label} sampled paths`}>
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

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <p id="developer-cleanup-policy-status" class="min-w-0 flex-1 text-13-regular leading-relaxed text-text-weak" aria-live="polite">
          {status()}
        </p>
        <Button
          class="dl-touch-target shrink-0"
          size="small"
          variant="secondary"
          icon="checklist"
          disabled={props.unavailable || !props.age.valid || props.eligibleCount === 0}
          title={
            props.unavailable
              ? "A verified storage map is required before bulk selection."
              : !props.age.valid
                ? developerCleanupAgeLabel(props.age)
                : undefined
          }
          onClick={props.onSelectEligible}
        >
          Select eligible for review
        </Button>
      </div>
    </section>
  )
}
