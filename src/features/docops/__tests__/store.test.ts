import { beforeEach, describe, expect, it } from 'vitest'
import { loadDocument, redo, undo, updateDoc, useDocument } from '@/store/document'
import type { Animation } from '@/lottie/types'
import { recordSpeedChange, speedOf, trackSpeedLedger } from '../store'

function doc(): Animation {
  return { v: '5.7.0', fr: 30, ip: 0, op: 60, w: 100, h: 100, layers: [] }
}

let edit = 0
/** Commits a trivial edit (a new history entry). */
function touch(): void {
  updateDoc('Edit', (d) => {
    d.nm = `edit ${++edit}`
  })
}

/** Commits an edit that changed the speed by `factor`. */
function speedEdit(factor: number): void {
  touch()
  recordSpeedChange(factor)
}

let stopTracking: (() => void) | null = null

describe('speed ledger', () => {
  beforeEach(() => {
    stopTracking?.()
    stopTracking = trackSpeedLedger()
    loadDocument(doc(), { fileName: 'a.json' })
  })

  it('multiplies the changes that are in the history', () => {
    expect(speedOf()).toBe(1)
    speedEdit(2)
    touch()
    speedEdit(0.75)
    expect(speedOf()).toBeCloseTo(1.5)
  })

  it('follows undo and redo', () => {
    speedEdit(2)
    speedEdit(3)
    undo()
    expect(speedOf()).toBe(2)
    undo()
    expect(speedOf()).toBe(1)
    redo()
    redo()
    expect(speedOf()).toBe(6)
  })

  it('forgets a redo branch discarded by a new edit', () => {
    speedEdit(2)
    undo()
    touch()
    expect(useDocument.getState().future).toHaveLength(0)
    expect(speedOf()).toBe(1)
    undo()
    expect(speedOf()).toBe(1)
  })

  it('keeps changes that fell off the history limit', () => {
    speedEdit(2)
    for (let i = 0; i < 320; i++) touch()
    expect(useDocument.getState().past.length).toBeLessThanOrEqual(300)
    expect(speedOf()).toBe(2)
  })

  it('resets for another document', () => {
    speedEdit(2)
    loadDocument(doc(), { fileName: 'b.json' })
    expect(speedOf()).toBe(1)
  })

  it('ignores no-op factors and edits that did not commit', () => {
    recordSpeedChange(1)
    recordSpeedChange(Number.NaN)
    expect(speedOf()).toBe(1)
  })
})
