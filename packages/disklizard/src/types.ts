/** Shared DiskLizard types — Desktop + TUI consume the same shapes */

export type DiskNode = {
  name: string
  path: string
  size: number
  isDir: boolean
  children: DiskNode[]
  ext: string
  isOther?: boolean
  _label?: string
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
  done?: boolean
}

export type ScanOptions = {
  onProgress?: (p: ScanProgress) => void
  maxDepth?: number
  concurrency?: number
  maxChildren?: number
  progressIntervalMs?: number
  useWorker?: boolean
}

export type Crumb = {
  name: string
  path: string
  node?: DiskNode
}
