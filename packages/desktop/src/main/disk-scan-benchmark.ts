import type { DiskNode, ScanOptions, ScanProgress } from "../../../disklizard/src/types"
import { scanPathWithBackend } from "./disk-scanner"
import type { DiskScanBackend, DiskScanResult } from "./disk-scanner"

export type DiskScanBenchmark = {
  targetPath: string
  backend: DiskScanBackend
  sizeMode: "physical" | "logical"
  elapsedMs: number
  files: number
  directories: number
  bytes: number
  bytesPerSecond: number
  entriesPerSecond: number
  countSource: "progress" | "tree"
}

export type DiskScanRunner = (targetPath: string, options: ScanOptions) => Promise<DiskScanResult>

export type DiskScanBenchmarkOptions = Omit<ScanOptions, "onProgress"> & {
  scan?: DiskScanRunner
  now?: () => number
  onProgress?: (progress: ScanProgress) => void
}

/**
 * Run one explicit scan and collect stable, machine-readable measurements.
 *
 * This utility does not choose a target, mutate the filesystem, or start Electron. The caller
 * must supply the path it wants measured. Scanners that emit a final progress event provide exact
 * walk counts; injected or legacy runners fall back to counting the returned visualization tree.
 */
export async function benchmarkDiskScan(
  targetPath: string,
  { scan = scanPathWithBackend, now = performance.now.bind(performance), onProgress, ...scanOptions }: DiskScanBenchmarkOptions = {},
): Promise<DiskScanBenchmark> {
  let finalProgress: ScanProgress | undefined
  const startedAt = now()
  const result = await scan(targetPath, {
    ...scanOptions,
    onProgress(progress) {
      if (progress.done) finalProgress = progress
      onProgress?.(progress)
    },
  })
  const elapsedMs = Math.max(0, now() - startedAt)
  const counts = finalProgress
    ? { files: finalProgress.filesScanned, directories: finalProgress.dirsScanned, countSource: "progress" as const }
    : { ...countTree(result.root), countSource: "tree" as const }
  const elapsedSeconds = elapsedMs / 1_000

  return {
    targetPath,
    backend: result.backend,
    sizeMode: scanOptions.sizeMode ?? "physical",
    elapsedMs,
    files: counts.files,
    directories: counts.directories,
    bytes: result.root.size,
    bytesPerSecond: elapsedSeconds > 0 ? result.root.size / elapsedSeconds : 0,
    entriesPerSecond: elapsedSeconds > 0 ? (counts.files + counts.directories) / elapsedSeconds : 0,
    countSource: counts.countSource,
  }
}

export function formatDiskScanBenchmark(result: DiskScanBenchmark) {
  return [
    "DiskLizard scan benchmark",
    `Target: ${result.targetPath}`,
    `Backend: ${result.backend}`,
    `Size mode: ${result.sizeMode}`,
    `Elapsed: ${result.elapsedMs.toFixed(1)} ms`,
    `Files: ${result.files.toLocaleString()}`,
    `Directories: ${result.directories.toLocaleString()}`,
    `Bytes: ${result.bytes.toLocaleString()} (${formatBytes(result.bytes)})`,
    `Throughput: ${formatBytes(result.bytesPerSecond)}/s · ${result.entriesPerSecond.toFixed(1)} entries/s`,
    `Counts: ${result.countSource === "progress" ? "scanner progress" : "returned tree"}`,
  ].join("\n")
}

function countTree(root: DiskNode) {
  let files = 0
  let directories = 0
  const pending = [root]

  while (pending.length > 0) {
    const node = pending.pop()
    if (!node) continue
    if (node.isDir) directories++
    if (!node.isDir) files++
    pending.push(...node.children)
  }

  return { files, directories }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 1_024) return `${Math.round(bytes)} B`
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"]
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1_024)), units.length)
  const value = bytes / 1_024 ** exponent
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[exponent - 1]}`
}
