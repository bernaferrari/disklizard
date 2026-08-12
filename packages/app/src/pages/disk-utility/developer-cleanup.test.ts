import { describe, expect, it } from "bun:test"
import type { DeveloperItem } from "./recognize"
import {
  developerCleanupAgeLabel,
  filterDeveloperItemsByAge,
  matchesDeveloperCleanupAge,
  resolveDeveloperCleanupAge,
} from "./developer-cleanup"

const now = Date.UTC(2026, 7, 11, 12)
const day = 24 * 60 * 60 * 1000

function item(name: string, modifiedAt?: number): DeveloperItem {
  return {
    bytes: 10,
    recognition: { safety: "regenerable", developer: "dependencies" },
    node: { name, path: `/${name}`, size: 10, modifiedAt, isDir: true, children: [], ext: "" },
  }
}

describe("developer cleanup age policy", () => {
  it("offers all of the fixed policies and resolves them deterministically", () => {
    expect(resolveDeveloperCleanupAge("all", "30")).toEqual({ valid: true })
    expect(resolveDeveloperCleanupAge("30", "90")).toEqual({ valid: true, days: 30 })
    expect(resolveDeveloperCleanupAge("180", "30")).toEqual({ valid: true, days: 180 })
    expect(resolveDeveloperCleanupAge("custom", "45")).toEqual({ valid: true, days: 45 })
  })

  it("does not silently turn invalid custom input into an unrestricted cleanup", () => {
    expect(resolveDeveloperCleanupAge("custom", "")).toEqual({ valid: false })
    expect(resolveDeveloperCleanupAge("custom", "0")).toEqual({ valid: false })
    expect(resolveDeveloperCleanupAge("custom", "1.5")).toEqual({ valid: false })
    expect(resolveDeveloperCleanupAge("custom", "3651")).toEqual({ valid: false })
  })

  it("filters by modification age and excludes an unavailable date from age-qualified results", () => {
    const age = resolveDeveloperCleanupAge("30", "30")
    const items = [item("old", now - 31 * day), item("recent", now - 29 * day), item("unknown")]

    expect(filterDeveloperItemsByAge(items, age, now).map(({ node }) => node.name)).toEqual(["old"])
    expect(matchesDeveloperCleanupAge(undefined, resolveDeveloperCleanupAge("all", ""), now)).toBe(true)
  })

  it("uses honest modification-time language", () => {
    expect(developerCleanupAgeLabel(resolveDeveloperCleanupAge("custom", "30"))).toBe("Unchanged for at least 30 days")
    expect(developerCleanupAgeLabel(resolveDeveloperCleanupAge("custom", "not-a-number"))).toBe(
      "Set a whole number from 1 to 3,650 days",
    )
  })
})
