import { useCallback, useEffect, useRef, type RefObject } from 'react'

/**
 * Initial focus of a dialog: its first field, selected so a value can be typed right away
 * (Radix would focus the close button). Pass `onOpenAutoFocus` to the Dialog and put `ref` on
 * the element holding the fields.
 */
export function useInitialFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const onOpenAutoFocus = useCallback((e: Event) => {
    const input = ref.current?.querySelector('input')
    if (!input) return
    e.preventDefault()
    input.focus()
    input.select()
  }, [])
  return { ref, onOpenAutoFocus }
}

/**
 * Enter (or ⌘/Ctrl+Enter with `requireMod`) inside `container` confirms a dialog. It fires on
 * key up, after fields have committed their value on key down, and only for a key press that
 * started inside the dialog (not the Enter that opened it).
 */
export function useConfirmKey(
  container: RefObject<HTMLElement | null>,
  onConfirm: () => void,
  requireMod = false,
): void {
  const latest = useRef(onConfirm)
  useEffect(() => {
    latest.current = onConfirm
  })
  useEffect(() => {
    let armed = false
    const inside = (e: KeyboardEvent) =>
      e.target instanceof Node && !!container.current?.contains(e.target)
    const down = (e: KeyboardEvent) => {
      armed =
        e.key === 'Enter' && !e.isComposing && inside(e) && (!requireMod || e.metaKey || e.ctrlKey)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !armed) return
      armed = false
      if (inside(e)) latest.current()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [container, requireMod])
}

/**
 * Escape inside `container` runs `onCancel` while `enabled`. It runs after the focused control
 * has handled the key (a field being typed in reverts and blurs first), without a key handler
 * on the container itself.
 */
export function useCancelKey(
  container: RefObject<HTMLElement | null>,
  onCancel: () => void,
  enabled = true,
): void {
  const latest = useRef(onCancel)
  useEffect(() => {
    latest.current = onCancel
  })
  useEffect(() => {
    if (!enabled) return
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return
      if (e.target instanceof Node && container.current?.contains(e.target)) latest.current()
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [container, enabled])
}
