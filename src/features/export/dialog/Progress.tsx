/** Progress of a running export: a thin accent bar and the "Rendering 42 / 179 frames" line. */
import { Spinner } from '@/components/ui'
import { useT } from '@/i18n'
import { useExportJob } from '../store'

/** Hairline progress bar along the bottom edge of the dialog body. */
export function ProgressBar() {
  const progress = useExportJob((s) => (s.status === 'running' ? s.progress : null))
  if (!progress) return null
  const indeterminate = progress.phase === 'preparing'
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
      data-testid="export-progress"
    >
      <progress
        className="sr-only"
        max={progress.total}
        value={indeterminate ? undefined : progress.done}
      />
      <div
        className="h-full bg-accent transition-[width] duration-100 ease-out"
        style={{ width: indeterminate ? '6%' : `${Math.max(2, progress.fraction * 100)}%` }}
        aria-hidden
      />
    </div>
  )
}

/** Footer text while exporting. */
export function ProgressLabel() {
  const t = useT()
  const progress = useExportJob((s) => s.progress)
  let text = t.export.exporting
  let eta: string | null = null
  if (progress) {
    if (progress.phase === 'preparing') text = t.export.preparing
    else if (progress.phase === 'finishing') text = t.export.finishing
    else {
      text = t.export.rendering(progress.done, progress.total)
      if (progress.secondsLeft !== null) eta = t.export.secondsLeft(progress.secondsLeft)
    }
  }
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-2 text-sm text-fg-muted tabular-nums"
      aria-live="polite"
      data-testid="export-progress-label"
    >
      <Spinner size={14} className="text-accent-text" />
      <span className="truncate">
        {text}
        {eta && <span className="text-fg-subtle"> · {eta}</span>}
      </span>
    </div>
  )
}
