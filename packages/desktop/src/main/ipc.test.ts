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

mock.module("electron", () => ({
  app: appEvents,
  BrowserWindow: {
    fromWebContents: (sender: FakeSender) => ({
      isDestroyed: () => false,
      webContents: sender,
    }),
    getAllWindows: () => [],
  },
  Notification: class {
    show() {}
  },
  clipboard: { readImage: () => ({ isEmpty: () => true }) },
  dialog: {},
  ipcMain: {
    handle: (name: string, handler: RegisteredHandler) => handlers.set(name, handler),
    on: () => undefined,
  },
  shell: {},
}))

mock.module("../../../app/src/i18n/desktop-native", () => ({
  parseDesktopNativeBundle: () => undefined,
}))
mock.module("./attachment-picker", () => ({
  assertAttachmentBudget: () => undefined,
  createPickedFileAuthorizations: () => ({}),
}))
mock.module("./debug", () => ({ setForceFocus: () => undefined }))
mock.module("./desktop-menu-actions", () => ({ runDesktopMenuAction: () => undefined }))
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
  getStore: () => undefined,
  removeStoreFileIfEmpty: () => undefined,
}))
mock.module("./windows", () => ({
  getPinchZoomEnabled: () => false,
  getWindowID: () => undefined,
  openExternalURL: () => undefined,
  openLocalFileURL: () => undefined,
  setPinchZoomEnabled: () => undefined,
  setTitlebar: () => undefined,
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
  consumeInitialDeepLinks: () => [],
  updater: {
    subscribe: () => () => undefined,
    check: async () => undefined,
    install: () => undefined,
  } as never,
  showUpdater: () => undefined,
  setBackgroundColor: () => undefined,
  exportDebugLogs: async () => "",
  recordFatalRendererError: () => undefined,
  setNativeTranslations: () => undefined,
})

class FakeSender extends EventEmitter {
  destroyed = false
  readonly mainFrame = {}

  constructor(readonly id: number) {
    super()
    this.setMaxListeners(100)
  }

  isDestroyed() {
    return this.destroyed
  }

  send() {}

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

afterAll(() => mock.restore())

describe("disk snapshot IPC lifecycle", () => {
  test("rejects privileged IPC from a subframe", () => {
    const sender = new FakeSender(40)
    const getDrives = handlers.get("disklizard:get-drives")!
    expect(() => getDrives({ sender, senderFrame: {} })).toThrow("Invalid IPC sender")
  })

  test("rejects renderer-selected store paths", () => {
    const sender = new FakeSender(43)
    const setStore = handlers.get("store-set")!
    expect(() => setStore(event(sender), "/tmp/escaped.json", "key", "value")).toThrow("Invalid renderer store")
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
})
