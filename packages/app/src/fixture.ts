import type {
  DiskDeleteOptions,
  DiskScanNode,
  DiskScanProgress,
  DiskScanUpdate,
  DiskUtilityAPI,
} from "@/pages/disk-utility/types"
import {
  DEMO_DRIVE_TOTAL,
  demoPreviousBaseline,
  demoScanTree,
  demoSubtree,
} from "./fixture-demo"
import { baselineStorageKey } from "@/pages/disk-utility/scan-baseline"

/**
 * Browser fixture: the demo data source that stood in for Electron IPC in the
 * v1 integration harness, powering the standalone v2 app.
 */

const MIB = 1024 * 1024

const denseFiles = Array.from({ length: 40 }, (_, index) => ({
  name: `small-${String(index + 1).padStart(2, "0")}.bin`,
  path: `/Users/alex/Dense/small-${String(index + 1).padStart(2, "0")}.bin`,
  size: MIB,
  logicalSize: MIB,
  modifiedAt: Date.UTC(2026, 7, 19),
  isDir: false,
  ext: ".bin",
  children: [],
})) satisfies DiskScanNode[]

const nestedWorkspacePath = "/Users/alex/Projects/nested-workspace"
const nestedPayloadPath = `${nestedWorkspacePath}/Payload`
const nestedWorkspaceTree: DiskScanNode = {
  name: "Nested workspace",
  path: nestedWorkspacePath,
  size: 16 * MIB,
  logicalSize: 16 * MIB,
  modifiedAt: Date.UTC(2026, 7, 23),
  cloneMetadata: { state: "available" },
  sharedStorageEvidence: "complete",
  isDir: true,
  ext: "",
  children: [
    {
      name: "Payload",
      path: nestedPayloadPath,
      size: 16 * MIB,
      logicalSize: 16 * MIB,
      modifiedAt: Date.UTC(2026, 7, 23),
      isDir: true,
      isCollapsed: true,
      ext: "",
      children: [],
    },
  ],
}

const nestedPayloadTree: DiskScanNode = {
  name: "Payload",
  path: nestedPayloadPath,
  size: 16 * MIB,
  logicalSize: 16 * MIB,
  modifiedAt: Date.UTC(2026, 7, 23),
  cloneMetadata: { state: "available" },
  sharedStorageEvidence: "complete",
  isDir: true,
  ext: "",
  children: [
    {
      name: "deep-artifact.bin",
      path: `${nestedPayloadPath}/deep-artifact.bin`,
      size: 16 * MIB,
      logicalSize: 16 * MIB,
      modifiedAt: Date.UTC(2026, 7, 23),
      isDir: false,
      ext: ".bin",
      children: [],
    },
  ],
}

const journeyScanTree: DiskScanNode = {
  name: "Test volume",
  path: "/Users/alex",
  size: 816 * MIB,
  logicalSize: 816 * MIB,
  modifiedAt: Date.UTC(2026, 7, 23),
  cloneMetadata: { state: "available" },
  sharedStorageEvidence: "complete",
  isDir: true,
  ext: "",
  children: [
    {
      name: "Build cache",
      path: "/Users/alex/Projects/sample/.cache",
      size: 360 * MIB,
      logicalSize: 360 * MIB,
      modifiedAt: Date.UTC(2026, 7, 22),
      isDir: true,
      ext: "",
      signatures: ["package.json"],
      children: [
        {
          name: "objects.bin",
          path: "/Users/alex/Projects/sample/.cache/objects.bin",
          size: 360 * MIB,
          logicalSize: 360 * MIB,
          modifiedAt: Date.UTC(2026, 7, 22),
          isDir: false,
          ext: ".bin",
          children: [],
        },
      ],
    },
    {
      name: "node_modules",
      path: "/Users/alex/Projects/web/node_modules",
      size: 120 * MIB,
      logicalSize: 120 * MIB,
      modifiedAt: Date.UTC(2026, 3, 14),
      isDir: true,
      ext: "",
      children: [
        {
          name: "left-pad",
          path: "/Users/alex/Projects/web/node_modules/left-pad",
          size: 120 * MIB,
          logicalSize: 120 * MIB,
          modifiedAt: Date.UTC(2026, 3, 14),
          isDir: false,
          ext: "",
          children: [],
        },
      ],
    },
    {
      name: "Archive.zip",
      path: "/Users/alex/Downloads/Archive.zip",
      size: 280 * MIB,
      logicalSize: 280 * MIB,
      modifiedAt: Date.UTC(2026, 7, 20),
      isDir: false,
      ext: ".zip",
      children: [],
    },
    {
      name: "Other (40 items)",
      path: "/Users/alex/__other__",
      size: 40 * MIB,
      logicalSize: 40 * MIB,
      modifiedAt: Date.UTC(2026, 7, 19),
      isDir: true,
      isOther: true,
      otherCount: 40,
      ext: "",
      children: denseFiles.slice(0, 2),
    },
    {
      name: "Nested workspace",
      path: nestedWorkspacePath,
      size: 16 * MIB,
      logicalSize: 16 * MIB,
      modifiedAt: Date.UTC(2026, 7, 23),
      isDir: true,
      isCollapsed: true,
      ext: "",
      children: [],
    },
  ],
}

// A browser-only QA journey with duplicate project names, a recent project,
// ambiguous output, and one simulated permission failure during a batch move.
// Theme overrides belong to this browser fixture, never the desktop bootstrap.
const fixtureTheme = new URLSearchParams(window.location.search).get("theme")
if (fixtureTheme === "light" || fixtureTheme === "dark")
  window.localStorage.setItem("disklizard-color-scheme", fixtureTheme)
const cleanupScenario =
  new URLSearchParams(window.location.search).get("fixture") === "cleanup"
const demoScenario =
  new URLSearchParams(window.location.search).get("fixture") === "demo"
const cleanupScenarioPaths = {
  work: "/Users/alex/Projects/web/node_modules",
  archive: "/Users/alex/Archive/web/node_modules",
  active: "/Users/alex/Projects/active/node_modules",
  ambiguous: "/Users/alex/Projects/notes/target",
}
const cleanupScenarioTree: DiskScanNode = {
  ...journeyScanTree,
  size: 320 * MIB,
  logicalSize: 320 * MIB,
  children: [
    {
      name: "node_modules",
      path: cleanupScenarioPaths.work,
      size: 120 * MIB,
      logicalSize: 120 * MIB,
      modifiedAt: Date.UTC(2025, 1, 4),
      isDir: true,
      ext: "",
      children: [],
    },
    {
      name: "node_modules",
      path: cleanupScenarioPaths.archive,
      size: 96 * MIB,
      logicalSize: 96 * MIB,
      modifiedAt: Date.UTC(2025, 0, 2),
      isDir: true,
      ext: "",
      children: [],
    },
    {
      name: "node_modules",
      path: cleanupScenarioPaths.active,
      size: 80 * MIB,
      logicalSize: 80 * MIB,
      modifiedAt: Date.UTC(2026, 8, 25),
      isDir: true,
      ext: "",
      children: [],
    },
    {
      name: "target",
      path: cleanupScenarioPaths.ambiguous,
      size: 24 * MIB,
      logicalSize: 24 * MIB,
      modifiedAt: Date.UTC(2024, 3, 1),
      isDir: true,
      ext: "",
      children: [],
    },
  ],
  developerArtifactInventory: {
    items: [
      ...[
        cleanupScenarioPaths.work,
        cleanupScenarioPaths.archive,
        cleanupScenarioPaths.active,
      ].map((path) => ({
        name: "node_modules",
        path,
        size:
          path === cleanupScenarioPaths.work
            ? 120 * MIB
            : path === cleanupScenarioPaths.archive
              ? 96 * MIB
              : 80 * MIB,
        isDir: true as const,
        kind: "dependencies" as const,
        ecosystem: "node" as const,
        confidence: "verified" as const,
        cleanup: "eligible" as const,
        evidence: ["name:node_modules", "parent:package.json"],
        inventoryOnly: true as const,
        modifiedAt:
          path === cleanupScenarioPaths.active
            ? Date.UTC(2026, 8, 25)
            : Date.UTC(2025, 0, 2),
      })),
      {
        name: "target",
        path: cleanupScenarioPaths.ambiguous,
        size: 24 * MIB,
        isDir: true,
        kind: "build-output",
        ecosystem: "generic",
        confidence: "ambiguous",
        cleanup: "review",
        evidence: ["name:target"],
        inventoryOnly: true,
        modifiedAt: Date.UTC(2024, 3, 1),
      },
    ],
    status: {
      state: "complete",
      maxItems: 2000,
      scannedDirectories: 16,
      matchedDirectories: 4,
      truncated: false,
      unreadableCount: 0,
      unreadableSamplePaths: [],
      skippedSymlinkCount: 0,
      skippedSymlinkSamplePaths: [],
      excludedCount: 0,
      excludedSamplePaths: [],
    },
  },
}

function expandedJourneyTree() {
  const root = structuredClone(journeyScanTree)
  root.children = [
    ...root.children.filter((node) => !node.isOther),
    ...structuredClone(denseFiles),
  ]
  return root
}

function countNodes(root: DiskScanNode) {
  let count = 0
  const pending = [root]
  while (pending.length > 0) {
    const node = pending.pop()!
    count += 1
    for (const child of node.children) pending.push(child)
  }
  return count
}

type DeletedItem = { path: string; options: DiskDeleteOptions }
export type FixtureState = {
  scans: string[]
  scanRequests: Array<{ path: string; scanId: string; maxChildren?: number }>
  stopWatchingRequests: Array<{ scanId?: string; retainTrustedSubtree?: true }>
  authorizationRequests: string[][]
  deleted: DeletedItem[]
  treeNodes: number
  emitUpdate(update: DiskScanUpdate): void
  emitBuildCacheGrowth(): void
  emitArchiveGrowth(): void
}

declare global {
  interface Window {
    diskLizardFixture: FixtureState
  }
}

const progressListeners = new Set<(progress: DiskScanProgress) => void>()
const updateListeners = new Set<(update: DiskScanUpdate) => void>()
const storage = new Map<string, string>()
if (demoScenario)
  storage.set(baselineStorageKey("/"), JSON.stringify(demoPreviousBaseline()))
let primaryScanId = "fixture-scan"

const fixture: FixtureState = {
  scans: [],
  scanRequests: [],
  stopWatchingRequests: [],
  authorizationRequests: [],
  deleted: [],
  treeNodes: countNodes(journeyScanTree),
  emitUpdate(update) {
    updateListeners.forEach((listener) => listener(structuredClone(update)))
  },
  emitBuildCacheGrowth() {
    const root = structuredClone(journeyScanTree)
    const cache = root.children.find((node) => node.name === "Build cache")
    if (!cache) throw new Error("Build cache fixture is missing")
    cache.size = 400 * MIB
    cache.logicalSize = 400 * MIB
    cache.children[0].size = 400 * MIB
    cache.children[0].logicalSize = 400 * MIB
    root.size = 736 * MIB
    root.logicalSize = 736 * MIB
    fixture.emitUpdate({
      scanId: primaryScanId,
      rootPath: root.path,
      root,
      changedPaths: [cache.path],
    })
  },
  emitArchiveGrowth() {
    const root = structuredClone(journeyScanTree)
    const archive = root.children.find((node) => node.name === "Archive.zip")
    if (!archive) throw new Error("Archive fixture is missing")
    archive.size = 300 * MIB
    archive.logicalSize = 300 * MIB
    root.size = 716 * MIB
    root.logicalSize = 716 * MIB
    fixture.emitUpdate({
      scanId: primaryScanId,
      rootPath: root.path,
      root,
      changedPaths: [archive.path],
    })
  },
}
window.diskLizardFixture = fixture

export const diskUtilityFixture: DiskUtilityAPI = {
  getHomePath: async () => "/Users/alex",
  async getDrives() {
    if (demoScenario) {
      const used = demoScanTree().size
      return [
        {
          path: "/",
          name: "Macintosh HD",
          label: "Macintosh HD",
          total: DEMO_DRIVE_TOTAL,
          used,
          free: DEMO_DRIVE_TOTAL - used,
          type: "local" as const,
          filesystem: "apfs",
        },
        {
          path: "/Volumes/Backup",
          name: "Backup",
          label: "Backup",
          total: 4 * 1024 ** 4,
          used: 2.9 * 1024 ** 4,
          free: 1.1 * 1024 ** 4,
          type: "removable" as const,
          filesystem: "apfs",
        },
      ]
    }
    const source = cleanupScenario ? cleanupScenarioTree : journeyScanTree
    const total = Math.max(1024 * MIB, Math.ceil(source.size * 1.25))
    return [
      {
        path: "/Users/alex",
        name: "Test volume",
        label: "Test volume",
        total,
        used: source.size,
        free: total - source.size,
        type: "local",
        filesystem: "apfs",
      },
    ]
  },
  onDriveFacts() {
    return () => undefined
  },
  async getStorageDiagnostics() {
    return {
      access: {
        status: "not-applicable",
        probes: [],
        wholeVolume: {
          capability: "not-applicable",
          status: "not-applicable",
          mapCoverage: "not-applicable",
          evidence: { source: "none" },
        },
      },
      locations: [],
    }
  },
  async openDiskAccessSettings() {
    return false
  },
  async scanPath(path, options, scanId = "fixture-scan") {
    if (!scanId.startsWith("expand-")) primaryScanId = scanId
    fixture.scans.push(path)
    fixture.scanRequests.push({
      path,
      scanId,
      ...(options?.maxChildren ? { maxChildren: options.maxChildren } : {}),
    })
    if (demoScenario) {
      const demo = path === "/" ? demoScanTree() : demoSubtree(path)
      if (demo) {
        if (!options?.maxChildren) {
          const steps = 28
          const finished = demo.children
            .filter((child) => child.size > 0)
            .toSorted((a, b) => a.size - b.size)
          for (let step = 1; step <= steps; step++) {
            await new Promise((resolve) => setTimeout(resolve, 100))
            const walk = demo.children.flatMap((child) => child.children)
            const discovery =
              finished[Math.floor(((step - 1) / steps) * finished.length)]
            const announced =
              step === steps ||
              step %
                Math.max(
                  1,
                  Math.floor(steps / Math.max(finished.length, 1))
                ) ===
                0
            progressListeners.forEach((listener) =>
              listener({
                scanId,
                filesScanned: Math.round((step / steps) * 1_284_331),
                dirsScanned: Math.round((step / steps) * 212_004),
                currentPath: walk[step % walk.length]?.path ?? path,
                size: Math.round((step / steps) * demo.size),
                percent: Math.round((step / steps) * 100),
                ...(announced && discovery
                  ? {
                      discovery: {
                        name: discovery.name,
                        path: discovery.path,
                        size: discovery.size,
                        isDir: discovery.isDir,
                      },
                    }
                  : {}),
                ...(step === steps
                  ? { done: true, source: "scan" as const }
                  : {}),
              })
            )
          }
          for (const discovery of finished)
            progressListeners.forEach((listener) =>
              listener({
                scanId,
                filesScanned: 1_284_331,
                currentPath: path,
                size: demo.size,
                discovery: {
                  name: discovery.name,
                  path: discovery.path,
                  size: discovery.size,
                  isDir: discovery.isDir,
                },
              })
            )
        }
        return demo
      }
    }
    progressListeners.forEach((listener) =>
      listener({
        scanId,
        filesScanned: 1,
        dirsScanned: 1,
        currentPath: `${path}/Projects`,
        size: 360 * MIB,
      })
    )
    await Promise.resolve()
    progressListeners.forEach((listener) =>
      listener({
        scanId,
        filesScanned: 2,
        dirsScanned: 2,
        currentPath: path,
        size: cleanupScenario ? cleanupScenarioTree.size : journeyScanTree.size,
        done: true,
        source: "scan",
      })
    )
    const source =
      path === nestedWorkspacePath
        ? nestedWorkspaceTree
        : path === nestedPayloadPath
          ? nestedPayloadTree
          : path === journeyScanTree.path && options?.maxChildren
            ? expandedJourneyTree()
            : cleanupScenario
              ? cleanupScenarioTree
              : journeyScanTree
    return structuredClone(source)
  },
  async cancelScan() {},
  async stopWatching(scanId, options) {
    if (options?.retainTrustedSubtree && !scanId) {
      throw new Error(
        "A focused scan ID is required to retain trusted subtree authority"
      )
    }
    fixture.stopWatchingRequests.push({
      ...(scanId ? { scanId } : {}),
      ...(options?.retainTrustedSubtree ? { retainTrustedSubtree: true } : {}),
    })
  },
  async authorizeDeletePaths(paths) {
    const requested = [...paths]
    fixture.authorizationRequests.push(requested)
    return requested.map((path, index) => ({
      path,
      authorization: `fixture-authorization-${index}`,
    }))
  },
  async deletePath(path, options) {
    if (cleanupScenario && path === cleanupScenarioPaths.archive)
      throw new Error("EACCES: access denied for this location")
    fixture.deleted.push({ path, options: structuredClone(options) })
    return { ok: true }
  },
  async previewPath() {
    return { kind: "unsupported", bytes: 0, reason: "format" }
  },
  async systemPreviewPath() {},
  async openPath() {},
  async openTrash() {},
  async revealPath() {},
  async chooseFolder() {
    return "/Users/alex"
  },
  onScanProgress(listener) {
    progressListeners.add(listener)
    return () => progressListeners.delete(listener)
  },
  onScanUpdate(listener) {
    updateListeners.add(listener)
    return () => updateListeners.delete(listener)
  },
}

export const fixtureStorage = () => ({
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
})
