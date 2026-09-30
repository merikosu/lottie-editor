import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadDocument, redo, undo, useDocument } from '@/store/document'
import { setFrame, setWorkArea, usePlayback } from '@/store/playback'
import type { Animation } from '@/lottie/types'
import { applyDuration, applySpeed, reverse, trimToWorkArea } from '../actions'
import { trackSpeedLedger, trackTimeEdits } from '../store'

function doc(): Animation {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 3,
        ind: 1,
        ip: 0,
        op: 60,
        st: 0,
        ks: {
          o: {
            a: 1,
            k: [
              { t: 0, s: [0] },
              { t: 60, s: [100] },
            ],
          },
        },
      } as never,
    ],
  }
}

const place = () => {
  const { frame, workArea } = usePlayback.getState()
  return { frame, workArea }
}

let stop: (() => void)[] = []

describe('the playhead follows undo and redo of time edits', () => {
  beforeEach(() => {
    stop = [trackSpeedLedger(), trackTimeEdits()]
    loadDocument(doc(), { fileName: 'a.json' })
  })
  afterEach(() => stop.forEach((s) => s()))

  it('keeps showing the same moment through a speed change, its undo and its redo', () => {
    setFrame(40)
    setWorkArea({ start: 10, end: 50 })
    expect(applySpeed(2)).toBe(true)
    expect(useDocument.getState().doc!.op).toBe(30)
    expect(place()).toEqual({ frame: 20, workArea: { start: 5, end: 25 } })
    undo()
    expect(useDocument.getState().doc!.op).toBe(60)
    expect(place()).toEqual({ frame: 40, workArea: { start: 10, end: 50 } })
    redo()
    expect(place()).toEqual({ frame: 20, workArea: { start: 5, end: 25 } })
  })

  it('restores the exact place when nothing moved since the edit', () => {
    loadDocument({ ...doc(), op: 179 }, { fileName: 'odd.json' })
    setFrame(120)
    setWorkArea({ start: 50, end: 150 })
    applySpeed(2) // 179 → 90 frames: 120 → 60.3, rounded to 60
    expect(place()).toEqual({ frame: 60, workArea: { start: 25, end: 75 } })
    undo()
    expect(place()).toEqual({ frame: 120, workArea: { start: 50, end: 150 } })
    redo()
    expect(place()).toEqual({ frame: 60, workArea: { start: 25, end: 75 } })
  })

  it('reads the place from before the range shrank on undo', () => {
    applyDuration(4)
    expect(useDocument.getState().doc!.op).toBe(120)
    // Moved after the edit, beyond the range the undo goes back to.
    setFrame(110)
    undo()
    expect(place().frame).toBe(55)
  })

  it('brings back the work area consumed by a trim', () => {
    setFrame(30)
    setWorkArea({ start: 20, end: 40 })
    expect(trimToWorkArea()).toBe(true)
    expect(useDocument.getState().doc).toMatchObject({ ip: 0, op: 20 })
    expect(place()).toEqual({ frame: 10, workArea: null })
    undo()
    expect(place()).toEqual({ frame: 30, workArea: { start: 20, end: 40 } })
    redo()
    expect(place()).toEqual({ frame: 10, workArea: null })
  })

  it('composes several edits undone at once', () => {
    setFrame(12)
    setWorkArea({ start: 6, end: 30 })
    applySpeed(2) // 12 → 6, work area 3..15
    reverse() // pivot 30: 6 → 24, work area 15..27
    expect(place()).toEqual({ frame: 24, workArea: { start: 15, end: 27 } })
    undo()
    undo()
    expect(place()).toEqual({ frame: 12, workArea: { start: 6, end: 30 } })
    redo()
    redo()
    expect(place()).toEqual({ frame: 24, workArea: { start: 15, end: 27 } })
  })

  it('forgets everything for another document', () => {
    applySpeed(2)
    loadDocument(doc(), { fileName: 'b.json' })
    setFrame(10)
    undo()
    expect(place().frame).toBe(10)
  })
})
