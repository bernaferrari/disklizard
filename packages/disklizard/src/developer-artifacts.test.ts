import { describe, expect, test } from "bun:test"
import {
  DEFAULT_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS,
  MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS,
  classifyDeveloperArtifact,
  normalizeDeveloperArtifactInventoryOptions,
} from "./developer-artifacts"

describe("developer artifact inventory rules", () => {
  test("keeps a conventional name at review until local evidence corroborates it", () => {
    // A basename match justifies discovery, not verified disposability.
    expect(classifyDeveloperArtifact("node_modules", "project", [])).toMatchObject({
      ecosystem: "node",
      confidence: "likely",
      cleanup: "review",
    })
    expect(classifyDeveloperArtifact(".output", "project", [])).toMatchObject({
      ecosystem: "node",
      confidence: "likely",
      cleanup: "review",
    })
    expect(classifyDeveloperArtifact("deriveddata", "project", [])).toMatchObject({
      ecosystem: "apple",
      confidence: "likely",
      cleanup: "review",
    })
    expect(classifyDeveloperArtifact("gocache", "project", [])).toMatchObject({
      ecosystem: "go",
      confidence: "likely",
      cleanup: "review",
    })
    expect(classifyDeveloperArtifact("target", "project", ["debug"])).toMatchObject({
      ecosystem: "rust",
      confidence: "likely",
      cleanup: "review",
    })
    expect(classifyDeveloperArtifact("target", "project", [".rustc_info.json", "debug"])).toMatchObject({
      ecosystem: "rust",
      confidence: "verified",
      cleanup: "eligible",
      evidence: ["name:target", "contains:.rustc_info.json", "contains:debug"],
    })
    expect(classifyDeveloperArtifact("target", "project", ["classes"])).toMatchObject({
      ecosystem: "jvm",
      confidence: "likely",
      cleanup: "review",
    })
    expect(classifyDeveloperArtifact("build", "project", ["CMakeCache.txt"])).toMatchObject({
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
    expect(classifyDeveloperArtifact("registry", "project", [])).toBeUndefined()
  })

  test("normalizes the opt-in bounded inventory request", () => {
    expect(normalizeDeveloperArtifactInventoryOptions(undefined)).toBeUndefined()
    expect(normalizeDeveloperArtifactInventoryOptions(false)).toBeUndefined()
    expect(normalizeDeveloperArtifactInventoryOptions(true)).toEqual({
      maxItems: DEFAULT_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS,
    })
    expect(normalizeDeveloperArtifactInventoryOptions({ maxItems: 0 })).toEqual({ maxItems: 1 })
    expect(normalizeDeveloperArtifactInventoryOptions({ maxItems: Number.MAX_SAFE_INTEGER })).toEqual({
      maxItems: MAX_DEVELOPER_ARTIFACT_INVENTORY_MAX_ITEMS,
    })
  })
})

