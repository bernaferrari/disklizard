import { describe, expect, test } from "bun:test"
import {
  benchmarkDiskSnapshotPipeline,
  formatDiskSnapshotBenchmark,
  parseDiskSnapshotBenchmarkArgs,
} from "./disk-snapshot-benchmark"

describe("desktop snapshot pipeline benchmark", () => {
  test("parses deterministic corpus and reporting options", () => {
    expect(parseDiskSnapshotBenchmarkArgs([])).toEqual({
      nodes: 100_000,
      branchingFactor: 64,
      sampleIntervalMs: 2,
      json: false,
      help: false,
    })
    expect(
      parseDiskSnapshotBenchmarkArgs([
        "--nodes",
        "4096",
        "--branching",
        "16",
        "--sample-interval-ms",
        "5",
        "--json",
      ]),
    ).toEqual({
      nodes: 4_096,
      branchingFactor: 16,
      sampleIntervalMs: 5,
      json: true,
      help: false,
    })
    expect(() => parseDiskSnapshotBenchmarkArgs(["--nodes", "0"])).toThrow("--nodes must be")
    expect(() => parseDiskSnapshotBenchmarkArgs(["--nodes", "500001"])).toThrow("--nodes must be")
    expect(() => parseDiskSnapshotBenchmarkArgs(["unexpected"])).toThrow()
  })

  test("reports a correct persist, restore, and incremental generation without performance thresholds", async () => {
    const report = await benchmarkDiskSnapshotPipeline({ nodes: 257, branchingFactor: 8, sampleIntervalMs: 1 })

    expect(report.corpus).toMatchObject({
      shape: "balanced-tree",
      nodes: 257,
      branchingFactor: 8,
      incrementalBytes: 4_096,
    })
    expect(report.corpus.directories + report.corpus.files).toBe(report.corpus.nodes)
    for (const payload of Object.values(report.payloads)) {
      expect(payload).toMatchObject({
        encoding: "ndjson-parent-index",
        schema: 8,
        format: 1,
        nodeRecords: 257,
        inventoryItemRecords: 0,
        framingRecords: 2,
      })
      expect(payload.serializedBytes).toBeGreaterThan(0)
    }
    for (const phase of Object.values(report.phases)) {
      expect(phase.wallTimeMs).toBeGreaterThanOrEqual(0)
      expect(phase.rssBeforeBytes).toBeGreaterThan(0)
      expect(phase.rssAfterBytes).toBeGreaterThan(0)
      expect(phase.observedPeakRssBytes).toBeGreaterThanOrEqual(phase.rssBeforeBytes)
      expect(phase.maxObservedEventLoopGapMs).toBeGreaterThanOrEqual(0)
    }

    const formatted = formatDiskSnapshotBenchmark(report)
    expect(formatted).toContain("DiskLizard snapshot pipeline benchmark")
    expect(formatted).toContain("checkpoint-cache-restore-and-generation-refresh")
    expect(formatted).toContain("Reporting only")
  })
})
