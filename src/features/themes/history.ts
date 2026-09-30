/**
 * Undoable changes to the dotLottie package (`DocumentMeta.dotLottie`), where themes live.
 *
 * The document store records history for the Lottie JSON only, so package changes ride on its
 * history entries (the pattern of the docops speed ledger): every entry that changed the package
 * has a before/after pair here, and undo/redo put the matching package back.
 * - A change of the package alone becomes an entry of its own: no JSON patches, the package
 *   pair here. It carries a translated label, coalesces like `updateDoc` (one step per picker
 *   drag), bumps the revision (autosave writes the package, the document counts as changed) and
 *   shows in the History panel like any other step.
 * - A change of both (renaming a theme color renames its rules too) is ONE step: the package
 *   pair is attached to the entry `updateDoc` just recorded.
 */
import type { Draft } from 'immer'
import type { Animation } from '@/lottie/types'
import {
  updateDoc,
  useDocument,
  type DocumentState,
  type HistoryEntry,
  type UpdateOptions,
} from '@/store/document'

interface Transition {
  docId: string
  before: unknown
  after: unknown
}

/** Package states before/after each history entry that changed the package, by entry id. */
const transitions = new Map<number, Transition>()
/** Entries of our own get negative ids: the store numbers its entries from 1 upwards. */
let nextEntryId = -1

// Same values as the document store (a gesture's updates merge; the history is bounded).
const COALESCE_MS = 1500
const HISTORY_LIMIT = 300

export interface PackageEditOptions {
  /** Gesture key: updates with the same key merge into one undo step (see `updateDoc`). */
  coalesceKey?: string
  /** Gesture state: false while in progress, true for the last update. */
  final?: boolean
}

/**
 * Replaces the package as one undoable step. Returns false when there is no document or the
 * package is the same object.
 */
export function commitPackage(
  label: string,
  next: unknown,
  opts: PackageEditOptions = {},
): boolean {
  const s = useDocument.getState()
  if (!s.doc || !s.meta) return false
  const before = s.meta.dotLottie
  if (next === before) return false
  const now = Date.now()
  const last = s.past[s.past.length - 1]
  const lastTransition = last ? transitions.get(last.id) : undefined
  const merge =
    !!opts.coalesceKey &&
    !!last &&
    !!lastTransition &&
    last.coalesceKey === opts.coalesceKey &&
    s.future.length === 0 &&
    (!last.closed || now - last.time < COALESCE_MS)

  let past: HistoryEntry[]
  if (merge && last && lastTransition) {
    transitions.set(last.id, { ...lastTransition, after: next })
    past = s.past.slice(0, -1).concat({
      ...last,
      time: now,
      selectionAfter: s.selection,
      closed: opts.final !== false,
    })
  } else {
    const entry: HistoryEntry = {
      id: nextEntryId--,
      label,
      patches: [],
      inverse: [],
      selectionBefore: s.selection,
      selectionAfter: s.selection,
      time: now,
      coalesceKey: opts.coalesceKey,
      closed: !opts.coalesceKey || opts.final !== false,
    }
    transitions.set(entry.id, { docId: s.meta.id, before, after: next })
    past = s.past.concat(entry)
    if (past.length > HISTORY_LIMIT) past = past.slice(past.length - HISTORY_LIMIT)
  }
  useDocument.setState({
    meta: { ...s.meta, dotLottie: next },
    past,
    future: [],
    revision: s.revision + 1,
  })
  return true
}

/**
 * Edits the document and the package as ONE undoable step: `recipe` runs through `updateDoc`,
 * then `nextPackage` (given the package before the edit) is attached to the recorded entry.
 * When the recipe changes nothing, the package change becomes a step of its own.
 */
export function commitDocAndPackage(
  label: string,
  recipe: (draft: Draft<Animation>) => void,
  nextPackage: (before: unknown) => unknown,
  opts: UpdateOptions = {},
): boolean {
  const start = useDocument.getState()
  if (!start.doc || !start.meta) return false
  const before = start.meta.dotLottie
  const changed = updateDoc(label, recipe, opts)
  const next = nextPackage(before)
  if (!changed) return next !== before ? commitPackage(label, next, opts) : false
  const s = useDocument.getState()
  const entry = s.past[s.past.length - 1]
  if (!s.meta || !entry || next === before) return true
  const previous = transitions.get(entry.id)
  transitions.set(entry.id, {
    docId: s.meta.id,
    before: previous ? previous.before : before,
    after: next,
  })
  useDocument.setState({ meta: { ...s.meta, dotLottie: next } })
  return true
}

/** Ids undone (most recent first) and redone (oldest first) between two history states. */
function historyMoves(
  prev: Pick<DocumentState, 'past' | 'future'>,
  next: Pick<DocumentState, 'past' | 'future'>,
): { undone: number[]; redone: number[] } {
  let k = 0
  while (k < prev.past.length && k < next.past.length && prev.past[k].id === next.past[k].id) k++
  const nextFuture = new Set(next.future.map((e) => e.id))
  const prevFuture = new Set(prev.future.map((e) => e.id))
  const undone = prev.past
    .slice(k)
    .map((e) => e.id)
    .filter((id) => nextFuture.has(id))
    .reverse()
  const redone = next.past
    .slice(k)
    .map((e) => e.id)
    .filter((id) => prevFuture.has(id))
  return { undone, redone }
}

/**
 * Keeps the package in step with undo and redo. Installed once by the feature's `register`;
 * returns the uninstall function.
 */
export function installPackageHistory(): () => void {
  return useDocument.subscribe((next, prev) => {
    if (next.meta?.id !== prev.meta?.id) {
      transitions.clear()
      return
    }
    if (transitions.size === 0 || (next.past === prev.past && next.future === prev.future)) return
    const { undone, redone } = historyMoves(prev, next)
    let target: { value: unknown } | null = null
    // Undone most recent first: the last one seen is the oldest, whose `before` is the state now.
    for (const id of undone) {
      const t = transitions.get(id)
      if (t) target = { value: t.before }
    }
    for (const id of redone) {
      const t = transitions.get(id)
      if (t) target = { value: t.after }
    }
    // Entries gone from both lists (history limit, a discarded redo branch) are settled.
    const alive = new Set<number>()
    for (const e of next.past) alive.add(e.id)
    for (const e of next.future) alive.add(e.id)
    for (const id of transitions.keys()) if (!alive.has(id)) transitions.delete(id)
    if (!target) return
    const docId = next.meta?.id
    const value = target.value
    // Deferred: a nested setState inside a store listener would hand the listeners after this
    // one a stale state.
    queueMicrotask(() => {
      const s = useDocument.getState()
      if (!s.meta || s.meta.id !== docId || s.meta.dotLottie === value) return
      useDocument.setState({ meta: { ...s.meta, dotLottie: value } })
    })
  })
}

/** Test helper: forgets every recorded package change. */
export function resetPackageHistory(): void {
  transitions.clear()
  nextEntryId = -1
}
