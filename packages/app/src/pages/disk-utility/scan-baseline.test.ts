import { describe, expect, it } from "bun:test"
import { captureBaseline, compareBaselines } from "./scan-baseline"
import type { DiskScanNode } from "./types"

const GB = 1024 ** 3
function dir(path: string, children: DiskScanNode[], own = 0): DiskScanNode {
  return {
    name: path.split("/").pop() || "/",
    path,
    size: own + children.reduce((sum, child) => sum + child.size, 0),
    isDir: true,
    ext: "",
    children,
  }
}
function file(path: string, size: number): DiskScanNode {
  return { name: path.split("/").pop()!, path, size, isDir: false, ext: "", children: [] }
}

describe("scan baseline", () => {
  const before = dir("/", [
    dir("/Users", [
      dir("/Users/a", [
        dir("/Users/a/app", [file("/Users/a/app/src.bin", 2 * GB)]),
        file("/Users/a/old.iso", 6 * GB),
      ]),
    ]),
    file("/big.bin", 40 * GB),
  ])
  const after = dir("/", [
    dir("/Users", [
      dir("/Users/a", [
        dir("/Users/a/app", [
          file("/Users/a/app/src.bin", 2 * GB),
          dir("/Users/a/app/node_modules", [file("/Users/a/app/node_modules/x", 3 * GB)]),
        ]),
      ]),
    ]),
    file("/big.bin", 40 * GB),
  ])

  it("reports the deepest explaining change, not every ancestor", () => {
    const result = compareBaselines(captureBaseline(before, 1), captureBaseline(after, 2))
    const paths = result.changes.map((change) => `${change.kind} ${change.path}`)
    expect(paths).toContain("added /Users/a/app/node_modules")
    expect(paths).toContain("removed /Users/a/old.iso")
    expect(paths).not.toContain("grew /Users/a/app")
    expect(result.netBytes).toBe(-3 * GB)
    expect(result.previousAt).toBe(1)
  })

  it("stays quiet when nothing meaningful changed", () => {
    expect(compareBaselines(captureBaseline(before, 1), captureBaseline(before, 2)).changes).toEqual([])
  })
})
