import { Icon } from "@/components/dl/icon"
import type { DiskDriveInfo, DiskScanNode } from "./types"
import { formatBytes } from "./format"
import { useLanguage } from "./runtime"

/** OS capacity is separate from file allocations and never a cleanup promise. */
export function VolumeCapacitySummary(props: {
  drive: DiskDriveInfo
  root: DiskScanNode
}) {
  const language = useLanguage()
  const free = Math.max(0, Math.min(props.drive.total, props.drive.free))
  const available =
    props.drive.available === undefined
      ? undefined
      : Math.max(free, Math.min(props.drive.total, props.drive.available))
  const hidden = props.root.children.find((node) => node.isHidden)
  return (
    <details className="text-12-regular group mt-1 text-text-weak">
      <summary className="flex min-h-7 cursor-pointer list-none items-center gap-2 outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
        <span>{language.t("disk.capacity.free")}</span>
        <span className="tabular-nums">{formatBytes(free)}</span>
        <Icon
          name="chevron-down"
          className="text-icon-weak size-3 transition-transform duration-150 group-open:rotate-180"
        />
      </summary>
      <div className="max-w-[45ch] pt-1 pb-2 leading-relaxed">
        {available !== undefined && available > free ? (
          <p
            className="flex items-center gap-2 tabular-nums"
            title={language.t("disk.drive.availableDetails", {
              free: formatBytes(free),
              reclaimable: formatBytes(available - free),
            })}
          >
            <span>{language.t("disk.capacity.available")}</span>
            <span>{formatBytes(available)}</span>
          </p>
        ) : null}
        <p className="mt-1 text-text-weaker">
          {language.t(
            hidden
              ? "disk.capacity.hiddenExplanation"
              : "disk.capacity.allocationExplanation"
          )}
        </p>
      </div>
    </details>
  )
}
