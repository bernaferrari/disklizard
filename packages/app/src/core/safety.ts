export type DiskPlatform = "darwin" | "linux" | "win32"

const PROTECTED: Record<DiskPlatform, string[]> = {
  darwin: [
    "/Applications",
    "/System",
    "/Library",
    "/bin",
    "/cores",
    "/dev",
    "/Network",
    "/opt",
    "/private",
    "/sbin",
    "/usr",
  ],
  linux: [
    "/bin",
    "/boot",
    "/dev",
    "/etc",
    "/lib",
    "/lib64",
    "/lost+found",
    "/opt",
    "/proc",
    "/root",
    "/run",
    "/sbin",
    "/snap",
    "/swapfile",
    "/sys",
    "/usr",
    "/var",
  ],
  win32: [
    "/$Recycle.Bin",
    "/$WinREAgent",
    "/Boot",
    "/EFI",
    "/hiberfil.sys",
    "/pagefile.sys",
    "/PerfLogs",
    "/Program Files",
    "/Program Files (x86)",
    "/ProgramData",
    "/Recovery",
    "/swapfile.sys",
    "/System Volume Information",
    "/Windows",
    "/Windows.old",
  ],
}

const PROTECTED_EXACT: Record<DiskPlatform, string[]> = {
  darwin: ["/Users", "/Volumes", "/etc", "/home", "/net", "/tmp", "/var"],
  linux: ["/home", "/media", "/mnt", "/tmp"],
  win32: ["/Users"],
}

const PROTECTED_DEVELOPER_COMPONENTS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".codex",
  ".claude",
  ".opencode",
  ".cursor",
  ".continue",
  ".aider",
  ".windsurf",
  ".cline",
  ".roo",
  ".worktrees",
  "worktrees",
  ".trash",
  ".trashes",
  "$recycle.bin",
])

function normalize(targetPath: string, platform: DiskPlatform) {
  const withSlashes = targetPath.trim().replace(/\\/g, "/")
  const collapsed =
    platform === "win32" && withSlashes.startsWith("//")
      ? `//${withSlashes.slice(2).replace(/\/+/g, "/")}`
      : withSlashes.replace(/\/+/g, "/")
  const withoutTrailing = collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed
  return platform === "win32" ? withoutTrailing.toLowerCase() : withoutTrailing
}

function containsOrEquals(candidate: string, protectedPath: string) {
  return candidate === protectedPath || candidate.startsWith(`${protectedPath}/`)
}

export function deletionBlockReason(
  targetPath: string,
  platform: DiskPlatform,
  options: { homePath?: string; mountRoots?: readonly string[] } = {},
): string | undefined {
  if (!targetPath.trim() || targetPath.includes("\0")) return "The deletion path is invalid."
  const candidate = normalize(targetPath, platform)
  if (candidate.split("/").some((part) => part === "." || part === ".."))
    return "Relative deletion paths are not allowed."

  if (platform === "win32") {
    if (/^\/\/[?.]\//.test(candidate) || (!/^[a-z]:\//i.test(candidate) && !/^\/\/[^/]+\/[^/]+/i.test(candidate))) {
      return "The deletion path must be absolute."
    }
    if (/^[a-z]:$/i.test(candidate) || /^\/\/[^/]+\/[^/]+$/i.test(candidate)) {
      return "A drive root cannot be removed."
    }
    const drive = /^[a-z]:/i.exec(candidate)?.[0] ?? ""
    for (const suffix of PROTECTED.win32) {
      if (containsOrEquals(candidate, normalize(`${drive}${suffix}`, platform))) {
        return "Windows system and application directories are protected."
      }
    }
    if (PROTECTED_EXACT.win32.some((suffix) => candidate === normalize(`${drive}${suffix}`, platform))) {
      return "The user-profile container cannot be removed."
    }
    if (/^[a-z]:\/users\/[^/]+$/i.test(candidate)) {
      return "An entire user profile cannot be removed as a single item."
    }
  } else {
    if (!candidate.startsWith("/")) return "The deletion path must be absolute."
    if (candidate === "/") return "The filesystem root cannot be removed."
    for (const protectedPath of PROTECTED[platform]) {
      if (containsOrEquals(candidate, protectedPath)) return "Operating-system files are protected."
    }
    if (PROTECTED_EXACT[platform].includes(candidate)) return "This operating-system container cannot be removed."
    if (
      (platform === "darwin" && /^\/Users\/[^/]+$/.test(candidate)) ||
      (platform === "linux" && /^\/home\/[^/]+$/.test(candidate))
    ) {
      return "An entire home directory cannot be removed as a single item."
    }
  }

  if (candidate.split("/").some((part) => PROTECTED_DEVELOPER_COMPONENTS.has(part.toLowerCase()))) {
    return "Version-control, worktree, and coding-agent data must be managed by their owning tool."
  }

  if (options.homePath && candidate === normalize(options.homePath, platform)) {
    return "Your home directory cannot be removed as a single item."
  }
  if (options.mountRoots?.some((root) => candidate === normalize(root, platform))) {
    return "A mounted volume cannot be removed."
  }
  return undefined
}

export function canDeletePath(targetPath: string, platform: DiskPlatform) {
  return deletionBlockReason(targetPath, platform) === undefined
}
