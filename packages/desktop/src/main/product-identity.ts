export const DESKTOP_CHANNELS = ["dev", "beta", "prod"] as const

export type DesktopChannel = (typeof DESKTOP_CHANNELS)[number]

export const PRODUCT_NAME = "DiskLizard"
export const APP_PROTOCOL = "disklizard"

export const APP_IDS = {
  dev: "io.github.bernaferrari.disklizard.dev",
  beta: "io.github.bernaferrari.disklizard.beta",
  prod: "io.github.bernaferrari.disklizard",
} as const satisfies Record<DesktopChannel, string>

export const APP_NAMES = {
  dev: `${PRODUCT_NAME} Dev`,
  beta: `${PRODUCT_NAME} Beta`,
  prod: PRODUCT_NAME,
} as const satisfies Record<DesktopChannel, string>

/**
 * DISKLIZARD_CHANNEL is the canonical build-time channel. OPENCODE_CHANNEL is
 * only a compatibility fallback for local builds that have not switched yet.
 */
export function resolveDesktopChannel(channel: unknown, legacyChannel?: unknown): DesktopChannel {
  const raw = channel ?? legacyChannel
  return isDesktopChannel(raw) ? raw : "dev"
}

function isDesktopChannel(value: unknown): value is DesktopChannel {
  return typeof value === "string" && DESKTOP_CHANNELS.includes(value as DesktopChannel)
}

export function appIdentity(channel: DesktopChannel, packaged: boolean) {
  const buildChannel = packaged ? channel : "dev"
  return { appId: APP_IDS[buildChannel], name: APP_NAMES[buildChannel] }
}

export function updaterFeedChannel(channel: DesktopChannel): "beta" | "latest" {
  return channel === "beta" ? "beta" : "latest"
}
