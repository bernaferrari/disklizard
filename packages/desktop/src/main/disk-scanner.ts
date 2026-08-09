/**
 * Desktop adapter — re-exports shared scanner.
 *
 * Import via relative path (not package name) so electron-vite bundles
 * the .ts source instead of Node loading it at runtime with strip-only TS.
 */

import { scanPath as scanPathTypeScript } from "../../../disklizard/src/scan"
import type { DiskNode, ScanOptions } from "../../../disklizard/src/types"
import { scanPathNative } from "./disk-scanner-native"

export {
  scanPathSync,
  getDrives,
  mountExclusions,
  assertSafeDeletionPath,
  deleteDiskPath,
  type DiskNode,
  type DriveInfo,
  type ScanProgress,
  type ScanOptions,
} from "../../../disklizard/src/scan"

/** Prefer the measured native scanner; retain the worker scanner for unsupported or broken installations. */
export async function scanPath(targetPath: string, options: ScanOptions = {}): Promise<DiskNode> {
  if (process.env.DISKLIZARD_NATIVE_SCANNER !== "0") {
    try {
      return await scanPathNative(targetPath, options)
    } catch (error) {
      options.signal?.throwIfAborted()
      if (process.env.DISKLIZARD_SCAN_DEBUG) {
        console.warn("[disklizard] native scanner failed, TypeScript worker fallback", error)
      }
    }
  }
  return scanPathTypeScript(targetPath, options)
}
