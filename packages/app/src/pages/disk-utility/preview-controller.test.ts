import { describe, expect, test } from "bun:test"
import { createDiskPreviewController } from "./preview-controller"
import type { DiskFilePreview, DiskScanNode } from "./types"

function file(path: string): DiskScanNode {
  return {
    name: path.split(/[\\/]/).at(-1)!,
    path,
    size: 1,
    isDir: false,
    ext: "txt",
    children: [],
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  const { promise, resolve, reject } = Promise.withResolvers<T>()
  return { promise, resolve, reject }
}

function setup(options: {
  entries: DiskScanNode[]
  previewPath: (path: string) => Promise<DiskFilePreview>
  systemPreviewPath?: (path: string) => Promise<void>
  openPath?: (path: string) => Promise<void>
  onOperationError?: (
    operation: "open" | "system-preview",
    message: string
  ) => void
}) {
  const selected: string[] = []
  const controller = createDiskPreviewController({
    api: () => ({
      previewPath: options.previewPath,
      systemPreviewPath: options.systemPreviewPath ?? (async () => undefined),
      openPath: options.openPath ?? (async () => undefined),
    }),
    entries: () => options.entries,
    isPathCurrent: (path) =>
      options.entries.some((entry) => entry.path === path),
    os: "macos",
    select: (path) => selected.push(path),
    onOperationError: options.onOperationError,
    surfaceOptions: { reducedMotion: () => true },
  })
  return { controller, selected, dispose: () => controller.dispose() }
}

describe("disk preview controller", () => {
  test("ignores an older read that resolves after the active target", async () => {
    const first = file("/work/first.txt")
    const second = file("/work/second.txt")
    const reads = new Map<string, ReturnType<typeof deferred<DiskFilePreview>>>(
      [
        [first.path, deferred<DiskFilePreview>()],
        [second.path, deferred<DiskFilePreview>()],
      ]
    )
    const { controller, dispose } = setup({
      entries: [first, second],
      previewPath: (path) => reads.get(path)!.promise,
    })

    const firstOpen = controller.show(first)
    const secondOpen = controller.show(second)
    const secondPayload = {
      kind: "text",
      text: "new",
      bytes: 3,
      truncated: false,
    } as const
    reads.get(second.path)!.resolve(secondPayload)
    await secondOpen
    expect(controller.view().target?.path).toBe(second.path)
    expect(controller.view().payload).toEqual(secondPayload)
    expect(controller.view()).toMatchObject({
      loading: false,
      error: undefined,
    })

    reads
      .get(first.path)!
      .resolve({ kind: "text", text: "stale", bytes: 5, truncated: false })
    await firstOpen
    expect(controller.view().target?.path).toBe(second.path)
    expect(controller.view().payload).toEqual(secondPayload)
    expect(controller.view()).toMatchObject({
      loading: false,
      error: undefined,
    })
    dispose()
  })

  test("close invalidates an in-flight read before resetting the surface", async () => {
    const target = file("/work/slow.txt")
    const read = deferred<DiskFilePreview>()
    const { controller, dispose } = setup({
      entries: [target],
      previewPath: () => read.promise,
    })

    const opening = controller.show(target)
    expect(controller.view()).toMatchObject({ mounted: true, loading: true })
    expect(controller.view().target?.path).toBe(target.path)
    controller.close()
    expect(controller.view()).toMatchObject({
      mounted: false,
      target: null,
      payload: undefined,
      loading: false,
    })

    read.resolve({ kind: "text", text: "too late", bytes: 8, truncated: false })
    await opening
    expect(controller.view()).toMatchObject({
      mounted: false,
      target: null,
      payload: undefined,
      loading: false,
    })
    dispose()
  })

  test("closes and invalidates a preview removed by the current scan generation", async () => {
    const target = file("/work/removed.txt")
    const read = deferred<DiskFilePreview>()
    const entries = [target]
    const { controller, dispose } = setup({
      entries,
      previewPath: () => read.promise,
    })

    const opening = controller.show(target)
    expect(controller.view()).toMatchObject({
      mounted: true,
      target,
      loading: true,
      position: 0,
    })
    entries.splice(0)
    expect(controller.reconcile()).toBe(false)
    expect(controller.view()).toMatchObject({
      mounted: false,
      target: null,
      loading: false,
      position: -1,
    })

    read.resolve({ kind: "text", text: "stale", bytes: 5, truncated: false })
    await opening
    expect(controller.view()).toMatchObject({
      mounted: false,
      target: null,
      payload: undefined,
    })
    dispose()
  })

  test("navigates only visible files and selects before loading the adjacent target", async () => {
    const first = file("/work/first.txt")
    const hidden = { ...file("/work/hidden.txt"), isHidden: true }
    const directory = { ...file("/work/folder"), isDir: true }
    const second = file("/work/second.txt")
    const reads: string[] = []
    const { controller, selected, dispose } = setup({
      entries: [first, hidden, directory, second],
      previewPath: async (path) => {
        reads.push(path)
        return { kind: "text", text: path, bytes: 1, truncated: false }
      },
    })

    await controller.show(first)
    expect(controller.view()).toMatchObject({
      position: 0,
      total: 2,
      canMovePrevious: false,
      canMoveNext: true,
    })
    controller.move(1)
    await Promise.resolve()
    expect(selected).toEqual([second.path])
    expect(reads).toEqual(["/work/first.txt", "/work/second.txt"])
    expect(controller.view()).toMatchObject({
      position: 1,
      canMovePrevious: true,
      canMoveNext: false,
    })
    expect(controller.view().target?.path).toBe(second.path)
    dispose()
  })

  test("showing a directory clears the previous file payload and read error", async () => {
    const loaded = file("/work/loaded.txt")
    const failed = file("/work/failed.txt")
    const directory = { ...file("/work/folder"), isDir: true }
    const reads: string[] = []
    const { controller, dispose } = setup({
      entries: [loaded, failed, directory],
      previewPath: async (path) => {
        reads.push(path)
        if (path === failed.path) throw new Error("read failed")
        return { kind: "text", text: "loaded", bytes: 6, truncated: false }
      },
    })

    await controller.show(loaded)
    expect(controller.view().payload).toMatchObject({
      kind: "text",
      text: "loaded",
    })
    await controller.show(failed)
    expect(controller.view()).toMatchObject({
      payload: undefined,
      error: "read failed",
      loading: false,
    })
    await controller.show(directory)
    expect(controller.view()).toMatchObject({
      target: directory,
      payload: undefined,
      error: undefined,
      loading: false,
    })
    expect(reads).toEqual([loaded.path, failed.path])
    dispose()
  })

  test("maps shell integration failures without leaking them into file preview state", async () => {
    const target = file("/work/file.txt")
    const failures: Array<[string, string]> = []
    const { controller, dispose } = setup({
      entries: [target],
      previewPath: async () => ({
        kind: "unsupported",
        bytes: 1,
        reason: "format",
      }),
      openPath: async () => {
        throw new Error("open failed")
      },
      systemPreviewPath: async () => {
        throw "quick look failed"
      },
      onOperationError: (operation, message) =>
        failures.push([operation, message]),
    })

    await controller.openInDefaultApp(target)
    await controller.openSystemPreview(target)
    expect(failures).toEqual([
      ["open", "open failed"],
      ["system-preview", "quick look failed"],
    ])
    expect(controller.view()).toMatchObject({
      target: null,
      error: undefined,
      loading: false,
    })
    dispose()
  })
})
