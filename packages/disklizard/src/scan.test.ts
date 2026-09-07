import { afterEach, describe, expect, it } from "bun:test"
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  symlink,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises"
import { homedir, platform, tmpdir } from "node:os"
import { join, parse } from "node:path"
import {
  assertSafeDeletionPath,
  canClaimDeveloperArtifactInventoryDirectory,
  defaultScanConcurrency,
  normalizeScanConcurrency,
  normalizeScanOptions,
  scanPath,
  scanPathSync,
} from "./scan"
import type { DriveDiscovery } from "./scan"
import type { ScanDiscovery } from "./types"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "disklizard-scan-"))
  roots.push(root)
  await Promise.all([mkdir(join(root, "$Recycle.Bin")), mkdir(join(root, "Windows.old")), mkdir(join(root, ".Trash"))])
  await Promise.all([
    writeFile(join(root, "$Recycle.Bin", "deleted.bin"), new Uint8Array(11)),
    writeFile(join(root, "Windows.old", "system.bin"), new Uint8Array(13)),
    writeFile(join(root, ".Trash", "item.bin"), new Uint8Array(17)),
    writeFile(join(root, "pagefile.sys"), new Uint8Array(19)),
  ])
  return root
}

describe("disk scanner", () => {
  it("uses a conservative portable metadata-I/O default", () => {
    expect(defaultScanConcurrency(1)).toBe(4)
    expect(defaultScanConcurrency(4)).toBe(6)
    expect(defaultScanConcurrency(8)).toBe(10)
    expect(defaultScanConcurrency(128)).toBe(12)
  })

  it("normalizes invalid scanner concurrency before either fallback execution path can deadlock", async () => {
    expect(normalizeScanConcurrency(undefined, 8)).toBe(10)
    expect(normalizeScanConcurrency(0, 8)).toBe(10)
    expect(normalizeScanConcurrency(-1, 8)).toBe(10)
    expect(normalizeScanConcurrency(Number.NaN, 8)).toBe(10)
    expect(normalizeScanConcurrency(Number.POSITIVE_INFINITY, 8)).toBe(10)
    expect(normalizeScanConcurrency(1.9, 8)).toBe(1)
    expect(normalizeScanConcurrency(1_000, 8)).toBe(64)

    const root = await fixture()
    for (const concurrency of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const options = { concurrency, maxChildren: 100, maxDepth: 4, sizeMode: "logical" as const }
      const [local, worker] = await Promise.all([
        scanPathSync(root, options),
        scanPath(root, { ...options, useWorker: true }),
      ])

      expect(worker).toEqual(local)
      expect(local.size).toBe(60)
    }
  })

  it("uses one bounded options contract for worker and in-process fallback scans", async () => {
    expect(
      normalizeScanOptions({
        maxDepth: -1,
        maxChildren: 0,
        progressIntervalMs: 0,
        concurrency: Number.POSITIVE_INFINITY,
      }),
    ).toMatchObject({ maxDepth: 0, maxChildren: 1, progressIntervalMs: 16 })
    expect(normalizeScanOptions({ maxDepth: 100, maxChildren: 100_001 })).toMatchObject({
      maxDepth: 64,
      maxChildren: 10_000,
    })

    const root = await fixture()
    const options = { maxDepth: -1, maxChildren: 0, progressIntervalMs: 0, sizeMode: "logical" as const }
    const [local, worker] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
    ])

    expect(worker).toEqual(local)
    expect(local.children).toHaveLength(2)
    expect(local.children.at(-1)).toMatchObject({ name: "Other (3 items)", size: 41, otherCount: 3 })
  })

  it("accounts for large system and trash entries instead of hiding them", async () => {
    const root = await fixture()
    const result = await scanPathSync(root, {
      concurrency: 4,
      maxChildren: 100,
      maxDepth: 4,
      sizeMode: "logical",
    })

    expect(result.size).toBe(60)
    expect(result.children.map((child) => child.name).sort()).toEqual([
      "$Recycle.Bin",
      ".Trash",
      "Windows.old",
      "pagefile.sys",
    ])
  })

  it("keeps worker and in-process results identical", async () => {
    const root = await fixture()
    const options = { concurrency: 4, maxChildren: 100, maxDepth: 4 }
    const [worker, local] = await Promise.all([
      scanPath(root, { ...options, useWorker: true }),
      scanPathSync(root, options),
    ])

    expect(worker).toEqual(local)
  })

  it("retains named developer markers below the size cutoff in both scanners", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-preserve-"))
    roots.push(root)
    await Promise.all([
      writeFile(join(root, "large-a.bin"), new Uint8Array(50)),
      writeFile(join(root, "large-b.bin"), new Uint8Array(40)),
      writeFile(join(root, "large-c.bin"), new Uint8Array(30)),
      writeFile(join(root, ".git"), new Uint8Array(1)),
    ])
    const options = { maxChildren: 2, preserveNames: [".git"], sizeMode: "logical" as const }
    const [local, worker] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
    ])

    expect(worker).toEqual(local)
    expect(local.children.map((child) => child.name)).toContain(".git")
    expect(local.children.find((child) => child.isOther)).toMatchObject({
      name: "Other (1 item)",
      size: 30,
      otherCount: 1,
    })
    expect(local.size).toBe(121)
  })

  it("retains equal-size siblings in deterministic lexical order across fallback execution paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-equal-siblings-"))
    roots.push(root)
    const files = Array.from({ length: 60 }, (_, index) => join(root, `file-${String(index).padStart(2, "0")}.bin`))
    const directories = Array.from({ length: 8 }, (_, index) => join(root, `dir-${String(index).padStart(2, "0")}`))
    await Promise.all([
      ...files.map((target) => writeFile(target, new Uint8Array(1))),
      ...directories.map(async (directory) => {
        await mkdir(directory)
        await writeFile(join(directory, "leaf.bin"), new Uint8Array(1))
      }),
    ])

    const options = {
      maxChildren: 2,
      preserveNames: ["dir-07"],
      sizeMode: "logical" as const,
    }
    const [local, worker] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
    ])

    expect(worker).toEqual(local)
    expect(local.children.map((child) => child.name)).toEqual(["dir-00", "dir-01", "dir-07", "Other (65 items)"])
    expect(local.children.at(-1)?.otherCount).toBe(65)
    expect(local.children.at(-1)?.children.map((child) => child.name)).toEqual([
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
    ])
  })

  it("retains the ancestry of developer artifacts hidden below a parent cutoff", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-preserve-branches-"))
    roots.push(root)
    const projects = Array.from({ length: 60 }, (_, index) => join(root, `project-${index}`, "node_modules"))
    await Promise.all(projects.map((path) => mkdir(path, { recursive: true })))
    await Promise.all(projects.map((path, index) => writeFile(join(path, `package-${index}.js`), new Uint8Array(1))))
    await Promise.all(
      Array.from({ length: 60 }, (_, index) => writeFile(join(root, `large-${index}.bin`), new Uint8Array(100))),
    )
    const options = {
      maxChildren: 2,
      maxDepth: 6,
      preserveNames: ["node_modules"],
      sizeMode: "logical" as const,
    }

    const [local, worker] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
    ])
    const retainedProjects = local.children.filter((child) => child.name.startsWith("project-"))

    expect(worker).toEqual(local)
    expect(retainedProjects).toHaveLength(60)
    expect(retainedProjects.every((project) => project.children.some((child) => child.name === "node_modules"))).toBe(
      true,
    )
    expect(local.size).toBe(6060)
  })

  it("collapses known artifact interiors until the user scans one directly", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-lazy-artifact-"))
    roots.push(root)
    const modules = join(root, "project", "node_modules")
    await mkdir(join(modules, "package", "nested"), { recursive: true })
    const moduleFile = join(modules, "package", "nested", "index.js")
    const changedAt = new Date("2022-04-05T12:00:00.000Z")
    await writeFile(moduleFile, new Uint8Array(31))
    await utimes(moduleFile, changedAt, changedAt)
    const options = {
      collapseNames: ["node_modules"],
      preserveNames: ["node_modules"],
      sizeMode: "logical" as const,
    }

    const [local, worker, focused] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
      scanPath(modules, { ...options, useWorker: true }),
    ])
    const collapsed = local.children[0].children[0]

    expect(worker).toEqual(local)
    expect(collapsed).toMatchObject({ name: "node_modules", size: 31, isCollapsed: true, children: [] })
    expect(Math.abs((collapsed.modifiedAt ?? 0) - changedAt.getTime())).toBeLessThan(2_000)
    expect(focused).toMatchObject({ name: "node_modules", size: 31 })
    expect(Math.abs((focused.modifiedAt ?? 0) - changedAt.getTime())).toBeLessThan(2_000)
    expect(focused.isCollapsed).toBeUndefined()
    expect(focused.children).not.toHaveLength(0)
  })

  it("retains only requested direct-entry signatures on collapsed build trees", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-build-signatures-"))
    roots.push(root)
    const target = join(root, "project", "target")
    await mkdir(join(target, "debug"), { recursive: true })
    await mkdir(join(target, "unrelated"), { recursive: true })
    await Promise.all([
      writeFile(join(target, ".rustc_info.json"), new Uint8Array(7)),
      writeFile(join(target, "debug", "app.bin"), new Uint8Array(23)),
      writeFile(join(target, "unrelated", "noise.bin"), new Uint8Array(11)),
    ])
    const options = {
      collapseNames: ["target"],
      preserveNames: ["target"],
      signatureNames: [".rustc_info.json", "debug", "release"],
      sizeMode: "logical" as const,
    }

    const [local, worker] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
    ])
    const collapsed = local.children[0].children[0]

    expect(worker).toEqual(local)
    expect(collapsed).toMatchObject({
      name: "target",
      size: 41,
      isCollapsed: true,
      children: [],
      signatures: [".rustc_info.json", "debug"],
    })
  })

  it("counts physical allocation and charges parallel hard links only once", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-hardlinks-"))
    roots.push(root)
    const primary = join(root, "primary.bin")
    await writeFile(primary, new Uint8Array(4096))
    await link(primary, join(root, "parallel.bin"))
    const stats = await stat(primary)
    const expectedPhysical = platform() === "win32" ? stats.size : stats.blocks * 512

    const [local, worker, logical] = await Promise.all([
      scanPathSync(root, { sizeMode: "physical" }),
      scanPath(root, { sizeMode: "physical", useWorker: true }),
      scanPathSync(root, { sizeMode: "logical" }),
    ])

    expect(worker.size).toBe(local.size)
    expect(worker).toEqual(local)
    expect(worker.children.map((child) => child.hardLink).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "primary",
      "secondary",
    ])
    expect(local.size).toBe(expectedPhysical)
    expect(local.logicalSize).toBe(stats.size * 2)
    expect(worker.logicalSize).toBe(stats.size * 2)
    expect(local.sharedStorageEvidence).toBe("partial")
    expect(worker.sharedStorageEvidence).toBe("partial")
    expect(local.children.every((child) => child.sharedStorageEvidence === undefined)).toBe(true)
    expect(local.children.map((child) => child.hardLink).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "primary",
      "secondary",
    ])
    expect(local.children.find((child) => child.name === "parallel.bin")).toMatchObject({
      hardLink: "primary",
      size: expectedPhysical,
    })
    expect(local.children.find((child) => child.name === "primary.bin")).toMatchObject({
      hardLink: "secondary",
      size: 0,
      logicalSize: stats.size,
    })
    expect(logical.size).toBe(stats.size * 2)
  })

  it("does not reassign a hard-link primary when the retained tree is incomplete", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-pruned-hardlinks-"))
    roots.push(root)
    const first = join(root, "first.bin")
    await writeFile(first, new Uint8Array(4096))
    await Promise.all([link(first, join(root, "second.bin")), link(first, join(root, "third.bin"))])
    const stats = await stat(first)
    const expectedPhysical = platform() === "win32" ? stats.size : stats.blocks * 512
    const options = { sizeMode: "physical" as const, maxChildren: 1, concurrency: 4 }

    const [local, worker] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
    ])

    // Only the charged member survives the cutoff; the filesystem says there
    // are three pathnames, so a lexical reallocation would be unproven.
    for (const result of [local, worker]) {
      expect(result.children).toHaveLength(1)
      expect(result.children[0]).toMatchObject({ hardLink: "primary", size: expectedPhysical })
      expect(result.size).toBe(expectedPhysical)
      expect(result.logicalSize).toBe(stats.size * 3)
    }
  })

  it("omits unavailable clone evidence rather than guessing from identical file content", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-clone-evidence-"))
    roots.push(root)
    await Promise.all([
      writeFile(join(root, "copy-a.bin"), new Uint8Array(37).fill(9)),
      writeFile(join(root, "copy-b.bin"), new Uint8Array(37).fill(9)),
    ])

    const [local, worker] = await Promise.all([
      scanPathSync(root, { sizeMode: "logical" }),
      scanPath(root, { sizeMode: "logical", useWorker: true }),
    ])

    expect(worker).toEqual(local)
    expect(local.size).toBe(74)
    expect(local.cloneMetadata).toEqual({ state: "unavailable", reason: "scanner" })
    expect(local.children.every((child) => child.clone === undefined)).toBe(true)
    expect(JSON.stringify(local)).not.toContain('"clone"')
  })

  it("does not mistake a sparse file's apparent length for occupied space", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-sparse-"))
    roots.push(root)
    const sparse = join(root, "sparse.bin")
    await writeFile(sparse, "")
    await truncate(sparse, 8 * 1024 * 1024)
    const stats = await stat(sparse)

    const physical = await scanPathSync(root, { sizeMode: "physical" })
    const logical = await scanPathSync(root, { sizeMode: "logical" })

    expect(physical.size).toBe(platform() === "win32" ? stats.size : stats.blocks * 512)
    expect(logical.size).toBe(stats.size)
  })

  it("does not cross explicitly excluded mount roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-mounts-"))
    roots.push(root)
    const mounted = join(root, "External")
    await mkdir(mounted)
    await Promise.all([
      writeFile(join(root, "local.bin"), new Uint8Array(23)),
      writeFile(join(mounted, "remote.bin"), new Uint8Array(41)),
    ])
    const options = { sizeMode: "logical" as const, excludePaths: [`${mounted}/`] }

    const [local, worker] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
    ])

    expect(worker).toEqual(local)
    expect(local.size).toBe(23)
    expect(local.children.map((child) => child.name)).toEqual(["local.bin"])
  })

  it("counts every byte below the visual depth limit", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-deep-"))
    roots.push(root)
    let leaf = root
    for (let depth = 0; depth < 18; depth++) leaf = join(leaf, `level-${depth}`)
    await mkdir(leaf, { recursive: true })
    await writeFile(join(leaf, "deep.bin"), new Uint8Array(37))

    const [local, worker] = await Promise.all([
      scanPathSync(root, { maxDepth: 1, sizeMode: "logical" }),
      scanPath(root, { maxDepth: 1, sizeMode: "logical", useWorker: true }),
    ])

    expect(worker).toEqual(local)
    expect(local.size).toBe(37)
  })

  it("indexes recognized developer artifacts beyond the visual map depth with conservative cleanup evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-artifact-inventory-"))
    roots.push(root)
    const project = join(root, "one", "two", "three", "project")
    const modules = join(project, "node_modules", "pkg")
    const rustTarget = join(project, "target", "debug")
    const genericBuild = join(project, "build")
    await Promise.all([
      mkdir(modules, { recursive: true }),
      mkdir(rustTarget, { recursive: true }),
      mkdir(genericBuild, { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(modules, "index.js"), new Uint8Array(13)),
      writeFile(join(project, "target", ".rustc_info.json"), new Uint8Array(7)),
      writeFile(join(rustTarget, "app"), new Uint8Array(17)),
      writeFile(join(genericBuild, "artifact.bin"), new Uint8Array(19)),
    ])

    const options = {
      maxDepth: 0,
      sizeMode: "logical" as const,
      developerArtifactInventory: { maxItems: 16 },
    }
    const [local, publicScan] = await Promise.all([
      scanPathSync(root, options),
      scanPath(root, { ...options, useWorker: true }),
    ])

    expect(publicScan).toEqual(local)
    const inventory = local.developerArtifactInventory
    expect(inventory?.status).toMatchObject({
      state: "complete",
      maxItems: 16,
      matchedDirectories: 3,
      truncated: false,
    })
    expect(inventory?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: join(project, "node_modules"),
          size: 13,
          kind: "dependencies",
          ecosystem: "node",
          confidence: "likely",
          cleanup: "review",
          inventoryOnly: true,
        }),
        expect.objectContaining({
          path: join(project, "target"),
          size: 24,
          kind: "build-output",
          ecosystem: "rust",
          confidence: "verified",
          cleanup: "eligible",
          signatures: [".rustc_info.json", "debug"],
        }),
        expect.objectContaining({
          path: genericBuild,
          size: 19,
          kind: "build-output",
          ecosystem: "generic",
          confidence: "ambiguous",
          cleanup: "review",
        }),
      ]),
    )
    const modulesArtifact = inventory?.items.find((item) => item.path === join(project, "node_modules"))
    expect(modulesArtifact?.directoryIdentity).toMatchObject({
      platform: platform() === "win32" ? "windows" : "posix",
      device: expect.any(String),
      fileId: expect.any(String),
      modifiedAt: expect.any(Number),
    })
  })

  it("promotes a conventional artifact to verified when sibling manifests corroborate it", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-artifact-markers-"))
    roots.push(root)
    const withManifest = join(root, "web")
    const bare = join(root, "stray")
    await Promise.all([
      mkdir(join(withManifest, "node_modules", "pkg"), { recursive: true }),
      mkdir(join(bare, "node_modules"), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(withManifest, "package.json"), new Uint8Array(1)),
      writeFile(join(withManifest, "package-lock.json"), new Uint8Array(1)),
      writeFile(join(withManifest, "node_modules", "pkg", "index.js"), new Uint8Array(5)),
      writeFile(join(bare, "node_modules", "index.js"), new Uint8Array(3)),
    ])

    const result = await scanPathSync(root, {
      maxDepth: 0,
      sizeMode: "logical",
      developerArtifactInventory: { maxItems: 8 },
    })
    const items = result.developerArtifactInventory?.items ?? []
    expect(items.find((item) => item.path === join(withManifest, "node_modules"))).toMatchObject({
      confidence: "verified",
      cleanup: "eligible",
      evidence: ["name:node_modules", "parent:package-lock.json", "parent:package.json"],
    })
    expect(items.find((item) => item.path === join(bare, "node_modules"))).toMatchObject({
      confidence: "likely",
      cleanup: "review",
      evidence: ["name:node_modules"],
    })
  })

  it("caps a deep developer artifact inventory while reporting omitted and skipped scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-artifact-cap-"))
    roots.push(root)
    const excluded = join(root, "excluded")
    const real = join(root, "real")
    await Promise.all([
      mkdir(join(root, "a", "node_modules"), { recursive: true }),
      mkdir(join(root, "b", "node_modules"), { recursive: true }),
      mkdir(join(root, "c", "node_modules"), { recursive: true }),
      mkdir(join(excluded, "node_modules"), { recursive: true }),
      mkdir(join(real, "node_modules"), { recursive: true }),
    ])
    await Promise.all([
      writeFile(join(root, "a", "node_modules", "a.js"), new Uint8Array(1)),
      writeFile(join(root, "b", "node_modules", "b.js"), new Uint8Array(1)),
      writeFile(join(root, "c", "node_modules", "c.js"), new Uint8Array(1)),
      writeFile(join(excluded, "node_modules", "excluded.js"), new Uint8Array(1)),
      writeFile(join(real, "node_modules", "real.js"), new Uint8Array(1)),
    ])
    if (platform() !== "win32") await symlink(real, join(root, "real-alias"), "dir")

    const result = await scanPathSync(root, {
      maxDepth: 0,
      sizeMode: "logical",
      excludePaths: [excluded],
      developerArtifactInventory: { maxItems: 2 },
    })
    const status = result.developerArtifactInventory?.status

    // The excluded subtree is intentionally not a match; the remaining four
    // material directories are observed, while only the bounded first two are retained.
    expect(status).toMatchObject({
      state: "partial",
      maxItems: 2,
      matchedDirectories: 4,
      truncated: true,
      excludedCount: 1,
    })
    expect(result.developerArtifactInventory?.items).toHaveLength(2)
    if (platform() !== "win32") {
      expect(status?.skippedSymlinkCount).toBe(1)
      expect(status?.skippedSymlinkSamplePaths).toEqual([join(root, "real-alias")])
    }
  })

  it("retains deterministic developer artifact top-K results in UTF-16 path order", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-artifact-top-k-"))
    roots.push(root)
    // JavaScript sorts U+1F600 by its high surrogate, before U+E000. This
    // regression prevents locale-sensitive ordering from diverging from the
    // native scanner under parallel discovery.
    const emoji = join(root, "😀", "node_modules")
    const privateUse = join(root, "\u{e000}", "node_modules")
    for (const directory of [emoji, privateUse]) {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, "index.js"), new Uint8Array(1))
    }

    for (let index = 0; index < 6; index++) {
      const result = await scanPathSync(root, {
        maxDepth: 0,
        sizeMode: "logical",
        developerArtifactInventory: { maxItems: 1 },
      })
      expect(result.developerArtifactInventory?.status).toMatchObject({
        matchedDirectories: 2,
        truncated: true,
      })
      expect(result.developerArtifactInventory?.items.map((item) => item.path)).toEqual([emoji])
    }
  })

  it("fails closed when developer inventory directory identity scope is unavailable", () => {
    const claimed = new Set(["7:1"])
    // Root identity unavailable or zero: never establish child scope from an
    // arbitrary descendant device.
    expect(canClaimDeveloperArtifactInventoryDirectory(false, undefined, claimed, 7n, 2n)).toBe(false)
    expect(canClaimDeveloperArtifactInventoryDirectory(true, 0n, claimed, 7n, 2n)).toBe(false)
    // A child without dev/inode and a cross-device child are both coverage
    // boundaries, not finite-depth recursive fallbacks.
    expect(canClaimDeveloperArtifactInventoryDirectory(true, 7n, claimed, 0n, 2n)).toBe(false)
    expect(canClaimDeveloperArtifactInventoryDirectory(true, 7n, claimed, 7n, 0n)).toBe(false)
    expect(canClaimDeveloperArtifactInventoryDirectory(true, 7n, claimed, 8n, 2n)).toBe(false)
    expect(canClaimDeveloperArtifactInventoryDirectory(true, 7n, claimed, 7n, 1n)).toBe(false)
    expect(canClaimDeveloperArtifactInventoryDirectory(true, 7n, claimed, 7n, 2n)).toBe(true)
  })

  it("keeps the visual map intact when developer inventory identity scope ends", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-inventory-scope-map-"))
    roots.push(root)
    const project = join(root, "project")
    const modules = join(project, "node_modules")
    await mkdir(modules, { recursive: true })
    await Promise.all([
      writeFile(join(root, "visible.bin"), new Uint8Array(3)),
      writeFile(join(modules, "index.js"), new Uint8Array(17)),
    ])

    const mapOptions = { maxDepth: 0, sizeMode: "logical" as const }
    const baseline = await scanPathSync(root, mapOptions)
    const mapShape = (node: { size: number; logicalSize?: number; children: readonly unknown[] }) => ({
      size: node.size,
      logicalSize: node.logicalSize,
      children: node.children,
    })
    const actualIdentity = async (targetPath: string) => {
      const info = await lstat(targetPath, { bigint: true })
      return {
        isDirectory: () => info.isDirectory(),
        isSymbolicLink: () => info.isSymbolicLink(),
        dev: info.dev,
        ino: info.ino,
        mtimeMs: info.mtimeMs,
      }
    }
    const inventoryOptions = (identityReader: typeof actualIdentity) =>
      ({
        ...mapOptions,
        developerArtifactInventory: { maxItems: 16 },
        // Private scanner test seam: production callers always use lstat.
        inventoryIdentityReader: identityReader,
      }) as Parameters<typeof scanPathSync>[1]

    const rootIdentityUnavailable = await scanPathSync(
      root,
      inventoryOptions(async (targetPath) => {
        const info = await actualIdentity(targetPath)
        return targetPath === root ? { ...info, ino: 0n } : info
      }),
    )
    expect(mapShape(rootIdentityUnavailable)).toEqual(mapShape(baseline))
    expect(rootIdentityUnavailable.developerArtifactInventory).toMatchObject({
      items: [],
      status: {
        state: "partial",
        skippedDirectoryCount: 1,
        skippedDirectorySamplePaths: [root],
      },
    })

    const childIdentityUnavailable = await scanPathSync(
      root,
      inventoryOptions(async (targetPath) => {
        const info = await actualIdentity(targetPath)
        return targetPath === project ? { ...info, ino: 0n } : info
      }),
    )
    expect(mapShape(childIdentityUnavailable)).toEqual(mapShape(baseline))
    expect(childIdentityUnavailable.developerArtifactInventory).toMatchObject({
      items: [],
      status: {
        state: "partial",
        skippedDirectoryCount: 1,
        skippedDirectorySamplePaths: [project],
      },
    })
  })

  it("marks a retained deep artifact partial when sealing its direct identity fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-inventory-identity-seal-"))
    roots.push(root)
    const modules = join(root, "project", "node_modules")
    await mkdir(modules, { recursive: true })
    await writeFile(join(modules, "index.js"), new Uint8Array(9))

    const actualIdentity = async (targetPath: string) => {
      const info = await lstat(targetPath, { bigint: true })
      return {
        isDirectory: () => info.isDirectory(),
        isSymbolicLink: () => info.isSymbolicLink(),
        dev: info.dev,
        ino: info.ino,
        mtimeMs: info.mtimeMs,
      }
    }
    let moduleReads = 0
    const result = await scanPathSync(root, {
      maxDepth: 0,
      sizeMode: "logical",
      developerArtifactInventory: { maxItems: 16 },
      // Simulate a directory which was safe to recurse into but changed
      // before the candidate's direct stale-delete identity was captured.
      inventoryIdentityReader: async (targetPath: string) => {
        const info = await actualIdentity(targetPath)
        if (targetPath === modules && ++moduleReads >= 2) return { ...info, ino: 0n }
        return info
      },
    } as Parameters<typeof scanPathSync>[1])

    const inventory = result.developerArtifactInventory
    expect(inventory?.items).toHaveLength(1)
    expect(inventory?.items[0]).toMatchObject({ path: modules })
    expect(inventory?.items[0]).not.toHaveProperty("directoryIdentity")
    expect(inventory?.status).toMatchObject({
      state: "partial",
      unavailableDirectoryIdentityCount: 1,
      unavailableDirectoryIdentitySamplePaths: [modules],
    })
  })

  it("reports unreadable subtrees instead of silently presenting a complete scan", async () => {
    if (platform() === "win32") return
    const root = await mkdtemp(join(tmpdir(), "disklizard-access-"))
    roots.push(root)
    const blocked = join(root, "private")
    await mkdir(blocked)
    await writeFile(join(blocked, "secret.bin"), new Uint8Array(41))
    await writeFile(join(root, "visible.bin"), new Uint8Array(23))
    await chmod(blocked, 0)

    try {
      const readable = await readdir(blocked).then(
        () => true,
        () => false,
      )
      if (readable) return

      const [local, worker] = await Promise.all([
        scanPathSync(root, { sizeMode: "logical" }),
        scanPath(root, { sizeMode: "logical", useWorker: true }),
      ])

      expect(worker).toEqual(local)
      expect(local.size).toBe(23)
      expect(local.scanIssues).toEqual({ unreadableCount: 1, samplePaths: [blocked] })
      const inventory = await scanPathSync(root, { sizeMode: "logical", developerArtifactInventory: true })
      expect(inventory.developerArtifactInventory?.status).toMatchObject({
        state: "partial",
        unreadableCount: 1,
        unreadableSamplePaths: [blocked],
      })
    } finally {
      await chmod(blocked, 0o700)
    }
  })

  it("maps a single dropped file as a valid scan target", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-file-"))
    roots.push(root)
    const target = join(root, "recording.MOV")
    await writeFile(target, new Uint8Array(29))

    const [local, worker] = await Promise.all([
      scanPathSync(target, { sizeMode: "logical" }),
      scanPath(target, { sizeMode: "logical", useWorker: true }),
    ])

    expect(worker).toEqual(local)
    expect(local).toMatchObject({ name: "recording.MOV", path: target, size: 29, isDir: false, ext: "mov" })
  })

  it("terminates a worker scan when cancelled", async () => {
    const root = await fixture()
    const controller = new AbortController()
    const scan = scanPath(root, { signal: controller.signal, useWorker: true })
    controller.abort(new Error("test cancellation"))

    const error = await scan.then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).toHaveProperty("message", "test cancellation")
  })

  it("rejects destructive paths that resolve through an alias into OS data", async () => {
    if (platform() === "win32") return
    const root = await mkdtemp(join(tmpdir(), "disklizard-alias-"))
    roots.push(root)
    const alias = join(root, "system-alias")
    await symlink("/etc", alias, "dir")

    const error = await assertSafeDeletionPath(join(alias, "hosts")).then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).toHaveProperty("message", expect.stringContaining("protected"))
  })

  it("fails closed when mount discovery is incomplete", async () => {
    const base = platform() === "darwin" ? homedir() : tmpdir()
    const root = await mkdtemp(join(base, ".disklizard-delete-safety-"))
    roots.push(root)
    const target = join(root, "candidate")
    await mkdir(target)
    const discovery: DriveDiscovery = { drives: [], mountRoots: [parse(target).root], complete: false }

    const error = await assertSafeDeletionPath(target, discovery).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(Error)
    expect(error).toHaveProperty("message", expect.stringContaining("could not be verified"))
    expect((await lstat(target)).isDirectory()).toBe(true)
  })

  it("blocks every discovered mount root, including roots hidden from the drive picker", async () => {
    const base = platform() === "darwin" ? homedir() : tmpdir()
    const root = await mkdtemp(join(base, ".disklizard-mount-safety-"))
    roots.push(root)
    const discovery: DriveDiscovery = {
      drives: [],
      mountRoots: [parse(root).root, root],
      complete: true,
    }

    const error = await assertSafeDeletionPath(root, discovery).then(
      () => null,
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(Error)
    expect(error).toHaveProperty("message", expect.stringContaining("mounted volume"))
    expect((await lstat(root)).isDirectory()).toBe(true)
  })

  it("tolerates ENOENT but propagates other filesystem validation errors", async () => {
    if (platform() === "win32") return
    const base = platform() === "darwin" ? homedir() : tmpdir()
    const root = await mkdtemp(join(base, ".disklizard-validation-errors-"))
    roots.push(root)
    const discovery: DriveDiscovery = { drives: [], mountRoots: [parse(root).root], complete: true }

    await expect(assertSafeDeletionPath(join(root, "already-gone"), discovery)).resolves.toBeUndefined()

    const loop = join(root, "loop")
    await symlink(loop, loop, "dir")
    const error = await assertSafeDeletionPath(join(loop, "child"), discovery).then(
      () => null,
      (reason: unknown) => reason,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).toHaveProperty("code", "ELOOP")
  })

  it("emits a final progress snapshot", async () => {
    const root = await fixture()
    const progress: Array<{ filesScanned: number; size: number; done?: boolean }> = []
    const result = await scanPath(root, {
      useWorker: true,
      onProgress: (event) => progress.push(event),
    })

    expect(progress.at(-1)).toMatchObject({ filesScanned: 4, size: result.size, done: true })
  })

  it("streams compact completed root branches without changing the final tree", async () => {
    const root = await fixture()
    const localDiscoveries: ScanDiscovery[] = []
    const workerDiscoveries: ScanDiscovery[] = []
    const options = { maxChildren: 100, maxDepth: 4, sizeMode: "logical" as const }

    const [local, worker] = await Promise.all([
      scanPathSync(root, {
        ...options,
        onProgress: (event) => {
          if (event.discovery) localDiscoveries.push(event.discovery)
        },
      }),
      scanPath(root, {
        ...options,
        useWorker: true,
        onProgress: (event) => {
          if (event.discovery) workerDiscoveries.push(event.discovery)
        },
      }),
    ])

    expect(worker).toEqual(local)
    expect(localDiscoveries.sort((a, b) => a.path.localeCompare(b.path))).toEqual(
      workerDiscoveries.sort((a, b) => a.path.localeCompare(b.path)),
    )
    expect(localDiscoveries).toHaveLength(local.children.length)
    expect(localDiscoveries.every((item) => !("children" in item) && item.size > 0)).toBe(true)
  })

  it("caps root-file discoveries so a flat folder cannot flood progress IPC", async () => {
    const root = await mkdtemp(join(tmpdir(), "disklizard-discovery-cap-"))
    roots.push(root)
    await Promise.all(
      Array.from({ length: 40 }, (_, index) => writeFile(join(root, `file-${index}.bin`), new Uint8Array(1))),
    )
    const counts: number[] = []

    await Promise.all(
      [false, true].map(async (useWorker) => {
        let discoveries = 0
        await scanPath(root, {
          useWorker,
          sizeMode: "logical",
          onProgress: (event) => {
            if (event.discovery) discoveries++
          },
        })
        counts.push(discoveries)
      }),
    )

    expect(counts).toEqual([24, 24])
  })
})
