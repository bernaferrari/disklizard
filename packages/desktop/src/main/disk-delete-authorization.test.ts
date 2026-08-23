import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  DiskDeleteAuthorizationManager,
  INVALID_DELETE_AUTHORIZATION_ERROR,
  UNSCANNED_DELETE_TARGET_ERROR,
} from "./disk-delete-authorization"

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("scan-bound delete authorization", () => {
  test("authorizes only an item issued by the sender's active scan", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "disklizard-delete-auth-"))
    temporary.push(rootPath)
    const filePath = join(rootPath, "reviewed.txt")
    await writeFile(filePath, "reviewed")
    const manager = new DiskDeleteAuthorizationManager()
    manager.updateRoot("7:scan", 7, {
      name: "root",
      path: rootPath,
      size: 8,
      isDir: true,
      ext: "",
      children: [{ name: "reviewed.txt", path: filePath, size: 8, isDir: false, ext: "txt", children: [] }],
    })

    const [prepared] = await manager.authorize(7, [filePath], async () => undefined)
    await expect(manager.consume(7, filePath, prepared.authorization)).resolves.toBeUndefined()
    await expect(manager.authorize(8, [filePath], async () => undefined)).rejects.toThrow(
      UNSCANNED_DELETE_TARGET_ERROR,
    )
    await expect(manager.authorize(7, [join(rootPath, "other.txt")], async () => undefined)).rejects.toThrow(
      UNSCANNED_DELETE_TARGET_ERROR,
    )
  })

  test("rejects a one-time authorization after the file identity changes", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "disklizard-delete-auth-"))
    temporary.push(rootPath)
    const filePath = join(rootPath, "changing.txt")
    await writeFile(filePath, "before")
    const manager = new DiskDeleteAuthorizationManager()
    manager.updateRoot("9:scan", 9, {
      name: "root",
      path: rootPath,
      size: 6,
      isDir: true,
      ext: "",
      children: [{ name: "changing.txt", path: filePath, size: 6, isDir: false, ext: "txt", children: [] }],
    })
    const [prepared] = await manager.authorize(9, [filePath], async () => undefined)
    await writeFile(filePath, "after-with-a-different-size")
    await expect(manager.consume(9, filePath, prepared.authorization)).rejects.toThrow(
      INVALID_DELETE_AUTHORIZATION_ERROR,
    )
  })

  test("does not publish capabilities when the reviewed scan changes during authorization", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "disklizard-delete-auth-"))
    temporary.push(rootPath)
    const filePath = join(rootPath, "stale.txt")
    await writeFile(filePath, "stale")
    const manager = new DiskDeleteAuthorizationManager()
    manager.updateRoot("11:scan", 11, {
      name: "root",
      path: rootPath,
      size: 5,
      isDir: true,
      ext: "",
      children: [{ name: "stale.txt", path: filePath, size: 5, isDir: false, ext: "txt", children: [] }],
    })

    await expect(
      manager.authorize(11, [filePath], async () => {
        manager.updateRoot("11:scan", 11, {
          name: "root",
          path: rootPath,
          size: 0,
          isDir: true,
          ext: "",
          children: [],
        })
      }),
    ).rejects.toThrow(UNSCANNED_DELETE_TARGET_ERROR)
    await expect(manager.authorize(11, [filePath], async () => undefined)).rejects.toThrow(
      UNSCANNED_DELETE_TARGET_ERROR,
    )
  })

  test("bounds filesystem checks while preserving reviewed batch order", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "disklizard-delete-auth-"))
    temporary.push(rootPath)
    const paths = Array.from({ length: 32 }, (_, index) => join(rootPath, `${index}.txt`))
    await Promise.all(paths.map((path) => writeFile(path, "x")))
    const manager = new DiskDeleteAuthorizationManager()
    manager.updateRoot("13:scan", 13, {
      name: "root",
      path: rootPath,
      size: paths.length,
      isDir: true,
      ext: "",
      children: paths.map((path, index) => ({
        name: `${index}.txt`,
        path,
        size: 1,
        isDir: false,
        ext: "txt",
        children: [],
      })),
    })

    let active = 0
    let peak = 0
    const prepared = await manager.authorize(13, [...paths, paths[0]!], async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => setImmediate(resolve))
      active -= 1
    })

    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(16)
    expect(prepared.map(({ path }) => path)).toEqual(paths)
  })
})
