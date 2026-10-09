import { FolderSearch } from "lucide-react"
import type { DiskScanNode } from "./types"
import { diskNodeDisplayName } from "./node-display"
import { formatBytes, formatLastChanged } from "./format"
import { useLanguage } from "./runtime"

/** Context for the open folder, independent of transient map hover. */
export function FolderContext(props: {
  node: DiskScanNode
  root: DiskScanNode
  color: string
  revealLabel: string
  onReveal: () => void
}) {
  const language = useLanguage()
  const share =
    props.root.size > 0
      ? Math.max(0, Math.min(1, props.node.size / props.root.size))
      : 0
  const folders = props.node.children.filter(
    (child) => child.isDir && !child.isOther && !child.isHidden
  ).length
  const files = props.node.children.filter(
    (child) => !child.isDir && !child.isOther && !child.isHidden
  ).length
  const grouped = props.node.children.reduce(
    (count, child) =>
      count + (child.isOther ? (child.otherCount ?? child.children.length) : 0),
    0
  )
  const row = "flex items-baseline justify-between gap-3"
  return (
    <section
      className="mx-5 mt-5 mb-5 border-t border-[var(--dl-separator)] pt-4"
      aria-label={language.t("disk.detail.info")}
    >
      {/* One rhythm for every fact: label left, value right. */}
      <dl className="space-y-2.5 text-[13px]">
        <div>
          <div className={row}>
            <dt className="min-w-0 truncate text-text-weak">
              {language.t("disk.inspector.share", {
                name: diskNodeDisplayName(props.root),
              })}
            </dt>
            <dd className="shrink-0 font-medium text-text-strong tabular-nums">
              {new Intl.NumberFormat(language.intl, {
                style: "percent",
                maximumFractionDigits: 1,
              }).format(share)}
            </dd>
          </div>
          <div
            className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-[var(--dl-well)]"
            aria-hidden
          >
            <span
              className="h-full rounded-full"
              style={{ width: `${share * 100}%`, backgroundColor: props.color }}
            />
          </div>
        </div>
        {folders + files + grouped > 0 ? (
          <div className={row}>
            <dt className="shrink-0 text-text-weak">
              {language.t("disk.inspector.contents")}
            </dt>
            <dd className="flex min-w-0 flex-wrap justify-end gap-x-2 text-right text-text-strong tabular-nums">
              {folders > 0 ? (
                <span>{language.plural("disk.count.folder", folders)}</span>
              ) : null}
              {files > 0 ? (
                <span>{language.plural("disk.count.file", files)}</span>
              ) : null}
              {grouped > 0 ? (
                <span>{language.plural("disk.node.other", grouped)}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
        {props.node.logicalSize !== undefined &&
        props.node.logicalSize !== props.node.size ? (
          <div className={row}>
            <dt className="text-text-weak">
              {language.t("disk.inspector.fileSize")}
            </dt>
            <dd className="text-text-strong tabular-nums">
              {formatBytes(props.node.logicalSize)}
            </dd>
          </div>
        ) : null}
        {props.node.modifiedAt ? (
          <div className={row}>
            <dt className="text-text-weak">
              {language.t("disk.sort.key.modified")}
            </dt>
            <dd className="text-text-strong">
              {formatLastChanged(props.node.modifiedAt)}
            </dd>
          </div>
        ) : null}
      </dl>
      {!props.node.isOther && !props.node.isHidden ? (
        <div className="mt-4 border-t border-[var(--dl-separator)] pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13px] text-text-weak">
              {language.t("disk.inspector.location")}
            </p>
            <button
              type="button"
              onClick={props.onReveal}
              className="-mr-2 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-text-base transition-colors outline-none hover:bg-[var(--dl-well)] hover:text-text-strong focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
            >
              <FolderSearch className="size-3.5" aria-hidden />
              {props.revealLabel}
            </button>
          </div>
          <p
            className="mt-1 font-mono text-[11.5px] leading-[1.6] [overflow-wrap:anywhere] text-text-weak"
            title={props.node.path}
          >
            {props.node.path}
          </p>
        </div>
      ) : null}
    </section>
  )
}
