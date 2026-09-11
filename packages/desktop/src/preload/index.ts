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
    getVolumeInfo: (path) => ipcRenderer.invoke("disklizard:volume-info", path),
    revealVolume: (path) => ipcRenderer.invoke("disklizard:reveal-volume", path),
    ejectVolume: (path) => ipcRenderer.invoke("disklizard:eject-volume", path),
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
    stopWatching: (scanId, options) => ipcRenderer.invoke("disklizard:stop-watching", scanId, options),
    authorizeDeletePaths: (paths) => ipcRenderer.invoke("disklizard:authorize-delete-paths", paths),
    deletePath: (path, options) => ipcRenderer.invoke("disklizard:delete-path", path, options),
    previewPath: (path) => ipcRenderer.invoke("disklizard:preview-path", path),
    systemPreviewPath: (path) => ipcRenderer.invoke("disklizard:system-preview-path", path),
    openPath: (path) => ipcRenderer.invoke("disklizard:open-path", path),
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
  storeGet: (key) => ipcRenderer.invoke("disklizard:store-get", key),
  storeSet: (key, value) => ipcRenderer.invoke("disklizard:store-set", key, value),
  storeDelete: (key) => ipcRenderer.invoke("disklizard:store-delete", key),
  storeClear: () => ipcRenderer.invoke("disklizard:store-clear"),
  storeKeys: () => ipcRenderer.invoke("disklizard:store-keys"),
  storeLength: () => ipcRenderer.invoke("disklizard:store-length"),

  onMenuCommand: (cb) => {
    const handler = (_: unknown, id: string) => cb(id)
    ipcRenderer.on("menu-command", handler)
    return () => ipcRenderer.removeListener("menu-command", handler)
  },
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openExternal: (url) => ipcRenderer.send("open-external", url),
  getWindowFullscreen: () => ipcRenderer.invoke("get-window-fullscreen"),
  onWindowFullscreenChanged: (cb) => {
    const handler = (_: unknown, fullscreen: boolean) => cb(fullscreen)
    ipcRenderer.on("window-fullscreen-changed", handler)
    return () => ipcRenderer.removeListener("window-fullscreen-changed", handler)
  },
  relaunch: () => ipcRenderer.send("relaunch"),
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
  setNativeTranslations: (bundle) => ipcRenderer.invoke("set-native-translations", bundle),
}

contextBridge.exposeInMainWorld("api", api)
