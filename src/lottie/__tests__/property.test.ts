import { describe, expect, it } from 'vitest'
import { cubicBezier, matchPreset, curveOfKeyframe } from '../easing'
import {
  evaluateArray,
  evaluatePath,
  evaluatePosition,
  evaluateScalar,
  evaluateTextDocument,
  isAnimated,
  isPropertyLike,
} from '../property'
import type { BezierPath, Keyframe, ScalarProperty, TextData, VectorProperty } from '../types'

const linear = { o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }

describe('cubicBezier', () => {
  it('is identity for linear curves', () => {
    const f = cubicBezier(0.25, 0.25, 0.75, 0.75)
    for (const x of [0, 0.1, 0.5, 0.9, 1]) expect(f(x)).toBeCloseTo(x, 6)
  })
  it('matches known ease values', () => {
    const ease = cubicBezier(0.42, 0, 0.58, 1)
    expect(ease(0.5)).toBeCloseTo(0.5, 5)
    expect(ease(0.25)).toBeCloseTo(0.1291, 3)
  })
  it('clamps outside [0,1]', () => {
    const f = cubicBezier(0.3, 0, 0.7, 1)
    expect(f(-1)).toBe(0)
    expect(f(2)).toBe(1)
  })
  it('supports overshoot', () => {
    const back = cubicBezier(0.34, 1.56, 0.64, 1)
    expect(Math.max(...[0.5, 0.6, 0.7, 0.8].map(back))).toBeGreaterThan(1)
  })
})

describe('isAnimated / isPropertyLike', () => {
  it('detects static and animated properties', () => {
    expect(isAnimated({ a: 0, k: 5 })).toBe(false)
    expect(isAnimated({ a: 0, k: [1, 2] })).toBe(false)
    expect(isAnimated({ a: 1, k: [{ t: 0, s: [1] }] })).toBe(true)
    // stale `a` flag: trust the data
    expect(isAnimated({ a: 0, k: [{ t: 0, s: [1] }] })).toBe(true)
  })
  it('recognizes property-like objects', () => {
    expect(isPropertyLike({ a: 0, k: 1 })).toBe(true)
    expect(isPropertyLike({ k: [1, 2, 3] })).toBe(true)
    expect(isPropertyLike({ k: { i: [], o: [], v: [], c: true } })).toBe(true)
    expect(isPropertyLike({ k: 'keywords' })).toBe(false)
    expect(isPropertyLike({ p: 3, k: { a: 0, k: [0, 1, 1, 1] } })).toBe(false)
  })
})

describe('evaluateArray', () => {
  const prop: VectorProperty = {
    a: 1,
    k: [
      { t: 10, s: [0, 0], ...linear },
      { t: 20, s: [100, 50], ...linear },
      { t: 30, s: [100, 50], h: 1 },
      { t: 40, s: [0, 0] },
    ],
  }

  it('returns the static value', () => {
    expect(evaluateArray({ a: 0, k: [3, 4] }, 100)).toEqual([3, 4])
    expect(evaluateArray({ a: 0, k: 7 }, 0)).toEqual([7])
  })
  it('clamps before the first and after the last keyframe', () => {
    expect(evaluateArray(prop, 0)).toEqual([0, 0])
    expect(evaluateArray(prop, 999)).toEqual([0, 0])
  })
  it('interpolates linearly', () => {
    const v = evaluateArray(prop, 15)
    expect(v[0]).toBeCloseTo(50)
    expect(v[1]).toBeCloseTo(25)
  })
  it('holds hold keyframes until the next keyframe', () => {
    expect(evaluateArray(prop, 35)).toEqual([100, 50])
    expect(evaluateArray(prop, 40)).toEqual([0, 0])
  })
  it('applies per-dimension easing', () => {
    const p: VectorProperty = {
      a: 1,
      k: [
        { t: 0, s: [0, 0], o: { x: [0, 0.42], y: [0, 0] }, i: { x: [1, 0.58], y: [1, 1] } },
        { t: 10, s: [100, 100] },
      ],
    }
    const v = evaluateArray(p, 2.5)
    expect(v[0]).toBeCloseTo(25, 3)
    expect(v[1]).toBeCloseTo(12.91, 1)
  })
  it('supports legacy keyframes with e values', () => {
    const legacy = {
      a: 1 as const,
      k: [
        { t: 0, s: [0], e: [10], ...linear },
        { t: 10, s: [10], e: [20], ...linear },
        { t: 20 },
      ] as Keyframe[],
    }
    expect(evaluateArray(legacy, 5)[0]).toBeCloseTo(5)
    expect(evaluateArray(legacy, 15)[0]).toBeCloseTo(15)
    expect(evaluateArray(legacy, 25)[0]).toBeCloseTo(20)
  })
})

describe('spatial interpolation', () => {
  it('follows the bezier motion path and hits the end points', () => {
    const p: VectorProperty = {
      a: 1,
      k: [
        { t: 0, s: [0, 0], ...linear, to: [0, -100], ti: [0, -100] },
        { t: 10, s: [100, 0] },
      ],
    }
    expect(evaluateArray(p, 0)).toEqual([0, 0])
    const mid = evaluateArray(p, 5)
    expect(mid[0]).toBeCloseTo(50, 0)
    expect(mid[1]).toBeLessThan(-60) // bulges upwards
    const end = evaluateArray(p, 10)
    expect(end[0]).toBeCloseTo(100)
    expect(end[1]).toBeCloseTo(0)
  })
  it('behaves like linear interpolation with zero tangents', () => {
    const p: VectorProperty = {
      a: 1,
      k: [
        { t: 0, s: [0, 0], ...linear, to: [0, 0], ti: [0, 0] },
        { t: 10, s: [100, 40] },
      ],
    }
    const v = evaluateArray(p, 5)
    expect(v[0]).toBeCloseTo(50, 1)
    expect(v[1]).toBeCloseTo(20, 1)
  })
})

describe('evaluateScalar / evaluatePosition', () => {
  it('unwraps 1D keyframes', () => {
    const r: ScalarProperty = {
      a: 1,
      k: [
        { t: 0, s: [0], ...linear },
        { t: 10, s: [90] },
      ],
    }
    expect(evaluateScalar(r, 5)).toBeCloseTo(45)
  })
  it('evaluates split positions', () => {
    expect(
      evaluatePosition(
        {
          s: true,
          x: {
            a: 1,
            k: [
              { t: 0, s: [0], ...linear },
              { t: 10, s: [10] },
            ],
          },
          y: { a: 0, k: 7 },
        },
        5,
      ),
    ).toEqual([5, 7])
  })
})

describe('evaluatePath', () => {
  const a: BezierPath = {
    c: true,
    v: [
      [0, 0],
      [10, 0],
    ],
    i: [
      [0, 0],
      [0, 0],
    ],
    o: [
      [0, 0],
      [0, 0],
    ],
  }
  const b: BezierPath = {
    c: true,
    v: [
      [0, 10],
      [20, 0],
    ],
    i: [
      [0, 0],
      [0, 0],
    ],
    o: [
      [0, 0],
      [0, 0],
    ],
  }
  it('interpolates vertices', () => {
    const path = evaluatePath(
      {
        a: 1,
        k: [
          { t: 0, s: [a], ...linear },
          { t: 10, s: [b] },
        ],
      },
      5,
    )
    expect(path?.v[0]).toEqual([0, 5])
    expect(path?.v[1]).toEqual([15, 0])
  })
  it('returns static paths', () => {
    expect(evaluatePath({ a: 0, k: a }, 3)).toBe(a)
  })
})

describe('evaluateTextDocument', () => {
  it('uses the latest keyframe at or before the frame', () => {
    const text = {
      d: {
        k: [
          { t: 0, s: { t: 'Hello', s: 20, f: 'Arial' } },
          { t: 10, s: { t: 'World', s: 20, f: 'Arial' } },
        ],
      },
    } as TextData
    expect(evaluateTextDocument(text, 5)?.t).toBe('Hello')
    expect(evaluateTextDocument(text, 10)?.t).toBe('World')
    expect(evaluateTextDocument(text, -5)?.t).toBe('Hello')
  })
})

describe('easing presets', () => {
  it('recognizes linear and hold', () => {
    expect(matchPreset([0.167, 0.167, 0.833, 0.833])?.id).toBe('linear')
    expect(matchPreset(null)?.id).toBe('hold')
    expect(matchPreset([0.333, 0, 0.667, 1])?.id).toBe('easyEase')
  })
  it('reads the curve of a keyframe', () => {
    expect(curveOfKeyframe({ t: 0, o: { x: [0.4], y: [0] }, i: { x: [0.2], y: [1] } })).toEqual([
      0.4, 0, 0.2, 1,
    ])
    expect(curveOfKeyframe({ t: 0, h: 1 })).toBeNull()
  })
})
