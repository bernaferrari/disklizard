import type {
  ApfsSnapshotEvidence,
  CloneAccounting,
  CloneEvidence,
  CloneMetadataCapability,
  DeveloperArtifact,
  DeveloperArtifactDirectoryIdentity,
  DeveloperArtifactInventory,
  DeveloperArtifactInventoryOptions,
  DriveFacts,
  SharedStorageEvidence,
} from "@disklizard/core"

/** Desktop disk utility (DiskLizard) — IPC from Electron main */
export type DiskDriveInfo = {
  path: string
  name: string
  label: string
  total: number
  free: number
  used: number
  type: "local" | "removable" | "network"
  /** Filesystem reported by the operating system, when available. */
  filesystem?: string
  /** APFS containers share this free capacity across their volumes. */
  sharedFree?: number
  /** APFS snapshots observed on this mounted volume. Their byte size is not reported reliably by macOS. */
  snapshotCount?: number
  purgeableSnapshotCount?: number
  timeMachineSnapshotCount?: number
  /** Bounded read-only APFS snapshot identities; no per-snapshot byte estimate is available. */
  apfsSnapshots?: ApfsSnapshotEvidence[]
}

/** Fresh-delete proof used only by bounded deep developer-artifact records. */
export type DiskDeveloperArtifactDeletePrecondition = {
  kind: "developer-artifact"
  /** Required by desktop cleanup; absence means rescan, never shape-only Trash. */
  directoryIdentity?: DeveloperArtifactDirectoryIdentity
  artifact: Pick<DeveloperArtifact, "name" | "kind" | "ecosystem" | "confidence" | "cleanup">
}

export type DiskDeleteOptions = {
  authorization: string
  precondition?: DiskDeveloperArtifactDeletePrecondition
}

/** Already-mounted storage roots discovered locally; no account or remote service is queried. */
export type DiskStorageLocation = {
  path: string
  name: string
  kind: "cloud" | "network"
  provider: "box" | "dropbox" | "google-drive" | "icloud" | "network" | "onedrive" | "other"
}

/** Evidence from conservative local probes, never a claim that an OS permission has been granted. */
export type DiskAccessDiagnostic = {
  status: "inconclusive" | "limited" | "not-applicable" | "unavailable"
  probes: Array<{
    name: "Contacts" | "Mail" | "Safari"
    status: "denied" | "missing" | "readable" | "unavailable"
  }>
  wholeVolume: {
    capability: "macos-full-disk-access" | "windows-elevated-token" | "not-applicable"
    status: "granted" | "limited" | "inconclusive" | "not-applicable"
    mapCoverage: "not-known-to-be-permission-limited" | "may-be-incomplete" | "unknown" | "not-applicable"
    evidence:
      | {
          source: "protected-directory-probes"
          probes: Array<{
            name: "Contacts" | "Mail" | "Safari"
            status: "denied" | "missing" | "readable" | "unavailable"
          }>
        }
      | {
          source: "windows-token-groups"
          integrityLevel: "low" | "medium" | "high" | "system" | "protected" | "unknown"
          administratorsGroup: "present" | "absent" | "unknown"
        }
      | { source: "none" }
  }
}

export type DiskStorageDiagnostics = {
  access: DiskAccessDiagnostic
  locations: DiskStorageLocation[]
}

export type DiskScanNode = {
  name: string
  path: string
  size: number
  logicalSize?: number
  modifiedAt?: number
  hardLink?: "primary" | "secondary"
  /** Filesystem clone evidence; it never changes the charged byte count. */
  clone?: CloneEvidence
  /** Exact full-clone charging is present only for groups completely observed in this scan. */
  cloneAccounting?: CloneAccounting
  /** Scan-root-only capability; absent or non-available means clone sharing was not fully assessed. */
  cloneMetadata?: CloneMetadataCapability
  /** Scan-root-only boundary; only `complete` permits physical reclaim estimates. */
  sharedStorageEvidence?: SharedStorageEvidence
  isDir: boolean
  children: DiskScanNode[]
  ext: string
  isOther?: boolean
  isHidden?: boolean
  isCollapsed?: boolean
  signatures?: string[]
  scanIssues?: { unreadableCount: number; samplePaths: string[] }
  /** Root-only, opt-in deep developer artifact index outside the visual tree. */
  developerArtifactInventory?: DeveloperArtifactInventory
  _label?: string
}

export type DiskScanProgress = {
  scanId: string
  filesScanned: number
  dirsScanned?: number
  currentPath: string
  size: number
  discovery?: Pick<DiskScanNode, "name" | "path" | "size" | "modifiedAt" | "isDir">
  done?: boolean
  /** Completion provenance; only `scan` represents a new full traversal. */
  source?: "scan" | "snapshot" | "delta"
}

export type DiskScanUpdate = {
  scanId: string
  rootPath: string
  root: DiskScanNode
  changedPaths: string[]
  watchError?: string
}

/** Optional local filesystem facts that arrive after the first drive list. */
export type DiskDriveFactsUpdate = {
  path: string
  facts: DriveFacts
}

export type DiskFilePreview =
  | { kind: "image"; mime: string; dataUrl: string; bytes: number }
  | { kind: "pdf"; dataUrl: string; bytes: number }
  | { kind: "text"; text: string; bytes: number; truncated: boolean }
  | { kind: "unsupported"; bytes: number; reason: "binary" | "directory" | "format" | "too-large" }

export type DiskUtilityAPI = {
  getDrives(): Promise<DiskDriveInfo[]>
  onDriveFacts(cb: (update: DiskDriveFactsUpdate) => void): () => void
  getStorageDiagnostics(): Promise<DiskStorageDiagnostics>
  /** Opens the OS privacy page when that platform exposes one. */
  openDiskAccessSettings(): Promise<boolean>
  scanPath(
    path: string,
    options?: {
      maxDepth?: number
      sizeMode?: "physical" | "logical"
      /** Recompute instead of restoring an otherwise unchanged local map. */
      forceFresh?: boolean
      preserveNames?: string[]
      collapseNames?: string[]
      signatureNames?: string[]
      developerArtifactInventory?: boolean | DeveloperArtifactInventoryOptions
    },
    scanId?: string,
  ): Promise<DiskScanNode | null>
  cancelScan(scanId?: string): Promise<void>
  stopWatching(scanId?: string): Promise<void>
  authorizeDeletePaths(paths: readonly string[]): Promise<Array<{ path: string; authorization: string }>>
  deletePath(path: string, options: DiskDeleteOptions): Promise<{ ok: true }>
  previewPath(path: string): Promise<DiskFilePreview>
  systemPreviewPath(path: string): Promise<void>
  openTrash(): Promise<void>
  revealPath(path: string): Promise<void>
  chooseFolder(): Promise<string | null>
  onScanProgress(cb: (progress: DiskScanProgress) => void): () => void
  onScanUpdate(cb: (update: DiskScanUpdate) => void): () => void
}

export type DiskPinnedLocation = {
  path: string
  label: string
}

export const diskPinnedLocationsDefault: DiskPinnedLocation[] = []

/** User lock: the tree stays visible on the map but cannot enter review or Trash. */
export type DiskCleanupLock = {
  path: string
  label: string
}

export const diskCleanupLocksDefault: DiskCleanupLock[] = []

export type DiskAccessGuidanceKey =
  | "disk.accessGuidance.macos"
  | "disk.accessGuidance.windows"
  | "disk.accessGuidance.linux"
  | "disk.accessGuidance.default"
  | "disk.accessGuidance.rescan"
