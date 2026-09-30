/**
 * State of the insights feature: persisted panel preferences, the latest document analysis and
 * transient Issues panel state. None of it is part of the document or its history.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { TARGET_IDS, type TargetId } from '@/lottie/compat'
import type { Animation } from '@/lottie/types'
import type { Severity } from '@/lottie/validate'
import type { AnalysisResult } from './analysis'

/* -------------------------------- Preferences ------------------------------- */

export interface InsightsPrefs {
  /** Players the Issues panel checks for. */
  target: TargetId
  /** Collapsed severity groups. */
  collapsed: Partial<Record<Severity, boolean>>
}

const defaults: InsightsPrefs = { target: 'all', collapsed: {} }

export const useInsightsPrefs = create<InsightsPrefs>()(
  persist(() => defaults, {
    name: 'lottie-editor:insights',
    version: 1,
    merge: (persisted, current) => {
      const p = (persisted ?? {}) as Partial<InsightsPrefs>
      return {
        ...current,
        ...p,
        // A target removed in a later version falls back to every player.
        target: p.target && TARGET_IDS.includes(p.target) ? p.target : current.target,
      }
    },
  }),
)

export function setTarget(target: TargetId): void {
  useInsightsPrefs.setState({ target })
}

export function toggleGroup(severity: Severity, collapsed?: boolean): void {
  useInsightsPrefs.setState((s) => ({
    collapsed: { ...s.collapsed, [severity]: collapsed ?? !s.collapsed[severity] },
  }))
}

/* --------------------------------- Analysis --------------------------------- */

export interface AnalysisState {
  /** Latest finished analysis. It may describe an older revision: compare `doc`. */
  result: AnalysisResult | null
  /** The document object `result` describes (paths in the result point into it). */
  doc: Animation | null
  /** Document session (`meta.id`) the state belongs to. */
  docId: string | null
  /** The open document changed since `doc` and is waiting to be analyzed. */
  pending: boolean
}

export const EMPTY_ANALYSIS: AnalysisState = {
  result: null,
  doc: null,
  docId: null,
  pending: false,
}

export const useAnalysis = create<AnalysisState>()(() => EMPTY_ANALYSIS)

/* ------------------------------ Issues panel UI ----------------------------- */

export interface IssuesUi {
  /** Expanded issue rows by issue id. */
  expanded: Record<string, boolean>
  /** Issues fixed since the last analysis: hidden until the next analysis confirms it. */
  fixed: ReadonlySet<string>
  /** Row the keyboard is on (row key). */
  active: string | null
}

const NO_IDS: ReadonlySet<string> = new Set()

export const useIssuesUi = create<IssuesUi>()(() => ({ expanded: {}, fixed: NO_IDS, active: null }))

export function toggleExpanded(id: string, expanded?: boolean): void {
  useIssuesUi.setState((s) => ({ expanded: { ...s.expanded, [id]: expanded ?? !s.expanded[id] } }))
}

export function setActiveRow(key: string | null): void {
  useIssuesUi.setState((s) => (s.active === key ? s : { active: key }))
}

export function markFixed(ids: readonly string[]): void {
  if (!ids.length) return
  useIssuesUi.setState((s) => ({ fixed: new Set([...s.fixed, ...ids]) }))
}

export function clearFixed(): void {
  useIssuesUi.setState((s) => (s.fixed.size ? { fixed: NO_IDS } : s))
}

/** Forgets per-document panel state (another file was opened). */
export function resetIssuesUi(): void {
  useIssuesUi.setState({ expanded: {}, fixed: NO_IDS, active: null })
}
