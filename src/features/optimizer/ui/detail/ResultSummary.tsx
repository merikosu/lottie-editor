/**
 * The result of the file on screen: the saving, sizes before and after in each delivery form
 * (raw JSON, gzip, .lottie), the visual check and anything relaxed to pass it.
 */
import type { ReactNode } from 'react'
import { Spinner } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { jobSizes, savedShare, type JobMatch } from '../../model/summary'
import type { Job, JobPart } from '../../model/types'
import { MatchBadge, ProgressBar } from '../common'
import { describeBackoffs } from '../backoffs'
import { useFormat, type Format } from '../format'

function SizeRow({
  label,
  before,
  after,
  f,
}: {
  label: string
  before: number
  after: number
  f: Format
}) {
  return (
    <>
      <span className="text-xs text-fg-subtle">{label}</span>
      <span className="text-right text-xs text-fg-muted tabular-nums">{f.bytes(before)}</span>
      <span className="text-right text-xs text-fg tabular-nums">{f.bytes(after)}</span>
      <span className="text-right text-xs text-fg tabular-nums">
        {f.saving(savedShare(before, after))}
      </span>
    </>
  )
}

/** The first optimization of a file: how far it is (large files take seconds). */
function RunProgress({ run }: { run: NonNullable<JobPart['run']> }) {
  const t = useT()
  const step =
    run.step === null
      ? null
      : run.step === 'measure'
        ? t.optimizer.result.measuring
        : t.optimizer.techniques[run.step].name
  return (
    <div className="mt-3 flex flex-col gap-1.5" data-testid="opt-run-progress">
      <ProgressBar value={run.progress} className="h-1" />
      <span className="truncate text-xs text-fg-subtle">
        {step ?? t.optimizer.status.optimizing}
      </span>
    </div>
  )
}

/** Totals of a file with several animations (the rows above are the animation on screen). */
function WholeFile({ job }: { job: Job }) {
  const t = useT()
  const f = useFormat()
  const sizes = jobSizes(job)
  if (!sizes) return null
  return (
    <p className="mt-2 flex flex-wrap gap-x-1.5 text-xs text-fg-subtle tabular-nums">
      <span>{t.optimizer.result.wholeFile(job.parts.length)}</span>
      <span className="text-fg-muted">
        {f.bytes(sizes.beforeRaw)} → {f.bytes(sizes.afterRaw)}
      </span>
      <span className="text-fg">{f.saving(savedShare(sizes.beforeRaw, sizes.afterRaw))}</span>
    </p>
  )
}

export function ResultSummary({
  job,
  part,
  match,
  busy,
  status,
}: {
  job: Job
  part: JobPart | undefined
  match: JobMatch
  /** A new result is being made (the numbers shown are the previous ones). */
  busy: boolean
  status: ReactNode
}) {
  const t = useT()
  const f = useFormat()
  const result = part?.result
  const report = result?.report
  const visual = part?.verify.visual
  const share = report ? savedShare(report.before.raw, report.after.raw) : 0
  return (
    <section
      aria-label={t.optimizer.result.title}
      className="shrink-0 border-b border-line px-4 pt-3 pb-3.5"
      data-testid="opt-result"
    >
      <div className="flex h-5 items-center justify-between gap-2">
        <span className="text-xs font-semibold text-fg">{t.optimizer.result.title}</span>
        {busy ? (
          <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
            <Spinner size={12} />
            {status}
          </span>
        ) : (
          report && (
            <span className="text-xs text-fg-subtle">
              {t.optimizer.result.time(f.duration(report.durationMs))}
            </span>
          )
        )}
      </div>
      <div className={cn('transition-opacity duration-150', busy && report && 'opacity-60')}>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-fg" data-testid="opt-result-saving">
            {report ? f.saving(share) : '—'}
          </span>
          {report && (
            <span className="text-sm text-fg-muted tabular-nums">
              {t.optimizer.result.saved}{' '}
              {f.bytes(Math.max(0, report.before.raw - report.after.raw))}
            </span>
          )}
        </div>
        {!report && part?.run && <RunProgress run={part.run} />}
        {report && (
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-4 gap-y-1">
            <span />
            <span className="text-right text-2xs text-fg-faint">{t.optimizer.content.before}</span>
            <span className="text-right text-2xs text-fg-faint">{t.optimizer.content.after}</span>
            <span />
            <SizeRow
              label={t.optimizer.result.json}
              before={report.before.raw}
              after={report.after.raw}
              f={f}
            />
            <SizeRow
              label={t.optimizer.result.gzip}
              before={report.before.gzip}
              after={report.after.gzip}
              f={f}
            />
            <SizeRow
              label={t.optimizer.result.lottie}
              before={report.before.dotLottie}
              after={report.after.dotLottie}
              f={f}
            />
          </div>
        )}
        {report && report.after.raw >= report.before.raw && (
          <p className="mt-2 text-xs text-fg-subtle">{t.optimizer.result.notSmaller}</p>
        )}
        {job.parts.length > 1 && <WholeFile job={job} />}
      </div>
      <div className="mt-3 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
        {match ? (
          <>
            <MatchBadge
              match={match}
              job={job}
              worstShare={visual?.worstShare ?? 0}
              worstFrame={visual?.worstFrame ?? 0}
            />
            {visual && match === 'identical' && (
              <span className="text-xs text-fg-subtle">
                {visual.maxDiff === 0
                  ? t.optimizer.verify.pixelIdenticalHint(visual.frames.length)
                  : t.optimizer.verify.identicalHint(visual.frames.length)}
              </span>
            )}
          </>
        ) : (
          // While a new result is being made the header says so; the check comes after it.
          result &&
          !busy && (
            <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <Spinner size={12} />
              {t.optimizer.verify.checking}
            </span>
          )
        )}
      </div>
      {result && result.backoffs.length > 0 && (
        <p className="mt-2 text-xs text-fg-muted" data-testid="opt-backoffs">
          {t.optimizer.result.relaxed}{' '}
          <span className="text-fg">{describeBackoffs(result.backoffs, t, f)}</span>
        </p>
      )}
    </section>
  )
}
