import { randomUUID } from "node:crypto"
import { lstat } from "node:fs/promises"
import type { DiskNode } from "./disk-scanner"

const MAX_DELETE_AUTHORIZATIONS = 256
const DELETE_AUTHORIZATION_TTL_MS = 5 * 60_000
const DELETE_AUTHORIZATION_STAT_CONCURRENCY = 16

export const INVALID_DELETE_AUTHORIZATION_ERROR =
  "Delete authorization expired or the item changed — review it again before moving it to Trash."
export const UNSCANNED_DELETE_TARGET_ERROR = "Item is not part of an active scan — rescan before moving it to Trash."

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

type Authorization = FileIdentity & {
  senderID: number
  owner: string
  path: string
  expiresAt: number
}

async function readIdentity(path: string): Promise<FileIdentity> {
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
  roots: ReadonlyMap<string, ScanRoot>,
  senderID: number,
  targetPaths: ReadonlySet<string>,
) {
  const unresolved = new Set(targetPaths)
  const resolved = new Map<string, ResolvedOwner>()
  for (const [owner, scan] of roots) {
    if (scan.senderID !== senderID) continue
    const stack = [scan.root]
    while (stack.length > 0 && unresolved.size > 0) {
      const node = stack.pop()!
      if (!node.isOther && unresolved.delete(node.path)) resolved.set(node.path, { owner, scan })
      // Avoid a spread call here: a single very wide directory can contain
      // more children than the JavaScript argument limit.
      for (let index = 0; index < node.children.length; index += 1) {
        stack.push(node.children[index]!)
      }
    }
    for (const item of scan.root.developerArtifactInventory?.items ?? []) {
      if (unresolved.delete(item.path)) resolved.set(item.path, { owner, scan })
    }
    if (unresolved.size === 0) break
  }
  return resolved
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
  private readonly authorizations = new Map<string, Authorization>()

  updateRoot(owner: string, senderID: number, root: DiskNode) {
    this.roots.set(owner, { senderID, root })
    this.removeAuthorizations(owner)
  }

  removeOwner(owner: string) {
    this.roots.delete(owner)
    this.removeAuthorizations(owner)
  }

  clear() {
    this.roots.clear()
    this.authorizations.clear()
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
  ) {
    if (!Array.isArray(paths)) throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
    const unique = [...new Set(paths)]
    if (unique.length === 0 || unique.length > MAX_DELETE_AUTHORIZATIONS) {
      throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
    }
    for (const path of unique) {
      if (typeof path !== "string" || path.length === 0) throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
    }

    const targets = new Set(unique)
    const owners = resolveOwners(this.roots, senderID, targets)
    if (owners.size !== unique.length) throw new Error(UNSCANNED_DELETE_TARGET_ERROR)

    // Validate the entire batch before publishing any capability. Bounded
    // concurrency keeps a 256-item review responsive without creating an
    // equally large burst of filesystem work.
    const identities = await mapWithConcurrency(
      unique,
      DELETE_AUTHORIZATION_STAT_CONCURRENCY,
      async (path) => {
        await assertSafe(path)
        return readIdentity(path)
      },
    )

    // A watcher can replace a scan root while the filesystem checks yield.
    // Bind the capabilities to the exact root object that was reviewed.
    for (const [path, resolved] of owners) {
      if (this.roots.get(resolved.owner) !== resolved.scan) {
        throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
      }
      if (resolved.scan.senderID !== senderID || !targets.has(path)) {
        throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
      }
    }

    const expiresAt = Date.now() + DELETE_AUTHORIZATION_TTL_MS
    return unique.map((path, index) => {
      const resolved = owners.get(path)!
      const authorization = randomUUID()
      this.authorizations.set(authorization, {
        ...identities[index]!,
        senderID,
        owner: resolved.owner,
        path,
        expiresAt,
      })
      return { path, authorization }
    })
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
      !this.roots.has(authorization.owner)
    ) {
      throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
    }
    const identity = await readIdentity(path)
    if (!sameIdentity(identity, authorization)) throw new Error(INVALID_DELETE_AUTHORIZATION_ERROR)
  }
}
