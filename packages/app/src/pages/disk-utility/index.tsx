import {
  showCollectionDragPreview,
  moveCollectionDragPreview,
  hideCollectionDragPreview,
} from "./collection-drag-preview"
import { trackPointerDrag, type PointerDragSource } from "./pointer-drag"
import { LocationNavigation } from "./LocationNavigation"
import { flushSync } from "react-dom"
import { planOtherExpansion } from "./other-expansion"
import { createGroupNavigation } from "./group-navigation"
import { AnimatePresence, motion } from "framer-motion"
import { CleanupView } from "./CleanupView"
import { DiskAppMenu } from "./DiskAppMenu"
import { useDiskActions } from "./use-disk-actions"
import {
  inventoryDeletionNeedsRescan,
  useCleanupPolicy,
} from "./use-cleanup-policy"
import { useReviewCollection } from "./use-review-collection"
import { buildCleanupSummary } from "./cleanup-summary"
import { ChangesPanel } from "./ChangesPanel"
import { StorageRow } from "./StorageRow"
import { FolderContext } from "./FolderContext"
import { mergeDiscovery, type ScanDiscovery } from "./live-scan"
import { NodeContextMenu, type ContextMenuItem } from "./NodeContextMenu"
import {
  Copy,
  CornerDownRight,
  Eye,
  FolderSearch,
  Lock,
  Minus,
  Plus,
  Trash2,
} from "lucide-react"
import { useScanBaseline } from "./use-scan-baseline"
import { developerInventoryCoverage } from "./developer-inventory-coverage"
import {
  ChangesButton,
  FreeSpaceRow,
  ScanIssuesNotice,
  ViewSwitch,
  WorkspaceSwitch,
} from "./ExplorerChrome"
import { aggregateTone, createSpectrum, toneCss } from "./spectrum"
/**
 * DiskLizard — standalone storage explorer.
 *
 * A DaisyDisk-inspired sunburst map (rendered in OKLCH) paired with a ranked list.
 * The signature trick: a "Reclaim" engine that recognizes well-known space hogs
 * (node_modules, caches, build output, Trash…) and surfaces a live,
 * non-double-counted file sizes — with an explicit review before removal.
 *
 * Motion stays out of the reactive render path; the canvas and small numeric
 * transitions run directly on requestAnimationFrame.
 */

import { DiskUtilitySearchTools } from "./DiskUtilitySearchTools"
import { DiskUtilityHoverContents } from "./DiskUtilityHoverContents"
import { useHoverPreview } from "./use-hover-preview"
import { Button } from "@/components/dl/button"
import { Icon } from "@/components/dl/icon"
import { ScrollView } from "@/components/dl/scroll-view"
import { showToast } from "@/components/dl/toast"
import {
  startTransition,
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
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react"
import {
  createPersistenceErrorDeduper,
  diskLanguageText,
  useLanguage,
  usePlatform,
  useSettings,
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
} from "./types"
import {
  Sunburst,
  primaryHueForIndex,
  sunburstEntryDuration,
  sunburstSegmentPadding,
  type SunburstEntryIntent,
} from "./sunburst"
import { Treemap } from "./TreemapPanel"
import { ViewMorph, type MorphTile } from "./ViewMorph"
import { ScanFormation } from "./ScanFormation"
import { CollectionDropTarget } from "./CollectionDropTarget"
import { usePinchNavigation } from "./pinch-navigation"
import { abbreviateHomePath } from "./item-identity"
import { useResolvedColorScheme } from "@/components/dl/theme"
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
  isSmartCleanupEligible,
  matchesArtifactEcosystem,
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
  byteUnitBaseForOs,
  setByteUnitBase,
  formatBytes,
  shortBytes,
  truncatePath,
} from "./format"
import {
  filterDeveloperItemsByAge,
  matchesDeveloperCleanupAge,
  resolveDeveloperCleanupAge,
  type DeveloperCleanupAgePreset,
} from "./developer-cleanup"
import {
  CenterOverlay,
  IndexEmpty,
  Placeholder,
} from "./DiskUtilityEmptyStates"
import type { VolumeScanJob } from "./DiskUtilityDriveSurfaces"
import { DriveOverview } from "./DiskUtilityDriveOverview"
import { DetailBar } from "./DiskUtilityDetailBar"
import {
  CleanupProtectionsResetDialog,
  CollectionDialog,
  DeleteConfirmDialog,
  type DeletionProgress,
} from "./DiskUtilityDialogs"
import { VirtualIndex } from "./DiskUtilityVirtualList"
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
import {
  findRetainedLocation,
  type RetainedLocationCandidate,
} from "./retained-location"
import { DISK_UTILITY_STYLES } from "./styles"
import {
  chooseFolderAndScan,
  DISK_CHOOSE_FOLDER_COMMAND,
} from "./choose-folder"
import {
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
import { itemIdentity } from "./item-identity"
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
  findRetainedNode,
  nativeRevealLabel,
  nativeTrashName,
  scanAccessGuidance,
  shouldHandleDiskShortcut,
  type Crumb,
} from "./navigation"

type ViewMode = "drives" | "scan"
type ScanMode = "map" | "grid"
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
  setByteUnitBase(byteUnitBaseForOs(platform.os))
  useEffect(() => {
    document.documentElement.dataset.dlOs = platform.os
  }, [platform.os])
  const language = useLanguage()
  const colorScheme = useResolvedColorScheme()
  const [homePath, setHomePath] = useState<string>()
  const settings = useSettings()
  const { reveal, openTrash, handleUpdaterMenuAction, exportDiagnostics } =
    useDiskActions()
  const isDesktop = platform.platform === "desktop"
  const disk = isDesktop ? platform.diskUtility : undefined

  const [view, setView] = useState<ViewMode>("drives")
  const [scanMode, setScanMode] = useState<ScanMode>("map")
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
  const [scanDiscoveries, setScanDiscoveries] = useState<
    readonly ScanDiscovery[]
  >([])
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
  const review = useReviewCollection({
    os: platform.os,
    canCollect: canModifyNode,
    needsRescan: inventoryDeletionNeedsRescan,
    onNeedsRescan: showDeveloperArtifactRescanGuidance,
    onParentReplaced: (node, count) =>
      showToast({
        variant: "default",
        title: language.t("disk.review.parentReplaces", {
          name: itemIdentity(node).reviewTitle,
          count,
        }),
      }),
    onEmpty: collectionSurface.close,
  })
  const {
    items: collection,
    setItems: setCollection,
    effectiveItems: effectiveCollection,
    paths: queuedPaths,
    bytes: collectionSize,
    shared: collectionHasSharedPhysicalStorage,
    toggle: toggleCollect,
    add: collectNodes,
    remove: removeCollected,
    uncollect: uncollectNodes,
    isCollected,
    coveringNode: coveringCollectedNode,
  } = review
  const [cleanupResults, setCleanupResults] = useState<CleanupOutcome[]>([])
  const [cleanupResultsOpen, setCleanupResultsOpen] = useState(false)
  const [cleanupPlanNeedsRecheck, setCleanupPlanNeedsRecheck] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    node: DiskScanNode
    x: number
    y: number
  } | null>(null)
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
  const [landscapeEl, setLandscapeEl] = useState<HTMLElement | null>(null)
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
  const gridOverlayRef = useRef<HTMLDivElement | null>(null)
  const volumeScanUnsubsRef = useRef(new Map<string, () => void>())
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)
  const sunburstRef = useRef<Sunburst | undefined>(undefined)
  const tileCameraPrepareRef = useRef<((path: string) => void) | null>(null)
  const registerTileCamera = useCallback(
    (prepare: ((path: string) => void) | null) => {
      tileCameraPrepareRef.current = prepare
    },
    []
  )

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
  const cancelCollectionDragRef = useRef<(() => void) | undefined>(undefined)
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
  // React state lags a just-started job; a scan that resolves at once (a
  // cached snapshot, a tiny folder) must still find it. This mirror is
  // updated synchronously with every put/patch/drop.
  const startedJobsRef = useRef<Record<string, VolumeScanJob | undefined>>({})

  function patchVolumeJob(id: string, patch: Partial<VolumeScanJob>) {
    const started = startedJobsRef.current[id]
    if (started) startedJobsRef.current[id] = { ...started, ...patch }
    setVolumeScanJobs((jobs) =>
      jobs[id] ? { ...jobs, [id]: { ...jobs[id], ...patch } } : jobs
    )
  }

  function putVolumeJob(job: VolumeScanJob) {
    startedJobsRef.current[job.id] = job
    setVolumeScanJobs((jobs) => ({ ...jobs, [job.id]: job }))
  }

  function dropVolumeJob(id: string) {
    startedJobsRef.current[id] = undefined
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
  const rootSpectrum = useMemo(
    () => createSpectrum(treeRoot, colorScheme),
    [treeRoot, colorScheme]
  )
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
    const category = indexFilter.developerCategory
    const ecosystem = indexFilter.developerEcosystem
    const categorized = developer().items.filter(
      ({ recognition }) =>
        (category === "all" || recognition.developer === category) &&
        matchesArtifactEcosystem(recognition, ecosystem)
    )
    return filterDeveloperItemsByAge(categorized, developerAge)
  }, [indexFilter, investigation, developerAge])
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
  const baselineStorage = useMemo(
    () => platform.storage?.("disklizard-baselines.dat"),
    [platform.storage]
  )
  /** Git-style comparison with the previous session's scan of this root. */
  const sinceLastScan = useScanBaseline(
    baselineStorage,
    treeRoot,
    scanSession.activeID,
    scanning
  )
  const sinceLastChanges = useMemo(
    () =>
      new Map(
        (sinceLastScan?.changes ?? []).map((change) => [change.path, change])
      ),
    [sinceLastScan]
  )
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
      query.trim() ||
      duplicateEntryNames.has(
        diskNodeDisplayName(entry.node).toLocaleLowerCase()
      )
        ? 46
        : 36,
    [query, duplicateEntryNames]
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
  const cleanupPolicy = useCleanupPolicy({
    selectedNode,
    scanIdentity: scanSession.activeID,
    disk,
    os: platform.os,
    locks: cleanupLocks,
    protectionsReady: cleanupProtectionsReady(),
    recognitionFor: investigation.recognitionFor,
  })
  const selectedAccess = cleanupPolicy.access
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
  useEffect(
    () => sunburstRef.current?.setQueuedPaths(queuedPaths),
    [queuedPaths]
  )
  // Review is a plan, not a new measurement. Queued treatment is drawn
  // independently; dragging and queuing never subtract from the measured map.
  const projectedPaths = useMemo(() => new Set<string>(), [])
  const visibleMapNode = viewNode
  // Keep a branch's hue anchored to the scanned tree while navigating or
  // previewing a drag. Re-rooting the spectrum at each view recolors the same
  // directory during a camera move and makes nested items look unrelated.
  const spectrum = rootSpectrum
  const tileColor = useCallback(
    (path: string) => spectrum.color({ path, isDir: true }),
    [spectrum]
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
    cleanupPolicy.revision,
  ])
  const smartCleanupCandidates = useMemo(
    () => uniqueDeletionRoots(smartCleanupEligibleEntries, platform.os),
    [smartCleanupEligibleEntries]
  )
  const cleanupSummary = useMemo(
    () =>
      buildCleanupSummary({
        developerItems,
        suggestions: physicalCloneAccountingUncertain
          ? []
          : investigation.recommendations().buckets,
        os: platform.os,
        canModify: canModifyNode,
        isEligible: isSmartCleanupEligible,
        hasUnobservedContents: (node) =>
          mayContainUnobservedContents(treeRoot, node, platform.os),
        matchesFilter: (node, recognition) =>
          matchesDeveloperCleanupAge(node.modifiedAt, developerAge) &&
          matchesArtifactEcosystem(recognition, indexFilter.developerEcosystem),
      }),
    [
      developerItems,
      investigation,
      physicalCloneAccountingUncertain,
      treeRoot,
      platform.os,
      cleanupLocks,
      cleanupLocksStatus,
      cleanupPolicy.revision,
      developerAge,
      indexFilter.developerEcosystem,
    ]
  )
  const currentScanPinned =
    !!scanSourcePath &&
    isPinnedScanLocation(pinnedLocations, scanSourcePath, platform.os)
  const currentScanLocked =
    !!scanSourcePath && isCleanupLock(scanSourcePath, cleanupLocks, platform.os)
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
    return findRetainedNode(root, targetPath)
  }

  function showBrowseNode(
    node: DiskScanNode,
    instant = false,
    /** Commit synchronously when the caller reads the new view right away. */
    urgent = false
  ) {
    const preserveInvestigation = indexFilter.lens !== "all" || !!query.trim()
    if (!instant && scanMode === "grid" && gridInteractive)
      tileCameraPrepareRef.current?.(node.path)
    clearSelectionAnnouncement()
    sunburstRef.current?.navigateTo(node, instant)
    // The map animates on its own canvas clock. Rendering the new folder's
    // sidebar, crumbs and details for a huge scan can take a long frame, so
    // let React do it as a non-urgent update instead of stalling the motion.
    if (instant || urgent) setViewNode(node)
    else startTransition(() => setViewNode(node))
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
      startScan: async (path, label, drive) => {
        live.current.startFolderScan(path, label, drive)
      },
      drives,
      os: platform.os,
    })
  }

  function retainedLocation(path: string) {
    const candidates: RetainedLocationCandidate<"active" | "tab" | "volume">[] =
      []
    if (view === "scan" && treeRoot)
      candidates.push({ kind: "active", id: "active", tree: treeRoot })
    for (const tab of tabs.toReversed())
      candidates.push({ kind: "tab", id: tab.id, tree: tab.tree })
    for (const job of volumeJobs) {
      if (job.status === "complete" && job.tree)
        candidates.push({ kind: "volume", id: job.id, tree: job.tree })
    }
    return findRetainedLocation(path, candidates, platform.os)
  }

  function openRetainedLocation(path: string) {
    if (scanning) return false
    const retained = retainedLocation(path)
    if (!retained) return false
    const { candidate, node } = retained
    if (candidate.kind === "active") {
      if (viewNode?.path === node.path) return true
      browseHistory.visit(node.path)
      showBrowseNode(node)
    } else if (candidate.kind === "tab") {
      switchToTab(candidate.id, node)
    } else {
      const job = volumeScanJobs[candidate.id]
      if (!job?.tree) return false
      openVolumeScan(job, node)
    }
    return true
  }

  function activateStorageLocation(location: DiskStorageLocation) {
    if (openRetainedLocation(location.path)) return
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
    startBackgroundScan({
      kind: "volume",
      path: drive.path,
      label: drive.name,
      drive,
    })
  }

  /**
   * Folder scans run like volume scans: in the background, several at once
   * (within the shared limit), each with its own progress card on Volumes.
   */
  function startFolderScan(path: string, label: string, drive?: DiskDriveInfo) {
    if (openRetainedLocation(path)) return
    startBackgroundScan({
      kind: "folder",
      path,
      label,
      // A neutral stand-in never equals the folder's path, so the scanner
      // never treats a folder as a whole-volume scan.
      drive: drive ?? {
        path: "",
        name: label,
        label,
        total: 0,
        free: 0,
        used: 0,
        type: "local",
      },
    })
  }

  function startBackgroundScan(target: {
    kind: "volume" | "folder"
    path: string
    label: string
    drive: DiskDriveInfo
  }) {
    const api = disk
    if (!api) return
    const { drive } = target
    const existing = volumeJobs.find((job) =>
      diskPathEquals(job.sourcePath, target.path, platform.os)
    )
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

    const id = newScanID(target.kind)
    putVolumeJob({
      id,
      kind: target.kind,
      status: "scanning",
      label: target.label,
      sourcePath: target.path,
      drive,
      files: 0,
      bytes: 0,
      pct: 0,
      currentPath: "",
      startedAt: Date.now(),
      source: undefined,
    })
    let completionObserved = false
    const unsubscribe = api.onScanProgress((progress) => {
      if (progress.scanId !== id) return
      if (progress.done && progress.source) {
        // IPC can deliver the tree and this final event in either order;
        // provenance must survive both.
        completionObserved = true
        const started = startedJobsRef.current[id]
        if (started)
          startedJobsRef.current[id] = { ...started, source: progress.source }
        patchVolumeJob(id, { source: progress.source })
        if (live.current.scanSession.activeID === id)
          setScanCompletionSource(progress.source)
        if (!startedJobsRef.current[id] || started?.status !== "scanning") {
          volumeScanUnsubsRef.current.get(id)?.()
          volumeScanUnsubsRef.current.delete(id)
        }
      }
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
            discoveries: mergeDiscovery(job.discoveries, progress.discovery),
            ...(progress.source ? { source: progress.source } : {}),
          },
        }
      })
    })
    volumeScanUnsubsRef.current.set(id, unsubscribe)
    void runVolumeScan(
      id,
      drive,
      target.path,
      target.label,
      () => completionObserved
    )
  }

  async function runVolumeScan(
    id: string,
    drive: DiskDriveInfo,
    path = drive.path,
    label = drive.name,
    completionObserved = () => true
  ) {
    const api = disk
    if (!api) return
    try {
      const scannedTree = await api.scanPath(
        path,
        scannerOptions(drive, true, path),
        id
      )
      if (!scannedTree) return
      const started = startedJobsRef.current[id]
      const current = started && {
        ...started,
        ...live.current.volumeScanJobs[id],
      }
      if (current?.status !== "scanning") return
      scanHistory.seed(id, scannedTree)
      const tree = includeHiddenSpace(asBrowseableRoot(scannedTree), drive)
      tree._label = label
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
          title: language.t("disk.toast.driveReady", { name: label }),
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
      // Keep listening until the final progress event has carried the
      // scan's provenance; it may arrive after the tree.
      if (completionObserved() || !startedJobsRef.current[id]) {
        volumeScanUnsubsRef.current.get(id)?.()
        volumeScanUnsubsRef.current.delete(id)
      }
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

  function openVolumeScan(job: VolumeScanJob, target?: DiskScanNode) {
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
    setViewNode(target ?? tree)
    browseHistory.reset(target?.path ?? tree.path)
    setScanSourcePath(job.sourcePath)
    setScanCompletionSource(job.source)
    setScanLabel(job.label)
    setScanDrive(job.drive)
    setScanFiles(job.files)
    setScanBytes(job.bytes)
    setScanTotal(job.kind === "folder" ? 0 : job.drive.used)
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
  function switchToTab(id: string, target?: DiskScanNode) {
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
    setViewNode(target ?? tab.view)
    if (target) browseHistory.reset(target.path)
    else browseHistory.replace(tab.browseHistory)
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
    setScanDiscoveries([])
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
    let treeReturned = false
    let completionObserved = false
    let unsubscribe = () => {}
    unsubscribe = api.onScanProgress((p) => {
      if (token !== scanTokenRef.current || p.scanId !== sessionID) return
      if (p.done && p.source) {
        completionObserved = true
        setScanCompletionSource(p.source)
        // IPC's invoke result and progress events can arrive in either order.
        // Retain the listener until the authoritative completion is observed.
        if (treeReturned) {
          unsubscribe()
          if (scanUnsubRef.current === unsubscribe)
            scanUnsubRef.current = undefined
        }
      }
      if (p.discovery)
        setScanDiscoveries((list) => mergeDiscovery(list, p.discovery) ?? list)
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
            discoveries: mergeDiscovery(job.discoveries, p.discovery),
            ...(p.source ? { source: p.source } : {}),
          },
        }
      })
    })
    scanUnsubRef.current = unsubscribe
    try {
      const scannedTree = await api.scanPath(
        path,
        {
          ...scannerOptions(drive, true, path),
          ...(forceFresh ? { forceFresh: true } : {}),
        },
        sessionID
      )
      treeReturned = !!scannedTree
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
        if (!treeReturned || completionObserved) {
          unsubscribe()
          if (scanUnsubRef.current === unsubscribe)
            scanUnsubRef.current = undefined
        }
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
    setScanDiscoveries([])
    const unsubscribe = api.onScanProgress((progress) => {
      if (token !== scanTokenRef.current || progress.scanId !== sessionID)
        return
      if (progress.discovery)
        setScanDiscoveries(
          (list) => mergeDiscovery(list, progress.discovery) ?? list
        )
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
      // The old map stays mounted during a focused rescan. Carry its painted
      // folder into the newly scanned tree before React updates the panels.
      sunburstRef.current?.reconcileAndNavigate(
        nextRoot,
        nextView,
        createSpectrum(nextRoot).tone
      )
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
    // Every "N smaller items" — a wedge, a tile, or a list row — opens the
    // same way: as a place the camera moves into, showing all its members.
    // (Scanner-level groups first fetch the members they don't have yet.)
    // An aggregate already describes a remainder. Keep its members in the
    // current folder's contents panel instead of opening another visual group.
    if (viewNode.isOther) {
      const firstMember = node.children[0]
      const index = firstMember
        ? entries.findIndex((entry) => entry.node.path === firstMember.path)
        : -1
      if (index >= 0) {
        setFocusIdx(index)
        scrollIndexIntoViewRef.current?.(index)
        focusListEntry(index)
      }
      return
    }
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
    if (restoreListFocus) restoreKeyboardViewFocus("contents")
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

  // Pinch (or ⌘/Ctrl+scroll) moves the camera one level: into the
  // top-level folder under the pointer, or back out to the parent.
  usePinchNavigation(view === "scan" ? landscapeEl : null, {
    onZoomIn: (x, y) => {
      if (scanning || morphing || !viewNode) return
      const pointed =
        scanMode === "map"
          ? sunburstRef.current?.nodeAtPoint(x, y)?.path
          : document
              .elementFromPoint(x, y)
              ?.closest<HTMLElement>("[data-disk-tile-path]")?.dataset
              .diskTilePath
      if (!pointed) return
      const target = viewNode.children.find(
        (child) =>
          child.path === pointed ||
          diskPathIsWithin(pointed, child.path, platform.os)
      )
      if (target && (target.isDir || target.isOther)) drill(target)
    },
    onZoomOut: () => {
      if (scanning || morphing) return
      goUp()
    },
  })

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
      !sb ||
      !canvas ||
      !landscape ||
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
          ...landscape.querySelectorAll<HTMLElement>("[data-disk-tile-path]"),
        ].map((el) => {
          const r = el.getBoundingClientRect()
          return [
            el.dataset.diskTilePath!,
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
          "[data-disk-tile-path]"
        )) {
          const rect = source.get(element.dataset.diskTilePath!)
          if (!rect) continue
          ctx.fillStyle = getComputedStyle(element).backgroundColor
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
        }
      }
    }
    setMorphing(true)
    setScanMode(mode)
    setGridVisible(mode === "grid" || previous === "grid")
    setGridInteractive(false)
    setHoveredPath(null)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (version !== viewTransitionVersionRef.current) return
        const target = readRects()
        const overlay = gridOverlayRef.current
        if (overlay) overlay.style.opacity = mode === "grid" ? "0" : "1"
        // A shared transition in two steps. Only top-level folders travel —
        // they are the same thing in both views. Detail steps aside first
        // (deeper rings or nested tiles fade where they are), the shared
        // shapes then unroll or roll up, and the destination's detail
        // settles in last.
        const toGrid = mode !== "map"
        const tiles: MorphTile[] = []
        const travelling = new Set<string>()
        for (const seg of segments) {
          const fromRect = source.get(seg.path)
          const toRect = target.get(seg.path)
          const pad = sunburstSegmentPadding(seg, sb.options.padAngle)
          const wedge = {
            start: seg.start + pad,
            end: seg.end - pad,
            inner: seg.inner,
            outer: seg.outer,
          }
          const colorIndex =
            Array.from({ length: 10 }, (_, i) => i).find(
              (i) => primaryHueForIndex(i) === seg.hue
            ) ?? 0
          const mapColor = seg.tone
            ? toneCss(seg.tone)
            : (spectrum.color(seg.node) ?? toneCss(aggregateTone(seg.depth)))
          const tileRect = toGrid ? toRect : fromRect
          if (seg.depth === 0 && tileRect) {
            travelling.add(seg.path)
            const arc = { shape: "arc" as const, wedge, rect: tileRect }
            const rect = { shape: "rect" as const, wedge, rect: tileRect }
            tiles.push({
              path: seg.path,
              node: seg.node,
              depth: seg.depth,
              colorIndex,
              fromColor: toGrid ? mapColor : tileRect.color,
              toColor: toGrid ? tileRect.color : mapColor,
              from: toGrid ? arc : rect,
              to: toGrid ? rect : arc,
              move: toGrid ? [0.22, 1] : [0, 0.78],
            })
            continue
          }
          const still = {
            shape: "arc" as const,
            wedge,
            rect: { x: 0, y: 0, w: 0, h: 0 },
          }
          tiles.push({
            path: seg.path,
            node: seg.node,
            depth: seg.depth,
            colorIndex,
            fromColor: mapColor,
            toColor: mapColor,
            fromOpacity: toGrid ? 1 : 0,
            toOpacity: toGrid ? 0 : 1,
            from: still,
            to: still,
            fade: toGrid ? [0, 0.34] : [0.66, 1],
          })
        }
        // Nested tiles: arriving ones settle in last, departing ones leave first.
        const otherRects = toGrid ? target : source
        for (const [path, rect] of otherRects) {
          if (travelling.has(path) || !viewNode) continue
          const wedge = { start: 0, end: 0.01, inner: 0, outer: 1 }
          const pose = { shape: "rect" as const, wedge, rect }
          tiles.push({
            path,
            node: viewNode,
            colorIndex: 0,
            fromColor: rect.color,
            toColor: rect.color,
            fromOpacity: toGrid ? 0 : 1,
            toOpacity: toGrid ? 1 : 0,
            from: pose,
            to: pose,
            fade: toGrid ? [0.64, 1] : [0, 0.32],
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
            if (overlay) overlay.style.opacity = ""
            sb.setMorphing(false)
            const queued = queuedModeRef.current
            queuedModeRef.current = null
            if (queued && queued !== mode)
              requestAnimationFrame(() => live.current.chooseScanMode(queued))
          },
          (fraction) => {
            const reveal = Math.max(0, Math.min(1, (fraction - 0.72) / 0.28))
            if (overlay) {
              overlay.style.opacity = String(
                mode === "grid" ? reveal : 1 - Math.min(1, fraction / 0.28)
              )
              if (mode === "grid" && fraction >= 0.9)
                overlay.dataset.labelsVisible = "true"
            }
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
  function restoreKeyboardViewFocus(mode: ScanMode | "contents") {
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
        if (mode === "contents") {
          focusListEntry(
            clampedListIndex(live.current.focusIdx, live.current.entries.length)
          )
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
      showBrowseNode(parent.node, instant, restoreListFocus)
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
    if (
      isPlainShortcut &&
      (event.key === "Escape" || event.key === "Backspace")
    ) {
      event.preventDefault()
      // Going up is one deliberate step, not rapid browsing: let it zoom out
      // like the pointer does (reduced motion still settles instantly).
      goUp(false, true)
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
    // Deep inventory is root-wide, but the navigable tree can still be patched
    // from the confirmed deletion. Drop stale inventory candidates while the
    // watcher reconciles the affected subtree; no root traversal is needed.
    if (deepInventoryNeedsRefresh) setCollection([])
    // A known clone or hard-link owner can transfer physical bytes to a peer
    // outside the removed subtree. That case still needs whole-root accounting.
    if (removed.some(containsSharedPhysicalStorage)) {
      // Known shared ownership invalidates every retained physical map.
      // Basket metadata from those maps is no longer a safe delete candidate.
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

  /** A clean success is a toast; failures or a stale plan keep the results sheet. */
  function reportCleanupOutcomes(
    outcomes: CleanupOutcome[],
    needsRecheck: boolean
  ) {
    setCleanupResults(outcomes)
    if (needsRecheck || outcomes.some((item) => item.status === "failed")) {
      setCleanupResultsOpen(true)
      return
    }
    const trash = nativeTrashName(platform.os)
    showToast({
      variant: "success",
      title: language.t("disk.toast.movedBytes", {
        bytes: formatBytes(
          outcomes.reduce((sum, item) => sum + item.node.size, 0)
        ),
        trash,
      }),
      description:
        outcomes.length === 1
          ? itemIdentity(outcomes[0].node).reviewTitle
          : language.plural("disk.count.item", outcomes.length),
      actions: [
        {
          label: language.t("disk.toast.showTrash", { trash }),
          onClick: () => void openTrash(),
        },
      ],
    })
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
      setCleanupPlanNeedsRecheck(containsSharedPhysicalStorage(node))
      live.current.applyDeletedNodes([node])
      reportCleanupOutcomes(
        [{ node, status: "moved" }],
        containsSharedPhysicalStorage(node)
      )
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

  /** Right-click anywhere in the explorer: rows, wedges, tiles, or layers. */
  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  useEffect(
    () => setContextMenu(null),
    [view, viewNode, scanning, indexFilter.lens]
  )

  function openContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement
    const row = target.closest<HTMLElement>("[data-disk-index]")
    const node = row
      ? entries[Number(row.dataset.diskIndex)]?.node
      : target instanceof HTMLCanvasElement
        ? sunburstRef.current?.nodeAtPoint(event.clientX, event.clientY)
        : (hoveredNode ?? undefined)
    if (!node || node.isHidden) return
    event.preventDefault()
    setContextMenu({ node, x: event.clientX, y: event.clientY })
  }

  function contextMenuItems(node: DiskScanNode): ContextMenuItem[] {
    const collected = isCollected(node.path)
    const locked = isPathCleanupLocked(node.path, cleanupLocks, platform.os)
    const items: ContextMenuItem[] = []
    if (node.isDir && !isDeveloperInventoryNode(node))
      items.push({
        label: language.t(
          node.isOther ? "disk.common.showMore" : "disk.common.open"
        ),
        icon: <CornerDownRight />,
        shortcut: "↩",
        onSelect: () => drill(node),
      })
    if (!node.isOther) {
      items.push(
        {
          label: preview.supportsSystemPreview()
            ? language.t("disk.common.quickLook")
            : language.t("disk.common.preview"),
          icon: <Eye />,
          shortcut: "Space",
          onSelect: () =>
            preview.supportsSystemPreview()
              ? void preview.openSystemPreview(node)
              : void preview.show(node),
        },
        {
          label: nativeRevealLabel(platform.os),
          icon: <FolderSearch />,
          onSelect: () => void reveal(node.path),
        },
        {
          label: language.t("disk.ui.copyPath"),
          icon: <Copy />,
          onSelect: () =>
            void navigator.clipboard
              ?.writeText(node.path)
              .then(() =>
                showToast({ title: language.t("disk.ui.pathCopied") })
              ),
        }
      )
    }
    if (canModifyNode(node) || collected) {
      items.push({ kind: "separator" })
      items.push({
        label: collected
          ? language.t("disk.ui.uncollect")
          : language.t("disk.common.collect"),
        icon: collected ? <Minus /> : <Plus />,
        shortcut: "C",
        onSelect: () => toggleCollect(node),
      })
    }
    if (!node.isOther && !deleting) {
      items.push({
        label: locked
          ? language.t("disk.detail.allowCleanup")
          : language.t("disk.detail.protectCleanup"),
        icon: <Lock />,
        shortcut: "L",
        onSelect: () => void toggleProtectedTree(node.path, node.name),
      })
    }
    if (canModifyNode(node)) {
      items.push({ kind: "separator" })
      items.push({
        label: language.t("disk.ui.moveToTrashEllipsis", {
          trash: nativeTrashName(platform.os),
        }),
        icon: <Trash2 />,
        shortcut: platform.os === "macos" ? "⌘⌫" : "Del",
        danger: true,
        onSelect: () => requestDelete(node),
      })
    }
    return items
  }

  /** Jump the explorer to a path from a comparison or change list. */
  function showPathInMap(path: string) {
    const root = treeRoot
    if (!root) return
    if (indexFilter.lens !== "all") chooseLens("all")
    const node = groupNavigation.resolve(root, path) ?? findScanNode(root, path)
    if (!node) return
    const parent = findScanNode(
      root,
      path.replace(/[\\/][^\\/]+$/, "") || root.path
    )
    if (parent && parent.path !== viewNode?.path) drill(parent)
    setTimeout(() => live.current.selectPath(node.path), 0)
  }

  /** Where a row lives, shown only when the name alone is ambiguous. */
  function entryLocation(node: DiskScanNode) {
    if (
      !query.trim() &&
      !duplicateEntryNames.has(diskNodeDisplayName(node).toLocaleLowerCase())
    )
      return undefined
    const parent = node.path.replace(/[\\/][^\\/]+$/, "")

    return truncatePath(abbreviateHomePath(parent || "/", homePath), 80)
  }

  function selectEligibleDeveloperResults() {
    const candidates = smartCleanupCandidates
    if (!candidates.length) return
    collectNodes(candidates)
    collectionSurface.open()
  }

  function canDragNode(node: DiskScanNode) {
    return !node.isHidden
  }

  function cleanupRestriction(node: DiskScanNode) {
    return cleanupPolicy.restriction(node)
  }

  function canModifyNode(node: DiskScanNode) {
    return cleanupPolicy.canModify(node)
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
  function clearCollection() {
    review.clear()
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
          ? toneCss(segment.tone)
          : undefined
    showCollectionDragPreview(
      collectionDragPreviewRef.current!,
      diskNodeDisplayName(node),
      shortBytes(node.size),
      color ?? tileColor(node.path) ?? toneCss(aggregateTone(0))
    )
    moveCollectionDragPreview(collectionDragPreviewRef.current!, x, y)
  }
  function endCollectionDrag() {
    cancelCollectionDragRef.current = undefined
    if (collectionDragPreviewRef.current)
      hideCollectionDragPreview(collectionDragPreviewRef.current)
    setCollectionDragNode(null)
    setCollectionDropActive(false)
  }
  useEffect(() => {
    // Navigation can unmount the drag source mid-drag. Window listeners keep
    // tracking it, so cancel explicitly when the surface changes or unmounts.
    cancelCollectionDragRef.current?.()
    return () => cancelCollectionDragRef.current?.()
  }, [view, scanMode, indexFilter.lens, canvasEl])

  /** One pointer-driven drag for map wedges, tiles, rows, and previews. */
  function beginCollectionDrag(
    event: PointerDragSource,
    node: DiskScanNode | null,
    onStart?: () => void
  ) {
    if (event.button !== 0 || !node || !canDragNode(node) || morphing) return
    cancelCollectionDragRef.current?.()
    cancelCollectionDragRef.current = trackPointerDrag(event, {
      threshold: event.pointerType === "touch" ? 18 : 6,
      onStart: (x, y) => {
        onStart?.()
        setCollectionDragNode(node)
        setCollectionDropActive(false)
        showDragToken(node, x, y)
      },
      onMove: (x, y) => {
        if (collectionDragPreviewRef.current)
          moveCollectionDragPreview(collectionDragPreviewRef.current, x, y)
        setCollectionDropActive(
          live.current.canModifyNode(node) &&
            live.current.pointerInsideCollectionTarget(x, y)
        )
      },
      onEnd: (x, y, cancelled) => {
        if (
          !cancelled &&
          live.current.canModifyNode(node) &&
          live.current.pointerInsideCollectionTarget(x, y)
        )
          live.current.collectNodes([node])
        endCollectionDrag()
      },
    })
  }

  function beginMapDrag(event: CanvasPointerEvent) {
    if (morphing) return
    const node = sunburstRef.current?.nodeAtPoint(event.clientX, event.clientY)
    beginCollectionDrag(event, node ?? null, () =>
      sunburstRef.current?.suppressNextClick()
    )
  }

  function pointerInsideCollectionTarget(x: number, y: number) {
    const rect = collectionDropElementRef.current?.getBoundingClientRect()
    const slop = 16
    return (
      !!rect &&
      x >= rect.left - slop &&
      x <= rect.right + slop &&
      y >= rect.top - slop &&
      y <= rect.bottom + slop
    )
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
      const invalidatesAllMaps = deepInventoryNeedsRefresh || knownSharedStorage
      if (removed.length) {
        live.current.applyDeletedNodes(removed)
      }
      const retryableFailures = failed.filter(
        ({ node, error }) =>
          !isDeveloperInventoryNode(node) ||
          (!inventoryDeletionNeedsRescan(node) &&
            !isDeveloperArtifactPreconditionRejection(error))
      )
      // Stale deep-inventory rows and a known shared-storage rebuild cannot
      // safely seed the next review basket.
      setCollection(
        invalidatesAllMaps ? [] : retryableFailures.map(({ node }) => node)
      )
      setCleanupPlanNeedsRecheck(knownSharedStorage)
      collectionSurface.close()
      reportCleanupOutcomes(
        [
          ...removed.map((node): CleanupOutcome => ({ node, status: "moved" })),
          ...failed.map(({ node, error }): CleanupOutcome => ({
            node,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          })),
        ],
        knownSharedStorage
      )
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
    // Scans run in parallel now, so every dropped folder gets its own job
    // (the shared limit explains itself if there are too many).
    for (const dropped of Array.from(event.dataTransfer?.files ?? [])) {
      const droppedPath = platform.getPathForFile?.(dropped)
      if (!droppedPath) continue
      startFolderScan(
        droppedPath,
        dropped.name || droppedPath.split(/[/\\]/).pop() || droppedPath,
        driveForPath(droppedPath, drives, platform.os)
      )
    }
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
    if (contextMenu) {
      // The open context menu owns the keyboard until it closes.
      if (e.key === "Escape") {
        e.preventDefault()
        setContextMenu(null)
      }
      return
    }
    if (activeDialog) {
      if (e.defaultPrevented || e.key !== "Escape") return
      e.preventDefault()
      if (deleting) return
      if (cleanupResetSurface.mounted) cleanupResetSurface.close()
      else if (deleteSurface.mounted)
        deleteSurface.closeThen(() => setPendingDelete(null))
      else if (collectionSurface.mounted) collectionSurface.close()
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
    if (
      !scanning &&
      (indexFilter.lens === "developer" ||
        indexFilter.lens === "recommendations")
    ) {
      // Clean Up is a page of its own: Escape returns to the map, Cmd+R
      // rescans, and map navigation keys stay inert.
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        chooseLens("all")
      } else if (
        e.key.toLowerCase() === "r" &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey
      ) {
        e.preventDefault()
        void rescanCurrent()
      }
      return
    }
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
      rings: 7,
      maxSegments: 900,
      padAngle: 0.0018,
      ringGap: 0.006,
      enterAnimMs: sunburstEntryDuration(orbitEntryIntentRef.current),
      canDrag: (node) => live.current.canDragNode(node),
      toneForNode: (node) => live.current.rootSpectrum.tone(node),
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
    void api
      .getHomePath?.()
      .then(setHomePath)
      .catch(() => undefined)
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
    rootSpectrum,
    chooseAndScan,
    openRetainedLocation,
    activateStorageLocation,
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
    startFolderScan,
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
    pointerInsideCollectionTarget,
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
  const cleanupWorkspace =
    indexFilter.lens === "developer" || indexFilter.lens === "recommendations"
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
  return (
    <div
      className="dl-shell relative isolate flex size-full min-h-0 flex-col overflow-hidden bg-background-base text-text-base tabular-nums antialiased"
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
        className="dl-topbar relative z-20 flex h-[52px] shrink-0 items-center gap-2 px-3"
        data-tauri-drag-region
        inert={activeDialog ? true : undefined}
        aria-hidden={activeDialog ? "true" : undefined}
      >
        <DiskAppMenu
          scan={
            view === "scan" && !scanning
              ? {
                  pinned: currentScanPinned,
                  protected: currentScanLocked,
                  pinPending: pinMutationPending,
                  canProtect:
                    !deleting &&
                    cleanupProtectionsReady() &&
                    !cleanupLockMutationPending,
                  onPin: () =>
                    void togglePinnedLocation(scanSourcePath, scanLabel),
                  onProtect: () =>
                    void toggleProtectedTree(scanSourcePath, scanLabel),
                }
              : undefined
          }
        />

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
            onLocation={(index) => {
              if (cleanupWorkspace) chooseLens("all")
              goToCrumb(crumbs[index])
            }}
          />
        )}
        {view === "drives" ? <div className="flex-1" /> : null}
        {view === "scan" && (!scanning || !!focusedScan) ? (
          <div
            className="flex shrink-0 items-center gap-2 pl-2"
            inert={scanning ? true : undefined}
          >
            {!cleanupWorkspace ? (
              <ViewSwitch
                value={scanMode}
                onChange={(value, keyboard) =>
                  chooseScanMode(
                    value,
                    keyboard ? "keyboard" : "pointer",
                    false
                  )
                }
              />
            ) : null}
            <ChangesButton count={historyChangeCount} sinceLast={sinceLastScan}>
              {(close) => (
                <ChangesPanel
                  homePath={homePath}
                  entries={currentHistoryEntries}
                  recent={recentChanges}
                  sinceLast={sinceLastScan}
                  onClear={clearCurrentHistory}
                  onReveal={(path) => void reveal(path)}
                  onShow={(path) => {
                    close()
                    showPathInMap(path)
                  }}
                />
              )}
            </ChangesButton>
            <span
              className="mx-0.5 h-5 w-px bg-[var(--dl-separator)]"
              aria-hidden
            />
            <WorkspaceSwitch
              value={cleanupWorkspace ? "cleanup" : "explore"}
              onChange={(value) =>
                chooseLens(value === "cleanup" ? "developer" : "all")
              }
            />
          </div>
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
                className="min-h-8 min-w-8"
                variant="secondary"
                size="small"
                onClick={() =>
                  void settings.store.general.retryDiskCleanupLocks()
                }
              >
                {language.t("disk.cleanup.retryProtections")}
              </Button>
              <Button
                className="min-h-8 min-w-8"
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
                  folderJobs={volumeJobs.filter((job) => job.kind === "folder")}
                  onCloseJob={closeVolumeScan}
                  canViewLocation={(path) => !!retainedLocation(path)}
                  onActivateStorageLocation={activateStorageLocation}
                  onOpenAccessSettings={() => void openDiskAccessSettings()}
                  onRetryDiagnostics={() => void loadStorageDiagnostics()}
                  onOpenMap={(map) => {
                    switchToTab(map.id)
                  }}
                  onCloseMap={(map) => closeTab(map.id)}
                  onActivatePinnedLocation={(location) => {
                    if (openRetainedLocation(location.path)) return
                    void startScan(
                      location.path,
                      location.label,
                      driveForPath(location.path, drives, platform.os)
                    )
                  }}
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
                !scanning || !!focusedScan ? (
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
                        className="flex shrink-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto border-b border-[var(--dl-separator)] px-3 py-1.5 [&::-webkit-scrollbar]:hidden"
                        role="group"
                        aria-label={language.t("disk.drive.openMaps")}
                      >
                        <span
                          className="flex h-7 max-w-[220px] min-w-0 shrink-0 items-center gap-2 rounded-md bg-[var(--dl-well-strong)] px-2.5 text-[12px] font-medium text-text-strong"
                          aria-current="page"
                          title={scanSourcePath}
                        >
                          <span className="truncate">{scanLabel}</span>
                        </span>
                        {tabs.map((tab) => (
                          <span
                            key={tab.id}
                            className="group flex h-7 max-w-[220px] min-w-0 shrink-0 items-center rounded-md text-text-weak hover:bg-[var(--dl-well)] hover:text-text-strong"
                          >
                            <button
                              type="button"
                              data-disk-tab={tab.id}
                              className="h-full min-w-0 flex-1 truncate rounded-md pr-1 pl-2.5 text-left text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
                              title={tab.sourcePath}
                              onClick={() => switchToTab(tab.id)}
                              onAuxClick={(event) => {
                                if (event.button === 1) {
                                  event.preventDefault()
                                  closeTab(tab.id)
                                }
                              }}
                            >
                              {tab.label}
                            </button>
                            <button
                              type="button"
                              className="mr-1 grid size-5 shrink-0 place-items-center rounded text-text-weaker opacity-0 outline-none group-hover:opacity-100 hover:bg-[var(--dl-well-strong)] hover:text-text-strong focus-visible:opacity-100"
                              aria-label={language.t("disk.pinned.remove", {
                                name: tab.label,
                              })}
                              onClick={() => closeTab(tab.id)}
                            >
                              <Icon name="close-small" className="size-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {cleanupWorkspace ? (
                      <CleanupView
                        summary={cleanupSummary}
                        homePath={homePath}
                        onInspect={cleanupPolicy.request}
                        onObserve={cleanupPolicy.request}
                        accessFor={cleanupPolicy.accessFor}
                        onCheckAccess={cleanupPolicy.retry}
                        onRescan={() => void rescanCurrent()}
                        protectionFor={(node) =>
                          cleanupLockForPath(
                            node.path,
                            cleanupLocks,
                            platform.os
                          )
                        }
                        onUnprotect={(lock) =>
                          void toggleProtectedTree(lock.path, lock.label)
                        }
                        customAgeDays={indexFilter.customDeveloperAgeDays}
                        onCustomAgeDays={setCustomDeveloperCleanupAgeDays}
                        isCollected={isCollected}
                        coveredBy={(path) => {
                          const cover = coveringCollectedNode(path)
                          return cover
                            ? itemIdentity(cover).reviewTitle
                            : undefined
                        }}
                        canModify={canModifyNode}
                        restriction={(node) => {
                          const key = cleanupRestriction(node)
                          return key ? language.t(key) : undefined
                        }}
                        collectionCount={effectiveCollection.length}
                        collectionBytes={collectionSize}
                        trashName={nativeTrashName(platform.os)}
                        agePreset={indexFilter.developerAge}
                        ecosystems={developerEcosystems}
                        ecosystem={indexFilter.developerEcosystem}
                        inventoryNote={
                          treeRoot?.developerArtifactInventory?.status.state ===
                          "partial"
                            ? developerInventoryCoverage(
                                treeRoot.developerArtifactInventory
                              )
                            : undefined
                        }
                        onAgePreset={chooseDeveloperCleanupAge}
                        onEcosystem={chooseDeveloperEcosystem}
                        onToggle={toggleCollect}
                        onCollect={collectNodes}
                        onRelease={uncollectNodes}
                        onClear={clearCollection}
                        onReview={() => collectionSurface.open()}
                        onReveal={(node) => void reveal(node.path)}
                        onPreview={(node) => {
                          if (preview.supportsSystemPreview()) {
                            void preview.openSystemPreview(node)
                          } else {
                            void preview.show(node)
                          }
                        }}
                        changeFor={(path) => sinceLastChanges.get(path)}
                      />
                    ) : (
                      <div
                        onContextMenu={openContextMenu}
                        className="relative flex min-h-0 w-full flex-1 overflow-hidden max-[840px]:grid max-[840px]:grid-rows-[minmax(260px,45%)_minmax(0,1fr)]"
                      >
                        <section
                          ref={(el: HTMLElement | null) => {
                            landscapeElRef.current = el
                            setLandscapeEl(el)
                          }}
                          className={cn(
                            "[container-type:size] relative min-h-0 min-w-0 flex-1 overflow-hidden [--dl-footer-height:72px] [view-transition-name:disk-landscape]",
                            selectedNode &&
                              (effectiveCollection.length > 0 ||
                                collectionDragNode) &&
                              "max-[1100px]:[--dl-footer-height:116px]"
                          )}
                        >
                          {scanning && focusedScan ? (
                            <div
                              role="status"
                              className="pointer-events-none absolute top-4 right-4 z-20 rounded-lg bg-[var(--dl-popover)] px-3 py-2 text-[12px] text-text-strong shadow-lg"
                            >
                              {language.t("disk.scan.label", {
                                label: focusedScan.label,
                              })}
                              <span className="ml-2 text-text-weak tabular-nums">
                                {language.t("disk.scan.fileCount", {
                                  count: scanFiles.toLocaleString(),
                                })}
                              </span>
                            </div>
                          ) : null}
                          <p className="sr-only">
                            {language.t("disk.map.colorMeaning")}
                          </p>
                          {/* The map canvas persists across map⇄grid so ViewMorph can fly
                              wedges into tile poses on one surface; CenterOverlay yields
                              while a morph owns the view. */}
                          <div
                            className="@container [container-type:inline-size] absolute inset-x-0 top-0 bottom-[var(--dl-footer-height)]"
                            style={{
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
                              className="absolute inset-0 size-full [touch-action:none] outline-none"
                              tabIndex={0}
                              role="region"
                              data-map-size={visibleMapNode?.size ?? 0}
                              aria-roledescription={language.t("disk.map.role")}
                              aria-describedby="disklizard-orbit-help"
                              aria-controls="disklizard-storage-list"
                              aria-label={language.t("disk.map.label", {
                                label: scanLabel,
                              })}
                              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End PageUp PageDown Enter Space C L Delete Backspace Escape 1 2"
                              onPointerDown={beginMapDrag}
                            />
                            <span
                              id="disklizard-orbit-help"
                              className="sr-only"
                            >
                              {language.t("disk.map.instructions")}
                            </span>
                            {scanMode === "map" || morphing ? (
                              <div
                                className={cn(
                                  "pointer-events-none absolute inset-0 transition-opacity duration-150",
                                  morphing ? "opacity-0" : "opacity-100"
                                )}
                              >
                                <CenterOverlay
                                  node={visibleMapNode}
                                  hovered={
                                    hoveredNode &&
                                    hoveredPath === hoveredNode.path &&
                                    hoveredNode.path !== visibleMapNode?.path
                                      ? hoveredNode
                                      : null
                                  }
                                />
                              </div>
                            ) : null}
                          </div>
                          {gridVisible ? (
                            <div
                              ref={gridOverlayRef}
                              data-labels-visible={gridInteractive}
                              style={
                                gridInteractive
                                  ? undefined
                                  : { opacity: scanMode === "grid" ? 0 : 1 }
                              }
                              className={cn(
                                "dl-treemap-overlay absolute inset-x-0 top-0 bottom-[var(--dl-footer-height)] px-6 pt-6 pb-2",
                                !gridInteractive && "pointer-events-none"
                              )}
                              inert={!gridInteractive ? true : undefined}
                              aria-hidden={
                                !gridInteractive ? "true" : undefined
                              }
                            >
                              <Treemap
                                rootPath={viewNode?.path ?? ""}
                                onPrepareNavigation={registerTileCamera}
                                parent={
                                  parentView
                                    ? {
                                        node: parentView,
                                        onUp: goUpFromMapCenter,
                                      }
                                    : undefined
                                }
                                rootIsAggregate={viewNode?.isOther}
                                colorForPath={tileColor}
                                colorForNode={(node) => spectrum.color(node)}
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
                              />
                            </div>
                          ) : null}

                          {/* Map footer: the collector on the left, the current selection on the right. */}
                          <div
                            className={cn(
                              "absolute inset-x-0 bottom-0 z-20 flex h-[var(--dl-footer-height)] items-center gap-3 px-4 max-[760px]:px-2.5",
                              selectedNode &&
                                (effectiveCollection.length > 0 ||
                                  collectionDragNode) &&
                                "max-[1100px]:flex-col max-[1100px]:items-stretch max-[1100px]:justify-center max-[1100px]:gap-1"
                            )}
                          >
                            <div
                              className={cn(
                                "min-w-0 shrink",
                                selectedNode &&
                                  effectiveCollection.length === 0 &&
                                  !collectionDragNode &&
                                  "max-[1100px]:hidden"
                              )}
                            >
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
                                compact={!!selectedNode}
                                onReview={() => collectionSurface.open()}
                                onClear={clearCollection}
                              />
                            </div>
                            <div className="flex min-w-0 flex-1 items-center justify-end max-[1100px]:w-full">
                              <AnimatePresence mode="popLayout" initial={false}>
                                {selectedNode ? (
                                  <motion.div
                                    key="selection"
                                    className="w-full max-w-[560px] min-w-0"
                                    initial={{
                                      opacity: 0,
                                      y: 8,
                                      scale: 0.98,
                                    }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                                    transition={{
                                      duration: 0.18,
                                      ease: [0.22, 1, 0.36, 1],
                                    }}
                                  >
                                    <DetailBar
                                      node={selectedNode}
                                      color={
                                        spectrum.color(selectedNode) ??
                                        rootSpectrum.color(selectedNode)
                                      }
                                      recognition={investigation.recognitionFor(
                                        selectedNode
                                      )}
                                      parentSize={indexSize}
                                      deletable={canModifyNode(selectedNode)}
                                      collected={isCollected(selectedNode.path)}
                                      reviewHasItems={
                                        effectiveCollection.length > 0
                                      }
                                      includedBy={
                                        coveringCollectedNode(selectedNode.path)
                                          ? itemIdentity(
                                              coveringCollectedNode(
                                                selectedNode.path
                                              )!
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
                                        selectedAccess?.path ===
                                        selectedNode.path
                                          ? selectedAccess.state
                                          : "not-checked"
                                      }
                                      onCheckAccess={() =>
                                        cleanupPolicy.retry()
                                      }
                                      trashName={nativeTrashName(platform.os)}
                                      revealLabel={nativeRevealLabel(
                                        platform.os
                                      )}
                                      onPreview={
                                        selectedNode.isOther ||
                                        selectedNode.isHidden
                                          ? undefined
                                          : () =>
                                              void preview.show(selectedNode)
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
                                      onReveal={() =>
                                        void reveal(selectedNode.path)
                                      }
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
                                      onTrash={() =>
                                        requestDelete(selectedNode)
                                      }
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
                                  </motion.div>
                                ) : null}
                              </AnimatePresence>
                            </div>
                          </div>
                        </section>

                        <aside className="[container-type:inline-size] relative flex min-h-0 w-[clamp(300px,26vw,360px)] shrink-0 flex-col overflow-hidden border-l border-[var(--dl-separator)] bg-[var(--dl-sidebar)] max-[840px]:w-full max-[840px]:border-t max-[840px]:border-l-0">
                          {hoverPreviewVisible && hoverPreviewNode ? (
                            <DiskUtilityHoverContents
                              node={hoverPreviewNode}
                              colorForNode={(node) => spectrum.color(node)}
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
                          <div
                            className="flex min-h-0 w-full flex-1 flex-col"
                            onMouseEnter={() => {
                              if (!hoverPreviewVisible) return
                              setMapHoverCandidate(null)
                              hoverPreview.dismiss()
                              hoverEntry(null)
                            }}
                          >
                            <div className="shrink-0 px-5 pt-5 pb-3">
                              <div className="flex items-start gap-3">
                                <div className="min-w-0 flex-1">
                                  <h2
                                    className="line-clamp-2 text-[18px] leading-6 font-medium tracking-[-0.02em] [overflow-wrap:anywhere] text-text-strong"
                                    title={viewNode?.path}
                                  >
                                    {query.trim()
                                      ? language.t("disk.search.results")
                                      : viewNode?._label ||
                                        (viewNode
                                          ? diskNodeDisplayName(viewNode)
                                          : language.t("disk.common.contents"))}
                                  </h2>
                                  <div className="mt-0.5 flex items-center gap-2">
                                    <p className="text-[12.5px] text-text-weak tabular-nums">
                                      {language.plural(
                                        "disk.count.item",
                                        indexCount
                                      )}
                                    </p>
                                  </div>
                                </div>
                                {!query.trim() ? (
                                  <p className="shrink-0 pt-0.5 text-[13px] leading-6 text-text-weak tabular-nums">
                                    {formatBytes(indexSize)}
                                  </p>
                                ) : null}
                              </div>
                              <div className="mt-3">
                                {searchVisible ? (
                                  <DiskUtilitySearchTools
                                    compact
                                    developer={false}
                                    grouped={groupDeveloper}
                                    onGroup={setGroupDeveloper}
                                    query={query}
                                    label={language.t("disk.search.label")}
                                    placeholder={language.t(
                                      "disk.search.placeholder"
                                    )}
                                    sortKey={indexFilter.sortKey}
                                    sortDirection={indexFilter.sortDirection}
                                    showSort
                                    onQuery={updateQuery}
                                    onSort={updateSort}
                                    onDismiss={closeSearch}
                                  />
                                ) : (
                                  <button
                                    ref={searchTriggerRef}
                                    type="button"
                                    className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-[13px] text-text-weaker transition-colors outline-none hover:bg-[var(--dl-well-strong)] hover:text-text-weak focus-visible:ring-2 focus-visible:ring-[var(--dl-focus)]"
                                    aria-label={language.t("disk.search.label")}
                                    aria-expanded={false}
                                    onClick={() => openSearch()}
                                  >
                                    <Icon
                                      name="magnifying-glass"
                                      className="size-3.5"
                                    />
                                    <span className="min-w-0 flex-1 truncate">
                                      {language.t("disk.search.placeholder")}
                                    </span>
                                    <kbd className="font-sans text-[11px] text-text-weaker">
                                      {platform.os === "macos"
                                        ? "⌘F"
                                        : "Ctrl F"}
                                    </kbd>
                                  </button>
                                )}
                              </div>
                            </div>

                            {entries.length > 0 ? (
                              <VirtualIndex
                                footer={
                                  viewNode &&
                                  treeRoot &&
                                  !diskPathEquals(
                                    viewNode.path,
                                    treeRoot.path,
                                    platform.os
                                  ) &&
                                  !query.trim() ? (
                                    <FolderContext
                                      node={viewNode}
                                      root={treeRoot}
                                      color={
                                        spectrum.color(viewNode) ??
                                        rootSpectrum.color(viewNode) ??
                                        "var(--dl-accent)"
                                      }
                                      revealLabel={nativeRevealLabel(
                                        platform.os
                                      )}
                                      onReveal={() =>
                                        void reveal(viewNode.path)
                                      }
                                    />
                                  ) : undefined
                                }
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
                                render={(entry, i) => (
                                  <StorageRow
                                    node={entry.node}
                                    index={i()}
                                    size={entry.displaySize}
                                    color={
                                      spectrum.color(entry.node) ??
                                      rootSpectrum.color(entry.node) ??
                                      "var(--text-weaker)"
                                    }
                                    query={query}
                                    location={entryLocation(entry.node)}
                                    active={selectedPath === entry.node.path}
                                    hovered={hoveredPath === entry.node.path}
                                    collected={isCollected(entry.node.path)}
                                    includedBy={
                                      coveringCollectedNode(entry.node.path)
                                        ? itemIdentity(
                                            coveringCollectedNode(
                                              entry.node.path
                                            )!
                                          ).reviewTitle
                                        : undefined
                                    }
                                    canCollect={canModifyNode(entry.node)}
                                    draggable={canDragNode(entry.node)}
                                    onActivate={(event) => {
                                      if (entry.node.isDir && !event.shiftKey)
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
                                      handleEntryKeyDown(event, entry.node, i())
                                    }
                                    onHover={(hovered) =>
                                      hovered
                                        ? hoverEntry(
                                            entry.node.path,
                                            entry.node
                                          )
                                        : hoverEntry(selectedPath ?? null)
                                    }
                                    onToggleCollect={() =>
                                      toggleCollect(entry.node)
                                    }
                                    onDragStart={(event) =>
                                      beginCollectionDrag(event, entry.node)
                                    }
                                  />
                                )}
                              />
                            ) : (
                              <ScrollView className="min-h-0 flex-1">
                                <IndexEmpty
                                  title={
                                    query.trim()
                                      ? language.t("disk.empty.queryTitle", {
                                          query: query.trim(),
                                        })
                                      : treeRoot?.scanIssues
                                        ? language.t("disk.empty.partialTitle")
                                        : undefined
                                  }
                                  body={
                                    query.trim()
                                      ? language.t("disk.empty.search.body")
                                      : treeRoot?.scanIssues
                                        ? language.t("disk.empty.partialBody")
                                        : undefined
                                  }
                                  actionLabel={
                                    query.trim()
                                      ? language.t("disk.search.clear")
                                      : undefined
                                  }
                                  kind={query.trim() ? "search" : "folder"}
                                  onReset={() => setQuery("")}
                                />
                              </ScrollView>
                            )}

                            {showVolumeCapacity ||
                            treeRoot?.scanIssues ||
                            physicalCloneAccountingWarning ? (
                              <div className="shrink-0 border-t border-[var(--dl-separator)] px-2 py-2">
                                {showVolumeCapacity && scanDrive ? (
                                  <FreeSpaceRow drive={scanDrive} />
                                ) : null}
                                <ScanIssuesNotice
                                  unreadableCount={
                                    treeRoot?.scanIssues?.unreadableCount
                                  }
                                  samplePaths={
                                    treeRoot?.scanIssues?.samplePaths
                                  }
                                  guidance={language.t(
                                    scanAccessGuidance(platform.os)
                                  )}
                                  accountingWarning={
                                    physicalCloneAccountingWarning
                                  }
                                  onRescan={() => void rescanCurrent(true)}
                                  onOpenPrivacy={
                                    storageDiagnostics?.access.status ===
                                    "limited"
                                      ? () => void openDiskAccessSettings()
                                      : undefined
                                  }
                                />
                              </div>
                            ) : null}
                          </div>
                        </aside>
                      </div>
                    )}
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
                      label: scanLabel,
                    })}
                  >
                    <ScanFormation
                      discoveries={scanDiscoveries}
                      totalBytes={
                        scanDrive &&
                        diskPathEquals(
                          scanSourcePath,
                          scanDrive.path,
                          platform.os
                        )
                          ? scanDrive.used
                          : 0
                      }
                      label={scanLabel}
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
                      className="min-h-8 min-w-8"
                      size="small"
                      variant="primary"
                      onClick={() => void platform.restart?.()}
                    >
                      {language.t("disk.top.restart")}
                    </Button>
                  ) : null}
                  {showNativeAppMenu && platform.exportDiagnostics ? (
                    <Button
                      className="min-h-8 min-w-8"
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

      <NodeContextMenu
        at={contextMenu}
        title={contextMenu ? diskNodeDisplayName(contextMenu.node) : undefined}
        items={contextMenu ? contextMenuItems(contextMenu.node) : []}
        onClose={closeContextMenu}
      />

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

      {collectionSurface.mounted ? (
        <CollectionDialog
          open={
            collectionSurface.phase === "open" ||
            collectionSurface.phase === "opening"
          }
          items={effectiveCollection}
          homePath={homePath}
          restrictionFor={(node) => {
            const key = cleanupRestriction(node)
            return key ? language.t(key) : undefined
          }}
          accessFor={cleanupPolicy.accessFor}
          onObserve={cleanupPolicy.request}
          onCheckAccess={cleanupPolicy.retry}
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
          homePath={homePath}
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
