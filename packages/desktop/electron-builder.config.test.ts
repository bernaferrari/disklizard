import { expect, test } from "bun:test"
import type { Configuration } from "electron-builder"
import { validateConfiguration } from "app-builder-lib/out/util/config/config"

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
    expect(config.protocols).toBeUndefined()
    expect(config.deb?.afterInstall).toEqual(expect.stringContaining("linux-after-install.sh"))
    expect(config.deb?.afterRemove).toEqual(expect.stringContaining("linux-after-remove.sh"))
    expect(config.rpm?.afterInstall).toBe(config.deb?.afterInstall)
    expect(config.rpm?.afterRemove).toBe(config.deb?.afterRemove)
    expect(config.deb?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
    expect(config.rpm?.fpm).toContainEqual(expect.stringContaining(`/usr/share/metainfo/${channel.appId}.metainfo.xml`))
  })
}

test("publishes only when a public release repository is explicitly configured", async () => {
  const previous = {
    channel: process.env.DISKLIZARD_CHANNEL,
    owner: process.env.DISKLIZARD_RELEASE_OWNER,
    repo: process.env.DISKLIZARD_RELEASE_REPO,
    public: process.env.DISKLIZARD_RELEASE_PUBLIC,
    publisher: process.env.DISKLIZARD_WINDOWS_PUBLISHER_NAME,
  }

  try {
    process.env.DISKLIZARD_CHANNEL = "prod"
    delete process.env.DISKLIZARD_RELEASE_OWNER
    delete process.env.DISKLIZARD_RELEASE_REPO
    delete process.env.DISKLIZARD_RELEASE_PUBLIC
    const unconfiguredModule = await import("./electron-builder.config.ts?publish=unconfigured")
    const unconfigured = unconfiguredModule.default as Configuration
    expect(unconfigured.publish).toBeUndefined()
    expect(unconfigured.win?.forceCodeSigning).toBeUndefined()

    process.env.DISKLIZARD_RELEASE_REPO = "disklizard-releases"
    process.env.DISKLIZARD_RELEASE_PUBLIC = "true"
    process.env.DISKLIZARD_WINDOWS_PUBLISHER_NAME = "CN=DiskLizard Release, O=DiskLizard"
    process.env.DISKLIZARD_CHANNEL = "beta"
    const betaModule = await import("./electron-builder.config.ts?publish=configured-beta")
    const beta = betaModule.default as Configuration

    process.env.DISKLIZARD_CHANNEL = "prod"
    const prodModule = await import("./electron-builder.config.ts?publish=configured-prod")
    const prod = prodModule.default as Configuration

    expect(beta.publish).toEqual({
      provider: "github",
      owner: "bernaferrari",
      repo: "disklizard-releases",
      channel: "beta",
      private: false,
    })
    expect(prod.publish).toEqual({
      provider: "github",
      owner: "bernaferrari",
      repo: "disklizard-releases",
      channel: "latest",
      private: false,
    })
    expect(prod.win?.verifyUpdateCodeSignature).toBe(true)
    expect(prod.win?.signtoolOptions?.publisherName).toBe("CN=DiskLizard Release, O=DiskLizard")
    expect(prod.win?.forceCodeSigning).toBe(true)
    expect(prod.win?.sign).toBeUndefined()
    expect(prod.win?.signtoolOptions?.sign).toBeUndefined()
    expect(prod.rpm?.packageName).toBe("disklizard")
    await expect(validateConfiguration(prod, { isEnabled: false } as never)).resolves.toBeUndefined()
  } finally {
    if (previous.channel === undefined) delete process.env.DISKLIZARD_CHANNEL
    else process.env.DISKLIZARD_CHANNEL = previous.channel
    if (previous.owner === undefined) delete process.env.DISKLIZARD_RELEASE_OWNER
    else process.env.DISKLIZARD_RELEASE_OWNER = previous.owner
    if (previous.repo === undefined) delete process.env.DISKLIZARD_RELEASE_REPO
    else process.env.DISKLIZARD_RELEASE_REPO = previous.repo
    if (previous.public === undefined) delete process.env.DISKLIZARD_RELEASE_PUBLIC
    else process.env.DISKLIZARD_RELEASE_PUBLIC = previous.public
    if (previous.publisher === undefined) delete process.env.DISKLIZARD_WINDOWS_PUBLISHER_NAME
    else process.env.DISKLIZARD_WINDOWS_PUBLISHER_NAME = previous.publisher
  }
})

test("uses the same strict channel identity in the bundle and package configs", async () => {
  const previous = {
    channel: process.env.DISKLIZARD_CHANNEL,
    legacy: process.env.OPENCODE_CHANNEL,
  }
  try {
    delete process.env.DISKLIZARD_CHANNEL
    process.env.OPENCODE_CHANNEL = "latest"
    const [builderModule, viteModule] = await Promise.all([
      import("./electron-builder.config.ts?channel-parity=builder"),
      import("./electron.vite.config.ts?channel-parity=vite"),
    ])
    const builder = builderModule.default as Configuration
    const vite = viteModule.default as { main?: { define?: Record<string, string> } }

    expect(builder.appId).toBe("io.github.bernaferrari.disklizard.dev")
    expect(vite.main?.define?.["import.meta.env.DISKLIZARD_CHANNEL"]).toBe(JSON.stringify("dev"))
    expect(vite.main?.define?.["import.meta.env.OPENCODE_CHANNEL"]).toBe(JSON.stringify("dev"))
  } finally {
    if (previous.channel === undefined) delete process.env.DISKLIZARD_CHANNEL
    else process.env.DISKLIZARD_CHANNEL = previous.channel
    if (previous.legacy === undefined) delete process.env.OPENCODE_CHANNEL
    else process.env.OPENCODE_CHANNEL = previous.legacy
  }
})

test("refuses a public update feed without an exact Windows certificate publisher DN", async () => {
  const previous = {
    channel: process.env.DISKLIZARD_CHANNEL,
    repo: process.env.DISKLIZARD_RELEASE_REPO,
    public: process.env.DISKLIZARD_RELEASE_PUBLIC,
    publisher: process.env.DISKLIZARD_WINDOWS_PUBLISHER_NAME,
  }
  try {
    process.env.DISKLIZARD_CHANNEL = "prod"
    process.env.DISKLIZARD_RELEASE_REPO = "disklizard-releases"
    process.env.DISKLIZARD_RELEASE_PUBLIC = "true"

    process.env.DISKLIZARD_WINDOWS_PUBLISHER_NAME = "CN=DiskLizard Release"
    await expect(import("./electron-builder.config.ts?publisher=partial")).rejects.toThrow(
      "DISKLIZARD_WINDOWS_PUBLISHER_NAME",
    )

    process.env.DISKLIZARD_WINDOWS_PUBLISHER_NAME =
      "CN=DiskLizard Release, O=DiskLizard, CN=Unexpected Publisher"
    await expect(import("./electron-builder.config.ts?publisher=duplicate")).rejects.toThrow(
      "DISKLIZARD_WINDOWS_PUBLISHER_NAME",
    )

    delete process.env.DISKLIZARD_WINDOWS_PUBLISHER_NAME

    await expect(import("./electron-builder.config.ts?publisher=missing")).rejects.toThrow(
      "DISKLIZARD_WINDOWS_PUBLISHER_NAME",
    )
  } finally {
    if (previous.channel === undefined) delete process.env.DISKLIZARD_CHANNEL
    else process.env.DISKLIZARD_CHANNEL = previous.channel
    if (previous.repo === undefined) delete process.env.DISKLIZARD_RELEASE_REPO
    else process.env.DISKLIZARD_RELEASE_REPO = previous.repo
    if (previous.public === undefined) delete process.env.DISKLIZARD_RELEASE_PUBLIC
    else process.env.DISKLIZARD_RELEASE_PUBLIC = previous.public
    if (previous.publisher === undefined) delete process.env.DISKLIZARD_WINDOWS_PUBLISHER_NAME
    else process.env.DISKLIZARD_WINDOWS_PUBLISHER_NAME = previous.publisher
  }
})

test("packages only DiskLizard release resources and excludes built source maps", async () => {
  const previous = process.env.DISKLIZARD_CHANNEL
  process.env.DISKLIZARD_CHANNEL = "prod"

  const module = await import("./electron-builder.config.ts?release-resources")
  const config = module.default as Configuration

  if (previous === undefined) delete process.env.DISKLIZARD_CHANNEL
  else process.env.DISKLIZARD_CHANNEL = previous

  expect(config.extraResources).toHaveLength(1)
  expect(config.files).toContain("!out/**/*.map")
  expect(config.deb?.fpm).not.toContainEqual(expect.stringContaining("opencode-desktop.desktop"))
  expect(config.rpm?.fpm).not.toContainEqual(expect.stringContaining("opencode-desktop.desktop"))
})

test("disables signing and notarization only for the explicit packaged smoke mode", async () => {
  const previous = process.env.DISKLIZARD_PACKAGED_SMOKE

  try {
    delete process.env.DISKLIZARD_PACKAGED_SMOKE
    const releaseModule = await import("./electron-builder.config.ts?signing=release")
    const release = releaseModule.default as Configuration
    expect(release.mac?.identity).toBeUndefined()
    expect(release.directories?.output).toBe("dist")
    expect(release.mac?.hardenedRuntime).toBe(true)
    expect(release.mac?.notarize).toBe(true)
    expect(release.dmg?.sign).toBe(true)
    expect(release.win?.signExecutable).toBeUndefined()
    expect(release.nsis?.createDesktopShortcut).toBe(true)
    expect(release.nsis?.createStartMenuShortcut).toBe(true)
    expect(release.nsis?.runAfterFinish).toBe(true)

    process.env.DISKLIZARD_PACKAGED_SMOKE = "true"
    const nonExplicitModule = await import("./electron-builder.config.ts?signing=non-explicit")
    const nonExplicit = nonExplicitModule.default as Configuration
    expect(nonExplicit.directories?.output).toBe("dist")
    expect(nonExplicit.mac?.notarize).toBe(true)
    expect(nonExplicit.win?.signExecutable).toBeUndefined()

    process.env.DISKLIZARD_PACKAGED_SMOKE = "1"
    const smokeModule = await import("./electron-builder.config.ts?signing=smoke")
    const smoke = smokeModule.default as Configuration
    expect(smoke.mac?.identity).toBeNull()
    expect(smoke.directories?.output).toBe("dist-smoke")
    expect(smoke.mac?.hardenedRuntime).toBe(false)
    expect(smoke.mac?.notarize).toBe(false)
    expect(smoke.dmg?.sign).toBe(false)
    expect(smoke.win?.signExecutable).toBe(false)
    expect(smoke.nsis?.createDesktopShortcut).toBe(false)
    expect(smoke.nsis?.createStartMenuShortcut).toBe(false)
    expect(smoke.nsis?.runAfterFinish).toBe(false)
  } finally {
    if (previous === undefined) delete process.env.DISKLIZARD_PACKAGED_SMOKE
    else process.env.DISKLIZARD_PACKAGED_SMOKE = previous
  }
})

test("forces a public-release shell into a non-publishing dev smoke artifact", async () => {
  const keys = [
    "DISKLIZARD_CHANNEL",
    "DISKLIZARD_PACKAGED_SMOKE",
    "DISKLIZARD_RELEASE_OWNER",
    "DISKLIZARD_RELEASE_PUBLIC",
    "DISKLIZARD_RELEASE_REPO",
    "DISKLIZARD_WINDOWS_PUBLISHER_NAME",
  ] as const
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    process.env.DISKLIZARD_CHANNEL = "prod"
    process.env.DISKLIZARD_PACKAGED_SMOKE = "1"
    process.env.DISKLIZARD_RELEASE_OWNER = "bernaferrari"
    process.env.DISKLIZARD_RELEASE_PUBLIC = "true"
    process.env.DISKLIZARD_RELEASE_REPO = "disklizard-releases"
    process.env.DISKLIZARD_WINDOWS_PUBLISHER_NAME = "CN=DiskLizard Release, O=DiskLizard"
    const [builderModule, viteModule] = await Promise.all([
      import("./electron-builder.config.ts?smoke=public-release-shell"),
      import("./electron.vite.config.ts?smoke=public-release-shell"),
    ])
    const builder = builderModule.default as Configuration
    const vite = viteModule.default as { main?: { define?: Record<string, string> } }

    expect(builder.appId).toBe("io.github.bernaferrari.disklizard.dev")
    expect(builder.productName).toBe("DiskLizard Dev")
    expect(builder.publish).toBeUndefined()
    expect(builder.win?.signtoolOptions?.publisherName).toBeUndefined()
    expect(vite.main?.define?.["import.meta.env.DISKLIZARD_CHANNEL"]).toBe(JSON.stringify("dev"))
    expect(vite.main?.define?.["import.meta.env.DISKLIZARD_RELEASE_PUBLIC"]).toBe(JSON.stringify(""))
    expect(vite.main?.define?.["import.meta.env.DISKLIZARD_RELEASE_REPO"]).toBe(JSON.stringify(""))
  } finally {
    for (const key of keys) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
