/**
 * Keys typed in the History list that the list does not use itself.
 *
 * The global shortcut handler ignores keys typed in listboxes, which it treats as modal UI (a
 * select's open dropdown). The History list is a listbox that is part of the workspace, so
 * those keys go to the handler as if typed outside of it: ⌘Z right after clicking a step
 * undoes, Space plays.
 */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { handleShortcut } from '@/commands/keyboard'

/** Runs the global shortcut for `e`, if any; the event is then consumed. */
export function forwardToShortcuts(e: ReactKeyboardEvent<HTMLElement>): void {
  const n = e.nativeEvent
  if (n.isComposing) return
  // A copy without a target: the handler then treats it like a key typed on the page itself.
  const copy = new KeyboardEvent('keydown', {
    key: n.key,
    code: n.code,
    metaKey: n.metaKey,
    ctrlKey: n.ctrlKey,
    altKey: n.altKey,
    shiftKey: n.shiftKey,
    repeat: n.repeat,
    cancelable: true,
  })
  if (!handleShortcut(copy)) return
  e.preventDefault()
  // Once is enough: shortcuts that are allowed in modal UI (⌘K) would otherwise run a second
  // time when the original event reaches the global handler on window.
  e.stopPropagation()
}
