import type { DiskScanNode } from "./types"

/** Preserve member sizes while bounding the number of painted cells. */
export function aggregatePreviewCells(
  children: readonly DiskScanNode[],
  width: number,
  height: number
): DiskScanNode[] {
  const ranked = children
    .filter((child) => child.size > 0)
    .toSorted((a, b) => b.size - a.size)
  const capacity = Math.max(
    16,
    Math.min(6_000, Math.floor((width * height) / 64))
  )
  if (ranked.length <= capacity) return ranked

  // The largest members remain individual cells. The rest are size-preserving
  // bins, so the preview never invents disk space or needs thousands of nodes.
  const individualCount = Math.min(24, Math.floor(capacity / 4))
  const individual = ranked.slice(0, individualCount)
  const tail = ranked.slice(individualCount)
  const binCount = capacity - individual.length
  const bins: DiskScanNode[] = []
  for (let index = 0; index < binCount; index++) {
    const start = Math.floor((index * tail.length) / binCount)
    const end = Math.floor(((index + 1) * tail.length) / binCount)
    const slice = tail.slice(start, end)
    if (!slice.length) continue
    bins.push({
      name: "",
      path: `preview:${index}`,
      size: slice.reduce((sum, child) => sum + child.size, 0),
      isDir: true,
      isOther: true,
      otherCount: slice.length,
      children: slice,
      ext: "",
    })
  }
  return [...individual, ...bins]
}
