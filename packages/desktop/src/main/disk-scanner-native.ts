import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { createInterface } from "node:readline"
import type { DiskNode, ScanOptions, ScanProgress } from "../../../disklizard/src/types"

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
}

type NativeMessage =
  | { type: "progress"; progress: ScanProgress }
  | { type: "done"; root: DiskNode }
  | { type: "error"; message: string }

type CompactNode = {
  n: string
  s: number
  l?: number
  m?: number
  h?: "primary" | "secondary"
  d?: boolean
  c?: CompactNode[]
  o?: boolean
  x?: boolean
  g?: string[]
  q?: DiskNode["scanIssues"]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isDiskNode(value: unknown): value is DiskNode {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.path === "string" &&
    typeof value.size === "number" &&
    typeof value.isDir === "boolean" &&
    Array.isArray(value.children) &&
    typeof value.ext === "string"
  )
}

function isCompactNode(value: unknown): value is CompactNode {
  return (
    isRecord(value) &&
    typeof value.n === "string" &&
    typeof value.s === "number" &&
    (value.c === undefined || Array.isArray(value.c))
  )
}

function extension(name: string) {
  if (name.startsWith(".")) return ""
  const dot = name.lastIndexOf(".")
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ""
}

/** Expand path prefixes once, after the compact native payload crosses IPC. */
export function hydrateCompactTree(rootPath: string, compact: CompactNode): DiskNode {
  const hydrate = (node: CompactNode, nodePath: string): DiskNode => ({
    name: node.n,
    path: nodePath,
    size: node.s,
    ...(node.l === undefined ? {} : { logicalSize: node.l }),
    ...(node.m === undefined ? {} : { modifiedAt: node.m }),
    ...(node.h === undefined ? {} : { hardLink: node.h }),
    isDir: node.d === true,
    children: (node.c ?? []).map((child) =>
      hydrate(child, path.join(nodePath, child.o ? "__other__" : child.n)),
    ),
    ext: node.d ? "" : extension(node.n),
    ...(node.o ? { isOther: true } : {}),
    ...(node.x ? { isCollapsed: true } : {}),
    ...(node.g ? { signatures: node.g } : {}),
    ...(node.q ? { scanIssues: node.q } : {}),
  })
  return hydrate(compact, rootPath)
}

function isScanProgress(value: unknown): value is ScanProgress {
  return (
    isRecord(value) &&
    typeof value.filesScanned === "number" &&
    typeof value.dirsScanned === "number" &&
    typeof value.currentPath === "string" &&
    typeof value.size === "number"
  )
}

export function parseNativeMessage(line: string): NativeMessage | undefined {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(value) || typeof value.type !== "string") return undefined
  if (value.type === "error" && typeof value.message === "string") {
    return { type: "error", message: value.message }
  }
  if (value.type === "done" && isDiskNode(value.root)) return { type: "done", root: value.root }
  if (
    value.type === "done" &&
    value.protocol === 2 &&
    typeof value.rootPath === "string" &&
    isCompactNode(value.root)
  ) {
    try {
      return { type: "done", root: hydrateCompactTree(value.rootPath, value.root) }
    } catch {
      return undefined
    }
  }
  if (value.type === "progress" && isScanProgress(value.progress)) {
    return { type: "progress", progress: value.progress }
  }
  return undefined
}

export function nativeScannerPath() {
  const override = process.env.DISKLIZARD_SCANNER_PATH
  if (override) return override
  const binary = process.platform === "win32" ? "disklizard-scanner.exe" : "disklizard-scanner"
  const packaged = path.join(process.resourcesPath ?? "", "native", binary)
  if (process.resourcesPath && existsSync(packaged)) return packaged
  return path.resolve(process.cwd(), "native", binary)
}

export async function scanPathNative(targetPath: string, options: ScanOptions = {}): Promise<DiskNode> {
  options.signal?.throwIfAborted()
  const request: NativeRequest = {
    targetPath,
    maxDepth: options.maxDepth ?? 10,
    concurrency: options.concurrency,
    maxChildren: options.maxChildren ?? 48,
    preserveNames: options.preserveNames ?? [],
    collapseNames: options.collapseNames ?? [],
    signatureNames: options.signatureNames ?? [],
    progressIntervalMs: options.progressIntervalMs ?? 100,
    sizeMode: options.sizeMode ?? "physical",
    excludePaths: options.excludePaths ?? [],
  }

  return new Promise((resolve, reject) => {
    const child = spawn(nativeScannerPath(), [], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    let settled = false
    let stderr = ""

    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort)
      lines.close()
    }
    const finish = (result: { root: DiskNode } | { error: unknown }) => {
      if (settled) return
      settled = true
      cleanup()
      if ("root" in result) resolve(result.root)
      else reject(result.error)
    }
    const onAbort = () => {
      child.kill()
      finish({ error: options.signal?.reason ?? new Error("Scan cancelled") })
    }

    options.signal?.addEventListener("abort", onAbort, { once: true })
    if (options.signal?.aborted) {
      onAbort()
      return
    }

    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 8192) stderr += chunk.slice(0, 8192 - stderr.length)
    })
    lines.on("line", (line) => {
      if (settled) return
      const message = parseNativeMessage(line)
      if (!message) {
        child.kill()
        finish({ error: new Error("Native scanner returned an invalid message") })
        return
      }
      if (message.type === "progress") {
        options.onProgress?.(message.progress)
        return
      }
      if (message.type === "done") {
        finish({ root: message.root })
        return
      }
      finish({ error: new Error(message.message) })
    })
    child.once("error", (error) => finish({ error }))
    child.once("close", (code, signal) => {
      if (settled) return
      const detail = stderr.trim()
      const suffix = detail ? `: ${detail}` : ""
      finish({ error: new Error(`Native scanner exited (${signal ?? code ?? "unknown"})${suffix}`) })
    })

    child.stdin.end(`${JSON.stringify(request)}\n`)
  })
}
