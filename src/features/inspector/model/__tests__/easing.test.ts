import { describe, expect, it } from 'vitest'
import type { Animation, Keyframe } from '@/lottie/types'
import {
  constrainCurve,
  curvesEqual,
  formatCubicBezier,
  isPerAxis,
  isSpatialSegment,
  isTextDocumentPath,
  parseEasing,
  segmentCurve,
  segmentKeyframe,
  segmentsForSelection,
} from '../easing'

const ease = { o: { x: 0.33, y: 0 }, i: { x: 0.67, y: 1 } }

function doc(): Animation {
  return {
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        ip: 0,
        op: 60,
        st: 0,
        shapes: [],
        ks: {
          o: {
            a: 1,
            k: [
              { t: 0, s: [0], ...ease },
              { t: 10, s: [100], ...ease },
              { t: 20, s: [50], ...ease },
              { t: 30, s: [0] },
            ],
          },
          r: {
            a: 1,
            k: [
              { t: 0, s: [0], ...ease },
              { t: 10, s: [90] },
            ],
          },
        },
      },
      {
        ty: 5,
        ip: 0,
        op: 60,
        st: 0,
        ks: {},
        t: {
          d: {
            k: [
              { t: 0, s: { t: 'a', s: 10, f: 'x' } },
              { t: 5, s: { t: 'b', s: 10, f: 'x' } },
            ],
          },
        },
      },
    ],
  }
}

const O = ['layers', 0, 'ks', 'o']
const R = ['layers', 0, 'ks', 'r']

describe('segmentsForSelection', () => {
  it('uses the outgoing segment of each selected key', () => {
    const sel = segmentsForSelection(
      doc(),
      [
        { path: O, index: 0 },
        { path: O, index: 2 },
        { path: R, index: 0 },
      ],
      null,
    )
    expect(sel.segments).toEqual([
      { path: O, index: 0 },
      { path: O, index: 2 },
      { path: R, index: 0 },
    ])
    expect(sel.incoming).toBe(false)
    expect(sel.single).toBe(false)
  })
  it('skips last keys when other segments exist', () => {
    const sel = segmentsForSelection(
      doc(),
      [
        { path: O, index: 2 },
        { path: O, index: 3 },
      ],
      null,
    )
    expect(sel.segments).toEqual([{ path: O, index: 2 }])
  })
  it('treats two adjacent keys + focused property as one timeline segment', () => {
    const sel = segmentsForSelection(
      doc(),
      [
        { path: O, index: 1 },
        { path: O, index: 2 },
      ],
      O,
    )
    expect(sel.segments).toEqual([{ path: O, index: 1 }])
    expect(sel.single).toBe(true)
  })
  it('edits the incoming segment of a lone last keyframe', () => {
    const sel = segmentsForSelection(doc(), [{ path: O, index: 3 }], null)
    expect(sel.segments).toEqual([{ path: O, index: 2 }])
    expect(sel.incoming).toBe(true)
  })
  it('ignores text document keyframes (they always hold)', () => {
    const T = ['layers', 1, 't', 'd']
    expect(isTextDocumentPath(T)).toBe(true)
    expect(segmentsForSelection(doc(), [{ path: T, index: 0 }], null).segments).toEqual([])
  })
  it('ignores stale references', () => {
    expect(
      segmentsForSelection(doc(), [{ path: ['layers', 9, 'ks', 'o'], index: 0 }], null).segments,
    ).toEqual([])
    expect(segmentsForSelection(doc(), [{ path: O, index: 42 }], null).segments).toEqual([])
  })
})

describe('segment helpers', () => {
  it('reads the keyframe and curve of a segment', () => {
    const d = doc()
    const kf = segmentKeyframe(d, { path: O, index: 1 })
    expect(kf?.t).toBe(10)
    expect(segmentCurve(kf!)).toEqual([0.33, 0, 0.67, 1])
    expect(segmentKeyframe(d, { path: O, index: 3 })).toBeUndefined()
  })
  it('reads hold as null', () => {
    expect(segmentCurve({ t: 0, s: [1], h: 1 })).toBeNull()
  })
  it('detects per-axis easing', () => {
    const same: Keyframe<unknown> = {
      t: 0,
      o: { x: [0.3, 0.3], y: [0, 0] },
      i: { x: [0.7, 0.7], y: [1, 1] },
    }
    const diff: Keyframe<unknown> = {
      t: 0,
      o: { x: [0.3, 0.9], y: [0, 0] },
      i: { x: [0.7, 0.7], y: [1, 1] },
    }
    expect(isPerAxis(same)).toBe(false)
    expect(isPerAxis(diff)).toBe(true)
    expect(isPerAxis({ t: 0, ...ease })).toBe(false)
  })
  it('detects spatial segments', () => {
    expect(isSpatialSegment({ t: 0, to: [0, 0], ti: [0, 0] })).toBe(true)
    expect(isSpatialSegment({ t: 0 })).toBe(false)
  })
  it('compares and constrains curves', () => {
    expect(curvesEqual([0, 0, 1, 1], [0.0005, 0, 1, 1])).toBe(true)
    expect(curvesEqual([0, 0, 1, 1], null)).toBe(false)
    expect(curvesEqual(null, null)).toBe(true)
    expect(constrainCurve([1.2, -0.5, -0.1, 1.6], false)).toEqual([1, -0.5, 0, 1.6])
    expect(constrainCurve([0.3, -0.5, 0.7, 1.6], true)).toEqual([0.3, 0, 0.7, 1])
  })
})

describe('CSS cubic-bezier', () => {
  it('formats with trimmed decimals', () => {
    expect(formatCubicBezier([0.333, 0, 0.6667, 1])).toBe('cubic-bezier(0.333, 0, 0.667, 1)')
  })
  it('parses functions, lists, arrays and keywords', () => {
    expect(parseEasing('cubic-bezier(0.42, 0, 0.58, 1)')).toEqual([0.42, 0, 0.58, 1])
    expect(parseEasing('  cubic-bezier(.4,0,.2,1);')).toEqual([0.4, 0, 0.2, 1])
    expect(parseEasing('0.1 0.2 0.3 0.4')).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(parseEasing('[0.68, -0.6, 0.32, 1.6]')).toEqual([0.68, -0.6, 0.32, 1.6])
    expect(parseEasing('ease-in-out')).toEqual([0.42, 0, 0.58, 1])
    expect(parseEasing('LINEAR')).toEqual([0, 0, 1, 1])
    expect(parseEasing('steps(1, end)')).toBe('hold')
    expect(parseEasing('step-end')).toBe('hold')
  })
  it('rejects invalid input', () => {
    expect(parseEasing('')).toBeNull()
    expect(parseEasing('hello')).toBeNull()
    expect(parseEasing('cubic-bezier(1.5, 0, 0.5, 1)')).toBeNull()
    expect(parseEasing('1, 2, 3')).toBeNull()
    expect(parseEasing('a, b, c, d')).toBeNull()
  })
})
