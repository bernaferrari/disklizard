import { useId } from "react"
import { SlidersHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useLanguage, type DiskLanguageKey } from "./runtime"
import {
  artifactEcosystemLabel,
  type ArtifactEcosystem,
  type ArtifactEcosystemFilter,
} from "./recognize"
import {
  DEVELOPER_CLEANUP_AGE_PRESETS,
  resolveDeveloperCleanupAge,
  developerCleanupAgeLabel,
  type DeveloperCleanupAgePreset,
} from "./developer-cleanup"

const AGE_LABEL = {
  all: "disk.developer.age.any",
  "30": "disk.developer.age.30",
  "60": "disk.developer.age.60",
  "90": "disk.developer.age.90",
  "180": "disk.developer.age.180",
  custom: "disk.developer.age.custom",
} as const satisfies Record<DeveloperCleanupAgePreset, DiskLanguageKey>

/** Shared look for the Clean up toolbar's search, menus, and filter trigger. */
export const cleanupToolbarControl =
  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--dl-separator)] px-3 text-[13px] whitespace-nowrap text-text-base outline-none transition-colors hover:border-[var(--dl-well-strong)] hover:bg-[var(--dl-well)] focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] data-[popup-open]:bg-[var(--dl-well)]"

/** One choice from a short list, shown as a row of chips so every option is
 * visible at once and operable as a radio group. */
function ChoiceChips<T extends string>(props: {
  labelledBy: string
  value: T
  options: readonly { value: T; label: string; disabled?: boolean }[]
  onChange: (value: T) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={props.labelledBy}
      className="flex flex-wrap gap-1.5"
    >
      {props.options.map((option) => {
        const checked = option.value === props.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={option.value}
            disabled={option.disabled}
            onClick={() => props.onChange(option.value)}
            className={cn(
              "h-7 rounded-full border px-3 text-[12px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] disabled:pointer-events-none disabled:opacity-40",
              checked
                ? "border-transparent bg-text-strong font-medium text-[var(--dl-popover)]"
                : "border-[var(--dl-separator)] text-text-base hover:bg-[var(--dl-well)] hover:text-text-strong"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** Filters are secondary to the list. Their current values stay visible on
 * the trigger, and every option is one click away inside the popover. */
export function CleanupFilters(props: {
  age: DeveloperCleanupAgePreset
  ecosystem: ArtifactEcosystemFilter
  ecosystems: readonly ArtifactEcosystem[]
  customDays?: string
  onCustomDays?: (days: string) => void
  onAge: (age: DeveloperCleanupAgePreset) => void
  onEcosystem: (ecosystem: ArtifactEcosystemFilter) => void
}) {
  const language = useLanguage()
  const id = useId()
  const active = Number(props.age !== "all") + Number(props.ecosystem !== "all")
  const filterValues = [
    props.ecosystem !== "all"
      ? artifactEcosystemLabel(props.ecosystem)
      : undefined,
    props.age !== "all"
      ? developerCleanupAgeLabel(
          resolveDeveloperCleanupAge(props.age, props.customDays ?? "30")
        )
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ")
  const inputStyle =
    "h-8 w-28 rounded-md border border-[var(--dl-separator)] bg-transparent px-2.5 text-[13px] text-text-strong tabular-nums outline-none focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          cleanupToolbarControl,
          "max-w-[min(420px,100%)]",
          active > 0 &&
            "border-[color-mix(in_oklab,var(--dl-accent)_45%,transparent)] bg-[color-mix(in_oklab,var(--dl-accent)_8%,transparent)]"
        )}
      >
        <SlidersHorizontal
          className="size-3.5 shrink-0 text-text-weak"
          aria-hidden
        />
        <span className={active > 0 ? "text-text-weak" : undefined}>
          {language.t("disk.ui.cleanup.filters")}
        </span>
        {active > 0 ? (
          <span className="truncate font-medium text-text-strong">
            {filterValues}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(380px,calc(100vw-32px))] gap-4 p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-medium">
            {language.t("disk.ui.cleanup.filters")}
          </p>
          {active > 0 ? (
            <button
              type="button"
              className="rounded px-1 py-1 text-[12px] text-text-weak outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
              onClick={() => {
                props.onAge("all")
                props.onEcosystem("all")
              }}
            >
              {language.t("disk.cleanup.clearFilters")}
            </button>
          ) : null}
        </div>
        <div className="space-y-2">
          <p id={`${id}-age`} className="text-[12px] text-text-weak">
            {language.t("disk.ui.cleanup.unchangedFor")}
          </p>
          <ChoiceChips
            labelledBy={`${id}-age`}
            value={props.age}
            onChange={props.onAge}
            options={DEVELOPER_CLEANUP_AGE_PRESETS.map((age) => ({
              value: age,
              label: language.t(AGE_LABEL[age]),
              disabled: age === "custom" && !props.onCustomDays,
            }))}
          />
        </div>
        {props.age === "custom" && props.onCustomDays ? (
          <div className="space-y-1.5">
            <label
              htmlFor={`${id}-days`}
              className="block text-[12px] text-text-weak"
            >
              {language.t("disk.developer.policy.customLabel")}
            </label>
            <input
              id={`${id}-days`}
              type="number"
              min={1}
              max={3650}
              step={1}
              value={props.customDays ?? "30"}
              onChange={(event) => props.onCustomDays?.(event.target.value)}
              className={inputStyle}
              aria-invalid={
                !resolveDeveloperCleanupAge("custom", props.customDays ?? "30")
                  .valid
              }
            />
            {!resolveDeveloperCleanupAge("custom", props.customDays ?? "30")
              .valid ? (
              <p role="alert" className="text-[12px] text-text-weak">
                {language.t("disk.developer.policy.invalidAge")}
              </p>
            ) : null}
          </div>
        ) : null}
        {props.ecosystems.length > 1 || props.ecosystem !== "all" ? (
          <div className="space-y-2">
            <p id={`${id}-ecosystem`} className="text-[12px] text-text-weak">
              {language.t("disk.ui.cleanup.ecosystem")}
            </p>
            <ChoiceChips
              labelledBy={`${id}-ecosystem`}
              value={props.ecosystem}
              onChange={props.onEcosystem}
              options={[
                {
                  value: "all",
                  label: language.t("disk.common.allEcosystems"),
                },
                ...props.ecosystems.map((ecosystem) => ({
                  value: ecosystem as ArtifactEcosystemFilter,
                  label: artifactEcosystemLabel(ecosystem),
                })),
              ]}
            />
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
