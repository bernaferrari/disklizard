import { useEffect, useState } from "react"
import type {
  DiskCleanupLock,
  DiskPathAccess,
  DiskScanNode,
  DiskUtilityAPI,
} from "./types"
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

type SelectedAccess = {
  path: string
  state: DiskPathAccess["state"] | "checking"
}
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
  if (input.access?.path === node.path && input.access.state === "denied")
    return "disk.cleanup.accessDenied"
  if (input.access?.path === node.path && input.access.state === "read-only")
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

/** Owns the selected item's asynchronous permission check and its retry. */
export function useCleanupPolicy(
  input: Omit<CleanupPolicyInput, "access"> & {
    selectedNode: DiskScanNode | null
    disk: DiskUtilityAPI | undefined
  }
) {
  const [access, setAccess] = useState<SelectedAccess>()
  const [checkVersion, setCheckVersion] = useState(0)
  useEffect(() => {
    const node = input.selectedNode
    if (
      !node ||
      !input.disk?.checkDeleteAccess ||
      !canActOnNode(node, input.os, input.locks)
    ) {
      setAccess(undefined)
      return undefined
    }
    let current = true
    setAccess({ path: node.path, state: "checking" })
    void input.disk.checkDeleteAccess(node.path).then(
      (result) =>
        current && setAccess({ path: node.path, state: result.state }),
      () => current && setAccess({ path: node.path, state: "unknown" })
    )
    return () => {
      current = false
    }
  }, [
    input.selectedNode?.path,
    input.disk,
    input.locks,
    input.os,
    checkVersion,
  ])
  const restriction = (node: DiskScanNode) =>
    cleanupRestrictionFor(node, { ...input, access })
  return {
    access,
    restriction,
    canModify: (node: DiskScanNode) => restriction(node) === null,
    retry: () => setCheckVersion((version) => version + 1),
  }
}
