import type { DiskScanNode } from "./types"
import { storageTileColor } from "./visual-palette"

/** Resolve from the scan's branches, never from the current viewport's ranking. */
export function createBranchIdentity(root: DiskScanNode | undefined | null) {
  const branches = [...(root?.children ?? [])].sort((a, b) => b.size - a.size)
  return (path: string): { index: number; depth: number } | undefined => {
    const index = branches.findIndex(branch => path === branch.path || path.startsWith(branch.path + "/"))
    if (index < 0) return undefined
    const depth = path.slice(branches[index]!.path.length).split("/").filter(Boolean).length
    return { index, depth }
  }
}

export function createTileIdentity(root: DiskScanNode | undefined | null) {
  const identity = createBranchIdentity(root)
  return (path: string) => {
    const value = identity(path)
    return value ? storageTileColor(value.index, value.depth % 3) : undefined
  }
}
