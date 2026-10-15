import { expect, test } from "bun:test"
import { createForegroundScans } from "./foreground-scans"
import type { DiskScanNode, DiskScanProgress } from "./types"

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
  return {
    listeners,
    requests,
    api: {
      onScanProgress(listener: (p: DiskScanProgress) => void) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      scanPath: () => {
        const request = Promise.withResolvers<DiskScanNode>()
        requests.push(request)
        return request.promise
      },
    },
    progress(id: string, size: number, done = false) {
      for (const listener of listeners)
        listener({
          scanId: id,
          size,
          filesScanned: 1,
          currentPath: "/work",
          done,
          ...(done ? { source: "snapshot" } : {}),
        })
    },
  }
}

test("foreground scans keep monotonic progress and late completion provenance", async () => {
  const f = fixture()
  const scans = createForegroundScans()
  const progress: DiskScanProgress[] = []
  const session = scans.begin(f.api, "root", {
    waitForCompletionSource: true,
    onProgress: (p) => progress.push(p),
  })
  const result = session.run("/work", {})
  f.progress("another", 999)
  f.progress("root", 20)
  f.progress("root", 10)
  f.requests[0]!.resolve(tree)
  expect(await result).toBe(tree)
  session.finish()
  expect(f.listeners.size).toBe(1)
  f.progress("root", 30, true)
  expect(progress.map((p) => p.size)).toEqual([20, 20, 30])
  expect(progress.at(-1)?.source).toBe("snapshot")
  expect(f.listeners.size).toBe(0)
})

test("foreground supersession drops stale results and releases failed listeners", async () => {
  const f = fixture()
  const scans = createForegroundScans()
  const first = scans.begin(f.api, "first", {
    onProgress: () => {
      throw new Error("Stale progress")
    },
  })
  const pending = first.run("/work", {})
  const second = scans.begin(f.api, "second", {
    waitForCompletionSource: true,
    onProgress: () => {},
  })
  f.progress("first", 10)
  f.requests[0]!.resolve(tree)
  expect(await pending).toBeUndefined()
  expect(first.isCurrent()).toBe(false)
  first.finish()
  expect(f.listeners.size).toBe(1)
  const failed = second.run("/work", {})
  f.requests[1]!.reject(new Error("Permission denied"))
  expect(await failed.catch((error: unknown) => error)).toEqual(
    new Error("Permission denied")
  )
  second.finish()
  expect(f.listeners.size).toBe(0)
})

test("completion before the tree and focused scans release listeners on finish", async () => {
  for (const waitForCompletionSource of [true, false]) {
    const f = fixture()
    const scans = createForegroundScans()
    const session = scans.begin(f.api, "root", {
      waitForCompletionSource,
      onProgress: () => {},
    })
    const pending = session.run("/work", {})
    f.progress("root", 30, true)
    f.requests[0]!.resolve(tree)
    await pending
    session.finish()
    expect(f.listeners.size).toBe(0)
  }
})
