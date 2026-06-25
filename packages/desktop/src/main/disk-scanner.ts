/**
 * Desktop adapter — re-exports shared scanner.
 *
 * Import via relative path (not package name) so electron-vite bundles
 * the .ts source instead of Node loading it at runtime with strip-only TS.
 */

export {
  scanPath,
  scanPathSync,
  getDrives,
  deleteDiskPath,
  type DiskNode,
  type DriveInfo,
  type ScanProgress,
  type ScanOptions,
} from "../../../disklizard/src/scan"
