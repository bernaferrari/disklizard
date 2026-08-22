import type { DesktopChannel } from "./product-identity"

export function productionUpdaterDowngradeAllowed(channel: DesktopChannel) {
  return channel !== "prod"
}

export function productionVerifyUpdateCodeSignature() {
  return true
}
