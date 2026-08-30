import { describe, expect, test } from "bun:test"
import {
  cleanupLockForPath,
  cleanupLockMessage,
  isCleanupLock,
  isPathCleanupLocked,
  toggleCleanupLock,
  withoutCleanupLockedNodes,
} from "./cleanup-lock"
import type { DiskScanNode } from "./types"

const node = (path: string, name = path.split("/").pop() || path): DiskScanNode => ({
  name,
  path,
  size: 8,
  isDir: true,
  children: [],
  ext: "",
})

describe("cleanup locks", () => {
  test("covers the locked tree and its descendants, not siblings", () => {
    const locks = [{ path: "/Users/me/xai", label: "xai" }]
    expect(isPathCleanupLocked("/Users/me/xai", locks, "macos")).toBe(true)
    expect(isPathCleanupLocked("/Users/me/xai/core/node_modules", locks, "macos")).toBe(true)
    expect(isPathCleanupLocked("/Users/me/other", locks, "macos")).toBe(false)
    expect(cleanupLockForPath("/Users/me/xai/core", locks, "macos")?.label).toBe("xai")
  })

  test("matches Windows paths case-insensitively", () => {
    const locks = [{ path: "C:\\Work\\Starlink", label: "Starlink" }]
    expect(isPathCleanupLocked("c:\\work\\starlink\\bazel-bin", locks, "windows")).toBe(true)
    expect(isCleanupLock("c:\\WORK\\starlink", locks, "windows")).toBe(true)
    expect(isPathCleanupLocked("c:\\work\\starlink", [{ path: "C:\\", label: "Drive" }], "windows")).toBe(true)
  })

  test("uses POSIX separators without conflating literal backslashes", () => {
    const locks = [{ path: "/srv/name\\with\\slashes", label: "Literal" }]
    expect(isPathCleanupLocked("/srv/name\\with\\slashes/cache", locks, "linux")).toBe(true)
    expect(isPathCleanupLocked("/srv/name/with/slashes/cache", locks, "linux")).toBe(false)
    expect(isPathCleanupLocked("/srv/project/cache", [{ path: "/srv//project/", label: "Project" }], "linux")).toBe(
      true,
    )
  })

  test("toggles a lock without silently dropping an existing one when the list is full", () => {
    const locks = Array.from({ length: 24 }, (_, index) => ({ path: `/work/${index}`, label: `${index}` }))
    expect(toggleCleanupLock(locks, { path: "/work/extra", label: "extra" }, "linux")).toEqual(locks)
    expect(toggleCleanupLock([{ path: "/Users/me/xai", label: "xai" }], { path: "/Users/me/xai/", label: "xai" }, "macos")).toEqual([])
  })

  test("removes locked review items and explains the lock", () => {
    const locks = [{ path: "/Users/me/xai", label: "xai" }]
    const kept = node("/Users/me/scratch/cache", "cache")
    expect(
      withoutCleanupLockedNodes(
        [node("/Users/me/xai/node_modules", "node_modules"), kept],
        locks,
        "macos",
      ),
    ).toEqual([kept])
    expect(cleanupLockMessage(locks[0]!)).toContain("will not go to review or Trash")
  })
})
