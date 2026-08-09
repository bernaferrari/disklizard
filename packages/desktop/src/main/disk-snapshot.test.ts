import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type ParcelWatcher from "@parcel/watcher"
import type { DiskNode } from "../../../disklizard/src/types"
import { applyDiskDelta, DiskSnapshotManager, deltaRoots, diskSnapshotKey } from "./disk-snapshot"

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((entry) => rm(entry, { recursive: true, force: true })))
})

async function temp() {
  const root = await mkdtemp(path.join(tmpdir(), "disklizard-snapshot-"))
  temporary.push(root)
  return realpath(root)
}

async function scanFixture(targetPath: string): Promise<DiskNode> {
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
    }
  }
  const names = await readdir(targetPath)
  const children = await Promise.all(names.map((name) => scanFixture(path.join(targetPath, name))))
  return {
    name: path.basename(targetPath),
    path: targetPath,
    size: children.reduce((total, child) => total + child.size, 0),
    modifiedAt: children.reduce((latest, child) => Math.max(latest, child.modifiedAt ?? 0), 0),
    isDir: true,
    children,
    ext: "",
  }
}

function fakeWatcher() {
  let callback: ParcelWatcher.SubscribeCallback | undefined
  let historical: ParcelWatcher.Event[] = []
  return {
    api: {
      async writeSnapshot(_dir: string, snapshot: string) {
        await writeFile(snapshot, String(Date.now()))
        return snapshot
      },
      async getEventsSince() {
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
  }
}

describe("disk scan snapshots", () => {
  test("uses a stable key for semantically identical scan options", () => {
    const first = diskSnapshotKey("/tmp/project", { preserveNames: ["target", "node_modules"] })
    const second = diskSnapshotKey("/tmp/project", { preserveNames: ["node_modules", "target"] })
    expect(first).toBe(second)
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
    await Bun.sleep(40)
    expect(updates.at(-1)?.size).toBe(18)
    await manager.stopAll()
  })

  test("rescans above collapsed aggregates and coalesces nested events", () => {
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
      deltaRoots(root, [
        { path: "/root/project/node_modules/a/index.js", type: "update" },
        { path: "/root/project/node_modules/b/index.js", type: "create" },
      ]),
    ).toEqual(["/root/project"])
  })

  test("drops coalesced ancestor updates when FSEvents includes a specific child", () => {
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
      deltaRoots(root, [
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
})
