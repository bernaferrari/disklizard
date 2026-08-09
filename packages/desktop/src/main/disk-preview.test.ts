import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MAX_IMAGE_PREVIEW_BYTES, MAX_TEXT_PREVIEW_BYTES, readDiskPreview } from "./disk-preview"

const directories: string[] = []

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "disklizard-preview-"))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe("readDiskPreview", () => {
  test("returns bounded text with an explicit truncation state", async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, "trace.log")
    await writeFile(path, "x".repeat(MAX_TEXT_PREVIEW_BYTES + 8))

    const preview = await readDiskPreview(path)

    expect(preview.kind).toBe("text")
    if (preview.kind !== "text") return
    expect(preview.text).toHaveLength(MAX_TEXT_PREVIEW_BYTES)
    expect(preview.truncated).toBe(true)
    expect(preview.bytes).toBe(MAX_TEXT_PREVIEW_BYTES + 8)
  })

  test("rejects binary data even when it has a text extension", async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, "payload.txt")
    await writeFile(path, Uint8Array.from([65, 0, 66]))

    expect(await readDiskPreview(path)).toEqual({ kind: "unsupported", bytes: 3, reason: "binary" })
  })

  test("previews extensionless project configuration files", async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, "_headers")
    await writeFile(path, "/*\n  X-Frame-Options: DENY\n")

    expect(await readDiskPreview(path)).toMatchObject({
      kind: "text",
      text: "/*\n  X-Frame-Options: DENY\n",
      truncated: false,
    })
  })

  test("returns supported images as renderer-safe data URLs", async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, "pixel.png")
    await writeFile(path, Uint8Array.from([137, 80, 78, 71]))

    expect(await readDiskPreview(path)).toEqual({
      kind: "image",
      mime: "image/png",
      dataUrl: "data:image/png;base64,iVBORw==",
      bytes: 4,
    })
  })

  test("refuses oversized images before reading their contents", async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, "huge.jpg")
    await writeFile(path, "")
    await truncate(path, MAX_IMAGE_PREVIEW_BYTES + 1)

    expect(await readDiskPreview(path)).toEqual({
      kind: "unsupported",
      bytes: MAX_IMAGE_PREVIEW_BYTES + 1,
      reason: "too-large",
    })
  })

  test("does not treat folders or arbitrary formats as previewable", async () => {
    const directory = await temporaryDirectory()
    const folder = join(directory, "folder")
    const archive = join(directory, "bundle.zip")
    await mkdir(folder)
    await writeFile(archive, "zip")

    expect(await readDiskPreview(folder)).toMatchObject({ kind: "unsupported", reason: "directory" })
    expect(await readDiskPreview(archive)).toEqual({ kind: "unsupported", bytes: 3, reason: "format" })
  })
})
