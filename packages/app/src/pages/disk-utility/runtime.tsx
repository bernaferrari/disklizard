import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { Accessor, ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import {
  diskCleanupLocksDefault,
  diskPinnedLocationsDefault,
  type DiskAccessGuidanceKey,
  type DiskCleanupLock,
  type DiskPinnedLocation,
  type DiskUtilityAPI,
} from "./types"

export type DiskLizardOS = "macos" | "windows" | "linux"

export type DiskLizardUpdaterState =
  | { status: "disabled" }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "downloading"; version: string; percent?: number }
  | { status: "ready"; version: string }
  | { status: "up-to-date" }
  | { status: "installing"; version: string }
  | { status: "error"; message: string }

export type DiskLizardMenu = {
  register(id: string, handler: () => unknown): () => void
  run(id: string): unknown
}

export function createDiskLizardMenu(): DiskLizardMenu {
  const handlers = new Map<string, () => unknown>()
  return {
    register(id, handler) {
      handlers.set(id, handler)
      return () => {
        if (handlers.get(id) === handler) handlers.delete(id)
      }
    },
    run(id) {
      return handlers.get(id)?.()
    },
  }
}

export type DiskLizardPlatform = {
  platform: "desktop"
  os?: DiskLizardOS
  version?: string
  diskUtility: DiskUtilityAPI
  menu?: DiskLizardMenu
  openPath?: (path: string) => Promise<void>
  getPathForFile?: (file: File) => string
  storage?: (name?: string) => SyncStorage | AsyncStorage
  updater?: {
    state: Accessor<DiskLizardUpdaterState>
    check(): Promise<DiskLizardUpdaterState>
    install(): Promise<void>
  }
  restart?: () => Promise<void>
  openExternal?: (url: string) => void
  revealPath?: (path: string) => Promise<boolean>
  windowFullscreen?: Accessor<boolean>
  dispose?: () => void
}

export const DISK_ACCESS_GUIDANCE: Record<DiskAccessGuidanceKey, string> = {
  "disk.accessGuidance.macos": "Grant Full Disk Access to DiskLizard in System Settings, then scan again.",
  "disk.accessGuidance.windows": "Use an account with access to this drive, or scan a folder your account can read.",
  "disk.accessGuidance.linux": "Review folder and mount permissions, then scan again.",
  "disk.accessGuidance.default": "Review access to these folders, then scan again.",
  "disk.accessGuidance.rescan": "Use Rescan in the top bar after changing access.",
}

export const DISK_LANGUAGE_TEXT = {
  ...DISK_ACCESS_GUIDANCE,
  "disk.brand": "DiskLizard",
  "disk.common.scan": "Scan",
  "disk.common.rescan": "Rescan",
  "disk.common.refresh": "Refresh",
  "disk.common.cancelScan": "Cancel scan",
  "disk.common.reveal": "Reveal",
  "disk.common.preview": "Preview",
  "disk.common.quickLook": "Quick Look",
  "disk.common.open": "Open",
  "disk.common.openFolder": "Open folder",
  "disk.common.recommendations": "Recommendations",
  "disk.common.review": "Review",
  "disk.common.back": "Back",
  "disk.common.net": "Net",
  "disk.common.complete": "Complete",
  "disk.common.partial": "Partial",
  "disk.common.volumes": "Volumes",
  "disk.common.saved": "Saved",
  "disk.common.saveLocation": "Save location",
  "disk.common.map": "Map",
  "disk.common.tiles": "Tiles",
  "disk.common.list": "List",
  "disk.common.all": "All",
  "disk.common.developer": "Developer",
  "disk.common.purgeable": "Purgeable",
  "disk.common.timeMachine": "Time Machine",
  "disk.common.days": "days",
  "disk.common.allEcosystems": "All ecosystems",
  "disk.common.errorDetail": "{message}",
  "disk.shortcut.keyC": "C",
  "disk.search.label": "Search this scan",
  "disk.search.placeholder": "Search names and paths",
  "disk.search.clear": "Clear filter",
  "disk.search.results": "Search results across this scan",
  "disk.sort.group": "Sort storage entries",
  "disk.sort.label": "Sort",
  "disk.sort.key.label": "Sort by",
  "disk.sort.key.size": "Size",
  "disk.sort.key.name": "Name",
  "disk.sort.key.modified": "Modified",
  "disk.sort.key.type": "Type",
  "disk.sort.direction.label": "Sort direction",
  "disk.sort.direction.ascending": "Ascending",
  "disk.sort.direction.descending": "Descending",
  "disk.history.heading": "Storage changes",
  "disk.history.summary": "Changes detected while this map is open",
  "disk.history.lens": "History",
  "disk.history.search": "Search change history",
  "disk.history.results": "Matching storage changes",
  "disk.history.empty.title": "No live changes yet",
  "disk.history.empty.filtered": "No matching changes",
  "disk.history.empty.body": "Changes detected while this map stays open will appear here.",
  "disk.history.events": "events",
  "disk.history.changes": "changes",
  "disk.history.clear": "Clear history",
  "disk.history.list": "Storage change history",
  "disk.history.net": "Net",
  "disk.history.kind.added": "Added",
  "disk.history.kind.removed": "Removed",
  "disk.history.kind.changed": "Changed",
  "disk.history.eventSummary": "{events} · {changes}",
  "disk.history.netValue": "Net {value}",
  "disk.history.changeSummary": "{changes} · {summary}",
  "disk.drop.title": "Drop to scan",
  "disk.drop.body": "Folders, volumes, and individual files are supported.",
  "disk.top.backToVolumes": "Back to volumes",
  "disk.top.currentLocation": "Current location",
  "disk.top.save": "Save this scan location",
  "disk.top.unsave": "Remove this saved location",
  "disk.top.protect": "Protect this tree from cleanup",
  "disk.top.unprotect": "Allow cleanup in this tree",
  "disk.top.rescan": "Rescan this location",
  "disk.top.openDesktop": "Open DiskLizard on desktop",
  "disk.top.scannerDisconnected": "Scanner disconnected",
  "disk.top.desktopBody": "Reading storage requires the secure desktop scanner.",
  "disk.top.disconnectedBody": "The secure desktop bridge is unavailable. Reopen DiskLizard to reconnect it.",
  "disk.map.label": "Storage map for {label}. Select an item to inspect it; use the results list to browse every item.",
  "disk.map.role": "interactive storage map",
  "disk.map.instructions": "Click once to select an item and double-click a folder to open it. Drag a folder to the review area to select it. Use the Up and Down arrow keys to select an item, Home, End, or Page Up and Page Down to move through the list, Enter or Right Arrow to open a folder, Space to preview it, C to add it to review, and Escape or Left Arrow to move up one level. The results list contains an accessible entry for every item in this map.",
  "disk.shortcuts.show": "Show keyboard shortcuts",
  "disk.shortcuts.heading": "Keyboard shortcuts",
  "disk.shortcuts.navigation": "↑ / ↓ select · Shift+↑ / ↓ adds a range to review · Home / End and Pg↑ / Pg↓ jump",
  "disk.shortcuts.open": "← / Escape goes up · → / Enter opens · Space previews · C selects for review · L protects from cleanup",
  "disk.shortcuts.openMac": "← / Escape goes up · → / Enter opens · Space previews with Quick Look · C selects for review · L protects from cleanup",
  "disk.shortcuts.views": "1 Map · 2 Tiles · 3 List · {modifier}-click reveals",
  "disk.explore.heading": "Explore this scan",
  "disk.explore.choose": "Choose what to show",
  "disk.explore.developerCategories": "Developer categories",
  "disk.explore.categoryDescription": "{label}. {description}. {size}",
  "disk.explore.fileSize": "file size",
  "disk.explore.physicalUnverified": "physical allocation · shared blocks unverified",
  "disk.explore.diskSpaceUsed": "disk space used",
  "disk.explore.physicalLabel": "Physical storage accounting is unverified",
  "disk.explore.physicalPaused": "Physical reclaim estimate paused",
  "disk.explore.totalsLow": "Totals may be low",
  "disk.explore.openPrivacy": "Open privacy settings",
  "disk.explore.unreadableList": "Unreadable locations sampled during this scan",
  "disk.explore.showingUnreadable": "Showing 5 of {count} locations",
  "disk.explore.selectTitle": "Select an item to inspect it",
  "disk.explore.selectBody": "Select an item, then press C or drag it here to review it",
  "disk.explore.unverifiedExcluded": "One or more summarized, excluded, or unreadable branches may hide shared storage. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space.",
  "disk.explore.unverifiedRelationships": "This map cannot verify that all shared-storage relationships are visible. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space.",
  "disk.explore.unverifiedScanner": "The native metadata scanner was unavailable for this map. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space until clone sharing can be verified.",
  "disk.explore.unverifiedMetadata": "The filesystem could not confirm enough clone metadata for this map. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space.",
  "disk.explore.unverifiedDefault": "This map does not include verified clone metadata. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space.",
  "disk.explore.developerFiles": "Developer files",
  "disk.explore.recommendationsScan": "Recommendations across this scan",
  "disk.explore.folderContents": "Folder contents",
  "disk.explore.summary": "{count} · {basis}",
  "disk.explore.reclaimWait": "Reclaim estimates wait for verified clone metadata.",
  "disk.explore.allDeveloper": "All developer files",
  "disk.explore.inspectHint": "Inspect this folder before changing it",
  "disk.explore.nestedCategories": " · {size} including nested categories",
  "disk.explore.lastChanged": "Last changed {date}",
  "disk.explore.removeReview": "Remove {name} from review",
  "disk.explore.selectReview": "Select {name} for review",
  "disk.explore.unreadable": "{count} unreadable {locations}",
  "disk.explore.locationNoun.one": "location",
  "disk.explore.locationNoun.other": "locations",
  "disk.developer.category.dependencies": "Dependencies",
  "disk.developer.category.buildOutput": "Build output",
  "disk.developer.category.toolchainCache": "Toolchains & caches",
  "disk.developer.category.agentData": "Coding agents",
  "disk.developer.category.worktree": "Worktrees",
  "disk.developer.category.versionControl": "Version history",
  "disk.collection.label": "Selected items for review",
  "disk.collection.release": "Release to select {name} for review",
  "disk.collection.drag": "Drag {name} here to select it",
  "disk.collection.none": "Select items to review",
  "disk.collection.selectedRebuild": "{size} selected size · Full map rebuild after move",
  "disk.collection.selectedApprove": "{size} · Nothing moves until you approve it",
  "disk.collection.reviewTrash": "{size} · Review before moving anything to {trash}",
  "disk.collection.instructions": "Press C, Shift+Arrow, or drag · Nothing moves until you approve it",
  "disk.collection.clear": "Clear review",
  "disk.collection.reviewSelected": "Review selected",
  "disk.collection.shortcutC": "Keyboard shortcut C",
  "disk.collection.noneStatus": "No items selected for review",
  "disk.developer.policy.heading": "Smart cleanup policy",
  "disk.developer.age.any": "Any age",
  "disk.developer.age.30": "30d+",
  "disk.developer.age.60": "60d+",
  "disk.developer.age.90": "90d+",
  "disk.developer.age.180": "180d+",
  "disk.developer.age.custom": "Custom",
  "disk.developer.policy.body": "Find rebuildable or redownloadable developer storage by modification date. This is not evidence that a folder was last used then.",
  "disk.developer.policy.minimum": "Minimum unchanged time",
  "disk.developer.policy.toolchain": "Language & toolchain",
  "disk.developer.policy.toolchainLabel": "Language and toolchain",
  "disk.developer.policy.customPrefix": "Unchanged for at least",
  "disk.developer.policy.customLabel": "Custom unchanged time in days",
  "disk.developer.policy.inventoryLabel": "Deep developer artifact inventory. {coverage}",
  "disk.developer.policy.inventoryHeading": "Deep artifact inventory · {state}",
  "disk.developer.policy.coverageDetails": "Coverage details",
  "disk.developer.policy.cap": "Results are capped at {count} retained items. Matching continues for coverage accounting, but paths beyond the cap are not listed.",
  "disk.developer.policy.samplePaths": "{label} sampled paths",
  "disk.developer.policy.select": "Select eligible for review",
  "disk.developer.policy.requiresVerified": "A verified storage map is required before bulk selection.",
  "disk.developer.policy.bulkWaits": "Bulk selection waits for a verified storage map.",
  "disk.developer.policy.noneEligible": "No automatically eligible results in this policy. Other artifacts remain inspectable.",
  "disk.developer.policy.noneMatch": "No developer artifacts match this policy.",
  "disk.developer.policy.status": "{eligible} · {size}{excluded} · modified time is not last-used time",
  "disk.developer.policy.excluded": " · {count} not auto-selected",
  "disk.developer.inventory.complete": "Complete · {observed}",
  "disk.developer.inventory.partial": "Partial · {observed}{gaps}",
  "disk.developer.inventory.observed": "{artifacts} found across {folders}",
  "disk.developer.inventory.incomplete": " · scanner reported an incomplete scope",
  "disk.developer.inventory.capGap": "kept {count} at the {max}-item cap",
  "disk.developer.inventory.unreadableGap": "{count} unreadable",
  "disk.developer.inventory.excludedGap": "{count} excluded",
  "disk.developer.inventory.issueUnreadable": "Unreadable folders",
  "disk.developer.inventory.issueExcluded": "Excluded folders",
  "disk.developer.inventory.issueSymlinks": "Skipped symlinks",
  "disk.developer.inventory.issueFolders": "Skipped folders (other device, cycle, or unavailable identity)",
  "disk.developer.inventory.issueRefresh": "Retained artifacts needing a fresh scan before Trash",
  "disk.detail.more": "More",
  "disk.detail.moreFor": "More actions for {name}",
  "disk.detail.revealManager": "Reveal in file manager",
  "disk.detail.moveTo": "Move to {trash}",
  "disk.detail.under": "Under {name}",
  "disk.detail.protected": "Protected",
  "disk.detail.protect": "Protect",
  "disk.detail.selectedReview": "Selected for review",
  "disk.detail.selectReview": "Select for review",
  "disk.detail.selected": "Selected",
  "disk.detail.allowCleanup": "Allow cleanup",
  "disk.detail.protectCleanup": "Protect from cleanup",
  "disk.dialog.collection.heading": "Review selected items",
  "disk.dialog.collection.summary": "{size} across {count}",
  "disk.dialog.collection.selectedSizes": "Selected file sizes: {summary}",
  "disk.dialog.collection.itemsLabel": "Items selected for review",
  "disk.dialog.collection.body": "Check every item before anything leaves its original location.",
  "disk.dialog.collection.deepWarning": "A selected path changes data represented by the deep artifact inventory. It can move to {trash}, but its displayed size is not a reclaim estimate. DiskLizard will rebuild the full map afterward.",
  "disk.dialog.collection.sharedWarning": "Some selected paths share physical storage through APFS clones or hard links. They can move to {trash}, but their displayed allocation is not a promise of freed disk space. DiskLizard will recompute the map afterward.",
  "disk.dialog.collection.unverifiedWarning": "This scan could not verify filesystem clone metadata. The paths can move to {trash}, but their displayed allocation is not a promise of freed disk space. DiskLizard will refresh the map afterward.",
  "disk.dialog.collection.close": "Close selected-item review",
  "disk.dialog.collection.quickLook": "Quick Look {name}",
  "disk.dialog.collection.remove": "Remove {name} from review",
  "disk.dialog.collection.moving": "Moving {current} of {total}",
  "disk.dialog.collection.movingCompact": "Moving {current}/{total}…",
  "disk.dialog.restore.rebuild": "Items can be restored from {trash}. DiskLizard will rebuild the full map after the move.",
  "disk.dialog.restore.recompute": "Items can be restored from {trash}. Storage allocation will be recomputed after the move.",
  "disk.dialog.restore.space": "Items can be restored from {trash}. Space is freed after you empty it.",
  "disk.dialog.reclaim.summary": "{count} worth reviewing",
  "disk.dialog.reclaim.itemsLabel": "Recommended items",
  "disk.dialog.reclaim.remove": "Remove {name} from review",
  "disk.dialog.reclaim.select": "Select {name} for review",
  "disk.dialog.reclaim.body": "DiskLizard thinks these can usually be recreated or downloaded again. They are recommendations, not permission—select only the items you want to review.",
  "disk.dialog.reclaim.close": "Close review",
  "disk.dialog.reclaim.action": "{action} · Nothing moves until you review the selected items",
  "disk.dialog.reclaim.selectAll": "Select all for review",
  "disk.dialog.delete.heading": "Confirm removal",
  "disk.dialog.delete.prompt": "Move this item to {trash}?",
  "disk.dialog.delete.selectedSize": "Selected file size: {size}",
  "disk.dialog.delete.restoreRebuild": "You can restore it from {trash}. DiskLizard will rebuild the full map after the move.",
  "disk.dialog.delete.restoreRecompute": "You can restore it from {trash}. Storage allocation will be recomputed after the move.",
  "disk.dialog.delete.restoreSpace": "You can restore it from {trash}. Space is freed after you empty it.",
  "disk.dialog.delete.deepWarning": "This path changes data represented by the deep artifact inventory. Moving it does not make its displayed size a reclaim promise; DiskLizard will rebuild the full map afterward.",
  "disk.dialog.delete.sharedWarning": "This path shares physical storage through an APFS clone or hard link. Moving it does not guarantee that its displayed bytes become free; DiskLizard will recompute shared storage afterward.",
  "disk.dialog.delete.unverifiedWarning": "This scan could not verify filesystem clone metadata. Moving the path does not guarantee that its displayed bytes become free; DiskLizard will refresh the map afterward.",
  "disk.dialog.delete.keep": "Keep it",
  "disk.dialog.delete.moving": "Moving…",
  "disk.preview.tooLarge.title": "This file is too large for instant preview",
  "disk.preview.tooLarge.body": "DiskLizard bounds embedded previews to keep inspection fast and memory use predictable. Open it in its default app or Quick Look instead.",
  "disk.preview.binary.title": "This file contains binary data",
  "disk.preview.binary.body": "Open it in its default application to inspect it safely.",
  "disk.preview.unsupported.title": "Preview is not available for this format",
  "disk.preview.unsupported.body": "DiskLizard previews common images, source code, configuration, logs, and plain-text files.",
  "disk.preview.heading": "Quick preview",
  "disk.preview.close": "Close preview",
  "disk.preview.loading": "Loading preview…",
  "disk.preview.readError": "DiskLizard could not read this file",
  "disk.preview.folderSummary": "Folder summary",
  "disk.preview.folderCount": "{count} immediate {items} · {size} in this scanned folder.",
  "disk.preview.folderBody": "This summary uses the current scan only. Open the folder to browse its map, or use Quick Look for the system view.",
  "disk.preview.largest": "Largest visible items",
  "disk.preview.total": "{count} total",
  "disk.preview.lines": "{count} lines shown",
  "disk.preview.truncated": "Preview truncated",
  "disk.preview.textLabel": "Text preview of {name}",
  "disk.preview.imageLabel": "Preview of {name}",
  "disk.preview.pdfLabel": "PDF preview of {name}",
  "disk.preview.navigation": "Preview navigation",
  "disk.preview.previous": "Preview previous file",
  "disk.preview.position": "{current} of {total}",
  "disk.preview.next": "Preview next file",
  "disk.preview.folder": "Folder",
  "disk.preview.local": "Read locally · Nothing uploaded",
  "disk.preview.changedLocal": "{changed} · Nothing uploaded",
  "disk.preview.openDefault": "Open in default app",
  "disk.scan.label": "Scanning {label}",
  "disk.scan.scanning": "Scanning",
  "disk.scan.readOnly": "Read-only",
  "disk.scan.noChanges": "No files are changed",
  "disk.scan.filesScanned": "Files scanned",
  "disk.scan.elapsed": "Elapsed",
  "disk.scan.elapsedSeconds": "{seconds}s",
  "disk.scan.elapsedMinutes": "{minutes}m {seconds}s",
  "disk.scan.scanningNow": "Scanning now",
  "disk.scan.starting": "Starting scan…",
  "disk.scan.building": "Building your storage map",
  "disk.scan.buildingBody": "DiskLizard is measuring every readable file and folder. The map opens when the scan finishes.",
  "disk.scan.status": "Scanning {label}. {files} files scanned. Use Cancel scan to stop.",
  "disk.scan.scanned": "scanned",
  "disk.scan.fileCount": "{count} files",
  "disk.apfs.unnamed": "Unnamed APFS snapshot",
  "disk.apfs.noIdentity.one": "1 APFS snapshot is present; macOS did not provide an identity.",
  "disk.apfs.noIdentity.other": "{count} APFS snapshots are present; macOS did not provide identities.",
  "disk.apfs.showing": "{count} APFS snapshots are present; showing {visible} read-only identities.",
  "disk.apfs.present.one": "1 APFS snapshot is present.",
  "disk.apfs.present.other": "{count} APFS snapshots are present.",
  "disk.apfs.body": "macOS does not report reliable per-snapshot bytes when copy-on-write blocks are shared. These identities are read-only evidence, not a size estimate or a deletion action.",
  "disk.apfs.observed": "Observed APFS snapshots",
  "disk.apfs.evidence": "APFS snapshot evidence",
  "disk.apfs.heading": "APFS snapshots",
  "disk.apfs.counts": "{purgeable} · {timeMachine}",
  "disk.accounting.label": "Storage accounting details",
  "disk.accounting.fileSize": "File size {size}",
  "disk.accounting.fileSizeDetail": "This item occupies {size} in the current scan but has an apparent length of {logicalSize}.",
  "disk.accounting.hardLink": "Shared hard link",
  "disk.accounting.hardLinkDetail": "This pathname shares the same allocation as an earlier hard link, so it is not charged a second time.",
  "disk.accounting.clonePrimary": "Clone group charged once",
  "disk.accounting.clonePrimaryDetail": "Every full clone in this group was observed by the scan. This pathname carries the shared allocation exactly once; the other clone paths retain their apparent file size.",
  "disk.accounting.cloneSecondary": "Clone allocation counted once",
  "disk.accounting.cloneSecondaryDetail": "Every full clone in this group was observed by the scan. Its shared allocation is charged to the canonical clone, so this pathname adds no extra physical bytes.",
  "disk.accounting.cloneMaybe": "APFS clone may share blocks",
  "disk.accounting.cloneMaybeDetail": "The filesystem reports possible shared blocks. DiskLizard does not guess which bytes belong to this pathname.",
  "disk.accounting.cloneShares": "APFS clone shares blocks",
  "disk.accounting.cloneSharesCount": "The filesystem reports {count} full clones. Byte ownership stays explicit unless every member is present in this scan.",
  "disk.accounting.cloneSharesDetail": "The filesystem reports that this file shares all of its blocks with a clone.",
  "disk.storage.connected": "Connected storage",
  "disk.storage.mountedMac": "Already mounted on this Mac",
  "disk.storage.accessTitle": "Some protected folders could not be read",
  "disk.storage.accessBody": "DiskLizard observed an OS permission denial. Open privacy settings to review access, then rescan—access is never assumed.",
  "disk.storage.accessWindowsBody": "DiskLizard is not running with an elevated Windows token, so protected locations may be missing from whole-volume scans.",
  "disk.storage.accessUnknownTitle": "Whole-volume access could not be verified",
  "disk.storage.accessUnknownBody": "DiskLizard could not confirm whether permission-protected locations are readable. Scan results remain inspectable, but treat coverage as potentially incomplete.",
  "disk.storage.scanLocation": "Scan {name}, {provider}",
  "disk.storage.provider.googleDrive": "Google Drive",
  "disk.storage.provider.icloud": "iCloud Drive",
  "disk.storage.provider.onedrive": "OneDrive",
  "disk.storage.provider.network": "Network location",
  "disk.storage.provider.other": "Cloud storage",
  "disk.treemap.label": "Tile view of this folder. Small items remain available in the list.",
  "disk.treemap.openList": "Open full list",
  "disk.treemap.moreLabel": "{name}, open the full list",
  "disk.treemap.folderLabel": "{name}, select for details. Press Enter to open the folder.",
  "disk.treemap.fileLabel": "{name}, select for details. Press Space to preview.",
  "disk.virtual.entries": "Storage entries",
  "disk.drive.volumes": "Volumes",
  "disk.drive.protected": "Protected from cleanup",
  "disk.drive.lockHint": "L locks the selected item",
  "disk.drive.saved": "Saved locations",
  "disk.drive.deviceOnly": "This device only",
  "disk.drive.scanFolder": "Scan Folder…",
  "disk.drive.reading": "Reading volumes",
  "disk.drive.readFailed": "Volumes could not be read",
  "disk.drive.none": "No volumes yet",
  "disk.drive.pickFolder": "Pick a folder and DiskLizard will map it without changing a thing.",
  "disk.drive.emptyFiltered": "Nothing matches these filters",
  "disk.drive.emptyFolder": "This folder is empty",
  "disk.drive.clearFilters": "Clear the filters to show every item in this folder.",
  "disk.drive.noItems": "There are no files or folders here.",
  "disk.drive.showEverything": "Show everything",
  "disk.drive.ofLevel": "of this level",
  "disk.drive.inventoryOnly": "Deep inventory result · review it from the results list. It can’t be opened in the map.",
  "disk.drive.allowCleanup": "Allow cleanup in {name}",
  "disk.drive.action.cancel": "Cancel",
  "disk.drive.action.view": "View",
  "disk.drive.action.retry": "Retry",
  "disk.drive.kind.removable": "removable disk",
  "disk.drive.kind.network": "network volume",
  "disk.drive.ready": "Ready",
  "disk.drive.stopped": "Scan stopped",
  "disk.drive.restored": "Restored local map",
  "disk.drive.updated": "Updated cached map",
  "disk.drive.mapReady": "Map ready",
  "disk.drive.startup": "startup disk",
  "disk.drive.sharedContainerFree": "{size} shared container free",
  "disk.drive.scanningSummary": "{files} files · {bytes}",
  "disk.drive.completedTitle": "Completed in {duration} at {rate}",
  "disk.drive.scanLimit": "Three scans are already running",
  "disk.drive.cancelLabel": "Cancel scan of {name}",
  "disk.drive.viewLabel": "View map of {name}",
  "disk.drive.scanLabel": "Scan {name}",
  "disk.drive.scanFreeLabel": "Scan {name}, {free} left",
  "disk.drive.reviewLabel": "Review {bytes} across {count} recommendations",
  "disk.pinned.remove": "Remove {name} from saved locations",
  "disk.toast.livePaused": "Live updates paused",
  "disk.toast.livePausedBody": "{message} Use Rescan to refresh this map now.",
  "disk.toast.listFailed": "Could not list drives",
  "disk.toast.noPrivacy": "No privacy settings page is available on this platform",
  "disk.toast.privacyFailed": "Could not open privacy settings",
  "disk.toast.scanLimit": "Three scans are already running",
  "disk.toast.scanLimitBody": "Let one finish or cancel it before starting another.",
  "disk.toast.driveReady": "{name} is ready",
  "disk.toast.driveReadyBody": "Open its storage map when you’re ready.",
  "disk.toast.scanFailed": "Scan failed",
  "disk.toast.openFailed": "Could not open {name}",
  "disk.toast.savedFull": "Saved locations are full",
  "disk.toast.savedFullBody": "Remove a saved location before adding another.",
  "disk.toast.savedRemoved": "Removed from saved locations",
  "disk.toast.savedAdded": "Location saved",
  "disk.toast.protectedFull": "Protected trees are full",
  "disk.toast.protectedFullBody": "Unlock a tree before protecting another.",
  "disk.toast.cleanupUnlocked": "Cleanup unlocked",
  "disk.toast.cleanupProtected": "Protected from cleanup",
  "disk.toast.cleanupUnlockedBody": "{name} can be included in cleanup actions again.",
  "disk.toast.cleanupProtectedBody": "{name} and everything inside it are excluded from cleanup actions.",
  "disk.toast.cleanupUnlockedBodyLegacy": "{name} can be reviewed again.",
  "disk.toast.cleanupProtectedBodyLegacy": "{name} stays on the map, but it will not go to review or Trash.",
  "disk.toast.revealFailed": "Could not reveal",
  "disk.toast.openFileFailed": "Could not open file",
  "disk.toast.quickLookFailed": "Could not open Quick Look",
  "disk.toast.trashOpenFailed": "Could not open {trash}",
  "disk.toast.moved": "Moved to {trash}",
  "disk.toast.showTrash": "Show in {trash}",
  "disk.toast.deleteFailed": "Delete failed",
  "disk.toast.protectedItem": "Protected item",
  "disk.toast.artifactChanged": "Artifact changed — rescan required",
  "disk.toast.rescanRemoval": "Rescan required before removal",
  "disk.toast.readDroppedFailed": "Could not read dropped item",
  "disk.toast.scanningFirstDrop": "Scanning the first dropped item",
  "disk.toast.persistenceFailed": "Could not save DiskLizard settings",
  "disk.toast.listingDrives": "Listing drives",
  "disk.toast.checkingStorage": "Checking connected storage",
  "disk.toast.refreshingTotals": "Refreshing drive totals",
  "disk.toast.folderChanged": "The folder changed while it was being scanned. Try opening it again.",
  "disk.toast.authorizationMismatch": "Delete authorization did not match the reviewed item.",
  "disk.toast.deepIdentity": "Deep inventory result requires a fresh directory identity before removal.",
  "disk.toast.movedRebuild": "{name} moved. Rebuilding the full map before reporting disk space.",
  "disk.toast.movedRecompute": "{name} moved. Recomputing storage allocation before reporting free space.",
  "disk.toast.protectedBody": "DiskLizard protects system paths, configuration-bearing developer data, worktrees, and version history from direct removal.",
  "disk.toast.changedBody": "{name} no longer matches the deep artifact result that was reviewed. Rebuild the full map, then review it again before moving it to {trash}.",
  "disk.toast.missingIdentityBody": "{name} does not have a current deep-scan directory identity. Rebuild the full map, then review it again before moving it to {trash}.",
  "disk.toast.movedItems": "Moved {items} to {trash}",
  "disk.toast.movedBytes": "Moved {bytes} to {trash}",
  "disk.toast.batchDeep": "A selected path changed the deep artifact inventory. DiskLizard is rebuilding the full map before reporting disk space.",
  "disk.toast.batchShared": "Some paths share file allocation. DiskLizard is recomputing the map before reporting allocation.",
  "disk.toast.batchUnverified": "This scan could not verify shared file allocation. DiskLizard is recomputing the map before reporting allocation.",
  "disk.toast.batchMoved": "{items} moved to {trash}",
} as const

export const DISK_LANGUAGE_PLURALS = {
  "disk.count.event": { one: "{count} event", other: "{count} events" },
  "disk.count.change": { one: "{count} change", other: "{count} changes" },
  "disk.count.item": { one: "{count} item", other: "{count} items" },
  "disk.count.itemNoun": { one: "item", other: "items" },
  "disk.drive.itemCount": { one: "1 item", other: "{formattedCount} items" },
  "disk.count.itemSelected": { one: "{count} item selected for review", other: "{count} items selected for review" },
  "disk.count.artifact": { one: "{count} artifact", other: "{count} artifacts" },
  "disk.count.folder": { one: "{count} folder", other: "{count} folders" },
  "disk.count.symlinkSkipped": { one: "{count} symlink skipped", other: "{count} symlinks skipped" },
  "disk.count.folderSkipped": {
    one: "{count} folder skipped (other device, cycle, or unavailable identity)",
    other: "{count} folders skipped (other device, cycle, or unavailable identity)",
  },
  "disk.count.artifactRefresh": {
    one: "{count} retained artifact needs a fresh scan before Trash",
    other: "{count} retained artifacts need a fresh scan before Trash",
  },
  "disk.count.removalFailed": {
    one: "{count} item could not be removed",
    other: "{count} items could not be removed",
  },
  "disk.count.recommendation": { one: "{count} recommendation", other: "{count} recommendations" },
  "disk.count.locationNoun": { one: "location", other: "locations" },
  "disk.apfs.purgeableCount": { one: "1 purgeable", other: "{count} purgeable" },
  "disk.apfs.timeMachineCount": { one: "1 Time Machine", other: "{count} Time Machine" },
} as const

export type DiskLanguageKey = keyof typeof DISK_LANGUAGE_TEXT
export type DiskLanguagePluralKey = keyof typeof DISK_LANGUAGE_PLURALS

type Placeholder<S extends string> = S extends `${string}{${infer Name}}${infer Rest}` ? Name | Placeholder<Rest> : never
type TextParams<Key extends DiskLanguageKey> = Record<Placeholder<(typeof DISK_LANGUAGE_TEXT)[Key]>, string | number>
type TextArgs<Key extends DiskLanguageKey> = [Placeholder<(typeof DISK_LANGUAGE_TEXT)[Key]>] extends [never]
  ? []
  : [params: TextParams<Key>]
type PluralTemplate<Key extends DiskLanguagePluralKey> =
  | (typeof DISK_LANGUAGE_PLURALS)[Key]["one"]
  | (typeof DISK_LANGUAGE_PLURALS)[Key]["other"]
type PluralParams<Key extends DiskLanguagePluralKey> = Record<
  Exclude<Placeholder<PluralTemplate<Key>>, "count">,
  string | number
>
type PluralArgs<Key extends DiskLanguagePluralKey> = [Exclude<Placeholder<PluralTemplate<Key>>, "count">] extends [never]
  ? []
  : [params: PluralParams<Key>]

function interpolate(template: string, params: Readonly<Record<string, string | number>>) {
  return template.replace(/\{([^}]+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

export function diskLanguageText<Key extends DiskLanguageKey>(key: Key, ...args: TextArgs<Key>) {
  return interpolate(DISK_LANGUAGE_TEXT[key], args[0] ?? {})
}

export function diskLanguagePlural<Key extends DiskLanguagePluralKey>(
  key: Key,
  count: number,
  ...args: PluralArgs<Key>
) {
  const templates = DISK_LANGUAGE_PLURALS[key]
  return interpolate(count === 1 ? templates.one : templates.other, { count, ...(args[0] ?? {}) })
}

const PINNED_STORAGE_NAME = "disklizard.dat"
const PINNED_STORAGE_KEY = "pinned-locations"
const CLEANUP_LOCK_STORAGE_KEY = "cleanup-locks"

function parsePathList<T extends { path: string; label: string }>(raw: string | null | undefined): T[] | undefined {
  if (!raw) return
  try {
    const value = JSON.parse(raw) as unknown
    if (!Array.isArray(value)) return
    const locations = value.filter(
      (item): item is T =>
        !!item && typeof item === "object" && typeof item.path === "string" && typeof item.label === "string",
    )
    return locations
  } catch {
    return
  }
}

export const { use: usePlatform, provider: DiskLizardPlatformProvider } = createSimpleContext({
  name: "DiskLizardPlatform",
  init: (props: { value: DiskLizardPlatform }) => props.value,
})

export function useLanguage() {
  return {
    t: diskLanguageText,
    plural: diskLanguagePlural,
  }
}

type DiskSettingsStorage = SyncStorage | AsyncStorage

function storageErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function createDiskSettings(storage?: DiskSettingsStorage) {
  const [state, setState] = createStore({
    locations: [...diskPinnedLocationsDefault] as DiskPinnedLocation[],
    locks: [...diskCleanupLocksDefault] as DiskCleanupLock[],
    persistenceError: undefined as string | undefined,
  })
  let pinsRevision = 0
  let locksRevision = 0
  let writes = Promise.resolve()

  const read = async <T extends { path: string; label: string }>(
    key: string,
    revision: number,
    currentRevision: () => number,
    apply: (value: T[]) => void,
  ) => {
    if (!storage) return
    try {
      const parsed = parsePathList<T>(await storage.getItem(key))
      if (parsed && revision === currentRevision()) apply(parsed)
    } catch (error) {
      setState("persistenceError", storageErrorMessage(error))
    }
  }

  const ready = Promise.all([
    read<DiskPinnedLocation>(
      PINNED_STORAGE_KEY,
      pinsRevision,
      () => pinsRevision,
      (value) => setState("locations", value),
    ),
    read<DiskCleanupLock>(
      CLEANUP_LOCK_STORAGE_KEY,
      locksRevision,
      () => locksRevision,
      (value) => setState("locks", value),
    ),
  ]).then(() => undefined)

  const write = (key: string, value: unknown) => {
    if (!storage) return Promise.resolve()
    writes = writes.then(async () => {
      try {
        await storage.setItem(key, JSON.stringify(value))
        setState("persistenceError", undefined)
      } catch (error) {
        setState("persistenceError", storageErrorMessage(error))
      }
    })
    return writes
  }

  const persistPins = (next: DiskPinnedLocation[]) => {
    pinsRevision += 1
    setState("locations", next)
    return write(PINNED_STORAGE_KEY, next)
  }
  const persistLocks = (next: DiskCleanupLock[]) => {
    locksRevision += 1
    setState("locks", next)
    return write(CLEANUP_LOCK_STORAGE_KEY, next)
  }

  return {
    ready,
    general: {
      diskPinnedLocations: () => state.locations,
      setDiskPinnedLocations: persistPins,
      diskCleanupLocks: () => state.locks,
      setDiskCleanupLocks: persistLocks,
      persistenceError: () => state.persistenceError,
    },
  }
}

export function createPersistenceErrorDeduper() {
  let previous: string | undefined
  return (error: string | undefined) => {
    if (!error) {
      previous = undefined
      return
    }
    if (error === previous) return
    previous = error
    return error
  }
}

export function useSettings() {
  const platform = usePlatform()
  return createDiskSettings(platform.storage?.(PINNED_STORAGE_NAME))
}

export function DiskLizardRuntime(props: ParentProps<{ platform: DiskLizardPlatform }>) {
  return <DiskLizardPlatformProvider value={props.platform}>{props.children}</DiskLizardPlatformProvider>
}
