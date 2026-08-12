#!/usr/bin/env bun

import { stat } from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"
import { benchmarkDiskScan, formatDiskScanBenchmark } from "../src/main/disk-scan-benchmark"

const usage = `Usage: bun run benchmark:disk -- --path /absolute/or/relative/path [options]

Runs one read-only, explicit DiskLizard scan. It never starts or restarts the desktop app.

Options:
  --path <path>             Required scan target (a positional path is also accepted)
  --size-mode <mode>        physical (default) or logical
  --max-depth <number>      Visualization depth, default: 10
  --max-children <number>   Retained children per directory, default: 48
  --concurrency <number>    Scanner concurrency (uses scanner default when omitted)
  --json                    Print the report as JSON
  --help                    Show this message

Set DISKLIZARD_NATIVE_SCANNER=0 to deliberately benchmark the TypeScript fallback.`

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    path: { type: "string" },
    "size-mode": { type: "string" },
    "max-depth": { type: "string" },
    "max-children": { type: "string" },
    concurrency: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  allowPositionals: true,
})

if (values.help) {
  console.log(usage)
  process.exit(0)
}

if (values.path && positionals.length > 0) throw new Error("Pass the target with --path or as a positional argument, not both.\n\n" + usage)
if (!values.path && positionals.length > 1) throw new Error("Only one positional target path is allowed.\n\n" + usage)

const target = values.path ?? positionals[0]
if (!target) throw new Error("An explicit target path is required.\n\n" + usage)

const sizeMode = values["size-mode"] ?? "physical"
if (sizeMode !== "physical" && sizeMode !== "logical") {
  throw new Error(`--size-mode must be physical or logical, received ${sizeMode}.`)
}

const targetPath = path.resolve(target)
await stat(targetPath)

const result = await benchmarkDiskScan(targetPath, {
  sizeMode,
  maxDepth: readPositiveInteger(values["max-depth"], "--max-depth") ?? 10,
  maxChildren: readPositiveInteger(values["max-children"], "--max-children") ?? 48,
  concurrency: readPositiveInteger(values.concurrency, "--concurrency"),
})

console.log(values.json ? JSON.stringify(result, null, 2) : formatDiskScanBenchmark(result))

function readPositiveInteger(value: string | undefined, option: string) {
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer, received ${value}.`)
  return parsed
}
