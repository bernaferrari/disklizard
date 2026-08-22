import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"
import type { DiskScanNode } from "./types"
import { StorageAccountingFacts } from "./StorageAccounting"
import { formatBytes, formatPct } from "./format"
import { developerArtifactContext, recognize } from "./recognize"
import { SAFETY_ACCENT } from "./ui-tokens"

/** Detail / action bar pinned under the scan results. */
export function DetailBar(props: {
  node: DiskScanNode
  parentSize: number
  deletable: boolean
  collected: boolean
  trashName: string
  onPreview?: () => void
  onQuickLook?: () => void
  onReveal: () => void
  onOpen?: () => void
  onCollect: () => void
  onTrash: () => void
}) {
  const rec = () => recognize(props.node)
  const developerContext = () => (rec().developer ? developerArtifactContext(props.node, rec()) : undefined)
  return (
    <div class="flex min-h-16 min-w-0 flex-wrap items-center justify-between gap-3 px-2">
      <div class="flex min-w-0 items-center gap-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-full bg-surface-raised-base text-text-weak">
          <Icon name={props.node.isHidden ? "shield" : props.node.isDir ? "folder" : "code-lines"} class="size-4" />
        </span>
        <div class="min-w-0">
          <div class="flex min-w-0 items-baseline gap-2">
            <span class="truncate text-13-semibold tracking-[-0.015em] text-text-strong">{props.node.name}</span>
            <span class="shrink-0 text-12-semibold tabular-nums text-text-strong">{formatBytes(props.node.size)}</span>
            <span class="shrink-0 text-13-regular tabular-nums text-text-weak">
              {formatPct(props.node.size, props.parentSize)}
            </span>
            <Show when={rec().tag}>
              <span
                class={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-13-semibold uppercase tracking-[0.08em] ring-1 ring-inset lg:inline ${SAFETY_ACCENT[rec().safety].pill}`}
              >
                {rec().tag}
              </span>
            </Show>
          </div>
          <p class="mt-1 max-w-[76ch] truncate text-13-regular text-text-weak" title={props.node.path}>
            <Show when={developerContext()}>
              {(context) => (
                <>
                  {context().scope} · <span class="text-13-semibold text-text-strong">{context().disposition}</span>
                  <span aria-hidden="true"> · </span>
                </>
              )}
            </Show>
            <span class="font-mono">{props.node.path}</span>
          </p>
          <StorageAccountingFacts node={props.node} class="mt-1" />
        </div>
      </div>
      <div class="hidden shrink-0 items-center gap-1.5 md:flex">
        <Show when={!props.node.isOther}>
          <Show when={props.onQuickLook}>
            <Button class="dl-touch-target" size="small" variant="ghost" icon="eye" onClick={props.onQuickLook}>
              Quick Look
            </Button>
          </Show>
          <Show when={props.onPreview}>
            <Button class="dl-touch-target" size="small" variant="ghost" icon="eye" onClick={props.onPreview}>
              Preview
            </Button>
          </Show>
          <Show when={props.node.isDir && props.onOpen}>
            <Button class="dl-touch-target" size="small" variant="ghost" icon="enter" onClick={props.onOpen}>
              Open
            </Button>
          </Show>
          <Button
            class="dl-touch-target"
            size="small"
            variant="ghost"
            icon="square-arrow-top-right"
            onClick={props.onReveal}
          >
            Reveal
          </Button>
        </Show>
        <Show when={props.deletable}>
          <Button class="dl-touch-target" size="small" variant="ghost" icon="trash" onClick={props.onTrash}>
            {props.trashName}
          </Button>
          <Button
            class="dl-touch-target"
            size="small"
            variant={props.collected ? "secondary" : "primary"}
            icon={props.collected ? "circle-check" : "plus-small"}
            aria-pressed={props.collected}
            onClick={props.onCollect}
          >
            {props.collected ? "Selected for review" : "Select for review"}
          </Button>
        </Show>
      </div>
      <div class="flex shrink-0 items-center gap-1.5 md:hidden">
        <Show when={props.deletable}>
          <Button
            class="dl-touch-target"
            size="small"
            variant={props.collected ? "secondary" : "primary"}
            icon={props.collected ? "circle-check" : "plus-small"}
            aria-pressed={props.collected}
            onClick={props.onCollect}
          >
            {props.collected ? "Selected" : "Review"}
          </Button>
        </Show>
        <DropdownMenu placement="top-end" gutter={6}>
          <DropdownMenu.Trigger
            as={Button}
            class="dl-touch-target"
            size="small"
            variant="secondary"
            icon="dot-grid"
            aria-label={`More actions for ${props.node.name}`}
          >
            More
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <Show when={!props.node.isOther}>
                <Show when={props.onQuickLook}>
                  <DropdownMenu.Item onSelect={props.onQuickLook}>
                    <DropdownMenu.ItemLabel>Quick Look</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </Show>
                <Show when={!props.onQuickLook && props.onPreview}>
                  <DropdownMenu.Item onSelect={props.onPreview}>
                    <DropdownMenu.ItemLabel>Preview</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </Show>
                <Show when={props.node.isDir && props.onOpen}>
                  <DropdownMenu.Item onSelect={props.onOpen}>
                    <DropdownMenu.ItemLabel>Open folder</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </Show>
                <DropdownMenu.Item onSelect={props.onReveal}>
                  <DropdownMenu.ItemLabel>Reveal in file manager</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
              <Show when={props.deletable}>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={props.onTrash}>
                  <DropdownMenu.ItemLabel>Move to {props.trashName}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </div>
  )
}
