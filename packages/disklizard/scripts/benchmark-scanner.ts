import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { nativeScannerAvailable, scanPathNative } from "../src/native"
import { scanPath, scanPathSync } from "../src/scan"
import type { ScanOptions } from "../src/types"

type Backend = "native" | "typescript" | "typescript-worker"

type BenchmarkResult = {
  backend: Backend
  mode: "complete" | "cancel"
  available: boolean
  outcome?: "completed" | "cancelled"
  elapsedMs?: number
  settledAfterAbortMs?: number
  filesScanned?: number
  rootSize?: number
  hostPeakRssBytes?: number
  hostRssDeltaBytes?: number
}

const scriptPath = fileURLToPath(import.meta.url)

function numericArgument(name: string, fallback: number): number {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const parsed = Number(process.argv[index + 1])
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`)
  return parsed
}

async function createFlatCorpus(root: string, entries: number) {
  await mkdir(root, { recursive: true })
  const width = String(entries).length
  for (let start = 0; start < entries; start += 256) {
    const writes: Promise<void>[] = []
    for (let index = start; index < Math.min(entries, start + 256); index++) {
      writes.push(
        writeFile(join(root, `entry-${String(index).padStart(width, "0")}.bin`), new Uint8Array([index & 0xff])),
      )
    }
    await Promise.all(writes)
  }
}

async function runScan(backend: Backend, root: string, options: ScanOptions) {
  if (backend === "native") return scanPathNative(root, options)
  if (backend === "typescript-worker") return scanPath(root, { ...options, useWorker: true })
  return scanPathSync(root, { ...options, useWorker: false })
}

async function childBenchmark(): Promise<BenchmarkResult> {
  const backend = process.argv[process.argv.indexOf("--backend") + 1] as Backend
  const mode = process.argv.includes("--cancel") ? "cancel" : "complete"
  const root = process.argv.at(-1)
  if (!root || !["native", "typescript", "typescript-worker"].includes(backend)) {
    throw new Error("invalid benchmark child arguments")
  }
  if (backend === "native" && !nativeScannerAvailable()) return { backend, mode, available: false }

  const initialRss = process.memoryUsage().rss
  let sampledPeakRss = initialRss
  const sample = setInterval(() => {
    sampledPeakRss = Math.max(sampledPeakRss, process.memoryUsage().rss)
  }, 5)
  const controller = new AbortController()
  let abortRequestedAt: number | undefined
  const cancelTimer =
    mode === "cancel"
      ? setTimeout(() => {
          abortRequestedAt = performance.now()
          controller.abort(new Error("benchmark cancellation"))
        }, 10)
      : undefined
  let filesScanned = 0
  const startedAt = performance.now()
  let outcome: BenchmarkResult["outcome"] = "completed"
  let rootSize: number | undefined
  try {
    const rootNode = await runScan(backend, root, {
      maxDepth: 2,
      maxChildren: 48,
      sizeMode: "logical",
      signal: controller.signal,
      onProgress: (progress) => {
        filesScanned = progress.filesScanned
      },
    })
    rootSize = rootNode.size
  } catch (error) {
    if (!controller.signal.aborted) throw error
    outcome = "cancelled"
  } finally {
    if (cancelTimer !== undefined) clearTimeout(cancelTimer)
    clearInterval(sample)
  }
  const finishedAt = performance.now()
  const hostPeakRssBytes = Math.max(sampledPeakRss, process.memoryUsage().rss, process.resourceUsage().maxRSS)
  return {
    backend,
    mode,
    available: true,
    outcome,
    elapsedMs: Math.round((finishedAt - startedAt) * 100) / 100,
    ...(abortRequestedAt === undefined
      ? {}
      : { settledAfterAbortMs: Math.round((finishedAt - abortRequestedAt) * 100) / 100 }),
    filesScanned,
    ...(rootSize === undefined ? {} : { rootSize }),
    hostPeakRssBytes,
    hostRssDeltaBytes: Math.max(0, hostPeakRssBytes - initialRss),
  }
}

async function runFreshProcess(backend: Backend, root: string, cancel: boolean): Promise<BenchmarkResult> {
  const child = Bun.spawn(
    [process.execPath, scriptPath, "--child", "--backend", backend, ...(cancel ? ["--cancel"] : []), root],
    { stdout: "pipe", stderr: "inherit" },
  )
  const stdout = await new Response(child.stdout).text()
  const exitCode = await child.exited
  if (exitCode !== 0) throw new Error(`${backend} benchmark child exited with code ${exitCode}`)
  return JSON.parse(stdout.trim()) as BenchmarkResult
}

async function main() {
  if (process.argv.includes("--child")) {
    console.log(JSON.stringify(await childBenchmark()))
    return
  }

  const entries = numericArgument("--entries", 25_000)
  const root = await mkdtemp(join(tmpdir(), "disklizard-benchmark-"))
  try {
    await createFlatCorpus(root, entries)
    const backends: Backend[] = ["native", "typescript-worker", "typescript"]
    const complete: BenchmarkResult[] = []
    const cancellation: BenchmarkResult[] = []
    for (const backend of backends) {
      complete.push(await runFreshProcess(backend, root, false))
      cancellation.push(await runFreshProcess(backend, root, true))
    }
    console.log(
      JSON.stringify(
        {
          corpus: { shape: "flat-files", entries, bytesPerFile: 1 },
          note: "Reporting contract only; elapsed time and host-process peak RSS have no pass/fail threshold. Native sidecar RSS is not included in its host-process figure.",
          complete,
          cancellation,
        },
        null,
        2,
      ),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

await main()
