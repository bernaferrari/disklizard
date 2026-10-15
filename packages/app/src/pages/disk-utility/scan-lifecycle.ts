/**
 * A root scan replaces the source map, so review selections must disappear
 * before native I/O can yield. Keeping this tiny transition outside the page
 * makes the ordering explicit and regression-testable.
 */
export function clearReviewForRootScan(controls: {
  clearCollection: () => void
  cancelDrag: () => void
  closeReview: () => void
}) {
  controls.clearCollection()
  controls.cancelDrag()
  controls.closeReview()
}
