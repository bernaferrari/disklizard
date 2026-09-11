import { afterAll, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { IpcMainInvokeEvent } from "electron"
import type { DiskNode, ScanOptions } from "../../../disklizard/src/types"
import type { DiskLizardAPI } from "../preload/types"

type RegisteredHandler = (...args: unknown[]) => unknown

const handlers = new Map<string, RegisteredHandler>()
const appEvents = Object.assign(new EventEmitter(), { getPath: () => "/tmp/disklizard-ipc-test" })
const rendererStore = new Map<string, unknown>()
let rendererStoreReadError: Error | undefined
const requestedStoreNames: string[] = []
const backgroundColors: string[] = []
const pinchZoomValues: boolean[] = []
const titlebarThemes: unknown[] = []
const desktopMenuActions: unknown[] = []

mock.module("electron", () => ({
  app: appEvents,
  BrowserWindow: {
    fromWebContents: (sender: FakeSender) => ({
      isDestroyed: () => false,
      webContents: sender,
      setProgressBar: () => undefined,
    }),
    getAllWindows: () => [],
  },
  dialog: {},
  ipcMain: {
    handle: (name: string, handler: RegisteredHandler) => handlers.set(name, handler),
    on: () => undefined,
  },
  shell: {
    openPath: async () => "",
    showItemInFolder: () => undefined,
  },
}))

mock.module("@disklizard/app/native-i18n", () => ({
  parseDesktopNativeBundle: () => undefined,
}))
mock.module("./desktop-menu-actions", () => ({
  runDesktopMenuAction: (_window: unknown, action: unknown) => desktopMenuActions.push(action),
}))
mock.module("./disk-delete-precondition", () => ({ runGuardedDiskDelete: () => undefined }))
mock.module("./disk-drive-facts", () => ({ publishDriveFacts: () => undefined }))
mock.module("./disk-platform", () => ({
  diskAccessSettingsUrl: () => undefined,
  getDiskStorageDiagnostics: () => ({}),
}))
mock.module("./disk-preview", () => ({
  quickLookCommand: () => undefined,
  readDiskPreview: () => undefined,
}))
mock.module("./disk-scanner", () => ({
  assertSafeDeletionPath: () => undefined,
  getDriveFacts: async () => ({}),
  getDrives: async () => [],
  mountExclusions: () => [],
  scanPath: () => undefined,
}))
mock.module("./native-translations", () => ({ nativeT: (key: string) => key }))
mock.module("./store", () => ({
  getStore: (name: string) => {
    requestedStoreNames.push(name)
    return {
      get: (key: string) => {
        if (rendererStoreReadError) throw rendererStoreReadError
        return rendererStore.get(key)
      },
      has: (key: string) => rendererStore.has(key),
      set: (key: string, value: string) => rendererStore.set(key, value),
      delete: (key: string) => rendererStore.delete(key),
      clear: () => rendererStore.clear(),
      get store() {
        return Object.fromEntries(rendererStore)
      },
    }
  },
  removeStoreFileIfEmpty: () => undefined,
}))
mock.module("./windows", () => ({
  getPinchZoomEnabled: () => false,
  openExternalURL: () => undefined,
  openLocalFileURL: () => undefined,
  setPinchZoomEnabled: (enabled: boolean) => pinchZoomValues.push(enabled),
  setTitlebar: (_window: unknown, theme: unknown) => titlebarThemes.push(theme),
  updateTitlebar: () => undefined,
}))

class FakeDiskSnapshotManager {
  readonly owners = new Set<string>()
  readonly roots = new Map<string, DiskNode>()
  readonly scans: Array<{ owner: string; rootPath: string; options: ScanOptions }> = []
  readonly stopped: string[] = []

  async scan(
    owner: string,
    rootPath: string,
    options: ScanOptions,
    _onUpdate: (update: unknown) => void,
    _forceFresh: boolean,
  ) {
    this.owners.add(owner)
    this.scans.push({ owner, rootPath, options })
    const root: DiskNode = this.roots.get(rootPath) ?? {
      name: path.basename(rootPath),
      path: rootPath,
      size: 0,
      isDir: true,
      children: [],
      ext: "",
    }
    return { root, source: "scan" as const, changedPaths: [] }
  }

  async stop(owner: string) {
    this.stopped.push(owner)
    this.owners.delete(owner)
  }

  activeOwners() {
    return [...this.owners]
  }

  async stopAll() {
    await Promise.all([...this.owners].map((owner) => this.stop(owner)))
  }
}

let diskSnapshots!: FakeDiskSnapshotManager
mock.module("./disk-snapshot", () => ({
  DiskSnapshotManager: class extends FakeDiskSnapshotManager {
    constructor() {
      super()
      diskSnapshots = this
    }
  },
}))

const { registerIpcHandlers } = await import("./ipc")

registerIpcHandlers({
  relaunch: () => undefined,
  updater: {
    subscribe: () => () => undefined,
    check: async () => undefined,
    install: () => undefined,
  } as never,
  showUpdater: () => undefined,
  setBackgroundColor: (color) => backgroundColors.push(color),
  exportDebugLogs: async () => "",
  setNativeTranslations: () => undefined,
})

class FakeSender extends EventEmitter {
  destroyed = false
  readonly mainFrame = {}
  zoomFactor = 1

  constructor(readonly id: number) {
    super()
    this.setMaxListeners(100)
  }

  isDestroyed() {
    return this.destroyed
  }

  send() {}

  setZoomFactor(factor: number) {
    this.zoomFactor = factor
  }

  destroy() {
    this.destroyed = true
    this.emit("destroyed")
  }
}

function event(sender: FakeSender) {
  return { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent
}

const scanPath = handlers.get("disklizard:scan-path") as (
  event: IpcMainInvokeEvent,
  targetPath: string,
  options: unknown,
  scanID: string,
) => Promise<DiskNode>
const stopWatching = handlers.get("disklizard:stop-watching") as (
  event: IpcMainInvokeEvent,
  scanID?: string,
  options?: unknown,
) => Promise<unknown>
const authorizeDeletePaths = handlers.get("disklizard:authorize-delete-paths") as (
  event: IpcMainInvokeEvent,
  paths: readonly string[],
) => Promise<Array<{ path: string; authorization: string }>>
const previewPath = handlers.get("disklizard:preview-path")!
const systemPreviewPath = handlers.get("disklizard:system-preview-path")!
const openPath = handlers.get("disklizard:open-path")!
const revealPath = handlers.get("disklizard:reveal-path")!

afterAll(() => mock.restore())

describe("disk snapshot IPC lifecycle", () => {
  test("volume actions reject paths outside the mounted volume inventory", async () => {
    const sender = new FakeSender(909)
    for (const channel of ["disklizard:eject-volume", "disklizard:reveal-volume"]) {
      expect(await handlers.get(channel)!(event(sender), "/not-a-mounted-volume")).toBe(false)
    }
    expect(await handlers.get("disklizard:volume-info")!(event(sender), "/not-a-mounted-volume")).toBeNull()
  })
  test("rejects privileged IPC from a subframe", () => {
    const sender = new FakeSender(40)
    const getDrives = handlers.get("disklizard:get-drives")!
    expect(() => getDrives({ sender, senderFrame: {} })).toThrow("Invalid IPC sender")
  })

  test("limits renderer persistence to the two DiskLizard settings keys", () => {
    const sender = new FakeSender(43)
    const setStore = handlers.get("disklizard:store-set")!
    expect(() => setStore(event(sender), "/tmp/escaped.json", "value")).toThrow("Invalid DiskLizard storage key")
    expect(() => setStore(event(sender), "opencode.global", "value")).toThrow("Invalid DiskLizard storage key")
    expect(() => setStore(event(sender), "pinned-locations", "x".repeat(1024 * 1024 + 1))).toThrow(
      "Invalid DiskLizard storage value",
    )
    expect(() => setStore(event(sender), "pinned-locations", "[]")).not.toThrow()
    expect(requestedStoreNames.at(-1)).toBe("disklizard.dat")
    expect(rendererStore.get("pinned-locations")).toBe("[]")
  })

  test("returns null only for missing values and rejects invalid legacy values", () => {
    const sender = new FakeSender(47)
    const getStoreValue = handlers.get("disklizard:store-get")!

    rendererStore.delete("pinned-locations")
    expect(getStoreValue(event(sender), "pinned-locations")).toBeNull()

    rendererStore.set("pinned-locations", [{ path: "/tmp/project", label: "Project" }])
    expect(getStoreValue(event(sender), "pinned-locations")).toBe(
      '[{"path":"/tmp/project","label":"Project"}]',
    )

    rendererStore.set("pinned-locations", null)
    expect(() => getStoreValue(event(sender), "pinned-locations")).toThrow("Invalid DiskLizard storage value")

    rendererStore.set("pinned-locations", "x".repeat(1024 * 1024 + 1))
    expect(() => getStoreValue(event(sender), "pinned-locations")).toThrow("Invalid DiskLizard storage value")

    rendererStore.set("pinned-locations", { value: "x".repeat(1024 * 1024) })
    expect(() => getStoreValue(event(sender), "pinned-locations")).toThrow("Invalid DiskLizard storage value")
  })

  test("propagates cleanup-protection store failures instead of reporting a missing value", () => {
    const sender = new FakeSender(49)
    const getStoreValue = handlers.get("disklizard:store-get")!
    rendererStore.delete("cleanup-locks")
    expect(getStoreValue(event(sender), "cleanup-locks")).toBeNull()

    rendererStore.set("cleanup-locks", "[]")
    rendererStoreReadError = new Error("settings unreadable")
    try {
      expect(() => getStoreValue(event(sender), "cleanup-locks")).toThrow("settings unreadable")
    } finally {
      rendererStoreReadError = undefined
    }
  })

  test("validates window appearance inputs before invoking Electron", () => {
    const sender = new FakeSender(48)
    const setBackgroundColor = handlers.get("set-background-color")!
    const setTitlebar = handlers.get("set-titlebar")!

    expect(() => setBackgroundColor(event(sender), "#f8f8f8")).not.toThrow()
    expect(() => setBackgroundColor(event(sender), "#00000000")).not.toThrow()
    expect(backgroundColors.slice(-2)).toEqual(["#f8f8f8", "#00000000"])
    for (const color of [undefined, null, "", "red", "#fff", "#gggggg", "rgb(0, 0, 0)"]) {
      expect(() => setBackgroundColor(event(sender), color)).toThrow("Invalid background color")
    }

    expect(() => setTitlebar(event(sender), { mode: "dark", scheme: "system" })).not.toThrow()
    expect(titlebarThemes.at(-1)).toEqual({ mode: "dark", scheme: "system" })
    for (const theme of [
      undefined,
      null,
      "dark",
      {},
      { mode: "system" },
      { mode: "light", scheme: "auto" },
      { mode: "dark", scheme: "system", extra: true },
    ]) {
      expect(() => setTitlebar(event(sender), theme)).toThrow("Invalid titlebar theme")
    }
  })

  test("validates and clamps renderer zoom controls", () => {
    const sender = new FakeSender(49)
    const setZoomFactor = handlers.get("set-zoom-factor")!
    const setPinchZoomEnabled = handlers.get("set-pinch-zoom-enabled")!

    setZoomFactor(event(sender), 1.5)
    expect(sender.zoomFactor).toBe(1.5)
    setZoomFactor(event(sender), 0.01)
    expect(sender.zoomFactor).toBe(0.2)
    setZoomFactor(event(sender), 100)
    expect(sender.zoomFactor).toBe(10)
    for (const factor of [undefined, null, "1", Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => setZoomFactor(event(sender), factor)).toThrow("Invalid zoom factor")
    }

    setPinchZoomEnabled(event(sender), true)
    setPinchZoomEnabled(event(sender), false)
    expect(pinchZoomValues.slice(-2)).toEqual([true, false])
    for (const enabled of [undefined, null, 0, 1, "true"]) {
      expect(() => setPinchZoomEnabled(event(sender), enabled)).toThrow("Invalid pinch zoom value")
    }
  })

  test("accepts only declared desktop menu actions from the renderer", () => {
    const sender = new FakeSender(50)
    const runDesktopMenuAction = handlers.get("run-desktop-menu-action")!

    for (const action of ["app.checkForUpdates", "edit.delete", "view.reload", "window.toggleMaximize"]) {
      expect(() => runDesktopMenuAction(event(sender), action)).not.toThrow()
    }
    expect(desktopMenuActions.slice(-4)).toEqual([
      "app.checkForUpdates",
      "edit.delete",
      "view.reload",
      "window.toggleMaximize",
    ])
    for (const action of [undefined, null, {}, "", "view.unknown", "window.new", "__proto__"]) {
      expect(() => runDesktopMenuAction(event(sender), action)).toThrow("Invalid desktop menu action")
    }
  })

  test("validates and forwards maxChildren at the renderer boundary", async () => {
    const sender = new FakeSender(44)
    const expansionOptions = {
      maxChildren: 256,
    } satisfies NonNullable<Parameters<DiskLizardAPI["scanPath"]>[1]>

    await scanPath(event(sender), "/tmp/expanded", expansionOptions, "expanded")
    expect(diskSnapshots.scans.at(-1)?.options.maxChildren).toBe(256)

    for (const maxChildren of [1, 10_000]) {
      await scanPath(event(sender), `/tmp/boundary-${maxChildren}`, { maxChildren }, `boundary-${maxChildren}`)
      expect(diskSnapshots.scans.at(-1)?.options.maxChildren).toBe(maxChildren)
      await stopWatching(event(sender), `boundary-${maxChildren}`)
    }

    await scanPath(event(sender), "/tmp/default", {}, "default")
    expect(diskSnapshots.scans.at(-1)?.options.maxChildren).toBe(48)

    const scansBeforeInvalidInput = diskSnapshots.scans.length
    for (const maxChildren of [0, 10_001, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "256", null]) {
      await expect(
        scanPath(event(sender), "/tmp/invalid", { maxChildren }, `invalid-${String(maxChildren)}`),
      ).rejects.toThrow("Invalid maxChildren scan option")
    }
    expect(diskSnapshots.scans).toHaveLength(scansBeforeInvalidInput)

    await stopWatching(event(sender), "expanded")
    await stopWatching(event(sender), "default")
  })

  test("keeps one renderer destruction listener across repeated and parallel scans", async () => {
    const sender = new FakeSender(41)

    for (let index = 0; index < 24; index++) {
      await scanPath(event(sender), "/tmp/project", {}, "primary")
      expect(sender.listenerCount("destroyed")).toBe(1)
    }

    await scanPath(event(sender), "/tmp/other", {}, "secondary")
    expect(sender.listenerCount("destroyed")).toBe(1)

    await stopWatching(event(sender), "primary")
    expect(sender.listenerCount("destroyed")).toBe(1)
    await stopWatching(event(sender), "secondary")
    expect(sender.listenerCount("destroyed")).toBe(0)
  })

  test("stops every tracked watcher when its renderer is destroyed", async () => {
    const sender = new FakeSender(42)
    await scanPath(event(sender), "/tmp/first", {}, "first")
    await scanPath(event(sender), "/tmp/second", {}, "second")

    sender.destroy()
    await Promise.resolve()

    expect(sender.listenerCount("destroyed")).toBe(0)
    expect(diskSnapshots.stopped).toContain("42:first")
    expect(diskSnapshots.stopped).toContain("42:second")
  })

  test("retains trusted focused authority only for an explicit stop option", async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), "disklizard-ipc-focused-"))
    const focusedPath = path.join(rootPath, "focused")
    const expandedPath = path.join(focusedPath, "expanded.txt")
    await mkdir(focusedPath)
    await writeFile(expandedPath, "expanded")
    try {
      const sender = new FakeSender(45)
      diskSnapshots.roots.set(rootPath, {
        name: path.basename(rootPath),
        path: rootPath,
        size: 8,
        isDir: true,
        ext: "",
        children: [
          {
            name: "focused",
            path: focusedPath,
            size: 8,
            isDir: true,
            isCollapsed: true,
            ext: "",
            children: [],
          },
        ],
      })
      diskSnapshots.roots.set(focusedPath, {
        name: "focused",
        path: focusedPath,
        size: 8,
        isDir: true,
        ext: "",
        children: [{ name: "expanded.txt", path: expandedPath, size: 8, isDir: false, ext: "txt", children: [] }],
      })

      await scanPath(event(sender), rootPath, {}, "primary")
      await scanPath(event(sender), focusedPath, {}, "expand")
      await stopWatching(event(sender), "expand")

      await expect(authorizeDeletePaths(event(sender), [expandedPath])).rejects.toThrow(
        "Item is not part of an active scan",
      )

      await scanPath(event(sender), focusedPath, {}, "expand")
      for (const options of [
        null,
        true,
        { retainTrustedSubtree: false },
        { retainTrustedSubtree: "yes" },
        { retainTrustedSubtree: true, unknown: true },
      ]) {
        await expect(stopWatching(event(sender), "expand", options)).rejects.toThrow("Invalid stop-watching options")
      }
      expect(diskSnapshots.owners).toContain("45:expand")

      const retainOptions = {
        retainTrustedSubtree: true,
      } satisfies NonNullable<Parameters<DiskLizardAPI["stopWatching"]>[1]>
      await expect(stopWatching(event(sender), undefined, retainOptions)).rejects.toThrow(
        "Invalid stop-watching options",
      )
      expect(diskSnapshots.owners).toContain("45:primary")
      expect(diskSnapshots.owners).toContain("45:expand")

      await stopWatching(event(sender), "expand", retainOptions)

      await expect(authorizeDeletePaths(event(sender), [expandedPath])).resolves.toEqual([
        { path: expandedPath, authorization: expect.any(String) },
      ])
      await stopWatching(event(sender), "primary")
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })

  test("gates preview, open, system preview, and reveal to the sender's active scan", async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), "disklizard-ipc-preview-"))
    const filePath = path.join(rootPath, "visible.txt")
    await writeFile(filePath, "visible")
    try {
      const sender = new FakeSender(46)
      for (const handler of [previewPath, systemPreviewPath, openPath, revealPath]) {
        await expect(Promise.resolve().then(() => handler(event(sender), filePath))).rejects.toThrow(
          "Item is not part of an active scan",
        )
      }

      diskSnapshots.roots.set(rootPath, {
        name: path.basename(rootPath),
        path: rootPath,
        size: 7,
        isDir: true,
        ext: "",
        children: [{ name: "visible.txt", path: filePath, size: 7, isDir: false, ext: "txt", children: [] }],
      })
      await scanPath(event(sender), rootPath, {}, "primary")

      await expect(Promise.resolve().then(() => previewPath(event(sender), filePath))).resolves.toBeUndefined()
      await expect(Promise.resolve().then(() => systemPreviewPath(event(sender), filePath))).resolves.toBeUndefined()
      await expect(Promise.resolve().then(() => openPath(event(sender), filePath))).resolves.toBeUndefined()
      await expect(Promise.resolve().then(() => revealPath(event(sender), filePath))).resolves.toBeUndefined()

      await stopWatching(event(sender), "primary")
      await expect(Promise.resolve().then(() => previewPath(event(sender), filePath))).rejects.toThrow(
        "Item is not part of an active scan",
      )
    } finally {
      await rm(rootPath, { recursive: true, force: true })
    }
  })
})
