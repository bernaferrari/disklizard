import { describe, expect, test } from "bun:test"
import {
  APP_IDS,
  APP_NAMES,
  APP_PROTOCOL,
  PRODUCT_NAME,
  appIdentity,
  resolveDesktopChannel,
  resolvePublicReleaseRepository,
  updaterFeedChannel,
  updaterPublishConfig,
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
    expect(resolveDesktopChannel(undefined, "latest")).toBe("dev")
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

  test("requires an explicitly acknowledged public update repository", () => {
    expect(resolvePublicReleaseRepository({})).toBeUndefined()
    expect(
      resolvePublicReleaseRepository({
        DISKLIZARD_RELEASE_REPO: "disklizard-releases",
      }),
    ).toBeUndefined()

    const repository = resolvePublicReleaseRepository({
      DISKLIZARD_RELEASE_REPO: "disklizard-releases",
      DISKLIZARD_RELEASE_PUBLIC: "true",
    })
    expect(repository).toEqual({ owner: "bernaferrari", repo: "disklizard-releases", private: false })
    expect(updaterPublishConfig("prod", repository)).toEqual({
      provider: "github",
      owner: "bernaferrari",
      repo: "disklizard-releases",
      channel: "latest",
      private: false,
    })
    expect(updaterPublishConfig("dev", repository)).toBeUndefined()
  })

  test("fails closed for malformed release repository identifiers", () => {
    expect(
      resolvePublicReleaseRepository({
        DISKLIZARD_RELEASE_OWNER: "not/an/owner",
        DISKLIZARD_RELEASE_REPO: "disklizard-releases",
        DISKLIZARD_RELEASE_PUBLIC: "true",
      }),
    ).toBeUndefined()
    expect(
      resolvePublicReleaseRepository({
        DISKLIZARD_RELEASE_REPO: "../private-source",
        DISKLIZARD_RELEASE_PUBLIC: "true",
      }),
    ).toBeUndefined()
  })
})
