/**
 * DiskLizard — the disk utility built into OpenCode.
 *
 * A DaisyDisk-inspired sunburst map (rendered in OKLCH) paired with a ranked list,
 * all in OpenCode's theme. The signature trick: a "Reclaim" engine that recognizes
 * well-known space hogs (node_modules, caches, build output, Trash…) and surfaces a
 * live, non-double-counted total of space you can get back — with one-tap review.
 *
 * Motion stays out of the reactive render path; the canvas and small numeric
 * transitions run directly on requestAnimationFrame.
 */

import { Button } from "@opencode-ai/ui/button"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { createVirtualizer } from "@tanstack/solid-virtual"
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  untrack,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform, type DiskDriveInfo, type DiskFilePreview, type DiskScanNode } from "@/context/platform"
import { useSettings } from "@/context/settings"
import { Sunburst, primarySegmentColor, sunburstEntryDuration, type SunburstEntryIntent } from "./sunburst"
import { Treemap } from "./TreemapPanel"
import { ScanFormation } from "./ScanFormation"
import { CollectionDropTarget } from "./CollectionDropTarget"
import { PinnedLocationCard } from "./PinnedLocationCard"
import { PreviewDialog } from "./PreviewDialog"
import { animateCount, createSurfacePresence, type SurfacePhase } from "./motion"
import { mergeScanDiscoveries, type ScanDiscovery } from "./scan-progress"
import {
  computeDeveloperSummary,
  computeDormantDeveloperSummary,
  computeReclaim,
  developerArtifactContext,
  recognize,
  type DeveloperCategory,
  type DeveloperSummary,
  type ReclaimSummary,
} from "./recognize"
import { formatBytes, formatLastChanged, isDormant, shortBytes, formatPct, formatCount, truncatePath } from "./format"
import { SAFETY_ACCENT, SIZE_BAR_TONES, usageStroke } from "./ui-tokens"
import {
  actionableReclaimSummary,
  asBrowseableRoot,
  canActOnNode,
  diskPathEquals,
  driveForPath,
  includeHiddenSpace,
  isPinnedScanLocation,
  replaceScanSubtree,
  removeScanSubtrees,
  runDeletionBatch,
  togglePinnedScanLocation,
  uniqueDeletionRoots,
  withoutDeletedNodes,
} from "./storage"
import {
  buildCrumbs,
  describeStorageNode,
  nativeTrashName,
  scanAccessGuidance,
  shouldHandleDiskShortcut,
  type Crumb,
} from "./navigation"

type ViewMode = "drives" | "scan"
type ScanMode = "map" | "list" | "grid"
type IndexLens = "all" | "developer" | "cleanup"
type DeveloperCategoryFilter = DeveloperCategory | "all" | "dormant"
type Entry = { node: DiskScanNode; index: number; displaySize: number }
type DeletionProgress = { completed: number; total: number }
type ReclaimReviewRow =
  | { type: "header"; key: string; bucket: ReclaimSummary["buckets"][number] }
  | {
      type: "item"
      key: string
      item: ReclaimSummary["buckets"][number]["items"][number]
      first: boolean
      last: boolean
    }
type ScanTab = {
  id: string
  label: string
  sourcePath: string
  tree: DiskScanNode
  view: DiskScanNode
  drive?: DiskDriveInfo
}

const IMPORTANT_PRESERVE_NAMES = [
  "$recycle.bin",
  ".trash",
  ".trashes",
  "trash",
  "windows.old",
  "pagefile.sys",
  "hiberfil.sys",
  "swapfile.sys",
  "lost+found",
  "node_modules",
  "bower_components",
  "jspm_packages",
  "__pycache__",
  "target",
  "build",
  "dist",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".gradle",
  ".m2",
  ".ivy2",
  ".cargo",
  ".rustup",
  ".nuget",
  ".npm",
  ".pnpm-store",
  ".yarn",
  ".bun",
  ".docker",
  ".dart_tool",
  "deriveddata",
  "coresimulator",
  ".venv",
  ".git",
  ".worktrees",
  "worktrees",
  ".codex",
  ".claude",
  ".opencode",
  "opencode",
  ".cursor",
  ".continue",
  ".aider",
] as const

const DEVELOPER_COLLAPSE_NAMES = [
  "node_modules",
  "bower_components",
  "jspm_packages",
  "__pycache__",
  "target",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".npm",
  ".pnpm-store",
  ".dart_tool",
  "deriveddata",
  "coresimulator",
  ".rustup",
  ".docker",
  ".venv",
  ".git",
] as const

/** Bounded direct-entry evidence retained while large developer trees stay collapsed. */
const DEVELOPER_SIGNATURE_NAMES = [
  ".rustc_info.json",
  "debug",
  "release",
  "classes",
  "test-classes",
  "generated-sources",
  "surefire-reports",
  "generated",
  "kotlin",
  "tmp",
  "resources",
  "reports",
  "libs",
  "intermediates",
  "cmakefiles",
  "cmakecache.txt",
  "build.ninja",
  "caches",
  "wrapper",
  "daemon",
] as const

const DEVELOPER_CATEGORY_LABEL: Record<DeveloperCategory, string> = {
  dependencies: "Dependencies",
  "build-output": "Build output",
  "toolchain-cache": "Toolchains & caches",
  "agent-data": "Coding agents",
  worktree: "Worktrees",
  "version-control": "Version history",
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const { promise: timed, resolve, reject } = Promise.withResolvers<T>()
  const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  promise.then(
    (v) => {
      clearTimeout(timer)
      resolve(v)
    },
    (e) => {
      clearTimeout(timer)
      reject(e)
    },
  )
  return timed
}

function isVisualAggregate(node: DiskScanNode | null | undefined) {
  return !!node?.path.startsWith("disklizard:orbit-more:") || !!node?.path.startsWith("disklizard:mosaic-more:")
}

export default function DiskUtilityPage() {
  const platform = usePlatform()
  const settings = useSettings()
  const isDesktop = () => platform.platform === "desktop"
  const disk = () => (platform.platform === "desktop" ? platform.diskUtility : undefined)

  const [view, setView] = createSignal<ViewMode>("drives")
  const [scanMode, setScanMode] = createSignal<ScanMode>("map")
  const [drives, setDrives] = createSignal<DiskDriveInfo[]>([])
  const [drivesLoading, setDrivesLoading] = createSignal(false)
  const [drivesError, setDrivesError] = createSignal<string>()
  const [scanDrive, setScanDrive] = createSignal<DiskDriveInfo>()

  const [treeRoot, setTreeRoot] = createSignal<DiskScanNode | null>(null)
  const [viewNode, setViewNode] = createSignal<DiskScanNode | null>(null)
  const [scanSourcePath, setScanSourcePath] = createSignal("")
  const [scanLabel, setScanLabel] = createSignal("")
  const [scanning, setScanning] = createSignal(false)
  const [scanFiles, setScanFiles] = createSignal(0)
  const [scanTotal, setScanTotal] = createSignal(0)
  const [scanPct, setScanPct] = createSignal(0)
  const [scanBytes, setScanBytes] = createSignal(0)
  const [scanTail, setScanTail] = createSignal("")
  const [scanDiscoveries, setScanDiscoveries] = createSignal<ScanDiscovery[]>([])
  const [selectedPath, setSelectedPath] = createSignal<string>()
  const [hoveredPath, setHoveredPath] = createSignal<string | null>(null)
  const [visualHoverNode, setVisualHoverNode] = createSignal<DiskScanNode | null>(null)
  const [focusIdx, setFocusIdx] = createSignal(0)
  const [pendingDelete, setPendingDelete] = createSignal<DiskScanNode | null>(null)
  const [deleting, setDeleting] = createSignal(false)
  const [deletionProgress, setDeletionProgress] = createSignal<DeletionProgress | null>(null)
  const [query, setQuery] = createSignal("")
  const [indexFilter, setIndexFilter] = createStore<{
    lens: IndexLens
    developerCategory: DeveloperCategoryFilter
  }>({ lens: "all", developerCategory: "all" })
  const reviewSurface = createSurfacePresence()
  const collectionSurface = createSurfacePresence()
  const deleteSurface = createSurfacePresence()
  const previewSurface = createSurfacePresence()
  const [previewTarget, setPreviewTarget] = createSignal<DiskScanNode | null>(null)
  const [filePreview, setFilePreview] = createSignal<DiskFilePreview>()
  const [previewLoading, setPreviewLoading] = createSignal(false)
  const [previewError, setPreviewError] = createSignal<string>()
  const [tabs, setTabs] = createSignal<ScanTab[]>([])
  const [collection, setCollection] = createSignal<DiskScanNode[]>([])
  const [dropActive, setDropActive] = createSignal(false)
  const [collectionDragNode, setCollectionDragNode] = createSignal<DiskScanNode | null>(null)
  const [collectionDropActive, setCollectionDropActive] = createSignal(false)
  const [focusedScan, setFocusedScan] = createSignal<{ label: string } | null>(null)

  const [canvasEl, setCanvasEl] = createSignal<HTMLCanvasElement | undefined>()
  const [sunburst, setSunburst] = createSignal<Sunburst | undefined>()
  let scanUnsub: (() => void) | undefined
  let scanUpdateUnsub: (() => void) | undefined
  let scanToken = 0
  let previewToken = 0
  let scanMaxBytes = 0
  let orbitEntryIntent: SunburstEntryIntent = "scan-complete"
  let dragDepth = 0
  let collectionDragPreview!: HTMLDivElement
  let scrollIndexIntoView: ((index: number) => void) | undefined

  const crumbs = createMemo(() => buildCrumbs(treeRoot(), viewNode()))
  const reclaim = createMemo<ReclaimSummary>(() => actionableReclaimSummary(computeReclaim(treeRoot()), platform.os))
  const developer = createMemo<DeveloperSummary>(() => computeDeveloperSummary(treeRoot()))
  const dormantDeveloper = createMemo(() => computeDormantDeveloperSummary(developer()))
  const parentSize = createMemo(() => viewNode()?.size ?? 0)
  const parentCount = createMemo(() => viewNode()?.children?.length ?? 0)
  const sizeBasisLabel = createMemo(() =>
    platform.os === "windows" || scanDrive()?.type === "network" ? "apparent size" : "physical size",
  )

  const sortedChildren = createMemo<DiskScanNode[]>(() => {
    const node = viewNode()
    if (!node) return []
    return [...(node.children ?? [])].sort((a, b) => b.size - a.size)
  })
  const entries = createMemo<Entry[]>(() => {
    const q = query().trim().toLowerCase()
    const nodes: { node: DiskScanNode; displaySize: number }[] =
      indexFilter.lens === "developer"
        ? (indexFilter.developerCategory === "dormant"
            ? dormantDeveloper().items
            : developer().items.filter(
                ({ recognition }) =>
                  indexFilter.developerCategory === "all" || recognition.developer === indexFilter.developerCategory,
              )
          ).map(({ node, bytes }) => ({ node, displaySize: bytes }))
        : indexFilter.lens === "cleanup"
          ? reclaim()
              .buckets.flatMap((bucket) => bucket.items.map(({ node }) => node))
              .sort((a, b) => b.size - a.size)
              .map((node) => ({ node, displaySize: node.size }))
          : sortedChildren().map((node) => ({ node, displaySize: node.size }))
    const filtered = q
      ? nodes.filter(({ node }) => `${node.name}\n${node.path}\n${recognize(node).tag ?? ""}`.toLowerCase().includes(q))
      : nodes
    return filtered.map(({ node, displaySize }, index) => ({ node, displaySize, index }))
  })
  const selectedNode = createMemo(() => {
    const path = selectedPath()
    if (!path) return null
    return entries().find(({ node }) => node.path === path)?.node ?? null
  })
  const previewableEntries = createMemo(() =>
    entries()
      .map(({ node }) => node)
      .filter((node) => !node.isDir && !node.isOther && !node.isHidden),
  )
  const previewPosition = createMemo(() => {
    const target = previewTarget()
    if (!target) return -1
    return previewableEntries().findIndex((node) => diskPathEquals(node.path, target.path, platform.os))
  })
  const developerBucket = createMemo(() =>
    indexFilter.developerCategory === "all" || indexFilter.developerCategory === "dormant"
      ? undefined
      : developer().buckets.find((bucket) => bucket.category === indexFilter.developerCategory),
  )
  const indexSize = createMemo(() =>
    indexFilter.lens === "developer"
      ? indexFilter.developerCategory === "dormant"
        ? dormantDeveloper().bytes
        : (developerBucket()?.bytes ?? (indexFilter.developerCategory === "all" ? developer().totalBytes : 0))
      : indexFilter.lens === "cleanup"
        ? reclaim().totalBytes
        : parentSize(),
  )
  const indexCount = createMemo(() =>
    indexFilter.lens === "developer"
      ? indexFilter.developerCategory === "dormant"
        ? dormantDeveloper().count
        : (developerBucket()?.count ?? (indexFilter.developerCategory === "all" ? developer().totalCount : 0))
      : indexFilter.lens === "cleanup"
        ? reclaim().totalCount
        : parentCount(),
  )
  const effectiveCollection = createMemo(() => uniqueDeletionRoots(collection(), platform.os))
  const pinnedLocations = settings.general.diskPinnedLocations
  const currentScanPinned = createMemo(() => {
    const path = scanSourcePath()
    return !!path && isPinnedScanLocation(pinnedLocations(), path, platform.os)
  })
  const collectionSize = createMemo(() => effectiveCollection().reduce((s, n) => s + n.size, 0))
  const driveTotals = createMemo(() =>
    drives().reduce(
      (total, drive) => ({
        capacity: total.capacity + drive.total,
        used: total.used + drive.used,
        free: total.free + drive.free,
      }),
      { capacity: 0, used: 0, free: 0 },
    ),
  )
  /** The node the sunburst center + list header should describe right now. */
  const focusNode = createMemo<DiskScanNode | null>(() => {
    const visual = visualHoverNode()
    if (visual) return visual
    const h = hoveredPath()
    if (h) {
      const hit = entries().find(({ node }) => node.path === h)?.node
      if (hit) return hit
    }
    const s = selectedNode()
    if (s) return s
    return viewNode()
  })
  const activeDialog = createMemo(() =>
    deleteSurface.mounted()
      ? "delete"
      : collectionSurface.mounted()
        ? "collection"
        : reviewSurface.mounted()
          ? "reclaim"
          : previewSurface.mounted()
            ? "preview"
            : null,
  )
  const selectionAnnouncement = createMemo(() => describeStorageNode(selectedNode(), parentSize()))

  createEffect(() => {
    if (!activeDialog()) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    onCleanup(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    })
  })

  onMount(() => {
    const api = disk()
    if (!api) return
    void loadDrives()
    scanUpdateUnsub = api.onScanUpdate((update) => {
      if (view() !== "scan" || !diskPathEquals(update.rootPath, scanSourcePath(), platform.os)) return
      const previousViewPath = viewNode()?.path
      const previousSelection = selectedPath()
      const tree = includeHiddenSpace(asBrowseableRoot(update.root), scanDrive())
      tree._label = scanLabel() || tree.name
      const nextView = previousViewPath ? findScanNode(tree, previousViewPath) : undefined
      const nextSelection = previousSelection ? findScanNode(tree, previousSelection) : undefined
      batch(() => {
        setTreeRoot(tree)
        setViewNode(nextView ?? tree)
        setSelectedPath(nextSelection?.path)
        setHoveredPath(null)
        setVisualHoverNode(null)
        setCollection((items) =>
          items.flatMap((item) => {
            const refreshed = findScanNode(tree, item.path)
            return refreshed ? [refreshed] : []
          }),
        )
      })
    })
  })

  // (Re)create the sunburst when its canvas mounts.
  createEffect(() => {
    const el = canvasEl()
    if (!el) {
      setSunburst(undefined)
      return
    }
    const sb = new Sunburst(el, {
      rings: 4,
      maxSegments: 960,
      padAngle: 0.0028,
      ringGap: 0.004,
      enterAnimMs: sunburstEntryDuration(orbitEntryIntent),
      canDrag: canModifyNode,
      onHover: (seg) => {
        setVisualHoverNode(seg?.node ?? null)
        setHoveredPath(seg?.path ?? null)
      },
      onClick: (seg) => {
        setVisualHoverNode(seg.node)
        if (isVisualAggregate(seg.node)) {
          chooseScanMode("list")
          return
        }
        const wasSelected = untrack(selectedPath) === seg.path
        selectPath(seg.path)
        if (wasSelected && seg.node.isDir && !seg.node.isOther && (seg.node.isCollapsed || seg.node.children?.length)) {
          drill(seg.node)
        }
      },
      onCenterClick: () => goUp(),
    })
    const root = treeRoot()
    if (root) sb.setData(root, viewNode(), orbitEntryIntent === "keyboard")
    orbitEntryIntent = "scan-complete"
    setSunburst(sb)
    onCleanup(() => {
      sb.destroy()
      setSunburst((cur) => (cur === sb ? undefined : cur))
    })
  })

  // Re-feed data when a fresh scan completes while the canvas is already mounted.
  createEffect(() => {
    const root = treeRoot()
    const sb = sunburst()
    if (root && sb && sb.root !== root) sb.updateData(root, viewNode())
  })

  onCleanup(() => {
    scanUnsub?.()
    scanUpdateUnsub?.()
    if (scanning()) void disk()?.cancelScan()
    else void disk()?.stopWatching()
    sunburst()?.destroy()
  })

  function findScanNode(root: DiskScanNode, targetPath: string): DiskScanNode | undefined {
    if (diskPathEquals(root.path, targetPath, platform.os)) return root
    for (const child of root.children) {
      const match = findScanNode(child, targetPath)
      if (match) return match
    }
    return undefined
  }

  async function loadDrives() {
    const api = disk()
    if (!api) return
    setDrivesLoading(true)
    setDrivesError(undefined)
    try {
      const list = await withTimeout(api.getDrives(), 8000, "Listing drives")
      setDrives(list)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setDrivesError(message)
      setDrives([])
      showToast({ variant: "error", title: "Could not list drives", description: message })
    } finally {
      setDrivesLoading(false)
    }
  }

  async function chooseAndScan() {
    const api = disk()
    if (!api) return
    const path = await api.chooseFolder()
    if (path) await startScan(path, path.split(/[/\\]/).pop() || path, driveForPath(path, drives(), platform.os))
  }

  /** Snapshot the current completed scan as a background tab before replacing it. */
  function saveCurrentTab() {
    const root = treeRoot()
    if (!root) return
    setTabs((prev) => [
      ...prev,
      {
        id: `tab-${Date.now()}-${prev.length}`,
        label: scanLabel() || root.name,
        sourcePath: scanSourcePath() || root.path,
        tree: root,
        view: viewNode() ?? root,
        drive: scanDrive(),
      },
    ])
  }

  /** Restore a background tab into the live state, saving the current one first. */
  function switchToTab(id: string) {
    if (scanning()) return
    const tab = tabs().find((t) => t.id === id)
    if (!tab) return
    saveCurrentTab()
    setTabs((prev) => prev.filter((t) => t.id !== id))
    setTreeRoot(tab.tree)
    setViewNode(tab.view)
    setScanSourcePath(tab.sourcePath)
    setScanLabel(tab.label)
    setScanDrive(tab.drive)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    setIndexFilter({ lens: "all", developerCategory: "all" })
    setFocusIdx(0)
  }

  function closeTab(id: string) {
    setTabs((prev) => prev.filter((t) => t.id !== id))
  }

  function scannerOptions(drive?: DiskDriveInfo) {
    return {
      // Materialize the visible map only; deeper branches remain exact-sized
      // aggregate nodes and are expanded on demand.
      maxDepth: 6,
      sizeMode: platform.os === "windows" || drive?.type === "network" ? ("logical" as const) : ("physical" as const),
      preserveNames: [...IMPORTANT_PRESERVE_NAMES],
      collapseNames: [...DEVELOPER_COLLAPSE_NAMES],
      signatureNames: [...DEVELOPER_SIGNATURE_NAMES],
    }
  }

  async function startScan(path: string, label: string, drive?: DiskDriveInfo, preserveCurrent = true) {
    const api = disk()
    if (!api) return
    scanUnsub?.()
    if (preserveCurrent) saveCurrentTab()
    const token = ++scanToken
    orbitEntryIntent = "scan-complete"
    setFocusedScan(null)
    setView("scan")
    setScanning(true)
    setScanLabel(label)
    setScanFiles(0)
    const isVolumeRoot = !!drive && diskPathEquals(path, drive.path, platform.os)
    setScanTotal(isVolumeRoot ? drive.used : 0)
    setScanPct(0)
    setScanBytes(0)
    setScanDiscoveries([])
    scanMaxBytes = 0
    setScanTail("")
    setTreeRoot(null)
    setViewNode(null)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    setIndexFilter({ lens: "all", developerCategory: "all" })
    setFocusIdx(0)
    setScanDrive(drive)
    setScanSourcePath(path)
    scanUnsub = api.onScanProgress((p) => {
      if (token !== scanToken) return
      setScanFiles(p.filesScanned)
      setScanTail(p.currentPath)
      const discovery = p.discovery
      if (discovery) setScanDiscoveries((current) => mergeScanDiscoveries(current, discovery))
      if (p.size > scanMaxBytes) {
        scanMaxBytes = p.size
        setScanBytes(scanMaxBytes)
        if (isVolumeRoot && drive.used) setScanPct(Math.min(99, (scanMaxBytes / drive.used) * 100))
      }
    })
    try {
      const scannedTree = await api.scanPath(path, scannerOptions(drive))
      if (token !== scanToken) return // superseded or cancelled
      const tree = includeHiddenSpace(asBrowseableRoot(scannedTree), drive)
      tree._label = label
      setScanPct(100)
      setTreeRoot(tree)
      setViewNode(tree)
    } catch (err) {
      if (token !== scanToken) return
      const message = err instanceof Error ? err.message : String(err)
      showToast({ variant: "error", title: "Scan failed", description: message })
      setView("drives")
      setScanSourcePath("")
      setScanLabel("")
      setScanDrive(undefined)
    } finally {
      if (token === scanToken) {
        setScanning(false)
        scanUnsub?.()
        scanUnsub = undefined
      }
    }
  }

  async function expandCollapsedNode(node: DiskScanNode) {
    const api = disk()
    const root = treeRoot()
    if (!api || !root) return
    scanUnsub?.()
    const token = ++scanToken
    orbitEntryIntent = "scan-complete"
    const drive = driveForPath(node.path, drives(), platform.os) ?? scanDrive()
    setFocusedScan({ label: node.name })
    setScanning(true)
    setScanFiles(0)
    setScanTotal(0)
    setScanPct(0)
    setScanBytes(0)
    setScanDiscoveries([])
    scanMaxBytes = 0
    setScanTail("")
    scanUnsub = api.onScanProgress((progress) => {
      if (token !== scanToken) return
      setScanFiles(progress.filesScanned)
      setScanTail(progress.currentPath)
      if (progress.discovery) setScanDiscoveries((current) => mergeScanDiscoveries(current, progress.discovery!))
      if (progress.size <= scanMaxBytes) return
      scanMaxBytes = progress.size
      setScanBytes(scanMaxBytes)
    })

    try {
      const replacement = asBrowseableRoot(await api.scanPath(node.path, scannerOptions(drive)))
      if (token !== scanToken) return
      const nextRoot = replaceScanSubtree(root, node.path, replacement, platform.os)
      if (nextRoot === root) throw new Error("The folder changed while it was being mapped. Try opening it again.")
      setScanPct(100)
      setTreeRoot(nextRoot)
      setViewNode(replacement)
      setCollection((items) =>
        items.map((item) => (diskPathEquals(item.path, node.path, platform.os) ? replacement : item)),
      )
      setIndexFilter({ lens: "all", developerCategory: "all" })
      setSelectedPath(undefined)
      setHoveredPath(null)
      setQuery("")
      setFocusIdx(0)
    } catch (error) {
      if (token !== scanToken) return
      showToast({
        variant: "error",
        title: `Could not open ${node.name}`,
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (token === scanToken) {
        setFocusedScan(null)
        setScanning(false)
        scanUnsub?.()
        scanUnsub = undefined
      }
    }
  }

  async function rescanCurrent() {
    const api = disk()
    const root = treeRoot()
    if (!api || !root) return
    let drive = scanDrive()
    if (drive) {
      try {
        const list = await withTimeout(api.getDrives(), 8000, "Refreshing drive totals")
        setDrives(list)
        drive = list.find((candidate) => candidate.path === drive?.path) ?? drive
      } catch {
        // A scan is still useful when a removable/network drive cannot refresh its capacity metadata.
      }
    }
    await startScan(scanSourcePath() || root.path, scanLabel(), drive, false)
  }

  /** Abort a focused expansion in place; primary scans return to the volume list. */
  function cancelScan() {
    const focused = focusedScan()
    scanToken++
    scanUnsub?.()
    scanUnsub = undefined
    void disk()?.cancelScan()
    setFocusedScan(null)
    setScanning(false)
    if (!focused) backToDrives()
  }

  function drill(node: DiskScanNode, instant = false) {
    if (scanning() || !node.isDir || node.isOther) return
    if (node.isCollapsed) {
      void expandCollapsedNode(node)
      return
    }
    sunburst()?.navigateTo(node, instant)
    setViewNode(node)
    setIndexFilter({ lens: "all", developerCategory: "all" })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    setFocusIdx(0)
  }

  function chooseLens(lens: IndexLens) {
    setIndexFilter({ lens, developerCategory: "all" })
    setQuery("")
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    if (lens !== "all") setScanMode("list")
    scrollIndexIntoView?.(0)
  }

  function chooseDeveloperCategory(category: DeveloperCategoryFilter) {
    setIndexFilter("developerCategory", category)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    scrollIndexIntoView?.(0)
  }

  function updateQuery(value: string) {
    setQuery(value)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    scrollIndexIntoView?.(0)
  }

  function chooseScanMode(mode: ScanMode, intent: Exclude<SunburstEntryIntent, "scan-complete"> = "pointer") {
    if (mode === "map" && scanMode() !== "map") orbitEntryIntent = intent
    setScanMode(mode)
    setVisualHoverNode(null)
    setHoveredPath(null)
    if (mode !== "list") setIndexFilter({ lens: "all", developerCategory: "all" })
  }

  function togglePinnedLocation(path: string, label: string) {
    const wasPinned = isPinnedScanLocation(pinnedLocations(), path, platform.os)
    const next = togglePinnedScanLocation(pinnedLocations(), { path, label }, platform.os)
    if (!wasPinned && !isPinnedScanLocation(next, path, platform.os)) {
      showToast({
        variant: "default",
        title: "Pinned scans are full",
        description: "Unpin a location before adding another.",
      })
      return
    }
    settings.general.setDiskPinnedLocations(next)
    showToast({
      variant: "default",
      title: wasPinned ? "Removed from pinned scans" : "Pinned for next time",
      description: label,
    })
  }

  function goUp(instant = false) {
    if (scanning()) {
      cancelScan()
      return
    }
    const list = crumbs()
    if (list.length <= 1) {
      backToDrives()
      return
    }
    const parent = list[list.length - 2]
    if (parent?.node) {
      sunburst()?.navigateTo(parent.node, instant)
      setViewNode(parent.node)
      setSelectedPath(undefined)
      setHoveredPath(null)
      setFocusIdx(0)
    } else {
      backToDrives()
    }
  }

  function backToDrives(preserveCurrent = true) {
    if (preserveCurrent) saveCurrentTab()
    void disk()?.stopWatching()
    setView("drives")
    setTreeRoot(null)
    setViewNode(null)
    setScanSourcePath("")
    setScanLabel("")
    setScanDrive(undefined)
    setSelectedPath(undefined)
    setHoveredPath(null)
    void loadDrives()
  }

  function goToCrumb(crumb: Crumb) {
    if (crumb.node && !scanning()) {
      sunburst()?.navigateTo(crumb.node)
      setViewNode(crumb.node)
      setSelectedPath(undefined)
      setHoveredPath(null)
      setFocusIdx(0)
    }
  }

  function selectPath(path: string) {
    setSelectedPath(path)
    sunburst()?.setSelected(path)
    const idx = entries().findIndex((e) => e.node.path === path)
    if (idx >= 0) setFocusIdx(idx)
  }

  function hoverEntry(path: string | null) {
    setVisualHoverNode(null)
    setHoveredPath(path)
    sunburst()?.setHighlight(path)
  }

  function moveFocus(delta: number) {
    const list = entries()
    if (!list.length) return
    let i = focusIdx() + delta
    if (i < 0) i = list.length - 1
    if (i >= list.length) i = 0
    setFocusIdx(i)
    selectPath(list[i].node.path)
    scrollIndexIntoView?.(i)
  }

  function openFocused() {
    const node = selectedNode()
    if (!node) return
    if (node.isDir && !node.isOther) drill(node, true)
    else if (!node.isOther) void openPreview(node)
  }

  async function reveal(path: string) {
    const api = disk()
    if (!api) return
    try {
      await api.revealPath(path)
    } catch (err) {
      showToast({
        variant: "error",
        title: "Could not reveal",
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async function openPreview(node: DiskScanNode) {
    const api = disk()
    if (!api || node.isDir || node.isOther || node.isHidden) return
    const token = ++previewToken
    batch(() => {
      setPreviewTarget(node)
      setFilePreview(undefined)
      setPreviewError(undefined)
      setPreviewLoading(true)
    })
    previewSurface.open()
    try {
      const preview = await api.previewPath(node.path)
      if (token !== previewToken) return
      setFilePreview(preview)
    } catch (error) {
      if (token !== previewToken) return
      setPreviewError(error instanceof Error ? error.message : String(error))
    } finally {
      if (token === previewToken) setPreviewLoading(false)
    }
  }

  function closePreview() {
    previewToken++
    previewSurface.closeThen(() => {
      batch(() => {
        setPreviewTarget(null)
        setFilePreview(undefined)
        setPreviewError(undefined)
        setPreviewLoading(false)
      })
    })
  }

  function previewAdjacent(delta: number) {
    const next = previewableEntries()[previewPosition() + delta]
    if (!next) return
    selectPath(next.path)
    void openPreview(next)
  }

  async function openInDefaultApp(node: DiskScanNode) {
    try {
      await platform.openPath?.(node.path)
    } catch (error) {
      showToast({
        variant: "error",
        title: "Could not open file",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function viewAfterDeletion(
    previousRoot: DiskScanNode,
    nextRoot: DiskScanNode,
    previousView: DiskScanNode,
    removed: readonly DiskScanNode[],
  ) {
    const survivor = withoutDeletedNodes(
      buildCrumbs(previousRoot, previousView).map((crumb) => crumb.node),
      removed,
      platform.os,
    ).at(-1)
    return survivor ? (buildCrumbs(nextRoot, survivor).at(-1)?.node ?? nextRoot) : nextRoot
  }

  function applyDeletedNodes(removed: readonly DiskScanNode[]) {
    if (!removed.length) return
    setCollection((items) => withoutDeletedNodes(items, removed, platform.os))
    setTabs((items) =>
      items.flatMap((tab) => {
        const tree = removeScanSubtrees(tab.tree, removed, platform.os)
        if (!tree) return []
        if (tree === tab.tree) return [tab]
        return [{ ...tab, tree, view: viewAfterDeletion(tab.tree, tree, tab.view, removed) }]
      }),
    )

    const root = treeRoot()
    const view = viewNode()
    if (!root || !view) return
    const tree = removeScanSubtrees(root, removed, platform.os)
    if (!tree) {
      backToDrives(false)
      return
    }
    if (tree === root) return
    batch(() => {
      setTreeRoot(tree)
      setViewNode(viewAfterDeletion(root, tree, view, removed))
      setSelectedPath(undefined)
      setHoveredPath(null)
      setVisualHoverNode(null)
      setFocusIdx(0)
    })
  }

  async function trashNode(node: DiskScanNode) {
    const api = disk()
    if (!api || !canModifyNode(node)) return
    setDeleting(true)
    try {
      await api.deletePath(node.path)
      applyDeletedNodes([node])
      showToast({
        variant: "success",
        title: `Moved to ${nativeTrashName(platform.os)}`,
        description: node.name,
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: "Delete failed",
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setDeleting(false)
    }
  }

  async function confirmDelete() {
    const node = pendingDelete()
    if (!node) return
    deleteSurface.closeThen(() => setPendingDelete(null))
    await trashNode(node)
  }

  function requestDelete(node: DiskScanNode) {
    if (!canModifyNode(node)) {
      showToast({
        variant: "default",
        title: "Protected item",
        description:
          "DiskLizard protects system paths, configuration-bearing developer data, worktrees, and version history from direct removal.",
      })
      return
    }
    setPendingDelete(node)
    deleteSurface.open()
  }

  function toggleCollect(node: DiskScanNode) {
    if (!canModifyNode(node)) return
    setCollection((prev) => {
      const exists = prev.some((item) => diskPathEquals(item.path, node.path, platform.os))
      return exists ? prev.filter((item) => !diskPathEquals(item.path, node.path, platform.os)) : [...prev, node]
    })
  }

  function collectNodes(nodes: readonly DiskScanNode[]) {
    const actionable = nodes.filter(canModifyNode)
    if (!actionable.length) return
    setCollection((prev) => uniqueDeletionRoots([...prev, ...actionable], platform.os))
  }

  function removeCollected(node: DiskScanNode) {
    const next = collection().filter((item) => !diskPathEquals(item.path, node.path, platform.os))
    setCollection(next)
    if (!uniqueDeletionRoots(next, platform.os).length) collectionSurface.close()
  }

  function canModifyNode(node: DiskScanNode) {
    if (!canActOnNode(node, platform.os)) return false
    const recognition = recognize(node)
    return recognition.safety !== "system" && recognition.safety !== "version-control"
  }
  const isCollected = (path: string) => collection().some((node) => diskPathEquals(node.path, path, platform.os))
  function clearCollection() {
    setCollection([])
  }

  function beginCollectionDrag(event: DragEvent, node: DiskScanNode | null) {
    if (!node || !canModifyNode(node) || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    setCollectionDragNode(node)
    setCollectionDropActive(false)
    event.dataTransfer.effectAllowed = "copy"
    event.dataTransfer.setData("application/x-disklizard-path", node.path)
    event.dataTransfer.setData("text/plain", node.path)
    collectionDragPreview.textContent = `${node.name} · ${shortBytes(node.size)}`
    event.dataTransfer.setDragImage(collectionDragPreview, 18, 18)
  }

  function endCollectionDrag() {
    setCollectionDragNode(null)
    setCollectionDropActive(false)
  }

  function collectionDragEnter(event: DragEvent) {
    if (!collectionDragNode()) return
    event.preventDefault()
    event.stopPropagation()
    setCollectionDropActive(true)
  }

  function collectionDragOver(event: DragEvent) {
    if (!collectionDragNode()) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    setCollectionDropActive(true)
  }

  function collectionDragLeave(event: DragEvent) {
    if (!collectionDragNode()) return
    event.stopPropagation()
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget instanceof HTMLElement && event.currentTarget.contains(next)) return
    setCollectionDropActive(false)
  }

  function collectDroppedNode(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    const node = collectionDragNode()
    if (node) collectNodes([node])
    endCollectionDrag()
  }
  async function deleteCollected() {
    const api = disk()
    const items = effectiveCollection()
    if (!api || !items.length) return
    setDeleting(true)
    setDeletionProgress({ completed: 0, total: items.length })
    try {
      let completed = 0
      const { removed, failed } = await runDeletionBatch(
        items,
        async (node) => {
          try {
            return await api.deletePath(node.path)
          } finally {
            completed++
            setDeletionProgress({ completed, total: items.length })
          }
        },
        platform.os,
      )
      if (removed.length) {
        applyDeletedNodes(removed)
        showToast({
          variant: "success",
          title: `Cleared ${formatBytes(removed.reduce((sum, node) => sum + node.size, 0))}`,
          description: `${removed.length} ${removed.length === 1 ? "item" : "items"} moved to ${nativeTrashName(platform.os)}`,
        })
      }
      setCollection(failed.map(({ node }) => node))
      if (failed.length) collectionSurface.open()
      else collectionSurface.close()
      if (failed.length) {
        const first = failed[0].error
        showToast({
          variant: "error",
          title: `${failed.length} ${failed.length === 1 ? "item" : "items"} could not be removed`,
          description: first instanceof Error ? first.message : String(first),
        })
      }
    } finally {
      setDeleting(false)
      setDeletionProgress(null)
    }
  }

  function onDragEnter(event: DragEvent) {
    if (activeDialog() || !event.dataTransfer?.types.includes("Files")) return
    event.preventDefault()
    dragDepth++
    setDropActive(true)
  }

  function onDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes("Files")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }

  function onDragLeave(event: DragEvent) {
    if (!event.dataTransfer?.types.includes("Files")) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) setDropActive(false)
  }

  async function onDrop(event: DragEvent) {
    event.preventDefault()
    dragDepth = 0
    setDropActive(false)
    if (activeDialog()) return
    const file = event.dataTransfer?.files.item(0)
    const path = file && platform.getPathForFile?.(file)
    if (!file || !path) {
      showToast({ variant: "error", title: "Could not read dropped item" })
      return
    }
    if ((event.dataTransfer?.files.length ?? 0) > 1) {
      showToast({ variant: "default", title: "Mapping the first dropped item", description: file.name })
    }
    await startScan(path, file.name || path.split(/[/\\]/).pop() || path, driveForPath(path, drives(), platform.os))
  }

  // Keyboard navigation
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeDialog()) {
        if (e.key === "Escape") {
          e.preventDefault()
          if (deleting()) return
          if (deleteSurface.mounted()) deleteSurface.closeThen(() => setPendingDelete(null))
          else if (collectionSurface.mounted()) collectionSurface.close()
          else if (reviewSurface.mounted()) reviewSurface.close()
          else closePreview()
        }
        return
      }
      if (!shouldHandleDiskShortcut(e.target, e.defaultPrevented)) return
      if (view() !== "scan") return
      if (scanning()) {
        if (e.key === "Escape" || e.key === "Backspace") {
          e.preventDefault()
          cancelScan()
        }
        return
      }
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault()
        moveFocus(1)
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault()
        moveFocus(-1)
      } else if (e.key === "Enter") {
        e.preventDefault()
        openFocused()
      } else if (e.key === " ") {
        const node = selectedNode()
        if (!node || node.isDir || node.isOther || node.isHidden) return
        e.preventDefault()
        void openPreview(node)
      } else if (e.key === "Backspace" && (e.metaKey || e.ctrlKey)) {
        const node = selectedNode()
        if (!node) return
        e.preventDefault()
        requestDelete(node)
      } else if (e.key === "Escape" || e.key === "Backspace") {
        e.preventDefault()
        goUp(true)
      } else if (e.key === "Delete") {
        e.preventDefault()
        const node = selectedNode()
        if (node) requestDelete(node)
      } else if (e.key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const node = selectedNode()
        if (!node || !canModifyNode(node)) return
        e.preventDefault()
        toggleCollect(node)
      } else if (e.key === "r" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void rescanCurrent()
      } else if (e.key === "1") {
        chooseScanMode("map", "keyboard")
      } else if (e.key === "2") {
        chooseScanMode("grid", "keyboard")
      } else if (e.key === "3") {
        chooseScanMode("list", "keyboard")
      }
    }
    document.addEventListener("keydown", onKey)
    onCleanup(() => document.removeEventListener("keydown", onKey))
  })

  return (
    <div
      class="dl-shell relative isolate flex size-full min-h-0 flex-col overflow-hidden bg-background-base text-text-base font-(family-name:--font-family-text)"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(event) => void onDrop(event)}
    >
      <style>{KEYFRAMES}</style>
      <div ref={collectionDragPreview} class="dl-drag-preview" aria-hidden="true" />

      <Show when={dropActive()}>
        <div
          class="pointer-events-none absolute inset-3 z-60 grid place-items-center rounded-[26px] bg-background-base/88 shadow-[inset_0_0_0_2px_oklch(0.72_0.13_176/0.7),0_24px_80px_rgb(0_0_0/0.24)] backdrop-blur-xl dl-pop"
          role="status"
          aria-live="polite"
        >
          <div class="text-center">
            <span class="dl-pulse dl-accent-text mx-auto grid size-16 place-items-center rounded-full bg-[oklch(0.72_0.12_176/0.14)]">
              <Icon name="folder-add-left" class="size-6" />
            </span>
            <p class="mt-5 text-20-medium tracking-[-0.03em] text-text-strong">Drop it into the landscape</p>
            <p class="mt-2 text-11-regular text-text-weak">Folders, volumes, and individual files are welcome.</p>
          </div>
        </div>
      </Show>

      <header class="dl-topbar relative z-20 flex h-14 shrink-0 items-center gap-4 px-5 backdrop-blur-xl">
        <button
          type="button"
          class="dl-touch-target group flex min-h-10 shrink-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
          onClick={() => backToDrives()}
        >
          <span class="dl-mark dl-accent-text relative grid size-7 place-items-center rounded-full">
            <span class="size-2 rounded-full bg-current" />
          </span>
          <span class="dl-brand-name text-13-semibold tracking-[-0.02em] text-text-strong">DiskLizard</span>
        </button>

        <Show when={view() === "scan" && crumbs().length > 0}>
          <span class="h-4 w-px bg-border-weaker-base" aria-hidden />
          <Button variant="ghost" size="small" icon="chevron-left" onClick={() => goUp()}>
            {crumbs().length <= 1 ? "Volumes" : "Back"}
          </Button>
          <nav
            class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Current location"
          >
            <For each={crumbs()}>
              {(crumb, i) => (
                <>
                  <Show when={i() > 0}>
                    <Icon name="chevron-right" class="size-3 shrink-0 text-text-weaker" />
                  </Show>
                  <button
                    type="button"
                    class="dl-touch-target min-h-10 max-w-[190px] shrink-0 truncate rounded-md px-2 text-11-regular text-text-weak outline-none transition-[color,background-color] duration-150 hover:bg-surface-raised-base hover:text-text-strong focus-visible:ring-2 focus-visible:ring-text-weak"
                    classList={{ "text-text-strong": i() === crumbs().length - 1 }}
                    onClick={() => goToCrumb(crumb)}
                  >
                    {crumb.name}
                  </button>
                </>
              )}
            </For>
          </nav>
        </Show>

        <div class="ml-auto flex shrink-0 items-center gap-1.5">
          <Show when={view() === "scan" && !scanning()}>
            <Button
              class="dl-pin-scan"
              variant="ghost"
              size="small"
              icon={currentScanPinned() ? "circle-check" : "plus-small"}
              aria-label={currentScanPinned() ? "Unpin this scan location" : "Pin this scan location"}
              onClick={() => togglePinnedLocation(scanSourcePath(), scanLabel())}
            >
              {currentScanPinned() ? "Unpin" : "Pin scan"}
            </Button>
            <Button class="dl-rescan" variant="ghost" size="small" icon="reset" onClick={() => void rescanCurrent()}>
              Rescan
            </Button>
          </Show>
          <Show when={view() === "drives" && disk()}>
            <Button
              variant="ghost"
              size="small"
              icon="reset"
              onClick={() => void loadDrives()}
              disabled={drivesLoading()}
            >
              Refresh
            </Button>
            <Button variant="secondary" size="small" icon="folder-add-left" onClick={() => void chooseAndScan()}>
              Scan a folder
            </Button>
          </Show>
        </div>
      </header>

      <Show when={tabs().length > 0}>
        <div class="dl-scan-tabs flex h-11 shrink-0 items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span class="mr-1 text-9-semibold uppercase tracking-[0.14em] text-text-weaker">Scans</span>
          <Show when={view() === "scan" && treeRoot()}>
            <span class="shrink-0 rounded-full bg-text-strong px-3 py-1 text-10-semibold text-background-base shadow-sm">
              {scanLabel() || "Current"}
            </span>
          </Show>
          <For each={tabs()}>
            {(tab) => (
              <div class="group flex shrink-0 items-center rounded-full text-text-weak transition-[color,background-color] duration-150 hover:bg-surface-raised-base hover:text-text-strong">
                <button
                  type="button"
                  class="dl-touch-target min-h-10 max-w-[132px] truncate rounded-full pl-3 text-10-regular outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
                  onClick={() => {
                    switchToTab(tab.id)
                    setView("scan")
                  }}
                >
                  {tab.label}
                </button>
                <button
                  type="button"
                  class="dl-touch-target grid size-10 place-items-center rounded-full opacity-50 outline-none transition-opacity duration-150 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-text-weak"
                  onClick={() => closeTab(tab.id)}
                  aria-label={`Close ${tab.label} scan`}
                >
                  <Icon name="close-small" class="size-2.5" />
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      <main class="relative min-h-0 flex-1 overflow-hidden">
        <Show
          when={isDesktop()}
          fallback={
            <Placeholder
              icon="folder"
              title="Open DiskLizard on desktop"
              body="Reading storage requires the secure desktop scanner."
            />
          }
        >
          <Show
            when={disk()}
            fallback={
              <Placeholder
                icon="folder"
                title="Scanner disconnected"
                body="The secure desktop bridge is unavailable. Reopen DiskLizard to reconnect it."
              />
            }
          >
            <Show when={view() === "drives"}>
              <ScrollView class="h-full">
                <div class="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 py-8 sm:px-7 sm:py-10 lg:px-10 lg:py-14">
                  <Show
                    when={!drivesLoading() && drives().length > 0}
                    fallback={
                      <DriveFallback
                        loading={drivesLoading()}
                        error={drivesError()}
                        onChoose={() => void chooseAndScan()}
                      />
                    }
                  >
                    <section class="pb-8">
                      <div class="flex flex-wrap items-end justify-between gap-6">
                        <div>
                          <p class="text-9-semibold uppercase tracking-[0.16em] text-text-weaker">Storage map</p>
                          <h2 class="mt-2 text-[clamp(34px,4vw,52px)] font-medium leading-none tracking-[-0.05em] text-text-strong">
                            Start with a volume.
                          </h2>
                          <p class="mt-3 max-w-[52ch] text-11-regular leading-relaxed text-text-weak">
                            Read-only on the first pass. After that, the map stays current from filesystem changes.
                          </p>
                        </div>
                        <div class="flex items-center gap-5">
                          <p class="text-right">
                            <span class="block text-18-medium tabular-nums tracking-[-0.025em] text-text-strong">
                              {formatBytes(driveTotals().free)}
                            </span>
                            <span class="mt-1 block text-8-semibold uppercase tracking-[0.13em] text-text-weaker">
                              available
                            </span>
                          </p>
                          <Button
                            variant="primary"
                            size="large"
                            icon="folder-add-left"
                            onClick={() => void chooseAndScan()}
                          >
                            Scan a folder
                          </Button>
                        </div>
                      </div>
                    </section>

                    <section class="overflow-hidden rounded-[22px] border border-border-weaker-base bg-background-base">
                      <For each={drives()}>
                        {(drive) => (
                          <DriveRow drive={drive} onScan={() => void startScan(drive.path, drive.name, drive)} />
                        )}
                      </For>
                    </section>

                    <section class="mt-5 grid gap-5 lg:grid-cols-[minmax(280px,0.42fr)_minmax(0,1fr)]">
                      <button
                        type="button"
                        onClick={() => void chooseAndScan()}
                        class="group flex min-h-32 items-center gap-4 rounded-[18px] border border-border-weaker-base px-5 text-left outline-none transition-[border-color,background-color] duration-150 hover:border-text-weaker hover:bg-surface-raised-strong/35 focus-visible:ring-2 focus-visible:ring-text-weak"
                      >
                        <span class="grid size-10 shrink-0 place-items-center rounded-full border border-border-weaker-base bg-background-base text-text-weak group-hover:text-text-strong">
                          <Icon name="folder-add-left" class="size-4" />
                        </span>
                        <span class="min-w-0">
                          <span class="block text-12-semibold text-text-strong">Map one project</span>
                          <span class="mt-1 block text-10-regular text-text-weak">
                            Choose a folder, or drop it anywhere here.
                          </span>
                        </span>
                      </button>
                      <div class="min-h-32 rounded-[18px] border border-border-weaker-base px-5 py-4">
                        <div class="flex items-center justify-between gap-4">
                          <div>
                            <p class="text-8-semibold uppercase tracking-[0.13em] text-text-weaker">Developer radar</p>
                            <p class="mt-1.5 text-11-semibold text-text-strong">Generated weight, called by name</p>
                          </div>
                          <Icon name="code-lines" class="size-4 shrink-0 text-text-weaker" />
                        </div>
                        <div class="mt-4 flex flex-wrap gap-x-5 gap-y-2" aria-label="Recognized developer artifacts">
                          <For each={["target", "node_modules", ".gradle", ".codex", ".claude", "worktrees"]}>
                            {(artifact, index) => (
                              <span class="flex items-center gap-2 font-mono text-9-regular text-text-weak">
                                <span
                                  class="size-1.5 rounded-full"
                                  style={{ background: SIZE_BAR_TONES[index() % SIZE_BAR_TONES.length] }}
                                />
                                {artifact}
                              </span>
                            )}
                          </For>
                        </div>
                      </div>
                    </section>

                    <Show when={pinnedLocations().length > 0}>
                      <section class="py-7">
                        <div class="mb-4 flex items-end justify-between gap-4">
                          <div>
                            <p class="text-9-semibold uppercase tracking-[0.14em] text-text-weaker">Pinned scans</p>
                            <h3 class="mt-1 text-18-medium tracking-[-0.02em] text-text-strong">
                              Return to your projects.
                            </h3>
                          </div>
                          <span class="text-10-regular text-text-weaker">Saved only on this device</span>
                        </div>
                        <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <For each={pinnedLocations()}>
                            {(location) => (
                              <PinnedLocationCard
                                location={location}
                                onScan={() =>
                                  void startScan(
                                    location.path,
                                    location.label,
                                    driveForPath(location.path, drives(), platform.os),
                                  )
                                }
                                onRemove={() => togglePinnedLocation(location.path, location.label)}
                              />
                            )}
                          </For>
                        </div>
                      </section>
                    </Show>
                  </Show>
                </div>
              </ScrollView>
            </Show>

            <Show when={view() === "scan"}>
              <Show
                when={!scanning()}
                fallback={
                  <div class="relative flex h-full items-start justify-center overflow-auto px-5 pb-8 pt-10 sm:px-8 sm:pt-14">
                    <ScanFormation
                      label={focusedScan()?.label ?? scanLabel()}
                      files={scanFiles()}
                      bytes={scanBytes()}
                      currentPath={scanTail()}
                      pct={scanTotal() > 0 ? scanPct() : null}
                      discoveries={scanDiscoveries()}
                      onCancel={cancelScan}
                    />
                  </div>
                }
              >
                <div class="flex h-full min-h-0 flex-col">
                  <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {selectionAnnouncement()}
                  </span>
                  <div class="dl-workspace-frame mx-4 mb-3 mt-2 flex min-h-0 flex-1 overflow-hidden rounded-[22px]">
                    <Show when={scanMode() !== "list"}>
                      <section class="dl-landscape relative grid min-w-0 flex-1 place-items-center overflow-hidden">
                        <Show when={reclaim().totalBytes > 0}>
                          <ReclaimBanner
                            bytes={reclaim().totalBytes}
                            count={reclaim().totalCount}
                            onReview={() => reviewSurface.open()}
                          />
                        </Show>
                        <Show when={scanMode() === "map"}>
                          <div class="relative aspect-square h-[min(94%,900px)] max-h-[900px] max-w-[94%]">
                            <canvas
                              ref={(el: HTMLCanvasElement) => setCanvasEl(el)}
                              class="absolute inset-0 size-full rounded-full outline-none [touch-action:manipulation] focus-visible:ring-2 focus-visible:ring-text-weak"
                              tabIndex={0}
                              role="application"
                              aria-roledescription="interactive storage map"
                              aria-describedby="disklizard-orbit-help"
                              aria-label={`Interactive storage map for ${scanLabel()}. Use arrow keys to select an item and Enter to explore it.`}
                              draggable="true"
                              onDragStart={(event) =>
                                beginCollectionDrag(
                                  event,
                                  sunburst()?.nodeAtPoint(event.clientX, event.clientY) ?? null,
                                )
                              }
                              onDragEnd={endCollectionDrag}
                            />
                            <span id="disklizard-orbit-help" class="sr-only">
                              Use the Up and Down arrow keys to select an item, Enter to explore a folder, C to add it
                              to cleanup, and Escape to move up one level.
                            </span>
                            <CenterOverlay
                              node={focusNode()}
                              parentSize={parentSize()}
                              selected={selectedNode()?.path === focusNode()?.path}
                            />
                          </div>
                        </Show>
                        <Show when={scanMode() === "grid"}>
                          <div
                            class="relative size-full px-5 pb-5 lg:px-8 lg:pb-8"
                            classList={{
                              "pt-20": reclaim().totalBytes > 0,
                              "pt-5 lg:pt-8": reclaim().totalBytes === 0,
                            }}
                          >
                            <Treemap
                              children={sortedChildren()}
                              hoveredPath={hoveredPath()}
                              selectedPath={selectedPath()}
                              onHover={(node) => {
                                hoverEntry(node?.path ?? selectedPath() ?? null)
                                if (isVisualAggregate(node)) setVisualHoverNode(node)
                              }}
                              onSelect={selectPath}
                              onDrill={drill}
                              onShowAll={() => chooseScanMode("list")}
                              canCollect={canModifyNode}
                              onCollectDragStart={beginCollectionDrag}
                              onCollectDragEnd={endCollectionDrag}
                            />
                          </div>
                        </Show>
                        <div class="dl-view-switch absolute right-4 top-4 flex items-center gap-0.5 rounded-[11px] bg-background-base/92 p-1 shadow-[0_0_0_1px_rgb(127_127_127/0.14),0_5px_18px_rgb(0_0_0/0.12)]">
                          <SegmentedButton
                            active={scanMode() === "map"}
                            onClick={() => chooseScanMode("map")}
                            icon="dot-grid"
                            label="Orbit"
                            shortcut="1"
                          />
                          <SegmentedButton
                            active={scanMode() === "grid"}
                            onClick={() => chooseScanMode("grid")}
                            icon="file-tree"
                            label="Mosaic"
                            shortcut="2"
                          />
                          <SegmentedButton
                            active={scanMode() === "list"}
                            onClick={() => chooseScanMode("list")}
                            icon="bullet-list"
                            label="Index"
                            shortcut="3"
                          />
                        </div>
                      </section>
                    </Show>

                    <aside
                      class="dl-inspector flex min-h-0 flex-col overflow-hidden bg-background-base"
                      classList={{
                        "w-[clamp(390px,32vw,470px)] shrink-0 border-l border-border-weaker-base":
                          scanMode() !== "list",
                        "flex-1": scanMode() === "list",
                      }}
                    >
                      <div class="shrink-0 border-b border-border-weaker-base px-5 pb-4 pt-5">
                        <div class="flex items-start justify-between gap-4">
                          <div>
                            <p class="text-9-semibold uppercase tracking-[0.16em] text-text-weaker">
                              {indexFilter.lens === "developer"
                                ? indexFilter.developerCategory === "all"
                                  ? "Developer footprint"
                                  : indexFilter.developerCategory === "dormant"
                                    ? "Dormant artifacts"
                                    : DEVELOPER_CATEGORY_LABEL[indexFilter.developerCategory]
                                : indexFilter.lens === "cleanup"
                                  ? "Cleanup candidates"
                                  : "Space index"}
                            </p>
                            <div class="mt-2 flex min-w-0 items-baseline justify-between gap-4">
                              <h2 class="min-w-0 truncate text-18-medium tracking-[-0.035em] text-text-strong">
                                {viewNode()?.name || scanLabel()}
                              </h2>
                              <span class="shrink-0 text-[24px] font-medium leading-none tracking-[-0.04em] tabular-nums text-text-strong">
                                {formatBytes(indexSize())}
                              </span>
                            </div>
                            <p class="mt-1.5 text-10-regular tabular-nums text-text-weak">
                              {formatCount(indexCount())} items · {sizeBasisLabel()}
                            </p>
                          </div>
                          <Show when={scanMode() === "list"}>
                            <div class="flex items-center gap-0.5 rounded-full bg-background-base/70 p-1 shadow-[0_0_0_1px_rgb(127_127_127/0.12)]">
                              <SegmentedButton
                                active={scanMode() === "map"}
                                onClick={() => chooseScanMode("map")}
                                icon="dot-grid"
                                label="Orbit"
                              />
                              <SegmentedButton
                                active={scanMode() === "grid"}
                                onClick={() => chooseScanMode("grid")}
                                icon="file-tree"
                                label="Mosaic"
                              />
                              <SegmentedButton active icon="bullet-list" label="Index" />
                            </div>
                          </Show>
                        </div>
                        <div
                          role="group"
                          aria-label="Space index lens"
                          class="mt-4 grid grid-cols-3 gap-1 border-b border-border-weaker-base pb-3"
                        >
                          <IndexLensButton
                            active={indexFilter.lens === "all"}
                            icon="bullet-list"
                            label="All"
                            onClick={() => chooseLens("all")}
                          />
                          <IndexLensButton
                            active={indexFilter.lens === "developer"}
                            icon="code-lines"
                            label="Developer"
                            onClick={() => chooseLens("developer")}
                          />
                          <IndexLensButton
                            active={indexFilter.lens === "cleanup"}
                            icon="shield"
                            label="Cleanup"
                            onClick={() => chooseLens("cleanup")}
                          />
                        </div>
                        <Show when={indexFilter.lens === "developer" && developer().buckets.length > 0}>
                          <div
                            class="mt-2 flex max-w-full gap-1.5 overflow-x-auto pb-0.5"
                            aria-label="Developer categories"
                          >
                            <DeveloperCategoryButton
                              active={indexFilter.developerCategory === "all"}
                              label="Everything"
                              bytes={developer().totalBytes}
                              onClick={() => chooseDeveloperCategory("all")}
                            />
                            <Show when={dormantDeveloper().count > 0}>
                              <DeveloperCategoryButton
                                active={indexFilter.developerCategory === "dormant"}
                                label="Dormant 90d+"
                                bytes={dormantDeveloper().bytes}
                                description="No descendant changed in at least 90 days"
                                onClick={() => chooseDeveloperCategory("dormant")}
                              />
                            </Show>
                            <For each={developer().buckets}>
                              {(bucket) => (
                                <DeveloperCategoryButton
                                  active={indexFilter.developerCategory === bucket.category}
                                  label={DEVELOPER_CATEGORY_LABEL[bucket.category]}
                                  bytes={bucket.bytes}
                                  onClick={() => chooseDeveloperCategory(bucket.category)}
                                />
                              )}
                            </For>
                          </div>
                        </Show>
                        <Show when={treeRoot()?.scanIssues}>
                          {(issues) => (
                            <details class="group mt-3 rounded-xl border border-border-warning-base/55 bg-surface-warning-weak/45">
                              <summary class="dl-touch-target flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-icon-warning-base [&::-webkit-details-marker]:hidden">
                                <Icon name="warning" class="size-3.5 shrink-0 text-icon-warning-base" />
                                <span class="min-w-0 flex-1 text-10-semibold text-text-strong">
                                  {formatCount(issues().unreadableCount)} unreadable
                                  {issues().unreadableCount === 1 ? " location" : " locations"}
                                </span>
                                <span class="text-9-regular text-text-weak">Totals may be low</span>
                                <Icon
                                  name="chevron-down"
                                  class="size-3 shrink-0 text-icon-weak transition-transform duration-150 group-open:rotate-180"
                                />
                              </summary>
                              <div class="border-t border-border-warning-base/40 px-3 pb-3 pt-2.5">
                                <p class="text-10-regular leading-relaxed text-text-weak">
                                  {scanAccessGuidance(platform.os)} Use Rescan in the top bar after changing access.
                                </p>
                                <ul class="mt-2 space-y-1" aria-label="Unreadable locations sampled during this scan">
                                  <For each={issues().samplePaths.slice(0, 5)}>
                                    {(path) => (
                                      <li class="truncate font-mono text-9-regular text-text-weaker" title={path}>
                                        {path}
                                      </li>
                                    )}
                                  </For>
                                </ul>
                                <Show when={issues().samplePaths.length > 5 || issues().unreadableCount > 5}>
                                  <p class="mt-1.5 text-9-regular text-text-weaker">
                                    Showing 5 of {formatCount(issues().unreadableCount)} locations
                                  </p>
                                </Show>
                              </div>
                            </details>
                          )}
                        </Show>
                        <label class="dl-touch-target mt-3 flex h-10 items-center gap-2 rounded-[10px] bg-surface-raised-base/55 px-3 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.14)] transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_1px_rgb(127_127_127/0.34),0_0_0_3px_rgb(127_127_127/0.08)]">
                          <Icon name="magnifying-glass" class="size-3.5 shrink-0 text-icon-weak" />
                          <span class="sr-only">
                            {indexFilter.lens === "all" ? "Filter this folder" : "Search this scan"}
                          </span>
                          <input
                            type="search"
                            placeholder={indexFilter.lens === "all" ? "Filter this folder" : "Search names and paths"}
                            value={query()}
                            onInput={(e) => updateQuery(e.currentTarget.value)}
                            class="dl-search-input min-w-0 flex-1 bg-transparent text-12-regular text-text-strong placeholder:text-text-weaker outline-none"
                          />
                          <Show when={query()}>
                            <button
                              type="button"
                              class="dl-touch-target grid size-10 place-items-center rounded-full text-text-weak outline-none hover:bg-surface-raised-base focus-visible:ring-2 focus-visible:ring-text-weak"
                              onClick={() => updateQuery("")}
                              aria-label="Clear filter"
                            >
                              <Icon name="close-small" class="size-3" />
                            </button>
                          </Show>
                        </label>
                      </div>

                      <Show
                        when={entries().length > 0}
                        fallback={
                          <ScrollView class="min-h-0 flex-1">
                            <IndexEmpty
                              filtered={!!query() || indexFilter.lens !== "all"}
                              onReset={() => {
                                setQuery("")
                                chooseLens("all")
                              }}
                            />
                          </ScrollView>
                        }
                      >
                        <VirtualIndex
                          entries={entries()}
                          bindScrollToIndex={(fn) => (scrollIndexIntoView = fn)}
                          onMoveFocus={moveFocus}
                          render={(entry, i) => {
                            const rec = () => recognize(entry.node)
                            const developerContext = () => developerArtifactContext(entry.node, rec())
                            const pct = () => (indexSize() ? (entry.displaySize / indexSize()) * 100 : 0)
                            const isActive = () =>
                              selectedPath() === entry.node.path || (focusIdx() === i() && !selectedPath())
                            return (
                              <div
                                class="group relative flex h-full items-center border-b border-border-weaker-base/70 transition-colors duration-150 hover:bg-surface-raised-base/45"
                                classList={{
                                  "bg-surface-raised-base/70": isActive(),
                                }}
                                onMouseEnter={() => hoverEntry(entry.node.path)}
                                onMouseLeave={() => hoverEntry(selectedPath() ?? null)}
                              >
                                <button
                                  type="button"
                                  aria-current={isActive() ? "true" : undefined}
                                  draggable={canModifyNode(entry.node)}
                                  class="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-4 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak"
                                  onClick={() => selectPath(entry.node.path)}
                                  onDblClick={() =>
                                    entry.node.isDir ? drill(entry.node) : void openPreview(entry.node)
                                  }
                                  onDragStart={(event) => beginCollectionDrag(event, entry.node)}
                                  onDragEnd={endCollectionDrag}
                                >
                                  <span
                                    class="size-2.5 shrink-0 rounded-full shadow-[0_0_0_1px_rgb(255_255_255/0.16)]"
                                    style={{ background: primarySegmentColor(entry.index) }}
                                    aria-hidden="true"
                                  />
                                  <span class="grid size-6 shrink-0 place-items-center text-text-weaker transition-colors duration-150 group-hover:text-text-strong">
                                    <Icon name={entry.node.isDir ? "folder" : "code-lines"} class="size-3.5" />
                                  </span>
                                  <span class="min-w-0 flex-1">
                                    <span class="flex min-w-0 items-center gap-1.5">
                                      <span class="truncate text-12-semibold text-text-strong">{entry.node.name}</span>
                                      <Show when={rec().tag && scanMode() === "list"}>
                                        <span
                                          class={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-9-semibold uppercase tracking-[0.08em] ring-1 ring-inset lg:inline ${SAFETY_ACCENT[rec().safety].pill}`}
                                        >
                                          {rec().tag}
                                        </span>
                                      </Show>
                                    </span>
                                    <Show
                                      when={indexFilter.lens !== "all"}
                                      fallback={
                                        <span class="mt-1 flex items-center gap-2">
                                          <Show when={rec().tag && scanMode() !== "list"}>
                                            <span
                                              class={`max-w-[145px] shrink-0 truncate rounded-full px-1.5 py-0.5 text-9-semibold uppercase tracking-[0.08em] ring-1 ring-inset ${SAFETY_ACCENT[rec().safety].pill}`}
                                              title={rec().tag}
                                            >
                                              {rec().tag}
                                            </span>
                                          </Show>
                                          <span class="h-0.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-raised-base">
                                            <span
                                              class="block h-full rounded-full"
                                              style={{
                                                width: `${Math.max(2, Math.min(100, pct()))}%`,
                                                background: primarySegmentColor(entry.index),
                                              }}
                                            />
                                          </span>
                                          <span class="w-10 text-right text-10-regular tabular-nums text-text-weak">
                                            {formatPct(entry.displaySize, indexSize())}
                                          </span>
                                        </span>
                                      }
                                    >
                                      <span class="mt-1 flex min-w-0 items-center gap-2">
                                        <span
                                          class="flex min-w-0 flex-1 items-center gap-1.5 text-10-regular text-text-weak"
                                          title={
                                            indexFilter.lens === "developer"
                                              ? `${developerContext().scope} · ${developerContext().disposition}\n${rec().hint ?? "Inspect this artifact before changing it"}\n${entry.node.path}`
                                              : entry.node.path
                                          }
                                        >
                                          <Show when={indexFilter.lens === "developer"}>
                                            <span class="shrink-0 text-text-weak">{developerContext().scope}</span>
                                            <span aria-hidden="true">·</span>
                                            <span class="shrink-0 text-10-semibold text-text-strong">
                                              {developerContext().disposition}
                                            </span>
                                            <span aria-hidden="true">·</span>
                                          </Show>
                                          <span class="min-w-0 truncate font-mono">
                                            {truncatePath(entry.node.path, 92)}
                                            <Show when={entry.displaySize !== entry.node.size}>
                                              {` · ${shortBytes(entry.node.size)} including nested categories`}
                                            </Show>
                                          </span>
                                        </span>
                                        <Show
                                          when={indexFilter.lens === "developer" ? entry.node.modifiedAt : undefined}
                                        >
                                          {(changedAt) => (
                                            <span
                                              class="shrink-0 text-10-regular tabular-nums text-text-weak"
                                              classList={{ "dl-accent-text": isDormant(changedAt()) }}
                                              title={`Last changed ${new Date(changedAt()).toLocaleString()}`}
                                            >
                                              {formatLastChanged(changedAt())}
                                            </span>
                                          )}
                                        </Show>
                                      </span>
                                    </Show>
                                  </span>
                                  <span class="shrink-0 text-11-semibold tabular-nums text-text-strong">
                                    {shortBytes(entry.displaySize)}
                                  </span>
                                </button>
                                <Show when={canModifyNode(entry.node)}>
                                  <button
                                    type="button"
                                    class="dl-row-action grid size-10 shrink-0 place-items-center rounded-lg text-text-weak opacity-65 outline-none transition-[color,opacity,background-color,transform] duration-150 hover:bg-surface-raised-base hover:text-text-strong hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]"
                                    classList={{
                                      "dl-accent-text opacity-100": isCollected(entry.node.path),
                                    }}
                                    onClick={() => toggleCollect(entry.node)}
                                    aria-pressed={isCollected(entry.node.path)}
                                    aria-label={
                                      isCollected(entry.node.path)
                                        ? `Remove ${entry.node.name} from cleanup basket`
                                        : `Add ${entry.node.name} to cleanup basket`
                                    }
                                  >
                                    <Icon
                                      name={isCollected(entry.node.path) ? "circle-check" : "plus-small"}
                                      class="size-3.5"
                                    />
                                  </button>
                                </Show>
                                <Show when={entry.node.isDir && !entry.node.isOther}>
                                  <button
                                    type="button"
                                    class="grid size-10 shrink-0 place-items-center rounded-lg text-text-weaker outline-none transition-colors duration-150 hover:bg-surface-raised-base hover:text-text-strong focus-visible:ring-2 focus-visible:ring-text-weak"
                                    onClick={() => drill(entry.node)}
                                    aria-label={`Open ${entry.node.name}`}
                                  >
                                    <Icon name="chevron-right" class="size-3.5" />
                                  </button>
                                </Show>
                              </div>
                            )
                          }}
                        />
                      </Show>
                    </aside>
                  </div>

                  <div class="dl-command-dock shrink-0 border-t border-border-weaker-base bg-background-base/92 px-4 py-2.5 backdrop-blur-xl">
                    <div class="dl-command-dock-inner mx-auto flex max-w-[1480px] items-center gap-3">
                      <div class="min-w-0 flex-1">
                        <Show
                          when={selectedNode()}
                          fallback={
                            <div class="flex min-h-[72px] items-center gap-3 px-2">
                              <span class="grid size-10 shrink-0 place-items-center rounded-full bg-surface-raised-base text-text-weak">
                                <Icon name="window-cursor" class="size-4" />
                              </span>
                              <div class="min-w-0">
                                <p class="text-12-semibold text-text-strong">Select anything to inspect it</p>
                                <p class="mt-0.5 truncate text-10-regular text-text-weak">
                                  Enter opens · Space previews · C adds to cleanup ·{" "}
                                  {platform.os === "macos" ? "⌘⌫" : "Ctrl+Backspace"} moves to{" "}
                                  {nativeTrashName(platform.os)}
                                </p>
                              </div>
                            </div>
                          }
                        >
                          {(node) => (
                            <DetailBar
                              node={node()}
                              parentSize={indexSize()}
                              deletable={canModifyNode(node())}
                              collected={isCollected(node().path)}
                              trashName={nativeTrashName(platform.os)}
                              onPreview={
                                node().isDir || node().isOther || node().isHidden
                                  ? undefined
                                  : () => void openPreview(node())
                              }
                              onReveal={() => void reveal(node().path)}
                              onOpen={() => drill(node())}
                              onCollect={() => toggleCollect(node())}
                              onTrash={() => requestDelete(node())}
                            />
                          )}
                        </Show>
                      </div>
                      <div class="dl-cleanup-slot w-[min(470px,38vw)] shrink-0">
                        <CollectionDropTarget
                          node={collectionDragNode()}
                          active={collectionDropActive()}
                          count={effectiveCollection().length}
                          bytes={collectionSize()}
                          trashName={nativeTrashName(platform.os)}
                          onReview={() => collectionSurface.open()}
                          onClear={clearCollection}
                          onDragEnter={collectionDragEnter}
                          onDragOver={collectionDragOver}
                          onDragLeave={collectionDragLeave}
                          onDrop={collectDroppedNode}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Show>
            </Show>
          </Show>
        </Show>
      </main>

      <Show when={previewSurface.mounted() && previewTarget()}>
        {(node) => (
          <PreviewDialog
            phase={previewSurface.phase()}
            node={node()}
            preview={filePreview()}
            loading={previewLoading()}
            error={previewError()}
            position={previewPosition() + 1}
            total={previewableEntries().length}
            onClose={closePreview}
            onPrevious={previewPosition() > 0 ? () => previewAdjacent(-1) : undefined}
            onNext={previewPosition() + 1 < previewableEntries().length ? () => previewAdjacent(1) : undefined}
            onReveal={() => void reveal(node().path)}
            onOpen={() => void openInDefaultApp(node())}
          />
        )}
      </Show>

      {/* ── Reclaim review drawer ── */}
      <Show when={reviewSurface.mounted()}>
        <ReclaimDrawer
          phase={reviewSurface.phase()}
          reclaim={reclaim()}
          onClose={() => reviewSurface.close()}
          onCollectAll={() => {
            collectNodes(reclaim().buckets.flatMap((bucket) => bucket.items.map(({ node }) => node)))
            reviewSurface.close()
          }}
          onTrash={(node) => {
            reviewSurface.closeThen(() => requestDelete(node))
          }}
          deleting={deleting()}
        />
      </Show>

      <Show when={collectionSurface.mounted()}>
        <CollectionDialog
          phase={collectionSurface.phase()}
          items={effectiveCollection()}
          bytes={collectionSize()}
          deleting={deleting()}
          progress={deletionProgress()}
          trashName={nativeTrashName(platform.os)}
          onClose={() => !deleting() && collectionSurface.close()}
          onRemove={removeCollected}
          onConfirm={() => void deleteCollected()}
        />
      </Show>

      {/* ── Delete confirm ── */}
      <Show when={deleteSurface.mounted() && pendingDelete()}>
        {(node) => (
          <div
            class="dl-dialog-surface fixed inset-0 z-50 grid place-items-center bg-background-base/62 p-4 backdrop-blur-sm"
            data-state={deleteSurface.phase()}
            onClick={() => !deleting() && deleteSurface.closeThen(() => setPendingDelete(null))}
            role="presentation"
          >
            <div
              class="dl-dialog-panel w-full max-w-md rounded-2xl bg-surface-raised-strong p-5 shadow-[0_0_0_1px_rgb(127_127_127/0.13),0_24px_80px_rgb(0_0_0/0.24)]"
              ref={focusDialog}
              tabIndex={-1}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={trapDialogFocus}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-title"
              aria-describedby="delete-description"
            >
              <div class="flex items-start gap-3">
                <div class="dl-critical-text grid size-10 shrink-0 place-items-center rounded-full bg-[oklch(0.62_0.2_25/0.12)]">
                  <Icon name="trash" class="size-4" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-9-semibold uppercase tracking-[0.14em] text-text-weaker">Confirm removal</p>
                  <h3 id="delete-title" class="mt-1 text-18-medium tracking-[-0.025em] text-text-strong">
                    Move this item to {nativeTrashName(platform.os)}?
                  </h3>
                  <div
                    id="delete-description"
                    class="mt-4 rounded-xl bg-background-base/65 p-3 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.1)]"
                  >
                    <p class="truncate text-12-semibold text-text-strong">{node().name}</p>
                    <p class="mt-0.5 truncate font-mono text-9-regular text-text-weaker">{node().path}</p>
                    <p class="mt-2 text-11-semibold tabular-nums text-text-strong">{formatBytes(node().size)}</p>
                  </div>
                  <p class="mt-3 flex items-center gap-1.5 text-10-regular text-text-weak">
                    <Icon name="shield" class="size-3.5" />
                    You can restore it from {nativeTrashName(platform.os)}.
                  </p>
                </div>
              </div>
              <div class="mt-5 flex justify-end gap-2">
                <Button
                  data-autofocus
                  size="small"
                  variant="ghost"
                  disabled={deleting()}
                  onClick={() => deleteSurface.closeThen(() => setPendingDelete(null))}
                >
                  Keep it
                </Button>
                <Button
                  size="small"
                  variant="primary"
                  disabled={deleting()}
                  icon="trash"
                  onClick={() => void confirmDelete()}
                >
                  {deleting() ? "Moving…" : `Move to ${nativeTrashName(platform.os)}`}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function focusDialog(element: HTMLElement) {
  queueMicrotask(() => {
    const target = element.querySelector<HTMLElement>("[data-autofocus]") ?? element
    target.focus({ preventScroll: true })
  })
}

function trapDialogFocus(event: KeyboardEvent) {
  if (event.key !== "Tab") return
  const dialog = event.currentTarget
  if (!(dialog instanceof HTMLElement)) return
  const focusable = [
    ...dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.getClientRects().length > 0)
  if (!focusable.length) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
    event.preventDefault()
    last.focus()
    return
  }
  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function SegmentedButton(props: {
  active: boolean
  onClick?: () => void
  icon: IconProps["name"]
  label: string
  shortcut?: string
}) {
  return (
    <button
      type="button"
      class="dl-segmented dl-touch-target flex min-h-10 items-center gap-1.5 rounded-full px-3 text-10-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]"
      classList={{
        "bg-surface-raised-base text-text-strong shadow-[0_0_0_1px_rgb(127_127_127/0.14),0_2px_7px_rgb(0_0_0/0.12)]":
          props.active,
        "text-text-weak hover:text-text-strong": !props.active,
      }}
      onClick={props.onClick}
      aria-pressed={props.active}
    >
      <Icon name={props.icon} class="size-3" />
      {props.label}
      <Show when={props.shortcut}>
        <kbd class="ml-0.5 text-8-regular opacity-45">{props.shortcut}</kbd>
      </Show>
    </button>
  )
}

function IndexLensButton(props: { active: boolean; onClick: () => void; icon: IconProps["name"]; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      class="dl-touch-target flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 text-10-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]"
      classList={{
        "bg-[oklch(0.76_0.155_148/0.12)] text-text-strong shadow-[inset_0_-2px_0_oklch(0.76_0.155_148/0.62)]":
          props.active,
        "text-text-weak hover:text-text-strong": !props.active,
      }}
      onClick={props.onClick}
    >
      <Icon name={props.icon} class="size-3.5" />
      {props.label}
    </button>
  )
}

function DeveloperCategoryButton(props: {
  active: boolean
  label: string
  bytes: number
  description?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={props.active}
      aria-label={props.description ? `${props.label}. ${props.description}. ${formatBytes(props.bytes)}` : undefined}
      title={props.description}
      class="dl-touch-target flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-9-semibold outline-none transition-[color,background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]"
      classList={{
        "bg-[oklch(0.76_0.155_148/0.12)] text-text-strong shadow-[inset_0_0_0_1px_oklch(0.76_0.155_148/0.28)]":
          props.active,
        "bg-background-base/45 text-text-weak hover:text-text-strong": !props.active,
      }}
      onClick={props.onClick}
    >
      <span>{props.label}</span>
      <span class="tabular-nums text-text-weaker">{shortBytes(props.bytes)}</span>
    </button>
  )
}

function DriveFallback(props: { loading: boolean; error?: string; onChoose: () => void }) {
  return (
    <div class="flex min-h-[520px] flex-1 flex-col items-center justify-center text-center">
      <Show
        when={!props.loading}
        fallback={
          <>
            <span class="dl-spin size-8 rounded-full border-2 border-border-weaker-base border-t-[oklch(0.67_0.13_176)]" />
            <p class="mt-5 text-13-medium text-text-strong">Finding your volumes</p>
            <p class="mt-1 text-11-regular text-text-weak">This should only take a moment.</p>
          </>
        }
      >
        <span class="dl-mark dl-accent-text grid size-12 place-items-center rounded-full">
          <span class="size-3 rounded-full bg-current" />
        </span>
        <h2 class="mt-5 text-20-medium tracking-[-0.025em] text-text-strong">
          {props.error ? "Volumes could not be read" : "Choose where to begin"}
        </h2>
        <p class="mt-2 max-w-sm text-12-regular leading-relaxed text-text-weak">
          {props.error ?? "Pick any folder and DiskLizard will map it without changing a thing."}
        </p>
        <Button class="mt-5" variant="primary" size="small" icon="folder-add-left" onClick={props.onChoose}>
          Scan a folder
        </Button>
      </Show>
    </div>
  )
}

function IndexEmpty(props: { filtered: boolean; onReset: () => void }) {
  return (
    <div class="flex min-h-full flex-col items-center justify-center px-8 py-16 text-center">
      <span class="grid size-11 place-items-center rounded-full bg-surface-raised-base text-text-weak">
        <Icon name={props.filtered ? "magnifying-glass" : "folder"} class="size-4" />
      </span>
      <h3 class="mt-4 text-13-semibold text-text-strong">
        {props.filtered ? "Nothing matches this lens" : "This folder is empty"}
      </h3>
      <p class="mt-1 max-w-[30ch] text-11-regular leading-relaxed text-text-weak">
        {props.filtered
          ? "Clear the filter to return to the complete space index."
          : "There is no storage to explore here."}
      </p>
      <Show when={props.filtered}>
        <Button class="mt-4" size="small" variant="secondary" onClick={props.onReset}>
          Show everything
        </Button>
      </Show>
    </div>
  )
}

function VirtualIndex(props: {
  entries: Entry[]
  bindScrollToIndex: (fn: ((index: number) => void) | undefined) => void
  onMoveFocus: (delta: number) => void
  render: (entry: Entry, index: () => number) => JSX.Element
}) {
  const [viewport, setViewport] = createSignal<HTMLDivElement>()
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLLIElement>({
    get count() {
      return props.entries.length
    },
    getScrollElement: () => viewport() ?? null,
    estimateSize: () => 58,
    overscan: 10,
    getItemKey: (index) => props.entries[index]?.node.path ?? index,
  })
  const scrollToIndex = (index: number) => virtualizer.scrollToIndex(index, { align: "auto" })
  props.bindScrollToIndex(scrollToIndex)
  onCleanup(() => props.bindScrollToIndex(undefined))

  return (
    <ScrollView
      class="min-h-0 flex-1"
      viewportRef={setViewport}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "j" && event.key !== "k") return
        event.preventDefault()
        event.stopPropagation()
        props.onMoveFocus(event.key === "ArrowDown" || event.key === "j" ? 1 : -1)
      }}
    >
      <ul class="relative mx-2 my-2" style={{ height: `${virtualizer.getTotalSize()}px` }} aria-label="Storage entries">
        <For each={virtualizer.getVirtualItems()}>
          {(item) => {
            const entry = () => props.entries[item.index]
            return (
              <Show when={entry()}>
                {(value) => (
                  <li
                    class="absolute left-0 top-0 w-full"
                    style={{ height: `${item.size}px`, transform: `translateY(${item.start}px)` }}
                  >
                    {props.render(value(), () => item.index)}
                  </li>
                )}
              </Show>
            )
          }}
        </For>
      </ul>
    </ScrollView>
  )
}

function VirtualRows<T>(props: {
  items: T[]
  ariaLabel: string
  estimateSize: (item: T) => number
  itemKey: (item: T, index: number) => string | number
  render: (item: T, index: () => number) => JSX.Element
}) {
  const [viewport, setViewport] = createSignal<HTMLDivElement>()
  const padding = 8
  const virtualizer = createVirtualizer<HTMLDivElement, HTMLLIElement>({
    get count() {
      return props.items.length
    },
    getScrollElement: () => viewport() ?? null,
    estimateSize: (index) => props.estimateSize(props.items[index]),
    overscan: 8,
    getItemKey: (index) => props.itemKey(props.items[index], index),
  })

  return (
    <ScrollView class="min-h-0 flex-1" viewportRef={setViewport}>
      <ul
        class="relative"
        style={{ height: `${virtualizer.getTotalSize() + padding * 2}px` }}
        aria-label={props.ariaLabel}
      >
        <For each={virtualizer.getVirtualItems()}>
          {(row) => {
            const item = () => props.items[row.index]
            return (
              <Show when={item()}>
                {(value) => (
                  <li
                    class="absolute left-0 top-0 w-full"
                    style={{ height: `${row.size}px`, transform: `translateY(${row.start + padding}px)` }}
                  >
                    {props.render(value(), () => row.index)}
                  </li>
                )}
              </Show>
            )
          }}
        </For>
      </ul>
    </ScrollView>
  )
}

function Placeholder(props: { icon: IconProps["name"]; title: string; body: string }) {
  return (
    <div class="flex h-full items-center justify-center px-6">
      <div class="max-w-md text-center">
        <div class="mx-auto mb-5 grid size-12 place-items-center rounded-full bg-surface-raised-base shadow-[0_0_0_1px_rgb(127_127_127/0.1),0_8px_24px_rgb(0_0_0/0.06)]">
          <Icon name={props.icon} class="size-5 text-text-weak" />
        </div>
        <h2 class="text-20-medium tracking-[-0.025em] text-text-strong">{props.title}</h2>
        <p class="mt-2 text-12-regular leading-relaxed text-text-weak">{props.body}</p>
      </div>
    </div>
  )
}

/** Center overlay for the sunburst — shows the focused node's identity + size. */
function CenterOverlay(props: { node: DiskScanNode | null; parentSize: number; selected: boolean }) {
  const rec = () => (props.node ? recognize(props.node) : null)
  return (
    <div class="pointer-events-none absolute inset-0 grid place-items-center">
      <div class="max-w-[70%] text-center">
        <Show when={props.node}>
          <p class="truncate text-10-semibold tracking-[-0.01em] text-text-weak">{props.node!.name}</p>
          <p
            class="mt-1.5 text-[clamp(22px,2.8vw,38px)] font-medium leading-none tracking-[-0.05em] tabular-nums text-text-strong"
            style={{ "text-wrap": "balance" }}
          >
            {formatBytes(props.node!.size)}
          </p>
          <Show when={props.parentSize && props.node!.path}>
            <p class="mt-2 text-10-regular tabular-nums text-text-weaker">
              {formatPct(props.node!.size, props.parentSize)} of this level
            </p>
          </Show>
          <Show when={rec()?.tag}>
            <span
              class={`mt-2 inline-block rounded-full px-2 py-0.5 text-8-semibold uppercase tracking-[0.1em] ring-1 ring-inset ${SAFETY_ACCENT[rec()!.safety].pill}`}
            >
              {rec()!.tag}
            </span>
          </Show>
          <Show when={props.selected && props.node!.isDir && !props.node!.isOther}>
            <p class="mt-2 text-9-regular text-text-weaker">Select again to explore</p>
          </Show>
        </Show>
      </div>
    </div>
  )
}

/** Compact volume row: identity, capacity, and the single next action. */
function DriveRow(props: { drive: DiskDriveInfo; onScan: () => void }) {
  const hasTotal = () => props.drive.total > 0
  const usedPct = () => (hasTotal() ? (props.drive.used / props.drive.total) * 100 : 0)
  const barColor = () => (hasTotal() ? usageStroke(props.drive.used, props.drive.total) : "oklch(0.65 0.13 270)")
  return (
    <button
      type="button"
      onClick={props.onScan}
      class="group grid min-h-40 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-6 border-b border-border-weaker-base px-5 py-6 text-left outline-none transition-colors duration-150 last:border-b-0 hover:bg-surface-raised-strong/28 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak sm:grid-cols-[minmax(220px,0.82fr)_minmax(280px,1fr)_132px] sm:px-7"
    >
      <span class="flex min-w-0 items-center gap-3.5">
        <span class="grid size-11 shrink-0 place-items-center rounded-full border border-border-weaker-base bg-surface-raised-strong/45 text-text-weak transition-colors duration-150 group-hover:text-text-strong">
          <Icon name="server" class="size-4" />
        </span>
        <span class="min-w-0">
          <span class="block truncate text-15-semibold tracking-[-0.025em] text-text-strong">{props.drive.name}</span>
          <span class="mt-1.5 block truncate font-mono text-9-regular text-text-weaker">{props.drive.path}</span>
          <span class="mt-3 inline-flex items-center gap-1.5 text-9-semibold text-text-strong">
            Scan volume
            <Icon
              name="arrow-right"
              class="size-3 text-text-weaker transition-transform duration-150 group-hover:translate-x-0.5"
            />
          </span>
        </span>
      </span>

      <Show
        when={hasTotal()}
        fallback={<span class="hidden text-10-regular text-text-weak sm:block">Ready to map</span>}
      >
        <span class="hidden min-w-0 sm:block">
          <span class="flex items-end justify-between gap-4 tabular-nums">
            <span>
              <span class="block text-8-semibold uppercase tracking-[0.13em] text-text-weaker">occupied</span>
              <span class="mt-1 block text-14-medium tracking-[-0.02em] text-text-strong">
                {formatBytes(props.drive.used)}
              </span>
            </span>
            <span class="pb-0.5 text-9-regular text-text-weak">{formatBytes(props.drive.free)} free</span>
          </span>
          <span class="mt-3 block h-1 overflow-hidden rounded-full bg-surface-raised-strong">
            <span class="block h-full rounded-full" style={{ width: `${usedPct()}%`, background: barColor() }} />
          </span>
        </span>
      </Show>

      <span class="relative grid size-24 place-items-center justify-self-end">
        <svg class="absolute inset-0 size-full -rotate-90" viewBox="0 0 96 96" aria-hidden="true">
          <circle cx="48" cy="48" r="40" fill="none" stroke="var(--surface-raised-strong)" stroke-width="7" />
          <Show when={hasTotal()}>
            <circle
              cx="48"
              cy="48"
              r="40"
              fill="none"
              stroke={barColor()}
              stroke-width="7"
              pathLength="100"
              stroke-dasharray={`${usedPct()} ${100 - usedPct()}`}
            />
          </Show>
        </svg>
        <span class="relative text-center">
          <span class="block text-13-medium tabular-nums text-text-strong">{Math.round(usedPct())}%</span>
          <span class="mt-0.5 block text-8-semibold uppercase tracking-[0.12em] text-text-weaker">used</span>
        </span>
      </span>
    </button>
  )
}

/** The reclaimable-space banner — the wow feature. */
function ReclaimBanner(props: { bytes: number; count: number; onReview: () => void }) {
  let valueElement!: HTMLSpanElement
  let displayed = 0

  createEffect(() => {
    const total = props.bytes
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayed = total
      valueElement.textContent = formatBytes(total)
      return
    }
    const cancel = animateCount(displayed, total, 240, (value) => {
      displayed = value
      valueElement.textContent = formatBytes(value)
    })
    onCleanup(cancel)
  })

  return (
    <div class="absolute left-4 top-4 z-10 flex w-[min(360px,calc(100%-32px))] items-center gap-2 rounded-full bg-background-base/86 p-1.5 pl-2 shadow-[0_0_0_1px_rgb(127_127_127/0.12),0_10px_32px_rgb(0_0_0/0.1)] backdrop-blur-xl">
      <div class="dl-accent-text grid size-8 shrink-0 place-items-center rounded-full bg-[oklch(0.72_0.12_176/0.14)]">
        <Icon name="models" class="size-3.5" />
      </div>
      <p class="min-w-0 flex-1 truncate text-11-semibold tracking-[-0.015em] text-text-strong">
        <span ref={valueElement} class="tabular-nums">
          {formatBytes(0)}
        </span>{" "}
        reclaimable
        <span class="ml-2 text-9-regular text-text-weaker">
          {props.count === 1 ? "1 item" : `${formatCount(props.count)} items`}
        </span>
      </p>
      <Button class="shrink-0" size="small" variant="primary" icon="arrow-right" onClick={props.onReview}>
        Review
      </Button>
    </div>
  )
}

/** Detail / action bar pinned under the scan results. */
function DetailBar(props: {
  node: DiskScanNode
  parentSize: number
  deletable: boolean
  collected: boolean
  trashName: string
  onPreview?: () => void
  onReveal: () => void
  onOpen: () => void
  onCollect: () => void
  onTrash: () => void
}) {
  const rec = () => recognize(props.node)
  const developerContext = () => (rec().developer ? developerArtifactContext(props.node, rec()) : undefined)
  return (
    <div class="flex min-h-[72px] min-w-0 flex-wrap items-center justify-between gap-3 px-2">
      <div class="flex min-w-0 items-center gap-3">
        <span class="grid size-10 shrink-0 place-items-center rounded-full bg-surface-raised-base text-text-weak">
          <Icon name={props.node.isHidden ? "shield" : props.node.isDir ? "folder" : "code-lines"} class="size-4" />
        </span>
        <div class="min-w-0">
          <div class="flex min-w-0 items-baseline gap-2">
            <span class="truncate text-13-semibold tracking-[-0.015em] text-text-strong">{props.node.name}</span>
            <span class="shrink-0 text-12-semibold tabular-nums text-text-strong">{formatBytes(props.node.size)}</span>
            <span class="shrink-0 text-10-regular tabular-nums text-text-weak">
              {formatPct(props.node.size, props.parentSize)}
            </span>
            <Show when={rec().tag}>
              <span
                class={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-9-semibold uppercase tracking-[0.08em] ring-1 ring-inset lg:inline ${SAFETY_ACCENT[rec().safety].pill}`}
              >
                {rec().tag}
              </span>
            </Show>
          </div>
          <p class="mt-1 max-w-[70ch] truncate font-mono text-10-regular text-text-weak" title={props.node.path}>
            {props.node.path}
          </p>
          <Show when={developerContext()}>
            {(context) => (
              <p
                class="mt-0.5 max-w-[70ch] truncate text-10-regular text-text-weak"
                title={`${context().scope} · ${context().disposition}${rec().hint ? ` · ${rec().hint}` : ""}`}
              >
                {context().scope} · <span class="text-10-semibold text-text-strong">{context().disposition}</span>
                <Show when={rec().hint}> · {rec().hint}</Show>
              </p>
            )}
          </Show>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <Show when={!props.node.isOther}>
          <Show when={props.onPreview}>
            <Button class="dl-touch-target" size="small" variant="ghost" icon="eye" onClick={props.onPreview}>
              Preview
            </Button>
          </Show>
          <Show when={props.node.isDir}>
            <Button class="dl-touch-target" size="small" variant="ghost" icon="enter" onClick={props.onOpen}>
              Open
            </Button>
          </Show>
          <Button
            class="dl-touch-target"
            size="small"
            variant="ghost"
            icon="square-arrow-top-right"
            onClick={props.onReveal}
          >
            Reveal
          </Button>
        </Show>
        <Show when={props.deletable}>
          <Button class="dl-touch-target" size="small" variant="ghost" icon="trash" onClick={props.onTrash}>
            {props.trashName}
          </Button>
          <Button
            class="dl-touch-target"
            size="small"
            variant={props.collected ? "secondary" : "primary"}
            icon={props.collected ? "circle-check" : "plus-small"}
            aria-pressed={props.collected}
            onClick={props.onCollect}
          >
            {props.collected ? "In cleanup" : "Add to cleanup"}
          </Button>
        </Show>
      </div>
    </div>
  )
}

function CollectionDialog(props: {
  phase: SurfacePhase
  items: DiskScanNode[]
  bytes: number
  deleting: boolean
  progress: DeletionProgress | null
  trashName: string
  onClose: () => void
  onRemove: (node: DiskScanNode) => void
  onConfirm: () => void
}) {
  return (
    <div
      class="dl-dialog-surface fixed inset-0 z-50 grid place-items-center bg-background-base/62 p-4 backdrop-blur-sm"
      data-state={props.phase}
      onClick={props.onClose}
      role="presentation"
    >
      <div
        class="dl-dialog-panel flex max-h-[min(680px,calc(100dvh-32px))] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface-raised-strong shadow-[0_0_0_1px_rgb(127_127_127/0.13),0_24px_80px_rgb(0_0_0/0.24)]"
        ref={focusDialog}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapDialogFocus}
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-title"
      >
        <div class="flex items-start gap-3 border-b border-border-weaker-base p-5">
          <span class="dl-accent-text grid size-10 shrink-0 place-items-center rounded-full bg-[oklch(0.72_0.12_176/0.14)]">
            <Icon name="checklist" class="size-4" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-9-semibold uppercase tracking-[0.14em] text-text-weaker">Cleanup review</p>
            <h2 id="collection-title" class="mt-1 text-20-medium tracking-[-0.03em] text-text-strong">
              {formatBytes(props.bytes)} across {props.items.length} {props.items.length === 1 ? "item" : "items"}
            </h2>
            <p class="mt-2 text-11-regular leading-relaxed text-text-weak">
              Check every item before anything leaves its original location.
            </p>
          </div>
          <Button
            size="small"
            variant="ghost"
            icon="close"
            disabled={props.deleting}
            onClick={props.onClose}
            aria-label="Close cleanup review"
          />
        </div>
        <VirtualRows
          items={props.items}
          ariaLabel="Items in the cleanup basket"
          estimateSize={() => 64}
          itemKey={(item) => item.path}
          render={(item) => (
            <div class="mx-3 flex h-full items-center gap-3 border-b border-border-weaker-base px-2 py-2 last:border-b-0">
              <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-raised-base text-text-weak">
                <Icon name={item.isDir ? "folder" : "code-lines"} class="size-3.5" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-12-semibold text-text-strong">{item.name}</span>
                <span class="mt-0.5 block truncate font-mono text-9-regular text-text-weaker" title={item.path}>
                  {item.path}
                </span>
              </span>
              <span class="shrink-0 text-11-semibold tabular-nums text-text-strong">{shortBytes(item.size)}</span>
              <Button
                class="dl-touch-target"
                size="small"
                variant="ghost"
                icon="close-small"
                disabled={props.deleting}
                aria-label={`Remove ${item.name} from cleanup basket`}
                onClick={() => props.onRemove(item)}
              />
            </div>
          )}
        />
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-weaker-base bg-background-base/55 p-4">
          <Show
            when={props.progress}
            fallback={
              <p class="flex items-center gap-1.5 text-10-regular text-text-weak">
                <Icon name="shield" class="size-3.5" />
                Items can be restored from {props.trashName}
              </p>
            }
          >
            {(progress) => (
              <p
                class="flex items-center gap-1.5 text-10-regular tabular-nums text-text-weak"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <span class="dl-spin size-3.5 rounded-full border border-border-weaker-base border-t-current" />
                Moving {progress().completed} of {progress().total}…
              </p>
            )}
          </Show>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <Button size="small" variant="ghost" disabled={props.deleting} onClick={props.onClose}>
              Back
            </Button>
            <Button size="small" variant="primary" icon="trash" disabled={props.deleting} onClick={props.onConfirm}>
              {props.progress
                ? `Moving ${props.progress.completed}/${props.progress.total}…`
                : `Move to ${props.trashName}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Slide-over drawer reviewing reclaimable items by category. */
function ReclaimDrawer(props: {
  phase: SurfacePhase
  reclaim: ReclaimSummary
  onClose: () => void
  onCollectAll: () => void
  onTrash: (node: DiskScanNode) => void
  deleting: boolean
}) {
  const rows = createMemo<ReclaimReviewRow[]>(() =>
    props.reclaim.buckets.flatMap((bucket) => [
      { type: "header" as const, key: `header:${bucket.safety}`, bucket },
      ...bucket.items.map((item, index) => ({
        type: "item" as const,
        key: `item:${item.node.path}`,
        item,
        first: index === 0,
        last: index === bucket.items.length - 1,
      })),
    ]),
  )

  return (
    <div
      class="dl-drawer-surface fixed inset-0 z-40 flex justify-end"
      data-state={props.phase}
      onClick={props.onClose}
      role="presentation"
    >
      <div class="dl-drawer-backdrop absolute inset-0 bg-background-base/58 backdrop-blur-sm" />
      <div
        class="dl-drawer-panel relative m-2 flex h-[calc(100%-16px)] w-[calc(100%-16px)] max-w-md flex-col overflow-hidden rounded-2xl bg-surface-raised-strong shadow-[0_0_0_1px_rgb(127_127_127/0.13),0_24px_80px_rgb(0_0_0/0.24)]"
        ref={focusDialog}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={trapDialogFocus}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reclaim-title"
      >
        <div class="shrink-0 border-b border-border-weaker-base px-5 pb-5 pt-5">
          <div class="flex items-start gap-3">
            <span class="dl-accent-text grid size-10 shrink-0 place-items-center rounded-full bg-[oklch(0.72_0.12_176/0.14)]">
              <Icon name="shield" class="size-4.5" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-9-semibold uppercase tracking-[0.14em] text-text-weaker">Recognized cleanup</p>
              <h2 id="reclaim-title" class="mt-1 text-20-medium tracking-[-0.03em] text-text-strong">
                Review {formatBytes(props.reclaim.totalBytes)}
              </h2>
              <p class="mt-2 max-w-[38ch] text-11-regular leading-relaxed text-text-weak">
                Every item below is explainable and actionable. Stage everything for one final review, or inspect one
                item at a time.
              </p>
            </div>
            <Button size="small" variant="ghost" icon="close" onClick={props.onClose} aria-label="Close review" />
          </div>
        </div>
        <VirtualRows
          items={rows()}
          ariaLabel="Recognized cleanup opportunities"
          estimateSize={(row) => (row.type === "header" ? 46 : 64)}
          itemKey={(row) => row.key}
          render={(row) => {
            if (row.type === "header") {
              return (
                <div class="flex h-full items-end gap-2 px-5 pb-2">
                  <span class={`mb-0.5 size-2 rounded-full ${SAFETY_ACCENT[row.bucket.safety].dot}`} />
                  <h3 class="text-9-semibold uppercase tracking-[0.14em] text-text-weak">
                    {row.bucket.safety.replace("-", " ")}
                  </h3>
                  <span class="ml-auto text-10-semibold tabular-nums text-text-strong">
                    {formatBytes(row.bucket.bytes)}
                  </span>
                </div>
              )
            }
            return (
              <div
                class="mx-4 flex h-full items-center gap-3 border-b border-border-weaker-base bg-background-base px-3 py-2"
                classList={{
                  "rounded-t-xl": row.first,
                  "rounded-b-xl border-b-0 shadow-[0_4px_16px_rgb(0_0_0/0.04)]": row.last,
                }}
              >
                <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-raised-base text-text-weak">
                  <Icon name={row.item.node.isDir ? "folder" : "code-lines"} class="size-3.5" />
                </span>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-12-semibold text-text-strong">{row.item.node.name}</p>
                  <p
                    class="mt-0.5 truncate font-mono text-9-regular text-text-weaker"
                    title={row.item.recognition.hint ?? row.item.node.path}
                  >
                    {row.item.recognition.hint ?? truncatePath(row.item.node.path, 44)}
                  </p>
                </div>
                <span class="shrink-0 text-11-semibold tabular-nums text-text-strong">
                  {shortBytes(row.item.node.size)}
                </span>
                <Button
                  class="dl-touch-target"
                  size="small"
                  variant="ghost"
                  icon="trash"
                  aria-label={`Review ${row.item.node.name} for removal`}
                  disabled={props.deleting}
                  onClick={() => props.onTrash(row.item.node)}
                />
              </div>
            )
          }}
        />
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-weaker-base bg-background-base/55 p-4">
          <div class="min-w-0">
            <p class="text-11-semibold text-text-strong">
              Collect {formatCount(props.reclaim.totalCount)}{" "}
              {props.reclaim.totalCount === 1 ? "candidate" : "candidates"}
            </p>
            <p class="mt-0.5 truncate text-9-regular text-text-weak">
              {formatBytes(props.reclaim.totalBytes)} · Nothing is removed until final review
            </p>
          </div>
          <Button
            class="ml-auto shrink-0"
            size="small"
            variant="primary"
            icon="checklist"
            disabled={props.deleting || props.reclaim.totalCount === 0}
            onClick={props.onCollectAll}
          >
            Collect all
          </Button>
        </div>
      </div>
    </div>
  )
}

const KEYFRAMES = `
.dl-shell {
  --dl-accent: oklch(0.76 0.155 148);
  --dl-accent-strong: oklch(0.7 0.17 148);
  --dl-hairline: 1px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-synthesis: none;
  font-variant-numeric: tabular-nums;
  background: var(--background-base);
}
.dl-workspace-frame {
  background: var(--background-base);
  box-shadow:
    0 0 0 var(--dl-hairline) color-mix(in oklch, var(--border-weaker-base) 72%, transparent),
    0 18px 52px -42px rgb(0 0 0 / 0.48);
}
.dl-landscape { background: color-mix(in oklch, var(--surface-raised-strong) 30%, var(--background-base)); }
.dl-inspector { box-shadow: -12px 0 36px -36px rgb(0 0 0 / 0.42); }
.dl-topbar {
  background: color-mix(in oklch, var(--background-base) 82%, transparent);
  box-shadow: 0 1px 0 rgb(127 127 127 / 0.1);
}
.dl-scan-tabs {
  background: color-mix(in oklch, var(--surface-raised-strong) 64%, transparent);
  box-shadow: 0 1px 0 rgb(127 127 127 / 0.08);
}
.dl-shell button, .dl-shell a, .dl-shell input { touch-action: manipulation; }
.dl-touch-target { min-width: 40px; min-height: 40px; }
.dl-shell ::selection { background: oklch(0.76 0.155 148 / 0.22); }
.dl-accent-text { color: color-mix(in oklch, var(--dl-accent-strong) 54%, var(--text-strong)); }
.dl-critical-text { color: color-mix(in oklch, oklch(0.62 0.2 25) 50%, var(--text-strong)); }
.dl-mark { box-shadow: inset 0 0 0 1px oklch(0.76 0.155 148 / 0.32); }
.dl-mark::before,.dl-mark::after { content: ""; position: absolute; border-radius: 999px; border: 1px solid currentColor; opacity: .45; }
.dl-mark::before { inset: 5px; border-left-color: transparent; transform: rotate(28deg); }
.dl-mark::after { inset: 9px; border-right-color: transparent; transform: rotate(-22deg); }
.dl-pop { animation: dl-pop 0.24s cubic-bezier(0.32,0.72,0,1) both; }
.dl-command-dock { box-shadow: 0 -1px 0 rgb(127 127 127 / 0.06); }
.dl-cleanup-dock {
  color: var(--text-weak);
  background: color-mix(in oklch, var(--surface-raised-strong) 76%, var(--background-base));
  box-shadow: inset 0 0 0 var(--dl-hairline) color-mix(in oklch, var(--border-weaker-base) 76%, transparent);
  transition: transform 150ms cubic-bezier(0.32,0.72,0,1), background-color 150ms ease-out, box-shadow 150ms ease-out;
}
.dl-cleanup-dock-icon {
  color: color-mix(in oklch, var(--dl-accent-strong) 48%, var(--text-strong));
  background: color-mix(in oklch, var(--dl-accent) 13%, var(--background-base));
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--dl-accent) 28%, transparent);
  transition: transform 150ms cubic-bezier(0.32,0.72,0,1);
}
.dl-cleanup-dock-filled {
  box-shadow: inset 0 0 0 var(--dl-hairline) color-mix(in oklch, var(--dl-accent) 34%, var(--border-weaker-base));
}
.dl-cleanup-dock-active {
  background: color-mix(in oklch, var(--dl-accent) 16%, var(--background-base));
  box-shadow: inset 0 0 0 2px color-mix(in oklch, var(--dl-accent) 68%, var(--text-strong));
  transform: translateY(-2px);
}
.dl-cleanup-dock-active .dl-cleanup-dock-icon { transform: scale(1.08); }
.dl-shortcut-key {
  display: grid; min-width: 28px; height: 28px; place-items: center; border-radius: 7px;
  color: var(--text-weak); background: var(--background-base);
  box-shadow: inset 0 -1px 0 rgb(127 127 127 / 0.16), inset 0 0 0 1px rgb(127 127 127 / 0.12);
  font: 600 11px/1 var(--font-family-mono); font-variant-numeric: tabular-nums;
}
.dl-dialog-surface { opacity: 0; backdrop-filter: blur(12px); transition: opacity 220ms cubic-bezier(0.32,0.72,0,1); }
.dl-dialog-panel { transform: scale(0.96) translateY(4px); transition: transform 220ms cubic-bezier(0.32,0.72,0,1); }
.dl-drawer-backdrop { opacity: 0; transition: opacity 260ms cubic-bezier(0.32,0.72,0,1); }
.dl-drawer-panel { transform: translateX(100%); transition: transform 260ms cubic-bezier(0.32,0.72,0,1); }
.dl-dialog-surface[data-state="open"], .dl-drawer-surface[data-state="open"] .dl-drawer-backdrop { opacity: 1; }
.dl-dialog-surface[data-state="open"] .dl-dialog-panel, .dl-drawer-surface[data-state="open"] .dl-drawer-panel { transform: none; }
.dl-dialog-surface[data-state="closing"], .dl-drawer-surface[data-state="closing"] { pointer-events: none; }
.dl-dialog-surface[data-state="closing"], .dl-dialog-surface[data-state="closing"] .dl-dialog-panel,
.dl-drawer-surface[data-state="closing"] .dl-drawer-backdrop, .dl-drawer-surface[data-state="closing"] .dl-drawer-panel {
  transition-duration: 160ms;
  transition-timing-function: cubic-bezier(0.4,0,1,1);
}
.dl-spin { animation: dl-spin 0.8s linear infinite; }
.dl-pulse { animation: dl-pulse 1.4s ease-in-out infinite; }
.dl-preview-image-stage {
  background: var(--surface-raised-strong);
}
.dl-preview-image-stage img { animation: dl-preview-arrive 180ms cubic-bezier(0.32,0.72,0,1) both; }
.dl-scan-branch { animation: dl-branch-arrive 180ms cubic-bezier(0.32,0.72,0,1) both; }
.dl-scan-orbit-segment { animation: dl-orbit-arrive 260ms cubic-bezier(0.32,0.72,0,1) both; }
.dl-scan-orbit-ticks { opacity: .34; }
.dl-drag-preview {
  position: fixed; left: -9999px; top: -9999px; z-index: 80; pointer-events: none;
  max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  border-radius: 12px; padding: 9px 12px; color: var(--text-strong); background: var(--background-base);
  box-shadow: 0 0 0 1px rgb(127 127 127 / 0.16), 0 12px 30px rgb(0 0 0 / 0.2);
  font: 600 12px/1.2 var(--font-family-text); font-variant-numeric: tabular-nums;
}
.dl-scan-beacon { animation: dl-scan-beacon 1.1s ease-in-out infinite; }
.dl-scan-indeterminate { width: 20%; animation: dl-scan-travel 1.2s cubic-bezier(0.32,0.72,0,1) infinite alternate; }
@keyframes dl-branch-arrive { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes dl-orbit-arrive { from { opacity: 0; } to { opacity: 1; } }
@keyframes dl-preview-arrive { from { opacity: 0; transform: scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes dl-pop { from { opacity: 0; transform: scale(0.96) translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes dl-spin { to { transform: rotate(360deg); } }
@keyframes dl-pulse { 0%,100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.12); opacity: 1; } }
@keyframes dl-scan-beacon { 0%,100% { opacity: .42; } 50% { opacity: 1; } }
@keyframes dl-scan-travel { from { transform: translateX(-100%); } to { transform: translateX(500%); } }
@media (pointer: coarse) {
  .dl-touch-target { min-width: 44px !important; min-height: 44px !important; }
  .dl-search-input { font-size: 16px !important; }
  .dl-row-action { width: 44px !important; height: 44px !important; opacity: 1 !important; }
  .dl-segmented { min-height: 44px; }
}
@media only screen and (min-device-pixel-ratio: 2), only screen and (min-resolution: 192dpi) {
  .dl-shell { --dl-hairline: 0.5px; }
}
@media (max-width: 760px) {
  .dl-brand-name { display: none; }
  .dl-pin-scan, .dl-rescan { max-width: 40px; overflow: hidden; }
  .dl-workspace-frame { flex-direction: column; }
  .dl-landscape { min-height: 52%; }
  .dl-inspector { width: 100% !important; min-height: 42%; border-left: 0 !important; border-top: 1px solid var(--border-weaker-base); }
  .dl-view-switch { top: 10px; right: 10px; }
  .dl-command-dock-inner { align-items: stretch; flex-direction: column; }
  .dl-cleanup-slot { width: 100% !important; }
}
@media (prefers-reduced-motion: reduce) {
  .dl-shell * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
`
