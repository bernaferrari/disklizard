import { app } from "electron"
import { resolveDesktopChannel, resolvePublicReleaseRepository, type DesktopChannel } from "./product-identity"

export { APP_IDS, APP_NAMES, APP_PROTOCOL, PRODUCT_NAME, appIdentity, updaterFeedChannel } from "./product-identity"
export type { DesktopChannel } from "./product-identity"

export const CHANNEL: DesktopChannel = resolveDesktopChannel(
  import.meta.env.DISKLIZARD_CHANNEL,
  import.meta.env.OPENCODE_CHANNEL,
)

export const RELEASE_REPOSITORY = resolvePublicReleaseRepository({
  DISKLIZARD_RELEASE_OWNER: import.meta.env.DISKLIZARD_RELEASE_OWNER,
  DISKLIZARD_RELEASE_REPO: import.meta.env.DISKLIZARD_RELEASE_REPO,
  DISKLIZARD_RELEASE_PUBLIC: import.meta.env.DISKLIZARD_RELEASE_PUBLIC,
})

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev" && RELEASE_REPOSITORY !== undefined
