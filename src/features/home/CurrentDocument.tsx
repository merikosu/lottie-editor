import { ArrowRight, FileJson, Gauge, Paintbrush } from 'lucide-react'
import { useEffect } from 'react'
import { navigate } from '@/app/router'
import { Button, IconButton, Tooltip } from '@/components/ui'
import {
  formatDuration,
  formatFileSize,
  refreshOpenThumbnail,
  TruncatedText,
  useIo,
} from '@/features/io'
import { useLanguage, useT } from '@/i18n'
import { isDirty, useDocument } from '@/store/document'
import { optimizeDocument } from './actions'

/**
 * The animation that is open, with the ways back to it: continue editing (the main action), or
 * take it to Customize or the optimizer.
 */
export function CurrentDocument() {
  const t = useT()
  const language = useLanguage()
  const meta = useDocument((s) => s.meta)
  const doc = useDocument((s) => s.doc)
  const dirty = useDocument(isDirty)
  // The recent entry has the thumbnail and the size after edits (autosave keeps it current).
  const entry = useIo((s) => s.recents?.find((r) => r.id === meta?.id))
  // The document does not change here: bring a thumbnail rendered before the last edits up to date.
  useEffect(() => {
    if (doc) refreshOpenThumbnail()
  }, [doc])
  if (!meta || !doc) return null

  const size = entry?.size ?? meta.sourceSize
  const thumbnail = entry?.thumbnail

  const frames = Math.max(0, doc.op - doc.ip)
  const details = [
    `${doc.w} × ${doc.h}`,
    `${doc.fr} ${t.common.fps}`,
    `${formatDuration(frames, doc.fr, language)} ${t.common.secondsShort}`,
    size ? formatFileSize(size, language, t.io.units) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section
      aria-label={t.home.current.label}
      data-testid="home-current"
      className="mb-3 flex min-w-0 items-center gap-3 rounded-lg border border-line bg-surface-1 py-2 pr-2 pl-2"
    >
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2 shadow-[inset_0_0_0_1px_var(--le-line)]">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="size-full object-contain p-0.5"
            draggable={false}
          />
        ) : (
          <FileJson size={16} className="text-fg-faint" />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <TruncatedText text={meta.fileName} className="text-sm font-medium text-fg" />
          {dirty && (
            <Tooltip content={t.app.unsaved}>
              <span
                className="size-1.5 shrink-0 rounded-full bg-fg-muted"
                aria-label={t.app.unsaved}
              />
            </Tooltip>
          )}
        </div>
        <span className="truncate text-xs text-fg-subtle tabular-nums">{details}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {/* Labelled on wide screens; icons with tooltips where the file name needs the room. */}
        <Button
          variant="ghost"
          icon={Paintbrush}
          onClick={() => navigate('customize')}
          data-testid="home-current-customize"
          className="max-lg:hidden"
        >
          {t.home.current.customize}
        </Button>
        <Button
          variant="ghost"
          icon={Gauge}
          onClick={() => void optimizeDocument()}
          data-testid="home-current-optimize"
          className="max-lg:hidden"
        >
          {t.home.current.optimize}
        </Button>
        <IconButton
          icon={Paintbrush}
          label={t.home.current.customize}
          size="md"
          onClick={() => navigate('customize')}
          className="lg:hidden"
        />
        <IconButton
          icon={Gauge}
          label={t.home.current.optimize}
          size="md"
          onClick={() => void optimizeDocument()}
          className="lg:hidden"
        />
        <Button
          variant="primary"
          onClick={() => navigate('edit')}
          data-testid="home-continue"
          className="ml-1"
        >
          {t.home.current.continue}
          <ArrowRight size={14} className="-mr-0.5 ml-0.5 inline-block align-[-2px]" />
        </Button>
      </div>
    </section>
  )
}
