import { describe, it, expect } from "bun:test"
import type { DiskScanNode } from "@/context/platform"
import { recognize, isReclaimable, computeReclaim, fileKind } from "./recognize"

const dir = (name: string, size: number, children: DiskScanNode[] = []): DiskScanNode => ({
  name,
  path: `/${name}`,
  size,
  isDir: true,
  children,
  ext: "",
})
const file = (name: string, size: number, ext: string): DiskScanNode => ({
  name,
  path: `/${name}`,
  size,
  isDir: false,
  children: [],
  ext,
})

describe("recognize — directory rules", () => {
  it("flags node_modules as regenerable", () => {
    const r = recognize(dir("node_modules", 100))
    expect(r.safety).toBe("regenerable")
    expect(r.tag).toBe("Node dependencies")
  })
  it("flags __pycache__ as regenerable", () => {
    expect(recognize(dir("__pycache__", 10)).safety).toBe("regenerable")
  })
  it("flags .cache as cache", () => {
    const r = recognize(dir(".cache", 10))
    expect(r.safety).toBe("cache")
    expect(r.tag).toBe("Cache directory")
  })
  it("flags .git as version-control (NOT reclaimable)", () => {
    const r = recognize(dir(".git", 10))
    expect(r.safety).toBe("version-control")
  })
  it("flags .venv as system", () => {
    expect(recognize(dir(".venv", 10)).safety).toBe("system")
  })
  it("flags Logs as logs", () => {
    expect(recognize(dir("Logs", 10)).safety).toBe("logs")
  })
  it("flags .Trash as trash", () => {
    expect(recognize(dir(".Trash", 10)).safety).toBe("trash")
  })
  it("returns unknown for an unrecognized directory", () => {
    const r = recognize(dir("vacation-photos", 10))
    expect(r.safety).toBe("unknown")
    expect(r.tag).toBeUndefined()
  })
})

describe("recognize — files via extension", () => {
  it("tags a video as media", () => {
    const r = recognize(file("movie.mp4", 1, "mp4"))
    expect(r.safety).toBe("media")
    expect(r.tag).toBe("Video")
  })
  it("tags an image as media", () => {
    expect(recognize(file("p.png", 1, "png")).tag).toBe("Image")
  })
  it("leaves an unknown extension as unknown", () => {
    expect(recognize(file("weird.zzz", 1, "zzz")).safety).toBe("unknown")
  })
})

describe("isReclaimable", () => {
  it("is true for regenerable / cache / logs / trash", () => {
    expect(isReclaimable(recognize(dir("node_modules", 1)))).toBe(true)
    expect(isReclaimable(recognize(dir(".cache", 1)))).toBe(true)
    expect(isReclaimable(recognize(dir("Logs", 1)))).toBe(true)
    expect(isReclaimable(recognize(dir(".Trash", 1)))).toBe(true)
  })
  it("is false for version-control / system / media / unknown", () => {
    expect(isReclaimable(recognize(dir(".git", 1)))).toBe(false)
    expect(isReclaimable(recognize(dir(".venv", 1)))).toBe(false)
    expect(isReclaimable(recognize(file("x.mp4", 1, "mp4")))).toBe(false)
    expect(isReclaimable(recognize(dir("misc", 1)))).toBe(false)
  })
})

describe("computeReclaim — non-double-counting walk", () => {
  it("counts a reclaimable subtree once and does not descend into it", () => {
    // node_modules (100, regenerable) contains a nested .cache (40) — the 40 must NOT be added.
    const tree = dir("root", 0, [
      dir("node_modules", 100, [dir(".cache", 40, [])]),
      dir(".git", 50, []),
      dir("src", 0, [dir("node_modules", 50, [])]),
    ])
    const sum = computeReclaim(tree)
    expect(sum.totalBytes).toBe(150) // 100 + 50, NOT 190
    expect(sum.totalCount).toBe(2)
  })
  it("skips version-control subtrees but descends unknown parents", () => {
    const tree = dir("root", 0, [dir(".git", 999, []), dir("src", 0, [dir("node_modules", 30, [])])])
    const sum = computeReclaim(tree)
    expect(sum.totalBytes).toBe(30) // .git excluded; nested node_modules under unknown src included
  })
  it("returns empty for null", () => {
    expect(computeReclaim(null)).toEqual({ totalBytes: 0, totalCount: 0, buckets: [] })
  })
  it("sorts buckets by bytes descending", () => {
    const tree = dir("root", 0, [dir("Logs", 5, []), dir("node_modules", 100, []), dir(".cache", 20, [])])
    const sum = computeReclaim(tree)
    expect(sum.buckets.map((b) => b.bytes)).toEqual([...sum.buckets.map((b) => b.bytes)].sort((a, b) => b - a))
  })
})

describe("fileKind", () => {
  it("categorizes archives and code without making them reclaimable", () => {
    expect(fileKind("zip").kind).toBe("archive")
    expect(fileKind("ts").kind).toBe("code")
    expect(fileKind("zip").safety).toBe("unknown")
  })
})
