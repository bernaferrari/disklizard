import type { ApfsSnapshotEvidence } from "@/core"
import { diskLanguagePlural, diskLanguageText, useLanguage } from "./runtime"

export const APFS_SNAPSHOT_EVIDENCE_LIMIT = 5

export function boundedSnapshotEvidence(snapshots: readonly ApfsSnapshotEvidence[] | undefined) {
  return (snapshots ?? []).slice(0, APFS_SNAPSHOT_EVIDENCE_LIMIT)
}

export function snapshotEvidenceLabel(snapshot: ApfsSnapshotEvidence): string {
  return snapshot.name ?? snapshot.uuid ?? diskLanguageText("disk.apfs.unnamed")
}

export function snapshotEvidenceCaption(snapshotCount: number, visibleCount: number): string {
  if (visibleCount === 0) {
    return diskLanguagePlural("disk.apfs.noIdentity", snapshotCount)
  }
  if (visibleCount < snapshotCount) {
    return diskLanguageText("disk.apfs.showing", { count: snapshotCount, visible: visibleCount })
  }
  return diskLanguagePlural("disk.apfs.present", snapshotCount)
}

export function snapshotEvidenceCountSummary(purgeableCount = 0, timeMachineCount = 0): string {
  const parts: string[] = []
  if (purgeableCount > 0) parts.push(diskLanguagePlural("disk.apfs.purgeableCount", purgeableCount))
  if (timeMachineCount > 0) parts.push(diskLanguagePlural("disk.apfs.timeMachineCount", timeMachineCount))
  return parts.join(" · ")
}

/**
 * Evidence, not a cleanup control: APFS snapshot byte ownership is not exposed
 * reliably by macOS, so this makes their presence inspectable without a made-up size.
 */
export function ApfsSnapshotEvidenceList(props: {
  snapshotCount?: number
  purgeableSnapshotCount?: number
  timeMachineSnapshotCount?: number
  snapshots?: readonly ApfsSnapshotEvidence[]
  className?: string
  embedded?: boolean
}) {
  const language = useLanguage()
  const snapshotCount = props.snapshotCount ?? 0
  const snapshots = boundedSnapshotEvidence(props.snapshots)
  const countSummary = snapshotEvidenceCountSummary(props.purgeableSnapshotCount, props.timeMachineSnapshotCount)
  if (snapshotCount < 1) return null

  const evidence = (
    <div className={props.embedded ? "mt-2" : "mt-2 border-t border-border-weaker-base pt-2"}>
      <p className="max-w-[62ch] text-13-regular leading-relaxed text-text-weaker">{language.t("disk.apfs.body")}</p>
      {countSummary ? <p className="mt-1.5 text-13-regular tabular-nums text-text-weaker">{countSummary}</p> : null}
      {snapshots.length > 0 ? (
        <ul className="mt-2 space-y-1.5" aria-label={language.t("disk.apfs.observed")}>
          {snapshots.map((snapshot, index) => (
            <li
              key={snapshot.uuid ?? snapshot.name ?? index}
              className="flex min-w-0 items-center gap-2 rounded-lg bg-background-base/45 px-2 py-1.5"
            >
              <span
                className="min-w-0 flex-1 truncate text-13-mono text-text-weak"
                title={snapshotEvidenceLabel(snapshot)}
              >
                {snapshotEvidenceLabel(snapshot)}
              </span>
              {snapshot.purgeable ? (
                <span className="shrink-0 rounded-full bg-surface-raised-strong px-1.5 py-0.5 text-13-semibold text-text-weak">
                  {language.t("disk.common.purgeable")}
                </span>
              ) : null}
              {snapshot.isTimeMachine ? (
                <span className="shrink-0 rounded-full bg-surface-raised-strong px-1.5 py-0.5 text-13-semibold text-text-weak">
                  {language.t("disk.common.timeMachine")}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )

  if (props.embedded) {
    return (
      <section className={props.className} aria-label={language.t("disk.apfs.evidence")}>
        <p className="text-13-semibold text-text-strong">
          {language.t("disk.apfs.heading")}
          <span className="ml-1.5 font-normal text-text-weaker">
            {snapshotEvidenceCaption(snapshotCount, snapshots.length)}
          </span>
        </p>
        {evidence}
      </section>
    )
  }

  return (
    <details className={`group mt-2 rounded-xl bg-surface-raised-base/75 px-3 py-2 ${props.className ?? ""}`}>
      <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
        <span className="flex items-center justify-between gap-3">
          <span>
            <span className="text-13-semibold text-text-strong">{language.t("disk.apfs.heading")}</span>
            <span className="ml-1.5 text-13-regular text-text-weaker">
              {snapshotEvidenceCaption(snapshotCount, snapshots.length)}
            </span>
          </span>
          <span
            className="text-13-semibold text-text-weak transition-transform duration-150 group-open:rotate-90"
            aria-hidden="true"
          >
            ›
          </span>
        </span>
      </summary>

      {evidence}
    </details>
  )
}
