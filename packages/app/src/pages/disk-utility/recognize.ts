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

import type { DiskScanNode } from "@/context/platform"
import { isDormant } from "./format"

export type Safety = "regenerable" | "cache" | "logs" | "trash" | "media" | "version-control" | "system" | "unknown"

export type DeveloperCategory =
  | "dependencies"
  | "build-output"
  | "toolchain-cache"
  | "agent-data"
  | "worktree"
  | "version-control"

export type Recognition = {
  /** Short human label, e.g. "Node dependencies". */
  tag?: string
  safety: Safety
  /** Actionable hint, e.g. "npm install regenerates it". */
  hint?: string
  /** Developer-storage lens grouping. Presence means this belongs in the global developer index. */
  developer?: DeveloperCategory
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

type Rule = { re: RegExp; safety: Safety; tag: string; hint?: string; developer?: DeveloperCategory }

/** Ordered rules; first match wins. Matched against the lowercased basename. */
const DIR_RULES: Rule[] = [
  // — Build outputs & dependencies (rebuild / reinstall to restore) —
  {
    re: /^node_modules$/,
    safety: "regenerable",
    tag: "Node dependencies",
    hint: "Your package manager restores it from the project lockfile",
    developer: "dependencies",
  },
  {
    re: /^bower_components$|^jspm_packages$/,
    safety: "regenerable",
    tag: "Package dependencies",
    hint: "The project package manager regenerates it",
    developer: "dependencies",
  },
  {
    re: /^vendor$|^pods$/,
    safety: "system",
    tag: "Vendored dependencies",
    hint: "Usually generated, but verify the project lockfile before removing",
    developer: "dependencies",
  },
  {
    re: /^__pycache__$|^\.pyc$|^\.mypy_cache$|^\.pytest_cache$|^\.ruff_cache$/,
    safety: "regenerable",
    tag: "Python cache",
    hint: "Recompiled on next run",
    developer: "toolchain-cache",
  },
  {
    re: /^target$/,
    safety: "system",
    tag: "Possible build target",
    hint: "Review the project toolchain before removing",
    developer: "build-output",
  },
  {
    re: /^\.next$|^\.nuxt$|^\.output$|^\.svelte-kit$/,
    safety: "regenerable",
    tag: "Framework build output",
    hint: "Rebuilt by the project framework",
    developer: "build-output",
  },
  {
    re: /^build$|^dist$|^out$/,
    safety: "system",
    tag: "Possible build output",
    hint: "Common generated name, but verify before removing",
    developer: "build-output",
  },
  {
    re: /^\.turbo$|^\.parcel-cache$|^\.rollup\.cache$|^cache\.cache$/,
    safety: "regenerable",
    tag: "Bundler cache",
    developer: "toolchain-cache",
  },
  {
    re: /^deriveddata$/,
    safety: "regenerable",
    tag: "Build cache",
    hint: "Regenerated on next build",
    developer: "toolchain-cache",
  },
  {
    re: /^\.gradle$|^\.m2$|^\.ivy2$/,
    safety: "system",
    tag: "Build-tool data",
    hint: "Contains configuration as well as caches; inspect a precise subfolder",
    developer: "toolchain-cache",
  },
  {
    re: /^\.dart_tool$/,
    safety: "regenerable",
    tag: "Dart build cache",
    hint: "dart/pub regenerates it",
    developer: "toolchain-cache",
  },

  // — Caches (re-download / re-derive as needed) —
  {
    re: /^\.cache$|^caches?$|^\.caches$/,
    safety: "cache",
    tag: "Cache directory",
    hint: "Apps re-create this as needed",
  },
  {
    re: /^\.npm$|^\.pnpm-store$/,
    safety: "cache",
    tag: "Package cache",
    developer: "toolchain-cache",
  },
  {
    re: /^\.yarn$|^\.bun$/,
    safety: "system",
    tag: "Package-manager data",
    hint: "May contain installed tools, project releases, plugins, or configuration",
    developer: "toolchain-cache",
  },
  { re: /^Library\/Caches$/, safety: "cache", tag: "macOS caches" },
  {
    re: /^\.cargo$/,
    safety: "system",
    tag: "Cargo data",
    hint: "Contains binaries, credentials, configuration, and disposable registries",
    developer: "toolchain-cache",
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
  },
  {
    re: /^\.docker$/,
    safety: "system",
    tag: "Docker data",
    hint: "May contain credentials and persistent volumes; manage it through Docker",
    developer: "toolchain-cache",
  },
  {
    re: /^\.IntelliJIdea.+$|^\.CLion.+$|^\.Rider.+$|^\.AndroidStudio.+$|^JetBrains$/i,
    safety: "system",
    tag: "IDE data",
    hint: "May contain settings and project state as well as caches",
    developer: "toolchain-cache",
  },
  {
    re: /^\.nuget$/,
    safety: "system",
    tag: "NuGet data",
    hint: "Contains configuration as well as package caches",
    developer: "toolchain-cache",
  },
  {
    re: /^\.rustup$/,
    safety: "system",
    tag: "Rust toolchains",
    hint: "Manage installed toolchains with rustup",
    developer: "toolchain-cache",
  },

  // — Coding agents. These are visible in the developer lens but protected from cleanup. —
  {
    re: /^\.codex$/,
    safety: "system",
    tag: "Codex data",
    hint: "Agent sessions, configuration, skills, and worktrees — review before changing",
    developer: "agent-data",
  },
  {
    re: /^\.claude$/,
    safety: "system",
    tag: "Claude Code data",
    hint: "Agent sessions, configuration, projects, and history — review before changing",
    developer: "agent-data",
  },
  {
    re: /^\.opencode$|^\.cursor$|^\.continue$|^\.aider$|^\.windsurf$|^\.cline$|^\.roo$/,
    safety: "system",
    tag: "Coding agent data",
    hint: "May contain configuration, history, or active sessions",
    developer: "agent-data",
  },
  {
    re: /^\.worktrees$|^worktrees$/,
    safety: "version-control",
    tag: "Worktrees",
    hint: "Linked checkouts — remove them through Git or the owning agent",
    developer: "worktree",
  },

  // — Keep: don't nuke these —
  {
    re: /^\.git$|^\.hg$|^\.svn$/,
    safety: "version-control",
    tag: "Version history",
    hint: "Your git history — keep it",
    developer: "version-control",
  },
  {
    re: /^\.venv$|^venv$|^env$/,
    safety: "system",
    tag: "Virtual environment",
    hint: "Recreatable, but preserve the project lockfile first",
    developer: "dependencies",
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
    },
  },
  {
    re: /\/\.git\/worktrees(?:\/|$)/i,
    r: {
      tag: "Git worktree metadata",
      safety: "version-control",
      hint: "Git manages this metadata — keep it",
      developer: "worktree",
    },
  },
  {
    re: /\/(?:\.config|\.local\/(?:share|state))\/opencode(?:\/|$)/i,
    r: {
      tag: "OpenCode data",
      safety: "system",
      hint: "Agent configuration, sessions, and cache — review before changing",
      developer: "agent-data",
    },
  },
  {
    re: /\/Library\/Developer\/Xcode\/DerivedData\b/i,
    r: {
      tag: "Xcode DerivedData",
      safety: "regenerable",
      hint: "Xcode regenerates on next build",
      developer: "build-output",
    },
  },
  {
    re: /\/\.gradle\/(?:caches|wrapper\/dists|daemon)(?:\/|$)/i,
    r: { tag: "Gradle cache", safety: "cache", hint: "Gradle downloads or rebuilds it", developer: "toolchain-cache" },
  },
  {
    re: /\/\.m2\/repository(?:\/|$)/i,
    r: {
      tag: "Maven repository",
      safety: "cache",
      hint: "Maven re-downloads dependencies",
      developer: "toolchain-cache",
    },
  },
  {
    re: /\/\.cargo\/(?:registry|git)(?:\/|$)/i,
    r: {
      tag: "Cargo registry",
      safety: "cache",
      hint: "Cargo re-downloads dependencies",
      developer: "toolchain-cache",
    },
  },
  {
    re: /\/\.ivy2\/cache(?:\/|$)/i,
    r: { tag: "Ivy cache", safety: "cache", hint: "Ivy re-downloads dependencies", developer: "toolchain-cache" },
  },
  {
    re: /\/\.nuget\/packages(?:\/|$)/i,
    r: { tag: "NuGet packages", safety: "cache", hint: "NuGet restores packages", developer: "toolchain-cache" },
  },
  {
    re: /\/\.bun\/install\/cache(?:\/|$)/i,
    r: { tag: "Bun package cache", safety: "cache", hint: "Bun re-downloads packages", developer: "toolchain-cache" },
  },
  {
    re: /\/go\/pkg\/mod(?:\/|$)/i,
    r: { tag: "Go module cache", safety: "cache", hint: "Go re-downloads modules", developer: "toolchain-cache" },
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

/** Recognize a node by basename (and a couple of path-based hints). */
export function recognize(node: DiskScanNode): Recognition {
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
  if (!node.isDir) {
    if (node.name.toLowerCase() === ".git") {
      return {
        safety: "version-control",
        tag: "Linked Git checkout",
        hint: "This file links a worktree or submodule to its Git metadata",
        developer: "worktree",
      }
    }
    const k = fileKind(node.ext)
    return k.safety !== "unknown" ? { safety: k.safety, tag: cap(k.kind) } : { safety: "unknown" }
  }
  if (node.children?.some((child) => !child.isDir && child.name.toLowerCase() === ".git")) {
    return {
      safety: "version-control",
      tag: "Git worktree",
      hint: "Linked checkout — remove it with git worktree remove",
      developer: "worktree",
    }
  }
  const normalizedPath = node.path.replaceAll("\\", "/")
  for (const { re, r } of PATH_HINTS) if (re.test(normalizedPath)) return r
  const base = node.name.toLowerCase()
  if (base === "target" && hasAnyChild(node, ".rustc_info.json", "debug", "release")) {
    return {
      safety: "regenerable",
      tag: "Rust build target",
      hint: "cargo clean regenerates it",
      developer: "build-output",
    }
  }
  if (base === "target" && hasAnyChild(node, "classes", "test-classes", "generated-sources", "surefire-reports")) {
    return {
      safety: "regenerable",
      tag: "Maven build target",
      hint: "mvn clean regenerates it",
      developer: "build-output",
    }
  }
  if (
    base === "build" &&
    (hasAnyChild(node, "cmakefiles", "cmakecache.txt", "build.ninja") ||
      countNamedChildren(
        node,
        "classes",
        "generated",
        "kotlin",
        "tmp",
        "resources",
        "reports",
        "libs",
        "intermediates",
      ) >= 2)
  ) {
    return {
      safety: "regenerable",
      tag: "Generated build output",
      hint: "The project build tool regenerates it",
      developer: "build-output",
    }
  }
  if (base === ".gradle" && hasAnyChild(node, "caches", "wrapper", "daemon")) {
    return {
      safety: "system",
      tag: "Gradle user data",
      hint: "Open it to separate disposable caches from configuration",
      developer: "toolchain-cache",
    }
  }
  for (const rule of DIR_RULES)
    if (rule.re.test(base)) return { tag: rule.tag, safety: rule.safety, hint: rule.hint, developer: rule.developer }
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
    if (isReclaimable(r) && node.size > 0) {
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
