import type {
  DeveloperArtifactCleanupReadiness,
  DeveloperArtifactConfidence,
  DeveloperArtifactEcosystem,
  DeveloperArtifactInventoryOptions,
  DeveloperArtifactKind,
} from "./types"

/** The inventory is deliberately bounded; status reports when this cap wins. */
export const DEFAULT_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS = 2_000
export const MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS = 20_000

export type NormalizedDeveloperArtifactInventoryOptions = {
  maxItems: number
}

export function normalizeDeveloperArtifactInventoryOptions(
  option: boolean | DeveloperArtifactInventoryOptions | undefined,
): NormalizedDeveloperArtifactInventoryOptions | undefined {
  if (!option) return undefined
  const requested = typeof option === "object" ? option.maxItems : undefined
  const maxItems = Number.isFinite(requested)
    ? Math.floor(Math.max(1, Math.min(MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS, requested!)))
    : DEFAULT_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS
  return { maxItems }
}

/**
 * Direct child names that provide meaningful evidence for generic `target`
 * and `build` folders. This is intentionally compact: it is not a manifest
 * parser and never reads project files.
 */
export const DEVELOPER_ARTIFACT_EVIDENCE_NAMES = new Set([
  ".rustc_info.json",
  "debug",
  "release",
  "classes",
  "test-classes",
  "generated-sources",
  "surefire-reports",
  "cmakecache.txt",
  "cmakefiles",
  "build.ninja",
  "intermediates",
  "outputs",
  "libs",
  "bin",
  "obj",
])

/**
 * Sibling names that establish a genuine project root for a candidate's
 * parent directory. Name-only evidence, like everything else here: the
 * scanners never read project file contents. A manifest plus a conventional
 * artifact basename corroborates both identity and a reinstall path, which
 * is what promotes a discovery-only match to reviewed-batch eligibility.
 */
export const DEVELOPER_PROJECT_MARKER_NAMES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "bower.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "setup.cfg",
  "pipfile",
  "poetry.lock",
  "uv.lock",
  "go.mod",
  "go.sum",
  "pubspec.yaml",
  "pubspec.lock",
])

const ECOSYSTEM_MARKERS: Record<"node" | "python" | "go" | "dart", readonly string[]> = {
  node: [
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "bun.lock",
    "bower.json",
  ],
  python: [
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "setup.cfg",
    "pipfile",
    "poetry.lock",
    "uv.lock",
  ],
  go: ["go.mod", "go.sum"],
  dart: ["pubspec.yaml", "pubspec.lock"],
}

/** Lowercased sibling names that carry project evidence, sorted and deduped. */
export function developerProjectMarkers(names: Iterable<string>): string[] {
  const markers = [...new Set([...names].map((value) => value.toLowerCase()))]
    .filter((value) => DEVELOPER_PROJECT_MARKER_NAMES.has(value))
  markers.sort()
  return markers
}

export type DeveloperArtifactClassification = {
  kind: DeveloperArtifactKind
  ecosystem: DeveloperArtifactEcosystem
  confidence: DeveloperArtifactConfidence
  cleanup: DeveloperArtifactCleanupReadiness
  evidence: string[]
}

function directEvidence(
  name: string,
  signatures: readonly string[],
  parentMarkers: readonly string[] = [],
) {
  const evidence = [`name:${name}`]
  for (const signature of signatures) evidence.push(`contains:${signature}`)
  for (const marker of parentMarkers) evidence.push(`parent:${marker}`)
  return evidence
}

function verified(
  kind: DeveloperArtifactKind,
  ecosystem: DeveloperArtifactEcosystem,
  name: string,
  signatures: readonly string[] = [],
  parentMarkers: readonly string[] = [],
): DeveloperArtifactClassification {
  return {
    kind,
    ecosystem,
    confidence: "verified",
    cleanup: "eligible",
    evidence: directEvidence(name, signatures, parentMarkers),
  }
}

function likely(
  kind: DeveloperArtifactKind,
  ecosystem: DeveloperArtifactEcosystem,
  name: string,
  signatures: readonly string[] = [],
  parentMarkers: readonly string[] = [],
): DeveloperArtifactClassification {
  return {
    kind,
    ecosystem,
    confidence: "likely",
    // Likely is informative, not enough evidence for a default destructive
    // selection. Keep this in lockstep with the renderer's smart-cleanup
    // policy: only a verified artifact is preselectable.
    cleanup: "review",
    evidence: directEvidence(name, signatures, parentMarkers),
  }
}

function review(
  kind: DeveloperArtifactKind,
  name: string,
  signatures: readonly string[] = [],
): DeveloperArtifactClassification {
  return {
    kind,
    ecosystem: "generic",
    confidence: "ambiguous",
    cleanup: "review",
    evidence: directEvidence(name, signatures),
  }
}

/**
 * Classify an observed directory using its basename, parent basename, direct
 * entries, and the sibling project markers observed beside it. A result is
 * evidence for the review UI, not a deletion verdict; generic names stay
 * review-only unless their local shape proves a conventional toolchain
 * artifact.
 */
export function classifyDeveloperArtifact(
  rawName: string,
  rawParentName: string | undefined,
  directSignatures: readonly string[],
  rawParentMarkers: readonly string[] = [],
): DeveloperArtifactClassification | undefined {
  const name = rawName.toLowerCase()
  const parentName = rawParentName?.toLowerCase()
  const signatures = [...new Set(directSignatures.map((value) => value.toLowerCase()))].sort()
  const has = (value: string) => signatures.includes(value)
  const parentMarkers = [...new Set(rawParentMarkers.map((value) => value.toLowerCase()))].sort()
  const markersFor = (ecosystem: keyof typeof ECOSYSTEM_MARKERS) =>
    ECOSYSTEM_MARKERS[ecosystem].filter((value) => parentMarkers.includes(value)).sort()
  const nodeMarkers = markersFor("node")
  const pythonMarkers = markersFor("python")
  const goMarkers = markersFor("go")
  const dartMarkers = markersFor("dart")
  const hasMarker = (ecosystem: keyof typeof ECOSYSTEM_MARKERS) => markersFor(ecosystem).length > 0

  switch (name) {
    // A conventional basename alone justifies discovery, never verified
    // disposability. `verified` requires corroborating context: direct
    // toolchain signatures, a parent basename that makes the name specific,
    // or sibling project markers that establish identity plus a reinstall
    // path. Keep these arms in lockstep with the Rust classifier and the
    // shared classification corpus.
    case "node_modules":
      return hasMarker("node")
        ? verified("dependencies", "node", name, [], nodeMarkers)
        : likely("dependencies", "node", name)
    case "bower_components":
    case "jspm_packages":
      return hasMarker("node")
        ? verified("dependencies", "web", name, [], nodeMarkers)
        : likely("dependencies", "web", name)
    case ".pnpm-store":
    case ".npm":
    case ".turbo":
    case ".parcel-cache":
    case ".rollup.cache":
      return hasMarker("node")
        ? verified("toolchain-cache", "node", name, [], nodeMarkers)
        : likely("toolchain-cache", "node", name)
    case "__pycache__":
    case ".mypy_cache":
    case ".pytest_cache":
    case ".ruff_cache":
    case ".tox":
      return hasMarker("python")
        ? verified("toolchain-cache", "python", name, [], pythonMarkers)
        : likely("toolchain-cache", "python", name)
    case ".venv":
    case "venv":
      return hasMarker("python")
        ? verified("dependencies", "python", name, [], pythonMarkers)
        : likely("dependencies", "python", name)
    case ".next":
    case ".nuxt":
    case ".output":
    case ".svelte-kit":
    case ".astro":
      return hasMarker("node")
        ? verified("build-output", "node", name, [], nodeMarkers)
        : likely("build-output", "node", name)
    case "deriveddata":
      return likely("toolchain-cache", "apple", name)
    case ".dart_tool":
    case ".pub-cache":
      return hasMarker("dart")
        ? verified("toolchain-cache", "dart", name, [], dartMarkers)
        : likely("toolchain-cache", "dart", name)
    case "gocache":
      return hasMarker("go")
        ? verified("toolchain-cache", "go", name, [], goMarkers)
        : likely("toolchain-cache", "go", name)
    case "target": {
      const rust = signatures.filter((value) => [".rustc_info.json", "debug", "release"].includes(value))
      if (has(".rustc_info.json")) return verified("build-output", "rust", name, rust)
      if (rust.length > 0) return likely("build-output", "rust", name, rust)
      const jvm = signatures.filter((value) => ["classes", "test-classes", "generated-sources", "surefire-reports"].includes(value))
      if (jvm.length > 0) return likely("build-output", "jvm", name, jvm)
      return review("build-output", name)
    }
    case "build": {
      const cmake = signatures.filter((value) => ["cmakecache.txt", "cmakefiles", "build.ninja"].includes(value))
      if (cmake.length > 0) return verified("build-output", "cpp", name, cmake)
      const jvm = signatures.filter((value) => ["classes", "intermediates", "outputs", "libs"].includes(value))
      if (jvm.length > 0) return likely("build-output", "jvm", name, jvm)
      const dotnet = signatures.filter((value) => ["bin", "obj"].includes(value))
      if (dotnet.length > 0) return likely("build-output", "dotnet", name, dotnet)
      return review("build-output", name)
    }
    case "dist":
    case "out":
      return review("build-output", name)
    case "caches":
      if (parentName === ".gradle") return verified("toolchain-cache", "jvm", name)
      return undefined
    case "repository":
      // Identity is not recoverability: a Maven local repository also holds
      // locally built and manually installed artifacts that no remote can
      // re-download, so it stays review-only without provenance detail.
      if (parentName === ".m2") return likely("toolchain-cache", "jvm", name)
      return undefined
    case "registry":
    case "git":
      if (parentName === ".cargo") return verified("toolchain-cache", "rust", name)
      return undefined
    case "packages":
      if (parentName === ".nuget") return verified("toolchain-cache", "dotnet", name)
      return undefined
    case "mod":
      if (parentName === "pkg") return likely("dependencies", "go", name)
      return undefined
    default:
      return undefined
  }
}
