import { canActOnNode, runDeletionBatch, uniqueDeletionRoots } from "./storage"
import type {
  DiskCleanupLock,
  DiskDeleteAuthorizationOutcome,
  DiskScanNode,
} from "./types"

export type DiskDeletionPlatform = "macos" | "windows" | "linux"

export function assertCleanupProtectionsReady(ready: boolean, message = "Saved cleanup protections are unavailable") {
  if (!ready) throw new Error(message)
}

export function resolveDeleteAuthorization(
  outcomes: readonly DiskDeleteAuthorizationOutcome[],
  path: string,
  mismatchMessage: string,
  os?: DiskDeletionPlatform,
) {
  // Main-process capabilities are bound to the exact scanner-issued path.
  // Do not case-fold here: Windows supports case-sensitive directories.
  const outcome = outcomes.find((candidate) => candidate.path === path)
  if (outcome?.error) throw new Error(outcome.error)
  if (!outcome?.authorization) throw new Error(mismatchMessage)
  return outcome.authorization
}

/**
 * Own the authorize-then-consume contract for a reviewed collection. UI state,
 * copy, and post-delete map reconciliation stay with the page composition.
 */
export async function executeAuthorizedDeletionBatch(input: {
  nodes: readonly DiskScanNode[]
  os?: DiskDeletionPlatform
  locks?: readonly DiskCleanupLock[]
  cleanupProtectionsReady: boolean
  /** Live state checked again immediately before each capability is consumed. */
  currentCleanupLocks?: () => readonly DiskCleanupLock[]
  currentCleanupProtectionsReady?: () => boolean
  cleanupProtectionsUnavailableMessage?: string
  cleanupProtectionChangedMessage?: string
  authorize(paths: readonly string[]): Promise<DiskDeleteAuthorizationOutcome[]>
  remove(node: DiskScanNode, authorization: string): Promise<unknown>
  authorizationMismatchMessage: string
  onSettled?(completed: number, total: number): void
}) {
  assertCleanupProtectionsReady(input.cleanupProtectionsReady, input.cleanupProtectionsUnavailableMessage)
  const locks = input.locks ?? []
  const actionable = uniqueDeletionRoots(input.nodes, input.os).filter((node) =>
    canActOnNode(node, input.os, locks),
  )
  if (actionable.length === 0) return { removed: [], failed: [] }

  const outcomes = await input.authorize(actionable.map((node) => node.path))
  let completed = 0
  return runDeletionBatch(
    actionable,
    async (node) => {
      try {
        assertCleanupProtectionsReady(
          input.currentCleanupProtectionsReady?.() ?? input.cleanupProtectionsReady,
          input.cleanupProtectionsUnavailableMessage,
        )
        const currentLocks = input.currentCleanupLocks?.() ?? locks
        if (!canActOnNode(node, input.os, currentLocks)) {
          throw new Error(input.cleanupProtectionChangedMessage ?? "Cleanup protections changed — review this item again")
        }
        const authorization = resolveDeleteAuthorization(
          outcomes,
          node.path,
          input.authorizationMismatchMessage,
          input.os,
        )
        return await input.remove(node, authorization)
      } finally {
        completed += 1
        input.onSettled?.(completed, actionable.length)
      }
    },
    input.os,
    locks,
  )
}
