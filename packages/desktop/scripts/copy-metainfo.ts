import { resolveChannel, type Channel } from "./utils"

const APP_ID = "io.github.bernaferrari.disklizard"

export function createMetainfo(channel: Channel) {
  const appId = channel === "prod" ? APP_ID : `${APP_ID}.${channel}`
  const productName =
    channel === "prod" ? "DiskLizard" : `DiskLizard ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
  const summary = `Developer-aware disk space explorer${channel !== "prod" ? ` (${channel})` : ""}`
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="io.github.bernaferrari">
    <name>DiskLizard contributors</name>
  </developer>

  <description>
    <p>
      DiskLizard maps disk usage, recognizes common developer artifacts, and supports deliberate cleanup review.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/bernaferrari/disklizard/issues</url>
  <url type="homepage">https://github.com/bernaferrari/disklizard</url>
  <url type="vcs-browser">https://github.com/bernaferrari/disklizard</url>
</component>
`

  return { appId, xml }
}

if (import.meta.main) {
  const arg = process.argv[2]
  const channel: Channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()
  const { appId, xml } = createMetainfo(channel)
  await Bun.write(`resources/${appId}.metainfo.xml`, xml)
  console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
}
