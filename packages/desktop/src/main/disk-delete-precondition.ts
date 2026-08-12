import { lstat, readdir } from "node:fs/promises"
import type { Dirent } from "node:fs"
import { basename, dirname } from "node:path"
import { DEVELOPER_ARTIFACT_EVIDENCE_NAMES, classifyDeveloperArtifact } from "@opencode-ai/disklizard"
import type {
  DeveloperArtifact,
  DeveloperArtifactDirectoryIdentity,
} from "../../../disklizard/src/types"

/** Kept stable so the renderer can turn a stale destructive action into a rescan affordance. */
export const STALE_DEVELOPER_ARTIFACT_ERROR = "Artifact changed since scan — rescan before moving it to Trash."

export type DeveloperArtifactDeletePrecondition = {
  kind: "developer-artifact"
  /**
   * Optional on the wire for backwards compatibility, but required by the
   * desktop guard for destructive deep-inventory cleanup. Native Windows
   * records are enriched with Node bigint-lstat metadata before delivery.
   */
  directoryIdentity?: DeveloperArtifactDirectoryIdentity
  /** The classification observed in the bounded inventory. */
  artifact: Pick<DeveloperArtifact, "name" | "kind" | "ecosystem" | "confidence" | "cleanup">
}

export type DiskDeleteOptions = {
  permanent?: boolean
  precondition?: DeveloperArtifactDeletePrecondition
}

/**
 * Runs the two path-level checks in the only useful order for a destructive
 * inventory action: safety first, then the fresh identity/classifier check,
 * immediately followed by the caller's move-to-Trash (or permanent-delete)
 * operation.  A handle-bound Trash API would be needed to remove the final
 * filesystem race entirely, but this keeps the bounded inventory proof as
 * close as possible to use of the path.
 */
export async function runGuardedDiskDelete<T>(
  targetPath: string,
  precondition: DeveloperArtifactDeletePrecondition | undefined,
  assertSafe: (targetPath: string) => Promise<void>,
  operation: (targetPath: string) => Promise<T>,
): Promise<T> {
  await assertSafe(targetPath)
  if (precondition) await assertDeveloperArtifactDeletePrecondition(targetPath, precondition)
  return operation(targetPath)
}

function staleArtifactError(): Error {
  return new Error(STALE_DEVELOPER_ARTIFACT_ERROR)
}

function isIdentity(value: unknown): value is DeveloperArtifactDirectoryIdentity {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    (candidate.platform === "posix" || candidate.platform === "windows") &&
    typeof candidate.device === "string" &&
    candidate.device.length > 0 &&
    typeof candidate.fileId === "string" &&
    candidate.fileId.length > 0 &&
    typeof candidate.modifiedAt === "number" &&
    Number.isSafeInteger(candidate.modifiedAt) &&
    candidate.modifiedAt >= 0
  )
}

function isArtifactShape(value: unknown): value is DeveloperArtifactDeletePrecondition["artifact"] {
  if (!value || typeof value !== "object") return false
  const artifact = value as Record<string, unknown>
  return (
    typeof artifact.name === "string" &&
    (artifact.kind === "dependencies" || artifact.kind === "build-output" || artifact.kind === "toolchain-cache") &&
    typeof artifact.ecosystem === "string" &&
    (artifact.confidence === "verified" || artifact.confidence === "likely" || artifact.confidence === "ambiguous") &&
    (artifact.cleanup === "eligible" || artifact.cleanup === "review")
  )
}

function directArtifactSignatures(entries: readonly Dirent[]) {
  // `readdir` is deliberately non-recursive and the classified markers are
  // only direct names. Ignore symlinks rather than letting a newly introduced
  // alias imitate the scan-time directory shape.
  const names = new Set<string>()
  for (const entry of entries) {
    if (typeof entry === "string" || entry.isSymbolicLink()) continue
    const name = entry.name.toLowerCase()
    if (DEVELOPER_ARTIFACT_EVIDENCE_NAMES.has(name)) names.add(name)
  }
  return [...names].sort()
}

function identityPlatform(): DeveloperArtifactDirectoryIdentity["platform"] {
  return process.platform === "win32" ? "windows" : "posix"
}

/**
 * Fresh, bounded defense against a deep inventory item changing between scan
 * and Trash. This is intentionally separate from `assertSafeDeletionPath`:
 * the latter protects dangerous paths; this one proves the inventory record
 * is still a non-symlink directory with the same conservative classifier.
 */
export async function assertDeveloperArtifactDeletePrecondition(
  targetPath: string,
  precondition: DeveloperArtifactDeletePrecondition,
): Promise<void> {
  if (precondition?.kind !== "developer-artifact" || !isArtifactShape(precondition.artifact)) {
    throw staleArtifactError()
  }

  try {
    const info = await lstat(targetPath, { bigint: true })
    if (!info.isDirectory() || info.isSymbolicLink()) throw staleArtifactError()

    const expectedIdentity = precondition.directoryIdentity
    // Deep inventory records can outlive the visual map and must never fall
    // back to a same-name/same-shape delete. A failed scan-time hydration or
    // an old cached payload therefore requires a fresh scan before Trash.
    if (!isIdentity(expectedIdentity) || expectedIdentity.platform !== identityPlatform()) {
      throw staleArtifactError()
    }
    const directModifiedAt = Math.floor(Number(info.mtimeMs))
    if (
      info.dev <= 0n ||
      info.ino <= 0n ||
      !Number.isSafeInteger(directModifiedAt) ||
      info.dev.toString() !== expectedIdentity.device ||
      info.ino.toString() !== expectedIdentity.fileId ||
      directModifiedAt !== expectedIdentity.modifiedAt
    ) {
      throw staleArtifactError()
    }

    const entries = await readdir(targetPath, { withFileTypes: true })
    const actual = classifyDeveloperArtifact(
      basename(targetPath),
      basename(dirname(targetPath)),
      directArtifactSignatures(entries),
    )
    const expected = precondition.artifact
    if (
      actual === undefined ||
      expected.name !== basename(targetPath) ||
      actual.kind !== expected.kind ||
      actual.ecosystem !== expected.ecosystem ||
      actual.confidence !== expected.confidence ||
      actual.cleanup !== expected.cleanup
    ) {
      throw staleArtifactError()
    }
  } catch (error) {
    if (error instanceof Error && error.message === STALE_DEVELOPER_ARTIFACT_ERROR) throw error
    throw staleArtifactError()
  }
}
