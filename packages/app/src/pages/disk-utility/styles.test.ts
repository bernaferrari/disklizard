import { expect, it } from "bun:test"
import { DISK_UTILITY_STYLES } from "./styles"

it("registers scan keyframes at stylesheet scope rather than inside a theme selector", () => {
  // @keyframes cannot be nested in a style rule. Browsers silently discard
  // them in that position while still rendering the static stripe gradient.
  let depth = 0
  const css = DISK_UTILITY_STYLES.replace(/\/\*[\s\S]*?\*\//g, "")
  for (let i = 0; i < css.length; i++) {
    if (css.startsWith("@keyframes dl-scan-travel", i)) expect(depth).toBe(0)
    if (css[i] === "{") depth++
    if (css[i] === "}") depth--
    expect(depth).toBeGreaterThanOrEqual(0)
  }
  expect(depth).toBe(0)
})

// WCAG contrast uses linear sRGB luminance. Check the actual tokens so an
// independently tuned dark theme or hover state cannot regress white labels.
function linearRgb(lightness: number, chroma: number, hue: number) {
  const angle = (hue * Math.PI) / 180
  const a = chroma * Math.cos(angle)
  const b = chroma * Math.sin(angle)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

for (const token of [
  "--dl-action",
  "--dl-action-hover",
  "--dl-danger-action",
  "--dl-danger-action-hover",
]) {
  it(`${token} stays in sRGB and gives small white labels at least 4.5:1 contrast`, () => {
    const declarations = [
      ...DISK_UTILITY_STYLES.matchAll(
        new RegExp(`${token}:\\s*oklch\\(([^)]+)\\)`, "g")
      ),
    ]
    expect(declarations.length).toBeGreaterThan(0)
    for (const declaration of declarations) {
      const [l, c, h] = declaration[1].trim().split(/\s+/).map(Number)
      const [r, g, b] = linearRgb(l, c, h)
      for (const channel of [r, g, b]) {
        expect(channel).toBeGreaterThanOrEqual(0)
        expect(channel).toBeLessThanOrEqual(1)
      }
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
      expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
  })
}

it("keeps destructive text readable on light and dark dialog surfaces", () => {
  const dangerTokens = [
    ...DISK_UTILITY_STYLES.matchAll(/--dl-danger:\s*oklch\(([^)]+)\)/g),
  ]
  const darkSurface = DISK_UTILITY_STYLES.match(
    /--dl-popover:\s*oklch\(([^)]+)\)/
  )
  expect(dangerTokens).toHaveLength(2)
  expect(darkSurface).not.toBeNull()
  const luminance = (channels: number[]) =>
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
  const parse = (value: string) => {
    const [l, c, h] = value.trim().split(/\s+/).map(Number)
    const channels = linearRgb(l, c, h)
    for (const channel of channels) {
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(1)
    }
    return luminance(channels)
  }
  const lightDanger = parse(dangerTokens[0][1])
  const darkDanger = parse(dangerTokens[1][1])
  if (!darkSurface) throw new Error("Dark dialog surface must be defined")
  const darkBackground = parse(darkSurface[1])
  expect(1.05 / (lightDanger + 0.05)).toBeGreaterThanOrEqual(4.5)
  expect((darkDanger + 0.05) / (darkBackground + 0.05)).toBeGreaterThanOrEqual(
    4.5
  )
})
