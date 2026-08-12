import { createSimpleContext } from "@opencode-ai/ui/context"
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
} from "@opencode-ai/disklizard"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { Accessor } from "solid-js"
import type { DesktopMenuAction } from "../desktop-menu"
import { ServerConnection } from "./server"
import type { WslServersPlatform } from "../wsl/types"
import type { UpdaterPlatform } from "../updater"
import type { DraftStore } from "@/utils/draft-store"

type PickerPaths = string | string[] | null
type OpenDirectoryPickerOptions = { title?: string; multiple?: boolean }
type OpenAttachmentPickerOptions = {
  title?: string
  multiple?: boolean
  accept?: string[]
  extensions?: string[]
  defaultPath?: string
}
type SaveFilePickerOptions = { title?: string; defaultPath?: string }
type PlatformName = "web" | "desktop"
type DesktopOS = "macos" | "windows" | "linux"

export type FatalRendererErrorLog = {
  error: string
  url: string
  version?: string
  platform: PlatformName
  os?: DesktopOS
}

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
  permanent?: boolean
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
  deletePath(path: string, options?: DiskDeleteOptions): Promise<{ ok: true }>
  previewPath(path: string): Promise<DiskFilePreview>
  systemPreviewPath(path: string): Promise<void>
  openTrash(): Promise<void>
  revealPath(path: string): Promise<void>
  chooseFolder(): Promise<string | null>
  onScanProgress(cb: (progress: DiskScanProgress) => void): () => void
  onScanUpdate(cb: (update: DiskScanUpdate) => void): () => void
}

type PlatformBase = {
  /** App version */
  version?: string

  /** Open a web or mail URL in the default system application */
  openExternal(url: string): void

  /** Open a local path in a local app (desktop only) */
  openPath?(path: string, app?: string): Promise<void>

  /** Open a local file URL in its default app (desktop only) */
  openLocalFile?(url: string): void

  /** Reveal a local path in the system file manager; false when the path does not exist (desktop only) */
  revealPath?(path: string): Promise<boolean>

  /** Restart the app  */
  restart(): Promise<void>

  /** Send a system notification */
  notify(title: string, description?: string, onClick?: () => void): Promise<void>

  /** Open a native attachment picker and read selected files sequentially (desktop only) */
  openAttachmentPickerDialog?(
    opts: OpenAttachmentPickerOptions,
    onFile: (file: File) => Promise<unknown>,
  ): Promise<void>

  /** Resolve the native source path for a desktop File. */
  getPathForFile?(file: File): string

  /** Open a native save file picker dialog (desktop only) */
  saveFilePickerDialog?(opts?: SaveFilePickerOptions): Promise<string | null>

  /** Storage mechanism, defaults to localStorage */
  storage?: (name?: string) => SyncStorage | AsyncStorage

  /** Prompt drafts, history, and their blobs. */
  draftStore?: DraftStore

  /** Stable platform window identity for window-scoped persistence */
  windowID?: string

  /** Application-global desktop updater */
  updater?: UpdaterPlatform

  /** Fetch override */
  fetch?: typeof fetch

  /** Get the configured default server URL (platform-specific) */
  getDefaultServer?(): Promise<ServerConnection.Key | null>

  /** Set the default server URL to use on app startup (platform-specific) */
  setDefaultServer?(url: ServerConnection.Key | null): Promise<void> | void

  /** Manage WSL sidecar servers (Electron on Windows only) */
  wslServers?: WslServersPlatform

  /** Get the preferred display backend (desktop only) */
  getDisplayBackend?(): Promise<DisplayBackend | null> | DisplayBackend | null

  /** Set the preferred display backend (desktop only) */
  setDisplayBackend?(backend: DisplayBackend): Promise<void>

  /** Webview zoom level (desktop only) */
  webviewZoom?: Accessor<number>

  /** Whether the native desktop window is fullscreen */
  windowFullscreen?: Accessor<boolean>

  /** Get whether native pinch/Ctrl-scroll zoom gestures are enabled (desktop only) */
  getPinchZoomEnabled?(): Promise<boolean> | boolean

  /** Allow native pinch/Ctrl-scroll zoom gestures (desktop only) */
  setPinchZoomEnabled?(enabled: boolean): Promise<void> | void

  /** Run a desktop-only menu action from the app chrome */
  runDesktopMenuAction?(action: DesktopMenuAction): Promise<void> | void

  /** Check if an editor app exists (desktop only) */
  checkAppExists?(appName: string): Promise<boolean>

  /** Read image from clipboard (desktop only) */
  readClipboardImage?(): Promise<File | null>

  /** Export collected diagnostic logs (desktop only) */
  exportDebugLogs?(): Promise<string>

  /** Force focus styles on interactive elements through desktop devtools (desktop only) */
  setForceFocus?(enabled: boolean): Promise<void>

  /** Record a fatal renderer error in platform logs (desktop only) */
  recordFatalRendererError?(error: FatalRendererErrorLog): Promise<void>
}

export type Platform = PlatformBase &
  (
    | { platform: "web"; os?: never }
    | {
        platform: "desktop"
        os?: DesktopOS
        openDirectoryPickerDialog(opts?: OpenDirectoryPickerOptions): Promise<PickerPaths>
        /** In-app disk space utility, opened at the /disk route (desktop only) */
        diskUtility?: DiskUtilityAPI
      }
  )

export type DisplayBackend = "auto" | "wayland"

export const { use: usePlatform, provider: PlatformProvider } = createSimpleContext({
  name: "Platform",
  init: (props: { value: Platform }) => {
    return props.value
  },
})
