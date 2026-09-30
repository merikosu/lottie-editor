/**
 * Derived data for the insights UI: the issues for the chosen players (re-graded for them, minus
 * fixes waiting for the next analysis to confirm them), their counts and the verdict per player.
 */
import type { Level, PlayerId, TargetId } from '@/lottie/compat'
import type { Animation } from '@/lottie/types'
import {
  issuesForTarget,
  playerLevels,
  summarizeIssues,
  type Issue,
  type IssueSummary,
} from '@/lottie/validate'
import type { AnalysisResult } from './analysis'
import { useAnalysisSubscription } from './engine'
import { useAnalysis, useInsightsPrefs, useIssuesUi } from './store'

export interface TargetView {
  issues: Issue[]
  summary: IssueSummary
  /** Worst support level per player of the target ('y' = no problem). */
  levels: Record<PlayerId, Level>
}

const EMPTY_VIEW: TargetView = {
  issues: [],
  summary: { errors: 0, warnings: 0, infos: 0, fixable: 0 },
  levels: {} as Record<PlayerId, Level>,
}

let cache: {
  issues: readonly Issue[]
  target: TargetId
  fixed: ReadonlySet<string>
  view: TargetView
} | null = null

/** Issues of the target (memoized: every consumer shares one computation per analysis). */
export function targetView(
  issues: readonly Issue[] | null,
  target: TargetId,
  fixed: ReadonlySet<string>,
): TargetView {
  if (!issues) return EMPTY_VIEW
  if (cache && cache.issues === issues && cache.target === target && cache.fixed === fixed)
    return cache.view
  const visible = issuesForTarget(issues, target).filter((i) => !fixed.has(i.id))
  const view: TargetView = {
    issues: visible,
    summary: summarizeIssues(visible),
    levels: playerLevels(visible, target),
  }
  cache = { issues, target, fixed, view }
  return view
}

export type AnalysisStatus = 'checking' | 'failed' | 'ready'

export interface IssuesView extends TargetView {
  status: AnalysisStatus
  target: TargetId
  /** The analyzed document (issue paths point into it). */
  doc: Animation | null
  result: AnalysisResult | null
  /** The document changed since the analysis; an update is on its way. */
  pending: boolean
}

/** Everything the Issues panel shows. Keeps the analysis running while mounted. */
export function useIssuesView(): IssuesView {
  useAnalysisSubscription()
  const result = useAnalysis((s) => s.result)
  const doc = useAnalysis((s) => s.doc)
  const pending = useAnalysis((s) => s.pending)
  const target = useInsightsPrefs((s) => s.target)
  const fixed = useIssuesUi((s) => s.fixed)
  const view = targetView(result?.issues ?? null, target, fixed)
  const status: AnalysisStatus = !result ? 'checking' : result.issues === null ? 'failed' : 'ready'
  return { ...view, status, target, doc, result, pending }
}
