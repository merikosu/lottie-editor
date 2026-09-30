/**
 * Space bar over the canvas (Figma / Rive convention):
 *  - hold Space + drag → pan (hand cursor)
 *  - tap Space (no drag, released within 500 ms) → play / pause
 * Elsewhere Space keeps its global meaning (the `playback.toggle` shortcut). The listener runs
 * in the capture phase on window so it sees the key before the global shortcut handler.
 */
import { runCommand } from '@/commands/registry'
import { isEditableTarget } from '@/lib/platform'

type Listener = (held: boolean) => void

/** A press longer than this without dragging is an aborted pan, not a play/pause tap. */
const TAP_MS = 500

let pointerOver = false
let held = false
let usedForPan = false
let pressedAt = 0
let installs = 0
const listeners = new Set<Listener>()

function notify() {
  for (const l of listeners) l(held)
}

function inOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper] [role="listbox"], [cmdk-root]',
    )
  )
}

function onKeyDown(e: KeyboardEvent) {
  if (e.code !== 'Space') return
  if (held) {
    // Swallow auto-repeat while the hand tool is active.
    e.preventDefault()
    e.stopPropagation()
    return
  }
  if (!pointerOver || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
  if (isEditableTarget(e.target) || inOverlay(e.target)) return
  e.preventDefault()
  e.stopPropagation()
  held = true
  usedForPan = false
  pressedAt = performance.now()
  notify()
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code !== 'Space' || !held) return
  e.preventDefault()
  e.stopPropagation()
  held = false
  notify()
  if (!usedForPan && performance.now() - pressedAt < TAP_MS) runCommand('playback.toggle')
}

function onBlur() {
  if (!held) return
  held = false
  notify()
}

/** Installs the window listeners (reference counted); returns the uninstall function. */
export function installSpacePan(): () => void {
  if (installs++ === 0) {
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
  }
  return () => {
    if (--installs > 0) return
    window.removeEventListener('keydown', onKeyDown, true)
    window.removeEventListener('keyup', onKeyUp, true)
    window.removeEventListener('blur', onBlur)
    held = false
    pointerOver = false
  }
}

export function setPointerOverViewport(over: boolean): void {
  pointerOver = over
}

export function isSpaceHeld(): boolean {
  return held
}

/** A drag happened while Space was held: releasing it must not toggle playback. */
export function markSpacePanUsed(): void {
  if (held) usedForPan = true
}

export function subscribeSpace(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
