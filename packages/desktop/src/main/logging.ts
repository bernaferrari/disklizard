import { MainLogger } from "electron-log"
import log from "electron-log/main.js"
import { app, shell } from "electron"
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs"
import { open, readdir, stat, writeFile } from "node:fs/promises"
import { ZipWriter, BlobWriter, BlobReader } from "@zip.js/zip.js"
import { dirname, join } from "node:path"
import { sanitizeDiagnosticLog, sanitizeDiagnosticText, sanitizeDiagnosticValue } from "./diagnostic-sanitizer"
import {
  createLocalDiagnosticExportAsync,
  isCurrentRunDiagnosticLog,
  type LocalDiagnosticLogCandidate,
} from "./local-diagnostics"

const MAX_LOG_AGE_DAYS = 7
const TAIL_LINES = 1000
const MAX_EXPORT_LOG_FILES = 16

let root = ""
let run = ""
let diagnosticHookInstalled = false

let logger: MainLogger
export const getLogger = () => logger

export function initLogging() {
  initRunDirectory()
  installDiagnosticSanitizer()
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.file.resolvePathFn = (_vars, message) =>
    join(
      run,
      `${safeLogName(message?.scope ?? (message?.variables?.processType === "renderer" ? "renderer" : "main"))}.log`,
    )
  log.initialize({ preload: false, spyRendererConsole: true })
  initConsoleTransport()
  cleanup()
  return (logger = log)
}

/** A user-initiated, local-only export. Nothing here is uploaded automatically. */
export async function exportDebugLogs() {
  const output = join(app.getPath("downloads"), `disklizard-debug-${stamp()}.zip`)
  write("main", "manual local debug export requested")

  const candidates = await collectCurrentRunLogs()
  const entries = (await createLocalDiagnosticExportAsync(
    {
      generatedAt: new Date().toISOString(),
      version: app.getVersion(),
      name: app.getName(),
      packaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
      nodeVersion: process.versions.node,
      uptimeSeconds: process.uptime(),
    },
    candidates,
  )).map((entry) => ({ name: entry.name, data: Buffer.from(entry.contents) }))

  await writeZip(output, entries)
  shell.showItemInFolder(output)
  return output
}

export function write(
  name: string,
  message: string,
  extra?: Record<string, unknown>,
  level: "info" | "warn" | "error" = "info",
) {
  if (!run) return
  const scoped = log.scope(safeLogName(name))
  if (extra !== undefined) {
    scoped[level](sanitizeDiagnosticText(message), sanitizeDiagnosticValue(extra))
    return
  }
  scoped[level](sanitizeDiagnosticText(message))
}

export function tail(): string {
  try {
    const path = log.transports.file.getFile().path
    const contents = readFileSync(path, "utf8")
    return sanitizeDiagnosticLog(contents, TAIL_LINES)
  } catch {
    return ""
  }
}

function initRunDirectory() {
  root = join(app.getPath("userData"), "logs")
  run = join(root, stamp())
  mkdirSync(run, { recursive: true })
}

function stamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
}

function safeLogName(name: string) {
  return name.replace(/[^a-z0-9_.-]/gi, "_") || "main"
}

function cleanup() {
  const dir = root || dirname(log.transports.file.getFile().path)
  const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000

  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry)
    try {
      const info = statSync(file)
      if (info.mtimeMs < cutoff) rmSync(file, { recursive: true, force: true })
    } catch {
      continue
    }
  }
}

type Entry = { name: string; data: Buffer }

async function collectCurrentRunLogs(): Promise<LocalDiagnosticLogCandidate[]> {
  if (!run) return []
  const result: LocalDiagnosticLogCandidate[] = []
  const entries = (await readdir(run, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))

  for (const entry of entries) {
    if (result.length >= MAX_EXPORT_LOG_FILES) break
    const file = join(run, entry.name)
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      const info = await stat(file)
      if (
        !isCurrentRunDiagnosticLog({
          name: entry.name,
          isFile: entry.isFile() && info.isFile(),
          size: info.size,
          modifiedAt: info.mtimeMs,
        })
      ) {
        continue
      }
      handle = await open(file, "r")
      const openedInfo = await handle.stat()
      if (!isCurrentRunDiagnosticLog({
        name: entry.name,
        isFile: openedInfo.isFile(),
        size: openedInfo.size,
        modifiedAt: openedInfo.mtimeMs,
      })) continue
      const data = Buffer.allocUnsafe(openedInfo.size)
      const { bytesRead } = await handle.read(data, 0, data.length, 0)
      result.push({
        name: entry.name,
        isFile: true,
        size: bytesRead,
        modifiedAt: openedInfo.mtimeMs,
        contents: new TextDecoder("utf-8", { fatal: true }).decode(data.subarray(0, bytesRead)),
      })
    } catch {
      continue
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }

  return result
}

async function writeZip(output: string, entries: Entry[]) {
  const writer = new ZipWriter(new BlobWriter("application/zip"))
  for (const entry of entries) {
    await writer.add(entry.name, new BlobReader(new Blob([new Uint8Array(entry.data)])))
  }
  const zip = await writer.close()
  await writeFile(output, Buffer.from(await zip.arrayBuffer()))
}

function installDiagnosticSanitizer() {
  if (diagnosticHookInstalled) return
  diagnosticHookInstalled = true
  log.hooks.push((message) => ({
    ...message,
    data: message.data.map((value) => sanitizeDiagnosticValue(value)),
  }))
}

function initConsoleTransport() {
  if (app.isPackaged) {
    log.transports.console.level = false
    return
  }

  const write = log.transports.console.writeFn.bind(log.transports.console)
  log.transports.console.writeFn = (options) => {
    try {
      write(options)
    } catch (err) {
      if (!isBrokenPipe(err)) throw err
      log.transports.console.level = false
    }
  }
}

function isBrokenPipe(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "EPIPE"
}
