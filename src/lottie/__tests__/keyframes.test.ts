import { describe, expect, it } from 'vitest'
import {
  applyEasyEase,
  findKeyframeAt,
  insertKeyframe,
  makeAnimated,
  makeStatic,
  moveKeyframes,
  normalizeLegacyKeyframes,
  removeKeyframes,
  setSegmentEasing,
  setValueAtFrame,
} from '../keyframes'
import { evaluateArray, getKeyframes } from '../property'
import type { Keyframe, ScalarProperty, VectorProperty } from '../types'

const linear = () => ({ o: { x: 0.167, y: 0.167 }, i: { x: 0.833, y: 0.833 } })

function animatedScalar(): ScalarProperty {
  return {
    a: 1,
    k: [
      { t: 0, s: [0], ...linear() },
      { t: 10, s: [100] },
    ],
  }
}

describe('makeAnimated / makeStatic', () => {
  it('round-trips scalar properties keeping the scalar static form', () => {
    const p: ScalarProperty = { a: 0, k: 45 }
    makeAnimated(p, 12)
    expect(p.a).toBe(1)
    expect(p.k).toEqual([{ t: 12, s: [45] }])
    makeStatic(p, 12)
    expect(p).toEqual({ a: 0, k: 45 })
  })
  it('keeps the value at the given frame when going static', () => {
    const p = animatedScalar()
    makeStatic(p, 5)
    expect(p.a).toBe(0)
    expect(p.k as number).toBeCloseTo(50, 0)
  })
  it('handles vectors', () => {
    const p: VectorProperty = { a: 0, k: [1, 2, 3] }
    makeAnimated(p, 0)
    expect(p.k).toEqual([{ t: 0, s: [1, 2, 3] }])
  })
})

describe('insertKeyframe', () => {
  it('splits a segment and copies its easing', () => {
    const p = animatedScalar()
    const idx = insertKeyframe(p, 5)
    const kfs = getKeyframes<number[]>(p)!
    expect(idx).toBe(1)
    expect(kfs.map((k) => k.t)).toEqual([0, 5, 10])
    expect(kfs[1].s![0]).toBeCloseTo(50, 0)
    expect(kfs[1].o).toEqual({ x: 0.167, y: 0.167 })
    expect(kfs[1].i).toEqual({ x: 0.833, y: 0.833 })
  })
  it('appends after the last keyframe and gives the old last keyframe handles', () => {
    const p = animatedScalar()
    insertKeyframe(p, 20, 30)
    const kfs = getKeyframes<number[]>(p)!
    expect(kfs.map((k) => k.t)).toEqual([0, 10, 20])
    expect(kfs[1].o).toBeDefined()
    expect(kfs[1].i).toBeDefined()
    expect(evaluateArray(p, 20)).toEqual([30])
  })
  it('prepends before the first keyframe', () => {
    const p = animatedScalar()
    insertKeyframe(p, -5, -20)
    const kfs = getKeyframes(p)!
    expect(kfs.map((k) => k.t)).toEqual([-5, 0, 10])
    expect(kfs[0].o).toBeDefined()
  })
  it('replaces the value when a keyframe already exists at the frame', () => {
    const p = animatedScalar()
    insertKeyframe(p, 10, 77)
    expect(getKeyframes<number[]>(p)!.length).toBe(2)
    expect(evaluateArray(p, 10)).toEqual([77])
  })
  it('preserves the motion path shape when splitting a spatial segment', () => {
    const p: VectorProperty = {
      a: 1,
      k: [
        { t: 0, s: [0, 0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 }, to: [0, -100], ti: [0, -100] },
        { t: 10, s: [100, 0] },
      ],
    }
    const samples = [2, 4, 6, 8].map((f) => evaluateArray(p, f))
    const before = evaluateArray(p, 5)
    insertKeyframe(p, 5)
    const after = evaluateArray(p, 5)
    expect(after[0]).toBeCloseTo(before[0], 1)
    expect(after[1]).toBeCloseTo(before[1], 1)
    // Points stay close to the original curve (timing along the path may shift slightly).
    for (const s of samples) {
      const nearest = Math.min(
        ...Array.from({ length: 101 }, (_, i) => {
          const q = evaluateArray(p, i / 10)
          return Math.hypot(q[0] - s[0], q[1] - s[1])
        }),
      )
      expect(nearest).toBeLessThan(3)
    }
  })
})

describe('setValueAtFrame', () => {
  it('sets static values', () => {
    const p: ScalarProperty = { a: 0, k: 1 }
    setValueAtFrame(p, 0, 5)
    expect(p.k).toBe(5)
  })
  it('auto-keys animated properties', () => {
    const p = animatedScalar()
    setValueAtFrame(p, 3, 90)
    expect(getKeyframes(p)!.map((k) => k.t)).toEqual([0, 3, 10])
    expect(evaluateArray(p, 3)).toEqual([90])
  })
})

describe('removeKeyframes', () => {
  it('removes keyframes and turns the property static when none remain', () => {
    const p = animatedScalar()
    removeKeyframes(p, [1])
    expect(getKeyframes(p)!.length).toBe(1)
    removeKeyframes(p, [0])
    expect(p.a).toBe(0)
    expect(p.k).toBe(0)
  })
})

describe('moveKeyframes', () => {
  it('moves keyframes and keeps them sorted', () => {
    const p = animatedScalar()
    const [idx] = moveKeyframes(p, [0], 15)
    const kfs = getKeyframes<number[]>(p)!
    expect(kfs.map((k) => k.t)).toEqual([10, 15])
    expect(idx).toBe(1)
    // The keyframe that is now first must have easing handles.
    expect(kfs[0].o).toBeDefined()
    expect(kfs[0].i).toBeDefined()
  })
  it('replaces an unmoved keyframe on collision', () => {
    const p = animatedScalar()
    moveKeyframes(p, [0], 10)
    const kfs = getKeyframes<number[]>(p)!
    expect(kfs.length).toBe(1)
    expect(kfs[0].s).toEqual([0])
  })
})

describe('easing edits', () => {
  it('sets a segment curve preserving the handle shape', () => {
    const p: ScalarProperty = {
      a: 1,
      k: [
        { t: 0, s: [0], o: { x: [0.167], y: [0.167] }, i: { x: [0.833], y: [0.833] } },
        { t: 10, s: [100] },
      ],
    }
    setSegmentEasing(p, 0, [0.42, 0, 0.58, 1])
    const kf = getKeyframes(p)![0]
    expect(kf.o).toEqual({ x: [0.42], y: [0] })
    expect(kf.i).toEqual({ x: [0.58], y: [1] })
    setSegmentEasing(p, 0, null)
    expect(getKeyframes(p)![0].h).toBe(1)
    setSegmentEasing(p, 0, [0, 0, 1, 1])
    expect(getKeyframes(p)![0].h).toBeUndefined()
  })
  it('applies easy ease around a keyframe', () => {
    const p: ScalarProperty = {
      a: 1,
      k: [
        { t: 0, s: [0], ...linear() },
        { t: 10, s: [100], ...linear() },
        { t: 20, s: [0] },
      ],
    }
    applyEasyEase(p, 1)
    const kfs = getKeyframes(p)!
    expect(kfs[0].i).toEqual({ x: 0.667, y: 1 })
    expect(kfs[1].o).toEqual({ x: 0.333, y: 0 })
  })
})

describe('legacy keyframes', () => {
  it('normalizes e values into the next keyframe s', () => {
    const p = {
      a: 1 as const,
      k: [{ t: 0, s: [0], e: [10], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: 10 }] as Keyframe[],
    }
    normalizeLegacyKeyframes(p)
    expect(p.k[1].s).toEqual([10])
    expect(p.k[0].e).toBeUndefined()
    expect(evaluateArray(p, 5)[0]).toBeCloseTo(5)
  })
})

describe('findKeyframeAt', () => {
  it('finds keyframes within tolerance', () => {
    const p = animatedScalar()
    expect(findKeyframeAt(p, 10)).toBe(1)
    expect(findKeyframeAt(p, 9.6, 0.5)).toBe(1)
    expect(findKeyframeAt(p, 5)).toBe(-1)
  })
})

describe('inside immer recipes', () => {
  it('handles legacy keyframes and path values on drafts', async () => {
    const { produce } = await import('immer')
    const legacy = {
      a: 1 as const,
      k: [{ t: 0, s: [0], e: [10], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: 10 }] as Keyframe[],
    }
    const moved = produce(legacy, (d) => {
      moveKeyframes(d, [1], 5)
    })
    expect(getKeyframes(moved)!.map((k) => k.t)).toEqual([0, 15])
    const path = {
      a: 1 as const,
      k: [
        {
          t: 0,
          s: [{ c: true, v: [[0, 0]], i: [[0, 0]], o: [[0, 0]] }],
          o: { x: 0, y: 0 },
          i: { x: 1, y: 1 },
        },
        { t: 10, s: [{ c: true, v: [[10, 0]], i: [[0, 0]], o: [[0, 0]] }] },
      ],
    }
    const extended = produce(path, (d) => {
      insertKeyframe(d as never, 20)
    })
    expect(getKeyframes(extended as never)!.length).toBe(3)
  })

  it('does not add easing to text document keyframes', () => {
    const textDoc = {
      k: [
        { t: 0, s: { t: 'A', s: 10, f: 'Arial' } },
        { t: 10, s: { t: 'B', s: 10, f: 'Arial' } },
      ],
    } as unknown as ScalarProperty
    moveKeyframes(textDoc, [1], 5)
    const kfs = getKeyframes(textDoc)!
    expect(kfs.map((k) => k.t)).toEqual([0, 15])
    expect(kfs[0].o).toBeUndefined()
    expect((textDoc as { a?: number }).a).toBeUndefined()
  })
})
