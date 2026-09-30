/**
 * Keeps "edited since the last export" honest. The document store only knows whether anything
 * happened since the last save (`revision !== savedRevision`); undo and redo are exact inverses,
 * though, so returning to the history position of the last clean state (opened, downloaded or
 * exported) brings back its content, and the document is clean again: no dot in the top bar, no
 * "discard changes?" question with autosave off. Reverting to the original of a file that was
 * never exported since it was opened makes it clean too.
 */
import { isDirty, markSaved, useDocument, type DocumentState } from '@/store/document'

interface CleanState {
  /** Document the state belongs to. */
  docId: string
  /** History position of the clean state (see `historyMarker`). */
  marker: string
  /** The clean state is the file as it was opened (its original). */
  original: boolean
}

let clean: CleanState | null = null

/**
 * Identifies a history position: the last step and how many changes it holds (a gesture that
 * merges into a step after a save adds to it), or the opened state.
 */
function historyMarker(s: DocumentState): string {
  const last = s.past[s.past.length - 1]
  return last ? `${last.id}:${last.patches.length}` : 'opened'
}

function onChange(s: DocumentState, prev: DocumentState): void {
  if (!s.doc || !s.meta) {
    clean = null
    return
  }
  const opened = s.meta.id !== prev.meta?.id
  if (opened) {
    // A file opened as is (not a session restored with unexported changes) is clean; it is
    // its own original unless a separate one was restored with it.
    clean = isDirty(s)
      ? null
      : { docId: s.meta.id, marker: historyMarker(s), original: s.original === s.doc }
    return
  }
  if (clean?.docId !== s.meta.id) clean = null
  const marker = historyMarker(s)
  if (!isDirty(s)) {
    // Saved or exported here: this is the new clean state.
    if (s.savedRevision !== prev.savedRevision || !clean)
      clean = { docId: s.meta.id, marker, original: clean?.marker === marker && clean.original }
    return
  }
  // Back where it was clean (undo/redo, a history jump): same content, so clean again.
  if (clean && s.revision !== prev.revision && marker === clean.marker) markSaved()
}

/**
 * After "Revert to original": clean when the last clean state was the file as opened (nothing
 * was exported since), since the document now has exactly that content.
 */
export function markCleanIfOriginal(): void {
  const s = useDocument.getState()
  if (!clean || s.meta?.id !== clean.docId || !clean.original || !isDirty(s)) return
  markSaved()
  // The new clean state is still the original's content (a later revert stays clean too).
  clean = { docId: clean.docId, marker: historyMarker(useDocument.getState()), original: true }
}

/** Watches the document store; returns the uninstall function. */
export function installCleanTracking(): () => void {
  const s = useDocument.getState()
  clean =
    s.doc && s.meta && !isDirty(s)
      ? { docId: s.meta.id, marker: historyMarker(s), original: s.original === s.doc }
      : null
  const unsubscribe = useDocument.subscribe(onChange)
  return () => {
    unsubscribe()
    clean = null
  }
}
