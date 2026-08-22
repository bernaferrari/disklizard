import { For, Show } from "solid-js"
import type { DiskScanNode } from "@/context/platform"
import { formatBytes } from "./format"

export type StorageAccountingFact = {
  label: string
  detail: string
}

/**
 * Explain exceptional byte accounting without pretending an individual path
 * owns bytes that its filesystem says are shared.
 */
export function storageAccountingFacts(node: DiskScanNode): StorageAccountingFact[] {
  const facts: StorageAccountingFact[] = []
  if (node.logicalSize !== undefined && node.logicalSize !== node.size) {
    facts.push({
      label: `File size ${formatBytes(node.logicalSize)}`,
      detail: `This item occupies ${formatBytes(node.size)} in the current scan but has an apparent length of ${formatBytes(node.logicalSize)}.`,
    })
  }
  if (node.hardLink === "secondary") {
    facts.push({
      label: "Shared hard link",
      detail: "This pathname shares the same allocation as an earlier hard link, so it is not charged a second time.",
    })
  }
  if (node.cloneAccounting === "primary") {
    facts.push({
      label: "Clone group charged once",
      detail:
        "Every full clone in this group was observed by the scan. This pathname carries the shared allocation exactly once; the other clone paths retain their apparent file size.",
    })
  }
  if (node.cloneAccounting === "secondary") {
    facts.push({
      label: "Clone allocation counted once",
      detail:
        "Every full clone in this group was observed by the scan. Its shared allocation is charged to the canonical clone, so this pathname adds no extra physical bytes.",
    })
  }
  if (node.clone?.state === "may-share-blocks") {
    facts.push({
      label: "APFS clone may share blocks",
      detail: "The filesystem reports possible shared blocks. DiskLizard does not guess which bytes belong to this pathname.",
    })
  }
  if (node.clone?.state === "shares-all-blocks" && !node.cloneAccounting) {
    facts.push({
      label: "APFS clone shares blocks",
      detail: node.clone.reportedFullCloneCount
        ? `The filesystem reports ${node.clone.reportedFullCloneCount} full clones. Byte ownership stays explicit unless every member is present in this scan.`
        : "The filesystem reports that this file shares all of its blocks with a clone.",
    })
  }
  return facts
}

export function StorageAccountingFacts(props: { node: DiskScanNode; class?: string }) {
  const facts = () => storageAccountingFacts(props.node)
  return (
    <Show when={facts().length > 0}>
      <div class={`flex max-w-full flex-wrap items-start gap-1.5 ${props.class ?? ""}`} aria-label="Storage accounting details">
        <For each={facts()}>
          {(fact) => (
            <details class="max-w-full">
              <summary class="dl-touch-target flex min-h-11 max-w-full cursor-pointer list-none items-center rounded-full bg-surface-raised-base px-2 py-0.5 text-13-semibold text-text-weak shadow-[inset_0_0_0_1px_rgb(127_127_127/0.1)] outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
                <span class="truncate">{fact.label}</span>
                <span class="ml-1 shrink-0 text-text-weaker" aria-hidden="true">
                  ?
                </span>
              </summary>
              <div
                role="note"
                class="mt-1 w-[min(20rem,calc(100vw-3rem))] max-w-full rounded-xl bg-background-base px-3 py-2 text-13-regular leading-relaxed text-text-weak shadow-[inset_0_0_0_1px_rgb(127_127_127/0.12)]"
              >
                {fact.detail}
              </div>
            </details>
          )}
        </For>
      </div>
    </Show>
  )
}
