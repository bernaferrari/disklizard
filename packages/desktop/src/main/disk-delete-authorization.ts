import { randomUUID } from "node:crypto"
import { lstat } from "node:fs/promises"
import type { DiskNode } from "./disk-scanner"

const MAX_DELETE_AUTHORIZATIONS = 256
const DELETE_AUTHORIZATION_TTL_MS = 5 * 60_000

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

function findOwner(roots: ReadonlyMap<string, ScanRoot>, senderID: number, targetPath: string) {
  for (const [owner, scan] of roots) {
    if (scan.senderID !== senderID) continue
    const stack = [scan.root]
    while (stack.length) {
      const node = stack.pop()!
      if (!node.isOther && node.path === targetPath) return owner
      stack.push(...node.children)
    }
    if (scan.root.developerArtifactInventory?.items.some((item) => item.path === targetPath)) return owner
  }
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
    const unique = [...new Set(paths)]
    if (unique.length === 0 || unique.length > MAX_DELETE_AUTHORIZATIONS) {
      throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
    }

    const prepared: Array<{ path: string; authorization: string }> = []
    for (const path of unique) {
      if (typeof path !== "string" || path.length === 0) throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
      const owner = findOwner(this.roots, senderID, path)
      if (!owner) throw new Error(UNSCANNED_DELETE_TARGET_ERROR)
      await assertSafe(path)
      const identity = await readIdentity(path)
      const authorization = randomUUID()
      this.authorizations.set(authorization, {
        ...identity,
        senderID,
        owner,
        path,
        expiresAt: Date.now() + DELETE_AUTHORIZATION_TTL_MS,
      })
      prepared.push({ path, authorization })
    }
    return prepared
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
