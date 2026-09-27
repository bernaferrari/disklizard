import { describe, expect, it } from "bun:test"
import type { DiskScanNode } from "./types"
import {
  filterIndexedDiskEntries,
  indexRetainedDiskTree,
  sortDiskEntries,
} from "./entry-view"
import {
  computeDeveloperSummaryWithInventory,
  computeReclaim,
  recognize,
} from "./recognize"
import { createScanInvestigation } from "./scan-investigation"

function node(
  name: string,
  path: string,
  size: number,
  children: DiskScanNode[] = []
): DiskScanNode {
  return {
    name,
    path,
    size,
    isDir: children.length > 0,
    children,
    ext: name.split(".").at(-1) ?? "",
  }
}

function fixture() {
  const artifact = node("bundle.js", "/repo/packages/app/dist/bundle.js", 20)
  const root = node("repo", "/repo", 120, [
    node("README.md", "/repo/README.md", 10),
    node("packages", "/repo/packages", 110, [
      node("app", "/repo/packages/app", 110, [artifact]),
    ]),
  ])
  return { root, artifact }
}

describe("lazy scan investigation", () => {
  it("keeps the normal current-folder map journey free of scan-wide recognition and summaries", () => {
    const { root } = fixture()
    let recognitionCalls = 0
    const investigation = createScanInvestigation(root, {
      recognizeNode(node) {
        recognitionCalls++
        return recognize(node)
      },
    })

    expect(investigation.state()).toEqual({
      identityIndexBuilt: false,
      searchIndexBuilt: false,
      recognitionIndexBuilt: false,
      developerSummaryBuilt: false,
      recommendationSummaryBuilt: false,
    })
    expect(
      investigation
        .entries({
          viewNode: root,
          query: "",
          lens: "all",
          sortKey: "size",
          sortDirection: "descending",
        })
        .map((entry) => [entry.node.name, entry.colorIndex])
    ).toEqual([
      ["packages", 0],
      ["README.md", 1],
    ])
    expect(recognitionCalls).toBe(0)
    expect(investigation.state()).toEqual({
      identityIndexBuilt: false,
      searchIndexBuilt: false,
      recognitionIndexBuilt: false,
      developerSummaryBuilt: false,
      recommendationSummaryBuilt: false,
    })
  })

  it("builds normalized scan-wide search only for a non-empty query and reuses it", () => {
    const { root, artifact } = fixture()
    let recognitionCalls = 0
    const investigation = createScanInvestigation(root, {
      recognizeNode(node) {
        recognitionCalls++
        return recognize(node)
      },
      recognitionText: (recognition) => recognition.tag ?? "",
      recognitionQueryMayMatch: () => false,
    })
    const options = {
      viewNode: root,
      lens: "all" as const,
      sortKey: "size" as const,
      sortDirection: "descending" as const,
    }

    expect(
      investigation
        .entries({ ...options, query: "bundle" })
        .map((entry) => entry.node.path)
    ).toEqual([artifact.path])
    expect(investigation.state().searchIndexBuilt).toBe(true)
    expect(investigation.state().recognitionIndexBuilt).toBe(false)
    const callsAfterBuild = recognitionCalls
    expect(
      investigation
        .entries({ ...options, query: "packages/app" })
        .map((entry) => entry.node.path)
    ).toContain(artifact.path)
    expect(recognitionCalls).toBe(callsAfterBuild)
  })

  it("matches the previous retained search ordering and local color identity", () => {
    const { root } = fixture()
    const label = (item: DiskScanNode) =>
      item.name === "bundle.js" ? "Generated build output" : undefined
    const previous = sortDiskEntries(
      filterIndexedDiskEntries(
        indexRetainedDiskTree(root, label),
        "generated build output"
      ).map(({ node, colorIndex, sourceIndex }) => ({
        node,
        colorIndex,
        sourceIndex,
        displaySize: node.size,
      })),
      "name",
      "ascending"
    )
    const investigation = createScanInvestigation(root, {
      recognitionText: (recognition) => recognition.tag ?? "",
      recognizeNode(item) {
        return { safety: "unknown", tag: label(item) }
      },
    })
    const next = investigation.entries({
      viewNode: root,
      query: "generated build output",
      lens: "all",
      sortKey: "name",
      sortDirection: "ascending",
    })

    expect(
      next.map((entry) => [
        entry.node.path,
        entry.colorIndex,
        entry.sourceIndex,
      ])
    ).toEqual(
      previous.map((entry) => [
        entry.node.path,
        entry.colorIndex,
        entry.sourceIndex,
      ])
    )
    expect(investigation.state().recognitionIndexBuilt).toBe(true)
  })

  it("builds lens identity and summaries independently without normalizing every search string", () => {
    const { root, artifact } = fixture()
    const investigation = createScanInvestigation(root)
    const entries = investigation.entries({
      viewNode: root,
      query: "",
      lens: "developer",
      sortKey: "size",
      sortDirection: "descending",
      developerCandidates: () => [
        { node: artifact, displaySize: artifact.size },
      ],
    })
    expect(entries.map((entry) => [entry.node.path, entry.colorIndex])).toEqual(
      [[artifact.path, 0]]
    )
    expect(investigation.state()).toEqual({
      identityIndexBuilt: true,
      searchIndexBuilt: false,
      recognitionIndexBuilt: false,
      developerSummaryBuilt: false,
      recommendationSummaryBuilt: false,
    })

    investigation.developer()
    expect(investigation.state().developerSummaryBuilt).toBe(true)
    expect(investigation.state().recommendationSummaryBuilt).toBe(false)
    investigation.recommendations()
    expect(investigation.state().recommendationSummaryBuilt).toBe(true)
  })

  it("preserves developer and recommendation summary output", () => {
    const root = node("repo", "/repo", 70, [
      node("node_modules", "/repo/node_modules", 40, [
        node("package.js", "/repo/node_modules/package.js", 40),
      ]),
      node(".cache", "/repo/.cache", 30, [
        node("objects.bin", "/repo/.cache/objects.bin", 30),
      ]),
    ])
    const investigation = createScanInvestigation(root)

    expect(investigation.developer()).toEqual(
      computeDeveloperSummaryWithInventory(root)
    )
    expect(investigation.recommendations()).toEqual(computeReclaim(root))
  })

  it("keeps conservative inventory evidence on a materialized result", () => {
    const target = node("target", "/repo/target", 40)
    target.isDir = true
    const root = node("repo", "/repo", 40, [target])
    root.developerArtifactInventory = {
      items: [
        {
          name: "target",
          path: target.path,
          size: 40,
          isDir: true,
          kind: "build-output",
          ecosystem: "rust",
          confidence: "ambiguous",
          cleanup: "review",
          evidence: ["name:target"],
          inventoryOnly: true,
        },
      ],
      status: {
        state: "complete",
        maxItems: 2000,
        scannedDirectories: 2,
        matchedDirectories: 1,
        truncated: false,
        unreadableCount: 0,
        unreadableSamplePaths: [],
        skippedSymlinkCount: 0,
        skippedSymlinkSamplePaths: [],
        excludedCount: 0,
        excludedSamplePaths: [],
      },
    } as DiskScanNode["developerArtifactInventory"]
    const investigation = createScanInvestigation(root, {
      recognizeNode: (candidate) =>
        candidate.path !== target.path
          ? { safety: "system" }
          : "inventoryOnly" in candidate
            ? { safety: "system", developer: "build-output", cleanup: "review" }
            : {
                safety: "regenerable",
                developer: "build-output",
                cleanup: "eligible",
              },
    })
    expect(investigation.recognitionFor(target).cleanup).toBe("review")
    expect(
      investigation
        .developer()
        .items.find((item) => item.node.path === target.path)?.recognition
        .cleanup
    ).toBe("review")
  })

  it("uses verified inventory evidence to promote a name-only result", () => {
    const modules = node("node_modules", "/repo/apps/web/node_modules", 40)
    modules.isDir = true
    const root = node("repo", "/repo", 40, [modules])
    root.developerArtifactInventory = {
      items: [
        {
          name: modules.name,
          path: modules.path,
          size: 40,
          isDir: true,
          kind: "dependencies",
          ecosystem: "node",
          confidence: "verified",
          cleanup: "eligible",
          evidence: ["name:node_modules", "parent:package.json"],
          inventoryOnly: true,
        },
      ],
      status: {
        state: "complete",
        maxItems: 2000,
        scannedDirectories: 2,
        matchedDirectories: 1,
        truncated: false,
        unreadableCount: 0,
        unreadableSamplePaths: [],
        skippedSymlinkCount: 0,
        skippedSymlinkSamplePaths: [],
        excludedCount: 0,
        excludedSamplePaths: [],
      },
    } as DiskScanNode["developerArtifactInventory"]
    const investigation = createScanInvestigation(root)
    expect(recognize(modules).cleanup).toBe("review")
    expect(investigation.recognitionFor(modules)).toMatchObject({
      developer: "dependencies",
      confidence: "verified",
      cleanup: "eligible",
    })
    expect(
      investigation
        .developer()
        .items.find((item) => item.node.path === modules.path)?.recognition
        .cleanup
    ).toBe("eligible")
  })
})
