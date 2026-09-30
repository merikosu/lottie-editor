/**
 * Small pieces shared by the queue and the detail view: format chips, the visual-check badge,
 * the savings meter and the preset control.
 */
import { AlertTriangle, Check, CircleSlash } from 'lucide-react'
import type { ReactNode } from 'react'
import { SegmentedControl, Spinner, Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { fileExtension } from '@/lottie/formats'
import { PRESET_IDS, type OptimizeOptions, type PresetId } from '@/lottie/optimizer'
import { presetOf } from '../model/settings'
import type { Job, JobPart } from '../model/types'
import type { JobMatch } from '../model/summary'
import { useFormat } from './format'

/** Input format chip (".lottie", "JSON", …; the extension of a file that could not be read). */
export function FormatChip({
  job,
  className,
}: {
  job: Pick<Job, 'input' | 'origin' | 'phase' | 'name'>
  className?: string
}) {
  const t = useT()
  const label =
    job.origin.kind === 'editor'
      ? t.optimizer.formats.editor
      : job.phase === 'error'
        ? fileExtension(job.name).toUpperCase() || '—'
        : t.optimizer.formats[job.input]
  return (
    <span
      className={cn(
        'inline-flex h-4 shrink-0 items-center rounded-xs bg-surface-2 px-1 font-mono text-2xs text-fg-muted shadow-[inset_0_0_0_1px_var(--le-line)]',
        className,
      )}
    >
      {label}
    </span>
  )
}

/** Thin meter of the saved share (accent) over a neutral track. */
export function SavingsMeter({ share, className }: { share: number; className?: string }) {
  const width = Math.max(0, Math.min(1, share)) * 100
  return (
    <span
      aria-hidden
      className={cn('relative block h-1 overflow-hidden rounded-full bg-line-strong/70', className)}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-accent transition-[width] duration-150 ease-out"
        style={{ width: `${width}%` }}
      />
    </span>
  )
}

/** Progress of a running optimization (0..1); the status text next to it says the same. */
export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative block h-0.5 overflow-hidden rounded-full bg-line-strong/70',
        className,
      )}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-fg-subtle transition-[width] duration-150 ease-out"
        style={{ width: `${Math.max(4, value * 100)}%` }}
      />
    </span>
  )
}

const badgeBase =
  'inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap'

/** Frames the check rendered (the report lists them). */
function checkedCount(parts: JobPart[]): number {
  return parts.reduce((n, p) => n + (p.verify.visual?.frames.length ?? 0), 0)
}

/**
 * The visual check's verdict for a job. In a queue row (`onOpen`) the badge sits above the row's
 * hit area, so its explanation shows on hover, and a click opens the file like the row does.
 */
export function MatchBadge({
  match,
  job,
  worstShare,
  worstFrame,
  onOpen,
}: {
  match: JobMatch
  job: Job
  worstShare: number
  worstFrame: number
  onOpen?: () => void
}) {
  const t = useT()
  const f = useFormat()
  let content: ReactNode
  let hint: string
  switch (match) {
    case 'identical': {
      const pixelExact = job.parts.every((p) => (p.verify.visual?.maxDiff ?? 1) === 0)
      const frames = checkedCount(job.parts)
      hint = pixelExact
        ? t.optimizer.verify.pixelIdenticalHint(frames)
        : t.optimizer.verify.identicalHint(frames)
      content = (
        <span className={cn(badgeBase, 'bg-success-subtle text-success')} data-match="identical">
          <Check size={12} strokeWidth={2.25} className="shrink-0" />
          <span className="truncate">{t.optimizer.verify.identical}</span>
        </span>
      )
      break
    }
    case 'different':
      hint = t.optimizer.verify.reviewHint(f.percent(worstShare), worstFrame)
      content = (
        <span className={cn(badgeBase, 'bg-warning-subtle text-warning')} data-match="different">
          <AlertTriangle size={12} className="shrink-0" />
          <span className="truncate tabular-nums">
            {t.optimizer.verify.review(f.percent(worstShare))}
          </span>
        </span>
      )
      break
    case 'unverified':
      hint = t.optimizer.verify.unverifiedHint
      content = (
        <span className={cn(badgeBase, 'bg-hover text-fg-muted')} data-match="unverified">
          <CircleSlash size={12} className="shrink-0" />
          <span className="truncate">{t.optimizer.verify.unverified}</span>
        </span>
      )
      break
    default:
      return null
  }
  return (
    <Tooltip content={hint}>
      {onOpen ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={onOpen}
          className="relative z-10 inline-flex min-w-0 rounded-sm"
        >
          {content}
        </button>
      ) : (
        <span className="inline-flex min-w-0" tabIndex={-1}>
          {content}
        </span>
      )}
    </Tooltip>
  )
}

/** Muted status line with a spinner ("Optimizing…", "Checking frames…"). */
export function BusyLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle', className)}
    >
      <Spinner size={12} className="shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  )
}

/** Safe / Balanced / Maximum (plus "Custom" while the options match none of them). */
export function PresetControl({
  options,
  onPreset,
  fill,
  className,
}: {
  options: OptimizeOptions
  onPreset: (id: PresetId) => void
  fill?: boolean
  className?: string
}) {
  const t = useT()
  const current = presetOf(options)
  const items = PRESET_IDS.map((id) => ({
    value: id as PresetId | 'custom',
    label: t.optimizer.presets[id],
  }))
  if (current === 'custom') items.push({ value: 'custom', label: t.optimizer.presets.custom })
  return (
    <SegmentedControl<PresetId | 'custom'>
      value={current}
      onValueChange={(v) => {
        if (v !== 'custom') onPreset(v)
      }}
      options={items}
      fill={fill}
      className={className}
      aria-label={t.optimizer.presets.label}
    />
  )
}
