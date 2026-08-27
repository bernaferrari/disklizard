import { afterAll, describe, expect, test } from "bun:test"
import { chmod, link, mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { nativeScannerAvailable, parseNativeMessage, scanPathNative } from "./native"
import { scanPathSync } from "./scan"
import type { DiskNode, ScanProgress } from "./types"

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

async function withNativeScannerFixture<T>(source: string, run: () => Promise<T>): Promise<T> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "disklizard-native-process-"))
  roots.push(fixtureRoot)
  const scannerPath = join(fixtureRoot, "scanner")
  await writeFile(scannerPath, `#!/usr/bin/env bun\n${source}\n`)
  await chmod(scannerPath, 0o755)
  const previous = process.env.DISKLIZARD_SCANNER_PATH
  process.env.DISKLIZARD_SCANNER_PATH = scannerPath
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.DISKLIZARD_SCANNER_PATH
    else process.env.DISKLIZARD_SCANNER_PATH = previous
  }
}

describe("native protocol validation", () => {
  test("rejects negative counters and paths outside the requested scan root", () => {
    const validation = { expectedRootPath: "/scan-root" }
    expect(
      parseNativeMessage(
        JSON.stringify({
          type: "progress",
          progress: { filesScanned: -1, dirsScanned: 0, currentPath: "/scan-root", size: 0 },
        }),
        validation,
      ),
    ).toBeUndefined()
    expect(
      parseNativeMessage(
        JSON.stringify({
          type: "progress",
          progress: { filesScanned: 1, dirsScanned: 1, currentPath: "/outside", size: 1 },
        }),
        validation,
      ),
    ).toBeUndefined()
  })
})

describe("native scanner process lifecycle", () => {
  const processTest = process.platform === "win32" ? test.skip : test.serial

  processTest("resolves a valid compact response and forwards validated progress", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-valid-"))
    roots.push(root)
    const progress: ScanProgress[] = []
    const result = await withNativeScannerFixture(
      String.raw`
const request = JSON.parse((await Bun.stdin.text()).trim())
console.log(JSON.stringify({
  type: "progress",
  progress: { filesScanned: 0, dirsScanned: 1, currentPath: request.targetPath, size: 0 }
}))
console.log(JSON.stringify({
  type: "done",
  protocol: 2,
  rootPath: request.targetPath,
  root: { n: "fixture-root", s: 0, d: true, c: [], k: { state: "unavailable", reason: "platform" }, e: "complete" }
}))`,
      () => scanPathNative(root, { onProgress: (event) => progress.push(event) }),
    )

    expect(result).toMatchObject({ name: "fixture-root", path: root, size: 0, isDir: true, children: [] })
    expect(progress).toEqual([{ filesScanned: 0, dirsScanned: 1, currentPath: root, size: 0 }])
  })

  processTest("rejects malformed protocol output", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-invalid-"))
    roots.push(root)
    const error = await withNativeScannerFixture(
      String.raw`
await Bun.stdin.text()
console.log("not-json")`,
      () => scanPathNative(root).catch((reason: unknown) => reason),
    )
    expect(error).toHaveProperty("message", "Native scanner returned an invalid message")
  })

  processTest("rejects a clean child exit that never sends a done frame", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-incomplete-"))
    roots.push(root)
    const error = await withNativeScannerFixture(
      String.raw`
await Bun.stdin.text()`,
      () => scanPathNative(root).catch((reason: unknown) => reason),
    )
    expect(error).toHaveProperty("message", "Native scanner exited (0)")
  })

  processTest("kills a non-responsive scanner when the request is cancelled", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-cancel-"))
    roots.push(root)
    const controller = new AbortController()
    const pending = withNativeScannerFixture(
      String.raw`
await Bun.stdin.text()
setInterval(() => {}, 1_000)`,
      () => scanPathNative(root, { signal: controller.signal }).catch((reason: unknown) => reason),
    )
    setTimeout(() => controller.abort(new Error("native cancellation fixture")), 25)

    const error = await pending
    expect(error).toHaveProperty("message", "native cancellation fixture")
  })
})

type ComparableNode = Pick<
  DiskNode,
  "name" | "size" | "logicalSize" | "hardLink" | "isDir" | "isOther" | "otherCount" | "isCollapsed" | "signatures"
> & { children: ComparableNode[] }

function comparableTree(node: DiskNode): ComparableNode {
  return {
    name: node.name,
    size: node.size,
    logicalSize: node.logicalSize,
    hardLink: node.hardLink,
    isDir: node.isDir,
    isOther: node.isOther,
    otherCount: node.otherCount,
    isCollapsed: node.isCollapsed,
    signatures: node.signatures,
    children: node.children.map(comparableTree),
  }
}

function comparableInventory(root: DiskNode) {
  return root.developerArtifactInventory?.items.map((item) => ({
    name: item.name,
    path: item.path,
    size: item.size,
    logicalSize: item.logicalSize,
    kind: item.kind,
    ecosystem: item.ecosystem,
    confidence: item.confidence,
    cleanup: item.cleanup,
    evidence: item.evidence,
  }))
}

describe("native and TypeScript scanner parity", () => {
  const nativeTest = nativeScannerAvailable() ? test.serial : test.skip
  const nativePhysicalTest = nativeScannerAvailable() && process.platform !== "win32" ? test.serial : test.skip

  nativeTest("agrees on deterministic logical trees and developer-artifact inventory", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-parity-"))
    roots.push(root)
    await Promise.all([
      mkdir(join(root, "nested"), { recursive: true }),
      mkdir(join(root, "node_modules", "pkg"), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(root, "alpha.bin"), new Uint8Array(7)),
      writeFile(join(root, "nested", "beta.bin"), new Uint8Array(11)),
      writeFile(join(root, "node_modules", "pkg", "index.js"), new Uint8Array(13)),
      writeFile(join(root, "hard-a.bin"), new Uint8Array(17)),
      writeFile(join(root, "sparse.bin"), new Uint8Array()),
    ])
    await link(join(root, "hard-a.bin"), join(root, "hard-b.bin"))
    await truncate(join(root, "sparse.bin"), 1024 * 1024)

    const options = {
      sizeMode: "logical" as const,
      maxDepth: 8,
      maxChildren: 2,
      developerArtifactInventory: { maxItems: 10 },
    }
    const [native, typescript] = await Promise.all([scanPathNative(root, options), scanPathSync(root, options)])

    expect(native.size).toBe(1_048_641)
    expect(comparableTree(native)).toEqual(comparableTree(typescript))
    expect(native.children.find((node) => node.isOther)?.otherCount).toBeGreaterThan(0)
    expect(comparableInventory(native)).toEqual(comparableInventory(typescript))
  })

  nativePhysicalTest("agrees on POSIX physical allocation and deterministic hard-link charging", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-physical-"))
    roots.push(root)
    await Promise.all([
      writeFile(join(root, "dense.bin"), new Uint8Array(8_192)),
      writeFile(join(root, "hard-a.bin"), new Uint8Array(4_096)),
      writeFile(join(root, "sparse.bin"), new Uint8Array()),
    ])
    await link(join(root, "hard-a.bin"), join(root, "hard-b.bin"))
    await truncate(join(root, "sparse.bin"), 2 * 1024 * 1024)

    const options = { sizeMode: "physical" as const, maxDepth: 4, maxChildren: 100 }
    const [native, typescript] = await Promise.all([scanPathNative(root, options), scanPathSync(root, options)])

    expect(comparableTree(native)).toEqual(comparableTree(typescript))
    expect(native.children.find((node) => node.name === "hard-a.bin")).toMatchObject({
      hardLink: "primary",
    })
    expect(native.children.find((node) => node.name === "hard-b.bin")).toMatchObject({
      hardLink: "secondary",
      size: 0,
      logicalSize: 4_096,
    })
  })
})
