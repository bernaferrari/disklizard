import {
  createDiskLizardMenu,
  type DiskLizardPlatform,
  type DiskLizardUpdaterState,
} from "../../../app/src/pages/disk-utility/runtime"
import type { AsyncStorage } from "@solid-primitives/storage"
import { createSignal } from "solid-js"
import pkg from "../../package.json"

export function desktopOS(): DiskLizardPlatform["os"] {
  const ua = navigator.userAgent
  if (ua.includes("Mac")) return "macos"
  if (ua.includes("Windows")) return "windows"
  if (ua.includes("Linux")) return "linux"
  return undefined
}

export function createDesktopStorage() {
  const cache = new Map<string, AsyncStorage>()

  const createStorage = (name: string) => {
    const api: AsyncStorage = {
      getItem: (key: string) => window.api.storeGet(name, key),
      setItem: (key: string, value: string) => window.api.storeSet(name, key, value),
      removeItem: (key: string) => window.api.storeDelete(name, key),
      clear: () => window.api.storeClear(name),
      key: async (index: number) => (await window.api.storeKeys(name))[index],
      getLength: () => window.api.storeLength(name),
      get length() {
        return api.getLength()
      },
    }
    return api
  }

  return (name = "disklizard.dat") => {
    const cached = cache.get(name)
    if (cached) return cached
    const api = createStorage(name)
    cache.set(name, api)
    return api
  }
}

export function createDiskLizardPlatform(updaterState: () => DiskLizardUpdaterState): DiskLizardPlatform {
  const os = desktopOS()
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
      deletePath: (path, options) => window.api.disklizard.deletePath(path, options),
      previewPath: (path) => window.api.disklizard.previewPath(path),
      systemPreviewPath: (path) => window.api.disklizard.systemPreviewPath(path),
      openTrash: () => window.api.disklizard.openTrash(),
      revealPath: (path) => window.api.disklizard.revealPath(path),
      chooseFolder: () => window.api.disklizard.chooseFolder(),
      onScanProgress: (cb) => window.api.disklizard.onScanProgress(cb),
      onScanUpdate: (cb) => window.api.disklizard.onScanUpdate(cb),
    },
    openPath: (path, app) => window.api.openPath(path, app),
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
    openExternal: (url) => window.api.openExternal(url),
    revealPath: (path) => window.api.revealPath(path),
  }
}

export function runRendererMenuAction(action: string) {
  return window.api.runDesktopMenuAction(action as never)
}
