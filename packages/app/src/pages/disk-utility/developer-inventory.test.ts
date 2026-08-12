import { describe, expect, it } from "bun:test"
import type { DeveloperArtifact, DeveloperArtifactInventory } from "@opencode-ai/disklizard"
import type { DiskScanNode } from "@/context/platform"
import {
  developerArtifactFromInventoryNode,
  developerInventoryCollectionNodeForPath,
  developerInventoryDeletePrecondition,
  developerInventoryNeedsRefresh,
  developerInventoryRootsNeedRefresh,
  developerInventoryNode,
  isDeveloperInventoryNode,
} from "./developer-inventory"
import {
  computeDeveloperSummaryWithInventory,
  developerArtifactCleanupReadiness,
  isSmartCleanupEligible,
  matchesDeveloperArtifact,
  recognize,
} from "./recognize"

function dir(name: string, path: string, size: number, children: DiskScanNode[] = []): DiskScanNode {
  return { name, path, size, isDir: true, children, ext: "" }
}

function artifact(overrides: Partial<DeveloperArtifact> = {}): DeveloperArtifact {
  return {
    name: "node_modules",
    path: "/repo/node_modules",
    size: 80,
    isDir: true,
    kind: "dependencies",
    ecosystem: "node",
    confidence: "verified",
    cleanup: "eligible",
    evidence: ["name:node_modules"],
    inventoryOnly: true,
    ...overrides,
  }
}

function inventory(items: DeveloperArtifact[]): DeveloperArtifactInventory {
  return {
    items,
    status: {
      state: "complete",
      maxItems: 2_000,
      scannedDirectories: 12,
      matchedDirectories: items.length,
      truncated: false,
      unreadableCount: 0,
      unreadableSamplePaths: [],
      skippedSymlinkCount: 0,
      skippedSymlinkSamplePaths: [],
      excludedCount: 0,
      excludedSamplePaths: [],
    },
  }
}

describe("deep developer artifact inventory", () => {
  it("marks synthetic list nodes and preserves the scanner's exact recognition posture", () => {
    const source = artifact({ kind: "toolchain-cache", ecosystem: "rust", confidence: "likely", cleanup: "review" })
    const node = developerInventoryNode(source)

    expect(isDeveloperInventoryNode(node)).toBe(true)
    expect(developerArtifactFromInventoryNode(node)).toMatchObject(source)
    expect(recognize(node)).toMatchObject({
      developer: "toolchain-cache",
      ecosystem: "rust",
      confidence: "likely",
      cleanup: "review",
      safety: "system",
    })
  })

  it("keeps deep artifacts under agent and VCS worktrees protected from Smart Cleanup", () => {
    const identity = { platform: "posix" as const, device: "1", fileId: "42", modifiedAt: 1_700_000_000_000 }
    for (const path of [
      "/Users/alex/.codex/worktrees/feature/node_modules",
      "/code/project/.git/worktrees/feature/node_modules",
    ]) {
      const node = developerInventoryNode(artifact({ path, directoryIdentity: identity }))
      const recognition = recognize(node)

      expect(recognition).toMatchObject({ safety: "version-control", cleanup: "protected" })
      expect(developerArtifactCleanupReadiness(recognition)).toBe("protected")
      expect(isSmartCleanupEligible(node, recognition)).toBe(false)
    }
  })

  it("keeps a precise cache whitelist eligible outside protected ancestry", () => {
    const identity = { platform: "posix" as const, device: "1", fileId: "42", modifiedAt: 1_700_000_000_000 }
    const node = developerInventoryNode(
      artifact({
        name: "caches",
        path: "/Users/alex/.gradle/caches",
        kind: "toolchain-cache",
        ecosystem: "jvm",
        directoryIdentity: identity,
      }),
    )
    const recognition = recognize(node)

    expect(recognition).toMatchObject({ tag: "Gradle cache", safety: "cache", cleanup: "eligible", ecosystem: "jvm" })
    expect(isSmartCleanupEligible(node, recognition)).toBe(true)
  })

  it("requires scanner-captured direct-directory identity before a deep record can move to Trash", () => {
    const withoutIdentity = developerInventoryNode(artifact())
    const identity = { platform: "posix" as const, device: "1", fileId: "42", modifiedAt: 1_700_000_000_000 }
    const withIdentity = developerInventoryNode(
      artifact({ directoryIdentity: identity, kind: "toolchain-cache", ecosystem: "rust", cleanup: "review" }),
    )

    expect(developerInventoryDeletePrecondition(withoutIdentity)).toBeUndefined()
    expect(developerInventoryDeletePrecondition(withIdentity)).toEqual({
      kind: "developer-artifact",
      directoryIdentity: identity,
      artifact: {
        name: "node_modules",
        kind: "toolchain-cache",
        ecosystem: "rust",
        confidence: "verified",
        cleanup: "review",
      },
    })
  })

  it("prunes an identity-less deep row when a shared review basket is rebased", () => {
    const path = "/repo/deep/node_modules"
    const staleTree: DiskScanNode = {
      ...dir("repo", "/repo", 80),
      developerArtifactInventory: inventory([artifact({ path })]),
    }
    const identity = { platform: "posix" as const, device: "1", fileId: "42", modifiedAt: 1_700_000_000_000 }
    const refreshedTree: DiskScanNode = {
      ...dir("repo", "/repo", 80),
      developerArtifactInventory: inventory([artifact({ path, directoryIdentity: identity })]),
    }

    expect(developerInventoryCollectionNodeForPath(staleTree, path)).toBeUndefined()
    expect(developerInventoryCollectionNodeForPath(refreshedTree, path)).toMatchObject({
      path,
      inventoryOnly: true,
      directoryIdentity: identity,
    })
  })

  it("prefers a materialized map node when the deep inventory repeats its exact path", () => {
    const visible = dir("node_modules", "/repo/client/node_modules", 80)
    const root: DiskScanNode = {
      ...dir("repo", "/repo", 100, [visible]),
      developerArtifactInventory: inventory([
        artifact({ path: visible.path, size: visible.size }),
        artifact({ path: "/repo/server/node_modules", size: 20 }),
      ]),
    }

    const summary = computeDeveloperSummaryWithInventory(root)
    expect(summary.totalBytes).toBe(100)
    expect(summary.totalCount).toBe(2)
    expect(summary.items.map(({ node, bytes }) => [node.path, bytes])).toEqual([
      ["/repo/client/node_modules", 80],
      ["/repo/server/node_modules", 20],
    ])
    expect(isDeveloperInventoryNode(summary.items[0].node)).toBe(false)
    expect(isDeveloperInventoryNode(summary.items[1].node)).toBe(true)
  })

  it("splits a review-only visible parent around a precise eligible deep child without double counting", () => {
    const build = dir("build", "/repo/build", 100)
    const root: DiskScanNode = {
      ...dir("repo", "/repo", 100, [build]),
      developerArtifactInventory: inventory([artifact({ path: "/repo/build/node_modules", size: 60 })]),
    }

    const summary = computeDeveloperSummaryWithInventory(root)
    expect(summary.totalBytes).toBe(100)
    expect(summary.items.map(({ node, bytes }) => [node.path, bytes])).toEqual([
      ["/repo/build/node_modules", 60],
      ["/repo/build", 40],
    ])
  })

  it("does not add a nested inventory record underneath an already eligible visible root", () => {
    const dependencies = dir("node_modules", "/repo/node_modules", 100)
    const root: DiskScanNode = {
      ...dir("repo", "/repo", 100, [dependencies]),
      developerArtifactInventory: inventory([
        artifact({ path: "/repo/node_modules/.next", name: ".next", size: 40, kind: "build-output" }),
      ]),
    }

    const summary = computeDeveloperSummaryWithInventory(root)
    expect(summary).toMatchObject({ totalBytes: 100, totalCount: 1 })
    expect(summary.items[0].node.path).toBe("/repo/node_modules")
  })

  it("does not subtract an already-accounted visible Gradle cache twice", () => {
    const caches = dir("caches", "/repo/.gradle/caches", 70)
    const gradle = dir(".gradle", "/repo/.gradle", 100, [caches])
    const root: DiskScanNode = {
      ...dir("repo", "/repo", 100, [gradle]),
      developerArtifactInventory: inventory([
        artifact({
          name: "caches",
          path: caches.path,
          size: caches.size,
          kind: "toolchain-cache",
          ecosystem: "jvm",
        }),
      ]),
    }

    const summary = computeDeveloperSummaryWithInventory(root)

    expect(summary.totalBytes).toBe(100)
    expect(Object.fromEntries(summary.items.map(({ node, bytes }) => [node.path, bytes]))).toMatchObject({
      "/repo/.gradle/caches": 70,
      "/repo/.gradle": 30,
    })
  })

  it("keeps agent/worktree remainders intact when a new deep artifact is added", () => {
    const worktrees = dir("worktrees", "/repo/.codex/worktrees", 20)
    const codex = dir(".codex", "/repo/.codex", 50, [worktrees])
    const root: DiskScanNode = {
      ...dir("repo", "/repo", 50, [codex]),
      developerArtifactInventory: inventory([artifact({ path: "/repo/.codex/cache/node_modules", size: 15 })]),
    }

    const summary = computeDeveloperSummaryWithInventory(root)

    expect(summary.totalBytes).toBe(50)
    expect(Object.fromEntries(summary.items.map(({ node, bytes }) => [node.path, bytes]))).toMatchObject({
      "/repo/.codex/worktrees": 20,
      "/repo/.codex/cache/node_modules": 15,
      "/repo/.codex": 15,
    })
  })

  it("keeps scanner ecosystem and modification evidence available to the normal Developer filters", () => {
    const now = Date.UTC(2026, 7, 11)
    const root: DiskScanNode = {
      ...dir("repo", "/repo", 80),
      developerArtifactInventory: inventory([
        artifact({ path: "/repo/deep/node_modules", modifiedAt: now - 45 * 24 * 60 * 60 * 1_000 }),
      ]),
    }

    const item = computeDeveloperSummaryWithInventory(root).items[0]
    expect(matchesDeveloperArtifact(item, { ecosystem: "node", readiness: "eligible", minAgeDays: 30 }, now)).toBe(true)
    expect(matchesDeveloperArtifact(item, { ecosystem: "python" }, now)).toBe(false)
  })

  it("keeps a root with zero deep matches as a valid coverage carrier", () => {
    const root: DiskScanNode = {
      ...dir("repo", "/repo", 0),
      developerArtifactInventory: {
        ...inventory([]),
        status: {
          ...inventory([]).status,
          state: "partial",
          unreadableCount: 1,
          unreadableSamplePaths: ["/repo/private"],
        },
      },
    }

    expect(computeDeveloperSummaryWithInventory(root)).toEqual({ totalBytes: 0, totalCount: 0, buckets: [], items: [] })
    expect(root.developerArtifactInventory?.status).toMatchObject({ state: "partial", unreadableCount: 1 })
  })

  it("requires a fresh root map for any deletion inside an inventory-enabled root", () => {
    const root: DiskScanNode = {
      ...dir("repo", "/repo", 100),
      developerArtifactInventory: inventory([artifact({ path: "/repo/build/node_modules", size: 60 })]),
    }

    expect(developerInventoryNeedsRefresh(root, [dir("build", "/repo/build", 100)])).toBe(true)
    expect(developerInventoryNeedsRefresh(root, [dir("package-lock.json", "/repo/package-lock.json", 1, [])])).toBe(true)
    expect(developerInventoryNeedsRefresh(root, [dir("other", "/other", 1)])).toBe(false)

    const cappedRoot: DiskScanNode = {
      ...root,
      developerArtifactInventory: {
        ...root.developerArtifactInventory!,
        status: { ...root.developerArtifactInventory!.status, state: "partial", truncated: true },
      },
    }
    expect(developerInventoryNeedsRefresh(cappedRoot, [dir("unretained", "/repo/unretained", 1)])).toBe(true)
  })

  it("checks every retained root when a shared cross-tab basket deletes an item", () => {
    const currentRoot = dir("current", "/current", 1)
    const backgroundRoot: DiskScanNode = {
      ...dir("repo", "/repo", 100),
      developerArtifactInventory: inventory([artifact({ path: "/repo/deep/node_modules", size: 80 })]),
    }

    expect(
      developerInventoryRootsNeedRefresh(
        [currentRoot, backgroundRoot],
        [dir("package-lock.json", "/repo/package-lock.json", 1)],
      ),
    ).toBe(true)
  })
})
