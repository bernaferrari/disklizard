import { lstat } from "./physical-fs"
import path from "node:path"
import { MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS } from "./developer-artifacts"
import type { DeveloperArtifactInventory, DiskNode, ScanProgress } from "./types"

export const MAX_MATERIALIZED_DISK_TREE_NODES = 500_000

const ARTIFACT_IDENTITY_HYDRATION_CONCURRENCY = 12
const MAX_ARTIFACT_IDENTITY_STATUS_SAMPLES = 12
const MAX_NATIVE_INVENTORY_SAMPLE_PATHS = 12
// These are protocol safety bounds, not scan limits. Native requests still
// decide visual depth/child retention, while malformed sidecar output cannot
// consume unbounded parser stack or work in the desktop process. The node
// budget is shared with snapshots: a cacheable tree must also be acceptable
// from the native sidecar, otherwise the desktop silently rescans it.
const MAX_NATIVE_COMPACT_TREE_DEPTH = 512
export const MAX_NATIVE_PROTOCOL_LINE_BYTES = 64 * 1024 * 1024

type ArtifactDirectoryStat = {
  isDirectory(): boolean
  isSymbolicLink(): boolean
  dev: bigint
  ino: bigint
  mtimeMs: bigint | number
}

type ArtifactDirectoryStatReader = (targetPath: string) => Promise<ArtifactDirectoryStat>

export type NativeMessage =
  | { type: "progress"; progress: ScanProgress }
  | { type: "done"; root: DiskNode; declaredRootPath?: string }
  | { type: "error"; message: string }

export type NativeDoneValidation = {
  /** The lexical, absolute request root that this sidecar response must echo. */
  expectedRootPath?: string
  /** Exact normalized cap sent with an opt-in inventory request. */
  expectedInventoryMaxItems?: number
  /** Native scans must use compact protocol v2; legacy trees are parser-only compatibility. */
  requireDeclaredRootPath?: boolean
  /** Prevent a sidecar from silently adding or omitting the requested root-only inventory. */
  inventoryEnabled?: boolean
}

type CompactNode = {
  n: string
  s: number
  l?: number
  /** Scan-root clone-metadata capability; child nodes must not carry this field. */
  k?: DiskNode["cloneMetadata"]
  /** Scan-root shared-storage evidence; only `complete` can support reclaim estimates. */
  e?: DiskNode["sharedStorageEvidence"]
  /** Root-only bounded deep developer artifact inventory. */
  i?: DiskNode["developerArtifactInventory"]
  m?: number
  h?: "primary" | "secondary"
  v?: DiskNode["clone"]
  /** Exact full-clone group charging, emitted only when native scan observed the entire group. */
  a?: DiskNode["cloneAccounting"]
  d?: boolean
  c?: CompactNode[]
  o?: boolean
  /** Total direct items represented by an aggregate `Other` node. */
  r?: number
  x?: boolean
  g?: string[]
  q?: DiskNode["scanIssues"]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isDiskNode(value: unknown): value is DiskNode {
  const pending: Array<{ node: unknown; isRoot: boolean; depth: number }> = [{ node: value, isRoot: true, depth: 0 }]
  const seen = new WeakSet<object>()
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || !isRecord(current.node) || seen.has(current.node)) return false
    if (++nodes > MAX_MATERIALIZED_DISK_TREE_NODES || current.depth > MAX_NATIVE_COMPACT_TREE_DEPTH) return false
    seen.add(current.node)
    const node = current.node
    if (
      typeof node.name !== "string" ||
      node.name.includes("\0") ||
      typeof node.path !== "string" ||
      node.path.length === 0 ||
      node.path.includes("\0") ||
      !isNonNegativeNumber(node.size) ||
      typeof node.isDir !== "boolean" ||
      !Array.isArray(node.children) ||
      typeof node.ext !== "string" ||
      (node.logicalSize !== undefined && !isNonNegativeNumber(node.logicalSize)) ||
      (node.modifiedAt !== undefined && !isNonNegativeNumber(node.modifiedAt)) ||
      (node.cloneMetadata !== undefined && (!current.isRoot || !isCloneMetadataCapability(node.cloneMetadata))) ||
      (node.sharedStorageEvidence !== undefined &&
        (!current.isRoot || !isSharedStorageEvidence(node.sharedStorageEvidence))) ||
      (node.developerArtifactInventory !== undefined &&
        (!current.isRoot || !isDeveloperArtifactInventory(node.developerArtifactInventory))) ||
      (node.isOther !== undefined && typeof node.isOther !== "boolean") ||
      (node.isOther === true && !node.isDir) ||
      (node.otherCount !== undefined &&
        (!isPositiveSafeInteger(node.otherCount) ||
          node.isOther !== true ||
          (Array.isArray(node.children) && node.otherCount < node.children.length)))
    ) {
      return false
    }
    if (node.children.length > MAX_MATERIALIZED_DISK_TREE_NODES - nodes) return false
    for (const child of node.children) pending.push({ node: child, isRoot: false, depth: current.depth + 1 })
  }
  return true
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

type NativePathApi = typeof path.posix

type NativePathScope = {
  api: NativePathApi
  root: string
  windows: boolean
}

/**
 * The desktop normally receives paths in its own OS syntax. Recognizing drive
 * and UNC syntax explicitly also keeps compact-protocol fixtures portable and
 * prevents POSIX `path.resolve` from treating a Windows pathname as a safe
 * relative child.
 */
function usesWindowsPathSyntax(value: string): boolean {
  return (
    /^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\/]/.test(value) || (process.platform === "win32" && !value.startsWith("/"))
  )
}

function nativePathApi(value: string): { api: NativePathApi; windows: boolean } {
  const windows = usesWindowsPathSyntax(value)
  return { api: windows ? path.win32 : path.posix, windows }
}

/** Create a lexical absolute-root boundary without resolving symlinks. */
function nativePathScope(rootPath: unknown, allowRelative = false): NativePathScope | undefined {
  if (typeof rootPath !== "string" || rootPath.length === 0 || rootPath.includes("\0")) return undefined
  const { api, windows } = nativePathApi(rootPath)
  try {
    if (!allowRelative && !api.isAbsolute(rootPath)) return undefined
    const root = api.resolve(rootPath)
    if (!api.isAbsolute(root)) return undefined
    return { api, root, windows }
  } catch {
    return undefined
  }
}

/** Normalize a requested scan root with the same lexical rules used to validate sidecar output. */
export function normalizeNativeScanRoot(rootPath: string): string | undefined {
  return nativePathScope(rootPath, true)?.root
}

function pathEquals(left: string, right: string): boolean {
  // Protocol-v2 roots preserve separator normalization while retaining exact
  // scanner casing. NTFS directories can opt into case-sensitive names, so a
  // case-folded equality check could bind a scan to a different filesystem object.
  return left === right
}

function leavesNativeRoot(relative: string): boolean {
  return relative === ".." || relative.startsWith("../") || relative.startsWith("..\\")
}

function exactWindowsPathWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith("\\") ? root : `${root}\\`)
}

/** Normalize one untrusted native pathname and prove it stays under `scope`. */
function normalizeScopedNativePath(value: unknown, scope: NativePathScope): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || !scope.api.isAbsolute(value))
    return undefined
  try {
    const normalized = scope.api.resolve(value)
    if (scope.windows && !exactWindowsPathWithinRoot(scope.root, normalized)) return undefined
    const relative = scope.api.relative(scope.root, normalized)
    if (leavesNativeRoot(relative) || scope.api.isAbsolute(relative)) return undefined
    return normalized
  } catch {
    return undefined
  }
}

function normalizeScopedNativePaths(value: unknown, count: unknown, scope: NativePathScope): string[] | undefined {
  if (!isStringArray(value) || !isNonNegativeSafeInteger(count)) return undefined
  const expectedLength = Math.min(count, MAX_NATIVE_INVENTORY_SAMPLE_PATHS)
  if (value.length !== expectedLength || new Set(value).size !== value.length) return undefined
  const normalized = value.map((entry) => normalizeScopedNativePath(entry, scope))
  if (!normalized.every((entry): entry is string => entry !== undefined)) return undefined
  return new Set(normalized).size === normalized.length ? normalized : undefined
}

function isDeveloperArtifactDirectoryIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.platform === "posix" || value.platform === "windows") &&
    typeof value.device === "string" &&
    value.device.length > 0 &&
    value.device !== "0" &&
    typeof value.fileId === "string" &&
    value.fileId.length > 0 &&
    value.fileId !== "0" &&
    typeof value.modifiedAt === "number" &&
    Number.isSafeInteger(value.modifiedAt) &&
    value.modifiedAt >= 0
  )
}

function isDeveloperArtifact(value: unknown): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.name === "string" &&
    typeof value.path === "string" &&
    isNonNegativeNumber(value.size) &&
    (value.logicalSize === undefined || isNonNegativeNumber(value.logicalSize)) &&
    (value.modifiedAt === undefined || isNonNegativeNumber(value.modifiedAt)) &&
    (value.directoryIdentity === undefined || isDeveloperArtifactDirectoryIdentity(value.directoryIdentity)) &&
    value.isDir === true &&
    (value.signatures === undefined || isStringArray(value.signatures)) &&
    (value.kind === "dependencies" || value.kind === "build-output" || value.kind === "toolchain-cache") &&
    (value.ecosystem === "node" ||
      value.ecosystem === "python" ||
      value.ecosystem === "rust" ||
      value.ecosystem === "jvm" ||
      value.ecosystem === "cpp" ||
      value.ecosystem === "go" ||
      value.ecosystem === "dotnet" ||
      value.ecosystem === "dart" ||
      value.ecosystem === "apple" ||
      value.ecosystem === "web" ||
      value.ecosystem === "containers" ||
      value.ecosystem === "tooling" ||
      value.ecosystem === "generic" ||
      value.ecosystem === "agent" ||
      value.ecosystem === "git") &&
    (value.confidence === "verified" || value.confidence === "likely" || value.confidence === "ambiguous") &&
    (value.cleanup === "eligible" || value.cleanup === "review") &&
    isStringArray(value.evidence) &&
    value.inventoryOnly === true
  )
}

/**
 * Validate and normalize the only uncompressed paths carried by protocol v2:
 * root-only inventory records and their coverage samples. This must run before
 * identity hydration, because the latter performs direct `lstat` calls.
 */
function normalizeNativeDeveloperArtifactInventory(
  value: unknown,
  scope: NativePathScope,
  expectedMaxItems?: number,
): DeveloperArtifactInventory | undefined {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(isDeveloperArtifact) ||
    !isRecord(value.status)
  ) {
    return undefined
  }
  const status = value.status
  if (
    (status.state !== "complete" && status.state !== "partial") ||
    !isNonNegativeSafeInteger(status.maxItems) ||
    status.maxItems < 1 ||
    status.maxItems > MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS ||
    (expectedMaxItems !== undefined && status.maxItems !== expectedMaxItems) ||
    value.items.length > status.maxItems ||
    !isNonNegativeSafeInteger(status.scannedDirectories) ||
    !isNonNegativeSafeInteger(status.matchedDirectories) ||
    status.scannedDirectories < status.matchedDirectories ||
    status.matchedDirectories < value.items.length ||
    typeof status.truncated !== "boolean" ||
    (!status.truncated && status.matchedDirectories !== value.items.length) ||
    (status.truncated && (value.items.length !== status.maxItems || status.matchedDirectories <= status.maxItems)) ||
    !isNonNegativeSafeInteger(status.unreadableCount) ||
    !isNonNegativeSafeInteger(status.skippedSymlinkCount) ||
    (status.skippedDirectoryCount !== undefined && !isNonNegativeSafeInteger(status.skippedDirectoryCount)) ||
    (status.unavailableDirectoryIdentityCount !== undefined &&
      !isNonNegativeSafeInteger(status.unavailableDirectoryIdentityCount)) ||
    !isNonNegativeSafeInteger(status.excludedCount)
  ) {
    return undefined
  }

  const unreadableSamplePaths = normalizeScopedNativePaths(status.unreadableSamplePaths, status.unreadableCount, scope)
  const skippedSymlinkSamplePaths = normalizeScopedNativePaths(
    status.skippedSymlinkSamplePaths,
    status.skippedSymlinkCount,
    scope,
  )
  const skippedDirectorySamplePaths =
    status.skippedDirectorySamplePaths === undefined && status.skippedDirectoryCount === undefined
      ? undefined
      : normalizeScopedNativePaths(status.skippedDirectorySamplePaths, status.skippedDirectoryCount, scope)
  const unavailableDirectoryIdentitySamplePaths =
    status.unavailableDirectoryIdentitySamplePaths === undefined &&
    status.unavailableDirectoryIdentityCount === undefined
      ? undefined
      : normalizeScopedNativePaths(
          status.unavailableDirectoryIdentitySamplePaths,
          status.unavailableDirectoryIdentityCount,
          scope,
        )
  const excludedSamplePaths = normalizeScopedNativePaths(status.excludedSamplePaths, status.excludedCount, scope)
  const hasMalformedSkippedDirectorySamples =
    skippedDirectorySamplePaths === undefined &&
    (status.skippedDirectorySamplePaths !== undefined || status.skippedDirectoryCount !== undefined)
  const hasMalformedUnavailableIdentitySamples =
    unavailableDirectoryIdentitySamplePaths === undefined &&
    (status.unavailableDirectoryIdentitySamplePaths !== undefined ||
      status.unavailableDirectoryIdentityCount !== undefined)
  if (
    unreadableSamplePaths === undefined ||
    skippedSymlinkSamplePaths === undefined ||
    hasMalformedSkippedDirectorySamples ||
    hasMalformedUnavailableIdentitySamples ||
    excludedSamplePaths === undefined
  ) {
    return undefined
  }

  const items = value.items.map((item) => {
    const normalizedPath = normalizeScopedNativePath(item.path, scope)
    return normalizedPath === undefined ? undefined : { ...item, path: normalizedPath }
  })
  if (!items.every((item): item is DeveloperArtifactInventory["items"][number] => item !== undefined)) return undefined
  if (new Set(items.map((item) => item.path)).size !== items.length) {
    return undefined
  }

  const identitylessPaths = items
    .filter((item) => !isDeveloperArtifactDirectoryIdentity(item.directoryIdentity))
    .map((item) => item.path)
  const unavailableCount = status.unavailableDirectoryIdentityCount
  if (
    (unavailableCount === undefined) !== (unavailableDirectoryIdentitySamplePaths === undefined) ||
    (unavailableCount !== undefined && unavailableCount !== identitylessPaths.length) ||
    (unavailableDirectoryIdentitySamplePaths !== undefined &&
      unavailableDirectoryIdentitySamplePaths.length !==
        Math.min(identitylessPaths.length, MAX_NATIVE_INVENTORY_SAMPLE_PATHS)) ||
    (unavailableDirectoryIdentitySamplePaths !== undefined &&
      unavailableDirectoryIdentitySamplePaths.some((sample) => !identitylessPaths.includes(sample)))
  ) {
    return undefined
  }

  const mustBePartial =
    status.truncated ||
    status.unreadableCount > 0 ||
    status.skippedSymlinkCount > 0 ||
    (status.skippedDirectoryCount ?? 0) > 0 ||
    identitylessPaths.length > 0 ||
    status.excludedCount > 0
  if (mustBePartial && status.state !== "partial") return undefined

  return {
    items,
    status: {
      state: status.state,
      maxItems: status.maxItems,
      scannedDirectories: status.scannedDirectories,
      matchedDirectories: status.matchedDirectories,
      truncated: status.truncated,
      unreadableCount: status.unreadableCount,
      unreadableSamplePaths,
      skippedSymlinkCount: status.skippedSymlinkCount,
      skippedSymlinkSamplePaths,
      ...(status.skippedDirectoryCount === undefined ? {} : { skippedDirectoryCount: status.skippedDirectoryCount }),
      ...(skippedDirectorySamplePaths === undefined ? {} : { skippedDirectorySamplePaths }),
      ...(status.unavailableDirectoryIdentityCount === undefined
        ? {}
        : { unavailableDirectoryIdentityCount: status.unavailableDirectoryIdentityCount }),
      ...(unavailableDirectoryIdentitySamplePaths === undefined ? {} : { unavailableDirectoryIdentitySamplePaths }),
      excludedCount: status.excludedCount,
      excludedSamplePaths,
    },
  }
}

/** Structural gate used before the compact root supplies its path scope. */
function isDeveloperArtifactInventory(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(isDeveloperArtifact) ||
    !isRecord(value.status)
  ) {
    return false
  }
  const status = value.status
  return (
    (status.state === "complete" || status.state === "partial") &&
    isNonNegativeSafeInteger(status.maxItems) &&
    status.maxItems > 0 &&
    isNonNegativeSafeInteger(status.scannedDirectories) &&
    isNonNegativeSafeInteger(status.matchedDirectories) &&
    typeof status.truncated === "boolean" &&
    isNonNegativeSafeInteger(status.unreadableCount) &&
    isStringArray(status.unreadableSamplePaths) &&
    isNonNegativeSafeInteger(status.skippedSymlinkCount) &&
    isStringArray(status.skippedSymlinkSamplePaths) &&
    (status.skippedDirectoryCount === undefined || isNonNegativeSafeInteger(status.skippedDirectoryCount)) &&
    (status.skippedDirectorySamplePaths === undefined || isStringArray(status.skippedDirectorySamplePaths)) &&
    (status.unavailableDirectoryIdentityCount === undefined ||
      isNonNegativeSafeInteger(status.unavailableDirectoryIdentityCount)) &&
    (status.unavailableDirectoryIdentitySamplePaths === undefined ||
      isStringArray(status.unavailableDirectoryIdentitySamplePaths)) &&
    isNonNegativeSafeInteger(status.excludedCount) &&
    isStringArray(status.excludedSamplePaths)
  )
}

function invalidNativeInventoryError(): Error {
  return new Error("Native scanner returned an invalid developer artifact inventory")
}

/**
 * Normalize an already-hydrated root's inventory before any desktop `lstat`.
 * `expectedRootPath` is supplied by scanPathNative so an untrusted sidecar
 * cannot redirect this bounded metadata pass to an unrelated location.
 */
function normalizeNativeInventoryRoot(
  root: DiskNode,
  expectedRootPath?: string,
  expectedInventoryMaxItems?: number,
): NativePathScope {
  const scope = nativePathScope(root.path)
  if (!scope) throw invalidNativeInventoryError()
  if (expectedRootPath !== undefined) {
    const expected = nativePathScope(expectedRootPath)
    if (!expected || expected.windows !== scope.windows || !pathEquals(scope.root, expected.root)) {
      throw invalidNativeInventoryError()
    }
  }
  root.path = scope.root
  if (!root.developerArtifactInventory) return scope
  const normalized = normalizeNativeDeveloperArtifactInventory(
    root.developerArtifactInventory,
    scope,
    expectedInventoryMaxItems,
  )
  if (!normalized) throw invalidNativeInventoryError()
  root.developerArtifactInventory = normalized
  return scope
}

function isCloneEvidence(value: unknown): value is NonNullable<DiskNode["clone"]> {
  if (!isRecord(value) || typeof value.state !== "string") return false
  if (value.state === "unavailable")
    return value.reason === "platform" || value.reason === "filesystem" || value.reason === "scanner"
  if (value.state === "unknown" || value.state === "not-shared") return true
  if (value.state === "may-share-blocks") return value.cloneId === undefined || typeof value.cloneId === "string"
  if (value.state === "shares-all-blocks") {
    return (
      (value.cloneId === undefined || typeof value.cloneId === "string") &&
      (value.reportedFullCloneCount === undefined ||
        (typeof value.reportedFullCloneCount === "number" &&
          Number.isSafeInteger(value.reportedFullCloneCount) &&
          value.reportedFullCloneCount > 0))
    )
  }
  return false
}

function isCloneAccounting(value: unknown): value is NonNullable<DiskNode["cloneAccounting"]> {
  return value === "primary" || value === "secondary"
}

function isCloneMetadataCapability(value: unknown): value is NonNullable<DiskNode["cloneMetadata"]> {
  if (!isRecord(value) || typeof value.state !== "string") return false
  if (value.state === "available" || value.state === "unknown") return true
  return (
    value.state === "unavailable" &&
    (value.reason === "platform" || value.reason === "filesystem" || value.reason === "scanner")
  )
}

function isSharedStorageEvidence(value: unknown): value is NonNullable<DiskNode["sharedStorageEvidence"]> {
  return value === "complete" || value === "partial"
}

/** A charging marker without this exact filesystem evidence would be a false claim. */
function hasCompleteCloneEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.state === "shares-all-blocks" &&
    typeof value.cloneId === "string" &&
    value.cloneId.length > 0 &&
    typeof value.reportedFullCloneCount === "number" &&
    Number.isSafeInteger(value.reportedFullCloneCount) &&
    value.reportedFullCloneCount > 1
  )
}

function isSafeCompactDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0")
}

function isScanIssueSummary(value: unknown): value is NonNullable<DiskNode["scanIssues"]> {
  return (
    isRecord(value) &&
    isNonNegativeSafeInteger(value.unreadableCount) &&
    isStringArray(value.samplePaths) &&
    value.samplePaths.length === Math.min(value.unreadableCount, MAX_NATIVE_INVENTORY_SAMPLE_PATHS) &&
    new Set(value.samplePaths).size === value.samplePaths.length
  )
}

function isCompactNodeShape(value: unknown, isRoot: boolean): value is CompactNode {
  return (
    isRecord(value) &&
    isSafeCompactDisplayName(value.n) &&
    isNonNegativeNumber(value.s) &&
    (value.l === undefined || isNonNegativeNumber(value.l)) &&
    (value.m === undefined || isNonNegativeNumber(value.m)) &&
    (value.h === undefined || value.h === "primary" || value.h === "secondary") &&
    (value.k === undefined || (isRoot && isCloneMetadataCapability(value.k))) &&
    (value.e === undefined || (isRoot && isSharedStorageEvidence(value.e))) &&
    (value.i === undefined || (isRoot && isDeveloperArtifactInventory(value.i))) &&
    (value.v === undefined || isCloneEvidence(value.v)) &&
    (value.a === undefined || (isCloneAccounting(value.a) && hasCompleteCloneEvidence(value.v))) &&
    (value.d === undefined || typeof value.d === "boolean") &&
    (value.o === undefined || typeof value.o === "boolean") &&
    (value.r === undefined || isPositiveSafeInteger(value.r)) &&
    (value.x === undefined || typeof value.x === "boolean") &&
    (value.g === undefined || isStringArray(value.g)) &&
    (value.q === undefined || isScanIssueSummary(value.q)) &&
    (value.c === undefined || Array.isArray(value.c)) &&
    (value.o !== true || (!isRoot && value.d === true)) &&
    (value.r === undefined || (value.o === true && (!Array.isArray(value.c) || value.r >= value.c.length))) &&
    (value.x !== true || value.d === true)
  )
}

/**
 * Validate compact payload shape without recursive descent. A sidecar is an
 * untrusted process boundary, so a deeply nested JSON tree must become an
 * invalid message rather than exhaust the desktop JavaScript stack.
 */
function isCompactNode(value: unknown): value is CompactNode {
  const pending: Array<{ node: unknown; isRoot: boolean; depth: number }> = [{ node: value, isRoot: true, depth: 0 }]
  const seen = new WeakSet<object>()
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || !isRecord(current.node) || seen.has(current.node)) return false
    if (++nodes > MAX_MATERIALIZED_DISK_TREE_NODES || current.depth > MAX_NATIVE_COMPACT_TREE_DEPTH) return false
    seen.add(current.node)
    if (!isCompactNodeShape(current.node, current.isRoot)) return false
    const children = current.node.c ?? []
    if (children.length > MAX_MATERIALIZED_DISK_TREE_NODES - nodes) return false
    for (const child of children) {
      pending.push({ node: child, isRoot: false, depth: current.depth + 1 })
    }
  }
  return true
}

function extension(name: string) {
  if (name.startsWith(".")) return ""
  const dot = name.lastIndexOf(".")
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : ""
}

/**
 * Compact protocol nodes carry only basename-like segments. Validate those
 * segments before expanding them so a malicious `n: "../outside"` cannot
 * produce an out-of-root visual node merely because it is not an inventory
 * record. `Other` nodes deliberately hydrate to the fixed synthetic segment.
 */
function compactPathSegment(node: CompactNode, scope: NativePathScope): string | undefined {
  const name = node.n
  const hasSeparator = scope.windows ? /[\\/]/.test(name) : name.includes("/")
  if (
    !isSafeCompactDisplayName(name) ||
    name === "." ||
    name === ".." ||
    hasSeparator ||
    scope.api.isAbsolute(name) ||
    (scope.windows && name.includes(":"))
  ) {
    return undefined
  }
  return node.o === true ? "__other__" : name
}

/**
 * Prove every hydrated compact-tree path remains within the declared root.
 * This repeats the bounded walk intentionally: public hydration is exported
 * for tests and must retain the same safety boundary as parser callers.
 */
function hasScopedCompactTreePaths(scope: NativePathScope, compact: CompactNode): boolean {
  const pending: Array<{ node: CompactNode; path: string; isRoot: boolean; depth: number }> = [
    { node: compact, path: scope.root, isRoot: true, depth: 0 },
  ]
  const seen = new WeakSet<object>()
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || !isRecord(current.node) || seen.has(current.node)) return false
    if (++nodes > MAX_MATERIALIZED_DISK_TREE_NODES || current.depth > MAX_NATIVE_COMPACT_TREE_DEPTH) return false
    seen.add(current.node)
    if (!isCompactNodeShape(current.node, current.isRoot)) return false
    if (
      current.node.q !== undefined &&
      normalizeScopedNativePaths(current.node.q.samplePaths, current.node.q.unreadableCount, scope) === undefined
    ) {
      return false
    }
    const siblingPaths = new Set<string>()
    const children = current.node.c ?? []
    if (children.length > MAX_MATERIALIZED_DISK_TREE_NODES - nodes) return false
    for (const child of children) {
      const segment = compactPathSegment(child, scope)
      if (segment === undefined) return false
      const childPath = normalizeScopedNativePath(scope.api.join(current.path, segment), scope)
      if (childPath === undefined) return false
      const siblingKey = childPath
      if (siblingPaths.has(siblingKey)) return false
      siblingPaths.add(siblingKey)
      pending.push({ node: child, path: childPath, isRoot: false, depth: current.depth + 1 })
    }
  }
  return true
}

function invalidNativeCompactTreeError(): Error {
  return new Error("Native scanner returned an invalid compact tree")
}

function hydrateCompactNode(node: CompactNode, nodePath: string, isRoot: boolean): DiskNode {
  return {
    name: node.n,
    path: nodePath,
    size: node.s,
    ...(node.l === undefined ? {} : { logicalSize: node.l }),
    ...(isRoot && node.k !== undefined ? { cloneMetadata: node.k } : {}),
    ...(isRoot && node.e !== undefined ? { sharedStorageEvidence: node.e } : {}),
    ...(isRoot && node.i !== undefined ? { developerArtifactInventory: node.i } : {}),
    ...(node.m === undefined ? {} : { modifiedAt: node.m }),
    ...(node.h === undefined ? {} : { hardLink: node.h }),
    ...(node.v === undefined ? {} : { clone: node.v }),
    ...(node.a === undefined ? {} : { cloneAccounting: node.a }),
    isDir: node.d === true,
    children: [],
    ext: node.d === true ? "" : extension(node.n),
    ...(node.o === true ? { isOther: true } : {}),
    ...(node.r === undefined ? {} : { otherCount: node.r }),
    ...(node.x === true ? { isCollapsed: true } : {}),
    ...(node.g === undefined ? {} : { signatures: node.g }),
    ...(node.q === undefined ? {} : { scanIssues: node.q }),
  }
}

function hydrateScopedCompactTree(scope: NativePathScope, compact: CompactNode): DiskNode {
  const root = hydrateCompactNode(compact, scope.root, true)
  const pending: Array<{ compact: CompactNode; disk: DiskNode; path: string; depth: number }> = [
    { compact, disk: root, path: scope.root, depth: 0 },
  ]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) throw invalidNativeCompactTreeError()
    const children: DiskNode[] = []
    const compactChildren = current.compact.c ?? []
    if (compactChildren.length > MAX_MATERIALIZED_DISK_TREE_NODES) throw invalidNativeCompactTreeError()
    for (const child of compactChildren) {
      const segment = compactPathSegment(child, scope)
      const childPath =
        segment === undefined ? undefined : normalizeScopedNativePath(scope.api.join(current.path, segment), scope)
      if (childPath === undefined || current.depth >= MAX_NATIVE_COMPACT_TREE_DEPTH)
        throw invalidNativeCompactTreeError()
      const diskChild = hydrateCompactNode(child, childPath, false)
      children.push(diskChild)
      pending.push({ compact: child, disk: diskChild, path: childPath, depth: current.depth + 1 })
    }
    current.disk.children = children
  }
  return root
}

/** Expand path prefixes once, after the compact native payload crosses IPC. */
export function hydrateCompactTree(rootPath: string, compact: CompactNode): DiskNode {
  const scope = nativePathScope(rootPath)
  if (!scope || !isCompactNode(compact) || !hasScopedCompactTreePaths(scope, compact))
    throw invalidNativeCompactTreeError()
  return hydrateScopedCompactTree(scope, compact)
}

function identityPlatform(platformName: NodeJS.Platform): "posix" | "windows" {
  return platformName === "win32" ? "windows" : "posix"
}

type DeveloperArtifactInventoryStatus = NonNullable<DiskNode["developerArtifactInventory"]>["status"]

function hasNonIdentityInventoryCoverageGap(status: DeveloperArtifactInventoryStatus): boolean {
  return (
    status.truncated ||
    status.unreadableCount > 0 ||
    status.skippedSymlinkCount > 0 ||
    (status.skippedDirectoryCount ?? 0) > 0 ||
    status.excludedCount > 0
  )
}

/**
 * Native Windows output is intentionally identity-less until this process
 * reads the directories with Node's bigint lstat representation. Recompute
 * the returned status from the final retained records so a hydration failure
 * cannot leave the renderer believing its deep cleanup inventory is complete.
 */
function reconcileDeveloperArtifactIdentityStatus(root: DiskNode): DiskNode {
  const inventory = root.developerArtifactInventory
  if (!inventory) return root
  const unavailable = inventory.items.filter((item) => !isDeveloperArtifactDirectoryIdentity(item.directoryIdentity))
  const unavailableDirectoryIdentityCount = unavailable.length
  const hasOtherCoverageGap = hasNonIdentityInventoryCoverageGap(inventory.status)
  // Older scanners did not distinguish identity-only partial status from an
  // unknown coverage gap. Preserve such a partial state conservatively; new
  // scanners send the count, allowing successful hydration to clear it.
  const identityOnlyPartial =
    inventory.status.state === "partial" &&
    (inventory.status.unavailableDirectoryIdentityCount ?? 0) > 0 &&
    !hasOtherCoverageGap
  const preserveUnknownPartial = inventory.status.state === "partial" && !identityOnlyPartial
  inventory.status = {
    ...inventory.status,
    state:
      preserveUnknownPartial || hasOtherCoverageGap || unavailableDirectoryIdentityCount > 0 ? "partial" : "complete",
    unavailableDirectoryIdentityCount,
    unavailableDirectoryIdentitySamplePaths: unavailable
      .slice(0, MAX_ARTIFACT_IDENTITY_STATUS_SAMPLES)
      .map((item) => item.path),
  }
  return root
}

/**
 * Native Windows directory identifiers are deliberately not compared with
 * Node's `lstat` dev/ino values. Fill only absent identities here, after the
 * compact payload is validated, using the same representation the desktop
 * Trash guard will later verify. This bounded pass never invents an identity
 * on a symlink, unsupported filesystem, permission failure, or race.
 */
export async function hydrateDeveloperArtifactDirectoryIdentities(
  root: DiskNode,
  readDirectoryStat: ArtifactDirectoryStatReader = (targetPath) => lstat(targetPath, { bigint: true }),
  platformName: NodeJS.Platform = process.platform,
  expectedRootPath?: string,
  expectedInventoryMaxItems?: number,
): Promise<DiskNode> {
  // Validation deliberately precedes the first candidate lookup. A malformed
  // sidecar payload must fail here rather than causing desktop lstat calls on
  // an attacker-chosen absolute path.
  normalizeNativeInventoryRoot(root, expectedRootPath, expectedInventoryMaxItems)
  const inventory = root.developerArtifactInventory
  if (!inventory) return root
  const items = inventory.items.filter((item) => !isDeveloperArtifactDirectoryIdentity(item.directoryIdentity))
  if (items.length === 0) return reconcileDeveloperArtifactIdentityStatus(root)

  let cursor = 0
  const workers = Array.from({ length: Math.min(ARTIFACT_IDENTITY_HYDRATION_CONCURRENCY, items.length) }, async () => {
    while (true) {
      const index = cursor++
      const item = items[index]
      if (!item) return
      try {
        const info = await readDirectoryStat(item.path)
        const modifiedAt = Math.floor(Number(info.mtimeMs))
        if (
          !info.isDirectory() ||
          info.isSymbolicLink() ||
          info.dev <= 0n ||
          info.ino <= 0n ||
          !Number.isSafeInteger(modifiedAt) ||
          modifiedAt < 0
        ) {
          continue
        }
        item.directoryIdentity = {
          platform: identityPlatform(platformName),
          device: info.dev.toString(),
          fileId: info.ino.toString(),
          modifiedAt,
        }
      } catch {
        // The scan is still useful, but this candidate cannot carry a stale
        // precondition if it changed or became inaccessible while hydrating.
      }
    }
  })
  await Promise.all(workers)
  return reconcileDeveloperArtifactIdentityStatus(root)
}

function normalizeNativeScanProgress(value: unknown, expectedRootPath?: string): ScanProgress | undefined {
  if (
    !isRecord(value) ||
    !isNonNegativeSafeInteger(value.filesScanned) ||
    !isNonNegativeSafeInteger(value.dirsScanned) ||
    typeof value.currentPath !== "string" ||
    !isNonNegativeNumber(value.size) ||
    (value.percent !== undefined && (!isNonNegativeNumber(value.percent) || value.percent > 100)) ||
    (value.done !== undefined && typeof value.done !== "boolean")
  ) {
    return undefined
  }

  const scope = expectedRootPath === undefined ? undefined : nativePathScope(expectedRootPath)
  const currentPath = scope ? normalizeScopedNativePath(value.currentPath, scope) : value.currentPath
  if (currentPath === undefined) return undefined

  let discovery: ScanProgress["discovery"]
  if (value.discovery !== undefined) {
    if (
      !isRecord(value.discovery) ||
      !isSafeCompactDisplayName(value.discovery.name) ||
      typeof value.discovery.path !== "string" ||
      !isNonNegativeNumber(value.discovery.size) ||
      (value.discovery.modifiedAt !== undefined && !isNonNegativeNumber(value.discovery.modifiedAt)) ||
      typeof value.discovery.isDir !== "boolean"
    ) {
      return undefined
    }
    const discoveryPath = scope ? normalizeScopedNativePath(value.discovery.path, scope) : value.discovery.path
    if (discoveryPath === undefined) return undefined
    discovery = {
      name: value.discovery.name,
      path: discoveryPath,
      size: value.discovery.size,
      ...(value.discovery.modifiedAt === undefined ? {} : { modifiedAt: value.discovery.modifiedAt }),
      isDir: value.discovery.isDir,
    }
  }

  return {
    ...(typeof value.percent === "number" ? { percent: value.percent } : {}),
    filesScanned: value.filesScanned,
    dirsScanned: value.dirsScanned,
    currentPath,
    size: value.size,
    ...(discovery === undefined ? {} : { discovery }),
    ...(value.done === undefined ? {} : { done: value.done }),
  }
}

function matchesExpectedNativeRoot(scope: NativePathScope, expectedRootPath: string | undefined): boolean {
  if (expectedRootPath === undefined) return true
  const expected = nativePathScope(expectedRootPath)
  return !!expected && expected.windows === scope.windows && pathEquals(scope.root, expected.root)
}

export function parseNativeMessage(line: string, validation: NativeDoneValidation = {}): NativeMessage | undefined {
  if (Buffer.byteLength(line, "utf8") > MAX_NATIVE_PROTOCOL_LINE_BYTES) return undefined
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return undefined
  }
  if (!isRecord(value) || typeof value.type !== "string") return undefined
  if (value.type === "error" && typeof value.message === "string") {
    return { type: "error", message: value.message }
  }
  if (value.type === "done" && isDiskNode(value.root)) {
    if (validation.requireDeclaredRootPath) return undefined
    return { type: "done", root: value.root }
  }
  if (value.type === "done" && value.protocol === 2 && typeof value.rootPath === "string" && isRecord(value.root)) {
    try {
      const scope = nativePathScope(value.rootPath)
      if (!scope || !matchesExpectedNativeRoot(scope, validation.expectedRootPath) || !isCompactNode(value.root))
        return undefined
      const hasInventory = value.root.i !== undefined
      if (validation.inventoryEnabled !== undefined && validation.inventoryEnabled !== hasInventory) return undefined
      const inventory = hasInventory
        ? normalizeNativeDeveloperArtifactInventory(value.root.i, scope, validation.expectedInventoryMaxItems)
        : undefined
      if (hasInventory && !inventory) return undefined
      const compact = inventory === undefined ? value.root : { ...value.root, i: inventory }
      if (!hasScopedCompactTreePaths(scope, compact)) return undefined
      return {
        type: "done",
        root: hydrateScopedCompactTree(scope, compact),
        declaredRootPath: scope.root,
      }
    } catch {
      return undefined
    }
  }
  if (value.type === "progress") {
    const progress = normalizeNativeScanProgress(value.progress, validation.expectedRootPath)
    if (progress) return { type: "progress", progress }
  }
  return undefined
}
