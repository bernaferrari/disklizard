/**
 * Desktop adapter — re-exports shared scanner.
 *
 * Import via relative path (not package name) so electron-vite bundles
 * the .ts source instead of Node loading it at runtime with strip-only TS.
 */

import { scanPath as scanPathTypeScript } from "../../../disklizard/src/scan"
import type { DiskNode, ScanOptions } from "../../../disklizard/src/types"
import { scanPathNative } from "./disk-scanner-native"

export type DiskScanBackend = "native" | "typescript-fallback"

export type DiskScanResult = {
  root: DiskNode
  backend: DiskScanBackend
}

export {
  scanPathSync,
  getDrives,
  getDriveFacts,
  mountExclusions,
  assertSafeDeletionPath,
  deleteDiskPath,
  type DiskNode,
  type DriveInfo,
  type ScanProgress,
  type ScanOptions,
} from "../../../disklizard/src/scan"
export type { DriveFacts } from "../../../disklizard/src/types"

/**
 * Prefer the native scanner, retaining the worker scanner for unsupported or broken installations.
 *
 * Keeping the backend alongside the result lets opt-in diagnostics report what actually ran
 * without changing the renderer-facing scan contract.
 */
export async function scanPathWithBackend(targetPath: string, options: ScanOptions = {}): Promise<DiskScanResult> {
  const requireNative = process.env.DISKLIZARD_REQUIRE_NATIVE_SCANNER === "1"
  if (requireNative || process.env.DISKLIZARD_NATIVE_SCANNER !== "0") {
    try {
      return { root: await scanPathNative(targetPath, options), backend: "native" }
    } catch (error) {
      options.signal?.throwIfAborted()
      // Packaged release smoke must prove that the shipped native sidecar is
      // executable. Falling back here would turn that proof into a false pass.
      if (requireNative) throw error
      // A fallback changes both scan speed and progress estimation. Always
      // record it so a broken sidecar cannot masquerade as a Rust regression.
      console.warn("[disklizard] native scanner failed, TypeScript worker fallback", error)
    }
  }
  return { root: await scanPathTypeScript(targetPath, options), backend: "typescript-fallback" }
}

/** Renderer-facing scan contract. Use scanPathWithBackend only for explicit diagnostics. */
export async function scanPath(targetPath: string, options: ScanOptions = {}): Promise<DiskNode> {
  return (await scanPathWithBackend(targetPath, options)).root
}
