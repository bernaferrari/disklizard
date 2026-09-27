import { Button } from "@/components/dl/button"
import { Icon } from "@/components/dl/icon"
import { formatCount } from "./format"
import { scanAccessGuidance } from "./navigation"
import { useLanguage } from "./runtime"
import type { DiskScanNode } from "./types"

/** Keep incomplete scan coverage next to the volume facts it qualifies. */
export function ScanCoverageDisclosure(props: {
  issues: NonNullable<DiskScanNode["scanIssues"]>
  os?: "macos" | "windows" | "linux"
  onRescan: () => void
}) {
  const language = useLanguage()
  return (
    <details className="group mt-0.5 text-text-weak">
      <summary className="text-12-medium flex min-h-7 cursor-pointer list-none items-center gap-2 outline-none hover:text-text-strong focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
        <Icon
          name="warning"
          className="size-3.5 shrink-0 text-icon-warning-base"
        />
        <span className="min-w-0 flex-1 truncate">
          {language.t("disk.explore.unreadable", {
            count: formatCount(props.issues.unreadableCount),
            locations: language.plural(
              "disk.count.locationNoun",
              props.issues.unreadableCount
            ),
          })}{" "}
          · {language.t("disk.explore.totalsLow")}
        </span>
        <Icon
          name="chevron-down"
          className="text-icon-weak size-3 shrink-0 transition-transform duration-150 group-open:rotate-180"
        />
      </summary>
      <div className="max-w-[45ch] pt-1 pb-2">
        <p className="text-12-regular leading-relaxed text-text-weak">
          {language.t(scanAccessGuidance(props.os))}{" "}
          {language.t("disk.accessGuidance.rescan")}
        </p>
        <Button
          className="mt-2 min-h-9"
          size="small"
          variant="secondary"
          onClick={props.onRescan}
        >
          {language.t("disk.common.rescan")}
        </Button>
        <ul
          className="mt-2 max-h-36 space-y-1 overflow-y-auto font-mono text-xs text-text-weak"
          aria-label={language.t("disk.explore.unreadableList")}
        >
          {props.issues.samplePaths.map((path) => (
            <li key={path} title={path} className="truncate">
              {path}
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
