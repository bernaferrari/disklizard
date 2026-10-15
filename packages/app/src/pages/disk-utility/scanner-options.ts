import type { DiskLizardOS } from "./runtime"
import type { DiskDriveInfo } from "./types"
import { diskPathEquals } from "./storage"

const IMPORTANT_PRESERVE_NAMES = [
  "$recycle.bin",
  ".trash",
  ".trashes",
  "trash",
  "windows.old",
  "pagefile.sys",
  "hiberfil.sys",
  "swapfile.sys",
  "lost+found",
  "node_modules",
  "bower_components",
  "jspm_packages",
  "__pycache__",
  "target",
  "build",
  "dist",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".gradle",
  ".m2",
  ".ivy2",
  ".cargo",
  ".rustup",
  ".nuget",
  ".npm",
  ".pnpm-store",
  ".yarn",
  ".bun",
  ".docker",
  ".dart_tool",
  "deriveddata",
  "coresimulator",
  ".venv",
  ".git",
  ".worktrees",
  "worktrees",
  ".codex",
  ".claude",
  ".opencode",
  "opencode",
  ".cursor",
  ".continue",
  ".aider",
] as const

const DEVELOPER_COLLAPSE_NAMES = [
  "node_modules",
  "bower_components",
  "jspm_packages",
  "__pycache__",
  "target",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".parcel-cache",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".npm",
  ".pnpm-store",
  ".dart_tool",
  "deriveddata",
  "coresimulator",
  ".rustup",
  ".docker",
  ".venv",
  ".git",
] as const

/** Bounded direct-entry evidence retained while large developer trees stay collapsed. */
const DEVELOPER_SIGNATURE_NAMES = [
  ".rustc_info.json",
  "debug",
  "release",
  "classes",
  "test-classes",
  "generated-sources",
  "surefire-reports",
  "generated",
  "kotlin",
  "tmp",
  "resources",
  "reports",
  "libs",
  "intermediates",
  "cmakefiles",
  "cmakecache.txt",
  "build.ninja",
  "caches",
  "wrapper",
  "daemon",
] as const

export function scannerOptions(
  os: DiskLizardOS | undefined,
  drive?: DiskDriveInfo,
  includeDeveloperInventory = true,
  scanPath?: string
) {
  const wholeVolume =
    !!drive && !!scanPath && diskPathEquals(scanPath, drive.path, os)
  return {
    // Materialize the visible map only; deeper branches remain exact-sized
    // aggregate nodes and are expanded on demand.
    maxDepth: wholeVolume ? 6 : 8,
    sizeMode:
      os === "windows" || drive?.type === "network"
        ? ("logical" as const)
        : ("physical" as const),
    preserveNames: [...IMPORTANT_PRESERVE_NAMES],
    collapseNames: wholeVolume ? [...DEVELOPER_COLLAPSE_NAMES] : [],
    signatureNames: [...DEVELOPER_SIGNATURE_NAMES],
    // This is intentionally separate from the visual depth limit so the
    // Developer lens can expose deep build/dependency artifacts too. Focused
    // subtree expansions leave it out: the root inventory remains the sole
    // authoritative bounded traversal for the current map.
    ...(includeDeveloperInventory
      ? { developerArtifactInventory: { maxItems: 2_000 } }
      : {}),
  }
}
