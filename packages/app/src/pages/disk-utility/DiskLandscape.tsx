import { AnimatePresence, motion } from "framer-motion"
import { cn } from "@/lib/utils"
import { cleanupLockForPath, isPathCleanupLocked } from "./cleanup-lock"
import { CollectionDropTarget } from "./CollectionDropTarget"
import { isDeveloperInventoryNode } from "./developer-inventory"
import { DetailBar } from "./DiskUtilityDetailBar"
import { CenterOverlay } from "./DiskUtilityEmptyStates"
import { itemIdentity } from "./item-identity"
import { nativeRevealLabel, nativeTrashName } from "./navigation"
import { containsSharedPhysicalStorage } from "./recognize"
import { Treemap } from "./TreemapPanel"
import type {
  RefObject,
  Dispatch,
  SetStateAction,
  PointerEvent as ReactPointerEvent,
} from "react"
import type { usePlatform, useLanguage } from "./runtime"
import type { useCleanupPolicy } from "./use-cleanup-policy"
import type { useSurfacePresence } from "./motion"
import type { createSpectrum } from "./spectrum"
import type { createScanInvestigation } from "./scan-investigation"
import type { createDiskPreviewController } from "./preview-controller"
import type { ScanMode } from "./use-disk-visualization"
import type { DiskScanNode, DiskCleanupLock } from "./types"
import type { PointerDragSource } from "./pointer-drag"
import type { AccessAssessment } from "./access-assessments"

export type DiskLandscapeProps = {
  platform: ReturnType<typeof usePlatform>
  language: ReturnType<typeof useLanguage>
  scanning: boolean
  deleting: boolean
  scanLabel: string
  toggleProtectedTree: (path: string, label: string) => Promise<void>
  focusedScan: { label: string } | null
  scanMode: ScanMode
  reveal: (path: string) => Promise<void>
  cleanupLocks: DiskCleanupLock[]
  cleanupPolicy: ReturnType<typeof useCleanupPolicy>
  isCollected: (path: string) => boolean
  coveringCollectedNode: (path: string) => DiskScanNode | undefined
  canModifyNode: (node: DiskScanNode) => boolean
  cleanupRestriction: ReturnType<typeof useCleanupPolicy>["restriction"]
  effectiveCollection: DiskScanNode[]
  collectionSize: number
  toggleCollect: (node: DiskScanNode) => void
  clearCollection: () => void
  collectionSurface: ReturnType<typeof useSurfacePresence>
  preview: ReturnType<typeof createDiskPreviewController>
  landscapeElRef: RefObject<HTMLElement | null>
  setLandscapeEl: Dispatch<SetStateAction<HTMLElement | null>>
  selectedNode: DiskScanNode | null
  collectionDragNode: DiskScanNode | null
  scanFiles: number
  morphing: boolean
  setCanvasEl: Dispatch<SetStateAction<HTMLCanvasElement | null>>
  visibleMapNode: DiskScanNode | null
  beginMapDrag: (event: ReactPointerEvent<HTMLCanvasElement>) => void
  hoveredNode: DiskScanNode | null
  hoveredPath: string | null
  gridVisible: boolean
  gridOverlayRef: RefObject<HTMLDivElement | null>
  gridInteractive: boolean
  viewNode: DiskScanNode | null
  registerTileCamera: (prepare: ((path: string) => void) | null) => void
  parentView: DiskScanNode | undefined
  goUpFromMapCenter: () => void
  tileColor: (path: string) => string | undefined
  spectrum: ReturnType<typeof createSpectrum>
  projectedViewNode: DiskScanNode | null
  sortedChildren: DiskScanNode[]
  selectedPath: string | undefined
  queuedPaths: string[]
  hoverEntry: (path: string | null, node?: DiskScanNode | null) => void
  selectPath: (path: string) => void
  drill: (
    node: DiskScanNode,
    instant?: boolean,
    restoreListFocus?: boolean
  ) => void
  expandOtherNode: (node: DiskScanNode, restoreListFocus?: boolean) => void
  canDragNode: (node: DiskScanNode) => boolean
  beginCollectionDrag: (
    event: PointerDragSource,
    node: DiskScanNode | null,
    onStart?: () => void
  ) => void
  collectionDropElementRef: RefObject<HTMLElement | undefined>
  collectionDropActive: boolean
  collectionHasSharedPhysicalStorage: boolean
  physicalCloneAccountingUncertain: boolean
  collectionNeedsDeepInventoryRefresh: boolean
  requiresDeepInventoryRefresh: (removed: readonly DiskScanNode[]) => boolean
  rootSpectrum: ReturnType<typeof createSpectrum>
  investigation: ReturnType<typeof createScanInvestigation>
  indexSize: number
  selectedAccess: AccessAssessment | undefined
  requestDelete: (node: DiskScanNode) => void
}

export function DiskLandscape({
  platform,
  language,
  scanning,
  deleting,
  scanLabel,
  toggleProtectedTree,
  focusedScan,
  scanMode,
  reveal,
  cleanupLocks,
  cleanupPolicy,
  isCollected,
  coveringCollectedNode,
  canModifyNode,
  cleanupRestriction,
  effectiveCollection,
  collectionSize,
  toggleCollect,
  clearCollection,
  collectionSurface,
  preview,
  landscapeElRef,
  setLandscapeEl,
  selectedNode,
  collectionDragNode,
  scanFiles,
  morphing,
  setCanvasEl,
  visibleMapNode,
  beginMapDrag,
  hoveredNode,
  hoveredPath,
  gridVisible,
  gridOverlayRef,
  gridInteractive,
  viewNode,
  registerTileCamera,
  parentView,
  goUpFromMapCenter,
  tileColor,
  spectrum,
  projectedViewNode,
  sortedChildren,
  selectedPath,
  queuedPaths,
  hoverEntry,
  selectPath,
  drill,
  expandOtherNode,
  canDragNode,
  beginCollectionDrag,
  collectionDropElementRef,
  collectionDropActive,
  collectionHasSharedPhysicalStorage,
  physicalCloneAccountingUncertain,
  collectionNeedsDeepInventoryRefresh,
  requiresDeepInventoryRefresh,
  rootSpectrum,
  investigation,
  indexSize,
  selectedAccess,
  requestDelete,
}: DiskLandscapeProps) {
  return (
    <section
      ref={(el: HTMLElement | null) => {
        landscapeElRef.current = el
        setLandscapeEl(el)
      }}
      className={cn(
        "[container-type:size] relative min-h-0 min-w-0 flex-1 overflow-hidden [--dl-footer-height:72px] [view-transition-name:disk-landscape]",
        selectedNode &&
          (effectiveCollection.length > 0 || collectionDragNode) &&
          "max-[1100px]:[--dl-footer-height:116px]"
      )}
    >
      {scanning && focusedScan ? (
        <div
          role="status"
          className="pointer-events-none absolute top-4 right-4 z-20 rounded-lg bg-[var(--dl-popover)] px-3 py-2 text-[12px] text-text-strong shadow-lg"
        >
          {language.t("disk.scan.label", {
            label: focusedScan.label,
          })}
          <span className="ml-2 text-text-weak tabular-nums">
            {language.t("disk.scan.fileCount", {
              count: scanFiles.toLocaleString(),
            })}
          </span>
        </div>
      ) : null}
      <p className="sr-only">{language.t("disk.map.colorMeaning")}</p>
      {/* The map canvas persists across map⇄grid so ViewMorph can fly
                              wedges into tile poses on one surface; CenterOverlay yields
                              while a morph owns the view. */}
      <div
        className="@container [container-type:inline-size] absolute inset-x-0 top-0 bottom-[var(--dl-footer-height)]"
        style={{
          visibility: scanMode !== "map" && !morphing ? "hidden" : "visible",
        }}
      >
        <canvas
          ref={(el: HTMLCanvasElement | null) => {
            setCanvasEl(el)
          }}
          className="absolute inset-0 size-full [touch-action:none] outline-none"
          tabIndex={0}
          role="region"
          data-map-size={visibleMapNode?.size ?? 0}
          aria-roledescription={language.t("disk.map.role")}
          aria-describedby="disklizard-orbit-help"
          aria-controls="disklizard-storage-list"
          aria-label={language.t("disk.map.label", {
            label: scanLabel,
          })}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End PageUp PageDown Enter Space C L Delete Backspace Escape 1 2"
          onPointerDown={beginMapDrag}
        />
        <span id="disklizard-orbit-help" className="sr-only">
          {language.t("disk.map.instructions")}
        </span>
        {scanMode === "map" || morphing ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-0 transition-opacity duration-150",
              morphing ? "opacity-0" : "opacity-100"
            )}
          >
            <CenterOverlay
              node={visibleMapNode}
              hovered={
                !collectionDragNode &&
                hoveredNode &&
                hoveredPath === hoveredNode.path &&
                hoveredNode.path !== visibleMapNode?.path
                  ? hoveredNode
                  : null
              }
            />
          </div>
        ) : null}
      </div>
      {gridVisible ? (
        <div
          ref={gridOverlayRef}
          data-labels-visible={gridInteractive}
          style={
            gridInteractive
              ? undefined
              : { opacity: scanMode === "grid" ? 0 : 1 }
          }
          className={cn(
            "dl-treemap-overlay absolute inset-x-0 top-0 bottom-[var(--dl-footer-height)] px-6 pt-6 pb-2",
            !gridInteractive && "pointer-events-none"
          )}
          inert={!gridInteractive ? true : undefined}
          aria-hidden={!gridInteractive ? "true" : undefined}
        >
          <Treemap
            rootPath={viewNode?.path ?? ""}
            onPrepareNavigation={registerTileCamera}
            parent={
              parentView
                ? {
                    node: parentView,
                    onUp: goUpFromMapCenter,
                  }
                : undefined
            }
            rootIsAggregate={viewNode?.isOther}
            colorForPath={tileColor}
            colorForNode={(node) => spectrum.color(node)}
            children={projectedViewNode?.children ?? sortedChildren}
            draggingNode={collectionDragNode}
            hoveredPath={hoveredPath}
            selectedPath={selectedPath}
            queuedPaths={queuedPaths}
            onHover={(node) => {
              hoverEntry(node?.path ?? selectedPath ?? null, node)
            }}
            onSelect={selectPath}
            onReveal={(node) => void reveal(node.path)}
            onPreview={(node) => {
              if (preview.supportsSystemPreview())
                void preview.openSystemPreview(node)
              else void preview.show(node)
            }}
            onDrill={(node, restoreListFocus) =>
              drill(node, false, restoreListFocus)
            }
            onShowAll={(node) => expandOtherNode(node)}
            canCollect={canDragNode}
            onCollectDragStart={beginCollectionDrag}
          />
        </div>
      ) : null}

      {/* Map footer: the collector on the left, the current selection on the right. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-20 flex h-[var(--dl-footer-height)] items-center gap-3 px-4 max-[760px]:px-2.5",
          selectedNode &&
            (effectiveCollection.length > 0 || collectionDragNode) &&
            "max-[1100px]:flex-col max-[1100px]:items-stretch max-[1100px]:justify-center max-[1100px]:gap-1"
        )}
      >
        <div
          className={cn(
            "min-w-0 shrink",
            selectedNode &&
              effectiveCollection.length === 0 &&
              !collectionDragNode &&
              "max-[1100px]:hidden"
          )}
        >
          <CollectionDropTarget
            setElement={(element) => {
              collectionDropElementRef.current = element ?? undefined
            }}
            node={collectionDragNode}
            acceptsNode={
              !collectionDragNode || canModifyNode(collectionDragNode)
            }
            active={collectionDropActive}
            count={effectiveCollection.length}
            bytes={collectionSize}
            hasSharedPhysicalStorage={
              collectionHasSharedPhysicalStorage ||
              (collectionDragNode
                ? containsSharedPhysicalStorage(collectionDragNode)
                : false)
            }
            hasUnverifiedPhysicalStorage={physicalCloneAccountingUncertain}
            requiresDeepInventoryRefresh={
              collectionNeedsDeepInventoryRefresh ||
              (collectionDragNode
                ? requiresDeepInventoryRefresh([collectionDragNode])
                : false)
            }
            trashName={nativeTrashName(platform.os)}
            compact={!!selectedNode}
            onReview={() => collectionSurface.open()}
            onClear={clearCollection}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end max-[1100px]:w-full">
          <AnimatePresence mode="popLayout" initial={false}>
            {selectedNode ? (
              <motion.div
                key="selection"
                className="w-full max-w-[560px] min-w-0"
                initial={{
                  opacity: 0,
                  y: 8,
                  scale: 0.98,
                }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{
                  duration: 0.18,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <DetailBar
                  node={selectedNode}
                  color={
                    spectrum.color(selectedNode) ??
                    rootSpectrum.color(selectedNode)
                  }
                  recognition={investigation.recognitionFor(selectedNode)}
                  parentSize={indexSize}
                  deletable={canModifyNode(selectedNode)}
                  collected={isCollected(selectedNode.path)}
                  reviewHasItems={effectiveCollection.length > 0}
                  includedBy={
                    coveringCollectedNode(selectedNode.path)
                      ? itemIdentity(coveringCollectedNode(selectedNode.path)!)
                          .reviewTitle
                      : undefined
                  }
                  locked={isPathCleanupLocked(
                    selectedNode.path,
                    cleanupLocks,
                    platform.os
                  )}
                  lockLabel={
                    cleanupLockForPath(
                      selectedNode.path,
                      cleanupLocks,
                      platform.os
                    )?.label
                  }
                  restriction={
                    cleanupRestriction(selectedNode)
                      ? language.t(cleanupRestriction(selectedNode)!)
                      : undefined
                  }
                  accessState={
                    selectedAccess?.path === selectedNode.path
                      ? selectedAccess.state
                      : "not-checked"
                  }
                  onCheckAccess={() => cleanupPolicy.retry()}
                  trashName={nativeTrashName(platform.os)}
                  revealLabel={nativeRevealLabel(platform.os)}
                  onPreview={
                    selectedNode.isOther || selectedNode.isHidden
                      ? undefined
                      : () => void preview.show(selectedNode)
                  }
                  onQuickLook={
                    preview.supportsSystemPreview() &&
                    !selectedNode.isOther &&
                    !selectedNode.isHidden
                      ? () => void preview.openSystemPreview(selectedNode)
                      : undefined
                  }
                  onReveal={() => void reveal(selectedNode.path)}
                  onOpen={
                    isDeveloperInventoryNode(selectedNode)
                      ? () => void reveal(selectedNode.path)
                      : () => drill(selectedNode)
                  }
                  openLabel={
                    isDeveloperInventoryNode(selectedNode)
                      ? nativeRevealLabel(platform.os)
                      : undefined
                  }
                  onCollect={() =>
                    coveringCollectedNode(selectedNode.path)
                      ? collectionSurface.open()
                      : toggleCollect(selectedNode)
                  }
                  onTrash={() => requestDelete(selectedNode)}
                  onToggleLock={
                    deleting || selectedNode.isOther || selectedNode.isHidden
                      ? undefined
                      : () =>
                          void toggleProtectedTree(
                            selectedNode.path,
                            selectedNode.name
                          )
                  }
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}
