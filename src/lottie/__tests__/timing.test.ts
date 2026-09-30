import { describe, expect, it } from 'vitest'
import { evaluateArray, evaluatePath, evaluateTextDocument, getKeyframes } from '../property'
import {
  changeFrameRate,
  countExpressions,
  extendEnd,
  framesForDuration,
  framesForSpeed,
  freezeAfter,
  mirrorKeyframes,
  offsetTime,
  pingPong,
  planFrameRate,
  reverseAnimation,
  roundTime,
  scaleTime,
  setDuration,
  setFrameCount,
  setSpeed,
  splitEasingCurve,
  splitSegmentAt,
  trimToRange,
} from '../timing'
import type {
  Animation,
  Keyframe,
  PrecompAsset,
  PrecompLayer,
  ScalarProperty,
  ShapePathProperty,
  TextData,
  VectorProperty,
} from '../types'
import { precomposeRoot } from '../canvas'
import {
  diff,
  frames,
  loadBounce,
  loadTestJson,
  precompFixture,
  snapshot,
  snapshotDiff,
  stepFixture,
} from './docops.fixtures'

type Kf = Keyframe<unknown>

interface MotionOptions {
  tolerance?: number
  /** Compare with what `before` showed just BEFORE t (its left limit: the reverse convention). */
  left?: boolean
  /** lottie-web's visibility rule (ip ≤ t < op) instead of ignoring in/out point ties. */
  exact?: boolean
  /** Only compare layers under this key prefix of `after` (e.g. '0>' inside a new precomp). */
  prefix?: string
}

/**
 * How far before t the left limit is read: far below any keyframe or in/out point spacing, and
 * small enough that fast motion (1000 px per frame) moves less than the tolerance meanwhile.
 */
const LEFT = 1e-6

/** Checks that `after` shows at map(t) what `before` showed at t. */
function expectSameMotion(
  before: Animation,
  after: Animation,
  times: number[],
  map: (t: number) => number,
  opts: MotionOptions | number = {},
) {
  const o = typeof opts === 'number' ? { tolerance: opts } : opts
  for (const t of times) {
    const a = snapshot(before, o.left ? t - LEFT : t, { exact: o.exact })
    const b = snapshot(after, map(t), { exact: o.exact })
    const d = snapshotDiff(a, b, o.tolerance ?? 2e-3, o.prefix)
    if (d) throw new Error(`frame ${t} → ${map(t)}: ${d}`)
  }
}

function asset(anim: Animation, id: string): PrecompAsset {
  return anim.assets!.find((a) => a.id === id) as PrecompAsset
}

describe('roundTime', () => {
  it('removes float noise and negative zero', () => {
    expect(roundTime(28.000000000000004)).toBe(28)
    expect(roundTime(-0.0001)).toBe(0)
    expect(roundTime(1 / 3)).toBe(0.333)
  })
})

describe('scaleTime', () => {
  it('stretches the bouncing ball and keeps its motion', () => {
    const before = loadBounce()
    const after = structuredClone(before)
    scaleTime(after, 2)
    expect(after.op).toBe(120)
    expect(after.layers.every((l) => l.op === 120)).toBe(true)
    expect(after.markers).toEqual([
      { tm: 0, cm: 'fall', dr: 56 },
      { tm: 56, cm: 'rise', dr: 64 },
    ])
    expectSameMotion(before, after, frames(0, 60, 0.5), (t) => t * 2)
  })

  it('scales around an origin', () => {
    const before = precompFixture()
    before.ip = 10
    const after = structuredClone(before)
    scaleTime(after, 0.5, { origin: 10 })
    expect(after.ip).toBe(10)
    expect(after.op).toBe(35)
    expectSameMotion(before, after, frames(10, 60, 0.5), (t) => 10 + (t - 10) * 0.5)
  })

  it('keeps precomp instances (st offsets, stretch, time remap, nesting) in sync', () => {
    const before = precompFixture()
    // Sampled between whole frames: text switches and holds sit exactly on whole frames, where
    // float noise in the precomp mapping (e.g. 12 · 0.7) picks either side.
    for (const factor of [2, 0.5, 0.7, 1.37]) {
      const after = structuredClone(before)
      scaleTime(after, factor)
      expectSameMotion(before, after, frames(0.37, 60, 0.5), (t) => roundTime(t * factor))
    }
  })

  it('scales time-remap values (seconds) with the content', () => {
    const doc = precompFixture()
    scaleTime(doc, 2)
    const tm = (doc.layers[2] as PrecompLayer).tm!
    expect((tm.k as Kf[]).map((k) => k.s)).toEqual([[0.4], [2.4], [1.2]])
    expect((tm.k as Kf[]).map((k) => k.t)).toEqual([0, 80, 120])
  })

  it('handles the real-world test file', () => {
    const before = loadTestJson()
    for (const factor of [0.5, 1.5]) {
      const after = structuredClone(before)
      scaleTime(after, factor)
      expectSameMotion(before, after, frames(0, 179, 0.5), (t) => t * factor)
    }
  })

  it('rejects non-positive factors', () => {
    const doc = loadBounce()
    expect(() => scaleTime(doc, 0)).toThrow(RangeError)
    expect(() => scaleTime(doc, -1)).toThrow(RangeError)
    expect(() => scaleTime(doc, Number.NaN)).toThrow(RangeError)
  })
})

describe('speed and duration', () => {
  it('rounds to whole frames', () => {
    expect(framesForSpeed({ ip: 0, op: 90 }, 0.7)).toBe(129)
    expect(framesForSpeed({ ip: 0, op: 60 }, 2)).toBe(30)
    expect(framesForSpeed({ ip: 0, op: 3 }, 100)).toBe(1)
    expect(framesForDuration({ fr: 25 }, 2.5)).toBe(63)
    expect(framesForDuration({ fr: 60 }, 0.001)).toBe(1)
  })

  it('bakes a speed into the file', () => {
    const before = loadBounce()
    const after = structuredClone(before)
    setSpeed(after, 0.7)
    expect(after.op).toBe(86)
    expect(after.fr).toBe(30)
    expect(after.layers.every((l) => l.op === 86)).toBe(true)
    const factor = 86 / 60
    expectSameMotion(before, after, frames(0, 60, 0.5), (t) => t * factor, 5e-3)
  })

  it('sets a duration in seconds', () => {
    const doc = loadBounce()
    setDuration(doc, 1)
    expect(doc.op).toBe(30)
    const ball = doc.layers[0].ks.p as VectorProperty
    expect((ball.k as Kf[]).map((k) => k.t)).toEqual([0, 14, 30])
  })

  it('does nothing when the frame count does not change', () => {
    const doc = loadBounce()
    const copy = structuredClone(doc)
    setFrameCount(doc, 60)
    setSpeed(doc, 1)
    expect(doc).toEqual(copy)
  })

  it('keeps a non-zero in point', () => {
    const doc = loadBounce()
    doc.ip = 10
    setSpeed(doc, 2)
    expect(doc.ip).toBe(10)
    expect(doc.op).toBe(35)
  })
})

describe('changeFrameRate', () => {
  it('keeps the duration by retiming everything', () => {
    const before = loadBounce()
    const after = structuredClone(before)
    changeFrameRate(after, 60, { keepDuration: true })
    expect(after.fr).toBe(60)
    expect(after.op).toBe(120)
    expectSameMotion(before, after, frames(0, 60, 0.5), (t) => t * 2)
  })

  it('rounds the range and keeps full-length layers and loop keys at the end', () => {
    const before = loadTestJson()
    const after = structuredClone(before)
    changeFrameRate(after, 24, { keepDuration: true })
    expect(after.op).toBe(Math.round(179 * 0.4))
    expect(planFrameRate(before, 24, true)).toEqual({ fr: 24, ip: 0, op: after.op })
    // Layers that covered the whole animation still do.
    for (const [i, layer] of before.layers.entries()) {
      if (layer.op >= before.op) expect(after.layers[i].op).toBeGreaterThanOrEqual(after.op)
    }
    // Keyframes at the old out point follow the rounded one (71.6 → 72): the last segments
    // (from frame 146 on) are stretched by 0.4 frame, everything before is exact.
    expectSameMotion(before, after, frames(1, 146, 1), (t) => t * 0.4, 3e-3)

    const bounce = loadBounce()
    changeFrameRate(bounce, 29.97, { keepDuration: true })
    const keys = getKeyframes(bounce.layers[0].ks.p as VectorProperty)!
    // 60 · 0.999 = 59.94 → rounded out point 60: the loop key follows it.
    expect(bounce.op).toBe(60)
    expect(keys[keys.length - 1].t).toBe(60)
  })

  it('changes the playback rate when the duration is not kept', () => {
    const before = precompFixture()
    const after = structuredClone(before)
    changeFrameRate(after, 60, { keepDuration: false })
    expect(after.op).toBe(60)
    expect(after.fr).toBe(60)
    expect(asset(after, 'comp_a').fr).toBe(60)
    // Frame numbers are unchanged, including what the time-remapped precomp shows.
    expectSameMotion(before, after, frames(0, 60, 0.5), (t) => t)
    const tm = (after.layers[2] as PrecompLayer).tm!
    expect((tm.k as Kf[]).map((k) => k.s)).toEqual([[0.1], [0.6], [0.3]])
  })

  it('keeps the duration with precomps, time remap and nesting', () => {
    const before = precompFixture()
    const after = structuredClone(before)
    changeFrameRate(after, 50, { keepDuration: true })
    expect(after.op).toBe(100)
    expectSameMotion(before, after, frames(0.37, 60, 0.5), (t) => (t * 50) / 30)
  })

  it('ignores a no-op and rejects invalid rates', () => {
    const doc = loadBounce()
    const copy = structuredClone(doc)
    changeFrameRate(doc, 30, { keepDuration: true })
    expect(doc).toEqual(copy)
    expect(() => changeFrameRate(doc, 0, { keepDuration: true })).toThrow(RangeError)
  })
})

describe('trimToRange and offsetTime', () => {
  it('sets the range without touching the content', () => {
    const doc = loadBounce()
    trimToRange(doc, 10, 40)
    expect([doc.ip, doc.op]).toEqual([10, 40])
    expect(doc.layers[0].ip).toBe(0)
  })

  it('shifts the range to frame 0', () => {
    const before = precompFixture()
    const after = structuredClone(before)
    trimToRange(after, 12, 48, { shiftToZero: true })
    expect([after.ip, after.op]).toEqual([0, 36])
    expect(after.markers!.map((m) => m.tm)).toEqual([-12, 28])
    expectSameMotion(before, after, frames(12, 48, 0.5), (t) => t - 12)
  })

  it('clips markers to the kept range when asked', () => {
    const doc = precompFixture()
    doc.markers = [
      { cm: 'before', tm: 0, dr: 5 },
      { cm: 'crossing', tm: 8, dr: 10 },
      { cm: 'inside', tm: 20, dr: 5 },
      { cm: 'after', tm: 50, dr: 5 },
    ]
    trimToRange(doc, 10, 40, { shiftToZero: true, clipMarkers: true })
    expect(doc.markers).toEqual([
      { cm: 'crossing', tm: 0, dr: 8 },
      { cm: 'inside', tm: 10, dr: 5 },
    ])
    const untouched = precompFixture()
    trimToRange(untouched, 10, 40)
    expect(untouched.markers).toEqual(precompFixture().markers)
  })

  it('offsets everything consistently', () => {
    const before = precompFixture()
    const after = structuredClone(before)
    offsetTime(after, 7.5)
    expect([after.ip, after.op]).toEqual([7.5, 67.5])
    // Precomp content is untouched: the instance start times moved instead.
    expect(asset(after, 'comp_a')).toEqual(asset(before, 'comp_a'))
    expectSameMotion(before, after, frames(0, 60, 0.5), (t) => t + 7.5)
  })

  it('rejects empty ranges', () => {
    expect(() => trimToRange(loadBounce(), 10, 10)).toThrow(RangeError)
    expect(() => trimToRange(loadBounce(), 20, 10)).toThrow(RangeError)
  })
})

describe('easing split', () => {
  it('reproduces the curve on the left part', () => {
    const curve: [number, number, number, number] = [0.42, 0, 0.58, 1]
    const { progress, left } = splitEasingCurve(curve, 0.3)
    expect(left).not.toBeNull()
    // The left curve, renormalized, matches the original progress on [0, 0.3].
    const [x1, y1, x2, y2] = left!
    for (const x of [0.1, 0.4, 0.7, 0.95]) {
      const original = evaluateArray(
        {
          k: [
            { t: 0, s: [0], o: { x: 0.42, y: 0 }, i: { x: 0.58, y: 1 } },
            { t: 1, s: [1] },
          ],
        },
        x * 0.3,
      )[0]
      const split = evaluateArray(
        {
          k: [
            { t: 0, s: [0], o: { x: x1, y: y1 }, i: { x: x2, y: y2 } },
            { t: 1, s: [progress] },
          ],
        },
        x,
      )[0]
      expect(split).toBeCloseTo(original, 4)
    }
  })

  it('splits scalar, per-dimension, spatial and path segments exactly', () => {
    const cases: { k: Kf[] }[] = [
      {
        k: [
          { t: 0, s: [10], o: { x: [0.8], y: [0] }, i: { x: [0.2], y: [1] } },
          { t: 30, s: [90] },
        ],
      },
      {
        k: [
          {
            t: 0,
            s: [0, 0, 100],
            o: { x: [0.1, 0.9, 0.5], y: [0, 0.3, 0] },
            i: { x: [0.6, 0.2, 0.5], y: [1, 1.4, 1] },
          },
          { t: 30, s: [100, 50, 100] },
        ],
      },
      {
        k: [
          {
            t: 0,
            s: [0, 0, 0],
            o: { x: 0.33, y: 0 },
            i: { x: 0.67, y: 1 },
            to: [40, 0, 0],
            ti: [0, -60, 0],
          },
          { t: 30, s: [200, 100, 0] },
        ],
      },
    ]
    for (const prop of cases) {
      const reference = structuredClone(prop)
      const [a, b] = prop.k
      const mid = splitSegmentAt(a, b, 12)
      const left = { k: [a, mid] }
      for (const t of frames(0, 12.01, 0.5)) {
        expect(diff(evaluateArray(left, t), evaluateArray(reference, t), 2e-3)).toBeNull()
      }
    }
    const square = {
      i: [
        [0, 0],
        [0, 0],
      ],
      o: [
        [0, 0],
        [0, 0],
      ],
      v: [
        [0, 0],
        [10, 0],
      ],
      c: false,
    }
    const wide = {
      i: [
        [0, 0],
        [0, 0],
      ],
      o: [
        [0, 0],
        [0, 0],
      ],
      v: [
        [0, 0],
        [110, 40],
      ],
      c: false,
    }
    const path: ShapePathProperty = {
      a: 1,
      k: [
        { t: 0, s: [square], o: { x: 0.2, y: 0.1 }, i: { x: 0.3, y: 1 } },
        { t: 20, s: [wide] },
      ],
    }
    const reference = structuredClone(path)
    const [a, b] = path.k as Kf[]
    const mid = splitSegmentAt(a, b, 8)
    const left = { a: 1 as const, k: [a, mid] } as ShapePathProperty
    for (const t of [0, 3, 6.5, 8]) {
      expect(diff(evaluatePath(left, t), evaluatePath(reference, t), 2e-3)).toBeNull()
    }
  })
})

function eased(): ScalarProperty {
  return {
    a: 1,
    k: [
      { t: 0, s: [0], o: { x: [0.7], y: [0] }, i: { x: [0.3], y: [1] } },
      { t: 20, s: [100], o: { x: [0.5], y: [0] }, i: { x: [0.5], y: [1] } },
      { t: 40, s: [20] },
    ] as never,
  }
}

describe('freezeAfter', () => {
  it('keeps everything before the cut and holds the value reached', () => {
    const prop = eased()
    const reference = structuredClone(prop)
    freezeAfter(prop, 27)
    for (const t of frames(0, 27, 0.5))
      expect(evaluateArray(prop, t)[0]).toBeCloseTo(evaluateArray(reference, t)[0], 3)
    const held = evaluateArray(reference, 27)[0]
    for (const t of [27, 30, 45, 100]) expect(evaluateArray(prop, t)[0]).toBeCloseTo(held, 3)
    expect((prop.k as Kf[]).length).toBe(3)
  })

  it('cuts at an existing keyframe', () => {
    const prop = eased()
    freezeAfter(prop, 20)
    expect((prop.k as Kf[]).map((k) => k.t)).toEqual([0, 20])
    freezeAfter(prop, 50)
    expect((prop.k as Kf[]).length).toBe(2)
  })

  it('keeps the held value when a hold jumps exactly at the cut', () => {
    const prop: ScalarProperty = {
      a: 1,
      k: [
        { t: 0, s: [1], h: 1 },
        { t: 10, s: [2], h: 1 },
        { t: 20, s: [3] },
      ] as never,
    }
    freezeAfter(prop, 20)
    expect(evaluateArray(prop, 25)[0]).toBe(2)
    expect(evaluateArray(prop, 15)[0]).toBe(2)
  })

  it('becomes static when a single keyframe remains', () => {
    const prop: ScalarProperty = {
      a: 1,
      k: [
        { t: 30, s: [5], o: { x: 0.2, y: 0.2 }, i: { x: 0.8, y: 0.8 } },
        { t: 40, s: [9] },
      ] as never,
    }
    freezeAfter(prop, 10)
    expect(prop).toEqual({ a: 0, k: 5 })
    const vec: VectorProperty = {
      a: 1,
      k: [
        { t: 0, s: [1, 2], h: 1 },
        { t: 10, s: [3, 4] },
      ] as never,
    }
    freezeAfter(vec, 5)
    expect(vec).toEqual({ a: 0, k: [1, 2] })
  })

  it('handles text documents and legacy keyframes', () => {
    const text = {
      k: [
        { t: 0, s: { t: 'A' } },
        { t: 10, s: { t: 'B' } },
        { t: 20, s: { t: 'C' } },
      ],
    }
    freezeAfter(text, 20)
    expect(text.k.map((k) => k.t)).toEqual([0, 10])
    const legacy: ScalarProperty = {
      a: 1,
      k: [{ t: 0, s: [0], e: [10], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } }, { t: 10 }] as never,
    }
    const reference = structuredClone(legacy)
    freezeAfter(legacy, 5)
    expect(evaluateArray(legacy, 3)[0]).toBeCloseTo(evaluateArray(reference, 3)[0], 3)
    expect((legacy.k as Kf[]).some((k) => k.e !== undefined)).toBe(false)
  })
})

describe('mirrorKeyframes', () => {
  it('reflects easing and swaps spatial tangents', () => {
    const out = mirrorKeyframes(
      [
        { t: 0, s: [0, 0], o: { x: 0.1, y: 0.2 }, i: { x: 0.7, y: 0.9 }, to: [5, 0], ti: [0, 7] },
        { t: 10, s: [10, 10] },
      ],
      30,
    )
    expect(out).toEqual([
      { t: 20, s: [10, 10], o: { x: 0.3, y: 0.1 }, i: { x: 0.9, y: 0.8 }, to: [0, 7], ti: [5, 0] },
      { t: 30, s: [0, 0] },
    ])
  })

  it('mirrors holds as left limits, at their exact mirrored times', () => {
    const prop = {
      k: [
        { t: 0, s: [1], h: 1 },
        { t: 7, s: [2], h: 1 },
        { t: 7.5, s: [3], h: 1 },
        { t: 18, s: [4] },
      ] as Kf[],
    }
    const out = { k: mirrorKeyframes(prop.k, 30) }
    // At every time, switches included, the result shows what the original showed just before
    // 30 − t: the mirror of a right-continuous step is right-continuous again.
    for (const t of frames(0, 30.01, 0.25))
      expect(evaluateArray(out, 30 - t)[0]).toBe(evaluateArray(prop, t - LEFT)[0])
    expect(out.k.map((k) => [k.t, (k.s as number[])[0], k.h])).toEqual([
      [11, 4, 1],
      [12, 3, 1],
      [22.5, 2, 1],
      [23, 1, 1],
    ])
  })

  it('plays frame-by-frame holds in exact reverse order', () => {
    // Holds on whole frames, pivot = ip + op = 20: frame g of the result is frame 19 − g.
    const prop = {
      k: [
        { t: 0, s: [1], h: 1 },
        { t: 3, s: [2], h: 1 },
        { t: 4, s: [3], h: 1 },
        { t: 9, s: [4], h: 1 },
        { t: 17, s: [5] },
      ] as Kf[],
    }
    const out = { k: mirrorKeyframes(prop.k, 20) }
    for (let g = 0; g < 20; g++)
      expect(evaluateArray(out, g)[0]).toBe(evaluateArray(prop, 19 - g)[0])
  })

  it('leads into a jump right after an interpolation', () => {
    // 0 → 10 eases in, holds 10 until 12, jumps to 50, then eases to 60.
    const prop = {
      k: [
        { t: 0, s: [0], o: { x: 0.4, y: 0 }, i: { x: 0.2, y: 1 } },
        { t: 5, s: [10], h: 1 },
        { t: 12, s: [50], o: { x: 0.3, y: 0.1 }, i: { x: 0.9, y: 1 } },
        { t: 20, s: [60] },
      ] as Kf[],
    }
    const out = { k: mirrorKeyframes(prop.k, 20) }
    // Left limits everywhere, except within the 0.01-frame lead that ends the mirrored ease-out.
    for (const t of frames(0.037, 20, 0.1)) {
      expect(evaluateArray(out, 20 - t)[0]).toBeCloseTo(evaluateArray(prop, t - LEFT)[0], 4)
    }
    for (const t of [0, 5, 12, 20])
      expect(evaluateArray(out, 20 - t)[0]).toBeCloseTo(evaluateArray(prop, t - LEFT)[0], 4)
    // The mirrored ease-out (60 → 50) is split exactly 0.01 frame before the jump to the hold,
    // which it then reaches with the value it had there.
    expect(out.k.map((k) => [k.t, k.h ?? 0])).toEqual([
      [0, 0],
      [7.99, 1],
      [8, 1],
      [15, 0],
      [20, 0],
    ])
    const leadValue = (out.k[1].s as number[])[0]
    expect(leadValue).toBeCloseTo(evaluateArray(prop, 12.01)[0], 5)
    expect(evaluateArray(out, 7.995)[0]).toBe(leadValue)
  })

  it('matches the original at every sample for random keyframes', () => {
    // Deterministic pseudo-random lists mixing holds, eases, stacked keys and 2D values.
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let run = 0; run < 60; run++) {
      const dims = run % 3 === 0 ? 2 : 1
      const kfs: Kf[] = []
      let t = Math.floor(random() * 4)
      const count = 2 + Math.floor(random() * 6)
      for (let i = 0; i < count; i++) {
        const s = Array.from({ length: dims }, () => Math.round(random() * 200 - 100))
        const kf: Kf = { t, s }
        const kind = random()
        if (kind < 0.35) kf.h = 1
        else kf.o = { x: random(), y: random() * 1.4 - 0.2 }
        if (kf.o) kf.i = { x: random(), y: random() * 1.4 - 0.2 }
        kfs.push(kf)
        // Mostly whole frames, sometimes fractional, sometimes stacked on the same time.
        const r = random()
        t +=
          r < 0.1
            ? 0
            : r < 0.3
              ? Math.round(random() * 40) / 10 + 0.1
              : 1 + Math.floor(random() * 6)
      }
      const pivot = Math.ceil(t) + 3
      const prop = { k: kfs }
      const out = { k: mirrorKeyframes(kfs, pivot) }
      const jumps = kfs.map((k) => k.t)
      for (const u of frames(0.0137, pivot, 0.071)) {
        // Skip the 0.01-frame leads right after (in original time) a jump.
        if (jumps.some((j) => u > j - 1e-9 && u < j + 0.011)) continue
        const want = evaluateArray(prop, u - LEFT)
        const got = evaluateArray(out, pivot - u)
        // (lottie's bezier solver is accurate to ~1e-4 of the progress in flat parts of a curve)
        expect(diff(got, want, 1e-3), `run ${run} at ${u}: ${JSON.stringify(kfs)}`).toBeNull()
      }
    }
  })

  it('keeps zero-length jumps', () => {
    const prop = {
      k: [
        { t: 0, s: [0], o: { x: 0.5, y: 0.5 }, i: { x: 0.5, y: 0.5 } },
        { t: 10, s: [10], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
        { t: 10, s: [50], o: { x: 0.5, y: 0.5 }, i: { x: 0.5, y: 0.5 } },
        { t: 20, s: [60] },
      ] as Kf[],
    }
    const out = { k: mirrorKeyframes(prop.k, 20) }
    for (const f of [0, 4.5, 9.9, 10.1, 15, 20])
      expect(evaluateArray(out, 20 - f)[0]).toBeCloseTo(evaluateArray(prop, f)[0], 5)
  })
})

describe('reverseAnimation', () => {
  it('plays the bouncing ball backwards', () => {
    const before = loadBounce()
    const after = structuredClone(before)
    reverseAnimation(after)
    expect([after.ip, after.op]).toEqual([0, 60])
    expect(after.markers).toEqual([
      { tm: 0, cm: 'rise', dr: 32 },
      { tm: 32, cm: 'fall', dr: 28 },
    ])
    expectSameMotion(before, after, frames(0, 60, 0.5), (t) => 60 - t)
  })

  it('reverses precomps in their own time base without time remapping', () => {
    const before = precompFixture()
    const after = structuredClone(before)
    reverseAnimation(after)
    expect((after.layers[0] as PrecompLayer).tm).toBeUndefined()
    // Between whole frames: switches at whole inner frames are float-noise ties through the
    // stretched and remapped instances (whole frames are covered by the other tests).
    expectSameMotion(before, after, frames(0.37, 60, 0.5), (t) => 60 - t)
  })

  it('reverses the real-world test file', () => {
    const before = loadTestJson()
    const after = structuredClone(before)
    reverseAnimation(after)
    expectSameMotion(before, after, frames(0, 180, 1), (t) => 179 - t)
    expectSameMotion(before, after, frames(0.25, 179, 0.5), (t) => 179 - t)
  })

  it('reverses text documents', () => {
    const doc = precompFixture()
    const text = (asset(doc, 'comp_a').layers[2] as unknown as { t: TextData }).t
    const reference = structuredClone(text)
    reverseAnimation(doc)
    // Content of comp_a is mirrored around its own pivot (0 + 40): frame f of the result shows
    // the original text just before 40 − f.
    for (const f of frames(0, 40.01, 0.5)) {
      expect(evaluateTextDocument(text, f)?.t).toBe(
        evaluateTextDocument(reference, 40 - f - 1e-6)?.t,
      )
    }
    expect((text.d.k as Kf[]).map((k) => [k.t, (k.s as { t: string }).t])).toEqual([
      [12, 'Three'],
      [13, 'Two'],
      [28, 'One'],
    ])
  })

  it('plays whole frames in exact reverse order, layer switches included', () => {
    for (const before of [loadBounce(), loadTestJson()]) {
      const after = structuredClone(before)
      reverseAnimation(after)
      const pivot = before.ip + before.op
      // At every whole frame (in/out points on the frame itself too), the result shows what
      // the original showed just before the mirrored time.
      expectSameMotion(before, after, frames(before.ip, before.op, 1), (t) => pivot - t, {
        left: true,
        exact: true,
        tolerance: 3e-3,
      })
      expectSameMotion(before, after, frames(before.ip + 0.5, before.op, 1), (t) => pivot - t, {
        left: true,
        exact: true,
        tolerance: 3e-3,
      })
    }
  })

  it('is its own inverse', () => {
    const before = precompFixture()
    const twice = structuredClone(before)
    reverseAnimation(twice)
    reverseAnimation(twice)
    expectSameMotion(before, twice, frames(0.37, 60, 0.5), (t) => t)
  })
})

describe('extendEnd', () => {
  it('holds the last frame of the bouncing ball', () => {
    const before = loadBounce()
    const after = structuredClone(before)
    const result = extendEnd(after, 0.5)
    expect(result).toEqual({ frames: 15, remappedLayers: 0 })
    expect(after.op).toBe(75)
    expect(after.layers.every((l) => l.op === 75)).toBe(true)
    expectSameMotion(before, after, frames(0, 60, 0.5), (t) => t)
    const end = snapshot(before, 59.999)
    for (const t of [60.5, 65, 74.5]) expect(snapshotDiff(end, snapshot(after, t), 2e-3)).toBeNull()
  })

  it('cuts animation that continued past the old out point', () => {
    const before = loadTestJson()
    const after = structuredClone(before)
    extendEnd(after, 1)
    expect(after.op).toBe(239)
    expectSameMotion(before, after, frames(0, 179, 0.5), (t) => t)
    const end = snapshot(before, 178.999)
    for (const t of [179.5, 200, 238.5])
      expect(snapshotDiff(end, snapshot(after, t), 5e-3)).toBeNull()
  })

  it('freezes precomps whose content keeps moving', () => {
    const before = precompFixture()
    // Instance A shows comp_a up to inner frame 50 → its layers end at 40: static afterwards.
    // Make the root end while comp_a is still animating.
    before.op = 30
    before.layers = before.layers.map((l) => ({
      ...l,
      op: Math.min(l.op, 30),
      ip: Math.min(l.ip, 29),
    }))
    const after = structuredClone(before)
    const result = extendEnd(after, 1)
    expect(after.op).toBe(60)
    expect(result.remappedLayers).toBe(2)
    expect((after.layers[0] as PrecompLayer).tm).toBeDefined()
    // lottie-web's visibility rule: the remap may not show a layer that starts on a whole
    // content frame one frame late (or early).
    expectSameMotion(before, after, frames(0, 30, 0.5), (t) => t, { exact: true, tolerance: 3e-3 })
    const end = snapshot(before, 30 - LEFT, { exact: true })
    for (const t of [30, 30.5, 45, 59.5])
      expect(snapshotDiff(end, snapshot(after, t, { exact: true }), 3e-3)).toBeNull()
  })

  it('keeps never-visible layers out of the pause and freezes parents', () => {
    const doc = loadBounce()
    doc.layers.push({
      ty: 4,
      ind: 9,
      nm: 'Later',
      ip: 70,
      op: 90,
      st: 0,
      ks: {
        o: {
          a: 1,
          k: [
            { t: 70, s: [0], o: { x: [0.5], y: [0.5] }, i: { x: [0.5], y: [0.5] } },
            { t: 80, s: [100] },
          ],
        },
      },
      shapes: [],
    } as never)
    doc.layers.push({
      ty: 3,
      ind: 10,
      nm: 'Parent',
      ip: 0,
      op: 20,
      st: 0,
      ks: {
        p: {
          a: 1,
          k: [
            { t: 0, s: [0, 0], o: { x: 0.5, y: 0.5 }, i: { x: 0.5, y: 0.5 } },
            { t: 90, s: [90, 0] },
          ],
        },
      },
    } as never)
    doc.layers[0].parent = 10
    extendEnd(doc, 1)
    const later = doc.layers[3]
    expect([later.ip, later.op]).toEqual([100, 120])
    expect(getKeyframes(later.ks.o)!.map((k) => k.t)).toEqual([100, 110])
    const parent = doc.layers[4].ks.p as VectorProperty
    expect(evaluateArray(parent, 80)).toEqual(evaluateArray(parent, 60))
    expect(evaluateArray(parent, 60)[0]).toBeCloseTo(60, 3)
  })

  it('keeps a precomp visible when its content ends exactly at the out point', () => {
    const before = loadBounce()
    precomposeRoot(before, { name: 'All' })
    const after = structuredClone(before)
    const result = extendEnd(after, 1)
    expect(result.remappedLayers).toBe(1)
    const end = snapshot(before, 59.9999, { exact: true })
    expect([...end.keys()]).toEqual(['0', '0>0', '0>1', '0>2'])
    for (const t of [60, 70, 89])
      expect(snapshotDiff(end, snapshot(after, t, { exact: true }), 2e-3)).toBeNull()
    // Before the pause, every whole frame is unchanged.
    expectSameMotion(before, after, frames(0, 60, 1), (t) => t, { exact: true })
  })

  it('holds a time-remapped precomp on the frame shown just before the end', () => {
    // After Effects' default time remap runs to the content's end: frozen there, the content
    // would be past its out point.
    const before = loadBounce()
    const { layer } = precomposeRoot(before, { name: 'All' })
    layer.tm = {
      a: 1,
      k: [
        { t: 0, s: [0], o: { x: [0.167], y: [0.167] }, i: { x: [0.833], y: [0.833] } },
        { t: 60, s: [2] },
      ],
    }
    const after = structuredClone(before)
    extendEnd(after, 1)
    const end = snapshot(before, 59.9999, { exact: true })
    for (const t of [60, 75, 89])
      expect(snapshotDiff(end, snapshot(after, t, { exact: true }), 2e-3)).toBeNull()
  })

  it('freezes precomps without delaying switches before the end', () => {
    const before = loadTestJson()
    // Cut the root while three splash precomps (in at 77, st 71–75) are still busy: they get
    // freeze remaps.
    before.op = 90
    const after = structuredClone(before)
    const result = extendEnd(after, 0.5)
    expect(result).toEqual({ frames: 30, remappedLayers: 3 })
    // Every whole frame before the end is identical, layers switching on it included.
    expectSameMotion(before, after, frames(0, 90, 1), (t) => t, { exact: true, tolerance: 3e-3 })
    expectSameMotion(before, after, frames(0.5, 90, 1), (t) => t, { exact: true, tolerance: 3e-3 })
    const end = snapshot(before, 90 - LEFT, { exact: true })
    expect([...end.keys()]).toEqual(expect.arrayContaining(['6>0', '7>0', '8>0']))
    for (const t of [90, 90.5, 105, 119.5])
      expect(snapshotDiff(end, snapshot(after, t, { exact: true }), 3e-3)).toBeNull()
  })

  it('adds no time remap when the precomps are already still', () => {
    const doc = precompFixture()
    // comp_a's layers end at 40, instance A shows inner frames up to 50: nothing moves at the end.
    doc.op = 50
    const result = extendEnd(doc, 1)
    expect(result.remappedLayers).toBe(0)
    expect((doc.layers[0] as PrecompLayer).tm).toBeUndefined()
  })

  it('rejects invalid lengths', () => {
    expect(() => extendEnd(loadBounce(), 0)).toThrow(RangeError)
  })
})

describe('pingPong', () => {
  it('plays forward then backward', () => {
    const before = loadBounce()
    const after = structuredClone(before)
    const { assetIndex } = pingPong(after, { name: 'Ping-pong' })
    expect(after.op).toBe(120)
    expect(after.layers).toHaveLength(1)
    expect(after.assets![assetIndex].id).toBe('comp_0')
    for (const t of frames(0.5, 60, 1)) {
      expect(snapshotDiff(snapshot(before, t), snapshot(after, t), 2e-3, '0>')).toBeNull()
      expect(snapshotDiff(snapshot(before, t), snapshot(after, 120 - t), 2e-3, '0>')).toBeNull()
    }
    // The turnaround frame shows the last frame: layers that end at the old out point included.
    expect(
      [...snapshot(after, 60, { exact: true }).keys()].filter((k) => k.startsWith('0>')),
    ).toHaveLength(3)
    // The original layers keep their timing.
    expect((after.assets![assetIndex] as PrecompAsset).layers.map((l) => [l.ip, l.op])).toEqual(
      before.layers.map((l) => [l.ip, l.op]),
    )
  })

  it('shows the original frames exactly, layer switches included', () => {
    const before = loadTestJson()
    const after = structuredClone(before)
    pingPong(after)
    const opts = { exact: true, prefix: '0>', tolerance: 3e-3 }
    // Forward half: identical at every whole frame (the remap never lands a hair before one).
    expectSameMotion(before, after, frames(0, 179, 0.5), (t) => t, opts)
    // Backward half: the original mirrored around the out point, as reverseAnimation does (left
    // limits), from the turnaround frame 179 to the last frame 357.
    expectSameMotion(before, after, frames(1, 179.01, 0.5), (t) => 358 - t, { ...opts, left: true })
  })
})

describe('frame-by-frame content', () => {
  // stepFixture: holds, text documents, stacked keys, legacy holds, drawings as consecutive
  // layers under a held parent and a frame-by-frame precomp; everything switches on whole
  // frames 0…23 (op = 24).
  const exact = { exact: true, tolerance: 1e-6 }

  it('reverses into the same frames in exact reverse order', () => {
    const before = stepFixture()
    const after = structuredClone(before)
    reverseAnimation(after)
    // Frame g shows frame 23 − g: every drawing is shown as many frames as before.
    expectSameMotion(before, after, frames(0, 24, 1), (t) => 23 - t, exact)
    // Between whole frames too: the result is the exact mirror (left limits) of the original.
    expectSameMotion(before, after, frames(0.25, 24, 0.25), (t) => 24 - t, { ...exact, left: true })
    expect(after.markers).toEqual([{ cm: 'loop', tm: 8, dr: 12 }])
  })

  it('is its own inverse', () => {
    const before = stepFixture()
    const twice = structuredClone(before)
    reverseAnimation(twice)
    reverseAnimation(twice)
    expectSameMotion(before, twice, frames(0, 24, 0.25), (t) => t, exact)
  })

  it('plays a ping-pong as a boomerang: every drawing lasts as long on the way back', () => {
    const before = stepFixture()
    const after = structuredClone(before)
    pingPong(after)
    const opts = { ...exact, prefix: '0>' }
    expectSameMotion(before, after, frames(0, 24, 0.25), (t) => t, opts)
    // Frame 24 + k shows frame 23 − k: …, 22, 23, 23, 22, … and 1, 0 | 0, 1 at the loop point.
    expectSameMotion(before, after, frames(0, 24, 1), (t) => 47 - t, opts)
  })

  it('pauses on the last frame', () => {
    const before = stepFixture()
    const after = structuredClone(before)
    const result = extendEnd(after, 0.5)
    expect(result).toEqual({ frames: 12, remappedLayers: 0 })
    expectSameMotion(before, after, frames(0, 24, 0.25), (t) => t, exact)
    const last = snapshot(before, 23, { exact: true })
    for (const t of [24, 27.5, 35])
      expect(snapshotDiff(last, snapshot(after, t, { exact: true }), 1e-6)).toBeNull()

    // A flipbook precomp still running at the end (its last drawing ends at inner frame 40)
    // is frozen by a time remap on the frame shown last.
    const busy = stepFixture()
    Object.assign(busy.layers[5], { op: 24, st: -10 })
    const frozen = structuredClone(busy)
    expect(extendEnd(frozen, 1)).toEqual({ frames: 24, remappedLayers: 1 })
    expectSameMotion(busy, frozen, frames(0, 24, 0.25), (t) => t, exact)
    const shown = snapshot(busy, 23, { exact: true })
    expect(shown.has('5>2')).toBe(true)
    for (const t of [24, 30, 47.5])
      expect(snapshotDiff(shown, snapshot(frozen, t, { exact: true }), 1e-6)).toBeNull()
  })

  it('retimes switches with the rest', () => {
    const before = stepFixture()
    const after = structuredClone(before)
    setSpeed(after, 0.5)
    expect(after.op).toBe(48)
    // Every switch lands on a whole frame again: whole frames show the frames of the original.
    expectSameMotion(before, after, frames(0, 24, 0.5), (t) => t * 2, exact)
  })
})

describe('slots', () => {
  it('retimes, reverses and freezes animated slot values with the root', () => {
    const doc = loadBounce()
    doc.slots = {
      tint: {
        p: {
          a: 1,
          k: [
            { t: 0, s: [1, 0, 0, 1], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } },
            { t: 60, s: [0, 0, 1, 1] },
          ],
        },
      },
      label: { p: { a: 0, k: [0, 1, 0, 1] } },
    }
    const slotKeys = (d: Animation) => (d.slots!.tint.p as { k: Kf[] }).k.map((k) => k.t)
    const scaled = structuredClone(doc)
    setSpeed(scaled, 2)
    expect(slotKeys(scaled)).toEqual([0, 30])
    const reversed = structuredClone(doc)
    reverseAnimation(reversed)
    expect((reversed.slots!.tint.p as { k: Kf[] }).k.map((k) => k.s)).toEqual([
      [0, 0, 1, 1],
      [1, 0, 0, 1],
    ])
    const held = structuredClone(doc)
    doc.op = 30
    held.op = 30
    extendEnd(held, 1)
    expect(slotKeys(held)).toEqual([0, 30])
    expect(held.slots!.label).toEqual(doc.slots.label)
  })
})

describe('countExpressions', () => {
  it('counts properties driven by expressions', () => {
    expect(countExpressions(loadTestJson())).toBe(1)
    expect(countExpressions(loadBounce())).toBe(0)
  })
})
