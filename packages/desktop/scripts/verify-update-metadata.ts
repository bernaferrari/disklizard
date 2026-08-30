#!/usr/bin/env bun
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { open, readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"
import { gunzipSync, inflateRawSync } from "node:zlib"

export type UpdateMetadataPlatform = "darwin" | "linux" | "win32"

type UpdateFile = {
  url: string
  sha512: string
  size: number
  blockMapSize?: number
}

type ParsedUpdateMetadata = {
  version: string
  files: UpdateFile[]
  path: string
  sha512: string
  releaseDate: string
}

export type UpdateMetadataReport = {
  metadataFile: string
  artifactFile: string
  blockmapFile: string
  blockmapKind: "embedded" | "sidecar"
  version: string
  sha512Verified: true
}

function unquote(value: string) {
  const trimmed = value.trim()
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function scalar(line: string, key: string) {
  return unquote(line.slice(key.length + 1))
}

function flushFile(files: UpdateFile[], current: Partial<UpdateFile> | undefined) {
  if (!current) return
  if (
    typeof current.url !== "string" ||
    current.url.length === 0 ||
    typeof current.sha512 !== "string" ||
    !Number.isSafeInteger(current.size) ||
    current.size! <= 0
  ) {
    throw new Error("Electron updater metadata contains an incomplete file entry")
  }
  if (
    current.blockMapSize !== undefined &&
    (!Number.isSafeInteger(current.blockMapSize) || current.blockMapSize <= 0)
  ) {
    throw new Error("Electron updater metadata contains an invalid embedded blockmap size")
  }
  files.push(current as UpdateFile)
}

/** Parse only electron-builder's bounded update manifest shape; aliases and YAML features are rejected. */
export function parseElectronUpdaterMetadata(content: string): ParsedUpdateMetadata {
  if (Buffer.byteLength(content, "utf8") > 256 * 1024) {
    throw new Error("Electron updater metadata is unexpectedly large")
  }
  const files: UpdateFile[] = []
  let current: Partial<UpdateFile> | undefined
  let inFiles = false
  let seenFiles = false
  let version = ""
  let artifactPath = ""
  let rootSha512 = ""
  let releaseDate = ""
  const seenRootKeys = new Set<string>()

  const setRoot = (key: string, value: string) => {
    if (seenRootKeys.has(key)) throw new Error(`Electron updater metadata declares ${key} more than once`)
    seenRootKeys.add(key)
    return value
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (line === "files:") {
      if (seenFiles) throw new Error("Electron updater metadata declares files more than once")
      seenFiles = true
      inFiles = true
      continue
    }
    if (inFiles) {
      const url = line.match(/^\s{2}- url:\s*(.+)$/)
      if (url) {
        flushFile(files, current)
        current = { url: unquote(url[1]!) }
        continue
      }
      const sha512 = line.match(/^\s{4}sha512:\s*(.+)$/)
      if (sha512 && current) {
        if (current.sha512 !== undefined) throw new Error("Electron updater metadata repeats a file SHA-512")
        current.sha512 = unquote(sha512[1]!)
        continue
      }
      const size = line.match(/^\s{4}size:\s*(.+)$/)
      if (size && current) {
        if (current.size !== undefined) throw new Error("Electron updater metadata repeats a file size")
        current.size = Number(unquote(size[1]!))
        continue
      }
      const blockMapSize = line.match(/^\s{4}blockMapSize:\s*(.+)$/)
      if (blockMapSize && current) {
        if (current.blockMapSize !== undefined) {
          throw new Error("Electron updater metadata repeats an embedded blockmap size")
        }
        current.blockMapSize = Number(unquote(blockMapSize[1]!))
        continue
      }
      if (line.length > 0 && !/^\s/.test(line)) {
        flushFile(files, current)
        current = undefined
        inFiles = false
      } else {
        continue
      }
    }

    if (line.startsWith("version:")) version = setRoot("version", scalar(line, "version"))
    else if (line.startsWith("path:")) artifactPath = setRoot("path", scalar(line, "path"))
    else if (line.startsWith("sha512:")) rootSha512 = setRoot("sha512", scalar(line, "sha512"))
    else if (line.startsWith("releaseDate:")) releaseDate = setRoot("releaseDate", scalar(line, "releaseDate"))
  }
  if (inFiles) flushFile(files, current)

  if (!version || files.length === 0 || !artifactPath || !rootSha512 || !releaseDate) {
    throw new Error("Electron updater metadata is missing required release fields")
  }
  if (files.length > 32) throw new Error("Electron updater metadata contains too many artifact entries")
  if (!Number.isFinite(Date.parse(releaseDate))) throw new Error("Electron updater metadata has an invalid release date")
  return { version, files, path: artifactPath, sha512: rootSha512, releaseDate }
}

function platformFiles(platform: UpdateMetadataPlatform) {
  if (platform === "darwin") return { metadata: "latest-mac.yml", suffix: ".zip" }
  if (platform === "win32") return { metadata: "latest.yml", suffix: ".exe" }
  return { metadata: "latest-linux.yml", suffix: ".appimage" }
}

function safeArtifactName(value: string) {
  return (
    value.length > 0 &&
    !value.includes("\0") &&
    !value.includes("/") &&
    !value.includes("\\") &&
    path.basename(value) === value
  )
}

function validSha512(value: string) {
  return /^[A-Za-z\d+/]{86}==$/.test(value) && Buffer.from(value, "base64").byteLength === 64
}

async function sha512(file: string) {
  const hash = createHash("sha512")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.once("error", reject)
    stream.once("end", resolve)
  })
  return hash.digest("base64")
}

const MAX_COMPRESSED_BLOCKMAP_BYTES = 32 * 1024 * 1024
const MAX_DECOMPRESSED_BLOCKMAP_BYTES = 128 * 1024 * 1024
const MAX_BLOCKMAP_CHUNKS = 2_000_000

function validBlockChecksum(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z\d+/]{24}$/.test(value)) return false
  const decoded = Buffer.from(value, "base64")
  return decoded.byteLength === 18 && decoded.toString("base64") === value
}

function validateBlockMap(compressed: Buffer, compression: "gzip" | "raw-deflate", expectedBytes: number) {
  if (compressed.byteLength === 0 || compressed.byteLength > MAX_COMPRESSED_BLOCKMAP_BYTES) {
    throw new Error("Electron updater blockmap has an invalid compressed size")
  }
  let decoded: Buffer
  try {
    decoded =
      compression === "gzip"
        ? gunzipSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BLOCKMAP_BYTES })
        : inflateRawSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BLOCKMAP_BYTES })
  } catch {
    throw new Error("Electron updater blockmap cannot be decompressed")
  }

  let value: unknown
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded))
  } catch {
    throw new Error("Electron updater blockmap is not valid UTF-8 JSON")
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Electron updater blockmap has an invalid structure")
  }
  const blockmap = value as Record<string, unknown>
  if (blockmap.version !== "2" || !Array.isArray(blockmap.files) || blockmap.files.length !== 1) {
    throw new Error("Electron updater blockmap must contain one version 2 file map")
  }
  const file = blockmap.files[0]
  if (typeof file !== "object" || file === null || Array.isArray(file)) {
    throw new Error("Electron updater blockmap has an invalid file map")
  }
  const mapped = file as Record<string, unknown>
  if (
    mapped.name !== "file" ||
    mapped.offset !== 0 ||
    !Array.isArray(mapped.checksums) ||
    !Array.isArray(mapped.sizes) ||
    mapped.sizes.length === 0 ||
    mapped.sizes.length !== mapped.checksums.length ||
    mapped.sizes.length > MAX_BLOCKMAP_CHUNKS
  ) {
    throw new Error("Electron updater blockmap has an invalid chunk map")
  }
  let mappedBytes = 0
  for (let index = 0; index < mapped.sizes.length; index += 1) {
    const size = mapped.sizes[index]
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || !validBlockChecksum(mapped.checksums[index])) {
      throw new Error("Electron updater blockmap contains an invalid chunk")
    }
    mappedBytes += size
    if (!Number.isSafeInteger(mappedBytes) || mappedBytes > expectedBytes) {
      throw new Error("Electron updater blockmap exceeds the packaged artifact")
    }
  }
  if (mappedBytes !== expectedBytes) throw new Error("Electron updater blockmap does not cover the packaged artifact")
}

async function readExactly(file: Awaited<ReturnType<typeof open>>, length: number, position: number) {
  const result = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await file.read(result, offset, length - offset, position + offset)
    if (bytesRead === 0) throw new Error("Electron updater artifact ended before its embedded blockmap")
    offset += bytesRead
  }
  return result
}

export async function verifyElectronUpdaterMetadata(
  distDirectory: string,
  platform: UpdateMetadataPlatform,
  expectedVersion: string,
): Promise<UpdateMetadataReport> {
  const expected = platformFiles(platform)
  const metadataPath = path.join(distDirectory, expected.metadata)
  const metadata = parseElectronUpdaterMetadata(await readFile(metadataPath, "utf8"))
  if (metadata.version !== expectedVersion) {
    throw new Error(`Electron updater metadata version mismatch: expected ${expectedVersion}, got ${metadata.version}`)
  }

  const artifacts = (await readdir(distDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(expected.suffix))
    .map((entry) => entry.name)
    .sort()
  if (artifacts.length !== 1) {
    throw new Error(`Expected exactly one ${platform} updater artifact; found ${artifacts.length}`)
  }
  const artifactFile = artifacts[0]!
  if (!safeArtifactName(artifactFile) || !safeArtifactName(metadata.path) || metadata.path !== artifactFile) {
    throw new Error("Electron updater metadata does not identify the packaged updater artifact")
  }
  const urls = new Set<string>()
  for (const file of metadata.files) {
    if (!safeArtifactName(file.url)) throw new Error("Electron updater metadata contains an unsafe artifact name")
    if (urls.has(file.url)) throw new Error("Electron updater metadata lists an artifact more than once")
    urls.add(file.url)
  }
  const selected = metadata.files.find((file) => file.url === artifactFile)
  if (!selected) throw new Error("Electron updater metadata does not list its selected updater artifact")
  if (!validSha512(metadata.sha512) || selected.sha512 !== metadata.sha512) {
    throw new Error("Electron updater metadata contains an invalid SHA-512 digest")
  }

  let selectedBlockmap:
    | { blockmapFile: string; blockmapKind: UpdateMetadataReport["blockmapKind"] }
    | undefined
  for (const listed of metadata.files) {
    if (!validSha512(listed.sha512)) {
      throw new Error("Electron updater metadata contains an invalid SHA-512 digest")
    }
    const listedPath = path.join(distDirectory, listed.url)
    const [listedStat, digest] = await Promise.all([stat(listedPath), sha512(listedPath)])
    if (listedStat.size !== listed.size) {
      throw new Error(`Electron updater metadata contains the wrong artifact size for ${listed.url}`)
    }
    if (digest !== listed.sha512) {
      throw new Error(`Electron updater metadata SHA-512 does not match ${listed.url}`)
    }

    // electron-builder lists both ZIP and DMG in latest-mac.yml. Authenticate
    // every listed artifact and its sidecar. Linux package metadata selects the
    // AppImage; deb/rpm are separately format-checked and are not differential
    // updater payloads.
    if (platform === "linux" && listed.url !== artifactFile) continue

    let verified: NonNullable<typeof selectedBlockmap>
    if (platform === "linux") {
      const blockMapSize = listed.blockMapSize
      if (
        typeof blockMapSize !== "number" ||
        !Number.isSafeInteger(blockMapSize) ||
        blockMapSize <= 0 ||
        blockMapSize > MAX_COMPRESSED_BLOCKMAP_BYTES ||
        blockMapSize + 4 >= listedStat.size
      ) {
        throw new Error("Electron updater metadata is missing a valid embedded blockmap size")
      }
      const artifact = await open(listedPath, "r")
      try {
        const trailer = await readExactly(artifact, 4, listedStat.size - 4)
        if (trailer.readUInt32BE(0) !== blockMapSize) {
          throw new Error("Electron updater embedded blockmap trailer does not match metadata")
        }
        const compressed = await readExactly(artifact, blockMapSize, listedStat.size - 4 - blockMapSize)
        validateBlockMap(compressed, "raw-deflate", listedStat.size - blockMapSize - 4)
      } finally {
        await artifact.close()
      }
      verified = { blockmapFile: listed.url, blockmapKind: "embedded" }
    } else {
      if (listed.blockMapSize !== undefined) {
        throw new Error("Electron updater sidecar metadata unexpectedly declares an embedded blockmap")
      }
      const blockmapFile = `${listed.url}.blockmap`
      const blockmapPath = path.join(distDirectory, blockmapFile)
      const blockmapStat = await stat(blockmapPath)
      if (blockmapStat.size <= 0 || blockmapStat.size > MAX_COMPRESSED_BLOCKMAP_BYTES) {
        throw new Error("Electron updater blockmap has an invalid compressed size")
      }
      validateBlockMap(await readFile(blockmapPath), "gzip", listedStat.size)
      verified = { blockmapFile, blockmapKind: "sidecar" }
    }
    if (listed.url === artifactFile) selectedBlockmap = verified
  }
  if (!selectedBlockmap) throw new Error("Electron updater artifact blockmap was not verified")

  const report: UpdateMetadataReport = {
    metadataFile: expected.metadata,
    artifactFile,
    blockmapFile: selectedBlockmap.blockmapFile,
    blockmapKind: selectedBlockmap.blockmapKind,
    version: metadata.version,
    sha512Verified: true,
  }
  console.log(`[disklizard] updater metadata passed: ${report.metadataFile} -> ${report.artifactFile}`)
  return report
}

function argumentValue(name: string) {
  return process.argv.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1)
}

if (import.meta.main) {
  const desktopDirectory = path.resolve(import.meta.dir, "..")
  const distDirectory = path.resolve(argumentValue("--dist") ?? path.join(desktopDirectory, "dist-smoke"))
  const packageJson = JSON.parse(await readFile(path.join(desktopDirectory, "package.json"), "utf8")) as {
    version?: unknown
  }
  if (typeof packageJson.version !== "string") throw new Error("Desktop package version is missing")
  if (process.platform !== "darwin" && process.platform !== "linux" && process.platform !== "win32") {
    throw new Error(`Update metadata verification is unsupported on ${process.platform}`)
  }
  await verifyElectronUpdaterMetadata(distDirectory, process.platform, packageJson.version)
}
