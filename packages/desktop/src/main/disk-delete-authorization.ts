import { randomUUID } from "node:crypto"
import { lstat } from "node:fs/promises"
import { normalize } from "node:path"
import type { DiskNode } from "./disk-scanner"
import { MAX_MATERIALIZED_DISK_TREE_NODES } from "./disk-tree-budget"

// A generous ceiling still bounds the review burst; real cleanups routinely
// exceed the previous hidden 256 limit.
const MAX_DELETE_AUTHORIZATIONS = 4096
const DELETE_AUTHORIZATION_TTL_MS = 5 * 60_000
const DELETE_AUTHORIZATION_STAT_CONCURRENCY = 16
const MAX_RETAINED_TRUSTED_SUBTREES = 64

export const INVALID_DELETE_AUTHORIZATION_ERROR =
  "Delete authorization expired or the item changed — review it again before moving it to Trash."
export const UNSCANNED_DELETE_TARGET_ERROR = "Item is not part of an active scan — rescan before moving it to Trash."

/** Per-item outcome appended to an authorization result; absent `error` means authorized. */
export type DeleteAuthorizationOutcome = {
  path: string
  authorization?: string
  error?: string
}

type FileIdentity = {
  device: string
  fileID: string
  modifiedAt: number
  size: string
  kind: "directory" | "file"
}

type ScanRoot = {
  senderID: number
  root: DiskNode
}

type RetainedScanRoot = {
  scan: ScanRoot
  parentOwner: string
  parentScan: ScanRoot
  nodeCount: number
}

type Authorization = FileIdentity & {
  senderID: number
  owner: string
  scan: ScanRoot
  path: string
  expiresAt: number
}

async function readIdentity(path: string): Promise<FileIdentity> {
  try {
    const info = await lstat(path, { bigint: true })
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
      throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
    }
    const modifiedAt = Math.floor(Number(info.mtimeMs))
    if (info.dev <= 0n || info.ino <= 0n || !Number.isSafeInteger(modifiedAt)) {
      throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
    }
    return {
      device: info.dev.toString(),
      fileID: info.ino.toString(),
      modifiedAt,
      size: info.size.toString(),
      kind: info.isDirectory() ? "directory" : "file",
    }
  } catch (error) {
    if (error instanceof Error && error.message === INVALID_DELETE_AUTHORIZATION_ERROR) throw error
    throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
  }
}

function sameIdentity(left: FileIdentity, right: FileIdentity) {
  return (
    left.device === right.device &&
    left.fileID === right.fileID &&
    left.modifiedAt === right.modifiedAt &&
    left.size === right.size &&
    left.kind === right.kind
  )
}

type ResolvedOwner = {
  owner: string
  scan: ScanRoot
}

function resolveOwners(
  roots: Iterable<readonly [string, ScanRoot]>,
  senderID: number,
  targetPaths: ReadonlySet<string>,
) {
  const comparableTargets = new Set([...targetPaths].map(comparableScanPath))
  const unresolved = comparableTargets
  const resolved = new Map<string, ResolvedOwner>()
  for (const [owner, scan] of roots) {
    if (scan.senderID !== senderID) continue
    const stack = [scan.root]
    while (stack.length > 0 && unresolved.size > 0) {
      const node = stack.pop()!
      if (!node.isOther && unresolved.delete(comparableScanPath(node.path)))
        resolved.set(node.path, { owner, scan })
      // Avoid a spread call here: a single very wide directory can contain
      // more children than the JavaScript argument limit.
      for (let index = 0; index < node.children.length; index += 1) {
        stack.push(node.children[index]!)
      }
    }
    for (const item of scan.root.developerArtifactInventory?.items ?? []) {
      if (unresolved.delete(comparableScanPath(item.path))) resolved.set(item.path, { owner, scan })
    }
    if (unresolved.size === 0) break
  }
  return resolved
}

function containsMaterializedPath(root: DiskNode, targetPath: string) {
  const target = comparableScanPath(targetPath)
  const stack = [root]
  let visited = 0
  while (stack.length > 0) {
    const node = stack.pop()!
    if (++visited > MAX_MATERIALIZED_DISK_TREE_NODES) return false
    if (!node.isOther && comparableScanPath(node.path) === target) return true
    for (let index = 0; index < node.children.length; index += 1) stack.push(node.children[index]!)
  }
  return false
}

function materializedNodeCount(root: DiskNode) {
  const stack = [root]
  let count = 0
  while (stack.length > 0) {
    const node = stack.pop()!
    if (++count > MAX_MATERIALIZED_DISK_TREE_NODES) return undefined
    for (let index = 0; index < node.children.length; index += 1) stack.push(node.children[index]!)
  }
  return count
}

function comparableScanPath(value: string) {
  const normalized = normalize(value)
  // Windows and the default APFS layout are case-insensitive; comparing
  // raw byte paths there rejects items that differ only in letter case.
  return process.platform === "win32" || process.platform === "darwin"
    ? normalized.toLowerCase()
    : normalized
}

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input) => Promise<Output>,
) {
  const results = new Array<Output>(inputs.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (cursor < inputs.length) {
      const index = cursor
      cursor += 1
      results[index] = await operation(inputs[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

export class DiskDeleteAuthorizationManager {
  private readonly roots = new Map<string, ScanRoot>()
  private readonly retainedRoots = new Map<string, RetainedScanRoot>()
  private readonly authorizations = new Map<string, Authorization>()
  private retainedNodeCount = 0

  updateRoot(owner: string, senderID: number, root: DiskNode) {
    this.removeRetainedBranch(owner)
    this.roots.set(owner, { senderID, root })
    this.removeAuthorizations(owner)
  }

  removeOwner(owner: string) {
    this.roots.delete(owner)
    this.removeRetainedBranch(owner)
  }

  /**
   * Stop-time handoff for a main-produced focused scan. The renderer supplies
   * neither tree: retain the focused authority only when an exact path is
   * materialized in another trusted root owned by the same sender.
   */
  retainOwnerAsTrustedSubtree(owner: string) {
    const source = this.roots.get(owner)
    if (!source) return false
    const nodeCount = materializedNodeCount(source.root)
    if (nodeCount === undefined) {
      this.removeOwner(owner)
      return false
    }

    // A newer focused result for the same path supersedes every older
    // generation and anything whose trust was derived from it. Otherwise a
    // path removed from the renderer's latest tree could remain deletable via
    // an older retained expansion.
    const sourcePath = comparableScanPath(source.root.path)
    for (const [retainedOwner, retained] of [...this.retainedRoots]) {
      if (
        retained.scan.senderID === source.senderID &&
        comparableScanPath(retained.scan.root.path) === sourcePath
      ) {
        this.removeRetainedBranch(retainedOwner)
      }
    }

    let parent: { owner: string; scan: ScanRoot } | undefined
    for (const [candidateOwner, candidate] of this.authorityRoots()) {
      if (
        candidateOwner === owner ||
        candidate.senderID !== source.senderID ||
        !containsMaterializedPath(candidate.root, source.root.path)
      ) {
        continue
      }
      if (!parent || candidate.root.path.length > parent.scan.root.path.length) {
        parent = { owner: candidateOwner, scan: candidate }
      }
    }
    if (!parent) {
      this.removeOwner(owner)
      return false
    }

    this.roots.delete(owner)
    this.removeRetainedBranch(owner)
    while (
      this.retainedRoots.size >= MAX_RETAINED_TRUSTED_SUBTREES ||
      this.retainedNodeCount + nodeCount > MAX_MATERIALIZED_DISK_TREE_NODES
    ) {
      const oldest = this.retainedRoots.keys().next().value
      if (typeof oldest !== "string") break
      this.removeRetainedBranch(oldest)
    }
    this.retainedRoots.set(owner, {
      scan: source,
      parentOwner: parent.owner,
      parentScan: parent.scan,
      nodeCount,
    })
    this.retainedNodeCount += nodeCount
    return true
  }

  clear() {
    this.roots.clear()
    this.retainedRoots.clear()
    this.retainedNodeCount = 0
    this.authorizations.clear()
  }

  private removeRetainedRoot(owner: string) {
    const retained = this.retainedRoots.get(owner)
    if (!retained) return
    this.retainedRoots.delete(owner)
    this.retainedNodeCount -= retained.nodeCount
    this.removeAuthorizations(owner)
  }

  private removeRetainedBranch(owner: string) {
    for (const [childOwner, retained] of [...this.retainedRoots]) {
      if (retained.parentOwner === owner) this.removeRetainedBranch(childOwner)
    }
    this.removeRetainedRoot(owner)
  }

  private isCurrentAuthority(owner: string, scan: ScanRoot, visited = new Set<string>()): boolean {
    if (this.roots.get(owner) === scan) return true
    if (visited.has(owner)) return false
    visited.add(owner)
    const retained = this.retainedRoots.get(owner)
    return (
      retained?.scan === scan &&
      this.isCurrentAuthority(retained.parentOwner, retained.parentScan, visited)
    )
  }

  private authorityRoots(): Map<string, ScanRoot> {
    const roots = new Map(this.roots)
    for (const [owner, retained] of this.retainedRoots) {
      if (this.isCurrentAuthority(owner, retained.scan)) roots.set(owner, retained.scan)
    }
    return roots
  }

  private removeAuthorizations(owner: string) {
    for (const [token, authorization] of this.authorizations) {
      if (authorization.owner === owner) this.authorizations.delete(token)
    }
  }

  async authorize(
    senderID: number,
    paths: readonly string[],
    assertSafe: (targetPath: string) => Promise<void>,
  ): Promise<DeleteAuthorizationOutcome[]> {
    if (!Array.isArray(paths)) throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
    const unique = [...new Set(paths)]
    if (unique.length === 0 || unique.length > MAX_DELETE_AUTHORIZATIONS) {
      throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
    }
    for (const path of unique) {
      if (typeof path !== "string" || path.length === 0) throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
    }

    const targets = new Set(unique)
    // Resolve per item: one unscanned or changed row must not sink the whole
    // batch — the renderer surfaces the outcome next to each item instead.
    const owners = resolveOwners(this.authorityRoots(), senderID, targets)
    const unresolved = unique.filter((path) => !owners.has(path))
    const resolved = unique.filter((path) => owners.has(path))

    // Bounded concurrency keeps a large review responsive without creating an
    // equally large burst of filesystem work.
    const identities = await mapWithConcurrency(resolved, DELETE_AUTHORIZATION_STAT_CONCURRENCY, async (path) => {
      try {
        await assertSafe(path)
        return { identity: await readIdentity(path), error: undefined as string | undefined }
      } catch (error) {
        return {
          identity: undefined,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    const outcomes = new Map<string, DeleteAuthorizationOutcome>()
    for (const path of unresolved) {
      outcomes.set(path, { path, error: UNSCANNED_DELETE_TARGET_ERROR })
    }

    const publishable: Array<{ path: string; index: number }> = []
    resolved.forEach((path, index) => {
      const checked = identities[index]!
      if (checked.error || !checked.identity) {
        outcomes.set(path, { path, error: checked.error ?? INVALID_DELETE_AUTHORIZATION_ERROR })
        return
      }
      const owner = owners.get(path)!
      if (!this.isCurrentAuthority(owner.owner, owner.scan)) {
        outcomes.set(path, { path, error: UNSCANNED_DELETE_TARGET_ERROR })
        return
      }
      publishable.push({ path, index })
    })

    // A watcher can replace a scan root while the filesystem checks yield.
    // Bind the capabilities to the exact root object that was reviewed. The
    // sender check runs once for the batch: every published capability is
    // bound to a root already filtered to this sender by `resolveOwners`.
    const expiresAt = Date.now() + DELETE_AUTHORIZATION_TTL_MS
    for (const { path, index } of publishable) {
      const owner = owners.get(path)!
      if (owner.scan.senderID !== senderID || !targets.has(path)) continue
      const authorization = randomUUID()
      this.authorizations.set(authorization, {
        ...identities[index]!.identity!,
        senderID,
        owner: owner.owner,
        scan: owner.scan,
        path,
        expiresAt,
      })
      outcomes.set(path, { path, authorization })
    }
    // Keep the historical contract when nothing survived: a caller that
    // authorized a single item still gets a rejection, while a genuinely
    // mixed batch surfaces per-item outcomes additively.
    const results = unique.map((path) => outcomes.get(path)!)
    if (results.every((outcome) => outcome.error)) {
      throw new Error(results[0]!.error ?? UNSCANNED_DELETE_TARGET_ERROR)
    }
    return results
  }

  async consume(senderID: number, path: string, token: unknown) {
    if (typeof token !== "string") throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
    const authorization = this.authorizations.get(token)
    this.authorizations.delete(token)
    if (
      !authorization ||
      authorization.senderID !== senderID ||
      authorization.path !== path ||
      authorization.expiresAt < Date.now() ||
      !this.isCurrentAuthority(authorization.owner, authorization.scan)
    ) {
      throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
    }
    // Sliding renewal: a slow, large cleanup consumes tokens one at a time;
    // each confirmed use extends the window so mid-batch expiry cannot strand
    // tokens that were reviewed together.
    authorization.expiresAt = Date.now() + DELETE_AUTHORIZATION_TTL_MS

    // Return a one-shot final guard so IPC can run all other safety and
    // artifact checks first, then revalidate at the closest possible point to
    // `shell.trashItem`. No filesystem identity checked only at review time is
    // trusted for the eventual operation.
    let validated = false
    return async () => {
      if (
        validated ||
        authorization.expiresAt < Date.now() ||
        !this.isCurrentAuthority(authorization.owner, authorization.scan)
      ) {
        throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
      }
      validated = true
      const identity = await readIdentity(path)
      if (!sameIdentity(identity, authorization) || !this.isCurrentAuthority(authorization.owner, authorization.scan)) {
        throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
      }
    }
  }
}
