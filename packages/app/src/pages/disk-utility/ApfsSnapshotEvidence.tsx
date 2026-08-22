import { For, Show } from "solid-js"
import type { ApfsSnapshotEvidence } from "@disklizard/core"

export function snapshotEvidenceLabel(snapshot: ApfsSnapshotEvidence): string {
  return snapshot.name ?? snapshot.uuid ?? "Unnamed APFS snapshot"
}

export function snapshotEvidenceCaption(snapshotCount: number, visibleCount: number): string {
  if (visibleCount === 0) {
    return snapshotCount === 1
      ? "1 APFS snapshot is present; macOS did not provide an identity."
      : `${snapshotCount} APFS snapshots are present; macOS did not provide identities.`
  }
  if (visibleCount < snapshotCount) {
    return `${snapshotCount} APFS snapshots are present; showing ${visibleCount} read-only identities.`
  }
  return `${snapshotCount === 1 ? "1 APFS snapshot is" : `${snapshotCount} APFS snapshots are`} present.`
}

/**
 * Evidence, not a cleanup control: APFS snapshot byte ownership is not exposed
 * reliably by macOS, so this makes their presence inspectable without a made-up size.
 */
export function ApfsSnapshotEvidenceList(props: {
  snapshotCount?: number
  snapshots?: readonly ApfsSnapshotEvidence[]
  class?: string
  embedded?: boolean
}) {
  const snapshotCount = () => props.snapshotCount ?? 0
  const snapshots = () => props.snapshots ?? []
  if (snapshotCount() < 1) return null

  const evidence = () => (
    <div class={props.embedded ? "mt-2" : "mt-2 border-t border-border-weaker-base pt-2"}>
      <p class="max-w-[62ch] text-13-regular leading-relaxed text-text-weaker">
        macOS does not report reliable per-snapshot bytes when copy-on-write blocks are shared. These identities are
        read-only evidence, not a size estimate or a deletion action.
      </p>
      <Show when={snapshots().length > 0}>
        <ul class="mt-2 space-y-1.5" aria-label="Observed APFS snapshots">
          <For each={snapshots()}>
            {(snapshot) => (
              <li class="flex min-w-0 items-center gap-2 rounded-lg bg-background-base/45 px-2 py-1.5">
                <span class="min-w-0 flex-1 truncate text-13-mono text-text-weak" title={snapshotEvidenceLabel(snapshot)}>
                  {snapshotEvidenceLabel(snapshot)}
                </span>
                <Show when={snapshot.purgeable}>
                  <span class="shrink-0 rounded-full bg-surface-raised-strong px-1.5 py-0.5 text-13-semibold text-text-weak">
                    Purgeable
                  </span>
                </Show>
                <Show when={snapshot.isTimeMachine}>
                  <span class="shrink-0 rounded-full bg-surface-raised-strong px-1.5 py-0.5 text-13-semibold text-text-weak">
                    Time Machine
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
      <section class={props.class} aria-label="APFS snapshot evidence">
        <p class="text-13-semibold text-text-strong">
          APFS snapshots
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
            <span class="text-13-semibold text-text-strong">APFS snapshots</span>
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
