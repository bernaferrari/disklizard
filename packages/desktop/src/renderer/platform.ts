import {
  createDiskLizardMenu,
  type DiskLizardPlatform,
  type DiskLizardUpdaterState,
} from "@disklizard/app/runtime"
import pkg from "../../package.json"

export function desktopOS(): DiskLizardPlatform["os"] {
  const ua = navigator.userAgent
  if (ua.includes("Mac")) return "macos"
  if (ua.includes("Windows")) return "windows"
  if (ua.includes("Linux")) return "linux"
  return undefined
}

export function createDesktopStorage() {
  const api = {
    getItem: (key: string) => window.api.storeGet(key),
    setItem: (key: string, value: string) => window.api.storeSet(key, value),
    removeItem: (key: string) => window.api.storeDelete(key),
    clear: () => window.api.storeClear(),
    key: async (index: number) => (await window.api.storeKeys())[index],
    getLength: () => window.api.storeLength(),
    get length() {
      return window.api.storeLength()
    },
  }
  return () => api
}

export function createDiskLizardPlatform(updaterState: () => DiskLizardUpdaterState): DiskLizardPlatform {
  const os = desktopOS()
  return {
    platform: "desktop",
    os,
    version: pkg.version,
    menu: createDiskLizardMenu(),
    diskUtility: {
      getVolumeInfo: window.api.disklizard.getVolumeInfo ? (path) => window.api.disklizard.getVolumeInfo!(path) : undefined,
      revealVolume: window.api.disklizard.revealVolume ? (path) => window.api.disklizard.revealVolume!(path) : undefined,
      ejectVolume: window.api.disklizard.ejectVolume ? (path) => window.api.disklizard.ejectVolume!(path) : undefined,
      getHomePath: () => window.api.disklizard.getHomePath(),
      getDrives: () => window.api.disklizard.getDrives(),
      onDriveFacts: (cb) => window.api.disklizard.onDriveFacts(cb),
      getStorageDiagnostics: () => window.api.disklizard.getStorageDiagnostics(),
      openDiskAccessSettings: () => window.api.disklizard.openDiskAccessSettings(),
      scanPath: (path, options, scanId) => window.api.disklizard.scanPath(path, options, scanId),
      cancelScan: (scanId) => window.api.disklizard.cancelScan(scanId),
      stopWatching: (scanId) => window.api.disklizard.stopWatching(scanId),
      authorizeDeletePaths: (paths) => window.api.disklizard.authorizeDeletePaths(paths),
      checkDeleteAccess: (path) => window.api.disklizard.checkDeleteAccess(path),
      deletePath: (path, options) => window.api.disklizard.deletePath(path, options),
      previewPath: (path) => window.api.disklizard.previewPath(path),
      systemPreviewPath: (path) => window.api.disklizard.systemPreviewPath(path),
      openPath: (path) => window.api.disklizard.openPath(path),
      openTrash: () => window.api.disklizard.openTrash(),
      revealPath: (path) => window.api.disklizard.revealPath(path),
      chooseFolder: () => window.api.disklizard.chooseFolder(),
      onScanProgress: (cb) => window.api.disklizard.onScanProgress(cb),
      onScanUpdate: (cb) => window.api.disklizard.onScanUpdate(cb),
    },
    getPathForFile: (file) => window.api.getPathForFile(file),
    storage: createDesktopStorage(),
    updater: {
      state: updaterState(),
      check: () => window.api.updater.check(),
      install: () => window.api.updater.install(),
    },
    restart: async () => {
      window.api.relaunch()
    },
    exportDiagnostics: () => window.api.exportDebugLogs(),
    openExternal: (url) => window.api.openExternal(url),
    windowFullscreen: false,
  }
}

export function runRendererMenuAction(action: string) {
  return window.api.runDesktopMenuAction(action as never)
}
