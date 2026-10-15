import { CleanupView } from "./CleanupView"
import { developerInventoryCoverage } from "./developer-inventory-coverage"
import { cleanupLockForPath } from "./cleanup-lock"
import { itemIdentity } from "./item-identity"
import { nativeTrashName } from "./navigation"
import type { usePlatform, useLanguage } from "./runtime"
import type { CleanupSummary } from "./cleanup-summary"
import type { useCleanupPolicy } from "./use-cleanup-policy"
import type { useSurfacePresence } from "./motion"
import type { createDiskPreviewController } from "./preview-controller"
import type { IndexFilter } from "./use-disk-investigation"
import type { BaselineChange } from "./scan-baseline"
import type { DiskScanNode, DiskCleanupLock } from "./types"
import type { ArtifactEcosystem, ArtifactEcosystemFilter } from "./recognize"
import type { DeveloperCleanupAgePreset } from "./developer-cleanup"

export type DiskCleanupWorkspaceProps = {
  platform: ReturnType<typeof usePlatform>
  language: ReturnType<typeof useLanguage>
  toggleProtectedTree: (path: string, label: string) => Promise<void>
  homePath: string | undefined
  reveal: (path: string) => Promise<void>
  cleanupLocks: DiskCleanupLock[]
  cleanupSummary: CleanupSummary
  cleanupPolicy: ReturnType<typeof useCleanupPolicy>
  rescanCurrent: (forceFresh?: boolean) => Promise<void>
  indexFilter: IndexFilter
  setCustomDeveloperCleanupAgeDays: (days: string) => void
  isCollected: (path: string) => boolean
  coveringCollectedNode: (path: string) => DiskScanNode | undefined
  canModifyNode: (node: DiskScanNode) => boolean
  cleanupRestriction: ReturnType<typeof useCleanupPolicy>["restriction"]
  effectiveCollection: DiskScanNode[]
  collectionSize: number
  developerEcosystems: ArtifactEcosystem[]
  treeRoot: DiskScanNode | null
  chooseDeveloperCleanupAge: (age: DeveloperCleanupAgePreset) => void
  chooseDeveloperEcosystem: (ecosystem: ArtifactEcosystemFilter) => void
  toggleCollect: (node: DiskScanNode) => void
  collectNodes: (nodes: readonly DiskScanNode[]) => void
  uncollectNodes: (nodes: readonly DiskScanNode[]) => void
  clearCollection: () => void
  collectionSurface: ReturnType<typeof useSurfacePresence>
  preview: ReturnType<typeof createDiskPreviewController>
  sinceLastChanges: Map<string, BaselineChange>
}

export function DiskCleanupWorkspace({
  platform,
  language,
  toggleProtectedTree,
  homePath,
  reveal,
  cleanupLocks,
  cleanupSummary,
  cleanupPolicy,
  rescanCurrent,
  indexFilter,
  setCustomDeveloperCleanupAgeDays,
  isCollected,
  coveringCollectedNode,
  canModifyNode,
  cleanupRestriction,
  effectiveCollection,
  collectionSize,
  developerEcosystems,
  treeRoot,
  chooseDeveloperCleanupAge,
  chooseDeveloperEcosystem,
  toggleCollect,
  collectNodes,
  uncollectNodes,
  clearCollection,
  collectionSurface,
  preview,
  sinceLastChanges,
}: DiskCleanupWorkspaceProps) {
  return (
    <CleanupView
      summary={cleanupSummary}
      homePath={homePath}
      onInspect={cleanupPolicy.request}
      onObserve={cleanupPolicy.request}
      accessFor={cleanupPolicy.accessFor}
      onCheckAccess={cleanupPolicy.retry}
      onRescan={() => void rescanCurrent()}
      protectionFor={(node) =>
        cleanupLockForPath(node.path, cleanupLocks, platform.os)
      }
      onUnprotect={(lock) => void toggleProtectedTree(lock.path, lock.label)}
      customAgeDays={indexFilter.customDeveloperAgeDays}
      onCustomAgeDays={setCustomDeveloperCleanupAgeDays}
      isCollected={isCollected}
      coveredBy={(path) => {
        const cover = coveringCollectedNode(path)
        return cover ? itemIdentity(cover).reviewTitle : undefined
      }}
      canModify={canModifyNode}
      restriction={(node) => {
        const key = cleanupRestriction(node)
        return key ? language.t(key) : undefined
      }}
      collectionCount={effectiveCollection.length}
      collectionBytes={collectionSize}
      trashName={nativeTrashName(platform.os)}
      agePreset={indexFilter.developerAge}
      ecosystems={developerEcosystems}
      ecosystem={indexFilter.developerEcosystem}
      inventoryNote={
        treeRoot?.developerArtifactInventory?.status.state === "partial"
          ? developerInventoryCoverage(treeRoot.developerArtifactInventory)
          : undefined
      }
      onAgePreset={chooseDeveloperCleanupAge}
      onEcosystem={chooseDeveloperEcosystem}
      onToggle={toggleCollect}
      onCollect={collectNodes}
      onRelease={uncollectNodes}
      onClear={clearCollection}
      onReview={() => collectionSurface.open()}
      onReveal={(node) => void reveal(node.path)}
      onPreview={(node) => {
        if (preview.supportsSystemPreview()) {
          void preview.openSystemPreview(node)
        } else {
          void preview.show(node)
        }
      }}
      changeFor={(path) => sinceLastChanges.get(path)}
    />
  )
}
