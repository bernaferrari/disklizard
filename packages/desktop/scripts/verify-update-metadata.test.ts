import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { deflateRawSync, gzipSync } from "node:zlib"

import { parseElectronUpdaterMetadata, verifyElectronUpdaterMetadata } from "./verify-update-metadata"

const temporaryDirectories: string[] = []

function blockMap(bytes: number) {
  return Buffer.from(JSON.stringify({
    version: "2",
    files: [{
      name: "file",
      offset: 0,
      checksums: [Buffer.alloc(18, 7).toString("base64")],
      sizes: [bytes],
    }],
  }))
}

async function fixture(platform: "darwin" | "linux" = "darwin") {
  const directory = await mkdtemp(path.join(tmpdir(), "disklizard-update-metadata-"))
  temporaryDirectories.push(directory)
  await mkdir(directory, { recursive: true })
  const artifact = platform === "linux" ? "disklizard-linux-x64.AppImage" : "disklizard-mac-arm64.zip"
  const payload = Buffer.from("real packaged bytes")
  const compressedBlockMap = platform === "linux" ? deflateRawSync(blockMap(payload.byteLength)) : undefined
  const trailer = compressedBlockMap ? Buffer.alloc(4) : undefined
  if (compressedBlockMap && trailer) trailer.writeUInt32BE(compressedBlockMap.byteLength)
  const bytes = compressedBlockMap && trailer ? Buffer.concat([payload, compressedBlockMap, trailer]) : payload
  const digest = createHash("sha512").update(bytes).digest("base64")
  await writeFile(path.join(directory, artifact), bytes)
  if (platform === "darwin") {
    await writeFile(path.join(directory, `${artifact}.blockmap`), gzipSync(blockMap(bytes.byteLength)))
  }
  const metadata = `version: 0.1.0
files:
  - url: ${artifact}
    sha512: ${digest}
    size: ${bytes.byteLength}
${compressedBlockMap ? `    blockMapSize: ${compressedBlockMap.byteLength}\n` : ""}path: ${artifact}
sha512: ${digest}
releaseDate: '2026-08-27T15:16:14.466Z'
`
  await writeFile(path.join(directory, platform === "linux" ? "latest-linux.yml" : "latest-mac.yml"), metadata)
  return { directory, artifact, digest, metadata, compressedBlockMap }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("electron updater artifact evidence", () => {
  test("parses the bounded electron-builder manifest shape", async () => {
    const value = await fixture()
    expect(parseElectronUpdaterMetadata(value.metadata)).toMatchObject({
      version: "0.1.0",
      path: value.artifact,
      sha512: value.digest,
      files: [{ url: value.artifact, sha512: value.digest, size: 19 }],
    })
  })

  test("verifies version, byte size, SHA-512, and differential blockmap", async () => {
    const value = await fixture()
    await expect(verifyElectronUpdaterMetadata(value.directory, "darwin", "0.1.0")).resolves.toEqual({
      metadataFile: "latest-mac.yml",
      artifactFile: value.artifact,
      blockmapFile: `${value.artifact}.blockmap`,
      blockmapKind: "sidecar",
      version: "0.1.0",
      sha512Verified: true,
    })
  })

  test("authenticates every macOS artifact while selecting the ZIP updater payload", async () => {
    const value = await fixture()
    const dmg = "disklizard-mac-arm64.dmg"
    const bytes = Buffer.from("real dmg bytes")
    const digest = createHash("sha512").update(bytes).digest("base64")
    await writeFile(path.join(value.directory, dmg), bytes)
    await writeFile(path.join(value.directory, `${dmg}.blockmap`), gzipSync(blockMap(bytes.byteLength)))
    await writeFile(
      path.join(value.directory, "latest-mac.yml"),
      value.metadata.replace(
        `path: ${value.artifact}`,
        `  - url: ${dmg}\n    sha512: ${digest}\n    size: ${bytes.byteLength}\npath: ${value.artifact}`,
      ),
    )

    await expect(verifyElectronUpdaterMetadata(value.directory, "darwin", "0.1.0")).resolves.toMatchObject({
      artifactFile: value.artifact,
      blockmapFile: `${value.artifact}.blockmap`,
    })
    await writeFile(path.join(value.directory, dmg), "tampered")
    await expect(verifyElectronUpdaterMetadata(value.directory, "darwin", "0.1.0")).rejects.toThrow(
      /wrong artifact size|does not match/,
    )
  })

  test("validates the AppImage raw-deflate blockmap and big-endian trailer", async () => {
    const value = await fixture("linux")
    await expect(verifyElectronUpdaterMetadata(value.directory, "linux", "0.1.0")).resolves.toEqual({
      metadataFile: "latest-linux.yml",
      artifactFile: value.artifact,
      blockmapFile: value.artifact,
      blockmapKind: "embedded",
      version: "0.1.0",
      sha512Verified: true,
    })

    const artifactPath = path.join(value.directory, value.artifact)
    const tampered = Buffer.from(await Bun.file(artifactPath).arrayBuffer())
    tampered.writeUInt32BE((value.compressedBlockMap?.byteLength ?? 0) + 1, tampered.byteLength - 4)
    await writeFile(artifactPath, tampered)
    const digest = createHash("sha512").update(tampered).digest("base64")
    const metadataPath = path.join(value.directory, "latest-linux.yml")
    await writeFile(metadataPath, value.metadata.replaceAll(value.digest, digest))
    await expect(verifyElectronUpdaterMetadata(value.directory, "linux", "0.1.0")).rejects.toThrow(
      "trailer does not match",
    )
  })

  test("rejects a non-blockmap sidecar even when it is non-empty", async () => {
    const value = await fixture()
    await writeFile(path.join(value.directory, `${value.artifact}.blockmap`), "blockmap")
    await expect(verifyElectronUpdaterMetadata(value.directory, "darwin", "0.1.0")).rejects.toThrow(
      "cannot be decompressed",
    )
  })

  test("fails closed when the artifact no longer matches published metadata", async () => {
    const value = await fixture()
    await writeFile(path.join(value.directory, value.artifact), "tampered")
    await expect(verifyElectronUpdaterMetadata(value.directory, "darwin", "0.1.0")).rejects.toThrow(
      /wrong artifact size|does not match/,
    )
  })

  test("rejects traversal and incomplete metadata", () => {
    expect(() =>
      parseElectronUpdaterMetadata(`version: 0.1.0
files:
  - url: ../outside.zip
path: ../outside.zip
releaseDate: now
`),
    ).toThrow("incomplete file entry")

    const digest = createHash("sha512").update("x").digest("base64")
    expect(() => parseElectronUpdaterMetadata(`version: 0.1.0
version: 0.1.1
files:
  - url: app.zip
    sha512: ${digest}
    size: 1
path: app.zip
sha512: ${digest}
releaseDate: '2026-08-27T15:16:14.466Z'
`)).toThrow("version more than once")
  })
})
