import { NodeContextMenu } from "./NodeContextMenu"
import { CleanupResultsDialog } from "./CleanupResultsDialog"
import { isDeveloperInventoryNode } from "./developer-inventory"
import {
  CleanupProtectionsResetDialog,
  CollectionDialog,
  DeleteConfirmDialog,
} from "./DiskUtilityDialogs"
import { nativeRevealLabel, nativeTrashName } from "./navigation"
import { diskNodeDisplayName } from "./node-display"
import { PreviewDialog } from "./PreviewDialog"
import { containsSharedPhysicalStorage } from "./recognize"
import { mayContainUnobservedContents } from "./storage"
import type { Dispatch, SetStateAction } from "react"
import type { usePlatform, useLanguage, useSettings } from "./runtime"
import type { useCleanupPolicy } from "./use-cleanup-policy"
import type { useSurfacePresence } from "./motion"
import type { createScanInvestigation } from "./scan-investigation"
import type {
  createDiskPreviewController,
  DiskPreviewView,
} from "./preview-controller"
import type { DiskScanNode } from "./types"
import type { ContextMenuItem } from "./NodeContextMenu"
import type { DeletionProgress } from "./DiskUtilityDialogs"
import type { CleanupOutcome } from "./CleanupResultsDialog"

export type DiskWorkspaceDialogsProps = {
  platform: ReturnType<typeof usePlatform>
  language: ReturnType<typeof useLanguage>
  deleting: boolean
  homePath: string | undefined
  reveal: (path: string) => Promise<void>
  settings: ReturnType<typeof useSettings>
  cleanupResetSurface: ReturnType<typeof useSurfacePresence>
  cleanupPolicy: ReturnType<typeof useCleanupPolicy>
  rescanCurrent: (forceFresh?: boolean) => Promise<void>
  cleanupRestriction: ReturnType<typeof useCleanupPolicy>["restriction"]
  effectiveCollection: DiskScanNode[]
  collectionSize: number
  treeRoot: DiskScanNode | null
  collectionSurface: ReturnType<typeof useSurfacePresence>
  preview: ReturnType<typeof createDiskPreviewController>
  drill: (
    node: DiskScanNode,
    instant?: boolean,
    restoreListFocus?: boolean
  ) => void
  collectionHasSharedPhysicalStorage: boolean
  physicalCloneAccountingUncertain: boolean
  collectionNeedsDeepInventoryRefresh: boolean
  requiresDeepInventoryRefresh: (removed: readonly DiskScanNode[]) => boolean
  investigation: ReturnType<typeof createScanInvestigation>
  contextMenu: { node: DiskScanNode; x: number; y: number } | null
  contextMenuItems: (node: DiskScanNode) => ContextMenuItem[]
  closeContextMenu: () => void
  previewView: DiskPreviewView
  deletionProgress: DeletionProgress | null
  removeCollected: (node: DiskScanNode) => void
  deleteCollected: () => Promise<void>
  cleanupResultsOpen: boolean
  cleanupResults: CleanupOutcome[]
  cleanupPlanNeedsRecheck: boolean
  setCleanupResultsOpen: Dispatch<SetStateAction<boolean>>
  openTrash: () => Promise<void>
  collection: DiskScanNode[]
  deleteSurface: ReturnType<typeof useSurfacePresence>
  pendingDelete: DiskScanNode | null
  setPendingDelete: Dispatch<SetStateAction<DiskScanNode | null>>
  confirmDelete: () => Promise<void>
}
export function DiskWorkspaceDialogs({
  platform,
  language,
  deleting,
  homePath,
  reveal,
  settings,
  cleanupResetSurface,
  cleanupPolicy,
  rescanCurrent,
  cleanupRestriction,
  effectiveCollection,
  collectionSize,
  treeRoot,
  collectionSurface,
  preview,
  drill,
  collectionHasSharedPhysicalStorage,
  physicalCloneAccountingUncertain,
  collectionNeedsDeepInventoryRefresh,
  requiresDeepInventoryRefresh,
  investigation,
  contextMenu,
  contextMenuItems,
  closeContextMenu,
  previewView,
  deletionProgress,
  removeCollected,
  deleteCollected,
  cleanupResultsOpen,
  cleanupResults,
  cleanupPlanNeedsRecheck,
  setCleanupResultsOpen,
  openTrash,
  collection,
  deleteSurface,
  pendingDelete,
  setPendingDelete,
  confirmDelete,
}: DiskWorkspaceDialogsProps) {
  return (
    <>
      <NodeContextMenu
        at={contextMenu}
        title={contextMenu ? diskNodeDisplayName(contextMenu.node) : undefined}
        items={contextMenu ? contextMenuItems(contextMenu.node) : []}
        onClose={closeContextMenu}
      />

      {previewView.mounted && previewView.target ? (
        <PreviewDialog
          open={previewView.phase === "open" || previewView.phase === "opening"}
          node={previewView.target}
          preview={previewView.payload}
          loading={previewView.loading}
          error={previewView.error}
          position={previewView.position + 1}
          total={previewView.total}
          onClose={preview.close}
          onPrevious={
            previewView.canMovePrevious ? () => preview.move(-1) : undefined
          }
          onNext={previewView.canMoveNext ? () => preview.move(1) : undefined}
          onReveal={() => void reveal(previewView.target!.path)}
          revealLabel={nativeRevealLabel(platform.os)}
          systemPreviewLabel={
            platform.os === "macos"
              ? language.t("disk.common.quickLook")
              : undefined
          }
          onSystemPreview={
            platform.os === "macos"
              ? () => void preview.openSystemPreview(previewView.target!)
              : undefined
          }
          onOpen={() => {
            const node = previewView.target!
            if (node.isDir && !isDeveloperInventoryNode(node)) {
              preview.close()
              drill(node, true, true)
              return
            }
            void preview.openInDefaultApp(node)
          }}
        />
      ) : null}

      {collectionSurface.mounted ? (
        <CollectionDialog
          open={
            collectionSurface.phase === "open" ||
            collectionSurface.phase === "opening"
          }
          items={effectiveCollection}
          homePath={homePath}
          restrictionFor={(node) => {
            const key = cleanupRestriction(node)
            return key ? language.t(key) : undefined
          }}
          accessFor={cleanupPolicy.accessFor}
          onObserve={cleanupPolicy.request}
          onCheckAccess={cleanupPolicy.retry}
          recognitionFor={investigation.recognitionFor}
          bytes={collectionSize}
          hasSharedPhysicalStorage={collectionHasSharedPhysicalStorage}
          hasUnverifiedPhysicalStorage={physicalCloneAccountingUncertain}
          hasUnobservedContents={effectiveCollection.some((node) =>
            mayContainUnobservedContents(treeRoot, node, platform.os)
          )}
          requiresDeepInventoryRefresh={collectionNeedsDeepInventoryRefresh}
          deleting={deleting}
          progress={deletionProgress}
          trashName={nativeTrashName(platform.os)}
          onClose={() => !deleting && collectionSurface.close()}
          onRemove={removeCollected}
          onQuickLook={
            preview.supportsSystemPreview()
              ? (node) => void preview.openSystemPreview(node)
              : undefined
          }
          onPreview={(node) =>
            collectionSurface.closeThen(() => void preview.show(node))
          }
          onReveal={(node) => void reveal(node.path)}
          onConfirm={() => void deleteCollected()}
        />
      ) : null}

      <CleanupResultsDialog
        open={cleanupResultsOpen}
        outcomes={cleanupResults}
        needsRecheck={cleanupPlanNeedsRecheck}
        trashName={nativeTrashName(platform.os)}
        onClose={() => setCleanupResultsOpen(false)}
        onReveal={(node) => void reveal(node.path)}
        onRescan={() => {
          setCleanupResultsOpen(false)
          void rescanCurrent()
        }}
        onOpenTrash={() => void openTrash()}
        onReviewFailures={
          collection.length
            ? () => {
                setCleanupResultsOpen(false)
                collectionSurface.open()
              }
            : undefined
        }
      />

      {/* ── Delete confirm ── */}
      {deleteSurface.mounted && pendingDelete ? (
        <DeleteConfirmDialog
          homePath={homePath}
          open={
            deleteSurface.phase === "open" || deleteSurface.phase === "opening"
          }
          node={pendingDelete}
          hasSharedPhysicalStorage={containsSharedPhysicalStorage(
            pendingDelete
          )}
          hasUnverifiedPhysicalStorage={physicalCloneAccountingUncertain}
          hasUnobservedContents={mayContainUnobservedContents(
            treeRoot,
            pendingDelete,
            platform.os
          )}
          requiresDeepInventoryRefresh={requiresDeepInventoryRefresh([
            pendingDelete,
          ])}
          deleting={deleting}
          trashName={nativeTrashName(platform.os)}
          onClose={() =>
            !deleting && deleteSurface.closeThen(() => setPendingDelete(null))
          }
          onConfirm={() => void confirmDelete()}
        />
      ) : null}

      {cleanupResetSurface.mounted ? (
        <CleanupProtectionsResetDialog
          open={
            cleanupResetSurface.phase === "open" ||
            cleanupResetSurface.phase === "opening"
          }
          onClose={() => cleanupResetSurface.close()}
          onReset={() => settings.store.general.resetDiskCleanupLocks()}
        />
      ) : null}
    </>
  )
}
