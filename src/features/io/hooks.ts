import { useEffect, useState } from 'react'
import { refreshRecents } from './session'
import { useIo } from './store'

/** Longest wait for the startup restore before the start pages show anyway (storage may hang). */
const STARTUP_WAIT_MS = 1200

/**
 * False while the last session (or a `?sample=`/`?url=` document) is being opened on startup:
 * the start pages render nothing meanwhile instead of flashing for a few frames before the
 * editor appears.
 */
export function useStartupSettled(): boolean {
  const startup = useIo((s) => s.startup)
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), STARTUP_WAIT_MS)
    return () => clearTimeout(timer)
  }, [])
  return startup === 'done' || waited
}

/** Keeps the recent files list fresh while a start page is shown (another tab may change it). */
export function useFreshRecents(): void {
  useEffect(() => {
    void refreshRecents()
    const onFocus = () => void refreshRecents()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
}
