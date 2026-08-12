import { execFile, spawn } from "node:child_process"
import { rm, stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { app, BrowserWindow, Notification, clipboard, dialog, ipcMain, shell } from "electron"
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron"
import type { DesktopMenuAction } from "@opencode-ai/app/desktop-menu"
import { parseDesktopNativeBundle, type DesktopNativeBundle } from "@opencode-ai/app/i18n/desktop-native"

import type { FatalRendererError, ServerReadyData, TitlebarTheme } from "../preload/types"
import { runDesktopMenuAction } from "./desktop-menu-actions"
import { setForceFocus } from "./debug"
import { assertAttachmentBudget, createPickedFileAuthorizations } from "./attachment-picker"
import { diskAccessSettingsUrl, getDiskStorageDiagnostics } from "./disk-platform"
import { runGuardedDiskDelete, type DiskDeleteOptions } from "./disk-delete-precondition"
import { quickLookCommand, readDiskPreview } from "./disk-preview"
import { publishDriveFacts } from "./disk-drive-facts"
import { assertSafeDeletionPath, getDriveFacts, getDrives, mountExclusions, scanPath } from "./disk-scanner"
import type { ScanOptions, ScanProgress } from "./disk-scanner"
import { DiskSnapshotManager } from "./disk-snapshot"
import { getStore, removeStoreFileIfEmpty } from "./store"
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
import { createDesktopDraftStore } from "./draft-store"
import { nativeT } from "./native-translations"

const pickerFilters = (ext?: string[]) => {
  if (!ext || ext.length === 0) return undefined
  return [{ name: nativeT("desktop.dialog.files"), extensions: ext }]
}

const pickedFiles = createPickedFileAuthorizations()

type Deps = {
  killSidecar: () => Promise<void> | void
  relaunch: () => void
  awaitInitialization: () => Promise<ServerReadyData>
  consumeInitialDeepLinks: () => Promise<string[]> | string[]
  getDefaultServerUrl: () => Promise<string | null> | string | null
  setDefaultServerUrl: (url: string | null) => Promise<void> | void
  isFirstLaunchOnboardingPending: () => Promise<boolean> | boolean
  finishFirstLaunchOnboarding: (createDefaultProject: boolean) => Promise<string | null> | string | null
  isOldLayoutEligible: () => Promise<boolean> | boolean
  getDisplayBackend: () => Promise<string | null>
  setDisplayBackend: (backend: string | null) => Promise<void> | void
  parseMarkdown: (markdown: string) => Promise<string> | string
  checkAppExists: (appName: string) => Promise<boolean> | boolean
  resolveAppPath: (appName: string) => Promise<string | null>
  updater: UpdaterController
  showUpdater: () => Promise<void> | void
  setBackgroundColor: (color: string) => void
  exportDebugLogs: () => Promise<string>
  recordFatalRendererError: (error: FatalRendererError) => Promise<void> | void
  setNativeTranslations: (bundle: DesktopNativeBundle) => void
}

export function registerIpcHandlers(deps: Deps) {
  const drafts = createDesktopDraftStore(join(app.getPath("userData"), "drafts.sqlite"))
  const updaterSubscriptions = createUpdaterSubscriptions()
  const diskScans = new Map<string, AbortController>()
  const diskSnapshotCache = join(app.getPath("userData"), "disklizard", "snapshots")
  const diskSnapshots = new DiskSnapshotManager({
    cacheDir: diskSnapshotCache,
    scan: scanPath,
  })
  app.once("will-quit", () => {
    updaterSubscriptions.clear()
    void diskSnapshots.stopAll()
  })
  app.on("before-quit", () => drafts.flush())
  app.once("will-quit", () => drafts.close())
  app.on("browser-window-created", (_event, win) => win.on("session-end", () => drafts.flush()))

  ipcMain.handle("disklizard:get-drives", async (event: IpcMainInvokeEvent) => {
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
  ipcMain.handle("disklizard:get-storage-diagnostics", async () =>
    getDiskStorageDiagnostics({ drives: await getDrives() }),
  )
  ipcMain.handle("disklizard:open-disk-access-settings", async () => {
    const url = diskAccessSettingsUrl()
    if (!url) return false
    await shell.openExternal(url)
    return true
  })
  ipcMain.handle(
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
      diskScans.get(owner)?.abort(new Error("Superseded by a new scan"))
      const controller = new AbortController()
      let latestProgress: ScanProgress | undefined
      const onDestroyed = () => controller.abort(new Error("Scan window closed"))
      diskScans.set(owner, controller)
      event.sender.once("destroyed", onDestroyed)
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
                void diskSnapshots.stop(owner)
                return
              }
              event.sender.send("disklizard:scan-update", { ...update, scanId: scanID })
            },
            options?.forceFresh === true,
          )
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
          event.sender.once("destroyed", () => void diskSnapshots.stop(owner))
          return result.root
        } catch (error) {
          if (controller.signal.aborted) return null
          throw error
        }
      } finally {
        if (diskScans.get(owner) === controller) diskScans.delete(owner)
        if (!event.sender.isDestroyed()) event.sender.removeListener("destroyed", onDestroyed)
      }
    },
  )
  ipcMain.handle("disklizard:cancel-scan", (event: IpcMainInvokeEvent, requestedScanID?: string) => {
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
    void Promise.all(owners.map((owner) => diskSnapshots.stop(owner)))
  })
  ipcMain.handle("disklizard:stop-watching", (event: IpcMainInvokeEvent, requestedScanID?: string) => {
    const prefix = `${event.sender.id}:`
    if (requestedScanID) return diskSnapshots.stop(`${prefix}${requestedScanID}`)
    return Promise.all(
      [...diskSnapshots.activeOwners()]
        .filter((owner) => String(owner).startsWith(prefix))
        .map((owner) => diskSnapshots.stop(owner)),
    )
  })
  ipcMain.handle(
    "disklizard:delete-path",
    async (_event: IpcMainInvokeEvent, targetPath: string, options?: DiskDeleteOptions) => {
      await runGuardedDiskDelete(
        targetPath,
        options?.precondition,
        assertSafeDeletionPath,
        options?.permanent
          ? async (path) => rm(path, { recursive: true, force: true })
          : async (path) => shell.trashItem(path),
      )
      return { ok: true }
    },
  )
  ipcMain.handle("disklizard:preview-path", (_event: IpcMainInvokeEvent, targetPath: string) =>
    readDiskPreview(targetPath),
  )
  ipcMain.handle("disklizard:system-preview-path", async (_event: IpcMainInvokeEvent, targetPath: string) => {
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
  ipcMain.handle("disklizard:open-trash", async () => {
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
  ipcMain.handle("disklizard:reveal-path", async (_event: IpcMainInvokeEvent, targetPath: string) => {
    await stat(targetPath)
    shell.showItemInFolder(targetPath)
  })
  ipcMain.handle("disklizard:choose-folder", async (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      properties: ["openDirectory"],
      title: "Choose folder to scan",
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle("kill-sidecar", () => deps.killSidecar())
  ipcMain.handle("await-initialization", () => deps.awaitInitialization())
  ipcMain.handle("consume-initial-deep-links", () => deps.consumeInitialDeepLinks())
  ipcMain.handle("get-default-server-url", () => deps.getDefaultServerUrl())
  ipcMain.handle("set-default-server-url", (_event: IpcMainInvokeEvent, url: string | null) =>
    deps.setDefaultServerUrl(url),
  )
  ipcMain.handle("is-first-launch-onboarding-pending", () => deps.isFirstLaunchOnboardingPending())
  ipcMain.handle("finish-first-launch-onboarding", (_event: IpcMainInvokeEvent, createDefaultProject: boolean) =>
    deps.finishFirstLaunchOnboarding(createDefaultProject),
  )
  ipcMain.handle("is-old-layout-eligible", () => deps.isOldLayoutEligible())
  ipcMain.handle("get-display-backend", () => deps.getDisplayBackend())
  ipcMain.handle("set-display-backend", (_event: IpcMainInvokeEvent, backend: string | null) =>
    deps.setDisplayBackend(backend),
  )
  ipcMain.handle("parse-markdown", (_event: IpcMainInvokeEvent, markdown: string) => deps.parseMarkdown(markdown))
  ipcMain.handle("check-app-exists", (_event: IpcMainInvokeEvent, appName: string) => deps.checkAppExists(appName))
  ipcMain.handle("resolve-app-path", (_event: IpcMainInvokeEvent, appName: string) => deps.resolveAppPath(appName))
  ipcMain.handle("updater-subscribe", (event) => {
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
  ipcMain.handle("updater-unsubscribe", (event) => updaterSubscriptions.delete(event.sender.id))
  ipcMain.handle("updater-check", () => deps.updater.check())
  ipcMain.handle("updater-install", () => deps.updater.install())
  ipcMain.handle("set-background-color", (_event: IpcMainInvokeEvent, color: string) => deps.setBackgroundColor(color))
  ipcMain.handle("export-debug-logs", () => deps.exportDebugLogs())
  ipcMain.handle("set-force-focus", (event: IpcMainInvokeEvent, enabled: boolean) => setForceFocus(event.sender, enabled))
  ipcMain.handle("record-fatal-renderer-error", (_event: IpcMainInvokeEvent, error: FatalRendererError) =>
    deps.recordFatalRendererError(error),
  )
  ipcMain.handle("set-native-translations", (event: IpcMainInvokeEvent, value: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed() || win.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Invalid native translation sender")
    }
    const bundle = parseDesktopNativeBundle(value)
    if (!bundle) throw new Error("Invalid native translation bundle")
    deps.setNativeTranslations(bundle)
  })
  ipcMain.handle("store-get", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    try {
      const store = getStore(name)
      const value = store.get(key)
      if (value === undefined || value === null) return null
      return typeof value === "string" ? value : JSON.stringify(value)
    } catch {
      return null
    }
  })
  ipcMain.handle("store-set", (_event: IpcMainInvokeEvent, name: string, key: string, value: string) => {
    getStore(name).set(key, value)
  })
  ipcMain.handle("store-delete", (_event: IpcMainInvokeEvent, name: string, key: string) => {
    getStore(name).delete(key)
    void removeStoreFileIfEmpty(name)
  })
  ipcMain.handle("store-clear", (_event: IpcMainInvokeEvent, name: string) => {
    getStore(name).clear()
    void removeStoreFileIfEmpty(name)
  })
  ipcMain.handle("draft-get", (_event, key: string) => drafts.get(key))
  ipcMain.handle("draft-set", (_event, key: string, value: string) => drafts.set(key, value))
  ipcMain.handle("draft-delete", (_event, key: string) => drafts.set(key, null))
  ipcMain.handle("draft-blob-put", (_event, data: ArrayBuffer) => drafts.putBlob(new Uint8Array(data)))
  ipcMain.handle("draft-blob-get", (_event, id: string) => {
    const data = drafts.getBlob(id)
    return data ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null
  })
  ipcMain.handle("store-keys", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store)
  })
  ipcMain.handle("store-length", (_event: IpcMainInvokeEvent, name: string) => {
    const store = getStore(name)
    return Object.keys(store.store).length
  })

  ipcMain.handle(
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

  ipcMain.handle(
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

  ipcMain.handle("read-picked-file", async (event: IpcMainInvokeEvent, token: string, filePath: string) => {
    return pickedFiles.read(event.sender.id, token, filePath)
  })

  ipcMain.handle("release-picked-files", (event: IpcMainInvokeEvent, token: string) => {
    pickedFiles.release(event.sender.id, token)
  })

  ipcMain.handle(
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

  ipcMain.on("open-external", (_event: IpcMainEvent, url: string) => openExternalURL(url))
  ipcMain.on("open-local-file", (_event: IpcMainEvent, url: string) => openLocalFileURL(url))

  ipcMain.handle("open-path", async (_event: IpcMainInvokeEvent, path: string, app?: string) => {
    if (!app) return shell.openPath(path)
    return new Promise<void>((resolve, reject) => {
      const [cmd, args] =
        process.platform === "darwin" ? (["open", ["-a", app, path]] as const) : ([app, [path]] as const)
      execFile(cmd, args, (err) => (err ? reject(err) : resolve()))
    })
  })

  ipcMain.handle("read-clipboard-image", () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const buffer = image.toPNG().buffer
    const size = image.getSize()
    return { buffer, width: size.width, height: size.height }
  })

  ipcMain.on("show-notification", (_event: IpcMainEvent, title: string, body?: string) => {
    new Notification({ title, body }).show()
  })

  ipcMain.handle("get-window-count", () => BrowserWindow.getAllWindows().length)

  ipcMain.handle("get-window-focused", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win?.isFocused() ?? false
  })

  ipcMain.handle("set-window-focus", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.focus()
  })

  ipcMain.handle("show-window", (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.show()
  })

  ipcMain.on("relaunch", () => {
    deps.relaunch()
  })

  ipcMain.handle("get-zoom-factor", (event: IpcMainInvokeEvent) => event.sender.getZoomFactor())
  ipcMain.handle("set-zoom-factor", (event: IpcMainInvokeEvent, factor: number) => {
    event.sender.setZoomFactor(factor)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    updateTitlebar(win)
  })
  ipcMain.handle("get-pinch-zoom-enabled", () => getPinchZoomEnabled())
  ipcMain.handle("set-pinch-zoom-enabled", (_event: IpcMainInvokeEvent, enabled: boolean) => {
    setPinchZoomEnabled(enabled)
  })
  ipcMain.handle("set-titlebar", (event: IpcMainInvokeEvent, theme: TitlebarTheme) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    setTitlebar(win, theme)
  })
  ipcMain.handle("run-desktop-menu-action", (event: IpcMainInvokeEvent, action: DesktopMenuAction) => {
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
