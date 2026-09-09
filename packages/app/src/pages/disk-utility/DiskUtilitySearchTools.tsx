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
  developer?: boolean
  grouped?: boolean
  onGroup?: (value: boolean) => void
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
    <div className="flex shrink-0 items-center gap-2 px-4 pb-3 pt-1">
      <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[7px] bg-background-base px-3 shadow-[inset_0_0_0_1px_var(--border-weaker-base)] focus-within:ring-2 focus-within:ring-text-weak">
        <Icon name="magnifying-glass" className="size-4 shrink-0 text-icon-weak" />
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
          className="dl-search-input h-full min-w-0 flex-1 bg-transparent text-13-regular text-text-strong placeholder:text-text-weaker outline-none"
        />
        {props.query ? (
          <button
            type="button"
            className="min-h-9 min-w-9 grid shrink-0 place-items-center rounded-md text-text-weak focus-visible:ring-2 focus-visible:ring-text-weak"
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
            className="min-h-9 min-w-9"
            icon="sliders"
            aria-label={language.t("disk.sort.group")}
            title={`${language.t(`disk.sort.key.${props.sortKey}`)} · ${language.t(`disk.sort.direction.${props.sortDirection}`)}`}
          />
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <DropdownMenu.Group>
                <DropdownMenu.GroupLabel>{language.t("disk.sort.key.label")}</DropdownMenu.GroupLabel>
                <DropdownMenu.RadioGroup
                  value={props.sortKey}
                  onChange={(key) => props.onSort(diskEntrySortKey(String(key)), props.sortDirection)}
                >
                  {(["size", "name", "modified", "type", ...(props.developer ? ["category" as const] : [])] as const).map((key) => (
                    <DropdownMenu.RadioItem key={key} value={key}>
                      <DropdownMenu.ItemLabel>{language.t(`disk.sort.key.${key}`)}</DropdownMenu.ItemLabel>
                      <DropdownMenu.ItemIndicator>
                        <Icon name="check" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Group>
              {props.developer && <DropdownMenu.Item onSelect={() => props.onGroup?.(!props.grouped)}>
                <DropdownMenu.ItemLabel>{language.t("disk.developer.group")}</DropdownMenu.ItemLabel>
                {props.grouped && <Icon name="check" />}
              </DropdownMenu.Item>}
              <DropdownMenu.Separator />
              <DropdownMenu.RadioGroup
                aria-label={language.t("disk.sort.direction.label")}
                value={props.sortDirection}
                onChange={(direction) => props.onSort(props.sortKey, diskEntrySortDirection(String(direction)))}
              >
                {(["descending", "ascending"] as const).map((direction) => (
                  <DropdownMenu.RadioItem key={direction} value={direction}>
                    <DropdownMenu.ItemLabel>{language.t(`disk.sort.direction.${direction}`)}</DropdownMenu.ItemLabel>
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
