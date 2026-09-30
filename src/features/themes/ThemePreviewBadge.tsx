/**
 * Small canvas overlay while a theme is previewed ("Theme: Dark ×"), so a themed canvas is never
 * mistaken for the document's own colors. The viewport mounts it (see index.ts).
 */
import { SwatchBook, X } from 'lucide-react'
import { IconButton } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { revealThemesSection, selectTheme } from './actions'
import { useActiveThemeName } from './preview'

export function ThemePreviewBadge({ className }: { className?: string }) {
  const t = useT()
  const name = useActiveThemeName()
  if (!name) return null
  return (
    <div
      className={cn(
        'pointer-events-auto flex h-7 max-w-[240px] animate-fade-in items-center gap-1 rounded-md bg-surface-3 pr-0.5 pl-2 text-xs text-fg shadow-popover',
        className,
      )}
      data-testid="themes-preview-badge"
    >
      <button
        type="button"
        onClick={revealThemesSection}
        className="flex min-w-0 items-center gap-1.5 rounded-xs hover:text-fg"
        aria-label={t.themes.preview.reveal}
      >
        <SwatchBook size={14} className="shrink-0 text-fg-muted" />
        <span className="truncate">{t.themes.preview.badge(name)}</span>
      </button>
      <IconButton
        icon={X}
        size="xs"
        label={t.themes.preview.stop}
        tooltipSide="bottom"
        onClick={() => selectTheme(null)}
      />
    </div>
  )
}
