import { constants } from "node:fs"
import { access, readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { posix, win32 } from "node:path"
import type { DriveInfo } from "./disk-scanner"

export type DiskStorageProvider = "box" | "dropbox" | "google-drive" | "icloud" | "network" | "onedrive" | "other"

export type DiskStorageLocation = {
  path: string
  name: string
  kind: "cloud" | "network"
  provider: DiskStorageProvider
}

export type DiskAccessProbe = {
  name: "Contacts" | "Mail" | "Safari"
  status: "denied" | "missing" | "readable" | "unavailable"
}

/**
 * This is intentionally evidence rather than a claim about TCC. macOS does
 * not offer a supported API that can prove Full Disk Access is granted.
 */
export type DiskAccessDiagnostic = {
  status: "inconclusive" | "limited" | "not-applicable" | "unavailable"
  probes: DiskAccessProbe[]
}

export type DiskStorageDiagnostics = {
  access: DiskAccessDiagnostic
  locations: DiskStorageLocation[]
}

type PlatformPath = typeof posix | typeof win32

type CloudCandidate = Omit<DiskStorageLocation, "kind"> & { kind?: "cloud" }

function pathForPlatform(platform: NodeJS.Platform): PlatformPath {
  return platform === "win32" ? win32 : posix
}

export function cloudStorageProvider(name: string): DiskStorageProvider {
  const normalized = name.toLowerCase()
  if (normalized.includes("icloud") || normalized.includes("mobile documents") || normalized.includes("clouddocs"))
    return "icloud"
  if (normalized.includes("dropbox")) return "dropbox"
  if (normalized.includes("google") || normalized.includes("drivefs")) return "google-drive"
  if (normalized.includes("onedrive")) return "onedrive"
  if (normalized.includes("box")) return "box"
  return "other"
}

export function cloudStorageCandidates(
  homePath: string,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv = process.env,
): CloudCandidate[] {
  const path = pathForPlatform(platform)
  const candidates = [
    { path: path.join(homePath, "Dropbox"), name: "Dropbox", provider: "dropbox" },
    { path: path.join(homePath, "Google Drive"), name: "Google Drive", provider: "google-drive" },
    { path: path.join(homePath, "Box"), name: "Box", provider: "box" },
  ] satisfies CloudCandidate[]

  if (platform === "darwin") {
    return [
      {
        path: path.join(homePath, "Library", "Mobile Documents", "com~apple~CloudDocs"),
        name: "iCloud Drive",
        provider: "icloud",
      },
      ...candidates,
    ]
  }

  if (platform !== "win32") return candidates
  const oneDrivePaths = [environment.OneDrive, environment.OneDriveConsumer, environment.OneDriveCommercial]
    .filter((value): value is string => !!value)
    .map((value) => ({ path: value, name: "OneDrive", provider: "onedrive" as const }))
  return [
    ...oneDrivePaths,
    { path: path.join(homePath, "OneDrive"), name: "OneDrive", provider: "onedrive" },
    ...candidates,
  ]
}

function storageLocationKey(location: DiskStorageLocation, platform: NodeJS.Platform) {
  return platform === "win32" ? location.path.toLowerCase() : location.path
}

function uniqueStorageLocations(locations: DiskStorageLocation[], platform: NodeJS.Platform) {
  const seen = new Set<string>()
  return locations.filter((location) => {
    const key = storageLocationKey(location, platform)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

type ReadDirectory = (path: string) => Promise<string[]>
type CheckAccess = (path: string) => Promise<void>

async function existingCloudLocations(
  homePath: string,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  readDirectory: ReadDirectory,
  checkAccess: CheckAccess,
) {
  const path = pathForPlatform(platform)
  const candidates = cloudStorageCandidates(homePath, platform, environment)
  if (platform === "darwin") {
    const cloudStorage = path.join(homePath, "Library", "CloudStorage")
    const children = await readDirectory(cloudStorage).catch(() => [])
    candidates.push(
      ...children.map((name) => ({
        path: path.join(cloudStorage, name),
        name,
        provider: cloudStorageProvider(name),
      })),
    )
  }

  const available: Array<DiskStorageLocation | undefined> = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        await checkAccess(candidate.path)
        return { ...candidate, kind: "cloud" as const }
      } catch {
        return undefined
      }
    }),
  )
  return available.filter((location): location is DiskStorageLocation => location !== undefined)
}

function accessProbeStatus(error: unknown): DiskAccessProbe["status"] {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
  if (code === "ENOENT") return "missing"
  if (code === "EACCES" || code === "EPERM") return "denied"
  return "unavailable"
}

async function macAccessDiagnostic(homePath: string, checkAccess: CheckAccess): Promise<DiskAccessDiagnostic> {
  const path = pathForPlatform("darwin")
  const probes = await Promise.all(
    [
      { name: "Mail" as const, path: path.join(homePath, "Library", "Mail") },
      { name: "Safari" as const, path: path.join(homePath, "Library", "Safari") },
      { name: "Contacts" as const, path: path.join(homePath, "Library", "Application Support", "AddressBook") },
    ].map(async (probe) => {
      try {
        await checkAccess(probe.path)
        return { name: probe.name, status: "readable" as const }
      } catch (error) {
        return { name: probe.name, status: accessProbeStatus(error) }
      }
    }),
  )
  if (probes.some((probe) => probe.status === "denied")) return { status: "limited", probes }
  if (probes.some((probe) => probe.status === "readable")) return { status: "inconclusive", probes }
  return { status: "unavailable", probes }
}

export async function getDiskStorageDiagnostics(options?: {
  platform?: NodeJS.Platform
  homePath?: string
  environment?: NodeJS.ProcessEnv
  drives?: readonly Pick<DriveInfo, "label" | "name" | "path" | "type">[]
  readDirectory?: ReadDirectory
  checkAccess?: CheckAccess
}): Promise<DiskStorageDiagnostics> {
  const platform = options?.platform ?? process.platform
  const homePath = options?.homePath ?? homedir()
  const checkAccess = options?.checkAccess ?? ((targetPath) => access(targetPath, constants.R_OK))
  const cloud = await existingCloudLocations(
    homePath,
    platform,
    options?.environment ?? process.env,
    options?.readDirectory ?? ((targetPath) => readdir(targetPath)),
    checkAccess,
  )
  const network = (options?.drives ?? [])
    .filter((drive) => drive.type === "network")
    .map((drive) => ({
      path: drive.path,
      name: drive.name || drive.label,
      kind: "network" as const,
      provider: "network" as const,
    }))
  const accessDiagnostic =
    platform === "darwin"
      ? await macAccessDiagnostic(homePath, checkAccess)
      : { status: "not-applicable" as const, probes: [] }
  return { access: accessDiagnostic, locations: uniqueStorageLocations([...cloud, ...network], platform) }
}

export function diskAccessSettingsUrl(platform = process.platform) {
  if (platform === "darwin") return "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
  if (platform === "win32") return "ms-settings:privacy-broadfilesystemaccess"
}
