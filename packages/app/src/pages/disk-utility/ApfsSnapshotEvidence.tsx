import { For, Show } from "solid-js"
import type { ApfsSnapshotEvidence } from "@disklizard/core"
import { diskLanguageText, useLanguage } from "./runtime"

export function snapshotEvidenceLabel(snapshot: ApfsSnapshotEvidence): string {
  return snapshot.name ?? snapshot.uuid ?? diskLanguageText("disk.apfs.unnamed")
}

export function snapshotEvidenceCaption(snapshotCount: number, visibleCount: number): string {
  if (visibleCount === 0) {
    return snapshotCount === 1
      ? diskLanguageText("disk.apfs.noIdentity.one")
      : diskLanguageText("disk.apfs.noIdentity.other", { count: snapshotCount })
  }
  if (visibleCount < snapshotCount) {
    return diskLanguageText("disk.apfs.showing", { count: snapshotCount, visible: visibleCount })
  }
  return snapshotCount === 1
    ? diskLanguageText("disk.apfs.present.one")
    : diskLanguageText("disk.apfs.present.other", { count: snapshotCount })
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
  class?: string
  embedded?: boolean
}) {
  const language = useLanguage()
  const snapshotCount = () => props.snapshotCount ?? 0
  const snapshots = () => props.snapshots ?? []
  const countSummary = () => {
    const parts = []
    if (props.purgeableSnapshotCount) {
      parts.push(language.plural("disk.apfs.purgeableCount", props.purgeableSnapshotCount))
    }
    if (props.timeMachineSnapshotCount) {
      parts.push(language.plural("disk.apfs.timeMachineCount", props.timeMachineSnapshotCount))
    }
    return parts.join(" · ")
  }
  if (snapshotCount() < 1) return null

  const evidence = () => (
    <div class={props.embedded ? "mt-2" : "mt-2 border-t border-border-weaker-base pt-2"}>
      <p class="max-w-[62ch] text-13-regular leading-relaxed text-text-weaker">
        {language.t("disk.apfs.body")}
      </p>
      <Show when={countSummary()}>
        <p class="mt-1.5 text-13-regular tabular-nums text-text-weaker">{countSummary()}</p>
      </Show>
      <Show when={snapshots().length > 0}>
        <ul class="mt-2 space-y-1.5" aria-label={language.t("disk.apfs.observed")}>
          <For each={snapshots()}>
            {(snapshot) => (
              <li class="flex min-w-0 items-center gap-2 rounded-lg bg-background-base/45 px-2 py-1.5">
                <span class="min-w-0 flex-1 truncate text-13-mono text-text-weak" title={snapshotEvidenceLabel(snapshot)}>
                  {snapshotEvidenceLabel(snapshot)}
                </span>
                <Show when={snapshot.purgeable}>
                  <span class="shrink-0 rounded-full bg-surface-raised-strong px-1.5 py-0.5 text-13-semibold text-text-weak">
                    {language.t("disk.common.purgeable")}
                  </span>
                </Show>
                <Show when={snapshot.isTimeMachine}>
                  <span class="shrink-0 rounded-full bg-surface-raised-strong px-1.5 py-0.5 text-13-semibold text-text-weak">
                    {language.t("disk.common.timeMachine")}
                  </span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )

  if (props.embedded) {
    return (
      <section class={props.class} aria-label={language.t("disk.apfs.evidence")}>
        <p class="text-13-semibold text-text-strong">
          {language.t("disk.apfs.heading")}
          <span class="ml-1.5 font-normal text-text-weaker">
            {snapshotEvidenceCaption(snapshotCount(), snapshots().length)}
          </span>
        </p>
        {evidence()}
      </section>
    )
  }

  return (
    <details class={`group mt-2 rounded-xl bg-surface-raised-base/75 px-3 py-2 ${props.class ?? ""}`}>
      <summary class="dl-touch-target flex min-h-11 cursor-pointer list-none items-center outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
        <span class="flex items-center justify-between gap-3">
          <span>
            <span class="text-13-semibold text-text-strong">{language.t("disk.apfs.heading")}</span>
            <span class="ml-1.5 text-13-regular text-text-weaker">
              {snapshotEvidenceCaption(snapshotCount(), snapshots().length)}
            </span>
          </span>
          <span class="text-13-semibold text-text-weak transition-transform duration-150 group-open:rotate-90" aria-hidden="true">
            ›
          </span>
        </span>
      </summary>

      {evidence()}
    </details>
  )
}
