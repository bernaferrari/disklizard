import { Fragment, useLayoutEffect, useRef } from "react"
import { Check, FolderOpen, Eye } from "lucide-react"
import { cn } from "@/lib/utils"
import { useLanguage, usePlatform } from "./runtime"
import { type CleanupItem, cleanupItemExplanation } from "./cleanup-summary"
import { formatBytes, formatLastChanged } from "./format"
import { nativeRevealLabel } from "./navigation"
import { itemIdentity } from "./item-identity"
import type { DiskScanNode } from "./types"
import type { BaselineChange } from "./scan-baseline"
import { primaryButton, quietButton } from "./ExplorerChrome"

/** Inspection never stages or removes files. Its explicit action shares the list's policy. */
export function CleanupInspector(props: {
  id: string
  category: string
  item: CleanupItem
  collected: boolean
  coveredBy?: string
  restriction?: string
  selectionCount: number
  change?: BaselineChange
  onToggle: (node: DiskScanNode) => void
  onReveal: (node: DiskScanNode) => void
  onPreview?: (node: DiskScanNode) => void
}) {
  const language = useLanguage()
  const platform = usePlatform()
  const { item } = props
  const identity = itemIdentity(item.node)
  const disabled = !!props.restriction || !!props.coveredBy
  const scrollArea = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (scrollArea.current) scrollArea.current.scrollTop = 0
  }, [item.node.path])
  return (
    <aside
      id={props.id}
      aria-labelledby={`${props.id}-title`}
      className="flex min-h-0 w-[320px] shrink-0 flex-col border-l border-[var(--dl-separator)] bg-[var(--dl-chrome)] max-[760px]:max-h-[40dvh] max-[760px]:w-full max-[760px]:border-t max-[760px]:border-l-0"
    >
      <div
        ref={scrollArea}
        className="min-h-0 flex-1 [scrollbar-width:thin] overflow-y-auto px-6 pt-6 pb-4"
      >
        <p
          className="truncate text-[12px] text-text-weak"
          title={item.node.path}
        >
          {props.category}
        </p>
        <h2
          id={`${props.id}-title`}
          className="mt-1 text-[19px] leading-6 font-medium tracking-[-0.025em] break-words text-text-strong"
        >
          {identity.reviewTitle}
        </h2>
        <p className="mt-5 text-[12px] text-text-weak">
          {language.t("disk.ui.cleanup.fileSize")}
        </p>
        <p className="mt-1 text-[28px] leading-8 font-medium tracking-[-0.035em] text-text-strong tabular-nums">
          {formatBytes(item.bytes)}
        </p>
        <p className="mt-1 text-[12px] leading-5 text-text-weak">
          {formatLastChanged(item.node.modifiedAt)}
        </p>
        {props.change && props.change.deltaBytes > 0 ? (
          <p className="text-[12px] leading-5 text-text-weak">
            {language.t("disk.ui.sinceChip", {
              delta: `+${formatBytes(props.change.deltaBytes)}`,
            })}
          </p>
        ) : null}
        <div className="mt-6 border-t border-[var(--dl-separator)] pt-4">
          <h3 className="text-[13px] font-medium text-text-strong">
            {language.t(
              item.safe
                ? "disk.ui.cleanup.restore"
                : "disk.ui.cleanup.beforeRemoving"
            )}
          </h3>
          <p className="mt-2 text-[13px] leading-[1.6] text-text-weak">
            {language.t(cleanupItemExplanation(item))}
          </p>
        </div>
        <div className="mt-5">
          <h3 className="text-[12px] text-text-weak">
            {language.t("disk.ui.cleanup.location")}
          </h3>
          <p className="mt-1.5 text-[12px] leading-5 [overflow-wrap:anywhere] text-text-base select-text">
            {item.node.path.split(/(?<=[/\\])/).map((part, index) => (
              <Fragment key={index}>
                {part}
                <wbr />
              </Fragment>
            ))}
          </p>
          <div className="mt-3 -ml-2.5 flex flex-wrap gap-1">
            <button
              type="button"
              className={quietButton}
              onClick={() => props.onReveal(item.node)}
            >
              <FolderOpen className="size-3.5" aria-hidden />
              {nativeRevealLabel(platform.os)}
            </button>
            {props.onPreview ? (
              <button
                type="button"
                className={quietButton}
                onClick={() => props.onPreview?.(item.node)}
              >
                <Eye className="size-3.5" aria-hidden />
                {language.t("disk.common.quickLook")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="shrink-0 px-6 pt-2 pb-5">
        {props.restriction || props.coveredBy ? (
          <p className="mb-2 text-[12px] leading-5 text-text-weak">
            {props.restriction ??
              language.t("disk.review.includedWith", {
                name: props.coveredBy!,
              })}
          </p>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          onClick={() => props.onToggle(item.node)}
          className={cn(
            props.selectionCount > 0 ? quietButton : primaryButton,
            "h-9 w-full justify-center"
          )}
        >
          {props.collected ? <Check className="size-3.5" aria-hidden /> : null}
          {language.t(
            props.collected ? "disk.ui.cleanup.remove" : "disk.ui.cleanup.add"
          )}
        </button>
      </div>
    </aside>
  )
}
