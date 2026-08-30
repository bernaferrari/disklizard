import { resolveDesktopChannel, type DesktopChannel } from "../src/main/product-identity"

export type Channel = DesktopChannel

export function resolveChannel(): Channel {
  return resolveDesktopChannel(Bun.env.DISKLIZARD_CHANNEL, Bun.env.OPENCODE_CHANNEL)
}
