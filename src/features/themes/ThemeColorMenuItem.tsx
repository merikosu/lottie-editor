/**
 * "Make a theme color" for the Colors panel's context menu: binds the static color properties
 * of a palette color to a new theme color, or shows the theme color it already is.
 */
import { SwatchBook } from 'lucide-react'
import { MenuItem, type MenuKind } from '@/components/ui'
import { useT } from '@/i18n'
import { extractColorUsages, type ColorUsage } from '@/lottie/colors'
import { planColorBinding } from '@/lottie/slots'
import { getDoc } from '@/store/document'
import { makeThemeColor, revealThemesSection } from './actions'

/** The same usages read from the current document (a list may hold older ones). */
function latest(usages: readonly ColorUsage[]): ColorUsage[] {
  const doc = getDoc()
  if (!doc) return []
  const ids = new Set(usages.map((u) => u.id))
  return extractColorUsages(doc).filter((u) => ids.has(u.id))
}

export function ThemeColorMenuItem({
  usages,
  kind = 'context',
}: {
  usages: readonly ColorUsage[]
  kind?: MenuKind
}) {
  const t = useT()
  // Menus render their content when they open: the plan is current.
  const doc = getDoc()
  const plan = doc ? planColorBinding(doc, latest(usages)) : null
  if (plan?.allBound) {
    return (
      <MenuItem kind={kind} icon={SwatchBook} onSelect={revealThemesSection}>
        {t.themes.bind.bound(plan.boundTo[0])}
      </MenuItem>
    )
  }
  return (
    <MenuItem
      kind={kind}
      icon={SwatchBook}
      disabled={!plan || plan.paths.length === 0}
      onSelect={() => makeThemeColor(latest(usages))}
    >
      {t.themes.bind.make}
    </MenuItem>
  )
}
