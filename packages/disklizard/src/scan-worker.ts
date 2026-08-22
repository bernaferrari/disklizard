import { parentPort, workerData } from "node:worker_threads"
import { scanPathSync } from "./scan"
import type { ScanDiscovery, ScanOptions } from "./types"

type WorkerRequest = {
  targetPath: string
  maxDepth?: number
  concurrency?: number
  maxChildren?: number
  preserveNames?: string[]
  collapseNames?: string[]
  signatureNames?: string[]
  progressIntervalMs?: number
  sizeMode?: ScanOptions["sizeMode"]
  excludePaths?: string[]
}

const request = workerData as WorkerRequest
let filesScanned = 0
let dirsScanned = 0

try {
  const root = await scanPathSync(request.targetPath, {
    maxDepth: request.maxDepth,
    concurrency: request.concurrency,
    maxChildren: request.maxChildren,
    preserveNames: request.preserveNames,
    collapseNames: request.collapseNames,
    signatureNames: request.signatureNames,
    progressIntervalMs: request.progressIntervalMs,
    sizeMode: request.sizeMode,
    excludePaths: request.excludePaths,
    useWorker: false,
    onProgress: (progress) => {
      filesScanned = progress.filesScanned
      dirsScanned = progress.dirsScanned ?? dirsScanned
      parentPort?.postMessage({
        type: "progress",
        filesScanned: progress.filesScanned,
        dirsScanned: progress.dirsScanned,
        currentPath: progress.currentPath,
        size: progress.size,
        discovery: progress.discovery satisfies ScanDiscovery | undefined,
      })
    },
  })
  parentPort?.postMessage({ type: "done", root, filesScanned, dirsScanned })
} catch (error) {
  parentPort?.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  })
}
