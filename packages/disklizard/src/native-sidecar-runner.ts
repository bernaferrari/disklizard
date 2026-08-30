import { spawn } from "node:child_process"
import {
  hydrateDeveloperArtifactDirectoryIdentities,
  MAX_NATIVE_PROTOCOL_LINE_BYTES,
  parseNativeMessage,
} from "./native-protocol"
import type { NativeParseWorkerRequest } from "./native-parse-worker-contract"
import type { DiskNode, ScanProgress } from "./types"

export type NativeProtocolLimits = {
  lineBytes: number
  totalStdoutBytes: number
  stderrBytes: number
}

export const DEFAULT_NATIVE_PROTOCOL_LIMITS: NativeProtocolLimits = {
  lineBytes: MAX_NATIVE_PROTOCOL_LINE_BYTES,
  // One maximum-sized tree plus a deliberately generous but finite progress budget.
  totalStdoutBytes: 96 * 1024 * 1024,
  stderrBytes: 8 * 1024,
}

type NativeSidecarHooks = {
  onProgress?: (progress: ScanProgress) => void
  signal?: AbortSignal
  /** Test seam for proving the production framer's bounds without allocating 64 MiB fixtures. */
  limits?: NativeProtocolLimits
  /** Test seam for exercising the bounded TERM -> KILL escalation. */
  terminationGraceMs?: number
  forceKillWaitMs?: number
  postExitPipeWaitMs?: number
  /** Test seam for making a completed protocol frame deliberately expensive. */
  onProtocolLineProcessed?: () => void
}

const DEFAULT_TERMINATION_GRACE_MS = 500
const DEFAULT_FORCE_KILL_WAIT_MS = 500
const DEFAULT_POST_EXIT_PIPE_WAIT_MS = 500

type ChildOutcome =
  | { type: "close"; code: number | null; signal: NodeJS.Signals | null }
  | { type: "error"; error: Error }

function errorFrom(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function normalizeLimits(value: NativeProtocolLimits | undefined): NativeProtocolLimits {
  const limits = value ?? DEFAULT_NATIVE_PROTOCOL_LIMITS
  if (
    !validLimit(limits.lineBytes) ||
    !validLimit(limits.totalStdoutBytes) ||
    !validLimit(limits.stderrBytes) ||
    limits.totalStdoutBytes < limits.lineBytes
  ) {
    throw new Error("Invalid native scanner protocol limits")
  }
  return limits
}

/**
 * Incrementally frames byte-oriented NDJSON. UTF-8 is decoded only after a
 * complete bounded line is available, so split code points remain valid and
 * malformed byte sequences fail closed.
 */
export class NativeNdjsonFramer {
  readonly #lineBytes: number
  #chunks: Buffer[] = []
  #bytes = 0

  constructor(lineBytes: number) {
    if (!validLimit(lineBytes)) throw new Error("Invalid native scanner line limit")
    this.#lineBytes = lineBytes
  }

  push(bytes: Uint8Array, onLine: (line: string) => void): void {
    const chunk = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
    let start = 0
    for (let index = 0; index < chunk.length; index++) {
      if (chunk[index] !== 0x0a) continue
      this.#append(chunk.subarray(start, index))
      this.#emit(onLine)
      start = index + 1
    }
    this.#append(chunk.subarray(start))
  }

  finish(onLine: (line: string) => void): void {
    if (this.#bytes > 0) this.#emit(onLine)
  }

  #append(bytes: Buffer): void {
    if (bytes.length === 0) return
    if (this.#bytes > this.#lineBytes - bytes.length) {
      throw new Error("Native scanner emitted an oversized protocol line")
    }
    this.#chunks.push(bytes)
    this.#bytes += bytes.length
  }

  #emit(onLine: (line: string) => void): void {
    const chunks = this.#chunks
    const bytes = this.#bytes
    this.#chunks = []
    this.#bytes = 0

    let line: string
    try {
      line = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes))
    } catch {
      throw new Error("Native scanner returned malformed UTF-8 protocol output")
    }
    onLine(line)
  }
}

/**
 * Run one untrusted native scanner process. The child lifecycle is observed
 * before stdin or stdout activity begins, progress is forwarded line by line,
 * and every protocol fault terminates the child through one failure path.
 */
export async function runNativeScannerSidecar(
  request: NativeParseWorkerRequest,
  hooks: NativeSidecarHooks = {},
): Promise<DiskNode> {
  hooks.signal?.throwIfAborted()
  const limits = normalizeLimits(hooks.limits)
  const child = spawn(request.scannerPath, [], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })

  let firstFailure: Error | undefined
  let killRequested = false
  let terminationTimer: ReturnType<typeof setTimeout> | undefined
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined
  let postExitPipeTimer: ReturnType<typeof setTimeout> | undefined
  let directChildExited = false
  let stderrBytes = 0
  const stderrChunks: Buffer[] = []

  const terminationGraceMs = Math.max(1, Math.min(hooks.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS, 30_000))
  const forceKillWaitMs = Math.max(1, Math.min(hooks.forceKillWaitMs ?? DEFAULT_FORCE_KILL_WAIT_MS, 30_000))
  const postExitPipeWaitMs = Math.max(
    1,
    Math.min(hooks.postExitPipeWaitMs ?? DEFAULT_POST_EXIT_PIPE_WAIT_MS, 30_000),
  )

  let settleForcedShutdown!: () => void
  const forcedShutdownPromise = new Promise<void>((resolve) => {
    settleForcedShutdown = resolve
  })
  const clearTerminationTimers = () => {
    if (terminationTimer) clearTimeout(terminationTimer)
    if (forceKillTimer) clearTimeout(forceKillTimer)
    if (postExitPipeTimer) clearTimeout(postExitPipeTimer)
    terminationTimer = undefined
    forceKillTimer = undefined
    postExitPipeTimer = undefined
  }
  const finishForcedShutdown = () => {
    clearTerminationTimers()
    // A descendant can inherit the scanner's pipes and keep `close`/async
    // iteration pending after the scanner itself has died. Once both bounded
    // termination attempts have elapsed, close our pipe ends and let the
    // authoritative protocol failure return independently.
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
    settleForcedShutdown()
  }
  const armPostExitPipeDeadline = () => {
    if (!directChildExited || killRequested) return
    if (postExitPipeTimer) clearTimeout(postExitPipeTimer)
    // `exit` can precede `close` while stdout is still being drained. Restart
    // the bound after every completely processed chunk so a valid large final
    // frame gets the full idle allowance after synchronous UTF-8/JSON/tree
    // validation, while an inherited descriptor still cannot hang forever.
    postExitPipeTimer = setTimeout(() => {
      failOnce(new Error("Native scanner pipes did not close after process exit"), false)
      finishForcedShutdown()
    }, postExitPipeWaitMs)
  }

  const killChild = () => {
    if (killRequested) return
    killRequested = true
    const directChildRunning = child.exitCode === null && child.signalCode === null
    if (directChildRunning) {
      try {
        child.kill("SIGTERM")
      } catch {
        // The first failure remains authoritative even if the process raced exit.
      }
    }
    const forceAndBoundPipes = () => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          // Node maps this to forceful process termination on Windows as well.
          child.kill("SIGKILL")
        } catch {
          // The bounded pipe teardown below still guarantees caller progress.
        }
      }
      // `close` waits for inherited stdio handles, so retain a second bound
      // even when the direct child has already emitted `exit`.
      forceKillTimer = setTimeout(finishForcedShutdown, forceKillWaitMs)
    }
    // An exited sidecar can leave descendants holding inherited pipes. It no
    // longer needs a TERM grace period, but the pipe teardown must still be
    // armed or a malformed-frame failure can wait forever for `close`/EOF.
    if (directChildRunning) terminationTimer = setTimeout(forceAndBoundPipes, terminationGraceMs)
    else forceAndBoundPipes()
  }
  const failOnce = (reason: unknown, kill = true) => {
    if (firstFailure) return
    firstFailure = errorFrom(reason)
    if (kill) killChild()
  }

  // Register lifecycle observers before writing the request or consuming any
  // output. A very short-lived scanner can otherwise close before it is seen.
  const outcomePromise = new Promise<ChildOutcome>((resolve) => {
    let resolved = false
    child.once("error", (error) => {
      failOnce(error, false)
      clearTerminationTimers()
      if (resolved) return
      resolved = true
      resolve({ type: "error", error })
    })
    child.once("close", (code, signal) => {
      clearTerminationTimers()
      if (resolved) return
      resolved = true
      resolve({ type: "close", code, signal })
    })
    child.once("exit", () => {
      directChildExited = true
      if (killRequested) return
      armPostExitPipeDeadline()
    })
  })

  const onAbort = () => failOnce(hooks.signal?.reason ?? new Error("Scan cancelled"))
  hooks.signal?.addEventListener("abort", onAbort, { once: true })

  child.stdin.once("error", (error) => failOnce(error))
  child.stderr.once("error", (error) => failOnce(error))
  child.stderr.on("data", (value: Buffer | Uint8Array | string) => {
    if (firstFailure) return
    const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value)
    if (stderrBytes > limits.stderrBytes - bytes.length) {
      failOnce(new Error("Native scanner emitted oversized stderr output"))
      return
    }
    stderrChunks.push(bytes)
    stderrBytes += bytes.length
  })

  let stdoutBytes = 0
  let doneRoot: DiskNode | undefined
  let doneCount = 0
  const framer = new NativeNdjsonFramer(limits.lineBytes)
  const consumeLine = (line: string) => {
    if (line.length === 0) throw new Error("Native scanner returned an invalid message")
    if (doneCount > 0) throw new Error("Native scanner emitted a message after done")
    const message = parseNativeMessage(line, {
      expectedRootPath: request.expectedRootPath,
      expectedInventoryMaxItems: request.expectedInventoryMaxItems,
      requireDeclaredRootPath: true,
      inventoryEnabled: request.inventoryEnabled,
    })
    if (!message) throw new Error("Native scanner returned an invalid message")
    if (message.type === "error") throw new Error(message.message)
    if (message.type === "progress") {
      hooks.onProgress?.(message.progress)
      return
    }
    doneCount += 1
    doneRoot = message.root
    hooks.onProtocolLineProcessed?.()
  }

  const stdoutPromise = (async () => {
    try {
      for await (const value of child.stdout) {
        if (firstFailure) break
        const bytes = Buffer.from(value)
        if (stdoutBytes > limits.totalStdoutBytes - bytes.length) {
          throw new Error("Native scanner emitted oversized total protocol output")
        }
        stdoutBytes += bytes.length
        framer.push(bytes, consumeLine)
        armPostExitPipeDeadline()
      }
      if (!firstFailure) {
        framer.finish(consumeLine)
        armPostExitPipeDeadline()
      }
    } catch (error) {
      failOnce(error)
    }
  })()

  try {
    child.stdin.end(`${request.requestJson}\n`)
    const outcome = await Promise.race([
      outcomePromise,
      forcedShutdownPromise.then(
        (): ChildOutcome => ({ type: "error", error: firstFailure ?? new Error("Native scanner failed to terminate") }),
      ),
    ])
    await Promise.race([stdoutPromise, forcedShutdownPromise])

    if (firstFailure) throw firstFailure
    if (outcome.type === "error") throw outcome.error

    const stderr = new TextDecoder("utf-8").decode(Buffer.concat(stderrChunks, stderrBytes)).trim()
    if (outcome.code !== 0 || outcome.signal !== null) {
      const status = outcome.signal ?? outcome.code ?? "unknown"
      throw new Error(`Native scanner exited (${status})${stderr ? `: ${stderr}` : ""}`)
    }
    if (doneCount !== 1 || !doneRoot) {
      throw new Error(`Native scanner exited (0)${stderr ? `: ${stderr}` : ""}`)
    }

    // Hydration remains in this worker-owned runner; the Electron main thread
    // only receives an already-materialized tree.
    const root = await hydrateDeveloperArtifactDirectoryIdentities(
      doneRoot,
      undefined,
      request.platform,
      request.expectedRootPath,
      request.expectedInventoryMaxItems,
    )
    hooks.signal?.throwIfAborted()
    return root
  } finally {
    hooks.signal?.removeEventListener("abort", onAbort)
    if (firstFailure) killChild()
    if (!killRequested) clearTerminationTimers()
  }
}
