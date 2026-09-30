import { describe, expect, it } from 'vitest'
import type { Issue } from '@/lottie/validate'
import { buildRows, isNavigable, parentIndex } from '../rows'
import { targetView } from '../view'

function issue(
  id: string,
  severity: Issue['severity'],
  paths: (string | number)[][],
  count = paths.length,
): Issue {
  return { id, severity, code: 'compat', params: {}, paths, count }
}

const ISSUES: Issue[] = [
  issue('w1', 'warning', [['layers', 0]]),
  issue('e1', 'error', [
    ['layers', 0],
    ['layers', 1],
  ]),
  issue('i1', 'info', [['layers', 2]]),
  issue(
    'e2',
    'error',
    [
      ['layers', 3],
      ['layers', 4],
    ],
    5000,
  ),
]

describe('issue rows', () => {
  it('groups by severity, errors first, keeping the issue order', () => {
    const rows = buildRows(ISSUES, {}, {})
    expect(rows.map((r) => r.key)).toEqual([
      'g:error',
      'i:e1',
      'i:e2',
      'g:warning',
      'i:w1',
      'g:info',
      'i:i1',
    ])
    expect(rows[0]).toMatchObject({ kind: 'group', count: 2, collapsed: false })
  })

  it('hides the issues of collapsed groups', () => {
    const rows = buildRows(ISSUES, {}, { error: true })
    expect(rows.map((r) => r.key)).toEqual(['g:error', 'g:warning', 'i:w1', 'g:info', 'i:i1'])
  })

  it('expands an issue into details, its places and the unlisted rest', () => {
    const rows = buildRows(ISSUES, { e2: true, w1: true }, {})
    expect(rows.map((r) => r.key)).toEqual([
      'g:error',
      'i:e1',
      'i:e2',
      'd:e2',
      'p:e2:0',
      'p:e2:1',
      'm:e2',
      'g:warning',
      'i:w1',
      'd:w1',
      'g:info',
      'i:i1',
    ])
    const more = rows.find((r) => r.kind === 'more')
    expect(more).toMatchObject({ hidden: 4998 })
    // A single place is shown on the issue row itself.
    expect(rows.some((r) => r.key.startsWith('p:w1'))).toBe(false)
    expect(rows.filter((r) => !isNavigable(r)).map((r) => r.key)).toEqual(['d:e2', 'd:w1'])
  })

  it('finds the parent row for keyboard navigation', () => {
    const rows = buildRows(ISSUES, { e2: true }, {})
    const index = (key: string) => rows.findIndex((r) => r.key === key)
    expect(parentIndex(rows, index('p:e2:1'))).toBe(index('i:e2'))
    expect(parentIndex(rows, index('m:e2'))).toBe(index('i:e2'))
    expect(parentIndex(rows, index('i:e2'))).toBe(index('g:error'))
    expect(parentIndex(rows, index('i:w1'))).toBe(index('g:warning'))
    expect(parentIndex(rows, index('g:error'))).toBe(-1)
  })
})

describe('target view', () => {
  it('hides fixed issues and shares one computation per analysis', () => {
    const fixed = new Set(['e1'])
    const a = targetView(ISSUES, 'all', fixed)
    expect(a.issues.map((i) => i.id)).toEqual(['e2', 'w1', 'i1'])
    expect(a.summary).toMatchObject({ errors: 1, warnings: 1, infos: 1 })
    expect(targetView(ISSUES, 'all', fixed)).toBe(a)
    expect(targetView(ISSUES, 'ios', fixed)).not.toBe(a)
    expect(targetView(null, 'all', fixed).issues).toEqual([])
  })
})
