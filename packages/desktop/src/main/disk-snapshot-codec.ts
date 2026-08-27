import { createReadStream } from "node:fs"
import { open } from "node:fs/promises"
import path from "node:path"
import { StringDecoder } from "node:string_decoder"
import {
  MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS,
  normalizeDeveloperArtifactInventoryOptions,
} from "../../../disklizard/src/developer-artifacts"
import type { DiskNode, ScanOptions } from "../../../disklizard/src/types"
import { MAX_MATERIALIZED_DISK_TREE_NODES } from "./disk-tree-budget"

// v8 replaces the monolithic V8 blob with bounded records so persistence,
// parsing, and validation can yield to Electron's main event loop.
const SNAPSHOT_SCHEMA = 8
const SNAPSHOT_FORMAT = 1
const SNAPSHOT_WRITE_BATCH_BYTES = 256 * 1024
const MAX_SNAPSHOT_RECORD_BYTES = 256 * 1024
const SNAPSHOT_YIELD_INTERVAL = 256

export type DiskSnapshotMetadata = {
  schema: number
  rootPath: string
  optionsHash: string
  savedAt: number
  checkpoint: string
  tree: string
}

type MetadataInput = Omit<DiskSnapshotMetadata, "schema">

function comparable(value: string) {
  return path.resolve(value)
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function isAncestor(parent: string, child: string) {
  return parent !== child && isWithin(parent, child)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function comparableAbsolutePath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || !path.isAbsolute(value)) {
    return undefined
  }
  try {
    return comparable(value)
  } catch {
    return undefined
  }
}

function isScopedPath(value: unknown, rootPath: string) {
  const candidate = comparableAbsolutePath(value)
  return candidate !== undefined && isWithin(rootPath, candidate)
}

function isScopedPathArray(value: unknown, rootPath: string) {
  return isStringArray(value) && value.every((entry) => isScopedPath(entry, rootPath))
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
    isNonNegativeSafeInteger(value.modifiedAt)
  )
}

function isCloneEvidence(value: unknown): boolean {
  if (!isRecord(value) || typeof value.state !== "string") return false
  if (value.state === "unavailable") {
    return value.reason === "platform" || value.reason === "filesystem" || value.reason === "scanner"
  }
  if (value.state === "unknown" || value.state === "not-shared") return true
  if (value.state === "may-share-blocks") return value.cloneId === undefined || typeof value.cloneId === "string"
  if (value.state === "shares-all-blocks") {
    return (
      (value.cloneId === undefined || typeof value.cloneId === "string") &&
      (value.reportedFullCloneCount === undefined ||
        (isNonNegativeInteger(value.reportedFullCloneCount) && value.reportedFullCloneCount > 0))
    )
  }
  return false
}

function isCompleteCloneEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.state === "shares-all-blocks" &&
    typeof value.cloneId === "string" &&
    value.cloneId.length > 0 &&
    isNonNegativeInteger(value.reportedFullCloneCount) &&
    value.reportedFullCloneCount > 1
  )
}

function isCloneMetadataCapability(value: unknown): boolean {
  if (!isRecord(value) || typeof value.state !== "string") return false
  if (value.state === "available" || value.state === "unknown") return true
  return (
    value.state === "unavailable" &&
    (value.reason === "platform" || value.reason === "filesystem" || value.reason === "scanner")
  )
}

function isDeveloperArtifact(value: unknown, rootPath: string): boolean {
  if (!isRecord(value)) return false
  return (
    typeof value.name === "string" &&
    isScopedPath(value.path, rootPath) &&
    isNonNegativeInteger(value.size) &&
    (value.logicalSize === undefined || isNonNegativeInteger(value.logicalSize)) &&
    (value.modifiedAt === undefined || isNonNegativeFiniteNumber(value.modifiedAt)) &&
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

function yieldToMainEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

async function isDeveloperArtifactInventory(value: unknown, rootPath: string, expectedMaxItems: number) {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.status)) return false
  const status = value.status
  if (
    (status.state !== "complete" && status.state !== "partial") ||
    !isNonNegativeSafeInteger(status.maxItems) ||
    status.maxItems < 1 ||
    status.maxItems > MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS ||
    status.maxItems !== expectedMaxItems ||
    value.items.length > status.maxItems ||
    !isNonNegativeInteger(status.scannedDirectories) ||
    !isNonNegativeInteger(status.matchedDirectories) ||
    status.scannedDirectories < status.matchedDirectories ||
    status.matchedDirectories < value.items.length ||
    (!status.truncated && status.matchedDirectories !== value.items.length) ||
    (status.truncated && status.matchedDirectories <= value.items.length) ||
    typeof status.truncated !== "boolean" ||
    !isNonNegativeInteger(status.unreadableCount) ||
    !isScopedPathArray(status.unreadableSamplePaths, rootPath) ||
    !isNonNegativeInteger(status.skippedSymlinkCount) ||
    !isScopedPathArray(status.skippedSymlinkSamplePaths, rootPath) ||
    (status.skippedDirectoryCount !== undefined && !isNonNegativeInteger(status.skippedDirectoryCount)) ||
    (status.skippedDirectorySamplePaths !== undefined &&
      !isScopedPathArray(status.skippedDirectorySamplePaths, rootPath)) ||
    (status.unavailableDirectoryIdentityCount !== undefined &&
      !isNonNegativeInteger(status.unavailableDirectoryIdentityCount)) ||
    (status.unavailableDirectoryIdentitySamplePaths !== undefined &&
      !isScopedPathArray(status.unavailableDirectoryIdentitySamplePaths, rootPath)) ||
    !isNonNegativeInteger(status.excludedCount) ||
    !isScopedPathArray(status.excludedSamplePaths, rootPath)
  ) {
    return false
  }
  for (let index = 0; index < value.items.length; index++) {
    if (!isDeveloperArtifact(value.items[index], rootPath)) return false
    if ((index + 1) % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
  }
  const mustBePartial =
    status.truncated ||
    status.unreadableCount > 0 ||
    status.skippedSymlinkCount > 0 ||
    (status.skippedDirectoryCount ?? 0) > 0 ||
    (status.unavailableDirectoryIdentityCount ?? 0) > 0 ||
    status.excludedCount > 0
  return !mustBePartial || status.state === "partial"
}

function isScanIssueSummary(value: unknown, rootPath: string): boolean {
  return (
    isRecord(value) && isNonNegativeSafeInteger(value.unreadableCount) && isScopedPathArray(value.samplePaths, rootPath)
  )
}

/** Validate a decoded cache tree cooperatively without trusting its object shape. */
async function isCachedDiskTree(value: unknown, rootPath: string, options: ScanOptions) {
  const normalizedRoot = comparable(rootPath)
  const expectedInventory = normalizeDeveloperArtifactInventoryOptions(options.developerArtifactInventory)
  if (!isRecord(value)) return false

  type PendingNode = { value: unknown; parentPath?: string; isRoot: boolean }
  const pending: PendingNode[] = [{ value, isRoot: true }]
  const seenNodes = new WeakSet<object>()
  const seenPaths = new Set<string>()
  let visited = 0

  try {
    while (pending.length > 0) {
      const current = pending.pop()!
      if (!isRecord(current.value) || seenNodes.has(current.value)) return false
      seenNodes.add(current.value)
      if (++visited > MAX_MATERIALIZED_DISK_TREE_NODES) return false
      if (visited % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()

      const node = current.value
      const nodePath = comparableAbsolutePath(node.path)
      if (!nodePath || !isWithin(normalizedRoot, nodePath) || seenPaths.has(nodePath)) return false
      if (current.isRoot) {
        if (nodePath !== normalizedRoot) return false
      } else if (!current.parentPath || !isAncestor(current.parentPath, nodePath)) {
        return false
      }
      seenPaths.add(nodePath)

      if (
        typeof node.name !== "string" ||
        !isNonNegativeInteger(node.size) ||
        (node.logicalSize !== undefined && !isNonNegativeInteger(node.logicalSize)) ||
        (node.modifiedAt !== undefined && !isNonNegativeFiniteNumber(node.modifiedAt)) ||
        (node.hardLink !== undefined && node.hardLink !== "primary" && node.hardLink !== "secondary") ||
        (node.clone !== undefined && !isCloneEvidence(node.clone)) ||
        (node.cloneAccounting !== undefined &&
          ((node.cloneAccounting !== "primary" && node.cloneAccounting !== "secondary") ||
            !isCompleteCloneEvidence(node.clone))) ||
        typeof node.isDir !== "boolean" ||
        !Array.isArray(node.children) ||
        (!node.isDir && node.children.length > 0) ||
        typeof node.ext !== "string" ||
        (node.isOther !== undefined && typeof node.isOther !== "boolean") ||
        (node.isOther === true && !node.isDir) ||
        (node.otherCount !== undefined &&
          (node.isOther !== true ||
            !isNonNegativeSafeInteger(node.otherCount) ||
            node.otherCount < 1 ||
            (Array.isArray(node.children) && node.otherCount < node.children.length))) ||
        (node.isHidden !== undefined && typeof node.isHidden !== "boolean") ||
        (node.isCollapsed !== undefined && (typeof node.isCollapsed !== "boolean" || !node.isDir)) ||
        (node.signatures !== undefined && !isStringArray(node.signatures)) ||
        (node.scanIssues !== undefined && !isScanIssueSummary(node.scanIssues, normalizedRoot)) ||
        (node._label !== undefined && typeof node._label !== "string")
      ) {
        return false
      }

      if (current.isRoot) {
        if (
          (node.cloneMetadata !== undefined && !isCloneMetadataCapability(node.cloneMetadata)) ||
          (node.sharedStorageEvidence !== undefined &&
            node.sharedStorageEvidence !== "complete" &&
            node.sharedStorageEvidence !== "partial") ||
          (node.developerArtifactInventory !== undefined &&
            !(await isDeveloperArtifactInventory(
              node.developerArtifactInventory,
              normalizedRoot,
              expectedInventory?.maxItems ?? 0,
            ))) ||
          (expectedInventory !== undefined) !== (node.developerArtifactInventory !== undefined)
        ) {
          return false
        }
      } else if (
        node.cloneMetadata !== undefined ||
        node.sharedStorageEvidence !== undefined ||
        node.developerArtifactInventory !== undefined
      ) {
        return false
      }

      // `Other` has a synthetic path; its materialized children remain real
      // descendants of the aggregate's parent.
      const childParentPath = node.isOther === true ? current.parentPath : nodePath
      for (let index = 0; index < node.children.length; index++) {
        pending.push({
          value: node.children[index]!,
          parentPath: childParentPath,
          isRoot: false,
        })
        if ((index + 1) % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
      }
      if (pending.length > MAX_MATERIALIZED_DISK_TREE_NODES) return false
    }
  } catch {
    return false
  }
  return true
}

function isSnapshotMetadata(value: unknown): value is DiskSnapshotMetadata {
  return (
    isRecord(value) &&
    value.schema === SNAPSHOT_SCHEMA &&
    typeof value.rootPath === "string" &&
    typeof value.optionsHash === "string" &&
    /^[0-9a-f]{32}$/.test(value.optionsHash) &&
    isNonNegativeSafeInteger(value.savedAt) &&
    typeof value.checkpoint === "string" &&
    typeof value.tree === "string"
  )
}

export function encodeDiskSnapshotMetadata(metadata: MetadataInput) {
  return JSON.stringify({ schema: SNAPSHOT_SCHEMA, ...metadata } satisfies DiskSnapshotMetadata)
}

export function decodeDiskSnapshotMetadata(
  serialized: string,
  expected: Pick<DiskSnapshotMetadata, "rootPath" | "optionsHash">,
): DiskSnapshotMetadata | undefined {
  try {
    const metadata = JSON.parse(serialized) as unknown
    return isSnapshotMetadata(metadata) &&
      metadata.rootPath === expected.rootPath &&
      metadata.optionsHash === expected.optionsHash
      ? metadata
      : undefined
  } catch {
    return undefined
  }
}

export async function encodeDiskSnapshotTree(targetPath: string, root: DiskNode) {
  const file = await open(targetPath, "wx")
  let batch: string[] = []
  let batchBytes = 0
  const flush = async () => {
    if (!batch.length) return
    const bytes = Buffer.from(batch.join(""))
    let offset = 0
    while (offset < bytes.length) {
      const written = await file.write(bytes, offset, bytes.length - offset)
      if (written.bytesWritten === 0) throw new Error("Snapshot cache write made no progress")
      offset += written.bytesWritten
    }
    batch = []
    batchBytes = 0
  }
  const append = async (record: Record<string, unknown>) => {
    const line = `${JSON.stringify(record)}\n`
    const bytes = Buffer.byteLength(line)
    if (bytes > MAX_SNAPSHOT_RECORD_BYTES) throw new Error("Snapshot record exceeds the cache format limit")
    if (batchBytes + bytes > SNAPSHOT_WRITE_BATCH_BYTES) await flush()
    batch.push(line)
    batchBytes += bytes
  }

  try {
    await append({ type: "disklizard-tree", format: SNAPSHOT_FORMAT })
    const pending: Array<{ node: DiskNode; parent: number | null }> = [{ node: root, parent: null }]
    const seen = new WeakSet<object>()
    let nodeCount = 0
    while (pending.length > 0) {
      const { node, parent } = pending.pop()!
      if (seen.has(node)) throw new Error("Snapshot tree contains a cycle or shared node")
      seen.add(node)
      if (++nodeCount > MAX_MATERIALIZED_DISK_TREE_NODES) throw new Error("Snapshot tree exceeds the node limit")
      const { children, developerArtifactInventory, ...data } = node
      if (node !== root && developerArtifactInventory !== undefined) {
        throw new Error("Snapshot inventory is only valid on the root node")
      }
      await append({ type: "node", parent, node: data })
      for (let index = children.length - 1; index >= 0; index--) {
        pending.push({ node: children[index]!, parent: nodeCount - 1 })
        if ((children.length - index) % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
      }
      if (nodeCount % SNAPSHOT_YIELD_INTERVAL === 0) {
        await flush()
        await yieldToMainEventLoop()
      }
    }

    const inventory = root.developerArtifactInventory
    if (inventory) {
      await append({ type: "inventory", status: inventory.status })
      for (let index = 0; index < inventory.items.length; index++) {
        await append({ type: "inventory-item", item: inventory.items[index] })
        if ((index + 1) % SNAPSHOT_YIELD_INTERVAL === 0) {
          await flush()
          await yieldToMainEventLoop()
        }
      }
    }
    await append({
      type: "end",
      nodes: nodeCount,
      inventoryItems: inventory?.items.length ?? 0,
    })
    await flush()
  } finally {
    await file.close()
  }
}

async function readDiskSnapshotTree(targetPath: string): Promise<DiskNode> {
  const decoder = new StringDecoder("utf8")
  const nodes: DiskNode[] = []
  const inventoryItems: unknown[] = []
  let inventoryStatus: unknown
  let pending = ""
  let records = 0
  let sawHeader = false
  let sawEnd = false
  let nodeSectionEnded = false

  const consume = async (line: string) => {
    if (Buffer.byteLength(line) > MAX_SNAPSHOT_RECORD_BYTES) {
      throw new Error("Snapshot record exceeds the cache format limit")
    }
    const record = JSON.parse(line) as unknown
    if (!isRecord(record) || typeof record.type !== "string" || sawEnd) throw new Error("Invalid snapshot record")
    if (!sawHeader) {
      if (record.type !== "disklizard-tree" || record.format !== SNAPSHOT_FORMAT) {
        throw new Error("Unsupported snapshot format")
      }
      sawHeader = true
      return
    }

    if (record.type === "node") {
      if (
        nodeSectionEnded ||
        !isRecord(record.node) ||
        "children" in record.node ||
        "developerArtifactInventory" in record.node
      ) {
        throw new Error("Invalid snapshot node record")
      }
      const parent = record.parent
      if (
        (nodes.length === 0 && parent !== null) ||
        (nodes.length > 0 && (!isNonNegativeSafeInteger(parent) || parent >= nodes.length)) ||
        nodes.length >= MAX_MATERIALIZED_DISK_TREE_NODES
      ) {
        throw new Error("Invalid snapshot parent index")
      }
      const node = { ...record.node, children: [] } as unknown as DiskNode
      if (nodes.length > 0) nodes[parent as number]!.children.push(node)
      nodes.push(node)
    } else if (record.type === "inventory") {
      if (nodes.length === 0 || inventoryStatus !== undefined || !isRecord(record.status)) {
        throw new Error("Invalid snapshot inventory record")
      }
      nodeSectionEnded = true
      inventoryStatus = record.status
    } else if (record.type === "inventory-item") {
      if (inventoryStatus === undefined || inventoryItems.length >= MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS) {
        throw new Error("Invalid snapshot inventory item")
      }
      inventoryItems.push(record.item)
    } else if (record.type === "end") {
      if (
        nodes.length === 0 ||
        !isNonNegativeSafeInteger(record.nodes) ||
        record.nodes !== nodes.length ||
        !isNonNegativeSafeInteger(record.inventoryItems) ||
        record.inventoryItems !== inventoryItems.length
      ) {
        throw new Error("Invalid snapshot footer")
      }
      sawEnd = true
    } else {
      throw new Error("Unknown snapshot record")
    }

    if (++records % SNAPSHOT_YIELD_INTERVAL === 0) await yieldToMainEventLoop()
  }

  for await (const chunk of createReadStream(targetPath, { highWaterMark: 64 * 1024 })) {
    pending += decoder.write(chunk as Buffer)
    let newline = pending.indexOf("\n")
    while (newline !== -1) {
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (!line) throw new Error("Empty snapshot record")
      await consume(line)
      newline = pending.indexOf("\n")
    }
    if (Buffer.byteLength(pending) > MAX_SNAPSHOT_RECORD_BYTES) {
      throw new Error("Snapshot record exceeds the cache format limit")
    }
  }
  pending += decoder.end()
  if (pending) await consume(pending)
  if (!sawHeader || !sawEnd || nodes.length === 0) throw new Error("Incomplete snapshot")

  const root = nodes[0]!
  if (inventoryStatus !== undefined) {
    root.developerArtifactInventory = {
      status: inventoryStatus,
      items: inventoryItems,
    } as DiskNode["developerArtifactInventory"]
  }
  return root
}

export async function decodeDiskSnapshotTree(
  targetPath: string,
  expected: { rootPath: string; options: ScanOptions; rootIsDirectory: boolean },
): Promise<DiskNode | undefined> {
  const root = await readDiskSnapshotTree(targetPath)
  if (!(await isCachedDiskTree(root, expected.rootPath, expected.options))) return undefined
  return root.isDir === expected.rootIsDirectory ? root : undefined
}
