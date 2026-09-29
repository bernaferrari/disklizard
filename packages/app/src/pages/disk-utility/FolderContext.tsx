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
  return (
    <section
      className="mx-5 mt-5 mb-5 border-t border-[var(--dl-separator)] pt-4"
      aria-label={language.t("disk.detail.info")}
    >
      {!props.node.isOther && !props.node.isHidden ? (
        <>
          <p className="text-[12px] font-medium text-text-weak">
            {language.t("disk.inspector.location")}
          </p>
          <p
            className="mt-1.5 text-[13px] leading-5 [overflow-wrap:anywhere] text-text-strong"
            title={props.node.path}
          >
            {props.node.path}
          </p>
          <button
            type="button"
            onClick={props.onReveal}
            className="mt-3 rounded-md bg-[var(--dl-well)] px-3 py-1.5 text-[13px] font-medium text-text-strong transition-colors hover:bg-[var(--dl-well-strong)] focus-visible:outline-2 focus-visible:outline-[var(--dl-focus)]"
          >
            {props.revealLabel}
          </button>
        </>
      ) : null}
      <dl className="mt-4 space-y-3 text-[13px]">
        <div>
          <div className="flex items-baseline justify-between gap-3">
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
          <div>
            <dt className="text-text-weak">
              {language.t("disk.inspector.contents")}
            </dt>
            <dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-text-strong tabular-nums">
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
          <div className="flex justify-between gap-3">
            <dt className="text-text-weak">
              {language.t("disk.inspector.fileSize")}
            </dt>
            <dd className="text-text-strong tabular-nums">
              {formatBytes(props.node.logicalSize)}
            </dd>
          </div>
        ) : null}
        {props.node.modifiedAt ? (
          <div className="flex justify-between gap-3">
            <dt className="text-text-weak">
              {language.t("disk.sort.key.modified")}
            </dt>
            <dd className="text-text-strong">
              {formatLastChanged(props.node.modifiedAt)}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  )
}
