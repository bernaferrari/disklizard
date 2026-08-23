import { describe, expect, it } from "bun:test"
import { MAC_TRAFFIC_LIGHT_INSET, macTrafficLightsVisible } from "./titlebar"

describe("macOS titlebar inset", () => {
  it("reserves the traffic-light cluster only on a windowed Mac", () => {
    expect(macTrafficLightsVisible("macos", false)).toBe(true)
    expect(macTrafficLightsVisible("macos", true)).toBe(false)
    expect(macTrafficLightsVisible("windows", false)).toBe(false)
    expect(macTrafficLightsVisible("linux", false)).toBe(false)
    expect(MAC_TRAFFIC_LIGHT_INSET).toBeGreaterThan(70)
  })
})
