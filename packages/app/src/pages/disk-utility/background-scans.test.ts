import { expect, test } from "bun:test"
import {
  createBackgroundScans,
  type BackgroundScanOptions,
} from "./background-scans"
import type { DiskScanNode, DiskScanProgress } from "./types"
import type { VolumeScanJob } from "./scan-jobs"

const drive = {
  path: "/work",
  name: "Work",
  label: "Work",
  total: 30,
  used: 30,
  free: 0,
  type: "local" as const,
}
const tree: DiskScanNode = {
  name: "work",
  path: "/work",
  size: 30,
  isDir: true,
  ext: "",
  children: [],
}
function fixture() {
  const listeners = new Set<(p: DiskScanProgress) => void>()
  const requests: ReturnType<typeof Promise.withResolvers<DiskScanNode>>[] = []
  const ready: VolumeScanJob[] = []
  const sources: string[] = []
  let limits = 0
  const context: BackgroundScanOptions = {
    os: "macos",
    api: {
      scanPath: () => {
        const request = Promise.withResolvers<DiskScanNode>()
        requests.push(request)
        return request.promise
      },
      onScanProgress(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      cancelScan: async () => {},
      stopWatching: async () => {},
    },
    scanOptions: () => ({}),
    onScanned: () => {},
    onForget: () => {},
    onLimit: () => {
      limits++
    },
    onReady: (job) => {
      ready.push(job)
    },
    onCompletionSource: (_id, source) => {
      sources.push(source)
    },
  }
  const scans = createBackgroundScans(() => context)
  return {
    scans,
    requests,
    ready,
    sources,
    listeners,
    limits: () => limits,
    start: (path = "/work") =>
      scans.start({ kind: "folder", path, label: path, drive }),
    progress(id: string, source?: "snapshot") {
      for (const listener of listeners)
        listener({
          scanId: id,
          size: 30,
          filesScanned: 2,
          currentPath: "/work",
          ...(source ? { source, done: true } : {}),
        })
    },
  }
}

test("background limits and deduplication hold before a React render", () => {
  const f = fixture()
  f.start()
  f.start()
  f.start("/two")
  f.start("/three")
  f.start("/four")
  expect(f.requests.length).toBe(3)
  expect(f.limits()).toBe(1)
  f.scans.dispose()
  expect(f.listeners.size).toBe(0)
})

test("background results preserve progress and provenance in either IPC order", async () => {
  for (const eventFirst of [true, false]) {
    const f = fixture()
    const id = f.start()!
    f.progress(id)
    if (eventFirst) f.progress(id, "snapshot")
    f.requests[0]!.resolve(tree)
    await f.requests[0]!.promise
    expect(f.scans.snapshot()[id]?.files).toBe(2)
    expect(f.ready.length).toBe(1)
    if (!eventFirst) {
      expect(f.listeners.size).toBe(1)
      f.progress(id, "snapshot")
    }
    expect(f.scans.snapshot()[id]?.source).toBe("snapshot")
    expect(f.sources).toEqual(["snapshot"])
    expect(f.listeners.size).toBe(0)
  }
})

test("cancelled and disposed jobs cannot reopen a map on late completion", async () => {
  for (const dispose of [true, false]) {
    const f = fixture()
    const id = f.start()!
    if (dispose) f.scans.dispose()
    else f.scans.cancel(id)
    f.requests[0]!.resolve(tree)
    await f.requests[0]!.promise
    expect(f.scans.snapshot()[id]).toBeUndefined()
    expect(f.ready).toEqual([])
    expect(f.listeners.size).toBe(0)
  }
})

test("failed background scans release progress listeners without a final event", async () => {
  const f = fixture()
  const id = f.start()!
  f.requests[0]!.reject(new Error("Permission denied"))
  await f.requests[0]!.promise.catch(() => {})
  expect(f.scans.snapshot()[id]?.status).toBe("failed")
  expect(f.listeners.size).toBe(0)
})
