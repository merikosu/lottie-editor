/**
 * State of the document operations feature:
 *  - remembered options (resize mode, aspect lock, fit padding, …) persisted per browser;
 *  - the speed ledger: the "Speed" field shows the playback speed relative to the file as it
 *    was opened. The file has no speed property, so every speed change records its factor
 *    against its history entry; undo/redo then show the right value automatically;
 *  - the last result message and busy state (transient).
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Anchor, ResizeMode } from '@/lottie/canvas'
import { useDocument, type DocumentState } from '@/store/document'
import { setFrame, setWorkArea, usePlayback, type WorkArea } from '@/store/playback'

/* -------------------------------------------------------------------------- */
/*                                 Preferences                                */
/* -------------------------------------------------------------------------- */

export interface DocopsPrefs {
  resizeMode: ResizeMode
  anchor: Anchor
  keepAspect: boolean
  keepDuration: boolean
  fitPadding: number
  fitIncludeOffCanvas: boolean
  pauseSeconds: number
}

export const useDocopsPrefs = create<DocopsPrefs>()(
  persist(
    (): DocopsPrefs => ({
      resizeMode: 'scale',
      anchor: 'center',
      keepAspect: true,
      keepDuration: true,
      fitPadding: 0,
      fitIncludeOffCanvas: false,
      pauseSeconds: 0.5,
    }),
    { name: 'lottie-editor:docops', version: 1 },
  ),
)

export function setDocopsPrefs(patch: Partial<DocopsPrefs>): void {
  useDocopsPrefs.setState(patch)
}

/* -------------------------------------------------------------------------- */
/*                                   Results                                  */
/* -------------------------------------------------------------------------- */

export type ResultScope = 'canvas' | 'timing'

export interface ResultMessage {
  id: number
  scope: ResultScope
  text: string
  tone: 'done' | 'info' | 'warning'
}

interface TransientState {
  result: ResultMessage | null
  /** Operation measuring the content (fit to content can take a moment on big files). */
  busy: 'fit' | null
  /** Bumped when the speed ledger changes (the ledger itself is not React state). */
  ledgerVersion: number
}

export const useDocopsState = create<TransientState>()(() => ({
  result: null,
  busy: null,
  ledgerVersion: 0,
}))

let resultId = 0

/** Shows a short inline result in the section of `scope` (replaces toasts for routine edits). */
export function showResult(
  scope: ResultScope,
  text: string,
  tone: ResultMessage['tone'] = 'done',
): void {
  useDocopsState.setState({ result: { id: ++resultId, scope, text, tone } })
}

export function clearResult(id: number): void {
  useDocopsState.setState((s) => (s.result?.id === id ? { result: null } : {}))
}

export function setBusy(busy: TransientState['busy']): void {
  useDocopsState.setState({ busy })
}

/* -------------------------------------------------------------------------- */
/*                                Speed ledger                                */
/* -------------------------------------------------------------------------- */

/** Speed multiplier recorded per history entry id (2 = twice as fast). */
const factors = new Map<number, number>()
/** Factors of entries that fell off the history limit: permanent, can no longer be undone. */
let settled = 1

function bumpLedger(): void {
  useDocopsState.setState((s) => ({ ledgerVersion: s.ledgerVersion + 1 }))
}

/** Records that the edit just committed changed the speed by `multiplier`. */
export function recordSpeedChange(multiplier: number): void {
  if (!(multiplier > 0) || !Number.isFinite(multiplier) || Math.abs(multiplier - 1) < 1e-9) return
  const entry = useDocument.getState().past.at(-1)
  if (!entry) return
  factors.set(entry.id, (factors.get(entry.id) ?? 1) * multiplier)
  bumpLedger()
}

/** Playback speed relative to the document as it was opened (1 = unchanged). */
export function speedOf(state: Pick<DocumentState, 'past'> = useDocument.getState()): number {
  let speed = settled
  for (const entry of state.past) {
    const f = factors.get(entry.id)
    if (f) speed *= f
  }
  return speed
}

/** Reactive speed: re-renders only when the value changes (history or ledger updates). */
export function useSpeed(): number {
  // The ledger is not store state: subscribing to its version re-runs the selector below.
  useDocopsState((s) => s.ledgerVersion)
  return useDocument((s) => speedOf(s))
}

function ids(entries: DocumentState['past']): Set<number> {
  return new Set(entries.map((e) => e.id))
}

/** Keeps the ledger in sync with the history; returns an unsubscribe function. */
export function trackSpeedLedger(): () => void {
  return useDocument.subscribe((next, prev) => {
    if (next.meta?.id !== prev.meta?.id) {
      if (factors.size || settled !== 1) {
        factors.clear()
        settled = 1
        bumpLedger()
      }
      return
    }
    if (next.past === prev.past && next.future === prev.future) return
    if (factors.size === 0) return
    const inPast = ids(next.past)
    const inFuture = ids(next.future)
    const wasPast = ids(prev.past)
    let changed = false
    for (const [id, factor] of factors) {
      if (inPast.has(id) || inFuture.has(id)) continue
      // Gone from both lists: dropped by the history limit (still applied) or a redo branch
      // that was discarded by a new edit (never applied).
      if (wasPast.has(id)) settled *= factor
      factors.delete(id)
      changed = true
    }
    if (changed) bumpLedger()
  })
}

/* -------------------------------------------------------------------------- */
/*                     Time edits: the playhead follows them                  */
/* -------------------------------------------------------------------------- */

/** A time edit moves every frame f of the document to a · f + b (a < 0 reverses it). */
export interface TimeMap {
  a: number
  b: number
}

/** Where the playhead and work area are. */
export interface PlaybackPlace {
  frame: number
  workArea: WorkArea | null
}

interface TimeEdit extends TimeMap {
  /** Places just before and just after the edit: restored exactly when nothing moved since. */
  before: PlaybackPlace
  after: PlaybackPlace
  /** The edit used up the work area (trim to work area): undo brings it back. */
  consumesWorkArea: boolean
}

function invert(map: TimeMap): TimeMap {
  return { a: 1 / map.a, b: -map.b / map.a }
}

function mapPlace(map: TimeMap, place: PlaybackPlace, consumesWorkArea = false): PlaybackPlace {
  const at = (f: number) => map.a * f + map.b
  const wa = place.workArea
  const a = wa ? at(wa.start) : 0
  const b = wa ? at(wa.end) : 0
  return {
    frame: at(place.frame),
    workArea: wa && !consumesWorkArea ? { start: Math.min(a, b), end: Math.max(a, b) } : null,
  }
}

function samePlace(a: PlaybackPlace, b: PlaybackPlace): boolean {
  if (Math.abs(a.frame - b.frame) > 1e-6) return false
  if (!a.workArea || !b.workArea) return a.workArea === b.workArea
  return a.workArea.start === b.workArea.start && a.workArea.end === b.workArea.end
}

/** Applies a place within the document range: whole frames, a work area inside the range. */
function applyPlace(place: PlaybackPlace): void {
  const doc = useDocument.getState().doc
  if (!doc) return
  const wa = place.workArea
  if (wa) {
    const start = Math.max(Math.ceil(doc.ip), Math.round(wa.start))
    const end = Math.min(Math.ceil(doc.op), Math.round(wa.end))
    setWorkArea(end > start ? { start, end } : null)
  } else {
    setWorkArea(null)
  }
  setFrame(place.frame, { keepPlaying: usePlayback.getState().playing })
}

function playbackNow(): PlaybackPlace {
  const { frame, workArea } = usePlayback.getState()
  return { frame, workArea }
}

/** Time edits by history entry id. */
const timeEdits = new Map<number, TimeEdit>()

/**
 * After a time edit was committed: moves the playhead and work area from `before` (read
 * before the edit) to the same moment of the animation, and remembers it so undo and redo
 * take them back and forth with the document. Updates merged into one history entry (a
 * gesture) compose.
 */
export function followTimeEdit(
  before: PlaybackPlace,
  map: TimeMap,
  opts: { consumesWorkArea?: boolean } = {},
): void {
  if (!Number.isFinite(map.a) || !Number.isFinite(map.b) || map.a === 0) return
  const consumesWorkArea = !!opts.consumesWorkArea
  applyPlace(mapPlace(map, before, consumesWorkArea))
  const entry = useDocument.getState().past.at(-1)
  if (!entry) return
  const after = playbackNow()
  const prev = timeEdits.get(entry.id)
  timeEdits.set(
    entry.id,
    prev
      ? {
          a: map.a * prev.a,
          b: map.a * prev.b + map.b,
          before: prev.before,
          after,
          consumesWorkArea: prev.consumesWorkArea || consumesWorkArea,
        }
      : { ...map, before, after, consumesWorkArea },
  )
}

function undoPlace(place: PlaybackPlace, edit: TimeEdit): PlaybackPlace {
  if (samePlace(place, edit.after)) return edit.before
  const moved = mapPlace(invert(edit), place)
  // A trim used the work area up: bring it back unless another one was set meanwhile.
  if (edit.consumesWorkArea && !moved.workArea) moved.workArea = edit.before.workArea
  return moved
}

function redoPlace(place: PlaybackPlace, edit: TimeEdit): PlaybackPlace {
  if (samePlace(place, edit.before)) return edit.after
  return mapPlace(edit, place, edit.consumesWorkArea)
}

/**
 * Follows undo and redo of the recorded time edits; returns an unsubscribe function. The
 * playback store clamps the playhead to a shrinking range before this runs, so the place is
 * read from the last playback state of the previous document revision.
 */
export function trackTimeEdits(): () => void {
  let latest: PlaybackPlace & { revision: number } = { ...playbackNow(), revision: -1 }
  let older = latest
  const offPlayback = usePlayback.subscribe((state, prev) => {
    if (state.frame === prev.frame && state.workArea === prev.workArea) return
    const revision = useDocument.getState().revision
    if (latest.revision !== revision) older = latest
    latest = { frame: state.frame, workArea: state.workArea, revision }
  })
  const offDocument = useDocument.subscribe((next, prev) => {
    if (next.meta?.id !== prev.meta?.id) {
      timeEdits.clear()
      return
    }
    if (next.past === prev.past && next.future === prev.future) return
    if (timeEdits.size > 0) {
      const moves = historyMoves(prev, next)
      const from =
        latest.revision < next.revision
          ? latest
          : older.revision < next.revision
            ? older
            : playbackNow()
      let place: PlaybackPlace = { frame: from.frame, workArea: from.workArea }
      let moved = false
      for (const id of moves.undone) {
        const edit = timeEdits.get(id)
        if (!edit) continue
        place = undoPlace(place, edit)
        moved = true
      }
      for (const id of moves.redone) {
        const edit = timeEdits.get(id)
        if (!edit) continue
        place = redoPlace(place, edit)
        moved = true
      }
      if (moved) applyPlace(place)
      for (const id of timeEdits.keys()) {
        if (!moves.kept.has(id)) timeEdits.delete(id)
      }
    }
    latest = { ...playbackNow(), revision: next.revision }
    older = latest
  })
  return () => {
    offPlayback()
    offDocument()
  }
}

/** Entries undone (most recent first) and redone (oldest first) between two history states. */
function historyMoves(
  prev: Pick<DocumentState, 'past' | 'future'>,
  next: Pick<DocumentState, 'past' | 'future'>,
): { undone: number[]; redone: number[]; kept: Set<number> } {
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
  const kept = new Set([...next.past, ...next.future].map((e) => e.id))
  return { undone, redone, kept }
}
