import { expect, test } from "bun:test"
import {
  buildCleanupSummary,
  partitionCleanupGroups,
  cleanupItemExplanation,
  organizeCleanupGroups,
} from "./cleanup-summary"
import { recognize } from "./recognize"
import type { DiskScanNode } from "./types"

function node(path: string, size: number): DiskScanNode {
  return {
    path,
    name: path.split("/").at(-1)!,
    size,
    isDir: true,
    children: [],
    ext: "",
  }
}
const item = (node: DiskScanNode) => ({
  node,
  bytes: node.size,
  recognition: recognize(node),
})
const options = {
  os: "macos" as const,
  canModify: () => true,
  isEligible: () => true,
}

test("cleanup totals count scopes once while keeping nested alternatives and excluding protected items", () => {
  const parent = node("/work/node_modules", 100)
  const child = node("/work/node_modules/.cache", 40)
  const protectedItem = node("/work/locked/node_modules", 60)
  const summary = buildCleanupSummary({
    ...options,
    developerItems: [
      item(child),
      item(protectedItem),
      item(parent),
      item(parent),
    ],
    suggestions: [],
    canModify: (candidate) => candidate.path !== protectedItem.path,
  })
  expect(summary.bytes).toBe(100)
  expect(summary.count).toBe(2)
  expect(summary.safe.map(({ node }) => node.path)).toEqual([
    parent.path,
    child.path,
  ])
  expect(summary.locked.map(({ node }) => node.path)).toEqual([
    protectedItem.path,
  ])
  expect(
    summary.groups
      .flatMap((group) => group.items)
      .map((item) => item.bytes)
      .sort((a, b) => b - a)
  ).toEqual([100, 40])
})

test("suggestion parents own their bytes even when listed in a later bucket", () => {
  const parent = node("/work/cache", 100)
  const child = node("/work/cache/logs", 40)
  const summary = buildCleanupSummary({
    ...options,
    developerItems: [],
    suggestions: [
      { safety: "logs", bytes: 40, count: 1, items: [item(child)] },
      { safety: "cache", bytes: 100, count: 1, items: [item(parent)] },
    ],
  })
  expect(summary.bytes).toBe(100)
  expect(summary.count).toBe(2)
  expect(summary.suggestions[0]?.items[0]?.node.path).toBe(parent.path)
  expect(summary.safe).toEqual([])
})

test("Windows separator aliases cannot inflate cleanup totals", () => {
  const parent = node("C:\\Work\\node_modules", 100)
  const alias = node("C:/Work/node_modules", 100)
  const summary = buildCleanupSummary({
    ...options,
    os: "windows",
    developerItems: [item(parent), item(alias)],
    suggestions: [],
  })
  expect(summary.bytes).toBe(100)
  expect(summary.count).toBe(1)
})

test("case-distinct Windows scanner paths retain their separate identities", () => {
  const first = node("C:/Work/node_modules", 100)
  const second = node("C:/Work/NODE_MODULES", 60)
  const summary = buildCleanupSummary({
    ...options,
    os: "windows",
    developerItems: [item(first), item(second)],
    suggestions: [],
  })
  expect(summary.bytes).toBe(160)
  expect(summary.count).toBe(2)
})

test("filters and per-item eligibility apply to the same summary", () => {
  const visible = node("/work/node_modules", 100)
  const filtered = node("/other/node_modules", 80)
  const summary = buildCleanupSummary({
    ...options,
    developerItems: [item(visible), item(filtered)],
    suggestions: [],
    matchesFilter: (candidate) => candidate.path.startsWith("/work/"),
    isEligible: () => false,
  })
  expect(summary.bytes).toBe(100)
  expect(summary.count).toBe(1)
  expect(summary.safe).toEqual([])
})

test("developer and suggestion alternatives retain siblings and count overlaps once", () => {
  const dependency = node("/work/node_modules", 100)
  const suggestions = [
    node("/work", 200),
    node("/work/node_modules/.cache", 40),
    node("/work/node_modules-old", 30),
  ]
  const summary = buildCleanupSummary({
    ...options,
    developerItems: [item(dependency)],
    suggestions: [
      { safety: "cache", bytes: 270, count: 3, items: suggestions.map(item) },
    ],
  })
  expect(summary.bytes).toBe(200)
  expect(summary.count).toBe(4)
  expect(
    summary.suggestions
      .flatMap((group) => group.items)
      .some((item) => item.node.path === "/work/node_modules-old")
  ).toBe(true)
})

test("large inventories retain nested discovery without duplicating measured totals", () => {
  const roots = Array.from({ length: 3000 }, (_, index) =>
    node(`/work/${index}/node_modules`, 100)
  )
  const summary = buildCleanupSummary({
    ...options,
    developerItems: roots.flatMap((parent) => [
      item(node(`${parent.path}/.cache`, 20)),
      item(parent),
    ]),
    suggestions: [],
  })
  expect(summary.bytes).toBe(300_000)
  expect(summary.count).toBe(6000)
})

test("uninspected contents cannot enter the recreatable section even with verified recognition", () => {
  const dependency = node("/work/node_modules", 100)
  const summary = buildCleanupSummary({
    ...options,
    developerItems: [item(dependency)],
    suggestions: [],
    hasUnobservedContents: () => true,
  })
  expect(summary.safe).toEqual([])
  expect(summary.groups[0].items[0].unobserved).toBe(true)
})

test("mixed groups separate eligible files without changing the total or losing paths", () => {
  const ready = node("/ready/node_modules", 100)
  const uncertain = node("/uncertain/node_modules", 80)
  const summary = buildCleanupSummary({
    ...options,
    developerItems: [item(ready), item(uncertain)],
    suggestions: [],
    isEligible: (candidate) => candidate === ready,
  })
  const partition = partitionCleanupGroups(summary)
  expect(partition.ready[0].items.map(({ node }) => node.path)).toEqual([
    ready.path,
  ])
  expect(partition.review[0].items.map(({ node }) => node.path)).toEqual([
    uncertain.path,
  ])
  expect(partition.ready[0].bytes + partition.review[0].bytes).toBe(
    summary.bytes
  )
  expect(partition.ready[0].key).not.toBe(partition.review[0].key)
})

test("item explanations distinguish incomplete scans, ambiguous names, and logs", () => {
  const candidate = node("/work/target", 100)
  const value = { ...item(candidate), safe: false, unobserved: false }
  expect(cleanupItemExplanation({ ...value, unobserved: true })).toBe(
    "disk.ui.cleanup.reason.incomplete"
  )
  expect(
    cleanupItemExplanation({
      ...value,
      recognition: { safety: "unknown", confidence: "ambiguous" },
    })
  ).toBe("disk.ui.cleanup.reason.nameOnly")
  expect(
    cleanupItemExplanation({ ...value, recognition: { safety: "logs" } })
  ).toBe("disk.ui.cleanup.reason.logs")
  expect(
    cleanupItemExplanation({
      ...value,
      safe: true,
      recognition: {
        safety: "regenerable",
        hint: "Xcode regenerates on next build",
      },
    })
  ).toBe("Xcode regenerates on next build")
})

test("presentation merges technical artifact tags into familiar categories without merging decisions", () => {
  const candidates = [
    {
      node: node("/work/web/.next", 100),
      bytes: 100,
      recognition: {
        safety: "regenerable" as const,
        developer: "build-output" as const,
        tag: "Framework build output" as const,
      },
    },
    {
      node: node("/work/app/DerivedData", 50),
      bytes: 50,
      recognition: {
        safety: "regenerable" as const,
        developer: "build-output" as const,
        tag: "Xcode build data" as const,
      },
    },
    {
      node: node("/work/notes/target", 40),
      bytes: 40,
      recognition: {
        safety: "unknown" as const,
        developer: "build-output" as const,
        tag: "Possible build target" as const,
        confidence: "ambiguous" as const,
      },
    },
  ]
  const summary = buildCleanupSummary({
    ...options,
    developerItems: candidates,
    suggestions: [],
    isEligible: () => false,
  })
  const groups = partitionCleanupGroups(summary)
  expect(groups.review.map((group) => group.labelKey)).toEqual([
    "disk.ui.cleanup.buildOutput",
    "disk.ui.cleanup.category.other",
  ])
  expect(groups.review[0].items.length).toBe(2)
  expect(groups.review.reduce((sum, group) => sum + group.bytes, 0)).toBe(190)
  expect(groups.ready).toEqual([])
})

test("an ambiguous accounting remainder retains its full operation and precise child", () => {
  const parent = node("/work/build", 10_000)
  const child = node("/work/build/node_modules", 8_000)
  const summary = buildCleanupSummary({
    ...options,
    developerItems: [{ ...item(parent), bytes: 2_000 }, item(child)],
    suggestions: [],
    isEligible: (candidate) => candidate === child,
  })
  expect(
    summary.groups
      .flatMap((group) => group.items)
      .map((item) => item.node.path)
      .sort()
  ).toEqual([parent.path, child.path].sort())
  expect(
    summary.groups
      .flatMap((group) => group.items)
      .find((item) => item.node === parent)?.bytes
  ).toBe(parent.size)
  expect(summary.bytes).toBe(parent.size)
  expect(summary.safe.map((item) => item.node.path)).toEqual([child.path])
})

test("cleanup search, project grouping and age sorting retain independent choices", () => {
  const old = { ...node("/work/payments/node_modules", 40), modifiedAt: 10 }
  const recent = { ...node("/work/payments/.next", 100), modifiedAt: 20 }
  const other = { ...node("/backup/payments/node_modules", 80), modifiedAt: 30 }
  const summary = buildCleanupSummary({
    ...options,
    developerItems: [old, recent, other].map(item),
    suggestions: [],
  })
  const groups = organizeCleanupGroups(summary, {
    query: "PAYMENTS",
    grouping: "project",
    sort: "oldest",
  })
  expect(groups.ready.map((group) => group.label)).toEqual([
    "/work/payments",
    "/backup/payments",
  ])
  expect(groups.ready[0].items.map((item) => item.node.path)).toEqual([
    old.path,
    recent.path,
  ])
  const searched = organizeCleanupGroups(summary, {
    query: "/backup",
    grouping: "artifact",
    sort: "largest",
  })
  expect(
    searched.ready.flatMap((group) => group.items).map((item) => item.node.path)
  ).toEqual([other.path])
})
