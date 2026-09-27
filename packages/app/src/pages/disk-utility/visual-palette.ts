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
// One hue means one branch. The outer levels recede gently so hierarchy reads
// before individual wedges; changing hue at each ring obscures that relationship.
export function storageMapHue(hue: number, _depth = 0) {
  return hue
}
const mapFolderTones = STORAGE_HUES.map((hue) =>
  Array.from({ length: 9 }, (_, depth) =>
    gamutTone(0.77 - depth * 0.008, hue, 0.76 - depth * 0.025, 0.035)
  )
)
// Files are neutral endpoints, not a new colored branch.
const mapFileTones = Array.from({ length: 9 }, (_, depth) => ({
  L: 0.68 - depth * 0.006,
  C: 0.006,
}))

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
  return directory ? mapFolderTones[index][level] : mapFileTones[level]
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
  return `oklch(${L} ${C} ${directory ? storageMapHue(hue, depth) : 250})`
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
