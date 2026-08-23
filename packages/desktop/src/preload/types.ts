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
import type { DesktopNativeBundle } from "../../../app/src/i18n/desktop-native"
import type { DiskStorageDiagnostics } from "../main/disk-platform"
export type UpdaterAPI = {
  subscribe: (cb: (state: UpdaterState) => void) => Promise<() => void>
  check: () => Promise<UpdaterState>
  install: () => Promise<void>
}

export type RendererStoreID = "disklizard" | "global"

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
  precondition?: DiskLizardDeveloperArtifactDeletePrecondition
}

export type DiskLizardScanProgress = {
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
  stopWatching: (scanId?: string) => Promise<void>
  authorizeDeletePaths: (paths: readonly string[]) => Promise<Array<{ path: string; authorization: string }>>
  deletePath: (path: string, options: DiskLizardDeleteOptions) => Promise<{ ok: true }>
  previewPath: (path: string) => Promise<DiskLizardFilePreview>
  systemPreviewPath: (path: string) => Promise<void>
  openTrash: () => Promise<void>
  revealPath: (path: string) => Promise<void>
  chooseFolder: () => Promise<string | null>
  onScanProgress: (cb: (progress: DiskLizardScanProgress) => void) => () => void
  onScanUpdate: (cb: (update: DiskLizardScanUpdate) => void) => () => void
}

export type FatalRendererError = {
  error: string
  url: string
  version?: string
  platform: string
  os?: string
}

export type ElectronAPI = {
  disklizard: DiskLizardAPI
  updater: UpdaterAPI
  consumeInitialDeepLinks: () => Promise<string[]>
  storeGet: (id: RendererStoreID, key: string) => Promise<string | null>
  storeSet: (id: RendererStoreID, key: string, value: string) => Promise<void>
  storeDelete: (id: RendererStoreID, key: string) => Promise<void>
  storeClear: (id: RendererStoreID) => Promise<void>
  storeKeys: (id: RendererStoreID) => Promise<string[]>
  storeLength: (id: RendererStoreID) => Promise<number>
  getWindowID: () => Promise<string>

  getWindowCount?: () => Promise<number>
  onMenuCommand: (cb: (id: string) => void) => () => void
  onDeepLink: (cb: (urls: string[]) => void) => () => void

  openDirectoryPicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
  }) => Promise<string | string[] | null>
  openFilePicker: (opts?: {
    multiple?: boolean
    title?: string
    defaultPath?: string
    extensions?: string[]
  }) => Promise<{ token: string; files: { path: string; name: string; size: number }[] } | null>
  readPickedFile: (token: string, path: string) => Promise<ArrayBuffer>
  releasePickedFiles: (token: string) => Promise<void>
  getPathForFile: (file: File) => string
  saveFilePicker: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>
  openExternal: (url: string) => void
  openLocalFile: (url: string) => void
  openPath: (path: string) => Promise<void>
  revealPath: (path: string) => Promise<boolean>
  readClipboardImage: () => Promise<{ buffer: ArrayBuffer; width: number; height: number } | null>
  showNotification?: (title: string, body?: string) => void
  getWindowFocused: () => Promise<boolean>
  getWindowFullscreen: () => Promise<boolean>
  onWindowFullscreenChanged: (cb: (fullscreen: boolean) => void) => () => void
  setWindowFocus: () => Promise<void>
  showWindow: () => Promise<void>
  relaunch: () => void
  getZoomFactor: () => Promise<number>
  setZoomFactor: (factor: number) => Promise<void>
  getPinchZoomEnabled: () => Promise<boolean>
  setPinchZoomEnabled: (enabled: boolean) => Promise<void>
  onPinchZoomEnabledChanged: (cb: (enabled: boolean) => void) => () => void
  onZoomFactorChanged: (cb: (factor: number) => void) => () => void
  setTitlebar: (theme: TitlebarTheme) => Promise<void>
  runDesktopMenuAction: (action: DesktopMenuAction) => Promise<void>
  setBackgroundColor: (color: string) => Promise<void>
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void>
  setForceFocus: (enabled: boolean) => Promise<void>
  setNativeTranslations: (bundle: DesktopNativeBundle) => Promise<void>
}
