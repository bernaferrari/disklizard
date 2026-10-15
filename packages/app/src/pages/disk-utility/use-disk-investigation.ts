import { useCallback, useMemo, useState } from "react"
import {
  filterDeveloperItemsByAge,
  resolveDeveloperCleanupAge,
  type DeveloperCleanupAgePreset,
} from "./developer-cleanup"
import {
  groupSmallEntryTail,
  type DiskEntrySortDirection,
  type DiskEntrySortKey,
} from "./entry-view"
import { diskNodeDisplayName } from "./node-display"
import { recentChangeNodes } from "./recent-changes"
import { DISK_RECOGNITION_LANGUAGE_KEYS } from "./recognition-language"
import {
  ARTIFACT_ECOSYSTEMS,
  matchesArtifactEcosystem,
  type ArtifactEcosystem,
  type ArtifactEcosystemFilter,
  type DeveloperCategory,
  type ReclaimSummary,
} from "./recognize"
import { useLanguage, type DiskLizardOS } from "./runtime"
import {
  createScanInvestigation,
  type ScanInvestigationLens,
} from "./scan-investigation"
import { actionableReclaimSummary } from "./storage"
import type { DiskScanNode, DiskCleanupLock } from "./types"
type IndexLens = ScanInvestigationLens
type DeveloperCategoryFilter = DeveloperCategory | "all"
export type IndexFilter = {
  lens: IndexLens
  developerCategory: DeveloperCategoryFilter
  developerEcosystem: ArtifactEcosystemFilter
  developerAge: DeveloperCleanupAgePreset
  customDeveloperAgeDays: string
  sortKey: DiskEntrySortKey
  sortDirection: DiskEntrySortDirection
}
const EMPTY_RECLAIM: ReclaimSummary = {
  totalBytes: 0,
  totalCount: 0,
  buckets: [],
}

/** Owns investigation filters, recognition, grouping and list derivation. */
export function useDiskInvestigation({
  treeRoot,
  viewNode,
  os,
  cleanupLocks,
  physicalCloneAccountingUncertain,
  historyChangeCount,
  query,
}: {
  treeRoot: DiskScanNode | null
  viewNode: DiskScanNode | null
  os?: DiskLizardOS
  cleanupLocks: readonly DiskCleanupLock[]
  physicalCloneAccountingUncertain: boolean
  historyChangeCount: number
  query: string
}) {
  const language = useLanguage()
  const platform = { os }
  const [indexFilter, setIndexFilter] = useState<IndexFilter>({
    lens: "all",
    developerCategory: "all",
    developerEcosystem: "all",
    developerAge: "all",
    customDeveloperAgeDays: "30",
    sortKey: "size",
    sortDirection: "descending",
  })
  function replaceIndexFilter(patch: Partial<IndexFilter>) {
    setIndexFilter((current) => ({ ...current, ...patch }))
  }

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
      query.trim() ||
      duplicateEntryNames.has(
        diskNodeDisplayName(entry.node).toLocaleLowerCase()
      )
        ? 46
        : 36,
    [query, duplicateEntryNames]
  )
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
  return {
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
  }
}
