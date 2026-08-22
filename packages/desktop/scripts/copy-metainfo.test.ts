import { expect, test } from "bun:test"

import { createMetainfo } from "./copy-metainfo"

for (const [channel, appId, productName] of [
  ["dev", "io.github.bernaferrari.disklizard.dev", "DiskLizard Dev"],
  ["beta", "io.github.bernaferrari.disklizard.beta", "DiskLizard Beta"],
  ["prod", "io.github.bernaferrari.disklizard", "DiskLizard"],
] as const) {
  test(`generates DiskLizard AppStream metadata for ${channel}`, () => {
    const metadata = createMetainfo(channel)

    expect(metadata.appId).toBe(appId)
    expect(metadata.xml).toContain(`<name>${productName}</name>`)
    expect(metadata.xml).toContain(`<launchable type="desktop-id">${appId}.desktop</launchable>`)
    expect(metadata.xml).toContain("https://github.com/bernaferrari/disklizard")
    expect(metadata.xml).not.toContain("OpenCode")
    expect(metadata.xml).not.toContain("anomalyco")
  })
}
