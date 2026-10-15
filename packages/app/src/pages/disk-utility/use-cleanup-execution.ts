import { showToast } from "@/components/dl/toast"
import { useRef, useState, type Dispatch, type SetStateAction } from "react"
import { cleanupLockForPath, cleanupLockMessage } from "./cleanup-lock"
import type { CleanupOutcome } from "./CleanupResultsDialog"
import {
  assertCleanupProtectionsReady,
  executeAuthorizedDeletionBatch,
  resolveDeleteAuthorization,
} from "./deletion-controller"
import {
  developerInventoryDeletePrecondition,
  isDeveloperInventoryNode,
} from "./developer-inventory"
import type { DeletionProgress } from "./DiskUtilityDialogs"
import { formatBytes } from "./format"
import { itemIdentity } from "./item-identity"
import { useSurfacePresence } from "./motion"
import { nativeTrashName } from "./navigation"
import { containsSharedPhysicalStorage } from "./recognize"
import type { DiskLizardOS, useLanguage } from "./runtime"
import type { DiskCleanupLock, DiskScanNode, DiskUtilityAPI } from "./types"
import { inventoryDeletionNeedsRescan } from "./use-cleanup-policy"

type CleanupExecutionOptions = {
  disk?: DiskUtilityAPI
  os?: DiskLizardOS
  language: ReturnType<typeof useLanguage>
  cleanupLocks: readonly DiskCleanupLock[]
  cleanupProtectionsReady: () => boolean
  ensureCleanupProtectionsReady: () => boolean
  canModifyNode: (node: DiskScanNode) => boolean
  showDeveloperArtifactRescanGuidance: (node: DiskScanNode) => void
  effectiveCollection: DiskScanNode[]
  setCollection: Dispatch<SetStateAction<DiskScanNode[]>>
  collectionSurface: Pick<ReturnType<typeof useSurfacePresence>, "close">
  requiresDeepInventoryRefresh: (nodes: readonly DiskScanNode[]) => boolean
  applyDeletedNodes: (nodes: readonly DiskScanNode[]) => void
  openTrash: () => void | Promise<void>
}

/** Owns authorize/consume execution and result surfaces; map reconciliation is
 * a separate callback. Batch guards read current protections after every await. */
export function useCleanupExecution(options: CleanupExecutionOptions) {
  const current = useRef(options)
  current.current = options
  const {
    disk,
    os,
    language,
    cleanupLocks,
    cleanupProtectionsReady,
    ensureCleanupProtectionsReady,
    canModifyNode,
    showDeveloperArtifactRescanGuidance,
    effectiveCollection,
    setCollection,
    collectionSurface,
    openTrash,
  } = options
  const deleteSurface = useSurfacePresence()
  const [pendingDelete, setPendingDelete] = useState<DiskScanNode | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deletionProgress, setDeletionProgress] =
    useState<DeletionProgress | null>(null)
  const [cleanupResults, setCleanupResults] = useState<CleanupOutcome[]>([])
  const [cleanupResultsOpen, setCleanupResultsOpen] = useState(false)
  const [cleanupPlanNeedsRecheck, setCleanupPlanNeedsRecheck] = useState(false)
  function isDeveloperArtifactPreconditionRejection(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return message.includes(
      "Artifact changed since scan — rescan before moving it to Trash."
    )
  }

  /** A clean success is a toast; failures or a stale plan keep the results sheet. */
  function reportCleanupOutcomes(
    outcomes: CleanupOutcome[],
    needsRecheck: boolean
  ) {
    setCleanupResults(outcomes)
    if (needsRecheck || outcomes.some((item) => item.status === "failed")) {
      setCleanupResultsOpen(true)
      return
    }
    const trash = nativeTrashName(os)
    showToast({
      variant: "success",
      title: language.t("disk.toast.movedBytes", {
        bytes: formatBytes(
          outcomes.reduce((sum, item) => sum + item.node.size, 0)
        ),
        trash,
      }),
      description:
        outcomes.length === 1
          ? itemIdentity(outcomes[0].node).reviewTitle
          : language.plural("disk.count.item", outcomes.length),
      actions: [
        {
          label: language.t("disk.toast.showTrash", { trash }),
          onClick: () => void openTrash(),
        },
      ],
    })
  }

  async function trashNode(node: DiskScanNode) {
    const api = disk
    if (!api) return
    if (!ensureCleanupProtectionsReady()) return
    if (inventoryDeletionNeedsRescan(node)) {
      showDeveloperArtifactRescanGuidance(node)
      return
    }
    if (!canModifyNode(node)) return
    const deepDeletePrecondition = developerInventoryDeletePrecondition(node)
    if (isDeveloperInventoryNode(node) && !deepDeletePrecondition) {
      showDeveloperArtifactRescanGuidance(node)
      return
    }
    setDeleting(true)
    try {
      assertCleanupProtectionsReady(
        cleanupProtectionsReady(),
        language.t("disk.cleanup.protectionsUnavailable")
      )
      const prepared = await api.authorizeDeletePaths([node.path])
      // Authorization may yield while protections or access assessments change.
      const latest = current.current
      assertCleanupProtectionsReady(
        latest.cleanupProtectionsReady(),
        latest.language.t("disk.cleanup.protectionsUnavailable")
      )
      if (!latest.canModifyNode(node))
        throw new Error(latest.language.t("disk.cleanup.protectionsChanged"))
      const authorization = resolveDeleteAuthorization(
        prepared,
        node.path,
        language.t("disk.toast.authorizationMismatch")
      )
      await api.deletePath(node.path, {
        authorization,
        historyMetadata: {
          estimatedBytes: node.size,
          kind: node.isDir ? "directory" : "file",
        },
        ...(deepDeletePrecondition
          ? { precondition: deepDeletePrecondition }
          : {}),
      })
      setCleanupPlanNeedsRecheck(containsSharedPhysicalStorage(node))
      current.current.applyDeletedNodes([node])
      reportCleanupOutcomes(
        [{ node, status: "moved" }],
        containsSharedPhysicalStorage(node)
      )
    } catch (err) {
      setCleanupPlanNeedsRecheck(false)
      setCleanupResults([
        {
          node,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        },
      ])
      setCleanupResultsOpen(true)
    } finally {
      setDeleting(false)
    }
  }

  async function confirmDelete() {
    const node = pendingDelete
    if (!node) return
    deleteSurface.closeThen(() => setPendingDelete(null))
    await trashNode(node)
  }

  function requestDelete(node: DiskScanNode) {
    if (!ensureCleanupProtectionsReady()) return
    if (inventoryDeletionNeedsRescan(node)) {
      showDeveloperArtifactRescanGuidance(node)
      return
    }
    if (!canModifyNode(node)) {
      const lock = cleanupLockForPath(node.path, cleanupLocks, os)
      showToast({
        variant: "default",
        title: lock
          ? language.t("disk.toast.cleanupProtected")
          : language.t("disk.toast.protectedItem"),
        description: lock
          ? cleanupLockMessage(lock)
          : language.t("disk.toast.protectedBody"),
      })
      return
    }
    setPendingDelete(node)
    deleteSurface.open()
  }

  async function deleteCollected() {
    const api = disk
    const items = effectiveCollection
    if (!api || !items.length) return
    if (!ensureCleanupProtectionsReady()) return
    setDeleting(true)
    setDeletionProgress({ completed: 0, total: items.length })
    try {
      const { removed, failed } = await executeAuthorizedDeletionBatch({
        nodes: items,
        os: os,
        locks: cleanupLocks,
        cleanupProtectionsReady: cleanupProtectionsReady(),
        currentCleanupLocks: () => current.current.cleanupLocks,
        currentCleanupProtectionsReady: () =>
          current.current.cleanupProtectionsReady(),
        cleanupProtectionsUnavailableMessage: language.t(
          "disk.cleanup.protectionsUnavailable"
        ),
        cleanupProtectionChangedMessage: language.t(
          "disk.cleanup.protectionsChanged"
        ),
        authorize: (paths) => api.authorizeDeletePaths(paths),
        authorizationMismatchMessage: language.t(
          "disk.toast.authorizationMismatch"
        ),
        remove: async (node, authorization) => {
          const deepDeletePrecondition =
            developerInventoryDeletePrecondition(node)
          if (isDeveloperInventoryNode(node) && !deepDeletePrecondition) {
            throw new Error(language.t("disk.toast.deepIdentity"))
          }
          return api.deletePath(node.path, {
            authorization,
            historyMetadata: {
              estimatedBytes: node.size,
              kind: node.isDir ? "directory" : "file",
            },
            ...(deepDeletePrecondition
              ? { precondition: deepDeletePrecondition }
              : {}),
          })
        },
        onSettled: (completed, total) =>
          setDeletionProgress({ completed, total }),
      })
      const deepInventoryNeedsRefresh =
        removed.length > 0 &&
        current.current.requiresDeepInventoryRefresh(removed)
      const knownSharedStorage = removed.some(containsSharedPhysicalStorage)
      const invalidatesAllMaps = deepInventoryNeedsRefresh || knownSharedStorage
      if (removed.length) {
        current.current.applyDeletedNodes(removed)
      }
      const retryableFailures = failed.filter(
        ({ node, error }) =>
          !isDeveloperInventoryNode(node) ||
          (!inventoryDeletionNeedsRescan(node) &&
            !isDeveloperArtifactPreconditionRejection(error))
      )
      // Stale deep-inventory rows and a known shared-storage rebuild cannot
      // safely seed the next review basket.
      setCollection(
        invalidatesAllMaps ? [] : retryableFailures.map(({ node }) => node)
      )
      setCleanupPlanNeedsRecheck(knownSharedStorage)
      collectionSurface.close()
      reportCleanupOutcomes(
        [
          ...removed.map((node): CleanupOutcome => ({ node, status: "moved" })),
          ...failed.map(({ node, error }): CleanupOutcome => ({
            node,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          })),
        ],
        knownSharedStorage
      )
    } catch (error) {
      setCleanupPlanNeedsRecheck(false)
      setCleanupResults(
        items.map((node) => ({
          node,
          status: "failed" as const,
          error: error instanceof Error ? error.message : String(error),
        }))
      )
      collectionSurface.close()
      setCleanupResultsOpen(true)
    } finally {
      setDeleting(false)
      setDeletionProgress(null)
    }
  }

  return {
    pendingDelete,
    setPendingDelete,
    deleting,
    deletionProgress,
    deleteSurface,
    cleanupResults,
    cleanupResultsOpen,
    setCleanupResultsOpen,
    cleanupPlanNeedsRecheck,
    trashNode,
    confirmDelete,
    requestDelete,
    deleteCollected,
  }
}
