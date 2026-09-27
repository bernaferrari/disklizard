import type { DiskScanNode } from "./types"
import { diskPathEquals } from "./storage"

type DesktopOS = "macos" | "windows" | "linux"

export type OtherExpansionPlan = Readonly<{
  /** Real filesystem directory to rescan; the `Other` path itself is synthetic. */
  parent: DiskScanNode
  /** Progressively widens dense folders without materializing an unbounded tree. */
  maxChildren: number
  representedCount?: number
}>

export type OtherExpansionOptions = Readonly<{
  initialChildren?: number
  growthFactor?: number
  maxChildren?: number
}>

const DEFAULT_INITIAL_CHILDREN = 192
const DEFAULT_GROWTH_FACTOR = 4
const DEFAULT_MAX_CHILDREN = 10_000

/**
 * Resolve a synthetic `Other` bucket to its real parent and choose the next
 * bounded scanner retention limit. Names are deliberately ignored: scanner
 * metadata, rather than localized copy, defines the aggregate.
 */
export function planOtherExpansion(
  root: DiskScanNode,
  aggregate: DiskScanNode,
  os?: DesktopOS,
  options: OtherExpansionOptions = {}
): OtherExpansionPlan | undefined {
  if (!aggregate.isOther || aggregate.isHidden) return undefined

  const initialChildren = positiveInteger(
    options.initialChildren,
    DEFAULT_INITIAL_CHILDREN
  )
  const growthFactor = positiveInteger(
    options.growthFactor,
    DEFAULT_GROWTH_FACTOR
  )
  const maxChildren = positiveInteger(options.maxChildren, DEFAULT_MAX_CHILDREN)
  const parent = findAggregateParent(root, aggregate, os)
  if (!parent) return undefined

  const retainedCount = parent.children.reduce(
    (count, child) => count + (child.isOther ? 0 : 1),
    0
  )
  if (retainedCount >= maxChildren) return undefined

  const representedCount = positiveMetadataCount(aggregate.otherCount)
  const progressiveLimit = Math.max(
    initialChildren,
    retainedCount * growthFactor
  )
  const knownTotal =
    representedCount === undefined
      ? undefined
      : retainedCount + representedCount
  return {
    parent,
    maxChildren: Math.min(
      maxChildren,
      knownTotal === undefined
        ? progressiveLimit
        : Math.max(retainedCount + 1, Math.min(progressiveLimit, knownTotal))
    ),
    ...(representedCount === undefined ? {} : { representedCount }),
  }
}

function findAggregateParent(
  root: DiskScanNode,
  aggregate: DiskScanNode,
  os?: DesktopOS
): DiskScanNode | undefined {
  for (const child of root.children) {
    if (
      child.isOther &&
      (child === aggregate || diskPathEquals(child.path, aggregate.path, os))
    )
      return root
    const match = findAggregateParent(child, aggregate, os)
    if (match) return match
  }
  return undefined
}

function positiveMetadataCount(value: number | undefined) {
  return Number.isSafeInteger(value) && value! > 0 ? value : undefined
}

function positiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError("Other expansion bounds must be positive integers")
  return value
}
