/**
 * Autosave: keeps the open document in IndexedDB so a reload, a crash or a closed tab never
 * loses work, and keeps the recent files list up to date.
 *
 * - A newly opened document is written right away (it becomes the session to restore and a
 *   recent file); edits are written 600 ms after the last change.
 * - When a document is replaced or closed, its pending changes are flushed first.
 * - Every write is verified by reading a stamp back; failures are shown in the top bar.
 * - Thumbnails are rendered in idle time: when a document is opened, closed or switched, and
 *   while editing at most every 30 s (never for large documents, whose render takes a while).
 */
import { startupSampleId } from '@/app/startup'
import type { Animation } from '@/lottie/types'
import { findSample } from '@/samples'
import { useDocument, type DocumentMeta, type DocumentState } from '@/store/document'
import { usePrefs } from '@/store/prefs'
import {
  StorageError,
  clearSession,
  patchRecent,
  writeDocument,
  type RecentEntry,
  type RecentSource,
  type StoredDocument,
} from './storage'
import { setRecents, setSaveState, useIo } from './store'
import { renderThumbnail, whenIdle } from './thumbnail'

const DEBOUNCE_MS = 600
/** Large documents take tens of milliseconds to clone into IndexedDB: write them less often. */
const LARGE_DEBOUNCE_MS = 1500
const LARGE_DOC_BYTES = 2_000_000
const THUMBNAIL_INTERVAL_MS = 30_000
/** Above this size a thumbnail render stalls the main thread noticeably (≈0.3 s at 5 MB). */
const LARGE_THUMBNAIL_BYTES = 1_000_000

/** What the io feature knows about a document beyond DocumentMeta (set before loading it). */
export interface DocumentInfo {
  source?: RecentSource
  contentKey?: string
  animationId?: string
  openedAt?: number
  /** The document was already edited in an earlier session (restored from storage). */
  edited?: boolean
  editedAt?: number
  /** Stored document already has its original (no need to write it again). */
  originalStored?: boolean
  /** Size of the document as minified JSON, measured when its thumbnail was last rendered. */
  size?: number
}

const infos = new Map<string, DocumentInfo>()

/** A document restored from storage already has its container stored: don't rewrite it. */
export function markContainerStored(id: string, container: unknown): void {
  if (container !== undefined) writtenContainers.set(id, container)
}

/** Registers details about a document id before `loadDocument` is called with that id. */
export function setDocumentInfo(id: string, info: DocumentInfo): void {
  infos.set(id, { ...infos.get(id), ...info })
}

interface Tracked {
  id: string
  doc: Animation
  meta: DocumentMeta
  original: Animation | null
  revision: number
  savedRevision: number
  /** Revision and dirty flag last written (null: never written). */
  written: { revision: number; dirty: boolean; fileName: string } | null
  originalWritten: boolean
  edited: boolean
  editedAt?: number
  openedAt: number
}

let tracked: Tracked | null = null
/** Container object last written per document (it is only rewritten when it changes). */
const writtenContainers = new Map<string, unknown>()
let timer: ReturnType<typeof setTimeout> | null = null
/** Writes run one after another (a flush of the old document before the new one's first save). */
let queue: Promise<void> = Promise.resolve()
let persistRequested = false
const thumbnailAt = new Map<string, number>()
/** Documents already rendered as a thumbnail, by object: an unchanged one is not rendered again. */
const rendered = new WeakMap<Animation, string>()
/** A `?sample=` link opens its sample without the io feature: identify it on first sight. */
let startupChecked = false

const enabled = () => usePrefs.getState().autosave

function track(s: DocumentState): Tracked {
  const meta = s.meta!
  let info = infos.get(meta.id) ?? {}
  if (!startupChecked) {
    startupChecked = true
    const sampleId = startupSampleId()
    if (
      !info.contentKey &&
      sampleId &&
      meta.fileName === `${sampleId}.json` &&
      findSample(sampleId)
    ) {
      info = { ...info, source: 'sample', contentKey: `sample:${sampleId}` }
      infos.set(meta.id, info)
    }
  }
  if (!info.contentKey) {
    // Opened by another path (e.g. a ?sample= link): identify the content by name and size, so
    // opening the same file again replaces its unedited recent entry instead of duplicating it.
    const size = meta.sourceSize ?? JSON.stringify(s.doc).length
    info = { ...info, contentKey: `${meta.fileName}|${size}` }
    infos.set(meta.id, info)
  }
  return {
    id: meta.id,
    doc: s.doc!,
    meta,
    original: s.original,
    revision: s.revision,
    savedRevision: s.savedRevision,
    written: null,
    originalWritten: info.originalStored ?? false,
    edited: info.edited ?? false,
    editedAt: info.editedAt,
    openedAt: Date.now(),
  }
}

function cancelTimer(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

function schedule(delay: number): void {
  cancelTimer()
  timer = setTimeout(() => {
    timer = null
    if (tracked) void enqueueWrite(tracked, true)
  }, delay)
}

function needsWrite(t: Tracked): boolean {
  const dirty = t.revision !== t.savedRevision
  return (
    !t.written ||
    t.written.revision !== t.revision ||
    t.written.dirty !== dirty ||
    t.written.fileName !== t.meta.fileName
  )
}

function recentEntry(t: Tracked, info: DocumentInfo): RecentEntry {
  const { doc, meta } = t
  return {
    id: t.id,
    fileName: meta.fileName,
    format: meta.format,
    source: info.source,
    animationId: info.animationId,
    width: doc.w,
    height: doc.h,
    fps: doc.fr,
    frames: Math.max(0, doc.op - doc.ip),
    size: info.size ?? meta.sourceSize,
    openedAt: t.openedAt,
    editedAt: t.editedAt,
    edited: t.edited,
    dirty: t.revision !== t.savedRevision,
    contentKey: info.contentKey,
  }
}

/** Writes a snapshot of `t`. `session` = it is the open document (restore it next time). */
function enqueueWrite(t: Tracked, session: boolean): Promise<void> {
  const snapshot = { ...t }
  const run = async () => {
    if (!needsWrite(snapshot)) return
    const isCurrent = () => tracked?.id === snapshot.id
    if (isCurrent()) setSaveState({ kind: 'saving' })
    const savedAt = Date.now()
    const dirty = snapshot.revision !== snapshot.savedRevision
    const info = infos.get(snapshot.id) ?? {}
    const container = snapshot.meta.dotLottie
    const containerChanged =
      container !== undefined && writtenContainers.get(snapshot.id) !== container
    const stored: StoredDocument = {
      v: 1,
      id: snapshot.id,
      doc: snapshot.doc,
      meta: {
        fileName: snapshot.meta.fileName,
        format: snapshot.meta.format,
        sourceSize: snapshot.meta.sourceSize,
        loadedAt: snapshot.meta.loadedAt,
      },
      savedAt,
      dirty,
      edited: snapshot.edited,
    }
    try {
      const recents = await writeDocument({
        doc: stored,
        recent: recentEntry(snapshot, info),
        original: snapshot.original
          ? { value: snapshot.original, stored: snapshot.originalWritten }
          : undefined,
        container:
          container === undefined ? undefined : { value: container, changed: containerChanged },
        session,
      })
      if (containerChanged) writtenContainers.set(snapshot.id, container)
      setRecents(recents)
      const written = { revision: snapshot.revision, dirty, fileName: snapshot.meta.fileName }
      // Update the live record only if it is still the same document.
      if (tracked?.id === snapshot.id) {
        tracked.written = written
        tracked.originalWritten = true
        if (tracked.revision === snapshot.revision && !timer)
          setSaveState({ kind: 'saved', at: savedAt })
      }
      infos.set(snapshot.id, { ...info, originalStored: true })
      maybeRefreshThumbnail(snapshot.id, snapshot.doc, recents)
    } catch (e) {
      const reason = e instanceof StorageError ? e.reason : 'unavailable'
      console.warn('Autosave failed', e)
      if (isCurrent()) setSaveState({ kind: 'error', reason })
    }
  }
  queue = queue.then(run, run)
  return queue
}

/** Best known size of a document in bytes (measured at the last thumbnail, else the source). */
function sizeOf(id: string, meta?: DocumentMeta): number {
  return infos.get(id)?.size ?? meta?.sourceSize ?? 0
}

function maybeRefreshThumbnail(id: string, doc: Animation, recents: RecentEntry[]): void {
  const entry = recents.find((r) => r.id === id)
  if (entry?.thumbnail) {
    // While editing, large documents wait for close/switch; small ones refresh now and then.
    const meta = tracked?.id === id ? tracked.meta : undefined
    if (sizeOf(id, meta) > LARGE_THUMBNAIL_BYTES) return
    if (Date.now() - (thumbnailAt.get(id) ?? 0) < THUMBNAIL_INTERVAL_MS) return
  }
  thumbnailAt.set(id, Date.now())
  whenIdle(() => void refreshThumbnail(id, doc))
}

/** Samples have a known attractive frame; everything else is shown at 1/3 of its duration. */
function thumbnailFrame(id: string): number | undefined {
  const key = infos.get(id)?.contentKey
  return key?.startsWith('sample:') ? findSample(key.slice('sample:'.length))?.poster : undefined
}

async function refreshThumbnail(id: string, doc: Animation): Promise<void> {
  if (rendered.get(doc) === id) return
  rendered.set(doc, id)
  const thumbnail = await renderThumbnail(doc, { at: thumbnailFrame(id) })
  const size = new TextEncoder().encode(JSON.stringify(doc)).length
  infos.set(id, { ...infos.get(id), size })
  try {
    setRecents(await patchRecent(id, { thumbnail: thumbnail ?? undefined, size }))
  } catch {
    // Thumbnails are a nicety: ignore storage failures here (the status shows real save errors).
  }
}

/**
 * Brings the open document's thumbnail up to date (it is refreshed at most every 30 s while
 * editing): for pages that show it, such as the home page. Large documents keep theirs until
 * they are closed, as while editing.
 */
export function refreshOpenThumbnail(): void {
  const t = tracked
  if (!t || !enabled() || rendered.get(t.doc) === t.id) return
  if (sizeOf(t.id, t.meta) > LARGE_THUMBNAIL_BYTES) return
  thumbnailAt.set(t.id, Date.now())
  whenIdle(() => void refreshThumbnail(t.id, t.doc))
}

/** Renders the thumbnail of a stored document that is not open (files dropped together). */
export function scheduleThumbnail(id: string, doc: Animation): void {
  thumbnailAt.set(id, Date.now())
  whenIdle(() => void refreshThumbnail(id, doc))
}

/** Asks the browser not to evict our storage, once, after the first real edit. */
function requestPersistence(): void {
  if (persistRequested) return
  persistRequested = true
  try {
    void navigator.storage?.persist?.().catch(() => false)
  } catch {
    // Best effort only.
  }
}

/** Drops references to a document that is no longer open, once its last write is done. */
async function release(id: string): Promise<void> {
  await queue
  if (tracked?.id !== id) writtenContainers.delete(id)
}

function onDocumentChange(s: DocumentState): void {
  const on = enabled()
  if (!s.doc || !s.meta) {
    const previous = tracked
    tracked = null
    cancelTimer()
    if (previous && on) {
      void enqueueWrite(previous, false).then(() => clearSession().catch(() => undefined))
      whenIdle(() => void refreshThumbnail(previous.id, previous.doc))
    }
    if (previous) void release(previous.id)
    setSaveState({ kind: 'idle' })
    return
  }

  if (!tracked || tracked.id !== s.meta.id) {
    const previous = tracked
    tracked = track(s)
    cancelTimer()
    if (previous && on) {
      if (needsWrite(previous)) void enqueueWrite(previous, false)
      whenIdle(() => void refreshThumbnail(previous.id, previous.doc))
    }
    if (previous) void release(previous.id)
    if (on) {
      setSaveState({ kind: 'pending' })
      schedule(0)
    } else {
      setSaveState({ kind: 'idle' })
    }
    return
  }

  const t = tracked
  const edited = s.revision !== t.revision
  t.doc = s.doc
  t.meta = s.meta
  t.original = s.original
  t.revision = s.revision
  t.savedRevision = s.savedRevision
  if (edited) {
    // Undoing every change brings the document back to its opened state: not edited then.
    t.edited = (infos.get(t.id)?.edited ?? false) || s.past.length > 0
    t.editedAt = Date.now()
    requestPersistence()
  }
  if (!on || !needsWrite(t)) return
  setSaveState({ kind: 'pending' })
  schedule(edited ? (sizeOf(t.id, t.meta) > LARGE_DOC_BYTES ? LARGE_DEBOUNCE_MS : DEBOUNCE_MS) : 0)
}

function onAutosaveToggled(on: boolean): void {
  cancelTimer()
  if (on) {
    if (tracked) {
      tracked.written = null
      setSaveState({ kind: 'pending' })
      schedule(0)
    }
  } else {
    setSaveState({ kind: 'idle' })
    void clearSession().catch(() => undefined)
  }
}

/** Writes pending changes now (before replacing the document, on page hide). */
export function flushAutosave(): Promise<void> {
  if (!enabled() || !tracked) return queue
  if (timer || needsWrite(tracked)) {
    cancelTimer()
    return enqueueWrite(tracked, true)
  }
  return queue
}

/**
 * True when the open document differs from how it was opened: edited in this session (and not
 * undone back to the start) or in an earlier one (restored from storage).
 */
export function isEditedSinceOpen(): boolean {
  const s = useDocument.getState()
  if (!tracked || tracked.id !== s.meta?.id) return s.past.length > 0
  return tracked.edited
}

/** Resolves when every write queued so far has finished. */
export function afterPendingWrites(): Promise<void> {
  return queue
}

/** True when leaving the page now could lose work (see the beforeunload handler). */
export function hasUnsavedWork(): boolean {
  const s = useDocument.getState()
  if (!s.doc) return false
  if (!enabled()) return s.revision !== s.savedRevision
  const save = useIo.getState().save.kind
  return save === 'pending' || save === 'saving' || save === 'error' || timer !== null
}

/** A hidden tab may be discarded without notice: write pending changes right away. */
function onHide(): void {
  if (document.visibilityState === 'hidden') void flushAutosave()
}

/** Starts watching the document store. Returns an uninstall function. */
export function installAutosave(): () => void {
  const unsubscribeDoc = useDocument.subscribe(
    // `original` too, in case a feature swaps it without a new revision.
    (s) => [s.doc, s.meta, s.original, s.revision, s.savedRevision] as const,
    () => onDocumentChange(useDocument.getState()),
    { equalityFn: (a, b) => a.every((v, i) => v === b[i]) },
  )
  const unsubscribePrefs = usePrefs.subscribe((p, prev) => {
    if (p.autosave !== prev.autosave) onAutosaveToggled(p.autosave)
  })
  document.addEventListener('visibilitychange', onHide)
  onDocumentChange(useDocument.getState())
  return () => {
    unsubscribeDoc()
    unsubscribePrefs()
    document.removeEventListener('visibilitychange', onHide)
  }
}
