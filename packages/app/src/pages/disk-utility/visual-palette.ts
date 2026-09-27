/** Branch hue identifies a location; color never communicates cleanup safety. */
export const STORAGE_HUES = [
  220, 25, 150, 280, 95, 245, 335, 125, 55, 265,
] as const

function inSrgb(lightness: number, chroma: number, hue: number) {
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].every((channel) => channel >= 0 && channel <= 1)
}

function gamutTone(
  L: number,
  hue: number,
  chromaFraction = 0.76,
  hoverLift = 0.025
) {
  let low = 0
  let high = 0.3
  for (let step = 0; step < 20; step++) {
    const mid = (low + high) / 2
    if (inSrgb(L, mid, hue) && inSrgb(Math.min(0.97, L + hoverLift), mid, hue))
      low = mid
    else high = mid
  }
  return { L, C: Math.floor(low * chromaFraction * 1000) / 1000 }
}

// Storage hues identify branches, independent of the surrounding app theme.
const folderTones = STORAGE_HUES.map((hue) =>
  Array.from({ length: 9 }, (_, depth) => gamutTone(0.77 + depth * 0.012, hue))
)
const fileTones = STORAGE_HUES.map((hue) =>
  Array.from({ length: 9 }, (_, depth) =>
    gamutTone(0.66 + depth * 0.008, hue, 0.6)
  )
)
// The map carries no labels inside segments, so it can use a livelier branch
// color than the tiles while still keeping every tone inside sRGB on hover.
const MAP_DEPTH_LIGHTNESS = [
  0, 0.045, -0.018, 0.035, -0.028, 0.025, -0.012, 0.018, -0.02,
]
const MAP_DEPTH_HUE_SHIFT = [0, -10, 4, -14, 7, -6, 10, -8, 5]
export function storageMapHue(hue: number, depth = 0) {
  const level = Math.max(0, Math.min(8, Math.floor(depth)))
  return (hue + MAP_DEPTH_HUE_SHIFT[level] + 360) % 360
}
const mapFolderTones = STORAGE_HUES.map((hue) =>
  Array.from({ length: 9 }, (_, depth) =>
    gamutTone(
      (hue >= 80 && hue <= 130
        ? 0.81
        : hue >= 140 && hue <= 170
          ? 0.76
          : 0.75) + MAP_DEPTH_LIGHTNESS[depth],
      storageMapHue(hue, depth),
      0.94,
      0.035
    )
  )
)
const mapFileTones = STORAGE_HUES.map((hue) =>
  Array.from({ length: 9 }, (_, depth) =>
    gamutTone(
      0.7 + MAP_DEPTH_LIGHTNESS[depth] * 0.55,
      storageMapHue(hue, depth),
      0.72,
      0.035
    )
  )
)

export function storageTone(hue: number, depth = 0, directory = true) {
  const index = Math.max(
    0,
    STORAGE_HUES.indexOf(hue as (typeof STORAGE_HUES)[number])
  )
  const level = Math.max(0, Math.min(8, Math.floor(depth)))
  const tone = directory ? folderTones[index][level] : fileTones[index][level]
  return directory ? tone : { L: tone.L, C: tone.C * 0.7 }
}

export function storageMapTone(hue: number, depth = 0, directory = true) {
  const index = Math.max(
    0,
    STORAGE_HUES.indexOf(hue as (typeof STORAGE_HUES)[number])
  )
  const level = Math.max(0, Math.min(8, Math.floor(depth)))
  return directory ? mapFolderTones[index][level] : mapFileTones[index][level]
}

export function storageMapColor(
  index: number,
  depth: number,
  directory = true
) {
  const hue =
    STORAGE_HUES[
      ((index % STORAGE_HUES.length) + STORAGE_HUES.length) %
        STORAGE_HUES.length
    ]
  const { L, C } = storageMapTone(hue, depth, directory)
  return `oklch(${L} ${C} ${storageMapHue(hue, depth)})`
}

export function storageTileColor(index: number, depth: number) {
  const hue =
    STORAGE_HUES[
      ((index % STORAGE_HUES.length) + STORAGE_HUES.length) %
        STORAGE_HUES.length
    ]
  const { L, C } = storageTone(hue, depth)
  return `oklch(${L} ${C} ${hue})`
}
