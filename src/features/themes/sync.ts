/**
 * Keeps theme colors (slots) consistent whoever edits them.
 *
 * The inspector, the timeline and the other editors write a property's own value, while
 * lottie-web — and every dotLottie player — draws `slots[sid].p` for a property bound to a slot:
 * an edit of a bound fill would not show on the canvas, and players would disagree. After each
 * edit this module brings the slot value and the other bound copies in line with the copy that
 * was edited (or with the slot value, when that is what changed), inside the SAME history entry,
 * so the edit and its sync are one undo step. Edits that keep copies consistent (the Themes
 * section's own) change nothing here.
 */
import { produceWithPatches, type Patch } from 'immer'
import { syncSlotCopies, touchedSlots } from '@/lottie/slots'
import { useDocument, type DocumentState } from '@/store/document'

interface Processed {
  docId: string
  entryId: number
  /** Patches of that entry already looked at (a gesture keeps adding to its entry). */
  count: number
}

let processed: Processed | null = null
let scheduled = false

function markProcessed(s: DocumentState): void {
  const last = s.past[s.past.length - 1]
  processed =
    last && s.meta ? { docId: s.meta.id, entryId: last.id, count: last.patches.length } : null
}

/**
 * Patches recorded since the last sync: the rest of the entry looked at last time (a gesture
 * keeps adding to it) and every entry after it (several edits can land in one tick).
 */
function unprocessedPatches(s: DocumentState): Patch[] {
  const past = s.past
  // Nothing looked at yet in this document (it had no history): every entry is new.
  let from = 0
  let start = 0
  if (processed && s.meta && processed.docId === s.meta.id) {
    // The entry looked at last may have left the bounded history: then only the latest counts.
    from = past.length - 1
    for (let i = past.length - 1; i >= 0; i--) {
      if (past[i].id !== processed.entryId) continue
      from = i
      start = processed.count
      break
    }
  }
  const out: Patch[] = []
  for (let i = Math.max(0, from); i < past.length; i++) {
    const patches = past[i].patches
    for (let p = i === from ? start : 0; p < patches.length; p++) out.push(patches[p])
  }
  return out
}

/** Syncs the slots the latest edits touched, amending the latest history entry. */
function syncLatest(): void {
  scheduled = false
  const s = useDocument.getState()
  const last = s.past[s.past.length - 1]
  if (!s.doc || !s.meta || !last) return
  const added = unprocessedPatches(s)
  markProcessed(s)
  if (added.length === 0) return
  const touched = touchedSlots(s.doc, added)
  if (!touched || touched.size === 0) return
  const [doc, patches, inverse] = produceWithPatches(s.doc, (draft) => {
    for (const [id, from] of touched) syncSlotCopies(draft, id, from)
  })
  if (patches.length === 0) return
  const amended = {
    ...last,
    patches: last.patches.concat(patches),
    inverse: inverse.concat(last.inverse),
  }
  processed = { docId: s.meta.id, entryId: last.id, count: amended.patches.length }
  useDocument.setState({
    doc,
    past: s.past.slice(0, -1).concat(amended),
    revision: s.revision + 1,
  })
}

/** Starts watching edits; returns the uninstall function. */
export function installSlotSync(): () => void {
  markProcessed(useDocument.getState())
  return useDocument.subscribe((next, prev) => {
    if (next.meta?.id !== prev.meta?.id) {
      markProcessed(next)
      return
    }
    if (next.past === prev.past) return
    // Undo and redo replay entries that were synced when they were made.
    const undone = next.past.length < prev.past.length
    const redone = prev.future.length > 0 && next.past[next.past.length - 1] === prev.future[0]
    if (undone || redone) {
      markProcessed(next)
      return
    }
    // Deferred: setting state inside a store listener would hand later listeners a stale state.
    if (!scheduled) {
      scheduled = true
      queueMicrotask(syncLatest)
    }
  })
}
