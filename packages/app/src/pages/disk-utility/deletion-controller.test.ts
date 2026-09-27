import { describe, expect, test } from "bun:test"
import {
  assertCleanupProtectionsReady,
  executeAuthorizedDeletionBatch,
  resolveDeleteAuthorization,
} from "./deletion-controller"
import type { DiskScanNode } from "./types"

const node = (path: string): DiskScanNode => ({
  name: path.split(/[\\/]/).at(-1)!,
  path,
  size: 1,
  isDir: false,
  ext: "txt",
  children: [],
})

describe("reviewed deletion controller", () => {
  test("maps mixed per-item authorization outcomes without sinking successful rows", async () => {
    const first = node("/work/first.txt")
    const second = node("/work/second.txt")
    const removed: string[] = []
    const progress: Array<[number, number]> = []

    const result = await executeAuthorizedDeletionBatch({
      nodes: [first, second],
      cleanupProtectionsReady: true,
      authorize: async () => [
        { path: first.path, authorization: "first-token" },
        { path: second.path, error: "Second item changed" },
      ],
      remove: async (candidate, authorization) => {
        removed.push(`${candidate.path}:${authorization}`)
      },
      authorizationMismatchMessage: "Authorization mismatch",
      onSettled: (completed, total) => progress.push([completed, total]),
    })

    expect(removed).toEqual(["/work/first.txt:first-token"])
    expect(result.removed).toEqual([first])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({
      node: second,
      error: new Error("Second item changed"),
    })
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
  })

  test("uses exact capability paths even on case-sensitive Windows directories", () => {
    expect(() =>
      resolveDeleteAuthorization(
        [{ path: "C:\\Work\\Artifact.bin", authorization: "token" }],
        "C:\\Work\\artifact.bin",
        "Mismatch"
      )
    ).toThrow("Mismatch")
    expect(
      resolveDeleteAuthorization(
        [{ path: "C:\\Work\\Artifact.bin", authorization: "token" }],
        "C:\\Work\\Artifact.bin",
        "Mismatch"
      )
    ).toBe("token")
    expect(() =>
      resolveDeleteAuthorization([], "/missing", "Mismatch")
    ).toThrow("Mismatch")
  })

  test("deduplicates nested roots and skips cleanup-protected paths before authorization", async () => {
    const parent: DiskScanNode = {
      ...node("/work/project"),
      isDir: true,
      children: [node("/work/project/cache.bin")],
    }
    const protectedNode = node("/work/protected.bin")
    let requested: readonly string[] = []

    const result = await executeAuthorizedDeletionBatch({
      nodes: [parent.children[0], parent, protectedNode],
      cleanupProtectionsReady: true,
      locks: [{ path: "/work/protected.bin", label: "Protected" }],
      authorize: async (paths) => {
        requested = paths
        return paths.map((path) => ({ path, authorization: `token:${path}` }))
      },
      remove: async () => undefined,
      authorizationMismatchMessage: "Mismatch",
    })

    expect(requested).toEqual([parent.path])
    expect(result.removed).toEqual([parent])
    expect(result.failed).toEqual([])
  })

  test("never requests capabilities while saved cleanup protections are unavailable", async () => {
    let authorizations = 0
    const failure = await executeAuthorizedDeletionBatch({
      nodes: [node("/work/file.txt")],
      cleanupProtectionsReady: false,
      authorize: async () => {
        authorizations += 1
        return []
      },
      remove: async () => undefined,
      authorizationMismatchMessage: "Mismatch",
    }).then(
      () => null,
      (error: unknown) => error
    )
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(
      "Saved cleanup protections are unavailable"
    )
    expect(authorizations).toBe(0)
    expect(() =>
      assertCleanupProtectionsReady(false, "Protections not ready")
    ).toThrow("Protections not ready")
  })

  test("stops an authorized batch when a newly persisted lock protects a later item", async () => {
    const first = node("/work/first.txt")
    const second = node("/work/second.txt")
    let currentLocks: Array<{ path: string; label: string }> = []
    const removed: string[] = []

    const result = await executeAuthorizedDeletionBatch({
      nodes: [first, second],
      cleanupProtectionsReady: true,
      locks: [],
      currentCleanupLocks: () => currentLocks,
      authorize: async (paths) =>
        paths.map((path) => ({ path, authorization: `token:${path}` })),
      remove: async (candidate) => {
        removed.push(candidate.path)
        currentLocks = [{ path: "/work", label: "Work" }]
      },
      authorizationMismatchMessage: "Mismatch",
      cleanupProtectionChangedMessage: "Cleanup protections changed",
    })

    expect(removed).toEqual([first.path])
    expect(result.removed).toEqual([first])
    expect(result.failed).toEqual([
      { node: second, error: new Error("Cleanup protections changed") },
    ])
  })
})
