import { spawn } from "node:child_process"
import { parentPort, workerData } from "node:worker_threads"
import { hydrateDeveloperArtifactDirectoryIdentities, parseNativeMessage } from "./native"
import type { DiskNode, ScanProgress } from "./types"

/** URL handle so the Electron main process can spawn this worker. */
export function nativeParseWorkerHref() {
  return new URL("./native-parse-worker.ts", import.meta.url)
}

export type NativeParseWorkerRequest = {
  scannerPath: string
  requestJson: string
  platform: NodeJS.Platform
  expectedRootPath: string
  inventoryEnabled: boolean
  expectedInventoryMaxItems?: number
}

export type NativeParseWorkerMessage =
  | { type: "progress"; progress: ScanProgress }
  | { type: "done"; root: DiskNode }
  | { type: "error"; message: string }

// Protocol safety bounds mirrored from `native.ts`: each NDJSON line is
// framed and bounded individually, so a single multi-megabyte `done` result
// stays legal while unbounded output still fails fast.
const MAX_NATIVE_PROTOCOL_LINE_BYTES = 64 * 1024 * 1024
const MAX_STDERR_BYTES = 8192


// The desktop main process must never JSON.parse a multi-megabyte native
// result or walk the hydrated tree synchronously. This short-lived worker
// owns both: it drives the sidecar, frames its NDJSON stdout under the same
// protocol bounds as `scanPathNative`, and posts back an already-hydrated tree.
const request = workerData as NativeParseWorkerRequest

try {
  const child = spawn(request.scannerPath, [], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  child.stdin.end(`${request.requestJson}\n`)

  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.slice(0, MAX_STDERR_BYTES - stderr.length)
  })

  // Frame NDJSON lines exactly like `consumeNativeNdjsonChunk`: bytes
  // accumulate per line and any single line past the protocol budget fails.
  let pending: Buffer[] = []
  let pendingBytes = 0
  const stdoutLines: (string | "oversized")[] = []
  for await (const bytes of child.stdout) {
    let start = 0
    for (let index = 0; index < bytes.length; index++) {
      if (bytes[index] !== 0x0a) continue
      const piece = bytes.subarray(start, index)
      pendingBytes += piece.length
      if (pendingBytes > MAX_NATIVE_PROTOCOL_LINE_BYTES) {
        stdoutLines.push("oversized")
      } else {
        pending.push(piece)
        stdoutLines.push(Buffer.concat(pending, pendingBytes).toString("utf8"))
      }
      pending = []
      pendingBytes = 0
      start = index + 1
    }
    const rest = bytes.subarray(start)
    pending.push(rest)
    pendingBytes += rest.length
    if (pendingBytes > MAX_NATIVE_PROTOCOL_LINE_BYTES) {
      stdoutLines.push("oversized")
      break
    }
  }
  if (pendingBytes > 0) {
    if (pendingBytes > MAX_NATIVE_PROTOCOL_LINE_BYTES) stdoutLines.push("oversized")
    else stdoutLines.push(Buffer.concat(pending, pendingBytes).toString("utf8"))
  }

  const [exitCode, exitSignal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    child.once("close", (code, signal) => resolve([code, signal]))
  })

  const fail = (message: string) => {
    parentPort?.postMessage({ type: "error", message } satisfies NativeParseWorkerMessage)
  }

  let doneRoot: DiskNode | undefined
  if (stdoutLines.includes("oversized")) {
    fail("Native scanner emitted an oversized protocol line")
  } else {
    try {
      for (const line of stdoutLines as string[]) {
        if (!line) continue
        const message = parseNativeMessage(line, {
          expectedRootPath: request.expectedRootPath,
          expectedInventoryMaxItems: request.expectedInventoryMaxItems,
          requireDeclaredRootPath: true,
          inventoryEnabled: request.inventoryEnabled,
        })
        if (!message) {
          fail("Native scanner returned an invalid message")
          doneRoot = undefined
          break
        }
        if (message.type === "progress") {
          parentPort?.postMessage({ type: "progress", progress: message.progress } satisfies NativeParseWorkerMessage)
          continue
        }
        if (message.type === "done") {
          doneRoot = message.root
          continue
        }
        fail(message.message)
        doneRoot = undefined
        break
      }
    } catch {
      fail("Native scanner returned malformed UTF-8 protocol output")
      doneRoot = undefined
    }
    if (!doneRoot) {
      const detail = stderr.trim()
      fail(`Native scanner exited (${exitSignal ?? exitCode ?? "unknown"})${detail ? `: ${detail}` : ""}`)
    }
  }

  if (doneRoot) {
    // Same bounded lstat pass the in-process path performs after a `done`
    // line; the parent's abort listener tears this worker down meanwhile.
    const root = await hydrateDeveloperArtifactDirectoryIdentities(
      doneRoot,
      undefined,
      request.platform,
      request.expectedRootPath,
      request.expectedInventoryMaxItems,
    )
    parentPort?.postMessage({ type: "done", root } satisfies NativeParseWorkerMessage)
  }
} catch (error) {
  parentPort?.postMessage({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  } satisfies NativeParseWorkerMessage)
}
