import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { DiskNode } from "../../../disklizard/src/types"
import {
  decodeDiskSnapshotMetadata,
  decodeDiskSnapshotTree,
  encodeDiskSnapshotMetadata,
  encodeDiskSnapshotTree,
} from "./disk-snapshot-codec"

const temporary: string[] = []

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((entry) => rm(entry, { recursive: true, force: true })))
})

async function temp() {
  const root = await mkdtemp(path.join(tmpdir(), "disklizard-snapshot-codec-"))
  temporary.push(root)
  return root
}

describe("disk snapshot wire codec", () => {
  test("owns schema-8 metadata encoding and expected-cache validation", () => {
    const expected = {
      rootPath: "/tmp/project",
      optionsHash: "0123456789abcdef0123456789abcdef",
    }
    const encoded = encodeDiskSnapshotMetadata({
      ...expected,
      savedAt: 123,
      checkpoint: "events-123-00000000-0000-4000-8000-000000000000.snapshot",
      tree: "tree-123-00000000-0000-4000-8000-000000000000.ndjson",
    })

    expect(JSON.parse(encoded)).toMatchObject({ schema: 8, ...expected })
    expect(decodeDiskSnapshotMetadata(encoded, expected)).toMatchObject({ schema: 8, ...expected })
    expect(decodeDiskSnapshotMetadata(encoded, { ...expected, rootPath: "/tmp/other" })).toBeUndefined()
    expect(decodeDiskSnapshotMetadata(encoded.replace('"schema":8', '"schema":7'), expected)).toBeUndefined()
  })

  test("decodes an existing schema-8 tree whose Other node predates aggregate counts", async () => {
    const rootPath = await temp()
    const treePath = path.join(rootPath, "existing.ndjson")
    const aggregatePath = path.join(rootPath, "__other__")
    const childPath = path.join(rootPath, "old.txt")
    const records = [
      { type: "disklizard-tree", format: 1 },
      {
        type: "node",
        parent: null,
        node: {
          name: path.basename(rootPath),
          path: rootPath,
          size: 1,
          isDir: true,
          ext: "",
          sharedStorageEvidence: "complete",
        },
      },
      {
        type: "node",
        parent: 0,
        node: { name: "Other (1 item)", path: aggregatePath, size: 1, isDir: true, ext: "", isOther: true },
      },
      {
        type: "node",
        parent: 1,
        node: { name: "old.txt", path: childPath, size: 1, isDir: false, ext: "txt" },
      },
      { type: "end", nodes: 3, inventoryItems: 0 },
    ]
    await writeFile(treePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`)

    const decoded = await decodeDiskSnapshotTree(treePath, {
      rootPath,
      options: {},
      rootIsDirectory: true,
    })

    const aggregate = decoded?.children[0]
    expect(aggregate).toMatchObject({
      path: aggregatePath,
      isOther: true,
      children: [{ path: childPath }],
    })
    expect(aggregate).not.toHaveProperty("otherCount")
  })

  test("round-trips a validated tree through the codec interface", async () => {
    const rootPath = await temp()
    const treePath = path.join(rootPath, "round-trip.ndjson")
    const root: DiskNode = {
      name: path.basename(rootPath),
      path: rootPath,
      size: 3,
      isDir: true,
      ext: "",
      sharedStorageEvidence: "complete",
      children: [
        {
          name: "file.txt",
          path: path.join(rootPath, "file.txt"),
          size: 3,
          isDir: false,
          ext: "txt",
          children: [],
        },
      ],
    }

    await encodeDiskSnapshotTree(treePath, root)

    await expect(decodeDiskSnapshotTree(treePath, { rootPath, options: {}, rootIsDirectory: true })).resolves.toEqual(
      root,
    )
  })
})
