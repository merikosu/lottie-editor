import { describe, expect, it } from 'vitest'
import { INITIAL_TRACKER, buildHistoryRows, trackBase, type BaseTracker } from '../model'
import { formatFullTime, formatHistoryTime, nextTimeChange } from '../time'

const step = (id: number, label = `Step ${id}`, time = id * 1000) => ({ id, label, time })
const initial = { label: 'Opened a.json', time: 0 }

describe('buildHistoryRows', () => {
  it('has only the initial state for a fresh document', () => {
    const rows = buildHistoryRows([], [], initial)
    expect(rows).toEqual([
      {
        index: 0,
        key: 'initial',
        label: 'Opened a.json',
        time: 0,
        state: 'current',
        initial: true,
      },
    ])
  })

  it('marks past, current and future steps with jump indices', () => {
    const rows = buildHistoryRows([step(1), step(2)], [step(3), step(4)], initial)
    expect(rows.map((r) => [r.index, r.label, r.state])).toEqual([
      [0, 'Opened a.json', 'past'],
      [1, 'Step 1', 'past'],
      [2, 'Step 2', 'current'],
      [3, 'Step 3', 'future'],
      [4, 'Step 4', 'future'],
    ])
  })

  it('makes the initial state current when everything is undone', () => {
    const rows = buildHistoryRows([], [step(1), step(2)], initial)
    expect(rows.map((r) => r.state)).toEqual(['current', 'future', 'future'])
  })

  it('uses step ids as stable keys', () => {
    const rows = buildHistoryRows([step(7)], [step(9)], initial)
    expect(rows.map((r) => r.key)).toEqual(['initial', 'step-7', 'step-9'])
  })
})

const run = (states: [string | null, number[]][]): BaseTracker =>
  states.reduce<BaseTracker>(
    (acc, [key, ids]) =>
      trackBase(
        acc,
        key,
        ids.map((id) => ({ id })),
      ),
    INITIAL_TRACKER,
  )

describe('trackBase', () => {
  it('is not truncated while steps are appended, undone and redone', () => {
    expect(
      run([
        ['a', []],
        ['a', [1]],
        ['a', [1, 2]],
        ['a', [1]],
        ['a', []],
        ['a', [1]],
      ]).truncated,
    ).toBe(false)
  })

  it('is not truncated when a new step replaces undone ones', () => {
    // Undo everything, then edit: the first step is new but the opened state is still reachable.
    expect(
      run([
        ['a', [1, 2]],
        ['a', [1]],
        ['a', []],
        ['a', [3]],
      ]).truncated,
    ).toBe(false)
  })

  it('detects the oldest step being dropped', () => {
    const t = run([
      ['a', [1, 2, 3]],
      ['a', [2, 3, 4]],
    ])
    expect(t.truncated).toBe(true)
  })

  it('stays truncated after undoing everything', () => {
    expect(
      run([
        ['a', [1, 2]],
        ['a', [2, 3]],
        ['a', [2]],
        ['a', []],
      ]).truncated,
    ).toBe(true)
  })

  it('resets for another document', () => {
    expect(
      run([
        ['a', [1, 2]],
        ['a', [2, 3]],
        ['b', []],
      ]).truncated,
    ).toBe(false)
    expect(
      run([
        ['a', [1, 2]],
        ['a', [2, 3]],
        [null, []],
      ]).truncated,
    ).toBe(false)
  })

  it('returns the same object when nothing changed', () => {
    const a = trackBase(INITIAL_TRACKER, 'a', [{ id: 1 }])
    expect(trackBase(a, 'a', [{ id: 1 }, { id: 2 }])).toBe(a)
  })
})

describe('formatHistoryTime', () => {
  const s = { justNow: 'now', minutes: (n: number) => `${n} min` }
  const now = new Date(2026, 8, 29, 14, 30, 0).getTime()

  it('shows "now" under a minute and minutes under an hour', () => {
    expect(formatHistoryTime(now - 5_000, now, 'en', s)).toBe('now')
    expect(formatHistoryTime(now + 5_000, now, 'en', s)).toBe('now')
    expect(formatHistoryTime(now - 60_000, now, 'en', s)).toBe('1 min')
    expect(formatHistoryTime(now - 59 * 60_000, now, 'en', s)).toBe('59 min')
  })

  it('shows the clock time later the same day', () => {
    const t = new Date(2026, 8, 29, 9, 5, 0).getTime()
    expect(formatHistoryTime(t, now, 'ru', s)).toBe('09:05')
    expect(formatHistoryTime(t, now, 'en-US', s)).toMatch(/^9:05\s?AM$/)
  })

  it('shows the date for earlier days', () => {
    const t = new Date(2026, 8, 27, 9, 5, 0).getTime()
    expect(formatHistoryTime(t, now, 'en-US', s)).toBe('Sep 27')
  })

  it('formats full timestamps for tooltips', () => {
    expect(formatFullTime(now, 'en-US')).toContain('2026')
  })
})

describe('nextTimeChange', () => {
  it('counts down to the next minute boundary within the hour', () => {
    expect(nextTimeChange(0, 10_000)).toBe(50_000)
    expect(nextTimeChange(0, 60_000)).toBe(60_000)
    expect(nextTimeChange(0, 3_600_000)).toBeNull()
  })
})
