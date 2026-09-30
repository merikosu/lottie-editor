import { FilePlus2, FolderOpen, Link2 } from 'lucide-react'
import { Button, Kbd, Spinner } from '@/components/ui'
import { formatShortcut } from '@/commands/shortcuts'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { openDialog } from '@/store/ui'
import { DIALOG } from './dialog-ids'
import { useFreshRecents, useStartupSettled } from './hooks'
import { openSample, pickFiles } from './open'
import { RecentSection } from './RecentSection'
import { SamplesSection } from './SamplesSection'
import { StartPage } from './StartPage'
import { useIo } from './store'
import { showOpenUrl } from './urlDownload'

const FORMATS = ['.json', '.lottie', '.tgs', '.zip']

function DropZone() {
  const t = useT()
  const opening = useIo((s) => s.opening)
  // Only a drop that would open something lights the zone up (not images without an animation).
  const dragging = useIo((s) => s.drag === 'open')

  return (
    <div
      data-testid="drop-zone"
      className={cn(
        'group relative flex flex-col items-center rounded-xl border border-dashed bg-surface-1 px-8 pt-9 pb-8 text-center',
        'transition-colors duration-150',
        dragging ? 'border-accent' : 'border-line-strong has-[>button:hover]:border-fg-faint',
      )}
    >
      {/*
        The empty area of the card opens the file picker too, as drop zones do. It is a mouse
        convenience only: keyboard and screen reader users have the "Open file…" button.
      */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={() => pickFiles()}
        className="absolute inset-0 rounded-xl"
      />
      <div className="pointer-events-none relative text-base font-medium text-fg">
        {t.io.welcome.dropTitle}
      </div>
      <div className="pointer-events-none relative mt-1.5 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs text-fg-subtle">
        {FORMATS.map((f) => (
          <code
            key={f}
            className="rounded-xs bg-surface-2 px-1 py-px font-mono text-2xs text-fg-muted"
          >
            {f}
          </code>
        ))}
        <span className="px-0.5">·</span>
        <span>{t.io.welcome.dropHintOr}</span>
        <Kbd shortcut="mod+v" />
      </div>
      <div className="relative mt-6 flex flex-wrap items-center justify-center gap-2">
        {opening ? (
          <output className="flex h-7 items-center gap-2 text-sm text-fg-muted">
            <Spinner size={14} />
            <span className="max-w-72 truncate">{t.io.welcome.opening(opening)}</span>
          </output>
        ) : (
          <>
            <Button
              variant="primary"
              icon={FolderOpen}
              onClick={() => pickFiles()}
              data-testid="welcome-open"
            >
              {t.io.welcome.openFile}
              <span className="ml-1 font-normal text-accent-fg/70">{formatShortcut('mod+o')}</span>
            </Button>
            <Button
              variant="secondary"
              icon={FilePlus2}
              onClick={() => openDialog(DIALOG.newDocument)}
              data-testid="welcome-new"
            >
              {t.io.welcome.newAnimation}
            </Button>
            <Button
              variant="ghost"
              icon={Link2}
              onClick={() => showOpenUrl()}
              data-testid="welcome-url"
            >
              {t.io.welcome.openUrl}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/** First screen when no document is open: open/create, recent files and samples. */
export function WelcomeScreen() {
  const t = useT()
  const settled = useStartupSettled()
  useFreshRecents()

  if (!settled) return <div className="h-full" aria-busy />

  return (
    <StartPage tagline={t.io.welcome.tagline} data-testid="welcome">
      <DropZone />
      <RecentSection className="mt-10" />
      <SamplesSection className="mt-10" onOpen={(id) => void openSample(id)} />
    </StartPage>
  )
}
