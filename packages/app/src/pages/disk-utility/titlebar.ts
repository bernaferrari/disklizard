/** Width reserved for the macOS traffic-light cluster in a custom titlebar. */
export const MAC_TRAFFIC_LIGHT_INSET = 84

/** Width of the three native Windows caption buttons (46px each). */
export const WINDOWS_CAPTION_BUTTONS_INSET = 138

export function macTrafficLightsVisible(os?: string, fullscreen?: boolean): boolean {
  return os === "macos" && !fullscreen
}

export function windowsCaptionButtonsVisible(os?: string, fullscreen?: boolean): boolean {
  return os === "windows" && !fullscreen
}
