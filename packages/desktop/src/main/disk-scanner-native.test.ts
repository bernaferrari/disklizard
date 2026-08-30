import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { scanPathSync } from "../../../disklizard/src/scan"
import type { DeveloperArtifactInventory, DiskNode } from "../../../disklizard/src/types"
import { scanPathWithBackend } from "./disk-scanner"
import { hydrateDeveloperArtifactDirectoryIdentities, parseNativeMessage, scanPathNative } from "./disk-scanner-native"
import { MAX_MATERIALIZED_DISK_TREE_NODES } from "./disk-tree-budget"

const roots: string[] = []

beforeAll(() => {
  const binary = process.platform === "win32" ? "disklizard-scanner.exe" : "disklizard-scanner"
  process.env.DISKLIZARD_SCANNER_PATH = path.resolve(import.meta.dir, "../../native", binary)
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "disklizard-native-"))
  roots.push(root)
  await mkdir(path.join(root, "project", "node_modules"), { recursive: true })
  await Promise.all([
    writeFile(path.join(root, "project", "app.ts"), new Uint8Array(17)),
    writeFile(path.join(root, "project", "node_modules", "package.js"), new Uint8Array(31)),
    writeFile(path.join(root, "readme.md"), new Uint8Array(7)),
  ])
  return root
}

function artifactInventory(
  rootPath: string,
  itemPath = path.join(rootPath, "project", "node_modules"),
  statusOverrides: Partial<DeveloperArtifactInventory["status"]> = {},
): DeveloperArtifactInventory {
  return {
    items: [
      {
        name: "node_modules",
        path: itemPath,
        size: 1,
        isDir: true,
        kind: "dependencies",
        ecosystem: "node",
        confidence: "verified",
        cleanup: "eligible",
        evidence: ["name:node_modules"],
        inventoryOnly: true,
      },
    ],
    status: {
      state: "partial",
      maxItems: 2_000,
      scannedDirectories: 1,
      matchedDirectories: 1,
      truncated: false,
      unreadableCount: 0,
      unreadableSamplePaths: [],
      skippedSymlinkCount: 0,
      skippedSymlinkSamplePaths: [],
      skippedDirectoryCount: 0,
      skippedDirectorySamplePaths: [],
      unavailableDirectoryIdentityCount: 1,
      unavailableDirectoryIdentitySamplePaths: [itemPath],
      excludedCount: 0,
      excludedSamplePaths: [],
      ...statusOverrides,
    },
  }
}

function compactDonePayload(rootPath: string, inventory?: DeveloperArtifactInventory, children: unknown[] = []) {
  return {
    type: "done",
    protocol: 2,
    rootPath,
    root: {
      n: path.basename(rootPath) || rootPath,
      s: 0,
      d: true,
      ...(inventory === undefined ? {} : { i: inventory }),
      ...(children.length === 0 ? {} : { c: children }),
    },
  }
}

describe("native disk scanner", () => {
  test("matches the TypeScript scanner's logical byte accounting", async () => {
    const root = await fixture()
    const options = {
      maxDepth: 10,
      maxChildren: 48,
      sizeMode: "logical" as const,
      collapseNames: ["node_modules"],
      signatureNames: ["package.json"],
    }
    const [native, typescript] = await Promise.all([scanPathNative(root, options), scanPathSync(root, options)])

    expect(native.size).toBe(typescript.size)
    expect(native.size).toBe(55)
    expect(native.children.map((child) => child.name)).toEqual(typescript.children.map((child) => child.name))
  })

  test("keeps equal-size top-K children and Other samples in fallback-compatible lexical order", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "disklizard-native-equal-siblings-"))
    roots.push(root)
    const files = Array.from({ length: 60 }, (_, index) =>
      path.join(root, `file-${String(index).padStart(2, "0")}.bin`),
    )
    const directories = Array.from({ length: 8 }, (_, index) =>
      path.join(root, `dir-${String(index).padStart(2, "0")}`),
    )
    await Promise.all([
      ...files.map((target) => writeFile(target, new Uint8Array(1))),
      ...directories.map(async (directory) => {
        await mkdir(directory)
        await writeFile(path.join(directory, "leaf.bin"), new Uint8Array(1))
      }),
    ])

    const options = { maxChildren: 2, preserveNames: ["dir-07"], sizeMode: "logical" as const }
    const [native, fallback] = await Promise.all([scanPathNative(root, options), scanPathSync(root, options)])

    const expectedTopLevelNames = ["dir-00", "dir-01", "dir-07", "Other (65 items)"]
    const expectedOtherSampleNames = [
      "dir-02",
      "dir-03",
      "dir-04",
      "dir-05",
      "dir-06",
      "file-00.bin",
      "file-01.bin",
      "file-02.bin",
      "file-03.bin",
      "file-04.bin",
      "file-05.bin",
      "file-06.bin",
    ]

    // Sidecar protocol hydration deliberately differs in mtime precision and
    // synthetic Other paths. The visible retention decision must not differ.
    expect(native.children.map((child) => child.name)).toEqual(expectedTopLevelNames)
    expect(fallback.children.map((child) => child.name)).toEqual(expectedTopLevelNames)
    expect(native.children.at(-1)?.children.map((child) => child.name)).toEqual(expectedOtherSampleNames)
    expect(fallback.children.at(-1)?.children.map((child) => child.name)).toEqual(expectedOtherSampleNames)
    expect(native.children.at(-1)?.otherCount).toBe(65)
    expect(fallback.children.at(-1)?.otherCount).toBe(65)
  })

  test("normalizes invalid options before serializing a native request", async () => {
    const root = await fixture()
    for (const concurrency of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const options = {
        concurrency,
        maxDepth: -1,
        maxChildren: 0,
        progressIntervalMs: 0,
        sizeMode: "logical" as const,
      }
      const [native, typescript] = await Promise.all([scanPathNative(root, options), scanPathSync(root, options)])

      expect(native.size).toBe(typescript.size)
      expect(native.children.map((child) => child.name)).toEqual(typescript.children.map((child) => child.name))
      expect(native.children).toHaveLength(2)
      expect(native.children.at(-1)).toMatchObject({ name: "Other (1 item)", size: 7 })
    }
  })

  test("returns the same deep opt-in artifact inventory as the TypeScript fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "disklizard-native-artifacts-"))
    roots.push(root)
    const project = path.join(root, "one", "two", "project")
    await Promise.all([
      mkdir(path.join(project, "node_modules", "pkg"), { recursive: true }),
      mkdir(path.join(project, "target", "debug"), { recursive: true }),
    ])
    await Promise.all([
      writeFile(path.join(project, "node_modules", "pkg", "index.js"), new Uint8Array(13)),
      writeFile(path.join(project, "target", ".rustc_info.json"), new Uint8Array(7)),
      writeFile(path.join(project, "target", "debug", "app"), new Uint8Array(17)),
    ])
    const options = {
      maxDepth: 0,
      maxChildren: 2,
      sizeMode: "logical" as const,
      developerArtifactInventory: { maxItems: 16 },
    }

    const [native, typescript] = await Promise.all([scanPathNative(root, options), scanPathSync(root, options)])

    expect(native.developerArtifactInventory?.status).toEqual(typescript.developerArtifactInventory?.status)
    expect(
      native.developerArtifactInventory?.items.map(({ modifiedAt, ...item }) => ({
        ...item,
        ...(modifiedAt === undefined ? {} : { modifiedAt: Math.floor(modifiedAt) }),
      })),
    ).toEqual(
      typescript.developerArtifactInventory?.items.map(({ modifiedAt, ...item }) => ({
        ...item,
        ...(modifiedAt === undefined ? {} : { modifiedAt: Math.floor(modifiedAt) }),
      })),
    )
    expect(native.developerArtifactInventory).toMatchObject({
      status: { state: "complete", matchedDirectories: 2, truncated: false },
      items: expect.arrayContaining([
        expect.objectContaining({
          path: path.join(project, "node_modules"),
          cleanup: "eligible",
          ecosystem: "node",
        }),
        expect.objectContaining({
          path: path.join(project, "target"),
          size: 24,
          cleanup: "eligible",
          ecosystem: "rust",
          signatures: [".rustc_info.json", "debug"],
        }),
      ]),
    })
  })

  test("terminates the sidecar when a scan is cancelled", async () => {
    const root = await fixture()
    const controller = new AbortController()
    const result = scanPathNative(root, {
      sizeMode: "logical",
      signal: controller.signal,
      onProgress: () => controller.abort(new Error("cancelled in test")),
    })

    const cancellation = await result.then(
      () => "resolved",
      (error) => (error instanceof Error ? error.message : String(error)),
    )
    expect(cancellation).toBe("cancelled in test")
  })

  test("keeps fallback clone capability on the scan root", async () => {
    const root = await fixture()
    const previous = process.env.DISKLIZARD_NATIVE_SCANNER
    const previousRequired = process.env.DISKLIZARD_REQUIRE_NATIVE_SCANNER
    process.env.DISKLIZARD_NATIVE_SCANNER = "0"
    delete process.env.DISKLIZARD_REQUIRE_NATIVE_SCANNER
    try {
      const result = await scanPathWithBackend(root, { sizeMode: "physical", useWorker: false })
      expect(result.backend).toBe("typescript-fallback")
      expect(result.root.cloneMetadata).toEqual({ state: "unavailable", reason: "scanner" })
      expect(result.root.sharedStorageEvidence).toBe("partial")
      expect(result.root.children.every((child) => child.cloneMetadata === undefined)).toBe(true)
      expect(result.root.children.every((child) => child.sharedStorageEvidence === undefined)).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.DISKLIZARD_NATIVE_SCANNER
      else process.env.DISKLIZARD_NATIVE_SCANNER = previous
      if (previousRequired === undefined) delete process.env.DISKLIZARD_REQUIRE_NATIVE_SCANNER
      else process.env.DISKLIZARD_REQUIRE_NATIVE_SCANNER = previousRequired
    }
  })

  test("a packaged smoke requirement cannot be defeated by the fallback override", async () => {
    const root = await fixture()
    const previousNative = process.env.DISKLIZARD_NATIVE_SCANNER
    const previousRequired = process.env.DISKLIZARD_REQUIRE_NATIVE_SCANNER
    process.env.DISKLIZARD_NATIVE_SCANNER = "0"
    process.env.DISKLIZARD_REQUIRE_NATIVE_SCANNER = "1"
    try {
      const result = await scanPathWithBackend(root, { sizeMode: "physical", useWorker: false })
      expect(result.backend).toBe("native")
    } finally {
      if (previousNative === undefined) delete process.env.DISKLIZARD_NATIVE_SCANNER
      else process.env.DISKLIZARD_NATIVE_SCANNER = previousNative
      if (previousRequired === undefined) delete process.env.DISKLIZARD_REQUIRE_NATIVE_SCANNER
      else process.env.DISKLIZARD_REQUIRE_NATIVE_SCANNER = previousRequired
    }
  })

  test("rejects malformed protocol messages", () => {
    expect(parseNativeMessage("not-json")).toBeUndefined()
    expect(parseNativeMessage('{"type":"progress","progress":{}}')).toBeUndefined()
  })

  test("accepts a cacheable compact tree beyond the legacy native 100k node cap", () => {
    // The snapshot and native-protocol boundary intentionally use the same
    // materialization budget. A native result that the snapshot can retain
    // must not trigger a second full TypeScript scan merely because it has
    // more than the old 100k protocol-only limit.
    const childCount = 100_001
    expect(childCount).toBeLessThanOrEqual(MAX_MATERIALIZED_DISK_TREE_NODES - 1)
    const message = parseNativeMessage(
      JSON.stringify(
        compactDonePayload(
          "/workspace",
          undefined,
          Array.from({ length: childCount }, (_, index) => ({ n: `child-${index}`, s: 0 })),
        ),
      ),
    )

    expect(message?.type).toBe("done")
    if (!message || message.type !== "done") throw new Error("Expected a native done message")
    expect(message.root.children).toHaveLength(childCount)
  })

  test("rejects compact child names that could escape the declared root", () => {
    for (const name of ["../outside", "/outside", "\0outside"]) {
      expect(
        parseNativeMessage(JSON.stringify(compactDonePayload("/workspace", undefined, [{ n: name, s: 1, d: true }]))),
      ).toBeUndefined()
    }
    expect(
      parseNativeMessage(
        JSON.stringify(compactDonePayload("C:\\workspace", undefined, [{ n: "..\\outside", s: 1, d: true }])),
      ),
    ).toBeUndefined()
  })

  test("validates compact Other aggregate counts", () => {
    expect(
      parseNativeMessage(
        JSON.stringify(
          compactDonePayload("/workspace", undefined, [{ n: "Other (18 items)", s: 18, d: true, o: true, r: 18 }]),
        ),
      ),
    ).toMatchObject({ type: "done", root: { children: [{ isOther: true, otherCount: 18 }] } })

    // Old protocol payloads may omit the new aggregate count.
    expect(
      parseNativeMessage(
        JSON.stringify(
          compactDonePayload("/workspace", undefined, [{ n: "Other (18 items)", s: 18, d: true, o: true }]),
        ),
      )?.type,
    ).toBe("done")

    for (const child of [
      { n: "ordinary", s: 1, r: 1 },
      { n: "Other (0 items)", s: 0, d: true, o: true, r: 0 },
      { n: "Other (1 items)", s: 1, d: true, o: true, r: 1.5 },
      {
        n: "Other (1 items)",
        s: 2,
        d: true,
        o: true,
        r: 1,
        c: [
          { n: "a", s: 1 },
          { n: "b", s: 1 },
        ],
      },
    ]) {
      expect(parseNativeMessage(JSON.stringify(compactDonePayload("/workspace", undefined, [child])))).toBeUndefined()
    }
  })

  test("bounds compact protocol depth without throwing and accepts a near-bound chain", () => {
    const nestedPayload = (depth: number) => {
      let child: Record<string, unknown> = { n: "leaf", s: 0, d: true }
      for (let index = 0; index < depth; index++) child = { n: `d${index}`, s: 0, d: true, c: [child] }
      return compactDonePayload("/workspace", undefined, [child])
    }

    expect(() => parseNativeMessage(JSON.stringify(nestedPayload(513)))).not.toThrow()
    expect(parseNativeMessage(JSON.stringify(nestedPayload(513)))).toBeUndefined()
    expect(parseNativeMessage(JSON.stringify(nestedPayload(510)))?.type).toBe("done")
  })

  test("rejects native inventory scope and bounded-coverage mismatches", () => {
    const root = "/workspace"
    const expected = {
      expectedRootPath: root,
      expectedInventoryMaxItems: 16,
      requireDeclaredRootPath: true,
      inventoryEnabled: true,
    }

    expect(
      parseNativeMessage(
        JSON.stringify(
          compactDonePayload("/outside", artifactInventory("/outside", "/outside/node_modules", { maxItems: 16 })),
        ),
        expected,
      ),
    ).toBeUndefined()
    expect(
      parseNativeMessage(
        JSON.stringify(compactDonePayload(root, artifactInventory(root, "/outside/node_modules", { maxItems: 16 }))),
        expected,
      ),
    ).toBeUndefined()
    expect(
      parseNativeMessage(
        JSON.stringify(compactDonePayload(root, artifactInventory(root, undefined, { maxItems: 17 }))),
        expected,
      ),
    ).toBeUndefined()
    expect(
      parseNativeMessage(
        JSON.stringify(
          compactDonePayload(
            root,
            artifactInventory(root, undefined, {
              scannedDirectories: 0,
              matchedDirectories: 1,
              maxItems: 16,
            }),
          ),
        ),
        expected,
      ),
    ).toBeUndefined()
    expect(
      parseNativeMessage(
        JSON.stringify(
          compactDonePayload(
            root,
            artifactInventory(root, undefined, {
              state: "complete",
              maxItems: 16,
            }),
          ),
        ),
        expected,
      ),
    ).toBeUndefined()
  })

  test("rejects out-of-root inventory metadata before identity hydration can lstat", async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), "disklizard-native-boundary-"))
    roots.push(rootPath)
    const candidate = path.join(rootPath, "project", "node_modules")
    const outside = path.resolve(rootPath, "..", "outside-sample")
    const root: DiskNode = {
      name: path.basename(rootPath),
      path: rootPath,
      size: 0,
      isDir: true,
      children: [],
      ext: "",
      developerArtifactInventory: artifactInventory(rootPath, candidate, {
        unreadableCount: 1,
        unreadableSamplePaths: [outside],
      }),
    }
    let lstatCalls = 0

    await expect(
      hydrateDeveloperArtifactDirectoryIdentities(root, async () => {
        lstatCalls += 1
        return {
          isDirectory: () => true,
          isSymbolicLink: () => false,
          dev: 1n,
          ino: 2n,
          mtimeMs: 3n,
        }
      }),
    ).rejects.toThrow("invalid developer artifact inventory")
    expect(lstatCalls).toBe(0)
  })

  test("rejects fake sidecar root and inventory escapes at the scan boundary", async () => {
    if (process.platform === "win32") return
    const root = await mkdtemp(path.join(tmpdir(), "disklizard-native-fake-boundary-"))
    roots.push(root)
    const script = path.join(root, "fake-native-scanner.sh")
    const previous = process.env.DISKLIZARD_SCANNER_PATH
    process.env.DISKLIZARD_SCANNER_PATH = script
    const writePayload = async (payload: unknown) => {
      await writeFile(script, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(payload)}'\n`)
      await chmod(script, 0o700)
    }
    try {
      await writePayload(
        compactDonePayload(
          path.resolve(root, "..", "other-root"),
          artifactInventory(path.resolve(root, "..", "other-root")),
        ),
      )
      await expect(scanPathNative(root, { developerArtifactInventory: true })).rejects.toThrow(
        "Native scanner returned an invalid message",
      )

      await writePayload(
        compactDonePayload(root, artifactInventory(root, path.resolve(root, "..", "outside-node_modules"))),
      )
      await expect(scanPathNative(root, { developerArtifactInventory: true })).rejects.toThrow(
        "Native scanner returned an invalid message",
      )
    } finally {
      if (previous === undefined) delete process.env.DISKLIZARD_SCANNER_PATH
      else process.env.DISKLIZARD_SCANNER_PATH = previous
    }
  })

  test("bounds an unterminated native stdout line before it can grow without limit", async () => {
    if (process.platform === "win32") return
    const root = await mkdtemp(path.join(tmpdir(), "disklizard-native-stdout-boundary-"))
    roots.push(root)
    const script = path.join(root, "fake-native-scanner.sh")
    await writeFile(script, "#!/bin/sh\nexec dd if=/dev/zero bs=1048576 count=65 2>/dev/null\n")
    await chmod(script, 0o700)
    const previous = process.env.DISKLIZARD_SCANNER_PATH
    process.env.DISKLIZARD_SCANNER_PATH = script
    try {
      await expect(scanPathNative(root)).rejects.toThrow("oversized protocol line")
    } finally {
      if (previous === undefined) delete process.env.DISKLIZARD_SCANNER_PATH
      else process.env.DISKLIZARD_SCANNER_PATH = previous
    }
  })

  test("hydrates compact protocol trees without repeated path prefixes on the wire", () => {
    const message = parseNativeMessage(
      JSON.stringify({
        type: "done",
        protocol: 2,
        rootPath: "/workspace",
        root: {
          n: "workspace",
          s: 12,
          k: { state: "available" },
          e: "complete",
          i: {
            items: [
              {
                name: "node_modules",
                path: "/workspace/project/node_modules",
                size: 8,
                directoryIdentity: {
                  platform: "posix",
                  device: "42",
                  fileId: "99",
                  modifiedAt: 123,
                },
                isDir: true,
                kind: "dependencies",
                ecosystem: "node",
                confidence: "verified",
                cleanup: "eligible",
                evidence: ["name:node_modules"],
                inventoryOnly: true,
              },
            ],
            status: {
              state: "partial",
              maxItems: 2000,
              scannedDirectories: 12,
              matchedDirectories: 1,
              truncated: false,
              unreadableCount: 0,
              unreadableSamplePaths: [],
              skippedSymlinkCount: 0,
              skippedSymlinkSamplePaths: [],
              skippedDirectoryCount: 1,
              skippedDirectorySamplePaths: ["/workspace/other-device"],
              unavailableDirectoryIdentityCount: 0,
              unavailableDirectoryIdentitySamplePaths: [],
              excludedCount: 0,
              excludedSamplePaths: [],
            },
          },
          d: true,
          c: [
            {
              n: "index.ts",
              s: 4,
              m: 123,
              v: { state: "shares-all-blocks", cloneId: "clone-42", reportedFullCloneCount: 2 },
              a: "secondary",
            },
            { n: "target", s: 8, d: true, x: true, g: ["debug"] },
            { n: "Other (2 items)", s: 0, d: true, o: true, r: 2 },
          ],
        },
      }),
    )

    expect(message?.type).toBe("done")
    if (message?.type !== "done") throw new Error("expected compact tree")
    expect(message.root.path).toBe("/workspace")
    expect(message.root.cloneMetadata).toEqual({ state: "available" })
    expect(message.root.sharedStorageEvidence).toBe("complete")
    expect(message.root.developerArtifactInventory).toEqual({
      items: [
        expect.objectContaining({
          path: "/workspace/project/node_modules",
          ecosystem: "node",
          cleanup: "eligible",
          inventoryOnly: true,
          directoryIdentity: { platform: "posix", device: "42", fileId: "99", modifiedAt: 123 },
        }),
      ],
      status: expect.objectContaining({
        state: "partial",
        matchedDirectories: 1,
        skippedDirectoryCount: 1,
        skippedDirectorySamplePaths: ["/workspace/other-device"],
        unavailableDirectoryIdentityCount: 0,
        unavailableDirectoryIdentitySamplePaths: [],
      }),
    })
    expect(message.root.children[0]).toMatchObject({
      path: path.join("/workspace", "index.ts"),
      ext: "ts",
      modifiedAt: 123,
      clone: { state: "shares-all-blocks", cloneId: "clone-42", reportedFullCloneCount: 2 },
      cloneAccounting: "secondary",
    })
    expect(message.root.children[0].cloneMetadata).toBeUndefined()
    expect(message.root.children[0].sharedStorageEvidence).toBeUndefined()
    expect(message.root.children[0].developerArtifactInventory).toBeUndefined()
    expect(message.root.children[1]).toMatchObject({
      path: path.join("/workspace", "target"),
      isCollapsed: true,
      signatures: ["debug"],
    })
    expect(message.root.children[2]).toMatchObject({
      path: path.join("/workspace", "__other__"),
      isOther: true,
      otherCount: 2,
    })
  })

  test("hydrates missing native inventory identities with Node-compatible Windows stats", async () => {
    const message = parseNativeMessage(
      JSON.stringify({
        type: "done",
        protocol: 2,
        rootPath: "C:\\workspace",
        root: {
          n: "workspace",
          s: 8,
          i: {
            items: [
              {
                name: "node_modules",
                path: "C:\\workspace\\project\\node_modules",
                size: 8,
                isDir: true,
                kind: "dependencies",
                ecosystem: "node",
                confidence: "verified",
                cleanup: "eligible",
                evidence: ["name:node_modules"],
                inventoryOnly: true,
              },
            ],
            status: {
              state: "partial",
              maxItems: 2000,
              scannedDirectories: 3,
              matchedDirectories: 1,
              truncated: false,
              unreadableCount: 0,
              unreadableSamplePaths: [],
              skippedSymlinkCount: 0,
              skippedSymlinkSamplePaths: [],
              skippedDirectoryCount: 0,
              skippedDirectorySamplePaths: [],
              unavailableDirectoryIdentityCount: 1,
              unavailableDirectoryIdentitySamplePaths: ["C:\\workspace\\project\\node_modules"],
              excludedCount: 0,
              excludedSamplePaths: [],
            },
          },
          d: true,
        },
      }),
    )
    if (message?.type !== "done") throw new Error("expected compact tree")

    await hydrateDeveloperArtifactDirectoryIdentities(
      message.root,
      async () => ({
        isDirectory: () => true,
        isSymbolicLink: () => false,
        dev: 41n,
        ino: 99n,
        mtimeMs: 123n,
      }),
      "win32",
    )

    expect(message.root.developerArtifactInventory?.items[0]?.directoryIdentity).toEqual({
      platform: "windows",
      device: "41",
      fileId: "99",
      modifiedAt: 123,
    })
    expect(message.root.developerArtifactInventory?.status).toMatchObject({
      state: "complete",
      unavailableDirectoryIdentityCount: 0,
      unavailableDirectoryIdentitySamplePaths: [],
    })

    const item = message.root.developerArtifactInventory?.items[0]
    if (!item) throw new Error("expected inventory item")
    item.directoryIdentity = undefined
    const status = message.root.developerArtifactInventory?.status
    if (!status) throw new Error("expected inventory status")
    status.state = "partial"
    status.unavailableDirectoryIdentityCount = 1
    status.unavailableDirectoryIdentitySamplePaths = ["C:\\workspace\\project\\node_modules"]
    await hydrateDeveloperArtifactDirectoryIdentities(
      message.root,
      async () => ({
        isDirectory: () => true,
        isSymbolicLink: () => true,
        dev: 41n,
        ino: 99n,
        mtimeMs: 123n,
      }),
      "win32",
    )
    expect(item.directoryIdentity).toBeUndefined()
    expect(message.root.developerArtifactInventory?.status).toMatchObject({
      state: "partial",
      unavailableDirectoryIdentityCount: 1,
      unavailableDirectoryIdentitySamplePaths: ["C:\\workspace\\project\\node_modules"],
    })
  })

  test("waits for delayed inventory identity hydration after a native done line", async () => {
    if (process.platform === "win32") return
    const root = await mkdtemp(path.join(tmpdir(), "disklizard-native-done-race-"))
    roots.push(root)
    const script = path.join(root, "fake-native-scanner.sh")
    const items = Array.from({ length: 512 }, (_, index) => ({
      name: "node_modules",
      path: path.join(root, `missing-${index}`, "node_modules"),
      size: 1,
      isDir: true,
      kind: "dependencies",
      ecosystem: "node",
      confidence: "verified",
      cleanup: "eligible",
      evidence: ["name:node_modules"],
      inventoryOnly: true,
    }))
    const payload = JSON.stringify({
      type: "done",
      protocol: 2,
      rootPath: root,
      root: {
        n: "root",
        s: 0,
        d: true,
        i: {
          items,
          status: {
            state: "partial",
            maxItems: 2000,
            scannedDirectories: items.length,
            matchedDirectories: items.length,
            truncated: false,
            unreadableCount: 0,
            unreadableSamplePaths: [],
            skippedSymlinkCount: 0,
            skippedSymlinkSamplePaths: [],
            skippedDirectoryCount: 0,
            skippedDirectorySamplePaths: [],
            unavailableDirectoryIdentityCount: items.length,
            unavailableDirectoryIdentitySamplePaths: items.slice(0, 12).map((item) => item.path),
            excludedCount: 0,
            excludedSamplePaths: [],
          },
        },
      },
    })
    await writeFile(script, `#!/bin/sh\nprintf '%s\\n' '${payload}'\n`)
    await chmod(script, 0o700)
    const previous = process.env.DISKLIZARD_SCANNER_PATH
    process.env.DISKLIZARD_SCANNER_PATH = script
    try {
      const result = await scanPathNative(root, { developerArtifactInventory: true })
      expect(result.developerArtifactInventory?.items).toHaveLength(512)
      expect(result.developerArtifactInventory?.items.every((item) => item.directoryIdentity === undefined)).toBe(true)
      expect(result.developerArtifactInventory?.status).toMatchObject({
        state: "partial",
        unavailableDirectoryIdentityCount: 512,
        unavailableDirectoryIdentitySamplePaths: items.slice(0, 12).map((item) => item.path),
      })
    } finally {
      if (previous === undefined) delete process.env.DISKLIZARD_SCANNER_PATH
      else process.env.DISKLIZARD_SCANNER_PATH = previous
    }
  })

  test("rejects clone charging markers without complete filesystem evidence", () => {
    expect(
      parseNativeMessage(
        JSON.stringify({
          type: "done",
          protocol: 2,
          rootPath: "/workspace",
          root: { n: "workspace", s: 4, a: "primary" },
        }),
      ),
    ).toBeUndefined()
  })

  test("accepts clone capability only on the compact scan root", () => {
    expect(
      parseNativeMessage(
        JSON.stringify({
          type: "done",
          protocol: 2,
          rootPath: "/workspace",
          root: { n: "workspace", s: 4, k: { state: "unknown" }, c: [{ n: "child", s: 4, k: { state: "available" } }] },
        }),
      ),
    ).toBeUndefined()
  })

  test("accepts shared-storage evidence only on the compact scan root", () => {
    expect(
      parseNativeMessage(
        JSON.stringify({
          type: "done",
          protocol: 2,
          rootPath: "/workspace",
          root: { n: "workspace", s: 4, e: "complete", c: [{ n: "child", s: 4, e: "partial" }] },
        }),
      ),
    ).toBeUndefined()
  })

  test("accepts developer artifact inventory only on the compact scan root", () => {
    const inventory = {
      items: [],
      status: {
        state: "complete",
        maxItems: 2,
        scannedDirectories: 1,
        matchedDirectories: 0,
        truncated: false,
        unreadableCount: 0,
        unreadableSamplePaths: [],
        skippedSymlinkCount: 0,
        skippedSymlinkSamplePaths: [],
        excludedCount: 0,
        excludedSamplePaths: [],
      },
    }
    expect(
      parseNativeMessage(
        JSON.stringify({
          type: "done",
          protocol: 2,
          rootPath: "/workspace",
          root: { n: "workspace", s: 4, i: inventory, c: [{ n: "child", s: 4, i: inventory }] },
        }),
      ),
    ).toBeUndefined()
  })

  test("rejects unsupported shared-storage evidence", () => {
    expect(
      parseNativeMessage(
        JSON.stringify({
          type: "done",
          protocol: 2,
          rootPath: "/workspace",
          root: { n: "workspace", s: 4, e: "unknown" },
        }),
      ),
    ).toBeUndefined()
  })

  test("rejects clone capability below the root in legacy native trees", () => {
    expect(
      parseNativeMessage(
        JSON.stringify({
          type: "done",
          root: {
            name: "workspace",
            path: "/workspace",
            size: 4,
            cloneMetadata: { state: "available" },
            isDir: true,
            ext: "",
            children: [
              {
                name: "child",
                path: "/workspace/child",
                size: 4,
                cloneMetadata: { state: "available" },
                isDir: false,
                ext: "",
                children: [],
              },
            ],
          },
        }),
      ),
    ).toBeUndefined()
  })

  test("validates legacy native Other aggregate counts while allowing omission", () => {
    const root = (child: Record<string, unknown>) => ({
      type: "done",
      root: {
        name: "workspace",
        path: "/workspace",
        size: 1,
        isDir: true,
        ext: "",
        children: [child],
      },
    })
    const other = {
      name: "Other (1 items)",
      path: "/workspace/__other__",
      size: 1,
      isDir: true,
      isOther: true,
      ext: "",
      children: [],
    }

    expect(parseNativeMessage(JSON.stringify(root({ ...other, otherCount: 1 })))?.type).toBe("done")
    expect(parseNativeMessage(JSON.stringify(root(other)))?.type).toBe("done")
    expect(parseNativeMessage(JSON.stringify(root({ ...other, otherCount: 0 })))).toBeUndefined()
    expect(
      parseNativeMessage(
        JSON.stringify(
          root({
            ...other,
            otherCount: 1,
            children: [
              { name: "a", path: "/workspace/a", size: 1, isDir: false, ext: "", children: [] },
              { name: "b", path: "/workspace/b", size: 1, isDir: false, ext: "", children: [] },
            ],
          }),
        ),
      ),
    ).toBeUndefined()
    expect(
      parseNativeMessage(
        JSON.stringify(
          root({
            name: "ordinary",
            path: "/workspace/ordinary",
            size: 1,
            isDir: false,
            otherCount: 1,
            ext: "",
            children: [],
          }),
        ),
      ),
    ).toBeUndefined()
  })

  test("rejects shared-storage evidence below the root in legacy native trees", () => {
    expect(
      parseNativeMessage(
        JSON.stringify({
          type: "done",
          root: {
            name: "workspace",
            path: "/workspace",
            size: 4,
            sharedStorageEvidence: "complete",
            isDir: true,
            ext: "",
            children: [
              {
                name: "child",
                path: "/workspace/child",
                size: 4,
                sharedStorageEvidence: "partial",
                isDir: false,
                ext: "",
                children: [],
              },
            ],
          },
        }),
      ),
    ).toBeUndefined()
  })
})
