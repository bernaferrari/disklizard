/** Small, deterministic helpers shared by keyboard and pointer list selection. */
export function wrappedListIndex(index: number, delta: number, length: number) {
  if (length <= 0) return -1
  return ((index + delta) % length + length) % length
}

/** Keep structural navigation within the visible list rather than crossing its ends. */
export function clampedListIndex(index: number, length: number) {
  if (length <= 0) return -1
  return Math.max(0, Math.min(index, length - 1))
}

/** Page navigation is intentionally bounded: Shift+Page must never turn into a wrapped, giant review range. */
export function pagedListIndex(index: number, direction: -1 | 1, pageSize: number, length: number) {
  const current = clampedListIndex(index, length)
  if (current < 0) return -1
  return clampedListIndex(current + direction * Math.max(1, Math.floor(pageSize)), length)
}

/** A fresh Shift navigation begins at the item that was focused before the movement. */
export function selectionAnchorIndex(anchor: number | undefined, currentIndex: number, length: number) {
  return clampedListIndex(anchor ?? currentIndex, length)
}

/** Inclusive contiguous range, normalized so it works in either selection direction. */
export function inclusiveIndexRange(anchor: number, target: number, length: number) {
  if (length <= 0) return []
  const start = Math.max(0, Math.min(anchor, target, length - 1))
  const end = Math.max(0, Math.min(Math.max(anchor, target), length - 1))
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
}
