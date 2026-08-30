/**
 * Standalone DiskLizard renderer interface.
 *
 * Keep desktop callers on this seam instead of reaching through the historical
 * application tree. The implementation can move without changing consumers.
 */
export { default as DiskUtilityPage } from "./pages/disk-utility"
export {
  configureDiskLanguage,
  createDiskLizardMenu,
  DiskLizardRuntime,
  diskLanguagePlural,
  diskLanguageText,
  type DiskLanguageKey,
  type DiskLizardMenu,
  type DiskLizardOS,
  type DiskLizardPlatform,
  type DiskLizardUpdaterState,
} from "./pages/disk-utility/runtime"
export { chooseFolderAndScan, DISK_CHOOSE_FOLDER_COMMAND } from "./pages/disk-utility/choose-folder"
export type {
  DiskDeleteAuthorizationOutcome,
  DiskDeleteOptions,
  DiskDriveInfo,
  DiskFilePreview,
  DiskScanNode,
  DiskScanProgress,
  DiskScanUpdate,
  DiskUtilityAPI,
} from "./pages/disk-utility/types"
