import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"

const channels = [
  { channel: "dev", appId: "io.github.bernaferrari.disklizard.dev", productName: "DiskLizard Dev" },
  { channel: "beta", appId: "io.github.bernaferrari.disklizard.beta", productName: "DiskLizard Beta" },
  { channel: "prod", appId: "io.github.bernaferrari.disklizard", productName: "DiskLizard" },
] as const

for (const channel of channels) {
  test(`uses one standalone desktop identity for ${channel.channel}`, async () => {
    const previous = process.env.DISKLIZARD_CHANNEL
    process.env.DISKLIZARD_CHANNEL = channel.channel

    const module = await import(`./electron-builder.config.ts?channel=${channel.channel}`)
    const config = module.default as Configuration

    if (previous === undefined) delete process.env.DISKLIZARD_CHANNEL
    else process.env.DISKLIZARD_CHANNEL = previous

    expect(config.appId).toBe(channel.appId)
    expect(config.productName).toBe(channel.productName)
    expect(config.artifactName).toBe("disklizard-${os}-${arch}.${ext}")
    expect(config.extraMetadata?.desktopName).toBe(`${channel.appId}.desktop`)
    expect(config.linux?.executableName).toBe(channel.appId)
    expect(config.linux?.desktop?.entry?.StartupWMClass).toBe(channel.appId)
    expect(config.linux?.category).toBe("Utility")
    expect(config.protocols).toEqual({ name: channel.productName, schemes: ["disklizard"] })
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
  })
}

test("publishes beta and production builds to DiskLizard's release repository", async () => {
  const previous = process.env.DISKLIZARD_CHANNEL
  process.env.DISKLIZARD_CHANNEL = "beta"
  const betaModule = await import("./electron-builder.config.ts?publish=beta")
  const beta = betaModule.default as Configuration

  process.env.DISKLIZARD_CHANNEL = "prod"
  const prodModule = await import("./electron-builder.config.ts?publish=prod")
  const prod = prodModule.default as Configuration

  if (previous === undefined) delete process.env.DISKLIZARD_CHANNEL
  else process.env.DISKLIZARD_CHANNEL = previous

  expect(beta.publish).toEqual({
    provider: "github",
    owner: "bernaferrari",
    repo: "disklizard",
    channel: "beta",
    private: false,
  })
  expect(prod.publish).toEqual({
    provider: "github",
    owner: "bernaferrari",
    repo: "disklizard",
    channel: "latest",
    private: false,
  })
  expect(prod.win?.verifyUpdateCodeSignature).toBe(true)
  expect(prod.win?.sign).toBeUndefined()
  expect(prod.win?.signtoolOptions?.sign).toBeUndefined()
  expect(prod.rpm?.packageName).toBe("disklizard")
})

test("does not retain an OpenCode Linux launcher or embedded CLI in release config", async () => {
  const previous = process.env.DISKLIZARD_CHANNEL
  process.env.DISKLIZARD_CHANNEL = "prod"

  const module = await import("./electron-builder.config.ts?release-resources")
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.DISKLIZARD_CHANNEL
  else process.env.DISKLIZARD_CHANNEL = previous

  expect(config.extraResources).toHaveLength(1)
  expect(config.deb?.fpm).not.toContainEqual(expect.stringContaining("opencode-desktop.desktop"))
  expect(config.rpm?.fpm).not.toContainEqual(expect.stringContaining("opencode-desktop.desktop"))
})
