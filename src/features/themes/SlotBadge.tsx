/**
 * Marks a property bound to a theme color in a property row (the inspector mounts it next to the
 * label): editing the property changes every use of the theme color. Click: the Themes section.
 */
import { SwatchBook } from 'lucide-react'
import { IconButton } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { getAt, type NodePath } from '@/lottie/path'
import { useDocument } from '@/store/document'
import { revealThemesSection } from './actions'

export function SlotBadge({ path, className }: { path: NodePath; className?: string }) {
  const t = useT()
  const sid = useDocument((s) => {
    const node = s.doc ? getAt<{ sid?: unknown }>(s.doc, path) : undefined
    return typeof node?.sid === 'string' && node.sid ? node.sid : null
  })
  if (!sid) return null
  return (
    <IconButton
      icon={SwatchBook}
      size="xs"
      label={t.themes.badge(sid)}
      tooltipSide="left"
      className={cn('text-accent-text hover:text-accent-text', className)}
      onClick={revealThemesSection}
      data-testid="themes-slot-badge"
    />
  )
}
