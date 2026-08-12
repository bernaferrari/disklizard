import { describe, expect, test } from "bun:test"
import type { DiskNode } from "../../../disklizard/src/types"
import { benchmarkDiskScan, formatDiskScanBenchmark } from "./disk-scan-benchmark"

const root: DiskNode = {
  name: "workspace",
  path: "/workspace",
  size: 3_072,
  isDir: true,
  ext: "",
  children: [
    {
      name: "src",
      path: "/workspace/src",
      size: 2_048,
      isDir: true,
      ext: "",
      children: [
        {
          name: "main.ts",
          path: "/workspace/src/main.ts",
          size: 2_048,
          isDir: false,
          ext: "ts",
          children: [],
        },
      ],
    },
    {
      name: "README.md",
      path: "/workspace/README.md",
      size: 1_024,
      isDir: false,
      ext: "md",
      children: [],
    },
  ],
}

describe("DiskLizard scan benchmark", () => {
  test("uses completed scanner progress for exact walk counts and reports the native backend", async () => {
    const ticks = [50, 1_550]
    const result = await benchmarkDiskScan("/workspace", {
      now: () => ticks.shift() ?? 1_550,
      scan: async (_target, options) => {
        options.onProgress?.({ filesScanned: 2, dirsScanned: 2, currentPath: "/workspace/src", size: 2_048 })
        options.onProgress?.({ filesScanned: 7, dirsScanned: 4, currentPath: "/workspace", size: 3_072, done: true })
        return { root, backend: "native" }
      },
    })

    expect(result).toMatchObject({
      targetPath: "/workspace",
      backend: "native",
      sizeMode: "physical",
      elapsedMs: 1_500,
      files: 7,
      directories: 4,
      bytes: 3_072,
      bytesPerSecond: 2_048,
      entriesPerSecond: 22 / 3,
      countSource: "progress",
    })
  })

  test("counts the returned tree when a runner does not emit a final progress event", async () => {
    const result = await benchmarkDiskScan("/workspace", {
      sizeMode: "logical",
      now: (() => {
        const ticks = [0, 500]
        return () => ticks.shift() ?? 500
      })(),
      scan: async () => ({ root, backend: "typescript-fallback" }),
    })

    expect(result).toMatchObject({
      backend: "typescript-fallback",
      sizeMode: "logical",
      files: 2,
      directories: 2,
      bytes: 3_072,
      bytesPerSecond: 6_144,
      entriesPerSecond: 8,
      countSource: "tree",
    })
    expect(formatDiskScanBenchmark(result)).toContain("Backend: typescript-fallback")
    expect(formatDiskScanBenchmark(result)).toContain("Throughput: 6.0 KiB/s")
  })
})
