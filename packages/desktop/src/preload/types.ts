import type { DesktopMenuAction } from "../main/desktop-menu"
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
import type { UpdaterState } from "../main/updater-controller"
import type { DesktopNativeBundle } from "@disklizard/app/native-i18n"
import type { DiskStorageDiagnostics } from "../main/disk-platform"
export type UpdaterAPI = {
  subscribe: (cb: (state: UpdaterState) => void) => Promise<() => void>
  check: () => Promise<UpdaterState>
  install: () => Promise<void>
}

export type LinuxDisplayBackend = "wayland" | "auto"
export type TitlebarTheme = {
  mode: "light" | "dark"
  scheme?: "system" | "light" | "dark"
}
export type DiskLizardDrive = {
  path: string
  name: string
  label: string
  total: number
  free: number
  used: number
  type: "local" | "removable" | "network"
  filesystem?: string
  available?: number
  sharedFree?: number
  snapshotCount?: number
  purgeableSnapshotCount?: number
  timeMachineSnapshotCount?: number
  /** Bounded read-only APFS snapshot identities; their byte size is intentionally not estimated. */
  apfsSnapshots?: ApfsSnapshotEvidence[]
}

export type DiskLizardNode = {
  name: string
  path: string
  size: number
  logicalSize?: number
  modifiedAt?: number
  hardLink?: "primary" | "secondary"
  clone?: CloneEvidence
  /** Set only for a clone group completely observed by the scanner. */
  cloneAccounting?: CloneAccounting
  /** Scan-root-only capability; without `available`, physical clone reclaim is intentionally unknown. */
  cloneMetadata?: CloneMetadataCapability
  /** Scan-root-only boundary; only `complete` permits physical reclaim estimates. */
  sharedStorageEvidence?: SharedStorageEvidence
  isDir: boolean
  children: DiskLizardNode[]
  ext: string
  isOther?: boolean
  /** Total direct items represented by a synthetic `Other` node, including unsampled items. */
  otherCount?: number
  isHidden?: boolean
  isCollapsed?: boolean
  signatures?: string[]
  scanIssues?: { unreadableCount: number; samplePaths: string[] }
  /** Root-only, opt-in deep developer artifact index outside the visual tree. */
  developerArtifactInventory?: DeveloperArtifactInventory
  _label?: string
}

/** Fresh-delete proof used only by bounded deep developer-artifact records. */
export type DiskLizardDeveloperArtifactDeletePrecondition = {
  kind: "developer-artifact"
  /** Required by main-process cleanup; absence means rescan, never shape-only Trash. */
  directoryIdentity?: DeveloperArtifactDirectoryIdentity
  artifact: Pick<DeveloperArtifact, "name" | "kind" | "ecosystem" | "confidence" | "cleanup">
}

export type DiskLizardDeleteOptions = {
  authorization: string
  historyMetadata?: { estimatedBytes?: number; kind?: "file" | "directory" }
  precondition?: DiskLizardDeveloperArtifactDeletePrecondition
}

export type DiskLizardDeleteAuthorizationOutcome = {
  path: string
  authorization?: string
  error?: string
}

export type DiskLizardStopWatchingOptions = {
  /** Preserve a main-produced focused subtree under its active trusted parent scan. */
  retainTrustedSubtree?: true
}

export type DiskLizardScanProgress = {
  /** Estimated completed work, independent of allocated bytes. */
  percent?: number
  phase?: "scan" | "reconcile" | "save" | "complete"
  scanId: string
  filesScanned: number
  dirsScanned?: number
  currentPath: string
  size: number
  discovery?: Pick<DiskLizardNode, "name" | "path" | "size" | "modifiedAt" | "isDir">
  done?: boolean
  /** Whether this completion traversed the filesystem, restored a cache, or applied a cache delta. */
  source?: "scan" | "snapshot" | "delta"
}

export type DiskLizardScanUpdate = {
  scanId: string
  rootPath: string
  root: DiskLizardNode
  changedPaths: string[]
  watchError?: string
}

/** Optional local filesystem facts delivered after a fast drive-list first paint. */
export type DiskLizardDriveFactsUpdate = {
  path: string
  facts: DriveFacts
}

export type DiskLizardFilePreview =
  | { kind: "image"; mime: string; dataUrl: string; bytes: number }
  | { kind: "pdf"; dataUrl: string; bytes: number }
  | { kind: "text"; text: string; bytes: number; truncated: boolean }
  | { kind: "unsupported"; bytes: number; reason: "binary" | "directory" | "format" | "too-large" }

export type DiskLizardAPI = {
  getDrives: () => Promise<DiskLizardDrive[]>
  onDriveFacts: (cb: (update: DiskLizardDriveFactsUpdate) => void) => () => void
  getStorageDiagnostics: () => Promise<DiskStorageDiagnostics>
  openDiskAccessSettings: () => Promise<boolean>
  scanPath: (
    path: string,
    options?: {
      maxDepth?: number
      /** Maximum retained children per directory; validated by the main process. */
      maxChildren?: number
      sizeMode?: "physical" | "logical"
      /** Recompute instead of restoring an otherwise unchanged local map. */
      forceFresh?: boolean
      preserveNames?: string[]
      collapseNames?: string[]
      signatureNames?: string[]
      developerArtifactInventory?: boolean | DeveloperArtifactInventoryOptions
    },
    scanId?: string,
  ) => Promise<DiskLizardNode | null>
  cancelScan: (scanId?: string) => Promise<void>
  stopWatching: (scanId?: string, options?: DiskLizardStopWatchingOptions) => Promise<void>
  authorizeDeletePaths: (paths: readonly string[]) => Promise<DiskLizardDeleteAuthorizationOutcome[]>
  deletePath: (path: string, options: DiskLizardDeleteOptions) => Promise<{ ok: true }>
  previewPath: (path: string) => Promise<DiskLizardFilePreview>
  systemPreviewPath: (path: string) => Promise<void>
  openPath: (path: string) => Promise<void>
  openTrash: () => Promise<void>
  revealPath: (path: string) => Promise<void>
  chooseFolder: () => Promise<string | null>
  onScanProgress: (cb: (progress: DiskLizardScanProgress) => void) => () => void
  onScanUpdate: (cb: (update: DiskLizardScanUpdate) => void) => () => void
}

export type ElectronAPI = {
  disklizard: DiskLizardAPI
  updater: UpdaterAPI
  storeGet: (key: string) => Promise<string | null>
  storeSet: (key: string, value: string) => Promise<void>
  storeDelete: (key: string) => Promise<void>
  storeClear: () => Promise<void>
  storeKeys: () => Promise<string[]>
  storeLength: () => Promise<number>
  onMenuCommand: (cb: (id: string) => void) => () => void
  getPathForFile: (file: File) => string
  openExternal: (url: string) => void
  getWindowFullscreen: () => Promise<boolean>
  onWindowFullscreenChanged: (cb: (fullscreen: boolean) => void) => () => void
  relaunch: () => void
  setZoomFactor: (factor: number) => Promise<void>
  getPinchZoomEnabled: () => Promise<boolean>
  setPinchZoomEnabled: (enabled: boolean) => Promise<void>
  onPinchZoomEnabledChanged: (cb: (enabled: boolean) => void) => () => void
  onZoomFactorChanged: (cb: (factor: number) => void) => () => void
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  runDesktopMenuAction: (action: DesktopMenuAction) => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  exportDebugLogs: () => Promise<string>
  setNativeTranslations: (bundle: DesktopNativeBundle) => Promise<void>
}
