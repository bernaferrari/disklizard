/** Branch hue identifies a location; color never communicates cleanup safety. */
export const STORAGE_HUES = [
  255, 25, 150, 285, 112, 194, 345, 55, 320, 85,
] as const

// Yellow needs more lightness than blue and violet to remain equally vivid.
const MAP_LIGHTNESS = [
  0.76, 0.8, 0.91, 0.68, 0.955, 0.93, 0.78, 0.87, 0.73, 0.93,
] as const
const TILE_LIGHTNESS = [
  0.74, 0.8, 0.9, 0.67, 0.94, 0.92, 0.77, 0.86, 0.73, 0.92,
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
  chromaFraction = 0.76
) {
  let low = 0
  let high = 0.3
  for (let step = 0; step < 20; step++) {
    const mid = (low + high) / 2
    if (inSrgb(L, mid, hue))
      low = mid
    else high = mid
  }
  return { L, C: Math.floor(low * chromaFraction * 1000) / 1000 }
}

// Storage hues identify branches, independent of the surrounding app theme.
const folderTones = STORAGE_HUES.map((hue, index) =>
  Array.from({ length: 9 }, (_, depth) =>
    gamutTone(
      TILE_LIGHTNESS[index] + depth * 0.003,
      hue,
      hue >= 255 ? 0.95 : 0.82
    )
  )
)
const fileTones = STORAGE_HUES.map((hue, index) =>
  Array.from({ length: 9 }, (_, depth) => {
    const tone = gamutTone(
      TILE_LIGHTNESS[index] - 0.035 + depth * 0.005,
      hue,
      0.68
    )
    return {
      ...tone,
      C: Math.min(tone.C, folderTones[index][depth].C * 0.72),
    }
  })
)
// One hue means one branch. The outer levels recede gently so hierarchy reads
// before individual wedges; changing hue at each ring obscures that relationship.
export function storageMapHue(hue: number, _depth = 0) {
  return hue
}
const mapFolderTones = STORAGE_HUES.map((hue, index) =>
  Array.from({ length: 9 }, (_, depth) =>
    gamutTone(
      MAP_LIGHTNESS[index] - depth * 0.004,
      hue,
      hue === 112 ? 0.75 : 0.95
    )
  )
)
// Files keep a softer tint of the same branch, so the outer rings still read
// as one family without competing with directories.
const mapFileTones = STORAGE_HUES.map((hue, index) =>
  Array.from({ length: 9 }, (_, depth) => {
    const tone = gamutTone(
      MAP_LIGHTNESS[index] - 0.04 - depth * 0.004,
      hue,
      0.76
    )
    return {
      ...tone,
      C: Math.min(
        tone.C,
        Math.floor(mapFolderTones[index][depth].C * 0.72 * 1000) / 1000
      ),
    }
  })
)

function indexedHue(index: number) {
  return STORAGE_HUES[
    ((index % STORAGE_HUES.length) + STORAGE_HUES.length) % STORAGE_HUES.length
  ]
}

export function storageTone(hue: number, depth = 0, directory = true) {
  const index = Math.max(
    0,
    STORAGE_HUES.indexOf(hue as (typeof STORAGE_HUES)[number])
  )
  const level = Math.max(0, Math.min(8, Math.floor(depth)))
  const tone = directory ? folderTones[index][level] : fileTones[index][level]
  return tone
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
  const hue = indexedHue(index)
  const { L, C } = storageMapTone(hue, depth, directory)
  return `oklch(${L} ${C} ${storageMapHue(hue, depth)})`
}

export function storageTileColor(index: number, depth: number) {
  const hue = indexedHue(index)
  const { L, C } = storageTone(hue, depth)
  return `oklch(${L} ${C} ${hue})`
}

/** Aggregates retain a recognizable branch hue at lower chroma. */
export function storageSummaryColor(
  index: number,
  depth: number,
  surface: "map" | "tile"
) {
  const hue = indexedHue(index)
  const { L, C } =
    surface === "map"
      ? storageMapTone(hue, depth, true)
      : storageTone(hue, depth, true)
  return `oklch(${L} ${Math.floor(C * 0.62 * 1000) / 1000} ${hue})`
}
