import { nativeScannerAvailable, scanPathNative } from "./native"
import { scanPath, scanPathSync } from "./scan"
import type { DiskNode, ScanOptions } from "./types"

export type ScanBackend = "native" | "typescript" | "typescript-worker"
export type ScanAccounting = "physical" | "logical"
export type ScanEvidence = "complete" | "partial" | "unavailable"

export type ScanBackendResult = {
  root: DiskNode
  backend: ScanBackend
  accounting: ScanAccounting
  evidence: ScanEvidence
}

export function scanEvidence(root: DiskNode): ScanEvidence {
  if (root.sharedStorageEvidence === "complete" || root.sharedStorageEvidence === "partial") return root.sharedStorageEvidence
  return "unavailable"
}

export function scanAccounting(
  options: ScanOptions | undefined,
  backend: ScanBackend,
  platform: NodeJS.Platform = process.platform,
): ScanAccounting {
  if (options?.sizeMode === "logical") return "logical"
  // Node's portable Windows Stats do not expose allocated blocks. The
  // fallback deliberately measures apparent length, so its public contract
  // must not relabel those bytes as physical allocation.
  if (platform === "win32" && backend !== "native") return "logical"
  return "physical"
}

export function describeScanResult(
  root: DiskNode,
  backend: ScanBackend,
  options?: ScanOptions,
  platform: NodeJS.Platform = process.platform,
): ScanBackendResult {
  return {
    root,
    backend,
    accounting: scanAccounting(options, backend, platform),
    evidence: scanEvidence(root),
  }
}

export async function scanPathWithBackend(targetPath: string, options: ScanOptions = {}): Promise<ScanBackendResult> {
  if (process.env.DISKLIZARD_NATIVE_SCANNER !== "0" && nativeScannerAvailable()) {
    try {
      return describeScanResult(await scanPathNative(targetPath, options), "native", options)
    } catch (error) {
      options.signal?.throwIfAborted()
      if (process.env.DISKLIZARD_SCAN_DEBUG) console.warn("[disklizard] native scanner failed, TypeScript fallback", error)
    }
  }

  if (options.useWorker) {
    return describeScanResult(await scanPath(targetPath, { ...options, useWorker: true }), "typescript-worker", options)
  }

  return describeScanResult(await scanPathSync(targetPath, { ...options, useWorker: false }), "typescript", options)
}
