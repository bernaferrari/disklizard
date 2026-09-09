import { execFile } from "node:child_process"
import { constants as fsConstants } from "./physical-fs"
import { access, readFile } from "./physical-fs"
import { homedir, platform } from "node:os"
import { promisify } from "node:util"
import type { ApfsSnapshotEvidence, DriveFacts, DriveInfo } from "./types"

const execFileAsync = promisify(execFile)
import { nativeScannerPath } from "./native"

const OS = platform()
const IS_WIN = OS === "win32"
const MAC_DRIVE_FACT_CACHE_MS = 15_000
const MAC_DRIVE_ENRICHMENT_BUDGET_MS = 400
const macDriveFactsCache = new Map<string, { expiresAt: number; facts: MacDriveFacts }>()
const macDriveFactsInFlight = new Map<string, Promise<MacDriveFacts>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// ── Drives (fast Windows path: WMIC is slower; prefer PowerShell once) ────

/**
 * Drive-picker entries and the stricter mount evidence required by permanent
 * deletion. `drives` may intentionally omit support/system mounts; `mountRoots`
 * must not. `complete` is false whenever the platform enumeration fell back or
 * any discovery row could not be understood.
 */
export type DriveDiscovery = {
  drives: DriveInfo[]
  mountRoots: string[]
  complete: boolean
}

export function mountExclusions(targetPath: string, drives: readonly DriveInfo[], os: NodeJS.Platform = OS): string[] {
  const normalize = (value: string) => {
    const normalized = value.length > 1 ? value.replace(/[\\/]+$/, "") : value
    return os === "win32" ? normalized.toLowerCase() : normalized
  }
  const target = normalize(targetPath)
  const boundary = target.endsWith("/") || target.endsWith("\\") ? target : target + (os === "win32" ? "\\" : "/")
  return drives
    .map((drive) => ({ original: drive.path, normalized: normalize(drive.path) }))
    .filter(({ normalized }) => normalized !== target && normalized.startsWith(boundary))
    .map(({ original }) => original)
}

type MacDriveFacts = DriveFacts

const MAX_APFS_SNAPSHOT_EVIDENCE = 48

function plistScalar(xml: string, key: string) {
  const keyPattern = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return xml
    .match(new RegExp(`<key>${keyPattern}</key>\\s*<(?:string|integer)>([^<]*)</(?:string|integer)>`))?.[1]
    ?.trim()
}

/** Parse the tiny, stable subset of `diskutil info -plist` used for capacity caveats. */
export function parseMacDriveInfoPlist(xml: string): Pick<DriveInfo, "filesystem" | "sharedFree"> {
  const filesystem = plistScalar(xml, "FilesystemType")?.toLowerCase()
  const containerFree = Number(plistScalar(xml, "APFSContainerFree"))
  return {
    ...(filesystem ? { filesystem } : {}),
    ...(filesystem === "apfs" && Number.isFinite(containerFree) && containerFree >= 0
      ? { sharedFree: containerFree }
      : {}),
  }
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function plistBoolean(xml: string, key: string) {
  const keyPattern = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const value = xml.match(new RegExp(`<key>${keyPattern}</key>\\s*<(true|false)\\s*/>`, "i"))?.[1]
  if (value !== undefined) return value.toLowerCase() === "true"

  // Older diskutil builds have emitted the same value as a string. Accept the
  // explicit spelling, but leave every other value unknown rather than
  // treating it as false.
  const scalar = plistScalar(xml, key)?.toLowerCase()
  if (scalar === "true" || scalar === "yes" || scalar === "1") return true
  if (scalar === "false" || scalar === "no" || scalar === "0") return false
  return undefined
}

function explicitBoolean(value: string | undefined) {
  if (!value) return undefined
  if (/^(?:yes|true|1)$/i.test(value)) return true
  if (/^(?:no|false|0)$/i.test(value)) return false
  return undefined
}

function isTimeMachineSnapshot(snapshot: ApfsSnapshotEvidence) {
  // Snapshot names are user-visible and can be arbitrary. Only recognize the
  // documented Apple namespaces, not a loose substring in a custom name.
  return /^com\.apple\.(?:TimeMachine|backupd)(?:\.|$)/i.test(snapshot.name ?? "")
}

function snapshotFacts(
  snapshots: ApfsSnapshotEvidence[],
  count = snapshots.length,
): Pick<DriveInfo, "snapshotCount" | "purgeableSnapshotCount" | "timeMachineSnapshotCount" | "apfsSnapshots"> {
  const normalized = snapshots.map((snapshot) => ({
    ...snapshot,
    ...(isTimeMachineSnapshot(snapshot) ? { isTimeMachine: true } : {}),
  }))
  const purgeableSnapshotCount = normalized.filter((snapshot) => snapshot.purgeable).length
  const timeMachineSnapshotCount = normalized.filter((snapshot) => snapshot.isTimeMachine).length
  return {
    snapshotCount: count,
    apfsSnapshots: normalized.slice(0, MAX_APFS_SNAPSHOT_EVIDENCE),
    ...(purgeableSnapshotCount ? { purgeableSnapshotCount } : {}),
    ...(timeMachineSnapshotCount ? { timeMachineSnapshotCount } : {}),
  }
}

/** Parse `diskutil apfs listSnapshots -plist` without turning snapshot identities into a size estimate. */
export function parseApfsSnapshotPlist(
  xml: string,
): Pick<DriveInfo, "snapshotCount" | "purgeableSnapshotCount" | "timeMachineSnapshotCount" | "apfsSnapshots"> {
  const keyedArray = xml.match(/<key>Snapshots<\/key>\s*<array(?:\s[^>]*)?>([\s\S]*?)<\/array>/i)?.[1]
  // `diskutil` has used both a keyed dictionary and a top-level array for
  // plist subcommands. Only accept a top-level array as a fallback, never an
  // arbitrary nested one from an unrelated plist value.
  const rootArray = xml.match(/<plist(?:\s[^>]*)?>\s*<array(?:\s[^>]*)?>([\s\S]*?)<\/array>\s*<\/plist>/i)?.[1]
  const emptyKeyedArray = /<key>Snapshots<\/key>\s*<array(?:\s[^>]*)?\s*\/>/i.test(xml)
  const emptyRootArray = /<plist(?:\s[^>]*)?>\s*<array(?:\s[^>]*)?\s*\/>\s*<\/plist>/i.test(xml)
  const array = keyedArray ?? rootArray ?? (emptyKeyedArray || emptyRootArray ? "" : undefined)
  if (array === undefined) return {}
  const snapshots = (array.match(/<dict>[\s\S]*?<\/dict>/gi) ?? []).map((entry) => {
    const name = plistScalar(entry, "SnapshotName") ?? plistScalar(entry, "Name")
    const uuid = plistScalar(entry, "SnapshotUUID") ?? plistScalar(entry, "UUID")
    const purgeable = plistBoolean(entry, "SnapshotPurgeable") ?? plistBoolean(entry, "Purgeable")
    return {
      ...(name ? { name: decodeXml(name) } : {}),
      ...(uuid ? { uuid: decodeXml(uuid) } : {}),
      ...(purgeable === undefined ? {} : { purgeable }),
    }
  })
  return snapshotFacts(snapshots)
}

/** Parse the human-readable `diskutil` fallback while preserving only read-only snapshot facts. */
export function parseApfsSnapshotOutput(
  stdout: string,
): Pick<DriveInfo, "snapshotCount" | "purgeableSnapshotCount" | "timeMachineSnapshotCount" | "apfsSnapshots"> {
  const entries = stdout.split(/^\+--\s+/m).slice(1)
  const reportedCount = Number(stdout.match(/\((\d+)\s+found\)/i)?.[1])
  const count = Number.isSafeInteger(reportedCount) && reportedCount >= 0 ? reportedCount : entries.length
  if (entries.length === 0) {
    if (!/Snapshot(?:s)?\s+for\b/i.test(stdout)) return {}
    return snapshotFacts([], 0)
  }
  const snapshots = entries.map((entry) => {
    const [header = "", ...bodyLines] = entry.split("\n")
    const body = bodyLines.join("\n")
    const value = (key: string) => body.match(new RegExp(`^\\s*${key}:\\s*(.*?)\\s*$`, "im"))?.[1]?.trim()
    const uuid = value("UUID") ?? value("Snapshot UUID") ?? (/^[0-9a-f-]{36}$/i.test(header) ? header : undefined)
    const name = value("Name") ?? value("Snapshot Name")
    const purgeable = explicitBoolean(value("Purgeable"))
    return {
      ...(name ? { name } : {}),
      ...(uuid ? { uuid } : {}),
      ...(purgeable === undefined ? {} : { purgeable }),
    }
  })
  return snapshotFacts(snapshots, count)
}

function applyMacDriveFacts(drive: DriveInfo, facts: MacDriveFacts): DriveInfo {
  return {
    ...drive,
    ...facts,
    // Facts are cached. Keep callers from accidentally mutating the cached
    // read-only evidence list or its entries between drive refreshes.
    ...(facts.apfsSnapshots ? { apfsSnapshots: facts.apfsSnapshots.map((snapshot) => ({ ...snapshot })) } : {}),
  }
}

function copyMacDriveFacts(facts: MacDriveFacts): MacDriveFacts {
  return {
    ...facts,
    ...(facts.apfsSnapshots ? { apfsSnapshots: facts.apfsSnapshots.map((snapshot) => ({ ...snapshot })) } : {}),
  }
}

async function collectMacDriveFacts(drive: Pick<DriveInfo, "path">): Promise<MacDriveFacts> {
  try {
    const { stdout } = await execFileAsync("diskutil", ["info", "-plist", drive.path], {
      maxBuffer: 1024 * 1024,
      timeout: 3_000,
    })
    const facts: MacDriveFacts = parseMacDriveInfoPlist(stdout)
    try {
      const capacity = await execFileAsync(nativeScannerPath(), ["--available-capacity", drive.path], { timeout: 1500, maxBuffer: 4096 })
      Object.assign(facts, parseMacAvailableCapacity(capacity.stdout))
    } catch { /* Older or unavailable sidecars retain raw free-space reporting. */ }
    if (facts.filesystem === "apfs") {
      try {
        const snapshots = await execFileAsync("diskutil", ["apfs", "listSnapshots", "-plist", drive.path], {
          maxBuffer: 1024 * 1024,
          timeout: 3_000,
        })
        Object.assign(facts, parseApfsSnapshotPlist(snapshots.stdout))
      } catch {
        // Some APFS mounts (notably sealed system volumes) decline a snapshot listing; the filesystem fact is still useful.
      }
    }
    return facts
  } catch {
    // Cache the absence briefly too: a machine where DiskManagement is
    // unavailable should not launch a fresh failed process on every refresh.
    return {}
  }
}

function loadMacDriveFacts(drive: Pick<DriveInfo, "path">): Promise<MacDriveFacts> {
  const cached = macDriveFactsCache.get(drive.path)
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.facts)

  let inFlight = macDriveFactsInFlight.get(drive.path)
  if (!inFlight) {
    inFlight = collectMacDriveFacts(drive)
      .then((facts) => {
        macDriveFactsCache.set(drive.path, { facts, expiresAt: Date.now() + MAC_DRIVE_FACT_CACHE_MS })
        return facts
      })
      .finally(() => macDriveFactsInFlight.delete(drive.path))
    macDriveFactsInFlight.set(drive.path, inFlight)
  }
  return inFlight
}

async function enrichMacDrive(drive: DriveInfo): Promise<DriveInfo> {
  return applyMacDriveFacts(drive, await loadMacDriveFacts(drive))
}

/**
 * Resolve optional filesystem/snapshot facts for one already-discovered drive.
 *
 * `getDrives()` intentionally returns after a short first-paint budget. A
 * desktop host can call this afterwards and publish an IPC/UI update when it
 * resolves; concurrent calls join the same in-flight `diskutil` work. The
 * result is evidence only and never includes a snapshot byte estimate.
 */
export async function getDriveFacts(path: string): Promise<DriveFacts> {
  if (OS !== "darwin") return {}
  return copyMacDriveFacts(await loadMacDriveFacts({ path }))
}

function enrichMacDrivesWithinBudget(drives: DriveInfo[]): Promise<DriveInfo[]> {
  // Network mounts cannot be APFS volumes and are most likely to stall a
  // metadata command. Start only local/removable enrichment in the background.
  const enrichment = Promise.all(drives.map((drive) => (drive.type === "network" ? drive : enrichMacDrive(drive))))
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: DriveInfo[]) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => finish(drives), MAC_DRIVE_ENRICHMENT_BUDGET_MS)
    void enrichment.then(finish, () => finish(drives))
  })
}

const WINDOWS_DRIVE_DISCOVERY_SCRIPT = [
  "$drives = @(Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,Size,FreeSpace,DriveType)",
  "$complete = $true",
  "$mountRoots = @()",
  "try { $mountRoots = @(Get-Partition -ErrorAction Stop | ForEach-Object { $_.AccessPaths }) } catch { $complete = $false }",
  "[pscustomobject]@{ Drives = $drives; MountRoots = @($mountRoots | Where-Object { $_ } | Sort-Object -Unique); Complete = $complete } | ConvertTo-Json -Compress -Depth 4",
].join("; ")

function fallbackSystemDrive(): DriveInfo {
  return { path: "/", name: "System", label: "System (/)", total: 0, free: 0, used: 0, type: "local" }
}

export async function getDriveDiscovery(): Promise<DriveDiscovery> {
  if (IS_WIN) {
    try {
      const { stdout } = await execFileAsync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `[Console]::OutputEncoding=[Text.UTF8Encoding]::UTF8; ${WINDOWS_DRIVE_DISCOVERY_SCRIPT}`,
        ],
        { windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
      )
      const discovery = parseWindowsDriveDiscoveryOutput(stdout)
      if (discovery.drives.length) return discovery
    } catch {
      /* letter probe */
    }

    const letters = "CDEFGHIJKLMNOPQRSTUVWXYZ"
    const drives: DriveInfo[] = []
    const probes = letters.split("").map(async (letter) => {
      const p = `${letter}:\\`
      try {
        await access(p, fsConstants.R_OK)
        return {
          path: p,
          name: `Drive ${letter}:`,
          label: `(${letter}:)`,
          total: 0,
          free: 0,
          used: 0,
          type: "local" as const,
        }
      } catch {
        return null
      }
    })
    for (const d of await Promise.all(probes)) if (d) drives.push(d)
    return { drives, mountRoots: drives.map((drive) => drive.path), complete: false }
  }

  // `df -P` provides display capacity. Linux deletion safety uses mountinfo
  // separately because `df` may suppress bind and zero-sized mounts.
  let dfOutput: string | undefined
  let drives: DriveInfo[] = []
  try {
    const { stdout } = await execFileAsync("df", ["-kP"], { maxBuffer: 1024 * 1024 })
    dfOutput = stdout
    drives = parseDfOutput(stdout, OS)
  } catch {
    /* keep the picker fallback separate from mount-safety evidence */
  }

  let mountDiscovery: Pick<DriveDiscovery, "mountRoots" | "complete">
  if (OS === "linux") {
    try {
      mountDiscovery = parseLinuxMountInfo(await readFile("/proc/self/mountinfo", "utf8"))
    } catch {
      mountDiscovery = { mountRoots: [], complete: false }
    }
  } else {
    mountDiscovery = dfOutput ? parseDfMountDiscovery(dfOutput) : { mountRoots: [], complete: false }
  }

  if (drives.length || mountDiscovery.mountRoots.length) {
    return {
      drives: drives.length
        ? OS === "darwin"
          ? await enrichMacDrivesWithinBudget(drives)
          : drives
        : [fallbackSystemDrive()],
      ...mountDiscovery,
    }
  }

  return { drives: [fallbackSystemDrive()], mountRoots: ["/"], complete: false }
}

/** Drive-picker compatibility wrapper. Safety-sensitive code uses getDriveDiscovery(). */
export async function getDrives(): Promise<DriveInfo[]> {
  return (await getDriveDiscovery()).drives
}

function parseJson(stdout: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout.trim() || "[]")
  } catch {
    return undefined
  }
  return parsed
}

function parseWindowsDrives(parsed: unknown): DriveInfo[] {
  const value = isRecord(parsed) && Reflect.has(parsed, "Drives") ? parsed.Drives : parsed
  const items = Array.isArray(value) ? value : [value]
  return items.flatMap((item) => {
    if (!isRecord(item)) return []
    const drive = item
    const id = typeof drive.DeviceID === "string" ? drive.DeviceID.toUpperCase() : ""
    const driveType = Number(drive.DriveType)
    if (!/^[A-Z]:$/.test(id) || driveType === 5) return []

    const total = Math.max(0, Number(drive.Size) || 0)
    const free = Math.max(0, Number(drive.FreeSpace) || 0)
    const volumeName = typeof drive.VolumeName === "string" ? drive.VolumeName.trim() : ""
    return [
      {
        path: `${id}\\`,
        name: volumeName || `Drive ${id}`,
        label: `${volumeName ? `${volumeName} ` : ""}(${id})`,
        total,
        free,
        used: Math.max(0, total - free),
        type: driveType === 2 ? "removable" : driveType === 4 ? "network" : "local",
      } satisfies DriveInfo,
    ]
  })
}

export function parseWindowsDriveOutput(stdout: string): DriveInfo[] {
  return parseWindowsDrives(parseJson(stdout))
}

function normalizeWindowsMountRoot(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const path = value.trim().replace(/\//g, "\\")
  if (/^[a-z]:\\/i.test(path)) return path
  if (/^\\\\(?![?.]\\)[^\\]+\\[^\\]+/i.test(path)) return path
  return undefined
}

export function parseWindowsDriveDiscoveryOutput(stdout: string): DriveDiscovery {
  const parsed = parseJson(stdout)
  const drives = parseWindowsDrives(parsed)
  const reportedRoots = isRecord(parsed)
    ? Array.isArray(parsed.MountRoots)
      ? parsed.MountRoots
      : [parsed.MountRoots]
    : []
  const mountRoots: string[] = []
  const seen = new Set<string>()
  for (const candidate of [...drives.map((drive) => drive.path), ...reportedRoots]) {
    const root = normalizeWindowsMountRoot(candidate)
    if (!root) continue
    const key = root.toLowerCase().replace(/[\\]+$/, "")
    if (seen.has(key)) continue
    seen.add(key)
    mountRoots.push(root)
  }

  return {
    drives,
    mountRoots,
    complete: isRecord(parsed) && parsed.Complete === true && drives.length > 0 && mountRoots.length > 0,
  }
}

type DfRow = {
  source: string
  totalK: number
  freeK: number
  mount: string
}

function decodeDfMount(value: string): string {
  return value.replace(/\\040/g, " ").replace(/\\011/g, "\t").replace(/\\134/g, "\\")
}

function parseDfRows(stdout: string): { rows: DfRow[]; complete: boolean } {
  const lines = stdout.trim().split("\n")
  const dataLines = lines.slice(1).filter((line) => line.trim())
  const rows: DfRow[] = []
  let complete = lines.length > 1 && dataLines.length > 0
  for (const line of dataLines) {
    const match = line.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/)
    if (!match) {
      complete = false
      continue
    }
    const mount = decodeDfMount(match[5])
    if (!mount.startsWith("/")) {
      complete = false
      continue
    }
    rows.push({ source: match[1], totalK: Number(match[2]) || 0, freeK: Number(match[4]) || 0, mount })
  }
  if (!rows.some((row) => row.mount === "/")) complete = false
  return { rows, complete }
}

export function parseDfMountDiscovery(stdout: string): Pick<DriveDiscovery, "mountRoots" | "complete"> {
  const parsed = parseDfRows(stdout)
  return { mountRoots: [...new Set(parsed.rows.map((row) => row.mount))], complete: parsed.complete }
}

function decodeLinuxMountInfoPath(value: string): string {
  const escaped: Record<string, string> = { "040": " ", "011": "\t", "012": "\n", "134": "\\" }
  return value.replace(/\\(040|011|012|134)/g, (_match, code: string) => escaped[code])
}

/** Parse the kernel's complete, per-process Linux mount table. */
export function parseLinuxMountInfo(stdout: string): Pick<DriveDiscovery, "mountRoots" | "complete"> {
  const lines = stdout.split("\n").filter((line) => line.trim())
  const roots: string[] = []
  let complete = lines.length > 0
  for (const line of lines) {
    const separator = line.indexOf(" - ")
    const fields = (separator === -1 ? line : line.slice(0, separator)).split(" ")
    if (separator === -1 || fields.length < 6) {
      complete = false
      continue
    }
    const mount = decodeLinuxMountInfoPath(fields[4])
    if (!mount.startsWith("/")) {
      complete = false
      continue
    }
    roots.push(mount)
  }
  const mountRoots = [...new Set(roots)]
  if (!mountRoots.includes("/")) complete = false
  return { mountRoots, complete }
}

export function parseDfOutput(stdout: string, os: NodeJS.Platform): DriveInfo[] {
  const seen = new Set<string>()
  const drives: DriveInfo[] = []
  for (const { source, totalK, freeK, mount } of parseDfRows(stdout).rows) {
    if (seen.has(mount) || totalK < 1024 * 100) continue

    const baseName = mount.split("/").filter(Boolean).pop() || ""
    if (os === "darwin") {
      if (mount !== "/" && mount.startsWith("/System/Volumes/")) continue
      if (mount.startsWith("/private/") || mount.startsWith("/dev")) continue
      if (mount.startsWith(`${homedir()}/Library/Developer/`)) continue
      if (
        /^(com\.apple\..+|SimRuntimeBundle.*|Recovery|Preboot|Update|VM|Hardware|xarts|iSCPreboot|iOS_.*)$/i.test(
          baseName,
        )
      )
        continue
    }
    if (os === "linux") {
      if (/^\/(proc|sys|dev)(\/|$)/.test(mount)) continue
      if (mount.startsWith("/run/") && !mount.startsWith("/run/media/")) continue
      if (/^\/var\/lib\/(docker|containers|kubelet)(\/|$)/.test(mount) || mount.startsWith("/snap/")) continue
    }

    seen.add(mount)
    const total = totalK * 1024
    const free = freeK * 1024
    const network = source.startsWith("//") || (!source.startsWith("/dev/") && source.includes(":"))
    const removable =
      (os === "darwin" && mount.startsWith("/Volumes/")) ||
      (os === "linux" && /^(\/media|\/run\/media|\/mnt)(\/|$)/.test(mount))
    const name = mount === "/" ? (os === "darwin" ? "Macintosh HD" : "System") : baseName || source
    drives.push({
      path: mount,
      name,
      label: mount === "/" ? `${name} (/)` : `${name} (${mount})`,
      total,
      free,
      used: Math.max(0, total - free),
      type: network ? "network" : removable ? "removable" : "local",
    })
  }
  return drives.sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.name.localeCompare(b.name)))
}

/** Unknown/invalid OS estimates must never replace physical free space with zero. */
export function parseMacAvailableCapacity(stdout: string): Pick<DriveInfo, "available"> {
  try {
    const value = JSON.parse(stdout)?.available
    return Number.isSafeInteger(value) && value >= 0 ? { available: value } : {}
  } catch { return {} }
}
