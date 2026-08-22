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
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import {
  usePlatform,
  type DiskDriveInfo,
  type DiskDriveFactsUpdate,
  type DiskFilePreview,
  type DiskScanNode,
  type DiskStorageDiagnostics,
  type DiskStorageLocation,
} from "@/context/platform"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"
import { Sunburst, primarySegmentColor, sunburstEntryDuration, type SunburstEntryIntent } from "./sunburst"
import { Treemap } from "./TreemapPanel"
import { ScanFormation } from "./ScanFormation"
import { CollectionDropTarget } from "./CollectionDropTarget"
import { PreviewDialog } from "./PreviewDialog"
import { createSurfacePresence } from "./motion"
import { isScanCancellation } from "./scan-progress"
import {
  clampedListIndex,
  inclusiveIndexRange,
  pagedListIndex,
  selectionAnchorIndex,
  wrappedListIndex,
} from "./list-navigation"
import { recentChangeNodes } from "./recent-changes"
import {
  ARTIFACT_ECOSYSTEMS,
  computeDeveloperSummaryWithInventory,
  computeReclaim,
  containsSharedPhysicalStorage,
  developerArtifactCleanupReadiness,
  developerArtifactContext,
  isSmartCleanupEligible,
  matchesArtifactEcosystem,
  recognize,
  type ArtifactEcosystem,
  type ArtifactEcosystemFilter,
  type DeveloperCategory,
  type DeveloperSummary,
  type ReclaimSummary,
} from "./recognize"
import {
  developerInventoryCollectionNodeForPath,
  developerInventoryNode,
  developerInventoryDeletePrecondition,
  developerInventoryRootsNeedRefresh,
  isDeveloperInventoryNode,
} from "./developer-inventory"
import { formatBytes, formatLastChanged, isDormant, shortBytes, formatPct, formatCount, truncatePath } from "./format"
import {
  developerCleanupAgeLabel,
  filterDeveloperItemsByAge,
  resolveDeveloperCleanupAge,
  type DeveloperCleanupAgePreset,
} from "./developer-cleanup"
import { SAFETY_ACCENT } from "./ui-tokens"
import { CenterOverlay, IndexEmpty, Placeholder } from "./DiskUtilityEmptyStates"
import { DeveloperCategoryButton, IndexLensButton, SegmentedButton } from "./DiskUtilityControls"
import { DeveloperCleanupPolicy } from "./DeveloperCleanupPolicy"
import { ReclaimBanner, type VolumeScanJob } from "./DiskUtilityDriveSurfaces"
import { DriveOverview } from "./DiskUtilityDriveOverview"
import { DetailBar } from "./DiskUtilityDetailBar"
import { CollectionDialog, DeleteConfirmDialog, ReclaimDrawer, type DeletionProgress } from "./DiskUtilityDialogs"
import { VirtualIndex } from "./DiskUtilityVirtualList"
import { clearReviewForRootScan } from "./scan-lifecycle"
import { refreshScanTabsForWatcherUpdate, visibleScanTabCount } from "./scan-tabs"
import { DISK_UTILITY_STYLES } from "./styles"
import {
  actionableReclaimSummary,
  asBrowseableRoot,
  canActOnNode,
  diskPathEquals,
  driveForPath,
  includeHiddenSpace,
  hasUnverifiedPhysicalCloneAccounting,
  isPhysicalByteAccounting,
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
type IndexLens = "all" | "developer" | "recommendations" | "changes"
type DeveloperCategoryFilter = DeveloperCategory | "all"
type Entry = { node: DiskScanNode; index: number; displaySize: number }
type CanvasPointerEvent = PointerEvent & { currentTarget: HTMLCanvasElement }
type ScanTab = {
  id: string
  sessionID?: string
  label: string
  sourcePath: string
  tree: DiskScanNode
  view: DiskScanNode
  drive?: DiskDriveInfo
}

const MAX_PARALLEL_VOLUME_SCANS = 3
const DEFAULT_LIST_PAGE_SIZE = 10
const EMPTY_RECLAIM: ReclaimSummary = { totalBytes: 0, totalCount: 0, buckets: [] }

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
  const language = useLanguage()
  const settings = useSettings()
  const isDesktop = () => platform.platform === "desktop"
  const disk = () => (platform.platform === "desktop" ? platform.diskUtility : undefined)

  const [view, setView] = createSignal<ViewMode>("drives")
  const [scanMode, setScanMode] = createSignal<ScanMode>("map")
  const [drives, setDrives] = createSignal<DiskDriveInfo[]>([])
  const [drivesLoading, setDrivesLoading] = createSignal(false)
  const [drivesError, setDrivesError] = createSignal<string>()
  const [storageDiagnostics, setStorageDiagnostics] = createSignal<DiskStorageDiagnostics>()
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
  const [selectedPath, setSelectedPath] = createSignal<string>()
  const [hoveredPath, setHoveredPath] = createSignal<string | null>(null)
  const [visualHoverNode, setVisualHoverNode] = createSignal<DiskScanNode | null>(null)
  const [focusIdx, setFocusIdx] = createSignal(0)
  const [rangeAnchorIndex, setRangeAnchorIndex] = createSignal<number>()
  const [pendingDelete, setPendingDelete] = createSignal<DiskScanNode | null>(null)
  const [deleting, setDeleting] = createSignal(false)
  const [deletionProgress, setDeletionProgress] = createSignal<DeletionProgress | null>(null)
  const [query, setQuery] = createSignal("")
  const [announcedSelection, setAnnouncedSelection] = createSignal("")
  const [indexFilter, setIndexFilter] = createStore<{
    lens: IndexLens
    developerCategory: DeveloperCategoryFilter
    developerEcosystem: ArtifactEcosystemFilter
    developerAge: DeveloperCleanupAgePreset
    customDeveloperAgeDays: string
  }>({
    lens: "all",
    developerCategory: "all",
    developerEcosystem: "all",
    developerAge: "all",
    customDeveloperAgeDays: "30",
  })
  const reviewSurface = createSurfacePresence()
  const collectionSurface = createSurfacePresence()
  const deleteSurface = createSurfacePresence()
  const previewSurface = createSurfacePresence()
  const [previewTarget, setPreviewTarget] = createSignal<DiskScanNode | null>(null)
  const [filePreview, setFilePreview] = createSignal<DiskFilePreview>()
  const [previewLoading, setPreviewLoading] = createSignal(false)
  const [previewError, setPreviewError] = createSignal<string>()
  const [tabs, setTabs] = createSignal<ScanTab[]>([])
  const [volumeScanJobs, setVolumeScanJobs] = createStore<Record<string, VolumeScanJob | undefined>>({})
  const [scanSession, setScanSession] = createStore<{ activeID?: string; foregroundID?: string }>({})
  const [collection, setCollection] = createSignal<DiskScanNode[]>([])
  const [dropActive, setDropActive] = createSignal(false)
  const [collectionDragNode, setCollectionDragNode] = createSignal<DiskScanNode | null>(null)
  const [collectionDropActive, setCollectionDropActive] = createSignal(false)
  const [focusedScan, setFocusedScan] = createSignal<{ label: string } | null>(null)
  const [scanTabsElement, setScanTabsElement] = createSignal<HTMLDivElement>()
  const [scanTabsOverflow, setScanTabsOverflow] = createSignal({ start: false, end: false })
  const volumeJobs = createMemo(() => Object.values(volumeScanJobs).filter((job): job is VolumeScanJob => !!job))
  const scanTabCount = createMemo(
    () =>
      visibleScanTabCount({
        retainedCount: tabs().length,
        volumeJobIDs: volumeJobs().map((job) => job.id),
        activeID: scanSession.activeID,
        hasCurrentScan: view() === "scan" && !!treeRoot(),
      }),
  )

  const [canvasEl, setCanvasEl] = createSignal<HTMLCanvasElement | undefined>()
  const [sunburst, setSunburst] = createSignal<Sunburst | undefined>()
  let scanUnsub: (() => void) | undefined
  const volumeScanUnsubs = new Map<string, () => void>()
  let scanUpdateUnsub: (() => void) | undefined
  let driveFactsUnsub: (() => void) | undefined
  let receivedDriveFacts: DiskDriveFactsUpdate[] = []
  let scanToken = 0
  let previewToken = 0
  let scanMaxBytes = 0
  let orbitEntryIntent: SunburstEntryIntent = "scan-complete"
  let dragDepth = 0
  let selectionAnnouncementTimer: ReturnType<typeof setTimeout> | undefined
  let collectionDragPreview!: HTMLDivElement
  let collectionDropElement: HTMLElement | undefined
  let mapDrag:
    | { node: DiskScanNode; pointerId: number; startX: number; startY: number; threshold: number; dragging: boolean }
    | undefined
  let scrollIndexIntoView: ((index: number) => void) | undefined
  let listPageSize = () => DEFAULT_LIST_PAGE_SIZE

  const crumbs = createMemo(() => buildCrumbs(treeRoot(), viewNode()))
  const usesPhysicalByteAccounting = createMemo(() => isPhysicalByteAccounting(platform.os, scanDrive()))
  /** A fallback or incomplete map must never turn unknown shared storage into a reclaim promise. */
  const physicalCloneAccountingUncertain = createMemo(
    () => hasUnverifiedPhysicalCloneAccounting(treeRoot(), platform.os, scanDrive()),
  )
  const physicalCloneAccountingWarning = createMemo(() => {
    const root = treeRoot()
    const capability = root?.cloneMetadata
    const sharedStorageEvidence = root?.sharedStorageEvidence
    if (!physicalCloneAccountingUncertain()) return undefined
    if (sharedStorageEvidence === "partial") {
      return "One or more summarized, excluded, or unreadable branches may hide shared storage. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space."
    }
    if (sharedStorageEvidence !== "complete") {
      return "This map cannot verify that all shared-storage relationships are visible. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space."
    }
    if (capability?.state === "unavailable" && capability.reason === "scanner") {
      return "The native metadata scanner was unavailable for this map. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space until clone sharing can be verified."
    }
    if (capability?.state === "unknown") {
      return "The filesystem could not confirm enough clone metadata for this map. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space."
    }
    return "This map does not include verified clone metadata. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space."
  })
  const reclaim = createMemo<ReclaimSummary>(() =>
    physicalCloneAccountingUncertain() ? EMPTY_RECLAIM : actionableReclaimSummary(computeReclaim(treeRoot()), platform.os),
  )
  const developer = createMemo<DeveloperSummary>(() => computeDeveloperSummaryWithInventory(treeRoot()))
  const developerAge = createMemo(() => resolveDeveloperCleanupAge(indexFilter.developerAge, indexFilter.customDeveloperAgeDays))
  const developerItems = createMemo(() => {
    const category = indexFilter.developerCategory
    const ecosystem = indexFilter.developerEcosystem
    const categorized = developer().items.filter(
      ({ recognition }) =>
        (category === "all" || recognition.developer === category) && matchesArtifactEcosystem(recognition, ecosystem),
    )
    return filterDeveloperItemsByAge(categorized, developerAge())
  })
  const developerEcosystems = createMemo<ArtifactEcosystem[]>(() =>
    ARTIFACT_ECOSYSTEMS.filter((ecosystem) => developer().items.some((item) => item.recognition.ecosystem === ecosystem)),
  )
  const parentSize = createMemo(() => viewNode()?.size ?? 0)
  const parentCount = createMemo(() => viewNode()?.children?.length ?? 0)
  const sizeBasisLabel = createMemo(() => {
    if (!usesPhysicalByteAccounting()) return "file size"
    return physicalCloneAccountingUncertain() ? "physical allocation · shared blocks unverified" : "disk space used"
  })

  const sortedChildren = createMemo<DiskScanNode[]>(() => {
    const node = viewNode()
    if (!node) return []
    return [...(node.children ?? [])].sort((a, b) => b.size - a.size)
  })
  const recentChanges = createMemo(() => recentChangeNodes(treeRoot()))
  const entries = createMemo<Entry[]>(() => {
    const q = query().trim().toLowerCase()
    const nodes: { node: DiskScanNode; displaySize: number }[] =
      indexFilter.lens === "developer"
        ? developerItems().map(({ node, bytes }) => ({ node, displaySize: bytes }))
        : indexFilter.lens === "recommendations"
          ? reclaim()
              .buckets.flatMap((bucket) => bucket.items.map(({ node }) => node))
              .sort((a, b) => b.size - a.size)
              .map((node) => ({ node, displaySize: node.size }))
          : indexFilter.lens === "changes"
            ? recentChanges().map((node) => ({ node, displaySize: node.size }))
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
  const indexSize = createMemo(() =>
    indexFilter.lens === "developer"
      ? developerItems().reduce((total, item) => total + item.bytes, 0)
      : indexFilter.lens === "recommendations"
        ? reclaim().totalBytes
        : indexFilter.lens === "changes"
          ? recentChanges().reduce((total, node) => total + node.size, 0)
        : parentSize(),
  )
  const indexCount = createMemo(() =>
    indexFilter.lens === "developer"
      ? developerItems().length
      : indexFilter.lens === "recommendations"
        ? reclaim().totalCount
        : indexFilter.lens === "changes"
          ? recentChanges().length
        : parentCount(),
  )
  // A watcher can rebase a selected deep result against a newer inventory.
  // Never let an identity-less replacement remain actionable while that
  // reconciliation is in flight (or if an older renderer left one behind).
  const effectiveCollection = createMemo(() =>
    uniqueDeletionRoots(collection().filter((node) => !inventoryDeletionNeedsRescan(node)), platform.os),
  )
  /**
   * Bulk selection is narrower than the Developer lens: only known
   * regenerable/cache artifacts with a verified storage map are eligible.
   * Everything else remains inspectable and must be reviewed individually.
   */
  const smartCleanupEligibleEntries = createMemo(() => {
    if (indexFilter.lens !== "developer" || physicalCloneAccountingUncertain() || !developerAge().valid) return []
    return entries()
      .map(({ node }) => node)
      .filter((node) => {
        const recognition = recognize(node)
        return isSmartCleanupEligible(node, recognition) && canModifyNode(node)
      })
  })
  const smartCleanupCandidates = createMemo(() => uniqueDeletionRoots(smartCleanupEligibleEntries(), platform.os))
  const smartCleanupCandidateBytes = createMemo(() => smartCleanupCandidates().reduce((total, node) => total + node.size, 0))
  const smartCleanupReviewCount = createMemo(() =>
    Math.max(0, (indexFilter.lens === "developer" ? entries().length : 0) - smartCleanupEligibleEntries().length),
  )
  const pinnedLocations = settings.general.diskPinnedLocations
  const currentScanPinned = createMemo(() => {
    const path = scanSourcePath()
    return !!path && isPinnedScanLocation(pinnedLocations(), path, platform.os)
  })
  const collectionSize = createMemo(() => effectiveCollection().reduce((s, n) => s + n.size, 0))
  const collectionHasSharedPhysicalStorage = createMemo(() => effectiveCollection().some(containsSharedPhysicalStorage))
  const collectionNeedsDeepInventoryRefresh = createMemo(() => requiresDeepInventoryRefresh(effectiveCollection()))
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
  const runningVolumeScans = createMemo(() => volumeJobs().filter((job) => job.status === "scanning").length)
  const volumeJobForDrive = (drive: DiskDriveInfo) =>
    volumeJobs().find((job) => diskPathEquals(job.sourcePath, drive.path, platform.os))
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
    driveFactsUnsub = api.onDriveFacts((update) => {
      receivedDriveFacts = [
        ...receivedDriveFacts.filter((candidate) => !diskPathEquals(candidate.path, update.path, platform.os)),
        update,
      ]
      setDrives((current) =>
        current.map((drive) =>
          diskPathEquals(drive.path, update.path, platform.os) ? { ...drive, ...update.facts } : drive,
        ),
      )
    })
    void loadDrives()
    scanUpdateUnsub = api.onScanUpdate((update) => {
      const job = volumeScanJobs[update.scanId]
      if (job) {
        const tree = scanUpdateTree(update.root, job.drive, job.label)
        setVolumeScanJobs(update.scanId, "tree", tree)
      }

      // Watchers keep running for parked tabs. Give a matching background tab
      // the fresh root (including its new immutable deep inventory) before it
      // can be reopened, and rebase only basket entries scoped to that map.
      const updatedTabs = tabs().filter((tab) => tab.sessionID === update.scanId)
      if (updatedTabs.length) {
        setTabs((items) =>
          refreshScanTabsForWatcherUpdate(
            items,
            update.scanId,
            (tab) => scanUpdateTree(update.root, tab.drive, tab.label),
            platform.os,
          ),
        )
        for (const tab of updatedTabs) {
          reconcileCollectionForScanUpdate(scanUpdateTree(update.root, tab.drive, tab.label), update.rootPath)
        }
      }

      if (
        update.scanId !== scanSession.activeID ||
        view() !== "scan" ||
        !diskPathEquals(update.rootPath, scanSourcePath(), platform.os)
      )
        return
      const tree = scanUpdateTree(update.root, job?.drive ?? scanDrive(), job?.label ?? (scanLabel() || update.root.name))
      const previousViewPath = viewNode()?.path
      const previousSelection = selectedPath()
      const nextView = previousViewPath ? findScanNode(tree, previousViewPath) : undefined
      const nextSelection = previousSelection ? findScanNode(tree, previousSelection) : undefined
      batch(() => {
        setTreeRoot(tree)
        setViewNode(nextView ?? tree)
        setSelectedPath(nextSelection?.path)
        setHoveredPath(null)
        setVisualHoverNode(null)
        reconcileCollectionForScanUpdate(tree, update.rootPath)
      })
    })
  })

  function updateScanTabsOverflow() {
    const element = scanTabsElement()
    if (!element) {
      setScanTabsOverflow({ start: false, end: false })
      return
    }
    setScanTabsOverflow({
      start: element.scrollLeft > 1,
      end: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
    })
  }

  function handleScanTabsKeyDown(event: KeyboardEvent & { currentTarget: HTMLDivElement }) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.scrollBy({
      left: event.key === "ArrowLeft" ? -180 : 180,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    })
  }

  createEffect(() => {
    scanTabCount()
    const element = scanTabsElement()
    if (!element) return
    const observer = new ResizeObserver(updateScanTabsOverflow)
    observer.observe(element)
    element.addEventListener("scroll", updateScanTabsOverflow, { passive: true })
    requestAnimationFrame(updateScanTabsOverflow)
    onCleanup(() => {
      observer.disconnect()
      element.removeEventListener("scroll", updateScanTabsOverflow)
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
      rings: 3,
      maxSegments: 360,
      padAngle: 0.0016,
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
        selectPath(seg.path)
      },
      onMetaClick: (seg) => {
        if (!seg.node.isOther) void reveal(seg.path)
      },
      onDoubleClick: (seg) => {
        if (seg.node.isDir && !seg.node.isOther) drill(seg.node)
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
    volumeScanUnsubs.forEach((unsubscribe) => unsubscribe())
    volumeScanUnsubs.clear()
    scanUpdateUnsub?.()
    driveFactsUnsub?.()
    scanToken++
    void disk()?.cancelScan()
    void disk()?.stopWatching()
    sunburst()?.destroy()
    if (selectionAnnouncementTimer) clearTimeout(selectionAnnouncementTimer)
  })

  function findScanNode(root: DiskScanNode, targetPath: string): DiskScanNode | undefined {
    if (diskPathEquals(root.path, targetPath, platform.os)) return root
    for (const child of root.children) {
      const match = findScanNode(child, targetPath)
      if (match) return match
    }
    return undefined
  }

  function scanUpdateTree(root: DiskScanNode, drive: DiskDriveInfo | undefined, label: string): DiskScanNode {
    return { ...includeHiddenSpace(asBrowseableRoot(root), drive), _label: label }
  }

  function pathBelongsToScanRoot(path: string, rootPath: string) {
    const normalize = (value: string) => {
      const normalized = value.replaceAll("\\", "/").replace(/\/+$/, "") || "/"
      return platform.os === "windows" ? normalized.toLowerCase() : normalized
    }
    const candidate = normalize(path)
    const root = normalize(rootPath)
    return candidate === root || (root === "/" ? candidate.startsWith("/") : candidate.startsWith(`${root}/`))
  }

  function reconcileCollectionForScanUpdate(tree: DiskScanNode, scanRootPath: string) {
    setCollection((items) =>
      items.flatMap((item) => {
        const refreshed = developerInventoryCollectionNodeForPath(tree, item.path, platform.os)
        // A refreshed inventory row without its scanner-captured directory
        // identity cannot be reviewed or deleted. Prune it instead of leaving
        // a stale basket entry that would later fail closed at delete time.
        if (refreshed && !inventoryDeletionNeedsRescan(refreshed)) return [refreshed]
        // Keep selections from other tabs, but drop a stale member of this
        // scan rather than turning an old deep record into a delete target.
        return pathBelongsToScanRoot(item.path, scanRootPath) ? [] : [item]
      }),
    )
  }

  function requiresDeepInventoryRefresh(removed: readonly DiskScanNode[]) {
    return developerInventoryRootsNeedRefresh(
      [treeRoot(), ...tabs().map((tab) => tab.tree), ...volumeJobs().map((job) => job.tree)],
      removed,
      platform.os,
    )
  }

  async function loadDrives() {
    const api = disk()
    if (!api) return
    setDrivesLoading(true)
    setDrivesError(undefined)
    setStorageDiagnostics(undefined)
    try {
      const list = await withTimeout(api.getDrives(), 8000, "Listing drives")
      setDrives(
        list.map((drive) => {
          const facts = receivedDriveFacts.find((candidate) => diskPathEquals(candidate.path, drive.path, platform.os))
          return facts ? { ...drive, ...facts.facts } : drive
        }),
      )
      // Diagnostics are helpful context, not a dependency for the main drive
      // chooser. Let it settle independently so a permission probe never
      // delays the first useful screen.
      void withTimeout(api.getStorageDiagnostics(), 8000, "Checking connected storage")
        .then(setStorageDiagnostics)
        .catch(() => undefined)
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

  function scanStorageLocation(location: DiskStorageLocation) {
    void startScan(location.path, location.name, driveForPath(location.path, drives(), platform.os))
  }

  async function openDiskAccessSettings() {
    const api = disk()
    if (!api) return
    try {
      const opened = await api.openDiskAccessSettings()
      if (opened) return
      showToast({ variant: "default", title: "No privacy settings page is available on this platform" })
    } catch (error) {
      showToast({
        variant: "error",
        title: "Could not open privacy settings",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function newScanID(kind: "volume" | "folder" | "expand") {
    return `${kind}-${crypto.randomUUID()}`
  }

  function startVolumeScan(drive: DiskDriveInfo) {
    const api = disk()
    if (!api) return
    const existing = volumeJobForDrive(drive)
    if (existing?.status === "scanning") return
    if (runningVolumeScans() >= MAX_PARALLEL_VOLUME_SCANS) {
      showToast({
        variant: "default",
        title: "Three scans are already running",
        description: "Let one finish or cancel it before starting another.",
      })
      return
    }
    if (existing) {
      volumeScanUnsubs.get(existing.id)?.()
      volumeScanUnsubs.delete(existing.id)
      void api.stopWatching(existing.id)
      setVolumeScanJobs(existing.id, undefined)
    }

    const id = newScanID("volume")
    setVolumeScanJobs(id, {
      id,
      status: "scanning",
      label: drive.name,
      sourcePath: drive.path,
      drive,
      files: 0,
      bytes: 0,
      pct: 0,
      currentPath: "",
      startedAt: Date.now(),
      source: undefined,
    })
    const unsubscribe = api.onScanProgress((progress) => {
      if (progress.scanId !== id || volumeScanJobs[id]?.status !== "scanning") return
      const bytes = Math.max(volumeScanJobs[id]?.bytes ?? 0, progress.size)
      setVolumeScanJobs(id, {
        files: progress.filesScanned,
        bytes,
        pct: drive.used > 0 ? Math.min(99, (bytes / drive.used) * 100) : 0,
        currentPath: progress.currentPath,
        ...(progress.source ? { source: progress.source } : {}),
      })
    })
    volumeScanUnsubs.set(id, unsubscribe)
    void runVolumeScan(id, drive)
  }

  async function runVolumeScan(id: string, drive: DiskDriveInfo) {
    const api = disk()
    if (!api) return
    try {
      const scannedTree = await api.scanPath(drive.path, scannerOptions(drive), id)
      if (!scannedTree || volumeScanJobs[id]?.status !== "scanning") return
      const tree = includeHiddenSpace(asBrowseableRoot(scannedTree), drive)
      tree._label = drive.name
      setVolumeScanJobs(id, {
        status: "complete",
        tree,
        bytes: tree.size,
        pct: 100,
        currentPath: "",
        completedAt: Date.now(),
      })
      showToast({
        variant: "default",
        title: `${drive.name} is ready`,
        description: "Open its storage map when you’re ready.",
      })
    } catch (error) {
      if (!volumeScanJobs[id] || isScanCancellation(error)) return
      setVolumeScanJobs(id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      volumeScanUnsubs.get(id)?.()
      volumeScanUnsubs.delete(id)
    }
  }

  function cancelVolumeScan(id: string) {
    const api = disk()
    volumeScanUnsubs.get(id)?.()
    volumeScanUnsubs.delete(id)
    setVolumeScanJobs(id, undefined)
    void api?.cancelScan(id)
  }

  function closeVolumeScan(id: string) {
    if (volumeScanJobs[id]?.status === "scanning") {
      cancelVolumeScan(id)
      return
    }
    setVolumeScanJobs(id, undefined)
    void disk()?.stopWatching(id)
  }

  function openVolumeScan(job: VolumeScanJob) {
    if (!job.tree) return
    saveCurrentTab()
    setScanSession({ activeID: job.id, foregroundID: undefined })
    orbitEntryIntent = "scan-complete"
    batch(() => {
      setView("scan")
      setScanning(false)
      setFocusedScan(null)
      setTreeRoot(job.tree!)
      setViewNode(job.tree!)
      setScanSourcePath(job.sourcePath)
      setScanLabel(job.label)
      setScanDrive(job.drive)
      setScanFiles(job.files)
      setScanBytes(job.bytes)
      setScanTotal(job.drive.used)
      setScanPct(100)
      setSelectedPath(undefined)
      setHoveredPath(null)
      setVisualHoverNode(null)
      setQuery("")
      setIndexFilter({ lens: "all", developerCategory: "all" })
      setFocusIdx(0)
      setRangeAnchorIndex(undefined)
    })
  }

  /** Snapshot the current completed scan as a background tab before replacing it. */
  function saveCurrentTab() {
    const root = treeRoot()
    if (!root || (scanSession.activeID && volumeScanJobs[scanSession.activeID])) return
    setTabs((prev) => [
      ...prev,
      {
        id: `tab-${Date.now()}-${prev.length}`,
        sessionID: scanSession.activeID,
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
    setScanSession({ activeID: tab.sessionID, foregroundID: undefined })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    setIndexFilter({ lens: "all", developerCategory: "all" })
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
  }

  function closeTab(id: string) {
    const tab = tabs().find((item) => item.id === id)
    setTabs((prev) => prev.filter((item) => item.id !== id))
    if (tab?.sessionID && !volumeScanJobs[tab.sessionID]) void disk()?.stopWatching(tab.sessionID)
  }

  function scannerOptions(drive?: DiskDriveInfo, includeDeveloperInventory = true) {
    return {
      // Materialize the visible map only; deeper branches remain exact-sized
      // aggregate nodes and are expanded on demand.
      maxDepth: 6,
      sizeMode: platform.os === "windows" || drive?.type === "network" ? ("logical" as const) : ("physical" as const),
      preserveNames: [...IMPORTANT_PRESERVE_NAMES],
      collapseNames: [...DEVELOPER_COLLAPSE_NAMES],
      signatureNames: [...DEVELOPER_SIGNATURE_NAMES],
      // This is intentionally separate from the visual depth limit so the
      // Developer lens can expose deep build/dependency artifacts too. Focused
      // subtree expansions leave it out: the root inventory remains the sole
      // authoritative bounded traversal for the current map.
      ...(includeDeveloperInventory ? { developerArtifactInventory: { maxItems: 2_000 } } : {}),
    }
  }

  async function startScan(
    path: string,
    label: string,
    drive?: DiskDriveInfo,
    preserveCurrent = true,
    forceFresh = false,
  ) {
    const api = disk()
    if (!api) return
    scanUnsub?.()
    if (preserveCurrent) saveCurrentTab()
    const token = ++scanToken
    const sessionID = !preserveCurrent && scanSession.activeID ? scanSession.activeID : newScanID("folder")
    const startedAt = Date.now()
    setScanSession({ activeID: sessionID, foregroundID: sessionID })
    if (volumeScanJobs[sessionID]) {
      setVolumeScanJobs(sessionID, {
        status: "scanning",
        files: 0,
        bytes: 0,
        pct: 0,
        currentPath: "",
        startedAt,
        completedAt: undefined,
        source: undefined,
      })
    }
    orbitEntryIntent = "scan-complete"
    setFocusedScan(null)
    setView("scan")
    setScanning(true)
    // A root scan replaces the authoritative map. The review basket can hold
    // deep inventory nodes from a prior root (or another tab), so clear it
    // synchronously before the old map disappears or the first scan await.
    clearReviewForRootScan({
      setCollection,
      setDragNode: setCollectionDragNode,
      setDropActive: setCollectionDropActive,
      closeReview: collectionSurface.close,
    })
    setScanLabel(label)
    setScanFiles(0)
    const isVolumeRoot = !!drive && diskPathEquals(path, drive.path, platform.os)
    setScanTotal(isVolumeRoot ? drive.used : 0)
    setScanPct(0)
    setScanBytes(0)
    scanMaxBytes = 0
    setScanTail("")
    setTreeRoot(null)
    setViewNode(null)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    setIndexFilter({ lens: "all", developerCategory: "all" })
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    setScanDrive(drive)
    setScanSourcePath(path)
    scanUnsub = api.onScanProgress((p) => {
      if (token !== scanToken || p.scanId !== sessionID) return
      setScanFiles(p.filesScanned)
      setScanTail(p.currentPath)
      if (p.size > scanMaxBytes) {
        scanMaxBytes = p.size
        setScanBytes(scanMaxBytes)
        if (isVolumeRoot && drive.used) setScanPct(Math.min(99, (scanMaxBytes / drive.used) * 100))
      }
      if (volumeScanJobs[sessionID]) {
        setVolumeScanJobs(sessionID, {
          files: p.filesScanned,
          bytes: scanMaxBytes,
          pct: isVolumeRoot && drive.used ? Math.min(99, (scanMaxBytes / drive.used) * 100) : 0,
          currentPath: p.currentPath,
          ...(p.source ? { source: p.source } : {}),
        })
      }
    })
    try {
      const scannedTree = await api.scanPath(
        path,
        { ...scannerOptions(drive), ...(forceFresh ? { forceFresh: true } : {}) },
        sessionID,
      )
      if (token !== scanToken || !scannedTree) return // superseded or cancelled
      const tree = includeHiddenSpace(asBrowseableRoot(scannedTree), drive)
      tree._label = label
      setScanPct(100)
      setTreeRoot(tree)
      setViewNode(tree)
      if (volumeScanJobs[sessionID]) {
        setVolumeScanJobs(sessionID, {
          status: "complete",
          tree,
          bytes: tree.size,
          pct: 100,
          currentPath: "",
          completedAt: Date.now(),
        })
      }
    } catch (err) {
      if (token !== scanToken || isScanCancellation(err)) return
      const message = err instanceof Error ? err.message : String(err)
      showToast({ variant: "error", title: "Scan failed", description: message })
      if (volumeScanJobs[sessionID]) setVolumeScanJobs(sessionID, { status: "failed", error: message })
      setView("drives")
      setScanSourcePath("")
      setScanLabel("")
      setScanDrive(undefined)
      setScanSession("activeID", undefined)
    } finally {
      if (token === scanToken) {
        setScanning(false)
        scanUnsub?.()
        scanUnsub = undefined
        setScanSession("foregroundID", undefined)
      }
    }
  }

  async function expandCollapsedNode(node: DiskScanNode, restoreListFocus = false) {
    const api = disk()
    const root = treeRoot()
    if (!api || !root) return
    scanUnsub?.()
    const token = ++scanToken
    const sessionID = newScanID("expand")
    setScanSession("foregroundID", sessionID)
    orbitEntryIntent = "scan-complete"
    const drive = driveForPath(node.path, drives(), platform.os) ?? scanDrive()
    setFocusedScan({ label: node.name })
    setScanning(true)
    setScanFiles(0)
    setScanTotal(0)
    setScanPct(0)
    setScanBytes(0)
    scanMaxBytes = 0
    setScanTail("")
    scanUnsub = api.onScanProgress((progress) => {
      if (token !== scanToken || progress.scanId !== sessionID) return
      setScanFiles(progress.filesScanned)
      setScanTail(progress.currentPath)
      if (progress.size <= scanMaxBytes) return
      scanMaxBytes = progress.size
      setScanBytes(scanMaxBytes)
    })

    try {
      const scannedTree = await api.scanPath(node.path, scannerOptions(drive, false), sessionID)
      if (token !== scanToken || !scannedTree) return
      const replacement = asBrowseableRoot(scannedTree)
      const nextRoot = replaceScanSubtree(root, node.path, replacement, platform.os)
      if (nextRoot === root) throw new Error("The folder changed while it was being scanned. Try opening it again.")
      setScanPct(100)
      setTreeRoot(nextRoot)
      setViewNode(replacement)
      if (scanSession.activeID && volumeScanJobs[scanSession.activeID]) {
        setVolumeScanJobs(scanSession.activeID, "tree", nextRoot)
      }
      setCollection((items) =>
        items.map((item) => (diskPathEquals(item.path, node.path, platform.os) ? replacement : item)),
      )
      setIndexFilter({ lens: "all", developerCategory: "all" })
      setSelectedPath(undefined)
      setHoveredPath(null)
      setVisualHoverNode(null)
      setQuery("")
      setFocusIdx(0)
      setRangeAnchorIndex(undefined)
      if (restoreListFocus) focusListEntry(0)
    } catch (error) {
      if (token !== scanToken || isScanCancellation(error)) return
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
        setScanSession("foregroundID", undefined)
        void api.stopWatching(sessionID)
      }
    }
  }

  async function rescanCurrent(forceFresh = false) {
    const api = disk()
    const root = treeRoot()
    if (!api || !root) return
    const path = scanSourcePath() || root.path
    const label = scanLabel() || root.name
    const drive = scanDrive()
    // Start immediately so stale map actions cannot race a slow drive-facts
    // request. Capacity refresh is helpful context, never a prerequisite for
    // rebuilding a destructive-action source of truth.
    const scan = startScan(path, label, drive, false, forceFresh)
    if (drive) {
      void withTimeout(api.getDrives(), 8000, "Refreshing drive totals")
        .then(setDrives)
        // A scan remains useful when a removable/network drive cannot refresh
        // its capacity metadata.
        .catch(() => undefined)
    }
    await scan
  }

  /** Abort a focused expansion in place; primary scans return to the volume list. */
  function cancelScan() {
    const focused = focusedScan()
    const sessionID = scanSession.foregroundID
    scanToken++
    scanUnsub?.()
    scanUnsub = undefined
    setScanSession("foregroundID", undefined)
    if (sessionID) void disk()?.cancelScan(sessionID)
    if (sessionID && volumeScanJobs[sessionID]) setVolumeScanJobs(sessionID, undefined)
    setFocusedScan(null)
    setScanning(false)
    if (!focused) backToDrives()
  }

  function drill(node: DiskScanNode, instant = false, restoreListFocus = false) {
    if (scanning() || !node.isDir || node.isOther || isDeveloperInventoryNode(node)) return
    if (node.isCollapsed) {
      void expandCollapsedNode(node, restoreListFocus)
      return
    }
    sunburst()?.navigateTo(node, instant)
    setViewNode(node)
    setIndexFilter({ lens: "all", developerCategory: "all" })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setVisualHoverNode(null)
    setQuery("")
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    if (restoreListFocus) focusListEntry(0)
  }

  function chooseLens(lens: IndexLens) {
    setIndexFilter({ lens, developerCategory: "all" })
    setQuery("")
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    scrollIndexIntoView?.(0)
  }

  function chooseDeveloperCategory(category: DeveloperCategoryFilter) {
    setIndexFilter("developerCategory", category)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    scrollIndexIntoView?.(0)
  }

  function chooseDeveloperEcosystem(ecosystem: ArtifactEcosystemFilter) {
    setIndexFilter("developerEcosystem", ecosystem)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    scrollIndexIntoView?.(0)
  }

  function chooseDeveloperCleanupAge(age: DeveloperCleanupAgePreset) {
    setIndexFilter("developerAge", age)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    scrollIndexIntoView?.(0)
  }

  function setCustomDeveloperCleanupAgeDays(days: string) {
    setIndexFilter("customDeveloperAgeDays", days)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    scrollIndexIntoView?.(0)
  }

  function updateQuery(value: string) {
    setQuery(value)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    scrollIndexIntoView?.(0)
  }

  /** A keyboard view switch must land on a real control in the newly mounted view. */
  function restoreKeyboardViewFocus(mode: ScanMode) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (mode === "map") {
          const canvas = canvasEl()
          if (canvas) {
            canvas.focus({ preventScroll: true })
            return
          }
          focusPersistentDiskAction()
          return
        }
        if (mode === "list") {
          focusListEntry(clampedListIndex(focusIdx(), entries().length))
          return
        }
        const desiredPath = selectedPath() ?? entries()[clampedListIndex(focusIdx(), entries().length)]?.node.path
        const tile = [...document.querySelectorAll<HTMLElement>("[data-disk-tile-path]")].find(
          (element) => element.dataset.diskTilePath === desiredPath,
        )
        const focusTarget = tile ?? document.querySelector<HTMLElement>("[data-disk-tile-path]")
        if (focusTarget) {
          focusTarget.focus({ preventScroll: true })
          return
        }
        focusPersistentDiskAction()
      })
    })
  }

  function chooseScanMode(mode: ScanMode, intent: Exclude<SunburstEntryIntent, "scan-complete"> = "pointer") {
    if (mode === "map" && scanMode() !== "map") orbitEntryIntent = intent
    setScanMode(mode)
    setVisualHoverNode(null)
    setHoveredPath(null)
    if (intent === "keyboard") restoreKeyboardViewFocus(mode)
  }

  function togglePinnedLocation(path: string, label: string) {
    const wasPinned = isPinnedScanLocation(pinnedLocations(), path, platform.os)
    const next = togglePinnedScanLocation(pinnedLocations(), { path, label }, platform.os)
    if (!wasPinned && !isPinnedScanLocation(next, path, platform.os)) {
      showToast({
        variant: "default",
        title: "Saved locations are full",
        description: "Remove a saved location before adding another.",
      })
      return
    }
    settings.general.setDiskPinnedLocations(next)
    showToast({
      variant: "default",
      title: wasPinned ? "Removed from saved locations" : "Location saved",
      description: label,
    })
  }

  function goUp(instant = false, restoreListFocus = false) {
    if (scanning()) {
      cancelScan()
      return
    }
    const current = viewNode()
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
      setVisualHoverNode(null)
      setFocusIdx(0)
      setRangeAnchorIndex(undefined)
      if (restoreListFocus && current) {
        const index = entries().findIndex((entry) => diskPathEquals(entry.node.path, current.path, platform.os))
        if (index >= 0) {
          setRangeAnchorIndex(index)
          selectPath(current.path)
          focusListEntry(index)
        }
      }
    } else {
      backToDrives()
    }
  }

  function backToDrives(preserveCurrent = true) {
    if (preserveCurrent) saveCurrentTab()
    setScanSession({ activeID: undefined, foregroundID: undefined })
    setView("drives")
    setTreeRoot(null)
    setViewNode(null)
    setScanSourcePath("")
    setScanLabel("")
    setScanDrive(undefined)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setVisualHoverNode(null)
    void loadDrives()
  }

  function goToCrumb(crumb: Crumb) {
    if (crumb.node && !scanning()) {
      sunburst()?.navigateTo(crumb.node)
      setViewNode(crumb.node)
      setSelectedPath(undefined)
      setHoveredPath(null)
      setVisualHoverNode(null)
      setFocusIdx(0)
      setRangeAnchorIndex(undefined)
    }
  }

  /** A virtual row may mount on the next frame after structural keyboard navigation. */
  function focusListEntry(index: number, attempt = 0) {
    if (index < 0) return
    scrollIndexIntoView?.(index)
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-disk-index="${index}"]`)
      if (target) {
        target.focus({ preventScroll: true })
        return
      }
      if (attempt < 2) {
        focusListEntry(index, attempt + 1)
        return
      }
      focusPersistentDiskAction()
    })
  }

  function focusPersistentDiskAction() {
    document.querySelector<HTMLElement>("[data-disk-primary-action], [data-disk-navigation-home]")?.focus({ preventScroll: true })
  }

  function selectPath(path: string) {
    setSelectedPath(path)
    sunburst()?.setSelected(path)
    const idx = entries().findIndex((e) => e.node.path === path)
    if (idx >= 0) setFocusIdx(idx)
    const root = treeRoot()
    const node = entries().find((entry) => entry.node.path === path)?.node ?? (root ? findScanNode(root, path) : undefined)
    if (!node) return
    if (selectionAnnouncementTimer) clearTimeout(selectionAnnouncementTimer)
    selectionAnnouncementTimer = setTimeout(
      () =>
        setAnnouncedSelection(
          describeStorageNode(node, indexFilter.lens === "all" ? parentSize() : indexSize(), {
            canPreview: !!disk(),
            canReview: canModifyNode(node),
            requiresRescanBeforeReview: inventoryDeletionNeedsRescan(node),
          }),
        ),
      120,
    )
  }

  /** Shift selection is intentionally routed into the review basket: inspection stays singular and destructive work stays reviewable. */
  function addRangeToReview(anchor: number, target: number) {
    const list = entries()
    const nodes = inclusiveIndexRange(anchor, target, list.length)
      .map((index) => list[index]?.node)
      .filter((node): node is DiskScanNode => !!node && canModifyNode(node))
    collectNodes(nodes)
  }

  function selectEntry(node: DiskScanNode, index: number, extendRange = false, currentIndex = index) {
    if (extendRange) {
      const anchor = selectionAnchorIndex(rangeAnchorIndex(), currentIndex, entries().length)
      if (anchor >= 0) {
        setRangeAnchorIndex(anchor)
        addRangeToReview(anchor, index)
      }
    } else {
      setRangeAnchorIndex(index)
    }
    selectPath(node.path)
  }

  function hoverEntry(path: string | null) {
    setVisualHoverNode(null)
    setHoveredPath(path)
    sunburst()?.setHighlight(path)
  }

  function focusEntryAt(index: number, extendRange = false, currentIndex = focusIdx()) {
    const list = entries()
    const target = clampedListIndex(index, list.length)
    if (target < 0) return -1
    setFocusIdx(target)
    selectEntry(list[target].node, target, extendRange, currentIndex)
    scrollIndexIntoView?.(target)
    return target
  }

  function moveFocus(delta: number, extendRange = false, startIndex = focusIdx()) {
    const list = entries()
    const current = clampedListIndex(startIndex, list.length)
    if (current < 0) return -1
    const next = extendRange
      ? clampedListIndex(current + delta, list.length)
      : wrappedListIndex(current, delta, list.length)
    return focusEntryAt(next, extendRange, current)
  }

  function moveFocusByPage(direction: -1 | 1, pageSize: number, extendRange = false, startIndex = focusIdx()) {
    const list = entries()
    const current = clampedListIndex(startIndex, list.length)
    if (current < 0) return -1
    return focusEntryAt(pagedListIndex(current, direction, pageSize, list.length), extendRange, current)
  }

  function moveFocusToBoundary(boundary: "first" | "last", extendRange = false, startIndex = focusIdx()) {
    const list = entries()
    const current = clampedListIndex(startIndex, list.length)
    if (current < 0) return -1
    return focusEntryAt(boundary === "first" ? 0 : list.length - 1, extendRange, current)
  }

  function focusedEntryNode() {
    const list = entries()
    return selectedNode() ?? list[clampedListIndex(focusIdx(), list.length)]?.node ?? null
  }

  function openFocused() {
    const node = focusedEntryNode()
    if (!node) return
    if (node.isDir) {
      if (!node.isOther && !isDeveloperInventoryNode(node)) drill(node, true)
      return
    }
    if (!node.isOther) void openPreview(node)
  }

  function handleEntryKeyDown(event: KeyboardEvent, node: DiskScanNode, index: number) {
    if (event.defaultPrevented) return
    const supportsRangeNavigation = !event.metaKey && !event.ctrlKey && !event.altKey
    const isPlainShortcut = supportsRangeNavigation && !event.shiftKey
    if (
      supportsRangeNavigation &&
      (event.key === "ArrowDown" || event.key === "ArrowUp" || (isPlainShortcut && (event.key === "j" || event.key === "k")))
    ) {
      event.preventDefault()
      const next = moveFocus(event.key === "ArrowDown" || event.key === "j" ? 1 : -1, event.shiftKey, index)
      if (next >= 0) focusListEntry(next)
      return
    }
    if (supportsRangeNavigation && (event.key === "PageDown" || event.key === "PageUp")) {
      event.preventDefault()
      const next = moveFocusByPage(event.key === "PageDown" ? 1 : -1, listPageSize(), event.shiftKey, index)
      if (next >= 0) focusListEntry(next)
      return
    }
    if (supportsRangeNavigation && (event.key === "Home" || event.key === "End")) {
      event.preventDefault()
      const next = moveFocusToBoundary(event.key === "Home" ? "first" : "last", event.shiftKey, index)
      if (next >= 0) focusListEntry(next)
      return
    }
    if (isPlainShortcut && event.key === "ArrowLeft") {
      event.preventDefault()
      goUp(true, true)
      return
    }
    if (isPlainShortcut && event.key === "ArrowRight") {
      if (!node.isDir || node.isOther || isDeveloperInventoryNode(node)) return
      event.preventDefault()
      drill(node, true, true)
      return
    }
    if (isPlainShortcut && event.key === "Enter") {
      event.preventDefault()
      if (node.isDir) {
        if (!node.isOther && !isDeveloperInventoryNode(node)) drill(node, true, true)
        return
      }
      if (!node.isOther) void openPreview(node)
      return
    }
    if (isPlainShortcut && event.key === " ") {
      event.preventDefault()
      if (node.isOther || node.isHidden) return
      if (supportsQuickLook()) {
        void openSystemPreview(node)
        return
      }
      void openPreview(node)
      return
    }
    if (event.key === "Backspace" && (event.metaKey || event.ctrlKey) && !event.altKey) {
      event.preventDefault()
      requestDelete(node)
      return
    }
    if (isPlainShortcut && event.key === "Delete") {
      event.preventDefault()
      requestDelete(node)
      return
    }
    if (isPlainShortcut && event.key.toLowerCase() === "c") {
      if (!canModifyNode(node)) return
      event.preventDefault()
      toggleCollect(node)
      return
    }
    if (event.key.toLowerCase() === "r" && (event.metaKey || event.ctrlKey) && !event.altKey) {
      event.preventDefault()
      void rescanCurrent()
      return
    }
    if (isPlainShortcut && event.key === "1") {
      event.preventDefault()
      chooseScanMode("map", "keyboard")
      return
    }
    if (isPlainShortcut && event.key === "2") {
      event.preventDefault()
      chooseScanMode("grid", "keyboard")
      return
    }
    if (isPlainShortcut && event.key === "3") {
      event.preventDefault()
      chooseScanMode("list", "keyboard")
      return
    }
    if (isPlainShortcut && (event.key === "Escape" || event.key === "Backspace")) {
      event.preventDefault()
      goUp(true, true)
    }
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
    if (!api || node.isOther || node.isHidden) return
    const token = ++previewToken
    batch(() => {
      setPreviewTarget(node)
      setFilePreview(undefined)
      setPreviewError(undefined)
      setPreviewLoading(true)
    })
    previewSurface.open()
    if (node.isDir) {
      setPreviewLoading(false)
      return
    }
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

  async function openSystemPreview(node: DiskScanNode) {
    const api = disk()
    if (!api) return
    try {
      await api.systemPreviewPath(node.path)
    } catch (error) {
      showToast({
        variant: "error",
        title: "Could not open Quick Look",
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const supportsQuickLook = () => platform.os === "macos" && !!disk()?.systemPreviewPath

  async function openTrash() {
    const api = disk()
    if (!api) return
    try {
      await api.openTrash()
    } catch (error) {
      showToast({
        variant: "error",
        title: `Could not open ${nativeTrashName(platform.os)}`,
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

  function restoreFocusAfterDeletion() {
    requestAnimationFrame(() => {
      if (entries().length > 0) {
        restoreKeyboardViewFocus(scanMode())
        return
      }
      focusPersistentDiskAction()
    })
  }

  function applyDeletedNodes(removed: readonly DiskScanNode[]) {
    if (!removed.length) return
    setCollection((items) => withoutDeletedNodes(items, removed, platform.os))
    const deepInventoryNeedsRefresh = requiresDeepInventoryRefresh(removed)
    // Shared physical ownership is not a per-path reclaim estimate. Do not
    // subtract any hard-link or clone path optimistically; close affected
    // background maps and force the active map through a real traversal. Deep
    // inventory entries likewise are not children of this map, so a local tree
    // patch would leave their parent aggregates and coverage status stale.
    if (deepInventoryNeedsRefresh || physicalCloneAccountingUncertain() || removed.some(containsSharedPhysicalStorage)) {
      // This branch invalidates every retained map. Whether the cause is deep
      // inventory, clone accounting, or shared storage, basket metadata from
      // the old maps is no longer a safe delete candidate. Require a fresh
      // selection after rebuilding instead of carrying it across tabs.
      setCollection([])
      setCollectionDragNode(null)
      setCollectionDropActive(false)
      // A peer path may live in another root. Without a whole-machine link
      // graph, every cached background map is potentially stale after shared
      // storage changes, so require a fresh scan before it can be used again.
      const invalidatedTabs = tabs()
      if (invalidatedTabs.length) {
        setTabs((items) => items.filter((tab) => !invalidatedTabs.some((stale) => stale.id === tab.id)))
        for (const tab of invalidatedTabs) {
          if (tab.sessionID && !volumeScanJobs[tab.sessionID]) void disk()?.stopWatching(tab.sessionID)
        }
      }
      // Completed volume cards retain their own scan roots too. Remove those
      // snapshots rather than exposing a parked deep inventory after a global
      // accounting invalidation.
      const invalidatedVolumeJobs = volumeJobs().filter((job) => !!job.tree)
      for (const job of invalidatedVolumeJobs) {
        setVolumeScanJobs(job.id, undefined)
        void disk()?.stopWatching(job.id)
      }
      void rescanCurrent(true).then(restoreFocusAfterDeletion)
      return
    }
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
      restoreFocusAfterDeletion()
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
    restoreFocusAfterDeletion()
  }

  async function trashNode(node: DiskScanNode) {
    const api = disk()
    if (!api) return
    if (inventoryDeletionNeedsRescan(node)) {
      showDeveloperArtifactRescanGuidance(node)
      return
    }
    if (!canModifyNode(node)) return
    const deepDeletePrecondition = developerInventoryDeletePrecondition(node)
    if (isDeveloperInventoryNode(node) && !deepDeletePrecondition) {
      showDeveloperArtifactRescanGuidance(node)
      return
    }
    setDeleting(true)
    try {
      await api.deletePath(node.path, deepDeletePrecondition ? { precondition: deepDeletePrecondition } : undefined)
      const deepInventoryNeedsRefresh = requiresDeepInventoryRefresh([node])
      const sharedStorageNeedsRefresh = containsSharedPhysicalStorage(node)
      const physicalAccountingNeedsRefresh = deepInventoryNeedsRefresh || sharedStorageNeedsRefresh || physicalCloneAccountingUncertain()
      applyDeletedNodes([node])
      showToast({
        variant: "success",
        title: `Moved to ${nativeTrashName(platform.os)}`,
        description: deepInventoryNeedsRefresh
          ? `${node.name} moved. Rebuilding the full map before reporting disk space.`
          : physicalAccountingNeedsRefresh
          ? `${node.name} moved. Recomputing storage allocation before reporting free space.`
          : node.name,
        actions: [
          { label: `Show in ${nativeTrashName(platform.os)}`, onClick: () => void openTrash() },
          { label: "Rescan", onClick: () => void rescanCurrent() },
        ],
      })
    } catch (err) {
      if (isDeveloperInventoryNode(node) && isDeveloperArtifactPreconditionRejection(err)) {
        showDeveloperArtifactRescanGuidance(node, "changed")
        return
      }
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
    if (inventoryDeletionNeedsRescan(node)) {
      showDeveloperArtifactRescanGuidance(node)
      return
    }
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
    if (inventoryDeletionNeedsRescan(node)) {
      showDeveloperArtifactRescanGuidance(node)
      return
    }
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

  function selectEligibleDeveloperResults() {
    const candidates = smartCleanupCandidates()
    if (!candidates.length || physicalCloneAccountingUncertain()) return
    collectNodes(candidates)
    collectionSurface.open()
  }

  function removeCollected(node: DiskScanNode) {
    const next = collection().filter((item) => !diskPathEquals(item.path, node.path, platform.os))
    setCollection(next)
    if (!uniqueDeletionRoots(next, platform.os).length) collectionSurface.close()
  }

  function canModifyNode(node: DiskScanNode) {
    if (!canActOnNode(node, platform.os)) return false
    if (inventoryDeletionNeedsRescan(node)) return false
    const recognition = recognize(node)
    // Ambiguous build/target/dist records may be individually moved through
    // the confirmation + Trash flow, but are never Smart Cleanup defaults.
    if (recognition.developer && developerArtifactCleanupReadiness(recognition) === "review") return true
    return recognition.safety !== "system" && recognition.safety !== "version-control"
  }

  function inventoryDeletionNeedsRescan(node: DiskScanNode) {
    return isDeveloperInventoryNode(node) && !developerInventoryDeletePrecondition(node)
  }

  function isDeveloperArtifactPreconditionRejection(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return message.includes("Artifact changed since scan — rescan before moving it to Trash.")
  }

  function showDeveloperArtifactRescanGuidance(node: DiskScanNode, reason: "missing-identity" | "changed" = "missing-identity") {
    showToast({
      variant: "default",
      title: reason === "changed" ? "Artifact changed — rescan required" : "Rescan required before removal",
      description:
        reason === "changed"
          ? `${node.name} no longer matches the deep artifact result that was reviewed. Rebuild the full map, then review it again before moving it to ${nativeTrashName(platform.os)}.`
          : `${node.name} does not have a current deep-scan directory identity. Rebuild the full map, then review it again before moving it to ${nativeTrashName(platform.os)}.`,
      actions: [{ label: "Rescan", onClick: () => void rescanCurrent(true) }],
    })
  }
  const isCollected = (path: string) => collection().some((node) => diskPathEquals(node.path, path, platform.os))
  function clearCollection() {
    setCollection([])
    setRangeAnchorIndex(undefined)
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

  function beginMapDrag(event: CanvasPointerEvent) {
    if (event.button !== 0) return
    const node = sunburst()?.nodeAtPoint(event.clientX, event.clientY)
    if (!node || !canModifyNode(node)) {
      mapDrag = undefined
      return
    }
    mapDrag = {
      node,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      threshold: event.pointerType === "touch" ? 18 : 7,
      dragging: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveMapDrag(event: CanvasPointerEvent) {
    const drag = mapDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.dragging && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < drag.threshold) return
    if (!drag.dragging) {
      drag.dragging = true
      sunburst()?.suppressNextClick()
      event.currentTarget.style.cursor = "grabbing"
      setCollectionDragNode(drag.node)
      collectionDragPreview.textContent = `${drag.node.name} · ${shortBytes(drag.node.size)}`
      collectionDragPreview.style.left = "0"
      collectionDragPreview.style.top = "0"
    }
    collectionDragPreview.style.transform = `translate3d(${event.clientX + 16}px, ${event.clientY + 16}px, 0)`
    const rect = collectionDropElement?.getBoundingClientRect()
    setCollectionDropActive(
      !!rect &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom,
    )
    event.preventDefault()
  }

  function finishMapDrag(event: CanvasPointerEvent, cancelled = false) {
    const drag = mapDrag
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.dragging) {
      if (!cancelled && collectionDropActive()) collectNodes([drag.node])
      event.currentTarget.style.cursor = ""
      collectionDragPreview.style.left = "-9999px"
      collectionDragPreview.style.top = "-9999px"
      collectionDragPreview.style.transform = "none"
      endCollectionDrag()
      event.preventDefault()
    }
    mapDrag = undefined
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
            const deepDeletePrecondition = developerInventoryDeletePrecondition(node)
            if (isDeveloperInventoryNode(node) && !deepDeletePrecondition) {
              throw new Error("Deep inventory result requires a fresh directory identity before removal.")
            }
            return await api.deletePath(node.path, deepDeletePrecondition ? { precondition: deepDeletePrecondition } : undefined)
          } finally {
            completed++
            setDeletionProgress({ completed, total: items.length })
          }
        },
        platform.os,
      )
      const deepInventoryNeedsRefresh = removed.length > 0 && requiresDeepInventoryRefresh(removed)
      const knownSharedStorage = removed.some(containsSharedPhysicalStorage)
      const invalidatesAllMaps =
        deepInventoryNeedsRefresh || knownSharedStorage || (removed.length > 0 && physicalCloneAccountingUncertain())
      if (removed.length) {
        const physicalAccountingNeedsRefresh = invalidatesAllMaps
        applyDeletedNodes(removed)
        showToast({
          variant: "success",
          title: physicalAccountingNeedsRefresh
            ? `Moved ${removed.length} ${removed.length === 1 ? "item" : "items"} to ${nativeTrashName(platform.os)}`
            : `Moved ${formatBytes(removed.reduce((sum, node) => sum + node.size, 0))} to ${nativeTrashName(platform.os)}`,
          description: physicalAccountingNeedsRefresh
            ? deepInventoryNeedsRefresh
              ? "A selected path changed the deep artifact inventory. DiskLizard is rebuilding the full map before reporting disk space."
              : knownSharedStorage
              ? "Some paths share file allocation. DiskLizard is recomputing the map before reporting allocation."
              : "This scan could not verify shared file allocation. DiskLizard is recomputing the map before reporting allocation."
            : `${removed.length} ${removed.length === 1 ? "item" : "items"} moved to ${nativeTrashName(platform.os)}`,
          actions: [
            { label: `Show in ${nativeTrashName(platform.os)}`, onClick: () => void openTrash() },
            { label: "Rescan", onClick: () => void rescanCurrent() },
          ],
        })
      }
      const staleDeepFailures = failed.filter(
        ({ node, error }) =>
          isDeveloperInventoryNode(node) &&
          (inventoryDeletionNeedsRescan(node) || isDeveloperArtifactPreconditionRejection(error)),
      )
      const retryableFailures = failed.filter(({ node, error }) =>
        !isDeveloperInventoryNode(node) ||
        (!inventoryDeletionNeedsRescan(node) && !isDeveloperArtifactPreconditionRejection(error)),
      )
      // A global map rebuild invalidates every retained tree. Do not put failed
      // rows from that old map back into the basket; the rebuilt map is the
      // next safe source of truth.
      setCollection(invalidatesAllMaps ? [] : retryableFailures.map(({ node }) => node))
      if (retryableFailures.length && !invalidatesAllMaps) collectionSurface.open()
      else collectionSurface.close()
      if (staleDeepFailures.length) {
        const stale = staleDeepFailures[0]
        showDeveloperArtifactRescanGuidance(
          stale.node,
          inventoryDeletionNeedsRescan(stale.node) ? "missing-identity" : "changed",
        )
      }
      if (retryableFailures.length) {
        const first = retryableFailures[0].error
        showToast({
          variant: "error",
          title: `${retryableFailures.length} ${retryableFailures.length === 1 ? "item" : "items"} could not be removed`,
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
      showToast({ variant: "default", title: "Scanning the first dropped item", description: file.name })
    }
    await startScan(path, file.name || path.split(/[/\\]/).pop() || path, driveForPath(path, drives(), platform.os))
  }

  // Keyboard navigation
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (activeDialog()) {
        if (e.defaultPrevented || e.key !== "Escape") return
        e.preventDefault()
        if (deleting()) return
        if (deleteSurface.mounted()) deleteSurface.closeThen(() => setPendingDelete(null))
        else if (collectionSurface.mounted()) collectionSurface.close()
        else if (reviewSurface.mounted()) reviewSurface.close()
        else closePreview()
        return
      }
      if (!shouldHandleDiskShortcut(e.target, e.defaultPrevented)) return
      if (view() !== "scan") return
      const supportsRangeNavigation = !e.metaKey && !e.ctrlKey && !e.altKey
      const isPlainShortcut = supportsRangeNavigation && !e.shiftKey
      if (scanning()) {
        if (isPlainShortcut && (e.key === "Escape" || e.key === "Backspace")) {
          e.preventDefault()
          cancelScan()
        }
        return
      }
      if (
        supportsRangeNavigation &&
        (e.key === "ArrowDown" || e.key === "ArrowUp" || (isPlainShortcut && (e.key === "j" || e.key === "k")))
      ) {
        e.preventDefault()
        moveFocus(e.key === "ArrowDown" || e.key === "j" ? 1 : -1, e.shiftKey)
        return
      }
      if (supportsRangeNavigation && (e.key === "PageDown" || e.key === "PageUp")) {
        e.preventDefault()
        moveFocusByPage(e.key === "PageDown" ? 1 : -1, listPageSize(), e.shiftKey)
        return
      }
      if (supportsRangeNavigation && (e.key === "Home" || e.key === "End")) {
        e.preventDefault()
        moveFocusToBoundary(e.key === "Home" ? "first" : "last", e.shiftKey)
        return
      }
      if (isPlainShortcut && e.key === "ArrowLeft") {
        e.preventDefault()
        goUp(true)
        return
      }
      if (isPlainShortcut && e.key === "ArrowRight") {
        const node = focusedEntryNode()
        if (!node?.isDir || node.isOther || isDeveloperInventoryNode(node)) return
        e.preventDefault()
        drill(node, true)
        return
      }
      if (isPlainShortcut && e.key === "Enter") {
        e.preventDefault()
        openFocused()
        return
      }
      if (isPlainShortcut && e.key === " ") {
        const node = focusedEntryNode()
        if (!node || node.isOther || node.isHidden) return
        e.preventDefault()
        if (supportsQuickLook()) {
          void openSystemPreview(node)
          return
        }
        void openPreview(node)
        return
      }
      if (e.key === "Backspace" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        const node = focusedEntryNode()
        if (!node) return
        e.preventDefault()
        requestDelete(node)
        return
      }
      if (isPlainShortcut && (e.key === "Escape" || e.key === "Backspace")) {
        e.preventDefault()
        goUp(true)
        return
      }
      if (isPlainShortcut && e.key === "Delete") {
        const node = focusedEntryNode()
        if (!node) return
        e.preventDefault()
        requestDelete(node)
        return
      }
      if (isPlainShortcut && e.key.toLowerCase() === "c") {
        const node = focusedEntryNode()
        if (!node || !canModifyNode(node)) return
        e.preventDefault()
        toggleCollect(node)
        return
      }
      if (e.key.toLowerCase() === "r" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault()
        void rescanCurrent()
        return
      }
      if (isPlainShortcut && e.key === "1") {
        e.preventDefault()
        chooseScanMode("map", "keyboard")
        return
      }
      if (isPlainShortcut && e.key === "2") {
        e.preventDefault()
        chooseScanMode("grid", "keyboard")
        return
      }
      if (isPlainShortcut && e.key === "3") {
        e.preventDefault()
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
      <style>{DISK_UTILITY_STYLES}</style>
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
            <p class="mt-5 text-20-medium tracking-[-0.03em] text-text-strong">Drop to scan</p>
            <p class="mt-2 text-12-regular text-text-weak">Folders, volumes, and individual files are supported.</p>
          </div>
        </div>
      </Show>

      <header
        class="dl-topbar relative z-20 flex h-14 shrink-0 items-center gap-4 px-5 backdrop-blur-xl"
        inert={activeDialog() ? true : undefined}
        aria-hidden={activeDialog() ? "true" : undefined}
      >
        <button
          type="button"
          data-disk-navigation-home
          class="dl-touch-target group flex min-h-10 shrink-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
          aria-label="Back to volumes"
          onClick={() => backToDrives()}
        >
          <span class="dl-mark dl-accent-text relative grid size-7 place-items-center rounded-full" aria-hidden="true">
            <span class="size-2 rounded-full bg-current" />
          </span>
          <span class="dl-brand-name text-14-semibold tracking-[-0.02em] text-text-strong">DiskLizard</span>
        </button>

        <Show when={view() === "scan" && crumbs().length > 0}>
          <span class="h-4 w-px bg-border-weaker-base" aria-hidden />
          <Button class="dl-touch-target" variant="ghost" size="small" icon="chevron-left" onClick={() => goUp()}>
            {crumbs().length <= 1 ? "Volumes" : "Back"}
          </Button>
          <nav
            class="dl-breadcrumbs flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
                    class="dl-hover-button dl-touch-target min-h-10 max-w-[190px] shrink-0 truncate rounded-md px-2 text-12-regular text-text-weak outline-none transition-[color,background-color] duration-150 focus-visible:ring-2 focus-visible:ring-text-weak"
                    classList={{ "text-text-strong": i() === crumbs().length - 1 }}
                    aria-current={i() === crumbs().length - 1 ? "page" : undefined}
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
              class="dl-touch-target dl-pin-scan"
              variant="ghost"
              size="small"
              icon={currentScanPinned() ? "circle-check" : "plus-small"}
              aria-label={currentScanPinned() ? "Remove this saved location" : "Save this scan location"}
              onClick={() => togglePinnedLocation(scanSourcePath(), scanLabel())}
            >
              <span class="dl-responsive-label">{currentScanPinned() ? "Saved" : "Save location"}</span>
            </Button>
            <Button
              class="dl-touch-target dl-rescan"
              variant="ghost"
              size="small"
              icon="reset"
              aria-label="Rescan this location"
              onClick={() => void rescanCurrent()}
            >
              <span class="dl-responsive-label">Rescan</span>
            </Button>
          </Show>
          <Show when={view() === "drives" && disk()}>
            <Button
              class="dl-touch-target"
              variant="ghost"
              size="small"
              icon="reset"
              onClick={() => void loadDrives()}
              disabled={drivesLoading()}
            >
              Refresh
            </Button>
          </Show>
        </div>
      </header>

      <Show when={tabs().length > 0 || volumeJobs().length > 0}>
        <div
          class="relative shrink-0"
          inert={activeDialog() ? true : undefined}
          aria-hidden={activeDialog() ? "true" : undefined}
        >
          <div
            ref={setScanTabsElement}
            class="dl-scan-tabs flex h-11 items-center gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&>*]:snap-start [&::-webkit-scrollbar]:hidden"
            role="region"
            tabIndex={0}
            aria-label={`${scanTabCount()} open scan${scanTabCount() === 1 ? "" : "s"}. Use Left and Right Arrow to scroll.`}
            onKeyDown={handleScanTabsKeyDown}
          >
            <span class="mr-1 text-12-semibold uppercase tracking-[0.14em] text-text-weaker">Scans</span>
          <Show when={view() === "scan" && treeRoot()}>
            <span class="shrink-0 rounded-full bg-text-strong px-3 py-1 text-12-semibold text-background-base shadow-sm">
              {scanLabel() || "Current"}
            </span>
          </Show>
          <For each={tabs()}>
            {(tab) => (
              <div class="dl-hover-tab group flex shrink-0 items-center rounded-full text-text-weak transition-[color,background-color] duration-150">
                <button
                  type="button"
                  class="dl-touch-target min-h-10 max-w-[132px] truncate rounded-full pl-3 text-12-regular outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
                  onClick={() => {
                    switchToTab(tab.id)
                    setView("scan")
                  }}
                >
                  {tab.label}
                </button>
                <button
                  type="button"
                  class="dl-hover-reveal dl-touch-target grid size-10 place-items-center rounded-full opacity-50 outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-text-weak"
                  onClick={() => closeTab(tab.id)}
                  aria-label={`Close ${tab.label} scan`}
                >
                  <Icon name="close-small" class="size-2.5" />
                </button>
              </div>
            )}
          </For>
            <For each={volumeJobs().filter((job) => job.id !== scanSession.activeID)}>
            {(job) => (
              <div class="dl-hover-tab group flex shrink-0 items-center rounded-full text-text-weak transition-[color,background-color] duration-150">
                <button
                  type="button"
                  class="dl-touch-target flex min-h-10 max-w-[168px] items-center gap-2 truncate rounded-full pl-3 text-12-regular outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
                  onClick={() => {
                    if (job.status === "complete") {
                      openVolumeScan(job)
                      return
                    }
                    if (view() === "scan") backToDrives()
                    requestAnimationFrame(() =>
                      document.getElementById(`disklizard-volume-${job.id}`)?.scrollIntoView({ block: "center" }),
                    )
                  }}
                >
                  <span
                    class="size-1.5 shrink-0 rounded-full"
                    classList={{
                      "dl-scan-beacon bg-[oklch(0.74_0.13_176)]": job.status === "scanning",
                      "bg-[oklch(0.72_0.15_148)]": job.status === "complete",
                      "bg-[oklch(0.68_0.17_28)]": job.status === "failed",
                    }}
                  />
                  <span class="truncate">{job.label}</span>
                  <Show when={job.status === "scanning" && job.drive.used > 0}>
                    <span class="min-w-[3ch] text-right tabular-nums text-text-weaker">{Math.round(job.pct)}%</span>
                  </Show>
                </button>
                <button
                  type="button"
                  class="dl-hover-reveal dl-touch-target grid size-10 place-items-center rounded-full opacity-50 outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-text-weak"
                  onClick={() => closeVolumeScan(job.id)}
                  aria-label={job.status === "scanning" ? `Cancel ${job.label} scan` : `Close ${job.label} scan`}
                >
                  <Icon name="close-small" class="size-2.5" />
                </button>
              </div>
            )}
            </For>
          </div>
          <Show when={scanTabsOverflow().start}>
            <span class="dl-scan-tabs-cue dl-scan-tabs-cue-left" aria-hidden="true">
              <Icon name="chevron-left" class="size-3" />
            </span>
          </Show>
          <Show when={scanTabsOverflow().end}>
            <span class="dl-scan-tabs-cue dl-scan-tabs-cue-right" aria-hidden="true">
              <Icon name="chevron-right" class="size-3" />
            </span>
          </Show>
        </div>
      </Show>

      <main
        class="relative min-h-0 flex-1 overflow-hidden"
        inert={activeDialog() ? true : undefined}
        aria-hidden={activeDialog() ? "true" : undefined}
      >
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
              <DriveOverview
                drives={drives()}
                loading={drivesLoading()}
                error={drivesError()}
                freeBytes={driveTotals().free}
                runningScans={runningVolumeScans()}
                maxParallelScans={MAX_PARALLEL_VOLUME_SCANS}
                diagnostics={storageDiagnostics()}
                pinnedLocations={pinnedLocations()}
                jobForDrive={volumeJobForDrive}
                onChooseFolder={() => void chooseAndScan()}
                onScanDrive={startVolumeScan}
                onCancelDrive={cancelVolumeScan}
                onOpenDrive={openVolumeScan}
                onScanStorageLocation={scanStorageLocation}
                onOpenAccessSettings={() => void openDiskAccessSettings()}
                onScanPinnedLocation={(location) =>
                  void startScan(
                    location.path,
                    location.label,
                    driveForPath(location.path, drives(), platform.os),
                  )
                }
                onRemovePinnedLocation={(location) => togglePinnedLocation(location.path, location.label)}
              />
            </Show>

            <Show when={view() === "scan"}>
              <Show
                when={!scanning()}
                fallback={
                  <div class="relative flex h-full items-center justify-center overflow-auto px-5 py-8 sm:px-8 sm:py-10">
                    <ScanFormation
                      label={focusedScan()?.label ?? scanLabel()}
                      files={scanFiles()}
                      bytes={scanBytes()}
                      currentPath={scanTail()}
                      pct={scanTotal() > 0 ? scanPct() : null}
                      onCancel={cancelScan}
                    />
                  </div>
                }
              >
                <div class="flex h-full min-h-0 flex-col">
                  <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {announcedSelection()}
                  </span>
                  <div class="dl-workspace-frame mx-4 mb-3 mt-2 flex min-h-0 flex-1 overflow-hidden rounded-[22px]">
                    <Show when={scanMode() !== "list"}>
                      <section class="dl-landscape relative grid min-w-0 flex-1 place-items-center overflow-hidden">
                        <Show when={scanMode() === "map"}>
                          <div class="relative aspect-square h-[min(94%,900px)] max-h-[900px] max-w-[94%]">
                            <canvas
                              ref={(el: HTMLCanvasElement) => setCanvasEl(el)}
                              class="absolute inset-0 size-full rounded-full outline-none [touch-action:none] focus-visible:ring-2 focus-visible:ring-text-weak"
                              tabIndex={0}
                              role="region"
                              aria-roledescription="interactive storage map"
                              aria-describedby="disklizard-orbit-help"
                              aria-controls="disklizard-storage-list"
                              aria-label={`Storage map for ${scanLabel()}. Select an item to inspect it; use the results list to browse every item.`}
                              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End PageUp PageDown Enter Space C Escape"
                              onPointerDown={beginMapDrag}
                              onPointerMove={moveMapDrag}
                              onPointerUp={(event) => finishMapDrag(event)}
                              onPointerCancel={(event) => finishMapDrag(event, true)}
                            />
                            <span id="disklizard-orbit-help" class="sr-only">
                              Click once to select an item and double-click a folder to open it. Drag a folder to the
                              review area to select it. Use the Up and Down arrow keys to select an item, Home, End,
                              or Page Up and Page Down to move through the list, Enter or Right Arrow to open a
                              folder, Space to preview it, C to add it to review, and Escape or Left Arrow to move up
                              one level. The results list contains an accessible entry for every item in this map.
                            </span>
                            <CenterOverlay
                              node={focusNode()}
                              parentSize={parentSize()}
                              canOpen={!!focusNode() && focusNode()!.isDir && !focusNode()!.isOther && !isDeveloperInventoryNode(focusNode()!)}
                              inventoryOnly={!!focusNode() && isDeveloperInventoryNode(focusNode()!)}
                              onOpen={() => {
                                const node = focusNode()
                                if (node?.isDir && !node.isOther && !isDeveloperInventoryNode(node)) drill(node, true, true)
                              }}
                            />
                          </div>
                        </Show>
                        <Show when={scanMode() === "grid"}>
                          <div class="relative size-full px-5 pb-5 pt-5 lg:px-8 lg:pb-8 lg:pt-8">
                            <Treemap
                              children={sortedChildren()}
                              hoveredPath={hoveredPath()}
                              selectedPath={selectedPath()}
                              onHover={(node) => {
                                hoverEntry(node?.path ?? selectedPath() ?? null)
                                if (isVisualAggregate(node)) setVisualHoverNode(node)
                              }}
                              onSelect={selectPath}
                              onReveal={(node) => void reveal(node.path)}
                              onPreview={(node) => {
                                if (supportsQuickLook()) void openSystemPreview(node)
                                else void openPreview(node)
                              }}
                              onDrill={(node, restoreListFocus) => drill(node, false, restoreListFocus)}
                              onShowAll={(restoreListFocus) =>
                                chooseScanMode("list", restoreListFocus ? "keyboard" : "pointer")
                              }
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
                            label="Map"
                            shortcut="1"
                          />
                          <SegmentedButton
                            active={scanMode() === "grid"}
                            onClick={() => chooseScanMode("grid")}
                            icon="file-tree"
                            label="Tiles"
                            shortcut="2"
                          />
                          <SegmentedButton
                            active={scanMode() === "list"}
                            onClick={() => chooseScanMode("list")}
                            icon="bullet-list"
                            label="List"
                            shortcut="3"
                          />
                          <details class="relative">
                            <summary
                              class="dl-touch-target grid size-11 cursor-pointer list-none place-items-center rounded-full text-12-semibold text-text-weak outline-none transition-colors focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden"
                              aria-label="Show keyboard shortcuts"
                            >
                              ?
                            </summary>
                            <div class="absolute right-0 top-[calc(100%+10px)] z-20 w-64 rounded-xl bg-background-base p-3 text-12-regular leading-relaxed text-text-weak shadow-[0_0_0_1px_rgb(127_127_127/0.14),0_12px_30px_rgb(0_0_0/0.16)]">
                              <p class="text-12-semibold text-text-strong">Keyboard shortcuts</p>
                              <p class="mt-2">
                                ↑ / ↓ select · Shift+↑ / ↓ adds a range to review · Home / End and Pg↑ / Pg↓ jump
                              </p>
                              <p class="mt-1">
                                ← / Escape goes up · → / Enter opens · Space previews{platform.os === "macos" ? " with Quick Look" : ""} · C selects for review
                              </p>
                              <p class="mt-1">
                                1 Map · 2 Tiles · 3 List · {platform.os === "macos" ? "⌘" : "Ctrl"}-click reveals
                              </p>
                            </div>
                          </details>
                        </div>
                      </section>
                    </Show>

                    <aside
                      class="dl-inspector flex min-h-0 flex-col overflow-hidden bg-background-base"
                      classList={{
                        "w-[clamp(360px,27vw,420px)] shrink-0 border-l border-border-weaker-base":
                          scanMode() !== "list",
                        "flex-1": scanMode() === "list",
                      }}
                    >
                      <div class="shrink-0 border-b border-border-weaker-base px-5 pb-4 pt-5">
                        <div class="flex items-start justify-between gap-4">
                          <div class="min-w-0 flex-1">
                            <p class="text-12-semibold uppercase tracking-[0.16em] text-text-weaker">
                              {indexFilter.lens === "developer"
                                ? indexFilter.developerCategory === "all"
                                  ? "Developer files"
                                  : DEVELOPER_CATEGORY_LABEL[indexFilter.developerCategory]
                                : indexFilter.lens === "recommendations"
                                  ? "Recommendations across this scan"
                                  : indexFilter.lens === "changes"
                                    ? "Largest recently changed items"
                                  : "Folder contents"}
                            </p>
                            <div class="mt-2 flex min-w-0 items-baseline justify-between gap-4">
                              <h2 class="min-w-0 truncate text-18-medium tracking-[-0.035em] text-text-strong">
                                {viewNode()?.name || scanLabel()}
                              </h2>
                              <span class="shrink-0 text-[24px] font-medium leading-none tracking-[-0.04em] tabular-nums text-text-strong">
                                {formatBytes(indexSize())}
                              </span>
                            </div>
                            <p class="mt-1.5 text-12-regular tabular-nums text-text-weak">
                              {formatCount(indexCount())} items · {sizeBasisLabel()}
                            </p>
                          </div>
                          <Show when={scanMode() === "list"}>
                            <div class="flex items-center gap-0.5 rounded-full bg-background-base/70 p-1 shadow-[0_0_0_1px_rgb(127_127_127/0.12)]">
                              <SegmentedButton
                                active={scanMode() === "map"}
                                onClick={() => chooseScanMode("map")}
                                icon="dot-grid"
                                label="Map"
                              />
                              <SegmentedButton
                                active={scanMode() === "grid"}
                                onClick={() => chooseScanMode("grid")}
                                icon="file-tree"
                                label="Tiles"
                              />
                              <SegmentedButton active icon="bullet-list" label="List" />
                            </div>
                          </Show>
                        </div>
                        <details class="group mt-4" open={indexFilter.lens !== "all"}>
                          <summary class="dl-touch-target flex min-h-11 cursor-pointer list-none items-center gap-2 border-b border-border-weaker-base px-1 text-12-semibold text-text-weak outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
                            <Icon name="sliders" class="size-3.5" />
                            <span class="flex-1">Explore this scan</span>
                            <span class="text-12-regular text-text-weaker">
                              {indexFilter.lens === "all"
                                ? "Folder contents"
                                : indexFilter.lens === "developer"
                                  ? "Developer files"
                                  : indexFilter.lens === "changes"
                                    ? "Changed this week"
                                    : "Recommendations"}
                            </span>
                            <Icon name="chevron-down" class="size-3 transition-transform duration-150 group-open:rotate-180" />
                          </summary>
                          <div role="group" aria-label="Choose what to show" class="mt-2 grid grid-cols-2 sm:grid-cols-4">
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
                              active={indexFilter.lens === "recommendations"}
                              icon="shield"
                              label="Recommendations"
                              disabled={physicalCloneAccountingUncertain()}
                              title={
                                physicalCloneAccountingUncertain()
                                  ? "Reclaim estimates wait for verified clone metadata."
                                  : undefined
                              }
                              onClick={() => chooseLens("recommendations")}
                            />
                            <IndexLensButton
                              active={indexFilter.lens === "changes"}
                              icon="arrow-undo-down"
                              label="Recent"
                              onClick={() => chooseLens("changes")}
                            />
                          </div>
                        </details>
                        <Show when={reclaim().totalBytes > 0 && indexFilter.lens !== "recommendations"}>
                          <ReclaimBanner
                            bytes={reclaim().totalBytes}
                            count={reclaim().totalCount}
                            onReview={() => reviewSurface.open()}
                          />
                        </Show>
                        <Show
                          when={
                            indexFilter.lens === "developer" &&
                            (developer().buckets.length > 0 || !!treeRoot()?.developerArtifactInventory)
                          }
                        >
                          <Show when={developer().buckets.length > 0}>
                            <div
                              class="mt-2 flex max-w-full gap-1.5 overflow-x-auto pb-0.5"
                              aria-label="Developer categories"
                            >
                              <DeveloperCategoryButton
                                active={indexFilter.developerCategory === "all"}
                                label="All developer files"
                                bytes={developer().totalBytes}
                                onClick={() => chooseDeveloperCategory("all")}
                              />
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
                          <DeveloperCleanupPolicy
                            preset={indexFilter.developerAge}
                            customDays={indexFilter.customDeveloperAgeDays}
                            age={developerAge()}
                            eligibleCount={smartCleanupCandidates().length}
                            eligibleBytes={smartCleanupCandidateBytes()}
                            excludedCount={smartCleanupReviewCount()}
                            ecosystems={developerEcosystems()}
                            ecosystem={indexFilter.developerEcosystem}
                            inventory={treeRoot()?.developerArtifactInventory}
                            unavailable={physicalCloneAccountingUncertain()}
                            onPresetChange={chooseDeveloperCleanupAge}
                            onCustomDaysChange={setCustomDeveloperCleanupAgeDays}
                            onEcosystemChange={chooseDeveloperEcosystem}
                            onSelectEligible={selectEligibleDeveloperResults}
                          />
                        </Show>
                        <Show when={physicalCloneAccountingWarning()}>
                          {(warning) => (
                            <div
                              class="mt-3 flex gap-2 rounded-xl border border-border-warning-base/55 bg-surface-warning-weak/45 px-3 py-2.5"
                              role="note"
                              aria-label="Physical storage accounting is unverified"
                            >
                              <Icon name="shield" class="mt-0.5 size-3.5 shrink-0 text-icon-warning-base" />
                              <div>
                                <p class="text-12-semibold text-text-strong">Physical reclaim estimate paused</p>
                                <p class="mt-1 text-12-regular leading-relaxed text-text-weak">{warning()}</p>
                              </div>
                            </div>
                          )}
                        </Show>
                        <Show when={treeRoot()?.scanIssues}>
                          {(issues) => (
                            <details class="group mt-3 rounded-xl border border-border-warning-base/55 bg-surface-warning-weak/45">
                              <summary class="dl-touch-target flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-icon-warning-base [&::-webkit-details-marker]:hidden">
                                <Icon name="warning" class="size-3.5 shrink-0 text-icon-warning-base" />
                                <span class="min-w-0 flex-1 text-12-semibold text-text-strong">
                                  {formatCount(issues().unreadableCount)} unreadable
                                  {issues().unreadableCount === 1 ? " location" : " locations"}
                                </span>
                                <span class="text-12-regular text-text-weak">Totals may be low</span>
                                <Icon
                                  name="chevron-down"
                                  class="size-3 shrink-0 text-icon-weak transition-transform duration-150 group-open:rotate-180"
                                />
                              </summary>
                              <div class="border-t border-border-warning-base/40 px-3 pb-3 pt-2.5">
                                <p class="text-12-regular leading-relaxed text-text-weak">
                                  {language.t(scanAccessGuidance(platform.os))} {language.t("disk.accessGuidance.rescan")}
                                </p>
                                <Show when={storageDiagnostics()?.access.status === "limited"}>
                                  <Button
                                    class="dl-touch-target mt-2"
                                    size="small"
                                    variant="secondary"
                                    icon="square-arrow-top-right"
                                    onClick={() => void openDiskAccessSettings()}
                                  >
                                    Open privacy settings
                                  </Button>
                                </Show>
                                <ul class="mt-2 space-y-1" aria-label="Unreadable locations sampled during this scan">
                                  <For each={issues().samplePaths.slice(0, 5)}>
                                    {(path) => (
                                      <li class="truncate font-mono text-12-regular text-text-weaker" title={path}>
                                        {path}
                                      </li>
                                    )}
                                  </For>
                                </ul>
                                <Show when={issues().samplePaths.length > 5 || issues().unreadableCount > 5}>
                                  <p class="mt-1.5 text-12-regular text-text-weaker">
                                    Showing 5 of {formatCount(issues().unreadableCount)} locations
                                  </p>
                                </Show>
                              </div>
                            </details>
                          )}
                        </Show>
                        <div class="dl-touch-target mt-3 flex h-11 items-center gap-2 rounded-[10px] bg-surface-raised-base/55 px-3 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.14)] transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_1px_rgb(127_127_127/0.34),0_0_0_3px_rgb(127_127_127/0.08)]">
                          <Icon name="magnifying-glass" class="size-3.5 shrink-0 text-icon-weak" />
                          <label class="sr-only" for="disklizard-scan-search">
                            {indexFilter.lens === "all" ? "Filter this folder" : "Search this scan"}
                          </label>
                          <input
                            id="disklizard-scan-search"
                            type="search"
                            autocomplete="off"
                            spellcheck={false}
                            placeholder={indexFilter.lens === "all" ? "Filter this folder" : "Search names and paths"}
                            value={query()}
                            onInput={(e) => updateQuery(e.currentTarget.value)}
                            class="dl-search-input min-w-0 flex-1 bg-transparent text-12-regular text-text-strong placeholder:text-text-weaker outline-none"
                          />
                          <Show when={query()}>
                            <button
                              type="button"
                              class="dl-hover-button dl-touch-target grid size-10 place-items-center rounded-full text-text-weak outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
                              onClick={() => updateQuery("")}
                              aria-label="Clear filter"
                            >
                              <Icon name="close-small" class="size-3" />
                            </button>
                          </Show>
                        </div>
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
                          bindPageSize={(fn) => (listPageSize = fn ?? (() => DEFAULT_LIST_PAGE_SIZE))}
                          onMoveFocus={moveFocus}
                          onPageFocus={moveFocusByPage}
                          onMoveFocusToBoundary={moveFocusToBoundary}
                          render={(entry, i) => {
                            const rec = () => recognize(entry.node)
                            const developerContext = () => developerArtifactContext(entry.node, rec())
                            const pct = () => (indexSize() ? (entry.displaySize / indexSize()) * 100 : 0)
                            const isActive = () =>
                              selectedPath() === entry.node.path || (focusIdx() === i() && !selectedPath())
                            return (
                              <div
                                class="dl-hover-row dl-index-row group relative flex h-full items-center border-b border-border-weaker-base/70 transition-colors duration-150"
                                classList={{
                                  "bg-surface-raised-base/70 shadow-[inset_2px_0_0_var(--dl-accent)]": isActive(),
                                }}
                                onMouseEnter={() => hoverEntry(entry.node.path)}
                                onMouseLeave={() => hoverEntry(selectedPath() ?? null)}
                              >
                                <button
                                  type="button"
                                  data-disk-index={i()}
                                  aria-current={isActive() ? "true" : undefined}
                                  draggable={canModifyNode(entry.node)}
                                  class="flex h-full min-h-11 min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak"
                                  onClick={(event) => {
                                    if (event.metaKey || event.ctrlKey) {
                                      void reveal(entry.node.path)
                                      return
                                    }
                                    selectEntry(entry.node, i(), event.shiftKey)
                                  }}
                                  onDblClick={() => {
                                    if (entry.node.isDir && !entry.node.isOther) drill(entry.node)
                                    else if (!entry.node.isOther) void openPreview(entry.node)
                                  }}
                                  onFocus={() => {
                                    setFocusIdx(i())
                                    selectPath(entry.node.path)
                                  }}
                                  onKeyDown={(event) => handleEntryKeyDown(event, entry.node, i())}
                                  onDragStart={(event) => beginCollectionDrag(event, entry.node)}
                                  onDragEnd={endCollectionDrag}
                                >
                                  <span
                                    class="size-2 shrink-0 rounded-full shadow-[0_0_0_1px_rgb(255_255_255/0.14)]"
                                    style={{ background: primarySegmentColor(entry.index, 1, entry.node.isDir) }}
                                    aria-hidden="true"
                                  />
                                  <span class="min-w-0 flex-1">
                                    <span class="flex min-w-0 items-center gap-1.5">
                                      <span class="truncate text-12-semibold text-text-strong">{entry.node.name}</span>
                                      <Show when={indexFilter.lens !== "all" && rec().tag}>
                                        <span
                                          class={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-12-semibold uppercase tracking-[0.08em] ring-1 ring-inset lg:inline ${SAFETY_ACCENT[rec().safety].pill}`}
                                        >
                                          {rec().tag}
                                        </span>
                                      </Show>
                                    </span>
                                    <Show
                                      when={indexFilter.lens !== "all"}
                                      fallback={
                                        <span class="mt-1.5 block h-px min-w-0 overflow-hidden bg-surface-raised-base">
                                          <span
                                            class="block h-full"
                                            style={{
                                              width: `${Math.max(1, Math.min(100, pct()))}%`,
                                              background: primarySegmentColor(entry.index, 1, entry.node.isDir),
                                            }}
                                          />
                                        </span>
                                      }
                                    >
                                      <span class="mt-1 flex min-w-0 items-center gap-2">
                                        <span
                                          class="flex min-w-0 flex-1 items-center gap-1.5 text-12-regular text-text-weak"
                                          title={
                                            indexFilter.lens === "developer"
                                              ? `${developerContext().scope} · ${developerContext().disposition}\n${rec().hint ?? "Inspect this folder before changing it"}\n${entry.node.path}`
                                              : entry.node.path
                                          }
                                        >
                                          <Show when={indexFilter.lens === "developer"}>
                                            <span class="shrink-0 text-text-weak">{developerContext().scope}</span>
                                            <span aria-hidden="true">·</span>
                                            <span class="shrink-0 text-12-semibold text-text-strong">
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
                                          when={
                                            indexFilter.lens === "developer" || indexFilter.lens === "changes"
                                              ? entry.node.modifiedAt
                                              : undefined
                                          }
                                        >
                                          {(changedAt) => (
                                            <span
                                              class="shrink-0 text-12-regular tabular-nums text-text-weak"
                                              classList={{ "dl-accent-text": indexFilter.lens === "developer" && isDormant(changedAt()) }}
                                              title={`Last changed ${new Date(changedAt()).toLocaleString()}`}
                                            >
                                              {formatLastChanged(changedAt())}
                                            </span>
                                          )}
                                        </Show>
                                      </span>
                                    </Show>
                                  </span>
                                  <span class="shrink-0 text-12-semibold tabular-nums text-text-strong">
                                    {shortBytes(entry.displaySize)}
                                  </span>
                                </button>
                                <Show when={canModifyNode(entry.node)}>
                                  <button
                                    type="button"
                                    class="dl-hover-action dl-row-action grid size-10 shrink-0 place-items-center rounded-lg text-text-weak opacity-65 outline-none transition-[color,opacity,background-color,transform] duration-150 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96]"
                                    classList={{
                                      "dl-accent-text opacity-100": isCollected(entry.node.path),
                                    }}
                                    onClick={() => toggleCollect(entry.node)}
                                    aria-pressed={isCollected(entry.node.path)}
                                    aria-label={
                                      isCollected(entry.node.path)
                                        ? `Remove ${entry.node.name} from review`
                                        : `Select ${entry.node.name} for review`
                                    }
                                  >
                                    <Icon
                                      name={isCollected(entry.node.path) ? "circle-check" : "plus-small"}
                                      class="size-3.5"
                                    />
                                  </button>
                                </Show>
                              </div>
                            )
                          }}
                        />
                      </Show>
                    </aside>
                  </div>

                  <div class="dl-command-dock shrink-0 border-t border-border-weaker-base bg-background-base px-4 py-2">
                    <div class="dl-command-dock-inner mx-auto flex max-w-[1480px] items-center gap-3">
                      <div class="min-w-0 flex-1">
                        <Show
                          when={selectedNode()}
                          fallback={
                            <div class="flex min-h-16 items-center gap-3 px-2">
                              <span class="grid size-9 shrink-0 place-items-center rounded-full bg-surface-raised-base text-text-weak">
                                <Icon name="window-cursor" class="size-4" />
                              </span>
                              <div class="min-w-0">
                                <p class="text-12-semibold text-text-strong">Select an item to inspect it</p>
                                <p class="mt-0.5 truncate text-12-regular text-text-weak">
                                  Select an item, then press C or drag it here to review it
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
                                node().isOther || node().isHidden ? undefined : () => void openPreview(node())
                              }
                              onQuickLook={
                                supportsQuickLook() && !node().isOther && !node().isHidden
                                  ? () => void openSystemPreview(node())
                                  : undefined
                              }
                              onReveal={() => void reveal(node().path)}
                              onOpen={isDeveloperInventoryNode(node()) ? undefined : () => drill(node())}
                              onCollect={() => toggleCollect(node())}
                              onTrash={() => requestDelete(node())}
                            />
                          )}
                        </Show>
                      </div>
                      <div
                        class="dl-cleanup-slot shrink-0"
                        classList={{
                          "w-[min(360px,30vw)]": effectiveCollection().length > 0 || !!collectionDragNode(),
                          "w-[220px]": effectiveCollection().length === 0 && !collectionDragNode(),
                        }}
                      >
                        <CollectionDropTarget
                          setElement={(element) => (collectionDropElement = element)}
                          node={collectionDragNode()}
                          active={collectionDropActive()}
                          count={effectiveCollection().length}
                          bytes={collectionSize()}
                          hasSharedPhysicalStorage={
                            collectionHasSharedPhysicalStorage() ||
                            (collectionDragNode() ? containsSharedPhysicalStorage(collectionDragNode()!) : false)
                          }
                          hasUnverifiedPhysicalStorage={physicalCloneAccountingUncertain()}
                          requiresDeepInventoryRefresh={
                            collectionNeedsDeepInventoryRefresh() ||
                            (collectionDragNode() ? requiresDeepInventoryRefresh([collectionDragNode()!]) : false)
                          }
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
            systemPreviewLabel={platform.os === "macos" ? "Quick Look" : undefined}
            onSystemPreview={platform.os === "macos" ? () => void openSystemPreview(node()) : undefined}
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
            reviewSurface.closeThen(() => collectionSurface.open())
          }}
          onToggle={toggleCollect}
          isSelected={(node) => isCollected(node.path)}
          deleting={deleting()}
        />
      </Show>

      <Show when={collectionSurface.mounted()}>
        <CollectionDialog
          phase={collectionSurface.phase()}
          items={effectiveCollection()}
          bytes={collectionSize()}
          hasSharedPhysicalStorage={collectionHasSharedPhysicalStorage()}
          hasUnverifiedPhysicalStorage={physicalCloneAccountingUncertain()}
          requiresDeepInventoryRefresh={collectionNeedsDeepInventoryRefresh()}
          deleting={deleting()}
          progress={deletionProgress()}
          trashName={nativeTrashName(platform.os)}
          onClose={() => !deleting() && collectionSurface.close()}
          onRemove={removeCollected}
          onQuickLook={supportsQuickLook() ? (node) => void openSystemPreview(node) : undefined}
          onConfirm={() => void deleteCollected()}
        />
      </Show>

      {/* ── Delete confirm ── */}
      <Show when={deleteSurface.mounted() && pendingDelete()}>
        {(node) => (
          <DeleteConfirmDialog
            phase={deleteSurface.phase()}
            node={node()}
            hasSharedPhysicalStorage={containsSharedPhysicalStorage(node())}
            hasUnverifiedPhysicalStorage={physicalCloneAccountingUncertain()}
            requiresDeepInventoryRefresh={requiresDeepInventoryRefresh([node()])}
            deleting={deleting()}
            trashName={nativeTrashName(platform.os)}
            onClose={() => !deleting() && deleteSurface.closeThen(() => setPendingDelete(null))}
            onConfirm={() => void confirmDelete()}
          />
        )}
      </Show>
    </div>
  )
}
