/**
 * DiskLizard — standalone storage explorer.
 *
 * A DaisyDisk-inspired sunburst map (rendered in OKLCH) paired with a ranked list.
 * The signature trick: a "Reclaim" engine that recognizes well-known space hogs
 * (node_modules, caches, build output, Trash…) and surfaces a live,
 * non-double-counted total of space you can get back — with one-tap review.
 *
 * Motion stays out of the reactive render path; the canvas and small numeric
 * transitions run directly on requestAnimationFrame.
 */

import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { showToast } from "@opencode-ai/ui/toast"
import { batch, createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, untrack } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import {
  createPersistenceErrorDeduper,
  diskLanguageText,
  useLanguage,
  usePlatform,
  useSettings,
  type DiskLanguageKey,
} from "./runtime"
import type {
  DiskDriveInfo,
  DiskDriveFactsUpdate,
  DiskFilePreview,
  DiskScanNode,
  DiskStorageDiagnostics,
  DiskStorageLocation,
} from "./types"
import { Sunburst, primarySegmentColor, sunburstEntryDuration, type SunburstEntryIntent } from "./sunburst"
import { Treemap } from "./TreemapPanel"
import { collapseTreemapChildren, layoutTreemap } from "./treemap"
import { ViewMorph, type MorphTile } from "./ViewMorph"
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
import {
  ARTIFACT_ECOSYSTEMS,
  containsSharedPhysicalStorage,
  developerArtifactCleanupReadiness,
  developerArtifactContext,
  isSmartCleanupEligible,
  matchesArtifactEcosystem,
  type ArtifactEcosystem,
  type ArtifactEcosystemFilter,
  type DeveloperCategory,
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
import { DiskScanHistory } from "./DiskScanHistory"
import { createScanHistory, filterScanHistoryEntries } from "./scan-history"
import { clearReviewForRootScan } from "./scan-lifecycle"
import { refreshScanTabsForWatcherUpdate } from "./scan-tabs"
import { recentChangeNodes } from "./recent-changes"
import { DISK_UTILITY_STYLES } from "./styles"
import { chooseFolderAndScan, DISK_CHOOSE_FOLDER_COMMAND } from "./choose-folder"
import {
  diskEntrySortDirection,
  diskEntrySortKey,
  type DiskEntrySortDirection,
  type DiskEntrySortKey,
} from "./entry-view"
import { createScanInvestigation, type ScanInvestigationEntry, type ScanInvestigationLens } from "./scan-investigation"
import { DISK_RECOGNITION_LANGUAGE_KEYS } from "./recognition-language"
import {
  EMPTY_DISK_BROWSE_HISTORY,
  resolveDiskBrowseHistoryMove,
  transitionDiskBrowseHistory,
  type DiskBrowseDirection,
  type DiskBrowseHistory,
} from "./browse-history"
import { diskNodeDisplayName } from "./node-display"
import { planOtherExpansion } from "./other-expansion"
import {
  cleanupLockForPath,
  cleanupLockMessage,
  isCleanupLock,
  isPathCleanupLocked,
  toggleCleanupLock,
  withoutCleanupLockedNodes,
} from "./cleanup-lock"
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
type IndexLens = ScanInvestigationLens
type DeveloperCategoryFilter = DeveloperCategory | "all"
type Entry = ScanInvestigationEntry
type CanvasPointerEvent = PointerEvent & { currentTarget: HTMLCanvasElement }
type FocusedExpansionOptions = {
  label?: string
  maxChildren?: number
}
type ScanTab = {
  id: string
  sessionID?: string
  label: string
  sourcePath: string
  tree: DiskScanNode
  view: DiskScanNode
  browseHistory: DiskBrowseHistory
  drive?: DiskDriveInfo
}

const MAX_PARALLEL_VOLUME_SCANS = 3
const DEFAULT_LIST_PAGE_SIZE = 10
/** Bounded trusted-rescan budget for expanding a scanner-collapsed subtree. */
const COLLAPSED_EXPANSION_MAX_CHILDREN = 48
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

const DEVELOPER_CATEGORY_LABEL = {
  dependencies: "disk.developer.category.dependencies",
  "build-output": "disk.developer.category.buildOutput",
  "toolchain-cache": "disk.developer.category.toolchainCache",
  "agent-data": "disk.developer.category.agentData",
  worktree: "disk.developer.category.worktree",
  "version-control": "disk.developer.category.versionControl",
} as const satisfies Record<DeveloperCategory, DiskLanguageKey>

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const { promise: timed, resolve, reject } = Promise.withResolvers<T>()
  const timer = setTimeout(
    () => reject(new Error(diskLanguageText("disk.error.timeout", { operation: label, milliseconds: ms }))),
    ms,
  )
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
    sortKey: DiskEntrySortKey
    sortDirection: DiskEntrySortDirection
  }>({
    lens: "all",
    developerCategory: "all",
    developerEcosystem: "all",
    developerAge: "all",
    customDeveloperAgeDays: "30",
    sortKey: "size",
    sortDirection: "descending",
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
  const [browseHistory, setBrowseHistory] = createStore<{
    past: string[]
    current?: string
    future: string[]
  }>({ past: [], future: [] })
  const scanHistory = createScanHistory({ os: platform.os })
  const [historyEntries, setHistoryEntries] = createSignal(scanHistory.entries())
  const [volumeScanJobs, setVolumeScanJobs] = createStore<Record<string, VolumeScanJob | undefined>>({})
  const [scanSession, setScanSession] = createStore<{ activeID?: string; foregroundID?: string }>({})
  const [collection, setCollection] = createSignal<DiskScanNode[]>([])
  const [dropActive, setDropActive] = createSignal(false)
  const [collectionDragNode, setCollectionDragNode] = createSignal<DiskScanNode | null>(null)
  const [collectionDropActive, setCollectionDropActive] = createSignal(false)
  const [focusedScan, setFocusedScan] = createSignal<{ label: string } | null>(null)
  // A foreground scan cancels only on a second Escape inside this window.
  const SCAN_CANCEL_ARM_MS = 2000
  let cancelArmedAt = 0
  // The shortcuts popover (<details>) tracks open state for Escape/outside-click dismissal.
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false)
  let scanProgressRegion: HTMLDivElement | undefined
  let shortcutsDetails: HTMLDetailsElement | undefined
  const [landscapeEl, setLandscapeEl] = createSignal<HTMLElement | undefined>()
  const volumeJobs = createMemo(() => Object.values(volumeScanJobs).filter((job): job is VolumeScanJob => !!job))

  /** False while the canvas morph owns the view; the Treemap DOM mounts only when true. */
  const [gridInteractive, setGridInteractive] = createSignal(false)
  const [gridVisible, setGridVisible] = createSignal(false)
  const [morphing, setMorphing] = createSignal(false)
  let morph: ViewMorph | null = null
  const volumeScanUnsubs = new Map<string, () => void>()
  const [canvasEl, setCanvasEl] = createSignal<HTMLCanvasElement | undefined>()
  const [sunburst, setSunburst] = createSignal<Sunburst | undefined>()

  let scanUnsub: (() => void) | undefined

  /** The morph draws on the sunburst's own canvas; both live and die with it. */
  function ensureMorph(el: HTMLCanvasElement): ViewMorph {
    if (!morph || morph.canvas !== el) {
      const ctx = el.getContext("2d", { alpha: true })!
      morph = new ViewMorph(
        el,
        ctx,
        () => {
          const sb = sunburst()
          return { cx: sb?.cx ?? el.width / 2, cy: sb?.cy ?? el.height / 2, maxR: sb?.maxR ?? 0 }
        },
        () => sunburst()?.reducedMotion ?? false,
      )
    }
    return morph
  }

  /**
   * Build one tile per primary wedge, matched by path to its treemap rect so a
   * segment lands exactly on the DOM tile that replaces it.
   */
  function buildMorphTiles(): MorphTile[] {
    const sb = sunburst()
    const landscape = landscapeEl()
    if (!sb || !landscape) return []
    // The overlay's content box is the exact tile space the Treemap DOM lays
    // out in (its padding lives on the same element), so unit rects scale by
    // it — canvas tiles land precisely under their DOM successors.
    const overlay = landscape.querySelector(".dl-treemap-overlay")
    const overlayStyle = overlay ? getComputedStyle(overlay) : undefined
    const padLeft = overlayStyle ? parseFloat(overlayStyle.paddingLeft) : 0
    const padTop = overlayStyle ? parseFloat(overlayStyle.paddingTop) : 0
    const box = landscape.getBoundingClientRect()
    if (box.width <= 0 || box.height <= 0) return []
    const contentW = Math.max(1, box.width - padLeft * 2)
    const contentH = Math.max(1, box.height - padTop * 2)
    const toPixels = (rect: { x: number; y: number; w: number; h: number }) => ({
      x: padLeft + rect.x * contentW,
      y: padTop + rect.y * contentH,
      w: rect.w * contentW,
      h: rect.h * contentH,
    })
    const rectByPath = new Map(
      layoutTreemap(collapseTreemapChildren(sortedChildren()), undefined, true).map((rect) => [
        rect.node.path,
        rect,
      ]),
    )
    const tiles: MorphTile[] = []
    for (const seg of sb.primarySegments()) {
      const rect = rectByPath.get(seg.path)
      if (!rect) continue
      tiles.push({
        path: seg.path,
        node: seg.node,
        colorIndex: rect.index,
        from: {
          wedge: { start: seg.start, end: seg.end, inner: seg.inner, outer: seg.outer },
          rect: toPixels(rect),
        },
        to: {
          wedge: { start: seg.start, end: seg.end, inner: seg.inner, outer: seg.outer },
          rect: toPixels(rect),
        },
      })
    }
    return tiles
  }

  let scanUpdateUnsub: (() => void) | undefined
  let driveFactsUnsub: (() => void) | undefined
  let receivedDriveFacts: DiskDriveFactsUpdate[] = []
  let scanToken = 0
  let previewToken = 0
  let scanMaxBytes = 0
  let lastWatchError: string | undefined
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
  const nextPersistenceError = createPersistenceErrorDeduper()

  const pinnedLocations = settings.general.diskPinnedLocations
  const cleanupLocks = settings.general.diskCleanupLocks

  createEffect(() => {
    const error = nextPersistenceError(settings.general.persistenceError())
    if (!error) return
    showToast({ variant: "error", title: language.t("disk.toast.persistenceFailed"), description: error })
  })

  const crumbs = createMemo(() => buildCrumbs(treeRoot(), viewNode()))
  const usesPhysicalByteAccounting = createMemo(() => isPhysicalByteAccounting(platform.os, scanDrive()))
  /** A fallback or incomplete map must never turn unknown shared storage into a reclaim promise. */
  const physicalCloneAccountingUncertain = createMemo(() =>
    hasUnverifiedPhysicalCloneAccounting(treeRoot(), platform.os, scanDrive()),
  )
  const physicalCloneAccountingWarning = createMemo(() => {
    const root = treeRoot()
    const capability = root?.cloneMetadata
    const sharedStorageEvidence = root?.sharedStorageEvidence
    if (!physicalCloneAccountingUncertain()) return undefined
    if (sharedStorageEvidence === "partial") {
      return language.t("disk.explore.unverifiedExcluded")
    }
    if (sharedStorageEvidence !== "complete") {
      return language.t("disk.explore.unverifiedRelationships")
    }
    if (capability?.state === "unavailable" && capability.reason === "scanner") {
      return language.t("disk.explore.unverifiedScanner")
    }
    if (capability?.state === "unknown") {
      return language.t("disk.explore.unverifiedMetadata")
    }
    return language.t("disk.explore.unverifiedDefault")
  })
  const investigation = createMemo(() =>
    createScanInvestigation(treeRoot(), {
      recognitionText(recognition) {
        return recognition.tag ? language.t(recognition.tag) : ""
      },
      recognitionQueryMayMatch(normalizedQuery) {
        return DISK_RECOGNITION_LANGUAGE_KEYS.some((key) =>
          language.t(key).toLocaleLowerCase().includes(normalizedQuery),
        )
      },
    }),
  )
  const reclaim = (): ReclaimSummary =>
    physicalCloneAccountingUncertain()
      ? EMPTY_RECLAIM
      : actionableReclaimSummary(investigation().recommendations(), platform.os, cleanupLocks())
  const developer = () => investigation().developer()
  const developerAge = createMemo(() =>
    resolveDeveloperCleanupAge(indexFilter.developerAge, indexFilter.customDeveloperAgeDays),
  )
  const developerItems = createMemo(() => {
    if (indexFilter.lens !== "developer") return []
    const category = indexFilter.developerCategory
    const ecosystem = indexFilter.developerEcosystem
    const categorized = developer().items.filter(
      ({ recognition }) =>
        (category === "all" || recognition.developer === category) && matchesArtifactEcosystem(recognition, ecosystem),
    )
    return filterDeveloperItemsByAge(categorized, developerAge())
  })
  const developerEcosystems = createMemo<ArtifactEcosystem[]>(() =>
    indexFilter.lens === "developer"
      ? ARTIFACT_ECOSYSTEMS.filter((ecosystem) =>
          developer().items.some((item) => item.recognition.ecosystem === ecosystem),
        )
      : [],
  )
  const parentSize = createMemo(() => viewNode()?.size ?? 0)
  const parentCount = createMemo(() => viewNode()?.children?.length ?? 0)
  const sortedChildren = createMemo(() =>
    [...(viewNode()?.children ?? [])].sort((left, right) => right.size - left.size),
  )
  const sizeBasisLabel = createMemo(() => {
    if (!usesPhysicalByteAccounting()) return language.t("disk.explore.fileSize")
    return physicalCloneAccountingUncertain()
      ? language.t("disk.explore.physicalUnverified")
      : language.t("disk.explore.diskSpaceUsed")
  })

  const currentHistoryEntries = createMemo(() =>
    filterScanHistoryEntries(historyEntries(), scanSession.activeID, query()),
  )
  const historyChangeCount = createMemo(() =>
    currentHistoryEntries().reduce((total, entry) => total + entry.changes.length, 0),
  )
  const recentChanges = createMemo(() => recentChangeNodes(treeRoot()))
  /**
   * The Recent lens is a page-level overlay on the "all" view: the typed
   * investigation lenses stay closed, so no scan-wide summary is rebuilt.
   */
  const [recentLens, setRecentLens] = createSignal(false)
  const entries = createMemo<Entry[]>(() => {
    const investigationEntries = investigation().entries({
      viewNode: viewNode(),
      query: query(),
      lens: indexFilter.lens,
      sortKey: indexFilter.sortKey,
      sortDirection: indexFilter.sortDirection,
      developerCandidates: () => developerItems().map(({ node, bytes }) => ({ node, displaySize: bytes })),
      recommendationCandidates: () =>
        reclaim()
          .buckets.flatMap((bucket) => bucket.items.map(({ node }) => node))
          .map((node) => ({ node, displaySize: node.size })),
    })
    if (!recentLens()) return investigationEntries
    // The Recent lens is a page-level overlay: the typed investigation lenses
    // stay untouched while it lists recently modified items for this root.
    const matches = new Set(recentChanges())
    return investigationEntries.filter((entry) => matches.has(entry.node))
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
    recentLens()
      ? entries().reduce((total, entry) => total + entry.displaySize, 0)
      : indexFilter.lens === "developer"
        ? developerItems().reduce((total, item) => total + item.bytes, 0)
        : indexFilter.lens === "recommendations"
          ? reclaim().totalBytes
          : indexFilter.lens === "changes"
            ? 0
            : parentSize(),
  )
  const indexCount = createMemo(() =>
    recentLens()
      ? entries().length
      : indexFilter.lens === "changes"
        ? historyChangeCount()
        : query().trim()
          ? entries().length
          : indexFilter.lens === "developer"
            ? developerItems().length
            : indexFilter.lens === "recommendations"
              ? reclaim().totalCount
              : parentCount(),
  )
  // A watcher can rebase a selected deep result against a newer inventory.
  // Never let an identity-less replacement remain actionable while that
  // reconciliation is in flight (or if an older renderer left one behind).
  const effectiveCollection = createMemo(() =>
    uniqueDeletionRoots(
      collection().filter((node) => !inventoryDeletionNeedsRescan(node)),
      platform.os,
    ),
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
        const recognition = investigation().recognitionFor(node)
        return isSmartCleanupEligible(node, recognition) && canModifyNode(node)
      })
  })
  const smartCleanupCandidates = createMemo(() => uniqueDeletionRoots(smartCleanupEligibleEntries(), platform.os))
  const smartCleanupCandidateBytes = createMemo(() =>
    smartCleanupCandidates().reduce((total, node) => total + node.size, 0),
  )
  const smartCleanupReviewCount = createMemo(() =>
    Math.max(0, (indexFilter.lens === "developer" ? entries().length : 0) - smartCleanupEligibleEntries().length),
  )
  const currentScanPinned = createMemo(() => {
    const path = scanSourcePath()
    return !!path && isPinnedScanLocation(pinnedLocations(), path, platform.os)
  })
  const currentScanLocked = createMemo(() => {
    const path = scanSourcePath()
    return !!path && isCleanupLock(path, cleanupLocks(), platform.os)
  })
  const collectionSize = createMemo(() => effectiveCollection().reduce((s, n) => s + n.size, 0))
  const collectionHasSharedPhysicalStorage = createMemo(() => effectiveCollection().some(containsSharedPhysicalStorage))
  const collectionNeedsDeepInventoryRefresh = createMemo(() => requiresDeepInventoryRefresh(effectiveCollection()))
  const runningVolumeScans = createMemo(() => volumeJobs().filter((job) => job.status === "scanning").length)
  const volumeJobForDrive = (drive: DiskDriveInfo) =>
    volumeJobs().find((job) => diskPathEquals(job.sourcePath, drive.path, platform.os))
  /**
   * A move is real only when resolving it lands on a surviving node. Stale
   * history entries are discarded during resolution without changing `current`,
   * so the buttons must not advertise those as navigable.
   */
  const browseMoveAvailable = (direction: DiskBrowseDirection) => {
    const root = treeRoot()
    if (!root || !browseHistory.current) return false
    const next = resolveDiskBrowseHistoryMove(browseHistory, direction, (path) => !!findScanNode(root, path))
    return !!next.current && !diskPathEquals(next.current, browseHistory.current, platform.os)
  }
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
    const unbindMenu = platform.menu?.register(DISK_CHOOSE_FOLDER_COMMAND, () => chooseAndScan())
    onCleanup(() => unbindMenu?.())
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
      if (scanHistory.record(update)) setHistoryEntries([...scanHistory.entries()])
      if (update.watchError && update.watchError !== lastWatchError) {
        lastWatchError = update.watchError
        showToast({
          variant: "error",
          title: language.t("disk.toast.livePaused"),
          description: language.t("disk.toast.livePausedBody", { message: update.watchError }),
          actions: [{ label: language.t("disk.common.rescan"), onClick: () => void rescanCurrent(true) }],
        })
      } else if (!update.watchError) {
        lastWatchError = undefined
      }
      const job = volumeScanJobs[update.scanId]
      if (job) {
        const tree = scanUpdateTree(update.root, job.drive, job.label)
        // The volume card's byte readout must track the refreshed map, not the
        // count captured at completion time.
        setVolumeScanJobs(update.scanId, {
          tree,
          ...(job.status === "complete" ? { bytes: tree.size } : {}),
        })
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
      const tree = scanUpdateTree(
        update.root,
        job?.drive ?? scanDrive(),
        job?.label ?? (scanLabel() || update.root.name),
      )
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
      if (!nextView) resetBrowseHistory(tree.path)
    })
  })

  // (Re)create the sunburst when its canvas mounts. The canvas persists across
  // map⇄grid now, so this runs once per mount — never rebuild for a mode switch.
  createEffect(() => {
    const el = canvasEl()
    if (!el) {
      setSunburst(undefined)
      morph?.abort()
      morph = null
      return
    }
    if (untrack(() => sunburst())) return
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
        if (seg.node.isDir && !isVisualAggregate(seg.node)) drill(seg.node)
      },
      onCenterClick: () => goUp(),
    })
    const root = untrack(() => treeRoot())
    if (root) sb.setData(root, untrack(() => viewNode()), orbitEntryIntent === "keyboard")
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

  function replaceBrowseHistory(next: DiskBrowseHistory) {
    setBrowseHistory({ past: [...next.past], current: next.current, future: [...next.future] })
  }

  function resetBrowseHistory(path?: string) {
    replaceBrowseHistory(
      transitionDiskBrowseHistory(EMPTY_DISK_BROWSE_HISTORY, { type: "reset", ...(path ? { path } : {}) }),
    )
  }

  function recordBrowseVisit(path: string) {
    replaceBrowseHistory(
      transitionDiskBrowseHistory(
        browseHistory,
        { type: "visit", path },
        { equals: (left, right) => diskPathEquals(left, right, platform.os) },
      ),
    )
  }

  function showBrowseNode(node: DiskScanNode, instant = false) {
    clearSelectionAnnouncement()
    sunburst()?.navigateTo(node, instant)
    setViewNode(node)
    setIndexFilter({ lens: "all", developerCategory: "all" })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setVisualHoverNode(null)
    setQuery("")
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
  }

  function moveBrowseHistory(direction: DiskBrowseDirection) {
    if (scanning()) return
    const root = treeRoot()
    if (!root) return
    const current = browseHistory.current
    const next = resolveDiskBrowseHistoryMove(browseHistory, direction, (path) => !!findScanNode(root, path))
    const changed = next !== browseHistory
    if (changed) replaceBrowseHistory(next)
    if (!next.current || diskPathEquals(next.current, current ?? "", platform.os)) return
    const node = findScanNode(root, next.current)
    if (!node) return
    showBrowseNode(node, true)
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
      const list = await withTimeout(api.getDrives(), 8000, language.t("disk.toast.listingDrives"))
      setDrives(
        list.map((drive) => {
          const facts = receivedDriveFacts.find((candidate) => diskPathEquals(candidate.path, drive.path, platform.os))
          return facts ? { ...drive, ...facts.facts } : drive
        }),
      )
      // Diagnostics are helpful context, not a dependency for the main drive
      // chooser. Let it settle independently so a permission probe never
      // delays the first useful screen.
      void withTimeout(api.getStorageDiagnostics(), 8000, language.t("disk.toast.checkingStorage"))
        .then(setStorageDiagnostics)
        .catch(() => undefined)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setDrivesError(message)
      setDrives([])
      showToast({ variant: "error", title: language.t("disk.toast.listFailed"), description: message })
    } finally {
      setDrivesLoading(false)
    }
  }

  async function chooseAndScan() {
    const api = disk()
    if (!api) return
    await chooseFolderAndScan({
      chooseFolder: () => api.chooseFolder(),
      startScan,
      drives: drives(),
      os: platform.os,
    })
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
      showToast({ variant: "default", title: language.t("disk.toast.noPrivacy") })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("disk.toast.privacyFailed"),
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
        title: language.t("disk.toast.scanLimit"),
        description: language.t("disk.toast.scanLimitBody"),
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
      scanHistory.seed(id, scannedTree)
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
      // A finished scan is an invitation: land the user in the map instead of
      // making them find the View affordance (DaisyDisk-style 2-step flow).
      const job = volumeScanJobs[id]
      if (job?.tree && view() === "drives" && !scanning()) {
        openVolumeScan(job)
      } else {
        // Background completion (or the user moved on): the toast with its
        // View action is the only path into the map, so keep it.
        showToast({
          variant: "default",
          title: language.t("disk.toast.driveReady", { name: drive.name }),
          description: language.t("disk.toast.driveReadyBody"),
          actions: [
            {
              label: language.t("disk.drive.action.view"),
              onClick: () => {
                const latest = volumeScanJobs[id]
                if (latest?.tree) openVolumeScan(latest)
              },
            },
          ],
        })
      }
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
    scanHistory.forget(id)
    void api?.cancelScan(id)
  }

  function closeVolumeScan(id: string) {
    if (volumeScanJobs[id]?.status === "scanning") {
      cancelVolumeScan(id)
      return
    }
    setVolumeScanJobs(id, undefined)
    scanHistory.forget(id)
    void disk()?.stopWatching(id)
  }

  function openVolumeScan(job: VolumeScanJob) {
    if (!job.tree) return
    // A completed tree is immutable renderer data. Keep it outside the deep
    // createStore proxy graph so traversing a large scan does not allocate a
    // signal/property wrapper for every node and field.
    const tree = unwrap(job.tree)
    saveCurrentTab()
    setScanSession({ activeID: job.id, foregroundID: undefined })
    orbitEntryIntent = "scan-complete"
    batch(() => {
      setView("scan")
      setScanning(false)
      setFocusedScan(null)
      setTreeRoot(tree)
      setViewNode(tree)
      resetBrowseHistory(tree.path)
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
        browseHistory: {
          past: [...browseHistory.past],
          current: browseHistory.current ?? (viewNode() ?? root).path,
          future: [...browseHistory.future],
        },
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
    replaceBrowseHistory(
      tab.browseHistory.current && findScanNode(tab.tree, tab.browseHistory.current)
        ? tab.browseHistory
        : transitionDiskBrowseHistory(EMPTY_DISK_BROWSE_HISTORY, { type: "reset", path: tab.view.path }),
    )
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
    if (tab?.sessionID && !volumeScanJobs[tab.sessionID]) {
      scanHistory.forget(tab.sessionID)
      void disk()?.stopWatching(tab.sessionID)
    }
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
    focusScanProgress()
    clearSelectionAnnouncement()
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
    resetBrowseHistory()
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
      if (scanSession.foregroundID !== sessionID) return // viewport moved to another scan
      scanHistory.seed(sessionID, scannedTree)
      const tree = includeHiddenSpace(asBrowseableRoot(scannedTree), drive)
      tree._label = label
      batch(() => {
        setScanPct(100)
        setTreeRoot(tree)
        setViewNode(tree)
        resetBrowseHistory(tree.path)
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
      })
      focusAfterScanCompletion()
    } catch (err) {
      if (token !== scanToken || isScanCancellation(err)) return
      const message = err instanceof Error ? err.message : String(err)
      showToast({ variant: "error", title: language.t("disk.toast.scanFailed"), description: message })
      if (volumeScanJobs[sessionID]) setVolumeScanJobs(sessionID, { status: "failed", error: message })
      setView("drives")
      setScanSourcePath("")
      setScanLabel("")
      setScanDrive(undefined)
      if (scanSession.activeID === sessionID) setScanSession("activeID", undefined)
      scanHistory.forget(sessionID)
    } finally {
      if (token === scanToken) {
        setScanning(false)
        scanUnsub?.()
        scanUnsub = undefined
        setScanSession("foregroundID", undefined)
      }
    }
  }

  async function expandFocusedNode(
    node: DiskScanNode,
    restoreListFocus = false,
    options: FocusedExpansionOptions = {},
  ) {
    const api = disk()
    const initialRoot = treeRoot()
    if (!api || !initialRoot) return
    scanUnsub?.()
    const token = ++scanToken
    const sessionID = newScanID("expand")
    setScanSession("foregroundID", sessionID)
    orbitEntryIntent = "scan-complete"
    const drive = driveForPath(node.path, drives(), platform.os) ?? scanDrive()
    const isScanRoot = diskPathEquals(initialRoot.path, node.path, platform.os)
    setFocusedScan({ label: options.label ?? diskNodeDisplayName(node) })
    setScanning(true)
    setScanFiles(0)
    setScanTotal(0)
    setScanPct(0)
    setScanBytes(0)
    scanMaxBytes = 0
    setScanTail("")
    const unsubscribe = api.onScanProgress((progress) => {
      if (token !== scanToken || progress.scanId !== sessionID) return
      setScanFiles(progress.filesScanned)
      setScanTail(progress.currentPath)
      if (progress.size <= scanMaxBytes) return
      scanMaxBytes = progress.size
      setScanBytes(scanMaxBytes)
    })
    scanUnsub = unsubscribe
    let retainTrustedSubtree = false

    try {
      const scannedTree = await api.scanPath(
        node.path,
        {
          ...scannerOptions(drive, isScanRoot),
          ...(options.maxChildren === undefined ? {} : { maxChildren: options.maxChildren }),
        },
        sessionID,
      )
      if (token !== scanToken || !scannedTree) return
      const latestRoot = treeRoot()
      if (
        !latestRoot ||
        !diskPathEquals(latestRoot.path, initialRoot.path, platform.os) ||
        !findScanNode(latestRoot, node.path)
      ) {
        throw new Error(language.t("disk.toast.folderChanged"))
      }
      const browsable = asBrowseableRoot(scannedTree)
      const replacement = isScanRoot
        ? { ...includeHiddenSpace(browsable, drive), _label: latestRoot._label }
        : browsable
      // A primary watcher may have published a newer generation while the
      // focused scan was in flight. Graft into that latest root so unrelated
      // watcher changes cannot be resurrected by the completion callback.
      const nextRoot = replaceScanSubtree(latestRoot, node.path, replacement, platform.os)
      if (nextRoot === latestRoot) throw new Error(language.t("disk.toast.folderChanged"))
      const nextView = findScanNode(nextRoot, replacement.path)
      if (!nextView) throw new Error(language.t("disk.toast.folderChanged"))
      retainTrustedSubtree = true
      clearSelectionAnnouncement()
      setScanPct(100)
      setTreeRoot(nextRoot)
      setViewNode(nextView)
      recordBrowseVisit(nextView.path)
      if (scanSession.activeID && volumeScanJobs[scanSession.activeID]) {
        setVolumeScanJobs(scanSession.activeID, "tree", nextRoot)
      }
      setCollection((items) =>
        items.flatMap((item) => {
          if (!pathBelongsToScanRoot(item.path, node.path)) return [item]
          const refreshed =
            findScanNode(nextRoot, item.path) ??
            developerInventoryCollectionNodeForPath(nextRoot, item.path, platform.os)
          return refreshed ? [refreshed] : []
        }),
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
        title: language.t("disk.toast.openFailed", { name: options.label ?? diskNodeDisplayName(node) }),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      unsubscribe()
      if (scanUnsub === unsubscribe) scanUnsub = undefined
      void api.stopWatching(sessionID, retainTrustedSubtree ? { retainTrustedSubtree: true } : undefined)
      if (token === scanToken) {
        setFocusedScan(null)
        setScanning(false)
        setScanSession("foregroundID", undefined)
      }
    }
  }

  function expandOtherNode(node: DiskScanNode, restoreListFocus = false) {
    const root = treeRoot()
    if (!root) return
    const plan = planOtherExpansion(root, node, platform.os)
    if (!plan) {
      showToast({ variant: "default", title: language.t("disk.toast.moreLimit") })
      return
    }
    void expandFocusedNode(plan.parent, restoreListFocus, {
      label: diskNodeDisplayName(node),
      maxChildren: plan.maxChildren,
    })
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
      void withTimeout(api.getDrives(), 8000, language.t("disk.toast.refreshingTotals"))
        .then(setDrives)
        // A scan remains useful when a removable/network drive cannot refresh
        // its capacity metadata.
        .catch(() => undefined)
    }
    await scan
  }

  /** Abort a focused expansion in place; primary scans return to the volume list. */
  function cancelScan({ confirmed = false }: { confirmed?: boolean } = {}) {
    // A foreground scan is expensive to throw away. The first Escape only arms
    // the cancellation; a second press inside the window confirms it.
    if (!confirmed && !focusedScan()) {
      if (Date.now() - cancelArmedAt < SCAN_CANCEL_ARM_MS) {
        cancelArmedAt = 0
      } else {
        cancelArmedAt = Date.now()
        showToast({
          variant: "default",
          title: language.t("disk.scan.label", { label: scanLabel() }),
          actions: [
            {
              label: language.t("disk.common.cancelScan"),
              onClick: () => cancelScan({ confirmed: true }),
            },
          ],
        })
        return
      }
    }
    const focused = focusedScan()
    const sessionID = scanSession.foregroundID
    scanToken++
    scanUnsub?.()
    scanUnsub = undefined
    setScanSession("foregroundID", undefined)
    if (sessionID) {
      void disk()?.cancelScan(sessionID)
      if (focused) void disk()?.stopWatching(sessionID)
    }
    if (sessionID && volumeScanJobs[sessionID]) setVolumeScanJobs(sessionID, undefined)
    setFocusedScan(null)
    setScanning(false)
    focusPersistentDiskAction()
    if (!focused) backToDrives()
  }

  function drill(node: DiskScanNode, instant = false, restoreListFocus = false) {
    if (scanning() || !node.isDir || isDeveloperInventoryNode(node)) return
    if (node.isOther) {
      expandOtherNode(node, restoreListFocus)
      return
    }
    if (node.isCollapsed) {
      void expandFocusedNode(node, restoreListFocus, {
        maxChildren: COLLAPSED_EXPANSION_MAX_CHILDREN,
      })
      return
    }
    recordBrowseVisit(node.path)
    showBrowseNode(node, instant)
    if (restoreListFocus) focusListEntry(0)
  }

  function chooseLens(lens: IndexLens | "recent") {
    setRecentLens(lens === "recent")
    setIndexFilter({ lens: lens === "recent" ? "all" : lens, developerCategory: "all" })
    setQuery("")
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    scrollIndexIntoView?.(0)
  }

  function clearCurrentHistory() {
    const scanId = scanSession.activeID
    if (!scanId) return
    scanHistory.clear(scanId)
    setHistoryEntries([...scanHistory.entries()])
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
    const path = selectedPath()
    setQuery(value)
    setHoveredPath(null)
    setRangeAnchorIndex(undefined)
    const nextIndex = path ? entries().findIndex((entry) => diskPathEquals(entry.node.path, path, platform.os)) : -1
    if (nextIndex >= 0) {
      setFocusIdx(nextIndex)
      scrollIndexIntoView?.(nextIndex)
    }
  }

  function chooseScanMode(mode: ScanMode, intent: Exclude<SunburstEntryIntent, "scan-complete"> = "pointer") {
    if (mode === "map" && scanMode() !== "map") orbitEntryIntent = intent
    const previous = scanMode()
    setScanMode(mode)
    setVisualHoverNode(null)
    setHoveredPath(null)
    if (mode === "grid" && previous !== "list") {
      runViewMorph("toGrid", mode, intent)
    } else if (mode === "map" && previous === "grid") {
      // Tiles fade out quickly, then the corners fly back into the wheel.
      setGridInteractive(false)
      setTimeout(() => {
        if (scanMode() === "map") runViewMorph("toMap", mode, intent)
      }, 120)
    } else {
      setGridVisible(mode === "grid")
      setGridInteractive(mode === "grid")
    }
    // Keyboard focus lands on the target view; during a morph the tiles don't
    // exist yet, so runViewMorph re-issues it when the flight lands.
    if (intent === "keyboard" && !morphing()) restoreKeyboardViewFocus(mode)
  }

  /**
   * The map⇄tiles morph: the sunburst yields its canvas, primary wedges fly
   * their corners to (or from) their treemap rects, and the Treemap DOM takes
   * over only once the flight has landed on exact tile geometry.
   */
  function runViewMorph(dir: "toGrid" | "toMap", mode: ScanMode, intent: Exclude<SunburstEntryIntent, "scan-complete">) {
    const sb = sunburst()
    const el = canvasEl()
    if (!sb || !el || sb.reducedMotion) {
      setGridVisible(mode === "grid")
      setGridInteractive(mode === "grid")
      return
    }
    const tiles = buildMorphTiles()
    if (!tiles.length) {
      setGridVisible(mode === "grid")
      setGridInteractive(mode === "grid")
      return
    }
    // An interrupted morph must not fire a stale completion callback.
    morph?.abort()
    setMorphing(true)
    sb.setMorphing(true)
    ensureMorph(el).play(tiles, dir, () => {
      setMorphing(false)
      sb.setMorphing(false)
      if (mode === "grid" && scanMode() === mode) {
        setGridVisible(true)
        setGridInteractive(true)
        if (intent === "keyboard") restoreKeyboardViewFocus(mode)
      }
    })
  }

  function updateSort(key: DiskEntrySortKey, direction: DiskEntrySortDirection) {
    const path = selectedPath()
    setIndexFilter({ sortKey: key, sortDirection: direction })
    setRangeAnchorIndex(undefined)
    const nextIndex = path ? entries().findIndex((entry) => diskPathEquals(entry.node.path, path, platform.os)) : -1
    setFocusIdx(nextIndex >= 0 ? nextIndex : 0)
    scrollIndexIntoView?.(nextIndex >= 0 ? nextIndex : 0)
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


  /** A newly started scan announces itself from its progress region. */
  function focusScanProgress() {
    requestAnimationFrame(() => scanProgressRegion?.focus({ preventScroll: true }))
  }

  /** Scan completion lands keyboard users on the fresh map or the results list. */
  function focusAfterScanCompletion() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (scanMode() === "map") {
          canvasEl()?.focus({ preventScroll: true })
          return
        }
        if (entries().length > 0) focusListEntry(0)
        else focusPersistentDiskAction()
      })
    })
  }

  function togglePinnedLocation(path: string, label: string) {
    const wasPinned = isPinnedScanLocation(pinnedLocations(), path, platform.os)
    const next = togglePinnedScanLocation(pinnedLocations(), { path, label }, platform.os)
    if (!wasPinned && !isPinnedScanLocation(next, path, platform.os)) {
      showToast({
        variant: "default",
        title: language.t("disk.toast.savedFull"),
        description: language.t("disk.toast.savedFullBody"),
      })
      return
    }
    settings.general.setDiskPinnedLocations(next)
    showToast({
      variant: "default",
      title: wasPinned ? language.t("disk.toast.savedRemoved") : language.t("disk.toast.savedAdded"),
      description: label,
    })
  }

  function toggleProtectedTree(path: string, label: string) {
    const wasLocked = isCleanupLock(path, cleanupLocks(), platform.os)
    const next = toggleCleanupLock(cleanupLocks(), { path, label }, platform.os)
    if (!wasLocked && !isCleanupLock(path, next, platform.os)) {
      showToast({
        variant: "default",
        title: language.t("disk.toast.protectedFull"),
        description: language.t("disk.toast.protectedFullBody"),
      })
      return
    }
    settings.general.setDiskCleanupLocks(next)
    setCollection((items) => withoutCleanupLockedNodes(items, next, platform.os))
    showToast({
      variant: "default",
      title: wasLocked ? language.t("disk.toast.cleanupUnlocked") : language.t("disk.toast.cleanupProtected"),
      description: wasLocked
        ? language.t("disk.toast.cleanupUnlockedBodyLegacy", { name: label })
        : language.t("disk.toast.cleanupProtectedBodyLegacy", { name: label }),
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
      recordBrowseVisit(parent.node.path)
      showBrowseNode(parent.node, instant)
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
    clearSelectionAnnouncement()
    setTreeRoot(null)
    setViewNode(null)
    resetBrowseHistory()
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
      recordBrowseVisit(crumb.node.path)
      showBrowseNode(crumb.node)
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
    document
      .querySelector<HTMLElement>("[data-disk-primary-action], [data-disk-navigation-home]")
      ?.focus({ preventScroll: true })
  }

  function selectPath(path: string) {
    setSelectedPath(path)
    sunburst()?.setSelected(path)
    const root = treeRoot()
    // One pass resolves both the row index and the node; the deep-tree search
    // only runs when the selection lives outside the visible lens.
    const list = entries()
    let idx = -1
    let node: DiskScanNode | undefined
    for (let i = 0; i < list.length; i++) {
      if (list[i].node.path === path) {
        idx = i
        node = list[i].node
        break
      }
    }
    if (idx >= 0) setFocusIdx(idx)
    else node ??= root ? findScanNode(root, path) : undefined
    if (!node) return
    const announced = node
    if (selectionAnnouncementTimer) clearTimeout(selectionAnnouncementTimer)
    selectionAnnouncementTimer = setTimeout(() => {
      selectionAnnouncementTimer = undefined
      setAnnouncedSelection(
        describeStorageNode(announced, indexFilter.lens === "all" ? parentSize() : indexSize(), {
          canPreview: !!disk(),
          canReview: canModifyNode(announced),
          requiresRescanBeforeReview: inventoryDeletionNeedsRescan(announced),
        }),
      )
    }, 120)
  }

  function clearSelectionAnnouncement() {
    if (selectionAnnouncementTimer) clearTimeout(selectionAnnouncementTimer)
    selectionAnnouncementTimer = undefined
    setAnnouncedSelection("")
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
      if (!isDeveloperInventoryNode(node)) drill(node, true)
      return
    }
    if (!node.isOther) void openPreview(node)
  }

  function handleEntryKeyDown(event: KeyboardEvent, node: DiskScanNode, index: number) {
    if (event.defaultPrevented) return
    const supportsRangeNavigation = !event.metaKey && !event.ctrlKey && !event.altKey
    const isPlainShortcut = supportsRangeNavigation && !event.shiftKey
    if (
      event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault()
      moveBrowseHistory(event.key === "ArrowLeft" ? "back" : "forward")
      return
    }
    if (
      supportsRangeNavigation &&
      (event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        (isPlainShortcut && (event.key === "j" || event.key === "k")))
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
      if (!node.isDir || isDeveloperInventoryNode(node)) return
      event.preventDefault()
      drill(node, true, true)
      return
    }
    if (isPlainShortcut && event.key === "Enter") {
      event.preventDefault()
      if (node.isDir) {
        if (!isDeveloperInventoryNode(node)) drill(node, true, true)
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
    if (isPlainShortcut && event.key.toLowerCase() === "l") {
      if (node.isOther || node.isHidden) return
      event.preventDefault()
      toggleProtectedTree(node.path, node.name)
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
        title: language.t("disk.toast.revealFailed"),
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
        title: language.t("disk.toast.openFileFailed"),
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
        title: language.t("disk.toast.quickLookFailed"),
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
        title: language.t("disk.toast.trashOpenFailed", { trash: nativeTrashName(platform.os) }),
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
    if (
      deepInventoryNeedsRefresh ||
      physicalCloneAccountingUncertain() ||
      removed.some(containsSharedPhysicalStorage)
    ) {
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
        const nextView = viewAfterDeletion(tab.tree, tree, tab.view, removed)
        return [
          {
            ...tab,
            tree,
            view: nextView,
            browseHistory: diskPathEquals(nextView.path, tab.view.path, platform.os)
              ? tab.browseHistory
              : transitionDiskBrowseHistory(EMPTY_DISK_BROWSE_HISTORY, { type: "reset", path: nextView.path }),
          },
        ]
      }),
    )

    // A completed volume card keeps its own retained map. Patch it here too,
    // or reopening the volume would resurrect the deleted subtrees.
    for (const job of volumeJobs()) {
      if (!job.tree) continue
      const tree = removeScanSubtrees(job.tree, removed, platform.os)
      if (tree && tree !== job.tree) setVolumeScanJobs(job.id, "tree", tree)
    }

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
    const nextView = viewAfterDeletion(root, tree, view, removed)
    batch(() => {
      setTreeRoot(tree)
      setViewNode(nextView)
      setSelectedPath(undefined)
      setHoveredPath(null)
      setVisualHoverNode(null)
      setFocusIdx(0)
    })
    if (!diskPathEquals(nextView.path, view.path, platform.os)) resetBrowseHistory(nextView.path)
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
      const [prepared] = await api.authorizeDeletePaths([node.path])
      if (!prepared || !diskPathEquals(prepared.path, node.path, platform.os)) {
        throw new Error(language.t("disk.toast.authorizationMismatch"))
      }
      await api.deletePath(node.path, {
        authorization: prepared.authorization,
        ...(deepDeletePrecondition ? { precondition: deepDeletePrecondition } : {}),
      })
      const deepInventoryNeedsRefresh = requiresDeepInventoryRefresh([node])
      const sharedStorageNeedsRefresh = containsSharedPhysicalStorage(node)
      const physicalAccountingNeedsRefresh =
        deepInventoryNeedsRefresh || sharedStorageNeedsRefresh || physicalCloneAccountingUncertain()
      applyDeletedNodes([node])
      showToast({
        variant: "success",
        title: language.t("disk.toast.moved", { trash: nativeTrashName(platform.os) }),
        description: deepInventoryNeedsRefresh
          ? language.t("disk.toast.movedRebuild", { name: node.name })
          : physicalAccountingNeedsRefresh
            ? language.t("disk.toast.movedRecompute", { name: node.name })
            : node.name,
        actions: [
          {
            label: language.t("disk.toast.showTrash", { trash: nativeTrashName(platform.os) }),
            onClick: () => void openTrash(),
          },
          { label: language.t("disk.common.rescan"), onClick: () => void rescanCurrent() },
        ],
      })
    } catch (err) {
      if (isDeveloperInventoryNode(node) && isDeveloperArtifactPreconditionRejection(err)) {
        showDeveloperArtifactRescanGuidance(node, "changed")
        return
      }
      showToast({
        variant: "error",
        title: language.t("disk.toast.deleteFailed"),
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
      const lock = cleanupLockForPath(node.path, cleanupLocks(), platform.os)
      showToast({
        variant: "default",
        title: lock ? language.t("disk.toast.cleanupProtected") : language.t("disk.toast.protectedItem"),
        description: lock ? cleanupLockMessage(lock) : language.t("disk.toast.protectedBody"),
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
    if (!canActOnNode(node, platform.os, cleanupLocks())) return false
    if (inventoryDeletionNeedsRescan(node)) return false
    const recognition = investigation().recognitionFor(node)
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

  function showDeveloperArtifactRescanGuidance(
    node: DiskScanNode,
    reason: "missing-identity" | "changed" = "missing-identity",
  ) {
    showToast({
      variant: "default",
      title: reason === "changed" ? language.t("disk.toast.artifactChanged") : language.t("disk.toast.rescanRemoval"),
      description:
        reason === "changed"
          ? language.t("disk.toast.changedBody", { name: node.name, trash: nativeTrashName(platform.os) })
          : language.t("disk.toast.missingIdentityBody", {
              name: node.name,
              trash: nativeTrashName(platform.os),
            }),
      actions: [{ label: language.t("disk.common.rescan"), onClick: () => void rescanCurrent(true) }],
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
    if (event.button !== 0 || morphing()) return
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
      const actionableItems = uniqueDeletionRoots(items, platform.os).filter((node) =>
        canActOnNode(node, platform.os, cleanupLocks()),
      )
      const prepared = await api.authorizeDeletePaths(actionableItems.map((node) => node.path))
      const authorizations = new Map(prepared.map((item) => [item.path, item.authorization]))
      let completed = 0
      const { removed, failed } = await runDeletionBatch(
        items,
        async (node) => {
          try {
            const deepDeletePrecondition = developerInventoryDeletePrecondition(node)
            if (isDeveloperInventoryNode(node) && !deepDeletePrecondition) {
              throw new Error(language.t("disk.toast.deepIdentity"))
            }
            const authorization = authorizations.get(node.path)
            if (!authorization) throw new Error(language.t("disk.toast.authorizationMismatch"))
            return await api.deletePath(node.path, {
              authorization,
              ...(deepDeletePrecondition ? { precondition: deepDeletePrecondition } : {}),
            })
          } finally {
            completed++
            setDeletionProgress({ completed, total: items.length })
          }
        },
        platform.os,
        cleanupLocks(),
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
            ? language.t("disk.toast.movedItems", {
                items: language.plural("disk.count.item", removed.length),
                trash: nativeTrashName(platform.os),
              })
            : language.t("disk.toast.movedBytes", {
                bytes: formatBytes(removed.reduce((sum, node) => sum + node.size, 0)),
                trash: nativeTrashName(platform.os),
              }),
          description: physicalAccountingNeedsRefresh
            ? deepInventoryNeedsRefresh
              ? language.t("disk.toast.batchDeep")
              : knownSharedStorage
                ? language.t("disk.toast.batchShared")
                : language.t("disk.toast.batchUnverified")
            : language.t("disk.toast.batchMoved", {
                items: language.plural("disk.count.item", removed.length),
                trash: nativeTrashName(platform.os),
              }),
          actions: [
            {
              label: language.t("disk.toast.showTrash", { trash: nativeTrashName(platform.os) }),
              onClick: () => void openTrash(),
            },
            { label: language.t("disk.common.rescan"), onClick: () => void rescanCurrent() },
          ],
        })
      }
      const staleDeepFailures = failed.filter(
        ({ node, error }) =>
          isDeveloperInventoryNode(node) &&
          (inventoryDeletionNeedsRescan(node) || isDeveloperArtifactPreconditionRejection(error)),
      )
      const retryableFailures = failed.filter(
        ({ node, error }) =>
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
          title: language.plural("disk.count.removalFailed", retryableFailures.length),
          description: first instanceof Error ? first.message : String(first),
        })
      }
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("disk.toast.deleteFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
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
      showToast({ variant: "error", title: language.t("disk.toast.readDroppedFailed") })
      return
    }
    if ((event.dataTransfer?.files.length ?? 0) > 1) {
      showToast({ variant: "default", title: language.t("disk.toast.scanningFirstDrop"), description: file.name })
    }
    await startScan(path, file.name || path.split(/[/\\]/).pop() || path, driveForPath(path, drives(), platform.os))
  }

  // Shortcuts popover: Escape and any outside pointer press dismiss it.
  onMount(() => {
    const closeShortcuts = () => {
      if (!shortcutsDetails) return
      shortcutsDetails.open = false
      setShortcutsOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !shortcutsOpen()) return
      e.preventDefault()
      e.stopImmediatePropagation()
      closeShortcuts()
      shortcutsDetails?.querySelector("summary")?.focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && shortcutsDetails?.contains(event.target)) return
      if (shortcutsOpen()) closeShortcuts()
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("pointerdown", onPointerDown)
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("pointerdown", onPointerDown)
    })
  })

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
          cancelArmedAt = 0
        }
        return
      }
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault()
        moveBrowseHistory(e.key === "ArrowLeft" ? "back" : "forward")
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
        if (!node?.isDir || isDeveloperInventoryNode(node)) return
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
      if (isPlainShortcut && e.key.toLowerCase() === "l") {
        const node = focusedEntryNode()
        if (!node || node.isOther || node.isHidden) return
        e.preventDefault()
        toggleProtectedTree(node.path, node.name)
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
      data-os={platform.os}
      data-fullscreen={platform.windowFullscreen?.() ? "true" : undefined}
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
            <p class="mt-5 text-20-medium tracking-[-0.03em] text-text-strong">{language.t("disk.drop.title")}</p>
            <p class="mt-2 text-12-regular text-text-weak">{language.t("disk.drop.body")}</p>
          </div>
        </div>
      </Show>

      <header
        class="dl-topbar relative z-20 flex h-14 shrink-0 items-center gap-4 px-5 backdrop-blur-xl"
        data-tauri-drag-region
        inert={activeDialog() ? true : undefined}
        aria-hidden={activeDialog() ? "true" : undefined}
      >
        <button
          type="button"
          data-disk-navigation-home
          class="dl-touch-target group flex min-h-10 shrink-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
          aria-label={language.t("disk.top.backToVolumes")}
          onClick={() => backToDrives()}
        >
          <span class="dl-mark dl-accent-text relative grid size-7 place-items-center rounded-full" aria-hidden="true">
            <span class="size-2 rounded-full bg-current" />
          </span>
          <span class="dl-brand-name text-14-semibold tracking-[-0.02em] text-text-strong">
            {language.t("disk.brand")}
          </span>
        </button>

        <Show when={view() === "scan" && crumbs().length > 0}>
          <span class="h-4 w-px bg-border-weaker-base" aria-hidden />
          <div class="flex shrink-0 items-center gap-0.5">
            <Button
              class="dl-touch-target"
              variant="ghost"
              size="small"
              icon="chevron-left"
              data-disk-history-back
              aria-label={language.t("disk.top.previousLocation")}
              disabled={!browseMoveAvailable("back")}
              onClick={() => moveBrowseHistory("back")}
            />
            <Button
              class="dl-touch-target"
              variant="ghost"
              size="small"
              icon="chevron-right"
              data-disk-history-forward
              aria-label={language.t("disk.top.nextLocation")}
              disabled={!browseMoveAvailable("forward")}
              onClick={() => moveBrowseHistory("forward")}
            />
          </div>
          <Button class="dl-touch-target" variant="ghost" size="small" icon="chevron-left" onClick={() => goUp()}>
            {crumbs().length <= 1 ? language.t("disk.common.volumes") : language.t("disk.common.back")}
          </Button>
          <nav
            class="dl-breadcrumbs flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label={language.t("disk.top.currentLocation")}
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
              aria-label={currentScanPinned() ? language.t("disk.top.unsave") : language.t("disk.top.save")}
              onClick={() => togglePinnedLocation(scanSourcePath(), scanLabel())}
            >
              <span class="dl-responsive-label">
                {currentScanPinned() ? language.t("disk.common.saved") : language.t("disk.common.saveLocation")}
              </span>
            </Button>
            <Button
              class="dl-touch-target"
              variant={currentScanLocked() ? "secondary" : "ghost"}
              size="small"
              icon="shield"
              aria-pressed={currentScanLocked()}
              aria-label={currentScanLocked() ? language.t("disk.top.unprotect") : language.t("disk.top.protect")}
              onClick={() => toggleProtectedTree(scanSourcePath(), scanLabel())}
            >
              <span class="dl-responsive-label">
                {currentScanLocked() ? language.t("disk.detail.protected") : language.t("disk.detail.protect")}
              </span>
            </Button>
            <Button
              class="dl-touch-target dl-rescan"
              variant="ghost"
              size="small"
              icon="reset"
              aria-label={language.t("disk.top.rescan")}
              onClick={() => void rescanCurrent()}
            >
              <span class="dl-responsive-label">{language.t("disk.common.rescan")}</span>
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
              {language.t("disk.common.refresh")}
            </Button>
          </Show>
        </div>
      </header>

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
              title={language.t("disk.top.openDesktop")}
              body={language.t("disk.top.desktopBody")}
            />
          }
        >
          <Show
            when={disk()}
            fallback={
              <Placeholder
                icon="folder"
                title={language.t("disk.top.scannerDisconnected")}
                body={language.t("disk.top.disconnectedBody")}
              />
            }
          >
            <Show when={view() === "drives"}>
              <DriveOverview
                drives={drives()}
                loading={drivesLoading()}
                error={drivesError()}
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
                  void startScan(location.path, location.label, driveForPath(location.path, drives(), platform.os))
                }
                onRemovePinnedLocation={(location) => togglePinnedLocation(location.path, location.label)}
                cleanupLocks={cleanupLocks()}
                onUnlockCleanupLock={(location) => toggleProtectedTree(location.path, location.label)}
              />
            </Show>

            <Show when={view() === "scan"}>
              <Show
                when={!scanning()}
                fallback={
                  <div
                    ref={scanProgressRegion}
                    class="relative flex h-full items-center justify-center overflow-auto px-5 py-8 sm:px-8 sm:py-10 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak"
                    tabIndex={0}
                    role="region"
                    aria-label={language.t("disk.scan.label", { label: focusedScan()?.label ?? scanLabel() })}
                  >
                    <ScanFormation
                      label={focusedScan()?.label ?? scanLabel()}
                      files={scanFiles()}
                      bytes={scanBytes()}
                      currentPath={scanTail()}
                      pct={scanTotal() > 0 ? scanPct() : null}
                      onCancel={() => cancelScan({ confirmed: true })}
                    />
                  </div>
                }
              >
                <div class="flex h-full min-h-0 flex-col">
                  <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {announcedSelection()}
                  </span>
                  <Show when={tabs().length > 0}>
                    <div
                      class="flex shrink-0 items-center gap-1 overflow-x-auto px-4 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                      role="tablist"
                      aria-label={language.t("disk.drive.saved")}
                    >
                      <For each={tabs()}>
                        {(tab) => (
                          <div class="dl-hover-tab flex min-w-0 max-w-[220px] shrink-0 items-center rounded-lg bg-surface-raised-base/55 shadow-[0_0_0_1px_rgb(127_127_127/0.12)]">
                            <button
                              type="button"
                              role="tab"
                              aria-selected="false"
                              data-disk-tab={tab.id}
                              class="dl-touch-target flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pl-3 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak"
                              title={tab.sourcePath}
                              onClick={() => switchToTab(tab.id)}
                              onAuxClick={(event) => {
                                if (event.button === 1) {
                                  event.preventDefault()
                                  closeTab(tab.id)
                                }
                              }}
                            >
                              <span class="truncate text-12-semibold text-text-strong">{tab.label}</span>
                            </button>
                            <button
                              type="button"
                              class="dl-hover-quiet-button dl-touch-target mr-1 grid size-8 shrink-0 place-items-center rounded-full text-text-weaker opacity-55 outline-none transition-[color,opacity,background-color] duration-150 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-text-weak active:bg-background-base"
                              aria-label={language.t("disk.pinned.remove", { name: tab.label })}
                              onClick={() => closeTab(tab.id)}
                            >
                              <Icon name="close-small" class="size-3" />
                            </button>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                  <div class="dl-workspace-frame mx-2 mb-2 mt-2 flex min-h-0 flex-1 overflow-hidden rounded-[16px]">
                    <Show when={scanMode() !== "list"}>
                      <section
                        ref={(el: HTMLElement) => setLandscapeEl(el)}
                        class="dl-landscape relative grid min-w-0 flex-1 place-items-center overflow-hidden"
                      >
                        {/* The map canvas persists across map⇄grid so ViewMorph can fly
                            wedges into tile poses on one surface; CenterOverlay yields
                            while a morph owns the view. */}
                        <div
                          class="relative aspect-square h-[min(100%,1100px)] max-h-[1100px] max-w-[100%]"
                          style={{
                            // Yield to the DOM tiles once grid has fully landed;
                            // stay visible while a morph is flying.
                            visibility: scanMode() === "grid" && !morphing() ? "hidden" : "visible",
                          }}
                        >
                            <canvas
                              ref={(el: HTMLCanvasElement) => setCanvasEl(el)}
                              class="absolute inset-0 size-full rounded-full outline-none [touch-action:none] focus-visible:ring-2 focus-visible:ring-text-weak"
                              tabIndex={0}
                              role="region"
                              aria-roledescription={language.t("disk.map.role")}
                              aria-describedby="disklizard-orbit-help"
                              aria-controls="disklizard-storage-list"
                              aria-label={language.t("disk.map.label", { label: scanLabel() })}
                              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End PageUp PageDown Enter Space C Escape"
                              onPointerDown={beginMapDrag}
                              onPointerMove={moveMapDrag}
                              onPointerUp={(event) => finishMapDrag(event)}
                              onPointerCancel={(event) => finishMapDrag(event, true)}
                            />
                            <span id="disklizard-orbit-help" class="sr-only">
                              {language.t("disk.map.instructions")}
                            </span>
                            <Show when={!morphing()}>
                              <CenterOverlay
                                node={focusNode()}
                                parentSize={parentSize()}
                                canOpen={
                                  !!focusNode() &&
                                  focusNode()!.isDir &&
                                  !isVisualAggregate(focusNode()) &&
                                  !isDeveloperInventoryNode(focusNode()!)
                                }
                                inventoryOnly={!!focusNode() && isDeveloperInventoryNode(focusNode()!)}
                                onOpen={() => {
                                  const node = focusNode()
                                  if (node?.isDir && !isVisualAggregate(node) && !isDeveloperInventoryNode(node))
                                    drill(node, true, true)
                                }}
                              />
                            </Show>
                        </div>
                        {/* Treemap overlay: mounted in both map and grid, but only
                            visible/interactive once the morph has landed (or motion is
                            reduced and the swap was instant). */}
                        <Show when={gridVisible()}>
                          <div
                            class="dl-treemap-overlay absolute inset-0 px-5 pb-5 pt-5 transition-opacity duration-150 lg:px-8 lg:pb-8 lg:pt-8"
                            classList={{ "pointer-events-none opacity-0": !gridInteractive() }}
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
                            label={language.t("disk.common.map")}
                            shortcut="1"
                          />
                          <SegmentedButton
                            active={scanMode() === "grid"}
                            onClick={() => chooseScanMode("grid")}
                            icon="file-tree"
                            label={language.t("disk.common.tiles")}
                            shortcut="2"
                          />
                          <SegmentedButton
                            active={scanMode() === "list"}
                            onClick={() => chooseScanMode("list")}
                            icon="bullet-list"
                            label={language.t("disk.common.list")}
                            shortcut="3"
                          />
                          <details
                            ref={shortcutsDetails}
                            class="relative"
                            open={shortcutsOpen()}
                            onToggle={(event) => setShortcutsOpen(event.currentTarget.open)}
                          >
                            <summary
                              class="dl-touch-target grid size-11 cursor-pointer list-none place-items-center rounded-full text-12-semibold text-text-weak outline-none transition-colors focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden"
                              aria-label={language.t("disk.shortcuts.show")}
                            >
                              ?
                            </summary>
                            <div class="absolute right-0 top-[calc(100%+10px)] z-20 w-64 rounded-xl bg-background-base p-3 text-12-regular leading-relaxed text-text-weak shadow-[0_0_0_1px_rgb(127_127_127/0.14),0_12px_30px_rgb(0_0_0/0.16)]">
                              <p class="text-12-semibold text-text-strong">{language.t("disk.shortcuts.heading")}</p>
                              <p class="mt-2">{language.t("disk.shortcuts.navigation")}</p>
                              <p class="mt-2">{language.t("disk.shortcuts.history")}</p>
                              <p class="mt-1">
                                {platform.os === "macos"
                                  ? language.t("disk.shortcuts.openMac")
                                  : language.t("disk.shortcuts.open")}
                              </p>
                              <p class="mt-1">
                                {language.t("disk.shortcuts.views", {
                                  modifier: platform.os === "macos" ? "⌘" : "Ctrl",
                                })}
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
                      <div class="shrink-0 border-b border-border-weaker-base px-6 pb-4 pt-5">
                        <div class="flex items-start justify-between gap-4">
                          <div class="min-w-0 flex-1">
                            <p class="text-12-semibold uppercase tracking-[0.14em] text-text-weaker">
                              {query().trim()
                                ? language.t(
                                    indexFilter.lens === "changes" ? "disk.history.results" : "disk.search.results",
                                  )
                                : indexFilter.lens === "developer"
                                  ? indexFilter.developerCategory === "all"
                                    ? language.t("disk.explore.developerFiles")
                                    : language.t(DEVELOPER_CATEGORY_LABEL[indexFilter.developerCategory])
                                  : indexFilter.lens === "recommendations"
                                    ? language.t("disk.explore.recommendationsScan")
                                    : indexFilter.lens === "changes"
                                      ? language.t("disk.history.heading")
                                      : recentLens()
                                        ? language.t("disk.changed.today")
                                        : language.t("disk.explore.folderContents")}
                            </p>
                            <div class="mt-2 flex min-w-0 items-baseline justify-between gap-4">
                              <h2 class="min-w-0 truncate text-18-medium tracking-[-0.035em] text-text-strong">
                                {viewNode() ? diskNodeDisplayName(viewNode()!) : scanLabel()}
                              </h2>
                              <Show when={!query().trim() && indexFilter.lens !== "changes"}>
                                <span class="shrink-0 text-[24px] font-medium leading-none tracking-[-0.03em] tabular-nums text-text-strong">
                                  {formatBytes(indexSize())}
                                </span>
                              </Show>
                            </div>
                            <p class="mt-1.5 text-12-regular tabular-nums text-text-weak">
                              {indexFilter.lens === "changes" ? (
                                <>
                                  {language.t("disk.history.changeSummary", {
                                    changes: language.plural("disk.count.change", indexCount()),
                                    summary: language.t("disk.history.summary"),
                                  })}
                                </>
                              ) : (
                                <>
                                  {language.t("disk.explore.summary", {
                                    count: language.plural("disk.count.item", indexCount()),
                                    basis: sizeBasisLabel(),
                                  })}
                                </>
                              )}
                            </p>
                          </div>
                          <Show when={scanMode() === "list"}>
                            <div class="flex items-center gap-0.5 rounded-full bg-background-base/70 p-1 shadow-[0_0_0_1px_rgb(127_127_127/0.12)]">
                              <SegmentedButton
                                active={scanMode() === "map"}
                                onClick={() => chooseScanMode("map")}
                                icon="dot-grid"
                                label={language.t("disk.common.map")}
                              />
                              <SegmentedButton
                                active={scanMode() === "grid"}
                                onClick={() => chooseScanMode("grid")}
                                icon="file-tree"
                                label={language.t("disk.common.tiles")}
                              />
                              <SegmentedButton active icon="bullet-list" label={language.t("disk.common.list")} />
                            </div>
                          </Show>
                        </div>
                        <details class="group mt-4" open={indexFilter.lens !== "all" || recentLens()}>
                          <summary class="dl-touch-target flex min-h-11 cursor-pointer list-none items-center gap-2 border-b border-border-weaker-base px-1 text-12-semibold text-text-weak outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden">
                            <Icon name="sliders" class="size-3.5" />
                            <span class="flex-1">{language.t("disk.explore.heading")}</span>
                            <span class="text-12-regular text-text-weaker">
                              {recentLens()
                                ? language.t("disk.changed.today")
                                : indexFilter.lens === "all"
                                  ? language.t("disk.explore.folderContents")
                                  : indexFilter.lens === "developer"
                                    ? language.t("disk.explore.developerFiles")
                                    : indexFilter.lens === "changes"
                                      ? language.t("disk.history.summary")
                                      : language.t("disk.common.recommendations")}
                            </span>
                            <Icon
                              name="chevron-down"
                              class="size-3 transition-transform duration-150 group-open:rotate-180"
                            />
                          </summary>
                          <div
                            role="group"
                            aria-label={language.t("disk.explore.choose")}
                            class="mt-2 grid grid-cols-2 sm:grid-cols-4"
                          >
                            <IndexLensButton
                              active={indexFilter.lens === "all"}
                              icon="bullet-list"
                              label={language.t("disk.common.all")}
                              onClick={() => chooseLens("all")}
                            />
                            <IndexLensButton
                              active={indexFilter.lens === "developer"}
                              icon="code-lines"
                              label={language.t("disk.common.developer")}
                              onClick={() => chooseLens("developer")}
                            />
                            <IndexLensButton
                              active={indexFilter.lens === "recommendations"}
                              icon="shield"
                              label={language.t("disk.common.recommendations")}
                              disabled={physicalCloneAccountingUncertain()}
                              title={
                                physicalCloneAccountingUncertain() ? language.t("disk.explore.reclaimWait") : undefined
                              }
                              onClick={() => chooseLens("recommendations")}
                            />
                            <IndexLensButton
                              active={indexFilter.lens === "changes"}
                              icon="arrow-undo-down"
                              label={language.t("disk.history.lens")}
                              onClick={() => chooseLens("changes")}
                            />
                            <IndexLensButton
                              active={recentLens()}
                              icon="reset"
                              label={language.t("disk.changed.today")}
                              disabled={recentChanges().length === 0}
                              onClick={() => chooseLens("recent")}
                            />
                          </div>
                        </details>
                        <Show when={indexFilter.lens === "recommendations" && reclaim().totalBytes > 0}>
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
                              aria-label={language.t("disk.explore.developerCategories")}
                            >
                              <DeveloperCategoryButton
                                active={indexFilter.developerCategory === "all"}
                                label={language.t("disk.explore.allDeveloper")}
                                bytes={developer().totalBytes}
                                onClick={() => chooseDeveloperCategory("all")}
                              />
                              <For each={developer().buckets}>
                                {(bucket) => (
                                  <DeveloperCategoryButton
                                    active={indexFilter.developerCategory === bucket.category}
                                    label={language.t(DEVELOPER_CATEGORY_LABEL[bucket.category])}
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
                              aria-label={language.t("disk.explore.physicalLabel")}
                            >
                              <Icon name="shield" class="mt-0.5 size-3.5 shrink-0 text-icon-warning-base" />
                              <div>
                                <p class="text-12-semibold text-text-strong">
                                  {language.t("disk.explore.physicalPaused")}
                                </p>
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
                                  {language.t("disk.explore.unreadable", {
                                    count: formatCount(issues().unreadableCount),
                                    locations: language.plural("disk.count.locationNoun", issues().unreadableCount),
                                  })}
                                </span>
                                <span class="text-12-regular text-text-weak">
                                  {language.t("disk.explore.totalsLow")}
                                </span>
                                <Icon
                                  name="chevron-down"
                                  class="size-3 shrink-0 text-icon-weak transition-transform duration-150 group-open:rotate-180"
                                />
                              </summary>
                              <div class="border-t border-border-warning-base/40 px-3 pb-3 pt-2.5">
                                <p class="text-12-regular leading-relaxed text-text-weak">
                                  {language.t(scanAccessGuidance(platform.os))}{" "}
                                  {language.t("disk.accessGuidance.rescan")}
                                </p>
                                <Show when={storageDiagnostics()?.access.status === "limited"}>
                                  <Button
                                    class="dl-touch-target mt-2"
                                    size="small"
                                    variant="secondary"
                                    icon="square-arrow-top-right"
                                    onClick={() => void openDiskAccessSettings()}
                                  >
                                    {language.t("disk.explore.openPrivacy")}
                                  </Button>
                                </Show>
                                <ul class="mt-2 space-y-1" aria-label={language.t("disk.explore.unreadableList")}>
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
                                    {language.t("disk.explore.showingUnreadable", {
                                      count: formatCount(issues().unreadableCount),
                                    })}
                                  </p>
                                </Show>
                              </div>
                            </details>
                          )}
                        </Show>
                        <div class="dl-touch-target mt-3 flex h-11 items-center gap-2 rounded-[10px] bg-surface-raised-base/55 px-3 shadow-[inset_0_0_0_1px_rgb(127_127_127/0.14)] transition-shadow duration-150 focus-within:shadow-[inset_0_0_0_1px_rgb(127_127_127/0.34),0_0_0_3px_rgb(127_127_127/0.08)]">
                          <Icon name="magnifying-glass" class="size-3.5 shrink-0 text-icon-weak" />
                          <label class="sr-only" for="disklizard-scan-search">
                            {language.t(indexFilter.lens === "changes" ? "disk.history.search" : "disk.search.label")}
                          </label>
                          <input
                            id="disklizard-scan-search"
                            type="search"
                            autocomplete="off"
                            spellcheck={false}
                            placeholder={language.t(
                              indexFilter.lens === "changes" ? "disk.history.search" : "disk.search.placeholder",
                            )}
                            value={query()}
                            onInput={(e) => updateQuery(e.currentTarget.value)}
                            class="dl-search-input min-w-0 flex-1 bg-transparent text-12-regular text-text-strong placeholder:text-text-weaker outline-none"
                          />
                          <Show when={query()}>
                            <button
                              type="button"
                              class="dl-hover-button dl-touch-target grid size-10 place-items-center rounded-full text-text-weak outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
                              onClick={() => updateQuery("")}
                              aria-label={language.t("disk.search.clear")}
                            >
                              <Icon name="close-small" class="size-3" />
                            </button>
                          </Show>
                        </div>
                        <Show when={indexFilter.lens !== "changes"}>
                          <div
                            class="mt-2 flex min-h-11 items-center gap-2"
                            role="group"
                            aria-label={language.t("disk.sort.group")}
                          >
                            <span class="shrink-0 text-12-semibold text-text-weaker">
                              {language.t("disk.sort.label")}
                            </span>
                            <label class="min-w-0 flex-1">
                              <span class="sr-only">{language.t("disk.sort.key.label")}</span>
                              <select
                                class="dl-sort-select dl-touch-target h-11 w-full rounded-[10px] bg-surface-raised-base/55 px-3 text-12-semibold text-text-strong shadow-[inset_0_0_0_1px_rgb(127_127_127/0.14)] outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
                                value={indexFilter.sortKey}
                                onChange={(event) =>
                                  updateSort(diskEntrySortKey(event.currentTarget.value), indexFilter.sortDirection)
                                }
                              >
                                <option value="size">{language.t("disk.sort.key.size")}</option>
                                <option value="name">{language.t("disk.sort.key.name")}</option>
                                <option value="modified">{language.t("disk.sort.key.modified")}</option>
                                <option value="type">{language.t("disk.sort.key.type")}</option>
                              </select>
                            </label>
                            <label class="w-[136px] shrink-0">
                              <span class="sr-only">{language.t("disk.sort.direction.label")}</span>
                              <select
                                class="dl-sort-select dl-touch-target h-11 w-full rounded-[10px] bg-surface-raised-base/55 px-3 text-12-semibold text-text-strong shadow-[inset_0_0_0_1px_rgb(127_127_127/0.14)] outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
                                value={indexFilter.sortDirection}
                                onChange={(event) =>
                                  updateSort(indexFilter.sortKey, diskEntrySortDirection(event.currentTarget.value))
                                }
                              >
                                <option value="descending">{language.t("disk.sort.direction.descending")}</option>
                                <option value="ascending">{language.t("disk.sort.direction.ascending")}</option>
                              </select>
                            </label>
                          </div>
                        </Show>
                      </div>

                      <Show
                        when={indexFilter.lens === "changes" || entries().length > 0}
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
                        {indexFilter.lens === "changes" ? (
                          <DiskScanHistory
                            entries={currentHistoryEntries()}
                            filtered={!!query().trim()}
                            onClear={clearCurrentHistory}
                          />
                        ) : (
                          <VirtualIndex
                            entries={entries()}
                            bindScrollToIndex={(fn) => (scrollIndexIntoView = fn)}
                            bindPageSize={(fn) => (listPageSize = fn ?? (() => DEFAULT_LIST_PAGE_SIZE))}
                            onMoveFocus={moveFocus}
                            onPageFocus={moveFocusByPage}
                            onMoveFocusToBoundary={moveFocusToBoundary}
                            render={(entry, i) => {
                              const rec = () => investigation().recognitionFor(entry.node)
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
                                    class="flex h-full min-h-11 min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color-mix(in_oklch,var(--dl-accent)_60%,transparent)]"
                                    onClick={(event) => {
                                      if (event.metaKey || event.ctrlKey) {
                                        void reveal(entry.node.path)
                                        return
                                      }
                                      selectEntry(entry.node, i(), event.shiftKey)
                                    }}
                                    onDblClick={() => {
                                      if (entry.node.isDir) drill(entry.node)
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
                                      style={{ background: primarySegmentColor(entry.colorIndex, 1, entry.node.isDir) }}
                                      aria-hidden="true"
                                    />
                                    <span class="min-w-0 flex-1">
                                      <span class="flex min-w-0 items-center gap-1.5">
                                        <span class="truncate text-13-semibold text-text-strong">
                                          {diskNodeDisplayName(entry.node)}
                                        </span>
                                        <Show when={indexFilter.lens !== "all" && rec().tag}>
                                          <span
                                            class={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-12-semibold uppercase tracking-[0.08em] ring-1 ring-inset lg:inline ${SAFETY_ACCENT[rec().safety].pill}`}
                                          >
                                            {language.t(rec().tag!)}
                                          </span>
                                        </Show>
                                      </span>
                                      <Show
                                        when={indexFilter.lens !== "all"}
                                        fallback={
                                          <span class="mt-1 block h-[3px] min-w-0 overflow-hidden rounded-full bg-surface-raised-base">
                                            <span
                                              class="block h-full rounded-full"
                                              style={{
                                                width: `${Math.max(1, Math.min(100, pct()))}%`,
                                                background: primarySegmentColor(entry.colorIndex, 1, entry.node.isDir),
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
                                                ? `${developerContext().scope} · ${developerContext().disposition}\n${rec().hint ? language.t(rec().hint!) : language.t("disk.explore.inspectHint")}\n${entry.node.path}`
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
                                                {language.t("disk.explore.nestedCategories", {
                                                  size: shortBytes(entry.node.size),
                                                })}
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
                                                classList={{
                                                  "dl-accent-text":
                                                    indexFilter.lens === "developer" && isDormant(changedAt()),
                                                }}
                                                title={language.t("disk.explore.lastChanged", {
                                                  date: new Date(changedAt()).toLocaleString(),
                                                })}
                                              >
                                                {formatLastChanged(changedAt())}
                                              </span>
                                            )}
                                          </Show>
                                        </span>
                                      </Show>
                                    </span>
                                    <span class="w-[4.75rem] shrink-0 text-right text-12-semibold tabular-nums text-text-strong">
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
                                          ? language.t("disk.explore.removeReview", { name: entry.node.name })
                                          : language.t("disk.explore.selectReview", { name: entry.node.name })
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
                        )}
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
                                <p class="text-12-semibold text-text-strong">
                                  {language.t("disk.explore.selectTitle")}
                                </p>
                                <p class="mt-0.5 truncate text-12-regular text-text-weak">
                                  {language.t("disk.explore.selectBody")}
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
                              locked={isPathCleanupLocked(node().path, cleanupLocks(), platform.os)}
                              lockLabel={cleanupLockForPath(node().path, cleanupLocks(), platform.os)?.label}
                              trashName={nativeTrashName(platform.os)}
                              onPreview={node().isOther || node().isHidden ? undefined : () => void openPreview(node())}
                              onQuickLook={
                                supportsQuickLook() && !node().isOther && !node().isHidden
                                  ? () => void openSystemPreview(node())
                                  : undefined
                              }
                              onReveal={() => void reveal(node().path)}
                              onOpen={isDeveloperInventoryNode(node()) ? undefined : () => drill(node())}
                              onCollect={() => toggleCollect(node())}
                              onTrash={() => requestDelete(node())}
                              onToggleLock={
                                node().isOther || node().isHidden
                                  ? undefined
                                  : () => toggleProtectedTree(node().path, node().name)
                              }
                            />
                          )}
                        </Show>
                      </div>
                      <div
                        class="dl-cleanup-slot shrink-0"
                        classList={{
                          "w-[min(360px,30vw)]": effectiveCollection().length > 0 || !!collectionDragNode(),
                          "w-[260px]": effectiveCollection().length === 0 && !collectionDragNode(),
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
            systemPreviewLabel={platform.os === "macos" ? language.t("disk.common.quickLook") : undefined}
            onSystemPreview={platform.os === "macos" ? () => void openSystemPreview(node()) : undefined}
            onOpen={() => void openInDefaultApp(node())}
          />
        )}
      </Show>

      {/* ── Reclaim review drawer ── */}
      <Show when={reviewSurface.mounted()}>
        <ReclaimDrawer
          phase={reviewSurface.phase()}
          reclaim={reclaim}
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
