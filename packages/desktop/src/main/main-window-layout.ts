export const MAIN_WINDOW_MINIMUM_WIDTH = 900
export const MAIN_WINDOW_MINIMUM_HEIGHT = 640

/** BrowserWindow options shared by every standalone DiskLizard window. */
export function mainWindowMinimumSize() {
  return {
    minWidth: MAIN_WINDOW_MINIMUM_WIDTH,
    minHeight: MAIN_WINDOW_MINIMUM_HEIGHT,
  } as const
}
