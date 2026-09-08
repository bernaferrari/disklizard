import { useMemo } from "react"
import { Button } from "@/components/dl/button"
import { DropdownMenu } from "@/components/dl/dropdown-menu"
import { Icon } from "@/components/dl/icon"
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
  const rec = useMemo(() => recognize(props.node), [props.node])
  const developerContext = useMemo(
    () => (rec.developer ? developerArtifactContext(props.node, rec) : undefined),
    [rec, props.node],
  )
  return (
    <div className="[container-type:inline-size] flex min-h-10 min-w-0 items-center justify-between gap-3 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="truncate text-13-medium text-text-strong">{diskNodeDisplayName(props.node)}</span>
        <span className="shrink-0 text-13-regular tabular-nums text-text-weak">{formatBytes(props.node.size)}</span>
        <details className="group">
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-12-regular text-text-weak outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
            {language.t("disk.detail.info")}
            <Icon name="chevron-down" className="size-3 group-open:rotate-180" />
          </summary>
          <div className="absolute bottom-full left-4 z-30 mb-2 w-[min(480px,calc(100vw-48px))] rounded-lg border border-border-weaker-base bg-surface-raised-base p-4 shadow-lg">
            <p className="text-13-medium text-text-strong">{diskNodeDisplayName(props.node)}</p>
            <p className="mt-2 break-all text-12-regular text-text-weak">{props.node.path}</p>
            {developerContext ? (
              <p className="mt-2 text-12-regular text-text-weak">
                {developerContext.scope} · {developerContext.disposition}
              </p>
            ) : null}
            <StorageAccountingFacts node={props.node} className="mt-3" />
          </div>
        </details>
      </div>
      <div className="hidden @min-[900px]:flex shrink-0 items-center gap-1.5">
        {!props.node.isOther ? (
          props.onQuickLook ? (
            <Button className="min-h-11 min-w-11" size="small" variant="ghost" icon="eye" onClick={props.onQuickLook}>
              {language.t("disk.common.quickLook")}
            </Button>
          ) : props.onPreview ? (
            <Button className="min-h-11 min-w-11" size="small" variant="ghost" icon="bullet-list" onClick={props.onPreview}>
              {language.t("disk.common.preview")}
            </Button>
          ) : null
        ) : null}
        {props.node.isDir && props.onOpen ? (
          <Button className="min-h-11 min-w-11" size="small" variant="ghost" icon="enter" onClick={props.onOpen}>
            {language.t(props.node.isOther ? "disk.common.showMore" : "disk.common.exploreFolder")}
          </Button>
        ) : null}
        {!props.node.isOther || props.onToggleLock || props.deletable ? (
          <DropdownMenu placement="top-end" gutter={6}>
            <DropdownMenu.Trigger
              as={Button}
              className="min-h-11 min-w-11"
              size="small"
              variant="ghost"
              icon="dot-grid"
              aria-label={language.t("disk.detail.moreFor", { name: diskNodeDisplayName(props.node) })}
            >
              {language.t("disk.detail.more")}
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content>
                {props.onQuickLook && props.onPreview ? (
                  <DropdownMenu.Item onSelect={props.onPreview}>
                    <DropdownMenu.ItemLabel>{language.t("disk.common.previewHere")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                ) : null}
                {!props.node.isOther ? (
                  <DropdownMenu.Item onSelect={props.onReveal}>
                    <DropdownMenu.ItemLabel>{props.revealLabel}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                ) : null}
                {props.onToggleLock ? (
                  <>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onSelect={props.onToggleLock}>
                      <DropdownMenu.ItemLabel>
                        {props.locked ? language.t("disk.detail.allowCleanup") : language.t("disk.detail.protectCleanup")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </>
                ) : null}
                {props.deletable ? (
                  <>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onSelect={props.onTrash}>
                      <DropdownMenu.ItemLabel>
                        {language.t("disk.detail.moveTo", { trash: props.trashName })}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </>
                ) : null}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        ) : null}
        {props.deletable ? (
          <Button
            className="min-h-11 min-w-11"
            size="small"
            variant={props.collected ? "secondary" : "primary"}
            icon={props.collected ? "circle-check" : "plus-small"}
            aria-pressed={props.collected}
            onClick={props.onCollect}
          >
            {props.collected ? language.t("disk.detail.selectedReview") : language.t("disk.detail.selectReview")}
          </Button>
        ) : null}
      </div>
      <div className="@min-[900px]:hidden flex shrink-0 items-center gap-1.5">
        {props.deletable ? (
          <Button
            className="min-h-11 min-w-11"
            size="small"
            variant={props.collected ? "secondary" : "primary"}
            icon={props.collected ? "circle-check" : "plus-small"}
            aria-pressed={props.collected}
            onClick={props.onCollect}
          >
            {props.collected ? language.t("disk.detail.selected") : language.t("disk.common.review")}
          </Button>
        ) : null}
        <DropdownMenu placement="top-end" gutter={6}>
          <DropdownMenu.Trigger
            as={Button}
            className="min-h-11 min-w-11"
            size="small"
            variant="secondary"
            icon="dot-grid"
            aria-label={language.t("disk.detail.moreFor", { name: diskNodeDisplayName(props.node) })}
          >
            {language.t("disk.detail.more")}
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              {!props.node.isOther ? (
                <>
                  {props.onQuickLook ? (
                    <DropdownMenu.Item onSelect={props.onQuickLook}>
                      <DropdownMenu.ItemLabel>{language.t("disk.common.quickLook")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  ) : null}
                  {props.onPreview ? (
                    <DropdownMenu.Item onSelect={props.onPreview}>
                      <DropdownMenu.ItemLabel>
                        {language.t(props.onQuickLook ? "disk.common.previewHere" : "disk.common.preview")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  ) : null}
                  <DropdownMenu.Item onSelect={props.onReveal}>
                    <DropdownMenu.ItemLabel>{props.revealLabel}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </>
              ) : null}
              {props.node.isDir && props.onOpen ? (
                <DropdownMenu.Item onSelect={props.onOpen}>
                  <DropdownMenu.ItemLabel>
                    {language.t(props.node.isOther ? "disk.common.showMore" : "disk.common.exploreFolder")}
                  </DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              ) : null}
              {props.onToggleLock ? (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onSelect={props.onToggleLock}>
                    <DropdownMenu.ItemLabel>
                      {props.locked ? language.t("disk.detail.allowCleanup") : language.t("disk.detail.protectCleanup")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </>
              ) : null}
              {props.deletable ? (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onSelect={props.onTrash}>
                    <DropdownMenu.ItemLabel>
                      {language.t("disk.detail.moveTo", { trash: props.trashName })}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </>
              ) : null}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>
      </div>
    </div>
  )
}
