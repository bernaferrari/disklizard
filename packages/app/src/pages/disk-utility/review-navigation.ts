export type ReviewNavigationKey = "ArrowDown" | "ArrowUp" | "PageDown" | "PageUp" | "Home" | "End"

export type ReviewNavigationInput = {
  currentIndex: number
  key: ReviewNavigationKey
  length: number
  pageSize: number
  isFocusable?: (index: number) => boolean
}

const REVIEW_NAVIGATION_KEYS: readonly ReviewNavigationKey[] = [
  "ArrowDown",
  "ArrowUp",
  "PageDown",
  "PageUp",
  "Home",
  "End",
]

export function isReviewNavigationKey(key: string): key is ReviewNavigationKey {
  return REVIEW_NAVIGATION_KEYS.includes(key as ReviewNavigationKey)
}

function firstFocusableIndex(length: number, isFocusable: (index: number) => boolean) {
  for (let index = 0; index < length; index++) {
    if (isFocusable(index)) return index
  }
  return -1
}

function lastFocusableIndex(length: number, isFocusable: (index: number) => boolean) {
  for (let index = length - 1; index >= 0; index--) {
    if (isFocusable(index)) return index
  }
  return -1
}

function nearestFocusableIndex(
  start: number,
  direction: -1 | 1,
  length: number,
  isFocusable: (index: number) => boolean,
) {
  const boundedStart = Math.max(0, Math.min(start, length - 1))
  for (let index = boundedStart; index >= 0 && index < length; index += direction) {
    if (isFocusable(index)) return index
  }
  return -1
}

/**
 * Find the next reachable row in a virtual review list without making
 * structural rows (such as recommendation section headers) focusable.
 */
export function reviewNavigationTarget(input: ReviewNavigationInput) {
  const length = Math.max(0, Math.floor(input.length))
  if (!length) return -1

  const isFocusable = input.isFocusable ?? (() => true)
  const first = firstFocusableIndex(length, isFocusable)
  if (first < 0) return -1
  const last = lastFocusableIndex(length, isFocusable)

  if (input.key === "Home") return first
  if (input.key === "End") return last

  const direction: -1 | 1 = input.key === "ArrowUp" || input.key === "PageUp" ? -1 : 1
  const hasCurrent = input.currentIndex >= 0 && input.currentIndex < length && isFocusable(input.currentIndex)
  if (!hasCurrent) return direction === 1 ? first : last
  const current = input.currentIndex

  if (input.key === "ArrowDown" || input.key === "ArrowUp") {
    return nearestFocusableIndex(current + direction, direction, length, isFocusable)
  }

  const pageSize = Number.isFinite(input.pageSize) ? Math.max(1, Math.floor(input.pageSize)) : 1
  const desired = Math.max(0, Math.min(current + direction * pageSize, length - 1))
  const preferred = nearestFocusableIndex(desired, direction, length, isFocusable)
  return preferred >= 0 ? preferred : nearestFocusableIndex(desired, direction === 1 ? -1 : 1, length, isFocusable)
}
