/**
 * Download buttons of the file on screen, each with the exact size of the file it saves: JSON,
 * .lottie (written in the background, since it is zipped) and a Telegram sticker when the
 * animation qualifies. The queue's output format (what "Download" saves) is outlined.
 */
import { Download } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { whenIdle } from '@/features/io/thumbnail'
import { buildOutput, canBeSticker, hasOutput, knownSize } from '../../model/output'
import { useOptimizerSettings } from '../../model/settings'
import { outputFormat } from '../../model/summary'
import type { Job, OutputFormat } from '../../model/types'
import { downloadJob } from '../actions'
import { useFormat } from '../format'

/** Exact .lottie size, computed when the page is idle (zipping takes a moment on large files). */
function useLottieSize(job: Job): number | null {
  const results = job.parts.map((p) => p.result)
  const ready = hasOutput(job)
  const [size, setSize] = useState<{ of: unknown[]; bytes: number } | null>(null)
  const current =
    size && size.of.length === results.length && size.of.every((r, i) => r === results[i])
  useEffect(() => {
    if (!ready || current) return
    let cancelled = false
    whenIdle(() => {
      if (cancelled) return
      try {
        const out = buildOutput(job, 'lottie')
        if (!cancelled) setSize({ of: job.parts.map((p) => p.result), bytes: out.size })
      } catch (err) {
        console.warn('Could not measure the .lottie', err)
      }
    })
    return () => {
      cancelled = true
    }
  })
  return current ? size.bytes : null
}

function FormatButton({
  label,
  size,
  primary,
  disabled,
  hint,
  onClick,
  testId,
}: {
  label: string
  size: string
  primary: boolean
  disabled?: boolean
  hint: string
  onClick: () => void
  testId: string
}) {
  return (
    <Tooltip content={hint} side="top">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        data-testid={testId}
        className={cn(
          'flex h-11 min-w-0 flex-1 flex-col items-start justify-center rounded-md bg-surface-2 px-2.5 text-left text-fg transition-[background-color,box-shadow] duration-100 hover:bg-surface-3 disabled:pointer-events-none disabled:opacity-40',
          // The queue's output format is the one "Download" saves: outlined in the accent.
          primary
            ? 'shadow-[inset_0_0_0_1px_var(--le-accent)]'
            : 'shadow-[inset_0_0_0_1px_var(--le-line-strong)]',
        )}
      >
        <span className="flex w-full items-center justify-between gap-1 text-xs font-medium">
          <span className="truncate">{label}</span>
          <Download
            size={12}
            className={cn('shrink-0', primary ? 'text-accent-text' : 'text-fg-subtle')}
          />
        </span>
        <span className="text-xs text-fg-muted tabular-nums">{size}</span>
      </button>
    </Tooltip>
  )
}

export function Downloads({ job }: { job: Job }) {
  const t = useT()
  const f = useFormat()
  const choice = useOptimizerSettings((s) => s.output)
  const ready = hasOutput(job)
  const primary = outputFormat(job, choice)
  const lottie = useLottieSize(job)
  const several = job.parts.length > 1
  const telegram = canBeSticker(job)
  const size = (format: OutputFormat, value: number | null) =>
    value === null ? (ready && format === 'lottie' ? '…' : '—') : f.bytes(value)
  const D = t.optimizer.downloads
  return (
    <section
      className="shrink-0 border-t border-line px-3 py-3"
      aria-label={D.title}
      data-testid="opt-downloads"
    >
      <div className="flex gap-2">
        <FormatButton
          label={several ? D.jsonOne : D.json}
          size={size('json', knownSize(job, 'json'))}
          primary={primary === 'json'}
          disabled={!ready}
          hint={ready ? D.json : D.notReady}
          onClick={() => downloadJob(job, 'json', job.active)}
          testId="opt-download-json"
        />
        <FormatButton
          label={D.lottie}
          size={size('lottie', lottie)}
          primary={primary === 'lottie'}
          disabled={!ready}
          hint={ready ? D.lottie : D.notReady}
          onClick={() => downloadJob(job, 'lottie')}
          testId="opt-download-lottie"
        />
        {telegram && (
          <FormatButton
            label={D.tgs}
            size={size('tgs', knownSize(job, 'tgs'))}
            primary={primary === 'tgs'}
            disabled={!ready}
            hint={D.telegram}
            onClick={() => downloadJob(job, 'tgs', job.active)}
            testId="opt-download-tgs"
          />
        )}
      </div>
    </section>
  )
}
