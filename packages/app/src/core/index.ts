/**
 * @disklizard/core subset vendored for the v2 React UI.
 * Only the modules the renderer needs: shared types, path safety, and
 * developer-artifact classification. Scanner/CLI/native modules stay desktop-side.
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
export { canDeletePath, deletionBlockReason, type DiskPlatform } from "./safety"
export {
  DEVELOPER_ARTIFACT_EVIDENCE_NAMES,
  DEVELOPER_PROJECT_MARKER_NAMES,
  classifyDeveloperArtifact,
  developerProjectMarkers,
  normalizeDeveloperArtifactInventoryOptions,
  type DeveloperArtifactClassification,
} from "./developer-artifacts"
