import { createSimpleContext } from "@opencode-ai/ui/context"
import type { AsyncStorage, SyncStorage } from "@solid-primitives/storage"
import type { Accessor, ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import {
  DESKTOP_NATIVE_LOCALE_TAGS,
  resolveDiskLizardReleaseLocale,
  type DesktopNativeLocale,
} from "../../i18n/desktop-native"
import {
  diskCleanupLocksDefault,
  diskPinnedLocationsDefault,
  type DiskAccessGuidanceKey,
  type DiskCleanupLock,
  type DiskPinnedLocation,
  type DiskUtilityAPI,
} from "./types"
import { DISK_RECOGNITION_LANGUAGE_TEXT } from "./recognition-language"
import {
  CLEANUP_LOCK_LIMIT,
  decodeSavedPaths,
  PINNED_LOCATION_LIMIT,
  sanitizeSavedPaths,
  type SavedPath,
  type SavedPathOptions,
} from "./saved-paths"

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
  getPathForFile?: (file: File) => string
  storage?: (name?: string) => SyncStorage | AsyncStorage
  updater?: {
    state: Accessor<DiskLizardUpdaterState>
    check(): Promise<DiskLizardUpdaterState>
    install(): Promise<void>
  }
  restart?: () => Promise<void>
  exportDiagnostics?: () => Promise<string>
  openExternal?: (url: string) => void
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
  ...DISK_RECOGNITION_LANGUAGE_TEXT,
  ...DISK_ACCESS_GUIDANCE,
  "disk.brand": "DiskLizard",
  "disk.common.scan": "Scan",
  "disk.common.rescan": "Rescan",
  "disk.common.refresh": "Refresh",
  "disk.common.cancelScan": "Cancel scan",
  "disk.common.reveal": "Reveal",
  "disk.common.preview": "Preview",
  "disk.common.quickLook": "Quick Look",
  "disk.common.previewHere": "Preview in DiskLizard",
  "disk.common.open": "Open",
  "disk.common.openFolder": "Open folder",
  "disk.common.exploreFolder": "Explore folder",
  "disk.common.showMore": "Show more",
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
  "disk.common.contents": "Contents",
  "disk.common.developer": "Developer",
  "disk.common.cleanup": "Cleanup",
  "disk.common.purgeable": "Purgeable",
  "disk.common.timeMachine": "Time Machine",
  "disk.common.days": "days",
  "disk.common.allEcosystems": "All ecosystems",
  "disk.common.errorDetail": "{message}",
  "disk.common.trash": "Trash",
  "disk.common.recycleBin": "Recycle Bin",
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
  "disk.history.summary": "Live changes detected while this map is open",
  "disk.history.lens": "Changes",
  "disk.history.live": "Live activity",
  "disk.history.modifiedToday": "Modified today",
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
  "disk.drop.restingHint": "…or drop a folder anywhere in this window.",
  "disk.top.backToVolumes": "Back to volumes",
  "disk.top.previousLocation": "Previous location",
  "disk.top.nextLocation": "Next location",
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
  "disk.top.restart": "Restart DiskLizard",
  "disk.app.menu": "DiskLizard menu",
  "disk.app.about": "DiskLizard {version}",
  "disk.app.checkUpdates": "Check for updates",
  "disk.app.installUpdate": "Restart to install {version}",
  "disk.app.updateChecking": "Checking for updates…",
  "disk.app.updateDownloading": "Downloading {version}…",
  "disk.app.restart": "Restart DiskLizard",
  "disk.app.exportDiagnostics": "Export diagnostics…",
  "disk.app.updateReady": "Update ready",
  "disk.app.updateReadyBody": "Version {version} is ready to install.",
  "disk.app.upToDate": "DiskLizard is up to date",
  "disk.app.updateFailed": "Could not check for updates",
  "disk.app.diagnosticsSaved": "Diagnostics exported",
  "disk.app.diagnosticsSavedBody": "Saved to {path}",
  "disk.app.diagnosticsFailed": "Could not export diagnostics",
  "disk.map.label": "Storage map for {label}. Select an item to inspect it; use the results list to browse every item.",
  "disk.map.role": "interactive storage map",
  "disk.map.instructions":
    "Click once to select an item and double-click a folder to open it. Drag a folder to the review area to select it. Use the Up and Down arrow keys to select an item, Home, End, or Page Up and Page Down to move through the list, Enter or Right Arrow to open a folder, Space to preview it, C to add it to review, and Escape or Left Arrow to move up one level. The results list contains an accessible entry for every item in this map.",
  "disk.shortcuts.show": "Show keyboard shortcuts",
  "disk.shortcuts.heading": "Keyboard shortcuts",
  "disk.shortcuts.navigation": "↑ / ↓ select · Shift+↑ / ↓ adds a range to review · Home / End and Pg↑ / Pg↓ jump",
  "disk.shortcuts.history": "Alt+← / → moves through visited locations",
  "disk.shortcuts.open":
    "← / Escape goes up · → / Enter opens · Space previews · C selects for review · L protects from cleanup",
  "disk.shortcuts.openMac":
    "← / Escape goes up · → / Enter opens · Space previews with Quick Look · C selects for review · L protects from cleanup",
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
  "disk.explore.unverifiedExcluded":
    "One or more summarized, excluded, or unreadable branches may hide shared storage. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space.",
  "disk.explore.unverifiedRelationships":
    "This map cannot verify that all shared-storage relationships are visible. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space.",
  "disk.explore.unverifiedScanner":
    "The native metadata scanner was unavailable for this map. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space until clone sharing can be verified.",
  "disk.explore.unverifiedMetadata":
    "The filesystem could not confirm enough clone metadata for this map. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space.",
  "disk.explore.unverifiedDefault":
    "This map does not include verified clone metadata. File sizes remain visible, but DiskLizard will not estimate reclaimable disk space.",
  "disk.explore.developerFiles": "Developer files",
  "disk.explore.recommendationsScan": "Recommendations across this scan",
  "disk.explore.folderContents": "Folder contents",
  "disk.explore.summary": "{count} · {basis}",
  "disk.explore.reclaimWait": "Reclaim estimates wait for verified clone metadata.",
  "disk.explore.allDeveloper": "All developer files",
  "disk.explore.inspectHint": "Inspect this folder before changing it",
  "disk.explore.nestedCategories": " · {size} including nested categories",
  "disk.explore.lastChanged": "Last changed {date}",
  "disk.changed.unavailable": "Change date unavailable",
  "disk.changed.today": "Changed today",
  "disk.changed.yesterday": "Changed yesterday",
  "disk.changed.days": "Changed {count}d ago",
  "disk.changed.weeks": "Changed {count}w ago",
  "disk.changed.months": "Changed {count}mo ago",
  "disk.changed.years": "Changed {count}y ago",
  "disk.empty.search.title": "No matching files",
  "disk.empty.search.body": "Try another name or path, or return to all contents.",
  "disk.empty.developer.title": "No developer storage found",
  "disk.empty.developer.body":
    "DiskLizard did not recognize build output, dependencies, toolchain caches, or other developer artifacts in this scan.",
  "disk.empty.recommendations.title": "Nothing is ready for cleanup",
  "disk.empty.recommendations.body":
    "DiskLizard only recommends items when it can explain and verify why they are recoverable.",
  "disk.empty.recent.title": "Nothing was modified today",
  "disk.empty.recent.body": "No items in this scan have a modification date from today.",
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
  "disk.developer.policy.explanation": "How this works",
  "disk.developer.policy.body":
    "Find rebuildable or redownloadable developer storage by modification date. This is not evidence that a folder was last used then.",
  "disk.developer.policy.minimum": "Minimum unchanged time",
  "disk.developer.policy.toolchain": "Language & toolchain",
  "disk.developer.policy.toolchainLabel": "Language and toolchain",
  "disk.developer.policy.customPrefix": "Unchanged for at least",
  "disk.developer.policy.customLabel": "Custom unchanged time in days",
  "disk.developer.policy.inventoryLabel": "Deep developer artifact inventory. {coverage}",
  "disk.developer.policy.inventoryHeading": "Deep artifact inventory · {state}",
  "disk.developer.policy.coverageDetails": "Coverage details",
  "disk.developer.policy.cap":
    "Results are capped at {count} retained items. Matching continues for coverage accounting, but paths beyond the cap are not listed.",
  "disk.developer.policy.samplePaths": "{label} sampled paths",
  "disk.developer.policy.select": "Select eligible for review",
  "disk.developer.policy.requiresVerified": "A verified storage map is required before bulk selection.",
  "disk.developer.policy.invalidAge": "Set a whole number from 1 to 3,650 days",
  "disk.developer.policy.anyDate": "Any modification date",
  "disk.developer.policy.ageLabel": "Unchanged for at least {count} days",
  "disk.developer.policy.bulkWaits": "Bulk selection waits for a verified storage map.",
  "disk.developer.policy.noneEligible":
    "No automatically eligible results in this policy. Other artifacts remain inspectable.",
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
  "disk.detail.revealFinder": "Show in Finder",
  "disk.detail.revealExplorer": "Show in File Explorer",
  "disk.detail.revealFiles": "Show in Files",
  "disk.detail.moveTo": "Move to {trash}",
  "disk.detail.under": "Under {name}",
  "disk.detail.protected": "Protected",
  "disk.detail.protect": "Protect",
  "disk.detail.selectedReview": "In review",
  "disk.detail.selectReview": "Add to review",
  "disk.detail.selected": "Selected",
  "disk.detail.allowCleanup": "Allow cleanup",
  "disk.detail.protectCleanup": "Protect from cleanup",
  "disk.dialog.collection.heading": "Review selected items",
  "disk.dialog.collection.summary": "{size} across {count}",
  "disk.dialog.collection.selectedSizes": "Selected file sizes: {summary}",
  "disk.dialog.collection.itemsLabel": "Items selected for review",
  "disk.dialog.collection.body": "Check every item before anything leaves its original location.",
  "disk.dialog.collection.deepWarning":
    "A selected path changes data represented by the deep artifact inventory. It can move to {trash}, but its displayed size is not a reclaim estimate. DiskLizard will rebuild the full map afterward.",
  "disk.dialog.collection.sharedWarning":
    "Some selected paths share physical storage through APFS clones or hard links. They can move to {trash}, but their displayed allocation is not a promise of freed disk space. DiskLizard will recompute the map afterward.",
  "disk.dialog.collection.unverifiedWarning":
    "This scan could not verify filesystem clone metadata. The paths can move to {trash}, but their displayed allocation is not a promise of freed disk space. DiskLizard will refresh the map afterward.",
  "disk.dialog.collection.close": "Close selected-item review",
  "disk.dialog.collection.quickLook": "Quick Look {name}",
  "disk.dialog.collection.preview": "Preview {name}",
  "disk.dialog.collection.reveal": "Show {name} in the file browser",
  "disk.dialog.collection.remove": "Remove {name} from review",
  "disk.dialog.collection.moving": "Moving {current} of {total}",
  "disk.dialog.collection.movingCompact": "Moving {current}/{total}…",
  "disk.dialog.restore.rebuild":
    "Items can be restored from {trash}. DiskLizard will rebuild the full map after the move.",
  "disk.dialog.restore.recompute":
    "Items can be restored from {trash}. Storage allocation will be recomputed after the move.",
  "disk.dialog.restore.space": "Items can be restored from {trash}. Space is freed after you empty it.",
  "disk.dialog.reclaim.summary": "{count} worth reviewing",
  "disk.dialog.reclaim.itemsLabel": "Recommended items",
  "disk.dialog.reclaim.remove": "Remove {name} from review",
  "disk.dialog.reclaim.select": "Select {name} for review",
  "disk.dialog.reclaim.inspect": "Inspect {name}",
  "disk.dialog.reclaim.body":
    "DiskLizard thinks these can usually be recreated or downloaded again. They are recommendations, not permission—select only the items you want to review.",
  "disk.dialog.reclaim.close": "Close review",
  "disk.dialog.reclaim.action": "{action} · Nothing moves until you review the selected items",
  "disk.dialog.reclaim.selectAll": "Select all for review",
  "disk.dialog.delete.heading": "Confirm removal",
  "disk.dialog.delete.prompt": "Move this item to {trash}?",
  "disk.dialog.delete.selectedSize": "Selected file size: {size}",
  "disk.dialog.delete.restoreRebuild":
    "You can restore it from {trash}. DiskLizard will rebuild the full map after the move.",
  "disk.dialog.delete.restoreRecompute":
    "You can restore it from {trash}. Storage allocation will be recomputed after the move.",
  "disk.dialog.delete.restoreSpace": "You can restore it from {trash}. Space is freed after you empty it.",
  "disk.dialog.delete.deepWarning":
    "This path changes data represented by the deep artifact inventory. Moving it does not make its displayed size a reclaim promise; DiskLizard will rebuild the full map afterward.",
  "disk.dialog.delete.sharedWarning":
    "This path shares physical storage through an APFS clone or hard link. Moving it does not guarantee that its displayed bytes become free; DiskLizard will recompute shared storage afterward.",
  "disk.dialog.delete.unverifiedWarning":
    "This scan could not verify filesystem clone metadata. Moving the path does not guarantee that its displayed bytes become free; DiskLizard will refresh the map afterward.",
  "disk.dialog.delete.keep": "Keep it",
  "disk.dialog.delete.moving": "Moving…",
  "disk.preview.tooLarge.title": "This file is too large for instant preview",
  "disk.preview.tooLarge.body":
    "DiskLizard bounds embedded previews to keep inspection fast and memory use predictable. Open it in its default app or Quick Look instead.",
  "disk.preview.tooLarge.bodyDefault":
    "DiskLizard bounds embedded previews to keep inspection fast and memory use predictable. Open it in its default app instead.",
  "disk.preview.binary.title": "This file contains binary data",
  "disk.preview.binary.body": "Open it in its default application to inspect it safely.",
  "disk.preview.unsupported.title": "Preview is not available for this format",
  "disk.preview.unsupported.body":
    "DiskLizard previews common images, source code, configuration, logs, and plain-text files.",
  "disk.preview.heading": "Quick preview",
  "disk.preview.close": "Close preview",
  "disk.preview.loading": "Loading preview…",
  "disk.preview.readError": "DiskLizard could not read this file",
  "disk.preview.folderSummary": "Folder summary",
  "disk.preview.folderCount": "{count} immediate {items} · {size} in this scanned folder.",
  "disk.preview.folderBody":
    "This summary uses the current scan only. Open the folder to browse its map, or use Quick Look for the system view.",
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
  "disk.preview.openMap": "Explore in DiskLizard",
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
  "disk.scan.buildingBody":
    "DiskLizard is measuring every readable file and folder. The map opens when the scan finishes.",
  "disk.scan.status": "Scanning {label}. {files} files scanned. Use Cancel scan to stop.",
  "disk.scan.scanned": "scanned",
  "disk.scan.fileCount": "{count} files",
  "disk.scan.progressLabel": "Scan progress for {label}",
  "disk.scan.progressValue": "{percent}% · {bytes} scanned across {files} files",
  "disk.scan.progressIndeterminate": "{bytes} scanned across {files} files · completion estimate unavailable",
  "disk.apfs.unnamed": "Unnamed APFS snapshot",
  "disk.apfs.showing": "{count} APFS snapshots are present; showing {visible} read-only identities.",
  "disk.apfs.body":
    "macOS does not report reliable per-snapshot bytes when copy-on-write blocks are shared. These identities are read-only evidence, not a size estimate or a deletion action.",
  "disk.apfs.observed": "Observed APFS snapshots",
  "disk.apfs.evidence": "APFS snapshot evidence",
  "disk.apfs.heading": "APFS snapshots",
  "disk.apfs.counts": "{purgeable} · {timeMachine}",
  "disk.accounting.label": "Storage accounting details",
  "disk.accounting.fileSize": "File size {size}",
  "disk.accounting.fileSizeDetail":
    "This item occupies {size} in the current scan but has an apparent length of {logicalSize}.",
  "disk.accounting.hardLink": "Shared hard link",
  "disk.accounting.hardLinkDetail":
    "This pathname shares the same allocation as an earlier hard link, so it is not charged a second time.",
  "disk.accounting.clonePrimary": "Clone group charged once",
  "disk.accounting.clonePrimaryDetail":
    "Every full clone in this group was observed by the scan. This pathname carries the shared allocation exactly once; the other clone paths retain their apparent file size.",
  "disk.accounting.cloneSecondary": "Clone allocation counted once",
  "disk.accounting.cloneSecondaryDetail":
    "Every full clone in this group was observed by the scan. Its shared allocation is charged to the canonical clone, so this pathname adds no extra physical bytes.",
  "disk.accounting.cloneMaybe": "APFS clone may share blocks",
  "disk.accounting.cloneMaybeDetail":
    "The filesystem reports possible shared blocks. DiskLizard does not guess which bytes belong to this pathname.",
  "disk.accounting.cloneShares": "APFS clone shares blocks",
  "disk.accounting.cloneSharesCount":
    "The filesystem reports {count} full clones. Byte ownership stays explicit unless every member is present in this scan.",
  "disk.accounting.cloneSharesDetail": "The filesystem reports that this file shares all of its blocks with a clone.",
  "disk.storage.connected": "Connected storage",
  "disk.storage.mountedMac": "Available on this device",
  "disk.storage.diagnosticsErrorTitle": "Storage coverage could not be verified",
  "disk.storage.diagnosticsErrorBody":
    "Volumes are still available to scan, but DiskLizard could not check connected storage or permission coverage.",
  "disk.storage.retryDiagnostics": "Check again",
  "disk.storage.accessTitle": "Some protected folders could not be read",
  "disk.storage.accessBody":
    "DiskLizard observed an OS permission denial. Open privacy settings to review access, then rescan—access is never assumed.",
  "disk.storage.accessWindowsBody":
    "DiskLizard is not running with an elevated Windows token, so protected locations may be missing from whole-volume scans.",
  "disk.storage.accessUnknownTitle": "Whole-volume access could not be verified",
  "disk.storage.accessUnknownBody":
    "DiskLizard could not confirm whether permission-protected locations are readable. Scan results remain inspectable, but treat coverage as potentially incomplete.",
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
  "disk.drive.lockHint": "Protected folders stay visible but are never added to cleanup.",
  "disk.drive.openMaps": "Open maps",
  "disk.drive.openMapsHint": "Kept live on this device",
  "disk.drive.closeMap": "Close map of {name}",
  "disk.drive.saved": "Saved locations",
  "disk.drive.deviceOnly": "This device only",
  "disk.drive.savedEmpty": "Use Save location after scanning a folder to keep it here.",
  "disk.drive.freeSuffix": "free",
  "disk.drive.firstRun.title": "Scan any folder",
  "disk.drive.firstRun.body":
    "Scan a volume above, drop a folder anywhere in this window, or pick a folder to map it without changing a thing.",
  "disk.drive.scanFolder": "Scan Folder…",
  "disk.drive.reading": "Reading volumes",
  "disk.drive.readFailed": "Volumes could not be read",
  "disk.drive.none": "No volumes yet",
  "disk.drive.pickFolder": "Pick a folder and DiskLizard will map it without changing a thing.",
  "disk.drive.emptyFiltered": "Nothing matches this view",
  "disk.drive.emptyFolder": "This folder is empty",
  "disk.drive.clearFilters": "Return to Contents to show every item in this folder.",
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
  "disk.toast.moreLimit": "No more direct items can be shown from this summary.",
  "disk.toast.authorizationMismatch": "Delete authorization did not match the reviewed item.",
  "disk.toast.deepIdentity": "Deep inventory result requires a fresh directory identity before removal.",
  "disk.toast.movedRebuild": "{name} moved. Rebuilding the full map before reporting disk space.",
  "disk.toast.movedRecompute": "{name} moved. Recomputing storage allocation before reporting free space.",
  "disk.toast.protectedBody":
    "DiskLizard protects system paths, configuration-bearing developer data, worktrees, and version history from direct removal.",
  "disk.toast.changedBody":
    "{name} no longer matches the deep artifact result that was reviewed. Rebuild the full map, then review it again before moving it to {trash}.",
  "disk.toast.missingIdentityBody":
    "{name} does not have a current deep-scan directory identity. Rebuild the full map, then review it again before moving it to {trash}.",
  "disk.toast.movedItems": "Moved {items} to {trash}",
  "disk.toast.movedBytes": "Moved {bytes} to {trash}",
  "disk.toast.batchDeep":
    "A selected path changed the deep artifact inventory. DiskLizard is rebuilding the full map before reporting disk space.",
  "disk.toast.batchShared":
    "Some paths share file allocation. DiskLizard is recomputing the map before reporting allocation.",
  "disk.toast.batchUnverified":
    "This scan could not verify shared file allocation. DiskLizard is recomputing the map before reporting allocation.",
  "disk.toast.batchMoved": "{items} moved to {trash}",
  "disk.error.timeout": "{operation} timed out after {milliseconds}ms",
  "disk.drive.performance": "{duration} · {rate}",
  "disk.treemap.hover": "{name} · {size}",
  "disk.recognition.projectScope": "Project · {name}",
  "disk.safety.regenerable": "regenerable",
  "disk.safety.cache": "cache",
  "disk.safety.logs": "logs",
  "disk.safety.trash": "trash",
  "disk.safety.media": "media",
  "disk.safety.versionControl": "version control",
  "disk.safety.system": "system",
  "disk.safety.unknown": "unknown",
  "disk.cleanup.lockMessage":
    "{name} is protected from cleanup. DiskLizard will still map it, but it will not go to review or Trash.",
  "disk.cleanup.protectionsLoadingTitle": "Loading cleanup protections",
  "disk.cleanup.protectionsLoading":
    "Review and Trash stay disabled until DiskLizard has loaded your saved protections.",
  "disk.cleanup.protectionsSavingTitle": "Saving cleanup protections",
  "disk.cleanup.protectionsSaving": "Review and Trash stay disabled until the protection change has been saved.",
  "disk.cleanup.protectionsErrorTitle": "Cleanup is disabled",
  "disk.cleanup.protectionsError":
    "DiskLizard could not load saved protections. Try again after repairing or resetting DiskLizard's saved settings.",
  "disk.cleanup.protectionsUnavailable": "Saved cleanup protections are not ready.",
  "disk.cleanup.protectionsChanged": "Cleanup protections changed. Review this item again before moving it to Trash.",
  "disk.cleanup.retryProtections": "Try again",
  "disk.cleanup.resetProtections": "Reset saved protections",
  "disk.cleanup.resetHeading": "Protection recovery",
  "disk.cleanup.resetTitle": "Reset cleanup protections?",
  "disk.cleanup.resetBody":
    "Use this only if retry keeps failing. DiskLizard will replace the unreadable protection list with an empty one. No files will be deleted.",
  "disk.cleanup.resetContinue": "Continue to final confirmation",
  "disk.cleanup.resetFinalTitle": "Confirm an empty protection list",
  "disk.cleanup.resetFinalBody":
    "Folders protected before this error will no longer be protected. Cleanup stays disabled until the empty list is safely saved.",
  "disk.cleanup.resetConfirm": "Reset saved protections",
  "disk.cleanup.resetting": "Saving empty protection list…",
  "disk.cleanup.resetFailedTitle": "Reset failed",
  "disk.cleanup.resetFailed":
    "DiskLizard could not save the empty protection list. Cleanup is still disabled. Check your settings storage and try again.",
  "disk.cleanup.resetCancel": "Cancel",
  "disk.metric.underSecond": "under 1s",
  "disk.metric.seconds": "{count}s",
  "disk.metric.minutes": "{minutes}m {seconds}s",
  "disk.metric.underFileRate": "<1 file/s",
  "disk.metric.fileRate": "{count} files/s",
  "disk.node.share": ", {value} of this level",
  "disk.node.hiddenSpace": "Hidden space",
  "disk.node.selectedFile": "Selected file",
  "disk.node.otherUnknown": "Other items",
  "disk.node.inventoryAction": " Deep inventory result; it cannot be explored from the map.",
  "disk.node.moreAction": " Press Enter to show more items.",
  "disk.node.aggregateDescription": "Scanner summary · open it to show more direct items",
  "disk.node.exploreAction": " Press Enter to explore.",
  "disk.node.previewAction": " Press Space to preview.",
  "disk.node.reviewAction": " Press C to add it to review.",
  "disk.node.rescanAction": " Rescan before adding it to review.",
  "disk.node.description": "{name}, {size}{share}.{action}{cleanup}",
} as const

export const DISK_LANGUAGE_PLURALS = {
  "disk.count.event": { one: "{count} event", other: "{count} events" },
  "disk.count.change": { one: "{count} change", other: "{count} changes" },
  "disk.count.item": { one: "{count} item", other: "{count} items" },
  "disk.node.other": { one: "1 smaller item", other: "{count} smaller items" },
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
  "disk.apfs.noIdentity": {
    one: "1 APFS snapshot is present; macOS did not provide an identity.",
    other: "{count} APFS snapshots are present; macOS did not provide identities.",
  },
  "disk.apfs.present": { one: "1 APFS snapshot is present.", other: "{count} APFS snapshots are present." },
} as const

export type DiskLanguageKey = keyof typeof DISK_LANGUAGE_TEXT
export type DiskLanguagePluralKey = keyof typeof DISK_LANGUAGE_PLURALS
export type DiskLanguagePluralCategory = "zero" | "one" | "two" | "few" | "many" | "other"
export type DiskLanguageMessageKey = DiskLanguageKey | `${DiskLanguagePluralKey}.${DiskLanguagePluralCategory}`

type Placeholder<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholder<Rest>
  : never
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
type PluralArgs<Key extends DiskLanguagePluralKey> = [Exclude<Placeholder<PluralTemplate<Key>>, "count">] extends [
  never,
]
  ? []
  : [params: PluralParams<Key>]

function interpolate(template: string, params: Readonly<Record<string, string | number>>) {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}|\{\s*([^{}]+?)\s*\}/g, (match, double, single) => {
    const name = String(double ?? single)
    return params[name] === undefined ? match : String(params[name])
  })
}

export function resolveDiskLanguageLocale(languages: readonly string[]) {
  const locale = resolveDiskLizardReleaseLocale(languages)
  return {
    locale,
    intl: DESKTOP_NATIVE_LOCALE_TAGS[locale],
  } as const
}

export function createDiskLanguage(
  locale: DesktopNativeLocale,
  messages: Readonly<Partial<Record<DiskLanguageMessageKey, string>>> = {},
) {
  const intl = DESKTOP_NATIVE_LOCALE_TAGS[locale]
  const rules = new Intl.PluralRules(intl)
  const englishRules = new Intl.PluralRules(DESKTOP_NATIVE_LOCALE_TAGS.en)

  return {
    locale,
    intl,
    t<Key extends DiskLanguageKey>(key: Key, ...args: TextArgs<Key>) {
      return interpolate(messages[key] ?? DISK_LANGUAGE_TEXT[key], args[0] ?? {})
    },
    plural<Key extends DiskLanguagePluralKey>(key: Key, count: number, ...args: PluralArgs<Key>) {
      const category = rules.select(count) as DiskLanguagePluralCategory
      const localized = messages[`${key}.${category}`] ?? messages[`${key}.other`]
      const englishCategory = englishRules.select(count)
      const english = DISK_LANGUAGE_PLURALS[key][englishCategory === "one" ? "one" : "other"]
      return interpolate(localized ?? english, { count, ...args[0] })
    },
  }
}

export type DiskLanguage = ReturnType<typeof createDiskLanguage>

let activeDiskLanguage = createDiskLanguage("en")

export function configureDiskLanguage(locale: DesktopNativeLocale, messages: Readonly<Record<string, string>> = {}) {
  activeDiskLanguage = createDiskLanguage(locale, messages)
  return activeDiskLanguage
}

export function diskLanguageText<Key extends DiskLanguageKey>(key: Key, ...args: TextArgs<Key>) {
  return activeDiskLanguage.t(key, ...args)
}

export function diskLanguagePlural<Key extends DiskLanguagePluralKey>(
  key: Key,
  count: number,
  ...args: PluralArgs<Key>
) {
  return activeDiskLanguage.plural(key, count, ...args)
}

const PINNED_STORAGE_NAME = "disklizard.dat"
const PINNED_STORAGE_KEY = "pinned-locations"
const CLEANUP_LOCK_STORAGE_KEY = "cleanup-locks"

export const { use: usePlatform, provider: DiskLizardPlatformProvider } = createSimpleContext({
  name: "DiskLizardPlatform",
  init: (props: { value: DiskLizardPlatform }) => props.value,
})

export function useLanguage() {
  return {
    locale: () => activeDiskLanguage.locale,
    intl: () => activeDiskLanguage.intl,
    t: diskLanguageText,
    plural: diskLanguagePlural,
  }
}

type DiskSettingsStorage = SyncStorage | AsyncStorage
export type DiskCleanupLocksStatus = "loading" | "saving" | "ready" | "error"

export type DiskSettingsWriteResult<T extends SavedPath> = {
  ok: boolean
  /** The in-memory value after persistence succeeds or a failed write rolls back. */
  value: T[]
}

type DiskSettingsOptions = {
  os?: DiskLizardOS
}

function storageErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Preview copy that names the platform's system previewer: Quick Look on
 * macOS, the default app elsewhere. Falls back to neutral wording when the
 * platform is unknown.
 */
export function diskPreviewTooLargeBody(os?: DiskLizardOS) {
  return diskLanguageText(os === "macos" ? "disk.preview.tooLarge.body" : "disk.preview.tooLarge.bodyDefault")
}

export function createDiskSettings(storage?: DiskSettingsStorage, options: DiskSettingsOptions = {}) {
  const [state, setState] = createStore({
    locations: [...diskPinnedLocationsDefault] as DiskPinnedLocation[],
    locks: [...diskCleanupLocksDefault] as DiskCleanupLock[],
    pinsError: undefined as string | undefined,
    locksError: undefined as string | undefined,
    cleanupLocksStatus: (storage ? "loading" : "ready") as DiskCleanupLocksStatus,
  })
  let pinsRevision = 0
  let locksRevision = 0
  let writes: Promise<unknown> = Promise.resolve()

  const read = async (
    kind: "pins" | "locks",
    key: string,
    pathOptions: SavedPathOptions,
    revision: number,
    currentRevision: () => number,
    apply: (value: SavedPath[]) => void,
  ) => {
    if (!storage) {
      if (kind === "locks") setState("cleanupLocksStatus", "ready")
      return true
    }
    try {
      const parsed = decodeSavedPaths(await storage.getItem(key), pathOptions)
      if (parsed.status === "invalid") {
        throw new Error(kind === "locks" ? "Saved cleanup protections are invalid" : "Saved scan locations are invalid")
      }
      if (revision === currentRevision()) apply(parsed.status === "valid" ? parsed.value : [])
      setState(kind === "locks" ? "locksError" : "pinsError", undefined)
      if (kind === "locks") setState("cleanupLocksStatus", "ready")
      return true
    } catch (error) {
      setState(kind === "locks" ? "locksError" : "pinsError", storageErrorMessage(error))
      if (kind === "locks") setState("cleanupLocksStatus", "error")
      return false
    }
  }

  const pinnedPathOptions = { limit: PINNED_LOCATION_LIMIT, os: options.os } satisfies SavedPathOptions
  const cleanupLockPathOptions = {
    limit: CLEANUP_LOCK_LIMIT,
    os: options.os,
    foldWindowsCase: true,
    rejectDiscardedEntries: true,
  } satisfies SavedPathOptions

  const ready = Promise.all([
    read(
      "pins",
      PINNED_STORAGE_KEY,
      pinnedPathOptions,
      pinsRevision,
      () => pinsRevision,
      (value) => setState("locations", value),
    ),
    read(
      "locks",
      CLEANUP_LOCK_STORAGE_KEY,
      cleanupLockPathOptions,
      locksRevision,
      () => locksRevision,
      (value) => setState("locks", value),
    ),
  ]).then(() => undefined)

  const write = (kind: "pins" | "locks", key: string, value: unknown) => {
    if (!storage) {
      setState(kind === "locks" ? "locksError" : "pinsError", undefined)
      return Promise.resolve(true)
    }
    const operation = writes.then(async () => {
      try {
        await storage.setItem(key, JSON.stringify(value))
        setState(kind === "locks" ? "locksError" : "pinsError", undefined)
        return true
      } catch (error) {
        setState(kind === "locks" ? "locksError" : "pinsError", storageErrorMessage(error))
        return false
      }
    })
    writes = operation
    return operation
  }

  const persistPins = async (next: DiskPinnedLocation[]): Promise<DiskSettingsWriteResult<DiskPinnedLocation>> => {
    const sanitized = sanitizeSavedPaths(next, pinnedPathOptions)
    const previous = [...state.locations]
    const revision = ++pinsRevision
    setState("locations", sanitized)
    const ok = await write("pins", PINNED_STORAGE_KEY, sanitized)
    if (!ok && revision === pinsRevision) setState("locations", previous)
    return { ok, value: [...state.locations] }
  }
  const persistLocks = async (next: DiskCleanupLock[]): Promise<DiskSettingsWriteResult<DiskCleanupLock>> => {
    if (state.cleanupLocksStatus !== "ready") return { ok: false, value: [...state.locks] }
    const sanitized = sanitizeSavedPaths(next, cleanupLockPathOptions)
    const revision = ++locksRevision
    setState("cleanupLocksStatus", "saving")
    const ok = await write("locks", CLEANUP_LOCK_STORAGE_KEY, sanitized)
    if (ok && revision === locksRevision) setState("locks", sanitized)
    if (revision === locksRevision) setState("cleanupLocksStatus", "ready")
    return { ok, value: [...state.locks] }
  }

  const retryCleanupLocks = async () => {
    if (!storage || state.cleanupLocksStatus !== "error") return false
    setState("cleanupLocksStatus", "loading")
    setState("locksError", undefined)
    return read(
      "locks",
      CLEANUP_LOCK_STORAGE_KEY,
      cleanupLockPathOptions,
      locksRevision,
      () => locksRevision,
      (value) => setState("locks", value),
    )
  }

  const resetCleanupLocks = async () => {
    if (!storage || state.cleanupLocksStatus !== "error") return false
    const revision = ++locksRevision
    setState("cleanupLocksStatus", "saving")
    setState("locksError", undefined)
    const ok = await write("locks", CLEANUP_LOCK_STORAGE_KEY, [])
    if (revision !== locksRevision) return false
    if (!ok) {
      setState("cleanupLocksStatus", "error")
      return false
    }
    setState("locks", [])
    setState("cleanupLocksStatus", "ready")
    return true
  }

  return {
    ready,
    general: {
      diskPinnedLocations: () => state.locations,
      setDiskPinnedLocations: persistPins,
      diskCleanupLocks: () => state.locks,
      setDiskCleanupLocks: persistLocks,
      cleanupLocksStatus: () => state.cleanupLocksStatus,
      retryDiskCleanupLocks: retryCleanupLocks,
      resetDiskCleanupLocks: resetCleanupLocks,
      persistenceError: () => state.locksError ?? state.pinsError,
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
  return createDiskSettings(platform.storage?.(PINNED_STORAGE_NAME), { os: platform.os })
}

export function DiskLizardRuntime(props: ParentProps<{ platform: DiskLizardPlatform }>) {
  return <DiskLizardPlatformProvider value={props.platform}>{props.children}</DiskLizardPlatformProvider>
}
