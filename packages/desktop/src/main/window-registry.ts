// Tracks open windows and the persisted window id list used to restore
// windows (and their per-window persisted state) across app launches.
export function createWindowRegistry<W>(persistence: {
  read: () => unknown
  write: (ids: string[]) => void
  cleanup: (id: string) => void
}) {
  const windows = new Map<string, W>()
  let quitting = false
  let lastFocusedID: string | undefined

  const persisted = () => {
    const value = persistence.read()
    if (!Array.isArray(value)) return []
    return value.filter((id): id is string => typeof id === "string" && id.length > 0)
  }

  return {
    persisted,
    /**
     * DiskLizard's cleanup protections are process-wide product state. Until
     * they are centralized in main, restoring more than one renderer would
     * let stale per-window state bypass a protection saved in another window.
     */
    restoreSingle(createID: () => string) {
      const ids = persisted()
      const id = ids[0] ?? createID()
      persistence.write([id])
      for (const stale of new Set(ids.slice(1).filter((candidate) => candidate !== id))) {
        persistence.cleanup(stale)
      }
      return id
    },
    setQuitting(value = true) {
      quitting = value
    },
    register(id: string, window: W) {
      windows.set(id, window)
      const ids = persisted()
      if (!ids.includes(id)) persistence.write([...ids, id])
    },
    focused(id: string) {
      lastFocusedID = id
    },
    lastFocused() {
      if (!lastFocusedID) return
      return windows.get(lastFocusedID)
    },
    closed(id: string) {
      windows.delete(id)
      if (lastFocusedID === id) lastFocusedID = windows.keys().next().value
      // Only a deliberate close (app keeps running with other windows open)
      // forgets a window. Closing the last window quits the app and fires
      // `closed` before `before-quit`, so treat it as a quit and keep the id
      // for restore on next launch.
      if (quitting || windows.size === 0) return
      persistence.write(persisted().filter((item) => item !== id))
      persistence.cleanup(id)
    },
  }
}
