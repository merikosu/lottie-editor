import { useAnalysisSubscription } from './engine'
import { useAnalysis, useInsightsPrefs, useIssuesUi } from './store'
import { targetView } from './view'

/**
 * Number of validation errors and warnings in the current document, for the players chosen in
 * the Issues panel. Updates shortly after edits settle (the analysis runs off the main thread).
 */
export function useIssueSummary(): { errors: number; warnings: number } {
  useAnalysisSubscription()
  const issues = useAnalysis((s) => s.result?.issues ?? null)
  const target = useInsightsPrefs((s) => s.target)
  const fixed = useIssuesUi((s) => s.fixed)
  const { summary } = targetView(issues, target, fixed)
  return { errors: summary.errors, warnings: summary.warnings }
}
