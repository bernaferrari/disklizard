import type { DiskScanNode } from "./types"
import { storageTileColor } from "./visual-palette"

/** Assign a branch once per scanned root so incremental scan updates cannot recolor it. */
const branchColorSlots = new Map<string, Map<string, number>>()
export function createBranchIdentity(root: DiskScanNode | undefined | null) {
  const branches = [...(root?.children ?? [])].sort((a, b) => b.size - a.size)
  const rootPath = root?.path ?? ""
  let slots = branchColorSlots.get(rootPath)
  if (!slots) {
    slots = new Map()
    branchColorSlots.set(rootPath, slots)
  }
  for (const branch of branches) {
    if (!slots.has(branch.path)) slots.set(branch.path, slots.size)
  }
  return (path: string): { index: number; depth: number } | undefined => {
    const branch = branches.find(
      (branch) => path === branch.path || path.startsWith(branch.path + "/")
    )
    if (!branch) return undefined
    const depth = path
      .slice(branch.path.length)
      .split("/")
      .filter(Boolean).length
    return { index: slots.get(branch.path)!, depth }
  }
}

export function createTileIdentity(root: DiskScanNode | undefined | null) {
  const identity = createBranchIdentity(root)
  return (path: string) => {
    const value = identity(path)
    return value ? storageTileColor(value.index, value.depth) : undefined
  }
}
