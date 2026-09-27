import type { DiskScanNode } from "./types"
import { formatBytes } from "./format"
import { diskLanguageText, useLanguage } from "./runtime"

export type StorageAccountingFact = {
  label: string
  detail: string
}

/**
 * Explain exceptional byte accounting without pretending an individual path
 * owns bytes that its filesystem says are shared.
 */
export function storageAccountingFacts(
  node: DiskScanNode
): StorageAccountingFact[] {
  const facts: StorageAccountingFact[] = []
  if (node.logicalSize !== undefined && node.logicalSize !== node.size) {
    facts.push({
      label: diskLanguageText("disk.accounting.fileSize", {
        size: formatBytes(node.logicalSize),
      }),
      detail: diskLanguageText("disk.accounting.fileSizeDetail", {
        size: formatBytes(node.size),
        logicalSize: formatBytes(node.logicalSize),
      }),
    })
  }
  if (node.hardLink === "secondary") {
    facts.push({
      label: diskLanguageText("disk.accounting.hardLink"),
      detail: diskLanguageText("disk.accounting.hardLinkDetail"),
    })
  }
  if (node.cloneAccounting === "primary") {
    facts.push({
      label: diskLanguageText("disk.accounting.clonePrimary"),
      detail: diskLanguageText("disk.accounting.clonePrimaryDetail"),
    })
  }
  if (node.cloneAccounting === "secondary") {
    facts.push({
      label: diskLanguageText("disk.accounting.cloneSecondary"),
      detail: diskLanguageText("disk.accounting.cloneSecondaryDetail"),
    })
  }
  if (node.clone?.state === "may-share-blocks") {
    facts.push({
      label: diskLanguageText("disk.accounting.cloneMaybe"),
      detail: diskLanguageText("disk.accounting.cloneMaybeDetail"),
    })
  }
  if (node.clone?.state === "shares-all-blocks" && !node.cloneAccounting) {
    facts.push({
      label: diskLanguageText("disk.accounting.cloneShares"),
      detail: node.clone.reportedFullCloneCount
        ? diskLanguageText("disk.accounting.cloneSharesCount", {
            count: node.clone.reportedFullCloneCount,
          })
        : diskLanguageText("disk.accounting.cloneSharesDetail"),
    })
  }
  return facts
}

export function StorageAccountingFacts(props: {
  node: DiskScanNode
  className?: string
}) {
  const language = useLanguage()
  const facts = storageAccountingFacts(props.node)
  return facts.length > 0 ? (
    <div
      className={`flex max-w-full flex-wrap items-start gap-1.5 ${props.className ?? ""}`}
      aria-label={language.t("disk.accounting.label")}
    >
      {facts.map((fact) => (
        <details key={fact.label} className="max-w-full">
          <summary className="text-13-semibold flex min-h-11 max-w-full min-w-11 cursor-pointer list-none items-center rounded-full bg-surface-raised-base px-2 py-0.5 text-text-weak shadow-[inset_0_0_0_1px_rgb(127_127_127/0.1)] outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
            <span className="truncate">{fact.label}</span>
            <span className="ml-1 shrink-0 text-text-weaker" aria-hidden="true">
              ?
            </span>
          </summary>
          <div
            role="note"
            className="text-13-regular mt-1 w-[min(20rem,calc(100vw-3rem))] max-w-full rounded-xl bg-background-base px-3 py-2 leading-relaxed text-text-weak shadow-[inset_0_0_0_1px_rgb(127_127_127/0.12)]"
          >
            {fact.detail}
          </div>
        </details>
      ))}
    </div>
  ) : null
}
