import type { DiskScanNode } from "./types"
import type { DiskLanguageKey, DiskLizardOS } from "./runtime"
import type {
  DeveloperItem,
  ReclaimBucket,
  Recognition,
  Safety,
} from "./recognize"
import {
  createDiskPathCoverage,
  normalizedDiskPath,
  uniqueDeletionRoots,
} from "./storage"

const SAFETY_LABEL = {
  regenerable: "disk.safety.regenerable",
  cache: "disk.safety.cache",
  logs: "disk.safety.logs",
  trash: "disk.safety.trash",
  media: "disk.safety.media",
  "version-control": "disk.safety.versionControl",
  system: "disk.safety.system",
  unknown: "disk.safety.unknown",
} as const satisfies Record<Safety, DiskLanguageKey>

export type CleanupItem = {
  node: DiskScanNode
  /** Complete filesystem scope used by every selection surface. */
  bytes: number
  operationBytes: number
  /** Contribution to developer accounting, which may exclude descendants. */
  accountingContributionBytes: number
  recognition: Recognition
  safe: boolean
  /** The scan cannot verify this folder’s complete contents. */
  unobserved: boolean
}

export type CleanupGroup = {
  key: string
  labelKey: DiskLanguageKey
  label?: string
  bytes: number
  items: CleanupItem[]
}

/** The toolbar and cleanup workspace share this file-size ledger. It never
 * represents reclaimed bytes. Discovery keeps nested alternatives; totals count
 * overlapping filesystem scopes once and review deduplicates operations. */
export function buildCleanupSummary(input: {
  developerItems: readonly DeveloperItem[]
  suggestions: readonly ReclaimBucket[]
  os?: DiskLizardOS
  canModify: (node: DiskScanNode) => boolean
  isEligible: (node: DiskScanNode, recognition: Recognition) => boolean
  hasUnobservedContents?: (node: DiskScanNode) => boolean
  matchesFilter?: (node: DiskScanNode, recognition: Recognition) => boolean
}) {
  const byTag = new Map<DiskLanguageKey, CleanupItem[]>()
  const locked: CleanupItem[] = []
  const roots = createDiskPathCoverage(input.os)
  const seen = new Set<string>()
  // Resolve duplicate identities in ancestry order, but retain nested choices.
  const candidates = [...input.developerItems].sort(
    (a, b) => roots.depth(a.node.path) - roots.depth(b.node.path)
  )
  for (const item of candidates) {
    if (
      input.matchesFilter &&
      !input.matchesFilter(item.node, item.recognition)
    )
      continue
    const path = normalizedDiskPath(item.node.path, input.os)
    if (seen.has(path)) continue
    seen.add(path)
    const unobserved = input.hasUnobservedContents?.(item.node) ?? false
    const value = {
      ...item,
      bytes: item.node.size,
      operationBytes: item.node.size,
      accountingContributionBytes: item.bytes,
      unobserved,
      safe: !unobserved && input.isEligible(item.node, item.recognition),
    }
    if (!input.canModify(item.node)) {
      locked.push({ ...value, safe: false })
      continue
    }
    const key = item.recognition.tag ?? SAFETY_LABEL[item.recognition.safety]
    const items = byTag.get(key) ?? []
    items.push(value)
    byTag.set(key, items)
  }
  const group = (
    key: string,
    labelKey: DiskLanguageKey,
    items: CleanupItem[]
  ): CleanupGroup => ({
    key,
    labelKey,
    bytes: uniqueDeletionRoots(
      items.map((item) => item.node),
      input.os
    ).reduce((sum, node) => sum + node.size, 0),
    items: items.toSorted((a, b) => b.bytes - a.bytes),
  })
  const developer = [...byTag]
    .map(([key, items]) => group(`dev:${key}`, key, items))
    .toSorted((a, b) => b.bytes - a.bytes)
  const bySafety = new Map<Safety, CleanupItem[]>()
  // Sort across buckets too: a parent in a later category must still own its
  // descendants instead of adding their file sizes twice.
  const suggestionCandidates = input.suggestions
    .flatMap((bucket) =>
      bucket.items.map((item) => ({ ...item, safety: bucket.safety }))
    )
    .toSorted((a, b) => roots.depth(a.node.path) - roots.depth(b.node.path))
  for (const { node, recognition, safety } of suggestionCandidates) {
    if (input.matchesFilter && !input.matchesFilter(node, recognition)) continue
    const path = normalizedDiskPath(node.path, input.os)
    if (seen.has(path)) continue
    seen.add(path)
    if (!input.canModify(node)) {
      locked.push({
        node,
        bytes: node.size,
        operationBytes: node.size,
        accountingContributionBytes: node.size,
        recognition,
        safe: false,
        unobserved: input.hasUnobservedContents?.(node) ?? false,
      })
      continue
    }
    const items = bySafety.get(safety) ?? []
    items.push({
      node,
      bytes: node.size,
      operationBytes: node.size,
      accountingContributionBytes: node.size,
      recognition,
      safe: false,
      unobserved: input.hasUnobservedContents?.(node) ?? false,
    })
    bySafety.set(safety, items)
  }
  const suggestions = [...bySafety]
    .map(([safety, items]) =>
      group(`rec:${safety}`, SAFETY_LABEL[safety], items)
    )
    .toSorted((a, b) => b.bytes - a.bytes)
  const groups = [...developer, ...suggestions].toSorted(
    (a, b) => b.bytes - a.bytes
  )
  const items = groups.flatMap((group) => group.items)
  return {
    developer,
    suggestions,
    groups,
    os: input.os,
    bytes: uniqueDeletionRoots(
      items.map((item) => item.node),
      input.os
    ).reduce((sum, node) => sum + node.size, 0),
    count: items.length,
    safe: items.filter((item) => item.safe),
    locked: locked.toSorted((a, b) => b.bytes - a.bytes),
  }
}

export type CleanupSummary = ReturnType<typeof buildCleanupSummary>

const CLEANUP_CATEGORIES = {
  dependencies: "disk.ui.cleanup.dependencies",
  builds: "disk.ui.cleanup.buildOutput",
  caches: "disk.ui.cleanup.category.caches",
  logs: "disk.ui.cleanup.category.logs",
  tools: "disk.ui.cleanup.category.tools",
  other: "disk.ui.cleanup.category.other",
} as const satisfies Record<string, DiskLanguageKey>

function cleanupCategory(item: CleanupItem): keyof typeof CLEANUP_CATEGORIES {
  const r = item.recognition
  if (r.confidence === "ambiguous") return "other"
  if (r.developer === "dependencies") return "dependencies"
  if (r.developer === "build-output") return "builds"
  if (r.developer === "toolchain-cache" || r.safety === "cache") return "caches"
  if (r.safety === "logs") return "logs"
  return r.developer ? "tools" : "other"
}

/** Present familiar categories while keeping recreatable and individual choices separate. */
export function partitionCleanupGroups(summary: CleanupSummary) {
  const ready = new Map<string, CleanupGroup>()
  const review = new Map<string, CleanupGroup>()
  for (const source of summary.groups)
    for (const item of source.items) {
      const category = cleanupCategory(item)
      const groups = item.safe ? ready : review
      const key = `${item.safe ? "ready" : "review"}:${category}`
      let group = groups.get(key)
      if (!group) {
        group = {
          key,
          labelKey: CLEANUP_CATEGORIES[category],
          bytes: 0,
          items: [],
        }
        groups.set(key, group)
      }
      group.items.push(item)
      group.bytes += item.bytes
    }
  const ordered = (groups: Map<string, CleanupGroup>) =>
    [...groups.values()]
      .map((group) => ({
        ...group,
        bytes: uniqueDeletionRoots(
          group.items.map((item) => item.node),
          summary.os
        ).reduce((sum, node) => sum + node.size, 0),
        items: group.items.toSorted((a, b) => b.bytes - a.bytes),
      }))
      .toSorted((a, b) => b.bytes - a.bytes)
  return { ready: ordered(ready), review: ordered(review) }
}

/** Explain evidence, rather than attaching the same warning to every artifact. */
export function cleanupItemExplanation(
  item: Pick<CleanupItem, "safe" | "recognition" | "unobserved">
): DiskLanguageKey {
  if (item.unobserved) return "disk.ui.cleanup.reason.incomplete"
  if (item.safe && item.recognition.hint) return item.recognition.hint
  if (item.recognition.confidence === "ambiguous")
    return "disk.ui.cleanup.reason.nameOnly"
  if (item.recognition.developer === "dependencies")
    return "disk.ui.cleanup.reason.dependencies"
  if (item.recognition.developer === "build-output")
    return "disk.ui.cleanup.reason.build"
  if (item.recognition.safety === "logs") return "disk.ui.cleanup.reason.logs"
  if (item.recognition.safety === "cache") return "disk.ui.cleanup.reason.cache"
  return item.recognition.hint ?? "disk.ui.cleanup.reason.other"
}

export type CleanupGrouping = "artifact" | "project"
export type CleanupSort = "largest" | "oldest"

/** Navigation operates on discovery, never on the global review selection. */
export function organizeCleanupGroups(
  summary: CleanupSummary,
  options: {
    query: string
    grouping: CleanupGrouping
    sort: CleanupSort
  }
) {
  const query = options.query.trim().toLocaleLowerCase()
  const groups = partitionCleanupGroups(summary)
  const compare = (a: CleanupItem, b: CleanupItem) =>
    options.sort === "oldest"
      ? (a.node.modifiedAt ?? Infinity) - (b.node.modifiedAt ?? Infinity) ||
        b.bytes - a.bytes ||
        a.node.path.localeCompare(b.node.path)
      : b.bytes - a.bytes || a.node.path.localeCompare(b.node.path)
  const organize = (sources: CleanupGroup[]): CleanupGroup[] => {
    const byLocation = new Map<string, CleanupGroup>()
    for (const source of sources) {
      const matches = source.items.filter(
        (item) =>
          item.node.path.toLocaleLowerCase().includes(query) ||
          item.node.name.toLocaleLowerCase().includes(query)
      )
      if (options.grouping === "artifact") {
        if (matches.length)
          byLocation.set(source.key, { ...source, items: matches })
        continue
      }
      for (const item of matches) {
        const location = item.node.path.replace(/[\\/][^\\/]+$/, "") || "/"
        const key = `${item.safe ? "ready" : "review"}:${location}`
        const group = byLocation.get(key) ?? {
          key,
          labelKey: source.labelKey,
          label: location,
          bytes: 0,
          items: [],
        }
        group.items.push(item)
        byLocation.set(key, group)
      }
    }
    return [...byLocation.values()]
      .map((group) => ({
        ...group,
        items: group.items.toSorted(compare),
        bytes: uniqueDeletionRoots(
          group.items.map((item) => item.node),
          summary.os
        ).reduce((sum, node) => sum + node.size, 0),
      }))
      .toSorted((a, b) =>
        options.sort === "oldest"
          ? compare(a.items[0], b.items[0])
          : b.bytes - a.bytes || a.key.localeCompare(b.key)
      )
  }
  return { ready: organize(groups.ready), review: organize(groups.review) }
}
