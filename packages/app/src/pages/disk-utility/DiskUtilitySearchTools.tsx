import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { For, Show } from "solid-js"
import {
  diskEntrySortDirection,
  diskEntrySortKey,
  type DiskEntrySortDirection,
  type DiskEntrySortKey,
} from "./entry-view"
import { useLanguage } from "./runtime"

/** Search stays reachable while the inspector's optional filters scroll. */
export function DiskUtilitySearchTools(props: {
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
    <div class="dl-inspector-tools flex shrink-0 items-center gap-2 border-b border-border-weaker-base px-4 py-2">
      <div class="dl-inspector-search flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg px-3 focus-within:ring-2 focus-within:ring-text-weak">
        <Icon name="magnifying-glass" class="size-4 shrink-0 text-icon-weak" />
        <label class="sr-only" for="disklizard-scan-search">
          {props.label}
        </label>
        <input
          id="disklizard-scan-search"
          type="search"
          autocomplete="off"
          spellcheck={false}
          placeholder={props.placeholder}
          value={props.query}
          onInput={(event) => props.onQuery(event.currentTarget.value)}
          class="dl-search-input h-full min-w-0 flex-1 bg-transparent text-13-regular text-text-strong placeholder:text-text-weaker outline-none"
        />
        <Show when={props.query}>
          <button
            type="button"
            class="dl-touch-target grid shrink-0 place-items-center rounded-md text-text-weak focus-visible:ring-2 focus-visible:ring-text-weak"
            aria-label={language.t("disk.search.clear")}
            onClick={() => props.onQuery("")}
          >
            <Icon name="close-small" class="size-4" />
          </button>
        </Show>
      </div>
      <Show when={props.showSort}>
        <DropdownMenu placement="bottom-end" gutter={6}>
          <DropdownMenu.Trigger
            as={Button}
            variant="ghost"
            size="small"
            class="dl-touch-target"
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
                  <For each={["size", "name", "modified", "type"] as const}>
                    {(key) => (
                      <DropdownMenu.RadioItem value={key}>
                        <DropdownMenu.ItemLabel>{language.t(`disk.sort.key.${key}`)}</DropdownMenu.ItemLabel>
                        <DropdownMenu.ItemIndicator>
                          <Icon name="check" />
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.RadioItem>
                    )}
                  </For>
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Group>
              <DropdownMenu.Separator />
              <DropdownMenu.RadioGroup
                aria-label={language.t("disk.sort.direction.label")}
                value={props.sortDirection}
                onChange={(direction) => props.onSort(props.sortKey, diskEntrySortDirection(String(direction)))}
              >
                <For each={["descending", "ascending"] as const}>
                  {(direction) => (
                    <DropdownMenu.RadioItem value={direction}>
                      <DropdownMenu.ItemLabel>{language.t(`disk.sort.direction.${direction}`)}</DropdownMenu.ItemLabel>
                      <DropdownMenu.ItemIndicator>
                        <Icon name="check" />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  )}
                </For>
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </Show>
    </div>
  )
}
