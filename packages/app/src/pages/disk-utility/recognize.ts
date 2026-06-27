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

export type Safety =
  | "regenerable"
  | "cache"
  | "logs"
  | "trash"
  | "media"
  | "version-control"
  | "system"
  | "unknown"

export type Recognition = {
  /** Short human label, e.g. "Node dependencies". */
  tag?: string
  safety: Safety
  /** Actionable hint, e.g. "npm install regenerates it". */
  hint?: string
}

type Rule = { re: RegExp; safety: Safety; tag: string; hint?: string }

/** Ordered rules; first match wins. Matched against the lowercased basename. */
const DIR_RULES: Rule[] = [
  // — Build outputs & dependencies (rebuild / reinstall to restore) —
  { re: /^node_modules$/, safety: "regenerable", tag: "Node dependencies", hint: "npm / pnpm / bun install regenerates it" },
  { re: /^bower_components$|^jspm_packages$|^vendor$/, safety: "regenerable", tag: "Vendored dependencies" },
  { re: /^__pycache__$|^\.pyc$|^\.mypy_cache$|^\.pytest_cache$|^\.ruff_cache$/, safety: "regenerable", tag: "Python cache", hint: "Recompiled on next run" },
  { re: /^target$/, safety: "regenerable", tag: "Build output", hint: "cargo / Gradle rebuilds it" },
  { re: /^build$|^dist$|^out$|^\.next$|^\.nuxt$|^\.output$|^\.svelte-kit$/, safety: "regenerable", tag: "Build artifacts", hint: "Rebuilt by your toolchain" },
  { re: /^\.turbo$|^\.parcel-cache$|^\.rollup\.cache$|^cache\.cache$/, safety: "regenerable", tag: "Bundler cache" },
  { re: /^deriveddata$|^\.gradle$|^\.m2$|^\.ivy2$|^build\/\.gradle$/, safety: "regenerable", tag: "Build cache", hint: "Regenerated on next build" },
  { re: /^\.dart_tool$/, safety: "regenerable", tag: "Dart build cache", hint: "dart/pub regenerates it" },

  // — Caches (re-download / re-derive as needed) —
  { re: /^\.cache$|^caches?$|^\.caches$/, safety: "cache", tag: "Cache directory", hint: "Apps re-create this as needed" },
  { re: /^\.npm$|^\.yarn$|^\.pnpm-store$|^\.bun$/, safety: "cache", tag: "Package cache" },
  { re: /^Library\/Caches$/, safety: "cache", tag: "macOS caches" },
  { re: /^\.cargo$|^Cargo\/registry$/, safety: "cache", tag: "Cargo registry" },
  { re: /^go\/pkg\/mod$/, safety: "cache", tag: "Go module cache" },

  // — Logs —
  { re: /^logs?$|^var\/log$|^log$/, safety: "logs", tag: "Log files", hint: "Usually safe to clear" },

  // — Trash —
  { re: /^\.trash(es)?$|^trash$/, safety: "trash", tag: "Trash", hint: "Already-deleted — empty it" },

  // — Keep: don't nuke these —
  { re: /^\.git$|^\.hg$|^\.svn$/, safety: "version-control", tag: "Version history", hint: "Your git history — keep it" },
  { re: /^\.venv$|^venv$|^env$/, safety: "system", tag: "Virtualenv", hint: "Recreatable but project-specific" },
]

const RECLAIMABLE: ReadonlySet<Safety> = new Set(["regenerable", "cache", "logs", "trash"])

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
const DOC_EXT: ReadonlySet<string> = expand("pdf doc docx xls xlsx ppt pptx odt ods odp rtf pages key numbers epub mobi azw3")
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
  { re: /\/Library\/Developer\/Xcode\/DerivedData\b/i, r: { tag: "Xcode DerivedData", safety: "regenerable", hint: "Xcode regenerates on next build" } },
  { re: /\/Library\/Caches\b/i, r: { tag: "macOS caches", safety: "cache", hint: "Apps re-create as needed" } },
  { re: /\/\.Trash\b|\/\.Trashes\b/i, r: { tag: "Trash", safety: "trash", hint: "Already-deleted — empty it" } },
]

/** Recognize a node by basename (and a couple of path-based hints). */
export function recognize(node: DiskScanNode): Recognition {
  if (!node.isDir) {
    const k = fileKind(node.ext)
    return k.safety !== "unknown" ? { safety: k.safety, tag: cap(k.kind) } : { safety: "unknown" }
  }
  for (const { re, r } of PATH_HINTS) if (re.test(node.path)) return r
  const base = node.name.toLowerCase()
  for (const rule of DIR_RULES) if (rule.re.test(base)) return { tag: rule.tag, safety: rule.safety, hint: rule.hint }
  if (node.isOther) return { safety: "unknown", tag: "Other" }
  return { safety: "unknown" }
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
  for (const b of list) b.items.sort((a, b) => b.node.size - a.node.size).splice(24)
  return {
    totalBytes: list.reduce((s, b) => s + b.bytes, 0),
    totalCount: list.reduce((s, b) => s + b.count, 0),
    buckets: list,
  }
}
