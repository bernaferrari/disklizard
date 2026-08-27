/** Shared DiskLizard types — Desktop + TUI consume the same shapes */

/**
 * Evidence reported for one regular file's possible block sharing.
 *
 * This is deliberately evidence, not an ownership calculation. APFS can say
 * that files share all or some blocks, but it cannot safely assign those bytes
 * to one path inside an arbitrary partial scan. Evidence alone never changes
 * `size`; only `cloneAccounting` can do so after a complete group is proven.
 */
export type CloneEvidence =
  | {
      /** The scanner could not ask the filesystem for clone metadata. */
      state: "unavailable"
      reason: "platform" | "filesystem" | "scanner"
    }
  | {
      /** Some clone metadata was returned, but not enough to classify sharing safely. */
      state: "unknown"
    }
  | {
      /** The filesystem reported no shared-block flags for this file. */
      state: "not-shared"
    }
  | {
      /** The filesystem reports that this file may share only part of its allocation. */
      state: "may-share-blocks"
      /** Opaque filesystem identifier. Never parse or do arithmetic with it. */
      cloneId?: string
    }
  | {
      /** The filesystem reports that this file shares all of its blocks with another file. */
      state: "shares-all-blocks"
      /** Opaque filesystem identifier. Equal IDs identify a full-clone data stream. */
      cloneId?: string
      /** Filesystem-reported count; it may include matching files outside this scan. */
      reportedFullCloneCount?: number
    }

/**
 * Set only when a complete APFS full-clone group is proven to be represented
 * by the scanned tree. The primary carries the shared physical allocation;
 * secondaries retain their logical size but charge zero additional bytes.
 */
export type CloneAccounting = "primary" | "secondary"

/**
 * Scan-root capability for APFS clone metadata. It is intentionally separate
 * from per-file `clone` evidence so a fallback scanner can be truthful without
 * adding inert data to every file node.
 */
export type CloneMetadataCapability =
  | { state: "available" }
  | { state: "unknown" }
  | {
      state: "unavailable"
      reason: "platform" | "filesystem" | "scanner"
    }

/**
 * Whether every retained path that may share physical storage still has
 * per-node evidence in this scan tree. `partial` is a safety boundary, not a
 * byte estimate: an omitted, unreadable, or unsupported branch may contain a
 * hard link or APFS clone whose ownership cannot be shown in the map.
 */
export type SharedStorageEvidence = "complete" | "partial"

/**
 * Ecosystem inferred from a recognized developer artifact. `generic` means a
 * conventional directory name (for example `build`) did not carry enough
 * local evidence to identify a toolchain safely.
 *
 * Keep this aligned with the renderer's developer-artifact filters. The
 * scanner reports an observed directory and its evidence; it never assumes a
 * project can be rebuilt merely because it has a familiar name.
 */
export type DeveloperArtifactEcosystem =
  | "node"
  | "python"
  | "rust"
  | "jvm"
  | "cpp"
  | "go"
  | "dotnet"
  | "dart"
  | "apple"
  | "web"
  | "containers"
  | "tooling"
  | "generic"
  | "agent"
  | "git"

/** Broad cleanup grouping, deliberately smaller than the UI's full taxonomy. */
export type DeveloperArtifactKind = "dependencies" | "build-output" | "toolchain-cache"

/** Strength of recognition derived from a name and direct child evidence. */
export type DeveloperArtifactConfidence = "verified" | "likely" | "ambiguous"

/**
 * Safe bulk-selection posture. `eligible` still means “send to Trash and
 * review”, never immediate deletion. `review` is intentionally never a
 * default selection because names such as `build`, `target`, and `vendor` are
 * not sufficiently specific on their own.
 */
export type DeveloperArtifactCleanupReadiness = "eligible" | "review"

/**
 * Opaque identity for the artifact directory itself, captured during the
 * scan. It is intentionally separate from an artifact's aggregate
 * `modifiedAt`, which reflects its newest descendant and cannot be verified
 * with a single directory `lstat` before Trash.
 *
 * Values are strings to preserve filesystem identifiers beyond JavaScript's
 * safe integer range. `modifiedAt` is the directory's direct mtime rounded
 * down to milliseconds, matching native scanner precision.
 */
export type DeveloperArtifactDirectoryIdentity = {
  /**
   * Filesystem-stat representation used for the opaque device/file id pair.
   * Native Windows scans intentionally omit this identity because their file
   * identifiers are not known to be equivalent to Node's `lstat` values.
   */
  platform: "posix" | "windows"
  device: string
  fileId: string
  modifiedAt: number
}

/**
 * A separately-indexed developer artifact that can sit below the visual
 * tree's depth / child limits. It is node-like so the renderer can reuse its
 * detail and selection presentation, but it is not present in `children`.
 *
 * `size` is the scanner's exact aggregate allocation for this pathname in the
 * requested size mode. Items can nest (for example a package may contain a
 * nested `node_modules`), so callers must remove descendant paths before
 * totaling or batch-selecting them.
 */
export type DeveloperArtifact = {
  name: string
  path: string
  size: number
  logicalSize?: number
  modifiedAt?: number
  /** Direct-directory identity for stale-result protection before Trash. */
  directoryIdentity?: DeveloperArtifactDirectoryIdentity
  isDir: true
  /** Direct-entry markers used to classify a generic artifact, normalized to lowercase. */
  signatures?: string[]
  kind: DeveloperArtifactKind
  ecosystem: DeveloperArtifactEcosystem
  confidence: DeveloperArtifactConfidence
  cleanup: DeveloperArtifactCleanupReadiness
  /** Short, machine-readable local observations such as `name:node_modules`. */
  evidence: string[]
  /** Distinguishes this deep index entry from a materialized visual tree node. */
  inventoryOnly: true
}

/**
 * Scope accounting for an opt-in deep developer-artifact index. `partial`
 * does not turn a candidate unsafe; it tells the user that permissions,
 * exclusions, symlinks, directory-identity boundaries, or the bounded result
 * limit left some paths outside the inventory's observable scope.
 */
export type DeveloperArtifactInventoryStatus = {
  state: "complete" | "partial"
  maxItems: number
  scannedDirectories: number
  matchedDirectories: number
  truncated: boolean
  unreadableCount: number
  unreadableSamplePaths: string[]
  skippedSymlinkCount: number
  skippedSymlinkSamplePaths: string[]
  /**
   * Traversal declined these directories because they crossed the root device,
   * repeated an observed directory identity, or lacked the identity needed to
   * prove cycle-safe deep scope. Optional for compatibility with older native
   * compact payloads; current scanners emit it.
   */
  skippedDirectoryCount?: number
  skippedDirectorySamplePaths?: string[]
  /**
   * Retained deep records which could not carry a direct directory identity.
   * They remain visible for review, but cannot safely be used for a stale-safe
   * delete until a fresh scan produces an identity. Optional so older native
   * compact payloads remain readable; current scanners always emit it.
   */
  unavailableDirectoryIdentityCount?: number
  unavailableDirectoryIdentitySamplePaths?: string[]
  excludedCount: number
  excludedSamplePaths: string[]
}

/** Root-only, bounded inventory produced only when the caller opts in. */
export type DeveloperArtifactInventory = {
  items: DeveloperArtifact[]
  status: DeveloperArtifactInventoryStatus
}

export type DeveloperArtifactInventoryOptions = {
  /** Cap retained records, while `matchedDirectories` still reports the full observed count. */
  maxItems?: number
}

export type DiskNode = {
  name: string
  path: string
  /**
   * Bytes charged to this node for the map. Physical allocation by default;
   * it is not a promise of bytes reclaimed by deleting this pathname.
   */
  size: number
  /**
   * Apparent byte length when it differs from `size`. Directories aggregate
   * descendant file lengths, including every hard-link pathname.
   */
  logicalSize?: number
  /** Latest descendant modification time in epoch milliseconds. Files use their own mtime. */
  modifiedAt?: number
  /** Parallel hard links share storage; only the primary contributes bytes. */
  hardLink?: "primary" | "secondary"
  /**
   * Clone-sharing evidence for a regular file. Directories intentionally have
   * no aggregate clone state: shared-byte ownership cannot be inferred safely.
   * Omission is not a `not-shared` claim: the portable scanner and ordinary
   * non-shared native files omit inert metadata to keep large scan payloads
   * compact. Treat an omitted value as no clone assertion.
   */
  clone?: CloneEvidence
  /**
   * Exact full-clone map accounting, never set for partial or incomplete groups.
   * This partitions a shared allocation for visualization only: deleting one
   * member can reclaim zero bytes while another member still references it.
   */
  cloneAccounting?: CloneAccounting
  /**
   * Present on a scan root (not descendants) when the scanner knows whether
   * clone metadata was available. This is a capability boundary, not a claim
   * that all shared bytes are reclaimable or fully accounted for. Older
   * payloads may omit it; treat omission as unknown.
   */
  cloneMetadata?: CloneMetadataCapability
  /**
   * Present on a physical scan root when the scanner can say whether
   * reclaim-relevant hard-link/clone evidence was retained. Treat omission or
   * `partial` as uncertain; this does not itself promise reclaimable bytes.
   */
  sharedStorageEvidence?: SharedStorageEvidence
  isDir: boolean
  children: DiskNode[]
  ext: string
  isOther?: boolean
  /** Total direct items represented by a synthetic `Other` node, including unsampled items. */
  otherCount?: number
  isHidden?: boolean
  /** Children were intentionally omitted; opening this node starts a focused scan. */
  isCollapsed?: boolean
  /** Requested direct-entry markers retained on a collapsed node, normalized to lowercase. */
  signatures?: string[]
  /** Read failures encountered below this scan root. Samples are capped. */
  scanIssues?: ScanIssueSummary
  /**
   * Opt-in deep developer-artifact index. Present only on a scan root and
   * intentionally independent from visualization depth / child cutoffs.
   */
  developerArtifactInventory?: DeveloperArtifactInventory
  _label?: string
}

export type ScanIssueSummary = {
  unreadableCount: number
  samplePaths: string[]
}

/**
 * Read-only APFS snapshot identity reported by `diskutil`. It intentionally
 * contains no size estimate: macOS does not expose reliable per-snapshot byte
 * totals, especially when snapshots share copy-on-write blocks.
 */
export type ApfsSnapshotEvidence = {
  name?: string
  uuid?: string
  purgeable?: boolean
  isTimeMachine?: boolean
}

export type DriveInfo = {
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
  /** Snapshot counts are informational; macOS does not expose reliable per-snapshot byte totals. */
  snapshotCount?: number
  purgeableSnapshotCount?: number
  timeMachineSnapshotCount?: number
  /** Bounded, read-only snapshot identities. Omitted when macOS declines to report them. */
  apfsSnapshots?: ApfsSnapshotEvidence[]
}

/** Optional read-only filesystem facts that can arrive after drive discovery. */
export type DriveFacts = Pick<
  DriveInfo,
  | "filesystem"
  | "sharedFree"
  | "snapshotCount"
  | "purgeableSnapshotCount"
  | "timeMachineSnapshotCount"
  | "apfsSnapshots"
>

export type ScanProgress = {
  filesScanned: number
  dirsScanned: number
  currentPath: string
  size: number
  /** A completed direct child of the scan root, emitted at most once as the landscape forms. */
  discovery?: ScanDiscovery
  done?: boolean
}

export type ScanDiscovery = Pick<DiskNode, "name" | "path" | "size" | "modifiedAt" | "isDir">

export type ScanOptions = {
  onProgress?: (p: ScanProgress) => void
  maxDepth?: number
  concurrency?: number
  maxChildren?: number
  /** Basenames retained even when they fall below the per-directory size cutoff. */
  preserveNames?: string[]
  /** Basenames retained as aggregate nodes and expanded only by a focused scan. */
  collapseNames?: string[]
  /** Direct-entry basenames to retain as bounded recognition evidence on collapsed nodes. */
  signatureNames?: string[]
  progressIntervalMs?: number
  useWorker?: boolean
  signal?: AbortSignal
  /** Physical allocation is the useful default for disk cleanup. */
  sizeMode?: "physical" | "logical"
  /** Exact mounted roots that must not be crossed during this scan. */
  excludePaths?: string[]
  /**
   * Build a bounded, root-only index of recognized developer artifact
   * directories even beyond visual tree depth. `true` uses the default cap;
   * `false`/omission preserves the existing fast map-only scan.
   */
  developerArtifactInventory?: boolean | DeveloperArtifactInventoryOptions
}

export type Crumb = {
  name: string
  path: string
  node?: DiskNode
}
