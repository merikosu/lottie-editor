import { useEffect, useState } from 'react'

/**
 * `value`, but only once it has stayed true for `delay` ms: progress indicators for work that
 * usually finishes sooner never flash.
 */
export function useDelayed(value: boolean, delay: number): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!value) return
    const timer = setTimeout(() => setShown(true), delay)
    return () => {
      clearTimeout(timer)
      setShown(false)
    }
  }, [value, delay])
  return value && shown
}
