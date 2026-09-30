/**
 * Browser storage actions of the settings dialog.
 *
 * - Stored files live in IndexedDB (database and object store `lottie-editor`, written by the
 *   io feature, which tolerates the store being cleared at any time — see io/storage.ts).
 * - Preferences live in localStorage: `lottie-editor:*` (the app and feature stores) and
 *   `react-resizable-panels:le-*` (panel sizes).
 * - A few `lottie-editor:*` keys hold state of saved sessions rather than preferences (layer
 *   locks of autosaved documents): they go with the stored files, not with the preferences.
 */
import { clear, createStore } from 'idb-keyval'
import { getCommand, isCommandEnabled } from '@/commands/registry'

/** Shared with the io feature (io/storage.ts `IDB_NAME` / `IDB_STORE`). */
const IDB_NAME = 'lottie-editor'
const IDB_STORE = 'lottie-editor'

const PREFERENCE_PREFIXES = ['lottie-editor:', 'react-resizable-panels:le-']
/** Per-document state of saved sessions (layers/state.ts `LOCKS_STORAGE`). */
export const SESSION_KEYS: readonly string[] = ['lottie-editor:layer-locks']

/** localStorage keys that hold editor preferences and panel layout. */
export function preferenceKeys(storage: Pick<Storage, 'length' | 'key'>): string[] {
  const keys: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key && !SESSION_KEYS.includes(key) && PREFERENCE_PREFIXES.some((p) => key.startsWith(p)))
      keys.push(key)
  }
  return keys
}

/** Removes every preference and reloads the page so all stores start from their defaults. */
export function resetPreferences(): void {
  try {
    for (const key of preferenceKeys(localStorage)) localStorage.removeItem(key)
  } catch (err) {
    console.warn('Could not reset preferences', err)
  }
  location.reload()
}

/**
 * Deletes recent files and the autosaved session. The io feature's own command runs first so
 * its in-memory recent list updates (the welcome screen shows it); then the whole store is
 * cleared, with the sessions' per-document state. The open document stays open; autosave
 * writes it again on the next change.
 */
export async function clearStoredFiles(): Promise<void> {
  const cmd = getCommand('file.clearRecents')
  if (cmd && isCommandEnabled(cmd)) await cmd.run()
  try {
    for (const key of SESSION_KEYS) localStorage.removeItem(key)
  } catch {
    // localStorage unavailable (private mode): nothing was stored there either.
  }
  if (typeof indexedDB === 'undefined') return
  await clear(createStore(IDB_NAME, IDB_STORE))
}

/**
 * Storage size in the UI language: "80 KB", "3,6 КБ" (1 KB = 1024 B, one decimal below 100).
 * `units` are the localized B/KB/MB/GB symbols.
 */
export function formatStorageSize(
  bytes: number,
  language: string,
  units: readonly string[],
): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value)} ${units[unit]}`
}

export interface StorageInfo {
  /** Bytes used by this site (all storage kinds), if the browser reports it. */
  usage: number | null
  /** Persistent storage granted; null when the API is missing. */
  persisted: boolean | null
  /** The browser can be asked for persistent storage. */
  canPersist: boolean
}

export async function readStorageInfo(): Promise<StorageInfo> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined
  let usage: number | null = null
  let persisted: boolean | null = null
  try {
    const estimate = await storage?.estimate?.()
    if (estimate && typeof estimate.usage === 'number') usage = estimate.usage
  } catch {
    // Not available (private mode, older browsers): the size is simply not shown.
  }
  try {
    if (storage?.persisted) persisted = await storage.persisted()
  } catch {
    persisted = null
  }
  return { usage, persisted, canPersist: typeof storage?.persist === 'function' }
}

/** Asks for persistent storage. Resolves to whether it is granted. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
