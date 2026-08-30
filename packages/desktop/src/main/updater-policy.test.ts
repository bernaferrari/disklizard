import { describe, expect, test } from "bun:test"
import {
  applyUpdaterReleasePolicy,
  productionUpdaterDowngradeAllowed,
  resolveWindowsPublisherName,
  updaterAllowsPrerelease,
} from "./updater-policy"

describe("updater release policy", () => {
  test("blocks production downgrades while preserving prerelease channel testing", () => {
    expect(productionUpdaterDowngradeAllowed("prod")).toBe(false)
    expect(productionUpdaterDowngradeAllowed("beta")).toBe(true)
    expect(productionUpdaterDowngradeAllowed("dev")).toBe(true)
  })

  test("uses GitHub prerelease discovery only for the beta channel", () => {
    expect(updaterAllowsPrerelease("beta")).toBe(true)
    expect(updaterAllowsPrerelease("prod")).toBe(false)
    expect(updaterAllowsPrerelease("dev")).toBe(false)
  })

  test("applies beta and production discovery policy to the updater backend", () => {
    const backend = { channel: null, allowPrerelease: false, allowDowngrade: false }

    applyUpdaterReleasePolicy(backend, "beta")
    expect(backend).toEqual({ channel: "beta", allowPrerelease: true, allowDowngrade: true })

    applyUpdaterReleasePolicy(backend, "prod")
    expect(backend).toEqual({ channel: "latest", allowPrerelease: false, allowDowngrade: false })
  })

  test("accepts only a canonical bounded Windows certificate distinguished name", () => {
    expect(resolveWindowsPublisherName("  CN=DiskLizard Release, O=DiskLizard  ")).toBe(
      "CN=DiskLizard Release, O=DiskLizard",
    )
    expect(resolveWindowsPublisherName(undefined)).toBeUndefined()
    expect(resolveWindowsPublisherName(" ")).toBeUndefined()
    expect(resolveWindowsPublisherName("DiskLizard Release")).toBeUndefined()
    expect(resolveWindowsPublisherName("CN=DiskLizard Release")).toBeUndefined()
    expect(resolveWindowsPublisherName("O=DiskLizard")).toBeUndefined()
    expect(resolveWindowsPublisherName("CN=DiskLizard, CN=Impostor, O=DiskLizard")).toBeUndefined()
    expect(resolveWindowsPublisherName("CN=DiskLizard, O=DiskLizard, O=Impostor")).toBeUndefined()
    expect(resolveWindowsPublisherName("cn=DiskLizard, o=DiskLizard")).toBe("CN=DiskLizard, O=DiskLizard")
    expect(resolveWindowsPublisherName('CN="DiskLizard, Inc.", O=DiskLizard')).toBe(
      'CN="DiskLizard, Inc.", O=DiskLizard',
    )
    expect(resolveWindowsPublisherName('CN="", O=DiskLizard')).toBeUndefined()
    expect(resolveWindowsPublisherName("DiskLizard\nPublisher")).toBeUndefined()
    expect(resolveWindowsPublisherName("x".repeat(257))).toBeUndefined()
  })
})
