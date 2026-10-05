import { describe, expect, it } from "bun:test"
import { distinguishingPathLabels, itemIdentity } from "./item-identity"
import type { DiskScanNode } from "./types"

describe("cleanup item identity", () => {
  it("retains the project and artifact in review", () => {
    const node: DiskScanNode = {
      name: "target",
      path: "/work/payments/target",
      size: 1,
      isDir: true,
      children: [],
      ext: "",
    }
    expect(itemIdentity(node).reviewTitle).toBe("payments / target")
  })

  it("distinguishes identical project names from different locations", () => {
    const paths = [
      "/Users/bernardo/Work/payments/target",
      "/Volumes/Backup/payments/target",
    ]
    const labels = distinguishingPathLabels(paths)
    expect(labels.get(paths[0])).toContain("Work/payments/target")
    expect(labels.get(paths[1])).toContain("Backup/payments/target")
    expect(labels.get(paths[0])).not.toBe(labels.get(paths[1]))
  })
})

it("abbreviates only the actual home while retaining distinct users, volumes and network roots", async () => {
  const { abbreviateHomePath, cleanupLocationLabels } =
    await import("./item-identity")
  const paths = [
    "/Users/bernardo/Developer/payments/target",
    "/Users/other/Developer/payments/target",
    "/Volumes/Backup/Developer/payments/target",
    "//server/share/Developer/payments/target",
  ]
  expect(abbreviateHomePath(paths[0], "/Users/bernardo")).toBe(
    "~/Developer/payments/target"
  )
  expect(abbreviateHomePath(paths[1], "/Users/bernardo")).toBe(paths[1])
  expect(
    abbreviateHomePath(
      "/Users/bernardos/Developer/payments/target",
      "/Users/bernardo"
    )
  ).not.toStartWith("~")
  expect(
    new Set(cleanupLocationLabels(paths, "/Users/bernardo").values()).size
  ).toBe(paths.length)
  const drives = [
    "C:\\Work\\payments\\target",
    "D:\\Work\\payments\\target",
    "\\\\server\\share\\payments\\target",
  ]
  expect(
    new Set(cleanupLocationLabels(drives, "C:\\Users\\Bernardo").values()).size
  ).toBe(drives.length)
})
