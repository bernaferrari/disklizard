/**
 * Storage adapters matching the shape the runtime expects from
 * `@solid-primitives/storage` (sync and async variants), backed by
 * `localStorage` in the browser fixture.
 */

export interface SyncStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface AsyncStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export function createLocalStorage(): SyncStorage {
  return {
    getItem: (key) => globalThis.localStorage?.getItem(key) ?? null,
    setItem: (key, value) => globalThis.localStorage?.setItem(key, value),
    removeItem: (key) => globalThis.localStorage?.removeItem(key),
  }
}
