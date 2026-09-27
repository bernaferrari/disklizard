import { useMemo } from "react"
import { Button } from "@/components/dl/button"
import { DropdownMenu } from "@/components/dl/dropdown-menu"
import { Icon } from "@/components/dl/icon"
import type { DiskScanNode } from "./types"
import { StorageAccountingFacts } from "./StorageAccounting"
import { formatBytes } from "./format"
import {
  developerArtifactContext,
  recognize,
  type Recognition,
} from "./recognize"
import { useLanguage } from "./runtime"
import { diskNodeDisplayName } from "./node-display"
import { itemIdentity } from "./item-identity"

/** Detail / action bar pinned under the scan results. */
export function DetailBar(props: {
  node: DiskScanNode
  recognition?: Recognition
  parentSize: number
  deletable: boolean
  collected: boolean
  includedBy?: string
  locked?: boolean
  lockLabel?: string
  restriction?: string
  accessState?:
    | "not-checked"
    | "checking"
    | "likely"
    | "denied"
    | "read-only"
    | "unknown"
  trashName: string
  revealLabel: string
  onPreview?: () => void
  onQuickLook?: () => void
  onReveal: () => void
  onOpen?: () => void
  openLabel?: string
  onCollect: () => void
  onTrash: () => void
  onToggleLock?: () => void
  onCheckAccess?: () => void
}) {
  const language = useLanguage()
  const identity = useMemo(() => itemIdentity(props.node), [props.node])
  const rec = useMemo(
    () => props.recognition ?? recognize(props.node),
    [props.node, props.recognition]
  )
  const developerContext = useMemo(
    () =>
      rec.developer ? developerArtifactContext(props.node, rec) : undefined,
    [rec, props.node]
  )
  return (
    <div className="[container-type:inline-size] flex min-h-10 min-w-0 items-center justify-between gap-3 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className="text-13-medium min-w-0 truncate text-text-strong"
          title={props.node.path}
        >
          {identity.reviewTitle}
        </span>
        {props.locked ? (
          <span
            className="text-12-regular shrink-0 text-icon-warning-base"
            title={props.lockLabel}
          >
            {language.t("disk.detail.protectedByYou")}
          </span>
        ) : null}
        {props.includedBy ? (
          <span
            className="text-12-regular shrink-0 text-text-weak"
            title={props.includedBy}
          >
            {language.t("disk.review.includedWith", { name: props.includedBy })}
          </span>
        ) : null}
        {props.locked && props.onToggleLock ? (
          <Button
            size="small"
            variant="ghost"
            className="min-h-9 shrink-0"
            onClick={props.onToggleLock}
          >
            {language.t("disk.detail.allowCleanup")}
          </Button>
        ) : null}
        {!props.locked && props.restriction ? (
          <span
            className="text-12-regular shrink-0 text-icon-warning-base"
            title={props.restriction}
          >
            {props.restriction}
          </span>
        ) : null}
        <span className="text-13-regular shrink-0 text-text-weak tabular-nums">
          {formatBytes(props.node.size)}
        </span>
        <details className="group">
          <summary className="text-12-regular flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-md px-2 text-text-weak outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
            {language.t("disk.detail.info")}
            <Icon
              name="chevron-down"
              className="size-3 group-open:rotate-180"
            />
          </summary>
          <div className="absolute bottom-full left-4 z-30 mb-2 w-[min(480px,calc(100vw-48px))] rounded-lg border border-border-weaker-base bg-surface-raised-base p-4 shadow-lg">
            <p className="text-13-medium text-text-strong">
              {diskNodeDisplayName(props.node)}
            </p>
            <p className="text-12-regular mt-2 break-all text-text-weak">
              {props.node.path}
            </p>
            {props.accessState && props.accessState !== "not-checked" ? (
              <p className="text-12-regular mt-2 text-text-weak">
                {language.t(
                  props.accessState === "checking"
                    ? "disk.cleanup.accessChecking"
                    : props.accessState === "likely"
                      ? "disk.cleanup.accessLikely"
                      : "disk.cleanup.accessUnknown"
                )}
              </p>
            ) : null}
            {(props.accessState === "denied" ||
              props.accessState === "read-only" ||
              props.accessState === "unknown") &&
            props.onCheckAccess ? (
              <Button
                size="small"
                variant="secondary"
                className="mt-2 min-h-9"
                onClick={props.onCheckAccess}
              >
                {language.t("disk.cleanup.checkAgain")}
              </Button>
            ) : null}
            {developerContext ? (
              <>
                <p className="text-12-regular mt-2 text-text-weak">
                  {developerContext.scope} · {developerContext.disposition}
                </p>
                <p className="text-12-regular mt-2 text-text-weak">
                  {props.node.modifiedAt
                    ? language.t("disk.developer.observedChange", {
                        date: new Date(props.node.modifiedAt).toLocaleString(),
                      })
                    : language.t("disk.developer.changeUnknown")}
                </p>
              </>
            ) : null}
            <StorageAccountingFacts node={props.node} className="mt-3" />
          </div>
        </details>
      </div>
      <div className="hidden shrink-0 items-center gap-1.5 @min-[900px]:flex">
        {!props.node.isOther ? (
          props.onQuickLook ? (
            <Button
              className="min-h-11 min-w-11"
              size="small"
              variant="ghost"
              icon="eye"
              onClick={props.onQuickLook}
            >
              {language.t("disk.common.quickLook")}
            </Button>
          ) : props.onPreview ? (
            <Button
              className="min-h-11 min-w-11"
              size="small"
              variant="ghost"
              icon="bullet-list"
              onClick={props.onPreview}
            >
              {language.t("disk.common.preview")}
            </Button>
          ) : null
        ) : null}
        {props.node.isDir && props.onOpen ? (
          <Button
            className="min-h-11 min-w-11"
            size="small"
            variant="ghost"
            icon="enter"
            onClick={props.onOpen}
          >
            {props.openLabel ??
              language.t(
                props.node.isOther
                  ? "disk.common.showMore"
                  : "disk.common.exploreFolder"
              )}
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
              aria-label={language.t("disk.detail.moreFor", {
                name: diskNodeDisplayName(props.node),
              })}
            >
              {language.t("disk.detail.more")}
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content>
                {props.onQuickLook && props.onPreview ? (
                  <DropdownMenu.Item onSelect={props.onPreview}>
                    <DropdownMenu.ItemLabel>
                      {language.t("disk.common.previewHere")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                ) : null}
                {!props.node.isOther ? (
                  <DropdownMenu.Item onSelect={props.onReveal}>
                    <DropdownMenu.ItemLabel>
                      {props.revealLabel}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                ) : null}
                {props.onToggleLock ? (
                  <>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onSelect={props.onToggleLock}>
                      <DropdownMenu.ItemLabel>
                        {props.locked
                          ? language.t("disk.detail.allowCleanup")
                          : language.t("disk.detail.protectCleanup")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </>
                ) : null}
                {props.deletable ? (
                  <>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item onSelect={props.onTrash}>
                      <DropdownMenu.ItemLabel>
                        {language.t("disk.detail.moveTo", {
                          trash: props.trashName,
                        })}
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
            variant={
              props.collected || props.includedBy ? "secondary" : "primary"
            }
            icon={
              props.collected || props.includedBy
                ? "circle-check"
                : "plus-small"
            }
            aria-pressed={props.collected}
            onClick={props.onCollect}
          >
            {props.includedBy
              ? language.t("disk.common.review")
              : props.collected
                ? language.t("disk.detail.selectedReview")
                : language.t("disk.detail.selectReview")}
          </Button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 @min-[900px]:hidden">
        {props.deletable ? (
          <Button
            className="min-h-11 min-w-11"
            size="small"
            variant={
              props.collected || props.includedBy ? "secondary" : "primary"
            }
            icon={
              props.collected || props.includedBy
                ? "circle-check"
                : "plus-small"
            }
            aria-pressed={props.collected}
            onClick={props.onCollect}
          >
            {props.includedBy
              ? language.t("disk.common.review")
              : props.collected
                ? language.t("disk.detail.selected")
                : language.t("disk.common.review")}
          </Button>
        ) : null}
        <DropdownMenu placement="top-end" gutter={6}>
          <DropdownMenu.Trigger
            as={Button}
            className="min-h-11 min-w-11"
            size="small"
            variant="secondary"
            icon="dot-grid"
            aria-label={language.t("disk.detail.moreFor", {
              name: diskNodeDisplayName(props.node),
            })}
          >
            {language.t("disk.detail.more")}
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content>
              {!props.node.isOther ? (
                <>
                  {props.onQuickLook ? (
                    <DropdownMenu.Item onSelect={props.onQuickLook}>
                      <DropdownMenu.ItemLabel>
                        {language.t("disk.common.quickLook")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  ) : null}
                  {props.onPreview ? (
                    <DropdownMenu.Item onSelect={props.onPreview}>
                      <DropdownMenu.ItemLabel>
                        {language.t(
                          props.onQuickLook
                            ? "disk.common.previewHere"
                            : "disk.common.preview"
                        )}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  ) : null}
                  <DropdownMenu.Item onSelect={props.onReveal}>
                    <DropdownMenu.ItemLabel>
                      {props.revealLabel}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </>
              ) : null}
              {props.node.isDir && props.onOpen ? (
                <DropdownMenu.Item onSelect={props.onOpen}>
                  <DropdownMenu.ItemLabel>
                    {language.t(
                      props.node.isOther
                        ? "disk.common.showMore"
                        : "disk.common.exploreFolder"
                    )}
                  </DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
              ) : null}
              {props.onToggleLock ? (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onSelect={props.onToggleLock}>
                    <DropdownMenu.ItemLabel>
                      {props.locked
                        ? language.t("disk.detail.allowCleanup")
                        : language.t("disk.detail.protectCleanup")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </>
              ) : null}
              {props.deletable ? (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item onSelect={props.onTrash}>
                    <DropdownMenu.ItemLabel>
                      {language.t("disk.detail.moveTo", {
                        trash: props.trashName,
                      })}
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
