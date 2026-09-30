/**
 * One file of the queue: what it is, its sizes, the saving, the visual check and its actions.
 * The name is the row's button (its hit area covers the row); the actions sit above it.
 */
import { Download, FileJson, FileX, PenTool, RotateCcw, X } from 'lucide-react'
import { memo, type KeyboardEvent } from 'react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  IconButton,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Tooltip,
} from '@/components/ui'
import { TruncatedText } from '@/features/io'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { canBeSticker, hasOutput } from '../../model/output'
import { retryJob } from '../../model/runner'
import { useOptimizerSettings } from '../../model/settings'
import { selectJob } from '../../model/store'
import {
  hasFailed,
  isCurrent,
  jobMatch,
  jobSizes,
  jobStatus,
  jobWorstShare,
  outputFormat,
  savedShare,
  type Policy,
} from '../../model/summary'
import type { Job, OutputFormat } from '../../model/types'
import { downloadJob, openInEditor, removeFromQueue } from '../actions'
import { BusyLabel, FormatChip, MatchBadge, ProgressBar, SavingsMeter } from '../common'
import { useFormat } from '../format'
import { usePolicy } from '../hooks'

/** Column template shared by the header and the rows. */
export const ROW_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,184px)_minmax(0,128px)_minmax(0,156px)_76px] items-center gap-x-4'

function Thumbnail({ job }: { job: Job }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2 shadow-[inset_0_0_0_1px_var(--le-line)]">
      {job.thumbnail ? (
        <img
          src={job.thumbnail}
          alt=""
          draggable={false}
          className="size-full object-contain p-0.5"
        />
      ) : job.phase === 'error' ? (
        <FileX size={16} className="text-fg-faint" />
      ) : (
        <FileJson size={16} className="text-fg-faint" />
      )}
    </span>
  )
}

function Meta({ job }: { job: Job }) {
  const t = useT()
  const f = useFormat()
  const part = job.parts[0]
  // The name is on the line above: say why it failed (the status badge has the whole message).
  if (job.phase === 'error' && job.error)
    return (
      <span className="truncate text-xs text-danger">{job.error.lines[0] ?? job.error.title}</span>
    )
  if (!part)
    return <span className="truncate text-xs text-fg-subtle">{f.bytes(job.inputSize)}</span>
  const { width, height, fps, ip, op } = part.info
  const seconds = fps > 0 ? (op - ip) / fps : 0
  const bits = [
    `${f.int(width)} × ${f.int(height)}`,
    `${f.number(fps)} ${t.common.fps}`,
    `${f.number(seconds)} ${t.common.secondsShort}`,
  ]
  if (job.parts.length > 1) bits.unshift(t.optimizer.queue.animations(job.parts.length))
  return <span className="truncate text-xs text-fg-subtle tabular-nums">{bits.join(' · ')}</span>
}

function Status({ job, policy }: { job: Job; policy: Policy }) {
  const t = useT()
  const status = jobStatus(job, policy)
  if (status === 'error') {
    const error = job.error ?? job.parts.find((p) => hasFailed(p, policy))?.error ?? null
    return (
      <Tooltip
        content={error ? [error.title, ...error.lines].join('\n') : t.optimizer.status.error}
      >
        {/* Above the row's hit area so the message shows on hover; a click opens the file too. */}
        <button
          type="button"
          tabIndex={-1}
          onClick={() => selectJob(job.id)}
          className="relative z-10 inline-flex h-5 items-center rounded-sm bg-danger-subtle px-1.5 text-xs font-medium text-danger"
        >
          {t.optimizer.status.error}
        </button>
      </Tooltip>
    )
  }
  if (status === 'done') {
    const worstPart = job.parts.reduce(
      (best, p) =>
        (p.verify.visual?.worstShare ?? 0) > (best?.verify.visual?.worstShare ?? -1) ? p : best,
      job.parts[0],
    )
    return (
      <MatchBadge
        match={jobMatch(job, policy)}
        job={job}
        worstShare={jobWorstShare(job)}
        worstFrame={worstPart?.verify.visual?.worstFrame ?? 0}
        onOpen={() => selectJob(job.id)}
      />
    )
  }
  // Progress over all animations: finished ones count whole, the running ones by their step.
  const running = job.parts.some((p) => p.run)
  const progress =
    job.parts.reduce((sum, p) => sum + (p.run ? p.run.progress : isCurrent(p, policy) ? 1 : 0), 0) /
    Math.max(1, job.parts.length)
  // A current result that failed the check is being optimized again with safer settings.
  const relaxing = job.parts.some(
    (p) =>
      isCurrent(p, policy) && p.verify.of === p.result?.json && p.verify.visual?.match === false,
  )
  const label = relaxing ? t.optimizer.status.adjusting : t.optimizer.status[status]
  // Waiting (for a worker, or for its turn to be checked) is quiet: only work in progress spins.
  const checking = job.parts.some((p) => p.verify.status === 'running')
  const active = status === 'reading' || running || (status === 'verifying' && checking) || relaxing
  if (!active) {
    return (
      <span className="truncate text-xs text-fg-faint">
        {status === 'verifying' ? t.optimizer.status.checkQueued : t.optimizer.status.queued}
      </span>
    )
  }
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <BusyLabel>{label}</BusyLabel>
      {running && <ProgressBar value={progress} className="w-24" />}
    </span>
  )
}

function Sizes({ job }: { job: Job }) {
  const t = useT()
  const f = useFormat()
  const sizes = jobSizes(job)
  if (!sizes)
    return (
      <span className="text-sm text-fg-faint tabular-nums">{job.phase === 'error' ? '' : '—'}</span>
    )
  return (
    <span className="flex min-w-0 flex-col tabular-nums">
      <span className="truncate text-sm text-fg">
        <span className="text-fg-muted">{f.bytes(sizes.beforeRaw)}</span>
        <span className="px-1 text-fg-faint">→</span>
        {f.bytes(sizes.afterRaw)}
      </span>
      <span className="truncate text-xs text-fg-subtle">
        {t.optimizer.queue.gzip} {f.bytes(sizes.beforeGzip)} → {f.bytes(sizes.afterGzip)}
      </span>
    </span>
  )
}

function Saved({ job }: { job: Job }) {
  const f = useFormat()
  const sizes = jobSizes(job)
  // Always a cell (an empty one keeps the grid's columns in place).
  if (!sizes) return <span />
  const share = savedShare(sizes.beforeRaw, sizes.afterRaw)
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SavingsMeter share={share} className="w-14 shrink-0" />
      <span className="truncate text-sm font-medium text-fg tabular-nums">{f.saving(share)}</span>
    </span>
  )
}

function RowMenu({ job }: { job: Job }) {
  const t = useT()
  const ready = hasOutput(job)
  // Rendered when the menu opens: the sticker check (parsing the result) only runs then.
  const formats: OutputFormat[] =
    job.parts.length > 1
      ? ['lottie']
      : canBeSticker(job)
        ? ['json', 'lottie', 'tgs']
        : ['json', 'lottie']
  const readable = job.phase !== 'error'
  return (
    <ContextMenuContent>
      <MenuItem kind="context" icon={FileJson} onSelect={() => selectJob(job.id)}>
        {t.optimizer.row.open}
      </MenuItem>
      {readable && (
        <>
          <MenuSeparator kind="context" />
          <MenuLabel kind="context">{t.optimizer.row.downloadAs}</MenuLabel>
          {formats.map((format) => (
            <MenuItem
              key={format}
              kind="context"
              icon={Download}
              disabled={!ready}
              onSelect={() => downloadJob(job, format)}
            >
              {t.optimizer.downloads[format]}
            </MenuItem>
          ))}
        </>
      )}
      {job.origin.kind === 'file' && readable && (
        <>
          <MenuSeparator kind="context" />
          <MenuItem
            kind="context"
            icon={PenTool}
            disabled={!ready}
            onSelect={() => void openInEditor(job)}
          >
            {t.optimizer.row.openInEditor}
          </MenuItem>
        </>
      )}
      <MenuSeparator kind="context" />
      <MenuItem kind="context" icon={X} onSelect={() => removeFromQueue(job.id)}>
        {t.optimizer.row.remove}
      </MenuItem>
    </ContextMenuContent>
  )
}

function Actions({ job, policy }: { job: Job; policy: Policy }) {
  const t = useT()
  const output = useOptimizerSettings((s) => s.output)
  const ready = hasOutput(job)
  const failed = job.parts.some((p) => hasFailed(p, policy))
  const format = t.optimizer.downloads[outputFormat(job, output)]
  // Several animations only fit in a .lottie, whatever the output format says.
  const downloadLabel =
    job.parts.length > 1 && output !== 'lottie'
      ? `${t.optimizer.row.download(format)} · ${t.optimizer.output.several}`
      : t.optimizer.row.download(format)
  // A file that could not be read has nothing to download or open: only removing it is left.
  const unreadable = job.phase === 'error'
  return (
    <span className="relative z-10 flex items-center justify-end gap-0.5">
      {unreadable ? null : failed ? (
        <IconButton
          icon={RotateCcw}
          label={t.optimizer.row.retry}
          onClick={() => retryJob(job.id)}
        />
      ) : (
        <IconButton
          icon={Download}
          label={downloadLabel}
          disabled={!ready}
          onClick={() => downloadJob(job)}
          data-testid="opt-row-download"
        />
      )}
      {job.origin.kind === 'file' && !unreadable && (
        <IconButton
          icon={PenTool}
          label={t.optimizer.row.openInEditor}
          disabled={!ready}
          onClick={() => void openInEditor(job)}
          // Revealed with the row (hover or keyboard focus); never shown faded while unusable.
          className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 disabled:!opacity-0"
        />
      )}
      <IconButton
        icon={X}
        label={t.optimizer.row.remove}
        onClick={() => removeFromQueue(job.id)}
        className={cn(
          !unreadable &&
            'opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100',
        )}
        data-testid="opt-row-remove"
      />
    </span>
  )
}

/** ↑/↓ move between rows, Home/End to the ends, Delete removes (focus goes to the next row). */
function onRowKeyDown(e: KeyboardEvent<HTMLButtonElement>, jobId: string) {
  const list = e.currentTarget.closest('ul')
  const rows = Array.from(list?.querySelectorAll<HTMLButtonElement>('[data-row-open]') ?? [])
  const index = rows.indexOf(e.currentTarget)
  const focusAt = (i: number) => rows[Math.max(0, Math.min(rows.length - 1, i))]?.focus()
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    focusAt(index + (e.key === 'ArrowDown' ? 1 : -1))
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault()
    focusAt(e.key === 'Home' ? 0 : rows.length - 1)
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    focusAt(index + 1 < rows.length ? index + 1 : index - 1)
    removeFromQueue(jobId)
  }
}

/** A queue row (memoized: rows re-render only when their job changes). */
export const JobRow = memo(function JobRow({ job }: { job: Job }) {
  const t = useT()
  const policy = usePolicy(job)!
  const own = job.options !== null
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          data-testid="opt-row"
          data-job={job.id}
          data-status={jobStatus(job, policy)}
          className={cn(
            ROW_COLUMNS,
            'group relative h-14 border-b border-line-subtle px-3 transition-colors duration-100 last:border-b-0 hover:bg-hover',
          )}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Thumbnail job={job} />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  data-row-open
                  onClick={() => selectJob(job.id)}
                  onKeyDown={(e) => onRowKeyDown(e, job.id)}
                  aria-label={`${job.name} — ${t.optimizer.row.open}`}
                  className="min-w-0 rounded-xs text-left text-sm font-medium text-fg outline-offset-2 after:absolute after:inset-0 after:content-['']"
                >
                  <TruncatedText text={job.name} />
                </button>
                <FormatChip job={job} />
                {own && (
                  <Tooltip content={t.optimizer.queue.ownSettingsHint}>
                    <span className="relative z-10 shrink-0 rounded-xs px-1 text-2xs text-accent-text shadow-[inset_0_0_0_1px_var(--le-accent-subtle)]">
                      {t.optimizer.queue.ownSettings}
                    </span>
                  </Tooltip>
                )}
              </span>
              <Meta job={job} />
            </span>
          </span>
          <Sizes job={job} />
          <Saved job={job} />
          <span className="flex min-w-0 items-center">
            <Status job={job} policy={policy} />
          </span>
          <Actions job={job} policy={policy} />
        </li>
      </ContextMenuTrigger>
      <RowMenu job={job} />
    </ContextMenu>
  )
})
