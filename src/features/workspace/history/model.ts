/**
 * History panel model: the initial state followed by every undo step, with the position of
 * the current state. Row `index` is the argument for `jumpToHistory` (the number of steps of
 * `past` to keep), so row 0 is the state the document was opened in.
 */

export interface HistoryStep {
  id: number
  label: string
  time: number
}

export type HistoryRowState = 'past' | 'current' | 'future'

export interface HistoryRow {
  /** jumpToHistory() target. */
  index: number
  /** Stable React key. */
  key: string
  label: string
  time: number
  state: HistoryRowState
  initial: boolean
}

export interface InitialState {
  label: string
  time: number
}

function stateOf(index: number, current: number): HistoryRowState {
  return index < current ? 'past' : index === current ? 'current' : 'future'
}

/** Rows for `past` (applied steps, oldest first) and `future` (undone steps, next first). */
export function buildHistoryRows(
  past: readonly HistoryStep[],
  future: readonly HistoryStep[],
  initial: InitialState,
): HistoryRow[] {
  const current = past.length
  const rows: HistoryRow[] = [
    {
      index: 0,
      key: 'initial',
      label: initial.label,
      time: initial.time,
      state: stateOf(0, current),
      initial: true,
    },
  ]
  const steps = past.concat(future)
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const index = i + 1
    rows.push({
      index,
      key: `step-${step.id}`,
      label: step.label,
      time: step.time,
      state: stateOf(index, current),
      initial: false,
    })
  }
  return rows
}

/* -------------------------------------------------------------------------- */
/*                             Truncated history                              */
/* -------------------------------------------------------------------------- */

/**
 * The document store keeps a limited number of steps and drops the oldest one when a new
 * step exceeds the limit. After that, the first row is no longer the opened file but "earlier
 * changes". A drop is detected as the first step changing while steps are only appended,
 * undone or redone at the end otherwise.
 */
export interface BaseTracker {
  /** Identifies one opened document (id + load time). */
  docKey: string | null
  firstId: number | null
  truncated: boolean
}

export const INITIAL_TRACKER: BaseTracker = { docKey: null, firstId: null, truncated: false }

export function trackBase(
  prev: BaseTracker,
  docKey: string | null,
  past: readonly { id: number }[],
): BaseTracker {
  const firstId = past.length ? past[0].id : null
  if (docKey !== prev.docKey) return { docKey, firstId, truncated: false }
  if (firstId === prev.firstId) return prev
  // A different oldest step while both lists are non-empty: the old one was dropped.
  const dropped = prev.firstId !== null && firstId !== null
  return { docKey, firstId, truncated: prev.truncated || dropped }
}
