import { Font } from "@opencode-ai/ui/font"
import { I18nProvider, useI18n } from "@opencode-ai/ui/context/i18n"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"
import { ThemeProvider } from "@opencode-ai/ui/theme/context"
import { Toast } from "@opencode-ai/ui/toast"
import { render } from "solid-js/web"
import { DiskLizardRuntime, DiskUtilityPage } from "@disklizard/app"
import type { DiskDeleteOptions, DiskScanNode, DiskScanProgress, DiskScanUpdate, DiskUtilityAPI } from "@disklizard/app"
import "@disklizard/app/styles.css"

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
  size: 696 * MIB,
  logicalSize: 696 * MIB,
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

function benchmarkScanTree(width: number): DiskScanNode {
  const modifiedAt = Date.UTC(2026, 7, 23)
  const directory = (level: number, indexes: readonly number[], parentPath: string): DiskScanNode => {
    const name = level === 1 ? `Workspace ${String(indexes.at(-1)).padStart(2, "0")}` : `Group ${indexes.join("-")}`
    const path = `${parentPath}/${name}`
    const children = Array.from({ length: width }, (_, index) => {
      const nextIndexes = [...indexes, index]
      if (level < 2) return directory(level + 1, nextIndexes, path)
      const size = (1 + (nextIndexes.reduce((sum, value) => sum * 31 + value, 0) % 16)) * MIB
      return {
        name: `artifact-${nextIndexes.join("-")}.bin`,
        path: `${path}/artifact-${nextIndexes.join("-")}.bin`,
        size,
        logicalSize: size,
        modifiedAt,
        isDir: false,
        ext: ".bin",
        children: [],
      } satisfies DiskScanNode
    })
    const size = children.reduce((total, child) => total + child.size, 0)
    return { name, path, size, logicalSize: size, modifiedAt, isDir: true, ext: "", children }
  }
  const children = Array.from({ length: width }, (_, index) => directory(1, [index], "/Users/alex"))
  const size = children.reduce((total, child) => total + child.size, 0)
  return {
    name: "Test volume",
    path: "/Users/alex",
    size,
    logicalSize: size,
    modifiedAt,
    cloneMetadata: { state: "available" },
    sharedStorageEvidence: "complete",
    isDir: true,
    ext: "",
    children,
  }
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

const fixtureParameters = new URLSearchParams(location.search)
const requestedWidth = Number(fixtureParameters.get("width") ?? 24)
const benchmarkWidth = Number.isInteger(requestedWidth) ? Math.min(32, Math.max(4, requestedWidth)) : 24
const benchmarkFixture = fixtureParameters.get("benchmark") === "1"
let scanTree = benchmarkFixture ? benchmarkScanTree(benchmarkWidth) : journeyScanTree
const scanTreeSize = scanTree.size
const scanTreePayloadBytes = new TextEncoder().encode(JSON.stringify(scanTree)).byteLength

type DeletedItem = { path: string; options: DiskDeleteOptions }
type FixtureState = {
  scans: string[]
  scanRequests: Array<{ path: string; scanId: string; maxChildren?: number }>
  stopWatchingRequests: Array<{ scanId?: string; retainTrustedSubtree?: true }>
  authorizationRequests: string[][]
  deleted: DeletedItem[]
  treeNodes: number
  payloadBytes: number
  emitUpdate(update: DiskScanUpdate): void
  emitBuildCacheGrowth(): void
  emitArchiveGrowth(): void
  holdNextScan(path: string): void
  releaseHeldScan(): void
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
let heldScanPath: string | undefined
let releaseHeldScan: (() => void) | undefined
let heldScanReleaseRequested = false

const fixture: FixtureState = {
  scans: [],
  scanRequests: [],
  stopWatchingRequests: [],
  authorizationRequests: [],
  deleted: [],
  treeNodes: countNodes(scanTree),
  payloadBytes: scanTreePayloadBytes,
  emitUpdate(update) {
    updateListeners.forEach((listener) => listener(structuredClone(update)))
  },
  emitBuildCacheGrowth() {
    const root = structuredClone(scanTree)
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
  holdNextScan(path) {
    heldScanPath = path
    heldScanReleaseRequested = false
  },
  releaseHeldScan() {
    if (releaseHeldScan) {
      releaseHeldScan()
      releaseHeldScan = undefined
    } else {
      heldScanReleaseRequested = true
    }
  },
}
window.diskLizardFixture = fixture

const diskUtility: DiskUtilityAPI = {
  async getDrives() {
    const total = Math.max(1024 * MIB, Math.ceil(scanTreeSize * 1.25))
    return [
      {
        path: "/Users/alex",
        name: "Test volume",
        label: "Test volume",
        total,
        used: scanTreeSize,
        free: total - scanTreeSize,
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
        size: scanTreeSize,
        done: true,
        source: "scan",
      }),
    )
    if (heldScanPath === path) {
      heldScanPath = undefined
      await new Promise<void>((resolve) => {
        if (heldScanReleaseRequested) {
          heldScanReleaseRequested = false
          resolve()
        } else {
          releaseHeldScan = resolve
        }
      })
    }
    const source =
      !benchmarkFixture && path === nestedWorkspacePath
        ? nestedWorkspaceTree
        : !benchmarkFixture && path === nestedPayloadPath
          ? nestedPayloadTree
          : !benchmarkFixture && path === journeyScanTree.path && options?.maxChildren
            ? expandedJourneyTree()
            : scanTree
    const result = structuredClone(source)
    // A real renderer receives one structured-cloned IPC payload; the source
    // tree stays in Electron main. Drop the benchmark fixture's renderer-side
    // source copy so retained-heap reporting measures the product state rather
    // than a test-only duplicate.
    if (benchmarkFixture) scanTree = journeyScanTree
    return result
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

const uiI18n = {
  locale: () => "en",
  t: (key: keyof typeof uiEn, params?: Record<string, string | number | boolean>) => {
    const value = uiEn[key] ?? String(key)
    if (!params) return value
    return value.replace(/{{\s*([^}]+?)\s*}}/g, (_, rawKey) => {
      const next = params[String(rawKey)]
      return next === undefined ? "" : String(next)
    })
  },
  plural: (key: Parameters<ReturnType<typeof useI18n>["plural"]>[0], count: number) => String(count) + String(key),
}

const root = document.getElementById("root")
if (!root) throw new Error("DiskLizard integration fixture root was not found")

render(
  () => (
    <ThemeProvider>
      <I18nProvider value={uiI18n}>
        <Font />
        <Toast.Region />
        <DiskLizardRuntime
          platform={{
            platform: "desktop",
            os: "macos",
            diskUtility,
            windowFullscreen: () => true,
            storage: () => ({
              getItem: (key) => storage.get(key) ?? null,
              setItem: (key, value) => storage.set(key, value),
              removeItem: (key) => storage.delete(key),
              clear: () => storage.clear(),
              key: (index: number) => [...storage.keys()][index] ?? null,
              get length() {
                return storage.size
              },
            }),
          }}
        >
          <DiskUtilityPage />
        </DiskLizardRuntime>
      </I18nProvider>
    </ThemeProvider>
  ),
  root,
)
