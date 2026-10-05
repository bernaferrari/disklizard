import { Button } from "@/components/ui/button"
import { Fragment, useLayoutEffect, useRef } from "react"
import { Check, Eye, FolderSearch, Info, Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { useLanguage, usePlatform } from "./runtime"
import { type CleanupItem, cleanupItemExplanation } from "./cleanup-summary"
import { formatBytes, formatLastChanged } from "./format"
import { nativeRevealLabel } from "./navigation"
import { itemIdentity } from "./item-identity"
import type { DiskScanNode, DiskCleanupLock } from "./types"
import type { BaselineChange } from "./scan-baseline"

import { ACCESS_LABEL, type AccessAssessment } from "./access-assessments"

/** Inspection never stages or removes files. Its explicit action shares the list's policy. */
export function CleanupInspector(props: {
  id: string
  category: string
  item: CleanupItem
  collected: boolean
  coveredBy?: string
  restriction?: string
  access?: AccessAssessment
  onCheckAccess?: (node: DiskScanNode) => void
  onRescan?: () => void
  protection?: DiskCleanupLock
  onUnprotect?: (lock: DiskCleanupLock) => void
  change?: BaselineChange
  /** False when the page already explains that the whole scan is partial. */
  flagIncomplete?: boolean
  onToggle: (node: DiskScanNode) => void
  onReveal: (node: DiskScanNode) => void
  onPreview?: (node: DiskScanNode) => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const { item } = props
  const identity = itemIdentity(item.node)
  const disabled =
    (!props.collected && !!props.restriction) || !!props.coveredBy
  const scrollArea = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = 0
  }, [item.node.path])
  // The incomplete-scan caveat applies to almost every folder on a real disk,
  // so it is a footnote; the item-specific reason leads.
  const reason = cleanupItemExplanation({ ...item, unobserved: false })
  const meta = [
    formatLastChanged(item.node.modifiedAt),
    props.change && props.change.deltaBytes > 0
      ? language.t("disk.ui.sinceChip", {
          delta: `+${formatBytes(props.change.deltaBytes)}`,
        })
      : undefined,
  ].filter(Boolean)
  return (
    <aside
      id={props.id}
      aria-labelledby={`${props.id}-title`}
      className="flex min-h-0 w-[340px] shrink-0 flex-col border-l border-[var(--dl-separator)] bg-[var(--dl-chrome)] max-[760px]:max-h-[32dvh] max-[760px]:w-full max-[760px]:border-t max-[760px]:border-l-0"
    >
      <div
        ref={scrollArea}
        className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-6 pt-6 pb-6"
      >
        <p
          className="truncate text-[11px] font-semibold tracking-[0.06em] text-text-weak uppercase"
          title={item.node.path}
        >
          {props.category}
        </p>
        <h2
          id={`${props.id}-title`}
          className="mt-1.5 text-[18px] leading-6 font-semibold tracking-[-0.02em] break-words text-text-strong"
        >
          {identity.reviewTitle}
        </h2>
        <p className="mt-4 text-[28px] leading-8 font-semibold tracking-[-0.035em] whitespace-nowrap text-text-strong tabular-nums">
          {formatBytes(item.bytes)}
        </p>
        {item.accountingContributionBytes !== undefined &&
        item.accountingContributionBytes !== item.bytes ? (
          <p className="mt-1 text-[12px] leading-5 text-text-weak">
            {language.t("disk.ui.cleanup.wholeFolder")}
          </p>
        ) : null}
        <p className="mt-1 text-[12px] leading-5 text-text-weak">
          {meta.join(" · ")}
        </p>
        {/* A selected item states its status, and turns into the removal
            action on hover or focus so the toggle never reads ambiguously. */}
        <Button
          type="button"
          disabled={disabled}
          onClick={() => props.onToggle(item.node)}
          variant={props.collected ? "outline" : "default"}
          size="lg"
          aria-pressed={props.collected}
          aria-label={language.t(
            props.collected ? "disk.ui.cleanup.remove" : "disk.ui.cleanup.add"
          )}
          className={cn(
            "group/toggle mt-4 w-full",
            props.collected && "text-text-strong"
          )}
        >
          {props.collected ? (
            <span className="grid">
              <span className="col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 group-hover/toggle:invisible group-focus-visible/toggle:invisible">
                <Check
                  className="size-3.5 text-[var(--dl-accent)]"
                  strokeWidth={2.5}
                  aria-hidden
                />
                {language.t("disk.ui.cleanup.selected")}
              </span>
              <span className="invisible col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5 group-hover/toggle:visible group-focus-visible/toggle:visible">
                <Minus className="size-3.5" strokeWidth={2.5} aria-hidden />
                {language.t("disk.ui.cleanup.remove")}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center justify-center gap-1.5">
              <Plus className="size-3.5" strokeWidth={2.5} aria-hidden />
              {language.t("disk.ui.cleanup.add")}
            </span>
          )}
        </Button>
        {props.restriction || props.coveredBy ? (
          <p className="mt-2 text-[12px] leading-5 text-text-weak">
            {props.restriction ??
              language.t("disk.review.includedWith", {
                name: props.coveredBy!,
              })}
          </p>
        ) : null}

        {props.access ? (
          <p className="mt-2 text-[12px] leading-5 text-text-weak">
            {language.t(ACCESS_LABEL[props.access.state])}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1">
          {props.protection && props.onUnprotect ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => props.onUnprotect?.(props.protection!)}
            >
              {language.t("disk.ui.cleanup.unprotect", {
                name: props.protection.label,
              })}
            </Button>
          ) : null}
          {props.onCheckAccess ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.access?.state === "checking"}
              onClick={() => props.onCheckAccess?.(item.node)}
            >
              {language.t("disk.cleanup.checkAgain")}
            </Button>
          ) : null}
          {props.restriction && props.onRescan ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={props.onRescan}
            >
              {language.t("disk.common.rescan")}
            </Button>
          ) : null}
        </div>

        <div className="mt-6 border-t border-[var(--dl-separator)] pt-5">
          <h3 className="text-[13px] font-medium text-text-strong">
            {language.t(
              item.safe
                ? "disk.ui.cleanup.restore"
                : "disk.ui.cleanup.beforeRemoving"
            )}
          </h3>
          <p className="mt-1.5 text-[13px] leading-[1.6] text-text-weak">
            {language.t(reason)}
          </p>
          {item.unobserved && props.flagIncomplete !== false ? (
            <p className="mt-3 flex gap-2 text-[12px] leading-[1.55] text-text-weaker">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {language.t("disk.ui.cleanup.reason.incomplete")}
            </p>
          ) : null}
        </div>

        <div className="mt-6 border-t border-[var(--dl-separator)] pt-5">
          <h3 className="text-[13px] font-medium text-text-strong">
            {language.t("disk.ui.cleanup.location")}
          </h3>
          <p className="mt-1.5 text-[12px] leading-5 [overflow-wrap:anywhere] text-text-weak select-text">
            {item.node.path.split(/(?<=[/\\])/).map((part, index) => (
              <Fragment key={index}>
                {part}
                <wbr />
              </Fragment>
            ))}
          </p>
          <div className="mt-2.5 -ml-2.5 flex flex-wrap gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-text-base"
              onClick={() => props.onReveal(item.node)}
            >
              <FolderSearch className="size-3.5" aria-hidden />
              {nativeRevealLabel(platform.os)}
            </Button>
            {props.onPreview ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-text-base"
                onClick={() => props.onPreview?.(item.node)}
              >
                <Eye className="size-3.5" aria-hidden />
                {language.t(
                  platform.os === "macos"
                    ? "disk.common.quickLook"
                    : "disk.common.preview"
                )}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </aside>
  )
}
