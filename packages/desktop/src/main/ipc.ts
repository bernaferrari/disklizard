import log from "electron-log/main.js"
import { execFile, spawn } from "node:child_process"
import { access, stat } from "node:fs/promises"
import { constants } from "node:fs"
import { dirname, join } from "node:path"
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron"
import type { DesktopMenuAction } from "./desktop-menu"
import { parseDesktopNativeBundle, type DesktopNativeBundle } from "@disklizard/app/native-i18n"
import { normalizeScanOptions } from "../../../disklizard/src/scan"

import type { TitlebarTheme } from "../preload/types"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { diskAccessSettingsUrl, getDiskStorageDiagnostics } from "./disk-platform"
import { DiskDeletionHistory, trashWithHistory } from "./disk-deletion-history"
import { DiskDeleteAuthorizationManager } from "./disk-delete-authorization"
import { runGuardedDiskDelete, type DiskDeleteOptions } from "./disk-delete-precondition"
import { quickLookCommand, readDiskPreview } from "./disk-preview"
import { publishDriveFacts } from "./disk-drive-facts"
import { assertSafeDeletionPath, getDriveFacts, getDrives, mountExclusions, scanPath } from "./disk-scanner"
import type { ScanOptions, ScanProgress } from "./disk-scanner"
import { DiskSnapshotManager } from "./disk-snapshot"
import { getStore, removeStoreFileIfEmpty } from "./store"
import { getPinchZoomEnabled, openExternalURL, setPinchZoomEnabled, setTitlebar, updateTitlebar } from "./windows"
import type { UpdaterController } from "./updater-controller"
import { createUpdaterSubscriptions } from "./updater-subscriptions"

// `app.getFileIcon` traps the browser process on macOS 27 (SIGTRAP, brk #0)
// for ordinary directories, not only the boot volume. The picker still lists
// every volume; it just has no custom icon.
export function volumeIconLookupAllowed(_path: string, platform = process.platform) {
  return platform !== "darwin"
}
import { nativeT } from "./native-translations"

let deletionHistory: DiskDeletionHistory | undefined
function getDeletionHistory() {
  if (!deletionHistory) {
    deletionHistory = new DiskDeletionHistory(join(app.getPath("userData"), "deletion-history.jsonl"))
    const prune = () => void deletionHistory!.prune().catch((error) => log.warn("Could not prune deletion history", error))
    prune()
    const timer = setInterval(prune, 24 * 60 * 60 * 1000)
    timer.unref()
    app.once("will-quit", () => clearInterval(timer))
  }
  return deletionHistory
}

const DISKLIZARD_RENDERER_STORE = "disklizard.dat"
const DISKLIZARD_STORAGE_KEYS = new Set(["pinned-locations", "cleanup-locks"])
const MAX_DISKLIZARD_STORAGE_BYTES = 1024 * 1024
const MIN_RENDERER_ZOOM_FACTOR = 0.2
const MAX_RENDERER_ZOOM_FACTOR = 10
const RENDERER_BACKGROUND_COLOR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/
const DESKTOP_MENU_ACTIONS: Readonly<Record<DesktopMenuAction, true>> = {
  "app.checkForUpdates": true,
  "app.relaunch": true,
  "edit.undo": true,
  "edit.redo": true,
  "edit.cut": true,
  "edit.copy": true,
  "edit.paste": true,
  "edit.delete": true,
  "edit.selectAll": true,
  "view.reload": true,
  "view.toggleDevTools": true,
  "view.resetZoom": true,
  "view.zoomIn": true,
  "view.zoomOut": true,
  "view.toggleFullscreen": true,
  "window.close": true,
  "window.minimize": true,
  "window.toggleMaximize": true,
}

function diskLizardStorageKey(value: unknown) {
  if (typeof value !== "string" || !DISKLIZARD_STORAGE_KEYS.has(value)) {
    throw new Error("Invalid DiskLizard storage key")
  }
  return value
}

function serializeDiskLizardStorageValue(value: unknown) {
  if (value === undefined || value === null) throw new Error("Invalid DiskLizard storage value")
  const serialized = typeof value === "string" ? value : JSON.stringify(value)
  if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > MAX_DISKLIZARD_STORAGE_BYTES) {
    throw new Error("Invalid DiskLizard storage value")
  }
  return serialized
}

function parseRendererBackgroundColor(value: unknown) {
  if (typeof value !== "string" || !RENDERER_BACKGROUND_COLOR.test(value)) {
    throw new Error("Invalid background color")
  }
  return value
}

function parseRendererZoomFactor(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid zoom factor")
  return Math.min(Math.max(value, MIN_RENDERER_ZOOM_FACTOR), MAX_RENDERER_ZOOM_FACTOR)
}

function parseRendererTitlebarTheme(value: unknown): TitlebarTheme {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid titlebar theme")
  }
  const theme = value as Record<string, unknown>
  if (Object.keys(theme).some((key) => key !== "mode" && key !== "scheme")) {
    throw new Error("Invalid titlebar theme")
  }
  if (theme.mode !== "light" && theme.mode !== "dark") throw new Error("Invalid titlebar theme")
  if (theme.scheme !== undefined && theme.scheme !== "system" && theme.scheme !== "light" && theme.scheme !== "dark") {
    throw new Error("Invalid titlebar theme")
  }
  return theme.scheme === undefined ? { mode: theme.mode } : { mode: theme.mode, scheme: theme.scheme }
}

function parseDesktopMenuAction(value: unknown): DesktopMenuAction {
  if (typeof value !== "string" || !Object.hasOwn(DESKTOP_MENU_ACTIONS, value)) {
    throw new Error("Invalid desktop menu action")
  }
  return value as DesktopMenuAction
}

function parseRendererMaxChildren(value: unknown) {
  const scannerDefault = normalizeScanOptions({}).maxChildren!
  if (value === undefined) return scannerDefault
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("Invalid maxChildren scan option")
  const normalized = normalizeScanOptions({ maxChildren: value }).maxChildren!
  if (normalized !== value) throw new Error("Invalid maxChildren scan option")
  return normalized
}

function parseStopWatchingOptions(value: unknown) {
  if (value === undefined) return false
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid stop-watching options")
  }
  const options = value as Record<string, unknown>
  if (
    Object.keys(options).some((key) => key !== "retainTrustedSubtree") ||
    (options.retainTrustedSubtree !== undefined && options.retainTrustedSubtree !== true)
  ) {
    throw new Error("Invalid stop-watching options")
  }
  return options.retainTrustedSubtree === true
}

type Deps = {
  relaunch: () => void
  updater: UpdaterController
  showUpdater: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  exportDebugLogs: () => Promise<string>
  setNativeTranslations: (bundle: DesktopNativeBundle) => void
  /** Present only in an explicit packaged-smoke build; replaces the native folder picker, not disk operations. */
  packagedSmokeFixturePath?: string
}

export function assertTrustedRenderer(event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">) {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win || win.isDestroyed() || win.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("Invalid IPC sender")
  }
  return win
}

export function registerIpcHandlers(deps: Deps) {
  getDeletionHistory()
  const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) =>
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedRenderer(event)
      return listener(event, ...args)
    })
  const on = (channel: string, listener: Parameters<typeof ipcMain.on>[1]) =>
    ipcMain.on(channel, (event, ...args) => {
      assertTrustedRenderer(event)
      return listener(event, ...args)
    })
  const updaterSubscriptions = createUpdaterSubscriptions()
  const diskScans = new Map<string, AbortController>()
  const dockProgress = new Map<AbortController, number>()
  let dockBadge = ""
  const updateDockBadge = () => {
    if (process.platform !== "darwin") return
    const active = [...dockProgress.entries()].filter(([scan]) => !scan.signal.aborted)
    const percent = active.at(-1)?.[1]
    const badge = percent === undefined ? "" : `${Math.floor(percent)}%`
    if (badge === dockBadge) return
    dockBadge = badge
    app.dock?.setBadge(badge)
  }
  const diskSnapshotCache = join(app.getPath("userData"), "disklizard", "snapshots")
  const diskSnapshots = new DiskSnapshotManager({
    cacheDir: diskSnapshotCache,
    scan: scanPath,
  })
  const diskDeleteAuthorizations = new DiskDeleteAuthorizationManager()
  type DiskSnapshotSender = {
    sender: WebContents
    owners: Set<string>
    onDestroyed: () => void
  }
  // Completed scans keep their filesystem watcher alive. Share one renderer
  // lifetime listener across all of its scan owners instead of appending a new
  // once-listener after every rescan.
  const diskSnapshotSenders = new Map<number, DiskSnapshotSender>()
  const diskSnapshotOwnerSenders = new Map<string, number>()

  const detachDiskSnapshotOwner = (owner: string) => {
    const senderID = diskSnapshotOwnerSenders.get(owner)
    if (senderID === undefined) return
    diskSnapshotOwnerSenders.delete(owner)
    const tracked = diskSnapshotSenders.get(senderID)
    if (!tracked) return
    tracked.owners.delete(owner)
    if (tracked.owners.size > 0) return
    diskSnapshotSenders.delete(senderID)
    if (!tracked.sender.isDestroyed()) tracked.sender.removeListener("destroyed", tracked.onDestroyed)
  }

  const stopDiskSnapshotOwner = async (owner: string, retainTrustedSubtree = false) => {
    if (!retainTrustedSubtree) {
      detachDiskSnapshotOwner(owner)
      diskDeleteAuthorizations.removeOwner(owner)
      return diskSnapshots.stop(owner)
    }
    try {
      // Stop first so an in-flight watcher update cannot recreate an active
      // authority after its renderer-lifetime tracking has been detached.
      await diskSnapshots.stop(owner)
    } catch (error) {
      detachDiskSnapshotOwner(owner)
      diskDeleteAuthorizations.removeOwner(owner)
      throw error
    }
    detachDiskSnapshotOwner(owner)
    diskDeleteAuthorizations.retainOwnerAsTrustedSubtree(owner)
  }

  const trackDiskSnapshotOwner = (sender: WebContents, owner: string) => {
    detachDiskSnapshotOwner(owner)
    if (sender.isDestroyed()) {
      void diskSnapshots.stop(owner)
      return
    }
    let tracked = diskSnapshotSenders.get(sender.id)
    if (!tracked || tracked.sender !== sender) {
      if (tracked) {
        if (!tracked.sender.isDestroyed()) tracked.sender.removeListener("destroyed", tracked.onDestroyed)
        diskDeleteAuthorizations.removeSender(sender.id)
        for (const staleOwner of tracked.owners) {
          diskSnapshotOwnerSenders.delete(staleOwner)
          void diskSnapshots.stop(staleOwner)
        }
      }
      const owners = new Set<string>()
      const onDestroyed = () => {
        const current = diskSnapshotSenders.get(sender.id)
        if (!current || current.onDestroyed !== onDestroyed) return
        diskSnapshotSenders.delete(sender.id)
        diskDeleteAuthorizations.removeSender(sender.id)
        for (const currentOwner of current.owners) {
          diskSnapshotOwnerSenders.delete(currentOwner)
          diskScans.get(currentOwner)?.abort(new Error("Scan window closed"))
          diskDeleteAuthorizations.removeOwner(currentOwner)
          void diskSnapshots.stop(currentOwner)
        }
      }
      tracked = { sender, owners, onDestroyed }
      diskSnapshotSenders.set(sender.id, tracked)
      sender.once("destroyed", onDestroyed)
    }
    tracked.owners.add(owner)
    diskSnapshotOwnerSenders.set(owner, sender.id)
  }

  const clearDiskSnapshotOwners = () => {
    for (const tracked of diskSnapshotSenders.values()) {
      if (!tracked.sender.isDestroyed()) tracked.sender.removeListener("destroyed", tracked.onDestroyed)
    }
    diskSnapshotSenders.clear()
    diskSnapshotOwnerSenders.clear()
    diskDeleteAuthorizations.clear()
  }
  app.once("will-quit", () => {
    updaterSubscriptions.clear()
    clearDiskSnapshotOwners()
    void diskSnapshots.stopAll()
  })

  handle("disklizard:volume-info", async (_event, target: unknown) => {
    const drive = (await getDrives()).find(drive => drive.path === target)
    if (!drive) return null
    const icon = volumeIconLookupAllowed(drive.path)
      ? await app.getFileIcon(drive.path, { size: "large" }).catch(() => undefined)
      : undefined
    return { icon: icon?.toDataURL(), canEject: process.platform === "darwin" && drive.type === "removable" && drive.path.startsWith("/Volumes/") }
  })
  handle("disklizard:reveal-volume", async (_event, target: unknown) => {
    const drive = (await getDrives()).find(drive => drive.path === target)
    return drive ? !(await shell.openPath(drive.path)) : false
  })
  handle("disklizard:eject-volume", async (_event, target: unknown) => {
    const drive = (await getDrives()).find(drive => drive.path === target)
    if (process.platform !== "darwin" || !drive || drive.type !== "removable" || !drive.path.startsWith("/Volumes/")) return false
    return new Promise<boolean>(resolve => {
      execFile("/usr/sbin/diskutil", ["eject", drive.path], { timeout: 15000, maxBuffer: 65536 }, error => resolve(!error))
    })
  })

  handle("disklizard:get-drives", async (event: IpcMainInvokeEvent) => {
    const drives = await getDrives()
    // `getDrives` has a short first-paint budget on macOS. Publish optional
    // APFS facts when their already-started local probes finish, without ever
    // delaying the volume chooser or contacting remote storage.
    if (process.platform === "darwin") {
      for (const drive of drives) {
        if (drive.type === "network") continue
        void getDriveFacts(drive.path)
          .then((facts) => publishDriveFacts(event.sender, drive.path, facts))
          .catch(() => undefined)
      }
    }
    return drives
  })
  handle("disklizard:get-storage-diagnostics", async () => getDiskStorageDiagnostics({ drives: await getDrives() }))
  handle("disklizard:open-disk-access-settings", async () => {
    const url = diskAccessSettingsUrl()
    if (!url) return false
    await shell.openExternal(url)
    return true
  })
  handle(
    "disklizard:scan-path",
    async (
      event: IpcMainInvokeEvent,
      targetPath: string,
      options?: {
        maxDepth?: number
        concurrency?: number
        maxChildren?: number
        sizeMode?: "physical" | "logical"
        /** Bypass an unchanged persisted map for a one-off exact recomputation. */
        forceFresh?: boolean
        preserveNames?: string[]
        collapseNames?: string[]
        signatureNames?: string[]
        developerArtifactInventory?: ScanOptions["developerArtifactInventory"]
      },
      requestedScanID?: string,
    ) => {
      const maxChildren = parseRendererMaxChildren(options?.maxChildren)
      const senderID = event.sender.id
      const scanID = requestedScanID || "primary"
      const owner = `${senderID}:${scanID}`
      detachDiskSnapshotOwner(owner)
      diskDeleteAuthorizations.removeOwner(owner)
      diskScans.get(owner)?.abort(new Error("Superseded by a new scan"))
      const controller = new AbortController()
      const scanStartedAt = Date.now()
      let lastProgressLog = 0
      let nativeDoneAt: number | undefined
      const scanWindow = BrowserWindow.fromWebContents(event.sender)
      if (process.platform === "darwin") {
        scanWindow?.setProgressBar(-1)
        dockProgress.set(controller, 0)
        updateDockBadge()
      } else {
        scanWindow?.setProgressBar(2, { mode: "indeterminate" })
      }
      log.info("disk scan started", { scanID })
      let latestProgress: ScanProgress | undefined
      diskScans.set(owner, controller)
      trackDiskSnapshotOwner(event.sender, owner)
      try {
        const excludePaths = [
          diskSnapshotCache,
          ...(process.platform === "win32" ? [] : mountExclusions(targetPath, await getDrives(), process.platform)),
        ]
        const scanOptions: ScanOptions = {
          maxDepth: options?.maxDepth ?? 10,
          concurrency: options?.concurrency,
          maxChildren,
          preserveNames: options?.preserveNames,
          collapseNames: options?.collapseNames,
          signatureNames: options?.signatureNames,
          developerArtifactInventory: options?.developerArtifactInventory,
          progressIntervalMs: 120,
          useWorker: true,
          sizeMode:
            options?.sizeMode ??
            (process.platform === "win32" && targetPath.startsWith("\\\\") ? "logical" : "physical"),
          signal: controller.signal,
          excludePaths,
          onProgress: (progress) => {
            latestProgress = progress
            if (progress.percent !== undefined && Number.isFinite(progress.percent)) {
              if (process.platform === "darwin") {
                dockProgress.set(controller, Math.max(0, Math.min(100, progress.percent)))
                updateDockBadge()
              } else if (scanWindow && !scanWindow.isDestroyed()) {
                scanWindow.setProgressBar(progress.percent / 100)
              }
            }
            if (progress.done) nativeDoneAt = Date.now()
            if (progress.done || Date.now() - lastProgressLog >= 10000) {
              lastProgressLog = Date.now()
              log.info("disk scan progress", {
                scanID,
                elapsedMs: Date.now() - scanStartedAt,
                files: progress.filesScanned,
                directories: progress.dirsScanned,
                bytes: progress.size,
                nativeDone: !!progress.done,
                phase: progress.phase,
                percent: progress.percent,
              })
            }
            if (!event.sender.isDestroyed())
              event.sender.send("disklizard:scan-progress", { ...progress, scanId: scanID })
          },
        }
        try {
          const result = await diskSnapshots.scan(
            owner,
            targetPath,
            scanOptions,
            (update) => {
              if (event.sender.isDestroyed()) {
                void stopDiskSnapshotOwner(owner)
                return
              }
              diskDeleteAuthorizations.updateRoot(owner, senderID, update.root)
              // `revision` is an additive renderer hint (stale-clone guard);
              // the existing update shape stays backward compatible.
              event.sender.send("disklizard:scan-update", { ...update, scanId: scanID })
            },
            options?.forceFresh === true,
          )
          diskDeleteAuthorizations.updateRoot(owner, senderID, result.root)
          // Snapshot restores deliberately skip traversal. Tell the renderer
          // the completion source so it never turns cache latency into a
          // fictional throughput claim.
          if (!event.sender.isDestroyed()) {
            event.sender.send("disklizard:scan-progress", {
              scanId: scanID,
              filesScanned: latestProgress?.filesScanned ?? 0,
              dirsScanned: latestProgress?.dirsScanned ?? 0,
              currentPath: targetPath,
              size: result.root.size,
              done: true,
              percent: 100,
              phase: "complete",
              source: result.source,
            })
          }
          log.info("disk scan ready", {
            scanID,
            elapsedMs: Date.now() - scanStartedAt,
            afterNativeMs: nativeDoneAt ? Date.now() - nativeDoneAt : undefined,
            source: result.source,
          })
          return result.root
        } catch (error) {
          if (controller.signal.aborted) {
            await stopDiskSnapshotOwner(owner)
            return null
          }
          await stopDiskSnapshotOwner(owner)
          throw error
        }
      } finally {
        if (diskScans.get(owner) === controller) diskScans.delete(owner)
        dockProgress.delete(controller)
        updateDockBadge()
        if (process.platform !== "darwin" && scanWindow && !scanWindow.isDestroyed()) {
          const active = [...diskScans.keys()].some((key) => key.startsWith(`${senderID}:`))
          scanWindow.setProgressBar(active ? 2 : -1, { mode: active ? "indeterminate" : "none" })
        }
      }
    },
  )
  handle("disklizard:cancel-scan", (event: IpcMainInvokeEvent, requestedScanID?: string) => {
    const prefix = `${event.sender.id}:`
    const owners = requestedScanID
      ? [`${prefix}${requestedScanID}`]
      : [
          ...new Set([
            ...[...diskScans.keys()].filter((key) => key.startsWith(prefix)),
            ...diskSnapshots
              .activeOwners()
              .filter((owner) => String(owner).startsWith(prefix))
              .map(String),
          ]),
        ]
    owners.forEach((owner) => diskScans.get(owner)?.abort(new Error("Scan cancelled")))
    void Promise.all(owners.map((owner) => stopDiskSnapshotOwner(owner)))
  })
  handle(
    "disklizard:stop-watching",
    async (event: IpcMainInvokeEvent, requestedScanID?: string, rawOptions?: unknown) => {
      const retainTrustedSubtree = parseStopWatchingOptions(rawOptions)
      if (retainTrustedSubtree && !requestedScanID) throw new Error("Invalid stop-watching options")
      const prefix = `${event.sender.id}:`
      if (requestedScanID) return stopDiskSnapshotOwner(`${prefix}${requestedScanID}`, retainTrustedSubtree)
      return Promise.all(
        [...diskSnapshots.activeOwners()]
          .filter((owner) => String(owner).startsWith(prefix))
          .map((owner) => stopDiskSnapshotOwner(String(owner))),
      )
    },
  )
  handle("disklizard:authorize-delete-paths", (event: IpcMainInvokeEvent, paths: readonly string[]) =>
    diskDeleteAuthorizations.authorize(event.sender.id, paths, assertSafeDeletionPath),
  )
  handle("disklizard:check-delete-access", async (event: IpcMainInvokeEvent, targetPath: string) => {
    diskDeleteAuthorizations.assertTrustedPath(event.sender.id, targetPath)
    await assertSafeDeletionPath(targetPath)
    try {
      await access(dirname(targetPath), constants.W_OK)
      return { state: "likely" as const }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined
      return { state: code === "EROFS" ? "read-only" as const : code === "EACCES" || code === "EPERM" ? "denied" as const : "unknown" as const }
    }
  })
  handle(
    "disklizard:delete-path",
    async (event: IpcMainInvokeEvent, targetPath: string, options: DiskDeleteOptions) => {
      const validateAuthorization = await diskDeleteAuthorizations.consume(
        event.sender.id,
        targetPath,
        options?.authorization,
      )
      await runGuardedDiskDelete(targetPath, options?.precondition, assertSafeDeletionPath, async (path) => {
        await validateAuthorization()
        await trashWithHistory(path, options?.historyMetadata, (target) => shell.trashItem(target), getDeletionHistory(),
          (error) => log.warn("Could not save deletion history", error))
      })
      return { ok: true }
    },
  )
  handle("disklizard:preview-path", (event: IpcMainInvokeEvent, targetPath: string) => {
    diskDeleteAuthorizations.assertTrustedPath(event.sender.id, targetPath)
    return readDiskPreview(targetPath)
  })
  handle("disklizard:system-preview-path", async (event: IpcMainInvokeEvent, targetPath: string) => {
    diskDeleteAuthorizations.assertTrustedPath(event.sender.id, targetPath)
    const metadata = await stat(targetPath)
    if (!metadata.isFile() && !metadata.isDirectory()) throw new Error("Only files and folders can be previewed")
    const command = quickLookCommand(targetPath)
    if (command) {
      const preview = spawn(command.file, command.args, { detached: true, stdio: "ignore" })
      preview.once("error", () => undefined)
      preview.unref()
      return
    }
    const error = await shell.openPath(targetPath)
    if (error) throw new Error(error)
  })
  handle("disklizard:open-path", async (event: IpcMainInvokeEvent, targetPath: string) => {
    diskDeleteAuthorizations.assertTrustedPath(event.sender.id, targetPath)
    const error = await shell.openPath(targetPath)
    if (error) throw new Error(error)
  })
  handle("disklizard:open-trash", async () => {
    if (process.platform === "win32") {
      const trash = spawn("explorer.exe", ["shell:RecycleBinFolder"], { detached: true, stdio: "ignore" })
      trash.once("error", () => undefined)
      trash.unref()
      return
    }
    const path =
      process.platform === "darwin"
        ? join(app.getPath("home"), ".Trash")
        : join(process.env.XDG_DATA_HOME || join(app.getPath("home"), ".local", "share"), "Trash", "files")
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  handle("disklizard:reveal-path", async (event: IpcMainInvokeEvent, targetPath: string) => {
    diskDeleteAuthorizations.assertTrustedPath(event.sender.id, targetPath)
    await stat(targetPath)
    shell.showItemInFolder(targetPath)
  })
  handle("disklizard:choose-folder", async (event: IpcMainInvokeEvent) => {
    if (import.meta.env.DISKLIZARD_PACKAGED_SMOKE === "1" && deps.packagedSmokeFixturePath) {
      const fixture = await stat(deps.packagedSmokeFixturePath)
      if (!fixture.isDirectory()) throw new Error("Packaged smoke fixture is not a directory")
      return deps.packagedSmokeFixturePath
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ["openDirectory"],
      title: nativeT("desktop.dialog.chooseFolder"),
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  handle("updater-subscribe", (event) => {
    const id = event.sender.id
    updaterSubscriptions.set(
      id,
      deps.updater.subscribe((state) => {
        if (event.sender.isDestroyed()) return updaterSubscriptions.delete(id)
        event.sender.send("updater-state", state)
      }),
    )
    event.sender.once("destroyed", () => updaterSubscriptions.delete(id))
  })
  handle("updater-unsubscribe", (event) => updaterSubscriptions.delete(event.sender.id))
  handle("updater-check", () => deps.updater.check())
  handle("updater-install", () => deps.updater.install())
  handle("set-background-color", (_event: IpcMainInvokeEvent, color: unknown) =>
    deps.setBackgroundColor(parseRendererBackgroundColor(color)),
  )
  handle("export-debug-logs", () => deps.exportDebugLogs())
  handle("set-native-translations", (_event: IpcMainInvokeEvent, value: unknown) => {
    const bundle = parseDesktopNativeBundle(value)
    if (!bundle) throw new Error("Invalid native translation bundle")
    deps.setNativeTranslations(bundle)
  })
  handle("disklizard:store-get", (_event: IpcMainInvokeEvent, input: unknown) => {
    const key = diskLizardStorageKey(input)
    const store = getStore(DISKLIZARD_RENDERER_STORE)
    if (!store.has(key)) return null
    return serializeDiskLizardStorageValue(store.get(key))
  })
  handle("disklizard:store-set", (_event: IpcMainInvokeEvent, input: unknown, value: unknown) => {
    const key = diskLizardStorageKey(input)
    if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_DISKLIZARD_STORAGE_BYTES) {
      throw new Error("Invalid DiskLizard storage value")
    }
    getStore(DISKLIZARD_RENDERER_STORE).set(key, value)
  })
  handle("disklizard:store-delete", (_event: IpcMainInvokeEvent, input: unknown) => {
    const key = diskLizardStorageKey(input)
    getStore(DISKLIZARD_RENDERER_STORE).delete(key)
    void removeStoreFileIfEmpty(DISKLIZARD_RENDERER_STORE)
  })
  handle("disklizard:store-clear", () => {
    getStore(DISKLIZARD_RENDERER_STORE).clear()
    void removeStoreFileIfEmpty(DISKLIZARD_RENDERER_STORE)
  })
  handle("disklizard:store-keys", () => {
    const store = getStore(DISKLIZARD_RENDERER_STORE)
    return Object.keys(store.store).filter((key) => DISKLIZARD_STORAGE_KEYS.has(key))
  })
  handle("disklizard:store-length", () => {
    const store = getStore(DISKLIZARD_RENDERER_STORE)
    return Object.keys(store.store).filter((key) => DISKLIZARD_STORAGE_KEYS.has(key)).length
  })

  on("open-external", (_event: IpcMainEvent, url: string) => openExternalURL(url))

  handle("get-window-fullscreen", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFullScreen() ?? false
  })

  on("relaunch", () => {
    deps.relaunch()
  })

  handle("set-zoom-factor", (event: IpcMainInvokeEvent, factor: unknown) => {
    event.sender.setZoomFactor(parseRendererZoomFactor(factor))
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    updateTitlebar(win)
  })
  handle("get-pinch-zoom-enabled", () => getPinchZoomEnabled())
  handle("set-pinch-zoom-enabled", (_event: IpcMainInvokeEvent, enabled: unknown) => {
    if (typeof enabled !== "boolean") throw new Error("Invalid pinch zoom value")
    setPinchZoomEnabled(enabled)
  })
  handle("set-titlebar", (event: IpcMainInvokeEvent, value: unknown) => {
    const theme = parseRendererTitlebarTheme(value)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebar(win, theme)
  })
  handle("run-desktop-menu-action", (event: IpcMainInvokeEvent, value: unknown) => {
    const action = parseDesktopMenuAction(value)
    runDesktopMenuAction(BrowserWindow.fromWebContents(event.sender), action, {
      checkForUpdates: () => void deps.showUpdater(),
      relaunch: deps.relaunch,
    })
  })
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send("menu-command", id)
}
