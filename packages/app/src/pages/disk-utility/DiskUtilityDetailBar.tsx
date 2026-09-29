import { useMemo } from "react"
import {
  Check,
  CornerDownRight,
  Eye,
  FolderSearch,
  Info,
  Lock,
  MoreHorizontal,
  Plus,
} from "lucide-react"
import { DropdownMenu } from "@/components/dl/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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
import { toolbarIconButton } from "./ExplorerChrome"

/**
 * The selection card: what the item is, how big, and the handful of things
 * you can do with it. Rare actions (protect, move to Trash directly) live in
 * the overflow menu so the collector stays the primary cleanup path.
 */
export function DetailBar(props: {
  node: DiskScanNode
  color?: string
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
  const share =
    props.parentSize > 0
      ? Math.round((props.node.size / props.parentSize) * 1000) / 10
      : undefined
  const kind = rec.tag ? language.t(rec.tag) : undefined
  const status = props.locked
    ? language.t("disk.detail.protectedByYou")
    : props.includedBy
      ? language.t("disk.review.includedWith", { name: props.includedBy })
      : props.restriction
  const preview = props.onQuickLook ?? props.onPreview
  const previewLabel = props.onQuickLook
    ? language.t("disk.common.quickLook")
    : language.t("disk.common.preview")
  const name = diskNodeDisplayName(props.node)

  return (
    <div className="flex h-12 min-w-0 items-center gap-1 rounded-full bg-[var(--dl-popover)] py-1.5 pr-1.5 pl-4 shadow-[0_0_0_0.5px_rgb(255_255_255/0.06),0_8px_28px_rgb(0_0_0/0.28)]">
      <span
        className={cn(
          "mr-1 size-2.5 shrink-0 rounded-full",
          !props.node.isDir && "rounded-[3px]"
        )}
        style={{ background: props.color ?? "var(--text-weaker)" }}
        aria-hidden
      />
      <div className="mr-2 min-w-0 flex-1 leading-tight">
        <p
          className="truncate text-[13px] font-medium text-text-strong"
          title={props.node.path}
        >
          {identity.reviewTitle}
        </p>
        <p className="truncate text-[12px] text-text-weak tabular-nums">
          {formatBytes(props.node.size)}
          {share !== undefined && share < 100 ? ` · ${share}%` : ""}
          {kind ? ` · ${kind}` : ""}
          {status ? (
            <span
              className={cn(
                props.locked || props.restriction
                  ? "text-[var(--dl-warning)]"
                  : undefined
              )}
            >
              {` · ${status}`}
            </span>
          ) : null}
        </p>
      </div>

      <Popover>
        <PopoverTrigger
          className={toolbarIconButton}
          aria-label={language.t("disk.detail.info")}
          title={language.t("disk.detail.info")}
        >
          <Info className="size-4" strokeWidth={1.75} aria-hidden />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={10}
          className="w-[min(420px,calc(100vw-32px))] gap-0 rounded-xl border-0 bg-[var(--dl-popover)] p-4 text-text-base shadow-[0_0_0_0.5px_rgb(255_255_255/0.08),0_18px_48px_rgb(0_0_0/0.35)]"
        >
          <p className="text-[13px] font-semibold text-text-strong">{name}</p>
          <p className="mt-1 font-mono text-[11px] leading-relaxed break-all text-text-weak">
            {props.node.path}
          </p>
          {developerContext ? (
            <p className="mt-3 text-[12px] text-text-weak">
              {developerContext.scope} · {developerContext.disposition}
            </p>
          ) : null}
          {rec.hint ? (
            <p className="mt-1 text-[12px] text-text-weak">
              {language.t(rec.hint)}
            </p>
          ) : null}
          <p className="mt-3 text-[12px] text-text-weak">
            {props.node.modifiedAt
              ? language.t("disk.developer.observedChange", {
                  date: new Date(props.node.modifiedAt).toLocaleString(),
                })
              : language.t("disk.developer.changeUnknown")}
          </p>
          {props.accessState && props.accessState !== "not-checked" ? (
            <p className="mt-1 text-[12px] text-text-weak">
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
            <button
              type="button"
              className="mt-2 text-[12px] font-medium text-[var(--dl-accent)] hover:underline"
              onClick={props.onCheckAccess}
            >
              {language.t("disk.cleanup.checkAgain")}
            </button>
          ) : null}
          <StorageAccountingFacts node={props.node} className="mt-3" />
        </PopoverContent>
      </Popover>

      {!props.node.isOther && preview ? (
        <button
          type="button"
          className={toolbarIconButton}
          aria-label={previewLabel}
          title={previewLabel}
          onClick={preview}
        >
          <Eye className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
      {!props.node.isOther ? (
        <button
          type="button"
          className={toolbarIconButton}
          aria-label={props.revealLabel}
          title={props.revealLabel}
          onClick={props.onReveal}
        >
          <FolderSearch className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
      {props.node.isDir && props.onOpen ? (
        <button
          type="button"
          className={toolbarIconButton}
          aria-label={
            props.openLabel ??
            language.t(
              props.node.isOther
                ? "disk.common.showMore"
                : "disk.common.exploreFolder"
            )
          }
          title={
            props.openLabel ??
            language.t(
              props.node.isOther
                ? "disk.common.showMore"
                : "disk.common.exploreFolder"
            )
          }
          onClick={props.onOpen}
        >
          <CornerDownRight className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
      {props.onToggleLock || props.deletable || (props.onQuickLook && props.onPreview) ? (
        <DropdownMenu placement="top-end" gutter={8}>
          <DropdownMenu.Trigger
            as="button"
            type="button"
            className={toolbarIconButton}
            aria-label={language.t("disk.detail.moreFor", { name })}
            title={language.t("disk.detail.more")}
          >
            <MoreHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
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
              {props.onToggleLock ? (
                <DropdownMenu.Item onSelect={props.onToggleLock}>
                  <DropdownMenu.ItemLabel>
                    {props.locked
                      ? language.t("disk.detail.allowCleanup")
                      : language.t("disk.detail.protectCleanup")}
                  </DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
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
      {props.locked ? (
        <span
          className="ml-1 grid size-9 place-items-center rounded-full text-[var(--dl-warning)]"
          title={props.lockLabel}
        >
          <Lock className="size-4" aria-hidden />
        </span>
      ) : props.deletable ? (
        <button
          type="button"
          className={cn(
            "ml-1 inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold outline-none transition-[filter,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]",
            props.collected || props.includedBy
              ? "bg-[var(--dl-well-strong)] text-text-strong hover:brightness-110"
              : "bg-[var(--dl-accent)] text-white hover:brightness-110"
          )}
          aria-pressed={props.collected}
          aria-keyshortcuts="C"
          onClick={props.onCollect}
        >
          {props.collected || props.includedBy ? (
            <Check className="size-4" strokeWidth={2.5} aria-hidden />
          ) : (
            <Plus className="size-4" strokeWidth={2.5} aria-hidden />
          )}
          {props.includedBy
            ? language.t("disk.common.review")
            : props.collected
              ? language.t("disk.detail.selected")
              : language.t("disk.common.collect")}
        </button>
      ) : null}
    </div>
  )
}
