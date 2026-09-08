import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"
import type { DiskScanNode } from "./types"
import { StorageAccountingFacts } from "./StorageAccounting"
import { formatBytes } from "./format"
import { developerArtifactContext, recognize } from "./recognize"
import { useLanguage } from "./runtime"
import { diskNodeDisplayName } from "./node-display"

/** Detail / action bar pinned under the scan results. */
export function DetailBar(props: {
  node: DiskScanNode
  parentSize: number
  deletable: boolean
  collected: boolean
  locked?: boolean
  lockLabel?: string
  trashName: string
  revealLabel: string
  onPreview?: () => void
  onQuickLook?: () => void
  onReveal: () => void
  onOpen?: () => void
  onCollect: () => void
  onTrash: () => void
  onToggleLock?: () => void
}) {
  const language = useLanguage()
  const rec = () => recognize(props.node)
  const developerContext = () => (rec().developer ? developerArtifactContext(props.node, rec()) : undefined)
  return (
    <div class="dl-detail-bar flex min-h-10 min-w-0 items-center justify-between gap-3 px-2">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <span class="truncate text-13-medium text-text-strong">{diskNodeDisplayName(props.node)}</span>
        <span class="shrink-0 text-13-regular tabular-nums text-text-weak">{formatBytes(props.node.size)}</span>
        <details class="dl-item-details group">
          <summary class="flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-12-regular text-text-weak outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
            {language.t("disk.detail.info")}
            <Icon name="chevron-down" class="size-3 group-open:rotate-180" />
          </summary>
          <div class="absolute bottom-full left-4 z-30 mb-2 w-[min(480px,calc(100vw-48px))] rounded-lg border border-border-weaker-base bg-surface-raised-base p-4 shadow-lg">
            <p class="text-13-medium text-text-strong">{diskNodeDisplayName(props.node)}</p>
            <p class="mt-2 break-all text-12-regular text-text-weak">{props.node.path}</p>
            <Show when={developerContext()}>
              {(context) => (
                <p class="mt-2 text-12-regular text-text-weak">
                  {context().scope} · {context().disposition}
                </p>
              )}
            </Show>
            <StorageAccountingFacts node={props.node} class="mt-3" />
          </div>
        </details>
      </div>
      <div class="dl-detail-actions-wide shrink-0 items-center gap-1.5">
        <Show when={!props.node.isOther}>
          <Show
            when={props.onQuickLook}
            fallback={
              <Show when={props.onPreview}>
                <Button
                  class="dl-touch-target"
                  size="small"
                  variant="ghost"
                  icon="bullet-list"
                  onClick={props.onPreview}
                >
                  {language.t("disk.common.preview")}
                </Button>
              </Show>
            }
          >
            <Button class="dl-touch-target" size="small" variant="ghost" icon="eye" onClick={props.onQuickLook}>
              {language.t("disk.common.quickLook")}
            </Button>
          </Show>
        </Show>
        <Show when={props.node.isDir && props.onOpen}>
          <Button class="dl-touch-target" size="small" variant="ghost" icon="enter" onClick={props.onOpen}>
            {language.t(props.node.isOther ? "disk.common.showMore" : "disk.common.exploreFolder")}
          </Button>
        </Show>
        <Show when={!props.node.isOther || props.onToggleLock || props.deletable}>
          <DropdownMenu placement="top-end" gutter={6}>
            <DropdownMenu.Trigger
              as={Button}
              class="dl-touch-target"
              size="small"
              variant="ghost"
              icon="dot-grid"
              aria-label={language.t("disk.detail.moreFor", { name: diskNodeDisplayName(props.node) })}
            >
              {language.t("disk.detail.more")}
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content>
                <Show when={props.onQuickLook && props.onPreview}>
                  <DropdownMenu.Item onSelect={props.onPreview}>
                    <DropdownMenu.ItemLabel>{language.t("disk.common.previewHere")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </Show>
                <Show when={!props.node.isOther}>
                  <DropdownMenu.Item onSelect={props.onReveal}>
                    <DropdownMenu.ItemLabel>{props.revealLabel}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </Show>
                <Show when={props.onToggleLock}>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onSelect={props.onToggleLock}>
                    <DropdownMenu.ItemLabel>
                      {props.locked ? language.t("disk.detail.allowCleanup") : language.t("disk.detail.protectCleanup")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </Show>
                <Show when={props.deletable}>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onSelect={props.onTrash}>
                    <DropdownMenu.ItemLabel>
                      {language.t("disk.detail.moveTo", { trash: props.trashName })}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </Show>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        </Show>
        <Show when={props.deletable}>
          <Button
            class="dl-touch-target"
            size="small"
            variant={props.collected ? "secondary" : "primary"}
            icon={props.collected ? "circle-check" : "plus-small"}
            aria-pressed={props.collected}
            onClick={props.onCollect}
          >
            {props.collected ? language.t("disk.detail.selectedReview") : language.t("disk.detail.selectReview")}
          </Button>
        </Show>
      </div>
      <div class="dl-detail-actions-compact flex shrink-0 items-center gap-1.5">
        <Show when={props.deletable}>
          <Button
            class="dl-touch-target"
            size="small"
            variant={props.collected ? "secondary" : "primary"}
            icon={props.collected ? "circle-check" : "plus-small"}
            aria-pressed={props.collected}
            onClick={props.onCollect}
          >
            {props.collected ? language.t("disk.detail.selected") : language.t("disk.common.review")}
          </Button>
        </Show>
        <DropdownMenu placement="top-end" gutter={6}>
          <DropdownMenu.Trigger
            as={Button}
            class="dl-touch-target"
            size="small"
            variant="secondary"
            icon="dot-grid"
            aria-label={language.t("disk.detail.moreFor", { name: diskNodeDisplayName(props.node) })}
          >
            {language.t("disk.detail.more")}
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              <Show when={!props.node.isOther}>
                <Show when={props.onQuickLook}>
                  <DropdownMenu.Item onSelect={props.onQuickLook}>
                    <DropdownMenu.ItemLabel>{language.t("disk.common.quickLook")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </Show>
                <Show when={props.onPreview}>
                  <DropdownMenu.Item onSelect={props.onPreview}>
                    <DropdownMenu.ItemLabel>
                      {language.t(props.onQuickLook ? "disk.common.previewHere" : "disk.common.preview")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </Show>
                <DropdownMenu.Item onSelect={props.onReveal}>
                  <DropdownMenu.ItemLabel>{props.revealLabel}</DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
              <Show when={props.node.isDir && props.onOpen}>
                <DropdownMenu.Item onSelect={props.onOpen}>
                  <DropdownMenu.ItemLabel>
                    {language.t(props.node.isOther ? "disk.common.showMore" : "disk.common.exploreFolder")}
                  </DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
              <Show when={props.onToggleLock}>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={props.onToggleLock}>
                  <DropdownMenu.ItemLabel>
                    {props.locked ? language.t("disk.detail.allowCleanup") : language.t("disk.detail.protectCleanup")}
                  </DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
              <Show when={props.deletable}>
                <DropdownMenu.Separator />
                <DropdownMenu.Item onSelect={props.onTrash}>
                  <DropdownMenu.ItemLabel>
                    {language.t("disk.detail.moveTo", { trash: props.trashName })}
                  </DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </div>
  )
}
