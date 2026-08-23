import type { DiskScanNode } from "./types"

export type DiskEntrySortKey = "size" | "name" | "modified" | "type"
export type DiskEntrySortDirection = "ascending" | "descending"

export function diskEntrySortKey(value: string): DiskEntrySortKey {
  return value === "name" || value === "modified" || value === "type" ? value : "size"
}

export function diskEntrySortDirection(value: string): DiskEntrySortDirection {
  return value === "ascending" ? value : "descending"
}

export type IndexedDiskEntry = {
  node: DiskScanNode
  colorIndex: number
  sourceIndex: number
  searchText: string
}

export type SortableDiskEntry = {
  node: DiskScanNode
  displaySize: number
  sourceIndex: number
}

function normalizedSearchText(value: string) {
  return value.trim().toLocaleLowerCase()
}

export function diskEntrySearchText(node: DiskScanNode, extra = "") {
  return normalizedSearchText(`${node.name}\n${node.path}\n${extra}`)
}

/**
 * Index every materialized descendant while retaining its local size rank.
 * That rank is the shared color identity used by the orbit, tiles, and list;
 * sorting search results must never recolor an item.
 */
export function indexRetainedDiskTree(
  root: DiskScanNode | null | undefined,
  extraSearchText: (node: DiskScanNode) => string | undefined = () => undefined,
): IndexedDiskEntry[] {
  if (!root) return []
  const indexed: IndexedDiskEntry[] = []

  const visit = (parent: DiskScanNode) => {
    const children = (parent.children ?? [])
      .map((node, originalIndex) => ({ node, originalIndex }))
      .toSorted((left, right) => right.node.size - left.node.size || left.originalIndex - right.originalIndex)
    for (let colorIndex = 0; colorIndex < children.length; colorIndex++) {
      const node = children[colorIndex].node
      indexed.push({
        node,
        colorIndex,
        sourceIndex: indexed.length,
        searchText: diskEntrySearchText(node, extraSearchText(node) ?? ""),
      })
      if (node.children?.length) visit(node)
    }
  }

  visit(root)
  return indexed
}

export function filterIndexedDiskEntries(entries: readonly IndexedDiskEntry[], query: string) {
  const normalized = normalizedSearchText(query)
  if (!normalized) return [...entries]
  return entries.filter((entry) => entry.searchText.includes(normalized))
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })
}

function diskEntryType(node: DiskScanNode) {
  if (node.isDir) return "0:folder"
  const extension = node.ext.trim().toLocaleLowerCase()
  return `1:${extension || "file"}`
}

function compareDefinedNumbers(left: number | undefined, right: number | undefined) {
  if (left === undefined && right === undefined) return 0
  if (left === undefined) return 1
  if (right === undefined) return -1
  return left - right
}

/** Stable sorting keeps the retained-tree order as the final tie breaker. */
export function sortDiskEntries<T extends SortableDiskEntry>(
  entries: readonly T[],
  key: DiskEntrySortKey,
  direction: DiskEntrySortDirection,
): T[] {
  const factor = direction === "ascending" ? 1 : -1
  return entries.toSorted((left, right) => {
    const comparison =
      key === "size"
        ? left.displaySize - right.displaySize
        : key === "name"
          ? compareText(left.node.name, right.node.name)
          : key === "modified"
            ? compareDefinedNumbers(left.node.modifiedAt, right.node.modifiedAt)
            : compareText(diskEntryType(left.node), diskEntryType(right.node)) ||
              compareText(left.node.name, right.node.name)
    // Unknown modification dates stay last in either direction.
    const missingModified =
      key === "modified" && (left.node.modifiedAt === undefined || right.node.modifiedAt === undefined)
    return (missingModified ? comparison : comparison * factor) || left.sourceIndex - right.sourceIndex
  })
}
