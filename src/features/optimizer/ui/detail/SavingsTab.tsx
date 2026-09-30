/**
 * Where the bytes went: one row per technique that changed something, sorted by the raw bytes it
 * removed, with the gzip bytes on the same scale below (honest: after compression the gains are
 * smaller). A row opens to say what the technique does and what it changed. Techniques with
 * nothing to do are listed in one line.
 */
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { OptimizeReport, StepReport, TechniqueId } from '@/lottie/optimizer'
import { useFormat } from '../format'

type ChangeKey = keyof ReturnType<typeof useT>['optimizer']['changes']

function changeText(step: StepReport, t: ReturnType<typeof useT>): string[] {
  const C = t.optimizer.changes
  const out: string[] = []
  for (const [key, n] of Object.entries(step.details)) {
    if (!n) continue
    const fn =
      key in C && key !== 'removed' ? (C[key as ChangeKey] as (n: number) => string) : C.other
    out.push(fn(n))
  }
  return out
}

function Row({
  step,
  max,
  total,
  open,
  onToggle,
}: {
  step: StepReport
  max: number
  total: number
  open: boolean
  onToggle: () => void
}) {
  const t = useT()
  const f = useFormat()
  const tech = t.optimizer.techniques[step.id]
  const changes = changeText(step, t)
  const rawWidth = max > 0 ? (Math.max(0, step.savedRaw) / max) * 100 : 0
  const gzipWidth = max > 0 ? (Math.max(0, step.savedGzip) / max) * 100 : 0
  return (
    <li data-technique={step.id}>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="group grid w-full grid-cols-[minmax(0,124px)_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-1.5 py-1.5 text-left transition-colors duration-100 hover:bg-hover"
      >
        <span className="flex min-w-0 items-start gap-1">
          <ChevronRight
            size={12}
            className={cn(
              'mt-0.5 shrink-0 text-fg-faint transition-transform duration-150 group-hover:text-fg-subtle',
              open && 'rotate-90',
            )}
          />
          {/* Long names (Russian) wrap to a second line rather than being cut. */}
          <span className="line-clamp-2 text-xs leading-4 text-fg-muted">{tech.name}</span>
        </span>
        <span className="flex min-w-0 flex-col gap-[3px]" aria-hidden>
          <span
            className="block h-1.5 rounded-r-sm bg-accent"
            style={{ width: `${Math.max(rawWidth, step.savedRaw > 0 ? 1.5 : 0)}%` }}
          />
          <span
            className="block h-1 rounded-r-sm bg-fg-subtle/70"
            style={{ width: `${Math.max(gzipWidth, step.savedGzip > 0 ? 1 : 0)}%` }}
          />
        </span>
        <span className="flex flex-col items-end leading-none tabular-nums">
          <span className="text-xs text-fg">{f.delta(step.savedRaw)}</span>
          <span className="mt-0.5 text-2xs text-fg-subtle">{f.delta(step.savedGzip)}</span>
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 pr-1.5 pb-2 pl-[22px] text-xs text-fg-muted">
          <p>{tech.about}</p>
          {changes.length > 0 && (
            <p className="text-fg-subtle">
              {t.optimizer.changes.removed}{' '}
              <span className="text-fg-muted">{changes.join(', ')}</span>
            </p>
          )}
          {total > 0 && step.savedRaw > 0 && (
            <p className="text-fg-subtle">
              {t.optimizer.savings.share(f.percent(step.savedRaw / total))}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

export function SavingsTab({ report }: { report: OptimizeReport | undefined }) {
  const t = useT()
  const f = useFormat()
  const [openId, setOpenId] = useState<TechniqueId | null>(null)
  if (!report) return null
  const active = report.steps
    .filter((s) => s.changes > 0 || s.savedRaw !== 0)
    .sort((a, b) => b.savedRaw - a.savedRaw || b.savedGzip - a.savedGzip)
  const idle = report.steps.filter((s) => !active.includes(s)).map((s) => s.id)
  const max = Math.max(0, ...active.map((s) => Math.max(s.savedRaw, s.savedGzip)))
  const totalRaw = report.before.raw - report.after.raw
  const totalGzip = report.before.gzip - report.after.gzip
  const names = (ids: TechniqueId[]) => ids.map((id) => t.optimizer.techniques[id].name).join(', ')
  return (
    <div className="flex flex-col px-3 pt-3 pb-4" data-testid="opt-savings">
      <div className="mb-2 flex items-center justify-between gap-2 px-1.5">
        <span className="flex items-center gap-3 text-2xs text-fg-subtle">
          <span className="flex items-center gap-1">
            <span aria-hidden className="h-1.5 w-2.5 rounded-xs bg-accent" />
            {t.optimizer.savings.legendRaw}
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden className="h-1 w-2.5 rounded-xs bg-fg-subtle/70" />
            {t.optimizer.savings.legendGzip}
          </span>
        </span>
        <span className="text-2xs text-fg-subtle tabular-nums">
          {t.optimizer.savings.total} <span className="text-fg">{f.delta(totalRaw)}</span> ·{' '}
          {f.delta(totalGzip)}
        </span>
      </div>
      {active.length ? (
        <ul className="flex flex-col" aria-label={t.optimizer.tabs.savings}>
          {active.map((step) => (
            <Row
              key={step.id}
              step={step}
              max={max}
              total={totalRaw}
              open={openId === step.id}
              onToggle={() => setOpenId((id) => (id === step.id ? null : step.id))}
            />
          ))}
        </ul>
      ) : (
        <p className="px-1.5 py-2 text-xs text-fg-subtle">{t.optimizer.savings.none}</p>
      )}
      {idle.length > 0 && (
        <p className="mt-2 px-1.5 text-xs text-fg-subtle">
          <span className="text-fg-muted">{t.optimizer.savings.unchanged}:</span> {names(idle)}
        </p>
      )}
      <p className="mt-4 px-1.5 text-xs leading-[18px] text-fg-subtle">
        {t.optimizer.savings.note}
      </p>
    </div>
  )
}
