import { EMPTY_SCAN_WORKSPACE, transitionScanWorkspace } from "./scan-workspace"
import { useCollectionDrag } from "./use-collection-drag"
import { useWorkspaceProtections } from "./use-workspace-protections"
import { reconcileDeletedMaps } from "./deletion-reconciliation"
import type { DiskUtilityViewProps } from "./DiskUtilityView"
import { useDiskInvestigation } from "./use-disk-investigation"
import { useDriveDiscovery } from "./use-drive-discovery"
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
import { buildCleanupSummary } from "./cleanup-summary"
import { createExplorerKeyboard } from "./explorer-keyboard"
import { useForegroundScan } from "./use-foreground-scan"
import { createGroupNavigation } from "./group-navigation"
import { mergeDiscovery } from "./live-scan"
import { type ContextMenuItem } from "./NodeContextMenu"
import { planOtherExpansion } from "./other-expansion"
import { scannerOptions } from "./scanner-options"
import { createSpectrum } from "./spectrum"
import { useBackgroundScans } from "./use-background-scans"
import { useCleanupExecution } from "./use-cleanup-execution"
import {
  inventoryDeletionNeedsRescan,
  useCleanupPolicy,
} from "./use-cleanup-policy"
import { useDiskActions } from "./use-disk-actions"
import { useReviewCollection } from "./use-review-collection"
import { useScanBaseline } from "./use-scan-baseline"
import { useResolvedColorScheme } from "@/components/dl/theme"
import { showToast } from "@/components/dl/toast"
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
} from "react"
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useReducer,
} from "react"
import { useDiskBrowseHistory } from "./use-disk-browse-history"
import { useDiskPreview } from "./use-disk-preview"
import {
  chooseFolderAndScan,
  DISK_CHOOSE_FOLDER_COMMAND,
} from "./choose-folder"
import {
  isCleanupLock,
  isPathCleanupLocked,
  withoutCleanupLockedNodes,
} from "./cleanup-lock"
import { withoutCollected } from "./collection-map"
import {
  matchesDeveloperCleanupAge,
  type DeveloperCleanupAgePreset,
} from "./developer-cleanup"
import {
  developerInventoryCollectionNodeForPath,
  developerInventoryRootsNeedRefresh,
  isDeveloperInventoryNode,
} from "./developer-inventory"
import type { VolumeScanJob } from "./scan-jobs"
import {
  type DiskEntrySortDirection,
  type DiskEntrySortKey,
} from "./entry-view"
import { byteUnitBaseForOs, setByteUnitBase, truncatePath } from "./format"
import { abbreviateHomePath, itemIdentity } from "./item-identity"
import {
  clampedListIndex,
  pagedListIndex,
  wrappedListIndex,
} from "./list-navigation"
import { useSurfacePresence } from "./motion"
import {
  describeStorageNode,
  findRetainedNode,
  nativeRevealLabel,
  nativeTrashName,
  type Crumb,
} from "./navigation"
import { diskNodeDisplayName } from "./node-display"
import { usePinchNavigation } from "./pinch-navigation"
import {
  isSmartCleanupEligible,
  matchesArtifactEcosystem,
  type ArtifactEcosystemFilter,
} from "./recognize"
import {
  findRetainedLocation,
  type RetainedLocationCandidate,
} from "./retained-location"
import {
  createPersistenceErrorDeduper,
  useLanguage,
  usePlatform,
  useSettings,
} from "./runtime"
import {
  createScanHistory,
  filterScanHistoryEntries,
  type ScanHistoryEntry,
} from "./scan-history"
import { type ScanInvestigationLens } from "./scan-investigation"
import { clearReviewForRootScan } from "./scan-lifecycle"
import { isScanCancellation } from "./scan-progress"
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
import {
  asBrowseableRoot,
  diskPathEquals,
  diskPathIsWithin,
  driveForPath,
  hasUnverifiedPhysicalCloneAccounting,
  includeHiddenSpace,
  isPinnedScanLocation,
  mayContainUnobservedContents,
  replaceScanSubtree,
} from "./storage"
import type {
  DiskDriveInfo,
  DiskScanNode,
  DiskScanUpdate,
  DiskStorageLocation,
} from "./types"
import { useDiskVisualization, type ScanMode } from "./use-disk-visualization"

type IndexLens = ScanInvestigationLens
type FocusedExpansionOptions = {
  group?: { node: DiskScanNode; excludedPaths: ReadonlySet<string> }
  label?: string
  maxChildren?: number
}
const DEFAULT_LIST_PAGE_SIZE = 10
/** Bounded trusted-rescan budget for expanding a scanner-collapsed subtree. */
const COLLAPSED_EXPANSION_MAX_CHILDREN = 48
export function useDiskUtilityWorkspace() {
  const platform = usePlatform()
  setByteUnitBase(byteUnitBaseForOs(platform.os))
  useEffect(() => {
    document.documentElement.dataset.dlOs = platform.os
  }, [platform.os])
  const language = useLanguage()
  const colorScheme = useResolvedColorScheme()
  const settings = useSettings()
  const { reveal, openTrash, exportDiagnostics } = useDiskActions()
  const isDesktop = platform.platform === "desktop"
  const disk = isDesktop ? platform.diskUtility : undefined

  const [scanWorkspace, transitionScan] = useReducer(
    transitionScanWorkspace,
    EMPTY_SCAN_WORKSPACE
  )
  const view = scanWorkspace.phase === "home" ? "drives" : "scan"
  const {
    root: treeRoot,
    node: viewNode,
    label: scanLabel,
    sourcePath: scanSourcePath,
    drive: scanDrive,
    focused: focusedExpansion,
  } = scanWorkspace
  const focusedScan = focusedExpansion ?? null
  const scanning =
    scanWorkspace.phase === "scanning" || scanWorkspace.phase === "expanding"
  const scanSession = {
    activeID: scanWorkspace.activeID,
    foregroundID: scanWorkspace.foregroundID,
  }
  const {
    homePath,
    drives,
    drivesLoading,
    drivesError,
    storageDiagnostics,
    storageDiagnosticsError,
    loadDrives,
    loadStorageDiagnostics,
  } = useDriveDiscovery({
    disk,
    os: platform.os,
    language,
    visible: view === "drives",
  })

  const foregroundScans = useForegroundScan(disk)
  const {
    files: scanFiles,
    total: scanTotal,
    pct: scanPct,
    bytes: scanBytes,
    tail: scanTail,
    discoveries: scanDiscoveries,
    source: scanCompletionSource,
  } = foregroundScans.progress
  const [selectedPath, setSelectedPath] = useState<string | undefined>()
  const [hoveredPath, setHoveredPath] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<DiskScanNode | null>(null)
  const [focusIdx, setFocusIdx] = useState(0)
  const [query, setQuery] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [announcedSelection, setAnnouncedSelection] = useState("")
  const collectionSurface = useSurfacePresence()
  const cleanupResetSurface = useSurfacePresence()
  const [tabs, setTabs] = useState<ScanTab[]>([])
  const scanHistory = useMemo(() => createScanHistory({ os: platform.os }), [])
  const [historyEntries, setHistoryEntries] = useState<ScanHistoryEntry[]>(() =>
    scanHistory.entries()
  )
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
  const {
    pendingDelete,
    setPendingDelete,
    deleting,
    deletionProgress,
    deleteSurface,
    cleanupResults,
    cleanupResultsOpen,
    setCleanupResultsOpen,
    cleanupPlanNeedsRecheck,
    confirmDelete,
    requestDelete,
    deleteCollected,
  } = useCleanupExecution({
    disk,
    os: platform.os,
    language,
    cleanupLocks: settings.locks,
    cleanupProtectionsReady: () => settings.cleanupLocksStatus === "ready",
    ensureCleanupProtectionsReady: () => ensureCleanupProtectionsReady(),
    canModifyNode: (node) => canModifyNode(node),
    showDeveloperArtifactRescanGuidance: (node) =>
      showDeveloperArtifactRescanGuidance(node),
    effectiveCollection,
    setCollection,
    collectionSurface,
    requiresDeepInventoryRefresh: (removed) =>
      live.current.requiresDeepInventoryRefresh(removed),
    applyDeletedNodes: (removed) => live.current.applyDeletedNodes(removed),
    openTrash,
  })
  const [dropActive, setDropActive] = useState(false)
  const [contextMenu, setContextMenu] = useState<{
    node: DiskScanNode
    x: number
    y: number
  } | null>(null)
  const {
    collectionDragNode,
    collectionDropActive,
    collectionDragPreviewRef,
    collectionDropElementRef,
    beginCollectionDrag,
    beginMapDrag,
    cancel: cancelCollectionDrag,
  } = useCollectionDrag({
    canDrag: (node) => live.current.canDragNode(node) && !live.current.morphing,
    canModify: (node) => live.current.canModifyNode(node),
    collect: (nodes) => live.current.collectNodes(nodes),
    color: (node) =>
      scanMode === "grid"
        ? tileColor(node.path)
        : (map.color(node.path) ?? tileColor(node.path)),
    nodeAtPoint: (x, y) => map.nodeAtPoint(x, y) ?? undefined,
    suppressNextClick: () => map.suppressNextClick(),
  })
  // A foreground scan cancels only on a second Escape inside this window.
  const SCAN_CANCEL_ARM_MS = 2000
  const cancelArmedAtRef = useRef(0)
  // The shortcuts popover (<details>) tracks open state for Escape/outside-click dismissal.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const scanProgressRegionRef = useRef<HTMLDivElement | undefined>(undefined)
  const shortcutsDetailsRef = useRef<HTMLDetailsElement | null>(null)
  const scanUpdateUnsubRef = useRef<(() => void) | undefined>(undefined)
  const keyboardContext =
    useRef<Parameters<typeof createExplorerKeyboard>[0]>(undefined)
  const keyboard: ReturnType<typeof createExplorerKeyboard> = useMemo(
    () => createExplorerKeyboard(() => keyboardContext.current!()),
    []
  )
  const { handleEntryKeyDown } = keyboard
  const lastWatchErrorRef = useRef<string | undefined>(undefined)
  const dragDepthRef = useRef(0)
  const selectionAnnouncementTimerRef = useRef<
    ReturnType<typeof setTimeout> | undefined
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
  const {
    pinMutationPending,
    cleanupLockMutationPending,
    cleanupProtectionsReady,
    ensureCleanupProtectionsReady,
    togglePinnedLocation,
    toggleProtectedTree,
  } = useWorkspaceProtections({
    deleting,
    onLocksChanged: (locks) =>
      setCollection((items) =>
        withoutCleanupLockedNodes(items, locks, platform.os)
      ),
  })

  const {
    jobs: volumeScanJobs,
    list: volumeJobs,
    running: runningVolumeScans,
    setJobs: setVolumeScanJobs,
    patch: patchVolumeJob,
    drop: dropVolumeJob,
    start: startBackgroundScan,
    cancel: cancelVolumeScan,
    close: closeVolumeScan,
  } = useBackgroundScans({
    api: disk,
    os: platform.os,
    scanOptions: (drive, path) =>
      scannerOptions(platform.os, drive, true, path),
    onScanned: (id, tree) => scanHistory.seed(id, tree),
    onForget: (id) => scanHistory.forget(id),
    onLimit: () =>
      showToast({
        variant: "default",
        title: language.t("disk.toast.scanLimit"),
        description: language.t("disk.toast.scanLimitBody"),
      }),
    onCompletionSource: (id, source) => {
      if (live.current.scanSession.activeID === id)
        foregroundScans.setSource(source)
    },
    onReady: (job) => {
      if (live.current.view === "drives" && !live.current.scanning) {
        live.current.openVolumeScan(job)
      } else {
        showToast({
          variant: "default",
          title: language.t("disk.toast.driveReady", { name: job.label }),
          description: language.t("disk.toast.driveReadyBody"),
          actions: [
            {
              label: language.t("disk.drive.action.view"),
              onClick: () => {
                const latest = live.current.volumeScanJobs[job.id]
                if (latest?.tree) live.current.openVolumeScan(latest)
              },
            },
          ],
        })
      }
    },
  })

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
    cancelCollectionDrag()
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
  const {
    indexFilter,
    replaceIndexFilter,
    investigation,
    developerAge,
    developerItems,
    developerEcosystems,
    parentSize,
    recentChanges,
    recentLens,
    setRecentLens,
    groupDeveloper,
    setGroupDeveloper,
    deriveEntries,
    entries,
    duplicateEntryNames,
    entryRowHeight,
    indexSize,
    indexCount,
  } = useDiskInvestigation({
    treeRoot,
    viewNode,
    os: platform.os,
    cleanupLocks,
    physicalCloneAccountingUncertain,
    historyChangeCount,
    query,
  })
  const sortedChildren = useMemo(
    () =>
      [...(viewNode?.children ?? [])].sort(
        (left, right) => right.size - left.size
      ),
    [viewNode]
  )
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
  // Like DaisyDisk: the map shows the disk as it would be without what you
  // are removing. The moment a drag starts the item leaves the map (and comes
  // back if the drag is cancelled); items in the collector stay out of it.
  // This is a reversible projection — the scan itself is never modified.
  const projectedPaths = useMemo(() => {
    const paths = new Set(queuedPaths)
    if (collectionDragNode && canModifyNode(collectionDragNode))
      paths.add(collectionDragNode.path)
    return paths
    // canModifyNode reads policy that only changes with the scan.
  }, [queuedPaths, collectionDragNode])
  const projectedViewNode = useMemo(
    () =>
      viewNode && projectedPaths.size
        ? withoutCollected(viewNode, projectedPaths)
        : viewNode,
    [viewNode, projectedPaths]
  )
  const visibleMapNode = viewNode
  // Keep a branch's hue anchored to the scanned tree while navigating or
  // previewing a drag. Re-rooting the spectrum at each view recolors the same
  // directory during a camera move and makes nested items look unrelated.
  const spectrum = rootSpectrum
  const tileColor = useCallback(
    (path: string) => spectrum.color({ path, isDir: true }),
    [spectrum]
  )
  const {
    scanMode,
    morphing,
    gridVisible,
    gridInteractive,
    canvasEl,
    setCanvasEl,
    landscapeEl,
    setLandscapeEl,
    landscapeElRef,
    gridOverlayRef,
    registerTileCamera,
    chooseScanMode,
    map,
  } = useDiskVisualization({
    treeRoot,
    viewNode,
    queuedPaths,
    excludedPaths: projectedPaths,
    spectrum,
    canDrag: (node) => live.current.canDragNode(node),
    onHover: (node) => live.current.handleMapHover(node),
    onActivate: (node) => {
      if (node.isOther || node.isDir) live.current.drill(node)
      else live.current.selectPath(node.path)
    },
    onUp: () => live.current.goUpFromMapCenter(),
    onModeChange: () => setHoveredPath(null),
    onKeyboardFocus: (mode) => restoreKeyboardViewFocus(mode),
  })
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
    clearSelectionAnnouncement()
    map.navigateTo(node, instant)
    // The map animates on its own canvas clock. Rendering the new folder's
    // sidebar, crumbs and details for a huge scan can take a long frame, so
    // let React do it as a non-urgent update instead of stalling the motion.
    if (instant || urgent) transitionScan({ type: "navigate", node })
    else startTransition(() => transitionScan({ type: "navigate", node }))
    if (!preserveInvestigation) {
      setSelectedPath(undefined)
      setFocusIdx(0)
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

  function openVolumeScan(job: VolumeScanJob, target?: DiskScanNode) {
    if (!job.tree) return
    // A completed tree is immutable renderer data; React state never wraps it
    // in reactive proxies, so traversing a large scan stays allocation-free.
    const tree = job.tree
    saveCurrentTab()
    map.enterScan()
    transitionScan({
      type: "open",
      scan: {
        activeID: job.id,
        root: tree,
        node: target ?? tree,
        sourcePath: job.sourcePath,
        label: job.label,
        drive: job.drive,
      },
    })
    browseHistory.reset(target?.path ?? tree.path)
    foregroundScans.restore(job)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    replaceIndexFilter({ lens: "all", developerCategory: "all" })
    setFocusIdx(0)

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
    foregroundScans.invalidate()
    transitionScan({
      type: "open",
      scan: {
        activeID: tab.sessionID,
        root: tab.tree,
        node: target ?? tab.view,
        sourcePath: tab.sourcePath,
        label: tab.label,
        drive: tab.drive,
      },
    })
    if (target) browseHistory.reset(target.path)
    else browseHistory.replace(tab.browseHistory)
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    replaceIndexFilter({ lens: "all", developerCategory: "all" })
    setFocusIdx(0)

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

  async function startScan(
    path: string,
    label: string,
    drive?: DiskDriveInfo,
    preserveCurrent = true,
    forceFresh = false
  ) {
    const api = disk
    if (!api) return
    foregroundScans.invalidate()
    if (preserveCurrent) saveCurrentTab()
    const sessionID =
      !preserveCurrent && scanSession.activeID
        ? scanSession.activeID
        : newScanID("folder")
    const startedAt = Date.now()
    transitionScan({
      type: "begin",
      id: sessionID,
      location: { sourcePath: path, label, drive },
    })
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
    map.enterScan()
    focusScanProgress()
    clearSelectionAnnouncement()
    // A root scan replaces the authoritative map. The review basket can hold
    // deep inventory nodes from a prior root (or another tab), so clear it
    // synchronously before the old map disappears or the first scan await.
    clearReviewForRootScan({
      clearCollection: review.clear,
      cancelDrag: cancelCollectionDrag,
      closeReview: collectionSurface.close,
    })
    const isVolumeRoot =
      !!drive && diskPathEquals(path, drive.path, platform.os)
    browseHistory.reset()
    setSelectedPath(undefined)
    setHoveredPath(null)
    setQuery("")
    replaceIndexFilter({ lens: "all", developerCategory: "all" })
    setFocusIdx(0)

    const session = foregroundScans.begin(sessionID, {
      total: isVolumeRoot ? drive.used : 0,
      waitForCompletionSource: true,
      onProgress: (p) => {
        setVolumeScanJobs((jobs) => {
          const job = jobs[sessionID]
          if (!job) return jobs
          return {
            ...jobs,
            [sessionID]: {
              ...job,
              files: p.filesScanned,
              bytes: p.size,
              pct: p.percent ?? 0,
              currentPath: p.currentPath,
              discoveries: mergeDiscovery(job.discoveries, p.discovery),
              ...(p.source ? { source: p.source } : {}),
            },
          }
        })
      },
    })
    try {
      const scannedTree = await session.run(path, {
        ...scannerOptions(platform.os, drive, true, path),
        ...(forceFresh ? { forceFresh: true } : {}),
      })
      if (!session.isCurrent() || !scannedTree) return // superseded or cancelled
      if (live.current.scanSession.foregroundID !== sessionID) return // viewport moved to another scan
      scanHistory.seed(sessionID, scannedTree)
      const tree = includeHiddenSpace(asBrowseableRoot(scannedTree), drive)
      tree._label = label
      foregroundScans.complete()
      transitionScan({ type: "complete", id: sessionID, root: tree })
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
      if (!session.isCurrent() || isScanCancellation(err)) return
      const message = err instanceof Error ? err.message : String(err)
      showToast({
        variant: "error",
        title: language.t("disk.toast.scanFailed"),
        description: message,
      })
      if (live.current.volumeScanJobs[sessionID])
        patchVolumeJob(sessionID, { status: "failed", error: message })
      transitionScan({ type: "fail", id: sessionID })
      scanHistory.forget(sessionID)
    } finally {
      session.finish()
      if (session.isCurrent()) transitionScan({ type: "finish", id: sessionID })
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
    foregroundScans.invalidate()
    const sessionID = newScanID("expand")
    transitionScan({
      type: "expand",
      id: sessionID,
      label: options.label ?? diskNodeDisplayName(node),
    })
    map.enterScan()
    const drive = driveForPath(node.path, drives, platform.os) ?? scanDrive
    const isScanRoot = diskPathEquals(initialRoot.path, node.path, platform.os)
    const session = foregroundScans.begin(sessionID, { keepSource: true })
    let retainTrustedSubtree = false

    try {
      const scannedTree = await session.run(node.path, {
        ...scannerOptions(platform.os, drive, isScanRoot, node.path),
        ...(options.maxChildren === undefined
          ? {}
          : { maxChildren: options.maxChildren }),
      })
      if (!session.isCurrent() || !scannedTree) return
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
      foregroundScans.complete()
      // The old map stays mounted during a focused rescan. Carry its painted
      // folder into the newly scanned tree before React updates the panels.
      map.reconcileAndNavigate(
        nextRoot,
        nextView,
        createSpectrum(nextRoot).tone
      )
      transitionScan({
        type: "complete",
        id: sessionID,
        root: nextRoot,
        node: nextView,
      })
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

      if (restoreListFocus) focusListEntry(0)
    } catch (error) {
      if (!session.isCurrent() || isScanCancellation(error)) return
      showToast({
        variant: "error",
        title: language.t("disk.toast.openFailed", {
          name: options.label ?? diskNodeDisplayName(node),
        }),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      session.finish()
      void api.stopWatching(
        sessionID,
        retainTrustedSubtree ? { retainTrustedSubtree: true } : undefined
      )
      if (session.isCurrent()) transitionScan({ type: "finish", id: sessionID })
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
    if (drive) void loadDrives(true)
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
    foregroundScans.invalidate()
    transitionScan({ type: "cancel", id: scanSession.foregroundID })
    if (sessionID && volumeScanJobs[sessionID]) dropVolumeJob(sessionID)
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
          ? map.nodeAtPoint(x, y)?.path
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

    scrollIndexIntoViewRef.current?.(0)
  }

  function clearCurrentHistory() {
    const scanId = scanSession.activeID
    if (!scanId) return
    scanHistory.clear(scanId)
    setHistoryEntries([...scanHistory.entries()])
  }

  function chooseDeveloperEcosystem(ecosystem: ArtifactEcosystemFilter) {
    replaceIndexFilter({ developerEcosystem: ecosystem })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)

    scrollIndexIntoViewRef.current?.(0)
  }

  function chooseDeveloperCleanupAge(age: DeveloperCleanupAgePreset) {
    replaceIndexFilter({ developerAge: age })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)

    scrollIndexIntoViewRef.current?.(0)
  }

  function setCustomDeveloperCleanupAgeDays(days: string) {
    replaceIndexFilter({ customDeveloperAgeDays: days })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)

    scrollIndexIntoViewRef.current?.(0)
  }

  function updateQuery(value: string) {
    const path = selectedPath
    setQuery(value)
    setHoveredPath(null)

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

  function updateSort(
    key: DiskEntrySortKey,
    direction: DiskEntrySortDirection
  ) {
    const path = selectedPath
    replaceIndexFilter({ sortKey: key, sortDirection: direction })

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
    foregroundScans.invalidate()
    transitionScan({ type: "home" })
    clearSelectionAnnouncement()
    browseHistory.reset()
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
    map.select(path)
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

    selectPath(node.path)
  }

  function hoverEntry(path: string | null, node: DiskScanNode | null = null) {
    setHoveredPath(path)
    setHoveredNode(node)
    map.highlight(path)
  }

  function handleMapHover(node: DiskScanNode | null) {
    // Hover answers in place — the wedge lifts, its row highlights, and the
    // ring's center shows its size — rather than in a second floating list.
    hoverEntry(node?.path ?? null, node)
  }

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
    const plan = reconcileDeletedMaps(
      {
        root: treeRoot,
        view: viewNode,
        tabs,
        jobs: volumeJobs,
        collection,
      },
      removed,
      platform.os
    )
    setCollection(plan.collection)
    setTabs(plan.tabs)
    for (const id of plan.invalidatedJobIDs) dropVolumeJob(id)
    for (const id of plan.releaseSessionIDs) void disk?.stopWatching(id)
    if (plan.kind === "rescan") {
      cancelCollectionDrag()
      void live.current.rescanCurrent(true).then(restoreFocusAfterDeletion)
      return
    }
    for (const job of plan.jobs) {
      if (job.tree && job.tree !== volumeScanJobs[job.id]?.tree)
        patchVolumeJob(job.id, { tree: job.tree, bytes: job.bytes })
    }
    if (!treeRoot || !viewNode) return
    if (!plan.root) {
      backToDrives(false)
      restoreFocusAfterDeletion()
      return
    }
    if (plan.root === treeRoot) return
    transitionScan({
      type: "replace-tree",
      root: plan.root,
      node: plan.view ?? plan.root,
    })
    setSelectedPath(undefined)
    setHoveredPath(null)
    setFocusIdx(0)
    if (
      plan.view &&
      !diskPathEquals(plan.view.path, viewNode.path, platform.os)
    )
      browseHistory.reset(plan.view.path)
    restoreFocusAfterDeletion()
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
        ? map.nodeAtPoint(event.clientX, event.clientY)
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

  function canDragNode(node: DiskScanNode) {
    return !node.isHidden
  }

  function cleanupRestriction(node: DiskScanNode) {
    return cleanupPolicy.restriction(node)
  }

  function canModifyNode(node: DiskScanNode) {
    return cleanupPolicy.canModify(node)
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
  }

  useEffect(() => {
    cancelCollectionDrag()
    return () => cancelCollectionDrag()
  }, [view, scanMode, indexFilter.lens, canvasEl])

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
    transitionScan({ type: "replace-tree", root: tree, node: nextView ?? tree })
    setSelectedPath(nextSelection?.path)
    setHoveredPath(null)
    reconcileCollectionForScanUpdate(tree, update.rootPath)
    if (!nextView) browseHistory.reset(tree.path)
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
    keyboard.handleGlobalKeyDown(e)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => live.current.handleGlobalKeyDown(e)
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  useEffect(
    () => () => {
      foregroundScans.invalidate()
      scanUpdateUnsubRef.current?.()
      void disk?.cancelScan()
      void disk?.stopWatching()
      clearTimeout(selectionAnnouncementTimerRef.current)
    },
    []
  )

  const { controller: browseHistory } = useDiskBrowseHistory({
    os: platform.os,
    resolve: (path) =>
      treeRoot
        ? (groupNavigation.resolve(treeRoot, path) ??
          findScanNode(treeRoot, path))
        : undefined,
    blocked: scanning,
    onMove: showBrowseNode,
  })
  const { controller: preview, view: previewView } = useDiskPreview({
    disk,
    os: platform.os,
    language,
    treeRoot,
    entries,
    select: selectPath,
  })

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
    scanUpdateUnsubRef.current = api.onScanUpdate((update) =>
      live.current.handleScanUpdate(update)
    )
    return () => {
      cleanupMenus()
    }
  }, [])

  // Every late-invoked callback (IPC subscriptions, toasts, timers, rAF,
  // controller commands) resolves through this render-fresh snapshot so a
  // closure captured in an earlier render never observes stale state.
  keyboardContext.current = () => ({
    view,
    scanning,
    indexFilter,
    browseHistory,
    preview,
    listPageSize: () => listPageSizeRef.current(),
    moveFocus,
    moveFocusByPage,
    moveFocusToBoundary,
    focusListEntry,
    goUp,
    drill,
    reveal,
    requestDelete,
    canModifyNode,
    toggleCollect,
    toggleProtectedTree,
    rescanCurrent,
    chooseScanMode,
    chooseLens,
    openSearch,
    cancelScan,
    focusedEntryNode,
    openFocused,
  })
  const liveValues = {
    view,
    scanMode,
    morphing,
    scanning,
    treeRoot,
    selectedPath,
    focusIdx,
    canvasEl,
    indexFilter,
    parentSize,
    indexSize,
    entries,
    disk,
    shortcutsOpen,
    scanSession,
    volumeScanJobs,
    chooseAndScan,
    openVolumeScan,
    startFolderScan,
    rescanCurrent,
    cancelScan,
    drill,
    goUpFromMapCenter,
    selectPath,
    handleMapHover,
    applyDeletedNodes,
    collectNodes,
    canModifyNode,
    canDragNode,
    requiresDeepInventoryRefresh,
    handleScanUpdate,
    handleGlobalKeyDown,
  }
  const live = useRef(liveValues)
  live.current = liveValues
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
  return {
    platform,
    scanCompletionSource,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    collectionDragPreviewRef,
    dropActive,
    language,
    activeDialog,
    view,
    scanning,
    scanSourcePath,
    scanLabel,
    cleanupWorkspace,
    focusedScan,
    isDesktop,
    disk,
    tabs,
    switchToTab,
    closeTab,
    announcedSelection,
    openContextMenu,
    scanFiles,
    scanDrive,
    scanProgressRegionRef,
    scanDiscoveries,
    scanBytes,
    scanTail,
    scanTotal,
    scanPct,
    cancelScan,
    showNativeAppMenu,
    exportDiagnostics,
    header: {
      activeDialog,
      view,
      scanning,
      currentScanPinned,
      currentScanLocked,
      pinMutationPending,
      deleting,
      cleanupProtectionsReady,
      cleanupLockMutationPending,
      togglePinnedLocation,
      scanSourcePath,
      scanLabel,
      toggleProtectedTree,
      crumbs,
      browseHistory,
      backToDrives,
      cleanupWorkspace,
      chooseLens,
      goToCrumb,
      focusedScan,
      scanMode,
      chooseScanMode,
      historyChangeCount,
      sinceLastScan,
      homePath,
      currentHistoryEntries,
      recentChanges,
      clearCurrentHistory,
      reveal,
      showPathInMap,
    },
    protectionNotice: {
      language,
      activeDialog,
      cleanupProtectionsReady,
      cleanupLocksStatus,
      settings,
      cleanupResetSurface,
    },
    overview: {
      platform,
      togglePinnedLocation,
      toggleProtectedTree,
      drives,
      drivesLoading,
      drivesError,
      runningVolumeScans,
      storageDiagnostics,
      storageDiagnosticsError,
      tabs,
      pinnedLocations,
      volumeJobForDrive,
      chooseAndScan,
      startVolumeScan,
      cancelVolumeScan,
      openVolumeScan,
      volumeJobs,
      closeVolumeScan,
      retainedLocation,
      activateStorageLocation,
      openDiskAccessSettings,
      loadStorageDiagnostics,
      switchToTab,
      closeTab,
      openRetainedLocation,
      startScan,
      cleanupLocks,
    },
    cleanup: {
      platform,
      language,
      toggleProtectedTree,
      homePath,
      reveal,
      cleanupLocks,
      cleanupSummary,
      cleanupPolicy,
      rescanCurrent,
      indexFilter,
      setCustomDeveloperCleanupAgeDays,
      isCollected,
      coveringCollectedNode,
      canModifyNode,
      cleanupRestriction,
      effectiveCollection,
      collectionSize,
      developerEcosystems,
      treeRoot,
      chooseDeveloperCleanupAge,
      chooseDeveloperEcosystem,
      toggleCollect,
      collectNodes,
      uncollectNodes,
      clearCollection,
      collectionSurface,
      preview,
      sinceLastChanges,
    },
    landscape: {
      platform,
      language,
      scanning,
      deleting,
      scanLabel,
      toggleProtectedTree,
      focusedScan,
      scanMode,
      reveal,
      cleanupLocks,
      cleanupPolicy,
      isCollected,
      coveringCollectedNode,
      canModifyNode,
      cleanupRestriction,
      effectiveCollection,
      collectionSize,
      toggleCollect,
      clearCollection,
      collectionSurface,
      preview,
      landscapeElRef,
      setLandscapeEl,
      selectedNode,
      collectionDragNode,
      scanFiles,
      morphing,
      setCanvasEl,
      visibleMapNode,
      beginMapDrag,
      hoveredNode,
      hoveredPath,
      gridVisible,
      gridOverlayRef,
      gridInteractive,
      viewNode,
      registerTileCamera,
      parentView,
      goUpFromMapCenter,
      tileColor,
      spectrum,
      projectedViewNode,
      sortedChildren,
      selectedPath,
      queuedPaths,
      hoverEntry,
      selectPath,
      drill,
      expandOtherNode,
      canDragNode,
      beginCollectionDrag,
      collectionDropElementRef,
      collectionDropActive,
      collectionHasSharedPhysicalStorage,
      physicalCloneAccountingUncertain,
      collectionNeedsDeepInventoryRefresh,
      requiresDeepInventoryRefresh,
      rootSpectrum,
      investigation,
      indexSize,
      selectedAccess,
      requestDelete,
    },
    indexPanel: {
      platform,
      language,
      reveal,
      storageDiagnostics,
      openDiskAccessSettings,
      rescanCurrent,
      indexFilter,
      isCollected,
      coveringCollectedNode,
      canModifyNode,
      treeRoot,
      toggleCollect,
      hoveredPath,
      viewNode,
      spectrum,
      selectedPath,
      hoverEntry,
      selectPath,
      drill,
      canDragNode,
      beginCollectionDrag,
      rootSpectrum,
      indexSize,
      query,
      indexCount,
      searchVisible,
      groupDeveloper,
      setGroupDeveloper,
      updateQuery,
      updateSort,
      closeSearch,
      searchTriggerRef,
      openSearch,
      entries,
      entryRowHeight,
      scrollIndexIntoViewRef,
      listPageSizeRef,
      DEFAULT_LIST_PAGE_SIZE,
      moveFocus,
      moveFocusByPage,
      moveFocusToBoundary,
      entryLocation,
      selectEntry,
      setFocusIdx,
      handleEntryKeyDown,
      setQuery,
      showVolumeCapacity,
      physicalCloneAccountingWarning,
      scanDrive,
    },
    dialogs: {
      platform,
      language,
      deleting,
      homePath,
      reveal,
      settings,
      cleanupResetSurface,
      cleanupPolicy,
      rescanCurrent,
      cleanupRestriction,
      effectiveCollection,
      collectionSize,
      treeRoot,
      collectionSurface,
      preview,
      drill,
      collectionHasSharedPhysicalStorage,
      physicalCloneAccountingUncertain,
      collectionNeedsDeepInventoryRefresh,
      requiresDeepInventoryRefresh,
      investigation,
      contextMenu,
      contextMenuItems,
      closeContextMenu,
      previewView,
      deletionProgress,
      removeCollected,
      deleteCollected,
      cleanupResultsOpen,
      cleanupResults,
      cleanupPlanNeedsRecheck,
      setCleanupResultsOpen,
      openTrash,
      collection,
      deleteSurface,
      pendingDelete,
      setPendingDelete,
      confirmDelete,
    },
  } satisfies DiskUtilityViewProps
}
