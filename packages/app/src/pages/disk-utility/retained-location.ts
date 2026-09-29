import { diskPathEquals, diskPathIsWithin } from "./storage"
import type { DiskScanNode } from "./types"

type DiskOS = "macos" | "windows" | "linux"

export type RetainedLocationCandidate<Kind extends string> = {
  kind: Kind
  id: string
  tree: DiskScanNode
}

/** Follow only the requested path through a retained tree, without walking the scan. */
function nodeAtPath(root: DiskScanNode, path: string, os?: DiskOS) {
  if (!diskPathIsWithin(path, root.path, os)) return undefined
  let node = root
  while (!diskPathEquals(node.path, path, os)) {
    const child = node.children.find(
      (entry) => !entry.isOther && diskPathIsWithin(path, entry.path, os)
    )
    if (!child) return undefined
    node = child
  }
  // A budgeted placeholder without retained contents has no map to reopen.
  if (node !== root && node.isCollapsed && !node.children.length)
    return undefined
  return node
}

/** Prefer a dedicated scan of the location over a partial view inside another scan. */
export function findRetainedLocation<Kind extends string>(
  path: string,
  candidates: readonly RetainedLocationCandidate<Kind>[],
  os?: DiskOS
):
  | { candidate: RetainedLocationCandidate<Kind>; node: DiskScanNode }
  | undefined {
  for (const exact of [true, false]) {
    for (const candidate of candidates) {
      if (diskPathEquals(candidate.tree.path, path, os) !== exact) continue
      const node = nodeAtPath(candidate.tree, path, os)
      if (node) return { candidate, node }
    }
  }
  return undefined
}
