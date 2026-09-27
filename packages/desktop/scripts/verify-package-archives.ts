#!/usr/bin/env bun
import { listPackage } from "@electron/asar"
import { DOMParser } from "@xmldom/xmldom"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"

import { APP_IDS, APP_NAMES } from "../src/main/product-identity"

const REQUIRED_ASAR_RUNTIME = [
  "out/main/index.js",
  "out/main/native-parse-worker.js",
  "out/preload/index.js",
  "out/renderer/index.html",
  "out/renderer/oc-theme-preload.js",
] as const

const COMMAND_TIMEOUT_MS = 2 * 60 * 1000
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024
const MAX_EXPANDED_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_EXTRACTED_ENTRIES = 30_000
const MAX_EXTRACTED_DEPTH = 32
const MAX_COMMAND_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_METADATA_BYTES = 1024 * 1024
const MAX_CONTROL_ARCHIVE_BYTES = 16 * 1024 * 1024

export type PackageArchiveIdentity = {
  appId: string
  productName: string
}

export type PackageArchiveFormat = "dmg" | "deb" | "rpm"

export type PackageArchiveInspection = {
  format: PackageArchiveFormat
  application: string
  executable: true
  appAsar: true
  nativeScanner: true
  identityMetadata: true
  desktopFile: string | null
  metainfo: string | null
}

export type PackageArchiveEvidence = {
  schemaVersion: 2
  platform: "darwin" | "linux"
  identity: PackageArchiveIdentity
  packages: Array<PackageArchiveInspection & { artifact: string; artifactBytes: number; sha512: string }>
}

export type LinuxPackageIdentity = {
  name: string
  version: string
  architecture: string
}

export type LinuxPackageExpectation = {
  packageName: string
  version: string
  architecture: NodeJS.Architecture
}

export const SAFE_LINUX_PACKAGE_SCRIPT =
  "#!/bin/sh\n# DiskLizard packages intentionally have no install-time mutation.\nexit 0\n"

type CommandOptions = {
  cwd?: string
  stdinFile?: string
  stdoutFile?: string
  maxStdoutBytes?: number
}

type CommandRunner = (command: string, args: string[], options?: CommandOptions) => Promise<Buffer>

function expectedLinuxArchitecture(format: "deb" | "rpm", architecture: NodeJS.Architecture) {
  const architectures: Partial<Record<NodeJS.Architecture, { deb: string; rpm: string }>> = {
    x64: { deb: "amd64", rpm: "x86_64" },
    arm64: { deb: "arm64", rpm: "aarch64" },
    ia32: { deb: "i386", rpm: "i686" },
    arm: { deb: "armhf", rpm: "armv7hl" },
  }
  const expected = architectures[architecture]?.[format]
  if (!expected) throw new Error(`Unsupported Linux package architecture: ${architecture}`)
  return expected
}

export function assertLinuxPackageIdentity(
  format: "deb" | "rpm",
  actual: LinuxPackageIdentity,
  expected: LinuxPackageExpectation,
) {
  if (
    actual.name !== expected.packageName ||
    actual.version !== expected.version ||
    actual.architecture !== expectedLinuxArchitecture(format, expected.architecture)
  ) {
    throw new Error(`${format} package identity does not match the frozen DiskLizard build`)
  }
}

export function assertSafePackageScriptlets(format: "deb" | "rpm", scripts: Readonly<Record<string, string>>) {
  for (const [name, source] of Object.entries(scripts)) {
    const normalized = source.replaceAll("\r\n", "\n").trimEnd()
    if (normalized.length === 0 || normalized === "(none)") continue
    if (`${normalized}\n` !== SAFE_LINUX_PACKAGE_SCRIPT) {
      throw new Error(`${format} package contains an unsafe install script: ${name}`)
    }
  }
}

export function parseDebianPackageIdentity(control: string): LinuxPackageIdentity {
  const fields = new Map<string, string>()
  let currentField: string | undefined
  let paragraphEnded = false
  for (const line of control.replaceAll("\r\n", "\n").split("\n")) {
    if (line.length === 0) {
      if (fields.size > 0) paragraphEnded = true
      continue
    }
    if (paragraphEnded) throw new Error("deb package metadata contains multiple paragraphs")
    if (/^[ \t]/.test(line)) {
      if (!currentField) throw new Error("deb package metadata contains an orphaned continuation")
      fields.set(currentField, `${fields.get(currentField)!}\n${line.slice(1)}`)
      continue
    }
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9-]*):[ \t]*(.*)$/)
    if (!match) throw new Error("deb package metadata contains an invalid field")
    currentField = match[1]!
    if (fields.has(currentField)) throw new Error(`deb package metadata contains a duplicate ${currentField} field`)
    fields.set(currentField, match[2]!)
  }
  const name = fields.get("Package")
  const version = fields.get("Version")
  const architecture = fields.get("Architecture")
  if (!name || !version || !architecture || [name, version, architecture].some((value) => /\s/.test(value))) {
    throw new Error("deb package metadata is incomplete")
  }
  return { name, version, architecture }
}

export function parseRpmPackageIdentity(query: string): LinuxPackageIdentity {
  const lines = query.replaceAll("\r\n", "\n").trimEnd().split("\n")
  if (lines.length !== 3 || lines.some((line) => line.length === 0 || /\s/.test(line))) {
    throw new Error("rpm package metadata is invalid")
  }
  return { name: lines[0]!, version: lines[1]!, architecture: lines[2]! }
}

function normalizedArchivePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+/, "")
}

function cleanCommandError(value: Buffer) {
  const text = value.toString("utf8").replaceAll(/\s+/g, " ").trim()
  return text.length > 0 ? `: ${text.slice(0, 512)}` : ""
}

async function runCommand(command: string, args: string[], options: CommandOptions = {}) {
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  const maxStdoutBytes = options.maxStdoutBytes ?? MAX_COMMAND_OUTPUT_BYTES
  const output = options.stdoutFile ? await open(options.stdoutFile, "wx", 0o600) : undefined
  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: [options.stdinFile ? "pipe" : "ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  const childStdout = child.stdout!
  const childStderr = child.stderr!
  let stdoutBytes = 0
  let stderrBytes = 0
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, COMMAND_TIMEOUT_MS)

  const completion = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => resolve({ code, signal }))
  })

  const consumeStdout = async () => {
    for await (const value of childStdout) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      stdoutBytes += chunk.length
      if (stdoutBytes > maxStdoutBytes) throw new Error(`${command} produced oversized output`)
      if (output) await output.write(chunk)
      else stdoutChunks.push(chunk)
    }
  }

  const consumeStderr = async () => {
    for await (const value of childStderr) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      stderrBytes += chunk.length
      if (stderrBytes > MAX_COMMAND_OUTPUT_BYTES) throw new Error(`${command} produced oversized error output`)
      stderrChunks.push(chunk)
    }
  }

  const provideStdin = async () => {
    if (!options.stdinFile || !child.stdin) return
    await pipeline(createReadStream(options.stdinFile), child.stdin)
  }

  try {
    const [, , , result] = await Promise.all([consumeStdout(), consumeStderr(), provideStdin(), completion])
    if (timedOut) throw new Error(`${command} timed out`)
    if (result.code !== 0) {
      throw new Error(
        `${command} failed with ${result.code === null ? `signal ${result.signal ?? "unknown"}` : `exit ${result.code}`}${cleanCommandError(Buffer.concat(stderrChunks))}`,
      )
    }
    return Buffer.concat(stdoutChunks)
  } catch (error) {
    child.kill("SIGKILL")
    await completion.catch(() => undefined)
    throw error
  } finally {
    clearTimeout(timer)
    await output?.close()
  }
}

async function assertArtifact(artifact: string) {
  const metadata = await lstat(artifact)
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Package artifact is not a regular file: ${path.basename(artifact)}`)
  }
  if (metadata.size <= 0 || metadata.size > MAX_ARTIFACT_BYTES) {
    throw new Error(`Package artifact has an unsafe size: ${path.basename(artifact)}`)
  }
  return metadata.size
}

async function describeArtifact(artifact: string) {
  const expectedBytes = await assertArtifact(artifact)
  const digest = createHash("sha512")
  let artifactBytes = 0
  for await (const value of createReadStream(artifact)) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
    artifactBytes += chunk.length
    if (artifactBytes > MAX_ARTIFACT_BYTES) throw new Error(`Package artifact grew beyond the safe size limit`)
    digest.update(chunk)
  }
  if (artifactBytes !== expectedBytes) throw new Error(`Package artifact changed while it was being inspected`)
  return { artifactBytes, sha512: digest.digest("hex") }
}

async function assertRegularFile(target: string, description: string, executable = false) {
  const metadata = await lstat(target).catch(() => undefined)
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Expected ${description} to be a regular file`)
  }
  if (metadata.size <= 0) throw new Error(`Expected ${description} to be non-empty`)
  if (executable && process.platform !== "win32" && (metadata.mode & 0o111) === 0) {
    throw new Error(`Expected ${description} to be executable`)
  }
}

async function readBoundedUtf8(target: string, description: string) {
  const metadata = await lstat(target)
  if (metadata.size > MAX_METADATA_BYTES) throw new Error(`${description} is oversized`)
  return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(target))
}

export async function readPlistBundleIdentifier(target: string, execute: CommandRunner = runCommand) {
  const output = await execute("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", target], {
    maxStdoutBytes: MAX_METADATA_BYTES,
  })
  const identifier = new TextDecoder("utf-8", { fatal: true }).decode(output).trim()
  if (identifier.length === 0 || identifier.includes("\0") || identifier.includes("\n") || identifier.includes("\r")) {
    throw new Error("DMG Info.plist returned an invalid bundle identity")
  }
  return identifier
}

function assertAsarRuntime(archivePath: string) {
  const entries = new Set(listPackage(archivePath, { isPack: false }).map(normalizedArchivePath))
  for (const required of REQUIRED_ASAR_RUNTIME) {
    if (!entries.has(required)) throw new Error(`Packaged app.asar is missing runtime entry ${required}`)
  }
}

async function assertExtractedBounds(root: string) {
  let entries = 0
  let logicalBytes = 0
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_EXTRACTED_DEPTH) throw new Error("Extracted package exceeds the directory depth limit")
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      entries += 1
      if (entries > MAX_EXTRACTED_ENTRIES) throw new Error("Extracted package exceeds the entry limit")
      const target = path.join(directory, entry.name)
      const metadata = await lstat(target)
      logicalBytes += metadata.size
      if (logicalBytes > MAX_EXPANDED_ARCHIVE_BYTES) throw new Error("Extracted package exceeds the byte limit")
      if (metadata.isDirectory()) await visit(target, depth + 1)
    }
  }
  await visit(root, 0)
}

export async function inspectMountedDmg(
  mountRoot: string,
  identity: PackageArchiveIdentity,
  readBundleIdentifier: (target: string) => Promise<string> = readPlistBundleIdentifier,
): Promise<PackageArchiveInspection> {
  await assertExtractedBounds(mountRoot)
  const applications = (await readdir(mountRoot, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && entry.name.endsWith(".app"),
  )
  if (applications.length !== 1 || applications[0]!.name !== `${identity.productName}.app`) {
    throw new Error(`DMG must contain exactly one application named ${identity.productName}.app`)
  }
  const application = path.join(mountRoot, applications[0]!.name)
  const executable = path.join(application, "Contents", "MacOS", identity.productName)
  const infoPlist = path.join(application, "Contents", "Info.plist")
  const appAsar = path.join(application, "Contents", "Resources", "app.asar")
  const nativeScanner = path.join(application, "Contents", "Resources", "native", "disklizard-scanner")
  await assertRegularFile(executable, "DMG application executable", true)
  await assertRegularFile(infoPlist, "DMG Info.plist")
  await assertRegularFile(appAsar, "DMG app.asar")
  await assertRegularFile(nativeScanner, "DMG native scanner", true)
  assertAsarRuntime(appAsar)
  if ((await readBundleIdentifier(infoPlist)) !== identity.appId) {
    throw new Error(`DMG bundle identity does not match ${identity.appId}`)
  }
  return {
    format: "dmg",
    application: applications[0]!.name,
    executable: true,
    appAsar: true,
    nativeScanner: true,
    identityMetadata: true,
    desktopFile: null,
    metainfo: null,
  }
}

function parseDesktopEntry(text: string, format: "deb" | "rpm") {
  const groups = new Map<string, Map<string, string>>()
  let current: Map<string, string> | undefined
  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.trim()
    if (line.length === 0 || line.startsWith("#")) continue
    const group = line.match(/^\[([^\]]+)\]$/)
    if (group) {
      const name = group[1]!
      if (groups.has(name)) throw new Error(`${format} desktop file contains a duplicate ${name} group`)
      current = new Map()
      groups.set(name, current)
      continue
    }
    if (!current) throw new Error(`${format} desktop file has a value outside a group`)
    const separator = sourceLine.indexOf("=")
    if (separator <= 0) throw new Error(`${format} desktop file contains an invalid entry`)
    const key = sourceLine.slice(0, separator).trim()
    const value = sourceLine.slice(separator + 1)
    if (!/^[A-Za-z][A-Za-z0-9-]*(?:\[[^\]\r\n]+\])?$/.test(key)) {
      throw new Error(`${format} desktop file contains an invalid key`)
    }
    if (current.has(key)) throw new Error(`${format} desktop file contains a duplicate ${key} entry`)
    current.set(key, value)
  }
  const desktop = groups.get("Desktop Entry")
  if (!desktop) throw new Error(`${format} desktop file has no Desktop Entry group`)
  return desktop
}

export function assertDesktopEntryIdentity(
  text: string,
  identity: PackageArchiveIdentity,
  format: "deb" | "rpm",
) {
  const desktop = parseDesktopEntry(text, format)
  const exec = desktop.get("Exec")
  const executable = exec?.match(/^(?:"([^"\r\n]+)"|([^\s\r\n]+))(?:\s|$)/)
  const expectedExecutable = `/opt/${identity.productName}/${identity.appId}`
  if ((executable?.[1] ?? executable?.[2]) !== expectedExecutable) {
    throw new Error(`${format} Desktop Entry does not launch the verified executable`)
  }
  if (desktop.get("StartupWMClass") !== identity.appId) {
    throw new Error(`${format} Desktop Entry does not identify ${identity.appId}`)
  }
}

function directElements(parent: Element, name: string) {
  const matches: Element[] = []
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index)
    if (child?.nodeType === 1 && (child as Element).tagName === name) matches.push(child as Element)
  }
  return matches
}

export function assertMetainfoIdentity(
  text: string,
  identity: PackageArchiveIdentity,
  format: "deb" | "rpm",
) {
  if (/<!DOCTYPE/i.test(text)) throw new Error(`${format} metainfo must not contain a document type`)
  const errors: string[] = []
  const document = new DOMParser({
    onError: (_level, message) => {
      errors.push(String(message))
    },
  }).parseFromString(text, "application/xml")
  const component = document.documentElement
  if (errors.length > 0 || component?.tagName !== "component") {
    throw new Error(`${format} metainfo is not a valid component document`)
  }
  const ids = directElements(component, "id")
  const launchables = directElements(component, "launchable").filter(
    (entry) => entry.getAttribute("type") === "desktop-id",
  )
  if (ids.length !== 1 || ids[0]!.textContent?.trim() !== identity.appId) {
    throw new Error(`${format} metainfo does not identify ${identity.appId}`)
  }
  if (launchables.length !== 1 || launchables[0]!.textContent?.trim() !== `${identity.appId}.desktop`) {
    throw new Error(`${format} metainfo does not identify the verified desktop entry`)
  }
}

export async function inspectExtractedLinuxPackage(
  root: string,
  format: "deb" | "rpm",
  identity: PackageArchiveIdentity,
): Promise<PackageArchiveInspection> {
  await assertExtractedBounds(root)
  const applicationRelative = path.join("opt", identity.productName)
  const application = path.join(root, applicationRelative)
  const executable = path.join(application, identity.appId)
  const appAsar = path.join(application, "resources", "app.asar")
  const nativeScanner = path.join(application, "resources", "native", "disklizard-scanner")
  const desktopRelative = path.join("usr", "share", "applications", `${identity.appId}.desktop`)
  const metainfoRelative = path.join("usr", "share", "metainfo", `${identity.appId}.metainfo.xml`)
  const desktopFile = path.join(root, desktopRelative)
  const metainfo = path.join(root, metainfoRelative)
  await assertRegularFile(executable, `${format} application executable`, true)
  await assertRegularFile(appAsar, `${format} app.asar`)
  await assertRegularFile(nativeScanner, `${format} native scanner`, true)
  await assertRegularFile(desktopFile, `${format} desktop file`)
  await assertRegularFile(metainfo, `${format} metainfo`)
  assertAsarRuntime(appAsar)

  const desktopText = await readBoundedUtf8(desktopFile, `${format} desktop file`)
  assertDesktopEntryIdentity(desktopText, identity, format)
  const metainfoText = await readBoundedUtf8(metainfo, `${format} metainfo`)
  assertMetainfoIdentity(metainfoText, identity, format)

  return {
    format,
    application: applicationRelative.split(path.sep).join("/"),
    executable: true,
    appAsar: true,
    nativeScanner: true,
    identityMetadata: true,
    desktopFile: desktopRelative.split(path.sep).join("/"),
    metainfo: metainfoRelative.split(path.sep).join("/"),
  }
}

export function validateArchiveExtractionListing(paths: string, details: string, format: "deb" | "rpm") {
  const entries = paths.split(/\r?\n/).filter(Boolean)
  const detailedEntries = details.split(/\r?\n/).filter(Boolean)
  if (entries.length === 0 || entries.length > MAX_EXTRACTED_ENTRIES) {
    throw new Error(`${format} archive returned an unsafe entry count`)
  }
  for (const raw of entries) {
    if (raw.length > 4096 || raw.includes("\0") || path.posix.isAbsolute(raw) || /^[A-Za-z]:[\\/]/.test(raw)) {
      throw new Error(`${format} archive contains an unsafe path`)
    }
    const normalized = raw.replaceAll("\\", "/").replace(/^\.\//, "")
    if (normalized.split("/").includes("..")) throw new Error(`${format} archive contains path traversal`)
  }
  if (detailedEntries.length !== entries.length) throw new Error(`${format} archive returned an ambiguous listing`)
  for (const detail of detailedEntries) {
    if (!/^[-d][rwxStTs-]{9}[+@.]?\s/.test(detail.trimStart())) {
      throw new Error(`${format} archive contains a link or special entry`)
    }
  }
}

function fatalCommandText(output: Buffer, format: "deb" | "rpm") {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(output)
  } catch {
    throw new Error(`${format} archive listing is not valid UTF-8`)
  }
}

async function inspectDebPackageEnvelope(artifact: string, workspace: string, expected: LinuxPackageExpectation) {
  const control = fatalCommandText(
    await runCommand("dpkg-deb", ["--field", artifact], { maxStdoutBytes: MAX_METADATA_BYTES }),
    "deb",
  )
  assertLinuxPackageIdentity("deb", parseDebianPackageIdentity(control), expected)

  const controlArchive = path.join(workspace, "control.tar")
  await runCommand("dpkg-deb", ["--ctrl-tarfile", artifact], {
    stdoutFile: controlArchive,
    maxStdoutBytes: MAX_CONTROL_ARCHIVE_BYTES,
  })
  const listing = await runCommand("tar", ["-tf", controlArchive])
  const details = await runCommand("tar", ["-tvf", controlArchive])
  const listingText = fatalCommandText(listing, "deb")
  validateArchiveExtractionListing(listingText, fatalCommandText(details, "deb"), "deb")
  const scriptNames = new Set(["preinst", "postinst", "prerm", "postrm", "config", "isinstallable"])
  const scripts: Record<string, string> = {}
  for (const raw of listingText.split(/\r?\n/).filter(Boolean)) {
    const name = normalizedArchivePath(raw)
    if (!scriptNames.has(name)) continue
    if (Object.hasOwn(scripts, name)) throw new Error(`deb control archive contains a duplicate ${name} script`)
    scripts[name] = fatalCommandText(
      await runCommand("tar", ["-xOf", controlArchive, "--", raw], { maxStdoutBytes: MAX_METADATA_BYTES }),
      "deb",
    )
  }
  assertSafePackageScriptlets("deb", scripts)
}

const RPM_SCRIPT_TAGS = {
  prein: "%{PREIN}",
  postin: "%{POSTIN}",
  preun: "%{PREUN}",
  postun: "%{POSTUN}",
  pretrans: "%{PRETRANS}",
  posttrans: "%{POSTTRANS}",
  verify: "%{VERIFYSCRIPT}",
  trigger: "[%{TRIGGERSCRIPTS}\n]",
} as const

async function inspectRpmPackageEnvelope(artifact: string, expected: LinuxPackageExpectation) {
  const identityText = fatalCommandText(
    await runCommand("rpm", ["-qp", "--queryformat", "%{NAME}\n%{VERSION}\n%{ARCH}\n", artifact], {
      maxStdoutBytes: MAX_METADATA_BYTES,
    }),
    "rpm",
  )
  assertLinuxPackageIdentity("rpm", parseRpmPackageIdentity(identityText), expected)
  const scripts: Record<string, string> = {}
  for (const [name, query] of Object.entries(RPM_SCRIPT_TAGS)) {
    scripts[name] = fatalCommandText(
      await runCommand("rpm", ["-qp", "--queryformat", query, artifact], { maxStdoutBytes: MAX_METADATA_BYTES }),
      "rpm",
    )
  }
  assertSafePackageScriptlets("rpm", scripts)
}

async function extractDeb(
  artifact: string,
  workspace: string,
  extractionRoot: string,
  expected: LinuxPackageExpectation,
) {
  await inspectDebPackageEnvelope(artifact, workspace, expected)
  const tarArchive = path.join(workspace, "payload.tar")
  await runCommand("dpkg-deb", ["--fsys-tarfile", artifact], {
    stdoutFile: tarArchive,
    maxStdoutBytes: MAX_EXPANDED_ARCHIVE_BYTES,
  })
  const listing = await runCommand("tar", ["-tf", tarArchive])
  const details = await runCommand("tar", ["-tvf", tarArchive])
  validateArchiveExtractionListing(fatalCommandText(listing, "deb"), fatalCommandText(details, "deb"), "deb")
  await runCommand("tar", ["-xf", tarArchive, "-C", extractionRoot, "--no-same-owner", "--no-same-permissions"])
}

async function extractRpm(
  artifact: string,
  workspace: string,
  extractionRoot: string,
  expected: LinuxPackageExpectation,
) {
  await inspectRpmPackageEnvelope(artifact, expected)
  const cpioArchive = path.join(workspace, "payload.cpio")
  await runCommand("rpm2cpio", [artifact], {
    stdoutFile: cpioArchive,
    maxStdoutBytes: MAX_EXPANDED_ARCHIVE_BYTES,
  })
  const listing = await runCommand("cpio", ["-it", "--quiet"], { stdinFile: cpioArchive })
  const details = await runCommand("cpio", ["-itv", "--quiet"], { stdinFile: cpioArchive })
  validateArchiveExtractionListing(fatalCommandText(listing, "rpm"), fatalCommandText(details, "rpm"), "rpm")
  await runCommand("cpio", ["-idm", "--quiet", "--no-absolute-filenames"], {
    cwd: extractionRoot,
    stdinFile: cpioArchive,
  })
}

function hdiutilParentDevice(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value["system-entities"])) {
    throw new Error("hdiutil returned invalid attachment metadata")
  }
  const devices = value["system-entities"]
    .map((entity) => (isRecord(entity) ? entity["dev-entry"] : undefined))
    .filter((entry): entry is string => typeof entry === "string")
  const parents = new Set(
    devices.map((entry) => entry.match(/^\/dev\/(disk\d+)(?:s\d+)*$/)?.[1]).filter((entry): entry is string => !!entry),
  )
  if (devices.length === 0 || parents.size !== 1) throw new Error("hdiutil returned an ambiguous parent device")
  return `/dev/${[...parents][0]}`
}

export function parseHdiutilAttachment(value: unknown, workspace: string) {
  const device = hdiutilParentDevice(value)
  const entities = (value as Record<string, unknown>)["system-entities"] as unknown[]
  const mountPoints = entities
    .map((entity) => (isRecord(entity) ? entity["mount-point"] : undefined))
    .filter((entry): entry is string => typeof entry === "string")
  if (mountPoints.length !== 1) throw new Error("DMG must expose exactly one mounted filesystem")
  const mountRoot = path.resolve(mountPoints[0]!)
  const canonicalDarwinPath = (value: string) =>
    path.resolve(value).replace(/^\/private(?=\/(?:tmp|var)(?:\/|$))/, "")
  if (canonicalDarwinPath(path.dirname(mountRoot)) !== canonicalDarwinPath(workspace)) {
    throw new Error("DMG mounted outside its private mount root")
  }
  return { device, mountRoot }
}

async function readPlistJson(target: string) {
  const output = await runCommand("plutil", ["-convert", "json", "-o", "-", target], {
    maxStdoutBytes: MAX_METADATA_BYTES,
  })
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(output)) as unknown
  } catch {
    throw new Error("hdiutil returned invalid plist metadata")
  }
}

async function detachDmg(device: string) {
  try {
    await runCommand("hdiutil", ["detach", device])
  } catch {
    await runCommand("hdiutil", ["detach", "-force", device])
  }
}

async function withMountedDmg<T>(artifact: string, action: (mountRoot: string) => Promise<T>) {
  const workspace = await mkdtemp(path.join(tmpdir(), "disklizard-dmg-"))
  const attachmentPlist = path.join(workspace, "attachment.plist")
  let attachedDevice: string | undefined
  try {
    await runCommand(
      "hdiutil",
      ["attach", "-readonly", "-nobrowse", "-noautoopen", "-plist", "-mountroot", workspace, artifact],
      { stdoutFile: attachmentPlist, maxStdoutBytes: MAX_METADATA_BYTES },
    )
    const metadata = await readPlistJson(attachmentPlist)
    attachedDevice = hdiutilParentDevice(metadata)
    const attachment = parseHdiutilAttachment(metadata, workspace)
    return await action(attachment.mountRoot)
  } finally {
    if (attachedDevice) {
      await detachDmg(attachedDevice)
    } else {
      // If attach failed before returning parseable metadata, detach every
      // mount directory confined under this private root before removing it.
      for (const entry of await readdir(workspace, { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory()) {
          await detachDmg(path.join(workspace, entry.name))
        }
      }
    }
    await rm(workspace, { recursive: true, force: true })
  }
}

async function withExtractedLinuxPackage<T>(
  artifact: string,
  format: "deb" | "rpm",
  expected: LinuxPackageExpectation,
  action: (root: string) => Promise<T>,
) {
  const workspace = await mkdtemp(path.join(tmpdir(), `disklizard-${format}-`))
  const extractionRoot = path.join(workspace, "root")
  await mkdir(extractionRoot)
  try {
    if (format === "deb") await extractDeb(artifact, workspace, extractionRoot, expected)
    else await extractRpm(artifact, workspace, extractionRoot, expected)
    return await action(extractionRoot)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

async function oneArtifact(directory: string, suffix: string) {
  const matches = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(suffix))
    .map((entry) => entry.name)
  if (matches.length !== 1) throw new Error(`Expected exactly one ${suffix} package; found ${matches.length}`)
  const artifact = path.join(directory, matches[0]!)
  return { path: artifact, ...(await describeArtifact(artifact)) }
}

export async function verifyPackagedReleaseArchives(
  directory: string,
  platform: NodeJS.Platform,
  identity: PackageArchiveIdentity = { appId: APP_IDS.dev, productName: APP_NAMES.dev },
  linuxPackage?: LinuxPackageExpectation,
): Promise<PackageArchiveEvidence | undefined> {
  if (platform === "darwin") {
    const artifact = await oneArtifact(directory, ".dmg")
    const inspection = await withMountedDmg(artifact.path, (mountRoot) => inspectMountedDmg(mountRoot, identity))
    return validatePackageArchiveEvidence({
      schemaVersion: 2,
      platform: "darwin",
      identity,
      packages: [{ artifact: path.basename(artifact.path), artifactBytes: artifact.artifactBytes, sha512: artifact.sha512, ...inspection }],
    })
  }
  if (platform === "linux") {
    if (!linuxPackage) throw new Error("Linux package verification requires a frozen package identity")
    const packages: PackageArchiveEvidence["packages"] = []
    for (const format of ["deb", "rpm"] as const) {
      const artifact = await oneArtifact(directory, `.${format}`)
      const inspection = await withExtractedLinuxPackage(artifact.path, format, linuxPackage, (root) =>
        inspectExtractedLinuxPackage(root, format, identity),
      )
      packages.push({
        artifact: path.basename(artifact.path),
        artifactBytes: artifact.artifactBytes,
        sha512: artifact.sha512,
        ...inspection,
      })
    }
    return validatePackageArchiveEvidence({ schemaVersion: 2, platform: "linux", identity, packages })
  }
  if (platform === "win32") return undefined
  throw new Error(`Package archive verification is unsupported on ${platform}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function validatePackageArchiveEvidence(value: unknown): PackageArchiveEvidence {
  const platform =
    isRecord(value) && (value.platform === "darwin" || value.platform === "linux") ? value.platform : undefined
  const identity = isRecord(value) && isRecord(value.identity) ? value.identity : undefined
  const packages = isRecord(value) && Array.isArray(value.packages) ? value.packages : undefined
  const expectedFormats = platform === "darwin" ? ["dmg"] : platform === "linux" ? ["deb", "rpm"] : undefined
  const validPackages =
    packages &&
    expectedFormats &&
    packages.length === expectedFormats.length &&
    packages.every((item, index) => {
      if (!isRecord(item) || item.format !== expectedFormats[index]) return false
      return (
        typeof item.artifact === "string" &&
        !item.artifact.includes("/") &&
        !item.artifact.includes("\\") &&
        path.basename(item.artifact) === item.artifact &&
        item.artifact.toLowerCase().endsWith(`.${item.format}`) &&
        typeof item.artifactBytes === "number" &&
        Number.isSafeInteger(item.artifactBytes) &&
        item.artifactBytes > 0 &&
        typeof item.sha512 === "string" &&
        /^[a-f\d]{128}$/.test(item.sha512) &&
        typeof item.application === "string" &&
        item.application.length > 0 &&
        item.executable === true &&
        item.appAsar === true &&
        item.nativeScanner === true &&
        item.identityMetadata === true &&
        (platform === "darwin"
          ? item.desktopFile === null && item.metainfo === null
          : typeof item.desktopFile === "string" && typeof item.metainfo === "string")
      )
    })
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    !platform ||
    !identity ||
    typeof identity.appId !== "string" ||
    identity.appId.length === 0 ||
    typeof identity.productName !== "string" ||
    identity.productName.length === 0 ||
    !validPackages
  ) {
    throw new Error("DiskLizard produced invalid package archive evidence")
  }
  return value as PackageArchiveEvidence
}

export async function writePackageArchiveEvidence(report: PackageArchiveEvidence, destination: string) {
  validatePackageArchiveEvidence(report)
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  try {
    await Bun.write(temporary, `${JSON.stringify(report, null, 2)}\n`)
    await chmod(temporary, 0o600)
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
}
