/**
 * The Issues panel as a flat list of rows (severity groups, issues, expanded details, places),
 * so it can be virtualized: a file can have thousands of places for one issue.
 */
import type { NodePath } from '@/lottie/path'
import type { Issue, Severity } from '@/lottie/validate'
import { SEVERITIES } from './format'

export type Row =
  | { kind: 'group'; key: string; severity: Severity; count: number; collapsed: boolean }
  | { kind: 'issue'; key: string; issue: Issue; expanded: boolean }
  | { kind: 'details'; key: string; issue: Issue }
  | { kind: 'place'; key: string; issue: Issue; path: NodePath; index: number }
  | { kind: 'more'; key: string; issue: Issue; hidden: number }

/** Row heights in px; details rows are measured (this is their estimate). */
export const ROW_HEIGHTS: Record<Row['kind'], number> = {
  group: 28,
  issue: 44,
  details: 96,
  place: 24,
  more: 24,
}

/** Places are listed when an issue occurs in more than one. */
export function hasPlaces(issue: Issue): boolean {
  return issue.paths.length > 1
}

/** Rows the keyboard moves between (details hold buttons reached with Tab). */
export function isNavigable(row: Row): boolean {
  return row.kind !== 'details'
}

export function buildRows(
  issues: readonly Issue[],
  expanded: Readonly<Record<string, boolean>>,
  collapsed: Readonly<Partial<Record<Severity, boolean>>>,
): Row[] {
  const rows: Row[] = []
  for (const severity of SEVERITIES) {
    const list = issues.filter((i) => i.severity === severity)
    if (!list.length) continue
    const groupCollapsed = !!collapsed[severity]
    rows.push({
      kind: 'group',
      key: `g:${severity}`,
      severity,
      count: list.length,
      collapsed: groupCollapsed,
    })
    if (groupCollapsed) continue
    for (const issue of list) {
      const open = !!expanded[issue.id]
      rows.push({ kind: 'issue', key: `i:${issue.id}`, issue, expanded: open })
      if (!open) continue
      rows.push({ kind: 'details', key: `d:${issue.id}`, issue })
      if (!hasPlaces(issue)) continue
      issue.paths.forEach((path, index) =>
        rows.push({ kind: 'place', key: `p:${issue.id}:${index}`, issue, path, index }),
      )
      if (issue.count > issue.paths.length) {
        rows.push({
          kind: 'more',
          key: `m:${issue.id}`,
          issue,
          hidden: issue.count - issue.paths.length,
        })
      }
    }
  }
  return rows
}

/** Index of the issue (or group) row a row belongs to, for "move to parent". */
export function parentIndex(rows: readonly Row[], index: number): number {
  const row = rows[index]
  if (!row) return -1
  const wanted: Row['kind'] = row.kind === 'issue' ? 'group' : 'issue'
  if (row.kind === 'group') return -1
  for (let i = index - 1; i >= 0; i--) {
    const r = rows[i]
    if (
      r.kind === wanted &&
      (wanted === 'group' || (r.kind === 'issue' && r.issue.id === row.issue.id))
    )
      return i
  }
  return -1
}
