/**
 * The inspector edits legacy files (bodymovin < 5.5, `e` end values) and source-text keys
 * through the foundation helpers inside immer recipes: guard that this keeps working.
 */
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import {
  insertKeyframe,
  normalizeLegacyKeyframes,
  setKeyframeTime,
  setKeyframeValue,
  setSegmentEasing,
} from '@/lottie/keyframes'
import { evaluateArray, type AnyProperty } from '@/lottie/property'

function legacyDoc() {
  return {
    p: {
      a: 1,
      k: [
        { t: 0, s: [0, 0], e: [100, 50], o: { x: 0.2, y: 0.2 }, i: { x: 0.8, y: 0.8 } },
        { t: 10, s: [100, 50], e: [0, 0], o: { x: 0.2, y: 0.2 }, i: { x: 0.8, y: 0.8 } },
        { t: 20 },
      ],
    } as AnyProperty,
  }
}

describe('legacy keyframes in recipes', () => {
  it('converts legacy end values inside an immer recipe', () => {
    const doc = legacyDoc()
    const next = produce(doc, (d) => {
      normalizeLegacyKeyframes(d.p)
    })
    expect(next.p.k).toEqual([
      { t: 0, s: [0, 0], o: { x: 0.2, y: 0.2 }, i: { x: 0.8, y: 0.8 } },
      { t: 10, s: [100, 50], o: { x: 0.2, y: 0.2 }, i: { x: 0.8, y: 0.8 } },
      { t: 20, s: [0, 0] },
    ])
    // The original is untouched and the new value is not aliased.
    expect((doc.p.k as { e?: unknown }[])[0].e).toEqual([100, 50])
    for (let f = 0; f <= 20; f += 2.5)
      expect(evaluateArray(next.p, f)).toEqual(evaluateArray(doc.p, f))
  })

  it('lets the keyframe helpers edit legacy keyframes in recipes', () => {
    const next = produce(legacyDoc(), (d) => {
      setKeyframeValue(d.p, 1, [7, 7])
      setSegmentEasing(d.p, 0, [0.33, 0, 0.67, 1])
      insertKeyframe(d.p, 15)
    })
    const kfs = next.p.k as { t: number; s?: number[]; e?: unknown }[]
    expect(kfs.map((k) => k.t)).toEqual([0, 10, 15, 20])
    expect(kfs[1].s).toEqual([7, 7])
    expect(kfs.some((k) => k.e !== undefined)).toBe(false)
  })

  it('moves source-text keys without adding easing', () => {
    const text = {
      k: [
        { t: 0, s: { t: 'a', s: 10, f: 'x' } },
        { t: 10, s: { t: 'b', s: 10, f: 'x' } },
      ],
    } as AnyProperty
    const next = produce({ text }, (d) => {
      expect(setKeyframeTime(d.text, 0, 12)).toBe(1)
    })
    const kfs = next.text.k as { t: number; o?: unknown; i?: unknown }[]
    expect(kfs.map((k) => k.t)).toEqual([10, 12])
    expect(kfs.some((k) => k.o || k.i)).toBe(false)
    expect((next.text as { a?: number }).a).toBeUndefined()
  })
})
