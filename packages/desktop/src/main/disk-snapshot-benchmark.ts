import { mkdtemp, open, readFile, realpath, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"
import type ParcelWatcher from "@parcel/watcher"
import type { DiskNode, ScanOptions } from "../../../disklizard/src/types"
import { MAX_MATERIALIZED_DISK_TREE_NODES } from "./disk-tree-budget"
import { DiskSnapshotManager, diskSnapshotKey } from "./disk-snapshot"

export type DiskSnapshotBenchmarkOptions = {
  nodes?: number
  branchingFactor?: number
  sampleIntervalMs?: number
}

export type DiskSnapshotBenchmarkCliOptions = Required<DiskSnapshotBenchmarkOptions> & {
  help: boolean
  json: boolean
}

export type DiskSnapshotBenchmarkPhase = {
  wallTimeMs: number
  rssBeforeBytes: number
  rssAfterBytes: number
  observedPeakRssBytes: number
  observedPeakRssDeltaBytes: number
  eventLoopTicks: number
  maxObservedEventLoopGapMs: number
}

export type DiskSnapshotPayloadReport = {
  encoding: "ndjson-parent-index"
  schema: number
  format: number
  serializedBytes: number
  nodeRecords: number
  inventoryItemRecords: number
  framingRecords: number
}

export type DiskSnapshotBenchmarkReport = {
  corpus: {
    shape: "balanced-tree"
    nodes: number
    directories: number
    files: number
    maxDepth: number
    branchingFactor: number
    bytes: number
    incrementalPath: string
    incrementalBytes: number
  }
  phases: {
    persist: DiskSnapshotBenchmarkPhase
    restore: DiskSnapshotBenchmarkPhase
    delta: DiskSnapshotBenchmarkPhase
  }
  payloads: {
    persist: DiskSnapshotPayloadReport
    restore: DiskSnapshotPayloadReport
    delta: DiskSnapshotPayloadReport
  }
  scope: {
    persist: "scan-checkpoint-and-generation-persist"
    restore: "checkpoint-cache-restore-and-generation-refresh"
    delta: "checkpoint-cache-restore-delta-and-generation-persist"
  }
  note: string
}

type SyntheticTree = {
  root: DiskNode
  directories: number
  files: number
  maxDepth: number
  changedNode: DiskNode
}

type SnapshotMetadata = {
  schema: number
  tree: string
}

const DEFAULT_NODES = 100_000
const DEFAULT_BRANCHING_FACTOR = 64
const DEFAULT_SAMPLE_INTERVAL_MS = 2
const INCREMENTAL_BYTES = 4_096

export function parseDiskSnapshotBenchmarkArgs(args: string[]): DiskSnapshotBenchmarkCliOptions {
  const { values } = parseArgs({
    args,
    options: {
      nodes: { type: "string" },
      branching: { type: "string" },
      "sample-interval-ms": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  })
  return {
    nodes: positiveInteger(values.nodes, "--nodes", DEFAULT_NODES, MAX_MATERIALIZED_DISK_TREE_NODES),
    branchingFactor: positiveInteger(values.branching, "--branching", DEFAULT_BRANCHING_FACTOR),
    sampleIntervalMs: positiveInteger(
      values["sample-interval-ms"],
      "--sample-interval-ms",
      DEFAULT_SAMPLE_INTERVAL_MS,
    ),
    json: values.json,
    help: values.help,
  }
}

export async function benchmarkDiskSnapshotPipeline(
  options: DiskSnapshotBenchmarkOptions = {},
): Promise<DiskSnapshotBenchmarkReport> {
  const nodeCount = positiveInteger(options.nodes, "nodes", DEFAULT_NODES, MAX_MATERIALIZED_DISK_TREE_NODES)
  if (nodeCount < 2) throw new Error("nodes must be at least 2 so the incremental phase has a leaf to update")
  const branchingFactor = positiveInteger(options.branchingFactor, "branchingFactor", DEFAULT_BRANCHING_FACTOR)
  const sampleIntervalMs = positiveInteger(options.sampleIntervalMs, "sampleIntervalMs", DEFAULT_SAMPLE_INTERVAL_MS)
  const rootPath = await realpath(await mkdtemp(path.join(tmpdir(), "disklizard-snapshot-benchmark-root-")))
  const cacheDir = await realpath(await mkdtemp(path.join(tmpdir(), "disklizard-snapshot-benchmark-cache-")))
  const scanOptions = { sizeMode: "logical" as const } satisfies ScanOptions

  try {
    let synthetic: SyntheticTree | undefined = createSyntheticTree(rootPath, nodeCount, branchingFactor)
    const corpus = {
      shape: "balanced-tree" as const,
      nodes: nodeCount,
      directories: synthetic.directories,
      files: synthetic.files,
      maxDepth: synthetic.maxDepth,
      branchingFactor,
      bytes: synthetic.root.size,
      incrementalPath: synthetic.changedNode.path,
      incrementalBytes: INCREMENTAL_BYTES,
    }
    const watcher = benchmarkWatcher()

    const persistManager = new DiskSnapshotManager({
      cacheDir,
      platform: process.platform,
      watcher: watcher.api,
      scan: async (targetPath) => {
        if (!synthetic || path.resolve(targetPath) !== path.resolve(rootPath)) throw new Error("Unexpected persist scan")
        return synthetic.root
      },
    })
    const persistPhase = await measurePhase(
      () => persistManager.scan("benchmark:persist", rootPath, scanOptions, () => {}),
      sampleIntervalMs,
      (result) => {
        if (result.source !== "scan") throw new Error(`Expected scan persist, received ${result.source}`)
      },
    )
    await persistManager.stopAll()
    const persistPayload = await inspectPayload(cacheDir, rootPath, scanOptions)

    const changedNode: DiskNode = {
      ...synthetic.changedNode,
      size: synthetic.changedNode.size + INCREMENTAL_BYTES,
      modifiedAt: (synthetic.changedNode.modifiedAt ?? 0) + 1,
    }
    synthetic = undefined

    const restoreManager = new DiskSnapshotManager({
      cacheDir,
      platform: process.platform,
      watcher: watcher.api,
      scan: async () => {
        throw new Error("Restore unexpectedly fell through to a scan")
      },
    })
    const restorePhase = await measurePhase(
      () => restoreManager.scan("benchmark:restore", rootPath, scanOptions, () => {}),
      sampleIntervalMs,
      (result) => {
        if (result.source !== "snapshot") throw new Error(`Expected snapshot restore, received ${result.source}`)
        if (countTreeNodes(result.root) !== nodeCount || result.root.size !== corpus.bytes) {
          throw new Error("Restored snapshot did not match the synthetic corpus")
        }
      },
    )
    await restoreManager.stopAll()
    const restorePayload = await inspectPayload(cacheDir, rootPath, scanOptions)

    watcher.historical([{ path: changedNode.path, type: "update" }])
    const deltaManager = new DiskSnapshotManager({
      cacheDir,
      platform: process.platform,
      watcher: watcher.api,
      scan: async (targetPath) => {
        if (path.resolve(targetPath) !== path.resolve(changedNode.path)) throw new Error("Delta escaped the changed leaf")
        return changedNode
      },
    })
    const deltaPhase = await measurePhase(
      () => deltaManager.scan("benchmark:delta", rootPath, scanOptions, () => {}),
      sampleIntervalMs,
      (result) => {
        if (result.source !== "delta" || !result.changedPaths.includes(changedNode.path)) {
          throw new Error("Incremental event did not produce the expected delta")
        }
        if (result.root.size !== corpus.bytes + INCREMENTAL_BYTES || countTreeNodes(result.root) !== nodeCount) {
          throw new Error("Incremental delta did not preserve the corpus accounting")
        }
      },
    )
    await deltaManager.stopAll()
    const deltaPayload = await inspectPayload(cacheDir, rootPath, scanOptions)

    return {
      corpus,
      phases: {
        persist: persistPhase,
        restore: restorePhase,
        delta: deltaPhase,
      },
      payloads: {
        persist: persistPayload,
        restore: restorePayload,
        delta: deltaPayload,
      },
      scope: {
        persist: "scan-checkpoint-and-generation-persist",
        restore: "checkpoint-cache-restore-and-generation-refresh",
        delta: "checkpoint-cache-restore-delta-and-generation-persist",
      },
      note:
        "Reporting only: timings, observed RSS, and event-loop gaps have no pass/fail threshold. Phases share one host process, garbage collection is not forced, and sampled RSS can miss allocations while the event loop is blocked.",
    }
  } finally {
    await Promise.all([
      rm(rootPath, { recursive: true, force: true }),
      rm(cacheDir, { recursive: true, force: true }),
    ])
  }
}

export function formatDiskSnapshotBenchmark(report: DiskSnapshotBenchmarkReport) {
  const phase = (name: keyof DiskSnapshotBenchmarkReport["phases"]) => {
    const result = report.phases[name]
    const payload = report.payloads[name]
    return [
      `${name[0]!.toUpperCase()}${name.slice(1)} (${report.scope[name]}):`,
      `  Wall time: ${result.wallTimeMs.toFixed(1)} ms`,
      `  Payload: ${formatBytes(payload.serializedBytes)} (${payload.serializedBytes.toLocaleString()} bytes)`,
      `  RSS before / after / observed peak: ${formatBytes(result.rssBeforeBytes)} / ${formatBytes(result.rssAfterBytes)} / ${formatBytes(result.observedPeakRssBytes)}`,
      `  Event loop: ${result.eventLoopTicks.toLocaleString()} ticks, ${result.maxObservedEventLoopGapMs.toFixed(1)} ms max observed gap`,
    ].join("\n")
  }
  return [
    "DiskLizard snapshot pipeline benchmark",
    `Corpus: ${report.corpus.nodes.toLocaleString()} nodes (${report.corpus.directories.toLocaleString()} directories, ${report.corpus.files.toLocaleString()} files), balanced branching ${report.corpus.branchingFactor}, depth ${report.corpus.maxDepth}`,
    `Payload shape: schema ${report.payloads.persist.schema}, format ${report.payloads.persist.format} ${report.payloads.persist.encoding}; ${report.payloads.persist.nodeRecords.toLocaleString()} node records + ${report.payloads.persist.framingRecords} framing records`,
    phase("persist"),
    phase("restore"),
    phase("delta"),
    report.note,
  ].join("\n")
}

function createSyntheticTree(rootPath: string, nodeCount: number, branchingFactor: number): SyntheticTree {
  const nodes: DiskNode[] = [
    {
      name: path.basename(rootPath),
      path: rootPath,
      size: 0,
      modifiedAt: 1,
      isDir: true,
      children: [],
      ext: "",
    },
  ]
  const depths = [0]
  let directories = 1
  let maxDepth = 0
  for (let index = 1; index < nodeCount; index++) {
    const parentIndex = Math.floor((index - 1) / branchingFactor)
    const parent = nodes[parentIndex]!
    const hasChildren = index * branchingFactor + 1 < nodeCount
    const name = hasChildren ? `directory-${index}` : `file-${index}.bin`
    const node: DiskNode = {
      name,
      path: path.join(parent.path, name),
      size: hasChildren ? 0 : (index % 4_096) + 1,
      modifiedAt: index + 1,
      isDir: hasChildren,
      children: [],
      ext: hasChildren ? "" : "bin",
    }
    nodes.push(node)
    parent.children.push(node)
    const depth = depths[parentIndex]! + 1
    depths.push(depth)
    maxDepth = Math.max(maxDepth, depth)
    if (hasChildren) directories++
  }
  for (let index = nodes.length - 1; index > 0; index--) {
    const node = nodes[index]!
    if (!node.isDir) continue
    node.size = node.children.reduce((total, child) => total + child.size, 0)
  }
  nodes[0]!.size = nodes[0]!.children.reduce((total, child) => total + child.size, 0)
  return {
    root: nodes[0]!,
    directories,
    files: nodeCount - directories,
    maxDepth,
    changedNode: nodes.at(-1)!,
  }
}

function benchmarkWatcher() {
  let events: ParcelWatcher.Event[] = []
  return {
    api: {
      async writeSnapshot(_directory: string, snapshot: string) {
        await writeFile(snapshot, "benchmark-checkpoint")
        return snapshot
      },
      async getEventsSince() {
        return events.splice(0)
      },
      async subscribe(_directory: string, _callback: ParcelWatcher.SubscribeCallback) {
        return { async unsubscribe() {} }
      },
    },
    historical(next: ParcelWatcher.Event[]) {
      events = next
    },
  }
}

async function measurePhase<T>(operation: () => Promise<T>, sampleIntervalMs: number, verify: (value: T) => void) {
  const rssBeforeBytes = process.memoryUsage().rss
  let observedPeakRssBytes = rssBeforeBytes
  let eventLoopTicks = 0
  let maxObservedEventLoopGapMs = 0
  const startedAt = performance.now()
  let lastObservation = startedAt
  const observe = () => {
    const now = performance.now()
    maxObservedEventLoopGapMs = Math.max(maxObservedEventLoopGapMs, now - lastObservation)
    lastObservation = now
    observedPeakRssBytes = Math.max(observedPeakRssBytes, process.memoryUsage().rss)
    eventLoopTicks++
  }
  const sampler = setInterval(observe, sampleIntervalMs)
  try {
    const value = await operation()
    const finishedAt = performance.now()
    maxObservedEventLoopGapMs = Math.max(maxObservedEventLoopGapMs, finishedAt - lastObservation)
    observedPeakRssBytes = Math.max(observedPeakRssBytes, process.memoryUsage().rss)
    const rssAfterBytes = process.memoryUsage().rss
    clearInterval(sampler)
    verify(value)
    return {
      wallTimeMs: finishedAt - startedAt,
      rssBeforeBytes,
      rssAfterBytes,
      observedPeakRssBytes: Math.max(observedPeakRssBytes, rssAfterBytes),
      observedPeakRssDeltaBytes: Math.max(0, observedPeakRssBytes - rssBeforeBytes, rssAfterBytes - rssBeforeBytes),
      eventLoopTicks,
      maxObservedEventLoopGapMs,
    }
  } finally {
    clearInterval(sampler)
  }
}

async function inspectPayload(cacheDir: string, rootPath: string, options: ScanOptions): Promise<DiskSnapshotPayloadReport> {
  const snapshotDir = path.join(cacheDir, diskSnapshotKey(rootPath, options))
  const metadata = JSON.parse(await readFile(path.join(snapshotDir, "metadata.json"), "utf8")) as SnapshotMetadata
  const treePath = path.join(snapshotDir, metadata.tree)
  const treeInfo = await stat(treePath)
  const file = await open(treePath, "r")
  try {
    const head = Buffer.alloc(Math.min(256, treeInfo.size))
    await file.read(head, 0, head.length, 0)
    const tail = Buffer.alloc(Math.min(512, treeInfo.size))
    await file.read(tail, 0, tail.length, Math.max(0, treeInfo.size - tail.length))
    const header = JSON.parse(head.toString("utf8").split("\n", 1)[0]!) as { type?: string; format?: number }
    const footerLine = tail.toString("utf8").trimEnd().split("\n").at(-1)
    const footer = JSON.parse(footerLine ?? "null") as { type?: string; nodes?: number; inventoryItems?: number }
    if (header.type !== "disklizard-tree" || footer.type !== "end") throw new Error("Unexpected snapshot payload framing")
    if (!Number.isSafeInteger(footer.nodes) || footer.nodes! < 1 || !Number.isSafeInteger(footer.inventoryItems)) {
      throw new Error("Unexpected snapshot payload counts")
    }
    return {
      encoding: "ndjson-parent-index",
      schema: metadata.schema,
      format: header.format ?? 0,
      serializedBytes: treeInfo.size,
      nodeRecords: footer.nodes!,
      inventoryItemRecords: footer.inventoryItems!,
      framingRecords: footer.inventoryItems! > 0 ? 3 : 2,
    }
  } finally {
    await file.close()
  }
}

function countTreeNodes(root: DiskNode) {
  let count = 0
  const pending = [root]
  while (pending.length > 0) {
    const node = pending.pop()!
    count++
    for (const child of node.children) pending.push(child)
  }
  return count
}

function positiveInteger(value: number | string | undefined, name: string, fallback: number, maximum?: number) {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || (maximum !== undefined && parsed > maximum)) {
    const range = maximum === undefined ? "a positive integer" : `an integer from 1 to ${maximum}`
    throw new Error(`${name} must be ${range}`)
  }
  return parsed
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${Math.round(bytes)} B`
  const units = ["KiB", "MiB", "GiB", "TiB"]
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1_024)), units.length)
  const value = bytes / 1_024 ** exponent
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[exponent - 1]}`
}
