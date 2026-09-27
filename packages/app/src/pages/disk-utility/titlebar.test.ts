import { describe, expect, it } from "bun:test"
import { DISK_UTILITY_STYLES } from "./styles"
import {
  MAC_TRAFFIC_LIGHT_INSET,
  macTrafficLightsVisible,
  WINDOWS_CAPTION_BUTTONS_INSET,
  windowsCaptionButtonsVisible,
} from "./titlebar"

describe("macOS titlebar inset", () => {
  it("reserves the traffic-light cluster only on a windowed Mac", () => {
    expect(macTrafficLightsVisible("macos", false)).toBe(true)
    expect(macTrafficLightsVisible("macos", true)).toBe(false)
    expect(macTrafficLightsVisible("windows", false)).toBe(false)
    expect(macTrafficLightsVisible("linux", false)).toBe(false)
    expect(MAC_TRAFFIC_LIGHT_INSET).toBeGreaterThan(70)
  })
})

describe("Windows titlebar safe area", () => {
  it("reserves the native caption-button cluster only while windowed", () => {
    expect(windowsCaptionButtonsVisible("windows", false)).toBe(true)
    expect(windowsCaptionButtonsVisible("windows", true)).toBe(false)
    expect(windowsCaptionButtonsVisible("macos", false)).toBe(false)
    expect(windowsCaptionButtonsVisible("linux", false)).toBe(false)
    expect(WINDOWS_CAPTION_BUTTONS_INSET).toBe(138)
  })

  it("uses Electron's titlebar safe-area environment variable with a native-width fallback", () => {
    const fallback = `calc(100vw - ${WINDOWS_CAPTION_BUTTONS_INSET}px)`
    expect(DISK_UTILITY_STYLES).toContain(
      `width: env(titlebar-area-width, ${fallback});`
    )
    expect(DISK_UTILITY_STYLES).toContain(
      `max-width: env(titlebar-area-width, ${fallback});`
    )
  })
})
