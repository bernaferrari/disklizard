import { Button } from "@/components/dl/button"
import { DropdownMenu } from "@/components/dl/dropdown-menu"
import { Icon } from "@/components/dl/icon"
import {
  diskEntrySortDirection,
  diskEntrySortKey,
  type DiskEntrySortDirection,
  type DiskEntrySortKey,
} from "./entry-view"
import { useLanguage } from "./runtime"

/** Search stays reachable while the inspector's optional filters scroll. */
export function DiskUtilitySearchTools(props: {
  compact?: boolean
  developer?: boolean
  grouped?: "none" | "category" | "project"
  onGroup?: (value: "none" | "category" | "project") => void
  query: string
  label: string
  placeholder: string
  sortKey: DiskEntrySortKey
  sortDirection: DiskEntrySortDirection
  showSort: boolean
  onQuery: (value: string) => void
  onSort: (key: DiskEntrySortKey, direction: DiskEntrySortDirection) => void
}) {
  const language = useLanguage()
  return (
    <div
      className={`flex shrink-0 items-center gap-2 px-4 ${props.compact ? "pb-1.5" : "pt-1 pb-3"}`}
    >
      <div
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-[7px] bg-background-base px-3 shadow-[inset_0_0_0_1px_var(--border-weaker-base)] focus-within:ring-2 focus-within:ring-text-weak ${props.compact ? "h-8" : "h-11"}`}
      >
        <Icon
          name="magnifying-glass"
          className="text-icon-weak size-4 shrink-0"
        />
        <label className="sr-only" htmlFor="disklizard-scan-search">
          {props.label}
        </label>
        <input
          id="disklizard-scan-search"
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={props.placeholder}
          value={props.query}
          onChange={(event) => props.onQuery(event.currentTarget.value)}
          className="dl-search-input h-full min-w-0 flex-1 bg-transparent text-base text-text-strong outline-none placeholder:text-text-weaker sm:text-[13px]"
        />
        {props.query ? (
          <button
            type="button"
            className={`grid shrink-0 place-items-center rounded-md text-text-weak focus-visible:ring-2 focus-visible:ring-text-weak ${props.compact ? "min-h-8 min-w-8" : "min-h-11 min-w-11"}`}
            aria-label={language.t("disk.search.clear")}
            onClick={() => props.onQuery("")}
          >
            <Icon name="close-small" className="size-4" />
          </button>
        ) : null}
      </div>
      {props.showSort ? (
        <DropdownMenu placement="bottom-end" gutter={6}>
          <DropdownMenu.Trigger
            as={Button}
            variant="ghost"
            size="small"
            className={
              props.compact
                ? "min-h-8 min-w-8 gap-2"
                : "min-h-11 min-w-11 gap-2"
            }
            icon="sliders"
            aria-label={language.t("disk.sort.group")}
            title={`${language.t(`disk.sort.key.${props.sortKey}`)} · ${language.t(`disk.sort.direction.${props.sortDirection}`)}`}
          >
            <span className="text-12-medium hidden text-text-weak @min-[420px]:inline">
              {props.sortKey === "size"
                ? language.t(
                    props.sortDirection === "descending"
                      ? "disk.sort.largestFirst"
                      : "disk.sort.smallestFirst"
                  )
                : language.t(`disk.sort.key.${props.sortKey}`)}
            </span>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Group>
                <DropdownMenu.GroupLabel>
                  {language.t("disk.sort.key.label")}
                </DropdownMenu.GroupLabel>
                <DropdownMenu.RadioGroup
                  value={props.sortKey}
                  onChange={(key) =>
                    props.onSort(diskEntrySortKey(key), props.sortDirection)
                  }
                >
                  {(
                    [
                      "size",
                      "name",
                      "modified",
                      "type",
                      ...(props.developer ? ["category" as const] : []),
                    ] as const
                  ).map((key) => (
                    <DropdownMenu.RadioItem key={key} value={key}>
                      <DropdownMenu.ItemLabel>
                        {language.t(`disk.sort.key.${key}`)}
                      </DropdownMenu.ItemLabel>
                      <DropdownMenu.ItemIndicator>
                        <Icon name="check" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Group>
              {props.developer && (
                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel>
                    {language.t("disk.developer.groupLabel")}
                  </DropdownMenu.GroupLabel>
                  <DropdownMenu.RadioGroup
                    value={props.grouped ?? "none"}
                    onChange={(value) =>
                      props.onGroup?.(value as "none" | "category" | "project")
                    }
                  >
                    {(["none", "category", "project"] as const).map((value) => (
                      <DropdownMenu.RadioItem key={value} value={value}>
                        <DropdownMenu.ItemLabel>
                          {language.t(`disk.developer.group.${value}`)}
                        </DropdownMenu.ItemLabel>
                        <DropdownMenu.ItemIndicator>
                          <Icon name="check" />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    ))}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Group>
              )}
              <DropdownMenu.Separator />
              <DropdownMenu.RadioGroup
                aria-label={language.t("disk.sort.direction.label")}
                value={props.sortDirection}
                onChange={(direction) =>
                  props.onSort(props.sortKey, diskEntrySortDirection(direction))
                }
              >
                {(["descending", "ascending"] as const).map((direction) => (
                  <DropdownMenu.RadioItem key={direction} value={direction}>
                    <DropdownMenu.ItemLabel>
                      {language.t(`disk.sort.direction.${direction}`)}
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
      ) : null}
    </div>
  )
}
