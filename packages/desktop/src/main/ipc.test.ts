import { afterAll, describe, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import path from "node:path"
import type { IpcMainInvokeEvent } from "electron"
import type { DiskNode, ScanOptions } from "../../../disklizard/src/types"

type RegisteredHandler = (...args: unknown[]) => unknown

const handlers = new Map<string, RegisteredHandler>()
const appEvents = Object.assign(new EventEmitter(), { getPath: () => "/tmp/disklizard-ipc-test" })

mock.module("electron", () => ({
  app: appEvents,
  BrowserWindow: {
    fromWebContents: () => undefined,
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
  readonly stopped: string[] = []

  async scan(
    owner: string,
    rootPath: string,
    _options: ScanOptions,
    _onUpdate: (update: unknown) => void,
    _forceFresh: boolean,
  ) {
    this.owners.add(owner)
    const root: DiskNode = {
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
  return { sender } as unknown as IpcMainInvokeEvent
}

const scanPath = handlers.get("disklizard:scan-path") as (
  event: IpcMainInvokeEvent,
  targetPath: string,
  options: object,
  scanID: string,
) => Promise<DiskNode>
const stopWatching = handlers.get("disklizard:stop-watching") as (
  event: IpcMainInvokeEvent,
  scanID?: string,
) => Promise<unknown>

afterAll(() => mock.restore())

describe("disk snapshot IPC lifecycle", () => {
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
})
