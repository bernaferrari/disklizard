import type { DiskScanNode } from "./types"
import {
  computeDeveloperSummaryWithInventory,
  computeDeveloperSummaryWithInventoryAsync,
  computeReclaim,
  computeReclaimAsync,
  fileKind,
  recognize,
  yieldToMain,
  type DeveloperSummary,
  type Recognition,
  type ReclaimSummary,
} from "./recognize"
import {
  diskEntrySearchText,
  filterIndexedDiskEntries,
  rankedDiskChildren,
  sortDiskEntries,
  walkRankedDiskTree,
  type DiskEntrySortDirection,
  type DiskEntrySortKey,
  type IndexedDiskEntry,
} from "./entry-view"

export type ScanInvestigationLens = "all" | "developer" | "recommendations" | "changes"

export type ScanInvestigationEntry = {
  node: DiskScanNode
  colorIndex: number
  displaySize: number
  sourceIndex: number
}

export type ScanInvestigationCandidate = { node: DiskScanNode; displaySize: number }

export type ScanInvestigationState = {
  identityIndexBuilt: boolean
  searchIndexBuilt: boolean
  recognitionIndexBuilt: boolean
  developerSummaryBuilt: boolean
  recommendationSummaryBuilt: boolean
}

/**
 * Facets for the investigation lens. Every field is optional and `undefined`
 * (or `"all"` for kind) means "do not filter". Files with an unknown modified
 * time never match a time range; directories are only matched by kind
 * `folder`, mirroring how the recognizer buckets extensions.
 */
export type ScanInvestigationFileKind =
  | "folder"
  | "video"
  | "audio"
  | "image"
  | "archive"
  | "code"
  | "document"
  | "data"
  | "file"

export const SCAN_INVESTIGATION_FILE_KINDS = [
  "video",
  "audio",
  "image",
  "archive",
  "code",
  "document",
  "data",
  "file",
] as const satisfies readonly Exclude<ScanInvestigationFileKind, "folder">[]

export type ScanInvestigationFilter = {
  kind?: ScanInvestigationFileKind | "all"
  /** Inclusive lower bound on node.modifiedAt (epoch ms). */
  modifiedFrom?: number | null
  /** Inclusive upper bound on node.modifiedAt (epoch ms). */
  modifiedTo?: number | null
}

type NodeIdentity = { colorIndex: number; sourceIndex: number }

type ScanInvestigationOptions = {
  recognizeNode?: (node: DiskScanNode) => Recognition
  recognitionText?: (recognition: Recognition) => string
  recognitionQueryMayMatch?: (normalizedQuery: string) => boolean
}

type ScanInvestigationEntriesOptions = {
  viewNode: DiskScanNode | null | undefined
  query: string
  lens: ScanInvestigationLens
  sortKey: DiskEntrySortKey
  sortDirection: DiskEntrySortDirection
  filter?: ScanInvestigationFilter
  developerCandidates?: () => readonly ScanInvestigationCandidate[]
  recommendationCandidates?: () => readonly ScanInvestigationCandidate[]
}

function matchesScanInvestigationFilter(node: DiskScanNode, filter: ScanInvestigationFilter) {
  if (filter.kind && filter.kind !== "all") {
    // Directories are only ever kind `folder`; extension buckets are files-only.
    if (node.isDir ? filter.kind !== "folder" : fileKind(node.ext).kind !== filter.kind) return false
  }
  if (filter.modifiedFrom !== undefined && filter.modifiedFrom !== null) {
    if (node.modifiedAt === undefined || node.modifiedAt < filter.modifiedFrom) return false
  }
  if (filter.modifiedTo !== undefined && filter.modifiedTo !== null) {
    if (node.modifiedAt === undefined || node.modifiedAt > filter.modifiedTo) return false
  }
  return true
}

/**
 * Owns every scan-wide renderer index for one immutable retained tree.
 * Construction is deliberately cheap: full-tree identity, recognition, search,
 * and lens summaries are each built only by the operation that needs them.
 */
export function createScanInvestigation(root: DiskScanNode | null | undefined, options: ScanInvestigationOptions = {}) {
  const recognizeNode = options.recognizeNode ?? recognize
  const recognitionText = options.recognitionText ?? ((recognition: Recognition) => recognition.tag ?? "")
  const recognitionQueryMayMatch = options.recognitionQueryMayMatch ?? (() => true)
  const recognitionByNode = new WeakMap<DiskScanNode, Recognition>()
  let identities: WeakMap<DiskScanNode, NodeIdentity> | undefined
  let searchIndex: IndexedDiskEntry[] | undefined
  let recognitionIndexBuilt = false
  let developerSummary: DeveloperSummary | undefined
  let recommendationSummary: ReclaimSummary | undefined
  let developerSummaryBuilt = false
  let recommendationSummaryBuilt = false

  const recognitionFor = (node: DiskScanNode) => {
    const cached = recognitionByNode.get(node)
    if (cached) return cached
    const result = recognizeNode(node)
    recognitionByNode.set(node, result)
    return result
  }

  const visitRetainedTree = (includeSearchText: boolean) => {
    const nextIdentities = identities ?? new WeakMap<DiskScanNode, NodeIdentity>()
    const nextSearchIndex: IndexedDiskEntry[] = []
    walkRankedDiskTree(root, (node, colorIndex, sourceIndex) => {
      nextIdentities.set(node, { colorIndex, sourceIndex })
      if (includeSearchText) {
        nextSearchIndex.push({
          node,
          colorIndex,
          sourceIndex,
          searchText: diskEntrySearchText(node),
        })
      }
    })
    identities = nextIdentities
    if (includeSearchText) searchIndex = nextSearchIndex
  }

  const ensureIdentities = () => {
    if (!identities) visitRetainedTree(false)
    return identities!
  }

  const ensureSearchIndex = () => {
    if (!searchIndex) visitRetainedTree(true)
    return searchIndex!
  }

  const currentFolderEntries = (viewNode: DiskScanNode | null | undefined): ScanInvestigationEntry[] => {
    if (!viewNode) return []
    return rankedDiskChildren(viewNode).map(({ node }, sourceIndex) => ({
      node,
      colorIndex: sourceIndex,
      displaySize: node.size,
      sourceIndex,
    }))
  }

  const decorateCandidates = (candidates: readonly ScanInvestigationCandidate[]): ScanInvestigationEntry[] => {
    const identityIndex = ensureIdentities()
    return candidates.map(({ node, displaySize }, sourceIndex) => ({
      node,
      displaySize,
      sourceIndex,
      colorIndex: identityIndex.get(node)?.colorIndex ?? sourceIndex,
    }))
  }

  // Search matches are memoized per normalized query against one immutable
  // tree, so every keystroke after the first filters the previous (smaller)
  // match set instead of rescanning the index. A cached query is only a sound
  // base for a query that extends it: matching is monotonic under appending.
  const MATCH_CACHE_LIMIT = 12
  const SEARCH_CHUNK_SIZE = 20000
  const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve))

  let matchCache = new Map<string, IndexedDiskEntry[]>()

  const rememberMatches = (normalized: string, matches: IndexedDiskEntry[]) => {
    if (matchCache.has(normalized)) matchCache.delete(normalized)
    matchCache.set(normalized, matches)
    while (matchCache.size > MATCH_CACHE_LIMIT) {
      const oldest = matchCache.keys().next().value
      if (oldest === undefined) break
      matchCache.delete(oldest)
    }
  }

  const cachedPrefix = (normalized: string): IndexedDiskEntry[] | undefined => {
    let best: string | undefined
    for (const key of matchCache.keys()) {
      if (normalized.startsWith(key) && (best === undefined || key.length > best.length)) best = key
    }
    return best === undefined ? undefined : matchCache.get(best)
  }

  const matchPredicate = (normalized: string) => {
    if (!recognitionQueryMayMatch(normalized)) {
      return (entry: IndexedDiskEntry) => entry.searchText.includes(normalized)
    }
    return (entry: IndexedDiskEntry) =>
      entry.searchText.includes(normalized) ||
      recognitionText(recognitionFor(entry.node)).trim().toLocaleLowerCase().includes(normalized)
  }

  const searchMatches = (normalized: string): IndexedDiskEntry[] => {
    const cached = matchCache.get(normalized)
    if (cached) {
      // Refresh LRU position.
      matchCache.delete(normalized)
      matchCache.set(normalized, cached)
      return cached
    }
    const base = cachedPrefix(normalized) ?? ensureSearchIndex()
    const matches = base.filter(matchPredicate(normalized))
    if (base.length > 0 && recognitionQueryMayMatch(normalized)) recognitionIndexBuilt = true
    rememberMatches(normalized, matches)
    return matches
  }

  /** Same result as `searchMatches`, but yields to the event loop between chunks. */
  const searchMatchesAsync = async (normalized: string): Promise<IndexedDiskEntry[]> => {
    const cached = matchCache.get(normalized)
    if (cached) return cached
    const base = cachedPrefix(normalized) ?? ensureSearchIndex()
    if (base.length <= SEARCH_CHUNK_SIZE) return searchMatches(normalized)
    const consultsRecognition = recognitionQueryMayMatch(normalized)
    const predicate = matchPredicate(normalized)
    const matches: IndexedDiskEntry[] = []
    for (let start = 0; start < base.length; start += SEARCH_CHUNK_SIZE) {
      for (const entry of base.slice(start, start + SEARCH_CHUNK_SIZE)) {
        if (predicate(entry)) matches.push(entry)
      }
      await yieldToMain()
    }
    if (consultsRecognition) recognitionIndexBuilt = true
    rememberMatches(normalized, matches)
    return matches
  }

  const searchCandidates = (matches: readonly IndexedDiskEntry[]): ScanInvestigationEntry[] =>
    matches.map(({ node, colorIndex, sourceIndex }) => ({
      node,
      colorIndex,
      sourceIndex,
      displaySize: node.size,
    }))

  const lensCandidates = (input: ScanInvestigationEntriesOptions): ScanInvestigationEntry[] => {
    if (input.lens === "developer") return decorateCandidates(input.developerCandidates?.() ?? [])
    if (input.lens === "recommendations") return decorateCandidates(input.recommendationCandidates?.() ?? [])
    return []
  }

  /** Query narrowing, kind/date facets, then sorting — shared by both entry paths. */
  const finishCandidates = (
    input: ScanInvestigationEntriesOptions,
    query: string,
    candidates: ScanInvestigationEntry[],
  ): ScanInvestigationEntry[] => {
    let result = candidates
    if (query && input.lens !== "all") {
      const normalizedQuery = query.toLocaleLowerCase()
      result = result.filter((entry) =>
        diskEntrySearchText(entry.node, recognitionText(recognitionFor(entry.node))).includes(normalizedQuery),
      )
    }
    const filter = input.filter
    if (filter) result = result.filter((entry) => matchesScanInvestigationFilter(entry.node, filter))
    return sortDiskEntries(result, input.sortKey, input.sortDirection)
  }

  const selectLens = (input: ScanInvestigationEntriesOptions, query: string) =>
    input.lens === "changes"
      ? []
      : input.lens !== "all"
        ? lensCandidates(input)
        : query
          ? searchCandidates(searchMatches(query.toLocaleLowerCase()))
          : currentFolderEntries(input.viewNode)

  const selectLensAsync = async (input: ScanInvestigationEntriesOptions, query: string) =>
    input.lens === "changes"
      ? []
      : input.lens !== "all"
        ? lensCandidates(input)
        : query
          ? searchCandidates(await searchMatchesAsync(query.toLocaleLowerCase()))
          : currentFolderEntries(input.viewNode)

  /**
   * Synchronous path for small candidate sets. Kept in lockstep with
   * `entriesAsync` so both produce identical results for identical input.
   */
  const entries: (input: ScanInvestigationEntriesOptions) => ScanInvestigationEntry[] = (input) => {
    const query = input.query.trim()
    return finishCandidates(input, query, selectLens(input, query))
  }

  /** Chunked path for scan-wide searches over large indexes; same result contract. */
  const entriesAsync = async (input: ScanInvestigationEntriesOptions): Promise<ScanInvestigationEntry[]> => {
    const query = input.query.trim()
    return finishCandidates(input, query, await selectLensAsync(input, query))
  }

  /**
   * Build every scan-wide index up front so the first search or lens switch
   * never pays the full cost synchronously. Recognition-heavy passes run in
   * yielded chunks; results are memoized per tree identity, so hover and
   * re-renders never recompute. Memoized per investigation instance.
   */
  let warmed: Promise<void> | undefined
  const warm = () => {
    if (warmed) return warmed
    warmed = (async () => {
      ensureSearchIndex()
      await yieldToMain()
      developerSummary = await computeDeveloperSummaryWithInventoryAsync(root ?? null, recognitionFor)
      developerSummaryBuilt = true
      await yieldToMain()
      recommendationSummary = await computeReclaimAsync(root ?? null, recognitionFor)
      recommendationSummaryBuilt = true
    })()
    return warmed
  }

  return {
    entries,
    entriesAsync,
    recognitionFor,
    warm,
    developer() {
      if (!developerSummaryBuilt) {
        developerSummary = computeDeveloperSummaryWithInventory(root ?? null, recognitionFor)
        developerSummaryBuilt = true
      }
      return developerSummary!
    },
    recommendations() {
      if (!recommendationSummaryBuilt) {
        recommendationSummary = computeReclaim(root ?? null, recognitionFor)
        recommendationSummaryBuilt = true
      }
      return recommendationSummary!
    },
    state(): ScanInvestigationState {
      return {
        identityIndexBuilt: !!identities,
        searchIndexBuilt: !!searchIndex,
        recognitionIndexBuilt,
        developerSummaryBuilt,
        recommendationSummaryBuilt,
      }
    },
  }
}

/**
 * Search-entry seam: debounce raw keystrokes into a settled search query so
 * the investigation pipeline runs at most once per pause, not per keystroke.
 * Call `input(value)` from the field's input handler; render from
 * `debounced()` to gate expensive filtering (keep an immediate signal for the
 * controlled input itself). Clearing the box settles synchronously.
 */
export type DebouncedSearchQuery = {
  input(value: string): void
  debounced(): string
  pending(): boolean
  /** Listener notification for external-store rendering (useSyncExternalStore). */
  subscribe(listener: () => void): () => void
  /** Clear the pending timer; call when the owner goes away. */
  dispose(): void
}

export function createDebouncedSearchQuery(delayMs = 180): DebouncedSearchQuery {
  let debounced = ""
  let pending = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()

  const write = (nextDebounced: string, nextPending: boolean) => {
    if (debounced === nextDebounced && pending === nextPending) return
    debounced = nextDebounced
    pending = nextPending
    for (const listener of [...listeners]) listener()
  }

  const settle = (value: string) => {
    timer = undefined
    write(value, false)
  }

  const input = (value: string) => {
    if (value === debounced) {
      clearTimeout(timer)
      timer = undefined
      write(debounced, false)
      return
    }
    if (value === "") {
      // Clearing is cheap and expected to be instant.
      clearTimeout(timer)
      timer = undefined
      write("", false)
      return
    }
    if (timer === undefined) write(debounced, true)
    clearTimeout(timer)
    timer = setTimeout(() => settle(value), delayMs)
  }

  return {
    input,
    debounced: () => debounced,
    pending: () => pending,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      clearTimeout(timer)
      timer = undefined
    },
  }
}
