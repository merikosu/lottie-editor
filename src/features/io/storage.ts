/**
 * Local persistence (IndexedDB via idb-keyval): the autosaved session and the recent files.
 *
 * Keys in the `lottie-editor` database / object store:
 *   `recents`      RecentEntry[] (light: what the welcome screen lists, newest first)
 *   `session`      { id, savedAt }: the document to restore on the next start
 *   `doc:<id>`     StoredDocument: the latest state of a document
 *   `orig:<id>`    the document as it was opened (for "Revert to original")
 *   `box:<id>`     the dotLottie container (other animations, themes…), written when it changes
 *   `stamp:<id>`   { savedAt }: read back after every write to verify it landed
 *
 * The settings dialog may `clear()` the whole store; everything here tolerates missing keys.
 */
import {
  createStore,
  delMany,
  get,
  getMany,
  keys,
  setMany,
  update,
  type UseStore,
} from 'idb-keyval'
import type { Animation } from '@/lottie/types'
import type { SourceFormat } from '@/store/document'

/** Database and object store names (shared with the settings dialog's "clear stored files"). */
export const IDB_NAME = 'lottie-editor'
export const IDB_STORE = 'lottie-editor'

/** How many recent files are kept (their documents are stored too). */
export const MAX_RECENTS = 12

export type RecentSource = 'json' | 'dotlottie' | 'tgs' | 'zip' | 'sample' | 'new' | 'url' | 'paste'

/** One row of the recent files list. */
export interface RecentEntry {
  /** Document id (DocumentMeta.id), also the key of the stored document. */
  id: string
  fileName: string
  format: SourceFormat
  source?: RecentSource
  /** dotLottie with several animations: the one being edited. */
  animationId?: string
  width: number
  height: number
  fps: number
  /** Duration in frames. */
  frames: number
  /** Size in bytes: the source file, or the minified JSON after edits. */
  size?: number
  openedAt: number
  /** When the last edit was saved; undefined if the document was never edited. */
  editedAt?: number
  edited: boolean
  /** Edited since the last download/export (the work exists only in this browser). */
  dirty?: boolean
  /** Small PNG/WebP data URL. */
  thumbnail?: string
  /** Identifies the source content, so opening the same file twice does not add two rows. */
  contentKey?: string
}

/** Meta data kept with a stored document (DocumentMeta without the session id). */
export interface StoredMeta {
  fileName: string
  format: SourceFormat
  sourceSize?: number
  dotLottie?: unknown
  loadedAt: number
}

export interface StoredDocument {
  v: 1
  id: string
  doc: Animation
  meta: StoredMeta
  savedAt: number
  /** Edited since the last download/export (the top bar dot). */
  dirty: boolean
  /** Edited since it was opened. */
  edited: boolean
}

export interface SessionPointer {
  id: string
  savedAt: number
}

/** Storage failures, classified for the save status ("storage full" vs "unavailable"). */
export class StorageError extends Error {
  readonly reason: 'quota' | 'unavailable'
  constructor(reason: 'quota' | 'unavailable', message: string) {
    super(message)
    this.name = 'StorageError'
    this.reason = reason
  }
}

const KEY = {
  recents: 'recents',
  session: 'session',
  doc: (id: string) => `doc:${id}`,
  original: (id: string) => `orig:${id}`,
  container: (id: string) => `box:${id}`,
  stamp: (id: string) => `stamp:${id}`,
}

const dataKeys = (id: string) => [KEY.doc(id), KEY.original(id), KEY.container(id), KEY.stamp(id)]

let store: UseStore | null = null

function db(): UseStore {
  if (!store) {
    if (typeof indexedDB === 'undefined')
      throw new StorageError('unavailable', 'IndexedDB is not available')
    store = createStore(IDB_NAME, IDB_STORE)
  }
  return store
}

function toStorageError(e: unknown): StorageError {
  if (e instanceof StorageError) return e
  const name = e instanceof Error || e instanceof DOMException ? e.name : ''
  const message = e instanceof Error ? e.message : String(e)
  const quota =
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    /quota|space/i.test(message)
  return new StorageError(quota ? 'quota' : 'unavailable', message)
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    throw toStorageError(e)
  }
}

function isRecentEntry(v: unknown): v is RecentEntry {
  if (v === null || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return (
    typeof r.id === 'string' && typeof r.fileName === 'string' && typeof r.openedAt === 'number'
  )
}

function activity(r: RecentEntry): number {
  return Math.max(r.openedAt, r.editedAt ?? 0)
}

/** Copies only the defined fields, so an update never erases a stored thumbnail by accident. */
function definedFields<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

/* -------------------------------------------------------------------------- */
/*                                   Recents                                  */
/* -------------------------------------------------------------------------- */

/** Recent files, newest first. */
export async function loadRecents(): Promise<RecentEntry[]> {
  return guard(async () => {
    const list = await get<unknown>(KEY.recents, db())
    return Array.isArray(list)
      ? list.filter(isRecentEntry).sort((a, b) => activity(b) - activity(a))
      : []
  })
}

/**
 * Inserts or updates an entry (it moves to the top). An unedited entry with the same content is
 * replaced; entries beyond MAX_RECENTS are dropped together with their stored documents.
 * Returns the new list.
 */
export async function upsertRecent(entry: RecentEntry): Promise<RecentEntry[]> {
  return guard(async () => {
    let next: RecentEntry[] = []
    const dropped: string[] = []
    await update<RecentEntry[]>(
      KEY.recents,
      (old) => {
        const list = (Array.isArray(old) ? old : []).filter(isRecentEntry)
        const existing = list.find((r) => r.id === entry.id)
        const merged: RecentEntry = { ...existing, ...definedFields(entry) } as RecentEntry
        const others = list.filter((r) => r.id !== entry.id)
        const kept = others.filter((r) => {
          const duplicate = !!entry.contentKey && r.contentKey === entry.contentKey && !r.edited
          if (duplicate) dropped.push(r.id)
          return !duplicate
        })
        const all = [merged, ...kept].sort((a, b) => activity(b) - activity(a))
        // The entry being written always stays, even when its activity is older than 12 others.
        const limited = all
          .filter((r) => r.id === entry.id)
          .concat(all.filter((r) => r.id !== entry.id))
          .slice(0, MAX_RECENTS)
        for (const r of all) if (!limited.includes(r)) dropped.push(r.id)
        next = limited.sort((a, b) => activity(b) - activity(a))
        return next
      },
      db(),
    )
    if (dropped.length) await delMany(dropped.flatMap(dataKeys), db())
    return next
  })
}

/** Updates fields of an entry (thumbnail, size) without moving it. Returns the new list. */
export async function patchRecent(
  id: string,
  patch: Partial<Omit<RecentEntry, 'id'>>,
): Promise<RecentEntry[]> {
  return guard(async () => {
    let next: RecentEntry[] = []
    await update<RecentEntry[]>(
      KEY.recents,
      (old) => {
        const list = (Array.isArray(old) ? old : []).filter(isRecentEntry)
        next = list.map((r) => (r.id === id ? { ...r, ...definedFields(patch) } : r))
        return next
      },
      db(),
    )
    return next
  })
}

/**
 * Marks a stored document as downloaded (its changes now exist outside the browser): clears the
 * "unsaved" dot of its recent entry and of the document restored from storage. Returns the list.
 */
export async function markExported(id: string): Promise<RecentEntry[]> {
  return guard(async () => {
    const stored = await get<StoredDocument>(KEY.doc(id), db())
    if (stored?.v === 1 && stored.dirty) {
      await setMany([[KEY.doc(id), { ...stored, dirty: false } satisfies StoredDocument]], db())
    }
    return patchRecent(id, { dirty: false })
  })
}

/** Removes an entry and its stored document. Returns the new list. */
export async function removeRecent(id: string): Promise<RecentEntry[]> {
  return guard(async () => {
    let next: RecentEntry[] = []
    await update<RecentEntry[]>(
      KEY.recents,
      (old) => {
        next = (Array.isArray(old) ? old : []).filter(isRecentEntry).filter((r) => r.id !== id)
        return next
      },
      db(),
    )
    const session = await get<SessionPointer>(KEY.session, db())
    await delMany([...dataKeys(id), ...(session?.id === id ? [KEY.session] : [])], db())
    return next
  })
}

/**
 * Removes every recent file and stored document except `keepId` (the open document, which
 * autosave keeps writing). Returns the new list.
 */
export async function clearRecents(keepId?: string): Promise<RecentEntry[]> {
  return guard(async () => {
    let next: RecentEntry[] = []
    await update<RecentEntry[]>(
      KEY.recents,
      (old) => {
        next = (Array.isArray(old) ? old : []).filter(isRecentEntry).filter((r) => r.id === keepId)
        return next
      },
      db(),
    )
    const keep = new Set(keepId ? dataKeys(keepId) : [])
    const all = await keys<IDBValidKey>(db())
    const stale = all.filter(
      (k) => typeof k === 'string' && /^(doc|orig|box|stamp):/.test(k) && !keep.has(k),
    )
    const session = await get<SessionPointer>(KEY.session, db())
    if (session && session.id !== keepId) stale.push(KEY.session)
    if (stale.length) await delMany(stale, db())
    return next
  })
}

/* -------------------------------------------------------------------------- */
/*                                  Documents                                 */
/* -------------------------------------------------------------------------- */

export interface WriteInput {
  doc: StoredDocument
  recent: RecentEntry
  /**
   * The document as opened. It never changes, so it is written when not `stored` yet, or when it
   * went missing from storage.
   */
  original?: { value: Animation; stored: boolean }
  /**
   * The dotLottie container (`meta.dotLottie`), stored apart from the document because it can be
   * large and rarely changes. It is written when `changed`, or when it is missing from storage
   * (the settings dialog may have cleared everything). `doc.meta.dotLottie` is then omitted.
   */
  container?: { value: unknown; changed: boolean }
  /** Point the session at this document (false when flushing a document being closed). */
  session?: boolean
}

/**
 * Writes a document and its recent entry, then reads the write stamp back to make sure the data
 * landed (IndexedDB can fail silently when the browser evicts storage). Returns the recents list.
 */
export async function writeDocument(input: WriteInput): Promise<RecentEntry[]> {
  return guard(async () => {
    const { id, savedAt } = input.doc
    const entries: [IDBValidKey, unknown][] = [
      [KEY.doc(id), input.doc],
      [KEY.stamp(id), { savedAt }],
    ]
    // Parts written earlier are checked for presence (one cheap key listing), because the settings
    // dialog may have cleared the whole store while the document stayed open.
    const needsCheck = input.original?.stored || (input.container && !input.container.changed)
    const present = needsCheck ? new Set(await keys<IDBValidKey>(db())) : new Set<IDBValidKey>()
    if (input.original && (!input.original.stored || !present.has(KEY.original(id)))) {
      entries.push([KEY.original(id), input.original.value])
    }
    if (input.container && (input.container.changed || !present.has(KEY.container(id)))) {
      entries.push([KEY.container(id), input.container.value])
    }
    if (input.session !== false)
      entries.push([KEY.session, { id, savedAt } satisfies SessionPointer])
    await setMany(entries, db())
    const recents = await upsertRecent(input.recent)
    const stamp = await get<{ savedAt: number }>(KEY.stamp(id), db())
    if (stamp?.savedAt !== savedAt)
      throw new StorageError('unavailable', 'The saved data could not be read back')
    return recents
  })
}

/** Reads a stored document and its original; null when it is gone. */
export async function readDocument(
  id: string,
): Promise<{ stored: StoredDocument; original?: Animation } | null> {
  return guard(async () => {
    const [stored, original, container] = await getMany<unknown>(
      [KEY.doc(id), KEY.original(id), KEY.container(id)],
      db(),
    )
    if (!stored || typeof stored !== 'object' || (stored as StoredDocument).v !== 1) return null
    const doc = stored as StoredDocument
    if (!doc.doc || typeof doc.doc !== 'object') return null
    const withContainer =
      container !== undefined && doc.meta.dotLottie === undefined
        ? { ...doc, meta: { ...doc.meta, dotLottie: container } }
        : doc
    return {
      stored: withContainer,
      original: original && typeof original === 'object' ? (original as Animation) : undefined,
    }
  })
}

/** The document to restore on startup, if any. */
export async function readSession(): Promise<SessionPointer | null> {
  return guard(async () => {
    const s = await get<unknown>(KEY.session, db())
    if (!s || typeof s !== 'object') return null
    const p = s as SessionPointer
    return typeof p.id === 'string' && typeof p.savedAt === 'number' ? p : null
  })
}

/** Forgets the session (the next start shows the welcome screen). */
export async function clearSession(): Promise<void> {
  return guard(async () => {
    await delMany([KEY.session], db())
  })
}
