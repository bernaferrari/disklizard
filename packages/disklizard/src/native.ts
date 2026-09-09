import { existsSync } from "./physical-fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import type { NativeParseWorkerMessage, NativeParseWorkerRequest } from "./native-parse-worker-contract"
import { normalizeDeveloperArtifactInventoryOptions } from "./developer-artifacts"
import { normalizeNativeScanRoot } from "./native-protocol"
import { normalizeScanOptions } from "./scan"
import type { DiskNode, ScanOptions } from "./types"

export {
  hydrateCompactTree,
  hydrateDeveloperArtifactDirectoryIdentities,
  MAX_MATERIALIZED_DISK_TREE_NODES,
  MAX_NATIVE_PROTOCOL_LINE_BYTES,
  normalizeNativeScanRoot,
  parseNativeMessage,
} from "./native-protocol"
export type { NativeDoneValidation, NativeMessage } from "./native-protocol"

type NativeRequest = {
  targetPath: string
  maxDepth: number
  concurrency?: number
  maxChildren: number
  preserveNames: string[]
  collapseNames: string[]
  signatureNames: string[]
  progressIntervalMs: number
  sizeMode: "physical" | "logical"
  excludePaths: string[]
  developerArtifactInventory?: boolean | { maxItems?: number }
}

export function nativeScannerPath() {
  const override = process.env.DISKLIZARD_SCANNER_PATH
  if (override) return override
  const binary = process.platform === "win32" ? "disklizard-scanner.exe" : "disklizard-scanner"
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  const packaged = path.join(resourcesPath ?? "", "native", binary)
  if (resourcesPath && existsSync(packaged)) return packaged
  const candidates = [
    // electron-vite emits this module into desktop/out/main. The app changes
    // cwd to the home directory, so dev sidecar lookup must be bundle-relative.
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../native", binary),
    path.resolve(process.cwd(), "native", binary),
    path.resolve(process.cwd(), "packages/desktop/native", binary),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../native-scanner/target/release", binary),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../desktop/native", binary),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

export function nativeScannerAvailable(scannerPath = nativeScannerPath()) {
  return existsSync(scannerPath)
}

function nativeParseWorkerUrl() {
  // Bun executes the TypeScript entrypoint directly in source tests. The
  // desktop build emits the worker as a sibling JavaScript Rollup entry.
  const entry = fileURLToPath(import.meta.url).endsWith(".ts") ? "./native-parse-worker.ts" : "./native-parse-worker.js"
  return new URL(entry, import.meta.url)
}

export async function scanPathNative(targetPath: string, options: ScanOptions = {}): Promise<DiskNode> {
  const normalizedOptions = normalizeScanOptions(options)
  normalizedOptions.signal?.throwIfAborted()
  // Preserve the user-selected lexical spelling while requiring the sidecar
  // to echo the exact canonical root at the protocol boundary.
  const requestedRoot = normalizeNativeScanRoot(targetPath)
  if (!requestedRoot) throw new Error("Invalid native scan target path")
  const expectedInventory = normalizeDeveloperArtifactInventoryOptions(normalizedOptions.developerArtifactInventory)
  const request: NativeRequest = {
    targetPath: requestedRoot,
    maxDepth: normalizedOptions.maxDepth ?? 10,
    concurrency: normalizedOptions.concurrency,
    maxChildren: normalizedOptions.maxChildren ?? 48,
    preserveNames: normalizedOptions.preserveNames ?? [],
    collapseNames: normalizedOptions.collapseNames ?? [],
    signatureNames: normalizedOptions.signatureNames ?? [],
    progressIntervalMs: normalizedOptions.progressIntervalMs ?? 100,
    sizeMode: normalizedOptions.sizeMode ?? "physical",
    excludePaths: normalizedOptions.excludePaths ?? [],
    ...(expectedInventory === undefined
      ? {}
      : { developerArtifactInventory: { maxItems: expectedInventory.maxItems } }),
  }

  return new Promise<DiskNode>((resolve, reject) => {
    if (normalizedOptions.signal?.aborted) {
      reject(normalizedOptions.signal.reason)
      return
    }

    const worker = new Worker(nativeParseWorkerUrl(), {
      workerData: {
        scannerPath: nativeScannerPath(),
        requestJson: JSON.stringify(request),
        platform: process.platform,
        expectedRootPath: requestedRoot,
        inventoryEnabled: expectedInventory !== undefined,
        expectedInventoryMaxItems: expectedInventory?.maxItems,
      } satisfies NativeParseWorkerRequest,
    })
    let settled = false

    const cleanup = () => normalizedOptions.signal?.removeEventListener("abort", onAbort)
    const finish = (result: { root: DiskNode } | { error: unknown }) => {
      if (settled) return
      settled = true
      cleanup()
      if ("root" in result) resolve(result.root)
      else reject(result.error)
    }
    const stopWorker = () => {
      try {
        worker.postMessage({ type: "cancel" })
      } catch {
        void worker.terminate()
        return
      }
      const force = setTimeout(() => void worker.terminate(), 1_000)
      force.unref()
      worker.once("exit", () => clearTimeout(force))
    }
    const onAbort = () => {
      stopWorker()
      finish({ error: normalizedOptions.signal?.reason ?? new Error("Scan cancelled") })
    }

    worker.on("message", (message: NativeParseWorkerMessage) => {
      if (settled) return
      if (message.type === "progress") {
        try {
          normalizedOptions.onProgress?.(message.progress)
        } catch (error) {
          stopWorker()
          finish({ error })
        }
        return
      }
      if (message.type === "done") finish({ root: message.root })
      else finish({ error: new Error(message.message) })
    })
    worker.once("error", (error) => finish({ error }))
    worker.once("exit", (code) => {
      if (!settled) finish({ error: new Error(`Native scanner exited (${code})`) })
    })

    normalizedOptions.signal?.addEventListener("abort", onAbort, { once: true })
    // Close the small race between the initial check and listener registration.
    if (normalizedOptions.signal?.aborted) onAbort()
  })
}
