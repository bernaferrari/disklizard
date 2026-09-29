import type { DeveloperArtifactInventory } from "@/core"
import { diskLanguagePlural, diskLanguageText } from "./runtime"

type InventoryIssueRow = { label: string; count: number; paths: string[] }

export function developerInventoryCoverage(
  inventory: DeveloperArtifactInventory
): string {
  const { status } = inventory
  const observed = diskLanguageText("disk.developer.inventory.observed", {
    artifacts: diskLanguagePlural(
      "disk.count.artifact",
      status.matchedDirectories
    ),
    folders: diskLanguagePlural("disk.count.folder", status.scannedDirectories),
  })
  if (status.state === "complete")
    return diskLanguageText("disk.developer.inventory.complete", { observed })
  const skippedDirectoryCount = status.skippedDirectoryCount ?? 0
  const unavailableDirectoryIdentityCount =
    status.unavailableDirectoryIdentityCount ?? 0
  const gaps = [
    status.truncated
      ? diskLanguageText("disk.developer.inventory.capGap", {
          count: inventory.items.length.toLocaleString(),
          max: status.maxItems.toLocaleString(),
        })
      : undefined,
    status.unreadableCount
      ? diskLanguageText("disk.developer.inventory.unreadableGap", {
          count: status.unreadableCount.toLocaleString(),
        })
      : undefined,
    status.excludedCount
      ? diskLanguageText("disk.developer.inventory.excludedGap", {
          count: status.excludedCount.toLocaleString(),
        })
      : undefined,
    status.skippedSymlinkCount
      ? diskLanguagePlural(
          "disk.count.symlinkSkipped",
          status.skippedSymlinkCount
        )
      : undefined,
    skippedDirectoryCount
      ? diskLanguagePlural("disk.count.folderSkipped", skippedDirectoryCount)
      : undefined,
    unavailableDirectoryIdentityCount
      ? diskLanguagePlural(
          "disk.count.artifactRefresh",
          unavailableDirectoryIdentityCount
        )
      : undefined,
  ].filter((value): value is string => !!value)
  return diskLanguageText("disk.developer.inventory.partial", {
    observed,
    gaps: gaps.length
      ? ` · ${gaps.join(" · ")}`
      : diskLanguageText("disk.developer.inventory.incomplete"),
  })
}

export function developerInventoryIssueRows(
  inventory: DeveloperArtifactInventory
): InventoryIssueRow[] {
  const { status } = inventory
  return [
    {
      label: diskLanguageText("disk.developer.inventory.issueUnreadable"),
      count: status.unreadableCount,
      paths: status.unreadableSamplePaths,
    },
    {
      label: diskLanguageText("disk.developer.inventory.issueExcluded"),
      count: status.excludedCount,
      paths: status.excludedSamplePaths,
    },
    {
      label: diskLanguageText("disk.developer.inventory.issueSymlinks"),
      count: status.skippedSymlinkCount,
      paths: status.skippedSymlinkSamplePaths,
    },
    {
      label: diskLanguageText("disk.developer.inventory.issueFolders"),
      count: status.skippedDirectoryCount ?? 0,
      paths: status.skippedDirectorySamplePaths ?? [],
    },
    {
      label: diskLanguageText("disk.developer.inventory.issueRefresh"),
      count: status.unavailableDirectoryIdentityCount ?? 0,
      paths: status.unavailableDirectoryIdentitySamplePaths ?? [],
    },
  ].filter((issue) => issue.count > 0)
}
