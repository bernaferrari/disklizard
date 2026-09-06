import { describe, it, expect } from "bun:test"
import type { DiskScanNode } from "./types"
import {
  recognize,
  isReclaimable,
  computeDeveloperSummary,
  computeDormantDeveloperSummary,
  computeReclaim,
  developerArtifactContext,
  developerArtifactCleanupReadiness,
  fileKind,
  artifactEcosystemLabel,
  isDeveloperArtifactOlderThan,
  isSmartCleanupEligible,
  matchesArtifactEcosystem,
  matchesDeveloperArtifact,
} from "./recognize"

const dir = (name: string, size: number, children: DiskScanNode[] = []): DiskScanNode => ({
  name,
  path: `/${name}`,
  size,
  isDir: true,
  children,
  ext: "",
})
const file = (name: string, size: number, ext: string): DiskScanNode => ({
  name,
  path: `/${name}`,
  size,
  isDir: false,
  children: [],
  ext,
})
const at = (node: DiskScanNode, path: string): DiskScanNode => ({ ...node, path })

describe("recognize — directory rules", () => {
  it("flags node_modules as regenerable", () => {
    const r = recognize(dir("node_modules", 100))
    expect(r.safety).toBe("regenerable")
    expect(r.tag).toBe("Node dependencies")
    expect(r.developer).toBe("dependencies")
  })
  it("flags __pycache__ as regenerable", () => {
    expect(recognize(dir("__pycache__", 10)).safety).toBe("regenerable")
  })
  it("flags .cache as cache", () => {
    const r = recognize(dir(".cache", 10))
    expect(r.safety).toBe("cache")
    expect(r.tag).toBe("Cache directory")
  })
  it("flags .git as version-control (NOT reclaimable)", () => {
    const r = recognize(dir(".git", 10))
    expect(r.safety).toBe("version-control")
  })
  it("flags .venv as system", () => {
    expect(recognize(dir(".venv", 10)).safety).toBe("system")
  })
  it("flags Logs as logs", () => {
    expect(recognize(dir("Logs", 10)).safety).toBe("logs")
  })
  it("flags each operating system's Trash container as protected trash", () => {
    expect(recognize(dir(".Trash", 10)).safety).toBe("trash")
    expect(recognize(dir("$Recycle.Bin", 10))).toMatchObject({ safety: "trash", tag: "Recycle Bin" })
  })
  it("returns unknown for an unrecognized directory", () => {
    const r = recognize(dir("vacation-photos", 10))
    expect(r.safety).toBe("unknown")
    expect(r.tag).toBeUndefined()
  })
})

describe("recognize — developer storage", () => {
  it("attaches evidence-backed ecosystem, confidence, and safe-bulk posture", () => {
    // A basename alone is discovery, never verified disposability.
    expect(recognize(dir("node_modules", 100))).toMatchObject({
      ecosystem: "node",
      confidence: "likely",
      cleanup: "review",
    })
    expect(recognize(dir("__pycache__", 100))).toMatchObject({
      ecosystem: "python",
      confidence: "likely",
      cleanup: "review",
    })
    // A precise cache path is corroborating context and stays preselectable.
    expect(recognize(at(dir("repository", 100), "/Users/dev/.m2/repository"))).toMatchObject({
      ecosystem: "jvm",
      confidence: "verified",
      cleanup: "eligible",
    })
    expect(artifactEcosystemLabel("cpp")).toBe("C / C++")
  })

  it("distinguishes build output and toolchain caches", () => {
    expect(recognize(dir("target", 100, [dir("debug", 90)]))).toMatchObject({
      developer: "build-output",
      safety: "regenerable",
      tag: "Rust build target",
    })
    expect(recognize(dir(".gradle", 100))).toMatchObject({ developer: "toolchain-cache", safety: "system" })
    expect(recognize(at(dir("repository", 100), "/Users/dev/.m2/repository"))).toMatchObject({
      developer: "toolchain-cache",
      tag: "Maven repository",
    })
    expect(recognize(at(dir("mod", 100), "C:\\Users\\dev\\go\\pkg\\mod"))).toMatchObject({
      developer: "toolchain-cache",
      tag: "Go module cache",
    })
  })

  it("identifies collapsed build trees from bounded scanner signatures", () => {
    const rust = { ...dir("target", 100), isCollapsed: true, signatures: [".rustc_info.json", "debug"] }
    const maven = { ...dir("target", 90), isCollapsed: true, signatures: ["classes", "surefire-reports"] }
    const gradle = { ...dir("build", 80), isCollapsed: true, signatures: ["classes", "kotlin"] }
    const cmake = { ...dir("build", 70), isCollapsed: true, signatures: ["build.ninja"] }
    const gradleHome = { ...dir(".gradle", 60), isCollapsed: true, signatures: ["caches", "wrapper"] }

    expect(recognize(rust)).toMatchObject({ safety: "regenerable", tag: "Rust build target" })
    expect(recognize(maven)).toMatchObject({ safety: "regenerable", tag: "Maven build target" })
    expect(recognize(gradle)).toMatchObject({ safety: "regenerable", tag: "Generated build output" })
    expect(recognize(cmake)).toMatchObject({ safety: "regenerable", tag: "Generated build output" })
    expect(recognize(gradleHome)).toMatchObject({ safety: "system", tag: "Gradle user data" })
    expect(developerArtifactContext(rust).disposition).toBe("Rebuildable")

    expect(recognize(rust)).toMatchObject({ ecosystem: "rust", confidence: "verified", cleanup: "eligible" })
    expect(recognize(maven)).toMatchObject({ ecosystem: "jvm", confidence: "likely", cleanup: "review" })
    expect(recognize(gradle)).toMatchObject({ ecosystem: "jvm", confidence: "likely", cleanup: "review" })
    expect(recognize(cmake)).toMatchObject({ ecosystem: "cpp", confidence: "verified", cleanup: "eligible" })
  })

  it("keeps generic build-looking names in review rather than smart-bulk cleanup", () => {
    for (const name of ["target", "build", "dist", "out"] as const) {
      const node = dir(name, 100)
      const result = recognize(node)
      expect(result).toMatchObject({ ecosystem: "generic", confidence: "ambiguous", cleanup: "review" })
      expect(developerArtifactCleanupReadiness(result)).toBe("review")
      expect(isSmartCleanupEligible(node, result)).toBe(false)
    }
  })

  it("protects tool roots and generic folder names while allowing precise disposable subtrees", () => {
    for (const name of [".gradle", ".m2", ".cargo", ".bun", ".docker", ".nuget", ".rustup"]) {
      expect(isReclaimable(recognize(dir(name, 100)))).toBe(false)
    }
    expect(isReclaimable(recognize(dir("target", 100)))).toBe(false)
    expect(isReclaimable(recognize(dir("build", 100)))).toBe(false)
    expect(isReclaimable(recognize(at(dir("caches", 100), "/Users/dev/.gradle/caches")))).toBe(true)
    expect(isReclaimable(recognize(at(dir("cache", 100), "/Users/dev/.bun/install/cache")))).toBe(true)
    expect(isReclaimable(recognize(at(dir("packages", 100), "C:\\Users\\dev\\.nuget\\packages")))).toBe(true)
    expect(isReclaimable(recognize(dir("CoreSimulator", 100)))).toBe(false)
  })

  it("does not preselect an otherwise eligible artifact that contains shared physical storage", () => {
    const sharedDependencies = dir("node_modules", 100, [
      { ...file("shared.js", 100, "js"), hardLink: "primary" as const },
    ])
    expect(isSmartCleanupEligible(sharedDependencies)).toBe(false)
  })

  it("surfaces coding-agent data without calling it reclaimable", () => {
    for (const [name, tag] of [
      [".codex", "Codex data"],
      [".claude", "Claude Code data"],
      [".opencode", "Coding agent data"],
    ] as const) {
      const result = recognize(dir(name, 100))
      expect(result).toMatchObject({ developer: "agent-data", safety: "system", tag })
      expect(isReclaimable(result)).toBe(false)
    }
  })

  it("recognizes agent worktree containers and linked Git checkouts", () => {
    const agentWorktrees = recognize(at(dir("worktrees", 200), "/Users/dev/.codex/worktrees"))
    expect(agentWorktrees).toMatchObject({ developer: "worktree", safety: "version-control" })

    const linked = dir("feature-payments", 300, [at(file(".git", 40, ""), "/code/feature-payments/.git")])
    expect(recognize(linked)).toMatchObject({ developer: "worktree", tag: "Git worktree" })
    expect(isReclaimable(recognize(linked))).toBe(false)
  })
})

describe("developer artifact context", () => {
  it("names the owning project across POSIX, Windows, and UNC paths", () => {
    const nodeModules = at(dir("node_modules", 100), "/home/alex/storefront/node_modules")
    const rustTarget = at(dir("target", 80, [dir("debug", 80)]), "C:\\Users\\Alex\\engine\\target")
    const history = at(dir(".git", 30), "\\\\server\\share\\apps\\cli\\.git")

    expect(developerArtifactContext(nodeModules)).toEqual({
      scope: "Project · storefront",
      disposition: "Reinstallable",
    })
    expect(developerArtifactContext(rustTarget)).toEqual({ scope: "Project · engine", disposition: "Rebuildable" })
    expect(developerArtifactContext(history)).toEqual({ scope: "Project · cli", disposition: "Keep" })
  })

  it("distinguishes global tool data from project-local caches", () => {
    const gradle = at(dir("caches", 90), "C:\\Users\\Alex\\.gradle\\caches")
    const pytest = at(dir(".pytest_cache", 20), "/work/api/.pytest_cache")

    expect(developerArtifactContext(gradle)).toEqual({ scope: "Gradle user data", disposition: "Redownloadable" })
    expect(developerArtifactContext(pytest)).toEqual({ scope: "Project · api", disposition: "Rebuildable" })
  })

  it("makes agent homes and managed worktrees explicit without advertising deletion", () => {
    const claude = at(dir(".claude", 120), "C:\\Users\\Alex\\.claude")
    const codexWorktrees = at(dir("worktrees", 80), "/Users/alex/.codex/worktrees")

    expect(developerArtifactContext(claude)).toEqual({ scope: "Claude Code agent home", disposition: "Protected" })
    expect(developerArtifactContext(codexWorktrees)).toEqual({
      scope: "Codex-managed checkout",
      disposition: "Manage with Git",
    })
  })

  it("keeps ambiguous generated-looking names in review-first territory", () => {
    expect(developerArtifactContext(at(dir("target", 40), "/data/archive/target"))).toEqual({
      scope: "Project · archive",
      disposition: "Review first",
    })
  })
})

describe("recognize — shared and hidden storage", () => {
  it("protects synthetic hidden space from cleanup suggestions", () => {
    expect(
      recognize({ ...dir("Hidden space", 40), path: "disklizard:hidden:/", isHidden: true, isOther: true }),
    ).toMatchObject({ safety: "system", tag: "Hidden space" })
  })

  it("explains why deleting one hard link may not reclaim bytes", () => {
    const linked = { ...file("archive.bin", 4096, "bin"), hardLink: "primary" as const }
    expect(recognize(linked)).toMatchObject({ safety: "system", tag: "Hard-linked file" })
    expect(isReclaimable(recognize(linked))).toBe(false)
  })

  it("keeps clone-accounted files and their cache containers out of reclaim promises", () => {
    const clone = {
      ...file("cached.bin", 100, "bin"),
      path: "/Users/dev/.cache/cached.bin",
      clone: { state: "shares-all-blocks" as const, cloneId: "clone-1", reportedFullCloneCount: 2 },
      cloneAccounting: "primary" as const,
    }
    const cache = at(dir(".cache", 100, [clone]), "/Users/dev/.cache")

    expect(recognize(clone)).toMatchObject({ safety: "unknown", tag: "APFS clone group" })
    expect(isReclaimable(recognize(clone))).toBe(false)
    expect(computeReclaim(cache)).toEqual({ totalBytes: 0, totalCount: 0, buckets: [] })
  })

  it("keeps cache containers with an external hard-link peer out of reclaim promises", () => {
    const linked = {
      ...file("cached.bin", 100, "bin"),
      path: "/Users/dev/.cache/cached.bin",
      hardLink: "primary" as const,
    }
    const cache = at(dir(".cache", 100, [linked]), "/Users/dev/.cache")

    expect(computeReclaim(cache)).toEqual({ totalBytes: 0, totalCount: 0, buckets: [] })
  })
})

describe("recognize — files via extension", () => {
  it("tags a video as media", () => {
    const r = recognize(file("movie.mp4", 1, "mp4"))
    expect(r.safety).toBe("media")
    expect(r.tag).toBe("Video")
  })
  it("tags an image as media", () => {
    expect(recognize(file("p.png", 1, "png")).tag).toBe("Image")
  })
  it("leaves an unknown extension as unknown", () => {
    expect(recognize(file("weird.zzz", 1, "zzz")).safety).toBe("unknown")
  })
})

describe("isReclaimable", () => {
  it("is true for regenerable, cache, and logs", () => {
    expect(isReclaimable(recognize(dir("node_modules", 1)))).toBe(true)
    expect(isReclaimable(recognize(dir(".cache", 1)))).toBe(true)
    expect(isReclaimable(recognize(dir("Logs", 1)))).toBe(true)
  })
  it("is false for version-control, system, media, trash, and unknown", () => {
    expect(isReclaimable(recognize(dir(".git", 1)))).toBe(false)
    expect(isReclaimable(recognize(dir(".venv", 1)))).toBe(false)
    expect(isReclaimable(recognize(file("x.mp4", 1, "mp4")))).toBe(false)
    expect(isReclaimable(recognize(dir(".Trash", 1)))).toBe(false)
    expect(isReclaimable(recognize(dir("misc", 1)))).toBe(false)
  })
})

describe("computeReclaim — non-double-counting walk", () => {
  it("counts a reclaimable subtree once and does not descend into it", () => {
    // node_modules (100, regenerable) contains a nested .cache (40) — the 40 must NOT be added.
    const tree = dir("root", 0, [
      dir("node_modules", 100, [dir(".cache", 40, [])]),
      dir(".git", 50, []),
      dir("src", 0, [dir("node_modules", 50, [])]),
    ])
    const sum = computeReclaim(tree)
    expect(sum.totalBytes).toBe(150) // 100 + 50, NOT 190
    expect(sum.totalCount).toBe(2)
  })
  it("skips version-control subtrees but descends unknown parents", () => {
    const tree = dir("root", 0, [dir(".git", 999, []), dir("src", 0, [dir("node_modules", 30, [])])])
    const sum = computeReclaim(tree)
    expect(sum.totalBytes).toBe(30) // .git excluded; nested node_modules under unknown src included
  })
  it("returns empty for null", () => {
    expect(computeReclaim(null)).toEqual({ totalBytes: 0, totalCount: 0, buckets: [] })
  })
  it("sorts buckets by bytes descending", () => {
    const tree = dir("root", 0, [dir("Logs", 5, []), dir("node_modules", 100, []), dir(".cache", 20, [])])
    const sum = computeReclaim(tree)
    const bytes = sum.buckets.map((b) => b.bytes)
    expect(bytes).toEqual(bytes.toSorted((a, b) => b - a))
  })
  it("keeps every recognized item available for the virtualized review", () => {
    const tree = dir(
      "root",
      0,
      Array.from({ length: 40 }, (_, index) => at(dir("node_modules", index + 1), `/project-${index}/node_modules`)),
    )
    const sum = computeReclaim(tree)

    expect(sum.totalCount).toBe(40)
    expect(sum.buckets[0].items).toHaveLength(40)
  })
})

describe("computeDeveloperSummary — scan-wide developer index", () => {
  it("finds nested artifacts, groups them, and does not double count their children", () => {
    const tree = dir("root", 0, [
      dir("projects", 0, [
        dir("web", 0, [dir("node_modules", 120, [dir(".cache", 30)])]),
        dir("rust", 0, [dir("target", 80)]),
      ]),
      dir(".codex", 50, [dir("worktrees", 20)]),
      dir(".git", 10),
    ])
    const summary = computeDeveloperSummary(tree)

    expect(summary.totalBytes).toBe(260)
    expect(summary.totalCount).toBe(5)
    expect(summary.items.map((item) => [item.node.name, item.bytes])).toEqual([
      ["node_modules", 120],
      ["target", 80],
      [".codex", 30],
      ["worktrees", 20],
      [".git", 10],
    ])
    expect(summary.buckets.map((bucket) => bucket.category)).toContainAllValues([
      "dependencies",
      "build-output",
      "agent-data",
      "worktree",
      "version-control",
    ])
  })

  it("peels precise caches out of protected toolchain roots", () => {
    const gradle = at(dir(".gradle", 100, [at(dir("caches", 70), "/Users/dev/.gradle/caches")]), "/Users/dev/.gradle")
    const summary = computeDeveloperSummary(dir("root", 100, [gradle]))

    expect(summary.totalBytes).toBe(100)
    expect(summary.items.map((item) => [item.node.name, item.bytes])).toEqual([
      ["caches", 70],
      [".gradle", 30],
    ])
  })

  it("returns an empty developer index for null", () => {
    expect(computeDeveloperSummary(null)).toEqual({ totalBytes: 0, totalCount: 0, buckets: [], items: [] })
  })

  it("summarizes only artifacts untouched for at least ninety days", () => {
    const now = Date.UTC(2026, 7, 9)
    const nodeModules = { ...dir("node_modules", 40), modifiedAt: now - 120 * 24 * 60 * 60 * 1_000 }
    const build = { ...dir(".next", 25), modifiedAt: now - 20 * 24 * 60 * 60 * 1_000 }
    const unknownAge = dir(".pytest_cache", 5)

    const dormant = computeDormantDeveloperSummary(
      computeDeveloperSummary(dir("root", 70, [nodeModules, build, unknownAge])),
      now,
    )

    expect(dormant).toMatchObject({ bytes: 40, count: 1 })
    expect(dormant.items.map(({ node }) => node.name)).toEqual(["node_modules"])
  })

  it("filters the developer inventory by ecosystem, bulk-cleanup posture, and explicit change age", () => {
    const now = Date.UTC(2026, 7, 9)
    const oldNodeModules = {
      ...at(dir("node_modules", 80), "/work/web/node_modules"),
      modifiedAt: now - 45 * 24 * 60 * 60 * 1_000,
    }
    const genericBuild = {
      ...at(dir("build", 50), "/work/archive/build"),
      modifiedAt: now - 45 * 24 * 60 * 60 * 1_000,
    }
    const currentPython = {
      ...at(dir(".pytest_cache", 20), "/work/api/.pytest_cache"),
      modifiedAt: now - 3 * 24 * 60 * 60 * 1_000,
    }
    const summary = computeDeveloperSummary(dir("root", 150, [oldNodeModules, genericBuild, currentPython]))
    const byName = new Map(summary.items.map((item) => [item.node.name, item]))
    const nodeModules = byName.get("node_modules")!
    const build = byName.get("build")!
    const pytest = byName.get(".pytest_cache")!

    expect(matchesDeveloperArtifact(nodeModules, { ecosystem: "node", readiness: "review", minAgeDays: 30 }, now)).toBe(true)
    expect(matchesDeveloperArtifact(nodeModules, { readiness: "eligible", minAgeDays: 30 }, now)).toBe(false)
    expect(matchesDeveloperArtifact(build, { readiness: "review", minAgeDays: 30 }, now)).toBe(true)
    expect(matchesDeveloperArtifact(build, { readiness: "eligible" }, now)).toBe(false)
    expect(matchesArtifactEcosystem(nodeModules.recognition, "all")).toBe(true)
    expect(isDeveloperArtifactOlderThan(oldNodeModules, 30, now)).toBe(true)
    expect(isDeveloperArtifactOlderThan({ ...oldNodeModules, modifiedAt: undefined }, 30, now)).toBe(false)
  })
})

describe("fileKind", () => {
  it("categorizes archives and code without making them reclaimable", () => {
    expect(fileKind("zip").kind).toBe("archive")
    expect(fileKind("ts").kind).toBe("code")
    expect(fileKind("zip").safety).toBe("unknown")
  })
})
