import { describe, expect, test } from "bun:test"
import {
  APP_IDS,
  APP_NAMES,
  APP_PROTOCOL,
  PRODUCT_NAME,
  appIdentity,
  resolveDesktopChannel,
  updaterFeedChannel,
} from "./product-identity"

describe("desktop product identity", () => {
  test("keeps every build channel on the DiskLizard identity", () => {
    expect(APP_IDS).toEqual({
      dev: "io.github.bernaferrari.disklizard.dev",
      beta: "io.github.bernaferrari.disklizard.beta",
      prod: "io.github.bernaferrari.disklizard",
    })
    expect(APP_NAMES).toEqual({ dev: "DiskLizard Dev", beta: "DiskLizard Beta", prod: "DiskLizard" })
    expect(APP_PROTOCOL).toBe("disklizard")
  })

  test("uses DISKLIZARD_CHANNEL before the legacy channel", () => {
    expect(resolveDesktopChannel("beta", "prod")).toBe("beta")
    expect(resolveDesktopChannel(undefined, "prod")).toBe("prod")
    expect(resolveDesktopChannel("unknown", "beta")).toBe("dev")
  })

  test("uses dev identity for unpackaged runs and isolates the beta feed", () => {
    expect(appIdentity("prod", false)).toEqual({
      appId: "io.github.bernaferrari.disklizard.dev",
      name: "DiskLizard Dev",
    })
    expect(appIdentity("beta", true)).toEqual({
      appId: "io.github.bernaferrari.disklizard.beta",
      name: "DiskLizard Beta",
    })
    expect(updaterFeedChannel("beta")).toBe("beta")
    expect(updaterFeedChannel("prod")).toBe("latest")
    expect(updaterFeedChannel("dev")).toBe("latest")
    expect(PRODUCT_NAME).toBe("DiskLizard")
  })
})
