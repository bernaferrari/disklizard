/** Shared DiskLizard types — Desktop + TUI consume the same shapes */

export type DiskNode = {
  name: string
  path: string
  /** Bytes charged to this node. Physical allocation by default. */
  size: number
  /** Apparent file length when it differs from the charged size. */
  logicalSize?: number
  /** Latest descendant modification time in epoch milliseconds. Files use their own mtime. */
  modifiedAt?: number
  /** Parallel hard links share storage; only the primary contributes bytes. */
  hardLink?: "primary" | "secondary"
  isDir: boolean
  children: DiskNode[]
  ext: string
  isOther?: boolean
  isHidden?: boolean
  /** Children were intentionally omitted; opening this node starts a focused scan. */
  isCollapsed?: boolean
  /** Requested direct-entry markers retained on a collapsed node, normalized to lowercase. */
  signatures?: string[]
  /** Read failures encountered below this scan root. Samples are capped. */
  scanIssues?: ScanIssueSummary
  _label?: string
}

export type ScanIssueSummary = {
  unreadableCount: number
  samplePaths: string[]
}

export type DriveInfo = {
  path: string
  name: string
  label: string
  total: number
  free: number
  used: number
  type: "local" | "removable" | "network"
}

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
}

export type Crumb = {
  name: string
  path: string
  node?: DiskNode
}
