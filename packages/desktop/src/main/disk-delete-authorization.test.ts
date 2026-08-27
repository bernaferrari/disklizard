import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
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
    const validate = await manager.consume(7, filePath, prepared.authorization)
    await expect(validate()).resolves.toBeUndefined()
    await expect(validate()).rejects.toThrow(INVALID_DELETE_AUTHORIZATION_ERROR)
    await expect(manager.authorize(8, [filePath], async () => undefined)).rejects.toThrow(UNSCANNED_DELETE_TARGET_ERROR)
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
    const validate = await manager.consume(9, filePath, prepared.authorization)
    await writeFile(filePath, "after-with-a-different-size")
    await expect(validate()).rejects.toThrow(INVALID_DELETE_AUTHORIZATION_ERROR)
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

  test("rejects the final guard when a watcher replaces the reviewed scan", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "disklizard-delete-auth-"))
    temporary.push(rootPath)
    const filePath = join(rootPath, "replaced.txt")
    await writeFile(filePath, "reviewed")
    const manager = new DiskDeleteAuthorizationManager()
    manager.updateRoot("15:scan", 15, {
      name: "root",
      path: rootPath,
      size: 8,
      isDir: true,
      ext: "",
      children: [{ name: "replaced.txt", path: filePath, size: 8, isDir: false, ext: "txt", children: [] }],
    })
    const [prepared] = await manager.authorize(15, [filePath], async () => undefined)
    const validate = await manager.consume(15, filePath, prepared.authorization)

    manager.updateRoot("15:scan", 15, {
      name: "root",
      path: rootPath,
      size: 0,
      isDir: true,
      ext: "",
      children: [],
    })
    await expect(validate()).rejects.toThrow(INVALID_DELETE_AUTHORIZATION_ERROR)
  })

  test("retains a trusted focused subtree only while its trusted parent generation remains active", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "disklizard-delete-auth-"))
    temporary.push(rootPath)
    const focusedPath = join(rootPath, "focused")
    const filePath = join(focusedPath, "expanded.txt")
    await mkdir(focusedPath)
    await writeFile(filePath, "expanded")
    const manager = new DiskDeleteAuthorizationManager()
    const primaryRoot = {
      name: "root",
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
    }
    const focusedRoot = {
      name: "focused",
      path: focusedPath,
      size: 8,
      isDir: true,
      ext: "",
      children: [{ name: "expanded.txt", path: filePath, size: 8, isDir: false, ext: "txt", children: [] }],
    }
    manager.updateRoot("17:primary", 17, primaryRoot)
    manager.updateRoot("17:expand", 17, focusedRoot)

    const [preparedBeforeStop] = await manager.authorize(17, [filePath], async () => undefined)
    expect(manager.retainOwnerAsTrustedSubtree("17:expand")).toBe(true)
    const validatePreparedBeforeStop = await manager.consume(17, filePath, preparedBeforeStop.authorization)
    await expect(validatePreparedBeforeStop()).resolves.toBeUndefined()
    const [prepared] = await manager.authorize(17, [filePath], async () => undefined)
    const validate = await manager.consume(17, filePath, prepared.authorization)
    await expect(validate()).resolves.toBeUndefined()

    const [stale] = await manager.authorize(17, [filePath], async () => undefined)
    manager.updateRoot("17:primary", 17, { ...primaryRoot, children: [] })
    await expect(manager.consume(17, filePath, stale.authorization)).rejects.toThrow(INVALID_DELETE_AUTHORIZATION_ERROR)
    await expect(manager.authorize(17, [filePath], async () => undefined)).rejects.toThrow(
      UNSCANNED_DELETE_TARGET_ERROR,
    )

    manager.updateRoot("17:primary", 17, primaryRoot)
    manager.updateRoot("17:expand", 17, focusedRoot)
    expect(manager.retainOwnerAsTrustedSubtree("17:expand")).toBe(true)
    const [reused] = await manager.authorize(17, [filePath], async () => undefined)
    manager.updateRoot("17:expand", 17, { ...focusedRoot, children: [] })
    await expect(manager.consume(17, filePath, reused.authorization)).rejects.toThrow(
      INVALID_DELETE_AUTHORIZATION_ERROR,
    )
  })

  test("supersedes an older retained generation for the same focused path", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "disklizard-delete-auth-"))
    temporary.push(rootPath)
    const focusedPath = join(rootPath, "focused")
    const oldPath = join(focusedPath, "old.txt")
    const freshPath = join(focusedPath, "fresh.txt")
    await mkdir(focusedPath)
    await Promise.all([writeFile(oldPath, "old"), writeFile(freshPath, "fresh")])
    const manager = new DiskDeleteAuthorizationManager()
    manager.updateRoot("21:primary", 21, {
      name: "root",
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
    manager.updateRoot("21:expand-old", 21, {
      name: "focused",
      path: focusedPath,
      size: 3,
      isDir: true,
      ext: "",
      children: [{ name: "old.txt", path: oldPath, size: 3, isDir: false, ext: "txt", children: [] }],
    })
    expect(manager.retainOwnerAsTrustedSubtree("21:expand-old")).toBe(true)
    const [oldAuthorization] = await manager.authorize(21, [oldPath], async () => undefined)

    manager.updateRoot("21:expand-new", 21, {
      name: "focused",
      path: focusedPath,
      size: 5,
      isDir: true,
      ext: "",
      children: [{ name: "fresh.txt", path: freshPath, size: 5, isDir: false, ext: "txt", children: [] }],
    })
    expect(manager.retainOwnerAsTrustedSubtree("21:expand-new")).toBe(true)

    await expect(manager.consume(21, oldPath, oldAuthorization.authorization)).rejects.toThrow(
      INVALID_DELETE_AUTHORIZATION_ERROR,
    )
    await expect(manager.authorize(21, [oldPath], async () => undefined)).rejects.toThrow(
      UNSCANNED_DELETE_TARGET_ERROR,
    )
    await expect(manager.authorize(21, [freshPath], async () => undefined)).resolves.toHaveLength(1)
  })

  test("retains nested focused authority and invalidates the complete chain transitively", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "disklizard-delete-auth-"))
    temporary.push(rootPath)
    const focusedPath = join(rootPath, "focused")
    const nestedPath = join(focusedPath, "nested")
    const filePath = join(nestedPath, "deep.txt")
    await mkdir(nestedPath, { recursive: true })
    await writeFile(filePath, "deep")
    const manager = new DiskDeleteAuthorizationManager()
    const primaryRoot = {
      name: "root",
      path: rootPath,
      size: 4,
      isDir: true,
      ext: "",
      children: [
        {
          name: "focused",
          path: focusedPath,
          size: 4,
          isDir: true,
          isCollapsed: true,
          ext: "",
          children: [],
        },
      ],
    }
    manager.updateRoot("23:primary", 23, primaryRoot)
    manager.updateRoot("23:expand-focused", 23, {
      name: "focused",
      path: focusedPath,
      size: 4,
      isDir: true,
      ext: "",
      children: [
        {
          name: "nested",
          path: nestedPath,
          size: 4,
          isDir: true,
          isCollapsed: true,
          ext: "",
          children: [],
        },
      ],
    })
    expect(manager.retainOwnerAsTrustedSubtree("23:expand-focused")).toBe(true)
    manager.updateRoot("23:expand-nested", 23, {
      name: "nested",
      path: nestedPath,
      size: 4,
      isDir: true,
      ext: "",
      children: [{ name: "deep.txt", path: filePath, size: 4, isDir: false, ext: "txt", children: [] }],
    })
    expect(manager.retainOwnerAsTrustedSubtree("23:expand-nested")).toBe(true)

    const [prepared] = await manager.authorize(23, [filePath], async () => undefined)
    manager.updateRoot("23:primary", 23, { ...primaryRoot, children: [] })
    await expect(manager.consume(23, filePath, prepared.authorization)).rejects.toThrow(
      INVALID_DELETE_AUTHORIZATION_ERROR,
    )
    await expect(manager.authorize(23, [filePath], async () => undefined)).rejects.toThrow(
      UNSCANNED_DELETE_TARGET_ERROR,
    )
  })

  test("bounds retained focused authority roots", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "disklizard-delete-auth-"))
    temporary.push(rootPath)
    const manager = new DiskDeleteAuthorizationManager()
    const focused = Array.from({ length: 65 }, (_, index) => {
      const directoryPath = join(rootPath, `focused-${index}`)
      const filePath = join(directoryPath, "expanded.txt")
      return { directoryPath, filePath }
    })
    await Promise.all(
      focused.map(async ({ directoryPath, filePath }) => {
        await mkdir(directoryPath)
        await writeFile(filePath, "expanded")
      }),
    )
    manager.updateRoot("19:primary", 19, {
      name: "root",
      path: rootPath,
      size: focused.length,
      isDir: true,
      ext: "",
      children: focused.map(({ directoryPath }, index) => ({
        name: `focused-${index}`,
        path: directoryPath,
        size: 1,
        isDir: true,
        isCollapsed: true,
        ext: "",
        children: [],
      })),
    })
    for (let index = 0; index < focused.length; index++) {
      const entry = focused[index]!
      manager.updateRoot(`19:expand-${index}`, 19, {
        name: `focused-${index}`,
        path: entry.directoryPath,
        size: 1,
        isDir: true,
        ext: "",
        children: [{ name: "expanded.txt", path: entry.filePath, size: 8, isDir: false, ext: "txt", children: [] }],
      })
      expect(manager.retainOwnerAsTrustedSubtree(`19:expand-${index}`)).toBe(true)
    }

    await expect(manager.authorize(19, [focused[0]!.filePath], async () => undefined)).rejects.toThrow(
      UNSCANNED_DELETE_TARGET_ERROR,
    )
    await expect(manager.authorize(19, [focused.at(-1)!.filePath], async () => undefined)).resolves.toHaveLength(1)
  })
})
