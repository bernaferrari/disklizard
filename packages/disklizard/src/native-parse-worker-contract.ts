import type { DiskNode, ScanProgress } from "./types"

export type NativeParseWorkerRequest = {
  scannerPath: string
  requestJson: string
  platform: NodeJS.Platform
  expectedRootPath: string
  inventoryEnabled: boolean
  expectedInventoryMaxItems?: number
}

export type NativeParseWorkerMessage =
  | { type: "progress"; progress: ScanProgress }
  | { type: "done"; root: DiskNode }
  | { type: "error"; message: string }

function isNodePlatform(value: unknown): value is NodeJS.Platform {
  return (
    value === "aix" ||
    value === "android" ||
    value === "darwin" ||
    value === "freebsd" ||
    value === "haiku" ||
    value === "linux" ||
    value === "openbsd" ||
    value === "sunos" ||
    value === "win32" ||
    value === "cygwin" ||
    value === "netbsd"
  )
}

export function isNativeParseWorkerRequest(value: unknown): value is NativeParseWorkerRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return (
    "scannerPath" in value &&
    typeof value.scannerPath === "string" &&
    value.scannerPath.length > 0 &&
    "requestJson" in value &&
    typeof value.requestJson === "string" &&
    "platform" in value &&
    isNodePlatform(value.platform) &&
    "expectedRootPath" in value &&
    typeof value.expectedRootPath === "string" &&
    value.expectedRootPath.length > 0 &&
    "inventoryEnabled" in value &&
    typeof value.inventoryEnabled === "boolean" &&
    (!("expectedInventoryMaxItems" in value) ||
      value.expectedInventoryMaxItems === undefined ||
      (typeof value.expectedInventoryMaxItems === "number" &&
        Number.isSafeInteger(value.expectedInventoryMaxItems) &&
        value.expectedInventoryMaxItems > 0))
  )
}
