import { Button } from "@opencode-ai/ui/button"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { Show } from "solid-js"
import type { DiskScanNode } from "./types"
import { StorageAccountingFacts } from "./StorageAccounting"
import { formatBytes, formatPct } from "./format"
import { developerArtifactContext, fileKind, recognize } from "./recognize"
import { SAFETY_ACCENT } from "./ui-tokens"
import { useLanguage } from "./runtime"
import { diskNodeDisplayName } from "./node-display"

const GLYPH_BY_KIND: Record<string, IconProps["name"]> = {
  image: "photo",
  video: "photo",
  audio: "review",
  archive: "archive",
  document: "review",
  data: "review",
  code: "console",
}

/** Pick a glyph that reflects what a file is instead of a generic code-lines mark. */
function nodeGlyph(node: DiskScanNode): IconProps["name"] {
  if (node.isDir) return "folder"
  return GLYPH_BY_KIND[fileKind(node.ext).kind] ?? "code-lines"
}

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
    <div class="flex min-h-16 min-w-0 flex-wrap items-center justify-between gap-3 px-2">
      <div class="flex min-w-0 items-center gap-3">
        <span class="grid size-9 shrink-0 place-items-center rounded-full bg-surface-raised-base text-text-weak">
          <Icon name={nodeGlyph(props.node)} class="size-4" />
        </span>
        <div class="min-w-0">
          <div class="flex min-w-0 items-baseline gap-2">
            <span class="truncate text-13-semibold tracking-[-0.015em] text-text-strong">
              {diskNodeDisplayName(props.node)}
            </span>
            <span class="shrink-0 text-12-semibold tabular-nums text-text-strong">{formatBytes(props.node.size)}</span>
            <span class="shrink-0 text-13-regular tabular-nums text-text-weak">
              {formatPct(props.node.size, props.parentSize)}
            </span>
            <Show when={rec().tag}>
              <span
                class={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-13-semibold uppercase tracking-[0.08em] ring-1 ring-inset lg:inline ${SAFETY_ACCENT[rec().safety].pill}`}
              >
                {language.t(rec().tag!)}
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
            <Show when={!props.node.isOther} fallback={<span>{language.t("disk.node.aggregateDescription")}</span>}>
              <span class="font-mono">{props.node.path}</span>
            </Show>
          </p>
          <StorageAccountingFacts node={props.node} class="mt-1" />
        </div>
      </div>
      <div class="hidden shrink-0 items-center gap-1.5 md:flex">
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
