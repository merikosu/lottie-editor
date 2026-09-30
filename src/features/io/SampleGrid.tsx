import { FolderOpen } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger, MenuItem } from '@/components/ui'
import { useLanguage, useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { SAMPLES } from '@/samples'
import { LottiePreview } from './LottiePreview'
import { formatDuration } from './format'
import { TruncatedText } from './TruncatedText'

/** Card grid of the built-in samples with live previews that play while hovered or focused. */
export function SampleGrid({
  onOpen,
  menuItems,
  className,
  autoFocus,
}: {
  onOpen: (id: string) => void
  /**
   * Extra context menu items for a card (e.g. "Open in Customize" on the home page). Without
   * them the cards have no context menu.
   */
  menuItems?: (id: string) => ReactNode
  className?: string
  /** Focus the first card (in the samples dialog, rather than its close button). */
  autoFocus?: boolean
}) {
  const t = useT()
  const language = useLanguage()
  const [active, setActive] = useState<string | null>(null)
  const names = t.io.samples.names as Record<string, string>
  const features = t.io.samples.features as Record<string, string>
  const leave = (id: string) => setActive((current) => (current === id ? null : current))

  return (
    <ul className={cn('grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-3', className)}>
      {SAMPLES.map((sample, index) => {
        const name = names[sample.id] ?? sample.name
        const duration = `${formatDuration(sample.frames, sample.fps, language)} ${t.common.secondsShort}`
        const card = (
          <button
            type="button"
            data-testid={`sample-${sample.id}`}
            autoFocus={autoFocus && index === 0}
            onClick={() => onOpen(sample.id)}
            onPointerEnter={() => setActive(sample.id)}
            onPointerLeave={() => leave(sample.id)}
            // Keyboard focus previews like hover does; a focused card after a click stays still.
            onFocus={(e) => e.currentTarget.matches(':focus-visible') && setActive(sample.id)}
            onBlur={() => leave(sample.id)}
            className={cn(
              'group flex h-full w-full flex-col overflow-hidden rounded-lg bg-surface-1 text-left',
              // A real border: an inset shadow would be painted over by the preview.
              'border border-line transition-colors duration-100',
              'hover:border-line-strong focus-visible:outline-offset-1',
              'data-[state=open]:border-line-strong',
            )}
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-2">
              <LottiePreview
                source={sample.load}
                poster={sample.poster}
                playing={active === sample.id}
                className="absolute inset-[9%]"
              />
            </div>
            <div className="flex min-w-0 flex-col px-2.5 pt-2 pb-2.5">
              <TruncatedText text={name} className="text-sm font-medium text-fg" />
              <span className="mt-0.5 truncate text-xs text-fg-subtle tabular-nums">
                {sample.width} × {sample.height} · {duration}
              </span>
              <TruncatedText text={features[sample.id] ?? ''} className="text-xs text-fg-subtle" />
            </div>
          </button>
        )
        return (
          <li key={sample.id} className="min-w-0">
            {menuItems ? (
              <ContextMenu>
                <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
                <ContextMenuContent>
                  <MenuItem kind="context" icon={FolderOpen} onSelect={() => onOpen(sample.id)}>
                    {t.io.recent.open}
                  </MenuItem>
                  {menuItems(sample.id)}
                </ContextMenuContent>
              </ContextMenu>
            ) : (
              card
            )}
          </li>
        )
      })}
    </ul>
  )
}
