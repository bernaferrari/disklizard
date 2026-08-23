import { spawn } from "node:child_process"
import { stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { app, BrowserWindow, Notification, clipboard, dialog, ipcMain, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron"
import type { DesktopMenuAction } from "./desktop-menu"
import { parseDesktopNativeBundle, type DesktopNativeBundle } from "../../../app/src/i18n/desktop-native"

import type { FatalRendererError, TitlebarTheme } from "../preload/types"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { setForceFocus } from "./debug"
import { assertAttachmentBudget, createPickedFileAuthorizations } from "./attachment-picker"
import { diskAccessSettingsUrl, getDiskStorageDiagnostics } from "./disk-platform"
import { DiskDeleteAuthorizationManager } from "./disk-delete-authorization"
import { runGuardedDiskDelete, type DiskDeleteOptions } from "./disk-delete-precondition"
import { quickLookCommand, readDiskPreview } from "./disk-preview"
import { publishDriveFacts } from "./disk-drive-facts"
import { assertSafeDeletionPath, getDriveFacts, getDrives, mountExclusions, scanPath } from "./disk-scanner"
import type { ScanOptions, ScanProgress } from "./disk-scanner"
import { DiskSnapshotManager } from "./disk-snapshot"
import { getStore, removeStoreFileIfEmpty } from "./store"
import { resolveRendererStoreName } from "./renderer-store"
import {
  getPinchZoomEnabled,
  getWindowID,
  openExternalURL,
  openLocalFileURL,
  setPinchZoomEnabled,
  setTitlebar,
  updateTitlebar,
} from "./windows"
import type { UpdaterController } from "./updater-controller"
import { createUpdaterSubscriptions } from "./updater-subscriptions"
import { nativeT } from "./native-translations"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: nativeT("desktop.dialog.files"), extensions: ext }]
}

const pickedFiles = createPickedFileAuthorizations()

type Deps = {
  relaunch: () => void
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  updater: UpdaterController
  showUpdater: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void> | void
  setNativeTranslations: (bundle: DesktopNativeBundle) => void
}

export function assertTrustedRenderer(event: Pick<IpcMainInvokeEvent, "sender" | "senderFrame">) {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (
    !win ||
    win.isDestroyed() ||
    win.webContents !== event.sender ||
    event.senderFrame !== event.sender.mainFrame
  ) {
    throw new Error("Invalid IPC sender")
  }
  return win
}

export function registerIpcHandlers(deps: Deps) {
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

  const stopDiskSnapshotOwner = (owner: string) => {
    detachDiskSnapshotOwner(owner)
    diskDeleteAuthorizations.removeOwner(owner)
    return diskSnapshots.stop(owner)
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
  handle("disklizard:get-storage-diagnostics", async () =>
    getDiskStorageDiagnostics({ drives: await getDrives() }),
  )
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
      const senderID = event.sender.id
      const scanID = requestedScanID || "primary"
      const owner = `${senderID}:${scanID}`
      detachDiskSnapshotOwner(owner)
      diskDeleteAuthorizations.removeOwner(owner)
      diskScans.get(owner)?.abort(new Error("Superseded by a new scan"))
      const controller = new AbortController()
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
          maxChildren: 48,
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
              source: result.source,
            })
          }
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
    void Promise.all(owners.map(stopDiskSnapshotOwner))
  })
  handle("disklizard:stop-watching", (event: IpcMainInvokeEvent, requestedScanID?: string) => {
    const prefix = `${event.sender.id}:`
    if (requestedScanID) return stopDiskSnapshotOwner(`${prefix}${requestedScanID}`)
    return Promise.all(
      [...diskSnapshots.activeOwners()]
        .filter((owner) => String(owner).startsWith(prefix))
        .map((owner) => stopDiskSnapshotOwner(String(owner))),
    )
  })
  handle(
    "disklizard:authorize-delete-paths",
    (event: IpcMainInvokeEvent, paths: readonly string[]) =>
      diskDeleteAuthorizations.authorize(event.sender.id, paths, assertSafeDeletionPath),
  )
  handle(
    "disklizard:delete-path",
    async (event: IpcMainInvokeEvent, targetPath: string, options: DiskDeleteOptions) => {
      await diskDeleteAuthorizations.consume(event.sender.id, targetPath, options?.authorization)
      await runGuardedDiskDelete(
        targetPath,
        options?.precondition,
        assertSafeDeletionPath,
        async (path) => shell.trashItem(path),
      )
      return { ok: true }
    },
  )
  handle("disklizard:preview-path", (_event: IpcMainInvokeEvent, targetPath: string) =>
    readDiskPreview(targetPath),
  )
  handle("disklizard:system-preview-path", async (_event: IpcMainInvokeEvent, targetPath: string) => {
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
        : join(app.getPath("home"), ".local", "share", "Trash", "files")
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  handle("disklizard:reveal-path", async (_event: IpcMainInvokeEvent, targetPath: string) => {
    await stat(targetPath)
    shell.showItemInFolder(targetPath)
  })
  handle("disklizard:choose-folder", async (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ["openDirectory"],
      title: "Choose folder to scan",
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  handle("consume-initial-deep-links", () => deps.consumeInitialDeepLinks())
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
  handle("set-background-color", (_event: IpcMainInvokeEvent, color: string) => deps.setBackgroundColor(color))
  handle("export-debug-logs", () => deps.exportDebugLogs())
  handle("set-force-focus", (event: IpcMainInvokeEvent, enabled: boolean) => setForceFocus(event.sender, enabled))
  handle("record-fatal-renderer-error", (_event: IpcMainInvokeEvent, error: FatalRendererError) =>
    deps.recordFatalRendererError(error),
  )
  handle("set-native-translations", (_event: IpcMainInvokeEvent, value: unknown) => {
    const bundle = parseDesktopNativeBundle(value)
    if (!bundle) throw new Error("Invalid native translation bundle")
    deps.setNativeTranslations(bundle)
  })
  handle("store-get", (_event: IpcMainInvokeEvent, id: unknown, key: string) => {
    try {
      const store = getStore(resolveRendererStoreName(id))
      const value = store.get(key)
      if (value === undefined || value === null) return null
      return typeof value === "string" ? value : JSON.stringify(value)
    } catch {
      return null
    }
  })
  handle("store-set", (_event: IpcMainInvokeEvent, id: unknown, key: string, value: string) => {
    getStore(resolveRendererStoreName(id)).set(key, value)
  })
  handle("store-delete", (_event: IpcMainInvokeEvent, id: unknown, key: string) => {
    const name = resolveRendererStoreName(id)
    getStore(name).delete(key)
    void removeStoreFileIfEmpty(name)
  })
  handle("store-clear", (_event: IpcMainInvokeEvent, id: unknown) => {
    const name = resolveRendererStoreName(id)
    getStore(name).clear()
    void removeStoreFileIfEmpty(name)
  })
  handle("store-keys", (_event: IpcMainInvokeEvent, id: unknown) => {
    const store = getStore(resolveRendererStoreName(id))
    return Object.keys(store.store)
  })
  handle("store-length", (_event: IpcMainInvokeEvent, id: unknown) => {
    const store = getStore(resolveRendererStoreName(id))
    return Object.keys(store.store).length
  })

  handle(
    "open-directory-picker",
    async (_event: IpcMainInvokeEvent, opts?: { multiple?: boolean; title?: string; defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...(opts?.multiple ? ["multiSelections" as const] : []), "createDirectory"],
        title: opts?.title ?? nativeT("desktop.dialog.chooseFolder"),
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return opts?.multiple ? result.filePaths : result.filePaths[0]
    },
  )

  handle(
    "open-file-picker",
    async (
      event: IpcMainInvokeEvent,
      opts?: { multiple?: boolean; title?: string; defaultPath?: string; extensions?: string[] },
    ) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", ...(opts?.multiple ? ["multiSelections" as const] : [])],
        title: opts?.title ?? nativeT("desktop.dialog.chooseFile"),
        defaultPath: opts?.defaultPath,
        filters: pickerFilters(opts?.extensions),
      })
      if (result.canceled) return null
      const files = await Promise.all(
        result.filePaths.map(async (filePath) => ({
          path: filePath,
          name: basename(filePath),
          size: (await stat(filePath)).size,
        })),
      )
      assertAttachmentBudget(files)
      const token = pickedFiles.add(event.sender.id, result.filePaths)
      return { token, files }
    },
  )

  handle("read-picked-file", async (event: IpcMainInvokeEvent, token: string, filePath: string) => {
    return pickedFiles.read(event.sender.id, token, filePath)
  })

  handle("release-picked-files", (event: IpcMainInvokeEvent, token: string) => {
    pickedFiles.release(event.sender.id, token)
  })

  handle(
    "save-file-picker",
    async (_event: IpcMainInvokeEvent, opts?: { title?: string; defaultPath?: string }) => {
      const result = await dialog.showSaveDialog({
        title: opts?.title ?? nativeT("desktop.dialog.saveFile"),
        defaultPath: opts?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePath ?? null
    },
  )

  on("open-external", (_event: IpcMainEvent, url: string) => openExternalURL(url))
  on("open-local-file", (_event: IpcMainEvent, url: string) => openLocalFileURL(url))

  handle("open-path", (_event: IpcMainInvokeEvent, path: string) => shell.openPath(path))

  handle("read-clipboard-image", () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = image.toPNG().buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })

  on("show-notification", (_event: IpcMainEvent, title: string, body?: string) => {
    new Notification({ title, body }).show()
  })

  handle("get-window-count", () => BrowserWindow.getAllWindows().length)

  handle("get-window-id", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) throw new Error("Window not found")
    const id = getWindowID(win)
    if (!id) throw new Error("Window ID not found")
    return id
  })

  handle("get-window-focused", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFocused() ?? false
  })

  handle("get-window-fullscreen", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFullScreen() ?? false
  })

  handle("set-window-focus", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.focus()
  })

  handle("show-window", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.show()
  })

  on("relaunch", () => {
    deps.relaunch()
  })

  handle("get-zoom-factor", (event: IpcMainInvokeEvent) => event.sender.getZoomFactor())
  handle("set-zoom-factor", (event: IpcMainInvokeEvent, factor: number) => {
    event.sender.setZoomFactor(factor)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    updateTitlebar(win)
  })
  handle("get-pinch-zoom-enabled", () => getPinchZoomEnabled())
  handle("set-pinch-zoom-enabled", (_event: IpcMainInvokeEvent, enabled: boolean) => {
    setPinchZoomEnabled(enabled)
  })
  handle("set-titlebar", (event: IpcMainInvokeEvent, theme: TitlebarTheme) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebar(win, theme)
  })
  handle("run-desktop-menu-action", (event: IpcMainInvokeEvent, action: DesktopMenuAction) => {
    runDesktopMenuAction(BrowserWindow.fromWebContents(event.sender), action, {
      checkForUpdates: () => void deps.showUpdater(),
      relaunch: deps.relaunch,
    })
  })
}

export function sendMenuCommand(win: BrowserWindow, id: string) {
  win.webContents.send("menu-command", id)
}

export function sendDeepLinks(win: BrowserWindow, urls: string[]) {
  win.webContents.send("deep-link", urls)
}
