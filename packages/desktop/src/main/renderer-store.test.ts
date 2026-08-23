import { describe, expect, test } from "bun:test"
import { resolveRendererStoreName } from "./renderer-store"

describe("renderer store authority", () => {
  test("maps typed renderer store ids to fixed user-data files", () => {
    expect(resolveRendererStoreName("disklizard")).toBe("disklizard.dat")
    expect(resolveRendererStoreName("global")).toBe("opencode.global.dat")
  })

  test("rejects paths and unknown stores", () => {
    expect(() => resolveRendererStoreName("/tmp/escaped.json")).toThrow("Invalid renderer store")
    expect(() => resolveRendererStoreName("../escaped.json")).toThrow("Invalid renderer store")
    expect(() => resolveRendererStoreName("disklizard.updater")).toThrow("Invalid renderer store")
  })
})
