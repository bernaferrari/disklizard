import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { chmod, link, mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Worker } from "node:worker_threads"
import { nativeScannerAvailable, parseNativeMessage, scanPathNative } from "./native"
import type { NativeParseWorkerMessage, NativeParseWorkerRequest } from "./native-parse-worker-contract"
import { runNativeScannerSidecar } from "./native-sidecar-runner"
import { scanPathSync } from "./scan"
import type { DiskNode, ScanProgress } from "./types"

const roots: string[] = []

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

async function createNativeScannerFixture(source: string): Promise<string> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "disklizard-native-process-"))
  roots.push(fixtureRoot)
  const scannerPath = join(fixtureRoot, "scanner")
  await writeFile(scannerPath, `#!/usr/bin/env bun\n${source}\n`)
  await chmod(scannerPath, 0o755)
  return scannerPath
}

async function withNativeScannerFixture<T>(source: string, run: () => Promise<T>): Promise<T> {
  const scannerPath = await createNativeScannerFixture(source)
  const previous = process.env.DISKLIZARD_SCANNER_PATH
  process.env.DISKLIZARD_SCANNER_PATH = scannerPath
  try {
    return await run()
  } finally {
    if (previous === undefined) delete process.env.DISKLIZARD_SCANNER_PATH
    else process.env.DISKLIZARD_SCANNER_PATH = previous
  }
}

function workerRequest(scannerPath: string, root: string): NativeParseWorkerRequest {
  return {
    scannerPath,
    requestJson: JSON.stringify({
      targetPath: root,
      maxDepth: 10,
      maxChildren: 48,
      preserveNames: [],
      collapseNames: [],
      signatureNames: [],
      progressIntervalMs: 100,
      sizeMode: "physical",
      excludePaths: [],
    }),
    platform: process.platform,
    expectedRootPath: root,
    inventoryEnabled: false,
  }
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
  throw new Error("Expected promise to reject")
}

const compactDoneSource = String.raw`
const request = JSON.parse((await Bun.stdin.text()).trim())
console.log(JSON.stringify({
  type: "done",
  protocol: 2,
  rootPath: request.targetPath,
  root: { n: "fixture-root", s: 0, d: true, c: [], k: { state: "unavailable", reason: "platform" }, e: "complete" }
}))`

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

  test("rejects a Windows protocol root whose casing differs from the requested root", () => {
    expect(
      parseNativeMessage(
        JSON.stringify({
          type: "done",
          protocol: 2,
          rootPath: "C:\\Work\\app",
          root: { n: "app", s: 0, d: true, c: [] },
        }),
        {
          expectedRootPath: "C:/Work/App",
          requireDeclaredRootPath: true,
          inventoryEnabled: false,
        },
      ),
    ).toBeUndefined()
  })

  test("rejects a Windows protocol descendant whose root casing differs", () => {
    expect(
      parseNativeMessage(
        JSON.stringify({
          type: "progress",
          progress: {
            filesScanned: 1,
            dirsScanned: 1,
            currentPath: "C:\\Work\\app\\file.txt",
            size: 1,
          },
        }),
        { expectedRootPath: "C:/Work/App" },
      ),
    ).toBeUndefined()
  })

  test("rejects a Windows inventory path whose root casing differs", () => {
    expect(
      parseNativeMessage(
        JSON.stringify({
          type: "done",
          protocol: 2,
          rootPath: "C:\\Work\\App",
          root: {
            n: "App",
            s: 1,
            d: true,
            c: [],
            i: {
              items: [
                {
                  name: "node_modules",
                  path: "C:\\Work\\app\\node_modules",
                  size: 1,
                  isDir: true,
                  kind: "dependencies",
                  ecosystem: "node",
                  confidence: "verified",
                  cleanup: "eligible",
                  evidence: [],
                  inventoryOnly: true,
                  directoryIdentity: {
                    platform: "windows",
                    device: "1",
                    fileId: "2",
                    modifiedAt: 1,
                  },
                },
              ],
              status: {
                state: "complete",
                maxItems: 1,
                scannedDirectories: 1,
                matchedDirectories: 1,
                truncated: false,
                unreadableCount: 0,
                unreadableSamplePaths: [],
                skippedSymlinkCount: 0,
                skippedSymlinkSamplePaths: [],
                excludedCount: 0,
                excludedSamplePaths: [],
              },
            },
          },
        }),
        {
          expectedRootPath: "C:/Work/App",
          expectedInventoryMaxItems: 1,
          requireDeclaredRootPath: true,
          inventoryEnabled: true,
        },
      ),
    ).toBeUndefined()
  })

  test("preserves case-distinct Windows siblings in a case-sensitive directory", () => {
    const message = parseNativeMessage(
      JSON.stringify({
        type: "done",
        protocol: 2,
        rootPath: "C:\\Work",
        root: {
          n: "Work",
          s: 2,
          d: true,
          c: [
            { n: "App", s: 1, d: true, c: [] },
            { n: "app", s: 1, d: true, c: [] },
          ],
        },
      }),
      {
        expectedRootPath: "C:/Work",
        requireDeclaredRootPath: true,
        inventoryEnabled: false,
      },
    )

    expect(message).toMatchObject({
      type: "done",
      root: {
        path: "C:\\Work",
        children: [{ path: "C:\\Work\\App" }, { path: "C:\\Work\\app" }],
      },
    })
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

  processTest("forwards progress while the scanner is still running", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-live-progress-"))
    roots.push(root)
    const gate = join(root, "progress-received")
    let scanResolved = false
    let progressBeforeResolution = false
    const result = await withNativeScannerFixture(
      String.raw`
import { existsSync } from "node:fs"
import { join } from "node:path"
const request = JSON.parse((await Bun.stdin.text()).trim())
console.log(JSON.stringify({
  type: "progress",
  progress: { filesScanned: 1, dirsScanned: 1, currentPath: request.targetPath, size: 1 }
}))
const gate = join(request.targetPath, "progress-received")
const deadline = Date.now() + 3000
while (!existsSync(gate) && Date.now() < deadline) await Bun.sleep(5)
if (!existsSync(gate)) process.exit(9)
console.log(JSON.stringify({
  type: "done",
  protocol: 2,
  rootPath: request.targetPath,
  root: { n: "fixture-root", s: 0, d: true, c: [] }
}))`,
      async () => {
        const pending = scanPathNative(root, {
          onProgress: () => {
            progressBeforeResolution = !scanResolved
            writeFileSync(gate, "release")
          },
        })
        const value = await pending
        scanResolved = true
        return value
      },
    )

    expect(result.path).toBe(root)
    expect(progressBeforeResolution).toBe(true)
  })

  processTest("rejects malformed UTF-8 instead of replacement-decoding it", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-malformed-utf8-"))
    roots.push(root)
    const error = await withNativeScannerFixture(
      String.raw`
await Bun.stdin.text()
process.stdout.write(Buffer.from([0xff, 0x0a]))`,
      () => scanPathNative(root).catch((reason: unknown) => reason),
    )

    expect(error).toHaveProperty("message", "Native scanner returned malformed UTF-8 protocol output")
  })

  processTest("rejects duplicate done frames and emits no successful result", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-duplicate-done-"))
    roots.push(root)
    const error = await withNativeScannerFixture(
      String.raw`
const request = JSON.parse((await Bun.stdin.text()).trim())
const payload = JSON.stringify({
  type: "done",
  protocol: 2,
  rootPath: request.targetPath,
  root: { n: "fixture-root", s: 0, d: true, c: [] }
})
console.log(payload)
console.log(payload)`,
      () => scanPathNative(root).catch((reason: unknown) => reason),
    )

    expect(error).toHaveProperty("message", "Native scanner emitted a message after done")
  })

  processTest("posts exactly one terminal error for a protocol fault", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-single-terminal-"))
    roots.push(root)
    const scannerPath = await createNativeScannerFixture(String.raw`
await Bun.stdin.text()
console.log("not-json")
process.stderr.write("secondary failure")
process.exit(8)`)
    const worker = new Worker(new URL("./native-parse-worker.ts", import.meta.url), {
      workerData: workerRequest(scannerPath, root),
    })
    const messages: NativeParseWorkerMessage[] = []

    await new Promise<void>((resolve, reject) => {
      worker.on("message", (message: NativeParseWorkerMessage) => messages.push(message))
      worker.once("error", reject)
      worker.once("exit", () => resolve())
    })

    expect(messages).toEqual([{ type: "error", message: "Native scanner returned an invalid message" }])
  })

  processTest("rejects a valid done frame when the scanner exits nonzero", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-nonzero-"))
    roots.push(root)
    const error = await withNativeScannerFixture(`${compactDoneSource}\nprocess.exit(7)`, () =>
      scanPathNative(root).catch((reason: unknown) => reason),
    )

    expect(error).toHaveProperty("message", "Native scanner exited (7)")
  })

  processTest("observes close even when a scanner writes done and exits immediately", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-close-race-"))
    roots.push(root)
    const scannerPath = await createNativeScannerFixture(String.raw`
import { writeFileSync } from "node:fs"
const request = JSON.parse((await Bun.stdin.text()).trim())
writeFileSync(1, JSON.stringify({
  type: "done",
  protocol: 2,
  rootPath: request.targetPath,
  root: { n: "fixture-root", s: 0, d: true, c: [] }
}) + "\n")
    process.exit(0)`)

    for (let iteration = 0; iteration < 4; iteration++) {
      const result = await runNativeScannerSidecar(workerRequest(scannerPath, root))
      expect(result).toMatchObject({ path: root })
    }
  })

  processTest("allows a large final frame a full idle deadline after exit-before-close parsing", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-slow-final-frame-"))
    roots.push(root)
    const scannerPath = await createNativeScannerFixture(String.raw`
import { spawn } from "node:child_process"
const request = JSON.parse((await Bun.stdin.text()).trim())
const source = "const rootPath = " + JSON.stringify(request.targetPath) + ";\n" + ${JSON.stringify(String.raw`
const { writeFileSync } = require("node:fs")
const children = Array.from({ length: 25_000 }, (_, index) => ({
  n: "entry-" + index,
  s: index,
  d: false,
  c: [],
}))
writeFileSync(1, JSON.stringify({
  type: "done",
  protocol: 2,
  rootPath,
  root: { n: "fixture-root", s: 312487500, d: true, c: children },
}) + "\n")
`)}
const descendant = spawn(process.execPath, ["-e", source], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
})
descendant.unref()
process.exit(0)`)

    let delayed = false
    const result = await runNativeScannerSidecar(workerRequest(scannerPath, root), {
      postExitPipeWaitMs: 1_000,
      onProtocolLineProcessed: () => {
        delayed = true
        const until = Date.now() + 1_500
        while (Date.now() < until) {
          // Deliberately model a slow synchronous parse/materialization turn.
        }
      },
    })

    expect(delayed).toBe(true)
    expect(result.children).toHaveLength(25_000)
    expect(result.path).toBe(root)
  })

  processTest("bounds individual lines, cumulative stdout, and stderr", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-bounds-"))
    roots.push(root)
    const limits = { lineBytes: 512, totalStdoutBytes: 768, stderrBytes: 32 }

    const longLineScanner = await createNativeScannerFixture(String.raw`
await Bun.stdin.text()
process.stdout.write("x".repeat(513) + "\n")`)
    const lineError = await rejection(runNativeScannerSidecar(workerRequest(longLineScanner, root), { limits }))
    expect(lineError.message).toContain("oversized protocol line")

    const totalScanner = await createNativeScannerFixture(String.raw`
const request = JSON.parse((await Bun.stdin.text()).trim())
for (let index = 0; index < 12; index++) {
  console.log(JSON.stringify({
    type: "progress",
    progress: { filesScanned: index, dirsScanned: 1, currentPath: request.targetPath, size: index }
  }))
}`)
    const totalError = await rejection(runNativeScannerSidecar(workerRequest(totalScanner, root), { limits }))
    expect(totalError.message).toContain("oversized total protocol output")

    const stderrScanner = await createNativeScannerFixture(String.raw`
await Bun.stdin.text()
process.stderr.write("x".repeat(33))
await Bun.sleep(25)`)
    const stderrError = await rejection(runNativeScannerSidecar(workerRequest(stderrScanner, root), { limits }))
    expect(stderrError.message).toContain("oversized stderr output")
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

  processTest("escalates protocol-fault termination when the scanner ignores SIGTERM", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-ignore-term-"))
    roots.push(root)
    const termObserved = join(root, "term-observed")
    const scannerPath = await createNativeScannerFixture(String.raw`
import { writeFileSync } from "node:fs"
import { join } from "node:path"
const request = JSON.parse((await Bun.stdin.text()).trim())
process.on("SIGTERM", () => writeFileSync(join(request.targetPath, "term-observed"), "yes"))
console.log("not-json")
setInterval(() => {}, 1_000)`)

    const startedAt = Date.now()
    const error = await rejection(
      runNativeScannerSidecar(workerRequest(scannerPath, root), {
        terminationGraceMs: 40,
        forceKillWaitMs: 80,
      }),
    )

    expect(error.message).toBe("Native scanner returned an invalid message")
    expect(existsSync(termObserved)).toBe(true)
    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })

  processTest("bounds inherited pipes after the faulty scanner already exited", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-inherited-pipe-"))
    roots.push(root)
    const scannerPath = await createNativeScannerFixture(String.raw`
import { spawn } from "node:child_process"
await Bun.stdin.text()
const descendant = spawn(process.execPath, ["-e", "setTimeout(() => { console.log('not-json'); setTimeout(() => process.exit(0), 2000) }, 75)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
})
descendant.unref()
process.exit(0)`)

    const startedAt = Date.now()
    const error = await rejection(
      runNativeScannerSidecar(workerRequest(scannerPath, root), {
        terminationGraceMs: 40,
        forceKillWaitMs: 80,
        postExitPipeWaitMs: 600,
      }),
    )

    expect(error.message).toBe("Native scanner returned an invalid message")
    expect(Date.now() - startedAt).toBeLessThan(1_000)
  })

  processTest("rejects a successful frame when an exited scanner leaks inherited pipes", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-native-leaked-success-pipe-"))
    roots.push(root)
    const scannerPath = await createNativeScannerFixture(String.raw`
import { spawn } from "node:child_process"
const request = JSON.parse((await Bun.stdin.text()).trim())
const descendant = spawn(process.execPath, ["-e", "setTimeout(() => process.exit(0), 2000)"], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
})
descendant.unref()
console.log(JSON.stringify({
  type: "done",
  protocol: 2,
  rootPath: request.targetPath,
  root: { n: "fixture-root", s: 0, d: true, c: [] },
}))
process.exit(0)`)

    const startedAt = Date.now()
    const error = await rejection(
      runNativeScannerSidecar(workerRequest(scannerPath, root), {
        terminationGraceMs: 40,
        forceKillWaitMs: 80,
      }),
    )

    expect(error.message).toBe("Native scanner pipes did not close after process exit")
    expect(Date.now() - startedAt).toBeLessThan(1_000)
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
