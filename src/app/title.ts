/**
 * The browser tab: its title names the open file on the pages that show it ("intro.json —
 * Lottie Editor"), so several tabs stay tellable apart, and the page's theme color follows the
 * UI theme (the browser chrome around the tab on mobile and in installed apps).
 */
import { useEffect } from 'react'
import { useT, type Dict } from '@/i18n'
import { useDocument } from '@/store/document'
import { usePrefs } from '@/store/prefs'
import { useRoute, type Route } from './router'
import { resolveTheme } from './theme'

/** Tab title for a page (and the open file's name, when there is one). */
export function pageTitle(route: Route, fileName: string | null, t: Dict): string {
  const app = t.app.name
  if ((route === 'edit' || route === 'customize') && fileName) return `${fileName} — ${app}`
  if (route === 'customize') return `${t.app.services.customize} — ${app}`
  if (route === 'optimize') return `${t.app.services.optimize} — ${app}`
  return app
}

/** Top bar color of each theme (--le-surface-1). */
const THEME_COLORS = { dark: '#16171a', light: '#ffffff' } as const

export function useTabTitle(): void {
  const t = useT()
  const route = useRoute()
  const fileName = useDocument((s) => (s.doc ? (s.meta?.fileName ?? null) : null))
  const theme = usePrefs((s) => s.theme)

  useEffect(() => {
    document.title = pageTitle(route, fileName, t)
  }, [route, fileName, t])

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!meta) return
    const apply = () => (meta.content = THEME_COLORS[resolveTheme(theme)])
    apply()
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}
