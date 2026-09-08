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
