import { CircleCheck } from 'lucide-react'
import { Tooltip } from '@/components/ui'
import { useT } from '@/i18n'
import { openIssuesPanel } from './actions'
import { SeverityIcon } from './parts'
import { useAnalysis } from './store'
import { useIssueSummary } from './useIssueSummary'

/** Status bar issues badge (errors and warnings for the chosen players); opens the Issues tab. */
export function IssuesIndicator() {
  const t = useT()
  const { errors, warnings } = useIssueSummary()
  const ready = useAnalysis((s) => s.result?.issues != null)
  if (!ready) return null
  const panel = t.insights.panel
  const none = errors === 0 && warnings === 0
  const parts = [
    errors ? panel.errors(errors) : '',
    warnings ? panel.warnings(warnings) : '',
  ].filter(Boolean)
  const summary = parts.join(' · ')
  return (
    <Tooltip
      content={none ? t.insights.indicator.noneTooltip : t.insights.indicator.tooltip(summary)}
      side="top"
      align="end"
    >
      <button
        type="button"
        onClick={openIssuesPanel}
        aria-label={none ? t.insights.indicator.none : t.insights.indicator.label(summary)}
        data-testid="issues-indicator"
        className="-mx-1.5 flex h-5 items-center gap-2 rounded-sm px-1.5 text-fg-subtle tabular-nums transition-colors hover:bg-hover hover:text-fg-muted"
      >
        {none ? (
          <span className="flex items-center gap-1">
            <CircleCheck size={12} aria-hidden className="text-fg-subtle" />
            {t.insights.indicator.none}
          </span>
        ) : (
          <>
            {errors > 0 && (
              <span className="flex items-center gap-1">
                <SeverityIcon severity="error" size={12} />
                {errors}
              </span>
            )}
            {warnings > 0 && (
              <span className="flex items-center gap-1">
                <SeverityIcon severity="warning" size={12} />
                {warnings}
              </span>
            )}
          </>
        )}
      </button>
    </Tooltip>
  )
}
