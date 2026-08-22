import { app } from "electron"
import { resolveDesktopChannel, type DesktopChannel } from "./product-identity"

export { APP_IDS, APP_NAMES, APP_PROTOCOL, PRODUCT_NAME, appIdentity, updaterFeedChannel } from "./product-identity"
export type { DesktopChannel } from "./product-identity"

export const CHANNEL: DesktopChannel = resolveDesktopChannel(
  import.meta.env.DISKLIZARD_CHANNEL,
  import.meta.env.OPENCODE_CHANNEL,
)

export const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev"
