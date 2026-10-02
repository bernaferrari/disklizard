import type { DiskScanNode } from "./types"
import type { DiskLanguageKey, DiskLizardOS } from "./runtime"
import type {
  DeveloperItem,
  ReclaimBucket,
  Recognition,
  Safety,
} from "./recognize"
import { createDiskPathCoverage } from "./storage"

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
  bytes: number
  recognition: Recognition
  safe: boolean
  /** The scan cannot verify this folder’s complete contents. */
  unobserved: boolean
}

export type CleanupGroup = {
  key: string
  labelKey: DiskLanguageKey
  bytes: number
  items: CleanupItem[]
}

/** The toolbar and cleanup workspace share this file-size ledger. It never
 * represents reclaimed bytes, and protected or overlapping roots are excluded. */
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
  // A parent owns its descendants' bytes. Sort by ancestry before grouping so
  // duplicate inventory entries cannot inflate either the page or its badge.
  const candidates = [...input.developerItems].sort(
    (a, b) => roots.depth(a.node.path) - roots.depth(b.node.path)
  )
  for (const item of candidates) {
    if (
      input.matchesFilter &&
      !input.matchesFilter(item.node, item.recognition)
    )
      continue
    const unobserved = input.hasUnobservedContents?.(item.node) ?? false
    const value = {
      ...item,
      unobserved,
      safe: !unobserved && input.isEligible(item.node, item.recognition),
    }
    if (!input.canModify(item.node)) {
      locked.push({ ...value, safe: false })
      continue
    }
    if (roots.covers(item.node.path)) continue
    roots.add(item.node.path)
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
    bytes: items.reduce((sum, item) => sum + item.bytes, 0),
    items: items.toSorted((a, b) => b.bytes - a.bytes),
  })
  const developer = [...byTag]
    .map(([key, items]) => group(`dev:${key}`, key, items))
    .toSorted((a, b) => b.bytes - a.bytes)
  const suggestionRoots = createDiskPathCoverage(input.os)
  const bySafety = new Map<Safety, CleanupItem[]>()
  // Sort across buckets too: a parent in a later category must still own its
  // descendants instead of adding their file sizes twice.
  const suggestionCandidates = input.suggestions
    .flatMap((bucket) =>
      bucket.items.map((item) => ({ ...item, safety: bucket.safety }))
    )
    .toSorted((a, b) => roots.depth(a.node.path) - roots.depth(b.node.path))
  for (const { node, recognition, safety } of suggestionCandidates) {
    if (
      !input.canModify(node) ||
      (input.matchesFilter && !input.matchesFilter(node, recognition))
    )
      continue
    if (roots.overlaps(node.path) || suggestionRoots.covers(node.path)) continue
    suggestionRoots.add(node.path)
    const items = bySafety.get(safety) ?? []
    items.push({
      node,
      bytes: node.size,
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
    bytes: items.reduce((sum, item) => sum + item.bytes, 0),
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
        items: group.items.toSorted((a, b) => b.bytes - a.bytes),
      }))
      .toSorted((a, b) => b.bytes - a.bytes)
  return { ready: ordered(ready), review: ordered(review) }
}

/** Explain evidence, rather than attaching the same warning to every artifact. */
export function cleanupItemExplanation(item: CleanupItem): DiskLanguageKey {
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
