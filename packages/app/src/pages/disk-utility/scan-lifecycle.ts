/**
 * A root scan replaces the source map, so review selections must disappear
 * before native I/O can yield. Keeping this tiny transition outside the page
 * makes the ordering explicit and regression-testable.
 */
export function clearReviewForRootScan<T>(controls: {
  setCollection: (items: T[]) => void
  setDragNode: (node: T | null) => void
  setDropActive: (active: boolean) => void
  closeReview: () => void
}) {
  controls.setCollection([])
  controls.setDragNode(null)
  controls.setDropActive(false)
  controls.closeReview()
}
