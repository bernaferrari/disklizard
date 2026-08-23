/** Width reserved for the macOS traffic-light cluster in a custom titlebar. */
export const MAC_TRAFFIC_LIGHT_INSET = 84

export function macTrafficLightsVisible(os?: string, fullscreen?: boolean): boolean {
  return os === "macos" && !fullscreen
}
