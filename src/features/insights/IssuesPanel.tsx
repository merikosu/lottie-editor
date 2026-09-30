/**
 * Issues tab of the right sidebar: problems that break or degrade playback, graded for the
 * players the user targets, with safe one-click fixes, a verdict per player and the places
 * each problem occurs.
 */
import { CircleAlert, CircleCheck, Wrench } from 'lucide-react'
import { Button, EmptyState, Select, Spinner, Tooltip, type SelectOption } from '@/components/ui'
import type { IconProps } from '@/commands/registry'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { TARGET_IDS, TARGETS, type PlayerId, type TargetId } from '@/lottie/compat'
import type { IssueSummary } from '@/lottie/validate'
import { useDocument } from '@/store/document'
import { fixAllSafe } from './actions'
import { retryAnalysis } from './engine'
import { levelText } from './format'
import { IssueList } from './IssueList'
import { LevelIcon, SeverityIcon } from './parts'
import { setTarget } from './store'
import { useDelayed } from './useDelayed'
import { useIssuesView, type IssuesView } from './view'

export function IssuesPanel() {
  const t = useT()
  const hasDoc = useDocument((s) => s.doc !== null)
  const view = useIssuesView()
  if (!hasDoc) return <EmptyState title={t.common.noDocument} />
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="issues-panel">
      <Toolbar view={view} />
      <Body view={view} />
    </div>
  )
}

/* ---------------------------------- Toolbar --------------------------------- */

function Toolbar({ view }: { view: IssuesView }) {
  const t = useT()
  const options: SelectOption<TargetId>[] = TARGET_IDS.map((id) => ({
    value: id,
    label: t.insights.targets[id],
    hint: t.insights.targetHints[id] || undefined,
  }))
  const fixable = view.summary.fixable
  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-line pr-1.5 pl-2">
      <Select<TargetId>
        value={view.target}
        onValueChange={setTarget}
        options={options}
        aria-label={t.insights.panel.target}
        className="w-auto max-w-[60%] min-w-0"
        contentClassName="min-w-48"
      />
      <Stale pending={view.pending && view.status === 'ready'} />
      <div className="ml-auto flex shrink-0 items-center">
        {fixable > 0 && (
          <Tooltip content={t.insights.panel.fixAllHint(fixable)} side="bottom">
            <Button
              size="sm"
              variant="secondary"
              icon={Wrench}
              onClick={() => fixAllSafe()}
              data-testid="issues-fix-all"
            >
              {t.insights.panel.fixAll}
              <span className="ml-1 text-fg-subtle tabular-nums">{fixable}</span>
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}

/** A spinner while a big file is re-analyzed (the list keeps its previous content meanwhile). */
function Stale({ pending }: { pending: boolean }) {
  const t = useT()
  const visible = useDelayed(pending, 600)
  if (!visible) return null
  return (
    <Tooltip content={t.insights.panel.stale} side="bottom">
      <output
        className="flex size-5 shrink-0 items-center justify-center"
        aria-label={t.insights.panel.stale}
      >
        <Spinner size={12} />
      </output>
    </Tooltip>
  )
}

/* ----------------------------------- Body ----------------------------------- */

function SuccessIcon({ className, size }: IconProps) {
  return <CircleCheck size={size} className={cn(className, 'text-success')} />
}

function Body({ view }: { view: IssuesView }) {
  const t = useT()
  const checking = useDelayed(view.status === 'checking', 300)
  if (view.status === 'checking') {
    return checking ? (
      <output className="flex flex-1 items-center justify-center gap-2 text-xs text-fg-subtle">
        <Spinner size={12} />
        {t.insights.panel.checking}
      </output>
    ) : null
  }
  if (view.status === 'failed') {
    return (
      <EmptyState
        icon={CircleAlert}
        title={t.insights.panel.failed}
        description={t.insights.panel.failedHint}
        action={
          <Button size="sm" variant="secondary" onClick={retryAnalysis}>
            {t.insights.panel.retry}
          </Button>
        }
      />
    )
  }
  if (view.issues.length === 0) {
    return (
      <EmptyState
        icon={SuccessIcon}
        title={t.insights.panel.noIssues}
        description={
          view.target === 'all'
            ? t.insights.panel.compatibleAll
            : t.insights.panel.compatibleWith(t.insights.targets[view.target])
        }
        className="flex-1"
      />
    )
  }
  // With one player the group headers already say everything the summary would.
  const multiPlayer = TARGETS[view.target].length > 1
  return (
    <>
      {multiPlayer && <Summary summary={view.summary} levels={view.levels} target={view.target} />}
      <IssueList issues={view.issues} doc={view.doc} showPlayers={multiPlayer} />
    </>
  )
}

/* ---------------------------------- Summary --------------------------------- */

function Summary({
  summary,
  levels,
  target,
}: {
  summary: IssueSummary
  levels: IssuesView['levels']
  target: TargetId
}) {
  const t = useT()
  const panel = t.insights.panel
  const counts = [
    { severity: 'error' as const, n: summary.errors, text: panel.errors(summary.errors) },
    { severity: 'warning' as const, n: summary.warnings, text: panel.warnings(summary.warnings) },
    { severity: 'info' as const, n: summary.infos, text: panel.infos(summary.infos) },
  ].filter((c) => c.n > 0)
  return (
    <div
      className="flex shrink-0 flex-col gap-2 border-b border-line px-3 pt-2 pb-2.5"
      data-testid="issues-summary"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted tabular-nums">
        {counts.map((c) => (
          <span key={c.severity} className="inline-flex items-center gap-1">
            <SeverityIcon severity={c.severity} size={12} />
            {c.text}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-1" aria-label={t.insights.panel.players}>
        {(TARGETS[target] as readonly PlayerId[]).map((player) => {
          const level = levels[player] ?? 'y'
          const names = t.insights.players[player]
          return (
            <Tooltip
              key={player}
              content={panel.playerVerdict(names.full, levelText(player, level, t))}
              side="bottom"
            >
              <span
                className="inline-flex h-5 items-center gap-1 rounded-sm bg-surface-2 pr-1.5 pl-1 text-xs text-fg-muted"
                data-testid={`issues-player-${player}`}
                data-level={level}
              >
                <LevelIcon level={level} size={12} />
                {names.short}
              </span>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
