import type { DiskDriveInfo, DiskScanNode } from "./types"
import type { ScanDiscovery } from "./live-scan"

export type VolumeScanJob = {
  id: string
  /** Folder jobs run in the background alongside volume scans. */
  kind?: "volume" | "folder"
  status: "scanning" | "complete" | "failed"
  label: string
  sourcePath: string
  drive: DiskDriveInfo
  files: number
  bytes: number
  pct: number
  currentPath: string
  startedAt: number
  completedAt?: number
  /** Only a fresh traversal earns a throughput measurement. */
  source?: "scan" | "snapshot" | "delta"
  tree?: DiskScanNode
  error?: string
  /** Top-level items the scanner has finished, in arrival order. */
  discoveries?: readonly ScanDiscovery[]
}
