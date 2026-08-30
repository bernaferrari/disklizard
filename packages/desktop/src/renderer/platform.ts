import {
  createDiskLizardMenu,
  type DiskLizardPlatform,
  type DiskLizardUpdaterState,
} from "@disklizard/app/runtime"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createSignal } from "solid-js"
import pkg from "../../package.json"
import { createWindowFullscreen } from "./window-fullscreen"

export function desktopOS(): DiskLizardPlatform["os"] {
  const ua = navigator.userAgent
  if (ua.includes("Mac")) return "macos"
  if (ua.includes("Windows")) return "windows"
  if (ua.includes("Linux")) return "linux"
  return undefined
}

export function createDesktopStorage() {
  const api: AsyncStorage = {
    getItem: (key: string) => window.api.storeGet(key),
    setItem: (key: string, value: string) => window.api.storeSet(key, value),
    removeItem: (key: string) => window.api.storeDelete(key),
    clear: () => window.api.storeClear(),
    key: async (index: number) => (await window.api.storeKeys())[index],
    getLength: () => window.api.storeLength(),
    get length() {
      return api.getLength()
    },
  }
  return () => api
}

export function createDiskLizardPlatform(updaterState: () => DiskLizardUpdaterState): DiskLizardPlatform {
  const os = desktopOS()
  const fullscreen = createWindowFullscreen(window.api)
  return {
    platform: "desktop",
    os,
    version: pkg.version,
    menu: createDiskLizardMenu(),
    diskUtility: {
      getDrives: () => window.api.disklizard.getDrives(),
      onDriveFacts: (cb) => window.api.disklizard.onDriveFacts(cb),
      getStorageDiagnostics: () => window.api.disklizard.getStorageDiagnostics(),
      openDiskAccessSettings: () => window.api.disklizard.openDiskAccessSettings(),
      scanPath: (path, options, scanId) => window.api.disklizard.scanPath(path, options, scanId),
      cancelScan: (scanId) => window.api.disklizard.cancelScan(scanId),
      stopWatching: (scanId) => window.api.disklizard.stopWatching(scanId),
      authorizeDeletePaths: (paths) => window.api.disklizard.authorizeDeletePaths(paths),
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
      state: updaterState,
      check: () => window.api.updater.check(),
      install: () => window.api.updater.install(),
    },
    restart: async () => {
      window.api.relaunch()
    },
    exportDiagnostics: () => window.api.exportDebugLogs(),
    openExternal: (url) => window.api.openExternal(url),
    windowFullscreen: fullscreen.value,
    dispose: fullscreen.dispose,
  }
}

export function runRendererMenuAction(action: string) {
  return window.api.runDesktopMenuAction(action as never)
}
