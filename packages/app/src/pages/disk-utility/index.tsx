import { VolumeCapacitySummary } from "./VolumeCapacitySummary"
import { ScanCoverageDisclosure } from "./ScanCoverageDisclosure"
import {
  showCollectionDragPreview,
  moveCollectionDragPreview,
  hideCollectionDragPreview,
} from "./collection-drag-preview"
import { createBranchIdentity, createTileIdentity } from "./tile-identity"
import { storageMapColor } from "./visual-palette"
import { LocationNavigation } from "./LocationNavigation"
import { flushSync } from "react-dom"
import { ParentFrame } from "./ParentFrame"
import { planOtherExpansion } from "./other-expansion"
import { createGroupNavigation } from "./group-navigation"
import {
  DeveloperCategories,
  DeveloperDisclosure,
  DeveloperEntryContent,
} from "./DeveloperPresentation"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ChartPie, LayoutGrid, Layers } from "lucide-react"
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

import { DiskUtilitySearchTools } from "./DiskUtilitySearchTools"
import { DiskUtilityWorkspaceMenu } from "./DiskUtilityWorkspaceMenu"
import { DiskUtilityHoverContents } from "./DiskUtilityHoverContents"
import { useHoverPreview } from "./use-hover-preview"
import { Button } from "@/components/dl/button"
import { DropdownMenu } from "@/components/dl/dropdown-menu"
import { Icon } from "@/components/dl/icon"
import { ScrollView } from "@/components/dl/scroll-view"
import { showToast } from "@/components/dl/toast"
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react"
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
  DiskScanProgress,
  DiskScanNode,
  DiskScanUpdate,
  DiskStorageDiagnostics,
  DiskStorageLocation,
  DiskUtilityAPI,
  DiskPathAccess,
} from "./types"
import {
  Sunburst,
  primaryHueForIndex,
  primarySegmentColor,
  sunburstEntryDuration,
  type SunburstEntryIntent,
} from "./sunburst"
import { Treemap } from "./TreemapPanel"
import { ViewMorph, type MorphTile } from "./ViewMorph"
import { ScanFormation } from "./ScanFormation"
import { CollectionDropTarget } from "./CollectionDropTarget"
import { withoutCollected } from "./collection-map"
import { PreviewDialog } from "./PreviewDialog"
import {
  CleanupResultsDialog,
  type CleanupOutcome,
} from "./CleanupResultsDialog"
import { useSurfacePresence } from "./motion"
import { PopIn, Pulse } from "./motion-ui"
import { isScanCancellation } from "./scan-progress"
import {
  clampedListIndex,
  pagedListIndex,
  wrappedListIndex,
} from "./list-navigation"
import {
  ARTIFACT_ECOSYSTEMS,
  containsSharedPhysicalStorage,
  developerArtifactCleanupReadiness,
  developerArtifactContext,
  isSmartCleanupEligible,
  matchesArtifactEcosystem,
  artifactEcosystemLabel,
  type ArtifactEcosystem,
  type ArtifactEcosystemFilter,
  type DeveloperCategory,
  type ReclaimSummary,
} from "./recognize"
import {
  developerInventoryCollectionNodeForPath,
  developerInventoryDeletePrecondition,
  developerInventoryRootsNeedRefresh,
  isDeveloperInventoryNode,
} from "./developer-inventory"
import {
  formatBytes,
  formatLastChanged,
  shortBytes,
  formatCount,
  truncatePath,
} from "./format"
import {
  filterDeveloperItemsByAge,
  resolveDeveloperCleanupAge,
  type DeveloperCleanupAgePreset,
} from "./developer-cleanup"
import { SAFETY_ACCENT } from "./ui-tokens"
import {
  CenterOverlay,
  IndexEmpty,
  Placeholder,
} from "./DiskUtilityEmptyStates"
import { SegmentedButton } from "./DiskUtilityControls"
import { DeveloperCleanupPolicy } from "./DeveloperCleanupPolicy"
import { ReclaimBanner, type VolumeScanJob } from "./DiskUtilityDriveSurfaces"
import { DriveOverview } from "./DiskUtilityDriveOverview"
import { IciclePanel } from "./IciclePanel"
import { DetailBar } from "./DiskUtilityDetailBar"
import {
  CleanupProtectionsResetDialog,
  CollectionDialog,
  DeleteConfirmDialog,
  ReclaimDrawer,
  type DeletionProgress,
} from "./DiskUtilityDialogs"
import { VirtualIndex } from "./DiskUtilityVirtualList"
import { DiskScanHistory } from "./DiskScanHistory"
import {
  createScanHistory,
  filterScanHistoryEntries,
  type ScanHistoryEntry,
} from "./scan-history"
import { clearReviewForRootScan } from "./scan-lifecycle"
import {
  closeScanTab,
  limitRetainedScanTabs,
  refreshScanTabsForWatcherUpdate,
  restoreScanTab,
  saveCurrentScanTab,
  type CurrentScanTabState,
  type RestoreScanTabResult,
  type ScanTab,
} from "./scan-tabs"
import { recentChangeNodes } from "./recent-changes"
import { DISK_UTILITY_STYLES } from "./styles"
import {
  chooseFolderAndScan,
  DISK_CHOOSE_FOLDER_COMMAND,
} from "./choose-folder"
import {
  diskEntrySearchText,
  groupSmallEntryTail,
  type DiskEntrySortDirection,
  type DiskEntrySortKey,
} from "./entry-view"
import {
  createScanInvestigation,
  type ScanInvestigationEntry,
  type ScanInvestigationLens,
} from "./scan-investigation"
import { DISK_RECOGNITION_LANGUAGE_KEYS } from "./recognition-language"
import {
  EMPTY_DISK_BROWSE_HISTORY,
  transitionDiskBrowseHistory,
} from "./browse-history"
import { createDiskBrowseHistoryController } from "./browse-history-controller"
import { diskNodeDisplayName } from "./node-display"
import { distinguishingPathLabels, itemIdentity } from "./item-identity"
import { SearchHighlight } from "./SearchHighlight"
import {
  assertCleanupProtectionsReady,
  executeAuthorizedDeletionBatch,
  resolveDeleteAuthorization,
} from "./deletion-controller"
import {
  createDiskPreviewController,
  type DiskPreviewView,
} from "./preview-controller"
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
  diskPathIsWithin,
  driveForPath,
  includeHiddenSpace,
  hasUnverifiedPhysicalCloneAccounting,
  isPinnedScanLocation,
  mayContainUnobservedContents,
  replaceScanSubtree,
  removeScanSubtrees,
  togglePinnedScanLocation,
  uniqueDeletionRoots,
  withoutDeletedNodes,
} from "./storage"
import { cn } from "@/lib/utils"
import {
  buildCrumbs,
  describeStorageNode,
  nativeRevealLabel,
  nativeTrashName,
  scanAccessGuidance,
  shouldHandleDiskShortcut,
  type Crumb,
} from "./navigation"

type ViewMode = "drives" | "scan"
type ScanMode = "map" | "list" | "grid" | "icicle"
type IndexLens = ScanInvestigationLens
type DeveloperCategoryFilter = DeveloperCategory | "all"
type Entry = ScanInvestigationEntry
type CanvasPointerEvent = ReactPointerEvent<HTMLCanvasElement>
type IndexFilter = {
  lens: IndexLens
  developerCategory: DeveloperCategoryFilter
  developerEcosystem: ArtifactEcosystemFilter
  developerAge: DeveloperCleanupAgePreset
  customDeveloperAgeDays: string
  sortKey: DiskEntrySortKey
  sortDirection: DiskEntrySortDirection
}
type FocusedExpansionOptions = {
  group?: { node: DiskScanNode; excludedPaths: ReadonlySet<string> }
  label?: string
  maxChildren?: number
}
const MAX_PARALLEL_VOLUME_SCANS = 3
const DEFAULT_LIST_PAGE_SIZE = 10
/** Bounded trusted-rescan budget for expanding a scanner-collapsed subtree. */
const COLLAPSED_EXPANSION_MAX_CHILDREN = 48
const EMPTY_RECLAIM: ReclaimSummary = {
  totalBytes: 0,
  totalCount: 0,
  buckets: [],
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

const DEVELOPER_CATEGORY_LABEL = {
  dependencies: "disk.developer.category.dependencies",
  "build-output": "disk.developer.category.buildOutput",
  "toolchain-cache": "disk.developer.category.toolchainCache",
  "agent-data": "disk.developer.category.agentData",
  worktree: "disk.developer.category.worktree",
  "version-control": "disk.developer.category.versionControl",
} as const satisfies Record<DeveloperCategory, DiskLanguageKey>

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            diskLanguageText("disk.error.timeout", {
              operation: label,
              milliseconds: ms,
            })
          )
        ),
      ms
    )
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

export default function DiskUtilityPage() {
  const platform = usePlatform()
  const language = useLanguage()
  const settings = useSettings()
  const isDesktop = platform.platform === "desktop"
  const disk = isDesktop ? platform.diskUtility : undefined

  const [view, setView] = useState<ViewMode>("drives")
  const [scanMode, setScanMode] = useState<ScanMode>("map")
  const [cleanupMapCollapsed, setCleanupMapCollapsed] = useState(true)
  const [drives, setDrives] = useState<DiskDriveInfo[]>([])
  const [drivesLoading, setDrivesLoading] = useState(false)
  const [drivesError, setDrivesError] = useState<string | undefined>()
  const [storageDiagnostics, setStorageDiagnostics] = useState<
    DiskStorageDiagnostics | undefined
  >()
  const [storageDiagnosticsError, setStorageDiagnosticsError] = useState(false)
  const [scanDrive, setScanDrive] = useState<DiskDriveInfo | undefined>()

  const [treeRoot, setTreeRoot] = useState<DiskScanNode | null>(null)
  const [viewNode, setViewNode] = useState<DiskScanNode | null>(null)
  const [scanSourcePath, setScanSourcePath] = useState("")
  const [scanLabel, setScanLabel] = useState("")
  const [scanning, setScanning] = useState(false)
  const [scanFiles, setScanFiles] = useState(0)
  const [scanTotal, setScanTotal] = useState(0)
  const [scanPct, setScanPct] = useState(0)
  const [scanBytes, setScanBytes] = useState(0)
  const [scanTail, setScanTail] = useState("")
  const [scanCompletionSource, setScanCompletionSource] = useState<
    DiskScanProgress["source"] | undefined
  >()
  const [selectedPath, setSelectedPath] = useState<string | undefined>()
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<DiskScanNode | null>(null)
  const [mapHoverCandidate, setMapHoverCandidate] =
    useState<DiskScanNode | null>(null)
  const hoverPreview = useHoverPreview(mapHoverCandidate, viewNode?.path)
  const hoverPreviewNode = hoverPreview.node
  const [focusIdx, setFocusIdx] = useState(0)
  const [_rangeAnchorIndex, setRangeAnchorIndex] = useState<
    number | undefined
  >()
  const [pendingDelete, setPendingDelete] = useState<DiskScanNode | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deletionProgress, setDeletionProgress] =
    useState<DeletionProgress | null>(null)
  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [announcedSelection, setAnnouncedSelection] = useState("")
  const [indexFilter, setIndexFilter] = useState<IndexFilter>({
    lens: "all",
    developerCategory: "all",
    developerEcosystem: "all",
    developerAge: "all",
    customDeveloperAgeDays: "30",
    sortKey: "size",
    sortDirection: "descending",
  })
  const reviewSurface = useSurfacePresence()
  const collectionSurface = useSurfacePresence()
  const deleteSurface = useSurfacePresence()
  const cleanupResetSurface = useSurfacePresence()
  const [tabs, setTabs] = useState<ScanTab[]>([])
  const scanHistory = useMemo(() => createScanHistory({ os: platform.os }), [])
  const [historyEntries, setHistoryEntries] = useState<ScanHistoryEntry[]>(() =>
    scanHistory.entries()
  )
  const [volumeScanJobs, setVolumeScanJobs] = useState<
    Record<string, VolumeScanJob | undefined>
  >({})
  const [scanSession, setScanSession] = useState<{
    activeID?: string
    foregroundID?: string
  }>({})
  const [collection, setCollection] = useState<DiskScanNode[]>([])
  const [cleanupResults, setCleanupResults] = useState<CleanupOutcome[]>([])
  const [cleanupResultsOpen, setCleanupResultsOpen] = useState(false)
  const [cleanupPlanNeedsRecheck, setCleanupPlanNeedsRecheck] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [collectionDragNode, setCollectionDragNode] =
    useState<DiskScanNode | null>(null)
  const [collectionDropActive, setCollectionDropActive] = useState(false)
  const [focusedScan, setFocusedScan] = useState<{ label: string } | null>(null)
  // A foreground scan cancels only on a second Escape inside this window.
  const SCAN_CANCEL_ARM_MS = 2000
  const cancelArmedAtRef = useRef(0)
  // The shortcuts popover (<details>) tracks open state for Escape/outside-click dismissal.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const scanProgressRegionRef = useRef<HTMLDivElement | undefined>(undefined)
  const shortcutsDetailsRef = useRef<HTMLDetailsElement | null>(null)
  const landscapeElRef = useRef<HTMLElement | null>(null)
  const volumeJobs = useMemo(
    () =>
      Object.values(volumeScanJobs).filter(
        (job): job is VolumeScanJob => !!job
      ),
    [volumeScanJobs]
  )

  /** False while the canvas morph owns the view; the Treemap DOM mounts only when true. */
  const [gridInteractive, setGridInteractive] = useState(false)
  const [gridVisible, setGridVisible] = useState(false)
  const [morphing, setMorphing] = useState(false)
  const morphRef = useRef<ViewMorph | null>(null)
  const volumeScanUnsubsRef = useRef(new Map<string, () => void>())
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)
  const sunburstRef = useRef<Sunburst | undefined>(undefined)

  const scanUnsubRef = useRef<(() => void) | undefined>(undefined)

  /** The morph draws on the sunburst's own canvas; both live and die with it. */
  function ensureMorph(el: HTMLCanvasElement): ViewMorph {
    if (!morphRef.current || morphRef.current.canvas !== el) {
      const ctx = el.getContext("2d", { alpha: true })!
      morphRef.current = new ViewMorph(
        el,
        ctx,
        () => {
          const sb = sunburstRef.current
          return {
            cx: sb?.cx ?? el.width / 2,
            cy: sb?.cy ?? el.height / 2,
            maxR: sb?.maxR ?? 0,
          }
        },
        () => sunburstRef.current?.reducedMotion ?? false
      )
    }
    return morphRef.current
  }

  const scanUpdateUnsubRef = useRef<(() => void) | undefined>(undefined)
  const driveFactsUnsubRef = useRef<(() => void) | undefined>(undefined)
  const receivedDriveFactsRef = useRef<DiskDriveFactsUpdate[]>([])
  const scanTokenRef = useRef(0)
  const scanMaxBytesRef = useRef(0)
  const lastWatchErrorRef = useRef<string | undefined>(undefined)
  const orbitEntryIntentRef = useRef<SunburstEntryIntent>("scan-complete")
  const dragDepthRef = useRef(0)
  const selectionAnnouncementTimerRef = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined)
  const collectionDragPreviewRef = useRef<HTMLDivElement | null>(null)
  const collectionDropElementRef = useRef<HTMLElement | undefined>(undefined)
  const mapDragRef = useRef<
    | {
        node: DiskScanNode
        pointerId: number
        startX: number
        startY: number
        threshold: number
        dragging: boolean
      }
    | undefined
  >(undefined)
  const scrollIndexIntoViewRef = useRef<((index: number) => void) | undefined>(
    undefined
  )
  const listPageSizeRef = useRef<() => number>(() => DEFAULT_LIST_PAGE_SIZE)
  const nextPersistenceError = useMemo(
    () => createPersistenceErrorDeduper(),
    []
  )

  const pinnedLocations = settings.locations
  const cleanupLocks = settings.locks
  const cleanupLocksStatus = settings.cleanupLocksStatus
  const cleanupProtectionsReady = () => cleanupLocksStatus === "ready"
  const [pinMutationPending, setPinMutationPending] = useState(false)
  const [cleanupLockMutationPending, setCleanupLockMutationPending] =
    useState(false)

  function replaceIndexFilter(patch: Partial<IndexFilter>) {
    setIndexFilter((current) => ({ ...current, ...patch }))
  }

  /** Merge a patch into an existing volume-scan job; a missing job is left alone (v1 store semantics). */
  function patchVolumeJob(id: string, patch: Partial<VolumeScanJob>) {
    setVolumeScanJobs((jobs) =>
      jobs[id] ? { ...jobs, [id]: { ...jobs[id], ...patch } } : jobs
    )
  }

  function putVolumeJob(job: VolumeScanJob) {
    setVolumeScanJobs((jobs) => ({ ...jobs, [job.id]: job }))
  }

  function dropVolumeJob(id: string) {
    setVolumeScanJobs((jobs) => {
      if (!(id in jobs)) return jobs
      return { ...jobs, [id]: undefined }
    })
  }

  useEffect(() => {
    const error = nextPersistenceError(settings.persistenceError)
    if (!error) return
    showToast({
      variant: "error",
      title: language.t("disk.toast.persistenceFailed"),
      description: error,
    })
  }, [settings.persistenceError, language, nextPersistenceError])

  const closeCollection = collectionSurface.close
  const closeDelete = deleteSurface.close
  useEffect(() => {
    if (cleanupLocksStatus === "ready" || cleanupLocksStatus === "saving")
      return
    setCollectionDragNode(null)
    setCollectionDropActive(false)
    setPendingDelete(null)
    closeCollection()
    closeDelete()
  }, [cleanupLocksStatus, closeCollection, closeDelete])

  const groupNavigation = useMemo(() => createGroupNavigation(), [])
  const crumbs = useMemo(
    () => groupNavigation.crumbs(treeRoot, viewNode),
    [treeRoot, viewNode, groupNavigation]
  )
  const parentView = crumbs.at(-2)?.node
  const branchIdentity = useMemo(
    () => createBranchIdentity(treeRoot),
    [treeRoot]
  )
  const branchColor = (node: DiskScanNode) => {
    const identity = branchIdentity(node.path)
    return identity
      ? storageMapColor(identity.index, identity.depth, node.isDir)
      : undefined
  }
  const tileColor = useMemo(() => createTileIdentity(treeRoot), [treeRoot])
  /** A fallback or incomplete map must never turn unknown shared storage into a reclaim promise. */
  const physicalCloneAccountingUncertain = useMemo(
    () =>
      hasUnverifiedPhysicalCloneAccounting(treeRoot, platform.os, scanDrive),
    [treeRoot, scanDrive]
  )
  const physicalCloneAccountingWarning = useMemo(() => {
    const root = treeRoot
    const capability = root?.cloneMetadata
    const sharedStorageEvidence = root?.sharedStorageEvidence
    if (!physicalCloneAccountingUncertain) return undefined
    if (sharedStorageEvidence === "partial") {
      return language.t("disk.explore.unverifiedExcluded")
    }
    if (sharedStorageEvidence !== "complete") {
      return language.t("disk.explore.unverifiedRelationships")
    }
    if (
      capability?.state === "unavailable" &&
      capability.reason === "scanner"
    ) {
      return language.t("disk.explore.unverifiedScanner")
    }
    if (capability?.state === "unknown") {
      return language.t("disk.explore.unverifiedMetadata")
    }
    return language.t("disk.explore.unverifiedDefault")
  }, [physicalCloneAccountingUncertain, treeRoot, language])
  const investigation = useMemo(
    () =>
      createScanInvestigation(treeRoot, {
        recognitionText(recognition) {
          return recognition.tag ? language.t(recognition.tag) : ""
        },
        recognitionQueryMayMatch(normalizedQuery) {
          return DISK_RECOGNITION_LANGUAGE_KEYS.some((key) =>
            language.t(key).toLocaleLowerCase().includes(normalizedQuery)
          )
        },
      }),
    [treeRoot, language]
  )
  const reclaim = useMemo(
    (): ReclaimSummary =>
      physicalCloneAccountingUncertain
        ? EMPTY_RECLAIM
        : actionableReclaimSummary(
            investigation.recommendations(),
            platform.os,
            cleanupLocks
          ),
    [physicalCloneAccountingUncertain, investigation, cleanupLocks]
  )
  const developer = () => investigation.developer()
  const developerAge = useMemo(
    () =>
      resolveDeveloperCleanupAge(
        indexFilter.developerAge,
        indexFilter.customDeveloperAgeDays
      ),
    [indexFilter]
  )
  const developerItems = useMemo(() => {
    if (indexFilter.lens !== "developer") return []
    const category = indexFilter.developerCategory
    const ecosystem = indexFilter.developerEcosystem
    const categorized = developer().items.filter(
      ({ recognition }) =>
        (category === "all" || recognition.developer === category) &&
        matchesArtifactEcosystem(recognition, ecosystem)
    )
    return filterDeveloperItemsByAge(categorized, developerAge)
  }, [indexFilter, investigation, developerAge])
  const developerCategoryTotals = useMemo(() => {
    if (indexFilter.lens !== "developer") return []
    const ageFiltered = filterDeveloperItemsByAge(
      developer().items.filter(({ recognition }) =>
        matchesArtifactEcosystem(recognition, indexFilter.developerEcosystem)
      ),
      developerAge
    )
    const needle = query.trim().toLocaleLowerCase()
    const filtered = needle
      ? ageFiltered.filter(({ node, recognition }) =>
          diskEntrySearchText(
            node,
            recognition.tag ? language.t(recognition.tag) : ""
          ).includes(needle)
        )
      : ageFiltered
    return developer().buckets.map((bucket) => ({
      category: bucket.category,
      bytes: filtered
        .filter((item) => item.recognition.developer === bucket.category)
        .reduce((sum, item) => sum + item.bytes, 0),
    }))
  }, [indexFilter, investigation, developerAge, query, language])
  const developerEcosystems = useMemo<ArtifactEcosystem[]>(
    () =>
      indexFilter.lens === "developer"
        ? ARTIFACT_ECOSYSTEMS.filter((ecosystem) =>
            developer().items.some(
              (item) => item.recognition.ecosystem === ecosystem
            )
          )
        : [],
    [indexFilter, investigation]
  )
  const parentSize = viewNode?.size ?? 0
  const parentCount = viewNode?.children?.length ?? 0
  const sortedChildren = useMemo(
    () =>
      [...(viewNode?.children ?? [])].sort(
        (left, right) => right.size - left.size
      ),
    [viewNode]
  )
  const currentHistoryEntries = useMemo(
    () => filterScanHistoryEntries(historyEntries, scanSession.activeID, query),
    [historyEntries, scanSession, query]
  )
  const historyChangeCount = useMemo(
    () =>
      currentHistoryEntries.reduce(
        (total, entry) => total + entry.changes.length,
        0
      ),
    [currentHistoryEntries]
  )
  const recentChanges = useMemo(() => recentChangeNodes(treeRoot), [treeRoot])
  /**
   * The Recent lens is a page-level overlay on the "all" view: the typed
   * investigation lenses stay closed, so no scan-wide summary is rebuilt.
   */
  const [recentLens, setRecentLens] = useState(false)
  const [groupDeveloper, setGroupDeveloper] = useState<
    "none" | "category" | "project"
  >("none")

  /**
   * Derive the visible entry list. Overrides let callers that just changed a
   * filter/view synchronously (Solid recomputed lazily on read) resolve the
   * NEXT list within the same tick.
   */
  function deriveEntries(
    overrides: Partial<{
      viewNode: DiskScanNode | null
      query: string
      lens: IndexLens
      sortKey: DiskEntrySortKey
      sortDirection: DiskEntrySortDirection
    }> = {}
  ) {
    const view =
      overrides.viewNode !== undefined ? overrides.viewNode : viewNode
    const queryText = overrides.query !== undefined ? overrides.query : query
    const lens =
      overrides.lens !== undefined ? overrides.lens : indexFilter.lens
    const sortKey =
      overrides.sortKey !== undefined ? overrides.sortKey : indexFilter.sortKey
    const sortDirection =
      overrides.sortDirection !== undefined
        ? overrides.sortDirection
        : indexFilter.sortDirection
    const investigationEntries = investigation.entries({
      viewNode: view,
      query: queryText,
      lens,
      sortKey,
      sortDirection,
      developerCandidates: () =>
        developerItems.map(({ node, bytes }) => ({ node, displaySize: bytes })),
      recommendationCandidates: () =>
        reclaim.buckets
          .flatMap((bucket) => bucket.items.map(({ node }) => node))
          .map((node) => ({ node, displaySize: node.size })),
    })
    const groupKey = (node: DiskScanNode) =>
      groupDeveloper === "category"
        ? (investigation.recognitionFor(node).developer ?? "")
        : node.path.replaceAll("\\", "/").split("/").slice(0, -1).join("/")
    const groupOrder = new Map<string, number>()
    if (lens === "developer" && groupDeveloper !== "none") {
      for (const entry of investigationEntries) {
        const group = groupKey(entry.node)
        if (!groupOrder.has(group)) groupOrder.set(group, groupOrder.size)
      }
    }
    const groupedEntries =
      groupOrder.size > 0
        ? [...investigationEntries].sort(
            (left, right) =>
              (groupOrder.get(groupKey(left.node)) ?? 0) -
              (groupOrder.get(groupKey(right.node)) ?? 0)
          )
        : investigationEntries
    if (!recentLens) return groupedEntries
    // The Recent lens is a page-level overlay: the typed investigation lenses
    // stay untouched while it lists recently modified items for this root.
    const matches = new Set(recentChanges)
    return groupedEntries.filter((entry) => matches.has(entry.node))
  }

  const entries = useMemo(() => {
    const raw = deriveEntries()
    return viewNode &&
      !viewNode.isOther &&
      indexFilter.lens === "all" &&
      !query.trim() &&
      !recentLens &&
      indexFilter.sortKey === "size" &&
      indexFilter.sortDirection === "descending"
      ? groupSmallEntryTail(raw, viewNode.path, viewNode.size)
      : raw
  }, [
    investigation,
    viewNode,
    query,
    indexFilter,
    recentLens,
    developerItems,
    reclaim,
    recentChanges,
    groupDeveloper,
  ])
  const duplicateEntryNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const { node } of entries) {
      const name = diskNodeDisplayName(node).toLocaleLowerCase()
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return new Set(
      [...counts].filter(([, count]) => count > 1).map(([name]) => name)
    )
  }, [entries])
  const entryRowHeight = useCallback(
    (entry: { node: DiskScanNode }) =>
      indexFilter.lens === "developer"
        ? query.trim()
          ? 88
          : 62
        : indexFilter.lens !== "all" ||
            query.trim() ||
            duplicateEntryNames.has(
              diskNodeDisplayName(entry.node).toLocaleLowerCase()
            )
          ? 44
          : 30,
    [indexFilter.lens, query, investigation, duplicateEntryNames]
  )
  const developerLocationLabels = useMemo(
    () => distinguishingPathLabels(entries.map(({ node }) => node.path)),
    [entries]
  )
  const developerGroupLabels = useMemo(() => {
    const labels = new Map<string, string>()
    if (groupDeveloper === "none" || indexFilter.lens !== "developer")
      return labels
    const projectLabels = distinguishingPathLabels(
      entries.map(({ node }) =>
        node.path.replaceAll("\\", "/").split("/").slice(0, -1).join("/")
      )
    )
    const groupFor = (node: DiskScanNode) =>
      groupDeveloper === "category"
        ? investigation.recognitionFor(node).developer
        : node.path.replaceAll("\\", "/").split("/").slice(0, -1).join("/")
    const groupCounts = new Map<string, number>()
    for (const entry of entries) {
      const group = groupFor(entry.node)
      if (group) groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1)
    }
    let previous: string | undefined
    for (const entry of entries) {
      const category = investigation.recognitionFor(entry.node).developer
      const project = entry.node.path
        .replaceAll("\\", "/")
        .split("/")
        .slice(0, -1)
        .join("/")
      const group = groupFor(entry.node)
      if (group && group !== previous && (groupCounts.get(group) ?? 0) > 1)
        labels.set(
          entry.node.path,
          groupDeveloper === "category" && category
            ? language.t(DEVELOPER_CATEGORY_LABEL[category])
            : (projectLabels.get(project) ?? project)
        )
      previous = group
    }
    return labels
  }, [entries, groupDeveloper, indexFilter.lens, investigation, language])
  const developerGroupLabel = useCallback(
    (entry: { node: DiskScanNode }) =>
      developerGroupLabels.get(entry.node.path),
    [developerGroupLabels]
  )
  const selectedNode = useMemo(() => {
    const path = selectedPath
    if (!path) return null
    const visible = entries.find(({ node }) =>
      diskPathEquals(node.path, path, platform.os)
    )?.node
    if (visible) return visible
    if (!treeRoot) return null
    return (
      groupNavigation.resolve(treeRoot, path) ??
      findScanNode(treeRoot, path) ??
      developerInventoryCollectionNodeForPath(treeRoot, path, platform.os) ??
      null
    )
  }, [entries, selectedPath, treeRoot, groupNavigation, platform.os])
  const [selectedAccess, setSelectedAccess] = useState<{
    path: string
    state: DiskPathAccess["state"] | "checking"
  }>()
  const [accessCheckVersion, setAccessCheckVersion] = useState(0)
  useEffect(() => {
    const node = selectedNode
    if (
      !node ||
      !disk?.checkDeleteAccess ||
      !canActOnNode(node, platform.os, cleanupLocks)
    ) {
      setSelectedAccess(undefined)
      return undefined
    }
    let current = true
    setSelectedAccess({ path: node.path, state: "checking" })
    void disk.checkDeleteAccess(node.path).then(
      (result) =>
        current && setSelectedAccess({ path: node.path, state: result.state }),
      () => current && setSelectedAccess({ path: node.path, state: "unknown" })
    )
    return () => {
      current = false
    }
  }, [selectedNode?.path, disk, cleanupLocks, platform.os, accessCheckVersion])
  const indexSize = recentLens
    ? entries.reduce((total, entry) => total + entry.displaySize, 0)
    : indexFilter.lens === "developer"
      ? developerItems.reduce((total, item) => total + item.bytes, 0)
      : indexFilter.lens === "recommendations"
        ? reclaim.totalBytes
        : indexFilter.lens === "changes"
          ? 0
          : parentSize
  const indexCount = recentLens
    ? entries.length
    : indexFilter.lens === "changes"
      ? historyChangeCount
      : query.trim()
        ? entries.length
        : indexFilter.lens === "developer"
          ? developerItems.length
          : indexFilter.lens === "recommendations"
            ? reclaim.totalCount
            : parentCount
  // A watcher can rebase a selected deep result against a newer inventory.
  // Never let an identity-less replacement remain actionable while that
  // reconciliation is in flight (or if an older renderer left one behind).
  const effectiveCollection = useMemo(
    () =>
      uniqueDeletionRoots(
        collection.filter((node) => !inventoryDeletionNeedsRescan(node)),
        platform.os
      ),
    [collection]
  )
  const queuedPaths = useMemo(
    () => effectiveCollection.map((node) => node.path),
    [effectiveCollection]
  )
  useEffect(
    () => sunburstRef.current?.setQueuedPaths(queuedPaths),
    [queuedPaths]
  )
  const projectedPaths = useMemo(() => {
    const paths = new Set(queuedPaths)
    if (collectionDropActive && collectionDragNode)
      paths.add(collectionDragNode.path)
    return paths
  }, [queuedPaths, collectionDropActive, collectionDragNode?.path])
  useEffect(
    () => sunburstRef.current?.setExcludedPaths(projectedPaths),
    [projectedPaths]
  )
  const visibleMapNode = useMemo(
    () => (viewNode ? withoutCollected(viewNode, projectedPaths) : null),
    [viewNode, projectedPaths]
  )
  /**
   * Bulk selection is narrower than the Developer lens: only known
   * regenerable/cache artifacts with per-item checks are eligible. File-size
   * review does not depend on a whole-volume physical reclaim estimate.
   * Everything else remains inspectable and must be reviewed individually.
   */
  const smartCleanupEligibleEntries = useMemo(() => {
    if (indexFilter.lens !== "developer" || !developerAge.valid) return []
    return entries
      .map(({ node }) => node)
      .filter((node) => {
        const recognition = investigation.recognitionFor(node)
        return isSmartCleanupEligible(node, recognition) && canModifyNode(node)
      })
  }, [
    indexFilter,
    physicalCloneAccountingUncertain,
    developerAge,
    entries,
    investigation,
    cleanupLocks,
    cleanupLocksStatus,
  ])
  const smartCleanupCandidates = useMemo(
    () => uniqueDeletionRoots(smartCleanupEligibleEntries, platform.os),
    [smartCleanupEligibleEntries]
  )
  const smartCleanupCandidateBytes = useMemo(
    () => smartCleanupCandidates.reduce((total, node) => total + node.size, 0),
    [smartCleanupCandidates]
  )
  const smartCleanupReviewCount = Math.max(
    0,
    (indexFilter.lens === "developer" ? entries.length : 0) -
      smartCleanupEligibleEntries.length
  )
  const currentScanPinned =
    !!scanSourcePath &&
    isPinnedScanLocation(pinnedLocations, scanSourcePath, platform.os)
  const currentScanLocked =
    !!scanSourcePath && isCleanupLock(scanSourcePath, cleanupLocks, platform.os)
  const collectionSize = effectiveCollection.reduce((s, n) => s + n.size, 0)
  const collectionHasSharedPhysicalStorage = effectiveCollection.some(
    containsSharedPhysicalStorage
  )
  const collectionNeedsDeepInventoryRefresh = useMemo(
    () => requiresDeepInventoryRefresh(effectiveCollection),
    [effectiveCollection, treeRoot, tabs, volumeJobs]
  )
  const runningVolumeScans = volumeJobs.filter(
    (job) => job.status === "scanning"
  ).length
  function volumeJobForDrive(drive: DiskDriveInfo) {
    return volumeJobs.find((job) =>
      diskPathEquals(job.sourcePath, drive.path, platform.os)
    )
  }

  // (Mount subscriptions, keyboard shortcuts, and the JSX read everything
  // through this render-fresh snapshot so late callbacks never go stale.)

  function findScanNode(
    root: DiskScanNode,
    targetPath: string
  ): DiskScanNode | undefined {
    if (diskPathEquals(root.path, targetPath, platform.os)) return root
    for (const child of root.children) {
      const match = findScanNode(child, targetPath)
      if (match) return match
    }
    return undefined
  }

  function showBrowseNode(node: DiskScanNode, instant = false) {
    const preserveInvestigation = indexFilter.lens !== "all" || !!query.trim()
    clearSelectionAnnouncement()
    sunburstRef.current?.navigateTo(node, instant)
    setViewNode(node)
    if (!preserveInvestigation) {
      setSelectedPath(undefined)
      setFocusIdx(0)
      setRangeAnchorIndex(undefined)
    }
    setHoveredPath(null)
  }

  function scanUpdateTree(
    root: DiskScanNode,
    drive: DiskDriveInfo | undefined,
    label: string
  ): DiskScanNode {
    return {
      ...includeHiddenSpace(asBrowseableRoot(root), drive),
      _label: label,
    }
  }

  function pathBelongsToScanRoot(path: string, rootPath: string) {
    return diskPathIsWithin(path, rootPath, platform.os)
  }

  function reconcileCollectionForScanUpdate(
    tree: DiskScanNode,
    scanRootPath: string
  ) {
    setCollection((items) =>
      items.flatMap((item) => {
        const refreshed = developerInventoryCollectionNodeForPath(
          tree,
          item.path,
          platform.os
        )
        // A refreshed inventory row without its scanner-captured directory
        // identity cannot be reviewed or deleted. Prune it instead of leaving
        // a stale basket entry that would later fail closed at delete time.
        if (refreshed && !inventoryDeletionNeedsRescan(refreshed))
          return [refreshed]
        // Keep selections from other tabs, but drop a stale member of this
        // scan rather than turning an old deep record into a delete target.
        return pathBelongsToScanRoot(item.path, scanRootPath) ? [] : [item]
      })
    )
  }

  function requiresDeepInventoryRefresh(removed: readonly DiskScanNode[]) {
    return developerInventoryRootsNeedRefresh(
      [
        treeRoot,
        ...tabs.map((tab) => tab.tree),
        ...volumeJobs.map((job) => job.tree),
      ],
      removed,
      platform.os
    )
  }

  const refreshingDrivesRef = useRef(false)
  async function loadDrives(quiet = false) {
    const api = disk
    if (!api || refreshingDrivesRef.current) return
    refreshingDrivesRef.current = true
    if (!quiet) setDrivesLoading(true)
    setDrivesError(undefined)
    if (!quiet) setStorageDiagnostics(undefined)
    setStorageDiagnosticsError(false)
    try {
      const list = await withTimeout(
        api.getDrives(),
        8000,
        language.t("disk.toast.listingDrives")
      )
      setDrives(
        list.map((drive) => {
          const facts = receivedDriveFactsRef.current.find((candidate) =>
            diskPathEquals(candidate.path, drive.path, platform.os)
          )
          return facts ? { ...drive, ...facts.facts } : drive
        })
      )
      // Diagnostics are helpful context, not a dependency for the main drive
      // chooser. Let it settle independently so a permission probe never
      // delays the first useful screen.
      void live.current.loadStorageDiagnostics()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (quiet) return
      setDrivesError(message)
      setDrives([])
      showToast({
        variant: "error",
        title: language.t("disk.toast.listFailed"),
        description: message,
      })
    } finally {
      refreshingDrivesRef.current = false
      setDrivesLoading(false)
    }
  }

  async function loadStorageDiagnostics() {
    const api = disk
    if (!api) return
    setStorageDiagnosticsError(false)
    try {
      setStorageDiagnostics(
        await withTimeout(
          api.getStorageDiagnostics(),
          8000,
          language.t("disk.toast.checkingStorage")
        )
      )
    } catch {
      setStorageDiagnostics(undefined)
      setStorageDiagnosticsError(true)
    }
  }

  async function chooseAndScan() {
    const api = disk
    if (!api) return
    await chooseFolderAndScan({
      chooseFolder: () => api.chooseFolder(),
      startScan: (path, label, drive) =>
        live.current.startScan(path, label, drive),
      drives,
      os: platform.os,
    })
  }

  function scanStorageLocation(location: DiskStorageLocation) {
    void startScan(
      location.path,
      location.name,
      driveForPath(location.path, drives, platform.os)
    )
  }

  async function openDiskAccessSettings() {
    const api = disk
    if (!api) return
    try {
      const opened = await api.openDiskAccessSettings()
      if (opened) return
      showToast({
        variant: "default",
        title: language.t("disk.toast.noPrivacy"),
      })
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
    const api = disk
    if (!api) return
    const existing = volumeJobForDrive(drive)
    if (existing?.status === "scanning") return
    if (runningVolumeScans >= MAX_PARALLEL_VOLUME_SCANS) {
      showToast({
        variant: "default",
        title: language.t("disk.toast.scanLimit"),
        description: language.t("disk.toast.scanLimitBody"),
      })
      return
    }
    if (existing) {
      volumeScanUnsubsRef.current.get(existing.id)?.()
      volumeScanUnsubsRef.current.delete(existing.id)
      void api.stopWatching(existing.id)
      dropVolumeJob(existing.id)
    }

    const id = newScanID("volume")
    putVolumeJob({
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
      if (progress.scanId !== id) return
      setVolumeScanJobs((jobs) => {
        const job = jobs[id]
        if (!job || job.status !== "scanning") return jobs
        const bytes = Math.max(job.bytes ?? 0, progress.size)
        return {
          ...jobs,
          [id]: {
            ...job,
            files: progress.filesScanned,
            bytes,
            pct: progress.percent ?? job.pct ?? 0,
            currentPath: progress.currentPath,
            ...(progress.source ? { source: progress.source } : {}),
          },
        }
      })
    })
    volumeScanUnsubsRef.current.set(id, unsubscribe)
    void runVolumeScan(id, drive)
  }

  async function runVolumeScan(id: string, drive: DiskDriveInfo) {
    const api = disk
    if (!api) return
    try {
      const scannedTree = await api.scanPath(
        drive.path,
        scannerOptions(drive, true, drive.path),
        id
      )
      if (!scannedTree) return
      const current = live.current.volumeScanJobs[id]
      if (current?.status !== "scanning") return
      scanHistory.seed(id, scannedTree)
      const tree = includeHiddenSpace(asBrowseableRoot(scannedTree), drive)
      tree._label = drive.name
      const completed: VolumeScanJob = {
        ...current,
        status: "complete",
        tree,
        bytes: tree.size,
        pct: 100,
        currentPath: "",
        completedAt: Date.now(),
      }
      putVolumeJob(completed)
      // A finished scan is an invitation: land the user in the map instead of
      // making them find the View affordance (DaisyDisk-style 2-step flow).
      if (live.current.view === "drives" && !live.current.scanning) {
        live.current.openVolumeScan(completed)
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
                const latest = live.current.volumeScanJobs[id]
                if (latest?.tree) live.current.openVolumeScan(latest)
              },
            },
          ],
        })
      }
    } catch (error) {
      if (!live.current.volumeScanJobs[id] || isScanCancellation(error)) return
      patchVolumeJob(id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      volumeScanUnsubsRef.current.get(id)?.()
      volumeScanUnsubsRef.current.delete(id)
    }
  }

  function cancelVolumeScan(id: string) {
    const api = disk
    volumeScanUnsubsRef.current.get(id)?.()
    volumeScanUnsubsRef.current.delete(id)
    dropVolumeJob(id)
    scanHistory.forget(id)
    void api?.cancelScan(id)
  }

  function closeVolumeScan(id: string) {
    if (volumeScanJobs[id]?.status === "scanning") {
      cancelVolumeScan(id)
      return
    }
    dropVolumeJob(id)
    scanHistory.forget(id)
    void disk?.stopWatching(id)
  }

  function openVolumeScan(job: VolumeScanJob) {
    if (!job.tree) return
    // A completed tree is immutable renderer data; React state never wraps it
    // in reactive proxies, so traversing a large scan stays allocation-free.
    const tree = job.tree
    saveCurrentTab()
    setScanSession({ activeID: job.id, foregroundID: undefined })
    orbitEntryIntentRef.current = "scan-complete"
    setView("scan")
    setScanning(false)
    setFocusedScan(null)
    setTreeRoot(tree)
    setViewNode(tree)
    browseHistory.reset(tree.path)
    setScanSourcePath(job.sourcePath)
    setScanLabel(job.label)
    setScanDrive(job.drive)
    setScanFiles(job.files)
    setScanBytes(job.bytes)
    setScanTotal(job.drive.used)
    setScanPct(100)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    replaceIndexFilter({ lens: "all", developerCategory: "all" })
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    focusAfterScanCompletion()
  }
  function currentScanTabState(): CurrentScanTabState {
    return {
      sessionID: scanSession.activeID,
      label: scanLabel,
      sourcePath: scanSourcePath,
      tree: treeRoot,
      view: viewNode,
      browseHistory: browseHistory.history(),
      drive: scanDrive,
    }
  }

  function releaseRetainedScanSessions(sessionIDs: readonly string[]) {
    for (const sessionID of sessionIDs) {
      scanHistory.forget(sessionID)
      void disk?.stopWatching(sessionID)
    }
  }

  /** Snapshot the current completed scan as a background tab before replacing it. */
  function saveCurrentTab() {
    const current = currentScanTabState()
    const timestamp = Date.now()
    const volumeJobSessionIDs = volumeJobs.map((job) => job.id)
    const saved = saveCurrentScanTab(tabs, current, {
      newTabID: `tab-${timestamp}-${tabs.length}`,
      volumeJobSessionIDs,
      os: platform.os,
    })
    const limited = limitRetainedScanTabs(saved, { volumeJobSessionIDs })
    setTabs(limited.tabs)
    releaseRetainedScanSessions(limited.releaseSessionIDs)
  }

  /** Restore a background tab into the live state, saving the current one first. */
  function switchToTab(id: string) {
    if (scanning) return
    const current = currentScanTabState()
    const timestamp = Date.now()
    const volumeJobSessionIDs = volumeJobs.map((job) => job.id)
    const transition: RestoreScanTabResult = restoreScanTab(tabs, id, current, {
      newTabID: `tab-${timestamp}-${tabs.length}`,
      volumeJobSessionIDs,
      os: platform.os,
    })
    const limited = limitRetainedScanTabs(transition.tabs, {
      activeSessionID: transition.restored?.sessionID,
      volumeJobSessionIDs,
    })
    setTabs(limited.tabs)
    releaseRetainedScanSessions(limited.releaseSessionIDs)
    const tab = transition.restored
    if (!tab) return
    setView("scan")
    setTreeRoot(tab.tree)
    setViewNode(tab.view)
    browseHistory.replace(tab.browseHistory)
    setScanSourcePath(tab.sourcePath)
    setScanLabel(tab.label)
    setScanDrive(tab.drive)
    setScanSession({ activeID: tab.sessionID, foregroundID: undefined })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    replaceIndexFilter({ lens: "all", developerCategory: "all" })
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    restoreKeyboardViewFocus(scanMode)
  }

  function closeTab(id: string) {
    const volumeJobSessionIDs = volumeJobs.map((job) => job.id)
    const transition = closeScanTab(tabs, id, {
      activeSessionID: scanSession.activeID,
      volumeJobSessionIDs,
    })
    setTabs(transition.tabs)
    if (!transition.releaseSessionID) return
    scanHistory.forget(transition.releaseSessionID)
    void disk?.stopWatching(transition.releaseSessionID)
  }

  function scannerOptions(
    drive?: DiskDriveInfo,
    includeDeveloperInventory = true,
    scanPath?: string
  ) {
    const wholeVolume =
      !!drive && !!scanPath && diskPathEquals(scanPath, drive.path, platform.os)
    return {
      // Materialize the visible map only; deeper branches remain exact-sized
      // aggregate nodes and are expanded on demand.
      maxDepth: wholeVolume ? 6 : 8,
      sizeMode:
        platform.os === "windows" || drive?.type === "network"
          ? ("logical" as const)
          : ("physical" as const),
      preserveNames: [...IMPORTANT_PRESERVE_NAMES],
      collapseNames: wholeVolume ? [...DEVELOPER_COLLAPSE_NAMES] : [],
      signatureNames: [...DEVELOPER_SIGNATURE_NAMES],
      // This is intentionally separate from the visual depth limit so the
      // Developer lens can expose deep build/dependency artifacts too. Focused
      // subtree expansions leave it out: the root inventory remains the sole
      // authoritative bounded traversal for the current map.
      ...(includeDeveloperInventory
        ? { developerArtifactInventory: { maxItems: 2_000 } }
        : {}),
    }
  }

  async function startScan(
    path: string,
    label: string,
    drive?: DiskDriveInfo,
    preserveCurrent = true,
    forceFresh = false
  ) {
    const api = disk
    if (!api) return
    scanUnsubRef.current?.()
    if (preserveCurrent) saveCurrentTab()
    const token = ++scanTokenRef.current
    const sessionID =
      !preserveCurrent && scanSession.activeID
        ? scanSession.activeID
        : newScanID("folder")
    const startedAt = Date.now()
    setScanSession({ activeID: sessionID, foregroundID: sessionID })
    if (volumeScanJobs[sessionID]) {
      patchVolumeJob(sessionID, {
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
    orbitEntryIntentRef.current = "scan-complete"
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
    const isVolumeRoot =
      !!drive && diskPathEquals(path, drive.path, platform.os)
    setScanTotal(isVolumeRoot ? drive.used : 0)
    setScanPct(0)
    setScanBytes(0)
    scanMaxBytesRef.current = 0
    setScanTail("")
    setScanCompletionSource(undefined)
    setTreeRoot(null)
    setViewNode(null)
    browseHistory.reset()
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    replaceIndexFilter({ lens: "all", developerCategory: "all" })
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    setScanDrive(drive)
    setScanSourcePath(path)
    scanUnsubRef.current = api.onScanProgress((p) => {
      if (token !== scanTokenRef.current || p.scanId !== sessionID) return
      if (p.done && p.source) setScanCompletionSource(p.source)
      setScanFiles(p.filesScanned)
      setScanTail(p.currentPath)
      if (p.size > scanMaxBytesRef.current) {
        scanMaxBytesRef.current = p.size
        setScanBytes(scanMaxBytesRef.current)
      }
      if (p.percent !== undefined) setScanPct(p.percent)
      setVolumeScanJobs((jobs) => {
        const job = jobs[sessionID]
        if (!job) return jobs
        return {
          ...jobs,
          [sessionID]: {
            ...job,
            files: p.filesScanned,
            bytes: scanMaxBytesRef.current,
            pct: p.percent ?? 0,
            currentPath: p.currentPath,
            ...(p.source ? { source: p.source } : {}),
          },
        }
      })
    })
    try {
      const scannedTree = await api.scanPath(
        path,
        {
          ...scannerOptions(drive, true, path),
          ...(forceFresh ? { forceFresh: true } : {}),
        },
        sessionID
      )
      if (token !== scanTokenRef.current || !scannedTree) return // superseded or cancelled
      if (live.current.scanSession.foregroundID !== sessionID) return // viewport moved to another scan
      scanHistory.seed(sessionID, scannedTree)
      const tree = includeHiddenSpace(asBrowseableRoot(scannedTree), drive)
      tree._label = label
      setScanPct(100)
      setTreeRoot(tree)
      setViewNode(tree)
      browseHistory.reset(tree.path)
      if (live.current.volumeScanJobs[sessionID]) {
        patchVolumeJob(sessionID, {
          status: "complete",
          tree,
          bytes: tree.size,
          pct: 100,
          currentPath: "",
          completedAt: Date.now(),
        })
      }
      focusAfterScanCompletion()
    } catch (err) {
      if (token !== scanTokenRef.current || isScanCancellation(err)) return
      const message = err instanceof Error ? err.message : String(err)
      showToast({
        variant: "error",
        title: language.t("disk.toast.scanFailed"),
        description: message,
      })
      if (live.current.volumeScanJobs[sessionID])
        patchVolumeJob(sessionID, { status: "failed", error: message })
      setView("drives")
      setScanSourcePath("")
      setScanLabel("")
      setScanDrive(undefined)
      if (live.current.scanSession.activeID === sessionID) {
        setScanSession((current) => ({ ...current, activeID: undefined }))
      }
      scanHistory.forget(sessionID)
    } finally {
      if (token === scanTokenRef.current) {
        setScanning(false)
        scanUnsubRef.current?.()
        scanUnsubRef.current = undefined
        setScanSession((current) => ({ ...current, foregroundID: undefined }))
      }
    }
  }

  async function expandFocusedNode(
    node: DiskScanNode,
    restoreListFocus = false,
    options: FocusedExpansionOptions = {}
  ) {
    const api = disk
    const initialRoot = treeRoot
    if (!api || !initialRoot) return
    scanUnsubRef.current?.()
    const token = ++scanTokenRef.current
    const sessionID = newScanID("expand")
    setScanSession((current) => ({ ...current, foregroundID: sessionID }))
    orbitEntryIntentRef.current = "scan-complete"
    const drive = driveForPath(node.path, drives, platform.os) ?? scanDrive
    const isScanRoot = diskPathEquals(initialRoot.path, node.path, platform.os)
    setFocusedScan({ label: options.label ?? diskNodeDisplayName(node) })
    setScanning(true)
    setScanFiles(0)
    setScanTotal(0)
    setScanPct(0)
    setScanBytes(0)
    scanMaxBytesRef.current = 0
    setScanTail("")
    const unsubscribe = api.onScanProgress((progress) => {
      if (token !== scanTokenRef.current || progress.scanId !== sessionID)
        return
      setScanFiles(progress.filesScanned)
      setScanTail(progress.currentPath)
      if (progress.size <= scanMaxBytesRef.current) return
      scanMaxBytesRef.current = progress.size
      setScanBytes(scanMaxBytesRef.current)
    })
    scanUnsubRef.current = unsubscribe
    let retainTrustedSubtree = false

    try {
      const scannedTree = await api.scanPath(
        node.path,
        {
          ...scannerOptions(drive, isScanRoot, node.path),
          ...(options.maxChildren === undefined
            ? {}
            : { maxChildren: options.maxChildren }),
        },
        sessionID
      )
      if (token !== scanTokenRef.current || !scannedTree) return
      const latestRoot = live.current.treeRoot
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
      const nextRoot = replaceScanSubtree(
        latestRoot,
        node.path,
        replacement,
        platform.os
      )
      if (nextRoot === latestRoot)
        throw new Error(language.t("disk.toast.folderChanged"))
      let nextView = findScanNode(nextRoot, replacement.path)
      if (nextView && options.group) {
        const children = nextView.children.filter(
          (child) => !options.group!.excludedPaths.has(child.path)
        )
        const group = {
          ...options.group.node,
          children,
          size: children.reduce((sum, child) => sum + child.size, 0),
          otherCount: children.reduce(
            (sum, child) => sum + (child.isOther ? (child.otherCount ?? 1) : 1),
            0
          ),
        }
        nextView = groupNavigation.open(nextRoot, nextView, group) ?? nextView
      }
      if (!nextView) throw new Error(language.t("disk.toast.folderChanged"))
      retainTrustedSubtree = true
      clearSelectionAnnouncement()
      setScanPct(100)
      setTreeRoot(nextRoot)
      setViewNode(nextView)
      browseHistory.visit(nextView.path)
      if (
        live.current.scanSession.activeID &&
        live.current.volumeScanJobs[live.current.scanSession.activeID]
      ) {
        patchVolumeJob(live.current.scanSession.activeID, { tree: nextRoot })
      }
      setCollection((items) =>
        items.flatMap((item) => {
          if (!pathBelongsToScanRoot(item.path, node.path)) return [item]
          const refreshed =
            findScanNode(nextRoot, item.path) ??
            developerInventoryCollectionNodeForPath(
              nextRoot,
              item.path,
              platform.os
            )
          return refreshed ? [refreshed] : []
        })
      )
      replaceIndexFilter({ lens: "all", developerCategory: "all" })
      setSelectedPath(undefined)
      setHoveredPath(null)
      setQuery("")
      setFocusIdx(0)
      setRangeAnchorIndex(undefined)
      if (restoreListFocus) focusListEntry(0)
    } catch (error) {
      if (token !== scanTokenRef.current || isScanCancellation(error)) return
      showToast({
        variant: "error",
        title: language.t("disk.toast.openFailed", {
          name: options.label ?? diskNodeDisplayName(node),
        }),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      unsubscribe()
      if (scanUnsubRef.current === unsubscribe) scanUnsubRef.current = undefined
      void api.stopWatching(
        sessionID,
        retainTrustedSubtree ? { retainTrustedSubtree: true } : undefined
      )
      if (token === scanTokenRef.current) {
        setFocusedScan(null)
        setScanning(false)
        setScanSession((current) => ({ ...current, foregroundID: undefined }))
      }
    }
  }

  function expandOtherNode(node: DiskScanNode, restoreListFocus = false) {
    if (node.isHidden) {
      showToast({
        title: language.t("disk.node.hiddenSpace"),
        description: language.t("disk.capacity.hiddenExplanation"),
      })
      return
    }
    if (!treeRoot || !viewNode) return
    const incomplete =
      node.children.reduce((sum, child) => sum + child.size, 0) < node.size ||
      (node.otherCount ?? node.children.length) > node.children.length
    if (incomplete) {
      const plan = planOtherExpansion(treeRoot, node, platform.os)
      if (plan) {
        const members = new Set(node.children.map((child) => child.path))
        void expandFocusedNode(plan.parent, restoreListFocus, {
          maxChildren: plan.maxChildren,
          label: diskNodeDisplayName(node),
          group: {
            node,
            excludedPaths: new Set(
              plan.parent.children
                .filter((child) => !child.isOther && !members.has(child.path))
                .map((child) => child.path)
            ),
          },
        })
        return
      }
    }
    const group = groupNavigation.open(treeRoot, viewNode, node)
    if (!group) return
    browseHistory.visit(group.path)
    showBrowseNode(group)
    if (restoreListFocus) restoreKeyboardViewFocus("list")
  }

  async function rescanCurrent(forceFresh = false) {
    const api = disk
    const root = treeRoot
    if (!api || !root) return
    const path = scanSourcePath || root.path
    const label = scanLabel || root.name
    const drive = scanDrive
    // Start immediately so stale map actions cannot race a slow drive-facts
    // request. Capacity refresh is helpful context, never a prerequisite for
    // rebuilding a destructive-action source of truth.
    const scan = startScan(path, label, drive, false, forceFresh)
    if (drive) {
      void withTimeout(
        api.getDrives(),
        8000,
        language.t("disk.toast.refreshingTotals")
      )
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
    if (!confirmed && !focusedScan) {
      if (Date.now() - cancelArmedAtRef.current < SCAN_CANCEL_ARM_MS) {
        cancelArmedAtRef.current = 0
      } else {
        cancelArmedAtRef.current = Date.now()
        showToast({
          variant: "default",
          title: language.t("disk.scan.label", { label: scanLabel }),
          actions: [
            {
              label: language.t("disk.common.cancelScan"),
              onClick: () => live.current.cancelScan({ confirmed: true }),
            },
          ],
        })
        return
      }
    }
    const focused = focusedScan
    const sessionID = scanSession.foregroundID
    scanTokenRef.current++
    scanUnsubRef.current?.()
    scanUnsubRef.current = undefined
    setScanSession((current) => ({ ...current, foregroundID: undefined }))
    if (sessionID) {
      void disk?.cancelScan(sessionID)
      if (focused) void disk?.stopWatching(sessionID)
    }
    if (sessionID && volumeScanJobs[sessionID]) dropVolumeJob(sessionID)
    setFocusedScan(null)
    setScanning(false)
    focusPersistentDiskAction()
    if (!focused) backToDrives()
  }

  function drill(
    node: DiskScanNode,
    instant = false,
    restoreListFocus = false
  ) {
    if (scanning || isDeveloperInventoryNode(node)) return
    if (node.isOther) {
      expandOtherNode(node, restoreListFocus)
      return
    }
    if (!node.isDir) return
    if (node.isCollapsed) {
      void expandFocusedNode(node, restoreListFocus, {
        maxChildren: COLLAPSED_EXPANSION_MAX_CHILDREN,
      })
      return
    }
    browseHistory.visit(node.path)
    showBrowseNode(node, instant)
    if (restoreListFocus) focusListEntry(0)
  }

  function chooseLens(lens: IndexLens | "recent") {
    setRecentLens(lens === "recent")
    replaceIndexFilter({
      lens: lens === "recent" ? "all" : lens,
      developerCategory: "all",
    })
    setQuery("")
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    scrollIndexIntoViewRef.current?.(0)
  }

  function clearCurrentHistory() {
    const scanId = scanSession.activeID
    if (!scanId) return
    scanHistory.clear(scanId)
    setHistoryEntries([...scanHistory.entries()])
  }

  function chooseDeveloperCategory(category: DeveloperCategoryFilter) {
    replaceIndexFilter({ developerCategory: category })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    scrollIndexIntoViewRef.current?.(0)
  }

  function chooseDeveloperEcosystem(ecosystem: ArtifactEcosystemFilter) {
    replaceIndexFilter({ developerEcosystem: ecosystem })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    scrollIndexIntoViewRef.current?.(0)
  }

  function chooseDeveloperCleanupAge(age: DeveloperCleanupAgePreset) {
    replaceIndexFilter({ developerAge: age })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    scrollIndexIntoViewRef.current?.(0)
  }

  function setCustomDeveloperCleanupAgeDays(days: string) {
    replaceIndexFilter({ customDeveloperAgeDays: days })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    setRangeAnchorIndex(undefined)
    scrollIndexIntoViewRef.current?.(0)
  }

  function updateQuery(value: string) {
    const path = selectedPath
    setQuery(value)
    setHoveredPath(null)
    setRangeAnchorIndex(undefined)
    const nextIndex = path
      ? deriveEntries({ query: value }).findIndex((entry) =>
          diskPathEquals(entry.node.path, path, platform.os)
        )
      : -1
    if (nextIndex >= 0) {
      setFocusIdx(nextIndex)
      scrollIndexIntoViewRef.current?.(nextIndex)
    }
  }

  function openSearch() {
    setSearchOpen(true)
    requestAnimationFrame(() =>
      document.getElementById("disklizard-scan-search")?.focus()
    )
  }

  function closeSearch() {
    updateQuery("")
    setSearchOpen(false)
    searchTriggerRef.current?.focus({ preventScroll: true })
  }

  const viewTransitionVersionRef = useRef(0)
  const queuedModeRef = useRef<ScanMode | null>(null)

  function chooseScanMode(
    mode: ScanMode,
    intent: Exclude<SunburstEntryIntent, "scan-complete"> = "pointer",
    focusContent = true
  ) {
    if (morphing) {
      queuedModeRef.current = mode
      return
    }
    if (mode === scanMode) return
    const version = ++viewTransitionVersionRef.current
    const sb = sunburstRef.current
    const canvas = canvasEl
    const landscape = landscapeElRef.current
    if (
      (scanMode !== "map" && mode !== "map") ||
      !sb ||
      !canvas ||
      !landscape ||
      mode === "list" ||
      scanMode === "list" ||
      intent === "keyboard" ||
      sb.reducedMotion
    ) {
      applyScanMode(mode, intent, focusContent)
      return
    }
    const previous = scanMode
    const segments = sb.morphSegments()
    const readRects = () => {
      const bounds = canvas.getBoundingClientRect()
      const sx = canvas.width / Math.max(1, bounds.width)
      const sy = canvas.height / Math.max(1, bounds.height)
      return new Map(
        [
          ...landscape.querySelectorAll<HTMLElement>(
            "[data-disk-tile-path], [data-disk-layer-path]"
          ),
        ].map((el) => {
          const r = el.getBoundingClientRect()
          return [
            el.dataset.diskTilePath ?? el.dataset.diskLayerPath!,
            {
              x: (r.left - bounds.left) * sx,
              y: (r.top - bounds.top) * sy,
              w: r.width * sx,
              h: r.height * sy,
              color: getComputedStyle(el).backgroundColor,
            },
          ]
        })
      )
    }
    const source = readRects()
    morphRef.current?.abort()
    sb.setMorphing(true)
    if (previous !== "map") {
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        for (const element of landscape.querySelectorAll<HTMLElement>(
          "[data-disk-tile-path], [data-disk-layer-path]"
        )) {
          const rect = source.get(
            element.dataset.diskTilePath ?? element.dataset.diskLayerPath!
          )
          if (!rect) continue
          ctx.fillStyle = getComputedStyle(element).backgroundColor
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
        }
      }
    }
    setMorphing(true)
    setScanMode(mode)
    setGridVisible(mode === "grid")
    setGridInteractive(false)
    setHoveredPath(null)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (version !== viewTransitionVersionRef.current) return
        const target = readRects()
        const tiles: MorphTile[] = []
        for (const seg of segments) {
          const fromRect = source.get(seg.path)
          const toRect = target.get(seg.path)
          // Preserve disappearing rings and entering details throughout the flight.
          const absentSource = previous !== "map" && !fromRect
          const absentTarget = mode !== "map" && !toRect
          const rect = toRect ?? fromRect ?? { x: 0, y: 0, w: 0, h: 0 }
          const wedge = {
            start: seg.start + sb.options.padAngle,
            end: seg.end - sb.options.padAngle,
            inner: seg.inner,
            outer: seg.outer,
          }
          tiles.push({
            path: seg.path,
            node: seg.node,
            depth: seg.depth,
            colorIndex:
              Array.from({ length: 10 }, (_, i) => i).find(
                (i) => primaryHueForIndex(i) === seg.hue
              ) ?? 0,
            fromColor:
              previous === "map"
                ? (branchColor(seg.node) ??
                  primarySegmentColor(0, 1, seg.node.isDir))
                : fromRect?.color,
            toColor:
              mode === "map"
                ? (branchColor(seg.node) ??
                  primarySegmentColor(0, 1, seg.node.isDir))
                : toRect?.color,
            fromOpacity: absentSource ? 0 : 1,
            toOpacity: absentTarget ? 0 : 1,
            from: {
              shape: previous === "map" ? "arc" : "rect",
              wedge,
              rect: fromRect ?? rect,
            },
            to: {
              shape: mode === "map" ? "arc" : "rect",
              wedge,
              rect: toRect ?? rect,
            },
          })
        }
        const known = new Set(tiles.map((tile) => tile.path))
        for (const [path, rect] of target) {
          if (mode === "map" || known.has(path) || !viewNode) continue
          const from = source.get(path)
          const wedge = {
            start: -Math.PI / 2,
            end: -Math.PI / 2 + 0.01,
            inner: 0,
            outer: 1,
          }
          tiles.push({
            path,
            node: viewNode,
            colorIndex: 0,
            fromColor: from?.color ?? rect.color,
            toColor: rect.color,
            fromOpacity: from ? 1 : 0,
            from: {
              shape: "rect",
              wedge,
              rect: from ?? {
                ...rect,
                x: rect.x + rect.w / 2,
                y: rect.y + rect.h / 2,
                w: 0,
                h: 0,
              },
            },
            to: { shape: "rect", wedge, rect },
          })
        }
        const included = new Set(tiles.map((tile) => tile.path))
        for (const [path, rect] of source) {
          if (previous === "map" || included.has(path) || !viewNode) continue
          const wedge = { start: 0, end: 0.01, inner: 0, outer: 1 }
          tiles.push({
            path,
            node: viewNode,
            colorIndex: 0,
            fromColor: rect.color,
            toColor: rect.color,
            toOpacity: 0,
            from: { shape: "rect", wedge, rect },
            to: { shape: "rect", wedge, rect },
          })
        }
        ensureMorph(canvas).play(
          tiles,
          mode === "map" ? "toMap" : "toGrid",
          () => {
            if (version !== viewTransitionVersionRef.current) return
            // Commit the destination before releasing canvas ownership: otherwise
            // a map redraw can briefly cover the arriving tiles or layers.
            flushSync(() => {
              setMorphing(false)
              setGridVisible(mode === "grid")
              setGridInteractive(mode === "grid")
            })
            sb.setMorphing(false)
            const queued = queuedModeRef.current
            queuedModeRef.current = null
            if (queued && queued !== mode)
              requestAnimationFrame(() => live.current.chooseScanMode(queued))
          }
        )
      })
    )
  }

  function applyScanMode(
    mode: ScanMode,
    intent: Exclude<SunburstEntryIntent, "scan-complete"> = "pointer",
    focusContent = true
  ) {
    queuedModeRef.current = null
    morphRef.current?.abort()
    sunburstRef.current?.setMorphing(false)
    setMorphing(false)
    if (mode === "map") orbitEntryIntentRef.current = intent
    setScanMode(mode)
    setHoveredPath(null)
    setGridVisible(mode === "grid")
    setGridInteractive(mode === "grid")
    if (intent === "keyboard" && focusContent) restoreKeyboardViewFocus(mode)
  }

  function updateSort(
    key: DiskEntrySortKey,
    direction: DiskEntrySortDirection
  ) {
    const path = selectedPath
    replaceIndexFilter({ sortKey: key, sortDirection: direction })
    setRangeAnchorIndex(undefined)
    const nextIndex = path
      ? deriveEntries({ sortKey: key, sortDirection: direction }).findIndex(
          (entry) => diskPathEquals(entry.node.path, path, platform.os)
        )
      : -1
    setFocusIdx(nextIndex >= 0 ? nextIndex : 0)
    scrollIndexIntoViewRef.current?.(nextIndex >= 0 ? nextIndex : 0)
  }

  /** A keyboard view switch must land on a real control in the newly mounted view. */
  function restoreKeyboardViewFocus(mode: ScanMode) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (mode === "map") {
          const canvas = live.current.canvasEl
          if (canvas) {
            canvas.focus({ preventScroll: true })
            return
          }
          focusPersistentDiskAction()
          return
        }
        if (mode === "list") {
          focusListEntry(
            clampedListIndex(live.current.focusIdx, live.current.entries.length)
          )
          return
        }
        if (mode === "icicle") {
          document
            .querySelector<HTMLElement>("[data-disk-layer-path]")
            ?.focus({ preventScroll: true })
          return
        }
        const desiredPath =
          live.current.selectedPath ??
          live.current.entries[
            clampedListIndex(live.current.focusIdx, live.current.entries.length)
          ]?.node.path
        const tile = [
          ...document.querySelectorAll<HTMLElement>("[data-disk-tile-path]"),
        ].find((element) => element.dataset.diskTilePath === desiredPath)
        const focusTarget =
          tile ?? document.querySelector<HTMLElement>("[data-disk-tile-path]")
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
    requestAnimationFrame(() =>
      scanProgressRegionRef.current?.focus({ preventScroll: true })
    )
  }

  /** Scan completion lands keyboard users on the fresh map or the results list. */
  function focusAfterScanCompletion() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (live.current.scanMode === "map") {
          live.current.canvasEl?.focus({ preventScroll: true })
          return
        }
        if (live.current.entries.length > 0) focusListEntry(0)
        else focusPersistentDiskAction()
      })
    })
  }

  async function togglePinnedLocation(path: string, label: string) {
    if (pinMutationPending) return
    setPinMutationPending(true)
    try {
      const wasPinned = isPinnedScanLocation(pinnedLocations, path, platform.os)
      const next = togglePinnedScanLocation(
        pinnedLocations,
        { path, label },
        platform.os
      )
      if (!wasPinned && !isPinnedScanLocation(next, path, platform.os)) {
        showToast({
          variant: "default",
          title: language.t("disk.toast.savedFull"),
          description: language.t("disk.toast.savedFullBody"),
        })
        return
      }
      const result = await settings.store.general.setDiskPinnedLocations(next)
      if (!result.ok) return
      const pinned = isPinnedScanLocation(result.value, path, platform.os)
      if (pinned === wasPinned) return
      showToast({
        variant: "default",
        title: pinned
          ? language.t("disk.toast.savedAdded")
          : language.t("disk.toast.savedRemoved"),
        description: label,
      })
    } finally {
      setPinMutationPending(false)
    }
  }

  function showCleanupProtectionsUnavailable() {
    const status = cleanupLocksStatus
    const title =
      status === "loading"
        ? "disk.cleanup.protectionsLoadingTitle"
        : status === "saving"
          ? "disk.cleanup.protectionsSavingTitle"
          : "disk.cleanup.protectionsErrorTitle"
    const description =
      status === "loading"
        ? "disk.cleanup.protectionsLoading"
        : status === "saving"
          ? "disk.cleanup.protectionsSaving"
          : "disk.cleanup.protectionsError"
    showToast({
      variant: status === "error" ? "error" : "default",
      title: language.t(title),
      description: language.t(description),
    })
  }

  function ensureCleanupProtectionsReady() {
    if (cleanupProtectionsReady()) return true
    showCleanupProtectionsUnavailable()
    return false
  }

  async function toggleProtectedTree(path: string, label: string) {
    if (
      deleting ||
      !ensureCleanupProtectionsReady() ||
      cleanupLockMutationPending
    )
      return
    setCleanupLockMutationPending(true)
    try {
      const wasLocked = isCleanupLock(path, cleanupLocks, platform.os)
      const next = toggleCleanupLock(cleanupLocks, { path, label }, platform.os)
      if (!wasLocked && !isCleanupLock(path, next, platform.os)) {
        showToast({
          variant: "default",
          title: language.t("disk.toast.protectedFull"),
          description: language.t("disk.toast.protectedFullBody"),
        })
        return
      }
      const result = await settings.store.general.setDiskCleanupLocks(next)
      if (!result.ok) return
      const locked = isCleanupLock(path, result.value, platform.os)
      if (locked === wasLocked) return
      setCollection((items) =>
        withoutCleanupLockedNodes(items, result.value, platform.os)
      )
      showToast({
        variant: "default",
        title: locked
          ? language.t("disk.toast.cleanupProtected")
          : language.t("disk.toast.cleanupUnlocked"),
        description: locked
          ? language.t("disk.toast.cleanupProtectedBodyLegacy", { name: label })
          : language.t("disk.toast.cleanupUnlockedBodyLegacy", { name: label }),
      })
    } finally {
      setCleanupLockMutationPending(false)
    }
  }

  function goUpFromMapCenter() {
    if (scanning) return
    // The center navigates inside this scan; leaving it belongs to Volumes.
    const parent =
      crumbs.length > 1 ? crumbs[crumbs.length - 2]?.node : undefined
    if (!parent) return
    browseHistory.visit(parent.path)
    showBrowseNode(parent)
  }

  function goUp(instant = false, restoreListFocus = false) {
    if (scanning) {
      cancelScan()
      return
    }
    const current = viewNode
    const list = crumbs
    if (list.length <= 1) {
      backToDrives()
      return
    }
    const parent = list[list.length - 2]
    if (parent?.node) {
      browseHistory.visit(parent.node.path)
      showBrowseNode(parent.node, instant)
      if (restoreListFocus && current) {
        const index = deriveEntries({
          viewNode: parent.node,
          query: "",
          lens: "all",
        }).findIndex((entry) =>
          diskPathEquals(entry.node.path, current.path, platform.os)
        )
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
    browseHistory.reset()
    setScanSourcePath("")
    setScanLabel("")
    setScanDrive(undefined)
    setSelectedPath(undefined)
    setHoveredPath(null)
    void loadDrives()
  }

  function goToCrumb(crumb: Crumb) {
    if (crumb.node && !scanning) {
      browseHistory.visit(crumb.node.path)
      showBrowseNode(crumb.node)
    }
  }

  /** A virtual row may mount on the next frame after structural keyboard navigation. */
  function focusListEntry(index: number, attempt = 0) {
    if (index < 0) return
    scrollIndexIntoViewRef.current?.(index)
    requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-disk-index="${index}"]`
      )
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
      .querySelector<HTMLElement>(
        "[data-disk-primary-action], [data-disk-navigation-home]"
      )
      ?.focus({ preventScroll: true })
  }

  function selectPath(path: string) {
    setSelectedPath(path)
    sunburstRef.current?.setSelected(path)
    const root = treeRoot
    // One pass resolves both the row index and the node; the deep-tree search
    // only runs when the selection lives outside the visible lens.
    const list = entries
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
    clearTimeout(selectionAnnouncementTimerRef.current)
    selectionAnnouncementTimerRef.current = setTimeout(() => {
      selectionAnnouncementTimerRef.current = undefined
      setAnnouncedSelection(
        describeStorageNode(
          announced,
          live.current.indexFilter.lens === "all"
            ? live.current.parentSize
            : live.current.indexSize,
          {
            canPreview: !!live.current.disk,
            canReview: live.current.canModifyNode(announced),
            requiresRescanBeforeReview: inventoryDeletionNeedsRescan(announced),
          }
        )
      )
    }, 120)
  }

  function clearSelectionAnnouncement() {
    clearTimeout(selectionAnnouncementTimerRef.current)
    selectionAnnouncementTimerRef.current = undefined
    setAnnouncedSelection("")
  }

  function selectEntry(
    node: DiskScanNode,
    index: number,
    _extendRange = false,
    _currentIndex = index
  ) {
    // Keyboard and pointer selection inspect an item. Review membership changes
    // only through the labeled review control or batch action.
    setRangeAnchorIndex(index)
    selectPath(node.path)
  }

  function hoverEntry(path: string | null, node: DiskScanNode | null = null) {
    setHoveredPath(path)
    setHoveredNode(node)
    sunburstRef.current?.setHighlight(path)
  }

  function handleMapHover(node: DiskScanNode | null) {
    hoverEntry(node?.path ?? null, node)
    setMapHoverCandidate(node?.isDir && node.children?.length ? node : null)
  }

  useEffect(() => {
    setMapHoverCandidate(null)
  }, [viewNode?.path])

  function focusEntryAt(
    index: number,
    extendRange = false,
    currentIndex = focusIdx
  ) {
    const list = entries
    const target = clampedListIndex(index, list.length)
    if (target < 0) return -1
    setFocusIdx(target)
    selectEntry(list[target].node, target, extendRange, currentIndex)
    scrollIndexIntoViewRef.current?.(target)
    return target
  }

  function moveFocus(
    delta: number,
    extendRange = false,
    startIndex = focusIdx
  ) {
    const list = entries
    const current = clampedListIndex(startIndex, list.length)
    if (current < 0) return -1
    const next = extendRange
      ? clampedListIndex(current + delta, list.length)
      : wrappedListIndex(current, delta, list.length)
    return focusEntryAt(next, extendRange, current)
  }

  function moveFocusByPage(
    direction: -1 | 1,
    pageSize: number,
    extendRange = false,
    startIndex = focusIdx
  ) {
    const list = entries
    const current = clampedListIndex(startIndex, list.length)
    if (current < 0) return -1
    return focusEntryAt(
      pagedListIndex(current, direction, pageSize, list.length),
      extendRange,
      current
    )
  }

  function moveFocusToBoundary(
    boundary: "first" | "last",
    extendRange = false,
    startIndex = focusIdx
  ) {
    const list = entries
    const current = clampedListIndex(startIndex, list.length)
    if (current < 0) return -1
    return focusEntryAt(
      boundary === "first" ? 0 : list.length - 1,
      extendRange,
      current
    )
  }

  function focusedEntryNode() {
    // An explicit selection must never silently turn into the focused row.
    if (selectedPath) return selectedNode
    return entries[clampedListIndex(focusIdx, entries.length)]?.node ?? null
  }

  function openFocused() {
    const node = focusedEntryNode()
    if (!node) return
    if (node.isDir) {
      if (isDeveloperInventoryNode(node)) void reveal(node.path)
      else drill(node, true)
      return
    }
    if (!node.isOther) void preview.show(node)
  }

  function handleEntryKeyDown(
    event: ReactKeyboardEvent,
    node: DiskScanNode,
    index: number
  ) {
    if (event.defaultPrevented) return
    const supportsRangeNavigation =
      !event.metaKey && !event.ctrlKey && !event.altKey
    const isPlainShortcut = supportsRangeNavigation && !event.shiftKey
    if (
      event.altKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      event.preventDefault()
      browseHistory.move(event.key === "ArrowLeft" ? "back" : "forward")
      return
    }
    if (
      supportsRangeNavigation &&
      (event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        (isPlainShortcut && (event.key === "j" || event.key === "k")))
    ) {
      event.preventDefault()
      const next = moveFocus(
        event.key === "ArrowDown" || event.key === "j" ? 1 : -1,
        event.shiftKey,
        index
      )
      if (next >= 0) focusListEntry(next)
      return
    }
    if (
      supportsRangeNavigation &&
      (event.key === "PageDown" || event.key === "PageUp")
    ) {
      event.preventDefault()
      const next = moveFocusByPage(
        event.key === "PageDown" ? 1 : -1,
        listPageSizeRef.current(),
        event.shiftKey,
        index
      )
      if (next >= 0) focusListEntry(next)
      return
    }
    if (
      supportsRangeNavigation &&
      (event.key === "Home" || event.key === "End")
    ) {
      event.preventDefault()
      const next = moveFocusToBoundary(
        event.key === "Home" ? "first" : "last",
        event.shiftKey,
        index
      )
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
        if (isDeveloperInventoryNode(node)) void reveal(node.path)
        else drill(node, true, true)
        return
      }
      if (!node.isOther) void preview.show(node)
      return
    }
    if (isPlainShortcut && event.key === " ") {
      event.preventDefault()
      if (node.isOther || node.isHidden) return
      if (preview.supportsSystemPreview()) {
        void preview.openSystemPreview(node)
        return
      }
      void preview.show(node)
      return
    }
    if (
      event.key === "Backspace" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey
    ) {
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
      void toggleProtectedTree(node.path, node.name)
      return
    }
    if (
      event.key.toLowerCase() === "r" &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey
    ) {
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
      chooseScanMode("icicle", "keyboard")
      return
    }
    if (
      isPlainShortcut &&
      (event.key === "Escape" || event.key === "Backspace")
    ) {
      event.preventDefault()
      goUp(true, true)
    }
  }

  async function reveal(path: string) {
    const api = disk
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

  async function openTrash() {
    const api = disk
    if (!api) return
    try {
      await api.openTrash()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("disk.toast.trashOpenFailed", {
          trash: nativeTrashName(platform.os),
        }),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function handleUpdaterMenuAction() {
    const updater = platform.updater
    if (!updater) return
    try {
      const current = updater.state
      if (current.status === "ready") {
        await updater.install()
        return
      }
      const next = await updater.check()
      if (next.status === "ready") {
        showToast({
          variant: "success",
          title: language.t("disk.app.updateReady"),
          description: language.t("disk.app.updateReadyBody", {
            version: next.version,
          }),
        })
      } else if (next.status === "up-to-date") {
        showToast({
          variant: "success",
          title: language.t("disk.app.upToDate"),
        })
      } else if (next.status === "error") {
        showToast({
          variant: "error",
          title: language.t("disk.app.updateFailed"),
          description: next.message,
        })
      }
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("disk.app.updateFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async function exportDiagnostics() {
    if (!platform.exportDiagnostics) return
    try {
      const path = await platform.exportDiagnostics()
      showToast({
        variant: "success",
        title: language.t("disk.app.diagnosticsSaved"),
        description: language.t("disk.app.diagnosticsSavedBody", { path }),
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("disk.app.diagnosticsFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function viewAfterDeletion(
    previousRoot: DiskScanNode,
    nextRoot: DiskScanNode,
    previousView: DiskScanNode,
    removed: readonly DiskScanNode[]
  ) {
    const survivor = withoutDeletedNodes(
      buildCrumbs(previousRoot, previousView).map((crumb) => crumb.node),
      removed,
      platform.os
    ).at(-1)
    return survivor
      ? (buildCrumbs(nextRoot, survivor).at(-1)?.node ?? nextRoot)
      : nextRoot
  }

  function restoreFocusAfterDeletion() {
    requestAnimationFrame(() => {
      if (live.current.entries.length > 0) {
        restoreKeyboardViewFocus(live.current.scanMode)
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
      physicalCloneAccountingUncertain ||
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
      const invalidatedTabs = tabs
      if (invalidatedTabs.length) {
        setTabs((items) =>
          items.filter(
            (tab) => !invalidatedTabs.some((stale) => stale.id === tab.id)
          )
        )
        for (const tab of invalidatedTabs) {
          if (tab.sessionID && !volumeScanJobs[tab.sessionID])
            void disk?.stopWatching(tab.sessionID)
        }
      }
      // Completed volume cards retain their own scan roots too. Remove those
      // snapshots rather than exposing a parked deep inventory after a global
      // accounting invalidation.
      const invalidatedVolumeJobs = volumeJobs.filter((job) => !!job.tree)
      for (const job of invalidatedVolumeJobs) {
        dropVolumeJob(job.id)
        void disk?.stopWatching(job.id)
      }
      void live.current.rescanCurrent(true).then(restoreFocusAfterDeletion)
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
            browseHistory: diskPathEquals(
              nextView.path,
              tab.view.path,
              platform.os
            )
              ? tab.browseHistory
              : transitionDiskBrowseHistory(EMPTY_DISK_BROWSE_HISTORY, {
                  type: "reset",
                  path: nextView.path,
                }),
          },
        ]
      })
    )

    // A completed volume card keeps its own retained map. Patch it here too,
    // or reopening the volume would resurrect the deleted subtrees.
    for (const job of volumeJobs) {
      if (!job.tree) continue
      const tree = removeScanSubtrees(job.tree, removed, platform.os)
      if (tree && tree !== job.tree) patchVolumeJob(job.id, { tree })
    }

    const root = treeRoot
    const view = viewNode
    if (!root || !view) return
    const tree = removeScanSubtrees(root, removed, platform.os)
    if (!tree) {
      backToDrives(false)
      restoreFocusAfterDeletion()
      return
    }
    if (tree === root) return
    const nextView = viewAfterDeletion(root, tree, view, removed)
    setTreeRoot(tree)
    setViewNode(nextView)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    if (!diskPathEquals(nextView.path, view.path, platform.os))
      browseHistory.reset(nextView.path)
    restoreFocusAfterDeletion()
  }

  async function trashNode(node: DiskScanNode) {
    const api = disk
    if (!api) return
    if (!ensureCleanupProtectionsReady()) return
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
      assertCleanupProtectionsReady(
        cleanupProtectionsReady(),
        language.t("disk.cleanup.protectionsUnavailable")
      )
      const prepared = await api.authorizeDeletePaths([node.path])
      const authorization = resolveDeleteAuthorization(
        prepared,
        node.path,
        language.t("disk.toast.authorizationMismatch")
      )
      await api.deletePath(node.path, {
        authorization,
        historyMetadata: {
          estimatedBytes: node.size,
          kind: node.isDir ? "directory" : "file",
        },
        ...(deepDeletePrecondition
          ? { precondition: deepDeletePrecondition }
          : {}),
      })
      setCleanupPlanNeedsRecheck(
        requiresDeepInventoryRefresh([node]) ||
          physicalCloneAccountingUncertain ||
          containsSharedPhysicalStorage(node)
      )
      live.current.applyDeletedNodes([node])
      setCleanupResults([{ node, status: "moved" }])
      setCleanupResultsOpen(true)
    } catch (err) {
      setCleanupPlanNeedsRecheck(false)
      setCleanupResults([
        {
          node,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        },
      ])
      setCleanupResultsOpen(true)
    } finally {
      setDeleting(false)
    }
  }

  async function confirmDelete() {
    const node = pendingDelete
    if (!node) return
    deleteSurface.closeThen(() => setPendingDelete(null))
    await trashNode(node)
  }

  function requestDelete(node: DiskScanNode) {
    if (!ensureCleanupProtectionsReady()) return
    if (inventoryDeletionNeedsRescan(node)) {
      showDeveloperArtifactRescanGuidance(node)
      return
    }
    if (!canModifyNode(node)) {
      const lock = cleanupLockForPath(node.path, cleanupLocks, platform.os)
      showToast({
        variant: "default",
        title: lock
          ? language.t("disk.toast.cleanupProtected")
          : language.t("disk.toast.protectedItem"),
        description: lock
          ? cleanupLockMessage(lock)
          : language.t("disk.toast.protectedBody"),
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
    const replacedChildren = collection.filter(
      (item) =>
        !diskPathEquals(item.path, node.path, platform.os) &&
        diskPathIsWithin(item.path, node.path, platform.os)
    )
    if (replacedChildren.length)
      showToast({
        variant: "default",
        title: language.t("disk.review.parentReplaces", {
          name: itemIdentity(node).reviewTitle,
          count: replacedChildren.length,
        }),
      })
    setCollection((prev) => {
      const exists = prev.some((item) =>
        diskPathEquals(item.path, node.path, platform.os)
      )
      return exists
        ? prev.filter(
            (item) => !diskPathEquals(item.path, node.path, platform.os)
          )
        : uniqueDeletionRoots([...prev, node], platform.os)
    })
  }

  function collectNodes(nodes: readonly DiskScanNode[]) {
    const actionable = nodes.filter(canModifyNode)
    if (!actionable.length) return
    setCollection((prev) =>
      uniqueDeletionRoots([...prev, ...actionable], platform.os)
    )
  }

  function selectEligibleDeveloperResults() {
    const candidates = smartCleanupCandidates
    if (!candidates.length) return
    collectNodes(candidates)
    collectionSurface.open()
  }

  function removeCollected(node: DiskScanNode) {
    const next = collection.filter(
      (item) => !diskPathEquals(item.path, node.path, platform.os)
    )
    setCollection(next)
    if (!uniqueDeletionRoots(next, platform.os).length)
      collectionSurface.close()
  }

  function canDragNode(node: DiskScanNode) {
    return !node.isHidden && !node.isOther
  }

  function cleanupRestriction(node: DiskScanNode): DiskLanguageKey | null {
    if (!cleanupProtectionsReady()) return "disk.cleanup.protectionsUnavailable"
    if (node.isOther || node.isHidden) return "disk.cleanup.summaryRestricted"
    if (isPathCleanupLocked(node.path, cleanupLocks, platform.os))
      return "disk.detail.protectedByYou"
    if (!canActOnNode(node, platform.os, []))
      return "disk.cleanup.locationRestricted"
    if (inventoryDeletionNeedsRescan(node)) return "disk.cleanup.needsFreshScan"
    if (selectedAccess?.path === node.path && selectedAccess.state === "denied")
      return "disk.cleanup.accessDenied"
    if (
      selectedAccess?.path === node.path &&
      selectedAccess.state === "read-only"
    )
      return "disk.cleanup.readOnly"
    const recognition = investigation.recognitionFor(node)
    // Ambiguous build/target/dist records may be individually moved through
    // the confirmation + Trash flow, but are never Smart Cleanup defaults.
    if (
      recognition.developer &&
      developerArtifactCleanupReadiness(recognition) === "review"
    )
      return null
    if (recognition.safety === "system") return "disk.cleanup.systemRestricted"
    if (recognition.safety === "version-control")
      return "disk.cleanup.managedRestricted"
    return null
  }

  function canModifyNode(node: DiskScanNode) {
    return cleanupRestriction(node) === null
  }

  function inventoryDeletionNeedsRescan(node: DiskScanNode) {
    return (
      isDeveloperInventoryNode(node) &&
      !developerInventoryDeletePrecondition(node)
    )
  }

  function isDeveloperArtifactPreconditionRejection(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return message.includes(
      "Artifact changed since scan — rescan before moving it to Trash."
    )
  }

  function showDeveloperArtifactRescanGuidance(
    node: DiskScanNode,
    reason: "missing-identity" | "changed" = "missing-identity"
  ) {
    showToast({
      variant: "default",
      title:
        reason === "changed"
          ? language.t("disk.toast.artifactChanged")
          : language.t("disk.toast.rescanRemoval"),
      description:
        reason === "changed"
          ? language.t("disk.toast.changedBody", {
              name: node.name,
              trash: nativeTrashName(platform.os),
            })
          : language.t("disk.toast.missingIdentityBody", {
              name: node.name,
              trash: nativeTrashName(platform.os),
            }),
      actions: [
        {
          label: language.t("disk.common.rescan"),
          onClick: () => void live.current.rescanCurrent(true),
        },
      ],
    })
  }
  const isCollected = (path: string) =>
    collection.some((node) => diskPathEquals(node.path, path, platform.os))
  const coveringCollectedNode = (path: string) =>
    collection.find(
      (node) =>
        !diskPathEquals(node.path, path, platform.os) &&
        diskPathIsWithin(path, node.path, platform.os)
    )
  function clearCollection() {
    setCollection([])
    setRangeAnchorIndex(undefined)
  }

  function showDragToken(node: DiskScanNode, x: number, y: number) {
    const segment = sunburstRef.current?.segments.find(
      (segment) => segment.path === node.path
    )
    const color =
      scanMode === "grid"
        ? tileColor(node.path)
        : segment?.tone
          ? `oklch(${segment.tone.L} ${segment.tone.C} ${segment.hue})`
          : undefined
    showCollectionDragPreview(
      collectionDragPreviewRef.current!,
      node.name,
      shortBytes(node.size),
      color ?? tileColor(node.path) ?? primarySegmentColor(0, 1, true)
    )
    moveCollectionDragPreview(collectionDragPreviewRef.current!, x, y)
  }
  useEffect(() => {
    const move = (event: DragEvent) => {
      if (
        collectionDragPreviewRef.current?.children.length &&
        (event.clientX || event.clientY)
      )
        moveCollectionDragPreview(
          collectionDragPreviewRef.current,
          event.clientX,
          event.clientY
        )
    }
    document.addEventListener("dragover", move)
    return () => document.removeEventListener("dragover", move)
  }, [])

  function beginCollectionDrag(event: DragEvent, node: DiskScanNode | null) {
    if (!node || !canDragNode(node) || !event.dataTransfer) {
      event.preventDefault()
      return
    }
    setCollectionDragNode(node)
    setCollectionDropActive(false)
    event.dataTransfer.effectAllowed = "copy"
    event.dataTransfer.setData("application/x-disklizard-path", node.path)
    event.dataTransfer.setData("text/plain", node.path)
    showDragToken(node, event.clientX, event.clientY)
    // The browser snapshot cannot animate. Hide it and move our shared token
    // with document dragover, just as the map's pointer drag does.
    const blank = document.createElement("canvas")
    blank.width = blank.height = 1
    collectionDragPreviewRef.current!.append(blank)
    event.dataTransfer.setDragImage(blank, 0, 0)
  }

  function endCollectionDrag() {
    if (collectionDragPreviewRef.current)
      hideCollectionDragPreview(collectionDragPreviewRef.current)
    const mapDrag = mapDragRef.current
    if (mapDrag && canvasEl?.hasPointerCapture(mapDrag.pointerId))
      canvasEl.releasePointerCapture(mapDrag.pointerId)
    if (canvasEl) canvasEl.style.cursor = ""
    mapDragRef.current = undefined
    setCollectionDragNode(null)
    setCollectionDropActive(false)
  }
  useEffect(() => {
    // Navigation can unmount the drag source before its pointerup/dragend fires.
    // The preview lives above the workspace, so clear it on every surface change.
    if (collectionDragPreviewRef.current?.children.length || mapDragRef.current)
      endCollectionDrag()
  }, [view, scanMode, indexFilter.lens, canvasEl])

  function beginMapDrag(event: CanvasPointerEvent) {
    if (event.button !== 0 || morphing) return
    const node = sunburstRef.current?.nodeAtPoint(event.clientX, event.clientY)
    if (!node || !canDragNode(node)) {
      mapDragRef.current = undefined
      return
    }
    mapDragRef.current = {
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
    const drag = mapDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (
      !drag.dragging &&
      Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) <
        drag.threshold
    )
      return
    if (!drag.dragging) {
      drag.dragging = true
      sunburstRef.current?.suppressNextClick()
      event.currentTarget.style.cursor = "grabbing"
      setCollectionDragNode(drag.node)
      showDragToken(drag.node, event.clientX, event.clientY)
    }
    moveCollectionDragPreview(
      collectionDragPreviewRef.current!,
      event.clientX,
      event.clientY
    )
    setCollectionDropActive(
      canModifyNode(drag.node) &&
        pointerInsideCollectionTarget(event.clientX, event.clientY)
    )
    event.preventDefault()
  }

  function pointerInsideCollectionTarget(x: number, y: number) {
    const rect = collectionDropElementRef.current?.getBoundingClientRect()
    return (
      !!rect &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    )
  }

  function finishMapDrag(event: CanvasPointerEvent, cancelled = false) {
    const drag = mapDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.dragging) {
      if (
        !cancelled &&
        canModifyNode(drag.node) &&
        pointerInsideCollectionTarget(event.clientX, event.clientY)
      )
        collectNodes([drag.node])
      endCollectionDrag()
      event.preventDefault()
    }
    mapDragRef.current = undefined
  }

  function collectionDragEnter(event: DragEvent) {
    if (!collectionDragNode || !canModifyNode(collectionDragNode)) return
    event.preventDefault()
    event.stopPropagation()
    setCollectionDropActive(true)
  }

  function collectionDragOver(event: DragEvent) {
    if (!collectionDragNode || !canModifyNode(collectionDragNode)) return
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
    setCollectionDropActive(true)
  }

  function collectionDragLeave(event: DragEvent) {
    if (!collectionDragNode) return
    event.stopPropagation()
    const next = event.relatedTarget
    // The native event's currentTarget is the delegated React root, so the
    // v1 "still inside the drop target" test resolves against the element
    // the page registered via CollectionDropTarget's setElement instead.
    const dropTarget = collectionDropElementRef.current
    if (
      next instanceof Node &&
      dropTarget instanceof HTMLElement &&
      dropTarget.contains(next)
    )
      return
    setCollectionDropActive(false)
  }

  function collectDroppedNode(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    const node = collectionDragNode
    if (node) collectNodes([node])
    endCollectionDrag()
  }
  async function deleteCollected() {
    const api = disk
    const items = effectiveCollection
    if (!api || !items.length) return
    if (!ensureCleanupProtectionsReady()) return
    setDeleting(true)
    setDeletionProgress({ completed: 0, total: items.length })
    try {
      const { removed, failed } = await executeAuthorizedDeletionBatch({
        nodes: items,
        os: platform.os,
        locks: cleanupLocks,
        cleanupProtectionsReady: cleanupProtectionsReady(),
        currentCleanupLocks: () => live.current.cleanupLocks,
        currentCleanupProtectionsReady: () =>
          live.current.cleanupProtectionsReady(),
        cleanupProtectionsUnavailableMessage: language.t(
          "disk.cleanup.protectionsUnavailable"
        ),
        cleanupProtectionChangedMessage: language.t(
          "disk.cleanup.protectionsChanged"
        ),
        authorize: (paths) => api.authorizeDeletePaths(paths),
        authorizationMismatchMessage: language.t(
          "disk.toast.authorizationMismatch"
        ),
        remove: async (node, authorization) => {
          const deepDeletePrecondition =
            developerInventoryDeletePrecondition(node)
          if (isDeveloperInventoryNode(node) && !deepDeletePrecondition) {
            throw new Error(language.t("disk.toast.deepIdentity"))
          }
          return api.deletePath(node.path, {
            authorization,
            historyMetadata: {
              estimatedBytes: node.size,
              kind: node.isDir ? "directory" : "file",
            },
            ...(deepDeletePrecondition
              ? { precondition: deepDeletePrecondition }
              : {}),
          })
        },
        onSettled: (completed, total) =>
          setDeletionProgress({ completed, total }),
      })
      const deepInventoryNeedsRefresh =
        removed.length > 0 && live.current.requiresDeepInventoryRefresh(removed)
      const knownSharedStorage = removed.some(containsSharedPhysicalStorage)
      const invalidatesAllMaps =
        deepInventoryNeedsRefresh ||
        knownSharedStorage ||
        (removed.length > 0 && live.current.physicalCloneAccountingUncertain)
      if (removed.length) {
        live.current.applyDeletedNodes(removed)
      }
      const retryableFailures = failed.filter(
        ({ node, error }) =>
          !isDeveloperInventoryNode(node) ||
          (!inventoryDeletionNeedsRescan(node) &&
            !isDeveloperArtifactPreconditionRejection(error))
      )
      // A global map rebuild invalidates every retained tree. Do not put failed
      // rows from that old map back into the basket; the rebuilt map is the
      // next safe source of truth.
      setCollection(
        invalidatesAllMaps ? [] : retryableFailures.map(({ node }) => node)
      )
      setCleanupPlanNeedsRecheck(invalidatesAllMaps)
      collectionSurface.close()
      setCleanupResults([
        ...removed.map((node): CleanupOutcome => ({ node, status: "moved" })),
        ...failed.map(({ node, error }): CleanupOutcome => ({
          node,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        })),
      ])
      setCleanupResultsOpen(true)
    } catch (error) {
      setCleanupPlanNeedsRecheck(false)
      setCleanupResults(
        items.map((node) => ({
          node,
          status: "failed" as const,
          error: error instanceof Error ? error.message : String(error),
        }))
      )
      collectionSurface.close()
      setCleanupResultsOpen(true)
    } finally {
      setDeleting(false)
      setDeletionProgress(null)
    }
  }

  function onDragEnter(event: ReactDragEvent) {
    if (activeDialog || !event.dataTransfer?.types.includes("Files")) return
    event.preventDefault()
    dragDepthRef.current++
    setDropActive(true)
  }

  function onDragOver(event: ReactDragEvent) {
    if (!event.dataTransfer?.types.includes("Files")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
  }

  function onDragLeave(event: ReactDragEvent) {
    if (!event.dataTransfer?.types.includes("Files")) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDropActive(false)
  }

  async function onDrop(event: ReactDragEvent) {
    event.preventDefault()
    dragDepthRef.current = 0
    setDropActive(false)
    if (activeDialog) return
    const file = event.dataTransfer?.files.item(0)
    const path = file && platform.getPathForFile?.(file)
    if (!file || !path) {
      showToast({
        variant: "error",
        title: language.t("disk.toast.readDroppedFailed"),
      })
      return
    }
    if ((event.dataTransfer?.files.length ?? 0) > 1) {
      showToast({
        variant: "default",
        title: language.t("disk.toast.scanningFirstDrop"),
        description: file.name,
      })
    }
    await startScan(
      path,
      file.name || path.split(/[/\\]/).pop() || path,
      driveForPath(path, drives, platform.os)
    )
  }

  // Shortcuts popover: Escape and any outside pointer press dismiss it.
  function closeShortcutsPopover() {
    if (!shortcutsDetailsRef.current) return
    shortcutsDetailsRef.current.open = false
    setShortcutsOpen(false)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !live.current.shortcutsOpen) return
      e.preventDefault()
      e.stopImmediatePropagation()
      closeShortcutsPopover()
      shortcutsDetailsRef.current?.querySelector("summary")?.focus()
    }
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        shortcutsDetailsRef.current?.contains(event.target)
      )
        return
      if (live.current.shortcutsOpen) closeShortcutsPopover()
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("pointerdown", onPointerDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("pointerdown", onPointerDown)
    }
  }, [])

  function handleScanUpdate(update: DiskScanUpdate) {
    if (scanHistory.record(update))
      setHistoryEntries([...scanHistory.entries()])
    if (update.watchError && update.watchError !== lastWatchErrorRef.current) {
      lastWatchErrorRef.current = update.watchError
      showToast({
        variant: "error",
        title: language.t("disk.toast.livePaused"),
        description: language.t("disk.toast.livePausedBody", {
          message: update.watchError,
        }),
        actions: [
          {
            label: language.t("disk.common.rescan"),
            onClick: () => void live.current.rescanCurrent(true),
          },
        ],
      })
    } else if (!update.watchError) {
      lastWatchErrorRef.current = undefined
    }
    const job = volumeScanJobs[update.scanId]
    if (job) {
      const tree = scanUpdateTree(update.root, job.drive, job.label)
      // The volume card's byte readout must track the refreshed map, not the
      // count captured at completion time.
      patchVolumeJob(update.scanId, {
        tree,
        ...(job.status === "complete" ? { bytes: tree.size } : {}),
      })
    }

    // Watchers keep running for parked tabs. Give a matching background tab
    // the fresh root (including its new immutable deep inventory) before it
    // can be reopened, and rebase only basket entries scoped to that map.
    const updatedTabs = tabs.filter((tab) => tab.sessionID === update.scanId)
    if (updatedTabs.length) {
      setTabs((items) =>
        refreshScanTabsForWatcherUpdate(
          items,
          update.scanId,
          (tab) => scanUpdateTree(update.root, tab.drive, tab.label),
          platform.os
        )
      )
      for (const tab of updatedTabs) {
        reconcileCollectionForScanUpdate(
          scanUpdateTree(update.root, tab.drive, tab.label),
          update.rootPath
        )
      }
    }

    if (
      update.scanId !== scanSession.activeID ||
      view !== "scan" ||
      !diskPathEquals(update.rootPath, scanSourcePath, platform.os)
    )
      return
    const tree = scanUpdateTree(
      update.root,
      job?.drive ?? scanDrive,
      job?.label ?? (scanLabel || update.root.name)
    )
    const previousViewPath = viewNode?.path
    const previousSelection = selectedPath
    const nextView = previousViewPath
      ? (groupNavigation.resolve(tree, previousViewPath) ??
        findScanNode(tree, previousViewPath))
      : undefined
    const nextSelection = previousSelection
      ? findScanNode(tree, previousSelection)
      : undefined
    setTreeRoot(tree)
    setViewNode(nextView ?? tree)
    setSelectedPath(nextSelection?.path)
    setHoveredPath(null)
    reconcileCollectionForScanUpdate(tree, update.rootPath)
    if (!nextView) browseHistory.reset(tree.path)
  }

  function applyDriveFacts(update: DiskDriveFactsUpdate) {
    receivedDriveFactsRef.current = [
      ...receivedDriveFactsRef.current.filter(
        (candidate) => !diskPathEquals(candidate.path, update.path, platform.os)
      ),
      update,
    ]
    setDrives((current) =>
      current.map((drive) =>
        diskPathEquals(drive.path, update.path, platform.os)
          ? { ...drive, ...update.facts }
          : drive
      )
    )
  }

  // Keyboard navigation
  function handleGlobalKeyDown(e: KeyboardEvent) {
    if (activeDialog) {
      if (e.defaultPrevented || e.key !== "Escape") return
      e.preventDefault()
      if (deleting) return
      if (cleanupResetSurface.mounted) cleanupResetSurface.close()
      else if (deleteSurface.mounted)
        deleteSurface.closeThen(() => setPendingDelete(null))
      else if (collectionSurface.mounted) collectionSurface.close()
      else if (reviewSurface.mounted) reviewSurface.close()
      else preview.close()
      return
    }
    if (
      view === "scan" &&
      !scanning &&
      (e.metaKey || e.ctrlKey) &&
      !e.altKey &&
      e.key.toLowerCase() === "f"
    ) {
      e.preventDefault()
      openSearch()
      return
    }
    if (!shouldHandleDiskShortcut(e.target, e.defaultPrevented)) return
    if (view !== "scan") return
    const supportsRangeNavigation = !e.metaKey && !e.ctrlKey && !e.altKey
    const isPlainShortcut = supportsRangeNavigation && !e.shiftKey
    if (scanning) {
      if (isPlainShortcut && (e.key === "Escape" || e.key === "Backspace")) {
        e.preventDefault()
        cancelScan()
        cancelArmedAtRef.current = 0
      }
      return
    }
    if (
      e.altKey &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.shiftKey &&
      (e.key === "ArrowLeft" || e.key === "ArrowRight")
    ) {
      e.preventDefault()
      browseHistory.move(e.key === "ArrowLeft" ? "back" : "forward")
      return
    }
    if (
      supportsRangeNavigation &&
      (e.key === "ArrowDown" ||
        e.key === "ArrowUp" ||
        (isPlainShortcut && (e.key === "j" || e.key === "k")))
    ) {
      e.preventDefault()
      moveFocus(e.key === "ArrowDown" || e.key === "j" ? 1 : -1, e.shiftKey)
      return
    }
    if (
      supportsRangeNavigation &&
      (e.key === "PageDown" || e.key === "PageUp")
    ) {
      e.preventDefault()
      moveFocusByPage(
        e.key === "PageDown" ? 1 : -1,
        listPageSizeRef.current(),
        e.shiftKey
      )
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
      if (preview.supportsSystemPreview()) {
        void preview.openSystemPreview(node)
        return
      }
      void preview.show(node)
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
      void toggleProtectedTree(node.path, node.name)
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
      chooseScanMode("icicle", "keyboard")
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => live.current.handleGlobalKeyDown(e)
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  // (Re)create the sunburst when its canvas mounts. The canvas persists across
  // map⇄grid now, so this runs once per mount — never rebuild for a mode switch.
  useEffect(() => {
    const el = canvasEl
    if (!el) {
      sunburstRef.current = undefined
      morphRef.current?.abort()
      morphRef.current = null
      return () => undefined
    }
    if (sunburstRef.current) return () => undefined
    const sb = new Sunburst(el, {
      rings: 8,
      maxSegments: 720,
      padAngle: 0.001,
      ringGap: 0.0025,
      enterAnimMs: sunburstEntryDuration(orbitEntryIntentRef.current),
      canDrag: (node) => live.current.canDragNode(node),
      onHover: (seg) => {
        live.current.handleMapHover(seg?.node ?? null)
      },
      onClick: (seg) => {
        if (seg.node.isOther || seg.node.isDir) live.current.drill(seg.node)
        else live.current.selectPath(seg.path)
      },
      onCenterClick: () => live.current.goUpFromMapCenter(),
    })
    sb.setQueuedPaths(live.current.effectiveCollection.map((node) => node.path))
    sb.setExcludedPaths(live.current.projectedPaths)
    const root = live.current.treeRoot
    if (root)
      sb.setData(
        root,
        live.current.viewNode,
        orbitEntryIntentRef.current === "keyboard"
      )
    orbitEntryIntentRef.current = "scan-complete"
    sunburstRef.current = sb
    return () => {
      sb.destroy()
      if (sunburstRef.current === sb) sunburstRef.current = undefined
    }
  }, [canvasEl])

  // Re-feed data when a fresh scan completes while the canvas is already mounted.
  useEffect(() => {
    const root = treeRoot
    const sb = sunburstRef.current
    if (root && sb && sb.root !== root) sb.updateData(root, viewNode)
  }, [treeRoot, viewNode, canvasEl])

  useEffect(
    () => () => {
      scanUnsubRef.current?.()
      volumeScanUnsubsRef.current.forEach((unsubscribe) => unsubscribe())
      volumeScanUnsubsRef.current.clear()
      scanUpdateUnsubRef.current?.()
      driveFactsUnsubRef.current?.()
      scanTokenRef.current++
      void disk?.cancelScan()
      void disk?.stopWatching()
      sunburstRef.current?.destroy()
      clearTimeout(selectionAnnouncementTimerRef.current)
    },
    []
  )

  useEffect(
    () => () => {
      ++viewTransitionVersionRef.current
      morphRef.current?.abort()
    },
    []
  )

  // Controller options stay stable for the factories' lifetime; each one
  // forwards through a ref that is repointed to the render-fresh snapshot
  // below, so late commands always observe current state. The preview entries
  // cache keeps one array identity per entries generation.
  const previewEntriesCacheRef = useRef<
    { entries: Entry[]; nodes: DiskScanNode[] } | undefined
  >(undefined)
  const browseResolveRef = useRef<(path: string) => DiskScanNode | undefined>(
    () => undefined
  )
  const browseBlockedRef = useRef<() => boolean>(() => false)
  const browseOnMoveRef = useRef<(node: DiskScanNode) => void>(() => undefined)
  const previewApiRef = useRef<() => DiskUtilityAPI | undefined>(
    () => undefined
  )
  const previewEntriesRef = useRef<() => DiskScanNode[]>(() => [])
  const previewIsPathCurrentRef = useRef<(path: string) => boolean>(() => false)
  const previewSelectRef = useRef<(path: string) => void>(() => undefined)
  const browseHistory = useMemo(
    () =>
      createDiskBrowseHistoryController({
        equals: (left, right) => diskPathEquals(left, right, platform.os),
        resolve: (path) => browseResolveRef.current(path),
        blocked: () => browseBlockedRef.current(),
        onMove: (node) => browseOnMoveRef.current(node),
      }),
    []
  )
  const browseHistoryView = useSyncExternalStore(
    browseHistory.subscribe,
    browseHistory.history
  )

  const preview = useMemo(
    () =>
      createDiskPreviewController({
        api: () => previewApiRef.current(),
        entries: () => previewEntriesRef.current(),
        isPathCurrent: (path) => previewIsPathCurrentRef.current(path),
        os: platform.os,
        select: (path) => previewSelectRef.current(path),
        onOperationError: (operation, message) => {
          showToast({
            variant: "error",
            title: language.t(
              operation === "open"
                ? "disk.toast.openFileFailed"
                : "disk.toast.quickLookFailed"
            ),
            description: message,
          })
        },
      }),
    []
  )
  // The preview view is parameterized by the page's entry list, which the
  // controller store cannot observe: a bare useSyncExternalStore would see an
  // unnotified snapshot change whenever entries moves and warn/loop. Re-read
  // on every notification AND on each entries generation instead.
  const [previewView, setPreviewView] = useState<DiskPreviewView>(() =>
    preview.view()
  )
  useEffect(() => {
    const update = () => setPreviewView(preview.view())
    update()
    return preview.subscribe(update)
  }, [preview, entries])

  useEffect(() => {
    preview.reconcile()
  }, [preview, treeRoot])

  useEffect(() => () => preview.dispose(), [preview])

  const activeDialog = cleanupResultsOpen
    ? "cleanup-results"
    : cleanupResetSurface.mounted
      ? "cleanup-reset"
      : deleteSurface.mounted
        ? "delete"
        : collectionSurface.mounted
          ? "collection"
          : reviewSurface.mounted
            ? "reclaim"
            : previewView.mounted
              ? "preview"
              : null

  useEffect(() => {
    if (!activeDialog) return undefined
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    return () => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    }
  }, [activeDialog])

  useEffect(() => {
    const unbindMenu = platform.menu?.register(DISK_CHOOSE_FOLDER_COMMAND, () =>
      live.current.chooseAndScan()
    )
    const unbindRescan = platform.menu?.register("disk.rescan", () => {
      if (!live.current.scanning) void live.current.rescanCurrent()
    })
    const api = disk
    const cleanupMenus = () => {
      unbindMenu?.()
      unbindRescan?.()
    }
    if (!api) return cleanupMenus
    driveFactsUnsubRef.current = api.onDriveFacts((update) =>
      live.current.applyDriveFacts(update)
    )
    void live.current.loadDrives()
    const refreshVolumes = () => {
      if (
        live.current.view === "drives" &&
        document.visibilityState === "visible"
      )
        void live.current.loadDrives(true)
    }
    const refreshTimer = setInterval(refreshVolumes, 30000)
    window.addEventListener("focus", refreshVolumes)
    scanUpdateUnsubRef.current = api.onScanUpdate((update) =>
      live.current.handleScanUpdate(update)
    )
    return () => {
      cleanupMenus()
      clearInterval(refreshTimer)
      window.removeEventListener("focus", refreshVolumes)
    }
  }, [])

  // Every late-invoked callback (IPC subscriptions, toasts, timers, rAF,
  // controller commands) resolves through this render-fresh snapshot so a
  // closure captured in an earlier render never observes stale state.
  const liveValues = {
    view,
    scanMode,
    scanning,
    drives,
    treeRoot,
    viewNode,
    scanSourcePath,
    scanLabel,
    scanDrive,
    selectedPath,
    focusIdx,
    canvasEl,
    indexFilter,
    parentSize,
    indexSize,
    entries,
    investigation,
    physicalCloneAccountingUncertain,
    pinnedLocations,
    cleanupLocks,
    cleanupLocksStatus,
    cleanupProtectionsReady,
    disk,
    deleting,
    focusedScan,
    shortcutsOpen,
    tabs,
    scanSession,
    volumeScanJobs,
    volumeJobs,
    collection,
    effectiveCollection,
    projectedPaths,
    chooseAndScan,
    scanStorageLocation,
    openDiskAccessSettings,
    startVolumeScan,
    runVolumeScan,
    cancelVolumeScan,
    closeVolumeScan,
    openVolumeScan,
    saveCurrentTab,
    switchToTab,
    closeTab,
    startScan,
    expandFocusedNode,
    expandOtherNode,
    rescanCurrent,
    cancelScan,
    drill,
    chooseLens,
    clearCurrentHistory,
    chooseDeveloperCategory,
    chooseDeveloperEcosystem,
    chooseDeveloperCleanupAge,
    setCustomDeveloperCleanupAgeDays,
    updateQuery,
    chooseScanMode,
    applyScanMode,
    updateSort,
    restoreKeyboardViewFocus,
    focusScanProgress,
    focusAfterScanCompletion,
    togglePinnedLocation,
    toggleProtectedTree,
    goUp,
    goUpFromMapCenter,
    backToDrives,
    goToCrumb,
    focusListEntry,
    selectPath,
    selectEntry,
    hoverEntry,
    handleMapHover,
    moveFocus,
    moveFocusByPage,
    moveFocusToBoundary,
    focusedEntryNode,
    openFocused,
    handleEntryKeyDown,
    reveal,
    openTrash,
    handleUpdaterMenuAction,
    exportDiagnostics,
    restoreFocusAfterDeletion,
    applyDeletedNodes,
    trashNode,
    confirmDelete,
    requestDelete,
    toggleCollect,
    collectNodes,
    selectEligibleDeveloperResults,
    removeCollected,
    canModifyNode,
    canDragNode,
    isCollected,
    clearCollection,
    beginCollectionDrag,
    endCollectionDrag,
    beginMapDrag,
    moveMapDrag,
    finishMapDrag,
    collectionDragEnter,
    collectionDragOver,
    collectionDragLeave,
    collectDroppedNode,
    deleteCollected,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    showBrowseNode,
    requiresDeepInventoryRefresh,
    currentScanTabState,
    loadDrives,
    loadStorageDiagnostics,
    handleScanUpdate,
    applyDriveFacts,
    handleGlobalKeyDown,
    volumeJobForDrive,
    browseHistory,
    preview,
    browseHistoryView,
  }
  const live = useRef(liveValues)
  live.current = liveValues
  browseResolveRef.current = (path) => {
    const root = live.current.treeRoot
    return root
      ? (groupNavigation.resolve(root, path) ?? findScanNode(root, path))
      : undefined
  }
  browseOnMoveRef.current = (node) => live.current.showBrowseNode(node)
  browseBlockedRef.current = () => live.current.scanning
  previewEntriesRef.current = () => {
    // One array identity per entries generation: the preview controller keys
    // its cached view on this array, so a fresh map per call would defeat the
    // useSyncExternalStore snapshot cache and loop React.
    const current = live.current.entries
    if (
      !previewEntriesCacheRef.current ||
      previewEntriesCacheRef.current.entries !== current
    ) {
      previewEntriesCacheRef.current = {
        entries: current,
        nodes: current.map(({ node }) => node),
      }
    }
    return previewEntriesCacheRef.current.nodes
  }
  previewApiRef.current = () => live.current.disk

  previewIsPathCurrentRef.current = (path) => {
    const root = live.current.treeRoot
    return (
      !!root &&
      (!!findScanNode(root, path) ||
        !!root.developerArtifactInventory?.items.some((item) =>
          diskPathEquals(item.path, path, platform.os)
        ))
    )
  }
  previewSelectRef.current = (path) => live.current.selectPath(path)
  // Named once so JSX conditionals never rely on control-flow narrowing of
  // `scanMode` / `platform.os` inside a branch that already constrained them.
  const showNativeAppMenu = platform.os !== "macos"
  const mapModeActive = scanMode === "map"
  const gridModeActive = scanMode === "grid"
  const cleanupWorkspace =
    indexFilter.lens === "developer" || indexFilter.lens === "recommendations"
  const showLandscape =
    scanMode !== "list" && (!cleanupWorkspace || !cleanupMapCollapsed)
  const workspaceTab =
    recentLens || indexFilter.lens === "changes"
      ? "changes"
      : cleanupWorkspace
        ? "cleanup"
        : "all"
  const searchVisible = workspaceTab !== "all" || searchOpen || !!query.trim()
  const showVolumeCapacity =
    !!scanDrive &&
    !!treeRoot &&
    !!viewNode &&
    diskPathEquals(viewNode.path, scanDrive.path, platform.os) &&
    indexFilter.lens === "all" &&
    !query.trim()
  const hoverPreviewVisible =
    workspaceTab === "all" &&
    scanMode === "map" &&
    !query.trim() &&
    !!hoverPreviewNode?.children?.length
  const changeWorkspaceTab = (value: "all" | "cleanup" | "changes") =>
    chooseLens(value === "cleanup" ? "developer" : value)

  return (
    <div
      className="dl-shell relative isolate flex size-full min-h-0 flex-col overflow-hidden bg-background-base font-(family-name:--font-family-text) text-text-base tabular-nums antialiased"
      data-os={platform.os}
      data-scan-source={scanCompletionSource}
      data-fullscreen={platform.windowFullscreen ? "true" : undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(event) => void onDrop(event)}
    >
      <style>{DISK_UTILITY_STYLES}</style>
      <div
        ref={(el) => {
          collectionDragPreviewRef.current = el
        }}
        className="pointer-events-none fixed -top-[9999px] -left-[9999px] z-[80] flex w-[76px] flex-col items-center font-sans text-xs leading-[1.2] font-semibold tabular-nums"
        aria-hidden="true"
      />

      {dropActive ? (
        <PopIn
          className="pointer-events-none absolute inset-3 z-60 grid place-items-center rounded-[26px] bg-background-base/88 shadow-[inset_0_0_0_2px_oklch(0.72_0.13_176/0.7),0_24px_80px_rgb(0_0_0/0.24)] backdrop-blur-xl"
          role="status"
          aria-live="polite"
          animate={{ opacity: 1, scale: 1, y: 0 }}
        >
          <div className="text-center">
            <Pulse className="mx-auto grid size-16 place-items-center rounded-full bg-[oklch(0.72_0.12_176/0.14)] text-[color-mix(in_oklch,var(--dl-accent-strong)_54%,var(--text-strong))]">
              <Icon name="folder-add-left" className="size-6" />
            </Pulse>
            <p className="text-20-medium mt-5 tracking-[-0.03em] text-text-strong">
              {language.t("disk.drop.title")}
            </p>
            <p className="text-12-regular mt-2 text-text-weak">
              {language.t("disk.drop.body")}
            </p>
          </div>
        </PopIn>
      ) : null}

      <header
        className="dl-topbar relative z-20 flex h-12 shrink-0 items-center gap-2 px-4"
        data-tauri-drag-region
        inert={activeDialog ? true : undefined}
        aria-hidden={activeDialog ? "true" : undefined}
      >
        {showNativeAppMenu ? (
          <DropdownMenu placement="bottom-start" gutter={6}>
            <DropdownMenu.Trigger
              as={Button}
              className="min-h-11 min-w-11"
              variant="ghost"
              size="small"
              icon="dot-grid"
              aria-label={language.t("disk.app.menu")}
            />
            <DropdownMenu.Portal>
              <DropdownMenu.Content>
                <DropdownMenu.Item disabled>
                  <DropdownMenu.ItemLabel>
                    {language.t("disk.app.about", {
                      version: platform.version ?? "",
                    })}
                  </DropdownMenu.ItemLabel>
                </DropdownMenu.Item>
                {view === "scan" && !scanning ? (
                  <>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      disabled={pinMutationPending}
                      onSelect={() =>
                        void togglePinnedLocation(scanSourcePath, scanLabel)
                      }
                    >
                      <DropdownMenu.ItemLabel>
                        {currentScanPinned
                          ? language.t("disk.top.unsave")
                          : language.t("disk.common.saveLocation")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      disabled={
                        deleting ||
                        !cleanupProtectionsReady() ||
                        cleanupLockMutationPending
                      }
                      onSelect={() =>
                        void toggleProtectedTree(scanSourcePath, scanLabel)
                      }
                    >
                      <DropdownMenu.ItemLabel>
                        {currentScanLocked
                          ? language.t("disk.top.unprotect")
                          : language.t("disk.top.protect")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </>
                ) : null}
                {platform.updater &&
                platform.updater.state.status !== "disabled" ? (
                  <>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      disabled={
                        platform.updater?.state.status === "checking" ||
                        platform.updater?.state.status === "downloading" ||
                        platform.updater?.state.status === "installing"
                      }
                      onSelect={() => void handleUpdaterMenuAction()}
                    >
                      <DropdownMenu.ItemLabel>
                        {(() => {
                          const state = platform.updater?.state
                          if (state?.status === "ready")
                            return language.t("disk.app.installUpdate", {
                              version: state.version,
                            })
                          if (state?.status === "checking")
                            return language.t("disk.app.updateChecking")
                          if (state?.status === "downloading")
                            return language.t("disk.app.updateDownloading", {
                              version: state.version,
                            })
                          if (state?.status === "installing")
                            return language.t("disk.app.installUpdate", {
                              version: state.version,
                            })
                          return language.t("disk.app.checkUpdates")
                        })()}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </>
                ) : null}
                {showNativeAppMenu && platform.exportDiagnostics ? (
                  <DropdownMenu.Item onSelect={() => void exportDiagnostics()}>
                    <DropdownMenu.ItemLabel>
                      {language.t("disk.app.exportDiagnostics")}
                    </DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                ) : null}
                {showNativeAppMenu && platform.restart ? (
                  <>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      onSelect={() => void platform.restart?.()}
                    >
                      <DropdownMenu.ItemLabel>
                        {language.t("disk.app.restart")}
                      </DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </>
                ) : null}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu>
        ) : null}

        {view === "scan" && crumbs.length > 0 && (
          <LocationNavigation
            locations={crumbs.map((crumb, index) => ({
              name: crumb.name,
              key: crumb.node?.path ?? String(index),
            }))}
            canBack={browseHistory.canMove("back")}
            canForward={browseHistory.canMove("forward")}
            onBack={() => browseHistory.move("back")}
            onForward={() => browseHistory.move("forward")}
            onHome={() => backToDrives(true)}
            onLocation={(index) => goToCrumb(crumbs[index])}
          />
        )}
        {view === "scan" && !scanning ? (
          <DiskUtilityWorkspaceMenu
            value={workspaceTab}
            onChange={changeWorkspaceTab}
            className="shrink-0"
          />
        ) : null}
      </header>

      {!cleanupProtectionsReady() ? (
        <div
          className="text-12-regular relative z-10 flex min-h-11 shrink-0 items-center gap-3 border-y border-icon-warning-base/35 bg-surface-warning-base/55 px-5 py-2 text-text-strong"
          role={cleanupLocksStatus === "error" ? "alert" : "status"}
          aria-live={cleanupLocksStatus === "error" ? "assertive" : "polite"}
          inert={activeDialog ? true : undefined}
          aria-hidden={activeDialog ? "true" : undefined}
        >
          <Icon
            name="shield"
            className="size-4 shrink-0 text-icon-warning-base"
          />
          <div className="min-w-0 flex-1">
            <span className="text-12-medium">
              {language.t(
                cleanupLocksStatus === "loading"
                  ? "disk.cleanup.protectionsLoadingTitle"
                  : cleanupLocksStatus === "saving"
                    ? "disk.cleanup.protectionsSavingTitle"
                    : "disk.cleanup.protectionsErrorTitle"
              )}
            </span>{" "}
            <span className="text-text-weak">
              {language.t(
                cleanupLocksStatus === "loading"
                  ? "disk.cleanup.protectionsLoading"
                  : cleanupLocksStatus === "saving"
                    ? "disk.cleanup.protectionsSaving"
                    : "disk.cleanup.protectionsError"
              )}
            </span>
          </div>
          {cleanupLocksStatus === "error" ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                className="min-h-11 min-w-11"
                variant="secondary"
                size="small"
                onClick={() =>
                  void settings.store.general.retryDiskCleanupLocks()
                }
              >
                {language.t("disk.cleanup.retryProtections")}
              </Button>
              <Button
                className="min-h-11 min-w-11"
                variant="ghost"
                size="small"
                onClick={() => cleanupResetSurface.open()}
              >
                {language.t("disk.cleanup.resetProtections")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <main
        className="relative min-h-0 flex-1 overflow-hidden"
        inert={activeDialog ? true : undefined}
        aria-hidden={activeDialog ? "true" : undefined}
      >
        {isDesktop ? (
          disk ? (
            <>
              {view === "drives" ? (
                <DriveOverview
                  drives={drives}
                  loading={drivesLoading}
                  error={drivesError}
                  runningScans={runningVolumeScans}
                  maxParallelScans={MAX_PARALLEL_VOLUME_SCANS}
                  diagnostics={storageDiagnostics}
                  diagnosticsError={storageDiagnosticsError}
                  openMaps={tabs}
                  pinnedLocations={pinnedLocations}
                  jobForDrive={volumeJobForDrive}
                  onChooseFolder={() => void chooseAndScan()}
                  onScanDrive={startVolumeScan}
                  onCancelDrive={cancelVolumeScan}
                  onOpenDrive={openVolumeScan}
                  onScanStorageLocation={scanStorageLocation}
                  onOpenAccessSettings={() => void openDiskAccessSettings()}
                  onRetryDiagnostics={() => void loadStorageDiagnostics()}
                  onOpenMap={(map) => {
                    switchToTab(map.id)
                  }}
                  onCloseMap={(map) => closeTab(map.id)}
                  onScanPinnedLocation={(location) =>
                    void startScan(
                      location.path,
                      location.label,
                      driveForPath(location.path, drives, platform.os)
                    )
                  }
                  onRemovePinnedLocation={(location) =>
                    void togglePinnedLocation(location.path, location.label)
                  }
                  cleanupLocks={cleanupLocks}
                  onUnlockCleanupLock={(location) =>
                    void toggleProtectedTree(location.path, location.label)
                  }
                />
              ) : null}

              {view === "scan" ? (
                !scanning ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <span
                      className="sr-only"
                      role="status"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {announcedSelection}
                    </span>
                    {tabs.length > 0 ? (
                      <div
                        className="flex shrink-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto px-4 pt-2 [&::-webkit-scrollbar]:hidden"
                        role="group"
                        aria-label={language.t("disk.drive.openMaps")}
                      >
                        <div className="flex max-w-[220px] min-w-0 shrink-0 items-center rounded-lg bg-surface-raised-base shadow-[inset_0_0_0_1px_rgb(127_127_127/0.22)]">
                          <span
                            className="flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-3 py-2"
                            aria-current="page"
                            title={scanSourcePath}
                          >
                            <span
                              className="size-1.5 shrink-0 rounded-full bg-[var(--dl-accent)]"
                              aria-hidden="true"
                            />
                            <span className="text-12-semibold truncate text-text-strong">
                              {scanLabel}
                            </span>
                          </span>
                        </div>
                        {tabs.map((tab) => (
                          <div
                            key={tab.id}
                            className="flex max-w-[220px] min-w-0 shrink-0 items-center rounded-lg bg-surface-raised-base/55 shadow-[0_0_0_1px_rgb(127_127_127/0.12)] hover:bg-surface-raised-base hover:text-text-strong"
                          >
                            <button
                              type="button"
                              data-disk-tab={tab.id}
                              className="flex min-h-11 min-w-11 flex-1 items-center gap-2 rounded-lg py-2 pr-1 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-text-weak focus-visible:ring-inset"
                              title={tab.sourcePath}
                              onClick={() => switchToTab(tab.id)}
                              onAuxClick={(event) => {
                                if (event.button === 1) {
                                  event.preventDefault()
                                  closeTab(tab.id)
                                }
                              }}
                            >
                              <span className="text-12-semibold truncate text-text-strong">
                                {tab.label}
                              </span>
                            </button>
                            <button
                              type="button"
                              className="mr-1 grid size-8 min-h-11 min-w-11 shrink-0 place-items-center rounded-full text-text-weaker opacity-55 transition-[color,opacity,background-color] duration-150 outline-none hover:bg-[color-mix(in_oklch,var(--background-base)_70%,transparent)] hover:text-text-strong hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-text-weak active:bg-background-base"
                              aria-label={language.t("disk.pinned.remove", {
                                name: tab.label,
                              })}
                              onClick={() => closeTab(tab.id)}
                            >
                              <Icon name="close-small" className="size-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div
                      className={cn(
                        "relative flex min-h-0 w-full flex-1 overflow-hidden bg-background-base max-[840px]:grid",
                        !showLandscape
                          ? "max-[840px]:grid-rows-[minmax(0,1fr)]"
                          : "max-[840px]:grid-rows-[minmax(220px,40%)_minmax(0,1fr)] max-[760px]:grid-rows-[240px_minmax(0,1fr)]"
                      )}
                    >
                      {effectiveCollection.length > 0 ||
                      collectionDragNode ||
                      cleanupResults.length > 0 ? (
                        <div className="absolute bottom-3 left-3 z-20 flex flex-col items-start gap-2 max-[840px]:top-3 max-[840px]:right-3 max-[840px]:bottom-auto max-[840px]:left-auto">
                          {effectiveCollection.length > 0 ||
                          collectionDragNode ? (
                            <CollectionDropTarget
                              setElement={(element) => {
                                collectionDropElementRef.current =
                                  element ?? undefined
                              }}
                              node={collectionDragNode}
                              acceptsNode={
                                !collectionDragNode ||
                                canModifyNode(collectionDragNode)
                              }
                              active={collectionDropActive}
                              count={effectiveCollection.length}
                              bytes={collectionSize}
                              hasSharedPhysicalStorage={
                                collectionHasSharedPhysicalStorage ||
                                (collectionDragNode
                                  ? containsSharedPhysicalStorage(
                                      collectionDragNode
                                    )
                                  : false)
                              }
                              hasUnverifiedPhysicalStorage={
                                physicalCloneAccountingUncertain
                              }
                              requiresDeepInventoryRefresh={
                                collectionNeedsDeepInventoryRefresh ||
                                (collectionDragNode
                                  ? requiresDeepInventoryRefresh([
                                      collectionDragNode,
                                    ])
                                  : false)
                              }
                              trashName={nativeTrashName(platform.os)}
                              onReview={() => collectionSurface.open()}
                              onDragEnter={collectionDragEnter}
                              onDragOver={collectionDragOver}
                              onDragLeave={collectionDragLeave}
                              onDrop={collectDroppedNode}
                            />
                          ) : null}
                          {cleanupResults.length > 0 ? (
                            <Button
                              size="small"
                              variant="secondary"
                              className="min-h-9"
                              onClick={() => setCleanupResultsOpen(true)}
                            >
                              {language.t("disk.results.reopen")}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                      {showLandscape ? (
                        <section
                          ref={(el: HTMLElement | null) => {
                            landscapeElRef.current = el
                          }}
                          className="[container-type:size] relative grid min-h-0 min-w-0 flex-1 place-items-center overflow-hidden bg-background-base pb-16 [view-transition-name:disk-landscape] max-[840px]:min-h-0"
                        >
                          <p className="sr-only">
                            {language.t("disk.map.colorMeaning")}
                          </p>
                          {/* The map canvas persists across map⇄grid so ViewMorph can fly
                              wedges into tile poses on one surface; CenterOverlay yields
                              while a morph owns the view. */}
                          <div
                            className="@container [container-type:inline-size] absolute inset-0 bottom-16"
                            style={{
                              // Yield to the DOM tiles once grid has fully landed;
                              // stay visible while a morph is flying.
                              visibility:
                                scanMode !== "map" && !morphing
                                  ? "hidden"
                                  : "visible",
                            }}
                          >
                            <canvas
                              ref={(el: HTMLCanvasElement | null) => {
                                setCanvasEl(el)
                              }}
                              className="absolute inset-0 size-full [touch-action:none] outline-none focus-visible:ring-2 focus-visible:ring-text-weak"
                              tabIndex={0}
                              role="region"
                              data-map-size={visibleMapNode?.size ?? 0}
                              aria-roledescription={language.t("disk.map.role")}
                              aria-describedby="disklizard-orbit-help"
                              aria-controls="disklizard-storage-list"
                              aria-label={language.t("disk.map.label", {
                                label: scanLabel,
                              })}
                              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End PageUp PageDown Enter Space C L Delete Backspace Escape 1 2 3"
                              onPointerDown={beginMapDrag}
                              onPointerMove={moveMapDrag}
                              onPointerUp={(event) => finishMapDrag(event)}
                              onPointerCancel={(event) =>
                                finishMapDrag(event, true)
                              }
                            />
                            <span
                              id="disklizard-orbit-help"
                              className="sr-only"
                            >
                              {language.t("disk.map.instructions")}
                            </span>
                            {!morphing ? (
                              <CenterOverlay node={visibleMapNode} />
                            ) : null}
                            {scanMode === "map" &&
                            hoveredNode &&
                            hoveredPath === hoveredNode.path &&
                            (!hoveredNode.isDir ||
                              !hoveredNode.children?.length) ? (
                              <div className="text-13-medium pointer-events-none absolute top-4 left-4 flex max-w-[min(22rem,50%)] items-center gap-2 rounded-lg border border-border-weaker-base/70 bg-background-base/85 px-3 py-2 text-text-strong shadow-[0_6px_20px_rgb(0_0_0/0.12)] backdrop-blur-sm">
                                <span className="min-w-0 truncate">
                                  {diskNodeDisplayName(hoveredNode)}
                                </span>
                                <span className="shrink-0 text-text-weak tabular-nums">
                                  {formatBytes(hoveredNode.size)}
                                </span>
                              </div>
                            ) : null}
                          </div>
                          {/* Treemap overlay: mounted in both map and grid, but only
                              visible/interactive once the morph has landed (or motion is
                              reduced and the swap was instant). */}
                          {gridVisible ? (
                            <div
                              className={cn(
                                "dl-treemap-overlay absolute inset-0 px-8 pt-8 pb-24 lg:px-12 lg:pt-12 lg:pb-24",
                                !gridInteractive &&
                                  "pointer-events-none opacity-0"
                              )}
                              inert={!gridInteractive ? true : undefined}
                              aria-hidden={
                                !gridInteractive ? "true" : undefined
                              }
                            >
                              {parentView && (
                                <ParentFrame
                                  name={
                                    parentView._label ||
                                    diskNodeDisplayName(parentView)
                                  }
                                  onUp={goUpFromMapCenter}
                                  color={tileColor(viewNode?.path ?? "")}
                                  showLabel
                                />
                              )}
                              <Treemap
                                rootPath={viewNode?.path ?? ""}
                                colorForPath={tileColor}
                                children={
                                  visibleMapNode?.children ?? sortedChildren
                                }
                                draggingNode={collectionDragNode}
                                hoveredPath={hoveredPath}
                                selectedPath={selectedPath}
                                queuedPaths={queuedPaths}
                                onHover={(node) => {
                                  hoverEntry(
                                    node?.path ?? selectedPath ?? null,
                                    node
                                  )
                                }}
                                onSelect={selectPath}
                                onReveal={(node) => void reveal(node.path)}
                                onPreview={(node) => {
                                  if (preview.supportsSystemPreview())
                                    void preview.openSystemPreview(node)
                                  else void preview.show(node)
                                }}
                                onDrill={(node, restoreListFocus) =>
                                  drill(node, false, restoreListFocus)
                                }
                                onShowAll={(node) => expandOtherNode(node)}
                                canCollect={canDragNode}
                                onCollectDragStart={beginCollectionDrag}
                                onCollectDragEnd={endCollectionDrag}
                              />
                            </div>
                          ) : null}
                          {scanMode === "icicle" && viewNode ? (
                            <div
                              className="absolute inset-0 px-6 pt-6 pb-20"
                              style={{
                                opacity: morphing ? 0 : 1,
                                pointerEvents: morphing ? "none" : undefined,
                              }}
                            >
                              {parentView && (
                                <ParentFrame
                                  name={
                                    parentView._label ||
                                    diskNodeDisplayName(parentView)
                                  }
                                  onUp={goUpFromMapCenter}
                                />
                              )}
                              <IciclePanel
                                root={visibleMapNode ?? viewNode}
                                draggingNode={collectionDragNode}
                                colorForNode={branchColor}
                                parentName={
                                  parentView
                                    ? parentView._label ||
                                      diskNodeDisplayName(parentView)
                                    : undefined
                                }
                                onUp={goUpFromMapCenter}
                                selectedPath={selectedPath}
                                queuedPaths={queuedPaths}
                                onSelect={selectPath}
                                onHover={(node) => {
                                  hoverEntry(
                                    node?.path ?? selectedPath ?? null,
                                    node
                                  )
                                }}
                                onReveal={(node) => void reveal(node.path)}
                                onPreview={(node) => {
                                  if (preview.supportsSystemPreview())
                                    void preview.openSystemPreview(node)
                                  else void preview.show(node)
                                }}
                                onDrill={(node) => drill(node)}
                                canCollect={canDragNode}
                                onDragStart={beginCollectionDrag}
                                onDragEnd={endCollectionDrag}
                              />
                            </div>
                          ) : null}
                          <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-lg border-0 bg-transparent p-1 shadow-none max-[760px]:bottom-2.5">
                            <DropdownMenu placement="top-start" gutter={6}>
                              <DropdownMenu.Trigger
                                as={Button}
                                size="small"
                                variant="secondary"
                                className="min-h-10 gap-2 rounded-lg border border-border-weaker-base/70 bg-surface-raised-base/85 px-3 text-text-strong shadow-none"
                              >
                                {scanMode === "map" ? (
                                  <ChartPie className="size-4" />
                                ) : scanMode === "grid" ? (
                                  <LayoutGrid className="size-4" />
                                ) : (
                                  <Layers className="size-4" />
                                )}
                                <span className="text-13-medium">
                                  {language.t(
                                    scanMode === "map"
                                      ? "disk.common.map"
                                      : scanMode === "grid"
                                        ? "disk.common.tiles"
                                        : "disk.common.icicle"
                                  )}
                                </span>
                                <Icon
                                  name="chevron-down"
                                  className="text-icon-weak size-3"
                                />
                              </DropdownMenu.Trigger>
                              <DropdownMenu.Portal>
                                <DropdownMenu.Content>
                                  <DropdownMenu.RadioGroup
                                    value={scanMode}
                                    onChange={(value) =>
                                      chooseScanMode(
                                        value as ScanMode,
                                        "pointer",
                                        false
                                      )
                                    }
                                    aria-label={language.t(
                                      "disk.explore.choose"
                                    )}
                                  >
                                    {(["map", "grid", "icicle"] as const).map(
                                      (mode) => (
                                        <DropdownMenu.RadioItem
                                          key={mode}
                                          value={mode}
                                        >
                                          {mode === "map" ? (
                                            <ChartPie className="size-4" />
                                          ) : mode === "grid" ? (
                                            <LayoutGrid className="size-4" />
                                          ) : (
                                            <Layers className="size-4" />
                                          )}
                                          <DropdownMenu.ItemLabel>
                                            {language.t(
                                              mode === "map"
                                                ? "disk.common.map"
                                                : mode === "grid"
                                                  ? "disk.common.tiles"
                                                  : "disk.common.icicle"
                                            )}
                                          </DropdownMenu.ItemLabel>
                                          <DropdownMenu.ItemIndicator>
                                            <Icon name="check" />
                                          </DropdownMenu.ItemIndicator>
                                        </DropdownMenu.RadioItem>
                                      )
                                    )}
                                  </DropdownMenu.RadioGroup>
                                </DropdownMenu.Content>
                              </DropdownMenu.Portal>
                            </DropdownMenu>
                            {physicalCloneAccountingWarning ||
                            treeRoot?.scanIssues ? (
                              <DeveloperDisclosure
                                compact
                                iconOnly
                                warning
                                label={
                                  treeRoot?.scanIssues
                                    ? language.t("disk.explore.unreadable", {
                                        count: formatCount(
                                          treeRoot.scanIssues.unreadableCount
                                        ),
                                        locations: language.plural(
                                          "disk.count.locationNoun",
                                          treeRoot.scanIssues.unreadableCount
                                        ),
                                      })
                                    : language.t("disk.explore.physicalPaused")
                                }
                              >
                                {indexFilter.lens !== "all" &&
                                physicalCloneAccountingWarning ? (
                                  <details
                                    className="group mt-1.5 rounded-none border-0 bg-transparent"
                                    aria-label={language.t(
                                      "disk.explore.physicalLabel"
                                    )}
                                  >
                                    <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center gap-2 rounded-lg px-0 py-2 font-normal outline-none focus-visible:ring-2 focus-visible:ring-icon-warning-base [&::-webkit-details-marker]:hidden">
                                      <Icon
                                        name="shield"
                                        className="size-3.5 shrink-0 text-icon-warning-base"
                                      />
                                      <span className="text-12-regular min-w-0 flex-1 text-text-weak">
                                        {language.t(
                                          "disk.explore.physicalPaused"
                                        )}
                                      </span>
                                      <Icon
                                        name="chevron-down"
                                        className="text-icon-weak size-3 shrink-0 group-open:rotate-180"
                                      />
                                    </summary>
                                    <p className="text-12-regular px-3 pb-3 leading-relaxed text-text-weak">
                                      {physicalCloneAccountingWarning}
                                    </p>
                                  </details>
                                ) : null}
                                {treeRoot?.scanIssues ? (
                                  <details className="group mt-2 border-t border-border-weaker-base">
                                    <summary className="flex min-h-11 min-w-11 cursor-pointer list-none items-center gap-2 rounded-lg px-0 py-2 outline-none marker:content-none focus-visible:ring-2 focus-visible:ring-icon-warning-base [&::-webkit-details-marker]:hidden">
                                      <Icon
                                        name="warning"
                                        className="size-3.5 shrink-0 text-icon-warning-base"
                                      />
                                      <span className="text-12-regular min-w-0 flex-1 text-text-weak">
                                        {language.t("disk.explore.unreadable", {
                                          count: formatCount(
                                            treeRoot.scanIssues.unreadableCount
                                          ),
                                          locations: language.plural(
                                            "disk.count.locationNoun",
                                            treeRoot.scanIssues.unreadableCount
                                          ),
                                        })}
                                      </span>
                                      <span className="sr-only">
                                        {language.t("disk.explore.totalsLow")}
                                      </span>
                                      <Icon
                                        name="chevron-down"
                                        className="text-icon-weak size-3 shrink-0 transition-transform duration-150 group-open:rotate-180"
                                      />
                                    </summary>
                                    <div className="border-t border-amber-500/15 px-3 pt-2.5 pb-3">
                                      <p className="text-12-regular leading-relaxed text-text-weak">
                                        {language.t(
                                          scanAccessGuidance(platform.os)
                                        )}{" "}
                                        {language.t(
                                          "disk.accessGuidance.rescan"
                                        )}
                                      </p>
                                      {storageDiagnostics?.access.status ===
                                      "limited" ? (
                                        <Button
                                          className="mt-2 min-h-11 min-w-11"
                                          size="small"
                                          variant="secondary"
                                          icon="square-arrow-top-right"
                                          onClick={() =>
                                            void openDiskAccessSettings()
                                          }
                                        >
                                          {language.t(
                                            "disk.explore.openPrivacy"
                                          )}
                                        </Button>
                                      ) : null}
                                      <ul
                                        className="mt-2 space-y-1"
                                        aria-label={language.t(
                                          "disk.explore.unreadableList"
                                        )}
                                      >
                                        {treeRoot.scanIssues.samplePaths
                                          .slice(0, 5)
                                          .map((path) => (
                                            <li
                                              key={path}
                                              className="text-12-regular truncate font-mono text-text-weaker"
                                              title={path}
                                            >
                                              {path}
                                            </li>
                                          ))}
                                      </ul>
                                      {treeRoot.scanIssues.samplePaths.length >
                                        5 ||
                                      treeRoot.scanIssues.unreadableCount >
                                        5 ? (
                                        <p className="text-12-regular mt-1.5 text-text-weaker">
                                          {language.t(
                                            "disk.explore.showingUnreadable",
                                            {
                                              count: formatCount(
                                                treeRoot.scanIssues
                                                  .unreadableCount
                                              ),
                                            }
                                          )}
                                        </p>
                                      ) : null}
                                    </div>
                                  </details>
                                ) : null}
                              </DeveloperDisclosure>
                            ) : null}
                            <details
                              ref={shortcutsDetailsRef}
                              className="relative"
                              open={shortcutsOpen}
                              onToggle={(event) =>
                                setShortcutsOpen(event.currentTarget.open)
                              }
                            >
                              <summary
                                className="text-12-semibold grid size-11 min-h-11 min-w-11 cursor-pointer list-none place-items-center rounded-full text-text-weak transition-colors outline-none focus-visible:ring-2 focus-visible:ring-text-weak [&::-webkit-details-marker]:hidden"
                                aria-label={language.t("disk.shortcuts.show")}
                              >
                                ?
                              </summary>
                              <div className="text-12-regular absolute right-0 bottom-[calc(100%+10px)] z-20 w-64 rounded-xl bg-background-base p-3 leading-relaxed text-text-weak shadow-[0_0_0_1px_rgb(127_127_127/0.14),0_12px_30px_rgb(0_0_0/0.16)]">
                                <p className="text-12-semibold text-text-strong">
                                  {language.t("disk.shortcuts.heading")}
                                </p>
                                <p className="mt-2">
                                  {language.t("disk.shortcuts.navigation")}
                                </p>
                                <p className="mt-2">
                                  {language.t("disk.shortcuts.history")}
                                </p>
                                <p className="mt-1">
                                  {platform.os === "macos"
                                    ? language.t("disk.shortcuts.openMac")
                                    : language.t("disk.shortcuts.open")}
                                </p>
                                <p className="mt-1">
                                  {language.t("disk.shortcuts.views")}
                                </p>
                              </div>
                            </details>
                          </div>
                        </section>
                      ) : null}

                      <aside
                        className={cn(
                          "[container-type:inline-size] relative flex min-h-0 w-full flex-col overflow-hidden border-0 bg-background-base max-[840px]:w-full max-[840px]:border-t max-[840px]:border-border-weaker-base",
                          showLandscape &&
                            !cleanupWorkspace &&
                            "w-[clamp(380px,34vw,480px)] shrink-0 border-l border-border-weaker-base max-[840px]:border-l-0",
                          (!showLandscape || cleanupWorkspace) &&
                            "min-w-0 flex-1 pb-16"
                        )}
                      >
                        <div
                          className={cn(
                            "flex min-h-0 w-full flex-1 flex-col",
                            cleanupWorkspace && "mx-auto max-w-[1080px]"
                          )}
                          inert={hoverPreviewVisible}
                          aria-hidden={hoverPreviewVisible}
                        >
                          <div className="max-h-[max(100px,calc(100%-224px))] shrink-0 [scrollbar-width:thin] overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-3 pb-2 max-[760px]:px-4 max-[760px]:pt-3 max-[760px]:pb-2">
                            <div className="flex items-start justify-between gap-4 max-[760px]:flex-wrap">
                              <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                                <p className="sr-only">
                                  {query.trim()
                                    ? language.t(
                                        indexFilter.lens === "changes"
                                          ? "disk.history.results"
                                          : "disk.search.results"
                                      )
                                    : indexFilter.lens === "developer"
                                      ? indexFilter.developerCategory === "all"
                                        ? language.t(
                                            "disk.explore.developerFiles"
                                          )
                                        : language.t(
                                            DEVELOPER_CATEGORY_LABEL[
                                              indexFilter.developerCategory
                                            ]
                                          )
                                      : indexFilter.lens === "recommendations"
                                        ? language.t(
                                            "disk.explore.recommendationsScan"
                                          )
                                        : indexFilter.lens === "changes"
                                          ? language.t("disk.history.heading")
                                          : recentLens
                                            ? language.t("disk.changed.today")
                                            : language.t(
                                                "disk.explore.folderContents"
                                              )}
                                </p>
                                <div className="dl-inspector-heading flex min-w-0 flex-1 items-baseline justify-between gap-3">
                                  <h2
                                    className="text-18-semibold min-w-0 truncate text-text-strong"
                                    title={viewNode?.path}
                                  >
                                    {indexFilter.lens === "developer"
                                      ? language.t(
                                          "disk.explore.developerFiles"
                                        )
                                      : indexFilter.lens === "recommendations"
                                        ? language.t(
                                            "disk.explore.recommendationsScan"
                                          )
                                        : indexFilter.lens === "changes"
                                          ? language.t("disk.history.heading")
                                          : query.trim()
                                            ? language.t("disk.search.results")
                                            : viewNode?._label ||
                                              (viewNode
                                                ? diskNodeDisplayName(viewNode)
                                                : language.t(
                                                    "disk.common.contents"
                                                  ))}
                                  </h2>
                                  <p className="text-12-regular shrink-0 truncate text-text-weak tabular-nums">
                                    {indexFilter.lens !== "changes"
                                      ? `${formatBytes(indexSize)} · `
                                      : ""}
                                    {language.plural(
                                      "disk.count.item",
                                      indexCount
                                    )}
                                  </p>
                                </div>
                                {workspaceTab === "all" ? (
                                  <button
                                    ref={searchTriggerRef}
                                    type="button"
                                    className={cn(
                                      "grid size-11 shrink-0 place-items-center rounded-lg text-text-weak transition-colors duration-150 outline-none hover:bg-surface-raised-base hover:text-text-strong focus-visible:ring-2 focus-visible:ring-text-weak",
                                      searchVisible &&
                                        "bg-surface-raised-base text-text-strong"
                                    )}
                                    aria-label={language.t("disk.search.label")}
                                    aria-expanded={searchVisible}
                                    title={language.t("disk.search.label")}
                                    onClick={() =>
                                      searchVisible
                                        ? closeSearch()
                                        : openSearch()
                                    }
                                  >
                                    <Icon
                                      name="magnifying-glass"
                                      className="size-4"
                                    />
                                  </button>
                                ) : null}
                              </div>
                              {cleanupWorkspace &&
                              effectiveCollection.length > 0 ? (
                                <Button
                                  size="small"
                                  variant="primary"
                                  className="min-h-11 shrink-0 max-[760px]:order-3 max-[760px]:w-full"
                                  onClick={() => collectionSurface.open()}
                                >
                                  {language.t("disk.collection.reviewSelected")}
                                  <span className="ml-2 tabular-nums">
                                    {effectiveCollection.length}
                                  </span>
                                </Button>
                              ) : null}
                              {cleanupWorkspace && scanMode !== "list" ? (
                                <Button
                                  size="small"
                                  variant="ghost"
                                  className="min-h-9 shrink-0 text-text-weak"
                                  onClick={() =>
                                    setCleanupMapCollapsed((value) => !value)
                                  }
                                >
                                  {language.t(
                                    cleanupMapCollapsed
                                      ? "disk.cleanup.showMap"
                                      : "disk.cleanup.hideMap"
                                  )}
                                </Button>
                              ) : null}
                              {scanMode === "list" ? (
                                <div className="flex items-center gap-0.5 rounded-full bg-background-base/70 p-1 shadow-[0_0_0_1px_rgb(127_127_127/0.12)]">
                                  <SegmentedButton
                                    active={mapModeActive}
                                    onClick={() => chooseScanMode("map")}
                                    icon="dot-grid"
                                    label={language.t("disk.common.map")}
                                  />
                                  <SegmentedButton
                                    active={gridModeActive}
                                    onClick={() => chooseScanMode("grid")}
                                    icon="file-tree"
                                    label={language.t("disk.common.tiles")}
                                  />
                                  <SegmentedButton
                                    active
                                    icon="bullet-list"
                                    label={language.t("disk.common.list")}
                                  />
                                </div>
                              ) : null}
                            </div>
                            {showVolumeCapacity && scanDrive && treeRoot ? (
                              <VolumeCapacitySummary
                                drive={scanDrive}
                                root={treeRoot}
                              />
                            ) : null}
                            {treeRoot?.scanIssues ? (
                              <ScanCoverageDisclosure
                                issues={treeRoot.scanIssues}
                                os={platform.os}
                                onRescan={() => void rescanCurrent(true)}
                              />
                            ) : null}
                            <div className="border-0 pb-0 max-[840px]:mt-2 max-[760px]:pb-1">
                              <p className="sr-only">
                                {language.t("disk.explore.heading")}
                              </p>
                              {cleanupWorkspace &&
                              !physicalCloneAccountingUncertain ? (
                                <Tabs
                                  value={indexFilter.lens}
                                  onValueChange={(value) =>
                                    chooseLens(
                                      value as "developer" | "recommendations"
                                    )
                                  }
                                >
                                  <TabsList
                                    variant="line"
                                    className="mt-2 h-10 w-fit gap-2"
                                    aria-label={language.t(
                                      "disk.cleanup.category"
                                    )}
                                  >
                                    <TabsTrigger
                                      className="text-13-medium px-3"
                                      value="developer"
                                    >
                                      {language.t(
                                        "disk.cleanup.developerArtifacts"
                                      )}
                                    </TabsTrigger>
                                    <TabsTrigger
                                      className="text-13-medium px-3"
                                      value="recommendations"
                                      disabled={
                                        physicalCloneAccountingUncertain
                                      }
                                      title={
                                        physicalCloneAccountingUncertain
                                          ? language.t(
                                              "disk.explore.reclaimWait"
                                            )
                                          : undefined
                                      }
                                    >
                                      {language.t(
                                        "disk.cleanup.otherSuggestions"
                                      )}
                                    </TabsTrigger>
                                  </TabsList>
                                </Tabs>
                              ) : null}
                              {(indexFilter.lens === "changes" || recentLens) &&
                              recentChanges.length > 0 ? (
                                <Tabs
                                  value={recentLens ? "recent" : "changes"}
                                  onValueChange={(value) =>
                                    chooseLens(value as "recent" | "changes")
                                  }
                                >
                                  <TabsList
                                    className="mt-3 h-8 w-full bg-background-base"
                                    aria-label={language.t("disk.history.lens")}
                                  >
                                    <TabsTrigger
                                      className="text-xs"
                                      value="changes"
                                    >
                                      {language.t("disk.history.live")}
                                    </TabsTrigger>
                                    <TabsTrigger
                                      className="text-xs"
                                      value="recent"
                                      disabled={recentChanges.length === 0}
                                    >
                                      {language.t("disk.history.modifiedToday")}
                                    </TabsTrigger>
                                  </TabsList>
                                </Tabs>
                              ) : null}
                            </div>
                            {indexFilter.lens === "recommendations" &&
                            reclaim.totalBytes > 0 ? (
                              <ReclaimBanner
                                bytes={reclaim.totalBytes}
                                count={reclaim.totalCount}
                                reviewReady={effectiveCollection.length > 0}
                                onReview={() => reviewSurface.open()}
                              />
                            ) : null}
                            {indexFilter.lens === "developer" &&
                            (developer().buckets.length > 0 ||
                              !!treeRoot?.developerArtifactInventory) ? (
                              <>
                                <div className="mt-3">
                                  <DeveloperCleanupPolicy
                                    expanded
                                    categoryControl={
                                      developer().buckets.length > 0 ? (
                                        <DeveloperCategories
                                          compact
                                          allLabel={language.t(
                                            "disk.explore.allDeveloper"
                                          )}
                                          label={language.t(
                                            "disk.explore.developerCategories"
                                          )}
                                          value={indexFilter.developerCategory}
                                          categories={developerCategoryTotals.map(
                                            (bucket) => ({
                                              value: bucket.category,
                                              label: language.t(
                                                DEVELOPER_CATEGORY_LABEL[
                                                  bucket.category
                                                ]
                                              ),
                                              bytes: bucket.bytes,
                                            })
                                          )}
                                          onChange={(value) =>
                                            chooseDeveloperCategory(
                                              developer().buckets.find(
                                                (bucket) =>
                                                  bucket.category === value
                                              )?.category ?? "all"
                                            )
                                          }
                                        />
                                      ) : undefined
                                    }
                                    preset={indexFilter.developerAge}
                                    customDays={
                                      indexFilter.customDeveloperAgeDays
                                    }
                                    age={developerAge}
                                    eligibleCount={
                                      smartCleanupCandidates.length
                                    }
                                    eligibleBytes={smartCleanupCandidateBytes}
                                    excludedCount={smartCleanupReviewCount}
                                    ecosystems={developerEcosystems}
                                    ecosystem={indexFilter.developerEcosystem}
                                    inventory={
                                      treeRoot?.developerArtifactInventory
                                    }
                                    unavailable={false}
                                    reviewReady={effectiveCollection.length > 0}
                                    filtersActive={
                                      indexFilter.developerCategory !== "all" ||
                                      indexFilter.developerEcosystem !==
                                        "all" ||
                                      indexFilter.developerAge !== "all" ||
                                      !!query.trim()
                                    }
                                    onPresetChange={chooseDeveloperCleanupAge}
                                    onCustomDaysChange={
                                      setCustomDeveloperCleanupAgeDays
                                    }
                                    onEcosystemChange={chooseDeveloperEcosystem}
                                    onSelectEligible={
                                      selectEligibleDeveloperResults
                                    }
                                    onClearFilters={() => {
                                      replaceIndexFilter({
                                        developerCategory: "all",
                                        developerEcosystem: "all",
                                        developerAge: "all",
                                        customDeveloperAgeDays: "30",
                                      })
                                      setQuery("")
                                    }}
                                  />
                                </div>
                              </>
                            ) : null}
                          </div>
                          {searchVisible ? (
                            <DiskUtilitySearchTools
                              compact={workspaceTab === "all"}
                              developer={indexFilter.lens === "developer"}
                              grouped={groupDeveloper}
                              onGroup={setGroupDeveloper}
                              query={query}
                              label={language.t(
                                indexFilter.lens === "changes"
                                  ? "disk.history.search"
                                  : "disk.search.label"
                              )}
                              placeholder={language.t(
                                indexFilter.lens === "changes"
                                  ? "disk.history.search"
                                  : "disk.search.placeholder"
                              )}
                              sortKey={indexFilter.sortKey}
                              sortDirection={indexFilter.sortDirection}
                              showSort={indexFilter.lens !== "changes"}
                              onQuery={updateQuery}
                              onSort={updateSort}
                              onDismiss={
                                workspaceTab === "all" ? closeSearch : undefined
                              }
                            />
                          ) : null}

                          {indexFilter.lens === "changes" ||
                          entries.length > 0 ? (
                            indexFilter.lens === "changes" ? (
                              <DiskScanHistory
                                entries={currentHistoryEntries}
                                filtered={!!query.trim()}
                                onClear={clearCurrentHistory}
                                onReveal={(path) => void reveal(path)}
                              />
                            ) : (
                              <VirtualIndex
                                groupLabel={developerGroupLabel}
                                rowHeight={entryRowHeight}
                                entries={entries}
                                bindScrollToIndex={(fn) => {
                                  scrollIndexIntoViewRef.current = fn
                                }}
                                bindPageSize={(fn) => {
                                  listPageSizeRef.current =
                                    fn ?? (() => DEFAULT_LIST_PAGE_SIZE)
                                }}
                                onMoveFocus={moveFocus}
                                onPageFocus={moveFocusByPage}
                                onMoveFocusToBoundary={moveFocusToBoundary}
                                render={(entry, i) => {
                                  const rec = () =>
                                    investigation.recognitionFor(entry.node)
                                  const developerContext = () =>
                                    developerArtifactContext(entry.node, rec())
                                  const isActive = () =>
                                    selectedPath === entry.node.path
                                  return (
                                    <div
                                      className={cn(
                                        "dl-index-row group relative flex h-full items-center border-b border-border-weaker-base/70 pr-11 transition-colors duration-150 hover:bg-[color-mix(in_oklch,var(--surface-raised-base)_55%,transparent)] has-[[aria-current=true]]:bg-surface-raised-strong",
                                        isActive() &&
                                          "bg-surface-raised-base/70 shadow-[inset_3px_0_0_var(--dl-accent)]",
                                        hoveredPath === entry.node.path &&
                                          !isActive() &&
                                          "bg-surface-raised-base/80 shadow-[inset_2px_0_0_var(--dl-accent)]",
                                        !!entry.node.isOther &&
                                          "rounded-none border-t border-border-weaker-base border-b-transparent"
                                      )}
                                      onMouseEnter={() =>
                                        hoverEntry(entry.node.path, entry.node)
                                      }
                                      onMouseLeave={() =>
                                        hoverEntry(selectedPath ?? null)
                                      }
                                    >
                                      <button
                                        type="button"
                                        data-disk-index={i()}
                                        aria-current={
                                          isActive() ? "true" : undefined
                                        }
                                        draggable={canDragNode(entry.node)}
                                        className="flex h-full min-h-0 min-w-0 flex-1 items-center gap-2.5 py-1 pr-2 pl-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklch,var(--dl-accent)_60%,transparent)] focus-visible:ring-inset"
                                        onClick={(event) => {
                                          if (
                                            entry.node.isDir &&
                                            indexFilter.lens !== "developer" &&
                                            !event.shiftKey
                                          )
                                            drill(entry.node)
                                          else
                                            selectEntry(
                                              entry.node,
                                              i(),
                                              event.shiftKey
                                            )
                                        }}
                                        onFocus={() => {
                                          setFocusIdx(i())
                                          selectPath(entry.node.path)
                                        }}
                                        onKeyDown={(event) =>
                                          handleEntryKeyDown(
                                            event,
                                            entry.node,
                                            i()
                                          )
                                        }
                                        onDragStart={(event) =>
                                          beginCollectionDrag(
                                            event.nativeEvent,
                                            entry.node
                                          )
                                        }
                                        onDragEnd={endCollectionDrag}
                                      >
                                        {indexFilter.lens === "developer" ? (
                                          <DeveloperEntryContent
                                            node={entry.node}
                                            query={query}
                                            bytes={entry.node.size}
                                            contributionBytes={
                                              entry.displaySize
                                            }
                                            scope={developerContext().scope}
                                            artifactType={
                                              rec().tag
                                                ? language.t(rec().tag!)
                                                : undefined
                                            }
                                            disposition={
                                              developerContext().disposition
                                            }
                                            location={
                                              developerLocationLabels.get(
                                                entry.node.path
                                              ) ?? entry.node.path
                                            }
                                            restriction={
                                              cleanupRestriction(entry.node)
                                                ? language.t(
                                                    cleanupRestriction(
                                                      entry.node
                                                    )!
                                                  )
                                                : undefined
                                            }
                                            metadataMatch={(() => {
                                              const needle = query
                                                .trim()
                                                .toLocaleLowerCase()
                                              const tag = rec().tag
                                              if (
                                                !needle ||
                                                !tag ||
                                                diskEntrySearchText(
                                                  entry.node
                                                ).includes(needle)
                                              )
                                                return undefined
                                              const label = language.t(tag)
                                              return label
                                                .toLocaleLowerCase()
                                                .includes(needle)
                                                ? label
                                                : undefined
                                            })()}
                                            color={
                                              (scanMode === "grid"
                                                ? tileColor(entry.node.path)
                                                : branchColor(entry.node)) ??
                                              primarySegmentColor(
                                                entry.colorIndex,
                                                1,
                                                entry.node.isDir
                                              )
                                            }
                                          />
                                        ) : (
                                          <>
                                            <span className="min-w-0 flex-1">
                                              <span className="flex min-w-0 items-center gap-2.5">
                                                <span
                                                  className="size-2 shrink-0 rounded-full"
                                                  style={{
                                                    background:
                                                      (scanMode === "grid"
                                                        ? tileColor(
                                                            entry.node.path
                                                          )
                                                        : branchColor(
                                                            entry.node
                                                          )) ??
                                                      (entry.node.isOther
                                                        ? "var(--text-weaker)"
                                                        : primarySegmentColor(
                                                            entry.colorIndex,
                                                            1,
                                                            entry.node.isDir
                                                          )),
                                                  }}
                                                  aria-hidden="true"
                                                />
                                                <span className="text-13-semibold truncate text-text-strong">
                                                  <SearchHighlight
                                                    text={diskNodeDisplayName(
                                                      entry.node
                                                    )}
                                                    query={query}
                                                  />
                                                </span>
                                                {indexFilter.lens !== "all" &&
                                                rec().tag ? (
                                                  <span
                                                    className={`text-12-semibold hidden shrink-0 rounded-md px-1.5 py-0.5 ring-1 ring-inset @min-[600px]:inline ${SAFETY_ACCENT[rec().safety].pill}`}
                                                  >
                                                    <SearchHighlight
                                                      text={language.t(
                                                        rec().tag!
                                                      )}
                                                      query={query}
                                                    />
                                                  </span>
                                                ) : null}
                                                {indexFilter.lens ===
                                                  "recommendations" &&
                                                cleanupRestriction(
                                                  entry.node
                                                ) ? (
                                                  <span
                                                    className="max-w-[12rem] shrink-0 truncate text-[11px] text-icon-warning-base"
                                                    title={language.t(
                                                      cleanupRestriction(
                                                        entry.node
                                                      )!
                                                    )}
                                                  >
                                                    {language.t(
                                                      cleanupRestriction(
                                                        entry.node
                                                      )!
                                                    )}
                                                  </span>
                                                ) : null}
                                              </span>
                                              {indexFilter.lens !== "all" ||
                                              !!query.trim() ||
                                              duplicateEntryNames.has(
                                                diskNodeDisplayName(
                                                  entry.node
                                                ).toLocaleLowerCase()
                                              ) ? (
                                                <span className="mt-1 ml-[18px] flex min-w-0 items-center gap-2">
                                                  <span
                                                    className="text-12-regular flex min-w-0 flex-1 items-center gap-1.5 text-text-weak"
                                                    title={entry.node.path}
                                                  >
                                                    <span
                                                      className={cn(
                                                        "hidden min-w-0 truncate @min-[600px]:inline",
                                                        "inline"
                                                      )}
                                                    >
                                                      {query.trim() ? (
                                                        <SearchHighlight
                                                          text={entry.node.path}
                                                          query={query}
                                                        />
                                                      ) : (
                                                        truncatePath(
                                                          treeRoot &&
                                                            pathBelongsToScanRoot(
                                                              entry.node.path,
                                                              treeRoot.path
                                                            )
                                                            ? entry.node.path
                                                                .slice(
                                                                  treeRoot.path
                                                                    .length
                                                                )
                                                                .replace(
                                                                  /^[\\/]+/,
                                                                  ""
                                                                )
                                                                .replace(
                                                                  /(^|[\\/])[^\\/]+$/,
                                                                  ""
                                                                ) ||
                                                                treeRoot.name
                                                            : entry.node.path.replace(
                                                                /[\\/][^\\/]+$/,
                                                                ""
                                                              ),
                                                          92
                                                        )
                                                      )}
                                                      {entry.displaySize !==
                                                      entry.node.size
                                                        ? language.t(
                                                            "disk.explore.nestedCategories",
                                                            {
                                                              size: shortBytes(
                                                                entry.node.size
                                                              ),
                                                            }
                                                          )
                                                        : null}
                                                    </span>
                                                  </span>
                                                  {indexFilter.lens ===
                                                    "changes" &&
                                                  entry.node.modifiedAt ? (
                                                    <span
                                                      className={cn(
                                                        "text-12-regular hidden shrink-0 text-text-weak tabular-nums @min-[600px]:inline"
                                                      )}
                                                      title={language.t(
                                                        "disk.explore.lastChanged",
                                                        {
                                                          date: new Date(
                                                            entry.node
                                                              .modifiedAt
                                                          ).toLocaleString(),
                                                        }
                                                      )}
                                                    >
                                                      {formatLastChanged(
                                                        entry.node.modifiedAt
                                                      )}
                                                    </span>
                                                  ) : null}
                                                </span>
                                              ) : null}
                                            </span>
                                            <span className="text-12-semibold w-[4.75rem] shrink-0 text-right text-text-strong tabular-nums">
                                              {shortBytes(entry.displaySize)}
                                            </span>
                                          </>
                                        )}
                                      </button>
                                      {coveringCollectedNode(
                                        entry.node.path
                                      ) ? (
                                        <span
                                          className="absolute right-2 bottom-1 max-w-[45%] truncate text-[11px] text-text-weak"
                                          title={
                                            coveringCollectedNode(
                                              entry.node.path
                                            )?.path
                                          }
                                        >
                                          {language.t(
                                            "disk.review.includedWith",
                                            {
                                              name: itemIdentity(
                                                coveringCollectedNode(
                                                  entry.node.path
                                                )!
                                              ).reviewTitle,
                                            }
                                          )}
                                        </span>
                                      ) : canModifyNode(entry.node) ? (
                                        <button
                                          type="button"
                                          className={cn(
                                            "absolute top-1/2 right-0 grid size-11 shrink-0 -translate-y-1/2 place-items-center rounded-lg text-text-weak transition-[color,opacity,background-color,transform] duration-150 outline-none group-hover:opacity-100 hover:bg-surface-raised-base hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-text-weak active:scale-[0.96] aria-pressed:opacity-100 [@media(hover:none)]:opacity-100",
                                            cleanupWorkspace
                                              ? "opacity-100"
                                              : "opacity-0",
                                            isCollected(entry.node.path)
                                              ? "text-[color-mix(in_oklch,var(--dl-accent-strong)_54%,var(--text-strong))] opacity-100"
                                              : "hover:text-text-strong"
                                          )}
                                          onClick={() =>
                                            toggleCollect(entry.node)
                                          }
                                          aria-pressed={isCollected(
                                            entry.node.path
                                          )}
                                          aria-label={
                                            isCollected(entry.node.path)
                                              ? language.t(
                                                  "disk.explore.removeReview",
                                                  { name: entry.node.name }
                                                )
                                              : language.t(
                                                  "disk.explore.selectReview",
                                                  { name: entry.node.name }
                                                )
                                          }
                                        >
                                          <Icon
                                            name={
                                              isCollected(entry.node.path)
                                                ? "circle-check"
                                                : "plus-small"
                                            }
                                            className="size-3.5"
                                          />
                                        </button>
                                      ) : null}
                                    </div>
                                  )
                                }}
                              />
                            )
                          ) : (
                            <ScrollView className="min-h-0 flex-1">
                              <IndexEmpty
                                title={
                                  query.trim()
                                    ? language.t("disk.empty.queryTitle", {
                                        query: query.trim(),
                                      })
                                    : indexFilter.lens === "developer" &&
                                        developerAge.valid &&
                                        developerAge.days !== undefined
                                      ? language.t("disk.empty.ageTitle", {
                                          days: developerAge.days,
                                        })
                                      : indexFilter.lens === "developer" &&
                                          indexFilter.developerEcosystem !==
                                            "all"
                                        ? language.t(
                                            "disk.empty.ecosystemTitle",
                                            {
                                              ecosystem: artifactEcosystemLabel(
                                                indexFilter.developerEcosystem
                                              ),
                                            }
                                          )
                                        : indexFilter.lens === "developer" &&
                                            indexFilter.developerCategory !==
                                              "all"
                                          ? language.t(
                                              "disk.empty.categoryTitle",
                                              {
                                                category: language.t(
                                                  DEVELOPER_CATEGORY_LABEL[
                                                    indexFilter
                                                      .developerCategory
                                                  ]
                                                ),
                                              }
                                            )
                                          : treeRoot?.scanIssues
                                            ? language.t(
                                                "disk.empty.partialTitle"
                                              )
                                            : undefined
                                }
                                body={
                                  query.trim()
                                    ? language.t("disk.empty.search.body")
                                    : indexFilter.lens === "developer" &&
                                        developerAge.valid &&
                                        developerAge.days !== undefined
                                      ? language.t("disk.empty.ageBody")
                                      : treeRoot?.scanIssues
                                        ? language.t("disk.empty.partialBody")
                                        : undefined
                                }
                                actionLabel={
                                  query.trim()
                                    ? language.t("disk.search.clear")
                                    : indexFilter.lens === "developer" &&
                                        developerAge.valid &&
                                        developerAge.days !== undefined
                                      ? language.t("disk.empty.clearAge")
                                      : indexFilter.lens === "developer" &&
                                          (indexFilter.developerEcosystem !==
                                            "all" ||
                                            indexFilter.developerCategory !==
                                              "all")
                                        ? language.t(
                                            "disk.cleanup.clearFilters"
                                          )
                                        : undefined
                                }
                                kind={
                                  query.trim()
                                    ? "search"
                                    : recentLens
                                      ? "recent"
                                      : indexFilter.lens === "developer"
                                        ? "developer"
                                        : indexFilter.lens === "recommendations"
                                          ? "recommendations"
                                          : "folder"
                                }
                                onReset={() => {
                                  if (query.trim()) setQuery("")
                                  else if (
                                    indexFilter.lens === "developer" &&
                                    indexFilter.developerAge !== "all"
                                  )
                                    chooseDeveloperCleanupAge("all")
                                  else if (
                                    indexFilter.lens === "developer" &&
                                    indexFilter.developerEcosystem !== "all"
                                  )
                                    chooseDeveloperEcosystem("all")
                                  else if (
                                    indexFilter.lens === "developer" &&
                                    indexFilter.developerCategory !== "all"
                                  )
                                    chooseDeveloperCategory("all")
                                  else chooseLens("all")
                                }}
                              />
                            </ScrollView>
                          )}
                        </div>
                        {hoverPreviewVisible && hoverPreviewNode ? (
                          <DiskUtilityHoverContents
                            node={hoverPreviewNode}
                            colorForNode={branchColor}
                            onLeave={() => hoverEntry(null)}
                            onHover={(node) => hoverEntry(node.path, node)}
                            onDismiss={() => {
                              setMapHoverCandidate(null)
                              hoverPreview.dismiss()
                              hoverEntry(null)
                            }}
                            onOpen={(node) => {
                              hoverPreview.dismiss()
                              if (node.isDir) drill(node)
                              else selectPath(node.path)
                            }}
                          />
                        ) : null}
                      </aside>
                    </div>

                    <div
                      className={cn(
                        "relative flex h-16 shrink-0 items-center border-t border-border-weaker-base bg-background-base px-4 shadow-none",
                        !selectedNode && "dl-command-dock-idle"
                      )}
                    >
                      <div className="dl-command-dock-inner mx-auto flex w-full max-w-[1480px] items-center gap-3">
                        <div className="min-w-0 flex-1">
                          {selectedNode ? (
                            <DetailBar
                              node={selectedNode}
                              recognition={investigation.recognitionFor(
                                selectedNode
                              )}
                              parentSize={indexSize}
                              deletable={canModifyNode(selectedNode)}
                              collected={isCollected(selectedNode.path)}
                              includedBy={
                                coveringCollectedNode(selectedNode.path)
                                  ? itemIdentity(
                                      coveringCollectedNode(selectedNode.path)!
                                    ).reviewTitle
                                  : undefined
                              }
                              locked={isPathCleanupLocked(
                                selectedNode.path,
                                cleanupLocks,
                                platform.os
                              )}
                              lockLabel={
                                cleanupLockForPath(
                                  selectedNode.path,
                                  cleanupLocks,
                                  platform.os
                                )?.label
                              }
                              restriction={
                                cleanupRestriction(selectedNode)
                                  ? language.t(
                                      cleanupRestriction(selectedNode)!
                                    )
                                  : undefined
                              }
                              accessState={
                                selectedAccess?.path === selectedNode.path
                                  ? selectedAccess.state
                                  : "not-checked"
                              }
                              onCheckAccess={() =>
                                setAccessCheckVersion((value) => value + 1)
                              }
                              trashName={nativeTrashName(platform.os)}
                              revealLabel={nativeRevealLabel(platform.os)}
                              onPreview={
                                selectedNode.isOther || selectedNode.isHidden
                                  ? undefined
                                  : () => void preview.show(selectedNode)
                              }
                              onQuickLook={
                                preview.supportsSystemPreview() &&
                                !selectedNode.isOther &&
                                !selectedNode.isHidden
                                  ? () =>
                                      void preview.openSystemPreview(
                                        selectedNode
                                      )
                                  : undefined
                              }
                              onReveal={() => void reveal(selectedNode.path)}
                              onOpen={
                                isDeveloperInventoryNode(selectedNode)
                                  ? () => void reveal(selectedNode.path)
                                  : () => drill(selectedNode)
                              }
                              openLabel={
                                isDeveloperInventoryNode(selectedNode)
                                  ? nativeRevealLabel(platform.os)
                                  : undefined
                              }
                              onCollect={() =>
                                coveringCollectedNode(selectedNode.path)
                                  ? collectionSurface.open()
                                  : toggleCollect(selectedNode)
                              }
                              onTrash={() => requestDelete(selectedNode)}
                              onToggleLock={
                                deleting ||
                                selectedNode.isOther ||
                                selectedNode.isHidden
                                  ? undefined
                                  : () =>
                                      void toggleProtectedTree(
                                        selectedNode.path,
                                        selectedNode.name
                                      )
                              }
                            />
                          ) : (
                            <div className="flex min-h-11 items-center gap-3 px-2">
                              <div className="min-w-0">
                                <p className="text-12-semibold text-text-strong">
                                  {language.t("disk.explore.selectTitle")}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    ref={(el) => {
                      scanProgressRegionRef.current = el ?? undefined
                    }}
                    className="relative flex h-full items-center justify-center overflow-auto px-5 py-8 outline-none focus-visible:ring-2 focus-visible:ring-text-weak focus-visible:ring-inset sm:px-8 sm:py-10"
                    tabIndex={0}
                    role="region"
                    data-scan-files={scanFiles}
                    aria-label={language.t("disk.scan.label", {
                      label: focusedScan?.label ?? scanLabel,
                    })}
                  >
                    <ScanFormation
                      label={focusedScan?.label ?? scanLabel}
                      files={scanFiles}
                      bytes={scanBytes}
                      currentPath={scanTail}
                      pct={scanTotal > 0 ? scanPct : null}
                      onCancel={() => cancelScan({ confirmed: true })}
                    />
                  </div>
                )
              ) : null}
            </>
          ) : (
            <Placeholder
              icon="folder"
              title={language.t("disk.top.scannerDisconnected")}
              body={language.t("disk.top.disconnectedBody")}
              actions={
                <>
                  {showNativeAppMenu && platform.restart ? (
                    <Button
                      className="min-h-11 min-w-11"
                      size="small"
                      variant="primary"
                      onClick={() => void platform.restart?.()}
                    >
                      {language.t("disk.top.restart")}
                    </Button>
                  ) : null}
                  {showNativeAppMenu && platform.exportDiagnostics ? (
                    <Button
                      className="min-h-11 min-w-11"
                      size="small"
                      variant="secondary"
                      onClick={() => void exportDiagnostics()}
                    >
                      {language.t("disk.app.exportDiagnostics")}
                    </Button>
                  ) : null}
                </>
              }
            />
          )
        ) : (
          <Placeholder
            icon="folder"
            title={language.t("disk.top.openDesktop")}
            body={language.t("disk.top.desktopBody")}
          />
        )}
      </main>

      {previewView.mounted && previewView.target ? (
        <PreviewDialog
          open={previewView.phase === "open" || previewView.phase === "opening"}
          node={previewView.target}
          preview={previewView.payload}
          loading={previewView.loading}
          error={previewView.error}
          position={previewView.position + 1}
          total={previewView.total}
          onClose={preview.close}
          onPrevious={
            previewView.canMovePrevious ? () => preview.move(-1) : undefined
          }
          onNext={previewView.canMoveNext ? () => preview.move(1) : undefined}
          onReveal={() => void reveal(previewView.target!.path)}
          revealLabel={nativeRevealLabel(platform.os)}
          systemPreviewLabel={
            platform.os === "macos"
              ? language.t("disk.common.quickLook")
              : undefined
          }
          onSystemPreview={
            platform.os === "macos"
              ? () => void preview.openSystemPreview(previewView.target!)
              : undefined
          }
          onOpen={() => {
            const node = previewView.target!
            if (node.isDir && !isDeveloperInventoryNode(node)) {
              preview.close()
              drill(node, true, true)
              return
            }
            void preview.openInDefaultApp(node)
          }}
        />
      ) : null}

      {/* ── Reclaim review drawer ── */}
      {reviewSurface.mounted ? (
        <ReclaimDrawer
          open={
            reviewSurface.phase === "open" || reviewSurface.phase === "opening"
          }
          reclaim={() => reclaim}
          onClose={() => reviewSurface.close()}
          onCollectAll={() => {
            collectNodes(
              reclaim.buckets.flatMap((bucket) =>
                bucket.items.map(({ node }) => node)
              )
            )
            reviewSurface.closeThen(() => collectionSurface.open())
          }}
          onToggle={toggleCollect}
          isSelected={(node) => isCollected(node.path)}
          onInspect={(node) =>
            reviewSurface.closeThen(() => void preview.show(node))
          }
          deleting={deleting}
        />
      ) : null}

      {collectionSurface.mounted ? (
        <CollectionDialog
          open={
            collectionSurface.phase === "open" ||
            collectionSurface.phase === "opening"
          }
          items={effectiveCollection}
          recognitionFor={investigation.recognitionFor}
          bytes={collectionSize}
          hasSharedPhysicalStorage={collectionHasSharedPhysicalStorage}
          hasUnverifiedPhysicalStorage={physicalCloneAccountingUncertain}
          hasUnobservedContents={effectiveCollection.some((node) =>
            mayContainUnobservedContents(treeRoot, node, platform.os)
          )}
          requiresDeepInventoryRefresh={collectionNeedsDeepInventoryRefresh}
          deleting={deleting}
          progress={deletionProgress}
          trashName={nativeTrashName(platform.os)}
          onClose={() => !deleting && collectionSurface.close()}
          onRemove={removeCollected}
          onQuickLook={
            preview.supportsSystemPreview()
              ? (node) => void preview.openSystemPreview(node)
              : undefined
          }
          onPreview={(node) =>
            collectionSurface.closeThen(() => void preview.show(node))
          }
          onReveal={(node) => void reveal(node.path)}
          onConfirm={() => void deleteCollected()}
        />
      ) : null}

      <CleanupResultsDialog
        open={cleanupResultsOpen}
        outcomes={cleanupResults}
        needsRecheck={cleanupPlanNeedsRecheck}
        trashName={nativeTrashName(platform.os)}
        onClose={() => setCleanupResultsOpen(false)}
        onReveal={(node) => void reveal(node.path)}
        onRescan={() => {
          setCleanupResultsOpen(false)
          void rescanCurrent()
        }}
        onOpenTrash={() => void openTrash()}
        onReviewFailures={
          collection.length
            ? () => {
                setCleanupResultsOpen(false)
                collectionSurface.open()
              }
            : undefined
        }
      />

      {/* ── Delete confirm ── */}
      {deleteSurface.mounted && pendingDelete ? (
        <DeleteConfirmDialog
          open={
            deleteSurface.phase === "open" || deleteSurface.phase === "opening"
          }
          node={pendingDelete}
          hasSharedPhysicalStorage={containsSharedPhysicalStorage(
            pendingDelete
          )}
          hasUnverifiedPhysicalStorage={physicalCloneAccountingUncertain}
          hasUnobservedContents={mayContainUnobservedContents(
            treeRoot,
            pendingDelete,
            platform.os
          )}
          requiresDeepInventoryRefresh={requiresDeepInventoryRefresh([
            pendingDelete,
          ])}
          deleting={deleting}
          trashName={nativeTrashName(platform.os)}
          onClose={() =>
            !deleting && deleteSurface.closeThen(() => setPendingDelete(null))
          }
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      {cleanupResetSurface.mounted ? (
        <CleanupProtectionsResetDialog
          open={
            cleanupResetSurface.phase === "open" ||
            cleanupResetSurface.phase === "opening"
          }
          onClose={() => cleanupResetSurface.close()}
          onReset={() => settings.store.general.resetDiskCleanupLocks()}
        />
      ) : null}
    </div>
  )
}
