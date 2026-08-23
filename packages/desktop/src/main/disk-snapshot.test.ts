import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type ParcelWatcher from "@parcel/watcher"
import type { DiskNode, ScanOptions } from "../../../disklizard/src/types"
import {
  applyDiskDelta,
  DiskSnapshotManager,
  deltaRoots,
  diskSnapshotKey,
  type DiskSnapshotUpdate,
} from "./disk-snapshot"

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((entry) => rm(entry, { recursive: true, force: true })))
})

async function temp() {
  const root = await mkdtemp(path.join(tmpdir(), "disklizard-snapshot-"))
  temporary.push(root)
  return realpath(root)
}

async function eventually(predicate: () => boolean, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for the disk snapshot update")
    await Bun.sleep(5)
  }
}

async function eventLoopTicksDuring<T>(operation: () => Promise<T>) {
  let ticks = 0
  const timer = setInterval(() => ticks++, 0)
  try {
    return { result: await operation(), ticks }
  } finally {
    clearInterval(timer)
  }
}

async function scanFixture(targetPath: string, scanRoot = true): Promise<DiskNode> {
  const metadata = await stat(targetPath)
  if (!metadata.isDirectory()) {
    return {
      name: path.basename(targetPath),
      path: targetPath,
      size: metadata.size,
      modifiedAt: metadata.mtimeMs,
      isDir: false,
      children: [],
      ext: path.extname(targetPath).slice(1),
      ...(scanRoot ? { sharedStorageEvidence: "complete" as const } : {}),
    }
  }
  const names = await readdir(targetPath)
  const children = await Promise.all(names.map((name) => scanFixture(path.join(targetPath, name), false)))
  return {
    name: path.basename(targetPath),
    path: targetPath,
    size: children.reduce((total, child) => total + child.size, 0),
    modifiedAt: children.reduce((latest, child) => Math.max(latest, child.modifiedAt ?? 0), 0),
    isDir: true,
    children,
    ext: "",
    ...(scanRoot ? { sharedStorageEvidence: "complete" as const } : {}),
  }
}

function fakeWatcher() {
  let callback: ParcelWatcher.SubscribeCallback | undefined
  let historical: ParcelWatcher.Event[] = []
  const checkpointReads: string[] = []
  return {
    api: {
      async writeSnapshot(_dir: string, snapshot: string) {
        await writeFile(snapshot, String(Date.now()))
        return snapshot
      },
      async getEventsSince(_dir: string, checkpoint: string) {
        checkpointReads.push(checkpoint)
        return historical.splice(0)
      },
      async subscribe(_dir: string, next: ParcelWatcher.SubscribeCallback) {
        callback = next
        return { async unsubscribe() {} }
      },
    },
    historical(events: ParcelWatcher.Event[]) {
      historical = events
    },
    emit(events: ParcelWatcher.Event[]) {
      callback?.(null, events)
    },
    checkpointReads() {
      return [...checkpointReads]
    },
  }
}

describe("disk scan snapshots", () => {
  test("uses a stable key for semantically identical scan options", () => {
    const first = diskSnapshotKey("/tmp/project", { preserveNames: ["target", "node_modules"] })
    const second = diskSnapshotKey("/tmp/project", { preserveNames: ["node_modules", "target"] })
    expect(first).toBe(second)
  })

  test("canonicalizes invalid concurrency to the scanner's execution contract", () => {
    const root = "/tmp/project"
    const defaultConcurrency = diskSnapshotKey(root, {})
    expect(diskSnapshotKey(root, { concurrency: 0 })).toBe(defaultConcurrency)
    expect(diskSnapshotKey(root, { concurrency: -1 })).toBe(defaultConcurrency)
    expect(diskSnapshotKey(root, { concurrency: Number.NaN })).toBe(defaultConcurrency)
    expect(diskSnapshotKey(root, { concurrency: Number.POSITIVE_INFINITY })).toBe(defaultConcurrency)
    expect(diskSnapshotKey(root, { concurrency: 100 })).toBe(diskSnapshotKey(root, { concurrency: 64 }))
  })

  test("canonicalizes the remaining bounded scanner options before deriving a snapshot key", () => {
    const root = "/tmp/project"
    const normalized = diskSnapshotKey(root, { maxDepth: 0, maxChildren: 1, progressIntervalMs: 16 })
    expect(diskSnapshotKey(root, { maxDepth: -1, maxChildren: 0, progressIntervalMs: 0 })).toBe(normalized)
    expect(diskSnapshotKey(root, { maxDepth: 100, maxChildren: 100_001 })).toBe(
      diskSnapshotKey(root, { maxDepth: 64, maxChildren: 10_000 }),
    )
  })

  test("keeps an opt-in developer artifact inventory separate from map-only snapshots", () => {
    const mapOnly = diskSnapshotKey("/tmp/project", { preserveNames: ["node_modules"] })
    const inventory = diskSnapshotKey("/tmp/project", {
      preserveNames: ["node_modules"],
      developerArtifactInventory: true,
    })
    const configuredInventory = diskSnapshotKey("/tmp/project", {
      preserveNames: ["node_modules"],
      developerArtifactInventory: {},
    })
    expect(inventory).not.toBe(mapOnly)
    expect(configuredInventory).toBe(inventory)
  })

  test("canonicalizes developer inventory caps before deriving a snapshot key", () => {
    const root = "/tmp/project"
    const defaultInventory = diskSnapshotKey(root, { developerArtifactInventory: true })
    expect(defaultInventory).toBe(diskSnapshotKey(root, { developerArtifactInventory: {} }))
    expect(defaultInventory).toBe(diskSnapshotKey(root, { developerArtifactInventory: { maxItems: undefined } }))
    expect(diskSnapshotKey(root, { developerArtifactInventory: { maxItems: 0 } })).toBe(
      diskSnapshotKey(root, { developerArtifactInventory: { maxItems: 1 } }),
    )
    expect(diskSnapshotKey(root, { developerArtifactInventory: { maxItems: 20_000.8 } })).toBe(
      diskSnapshotKey(root, { developerArtifactInventory: { maxItems: 20_000 } }),
    )
    expect(diskSnapshotKey(root, { developerArtifactInventory: { maxItems: Number.NaN } })).toBe(defaultInventory)
  })

  test("restores an unchanged tree without scanning it again", async () => {
    const root = await temp()
    const cacheDir = await temp()
    await writeFile(path.join(root, "file.bin"), new Uint8Array(12))
    const watcher = fakeWatcher()
    let scans = 0
    const scan = async (target: string) => {
      scans++
      return scanFixture(target)
    }
    const first = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    expect((await first.scan(1, root, {}, () => {})).source).toBe("scan")
    await first.stopAll()

    const second = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    const restored = await second.scan(2, root, {}, () => {})
    expect(restored.source).toBe("snapshot")
    expect(restored.root.size).toBe(12)
    expect(scans).toBe(1)
    await second.stopAll()
  })

  test("keeps the event loop responsive while persisting and restoring a tree above 100k nodes", async () => {
    const root = await temp()
    const cacheDir = await temp()
    const watcher = fakeWatcher()
    const children = Array.from({ length: 100_001 }, (_, index): DiskNode => ({
      name: `child-${index}`,
      path: path.join(root, `child-${index}`),
      size: 0,
      isDir: false,
      children: [],
      ext: "",
    }))
    const largeRoot: DiskNode = {
      name: path.basename(root),
      path: root,
      size: 0,
      isDir: true,
      children,
      ext: "",
    }
    let scans = 0
    const scan = async () => {
      scans++
      return largeRoot
    }

    const first = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    const persisted = await eventLoopTicksDuring(() => first.scan(1, root, {}, () => {}))
    expect(persisted.result.source).toBe("scan")
    expect(persisted.ticks).toBeGreaterThan(5)
    await first.stopAll()

    const second = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    const restored = await eventLoopTicksDuring(() => second.scan(2, root, {}, () => {}))
    expect(restored.result.source).toBe("snapshot")
    expect(restored.result.root.children).toHaveLength(children.length)
    expect(restored.ticks).toBeGreaterThan(5)
    expect(scans).toBe(1)
    await second.stopAll()
  })

  test("does not restore an identity-less pre-v6 developer inventory snapshot", async () => {
    const root = await temp()
    const cacheDir = await temp()
    await writeFile(path.join(root, "file.bin"), new Uint8Array(12))
    const watcher = fakeWatcher()
    const options = { developerArtifactInventory: true }
    let scans = 0
    const scan = async (target: string) => {
      scans++
      return scanFixture(target)
    }
    const first = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "win32" })
    expect((await first.scan(1, root, options, () => {})).source).toBe("scan")
    await first.stopAll()

    const metadataPath = path.join(cacheDir, diskSnapshotKey(root, options), "metadata.json")
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as { schema: number }
    await writeFile(metadataPath, JSON.stringify({ ...metadata, schema: 5 }))

    const second = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "win32" })
    expect((await second.scan(2, root, options, () => {})).source).toBe("scan")
    expect(scans).toBe(2)
    await second.stopAll()
  })

  test("migrates a legacy v7 blob as a safe cache miss and cleans it after replacement", async () => {
    const root = await temp()
    const cacheDir = await temp()
    await writeFile(path.join(root, "file.bin"), new Uint8Array(12))
    const watcher = fakeWatcher()
    let scans = 0
    const scan = async (target: string) => {
      scans++
      return scanFixture(target)
    }
    const first = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    await first.scan(1, root, {}, () => {})
    await first.stopAll()

    const snapshotDir = path.join(cacheDir, diskSnapshotKey(root, {}))
    const metadataPath = path.join(snapshotDir, "metadata.json")
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>
    const legacyTree = path.join(snapshotDir, `tree-${Date.now()}-00000000-0000-4000-8000-000000000000.bin`)
    await writeFile(legacyTree, new Uint8Array([0xff]))
    await writeFile(
      metadataPath,
      JSON.stringify({ ...metadata, schema: 7, tree: path.basename(legacyTree) }),
    )

    const second = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    expect((await second.scan(2, root, {}, () => {})).source).toBe("scan")
    expect(scans).toBe(2)
    await expect(stat(legacyTree)).rejects.toThrow()
    const replacement = JSON.parse(await readFile(metadataPath, "utf8")) as { schema: number; tree: string }
    expect(replacement.schema).toBe(8)
    expect(replacement.tree.endsWith(".ndjson")).toBe(true)
    await second.stopAll()
  })

  test("treats an out-of-scope or root-only persisted child field as a cache miss", async () => {
    const root = await temp()
    const outside = await temp()
    const cacheDir = await temp()
    await writeFile(path.join(root, "file.bin"), new Uint8Array(12))
    const watcher = fakeWatcher()
    let scans = 0
    const scan = async (target: string) => {
      scans++
      return scanFixture(target)
    }
    const first = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    await first.scan(1, root, {}, () => {})
    await first.stopAll()

    const snapshotDir = path.join(cacheDir, diskSnapshotKey(root, {}))
    const metadata = JSON.parse(await readFile(path.join(snapshotDir, "metadata.json"), "utf8")) as { tree: string }
    const treePath = path.join(snapshotDir, metadata.tree)
    const records = (await readFile(treePath, "utf8"))
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const childRecord = records.find(
      (record) =>
        record.type === "node" &&
        typeof record.node === "object" &&
        record.node !== null &&
        (record.node as Record<string, unknown>).path === path.join(root, "file.bin"),
    )
    expect(childRecord).toBeDefined()
    const child = childRecord!.node as Record<string, unknown>
    child.path = path.join(outside, "file.bin")
    child.sharedStorageEvidence = "complete"
    await writeFile(treePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`)

    const second = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    expect((await second.scan(2, root, {}, () => {})).source).toBe("scan")
    expect(scans).toBe(2)
    await second.stopAll()
  })

  test("never follows an escaped checkpoint path from persisted metadata", async () => {
    const root = await temp()
    const cacheDir = await temp()
    const outside = path.join(await temp(), "outside.snapshot")
    await writeFile(path.join(root, "file.bin"), new Uint8Array(12))
    await writeFile(outside, "not a watcher checkpoint")
    const watcher = fakeWatcher()
    let scans = 0
    const scan = async (target: string) => {
      scans++
      return scanFixture(target)
    }
    const first = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    await first.scan(1, root, {}, () => {})
    await first.stopAll()

    const snapshotDir = path.join(cacheDir, diskSnapshotKey(root, {}))
    const metadataPath = path.join(snapshotDir, "metadata.json")
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<string, unknown>
    await writeFile(metadataPath, JSON.stringify({ ...metadata, checkpoint: "../../outside.snapshot" }))

    const second = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    expect((await second.scan(2, root, {}, () => {})).source).toBe("scan")
    expect(scans).toBe(2)
    expect(watcher.checkpointReads()).not.toContain(outside)
    await second.stopAll()
  })

  test("preserves fallback shared-storage capability when restoring a local map", async () => {
    const root = await temp()
    const cacheDir = await temp()
    await writeFile(path.join(root, "file.bin"), new Uint8Array(12))
    const watcher = fakeWatcher()
    let scans = 0
    const scan = async (target: string) => {
      scans++
      return {
        ...(await scanFixture(target)),
        cloneMetadata: { state: "unavailable" as const, reason: "scanner" as const },
        sharedStorageEvidence: "partial" as const,
      }
    }
    const first = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    const initial = await first.scan(1, root, {}, () => {})
    expect(initial.root.cloneMetadata).toEqual({
      state: "unavailable",
      reason: "scanner",
    })
    expect(initial.root.sharedStorageEvidence).toBe("partial")
    await first.stopAll()

    const second = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    const restored = await second.scan(2, root, {}, () => {})
    expect(restored.source).toBe("snapshot")
    expect(restored.root.cloneMetadata).toEqual({ state: "unavailable", reason: "scanner" })
    expect(restored.root.sharedStorageEvidence).toBe("partial")
    expect(restored.root.children[0]?.cloneMetadata).toBeUndefined()
    expect(restored.root.children[0]?.sharedStorageEvidence).toBeUndefined()
    expect(scans).toBe(1)
    await second.stopAll()
  })

  test("can force a fresh traversal when cached accounting is no longer safe", async () => {
    const root = await temp()
    const cacheDir = await temp()
    await writeFile(path.join(root, "file.bin"), new Uint8Array(12))
    const watcher = fakeWatcher()
    let scans = 0
    const scan = async (target: string) => {
      scans++
      return scanFixture(target)
    }
    const first = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    await first.scan(1, root, {}, () => {})
    await first.stopAll()

    const second = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    expect((await second.scan(2, root, {}, () => {}, true)).source).toBe("scan")
    expect(scans).toBe(2)
    await second.stopAll()
  })

  for (const platform of ["linux", "win32"] as const) {
    test(`uses native snapshots and offline deltas on ${platform}`, async () => {
      const root = await temp()
      const cacheDir = await temp()
      const file = path.join(root, "file.bin")
      await writeFile(file, new Uint8Array(9))
      const watcher = fakeWatcher()
      let scans = 0
      const scan = async (target: string) => {
        scans++
        return scanFixture(target)
      }

      const first = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform })
      expect((await first.scan(1, root, {}, () => {})).source).toBe("scan")
      await first.stopAll()

      await writeFile(file, new Uint8Array(21))
      watcher.historical([{ path: file, type: "update" }])
      const second = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform })
      const restored = await second.scan(2, root, {}, () => {})
      expect(restored.source).toBe("delta")
      expect(restored.root.size).toBe(21)
      expect(scans).toBe(2)
      await second.stopAll()
    })
  }

  test("replays offline events by rescanning only the changed materialized node", async () => {
    const root = await temp()
    const cacheDir = await temp()
    const file = path.join(root, "file.bin")
    await writeFile(file, new Uint8Array(12))
    const watcher = fakeWatcher()
    const scanned: string[] = []
    const scan = async (target: string) => {
      scanned.push(target)
      return scanFixture(target)
    }
    const first = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    await first.scan(1, root, {}, () => {})
    await first.stopAll()

    await writeFile(file, new Uint8Array(29))
    watcher.historical([{ path: file, type: "update" }])
    const second = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin" })
    const updated = await second.scan(2, root, {}, () => {})
    expect(updated.source).toBe("delta")
    expect(updated.changedPaths).toEqual([file])
    expect(updated.root.size).toBe(29)
    expect(scanned).toEqual([root, file])
    await second.stopAll()
  })

  test("keeps repeated watcher deltas local and invalidates a stale deep developer inventory", async () => {
    const root = await temp()
    const file = path.join(root, "project", "node_modules", "index.js")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, new Uint8Array(12))
    const original: DiskNode = {
      ...(await scanFixture(root)),
      developerArtifactInventory: {
        items: [
          {
            name: "node_modules",
            path: path.dirname(file),
            size: 12,
            isDir: true,
            kind: "dependencies",
            ecosystem: "node",
            confidence: "verified",
            cleanup: "eligible",
            evidence: ["name:node_modules"],
            inventoryOnly: true,
          },
        ],
        status: {
          state: "complete",
          maxItems: 200,
          scannedDirectories: 3,
          matchedDirectories: 1,
          truncated: false,
          unreadableCount: 0,
          unreadableSamplePaths: [],
          skippedSymlinkCount: 0,
          skippedSymlinkSamplePaths: [],
          excludedCount: 0,
          excludedSamplePaths: [],
        },
      },
    }
    const scanned: string[] = []
    const inventoryOptions: ScanOptions["developerArtifactInventory"][] = []
    const scan = async (target: string, options: ScanOptions) => {
      scanned.push(target)
      inventoryOptions.push(options.developerArtifactInventory)
      return scanFixture(target)
    }

    const first = await applyDiskDelta(original, [{ path: file, type: "update" }], scan, {
      developerArtifactInventory: { maxItems: 200 },
    })
    const second = await applyDiskDelta(first.root, [{ path: file, type: "update" }], scan, {
      developerArtifactInventory: { maxItems: 200 },
    })

    expect(scanned).toEqual([file, file])
    expect(inventoryOptions).toEqual([undefined, undefined])
    expect(first.changedPaths).toEqual([file])
    expect(second.changedPaths).toEqual([file])
    expect(first.root.developerArtifactInventory).toBeUndefined()
    expect(second.root.developerArtifactInventory).toBeUndefined()
  })

  test("lets the event loop advance while indexing and reconciling a large incremental delta", async () => {
    const rootPath = "/benchmark-root"
    const children = Array.from({ length: 1_024 }, (_, index): DiskNode => ({
      name: `file-${index}.bin`,
      path: `${rootPath}/file-${index}.bin`,
      size: 1,
      isDir: false,
      children: [],
      ext: "bin",
    }))
    const root: DiskNode = {
      name: "benchmark-root",
      path: rootPath,
      size: children.length,
      isDir: true,
      children,
      ext: "",
    }
    const changed = { ...children.at(-1)!, size: 9 }
    let eventLoopTurns = 0
    let active = true
    let turn: ReturnType<typeof setImmediate>
    const scheduleTurn = () => {
      turn = setImmediate(() => {
        eventLoopTurns++
        if (active) scheduleTurn()
      })
    }
    scheduleTurn()

    try {
      const result = await applyDiskDelta(
        root,
        [{ path: changed.path, type: "update" }],
        async () => changed,
        { sizeMode: "logical" },
      )
      expect(result.changedPaths).toEqual([changed.path])
      expect(result.root.size).toBe(children.length + 8)
      expect(eventLoopTurns).toBeGreaterThan(2)
    } finally {
      active = false
      clearImmediate(turn!)
    }
  })

  test("pushes live changes into the open tree", async () => {
    const root = await temp()
    const cacheDir = await temp()
    const file = path.join(root, "file.bin")
    await writeFile(file, new Uint8Array(4))
    const watcher = fakeWatcher()
    const manager = new DiskSnapshotManager({
      cacheDir,
      scan: (target) => scanFixture(target),
      watcher: watcher.api,
      platform: "darwin",
      debounceMs: 1,
    })
    const updates: DiskNode[] = []
    await manager.scan(1, root, {}, (update) => updates.push(update.root))
    await writeFile(file, new Uint8Array(18))
    watcher.emit([{ path: file, type: "update" }])
    await eventually(() => updates.at(-1)?.size === 18)
    expect(updates.at(-1)?.size).toBe(18)
    await manager.stopAll()
  })

  test("retains failed watcher events and recovers with a full root scan", async () => {
    const root = await temp()
    const cacheDir = await temp()
    const file = path.join(root, "file.bin")
    await writeFile(file, new Uint8Array(4))
    const watcher = fakeWatcher()
    let initialScanComplete = false
    let failedRefreshScans = 0
    let recoveryRootScans = 0
    const manager = new DiskSnapshotManager({
      cacheDir,
      scan: async (target) => {
        if (!initialScanComplete) {
          const tree = await scanFixture(target)
          initialScanComplete = true
          return tree
        }
        // applyDiskDelta escalates one failed local scan to its own root scan.
        // Fail both calls across three refresh attempts so the manager-level
        // recovery path must retain the event and perform a fresh root scan.
        if (failedRefreshScans < 6) {
          failedRefreshScans++
          throw new Error("transient refresh failure")
        }
        if (target === root) recoveryRootScans++
        return scanFixture(target)
      },
      watcher: watcher.api,
      platform: "darwin",
      debounceMs: 1,
    })
    const updates: DiskSnapshotUpdate[] = []
    await manager.scan("recovery", root, {}, (update) => updates.push(update))
    await writeFile(file, new Uint8Array(18))
    watcher.emit([{ path: file, type: "update" }])
    await eventually(() => updates.at(-1)?.root.size === 18)
    expect(failedRefreshScans).toBe(6)
    expect(recoveryRootScans).toBe(1)
    expect(updates.at(-1)?.changedPaths).toEqual([root])
    expect(updates.at(-1)?.watchError).toBeUndefined()
    await manager.stopAll()
  })

  test("does not persist an inventory-invalidated live delta under an inventory cache key", async () => {
    const root = await temp()
    const cacheDir = await temp()
    const file = path.join(root, "project", "node_modules", "file.bin")
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, new Uint8Array(4))
    const watcher = fakeWatcher()
    const scan = async (target: string, options: ScanOptions) => {
      const tree = await scanFixture(target)
      if (path.resolve(target) !== path.resolve(root) || !options.developerArtifactInventory) return tree
      tree.developerArtifactInventory = {
        items: [],
        status: {
          state: "complete",
          maxItems: 200,
          scannedDirectories: 3,
          matchedDirectories: 0,
          truncated: false,
          unreadableCount: 0,
          unreadableSamplePaths: [],
          skippedSymlinkCount: 0,
          skippedSymlinkSamplePaths: [],
          excludedCount: 0,
          excludedSamplePaths: [],
        },
      }
      return tree
    }
    const options = { developerArtifactInventory: { maxItems: 200 } }
    const manager = new DiskSnapshotManager({ cacheDir, scan, watcher: watcher.api, platform: "darwin", debounceMs: 1 })
    const updates: DiskNode[] = []
    await manager.scan("first", root, options, (update) => updates.push(update.root))
    await writeFile(file, new Uint8Array(18))
    watcher.emit([{ path: file, type: "update" }])
    await eventually(() => updates.length > 0 && updates.at(-1)?.developerArtifactInventory === undefined)
    expect(updates.at(-1)?.developerArtifactInventory).toBeUndefined()
    await manager.stop("first")

    let rootScans = 0
    const second = new DiskSnapshotManager({
      cacheDir,
      scan: async (target, scanOptions) => {
        if (path.resolve(target) === path.resolve(root)) rootScans++
        return scan(target, scanOptions)
      },
      watcher: watcher.api,
      platform: "darwin",
      debounceMs: 1,
    })
    const reopened = await second.scan("second", root, options, () => {})
    expect(reopened.source).toBe("scan")
    expect(rootScans).toBe(1)
    expect(reopened.root.developerArtifactInventory).toBeDefined()
    await second.stopAll()
  })

  test("keeps snapshot lifecycles isolated for simultaneous scan sessions", async () => {
    const firstRoot = await temp()
    const secondRoot = await temp()
    const cacheDir = await temp()
    await writeFile(path.join(firstRoot, "first.bin"), new Uint8Array(4))
    await writeFile(path.join(secondRoot, "second.bin"), new Uint8Array(8))
    const manager = new DiskSnapshotManager({
      cacheDir,
      scan: (target) => scanFixture(target),
      watcher: fakeWatcher().api,
      platform: "darwin",
    })

    await Promise.all([
      manager.scan("window:scan-a", firstRoot, {}, () => {}),
      manager.scan("window:scan-b", secondRoot, {}, () => {}),
    ])
    expect(manager.activeOwners().sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "window:scan-a",
      "window:scan-b",
    ])

    await manager.stop("window:scan-a")
    expect(manager.activeOwners()).toEqual(["window:scan-b"])
    await manager.stopAll()
  })

  test("keeps an active same-key checkpoint through concurrent cleanup and pruning", async () => {
    const root = await temp()
    const cacheDir = await temp()
    await writeFile(path.join(root, "file.bin"), new Uint8Array(8))
    const checkpoints: string[] = []
    let blockNextRead = false
    let firstReadStarted!: () => void
    const firstRead = new Promise<void>((resolve) => {
      firstReadStarted = resolve
    })
    let releaseFirstRead!: () => void
    const releaseGate = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    const watcher = {
      async writeSnapshot(_dir: string, snapshot: string) {
        checkpoints.push(snapshot)
        await writeFile(snapshot, "checkpoint")
        return snapshot
      },
      async getEventsSince(_dir: string, checkpoint: string) {
        if (blockNextRead) {
          blockNextRead = false
          firstReadStarted()
          await releaseGate
        }
        // This is deliberately after the gate: older cleanup code removed
        // the cached checkpoint while the first owner was still about to read it.
        await stat(checkpoint)
        return [] as ParcelWatcher.Event[]
      },
      async subscribe(_dir: string, _next: ParcelWatcher.SubscribeCallback) {
        return { async unsubscribe() {} }
      },
    }
    const manager = new DiskSnapshotManager({
      cacheDir,
      scan: (target) => scanFixture(target),
      watcher,
      platform: "darwin",
    })

    await manager.scan("seed", root, {}, () => {})
    await manager.stop("seed")

    // Put this live cache entry just outside the newest eight. A concurrent
    // prune must see the active checkpoint lease and leave its directory alone.
    const future = (Date.now() + 60_000) / 1_000
    await Promise.all(
      Array.from({ length: 8 }, async (_, index) => {
        const noise = path.join(cacheDir, `newer-${index}`)
        await mkdir(noise)
        const metadata = path.join(noise, "metadata.json")
        await writeFile(metadata, "{}")
        await utimes(metadata, future, future)
      }),
    )

    blockNextRead = true
    const first = manager.scan("first", root, {}, () => {})
    await firstRead
    try {
      const second = await manager.scan("second", root, {}, () => {})
      expect(second.source).toBe("snapshot")
      await (manager as unknown as { prune(): Promise<void> }).prune()
      await expect(stat(checkpoints[1]!)).resolves.toBeDefined()

      releaseFirstRead()
      expect((await first).source).toBe("snapshot")
    } finally {
      releaseFirstRead()
      await manager.stopAll()
    }
  })

  test("does not let superseded cleanup stop the replacement session", async () => {
    const firstRoot = await temp()
    const secondRoot = await temp()
    const cacheDir = await temp()
    await writeFile(path.join(secondRoot, "ready.bin"), new Uint8Array(8))
    const firstController = new AbortController()
    let started!: () => void
    const firstStarted = new Promise<void>((resolve) => (started = resolve))
    const manager = new DiskSnapshotManager({
      cacheDir,
      scan: (target, options) => {
        if (target !== firstRoot) return scanFixture(target)
        return new Promise((_, reject) => {
          started()
          options.signal?.addEventListener(
            "abort",
            () => setTimeout(() => reject(options.signal?.reason ?? new Error("cancelled")), 10),
            { once: true },
          )
        })
      },
      watcher: fakeWatcher().api,
      platform: "darwin",
    })

    const first = manager.scan("window:shared", firstRoot, { signal: firstController.signal }, () => {})
    await firstStarted
    firstController.abort(new Error("superseded"))
    const firstRejected = expect(first).rejects.toThrow("superseded")
    const replacement = await manager.scan("window:shared", secondRoot, {}, () => {})
    await firstRejected

    expect(replacement.root.size).toBe(8)
    expect(manager.activeOwners()).toEqual(["window:shared"])
    await manager.stopAll()
  })

  test("rescans above collapsed aggregates and coalesces nested events", async () => {
    const root: DiskNode = {
      name: "root",
      path: "/root",
      size: 10,
      isDir: true,
      ext: "",
      children: [
        {
          name: "project",
          path: "/root/project",
          size: 10,
          isDir: true,
          ext: "",
          children: [
            {
              name: "node_modules",
              path: "/root/project/node_modules",
              size: 10,
              isDir: true,
              isCollapsed: true,
              ext: "",
              children: [],
            },
          ],
        },
      ],
    }
    expect(
      await deltaRoots(root, [
        { path: "/root/project/node_modules/a/index.js", type: "update" },
        { path: "/root/project/node_modules/b/index.js", type: "create" },
      ]),
    ).toEqual(["/root/project"])
  })

  test("drops coalesced ancestor updates when FSEvents includes a specific child", async () => {
    const file: DiskNode = {
      name: "file.bin",
      path: "/root/file.bin",
      size: 10,
      isDir: false,
      ext: "bin",
      children: [],
    }
    const root: DiskNode = {
      name: "root",
      path: "/root",
      size: 10,
      isDir: true,
      ext: "",
      children: [file],
    }
    expect(
      await deltaRoots(root, [
        { path: "/root", type: "update" },
        { path: "/root/file.bin", type: "update" },
      ]),
    ).toEqual(["/root/file.bin"])
  })

  test("rebases physical accounting when a dirty subtree contains hard links", async () => {
    const linked: DiskNode = {
      name: "linked.bin",
      path: "/root/project/linked.bin",
      size: 8,
      hardLink: "primary",
      isDir: false,
      ext: "bin",
      children: [],
    }
    const project: DiskNode = {
      name: "project",
      path: "/root/project",
      size: 8,
      isDir: true,
      ext: "",
      children: [linked],
    }
    const root: DiskNode = {
      name: "root",
      path: "/root",
      size: 8,
      isDir: true,
      ext: "",
      children: [project],
    }
    const scanned: string[] = []
    const updated = await applyDiskDelta(
      root,
      [{ path: linked.path, type: "update" }],
      async (target) => {
        scanned.push(target)
        return target === root.path ? root : linked
      },
      { sizeMode: "physical" },
    )
    expect(scanned).toEqual([root.path])
    expect(updated.changedPaths).toEqual([root.path])
  })

  test("rebases an exact APFS clone group instead of leaving a stale zero-byte secondary", async () => {
    const clone = (name: string, nodePath: string, size: number, cloneAccounting: "primary" | "secondary"): DiskNode => ({
      name,
      path: nodePath,
      size,
      ...(cloneAccounting === "secondary" ? { logicalSize: 100 } : {}),
      clone: { state: "shares-all-blocks", cloneId: "clone-group", reportedFullCloneCount: 2 },
      cloneAccounting,
      isDir: false,
      ext: "bin",
      children: [],
    })
    const primary = clone("primary.bin", "/root/alpha/primary.bin", 100, "primary")
    const secondary = clone("secondary.bin", "/root/beta/secondary.bin", 0, "secondary")
    const alpha: DiskNode = {
      name: "alpha",
      path: "/root/alpha",
      size: 100,
      isDir: true,
      ext: "",
      children: [primary],
    }
    const beta: DiskNode = {
      name: "beta",
      path: "/root/beta",
      size: 0,
      logicalSize: 100,
      isDir: true,
      ext: "",
      children: [secondary],
    }
    const root: DiskNode = {
      name: "root",
      path: "/root",
      size: 100,
      logicalSize: 200,
      isDir: true,
      ext: "",
      children: [alpha, beta],
    }
    const scanned: string[] = []

    const updated = await applyDiskDelta(
      root,
      [{ path: secondary.path, type: "delete" }],
      async (target) => {
        scanned.push(target)
        return root
      },
      { sizeMode: "physical" },
    )

    expect(scanned).toEqual([root.path])
    expect(updated.changedPaths).toEqual([root.path])
  })

  test("rescans the whole root when a nested refresh reports partial shared-storage evidence", async () => {
    const collapsed: DiskNode = {
      name: "node_modules",
      path: "/root/project/node_modules",
      size: 8,
      logicalSize: 16,
      isDir: true,
      isCollapsed: true,
      ext: "",
      children: [],
    }
    const project: DiskNode = {
      name: "project",
      path: "/root/project",
      size: 8,
      logicalSize: 16,
      isDir: true,
      ext: "",
      children: [collapsed],
    }
    const root: DiskNode = {
      name: "root",
      path: "/root",
      size: 8,
      logicalSize: 16,
      sharedStorageEvidence: "complete",
      isDir: true,
      ext: "",
      children: [project],
    }
    const partialProject: DiskNode = { ...project, sharedStorageEvidence: "partial" }
    const rescannedRoot: DiskNode = {
      ...root,
      sharedStorageEvidence: "partial",
      children: [project],
    }
    const scanned: string[] = []

    const updated = await applyDiskDelta(
      root,
      [{ path: project.path, type: "update" }],
      async (target) => {
        scanned.push(target)
        return target === root.path ? rescannedRoot : partialProject
      },
      { sizeMode: "physical" },
    )

    expect(scanned).toEqual([project.path, root.path])
    expect(updated.changedPaths).toEqual([root.path])
    expect(updated.root.sharedStorageEvidence).toBe("partial")
    expect(updated.root.children[0]?.sharedStorageEvidence).toBeUndefined()
  })

  test("does not graft partial parent evidence after a changed file disappears", async () => {
    const file: DiskNode = {
      name: "shared.bin",
      path: "/root/project/shared.bin",
      size: 8,
      isDir: false,
      ext: "bin",
      children: [],
    }
    const project: DiskNode = {
      name: "project",
      path: "/root/project",
      size: 8,
      isDir: true,
      ext: "",
      children: [file],
    }
    const root: DiskNode = {
      name: "root",
      path: "/root",
      size: 8,
      sharedStorageEvidence: "complete",
      isDir: true,
      ext: "",
      children: [project],
    }
    const partialProject: DiskNode = { ...project, sharedStorageEvidence: "partial" }
    const rescannedRoot: DiskNode = {
      ...root,
      sharedStorageEvidence: "partial",
      children: [project],
    }
    const scanned: string[] = []

    const updated = await applyDiskDelta(
      root,
      [{ path: file.path, type: "update" }],
      async (target) => {
        scanned.push(target)
        if (target === file.path) throw new Error("file disappeared")
        return target === root.path ? rescannedRoot : partialProject
      },
      { sizeMode: "physical" },
    )

    expect(scanned).toEqual([file.path, project.path, root.path])
    expect(updated.changedPaths).toEqual([root.path])
    expect(updated.root.sharedStorageEvidence).toBe("partial")
  })

  test("recalculates apparent size after a localized refresh", async () => {
    const previous: DiskNode = {
      name: "sparse.bin",
      path: "/root/sparse.bin",
      size: 8,
      logicalSize: 64,
      isDir: false,
      ext: "bin",
      children: [],
    }
    const root: DiskNode = {
      name: "root",
      path: "/root",
      size: 8,
      logicalSize: 64,
      isDir: true,
      ext: "",
      children: [previous],
    }
    const replacement: DiskNode = { ...previous, size: 4, logicalSize: 32 }

    const updated = await applyDiskDelta(root, [{ path: previous.path, type: "update" }], async () => replacement, {
      sizeMode: "logical",
    })

    expect(updated.root.size).toBe(4)
    expect(updated.root.logicalSize).toBe(32)
  })
})
