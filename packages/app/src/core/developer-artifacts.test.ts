import { describe, expect, test } from "bun:test"
import corpus from "./classification-corpus.json"
import {
  DEFAULT_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS,
  MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS,
  classifyDeveloperArtifact,
  normalizeDeveloperArtifactInventoryOptions,
} from "./developer-artifacts"
describe("developer artifact inventory rules", () => {
  test("keeps a conventional name at review until local evidence corroborates it", () => {
    // A basename match justifies discovery, not verified disposability.
    expect(
      classifyDeveloperArtifact("node_modules", "project", [])
    ).toMatchObject({
      ecosystem: "node",
      confidence: "likely",
      cleanup: "review",
    })
    expect(classifyDeveloperArtifact(".output", "project", [])).toMatchObject({
      ecosystem: "node",
      confidence: "likely",
      cleanup: "review",
    })
    expect(
      classifyDeveloperArtifact("deriveddata", "project", [])
    ).toMatchObject({
      ecosystem: "apple",
      confidence: "likely",
      cleanup: "review",
    })
    expect(classifyDeveloperArtifact("gocache", "project", [])).toMatchObject({
      ecosystem: "go",
      confidence: "likely",
      cleanup: "review",
    })
    expect(
      classifyDeveloperArtifact("target", "project", ["debug"])
    ).toMatchObject({
      ecosystem: "rust",
      confidence: "likely",
      cleanup: "review",
    })
    expect(
      classifyDeveloperArtifact("target", "project", [
        ".rustc_info.json",
        "debug",
      ])
    ).toMatchObject({
      ecosystem: "rust",
      confidence: "verified",
      cleanup: "eligible",
      evidence: ["name:target", "contains:.rustc_info.json", "contains:debug"],
    })
    expect(
      classifyDeveloperArtifact("target", "project", ["classes"])
    ).toMatchObject({
      ecosystem: "jvm",
      confidence: "likely",
      cleanup: "review",
    })
    expect(
      classifyDeveloperArtifact("build", "project", ["CMakeCache.txt"])
    ).toMatchObject({
      ecosystem: "cpp",
      confidence: "verified",
      cleanup: "eligible",
    })
    expect(classifyDeveloperArtifact("build", "project", [])).toMatchObject({
      ecosystem: "generic",
      confidence: "ambiguous",
      cleanup: "review",
    })
  })

  test("recognizes cache paths only when their parent makes the basename specific", () => {
    expect(classifyDeveloperArtifact("caches", ".gradle", [])).toMatchObject({
      ecosystem: "jvm",
      cleanup: "eligible",
    })
    expect(classifyDeveloperArtifact("caches", "project", [])).toBeUndefined()
    expect(classifyDeveloperArtifact("registry", ".cargo", [])).toMatchObject({
      ecosystem: "rust",
      cleanup: "eligible",
    })
    expect(classifyDeveloperArtifact("repository", ".m2", [])).toMatchObject({
      ecosystem: "jvm",
      confidence: "likely",
      cleanup: "review",
    })
    expect(classifyDeveloperArtifact("registry", "project", [])).toBeUndefined()
  })

  test("sibling project markers corroborate identity and a reinstall path", () => {
    expect(
      classifyDeveloperArtifact(
        "node_modules",
        "web",
        [],
        ["readme.md", "package.json", "package-lock.json"]
      )
    ).toMatchObject({
      confidence: "verified",
      cleanup: "eligible",
      evidence: [
        "name:node_modules",
        "parent:package-lock.json",
        "parent:package.json",
      ],
    })
    expect(
      classifyDeveloperArtifact("node_modules", "web", [], ["readme.md"])
    ).toMatchObject({
      confidence: "likely",
      cleanup: "review",
    })
    expect(
      classifyDeveloperArtifact("__pycache__", "api", [], ["pyproject.toml"])
    ).toMatchObject({
      confidence: "verified",
      cleanup: "eligible",
    })
  })

  test("matches the shared classification corpus every implementation must agree on", () => {
    // The same corpus drives the Rust classifier's conformance test; a case
    // that passes here and fails there (or vice versa) is policy drift.
    expect(corpus.cases.length).toBeGreaterThanOrEqual(20)
    for (const fixture of corpus.cases) {
      const actual = classifyDeveloperArtifact(
        fixture.name,
        fixture.parent,
        fixture.signatures,
        fixture.parentMarkers
      )
      if (fixture.expected === null) {
        expect(actual).toBeUndefined()
        continue
      }
      expect(actual).toMatchObject(fixture.expected)
    }
  })

  test("normalizes the opt-in bounded inventory request", () => {
    expect(
      normalizeDeveloperArtifactInventoryOptions(undefined)
    ).toBeUndefined()
    expect(normalizeDeveloperArtifactInventoryOptions(false)).toBeUndefined()
    expect(normalizeDeveloperArtifactInventoryOptions(true)).toEqual({
      maxItems: DEFAULT_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS,
    })
    expect(normalizeDeveloperArtifactInventoryOptions({ maxItems: 0 })).toEqual(
      { maxItems: 1 }
    )
    expect(
      normalizeDeveloperArtifactInventoryOptions({
        maxItems: Number.MAX_SAFE_INTEGER,
      })
    ).toEqual({
      maxItems: MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS,
    })
  })
})
