import type {
  DiskDeleteOptions,
  DiskScanNode,
  DiskScanProgress,
  DiskScanUpdate,
  DiskUtilityAPI,
} from "@/pages/disk-utility/types"

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

function expandedJourneyTree() {
  const root = structuredClone(journeyScanTree)
  root.children = [...root.children.filter((node) => !node.isOther), ...structuredClone(denseFiles)]
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
  async getDrives() {
    const total = Math.max(1024 * MIB, Math.ceil(journeyScanTree.size * 1.25))
    return [
      {
        path: "/Users/alex",
        name: "Test volume",
        label: "Test volume",
        total,
        used: journeyScanTree.size,
        free: total - journeyScanTree.size,
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
    fixture.scanRequests.push({ path, scanId, ...(options?.maxChildren ? { maxChildren: options.maxChildren } : {}) })
    progressListeners.forEach((listener) =>
      listener({ scanId, filesScanned: 1, dirsScanned: 1, currentPath: `${path}/Projects`, size: 360 * MIB }),
    )
    await Promise.resolve()
    progressListeners.forEach((listener) =>
      listener({
        scanId,
        filesScanned: 2,
        dirsScanned: 2,
        currentPath: path,
        size: journeyScanTree.size,
        done: true,
        source: "scan",
      }),
    )
    const source =
      path === nestedWorkspacePath
        ? nestedWorkspaceTree
        : path === nestedPayloadPath
          ? nestedPayloadTree
          : path === journeyScanTree.path && options?.maxChildren
            ? expandedJourneyTree()
            : journeyScanTree
    return structuredClone(source)
  },
  async cancelScan() {},
  async stopWatching(scanId, options) {
    if (options?.retainTrustedSubtree && !scanId) {
      throw new Error("A focused scan ID is required to retain trusted subtree authority")
    }
    fixture.stopWatchingRequests.push({
      ...(scanId ? { scanId } : {}),
      ...(options?.retainTrustedSubtree ? { retainTrustedSubtree: true } : {}),
    })
  },
  async authorizeDeletePaths(paths) {
    const requested = [...paths]
    fixture.authorizationRequests.push(requested)
    return requested.map((path, index) => ({ path, authorization: `fixture-authorization-${index}` }))
  },
  async deletePath(path, options) {
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
