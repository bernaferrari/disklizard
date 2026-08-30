#!/usr/bin/env bun
import { extractFile, listPackage } from "@electron/asar"
import { lstat, readdir } from "node:fs/promises"
import path from "node:path"

const REQUIRED_ARCHIVE_ENTRIES = [
  "out/main/index.js",
  "out/main/native-parse-worker.js",
  "out/preload/index.js",
  "out/renderer/index.html",
  "out/renderer/oc-theme-preload.js",
] as const

function normalizedArchivePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\/+/, "")
}

export function packagedContentViolations(input: {
  archiveEntries: readonly string[]
  filesystemEntries: readonly string[]
  mainBundle: string
  preloadBundle: string
  rendererHtml: string
}) {
  const archiveEntries = input.archiveEntries.map(normalizedArchivePath)
  const filesystemEntries = input.filesystemEntries.map(normalizedArchivePath)
  const allEntries = [...archiveEntries, ...filesystemEntries]
  const violations: string[] = []

  for (const required of REQUIRED_ARCHIVE_ENTRIES) {
    if (!archiveEntries.includes(required)) violations.push(`missing archive entry: ${required}`)
  }
  if (!filesystemEntries.some((entry) => /(^|\/)resources\/native\/disklizard-scanner(?:\.exe)?$/i.test(entry))) {
    violations.push("missing packaged native scanner")
  }

  for (const entry of allEntries) {
    if (entry.startsWith("packages/app/") || entry.startsWith("src/") || entry.startsWith("e2e/")) {
      violations.push(`first-party source leaked into package: ${entry}`)
    }
    if (entry.includes("node_modules/@disklizard/")) {
      violations.push(`bundled workspace copied as a production dependency: ${entry}`)
    }
    if (/(^|\/)native-scanner\/target(?:\/|$)/.test(entry) || /(^|\/)target\/(?:debug|release)(?:\/|$)/.test(entry)) {
      violations.push(`native build target leaked into package: ${entry}`)
    }
    if (/\.(?:ts|tsx)$/.test(entry) && /^(?:out|packages|src|e2e|node_modules\/@disklizard)\//.test(entry)) {
      violations.push(`first-party TypeScript source leaked into package: ${entry}`)
    }
    if (/^out\/renderer\/assets\/KaTeX_/i.test(entry)) {
      violations.push(`unused KaTeX asset leaked into standalone renderer: ${entry}`)
    }
  }

  const rendererScripts = archiveEntries.filter((entry) => /^out\/renderer\/assets\/[^/]+\.js$/.test(entry))
  if (rendererScripts.length !== 1 || !/^out\/renderer\/assets\/main-[^/]+\.js$/.test(rendererScripts[0] ?? "")) {
    violations.push(`standalone renderer must contain one main script; found ${rendererScripts.length}`)
  }

  for (const [name, source] of [
    ["main", input.mainBundle],
    ["preload", input.preloadBundle],
  ] as const) {
    if (source.includes("@disklizard/app")) violations.push(`${name} bundle retains a bare @disklizard/app import`)
    if (source.includes("@disklizard/core")) violations.push(`${name} bundle retains a bare @disklizard/core import`)
  }
  const themePreload = input.rendererHtml.match(
    /<script\b[^>]*\bid=["']oc-theme-preload-script["'][^>]*><\/script>/i,
  )?.[0]
  if (!themePreload || !/\bsrc=["']\.\/oc-theme-preload\.js["']/i.test(themePreload)) {
    violations.push("renderer must load the external self-hosted theme preload allowed by its CSP")
  }
  return [...new Set(violations)].sort()
}

async function findFiles(root: string, target: string, maxDepth: number) {
  const found: string[] = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      if (entry.isFile() && entry.name === target) found.push(absolute)
      if (entry.isDirectory() && depth < maxDepth) await visit(absolute, depth + 1)
    }
  }
  await visit(root, 0)
  return found.sort()
}

function packagedApplicationRoot(archivePath: string) {
  const parsed = path.parse(archivePath)
  const segments = parsed.dir.slice(parsed.root.length).split(path.sep)
  const appIndex = segments.findIndex((segment) => segment.endsWith(".app"))
  if (appIndex >= 0) return path.join(parsed.root, ...segments.slice(0, appIndex + 1))
  const unpackedIndex = segments.findIndex((segment) => segment.endsWith("-unpacked"))
  if (unpackedIndex >= 0) return path.join(parsed.root, ...segments.slice(0, unpackedIndex + 1))
  return path.dirname(path.dirname(archivePath))
}

async function applicationInventory(root: string) {
  const entries: string[] = []
  let bytes = 0
  const visit = async (current: string): Promise<void> => {
    const stat = await lstat(current)
    if (!stat.isDirectory()) {
      entries.push(path.relative(root, current))
      bytes += stat.size
      return
    }
    for (const entry of await readdir(current)) await visit(path.join(current, entry))
  }
  await visit(root)
  return { entries: entries.sort(), bytes }
}

export type PackagedBoundaryReport = {
  applicationRoot: string
  archivePath: string
  archiveEntries: number
  unpackedBytes: number
}

export async function inspectPackagedBoundary(distDirectory: string): Promise<PackagedBoundaryReport> {
  const archives = await findFiles(distDirectory, "app.asar", 6)
  if (archives.length !== 1) {
    throw new Error(`Expected exactly one packaged app.asar under ${distDirectory}; found ${archives.length}`)
  }

  const archivePath = archives[0]!
  const applicationRoot = packagedApplicationRoot(archivePath)
  const archiveEntries = listPackage(archivePath, { isPack: false }).map(normalizedArchivePath)
  const inventory = await applicationInventory(applicationRoot)
  const mainBundle = extractFile(archivePath, "out/main/index.js").toString("utf8")
  const preloadBundle = extractFile(archivePath, "out/preload/index.js").toString("utf8")
  const rendererHtml = extractFile(archivePath, "out/renderer/index.html").toString("utf8")
  const violations = packagedContentViolations({
    archiveEntries,
    filesystemEntries: inventory.entries,
    mainBundle,
    preloadBundle,
    rendererHtml,
  })
  if (violations.length > 0) {
    const displayed = violations.slice(0, 32)
    const omitted = violations.length - displayed.length
    const suffix = omitted > 0 ? `\n  - …and ${omitted} more violation${omitted === 1 ? "" : "s"}` : ""
    throw new Error(
      `Packaged DiskLizard boundary failed (${violations.length} violation${violations.length === 1 ? "" : "s"}):\n${displayed.map((item) => `  - ${item}`).join("\n")}${suffix}`,
    )
  }

  const report = {
    applicationRoot,
    archivePath,
    archiveEntries: archiveEntries.length,
    unpackedBytes: inventory.bytes,
  }
  console.log(
    `[disklizard] packaged boundary passed: ${report.archiveEntries} archive entries, ${(report.unpackedBytes / 1024 / 1024).toFixed(1)} MiB unpacked`,
  )
  return report
}

function argumentValue(name: string) {
  return process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1)
}

if (import.meta.main) {
  const desktopDirectory = path.resolve(import.meta.dir, "..")
  const distDirectory = path.resolve(argumentValue("--dist") ?? path.join(desktopDirectory, "dist-smoke"))
  await inspectPackagedBoundary(distDirectory)
}
