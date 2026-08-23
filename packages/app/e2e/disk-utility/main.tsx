import { Font } from "@opencode-ai/ui/font"
import { I18nProvider, useI18n } from "@opencode-ai/ui/context/i18n"
import { dict as uiEn } from "@opencode-ai/ui/i18n/en"
import { ThemeProvider } from "@opencode-ai/ui/theme/context"
import { Toast } from "@opencode-ai/ui/toast"
import { render } from "solid-js/web"
import DiskUtilityPage from "../../src/pages/disk-utility"
import { DiskLizardRuntime } from "../../src/pages/disk-utility/runtime"
import type {
  DiskDeleteOptions,
  DiskScanNode,
  DiskScanProgress,
  DiskScanUpdate,
  DiskUtilityAPI,
} from "../../src/pages/disk-utility/types"
import "../../src/index.css"

const MIB = 1024 * 1024

const scanTree: DiskScanNode = {
  name: "Test volume",
  path: "/Users/alex",
  size: 640 * MIB,
  logicalSize: 640 * MIB,
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
  ],
}

type DeletedItem = { path: string; options: DiskDeleteOptions }
type FixtureState = {
  scans: string[]
  authorizationRequests: string[][]
  deleted: DeletedItem[]
  emitUpdate(update: DiskScanUpdate): void
  emitBuildCacheGrowth(): void
}

declare global {
  interface Window {
    diskLizardFixture: FixtureState
  }
}

const progressListeners = new Set<(progress: DiskScanProgress) => void>()
const updateListeners = new Set<(update: DiskScanUpdate) => void>()
const storage = new Map<string, string>()
let lastScanId = "fixture-scan"

const fixture: FixtureState = {
  scans: [],
  authorizationRequests: [],
  deleted: [],
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
    root.size = 680 * MIB
    root.logicalSize = 680 * MIB
    fixture.emitUpdate({
      scanId: lastScanId,
      rootPath: root.path,
      root,
      changedPaths: [cache.path],
    })
  },
}
window.diskLizardFixture = fixture

const diskUtility: DiskUtilityAPI = {
  async getDrives() {
    return [
      {
        path: "/Users/alex",
        name: "Test volume",
        label: "Test volume",
        total: 1024 * MIB,
        used: scanTree.size,
        free: 384 * MIB,
        type: "local",
        filesystem: "apfs",
      },
    ]
  },
  onDriveFacts() {
    return () => undefined
  },
  async getStorageDiagnostics() {
    return { access: { status: "not-applicable", probes: [] }, locations: [] }
  },
  async openDiskAccessSettings() {
    return false
  },
  async scanPath(path, _options, scanId = "fixture-scan") {
    lastScanId = scanId
    fixture.scans.push(path)
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
        size: scanTree.size,
        done: true,
        source: "scan",
      }),
    )
    return structuredClone(scanTree)
  },
  async cancelScan() {},
  async stopWatching() {},
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
              key: (index) => [...storage.keys()][index] ?? null,
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
