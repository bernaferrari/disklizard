import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { ElectronAPI } from "./types"
import type { UpdaterState } from "../main/updater-controller"

const updaterCallbacks = new Set<(state: UpdaterState) => void>()
let updaterState: UpdaterState | undefined
let updaterSubscription: Promise<void> | undefined
const updaterHandler = (_: unknown, state: UpdaterState) => {
  updaterState = state
  updaterCallbacks.forEach((callback) => callback(state))
}

const api: ElectronAPI = {
  disklizard: {
    getDrives: () => ipcRenderer.invoke("disklizard:get-drives"),
    onDriveFacts: (cb) => {
      const handler = (_: unknown, update: Parameters<typeof cb>[0]) => cb(update)
      ipcRenderer.on("disklizard:drive-facts", handler)
      return () => ipcRenderer.removeListener("disklizard:drive-facts", handler)
    },
    getStorageDiagnostics: () => ipcRenderer.invoke("disklizard:get-storage-diagnostics"),
    openDiskAccessSettings: () => ipcRenderer.invoke("disklizard:open-disk-access-settings"),
    scanPath: (path, options, scanId) => ipcRenderer.invoke("disklizard:scan-path", path, options, scanId),
    cancelScan: (scanId) => ipcRenderer.invoke("disklizard:cancel-scan", scanId),
    stopWatching: (scanId) => ipcRenderer.invoke("disklizard:stop-watching", scanId),
    authorizeDeletePaths: (paths) => ipcRenderer.invoke("disklizard:authorize-delete-paths", paths),
    deletePath: (path, options) => ipcRenderer.invoke("disklizard:delete-path", path, options),
    previewPath: (path) => ipcRenderer.invoke("disklizard:preview-path", path),
    systemPreviewPath: (path) => ipcRenderer.invoke("disklizard:system-preview-path", path),
    openTrash: () => ipcRenderer.invoke("disklizard:open-trash"),
    revealPath: (path) => ipcRenderer.invoke("disklizard:reveal-path", path),
    chooseFolder: () => ipcRenderer.invoke("disklizard:choose-folder"),
    onScanProgress: (cb) => {
      const handler = (_: unknown, progress: Parameters<typeof cb>[0]) => cb(progress)
      ipcRenderer.on("disklizard:scan-progress", handler)
      return () => ipcRenderer.removeListener("disklizard:scan-progress", handler)
    },
    onScanUpdate: (cb) => {
      const handler = (_: unknown, update: Parameters<typeof cb>[0]) => cb(update)
      ipcRenderer.on("disklizard:scan-update", handler)
      return () => ipcRenderer.removeListener("disklizard:scan-update", handler)
    },
  },
  updater: {
    subscribe: async (cb) => {
      updaterCallbacks.add(cb)
      if (updaterState) cb(updaterState)
      if (!updaterSubscription) {
        ipcRenderer.on("updater-state", updaterHandler)
        updaterSubscription = ipcRenderer.invoke("updater-subscribe")
      }
      await updaterSubscription
      return () => {
        updaterCallbacks.delete(cb)
        if (updaterCallbacks.size > 0) return
        ipcRenderer.removeListener("updater-state", updaterHandler)
        updaterSubscription = undefined
        void ipcRenderer.invoke("updater-unsubscribe")
      }
    },
    check: () => ipcRenderer.invoke("updater-check"),
    install: () => ipcRenderer.invoke("updater-install"),
  },
  consumeInitialDeepLinks: () => ipcRenderer.invoke("consume-initial-deep-links"),
  storeGet: (name, key) => ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => ipcRenderer.invoke("store-length", name),

  getWindowID: () => ipcRenderer.invoke("get-window-id"),
  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  onDeepLink: (cb) => {
    const handler = (_: unknown, urls: string[]) => cb(urls)
    ipcRenderer.on("deep-link", handler)
    return () => ipcRenderer.removeListener("deep-link", handler)
  },

  openDirectoryPicker: (opts) => ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => ipcRenderer.invoke("open-file-picker", opts),
  readPickedFile: (token, path) => ipcRenderer.invoke("read-picked-file", token, path),
  releasePickedFiles: (token) => ipcRenderer.invoke("release-picked-files", token),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  saveFilePicker: (opts) => ipcRenderer.invoke("save-file-picker", opts),
  openExternal: (url) => ipcRenderer.send("open-external", url),
  openLocalFile: (url) => ipcRenderer.send("open-local-file", url),
  openPath: (path) => ipcRenderer.invoke("open-path", path),
  revealPath: (path) => ipcRenderer.invoke("reveal-path", path),
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
  getWindowFocused: () => ipcRenderer.invoke("get-window-focused"),
  getWindowFullscreen: () => ipcRenderer.invoke("get-window-fullscreen"),
  onWindowFullscreenChanged: (cb) => {
    const handler = (_: unknown, fullscreen: boolean) => cb(fullscreen)
    ipcRenderer.on("window-fullscreen-changed", handler)
    return () => ipcRenderer.removeListener("window-fullscreen-changed", handler)
  },
  setWindowFocus: () => ipcRenderer.invoke("set-window-focus"),
  showWindow: () => ipcRenderer.invoke("show-window"),
  relaunch: () => ipcRenderer.send("relaunch"),
  getZoomFactor: () => ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => ipcRenderer.invoke("set-zoom-factor", factor),
  getPinchZoomEnabled: () => ipcRenderer.invoke("get-pinch-zoom-enabled"),
  setPinchZoomEnabled: (enabled) => ipcRenderer.invoke("set-pinch-zoom-enabled", enabled),
  onPinchZoomEnabledChanged: (cb) => {
    const handler = (_: unknown, enabled: boolean) => cb(enabled)
    ipcRenderer.on("pinch-zoom-enabled-changed", handler)
    return () => ipcRenderer.removeListener("pinch-zoom-enabled-changed", handler)
  },
  onZoomFactorChanged: (cb) => {
    const handler = (_: unknown, factor: number) => cb(factor)
    ipcRenderer.on("zoom-factor-changed", handler)
    return () => ipcRenderer.removeListener("zoom-factor-changed", handler)
  },
  setTitlebar: (theme) => ipcRenderer.invoke("set-titlebar", theme),
  runDesktopMenuAction: (action) => ipcRenderer.invoke("run-desktop-menu-action", action),
  setBackgroundColor: (color: string) => ipcRenderer.invoke("set-background-color", color),
  exportDebugLogs: () => ipcRenderer.invoke("export-debug-logs"),
  setForceFocus: (enabled) => ipcRenderer.invoke("set-force-focus", enabled),
  recordFatalRendererError: (error) => ipcRenderer.invoke("record-fatal-renderer-error", error),
  setNativeTranslations: (bundle) => ipcRenderer.invoke("set-native-translations", bundle),
}

contextBridge.exposeInMainWorld("api", api)
