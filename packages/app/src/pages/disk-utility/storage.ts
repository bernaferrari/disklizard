import type { DiskCleanupLock, DiskDriveInfo, DiskPinnedLocation, DiskScanNode } from "./types"
import { canDeletePath } from "@/core/safety"
import { isPathCleanupLocked } from "./cleanup-lock"
import { containsSharedPhysicalStorage, type ReclaimSummary } from "./recognize"
import { diskLanguageText } from "./runtime"
import { PINNED_LOCATION_LIMIT } from "./saved-paths"

function normalizedDiskPath(path: string, os?: "macos" | "windows" | "linux") {
  // Exact casing is significant on APFS and on NTFS directories with the
  // per-directory case-sensitive flag. Scanner-produced paths already carry
  // the spelling needed for stable identity.
  const windowsPath =
    os === "windows" ||
    (os === undefined && (/^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\")))
  let normalized = windowsPath
    ? path.replace(/\\/g, "/").replace(/^\/\/+/, "//").replace(/(?<!^)\/{2,}/g, "/")
    : path.replace(/\/+/g, "/")
  normalized = normalized.replace(/\/+$/, "") || "/"
  if (windowsPath && /^[a-z]:$/i.test(normalized)) normalized += "/"
  return normalized
}

export function diskPathEquals(a: string, b: string, os?: "macos" | "windows" | "linux") {
  return normalizedDiskPath(a, os) === normalizedDiskPath(b, os)
}

/** Exact scanner-path containment; never case-folds case-sensitive NTFS directories. */
export function diskPathIsWithin(path: string, rootPath: string, os?: "macos" | "windows" | "linux") {
  const candidate = normalizedDiskPath(path, os)
  const root = normalizedDiskPath(rootPath, os)
  return candidate === root || candidate.startsWith(root.endsWith("/") ? root : `${root}/`)
}

export function isPinnedScanLocation(
  locations: readonly DiskPinnedLocation[],
  path: string,
  os?: "macos" | "windows" | "linux",
) {
  return locations.some((location) => diskPathEquals(location.path, path, os))
}

/** Toggle a bounded persistent scan shortcut list without leaking platform path quirks into the UI. */
export function togglePinnedScanLocation(
  locations: readonly DiskPinnedLocation[],
  candidate: DiskPinnedLocation,
  os?: "macos" | "windows" | "linux",
  limit = PINNED_LOCATION_LIMIT,
): DiskPinnedLocation[] {
  if (!candidate.path.trim()) return [...locations]
  if (isPinnedScanLocation(locations, candidate.path, os)) {
    return locations.filter((location) => !diskPathEquals(location.path, candidate.path, os))
  }
  if (locations.length >= Math.max(1, limit)) return [...locations]
  const next = [...locations, { path: candidate.path, label: candidate.label.trim() || candidate.path }]
  return next
}

export function driveForPath(
  path: string,
  drives: readonly DiskDriveInfo[],
  os?: "macos" | "windows" | "linux",
): DiskDriveInfo | undefined {
  const candidate = normalizedDiskPath(path, os)
  const comparableCandidate = os === "windows" ? candidate.toLowerCase() : candidate
  return [...drives]
    .sort((a, b) => normalizedDiskPath(b.path, os).length - normalizedDiskPath(a.path, os).length)
    .find((drive) => {
      const normalizedRoot = normalizedDiskPath(drive.path, os)
      const root = os === "windows" ? normalizedRoot.toLowerCase() : normalizedRoot
      return comparableCandidate === root || comparableCandidate.startsWith(root.endsWith("/") ? root : `${root}/`)
    })
}

/** Physical-byte maps need complete shared-storage evidence before they can promise reclaimable space. */
export function isPhysicalByteAccounting(os?: "macos" | "windows" | "linux", drive?: DiskDriveInfo): boolean {
  // Scan requests default to physical bytes on every non-Windows platform.
  // Drive discovery can legitimately lag behind that request, so an unknown
  // drive stays on the conservative physical path until we explicitly know
  // it is a network volume (or Windows' logical-accounting path).
  if (os === "windows") return false
  return drive?.type !== "network"
}

export function hasUnverifiedPhysicalCloneAccounting(
  root: DiskScanNode | null | undefined,
  os?: "macos" | "windows" | "linux",
  drive?: DiskDriveInfo,
): boolean {
  return (
    !!root &&
    isPhysicalByteAccounting(os, drive) &&
    (root.cloneMetadata?.state !== "available" || root.sharedStorageEvidence !== "complete")
  )
}

/**
 * Account for bytes the filesystem reports as used but a metadata scan cannot
 * attribute to visible files (permissions, snapshots, metadata, or clones).
 */
export function includeHiddenSpace(root: DiskScanNode, drive?: DiskDriveInfo): DiskScanNode {
  if (!drive || !diskPathEquals(root.path, drive.path) || drive.used <= root.size) return root
  const hiddenSize = drive.used - root.size
  const hidden: DiskScanNode = {
    name: diskLanguageText("disk.node.hiddenSpace"),
    path: `disklizard:hidden:${root.path}`,
    size: hiddenSize,
    isDir: true,
    isOther: true,
    isHidden: true,
    children: [],
    ext: "",
  }

  return {
    ...root,
    size: drive.used,
    children: [...root.children, hidden].sort((a, b) => b.size - a.size),
  }
}

export function asBrowseableRoot(node: DiskScanNode): DiskScanNode {
  if (node.isDir) return node
  return {
    name: diskLanguageText("disk.node.selectedFile"),
    path: `disklizard:selection:${node.path}`,
    size: node.size,
    ...(node.cloneMetadata ? { cloneMetadata: node.cloneMetadata } : {}),
    ...(node.sharedStorageEvidence ? { sharedStorageEvidence: node.sharedStorageEvidence } : {}),
    isDir: true,
    children: [node],
    ext: "",
  }
}

function apparentBytes(node: Pick<DiskScanNode, "size" | "logicalSize">) {
  return node.logicalSize ?? node.size
}

/** Metadata that describes the accounting boundary is valid only on the authoritative scan root. */
function withoutRootOnlyScanMetadata(node: DiskScanNode): DiskScanNode {
  if (!node.developerArtifactInventory && !node.cloneMetadata && !node.sharedStorageEvidence) return node
  const {
    developerArtifactInventory: _inventory,
    cloneMetadata: _cloneMetadata,
    sharedStorageEvidence: _sharedStorageEvidence,
    ...subtree
  } = node
  return subtree
}

function withReconciledChildren(node: DiskScanNode, children: DiskScanNode[]): DiskScanNode {
  const previousSize = node.children.reduce((sum, child) => sum + child.size, 0)
  const nextSize = children.reduce((sum, child) => sum + child.size, 0)
  const previousLogicalSize = node.children.reduce((sum, child) => sum + apparentBytes(child), 0)
  const nextLogicalSize = children.reduce((sum, child) => sum + apparentBytes(child), 0)
  const size = Math.max(0, node.size + nextSize - previousSize)
  const logicalSize = Math.max(0, apparentBytes(node) + nextLogicalSize - previousLogicalSize)
  const modifiedAt = children.reduce((latest, child) => Math.max(latest, child.modifiedAt ?? 0), 0)
  const { logicalSize: _previousLogicalSize, ...unchanged } = node
  return {
    ...unchanged,
    size,
    ...(logicalSize === size ? {} : { logicalSize }),
    modifiedAt: modifiedAt || undefined,
    children: children.toSorted((a, b) => b.size - a.size),
  }
}

/** Replace a focused subtree without losing its retained ancestors or scan-root identity. */
export function replaceScanSubtree(
  root: DiskScanNode,
  targetPath: string,
  replacement: DiskScanNode,
  os?: "macos" | "windows" | "linux",
): DiskScanNode {
  function visit(current: DiskScanNode, isScanRoot: boolean): DiskScanNode {
    if (diskPathEquals(current.path, targetPath, os)) {
      // A focused expansion must never attach boundary-wide accounting or
      // inventory evidence to a materialized child. The existing scan root
      // remains the sole authority for those claims.
      return isScanRoot ? replacement : withoutRootOnlyScanMetadata(replacement)
    }

    const children = current.children.map((child) => visit(child, false))
    if (children.every((child, index) => child === current.children[index])) return current

    return withReconciledChildren(current, children)
  }

  const result = visit(root, true)
  if (
    result === root ||
    diskPathEquals(root.path, targetPath, os) ||
    result.sharedStorageEvidence !== "complete"
  ) {
    return result
  }

  // The replacement came from an independent scan boundary. Its local
  // hard-link/clone decisions cannot prove relationships with siblings in the
  // outer map, so whole-root physical reclaim claims must remain disabled
  // until a fresh authoritative root scan reconciles the complete boundary.
  return { ...result, sharedStorageEvidence: "partial" }
}

/** Remove confirmed filesystem deletions while preserving unaffected tree object identity. */
export function removeScanSubtrees(
  root: DiskScanNode,
  removed: readonly DiskScanNode[],
  os?: "macos" | "windows" | "linux",
): DiskScanNode | null {
  const targets = new Set(uniqueDeletionRoots(removed, os).map((node) => normalizedDiskPath(node.path, os)))

  function visit(node: DiskScanNode): DiskScanNode | null {
    if (targets.has(normalizedDiskPath(node.path, os))) return null
    const children = node.children.map(visit).filter((child): child is DiskScanNode => child !== null)
    if (children.length === node.children.length && children.every((child, index) => child === node.children[index]))
      return node

    return withReconciledChildren(node, children)
  }

  return visit(root)
}

export function canActOnNode(
  node: DiskScanNode,
  os?: "macos" | "windows" | "linux",
  locks: readonly DiskCleanupLock[] = [],
) {
  const platform = os === "macos" ? "darwin" : os === "windows" ? "win32" : "linux"
  return !node.isOther && !node.isHidden && !isPathCleanupLocked(node.path, locks, os) && canDeletePath(node.path, platform)
}

/** Keep the cleanup promise aligned with the path policy enforced by Electron. */
export function actionableReclaimSummary(
  summary: ReclaimSummary,
  os?: "macos" | "windows" | "linux",
  locks: readonly DiskCleanupLock[] = [],
): ReclaimSummary {
  const buckets = summary.buckets
    .flatMap((bucket) => {
      const items = bucket.items.filter(({ node }) => canActOnNode(node, os, locks) && !containsSharedPhysicalStorage(node))
      if (!items.length) return []
      return [{ ...bucket, items, count: items.length, bytes: items.reduce((sum, item) => sum + item.node.size, 0) }]
    })
    .sort((a, b) => b.bytes - a.bytes)
  return {
    totalBytes: buckets.reduce((sum, bucket) => sum + bucket.bytes, 0),
    totalCount: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    buckets,
  }
}

/** Collapse nested selections so a parent and its child are never charged or removed twice. */
export function uniqueDeletionRoots(
  nodes: readonly DiskScanNode[],
  os?: "macos" | "windows" | "linux",
): DiskScanNode[] {
  const key = (node: DiskScanNode) => {
    return node.path.replace(/\\/g, "/").replace(/\/+$/, "")
  }
  const sorted = [...nodes].sort((a, b) => key(a).length - key(b).length)
  const roots: DiskScanNode[] = []
  const selected = new Set<string>()
  for (const node of sorted) {
    const candidate = key(node)
    if (selected.has(candidate)) continue

    let separator = candidate.lastIndexOf("/")
    let nested = false
    while (separator >= 0) {
      const ancestor = separator === 0 ? "/" : candidate.slice(0, separator)
      if (selected.has(ancestor)) {
        nested = true
        break
      }
      if (separator === 0) break
      separator = candidate.lastIndexOf("/", separator - 1)
    }
    if (nested) continue

    selected.add(candidate)
    roots.push(node)
  }
  return roots
}

/** Remove stale collection entries that were inside an item deleted elsewhere. */
export function withoutDeletedNodes(
  nodes: readonly DiskScanNode[],
  deleted: readonly DiskScanNode[],
  os?: "macos" | "windows" | "linux",
): DiskScanNode[] {
  const key = (node: DiskScanNode) => {
    return node.path.replace(/\\/g, "/").replace(/\/+$/, "")
  }
  const roots = uniqueDeletionRoots(deleted, os).map(key)
  return nodes.filter((node) => {
    const candidate = key(node)
    return !roots.some((root) => candidate === root || candidate.startsWith(`${root}/`))
  })
}

export async function runDeletionBatch(
  nodes: readonly DiskScanNode[],
  remove: (node: DiskScanNode) => Promise<unknown>,
  os?: "macos" | "windows" | "linux",
  locks: readonly DiskCleanupLock[] = [],
) {
  const removed: DiskScanNode[] = []
  const failed: Array<{ node: DiskScanNode; error: unknown }> = []
  for (const node of uniqueDeletionRoots(nodes, os)) {
    if (!canActOnNode(node, os, locks)) continue
    try {
      await remove(node)
      removed.push(node)
    } catch (error) {
      failed.push({ node, error })
    }
  }
  return { removed, failed }
}
