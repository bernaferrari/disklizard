import { describe, expect, it } from "bun:test"
import { join } from "node:path"
import { ChildRetention } from "./scan-retention"
import type { DiskNode } from "./types"

function file(name: string, size: number, logicalSize = size, modifiedAt?: number): DiskNode {
  return {
    name,
    path: `/fixture/${name}`,
    size,
    ...(logicalSize === size ? {} : { logicalSize }),
    modifiedAt,
    isDir: false,
    children: [],
    ext: "",
  }
}

describe("ChildRetention", () => {
  it("keeps deterministic top-K children, preserved ancestry, and exact aggregate accounting", () => {
    const retention = new ChildRetention("/fixture", 2, new Set(["node_modules"]))
    retention.add(file("large-a.bin", 50, 60, 10))
    retention.add(file("large-b.bin", 40, 50, 20))
    retention.add(file("large-c.bin", 30, 30, 30))
    retention.add({
      name: "project",
      path: "/fixture/project",
      size: 1,
      logicalSize: 2,
      modifiedAt: 40,
      isDir: true,
      ext: "",
      children: [
        {
          name: "node_modules",
          path: "/fixture/project/node_modules",
          size: 1,
          isDir: true,
          ext: "",
          children: [],
        },
      ],
    })

    const result = retention.finish()

    expect(result).toMatchObject({ size: 121, logicalSize: 142, modifiedAt: 40 })
    expect(result.children.map((child) => child.name)).toEqual([
      "large-a.bin",
      "large-b.bin",
      "project",
      "Other (1 items)",
    ])
    expect(result.children.at(-1)).toMatchObject({
      path: join("/fixture", "__other__"),
      size: 30,
      isOther: true,
    })
  })

  it("bounds Other samples and orders equal-size entries lexically", () => {
    const retention = new ChildRetention("/fixture", 2, new Set())
    for (let index = 19; index >= 0; index--) {
      retention.add(file(`file-${String(index).padStart(2, "0")}`, 1))
    }

    const result = retention.finish()
    const other = result.children.at(-1)

    expect(result.children.slice(0, 2).map((child) => child.name)).toEqual(["file-00", "file-01"])
    expect(other).toMatchObject({ name: "Other (18 items)", size: 18 })
    expect(other?.children.map((child) => child.name)).toEqual(
      Array.from({ length: 12 }, (_, index) => `file-${String(index + 2).padStart(2, "0")}`),
    )
  })
})
