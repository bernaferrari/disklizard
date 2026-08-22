/**
 * DiskLizard intelligence — the feature no disk cleaner has.
 *
 * Recognizes well-known space hogs (node_modules, build artifacts, caches, Xcode
 * DerivedData, Trash, logs…) and tags each with a human label, a safety verdict,
 * and an actionable hint. Drives the "Reclaim" estimate: a live, non-double-counted
 * total of space you can get back, broken down by category.
 *
 * Safety verdicts map to a single OKLCH accent so the whole UI stays coherent.
 */

import type { DiskScanNode } from "./types"
import { developerArtifactFromInventoryNode, developerInventoryNode } from "./developer-inventory"
import { daysSinceChanged, isDormant } from "./format"

export type Safety = "regenerable" | "cache" | "logs" | "trash" | "media" | "version-control" | "system" | "unknown"

export type DeveloperCategory =
  | "dependencies"
  | "build-output"
  | "toolchain-cache"
  | "agent-data"
  | "worktree"
  | "version-control"

/**
 * The project ecosystem behind a recognized developer artifact. `generic` is
 * deliberate: a name such as `build` is not enough evidence to call it Rust,
 * JVM, or any other toolchain.
 */
export const ARTIFACT_ECOSYSTEMS = [
  "node",
  "python",
  "rust",
  "jvm",
  "cpp",
  "go",
  "dotnet",
  "dart",
  "apple",
  "web",
  "containers",
  "tooling",
  "generic",
  "agent",
  "git",
] as const

export type ArtifactEcosystem = (typeof ARTIFACT_ECOSYSTEMS)[number]
export type ArtifactEcosystemFilter = ArtifactEcosystem | "all"

/** How directly the scanner's name, path, or child evidence identifies an artifact. */
export type ArtifactConfidence = "verified" | "likely" | "ambiguous"

/**
 * The bulk-cleanup posture for a developer artifact. Only `eligible` may be
 * preselected by Smart Cleanup; `review` remains visible but requires an
 * intentional individual decision.
 */
export type DeveloperArtifactCleanupReadiness = "eligible" | "review" | "protected"

/** Human labels are kept next to the stable filter values consumed by the UI. */
export function artifactEcosystemLabel(ecosystem: ArtifactEcosystem): string {
  switch (ecosystem) {
    case "node":
      return "Node.js"
    case "python":
      return "Python"
    case "rust":
      return "Rust"
    case "jvm":
      return "Java / Kotlin"
    case "cpp":
      return "C / C++"
    case "go":
      return "Go"
    case "dotnet":
      return ".NET"
    case "dart":
      return "Dart / Flutter"
    case "apple":
      return "Apple"
    case "web":
      return "Web tooling"
    case "containers":
      return "Containers"
    case "tooling":
      return "Developer tooling"
    case "generic":
      return "Unclassified"
    case "agent":
      return "Coding agents"
    case "git":
      return "Git"
  }
}

export type Recognition = {
  /** Short human label, e.g. "Node dependencies". */
  tag?: string
  safety: Safety
  /** Actionable hint, e.g. "npm install regenerates it". */
  hint?: string
  /** Developer-storage lens grouping. Presence means this belongs in the global developer index. */
  developer?: DeveloperCategory
  /** Toolchain/language classification backed by the matched name, path, or child evidence. */
  ecosystem?: ArtifactEcosystem
  /** Strength of the ecosystem and cleanup classification. */
  confidence?: ArtifactConfidence
  /** Conservative bulk-cleanup posture. Never use `review` or `protected` for automatic selection. */
  cleanup?: DeveloperArtifactCleanupReadiness
}

export type DeveloperArtifactContext = {
  /** Human scope, such as `Project · storefront` or `Gradle user data`. */
  scope: string
  /** The decision a user should make before acting. */
  disposition:
    | "Reinstallable"
    | "Rebuildable"
    | "Redownloadable"
    | "Manage with Git"
    | "Keep"
    | "Protected"
    | "Review first"
}

type Rule = {
  re: RegExp
  safety: Safety
  tag: string
  hint?: string
  developer?: DeveloperCategory
  ecosystem?: ArtifactEcosystem
  confidence?: ArtifactConfidence
  cleanup?: DeveloperArtifactCleanupReadiness
}

/** Ordered rules; first match wins. Matched against the lowercased basename. */
const DIR_RULES: Rule[] = [
  // — Build outputs & dependencies (rebuild / reinstall to restore) —
  {
    re: /^node_modules$/,
    safety: "regenerable",
    tag: "Node dependencies",
    hint: "Your package manager restores it from the project lockfile",
    developer: "dependencies",
    ecosystem: "node",
  },
  {
    re: /^bower_components$|^jspm_packages$/,
    safety: "regenerable",
    tag: "Package dependencies",
    hint: "The project package manager regenerates it",
    developer: "dependencies",
    ecosystem: "web",
  },
  {
    re: /^vendor$/,
    safety: "system",
    tag: "Vendored dependencies",
    hint: "Usually generated, but verify the project lockfile before removing",
    developer: "dependencies",
    ecosystem: "generic",
    confidence: "likely",
    cleanup: "review",
  },
  {
    re: /^pods$/,
    safety: "system",
    tag: "CocoaPods dependencies",
    hint: "Usually generated, but verify the project lockfile before removing",
    developer: "dependencies",
    ecosystem: "apple",
    cleanup: "review",
  },
  {
    re: /^__pycache__$|^\.pyc$|^\.mypy_cache$|^\.pytest_cache$|^\.ruff_cache$/,
    safety: "regenerable",
    tag: "Python cache",
    hint: "Recompiled on next run",
    developer: "toolchain-cache",
    ecosystem: "python",
  },
  {
    re: /^target$/,
    safety: "system",
    tag: "Possible build target",
    hint: "Review the project toolchain before removing",
    developer: "build-output",
    ecosystem: "generic",
    confidence: "ambiguous",
    cleanup: "review",
  },
  {
    re: /^\.next$|^\.nuxt$|^\.output$|^\.svelte-kit$/,
    safety: "regenerable",
    tag: "Framework build output",
    hint: "Rebuilt by the project framework",
    developer: "build-output",
    ecosystem: "node",
  },
  {
    re: /^build$|^dist$|^out$/,
    safety: "system",
    tag: "Possible build output",
    hint: "Common generated name, but verify before removing",
    developer: "build-output",
    ecosystem: "generic",
    confidence: "ambiguous",
    cleanup: "review",
  },
  {
    re: /^\.turbo$|^\.parcel-cache$|^\.rollup\.cache$|^cache\.cache$/,
    safety: "regenerable",
    tag: "Bundler cache",
    developer: "toolchain-cache",
    ecosystem: "node",
  },
  {
    re: /^deriveddata$/,
    safety: "regenerable",
    tag: "Build cache",
    hint: "Regenerated on next build",
    developer: "toolchain-cache",
    ecosystem: "apple",
  },
  {
    re: /^\.gradle$|^\.m2$|^\.ivy2$/,
    safety: "system",
    tag: "Build-tool data",
    hint: "Contains configuration as well as caches; inspect a precise subfolder",
    developer: "toolchain-cache",
    ecosystem: "jvm",
    cleanup: "protected",
  },
  {
    re: /^\.dart_tool$/,
    safety: "regenerable",
    tag: "Dart build cache",
    hint: "dart/pub regenerates it",
    developer: "toolchain-cache",
    ecosystem: "dart",
  },

  // — Caches (re-download / re-derive as needed) —
  {
    re: /^\.cache$|^caches?$|^\.caches$/,
    safety: "cache",
    tag: "Cache directory",
    hint: "Apps re-create this as needed",
    confidence: "likely",
  },
  {
    re: /^\.npm$|^\.pnpm-store$/,
    safety: "cache",
    tag: "Package cache",
    developer: "toolchain-cache",
    ecosystem: "node",
  },
  {
    re: /^\.yarn$|^\.bun$/,
    safety: "system",
    tag: "Package-manager data",
    hint: "May contain installed tools, project releases, plugins, or configuration",
    developer: "toolchain-cache",
    ecosystem: "node",
    cleanup: "protected",
  },
  { re: /^Library\/Caches$/, safety: "cache", tag: "macOS caches" },
  {
    re: /^\.cargo$/,
    safety: "system",
    tag: "Cargo data",
    hint: "Contains binaries, credentials, configuration, and disposable registries",
    developer: "toolchain-cache",
    ecosystem: "rust",
    cleanup: "protected",
  },

  // — Logs —
  { re: /^logs?$|^var\/log$|^log$/, safety: "logs", tag: "Log files", hint: "Usually safe to clear" },

  // — Trash / Recycle Bin —
  {
    re: /^\$recycle\.bin$/,
    safety: "trash",
    tag: "Recycle Bin",
    hint: "Empty or restore it through Windows",
  },
  {
    re: /^\.trash(es)?$|^trash$/,
    safety: "trash",
    tag: "System Trash",
    hint: "Empty or restore it through your operating system's Trash",
  },

  // — Stale toolchain caches (re-download or re-derive) —
  {
    re: /^coresimulator$/,
    safety: "system",
    tag: "Xcode Simulator data",
    hint: "May contain device data; manage runtimes and devices through Xcode",
    developer: "toolchain-cache",
    ecosystem: "apple",
    cleanup: "protected",
  },
  {
    re: /^\.docker$/,
    safety: "system",
    tag: "Docker data",
    hint: "May contain credentials and persistent volumes; manage it through Docker",
    developer: "toolchain-cache",
    ecosystem: "containers",
    cleanup: "protected",
  },
  {
    re: /^\.IntelliJIdea.+$|^\.CLion.+$|^\.Rider.+$|^\.AndroidStudio.+$|^JetBrains$/i,
    safety: "system",
    tag: "IDE data",
    hint: "May contain settings and project state as well as caches",
    developer: "toolchain-cache",
    ecosystem: "tooling",
    cleanup: "protected",
  },
  {
    re: /^\.nuget$/,
    safety: "system",
    tag: "NuGet data",
    hint: "Contains configuration as well as package caches",
    developer: "toolchain-cache",
    ecosystem: "dotnet",
    cleanup: "protected",
  },
  {
    re: /^\.rustup$/,
    safety: "system",
    tag: "Rust toolchains",
    hint: "Manage installed toolchains with rustup",
    developer: "toolchain-cache",
    ecosystem: "rust",
    cleanup: "protected",
  },

  // — Coding agents. These are visible in the developer lens but protected from cleanup. —
  {
    re: /^\.codex$/,
    safety: "system",
    tag: "Codex data",
    hint: "Agent sessions, configuration, skills, and worktrees — review before changing",
    developer: "agent-data",
    ecosystem: "agent",
    cleanup: "protected",
  },
  {
    re: /^\.claude$/,
    safety: "system",
    tag: "Claude Code data",
    hint: "Agent sessions, configuration, projects, and history — review before changing",
    developer: "agent-data",
    ecosystem: "agent",
    cleanup: "protected",
  },
  {
    re: /^\.opencode$|^\.cursor$|^\.continue$|^\.aider$|^\.windsurf$|^\.cline$|^\.roo$/,
    safety: "system",
    tag: "Coding agent data",
    hint: "May contain configuration, history, or active sessions",
    developer: "agent-data",
    ecosystem: "agent",
    cleanup: "protected",
  },
  {
    re: /^\.worktrees$|^worktrees$/,
    safety: "version-control",
    tag: "Worktrees",
    hint: "Linked checkouts — remove them through Git or the owning agent",
    developer: "worktree",
    ecosystem: "git",
    cleanup: "protected",
  },

  // — Keep: don't nuke these —
  {
    re: /^\.git$|^\.hg$|^\.svn$/,
    safety: "version-control",
    tag: "Version history",
    hint: "Your git history — keep it",
    developer: "version-control",
    ecosystem: "git",
    cleanup: "protected",
  },
  {
    re: /^\.venv$|^venv$|^env$/,
    safety: "system",
    tag: "Virtual environment",
    hint: "Recreatable, but preserve the project lockfile first",
    developer: "dependencies",
    ecosystem: "python",
    cleanup: "review",
  },
]

const RECLAIMABLE: ReadonlySet<Safety> = new Set(["regenerable", "cache", "logs"])

const MEDIA_EXT: ReadonlySet<string> = expand(
  "mp4 mov m4v mkv avi webm wmv flv mpg mpeg 3gp",
  "mp3 wav flac aac ogg opus m4a wma aiff alac",
  "png jpg jpeg gif webp heic heif tiff tif bmp svg ico raw cr2 nef arw psd",
)
const ARCHIVE_EXT: ReadonlySet<string> = expand("zip tar gz tgz bz2 xz 7z rar dmg iso lz zst cab pkg deb rpm")
const CODE_EXT: ReadonlySet<string> = expand(
  "ts tsx js jsx mjs cjs py rb rs go java kt scala c cpp cc h hpp cs php swift dart",
  "vue svelte astro elm ex exs erl lua pl pm clj cljs hs ml nim zig v",
)
const DOC_EXT: ReadonlySet<string> = expand(
  "pdf doc docx xls xlsx ppt pptx odt ods odp rtf pages key numbers epub mobi azw3",
)
const DATA_EXT: ReadonlySet<string> = expand("json xml yaml yml csv tsv sql db sqlite sqlite3 parquet toml ini conf")

function expand(...groups: string[]): ReadonlySet<string> {
  return new Set(groups.join(" ").split(/\s+/))
}

/** Categorize a file by its extension into a rough kind bucket. */
export function fileKind(ext: string): { kind: string; safety: Safety } {
  const e = ext.toLowerCase().replace(/^\./, "")
  if (!e) return { kind: "file", safety: "unknown" }
  if (MEDIA_EXT.has(e)) return { kind: labelFor(e), safety: "media" }
  if (ARCHIVE_EXT.has(e)) return { kind: "archive", safety: "unknown" }
  if (CODE_EXT.has(e)) return { kind: "code", safety: "unknown" }
  if (DOC_EXT.has(e)) return { kind: "document", safety: "unknown" }
  if (DATA_EXT.has(e)) return { kind: "data", safety: "unknown" }
  return { kind: "file", safety: "unknown" }
}

function labelFor(ext: string): string {
  if (["mp4", "mov", "m4v", "mkv", "avi", "webm", "wmv", "flv", "mpg", "mpeg", "3gp"].includes(ext)) return "video"
  if (["mp3", "wav", "flac", "aac", "ogg", "opus", "m4a", "wma", "aiff", "alac"].includes(ext)) return "audio"
  return "image"
}

const PATH_HINTS: { re: RegExp; r: Recognition }[] = [
  {
    re: /\/(?:\.codex|\.claude)\/worktrees(?:\/|$)/i,
    r: {
      tag: "Agent worktrees",
      safety: "version-control",
      hint: "Linked checkouts — remove them through the owning agent",
      developer: "worktree",
      ecosystem: "git",
      cleanup: "protected",
    },
  },
  {
    re: /\/\.git\/worktrees(?:\/|$)/i,
    r: {
      tag: "Git worktree metadata",
      safety: "version-control",
      hint: "Git manages this metadata — keep it",
      developer: "worktree",
      ecosystem: "git",
      cleanup: "protected",
    },
  },
  {
    re: /\/(?:\.config|\.local\/(?:share|state))\/opencode(?:\/|$)/i,
    r: {
      tag: "OpenCode data",
      safety: "system",
      hint: "Agent configuration, sessions, and cache — review before changing",
      developer: "agent-data",
      ecosystem: "agent",
      cleanup: "protected",
    },
  },
  {
    re: /\/Library\/Developer\/Xcode\/DerivedData\b/i,
    r: {
      tag: "Xcode DerivedData",
      safety: "regenerable",
      hint: "Xcode regenerates on next build",
      developer: "build-output",
      ecosystem: "apple",
    },
  },
  {
    re: /\/\.gradle\/(?:caches|wrapper\/dists|daemon)(?:\/|$)/i,
    r: {
      tag: "Gradle cache",
      safety: "cache",
      hint: "Gradle downloads or rebuilds it",
      developer: "toolchain-cache",
      ecosystem: "jvm",
    },
  },
  {
    re: /\/\.m2\/repository(?:\/|$)/i,
    r: {
      tag: "Maven repository",
      safety: "cache",
      hint: "Maven re-downloads dependencies",
      developer: "toolchain-cache",
      ecosystem: "jvm",
    },
  },
  {
    re: /\/\.cargo\/(?:registry|git)(?:\/|$)/i,
    r: {
      tag: "Cargo registry",
      safety: "cache",
      hint: "Cargo re-downloads dependencies",
      developer: "toolchain-cache",
      ecosystem: "rust",
    },
  },
  {
    re: /\/\.ivy2\/cache(?:\/|$)/i,
    r: {
      tag: "Ivy cache",
      safety: "cache",
      hint: "Ivy re-downloads dependencies",
      developer: "toolchain-cache",
      ecosystem: "jvm",
    },
  },
  {
    re: /\/\.nuget\/packages(?:\/|$)/i,
    r: {
      tag: "NuGet packages",
      safety: "cache",
      hint: "NuGet restores packages",
      developer: "toolchain-cache",
      ecosystem: "dotnet",
    },
  },
  {
    re: /\/\.bun\/install\/cache(?:\/|$)/i,
    r: {
      tag: "Bun package cache",
      safety: "cache",
      hint: "Bun re-downloads packages",
      developer: "toolchain-cache",
      ecosystem: "node",
    },
  },
  {
    re: /\/go\/pkg\/mod(?:\/|$)/i,
    r: {
      tag: "Go module cache",
      safety: "cache",
      hint: "Go re-downloads modules",
      developer: "toolchain-cache",
      ecosystem: "go",
    },
  },
  { re: /\/Library\/Caches\b/i, r: { tag: "macOS caches", safety: "cache", hint: "Apps re-create as needed" } },
  {
    re: /\/\.Trash\b|\/\.Trashes\b/i,
    r: {
      tag: "System Trash",
      safety: "trash",
      hint: "Empty or restore it through your operating system's Trash",
    },
  },
]

/**
 * The scanner classifies an artifact from its own direct evidence, but an
 * inventory-only node has no materialized ancestors for the renderer to walk.
 * Keep agent homes, managed worktrees, and VCS metadata authoritative over a
 * descendant's otherwise-valid cache/dependency name. These paths stay in the
 * Developer lens as protected context; they never become cleanup candidates.
 */
const PROTECTED_DEVELOPER_INVENTORY_ANCESTRY: { re: RegExp; r: Recognition }[] = [
  {
    re: /\/(?:\.codex|\.claude|\.opencode|\.cursor|\.continue|\.aider|\.windsurf|\.cline|\.roo)(?:\/|$)/i,
    r: {
      tag: "Coding agent data",
      safety: "system",
      hint: "Agent configuration, sessions, or managed checkouts — keep it out of cleanup",
      developer: "agent-data",
      ecosystem: "agent",
      cleanup: "protected",
    },
  },
  {
    re: /\/(?:\.git|\.hg|\.svn)(?:\/|$)/i,
    r: {
      tag: "Version-control data",
      safety: "version-control",
      hint: "Git or other VCS manages this data — keep it out of cleanup",
      developer: "version-control",
      ecosystem: "git",
      cleanup: "protected",
    },
  },
  {
    re: /(?:^|\/)(?:\.worktrees|worktrees)(?:\/|$)/i,
    r: {
      tag: "Managed worktree",
      safety: "version-control",
      hint: "Linked checkout data — remove it through Git or the owning agent",
      developer: "worktree",
      ecosystem: "git",
      cleanup: "protected",
    },
  },
]

/** Add conservative defaults without letting ambiguous names enter bulk cleanup. */
function finalizeDeveloperRecognition(recognition: Recognition): Recognition {
  if (!recognition.developer) return recognition
  const confidence = recognition.confidence ?? "verified"
  const cleanup =
    recognition.cleanup ??
    (recognition.safety === "regenerable" || recognition.safety === "cache"
      ? confidence === "verified"
        ? "eligible"
        : "review"
      : confidence === "ambiguous"
        ? "review"
        : "protected")
  return { ...recognition, confidence, cleanup }
}

/**
 * Apply path-level safety before trusting a scanner's local artifact verdict.
 * Protected hints win; precise known cache paths remain the deliberately
 * narrow exception elsewhere in a user's developer-data root.
 */
function developerInventoryPathRecognition(path: string): Recognition | undefined {
  const normalizedPath = path.replaceAll("\\", "/")
  const protectedHint = PATH_HINTS.find(({ re, r }) => r.cleanup === "protected" && re.test(normalizedPath))
  if (protectedHint) return finalizeDeveloperRecognition(protectedHint.r)
  const protectedAncestor = PROTECTED_DEVELOPER_INVENTORY_ANCESTRY.find(({ re }) => re.test(normalizedPath))
  if (protectedAncestor) return finalizeDeveloperRecognition(protectedAncestor.r)
  const preciseCacheHint = PATH_HINTS.find(({ re, r }) => r.cleanup !== "protected" && re.test(normalizedPath))
  return preciseCacheHint ? finalizeDeveloperRecognition(preciseCacheHint.r) : undefined
}

/**
 * The deep scanner has already classified these directories from its observed
 * name and local evidence. Preserve that verdict rather than making a second,
 * weaker decision from a synthetic node's basename.
 */
function recognizeDeveloperInventoryArtifact(node: DiskScanNode): Recognition | undefined {
  const artifact = developerArtifactFromInventoryNode(node)
  if (!artifact) return undefined

  const pathRecognition = developerInventoryPathRecognition(artifact.path)
  if (pathRecognition) return pathRecognition

  const safeToPreselect = artifact.cleanup === "eligible"
  const safety: Safety = safeToPreselect
    ? artifact.kind === "toolchain-cache"
      ? "cache"
      : "regenerable"
    : "system"
  const tag =
    artifact.kind === "dependencies"
      ? "Developer dependencies"
      : artifact.kind === "build-output"
        ? "Developer build output"
        : "Developer toolchain cache"
  const hint = safeToPreselect
    ? artifact.kind === "dependencies"
      ? "The project package manager restores it"
      : artifact.kind === "build-output"
        ? "The project build tool regenerates it"
        : "The related toolchain recreates or re-downloads it"
    : "The scanner found a conventional artifact but did not prove it is safe to remove automatically"

  return {
    safety,
    tag,
    hint,
    developer: artifact.kind,
    ecosystem: artifact.ecosystem,
    confidence: artifact.confidence,
    cleanup: artifact.cleanup,
  }
}

/** Recognize a node by basename (and a couple of path-based hints). */
export function recognize(node: DiskScanNode): Recognition {
  const inventoryRecognition = recognizeDeveloperInventoryArtifact(node)
  if (inventoryRecognition) return inventoryRecognition
  if (node.isHidden) {
    return {
      safety: "system",
      tag: "Hidden space",
      hint: "Filesystem metadata, snapshots, shared blocks, or restricted data",
    }
  }
  if (node.hardLink) {
    return {
      safety: "system",
      tag: node.hardLink === "primary" ? "Hard-linked file" : "Shared link",
      hint: node.hardLink === "primary" ? "Other paths may still reference these bytes" : "Counted at another path",
    }
  }
  if (node.cloneAccounting || node.clone?.state === "may-share-blocks" || node.clone?.state === "shares-all-blocks") {
    return {
      safety: "unknown",
      tag: node.cloneAccounting ? "APFS clone group" : "APFS shared blocks",
      hint: node.cloneAccounting
        ? "This clone group is charged once in the map. Moving one pathname may not free the shared allocation."
        : "This file may share APFS blocks. Moving one pathname does not guarantee that its displayed bytes become free.",
    }
  }
  if (!node.isDir) {
    if (node.name.toLowerCase() === ".git") {
      return finalizeDeveloperRecognition({
        safety: "version-control",
        tag: "Linked Git checkout",
        hint: "This file links a worktree or submodule to its Git metadata",
        developer: "worktree",
        ecosystem: "git",
        cleanup: "protected",
      })
    }
    const k = fileKind(node.ext)
    return k.safety !== "unknown" ? { safety: k.safety, tag: cap(k.kind) } : { safety: "unknown" }
  }
  if (node.children?.some((child) => !child.isDir && child.name.toLowerCase() === ".git")) {
    return finalizeDeveloperRecognition({
      safety: "version-control",
      tag: "Git worktree",
      hint: "Linked checkout — remove it with git worktree remove",
      developer: "worktree",
      ecosystem: "git",
      cleanup: "protected",
    })
  }
  const normalizedPath = node.path.replaceAll("\\", "/")
  for (const { re, r } of PATH_HINTS) if (re.test(normalizedPath)) return finalizeDeveloperRecognition(r)
  const base = node.name.toLowerCase()
  const hasRustMetadata = hasAnyChild(node, ".rustc_info.json")
  const hasRustOutput = hasAnyChild(node, "debug", "release")
  if (base === "target" && hasRustMetadata) {
    return finalizeDeveloperRecognition({
      safety: "regenerable",
      tag: "Rust build target",
      hint: "cargo clean regenerates it",
      developer: "build-output",
      ecosystem: "rust",
    })
  }
  if (base === "target" && hasRustOutput) {
    return finalizeDeveloperRecognition({
      safety: "regenerable",
      tag: "Rust build target",
      hint: "cargo clean regenerates it",
      developer: "build-output",
      ecosystem: "rust",
      confidence: "likely",
    })
  }
  if (base === "target" && hasAnyChild(node, "classes", "test-classes", "generated-sources", "surefire-reports")) {
    return finalizeDeveloperRecognition({
      safety: "regenerable",
      tag: "Maven build target",
      hint: "mvn clean regenerates it",
      developer: "build-output",
      ecosystem: "jvm",
      confidence: "likely",
    })
  }
  const isCmakeBuild = hasAnyChild(node, "cmakefiles", "cmakecache.txt", "build.ninja")
  const generatedBuildChildCount = countNamedChildren(
    node,
    "classes",
    "generated",
    "kotlin",
    "tmp",
    "resources",
    "reports",
    "libs",
    "intermediates",
  )
  if (
    base === "build" &&
    (isCmakeBuild || generatedBuildChildCount >= 2)
  ) {
    return finalizeDeveloperRecognition({
      safety: "regenerable",
      tag: "Generated build output",
      hint: "The project build tool regenerates it",
      developer: "build-output",
      ecosystem: isCmakeBuild ? "cpp" : "jvm",
      confidence: isCmakeBuild ? "verified" : "likely",
    })
  }
  if (base === ".gradle" && hasAnyChild(node, "caches", "wrapper", "daemon")) {
    return finalizeDeveloperRecognition({
      safety: "system",
      tag: "Gradle user data",
      hint: "Open it to separate disposable caches from configuration",
      developer: "toolchain-cache",
      ecosystem: "jvm",
      cleanup: "protected",
    })
  }
  for (const rule of DIR_RULES)
    if (rule.re.test(base))
      return finalizeDeveloperRecognition({
        tag: rule.tag,
        safety: rule.safety,
        hint: rule.hint,
        developer: rule.developer,
        ecosystem: rule.ecosystem,
        confidence: rule.confidence,
        cleanup: rule.cleanup,
      })
  if (node.isOther) return { safety: "unknown", tag: "Other" }
  return { safety: "unknown" }
}

/** Explain where a developer artifact belongs and the safest next decision, independent of path separators. */
export function developerArtifactContext(
  node: DiskScanNode,
  recognition: Recognition = recognize(node),
): DeveloperArtifactContext {
  const normalized = node.path.replaceAll("\\", "/").replace(/\/+$/, "")
  const lower = normalized.toLowerCase()
  const parts = normalized.split("/").filter(Boolean)
  const parent = parts.at(-2)
  const project = !parent || /^[a-z]:$/i.test(parent) ? "Selected folder" : `Project · ${parent}`

  const includesSegment = (segment: string) =>
    lower === segment ||
    lower.startsWith(`${segment}/`) ||
    lower.includes(`/${segment}/`) ||
    lower.endsWith(`/${segment}`)

  let scope = project
  if (recognition.developer === "agent-data") {
    if (includesSegment(".codex")) scope = "Codex agent home"
    else if (includesSegment(".claude")) scope = "Claude Code agent home"
    else if (includesSegment(".opencode") || /\/(?:\.config|\.local\/(?:share|state))\/opencode(?:\/|$)/i.test(lower))
      scope = "OpenCode agent home"
    else scope = "Coding-agent data"
  } else if (recognition.developer === "worktree") {
    if (includesSegment(".codex")) scope = "Codex-managed checkout"
    else if (includesSegment(".claude")) scope = "Claude Code-managed checkout"
    else scope = "Git-managed checkout"
  } else if (recognition.developer === "toolchain-cache") {
    if (includesSegment(".gradle")) scope = "Gradle user data"
    else if (includesSegment(".m2")) scope = "Maven user data"
    else if (includesSegment(".cargo")) scope = "Cargo user data"
    else if (includesSegment(".nuget")) scope = "NuGet user data"
    else if (includesSegment(".bun")) scope = "Bun user data"
    else if (/\/go\/pkg\/mod(?:\/|$)/i.test(lower)) scope = "Go module cache"
    else if (/\/library\/developer\/xcode(?:\/|$)/i.test(lower)) scope = "Xcode build data"
  }

  let disposition: DeveloperArtifactContext["disposition"]
  if (recognition.safety === "regenerable") {
    disposition = recognition.developer === "dependencies" ? "Reinstallable" : "Rebuildable"
  } else if (recognition.safety === "cache") disposition = "Redownloadable"
  else if (recognition.safety === "version-control")
    disposition = recognition.developer === "worktree" ? "Manage with Git" : "Keep"
  else if (recognition.safety === "system" && recognition.developer === "agent-data") disposition = "Protected"
  else disposition = "Review first"

  return { scope, disposition }
}

function hasAnyChild(node: DiskScanNode, ...names: string[]): boolean {
  const expected = new Set(names)
  return nodeEvidence(node).some((name) => expected.has(name))
}

function countNamedChildren(node: DiskScanNode, ...names: string[]): number {
  const expected = new Set(names)
  return nodeEvidence(node).reduce((count, name) => count + Number(expected.has(name)), 0)
}

function nodeEvidence(node: DiskScanNode): string[] {
  const evidence = new Set(node.signatures ?? [])
  for (const child of node.children ?? []) evidence.add(child.name.toLowerCase())
  return [...evidence]
}

export function isReclaimable(r: Recognition): boolean {
  return RECLAIMABLE.has(r.safety)
}

/** Match a user-selected language/toolchain facet without special casing missing metadata in the UI. */
export function matchesArtifactEcosystem(
  recognition: Recognition,
  ecosystem: ArtifactEcosystemFilter | undefined,
): boolean {
  return !ecosystem || ecosystem === "all" || recognition.ecosystem === ecosystem
}

/**
 * Convert recognition evidence into the exact bulk-cleanup decision. This is
 * intentionally stricter than `isReclaimable`: a generic or only-likely match
 * may be reviewed, but must never be selected automatically.
 */
export function developerArtifactCleanupReadiness(recognition: Recognition): DeveloperArtifactCleanupReadiness {
  if (!recognition.developer) return "protected"
  return finalizeDeveloperRecognition(recognition).cleanup ?? "protected"
}

/**
 * A selected directory can contain clone-accounted or hard-linked files
 * without being shared itself. Its aggregate bytes cannot be promised as
 * reclaim because the peer pathname may sit outside that directory.
 */
export function containsSharedPhysicalStorage(node: DiskScanNode): boolean {
  return (
    !!node.hardLink ||
    !!node.cloneAccounting ||
    node.clone?.state === "may-share-blocks" ||
    node.clone?.state === "shares-all-blocks" ||
    node.children.some(containsSharedPhysicalStorage)
  )
}

/**
 * Whether Smart Cleanup may preselect this artifact. Callers still need to
 * apply their platform's protected-path policy before adding it to review.
 */
export function isSmartCleanupEligible(node: DiskScanNode, recognition: Recognition = recognize(node)): boolean {
  return (
    !!recognition.developer &&
    developerArtifactCleanupReadiness(recognition) === "eligible" &&
    !containsSharedPhysicalStorage(node)
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export type ReclaimBucket = {
  safety: Safety
  bytes: number
  count: number
  /** Largest reclaimable items, for a review list. */
  items: { node: DiskScanNode; recognition: Recognition }[]
}

export type ReclaimSummary = {
  totalBytes: number
  totalCount: number
  buckets: ReclaimBucket[]
}

export type DeveloperBucket = {
  category: DeveloperCategory
  bytes: number
  count: number
  items: DeveloperItem[]
}

export type DeveloperItem = { node: DiskScanNode; recognition: Recognition; bytes: number }

/** Pure filter contract for the Smart Cleanup developer inventory. */
export type DeveloperArtifactFilter = {
  category?: DeveloperCategory | "all"
  ecosystem?: ArtifactEcosystemFilter
  readiness?: DeveloperArtifactCleanupReadiness | "all"
  /** `null` / `undefined` means do not filter by change age. Unknown dates never match an age filter. */
  minAgeDays?: number | null
}

/**
 * A modified-time filter, not a claim about last use. This remains explicit so
 * the UI can say “unchanged for 30 days”, rather than implying usage tracking.
 */
export function isDeveloperArtifactOlderThan(node: DiskScanNode, minAgeDays: number, now = Date.now()): boolean {
  if (!Number.isFinite(minAgeDays) || minAgeDays < 0) return false
  const age = daysSinceChanged(node.modifiedAt, now)
  return age !== null && age >= Math.floor(minAgeDays)
}

/** Apply category, language/toolchain, safety posture, and age facets consistently across views. */
export function matchesDeveloperArtifact(
  item: DeveloperItem,
  filter: DeveloperArtifactFilter = {},
  now = Date.now(),
): boolean {
  const { recognition, node } = item
  if (filter.category && filter.category !== "all" && recognition.developer !== filter.category) return false
  if (!matchesArtifactEcosystem(recognition, filter.ecosystem)) return false
  if (
    filter.readiness &&
    filter.readiness !== "all" &&
    developerArtifactCleanupReadiness(recognition) !== filter.readiness
  )
    return false
  if (filter.minAgeDays !== undefined && filter.minAgeDays !== null)
    return isDeveloperArtifactOlderThan(node, filter.minAgeDays, now)
  return true
}

export type DeveloperSummary = {
  totalBytes: number
  totalCount: number
  buckets: DeveloperBucket[]
  items: DeveloperItem[]
}

export type DormantDeveloperSummary = {
  bytes: number
  count: number
  items: DeveloperItem[]
}

/**
 * Build a scan-wide developer index without double counting nested artifacts. A
 * recognized directory represents its complete subtree, so `.codex` or
 * `node_modules` appears once instead of also counting every cache inside it.
 */
export function computeDeveloperSummary(root: DiskScanNode | null): DeveloperSummary {
  const buckets = new Map<DeveloperCategory, DeveloperBucket>()

  function add(node: DiskScanNode, recognition: Recognition, bytes: number) {
    if (!recognition.developer || bytes <= 0) return
    let entry = buckets.get(recognition.developer)
    if (!entry) {
      entry = { category: recognition.developer, bytes: 0, count: 0, items: [] }
      buckets.set(recognition.developer, entry)
    }
    entry.bytes += bytes
    entry.count += 1
    entry.items.push({ node, recognition, bytes })
  }

  function walk(node: DiskScanNode): number {
    const recognition = recognize(node)
    if (recognition.developer && node.size > 0) {
      // Agent and VCS roots are meaningful containers. Peel out recognizable
      // worktrees/caches below them, then attribute only the remainder here.
      if (
        recognition.safety === "system" ||
        recognition.developer === "agent-data" ||
        recognition.developer === "version-control"
      ) {
        const nested = (node.children ?? []).reduce((sum, child) => sum + walk(child), 0)
        add(node, recognition, Math.max(0, node.size - nested))
        return node.size
      }
      add(node, recognition, node.size)
      return node.size
    }
    return (node.children ?? []).reduce((sum, child) => sum + walk(child), 0)
  }

  const totalBytes = root ? walk(root) : 0
  const list = [...buckets.values()].sort((a, b) => b.bytes - a.bytes)
  for (const bucket of list) bucket.items.sort((a, b) => b.bytes - a.bytes)
  const items = list.flatMap((bucket) => bucket.items).sort((a, b) => b.bytes - a.bytes)
  return {
    totalBytes,
    totalCount: list.reduce((sum, bucket) => sum + bucket.count, 0),
    buckets: list,
    items,
  }
}

type DeveloperSummaryCandidate = {
  item: DeveloperItem
  source: "visual" | "inventory"
  path: string
  /** A candidate that is not safe for Smart Cleanup can be split around a more precise descendant. */
  canSplitAroundDescendants: boolean
}

function normalizedDeveloperPath(path: string) {
  return path.replaceAll("\\", "/").replace(/\/+$/, "") || "/"
}

function developerPathContains(parent: string, child: string) {
  return parent !== child && (parent === "/" ? child.startsWith("/") : child.startsWith(`${parent}/`))
}

function candidateDepth(candidate: DeveloperSummaryCandidate) {
  return candidate.path === "/" ? 0 : candidate.path.split("/").filter(Boolean).length
}

/**
 * Add the opt-in deep scanner inventory without pretending that nested
 * directories are extra bytes. Visual nodes win on an exact pathname. A
 * review-only container may be split around a precise deep child; an eligible
 * root already covers its descendants and remains the safer, simpler choice.
 */
export function computeDeveloperSummaryWithInventory(root: DiskScanNode | null): DeveloperSummary {
  const visible = computeDeveloperSummary(root)
  const inventory = root?.developerArtifactInventory
  if (!inventory?.items.length) return visible

  const visualCandidates: DeveloperSummaryCandidate[] = visible.items.map((item) => ({
    item,
    source: "visual",
    path: normalizedDeveloperPath(item.node.path),
    canSplitAroundDescendants: developerArtifactCleanupReadiness(item.recognition) !== "eligible",
  }))
  const visualPaths = new Set(visualCandidates.map((candidate) => candidate.path))
  const inventoryCandidates: DeveloperSummaryCandidate[] = inventory.items
    .filter((artifact) => artifact.size > 0 && artifact.path.trim().length > 0)
    .map((artifact) => {
      const node = developerInventoryNode(artifact)
      const recognition = recognize(node)
      return {
        item: { node, recognition, bytes: node.size },
        source: "inventory" as const,
        path: normalizedDeveloperPath(node.path),
        canSplitAroundDescendants: developerArtifactCleanupReadiness(recognition) !== "eligible",
      }
    })
    // A materialized visible child is more useful than a synthetic ancestor:
    // it has navigable map context and may have richer direct evidence.
    .filter(
      (candidate) =>
        !visualPaths.has(candidate.path) &&
        !visualCandidates.some((visual) => developerPathContains(candidate.path, visual.path)),
    )

  const candidatesByPath = new Map<string, DeveloperSummaryCandidate>()
  // Register visible map entries first so an exact deep record cannot replace
  // the item already represented in the visual tree.
  for (const candidate of visualCandidates) candidatesByPath.set(candidate.path, candidate)
  for (const candidate of inventoryCandidates) {
    if (!candidatesByPath.has(candidate.path)) candidatesByPath.set(candidate.path, candidate)
  }

  const candidates = [...candidatesByPath.values()].sort(
    (a, b) =>
      candidateDepth(a) - candidateDepth(b) ||
      (a.source === b.source ? 0 : a.source === "visual" ? -1 : 1) ||
      b.item.bytes - a.item.bytes,
  )
  const accepted: DeveloperSummaryCandidate[] = []
  for (const candidate of candidates) {
    const coveredByEligibleAncestor = accepted.some(
      (ancestor) => developerPathContains(ancestor.path, candidate.path) && !ancestor.canSplitAroundDescendants,
    )
    if (!coveredByEligibleAncestor) accepted.push(candidate)
  }

  const merged = accepted
    .map((candidate) => {
      if (!candidate.canSplitAroundDescendants) return candidate.item
      const directNested = accepted.filter(
        (child) =>
          // `computeDeveloperSummary` already charges a visual child against
          // its review/protected ancestor. Only a newly added deep record is
          // extra coverage that needs subtracting from this visible remainder.
          child.source === "inventory" &&
          developerPathContains(candidate.path, child.path) &&
          !accepted.some(
            (between) =>
              between !== candidate &&
              between !== child &&
              developerPathContains(candidate.path, between.path) &&
              developerPathContains(between.path, child.path),
          ),
      )
      // `node.size` is the true aggregate of the nested pathname. The visual
      // summary may already be a remainder, so never let a subtraction go
      // below zero.
      const nestedBytes = directNested.reduce((sum, child) => sum + child.item.node.size, 0)
      return { ...candidate.item, bytes: Math.max(0, candidate.item.bytes - nestedBytes) }
    })
    .filter((item) => item.bytes > 0)

  const buckets = new Map<DeveloperCategory, DeveloperBucket>()
  for (const item of merged) {
    const category = item.recognition.developer
    if (!category) continue
    let bucket = buckets.get(category)
    if (!bucket) {
      bucket = { category, bytes: 0, count: 0, items: [] }
      buckets.set(category, bucket)
    }
    bucket.bytes += item.bytes
    bucket.count += 1
    bucket.items.push(item)
  }
  const list = [...buckets.values()].sort((a, b) => b.bytes - a.bytes)
  for (const bucket of list) bucket.items.sort((a, b) => b.bytes - a.bytes)
  const items = list.flatMap((bucket) => bucket.items).sort((a, b) => b.bytes - a.bytes)
  return {
    totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
    totalCount: items.length,
    buckets: list,
    items,
  }
}

export function computeDormantDeveloperSummary(summary: DeveloperSummary, now = Date.now()): DormantDeveloperSummary {
  const items = summary.items.filter(({ node }) => isDormant(node.modifiedAt, now))
  return { items, bytes: items.reduce((sum, item) => sum + item.bytes, 0), count: items.length }
}

/**
 * Walk the tree summing reclaimable space WITHOUT double counting: when a node is
 * itself reclaimable, its whole subtree is counted once and we stop descending.
 */
export function computeReclaim(root: DiskScanNode | null): ReclaimSummary {
  const buckets = new Map<Safety, ReclaimBucket>()
  const bucket = (s: Safety): ReclaimBucket => {
    let b = buckets.get(s)
    if (!b) {
      b = { safety: s, bytes: 0, count: 0, items: [] }
      buckets.set(s, b)
    }
    return b
  }

  function walk(node: DiskScanNode) {
    const r = recognize(node)
    if (isReclaimable(r) && node.size > 0 && !containsSharedPhysicalStorage(node)) {
      const b = bucket(r.safety)
      b.bytes += node.size
      b.count += 1
      b.items.push({ node, recognition: r })
      return // count the subtree whole; do not descend
    }
    for (const child of node.children ?? []) walk(child)
  }
  if (root) walk(root)

  const list = [...buckets.values()].sort((a, b) => b.bytes - a.bytes)
  for (const b of list) b.items.sort((a, b) => b.node.size - a.node.size)
  return {
    totalBytes: list.reduce((s, b) => s + b.bytes, 0),
    totalCount: list.reduce((s, b) => s + b.count, 0),
    buckets: list,
  }
}
