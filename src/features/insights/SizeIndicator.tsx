import { Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { formatBytes } from '@/lib/format'
import { openOptimizer } from './actions'
import { useAnalysisSubscription } from './engine'
import { useAnalysis } from './store'
import { useDelayed } from './useDelayed'

/**
 * Status bar readout of the document size: minified JSON and its gzip size (what a server
 * sends), with a breakdown in the tooltip. Updates shortly after edits; opens the optimizer.
 */
export function SizeIndicator() {
  const t = useT()
  useAnalysisSubscription()
  const size = useAnalysis((s) => s.result?.size ?? null)
  const measuring = useDelayed(
    useAnalysis((s) => s.pending && !s.result),
    400,
  )
  const s = t.insights.size
  if (!size) {
    // Big files take a moment to measure the first time.
    return measuring ? <span className="text-fg-faint">{s.measuring}</span> : null
  }
  const label = s.label(formatBytes(size.raw), formatBytes(size.gzip))
  const breakdown = (
    <span className="flex min-w-48 flex-col gap-1 py-0.5 tabular-nums">
      <span className="font-medium text-fg">{s.title}</span>
      <Line label={s.json} value={formatBytes(size.raw)} />
      {size.imageCount > 0 && (
        <>
          <Line label={s.data} value={formatBytes(Math.max(0, size.raw - size.images))} indent />
          <Line label={s.images(size.imageCount)} value={formatBytes(size.images)} indent />
        </>
      )}
      <Line label={s.gzip} value={formatBytes(size.gzip)} />
      <span className="max-w-60 text-fg-subtle">{s.gzipHint}</span>
      <span className="text-fg-subtle">{s.optimize}</span>
    </span>
  )
  return (
    <Tooltip content={breakdown} side="top" align="end">
      <button
        type="button"
        onClick={openOptimizer}
        aria-label={`${s.title}: ${label}`}
        data-testid="size-indicator"
        className="-mx-1.5 flex h-5 items-center rounded-sm px-1.5 text-fg-subtle tabular-nums transition-colors hover:bg-hover hover:text-fg-muted"
      >
        {label}
      </button>
    </Tooltip>
  )
}

function Line({ label, value, indent }: { label: string; value: string; indent?: boolean }) {
  return (
    <span className="flex items-baseline justify-between gap-4">
      <span className={indent ? 'pl-2 text-fg-subtle' : 'text-fg-muted'}>{label}</span>
      <span className="text-fg">{value}</span>
    </span>
  )
}
