/**
 * @disklizard/core — shared core for Desktop (Electron) + TUI
 *
 *   import { scanPath, formatBytes, buildCrumbs } from "@disklizard/core"
 *   bun packages/disklizard/bin/disklizard.ts   # terminal UI
 */

export type {
  CloneEvidence,
  CloneAccounting,
  CloneMetadataCapability,
  SharedStorageEvidence,
  DeveloperArtifactEcosystem,
  DeveloperArtifactKind,
  DeveloperArtifactConfidence,
  DeveloperArtifactCleanupReadiness,
  DeveloperArtifactDirectoryIdentity,
  DeveloperArtifact,
  DeveloperArtifactInventory,
  DeveloperArtifactInventoryStatus,
  DeveloperArtifactInventoryOptions,
  DriveFacts,
  DiskNode,
  DriveInfo,
  ApfsSnapshotEvidence,
  ScanProgress,
  ScanDiscovery,
  ScanOptions,
  ScanIssueSummary,
  Crumb,
} from "./types"
export { formatBytes, formatPct, truncate, pad } from "./format"
export { buildCrumbs, findParent, findNode, sortedChildren, canDrill } from "./tree"
export { canDeletePath, deletionBlockReason, type DiskPlatform } from "./safety"
export {
  DEVELOPER_ARTIFACT_EVIDENCE_NAMES,
  classifyDeveloperArtifact,
  normalizeDeveloperArtifactInventoryOptions,
  type DeveloperArtifactClassification,
} from "./developer-artifacts"
export {
  scanPath,
  scanPathSync,
  normalizeScanConcurrency,
  normalizeScanOptions,
  getDrives,
  getDriveDiscovery,
  getDriveFacts,
  mountExclusions,
  assertSafeDeletionPath,
  deleteDiskPath,
  type DriveDiscovery,
} from "./scan"
export { renderTuiBars, renderTuiHeader, renderTuiHelp } from "./tui/render"
export { diskLizardCliHelp, formatDiskLizardJson, formatDiskLizardSummary, parseDiskLizardCliArgs, runDiskLizardCli } from "./cli"
export { scanPathWithBackend, describeScanResult, type ScanBackend, type ScanBackendResult } from "./backend"
export { generateGoldenCorpus, accountingFromTree, formatBenchmarkReport } from "./fixtures"
export { nativeScannerAvailable, nativeScannerPath, scanPathNative } from "./native"
export { scanWorkerHref } from "./scan"
