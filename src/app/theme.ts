import { useEffect } from 'react'
import { usePrefs, type ThemePref } from '@/store/prefs'

export function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  if (pref !== 'system') return pref
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/**
 * The browser (and the installed app's title bar) takes its color from `<meta name="theme-color">`:
 * keep it the color of the top bar in the current theme.
 */
function syncThemeColor(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  const color = getComputedStyle(document.documentElement).getPropertyValue('--le-surface-1').trim()
  if (meta && color) meta.content = color
}

/** Applies the theme (data-theme on <html>) and follows the OS when set to "system". */
export function useThemeEffect(): void {
  const pref = usePrefs((s) => s.theme)
  const language = usePrefs((s) => s.language)

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(pref)
      syncThemeColor()
    }
    apply()
    if (pref !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [pref])

  useEffect(() => {
    document.documentElement.lang = language
  }, [language])
}
