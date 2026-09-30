/**
 * Restoring documents from IndexedDB: the last session on startup and recent files.
 */
import { hasStartupDocument, loadStartupDocument } from '@/app/startup'
import { getT } from '@/i18n'
import type { Animation } from '@/lottie/types'
import { closeDocument, loadDocument, useDocument } from '@/store/document'
import { usePrefs } from '@/store/prefs'
import { flushAutosave, markContainerStored, setDocumentInfo } from './autosave'
import { confirmReplace } from './confirm'
import type { DocumentRoute } from './dialog-ids'
import { describeOpenError, describeStorageError } from './messages'
import { notifyError, notifyInfo } from './notify'
import { revealDocument } from './reveal'
import {
  clearRecents,
  clearSession,
  loadRecents,
  readDocument,
  readSession,
  removeRecent,
  type RecentEntry,
  type StoredDocument,
} from './storage'
import { finishStartup, setRecents, useIo } from './store'
import { formatRelativeTime } from './format'

/**
 * Opens a stored document with its id (autosave keeps updating the same entry), its original
 * (for "Revert to original") and its "edited since export" state.
 */
export function loadStoredDocument(
  stored: StoredDocument,
  original: Animation | undefined,
  recent?: RecentEntry,
): void {
  markContainerStored(stored.id, stored.meta.dotLottie)
  setDocumentInfo(stored.id, {
    source: recent?.source,
    contentKey: recent?.contentKey,
    animationId: recent?.animationId,
    edited: stored.edited,
    editedAt: recent?.editedAt,
    originalStored: !!original,
  })
  loadDocument(stored.doc, {
    id: stored.id,
    fileName: stored.meta.fileName,
    format: stored.meta.format,
    dotLottie: stored.meta.dotLottie,
    sourceSize: stored.meta.sourceSize,
    original,
    dirty: stored.dirty,
  })
}

/** Reloads the recent files list from storage (e.g. after another tab changed it). */
export async function refreshRecents(): Promise<void> {
  try {
    setRecents(await loadRecents())
  } catch {
    setRecents([])
  }
}

/**
 * Restores the last session on startup (no modal: a toast offers to start fresh instead). A
 * `?sample=` or `?url=` link opens its own document: startup then waits for it, so the start
 * pages do not flash before the editor appears.
 */
export async function restoreLastSession(): Promise<void> {
  try {
    if (hasStartupDocument()) {
      // Let every feature register its file handlers before the link's file is dispatched.
      await Promise.resolve()
      await loadStartupDocument()
      return
    }
    if (!usePrefs.getState().autosave) return
    const pointer = await readSession()
    if (!pointer) return
    const data = await readDocument(pointer.id)
    if (!data) {
      await clearSession()
      return
    }
    // The user opened something while storage was being read: theirs wins.
    if (useDocument.getState().doc) return
    const recents = await loadRecents().catch(() => [] as RecentEntry[])
    const recent = recents.find((r) => r.id === pointer.id)
    loadStoredDocument(data.stored, data.original, recent)
    const t = getT()
    const { edited, savedAt } = data.stored
    const at = (edited ? recent?.editedAt : recent?.openedAt) ?? savedAt
    const when = formatRelativeTime(at, usePrefs.getState().language, t.io.time.justNow)
    notifyInfo(
      t.io.restore.restored(data.stored.meta.fileName),
      [edited ? t.io.restore.edited(when) : t.io.restore.opened(when)],
      { label: t.io.restore.startFresh, onClick: () => startFresh() },
    )
  } catch (err) {
    // Storage unavailable (private mode, blocked): start with the welcome screen.
    console.warn('Could not restore the last session', err)
  } finally {
    // Load the recent list before showing the welcome screen, so it doesn't jump when it arrives.
    await refreshRecents()
    finishStartup()
  }
}

/** Closes the restored document; it stays in the recent files. */
export function startFresh(): void {
  void flushAutosave().then(() => {
    closeDocument()
    void clearSession().catch(() => undefined)
  })
}

/**
 * Opens a recent file (asking first when unsaved work would be lost, see confirmReplace), on
 * `route` when given (see `revealDocument`). The open document is only shown.
 */
export async function openRecent(entry: RecentEntry, route?: DocumentRoute): Promise<void> {
  const t = getT()
  if (useDocument.getState().meta?.id === entry.id) {
    revealDocument(route)
    return
  }
  if (!(await confirmReplace())) return
  try {
    await flushAutosave()
    const data = await readDocument(entry.id)
    if (!data) {
      setRecents(await removeRecent(entry.id).catch(() => useIo.getState().recents ?? []))
      notifyError({ title: t.io.recent.missing(entry.fileName), lines: [t.io.recent.missingHint] })
      return
    }
    loadStoredDocument(data.stored, data.original, entry)
    revealDocument(route)
  } catch (err) {
    notifyError(describeOpenError(err, entry.fileName, t))
  }
}

/** Removes a recent file and its stored document (errors become a toast). */
export async function removeRecentEntry(id: string): Promise<void> {
  try {
    setRecents(await removeRecent(id))
  } catch (err) {
    notifyError(describeStorageError(err, getT()))
  }
}

/** Removes every recent file except the open document (errors become a toast). */
export async function clearAllRecents(): Promise<void> {
  try {
    setRecents(await clearRecents(useDocument.getState().meta?.id))
  } catch (err) {
    notifyError(describeStorageError(err, getT()))
  }
}
