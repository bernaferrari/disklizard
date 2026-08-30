import { describe, expect, test } from "bun:test"
import {
  CLEANUP_LOCK_LIMIT,
  decodeSavedPaths,
  parseSavedPaths,
  PINNED_LOCATION_LIMIT,
  sanitizeSavedPaths,
} from "./saved-paths"

describe("persisted filesystem paths", () => {
  test("rejects malformed, relative, traversing, nul, and oversized values", () => {
    const oversizedPath = `/${"a".repeat(64 * 1024)}`
    const oversizedLabel = "a".repeat(513)
    const result = sanitizeSavedPaths(
      [
        null,
        [],
        { path: 1, label: "number" },
        { path: "relative/folder", label: "relative" },
        { path: "/work/../private", label: "traversal" },
        { path: "/work/./private", label: "dot" },
        { path: "/work/\0private", label: "nul" },
        { path: oversizedPath, label: "oversized path" },
        { path: "/work/label", label: oversizedLabel },
        { path: "C:relative", label: "drive relative" },
        { path: "C://malformed", label: "double separator" },
        { path: "\\\\server", label: "missing share" },
        { path: "/work/project/", label: "  Project  " },
      ],
      { limit: PINNED_LOCATION_LIMIT },
    )

    expect(result).toEqual([{ path: "/work/project", label: "Project" }])
  })

  test("normalizes filesystem roots and supplies an empty label", () => {
    expect(
      sanitizeSavedPaths(
        [
          { path: "/", label: "" },
          { path: "C:\\", label: "  " },
          { path: "\\\\server\\share\\folder\\", label: "Network" },
        ],
        { limit: PINNED_LOCATION_LIMIT },
      ),
    ).toEqual([
      { path: "/", label: "/" },
      { path: "C:/", label: "C:/" },
      { path: "//server/share/folder", label: "Network" },
    ])
  })

  test("deduplicates Windows cleanup locks case-insensitively and clamps them", () => {
    const locks = [
      { path: "C:\\Work\\App", label: "First" },
      { path: "c:/work/app/", label: "Duplicate" },
      ...Array.from({ length: CLEANUP_LOCK_LIMIT + 5 }, (_, index) => ({
        path: `/work/${index}`,
        label: `${index}`,
      })),
    ]
    const result = sanitizeSavedPaths(locks, { limit: CLEANUP_LOCK_LIMIT, foldWindowsCase: true })

    expect(result).toHaveLength(CLEANUP_LOCK_LIMIT)
    expect(result[0]).toEqual({ path: "C:/Work/App", label: "First" })
    expect(result.some((entry) => entry.label === "Duplicate")).toBe(false)
  })

  test("preserves case-distinct Windows pins", () => {
    expect(
      sanitizeSavedPaths(
        [
          { path: "C:\\Work\\App", label: "Upper" },
          { path: "c:\\work\\app", label: "Lower" },
        ],
        { limit: PINNED_LOCATION_LIMIT },
      ),
    ).toEqual([
      { path: "C:/Work/App", label: "Upper" },
      { path: "c:/work/app", label: "Lower" },
    ])
  })

  test("uses POSIX separators on macOS and Linux without dropping literal backslashes", () => {
    expect(
      sanitizeSavedPaths(
        [
          { path: "/srv/name\\with\\slashes", label: "Literal backslashes" },
          { path: "/srv//project///", label: "Repeated separators" },
          { path: "//srv/share", label: "Leading separators" },
          { path: "/srv/../private", label: "Traversal" },
        ],
        { limit: 12, os: "linux" },
      ),
    ).toEqual([
      { path: "/srv/name\\with\\slashes", label: "Literal backslashes" },
      { path: "/srv/project", label: "Repeated separators" },
      { path: "/srv/share", label: "Leading separators" },
    ])
  })

  test("keeps Windows parsing separate from POSIX path syntax", () => {
    expect(
      sanitizeSavedPaths(
        [
          { path: "C:\\Work\\App", label: "Windows" },
          { path: "/srv/project", label: "POSIX" },
          { path: "\\\\?\\C:\\device", label: "Device namespace" },
        ],
        { limit: 12, os: "windows" },
      ),
    ).toEqual([{ path: "C:/Work/App", label: "Windows" }])
  })

  test("fails closed for non-finite or unsafe limits", () => {
    const values = Array.from({ length: 30 }, (_, index) => ({ path: `/work/${index}`, label: `${index}` }))
    expect(sanitizeSavedPaths(values, { limit: Number.NaN })).toEqual([])
    expect(sanitizeSavedPaths(values, { limit: Number.POSITIVE_INFINITY })).toEqual([])
    expect(sanitizeSavedPaths(values, { limit: 1.5 })).toEqual([])
  })

  test("rejects invalid or non-array JSON", () => {
    expect(parseSavedPaths("not json", { limit: 12 })).toBeUndefined()
    expect(parseSavedPaths('{"path":"/work"}', { limit: 12 })).toBeUndefined()
    expect(parseSavedPaths(undefined, { limit: 12 })).toBeUndefined()
    expect(decodeSavedPaths(undefined, { limit: 12 })).toEqual({ status: "missing" })
    expect(decodeSavedPaths("not json", { limit: 12 })).toEqual({ status: "invalid" })
    expect(decodeSavedPaths("[]", { limit: 12 })).toEqual({ status: "valid", value: [] })
  })

  test("strict cleanup-protection decoding rejects every discarded entry", () => {
    const valid = { path: "/work/protected", label: "Protected" }
    for (const value of [
      [valid, { path: "/work/corrupt-label", label: "x".repeat(513) }],
      [valid, { path: "/work/protected/", label: "Duplicate" }],
      [valid, { path: "relative", label: "Relative" }],
      [valid, { path: "/work/second", label: "Second" }],
    ]) {
      expect(
        decodeSavedPaths(JSON.stringify(value), {
          limit: value.at(-1)?.path === "/work/second" ? 1 : CLEANUP_LOCK_LIMIT,
          rejectDiscardedEntries: true,
        }),
      ).toEqual({ status: "invalid" })
    }

    expect(
      decodeSavedPaths(JSON.stringify([{ path: "/work/protected/", label: " Protected " }]), {
        limit: CLEANUP_LOCK_LIMIT,
        rejectDiscardedEntries: true,
      }),
    ).toEqual({ status: "valid", value: [{ path: "/work/protected", label: "Protected" }] })
  })
})
