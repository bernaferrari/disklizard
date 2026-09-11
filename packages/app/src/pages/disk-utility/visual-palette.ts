/** Shared storage colors. Hue expresses identity, never cleanup safety. */
export const STORAGE_HUES = [85, 145, 220, 310, 25, 95, 265, 180, 340, 115] as const

function inSrgb(lightness: number, chroma: number, hue: number) {
  const a = chroma * Math.cos(hue * Math.PI / 180)
  const b = chroma * Math.sin(hue * Math.PI / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
    -0.0041960863*l - 0.7034186147*m + 1.707614701*s].every(channel => channel >= 0 && channel <= 1)
}

// Compute once, not in animation frames. Each hue uses the same share of its
// own displayable chroma, including headroom for the hover lightness lift.
const tones = STORAGE_HUES.map(hue => Array.from({length: 6}, (_, depth) => {
  const L = 0.82 + depth * 0.012
  let low = 0, high = 0.3
  for (let step = 0; step < 20; step++) {
    const mid = (low + high) / 2
    if (inSrgb(L, mid, hue) && inSrgb(L + 0.025, mid, hue)) low = mid
    else high = mid
  }
  return { L, C: Math.floor(low * 0.94 * 1000) / 1000 }
}))

export function storageTone(hue: number, depth = 0, directory = true) {
  const index = STORAGE_HUES.indexOf(hue as typeof STORAGE_HUES[number])
  const tone = tones[Math.max(0, index)][Math.max(0, Math.min(5, Math.floor(depth)))]
  return directory ? tone : { L: tone.L, C: tone.C * 0.94 }
}

// Tile headers and their children need clear steps, unlike continuous map rings.
const tileTones = STORAGE_HUES.map(hue => [0.76, 0.845, 0.93].map(L => {
  let low = 0, high = 0.3
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2
    if (inSrgb(L, mid, hue)) low = mid
    else high = mid
  }
  return `oklch(${L} ${Math.floor(low * 0.94 * 1000) / 1000} ${hue})`
}))
export function storageTileColor(index: number, depth: number) {
  return tileTones[((index % tileTones.length) + tileTones.length) % tileTones.length][Math.max(0, Math.min(2, depth))]
}
