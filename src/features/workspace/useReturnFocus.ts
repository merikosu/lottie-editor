import { useEffect, useState } from 'react'

/**
 * Returns keyboard focus to where it was when a dialog opened (a tree row, a field) once the
 * dialog closes. App dialogs open through `openDialog`, without a Radix `Dialog.Trigger`, so
 * Radix itself leaves focus on <body> when they close. Focus is only moved back if nothing
 * else has taken it meanwhile (another dialog, a page switch).
 */
export function useReturnFocus(): void {
  // The first render happens before the dialog moves focus into itself.
  const [origin] = useState(() => {
    const el = document.activeElement
    return el instanceof HTMLElement && el !== document.body ? el : null
  })
  useEffect(
    () => () => {
      // Radix finishes its own close handling in a zero-delay timer too; either order works.
      window.setTimeout(() => {
        const active = document.activeElement
        if (origin?.isConnected && (active === null || active === document.body))
          origin.focus({ preventScroll: true })
      }, 0)
    },
    [origin],
  )
}
