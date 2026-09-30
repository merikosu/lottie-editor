import { FolderOpen, Link2, Paintbrush } from 'lucide-react'
import { Button, Kbd, Spinner } from '@/components/ui'
import {
  openFiles,
  openSample,
  pickFiles,
  RecentSection,
  SamplesSection,
  showOpenUrl,
  useFreshRecents,
  useIo,
  useStartupSettled,
} from '@/features/io'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { useUi } from '@/store/ui'

const FORMATS = ['.json', '.lottie', '.tgs', '.zip']

function chooseFiles(): void {
  pickFiles((files) => void openFiles(files, { route: 'customize' }))
}

function DropZone() {
  const t = useT()
  const opening = useIo((s) => s.opening)
  const dragging = useUi((s) => s.dropActive)
  return (
    <div
      data-testid="customize-drop-zone"
      className={cn(
        'relative flex flex-col items-center rounded-xl border border-dashed bg-surface-1 px-8 pt-10 pb-9 text-center',
        'transition-colors duration-150',
        dragging ? 'border-accent' : 'border-line-strong has-[>button:hover]:border-fg-faint',
      )}
    >
      {/* The empty area opens the file picker too (a mouse convenience; the buttons are the way). */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        onClick={chooseFiles}
        className="absolute inset-0 rounded-xl"
      />
      <span className="pointer-events-none relative mb-3 flex size-9 items-center justify-center rounded-lg bg-surface-2 text-fg-muted shadow-[inset_0_0_0_1px_var(--le-line)]">
        <Paintbrush size={16} />
      </span>
      <div className="pointer-events-none relative text-base font-medium text-fg">
        {t.customize.start.drop}
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
        <span>{t.customize.start.dropHint}</span>
        <Kbd shortcut="mod+v" />
      </div>
      <div className="relative mt-6 flex flex-wrap items-center justify-center gap-2">
        {opening ? (
          <output className="flex h-7 items-center gap-2 text-sm text-fg-muted">
            <Spinner size={14} />
            <span className="max-w-72 truncate">{t.customize.start.opening(opening)}</span>
          </output>
        ) : (
          <>
            <Button
              variant="primary"
              icon={FolderOpen}
              onClick={chooseFiles}
              data-testid="customize-choose"
            >
              {t.customize.start.choose}
            </Button>
            <Button variant="ghost" icon={Link2} onClick={() => showOpenUrl()}>
              {t.customize.start.openUrl}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

/** Customize without an animation: open one (drop, file, link, recent or sample). */
export function StartState() {
  const t = useT()
  const settled = useStartupSettled()
  useFreshRecents()
  if (!settled) return <div className="h-full" aria-busy />
  return (
    <div
      className="mx-auto flex w-full max-w-[880px] animate-fade-in flex-col px-8 pt-[max(48px,10vh)] pb-16"
      data-testid="customize-start"
    >
      <header className="mb-6 px-1">
        <h1 className="text-md font-semibold text-fg">{t.customize.start.title}</h1>
        <p className="mt-0.5 text-sm text-fg-muted">{t.customize.start.description}</p>
      </header>
      <DropZone />
      <RecentSection className="mt-10" route="customize" />
      <SamplesSection className="mt-10" onOpen={(id) => void openSample(id, 'customize')} />
    </div>
  )
}
