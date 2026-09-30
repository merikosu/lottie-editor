import {
  FilePlus2,
  FolderOpen,
  Gauge,
  Link2,
  Paintbrush,
  PenTool,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { primaryShortcut, useCommand } from '@/commands/registry'
import { formatShortcut } from '@/commands/shortcuts'
import { Button, IconButton, Kbd } from '@/components/ui'
import { collectFiles, IO_DIALOG, pickFiles, showOpenUrl, useIo } from '@/features/io'
import { useT, type Dict } from '@/i18n'
import { cn } from '@/lib/cn'
import { useDocument } from '@/store/document'
import { openDialog } from '@/store/ui'
import { openInService, type ServiceRoute } from './actions'

/** Same icons as the service switcher in the top bar. */
const SERVICES: { route: ServiceRoute; icon: LucideIcon }[] = [
  { route: 'edit', icon: PenTool },
  { route: 'customize', icon: Paintbrush },
  { route: 'optimize', icon: Gauge },
]

/** Commands that switch to each service (their shortcuts are shown on the cards). */
const SERVICE_COMMANDS: Record<ServiceRoute, string> = {
  edit: 'app.edit',
  customize: 'app.customize',
  optimize: 'app.optimize',
}

/** Where a drop outside the cards goes (the page-wide drop opens files in the editor). */
const DEFAULT_ZONE: ServiceRoute = 'edit'

type CardState = 'idle' | 'zone' | 'target'

function serviceTitle(route: ServiceRoute, t: Dict): string {
  return route === 'edit'
    ? t.app.services.edit
    : route === 'customize'
      ? t.app.services.customize
      : t.app.services.optimize
}

/** The service card an event happened on, if any. */
function zoneOf(e: DragEvent): ServiceRoute | null {
  const card = e.target instanceof Element ? e.target.closest('[data-drop-zone]') : null
  return (card?.getAttribute('data-drop-zone') as ServiceRoute | null | undefined) ?? null
}

/**
 * Tracks the card under the pointer while files are dragged over the window (null elsewhere, so
 * leaving a card for the page margins is noticed too) and takes drops of animation files on a
 * card. The zone follows dragenter as well as dragover, so it changes in the same event as the
 * drag state and a stale zone never shows. The window listens to drops in the capture phase,
 * before the window-wide drop handler (FileDropOverlay), which then leaves a handled drop alone;
 * drops elsewhere open in the editor as usual.
 */
function useCardDrops(): ServiceRoute | null {
  const active = useIo((s) => s.drag === 'open')
  const [zone, setZone] = useState<ServiceRoute | null>(null)
  useEffect(() => {
    const track = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) setZone(zoneOf(e))
    }
    const onDrop = (e: DragEvent) => {
      const route = zoneOf(e)
      if (!route || !e.dataTransfer || e.defaultPrevented) return
      if (useIo.getState().drag !== 'open') return
      e.preventDefault()
      void collectFiles(e.dataTransfer).then((files) => {
        if (files.length) void openInService(route, files)
      })
    }
    window.addEventListener('dragenter', track)
    window.addEventListener('dragover', track)
    window.addEventListener('drop', onDrop, true)
    return () => {
      window.removeEventListener('dragenter', track)
      window.removeEventListener('dragover', track)
      window.removeEventListener('drop', onDrop, true)
    }
  }, [])
  return active ? zone : null
}

function ServiceCard({
  route,
  icon: Icon,
  state,
  actions,
  dropHint,
}: {
  route: ServiceRoute
  icon: LucideIcon
  state: CardState
  actions: ReactNode
  dropHint: string
}) {
  const t = useT()
  const shortcut = primaryShortcut(useCommand(SERVICE_COMMANDS[route]))
  const copy = t.home.services[route]
  const titleId = `le-home-${route}-title`
  const dragging = state !== 'idle'
  const target = state === 'target'

  return (
    <section
      aria-labelledby={titleId}
      data-drop-zone={route}
      data-state={state}
      data-testid={`service-${route}`}
      className={cn(
        'relative grid min-w-0 overflow-hidden rounded-lg border bg-surface-1 p-4',
        'transition-[border-color] duration-150 ease-out',
        state === 'idle' ? 'border-line' : 'border-dashed',
        state === 'zone' && 'border-line-strong',
        target && 'border-accent',
      )}
    >
      {/* An accent tint over the card surface (rather than instead of it): same in both themes. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-0 bg-accent/[0.07] opacity-0',
          'transition-opacity duration-150 ease-out',
          target && 'opacity-100',
        )}
      />
      {/* The card keeps its size while it shows the drop label: both layers share one cell. */}
      <div
        className={cn(
          'relative flex min-w-0 flex-col transition-opacity duration-150 ease-out [grid-area:1/1]',
          dragging && 'opacity-0',
        )}
        aria-hidden={dragging || undefined}
      >
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg-muted shadow-[inset_0_0_0_1px_var(--le-line)]">
            <Icon size={16} />
          </span>
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            {serviceTitle(route, t)}
          </h2>
          {/* The shortcut that opens the service from anywhere (⌥1…⌥3). */}
          {shortcut && <Kbd shortcut={shortcut} className="shrink-0 text-fg-faint" />}
        </div>
        {/* flex-1: the actions of the three cards line up whatever the length of the text. */}
        <p className="mt-3 flex-1 text-sm text-fg-muted">{copy.description}</p>
        <div className="mt-4 flex min-w-0 items-center gap-1">{actions}</div>
      </div>
      {dragging && (
        <div
          className="pointer-events-none relative flex min-w-0 animate-fade-in flex-col items-center justify-center px-2 text-center [grid-area:1/1]"
          data-testid={`service-${route}-drop`}
        >
          <Icon size={18} className={target ? 'text-accent-text' : 'text-fg-subtle'} />
          <div
            className={cn(
              'mt-2.5 max-w-full truncate text-base font-medium',
              target ? 'text-fg' : 'text-fg-muted',
            )}
          >
            {copy.drop}
          </div>
          <div className="mt-0.5 max-w-full truncate text-xs text-fg-subtle">{dropHint}</div>
        </div>
      )}
    </section>
  )
}

/**
 * The three services as cards: what each does and its main action. While files are dragged over
 * the page the cards turn into drop zones, and dropping on one opens the files in that service.
 */
export function ServiceCards() {
  const t = useT()
  const zones = useIo((s) => s.drag === 'open')
  const hovered = useCardDrops()
  const fileName = useDocument((s) => s.meta?.fileName)
  const rootRef = useRef<HTMLDivElement>(null)

  // A drag that starts while the cards are scrolled away brings them into view.
  useEffect(() => {
    if (!zones) return
    const el = rootRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [zones])

  const stateOf = (route: ServiceRoute): CardState =>
    !zones ? 'idle' : (hovered ?? DEFAULT_ZONE) === route ? 'target' : 'zone'

  const hintOf = (route: ServiceRoute): string => {
    if (route === 'optimize') return t.home.services.optimize.dropHint
    return fileName ? t.home.replaces(fileName) : t.home.services[route].dropHint
  }

  const actions: Record<ServiceRoute, ReactNode> = {
    edit: (
      <>
        <Button
          icon={FolderOpen}
          onClick={() => pickFiles((files) => void openInService('edit', files))}
          data-testid="home-open-edit"
          className="min-w-0"
        >
          {t.home.services.edit.action}
          <span className="ml-1 font-normal text-fg-subtle">{formatShortcut('mod+o')}</span>
        </Button>
        <IconButton
          icon={FilePlus2}
          label={t.home.newAnimation}
          shortcut="mod+alt+n"
          size="md"
          onClick={() => openDialog(IO_DIALOG.newDocument)}
          data-testid="home-new"
        />
        <IconButton
          icon={Link2}
          label={t.home.openUrl}
          size="md"
          onClick={() => showOpenUrl()}
          data-testid="home-url"
        />
      </>
    ),
    customize: (
      <Button
        icon={FolderOpen}
        onClick={() => pickFiles((files) => void openInService('customize', files))}
        data-testid="home-open-customize"
        className="min-w-0"
      >
        {t.home.services.customize.action}
      </Button>
    ),
    optimize: (
      <Button
        icon={FolderOpen}
        onClick={() => pickFiles((files) => void openInService('optimize', files))}
        data-testid="home-open-optimize"
        className="min-w-0"
      >
        {t.home.services.optimize.action}
      </Button>
    ),
  }

  return (
    <div ref={rootRef} className="grid scroll-my-6 grid-cols-1 gap-3 md:grid-cols-3">
      {SERVICES.map(({ route, icon }) => (
        <ServiceCard
          key={route}
          route={route}
          icon={icon}
          state={stateOf(route)}
          actions={actions[route]}
          dropHint={hintOf(route)}
        />
      ))}
    </div>
  )
}
