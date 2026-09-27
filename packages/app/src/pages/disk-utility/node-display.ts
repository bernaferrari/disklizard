import { diskLanguagePlural, diskLanguageText } from "./runtime"
import type { DiskScanNode } from "./types"

/** Metadata-backed display copy for synthetic scanner and visual aggregates. */
export function diskNodeDisplayName(
  node: Pick<DiskScanNode, "name" | "isOther" | "isHidden" | "otherCount">
) {
  if (!node.isOther || node.isHidden) return node.name
  if (Number.isSafeInteger(node.otherCount) && node.otherCount! > 0) {
    return diskLanguagePlural("disk.node.other", node.otherCount!)
  }
  return diskLanguageText("disk.node.otherUnknown")
}
