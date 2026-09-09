import { execFile } from "node:child_process"
import { constants } from "../../../disklizard/src/physical-fs"
import { access, readdir, realpath, stat } from "../../../disklizard/src/physical-fs"
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

export type WholeVolumeAccessDiagnostic = {
  capability: "macos-full-disk-access" | "windows-elevated-token" | "not-applicable"
  status: "granted" | "limited" | "inconclusive" | "not-applicable"
  /** Permission-specific coverage only; scanners can still be incomplete for other reasons. */
  mapCoverage: "not-known-to-be-permission-limited" | "may-be-incomplete" | "unknown" | "not-applicable"
  evidence:
    | {
        source: "protected-directory-probes"
        probes: DiskAccessProbe[]
      }
    | {
        source: "windows-token-groups"
        integrityLevel: "low" | "medium" | "high" | "system" | "protected" | "unknown"
        administratorsGroup: "present" | "absent" | "unknown"
      }
    | { source: "none" }
}

/**
 * This is intentionally evidence rather than a claim about TCC. macOS does
 * not offer a supported API that can prove Full Disk Access is granted.
 */
export type DiskAccessDiagnostic = {
  status: "inconclusive" | "limited" | "not-applicable" | "unavailable"
  probes: DiskAccessProbe[]
  wholeVolume: WholeVolumeAccessDiagnostic
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
type RunCommand = (file: string, args: readonly string[]) => Promise<string>

async function existingCloudLocations(
  homePath: string,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  readDirectory: ReadDirectory,
  checkAccess: CheckAccess,
  resolvePath: (path: string) => Promise<string>,
) {
  const path = pathForPlatform(platform)
  const candidates = cloudStorageCandidates(homePath, platform, environment)
  if (platform === "darwin") {
    const cloudStorage = path.join(homePath, "Library", "CloudStorage")
    const children = await readDirectory(cloudStorage).catch(() => [])
    candidates.push(
      ...children
        .filter((name) => !name.startsWith(".") && !/^iCloudDrive-iCloudDrive \(\d{2}-\d{2}-\d{2} /.test(name))
        .map((name) => ({
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
        return {
          ...candidate,
          path: await resolvePath(candidate.path).catch(() => candidate.path),
          kind: "cloud" as const,
        }
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

function protectedDirectoryCapability(probes: DiskAccessProbe[]): WholeVolumeAccessDiagnostic {
  if (probes.some((probe) => probe.status === "denied")) {
    return {
      capability: "macos-full-disk-access",
      status: "limited",
      mapCoverage: "may-be-incomplete",
      evidence: { source: "protected-directory-probes", probes },
    }
  }
  // Apple exposes no supported Full Disk Access status API. Successful probes
  // demonstrate only that those paths were readable, never a global grant.
  return {
    capability: "macos-full-disk-access",
    status: "inconclusive",
    mapCoverage: "unknown",
    evidence: { source: "protected-directory-probes", probes },
  }
}

async function macAccessDiagnostic(
  homePath: string,
  readProtectedDirectory: ReadDirectory,
): Promise<DiskAccessDiagnostic> {
  const path = pathForPlatform("darwin")
  const probes = await Promise.all(
    [
      { name: "Mail" as const, path: path.join(homePath, "Library", "Mail") },
      { name: "Safari" as const, path: path.join(homePath, "Library", "Safari") },
      { name: "Contacts" as const, path: path.join(homePath, "Library", "Application Support", "AddressBook") },
    ].map(async (probe) => {
      try {
        await readProtectedDirectory(probe.path)
        return { name: probe.name, status: "readable" as const }
      } catch (error) {
        return { name: probe.name, status: accessProbeStatus(error) }
      }
    }),
  )
  const wholeVolume = protectedDirectoryCapability(probes)
  if (wholeVolume.status === "limited") return { status: "limited", probes, wholeVolume }
  if (probes.some((probe) => probe.status === "readable")) return { status: "inconclusive", probes, wholeVolume }
  return { status: "unavailable", probes, wholeVolume }
}

function windowsIntegrityLevel(
  rid: number,
): Extract<WholeVolumeAccessDiagnostic["evidence"], { source: "windows-token-groups" }>["integrityLevel"] {
  if (rid >= 28_672) return "protected"
  if (rid >= 16_384) return "system"
  if (rid >= 12_288) return "high"
  if (rid >= 8_192) return "medium"
  return "low"
}

function windowsAccessDiagnostic(output: string): DiskAccessDiagnostic["wholeVolume"] {
  const integrityRids = new Set(
    [...output.matchAll(/\bS-1-16-(\d+)\b/gi)]
      .map((match) => Number(match[1]))
      .filter((rid) => Number.isSafeInteger(rid) && rid >= 0),
  )
  // A real token has one mandatory integrity label. Multiple or missing labels
  // are contradictory evidence, so do not choose the most favorable value.
  const integrityRid = integrityRids.size === 1 ? integrityRids.values().next().value : undefined
  const administratorsGroup = /\bS-1-5-32-544\b/i.test(output) ? ("present" as const) : ("absent" as const)
  const integrityLevel = integrityRid === undefined ? "unknown" : windowsIntegrityLevel(integrityRid)
  const evidence = {
    source: "windows-token-groups" as const,
    integrityLevel,
    administratorsGroup,
  }
  if (integrityRid === undefined) {
    return {
      capability: "windows-elevated-token",
      status: "inconclusive",
      mapCoverage: "unknown",
      evidence,
    }
  }
  if (integrityRid < 12_288) {
    return {
      capability: "windows-elevated-token",
      status: "limited",
      mapCoverage: "may-be-incomplete",
      evidence,
    }
  }
  if (administratorsGroup === "present") {
    return {
      capability: "windows-elevated-token",
      status: "granted",
      mapCoverage: "not-known-to-be-permission-limited",
      evidence,
    }
  }
  return {
    capability: "windows-elevated-token",
    status: "inconclusive",
    mapCoverage: "unknown",
    evidence,
  }
}

function runCommand(file: string, args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      file,
      [...args],
      { encoding: "utf8", windowsHide: true, timeout: 2_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })
}

async function windowsWholeVolumeDiagnostic(run: RunCommand): Promise<WholeVolumeAccessDiagnostic> {
  try {
    return windowsAccessDiagnostic(await run("whoami.exe", ["/groups", "/fo", "csv", "/nh"]))
  } catch {
    return {
      capability: "windows-elevated-token",
      status: "inconclusive",
      mapCoverage: "unknown",
      evidence: {
        source: "windows-token-groups",
        integrityLevel: "unknown",
        administratorsGroup: "unknown",
      },
    }
  }
}

export async function getDiskStorageDiagnostics(options?: {
  platform?: NodeJS.Platform
  homePath?: string
  environment?: NodeJS.ProcessEnv
  drives?: readonly Pick<DriveInfo, "label" | "name" | "path" | "type">[]
  readDirectory?: ReadDirectory
  readProtectedDirectory?: ReadDirectory
  resolvePath?: (path: string) => Promise<string>
  checkAccess?: CheckAccess
  runCommand?: RunCommand
}): Promise<DiskStorageDiagnostics> {
  const platform = options?.platform ?? process.platform
  const homePath = options?.homePath ?? homedir()
  const checkAccess =
    options?.checkAccess ??
    (async (targetPath: string) => {
      if (!(await stat(targetPath)).isDirectory()) throw new Error("Not a storage directory")
      await access(targetPath, constants.R_OK)
    })
  const cloud = await existingCloudLocations(
    homePath,
    platform,
    options?.environment ?? process.env,
    options?.readDirectory ?? ((targetPath) => readdir(targetPath)),
    checkAccess,
    options?.resolvePath ?? realpath,
  )
  const network = (options?.drives ?? [])
    .filter((drive) => drive.type === "network")
    .map((drive) => ({
      path: drive.path,
      name: drive.name || drive.label,
      kind: "network" as const,
      provider: "network" as const,
    }))
  let accessDiagnostic: DiskAccessDiagnostic
  if (platform === "darwin") {
    accessDiagnostic = await macAccessDiagnostic(
      homePath,
      options?.readProtectedDirectory ?? ((targetPath) => readdir(targetPath)),
    )
  } else if (platform === "win32") {
    accessDiagnostic = {
      status: "not-applicable",
      probes: [],
      wholeVolume: await windowsWholeVolumeDiagnostic(options?.runCommand ?? runCommand),
    }
  } else {
    accessDiagnostic = {
      status: "not-applicable",
      probes: [],
      wholeVolume: {
        capability: "not-applicable",
        status: "not-applicable",
        mapCoverage: "not-applicable",
        evidence: { source: "none" },
      },
    }
  }
  return { access: accessDiagnostic, locations: uniqueStorageLocations([...cloud, ...network], platform) }
}

export function diskAccessSettingsUrl(platform = process.platform) {
  if (platform === "darwin") return "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
  if (platform === "win32") return "ms-settings:privacy-broadfilesystemaccess"
}
