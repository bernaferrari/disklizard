import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"
import {
  createAccessAssessments,
  type AccessAssessment,
} from "./access-assessments"
import type { DiskCleanupLock, DiskScanNode, DiskUtilityAPI } from "./types"
import type { DiskLanguageKey, DiskLizardOS } from "./runtime"
import { canActOnNode } from "./storage"
import { isPathCleanupLocked } from "./cleanup-lock"
import {
  developerArtifactCleanupReadiness,
  type Recognition,
} from "./recognize"
import {
  isDeveloperInventoryNode,
  developerInventoryDeletePrecondition,
} from "./developer-inventory"

export function inventoryDeletionNeedsRescan(node: DiskScanNode) {
  return (
    isDeveloperInventoryNode(node) &&
    !developerInventoryDeletePrecondition(node)
  )
}

type SelectedAccess = AccessAssessment
type CleanupPolicyInput = {
  os?: DiskLizardOS
  locks: readonly DiskCleanupLock[]
  protectionsReady: boolean
  access?: SelectedAccess
  recognitionFor: (node: DiskScanNode) => Recognition
}

/** One policy for rows, bulk selection, review, and cleanup totals. */
export function cleanupRestrictionFor(
  node: DiskScanNode,
  input: CleanupPolicyInput
): DiskLanguageKey | null {
  if (!input.protectionsReady) return "disk.cleanup.protectionsUnavailable"
  if (node.isOther || node.isHidden) return "disk.cleanup.summaryRestricted"
  if (isPathCleanupLocked(node.path, input.locks, input.os))
    return "disk.detail.protectedByYou"
  if (!canActOnNode(node, input.os, []))
    return "disk.cleanup.locationRestricted"
  if (inventoryDeletionNeedsRescan(node)) return "disk.cleanup.needsFreshScan"
  const accessState =
    input.access?.state === "checking"
      ? input.access.previousState
      : input.access?.state
  if (input.access?.path === node.path && accessState === "denied")
    return "disk.cleanup.accessDenied"
  if (input.access?.path === node.path && accessState === "read-only")
    return "disk.cleanup.readOnly"
  const recognition = input.recognitionFor(node)
  // Ambiguous build/target/dist records may be individually moved through
  // the confirmation + Trash flow, but are never Smart Cleanup defaults.
  if (
    recognition.developer &&
    developerArtifactCleanupReadiness(recognition) === "review"
  )
    return null
  if (recognition.safety === "system") return "disk.cleanup.systemRestricted"
  if (recognition.safety === "version-control")
    return "disk.cleanup.managedRestricted"
  return null
}

/** Explorer selection and cleanup inspection share scan-local assessments. */
export function useCleanupPolicy(
  input: Omit<CleanupPolicyInput, "access"> & {
    selectedNode: DiskScanNode | null
    scanIdentity?: string
    disk: DiskUtilityAPI | undefined
  }
) {
  const stores = useMemo(
    () => new Map<string, ReturnType<typeof createAccessAssessments>>(),
    [input.disk, input.os]
  )
  const store = useMemo(() => {
    const key = input.scanIdentity ?? "no-scan"
    const existing = stores.get(key)
    if (existing) return existing
    const assessments = createAccessAssessments(
      input.disk?.checkDeleteAccess
        ? (path) => input.disk!.checkDeleteAccess!(path)
        : undefined
    )
    // Keep recently visited scan tabs without retaining every historical scan.
    if (stores.size >= 16) {
      const oldest = stores.keys().next().value!
      stores.get(oldest)?.dispose()
      stores.delete(oldest)
    }
    stores.set(key, assessments)
    return assessments
  }, [stores, input.scanIdentity])
  const revision = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot
  )
  const request = useCallback(
    (node: DiskScanNode) => {
      if (canActOnNode(node, input.os, [])) store.request(node)
    },
    [store, input.os]
  )
  useEffect(() => {
    if (input.selectedNode) request(input.selectedNode)
  }, [input.selectedNode, request])
  useEffect(() => {
    const refresh = () => store.refresh()
    window.addEventListener("focus", refresh)
    return () => {
      window.removeEventListener("focus", refresh)
      store.cancelQueued()
    }
  }, [store])
  const restriction = (node: DiskScanNode) =>
    cleanupRestrictionFor(node, { ...input, access: store.get(node) })
  return {
    revision,
    access: input.selectedNode ? store.get(input.selectedNode) : undefined,
    accessFor: store.get,
    request,
    restriction,
    canModify: (node: DiskScanNode) => restriction(node) === null,
    retry: (node = input.selectedNode) => {
      if (node) store.request(node, true)
    },
  }
}
