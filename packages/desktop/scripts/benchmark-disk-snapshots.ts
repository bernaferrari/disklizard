#!/usr/bin/env bun

import {
  benchmarkDiskSnapshotPipeline,
  formatDiskSnapshotBenchmark,
  parseDiskSnapshotBenchmarkArgs,
} from "../src/main/disk-snapshot-benchmark"

const usage = `Usage: bun run benchmark:snapshots -- [options]

Runs the desktop snapshot pipeline against a deterministic synthetic tree.
It creates and removes temporary cache/checkpoint directories and does not scan user data.

Options:
  --nodes <number>              Total synthetic nodes, default: 100000
  --branching <number>          Maximum children per directory, default: 64
  --sample-interval-ms <number> RSS/event-loop sampling interval, default: 2
  --json                        Print the report as JSON
  --help                        Show this message

This benchmark is reporting-only. Timing, memory, and responsiveness values have no pass/fail thresholds.`

const options = parseDiskSnapshotBenchmarkArgs(Bun.argv.slice(2))
if (options.help) {
  console.log(usage)
  process.exit(0)
}

const report = await benchmarkDiskSnapshotPipeline(options)
console.log(options.json ? JSON.stringify(report, null, 2) : formatDiskSnapshotBenchmark(report))
