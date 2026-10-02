import { useId } from "react"
import { SlidersHorizontal } from "lucide-react"
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

/** Filters are secondary to the list. Their current values stay visible in
 * one labeled popover, with native keyboard-operated selects. */
export function CleanupFilters(props: {
  age: DeveloperCleanupAgePreset
  ecosystem: ArtifactEcosystemFilter
  ecosystems: readonly ArtifactEcosystem[]
  onAge: (age: DeveloperCleanupAgePreset) => void
  onEcosystem: (ecosystem: ArtifactEcosystemFilter) => void
}) {
  const language = useLanguage()
  const id = useId()
  const active = Number(props.age !== "all") + Number(props.ecosystem !== "all")
  const selectStyle =
    "h-8 w-full rounded-md bg-[var(--dl-well)] px-2 text-[13px] text-text-strong outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
  return (
    <Popover>
      <PopoverTrigger className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] text-text-weak outline-none hover:bg-[var(--dl-well)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)] data-[popup-open]:bg-[var(--dl-well)]">
        <SlidersHorizontal className="size-3.5" aria-hidden />
        {language.t("disk.ui.cleanup.filters")}
        {active > 0 ? (
          <span className="grid size-4 place-items-center rounded bg-[var(--dl-well-strong)] text-[11px] text-text-strong tabular-nums">
            {active}
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="gap-4 p-4">
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
        <div className="space-y-1.5">
          <label
            htmlFor={`${id}-age`}
            className="block text-[12px] text-text-weak"
          >
            {language.t("disk.ui.cleanup.unchangedFor")}
          </label>
          <select
            id={`${id}-age`}
            className={selectStyle}
            value={props.age}
            onChange={(event) => {
              const age = DEVELOPER_CLEANUP_AGE_PRESETS.find(
                (candidate) => candidate === event.target.value
              )
              if (age) props.onAge(age)
            }}
          >
            {DEVELOPER_CLEANUP_AGE_PRESETS.filter(
              (age) => age !== "custom" || props.age === "custom"
            ).map((age) => (
              <option key={age} value={age} disabled={age === "custom"}>
                {language.t(AGE_LABEL[age])}
              </option>
            ))}
          </select>
        </div>
        {props.ecosystems.length > 1 || props.ecosystem !== "all" ? (
          <div className="space-y-1.5">
            <label
              htmlFor={`${id}-ecosystem`}
              className="block text-[12px] text-text-weak"
            >
              {language.t("disk.ui.cleanup.ecosystem")}
            </label>
            <select
              id={`${id}-ecosystem`}
              className={selectStyle}
              value={props.ecosystem}
              onChange={(event) => {
                const ecosystem = (["all", ...props.ecosystems] as const).find(
                  (candidate) => candidate === event.target.value
                )
                if (ecosystem) props.onEcosystem(ecosystem)
              }}
            >
              <option value="all">
                {language.t("disk.common.allEcosystems")}
              </option>
              {props.ecosystems.map((ecosystem) => (
                <option key={ecosystem} value={ecosystem}>
                  {artifactEcosystemLabel(ecosystem)}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
