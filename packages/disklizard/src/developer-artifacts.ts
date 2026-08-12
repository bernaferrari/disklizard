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
  "intermediates",
  "outputs",
  "libs",
  "bin",
  "obj",
])

export type DeveloperArtifactClassification = {
  kind: DeveloperArtifactKind
  ecosystem: DeveloperArtifactEcosystem
  confidence: DeveloperArtifactConfidence
  cleanup: DeveloperArtifactCleanupReadiness
  evidence: string[]
}

function directEvidence(name: string, signatures: readonly string[]) {
  const evidence = [`name:${name}`]
  for (const signature of signatures) evidence.push(`contains:${signature}`)
  return evidence
}

function verified(
  kind: DeveloperArtifactKind,
  ecosystem: DeveloperArtifactEcosystem,
  name: string,
  signatures: readonly string[] = [],
): DeveloperArtifactClassification {
  return {
    kind,
    ecosystem,
    confidence: "verified",
    cleanup: "eligible",
    evidence: directEvidence(name, signatures),
  }
}

function likely(
  kind: DeveloperArtifactKind,
  ecosystem: DeveloperArtifactEcosystem,
  name: string,
  signatures: readonly string[] = [],
): DeveloperArtifactClassification {
  return {
    kind,
    ecosystem,
    confidence: "likely",
    // Likely is informative, not enough evidence for a default destructive
    // selection. Keep this in lockstep with the renderer's smart-cleanup
    // policy: only a verified artifact is preselectable.
    cleanup: "review",
    evidence: directEvidence(name, signatures),
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
 * Classify an observed directory using only its basename, parent basename,
 * and direct entries. A result is evidence for the review UI, not a deletion
 * verdict; generic names stay review-only unless their local shape proves a
 * conventional toolchain artifact.
 */
export function classifyDeveloperArtifact(
  rawName: string,
  rawParentName: string | undefined,
  directSignatures: readonly string[],
): DeveloperArtifactClassification | undefined {
  const name = rawName.toLowerCase()
  const parentName = rawParentName?.toLowerCase()
  const signatures = [...new Set(directSignatures.map((value) => value.toLowerCase()))].sort()
  const has = (value: string) => signatures.includes(value)

  switch (name) {
    case "node_modules":
      return verified("dependencies", "node", name)
    case "bower_components":
    case "jspm_packages":
      return likely("dependencies", "web", name)
    case ".pnpm-store":
    case ".npm":
    case ".turbo":
    case ".parcel-cache":
    case ".rollup.cache":
      return verified("toolchain-cache", "node", name)
    case "__pycache__":
    case ".mypy_cache":
    case ".pytest_cache":
    case ".ruff_cache":
    case ".tox":
      return verified("toolchain-cache", "python", name)
    case ".venv":
    case "venv":
      return likely("dependencies", "python", name)
    case ".next":
    case ".nuxt":
    case ".output":
    case ".svelte-kit":
    case ".astro":
      return verified("build-output", "node", name)
    case "deriveddata":
      return verified("toolchain-cache", "apple", name)
    case ".dart_tool":
    case ".pub-cache":
      return verified("toolchain-cache", "dart", name)
    case "gocache":
      return verified("toolchain-cache", "go", name)
    case "target": {
      const rust = signatures.filter((value) => [".rustc_info.json", "debug", "release"].includes(value))
      if (has(".rustc_info.json")) return verified("build-output", "rust", name, rust)
      if (rust.length > 0) return likely("build-output", "rust", name, rust)
      const jvm = signatures.filter((value) => ["classes", "test-classes", "generated-sources", "surefire-reports"].includes(value))
      if (jvm.length > 0) return likely("build-output", "jvm", name, jvm)
      return review("build-output", name)
    }
    case "build": {
      const cmake = signatures.filter((value) => ["cmakecache.txt", "cmakefiles"].includes(value))
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
      if (parentName === ".m2") return verified("toolchain-cache", "jvm", name)
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
