import { describe, expect, test } from "bun:test"
import {
  PACKAGED_SMOKE_FIXTURE_ARGUMENT,
  PACKAGED_SMOKE_USER_DATA_ARGUMENT,
  resolvePackagedSmokeConfig,
} from "./packaged-smoke"

describe("packaged smoke startup contract", () => {
  test("requires a packaged explicit smoke build before accepting fixture paths", () => {
    const argv = [
      "app",
      `${PACKAGED_SMOKE_FIXTURE_ARGUMENT}/work/fixture`,
      `${PACKAGED_SMOKE_USER_DATA_ARGUMENT}/work/profile`,
    ]

    expect(resolvePackagedSmokeConfig(argv, false, true)).toBeUndefined()
    expect(resolvePackagedSmokeConfig(argv, true, false)).toBeUndefined()
    expect(resolvePackagedSmokeConfig(argv, true, true)).toEqual({
      fixturePath: "/work/fixture",
      userDataPath: "/work/profile",
    })
  })

  test("fails closed on partial, relative, or overlapping smoke paths", () => {
    expect(() =>
      resolvePackagedSmokeConfig(["app", `${PACKAGED_SMOKE_FIXTURE_ARGUMENT}/work/fixture`], true, true),
    ).toThrow("requires absolute fixture and user-data paths")
    expect(() =>
      resolvePackagedSmokeConfig(
        [
          "app",
          `${PACKAGED_SMOKE_FIXTURE_ARGUMENT}relative-fixture`,
          `${PACKAGED_SMOKE_USER_DATA_ARGUMENT}/work/profile`,
        ],
        true,
        true,
      ),
    ).toThrow("requires absolute fixture and user-data paths")
    expect(() =>
      resolvePackagedSmokeConfig(
        [
          "app",
          `${PACKAGED_SMOKE_FIXTURE_ARGUMENT}/work/fixture`,
          `${PACKAGED_SMOKE_USER_DATA_ARGUMENT}/work/fixture/profile`,
        ],
        true,
        true,
      ),
    ).toThrow("must not overlap")
  })

  test("leaves an explicit smoke build in normal mode when no smoke arguments are supplied", () => {
    expect(resolvePackagedSmokeConfig(["app"], true, true)).toBeUndefined()
  })
})
