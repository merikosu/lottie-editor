import type { ReactNode } from 'react'
import { useT } from '@/i18n'
import { SampleGrid } from './SampleGrid'

/** Id of the samples section of the start pages (the "Samples…" command scrolls to it). */
export const SAMPLES_SECTION_ID = 'le-samples'

/** "Samples" section of the start pages: the sample cards under a heading. */
export function SamplesSection({
  onOpen,
  menuItems,
  className,
}: {
  onOpen: (id: string) => void
  /** Extra context menu items for a card. */
  menuItems?: (id: string) => ReactNode
  className?: string
}) {
  const t = useT()
  return (
    <section id={SAMPLES_SECTION_ID} aria-labelledby="le-samples-title" className={className}>
      <div className="mb-3 flex items-baseline gap-2 px-2">
        <h2 id="le-samples-title" className="shrink-0 text-sm font-semibold text-fg">
          {t.io.welcome.samples}
        </h2>
        <span className="truncate text-xs text-fg-subtle">{t.io.welcome.samplesHint}</span>
      </div>
      <SampleGrid onOpen={onOpen} menuItems={menuItems} />
    </section>
  )
}
