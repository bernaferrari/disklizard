import { describe, expect, it } from "bun:test"
import type { DeveloperArtifactInventory } from "@/core"
import {
  developerInventoryCoverage,
  developerInventoryIssueRows,
} from "./DeveloperCleanupPolicy"

const inventory: DeveloperArtifactInventory = {
  items: [],
  status: {
    state: "partial",
    maxItems: 2_000,
    scannedDirectories: 8,
    matchedDirectories: 0,
    truncated: false,
    unreadableCount: 0,
    unreadableSamplePaths: [],
    excludedCount: 0,
    excludedSamplePaths: [],
    skippedSymlinkCount: 0,
    skippedSymlinkSamplePaths: [],
    skippedDirectoryCount: 2,
    skippedDirectorySamplePaths: [
      "/workspace/other-volume",
      "/workspace/cycle",
    ],
    unavailableDirectoryIdentityCount: 1,
    unavailableDirectoryIdentitySamplePaths: [
      "/workspace/project/node_modules",
    ],
  },
}

describe("DeveloperCleanupPolicy inventory coverage", () => {
  it("makes cross-device, cycle, and unavailable-identity folders explicit in partial coverage", () => {
    expect(developerInventoryCoverage(inventory)).toContain(
      "2 folders skipped (other device, cycle, or unavailable identity)"
    )
    expect(developerInventoryIssueRows(inventory)).toContainEqual({
      label: "Skipped folders (other device, cycle, or unavailable identity)",
      count: 2,
      paths: ["/workspace/other-volume", "/workspace/cycle"],
    })
    expect(developerInventoryCoverage(inventory)).toContain(
      "1 retained artifact needs a fresh scan before Trash"
    )
    expect(developerInventoryIssueRows(inventory)).toContainEqual({
      label: "Retained artifacts needing a fresh scan before Trash",
      count: 1,
      paths: ["/workspace/project/node_modules"],
    })
  })
})
