import type { DeveloperArtifact, DeveloperArtifactDirectoryIdentity } from "@disklizard/core"
import type { DiskScanNode } from "./types"

/**
 * A deep-inventory record is deliberately rendered as a node-shaped value so
 * the list, keyboard selection, and review basket can share the normal disk
 * UI. It is not part of `children`, however, so callers must never drill into
 * it or assume a local tree update can account for a removal.
 */
export type DeveloperInventoryNode = DiskScanNode & DeveloperArtifact

export function developerInventoryNode(artifact: DeveloperArtifact): DeveloperInventoryNode {
  return {
    ...artifact,
    children: [],
    ext: "",
  }
}

function inventoryPathEquals(a: string, b: string, os?: "macos" | "windows" | "linux") {
  const normalize = (path: string) => {
    const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "") || "/"
    return os === "windows" ? normalized.toLowerCase() : normalized
  }
  return normalize(a) === normalize(b)
}

function findMaterializedNode(
  root: DiskScanNode,
  targetPath: string,
  os?: "macos" | "windows" | "linux",
): DiskScanNode | undefined {
  if (inventoryPathEquals(root.path, targetPath, os)) return root
  for (const child of root.children) {
    const match = findMaterializedNode(child, targetPath, os)
    if (match) return match
  }
  return undefined
}

/** Keep the inventory-only boundary explicit at every destructive call site. */
export function isDeveloperInventoryNode(node: DiskScanNode): node is DeveloperInventoryNode {
  const candidate = node as Partial<DeveloperArtifact>
  return candidate.inventoryOnly === true && candidate.isDir === true && typeof candidate.kind === "string"
}

/** Scanner data is already validated at the desktop boundary; this narrows it for the renderer. */
export function developerArtifactFromInventoryNode(node: DiskScanNode): DeveloperArtifact | undefined {
  return isDeveloperInventoryNode(node) ? node : undefined
}

/**
 * Deep entries are outside the materialized tree, so deleting one must prove
 * the scanned directory is still the directory about to move to Trash. The
 * scanner's direct-directory identity is intentionally distinct from an
 * aggregate descendant modification time.
 */
export type DeveloperArtifactDeletePrecondition = {
  kind: "developer-artifact"
  /** The IPC contract permits this to be optional, but the renderer fails closed without it. */
  directoryIdentity?: DeveloperArtifactDirectoryIdentity
  artifact: Pick<DeveloperArtifact, "name" | "kind" | "ecosystem" | "confidence" | "cleanup">
}

export function developerInventoryDeletePrecondition(
  node: DiskScanNode,
): DeveloperArtifactDeletePrecondition | undefined {
  const artifact = developerArtifactFromInventoryNode(node)
  if (!artifact?.directoryIdentity) return undefined
  const { name, kind, ecosystem, confidence, cleanup } = artifact
  return {
    kind: "developer-artifact",
    directoryIdentity: artifact.directoryIdentity,
    artifact: { name, kind, ecosystem, confidence, cleanup },
  }
}

/**
 * Rebase a shared review-basket row against a fresh root map. Exact
 * materialized nodes take priority; a deep-only replacement is retained only
 * when it still has the scanner identity required for its guarded deletion.
 */
export function developerInventoryCollectionNodeForPath(
  root: DiskScanNode,
  path: string,
  os?: "macos" | "windows" | "linux",
): DiskScanNode | undefined {
  const materialized = findMaterializedNode(root, path, os)
  if (materialized) return materialized
  const artifact = root.developerArtifactInventory?.items.find((item) => inventoryPathEquals(item.path, path, os))
  if (!artifact) return undefined
  const node = developerInventoryNode(artifact)
  return developerInventoryDeletePrecondition(node) ? node : undefined
}

/**
 * A deep inventory is root-only and is never incrementally patched. Any
 * removal can change an item’s aggregate size, modification date, result cap,
 * or coverage facts—even when the affected record was not retained because
 * the inventory was partial or capped—so refresh any inventory-enabled root
 * whose scope intersects the removed path.
 */
export function developerInventoryNeedsRefresh(
  root: DiskScanNode | null | undefined,
  removed: readonly DiskScanNode[],
  os?: "macos" | "windows" | "linux",
): boolean {
  if (!root?.developerArtifactInventory || !removed.length) return false
  const normalized = (path: string) => {
    const value = path.replaceAll("\\", "/").replace(/\/+$/, "") || "/"
    return os === "windows" ? value.toLowerCase() : value
  }
  const rootPath = normalized(root.path)
  const contains = (parent: string, child: string) =>
    parent === child || (parent === "/" ? child.startsWith("/") : child.startsWith(`${parent}/`))
  return removed.some((node) => {
    const path = normalized(node.path)
    return contains(rootPath, path) || contains(path, rootPath)
  })
}

/**
 * The review basket is shared by the active map and parked tabs. Check every
 * retained root before reporting that a deletion can use a local tree patch.
 */
export function developerInventoryRootsNeedRefresh(
  roots: readonly (DiskScanNode | null | undefined)[],
  removed: readonly DiskScanNode[],
  os?: "macos" | "windows" | "linux",
): boolean {
  return roots.some((root) => developerInventoryNeedsRefresh(root, removed, os))
}
