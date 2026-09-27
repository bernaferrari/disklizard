import { randomUUID } from "node:crypto"
import { lstat } from "../../../disklizard/src/physical-fs"
import type { DiskNode } from "./disk-scanner"
import { MAX_MATERIALIZED_DISK_TREE_NODES } from "./disk-tree-budget"

// A generous ceiling still bounds the review burst; real cleanups routinely
// exceed the previous hidden 256 limit.
const MAX_DELETE_AUTHORIZATIONS = 4096
const DELETE_AUTHORIZATION_TTL_MS = 5 * 60_000
const DELETE_AUTHORIZATION_STAT_CONCURRENCY = 16
const MAX_RETAINED_TRUSTED_SUBTREES = 64
const MAX_DELETE_AUTHORIZATIONS_PER_SENDER = 8192
const MAX_DELETE_AUTHORIZATIONS_GLOBAL = 16_384

export const INVALID_DELETE_AUTHORIZATION_ERROR =
  "Delete authorization expired or the item changed — review it again before moving it to Trash."
export const UNSCANNED_DELETE_TARGET_ERROR = "Item is not part of an active scan — rescan before moving it to Trash."

/** Per-item outcome appended to an authorization result; absent `error` means authorized. */
export type DeleteAuthorizationOutcome = {
  path: string
  authorization?: string
  error?: string
}

export type DiskDeleteFileIdentity = {
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

type Authorization = DiskDeleteFileIdentity & {
  senderID: number
  owner: string
  scan: ScanRoot
  groupID: string
  path: string
}

type AuthorizationGroup = {
  id: string
  senderID: number
  tokens: Set<string>
  expiresAt: number
  lastActivityAt: number
}

export type DiskDeleteAuthorizationManagerOptions = {
  now?: () => number
  readIdentity?: (path: string) => Promise<DiskDeleteFileIdentity>
  ttlMs?: number
  maxPerSender?: number
  maxGlobal?: number
}

async function readIdentity(path: string): Promise<DiskDeleteFileIdentity> {
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

function sameIdentity(left: DiskDeleteFileIdentity, right: DiskDeleteFileIdentity) {
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
  const requestedByKey = new Map([...targetPaths].map((path) => [authorizationPathKey(path), path]))
  const comparableTargets = new Set(requestedByKey.keys())
  const unresolved = comparableTargets
  const resolved = new Map<string, ResolvedOwner>()
  for (const [owner, scan] of roots) {
    if (scan.senderID !== senderID) continue
    const stack = [scan.root]
    while (stack.length > 0 && unresolved.size > 0) {
      const node = stack.pop()!
      const key = authorizationPathKey(node.path)
      if (!node.isOther && unresolved.delete(key)) resolved.set(requestedByKey.get(key)!, { owner, scan })
      // Avoid a spread call here: a single very wide directory can contain
      // more children than the JavaScript argument limit.
      for (let index = 0; index < node.children.length; index += 1) {
        stack.push(node.children[index]!)
      }
    }
    for (const item of scan.root.developerArtifactInventory?.items ?? []) {
      const key = authorizationPathKey(item.path)
      if (unresolved.delete(key)) resolved.set(requestedByKey.get(key)!, { owner, scan })
    }
    if (unresolved.size === 0) break
  }
  return resolved
}

function containsMaterializedPath(root: DiskNode, targetPath: string) {
  const target = authorizationPathKey(targetPath)
  const stack = [root]
  let visited = 0
  while (stack.length > 0) {
    const node = stack.pop()!
    if (++visited > MAX_MATERIALIZED_DISK_TREE_NODES) return false
    if (!node.isOther && authorizationPathKey(node.path) === target) return true
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

export function authorizationPathKey(value: string, _platform: NodeJS.Platform = process.platform) {
  // Capabilities bind to the exact scanner-issued string. Lexical
  // normalization is unsafe across symlink/junction components (`link/..`
  // need not resolve to the lexical parent), and case folding is unsafe in
  // case-sensitive APFS/NTFS directories.
  return value
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
  private readonly authorizationGroups = new Map<string, AuthorizationGroup>()
  private readonly now: () => number
  private readonly readIdentity: (path: string) => Promise<DiskDeleteFileIdentity>
  private readonly ttlMs: number
  private readonly maxPerSender: number
  private readonly maxGlobal: number
  private retainedNodeCount = 0

  constructor(options: DiskDeleteAuthorizationManagerOptions = {}) {
    this.now = options.now ?? Date.now
    this.readIdentity = options.readIdentity ?? readIdentity
    this.ttlMs = options.ttlMs ?? DELETE_AUTHORIZATION_TTL_MS
    this.maxPerSender = options.maxPerSender ?? MAX_DELETE_AUTHORIZATIONS_PER_SENDER
    this.maxGlobal = options.maxGlobal ?? MAX_DELETE_AUTHORIZATIONS_GLOBAL
    if (
      !Number.isSafeInteger(this.ttlMs) ||
      this.ttlMs <= 0 ||
      !Number.isSafeInteger(this.maxPerSender) ||
      this.maxPerSender <= 0 ||
      !Number.isSafeInteger(this.maxGlobal) ||
      this.maxGlobal <= 0
    ) {
      throw new TypeError("Invalid delete authorization limits")
    }
  }

  updateRoot(owner: string, senderID: number, root: DiskNode) {
    this.removeRetainedBranch(owner)
    this.roots.set(owner, { senderID, root })
    this.removeAuthorizations(owner)
  }

  removeOwner(owner: string) {
    this.roots.delete(owner)
    this.removeRetainedBranch(owner)
    this.removeAuthorizations(owner)
  }

  removeSender(senderID: number) {
    for (const [owner, root] of [...this.roots]) {
      if (root.senderID === senderID) this.removeOwner(owner)
    }
    for (const [owner, retained] of [...this.retainedRoots]) {
      if (retained.scan.senderID === senderID) this.removeRetainedBranch(owner)
    }
    for (const group of [...this.authorizationGroups.values()]) {
      if (group.senderID === senderID) this.removeAuthorizationGroup(group.id)
    }
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
    const sourcePath = authorizationPathKey(source.root.path)
    for (const [retainedOwner, retained] of [...this.retainedRoots]) {
      if (
        retained.scan.senderID === source.senderID &&
        authorizationPathKey(retained.scan.root.path) === sourcePath
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
    this.authorizationGroups.clear()
  }

  /**
   * Gate non-destructive filesystem integrations behind the same trusted,
   * main-produced scan inventory used by Trash authorization. This does not
   * grant a delete capability; it only proves that the renderer is referring
   * to an exact materialized path in one of its current scan generations.
   */
  assertTrustedPath(senderID: number, targetPath: unknown): string {
    if (typeof targetPath !== "string" || targetPath.length === 0 || targetPath.includes("\0")) {
      throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
    }
    const resolved = resolveOwners(this.authorityRoots(), senderID, new Set([targetPath]))
    if (!resolved.has(targetPath)) throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
    return targetPath
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
      if (authorization.owner === owner) this.removeAuthorizationToken(token)
    }
  }

  private removeAuthorizationToken(token: string) {
    const authorization = this.authorizations.get(token)
    if (!authorization) return
    this.authorizations.delete(token)
    const group = this.authorizationGroups.get(authorization.groupID)
    if (!group) return
    group.tokens.delete(token)
    if (group.tokens.size === 0) this.authorizationGroups.delete(group.id)
  }

  private removeAuthorizationGroup(groupID: string) {
    const group = this.authorizationGroups.get(groupID)
    if (!group) return
    this.authorizationGroups.delete(groupID)
    for (const token of group.tokens) this.authorizations.delete(token)
  }

  private pruneExpiredAuthorizations(now: number) {
    for (const group of [...this.authorizationGroups.values()]) {
      if (group.expiresAt <= now) this.removeAuthorizationGroup(group.id)
    }
  }

  private authorizationCountForSender(senderID: number) {
    let count = 0
    for (const group of this.authorizationGroups.values()) {
      if (group.senderID === senderID) count += group.tokens.size
    }
    return count
  }

  private oldestAuthorizationGroup(senderID?: number) {
    let oldest: AuthorizationGroup | undefined
    for (const group of this.authorizationGroups.values()) {
      if (senderID !== undefined && group.senderID !== senderID) continue
      if (!oldest || group.lastActivityAt < oldest.lastActivityAt) oldest = group
    }
    return oldest
  }

  private reserveAuthorizationCapacity(senderID: number, incoming: number) {
    if (incoming > this.maxPerSender || incoming > this.maxGlobal) {
      throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
    }
    while (this.authorizationCountForSender(senderID) + incoming > this.maxPerSender) {
      const oldest = this.oldestAuthorizationGroup(senderID)
      if (!oldest) break
      this.removeAuthorizationGroup(oldest.id)
    }
    while (this.authorizations.size + incoming > this.maxGlobal) {
      const oldest = this.oldestAuthorizationGroup()
      if (!oldest) break
      this.removeAuthorizationGroup(oldest.id)
    }
  }

  async authorize(
    senderID: number,
    paths: readonly string[],
    assertSafe: (targetPath: string) => Promise<void>,
  ): Promise<DeleteAuthorizationOutcome[]> {
    this.pruneExpiredAuthorizations(this.now())
    if (!Array.isArray(paths)) throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
    for (const path of paths) {
      if (typeof path !== "string" || path.length === 0) throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
    }
    const unique = [...new Map(paths.map((path) => [authorizationPathKey(path), path])).values()]
    if (unique.length === 0 || unique.length > MAX_DELETE_AUTHORIZATIONS) {
      throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
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
        return { identity: await this.readIdentity(path), error: undefined as string | undefined }
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
    const createdAt = this.now()
    this.reserveAuthorizationCapacity(senderID, publishable.length)
    const groupID = randomUUID()
    const group: AuthorizationGroup = {
      id: groupID,
      senderID,
      tokens: new Set(),
      expiresAt: createdAt + this.ttlMs,
      lastActivityAt: createdAt,
    }
    if (publishable.length > 0) this.authorizationGroups.set(groupID, group)
    for (const { path, index } of publishable) {
      const owner = owners.get(path)!
      if (owner.scan.senderID !== senderID || !targets.has(path)) continue
      const authorization = randomUUID()
      this.authorizations.set(authorization, {
        ...identities[index]!.identity!,
        senderID,
        owner: owner.owner,
        scan: owner.scan,
        groupID,
        path,
      })
      group.tokens.add(authorization)
      outcomes.set(path, { path, authorization })
    }
    // Preserve the identity of every rejected item, including an all-failed
    // batch. The renderer can then report the reason beside each path.
    const results = unique.map((path) => outcomes.get(path)!)
    return results
  }

  async consume(senderID: number, path: string, token: unknown) {
    if (typeof token !== "string") throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
    const now = this.now()
    this.pruneExpiredAuthorizations(now)
    const authorization = this.authorizations.get(token)
    const group = authorization ? this.authorizationGroups.get(authorization.groupID) : undefined
    if (
      !authorization ||
      !group ||
      group.senderID !== senderID ||
      authorization.senderID !== senderID ||
      authorization.path !== path ||
      !this.isCurrentAuthority(authorization.owner, authorization.scan)
    ) {
      this.removeAuthorizationToken(token)
      throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
    }
    // Sliding group renewal: activity on one reviewed item extends the bounded
    // batch, preventing later entries in a deliberate slow cleanup from
    // expiring while preserving a short lifetime for abandoned reviews.
    group.expiresAt = now + this.ttlMs
    group.lastActivityAt = now
    const guardExpiresAt = group.expiresAt
    this.removeAuthorizationToken(token)

    // Return a one-shot final guard so IPC can run all other safety and
    // artifact checks first, then revalidate at the closest possible point to
    // `shell.trashItem`. No filesystem identity checked only at review time is
    // trusted for the eventual operation.
    let validated = false
    return async () => {
      if (
        validated ||
        guardExpiresAt <= this.now() ||
        !this.isCurrentAuthority(authorization.owner, authorization.scan)
      ) {
        throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
      }
      validated = true
      const identity = await this.readIdentity(path)
      if (
        guardExpiresAt <= this.now() ||
        !sameIdentity(identity, authorization) ||
        !this.isCurrentAuthority(authorization.owner, authorization.scan)
      ) {
        throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
      }
    }
  }
}
