import { Gauge, Paintbrush } from 'lucide-react'
import { useEffect } from 'react'
import { navigate, useRouter } from '@/app/router'
import { Kbd, MenuItem, Spinner } from '@/components/ui'
import {
  openRecent,
  openSample,
  RecentSection,
  SamplesSection,
  StartPage,
  useFreshRecents,
  useIo,
  useStartupSettled,
  type RecentEntry,
} from '@/features/io'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useDocument } from '@/store/document'
import { optimizeRecent, optimizeSample } from './actions'
import { CurrentDocument } from './CurrentDocument'
import { ServiceCards } from './ServiceCards'

const FORMATS = ['.json', '.lottie', '.tgs', '.zip']
const STEP_BACK = 'transition-opacity duration-150 ease-out'

/**
 * Without a hash the router shows home only while nothing is open, and the editor as soon as a
 * document is. Once startup is over (a restored session would have opened the editor), home gets
 * its own `#/` entry, so Back from a service returns here.
 */
function usePinnedHomeRoute(): void {
  const startup = useIo((s) => s.startup)
  useEffect(() => {
    if (startup === 'done' && useRouter.getState().hashRoute === null) {
      navigate('home', { replace: true })
    }
  }, [startup])
}

/** Accepted formats and the other ways in; while a file is being read, its progress instead. */
function FormatsHint() {
  const t = useT()
  const opening = useIo((s) => s.opening)
  if (opening) {
    return (
      <output className="mt-3 flex h-5 min-w-0 items-center gap-2 px-1 text-xs text-fg-muted">
        <Spinner size={12} />
        <span className="truncate">{t.io.welcome.opening(opening)}</span>
      </output>
    )
  }
  return (
    <p className="mt-3 flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs text-fg-subtle">
      {FORMATS.map((f) => (
        <code
          key={f}
          className="rounded-xs bg-surface-2 px-1 py-px font-mono text-2xs text-fg-muted"
        >
          {f}
        </code>
      ))}
      <span aria-hidden className="px-0.5">
        ·
      </span>
      <span>{t.home.hint}</span>
      <Kbd shortcut="mod+v" />
    </p>
  )
}

/** Home: the three services (each a drop target), the open animation, recent files and samples. */
export function HomePage() {
  const t = useT()
  const settled = useStartupSettled()
  const currentId = useDocument((s) => s.meta?.id)
  const dragging = useIo((s) => s.drag === 'open')
  useFreshRecents()
  usePinnedHomeRoute()

  if (!settled) return <div className="h-full" aria-busy />

  const recentMenu = (entry: RecentEntry) => (
    <>
      <MenuItem
        kind="context"
        icon={Paintbrush}
        onSelect={() => void openRecent(entry, 'customize')}
      >
        {t.home.menu.customize}
      </MenuItem>
      <MenuItem kind="context" icon={Gauge} onSelect={() => void optimizeRecent(entry)}>
        {t.home.menu.optimize}
      </MenuItem>
    </>
  )
  const sampleMenu = (id: string) => (
    <>
      <MenuItem kind="context" icon={Paintbrush} onSelect={() => void openSample(id, 'customize')}>
        {t.home.menu.customize}
      </MenuItem>
      <MenuItem kind="context" icon={Gauge} onSelect={() => void optimizeSample(id)}>
        {t.home.menu.optimize}
      </MenuItem>
    </>
  )

  return (
    <StartPage tagline={t.home.tagline} data-testid="home">
      {/* While files are dragged the cards are the drop targets: everything else steps back. */}
      <div className={cn(STEP_BACK, dragging && 'opacity-40')}>
        <CurrentDocument />
      </div>
      <ServiceCards />
      <FormatsHint />

      <div className={cn(STEP_BACK, dragging && 'opacity-40')}>
        <RecentSection
          className="mt-10"
          excludeId={currentId}
          route="edit"
          menuItems={recentMenu}
        />
        <SamplesSection
          className="mt-10"
          onOpen={(id) => void openSample(id, 'edit')}
          menuItems={sampleMenu}
        />
      </div>
    </StartPage>
  )
}
