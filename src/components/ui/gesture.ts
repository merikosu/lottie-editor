import { uid } from '@/lib/id'

/**
 * Describes one change coming from an editing control.
 * - `key` is stable for the whole gesture (a scrub, a picker drag, repeated arrow nudges),
 *   so pass it as `coalesceKey` to updateDoc() to get ONE undo step per gesture.
 * - `final` is true for the last change of the gesture (pointer up, Enter, blur).
 */
export interface ChangeGesture {
  key: string
  final: boolean
}

export function newGesture(prefix = 'g'): ChangeGesture {
  return { key: uid(prefix), final: true }
}
