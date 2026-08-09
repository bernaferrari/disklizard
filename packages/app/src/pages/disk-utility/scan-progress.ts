import type { DiskScanProgress } from "@/context/platform"

export type ScanDiscovery = NonNullable<DiskScanProgress["discovery"]>

export function mergeScanDiscoveries(
  current: readonly ScanDiscovery[],
  discovery: ScanDiscovery,
  limit = 12,
): ScanDiscovery[] {
  if (limit <= 0 || discovery.size <= 0) return [...current]
  return [...current.filter((item) => item.path !== discovery.path), discovery]
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export type ScanDiscoveryArc = ScanDiscovery & {
  /** Fraction of one clockwise turn. */
  start: number
  /** Fraction of one clockwise turn, excluding the visual gap. */
  length: number
}

/** Convert completed branches into a compact orbit without inventing a total for an unfinished folder scan. */
export function scanDiscoveryArcs(discoveries: readonly ScanDiscovery[]): ScanDiscoveryArc[] {
  const visible = discoveries.filter((item) => item.size > 0)
  const total = visible.reduce((sum, item) => sum + item.size, 0)
  if (!total) return []

  const gap = Math.min(0.012, 0.16 / visible.length)
  let cursor = 0
  return visible.map((item) => {
    const share = item.size / total
    const arc = { ...item, start: cursor, length: Math.max(0, share - gap) }
    cursor += share
    return arc
  })
}
