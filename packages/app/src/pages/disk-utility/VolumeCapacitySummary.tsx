import type { DiskDriveInfo, DiskScanNode } from "./types"
import { formatBytes } from "./format"
import { useLanguage } from "./runtime"

/** OS capacity is separate from file allocations and never a cleanup promise. */
export function VolumeCapacitySummary(props: { drive: DiskDriveInfo; root: DiskScanNode }) {
  const language = useLanguage()
  const free = Math.max(0, Math.min(props.drive.total, props.drive.free))
  const available = props.drive.available === undefined ? undefined : Math.max(free, Math.min(props.drive.total, props.drive.available))
  const hidden = props.root.children.find(node => node.isHidden)
  return <div className="shrink-0 border-t border-border-weaker-base px-5 py-3 text-12-regular text-text-weak">
    <div className="flex items-center gap-2.5 py-1"><span aria-hidden className="size-1.5 rounded-full bg-text-weak"/><span>{language.t("disk.capacity.free")}</span><span className="ml-auto tabular-nums">{formatBytes(free)}</span></div>
    {available !== undefined && available > free && <div className="flex items-center gap-2.5 py-1" title={language.t("disk.drive.availableDetails", { free: formatBytes(free), reclaimable: formatBytes(available - free) })}><span aria-hidden className="w-1.5">≈</span><span>{language.t("disk.capacity.available")}</span><span className="ml-auto tabular-nums">{formatBytes(available)}</span></div>}
    <details className="mt-1">
      <summary className="cursor-pointer py-1 text-text-weaker hover:text-text-strong">{language.t("disk.capacity.details")}</summary>
      <p className="pt-1 leading-relaxed">{language.t(hidden ? "disk.capacity.hiddenExplanation" : "disk.capacity.allocationExplanation")}</p>
    </details>
  </div>
}
