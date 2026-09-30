import { describe, expect, it } from 'vitest'
import { cubicBezier, EASING_PRESETS } from '@/lottie/easing'
import {
  clamp01,
  dragDecimals,
  easeAt,
  easeFromSpeedHandle,
  easeFromValueHandle,
  easeParam,
  easeSlope,
  easeWithSpeed,
  fitRange,
  isLinearEase,
  MIN_INFLUENCE,
  niceStep,
  polylineDistance,
  sameSpeed,
  segmentDistance,
  spatialLength,
  speedHandles,
  stepDecimals,
  valueHandles,
  valueTicks,
  type Ease,
} from '../graph/math'

const ease = (x1: number, y1: number, x2: number, y2: number): Ease => ({ x1, y1, x2, y2 })
const LINEAR = (): Ease => ease(0, 0, 1, 1)

/** Deterministic pseudo-random numbers (tests must not flake). */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const curves: Ease[] = [
  ...EASING_PRESETS.flatMap((p) => (p.curve ? [ease(...p.curve)] : [])),
  ease(0.167, 0.167, 0.833, 0.833),
  ease(0.55, 0, 0.9, 0.6),
  ease(0.1, 0.4, 0.45, 1),
  ease(0.9, 0.1, 0.1, 0.9),
  ease(1, 0, 0, 1),
]

describe('easing curve', () => {
  it('matches the evaluator easing (lottie-web algorithm) everywhere', () => {
    for (const e of curves) {
      const reference = cubicBezier(e.x1, e.y1, e.x2, e.y2)
      for (let i = 0; i <= 50; i++) {
        const x = i / 50
        expect(easeAt(e, x)).toBeCloseTo(reference(x), 3)
      }
    }
  })

  it('inverts the time coordinate precisely, also on flat spots', () => {
    for (const e of curves) {
      for (let i = 1; i < 40; i++) {
        const x = i / 40
        const s = easeParam(x, e.x1, e.x2)
        const m = 1 - s
        const back = 3 * m * m * s * clamp01(e.x1) + 3 * m * s * s * clamp01(e.x2) + s * s * s
        expect(back).toBeCloseTo(x, 9)
      }
    }
    expect(easeParam(0, 0.3, 0.7)).toBe(0)
    expect(easeParam(1, 0.3, 0.7)).toBe(1)
    expect(easeParam(-2, 0.3, 0.7)).toBe(0)
    expect(easeParam(Number.NaN, 0.3, 0.7)).toBe(0)
  })

  it('takes the linear shortcut like lottie-web (any curve on the diagonal)', () => {
    expect(isLinearEase(ease(0.167, 0.167, 0.833, 0.833))).toBe(true)
    expect(isLinearEase(ease(0, 0, 1, 1))).toBe(true)
    expect(isLinearEase(ease(0.33, 0, 0.67, 1))).toBe(false)
    // x is clamped before the comparison, like the evaluator.
    expect(isLinearEase(ease(-0.2, 0, 1, 1))).toBe(true)
    expect(easeAt(ease(0.2, 0.2, 0.7, 0.7), 0.3)).toBe(0.3)
    expect(easeSlope(ease(0.2, 0.2, 0.7, 0.7), 0.9)).toBe(1)
  })

  it('has the slope of the curve (central differences)', () => {
    for (const e of curves) {
      for (let i = 1; i < 20; i++) {
        const x = i / 20
        const h = 1e-5
        const numeric = (easeAt(e, x + h) - easeAt(e, x - h)) / (2 * h)
        const analytic = easeSlope(e, x)
        if (Math.abs(analytic) > 50) continue // vertical tangents: finite differences blow up
        expect(analytic).toBeCloseTo(numeric, 2)
      }
    }
  })

  it('gives the handle slopes at the ends (After Effects speed), limits for zero-length handles', () => {
    const e = ease(0.25, 0.1, 0.6, 0.8)
    expect(easeSlope(e, 0)).toBeCloseTo(0.1 / 0.25, 9)
    expect(easeSlope(e, 1)).toBeCloseTo((1 - 0.8) / (1 - 0.6), 9)
    // Ease out [0, 0, 0.58, 1]: the out handle has no length, the curve leaves towards P2.
    expect(easeSlope(ease(0, 0, 0.58, 1), 0)).toBeCloseTo(1 / 0.58, 2)
    // Easy ease starts and ends at rest.
    expect(easeSlope(ease(0.333, 0, 0.667, 1), 0)).toBeCloseTo(0, 9)
    expect(easeSlope(ease(0.333, 0, 0.667, 1), 1)).toBeCloseTo(0, 9)
  })
})

describe('value graph handles', () => {
  const seg = { t0: 10, v0: 100, t1: 30, v1: 200 }

  it('are the inner control points of the value cubic', () => {
    const e = ease(0.25, 0.1, 0.75, 0.9)
    const h = valueHandles(seg.t0, seg.v0, seg.t1, seg.v1, e)
    expect(h.out).toEqual({ t: 15, v: 110 })
    expect(h.in).toEqual({ t: 25, v: 190 })
  })

  it('reproduce the evaluated value curve: v(t) is the cubic through the handles', () => {
    const e = ease(0.4, -0.3, 0.2, 1.4)
    const h = valueHandles(seg.t0, seg.v0, seg.t1, seg.v1, e)
    for (let i = 1; i < 10; i++) {
      const s = i / 10
      const m = 1 - s
      const bt =
        m ** 3 * seg.t0 + 3 * m * m * s * h.out.t + 3 * m * s * s * h.in.t + s ** 3 * seg.t1
      const bv =
        m ** 3 * seg.v0 + 3 * m * m * s * h.out.v + 3 * m * s * s * h.in.v + s ** 3 * seg.v1
      const x = (bt - seg.t0) / (seg.t1 - seg.t0)
      expect(seg.v0 + (seg.v1 - seg.v0) * easeAt(e, x)).toBeCloseTo(bv, 6)
    }
  })

  it('round-trip through easeFromValueHandle', () => {
    const e = ease(0.3, 0.2, 0.6, 1.2)
    const h = valueHandles(seg.t0, seg.v0, seg.t1, seg.v1, e)
    expect(easeFromValueHandle('out', h.out, seg, LINEAR())).toMatchObject({ x1: 0.3, y1: 0.2 })
    const back = easeFromValueHandle('in', h.in, seg, e)
    expect(back.x2).toBeCloseTo(0.6, 12)
    expect(back.y2).toBeCloseTo(1.2, 12)
  })

  it('keep time inside the segment and y on flat segments; clamp y for spatial segments', () => {
    const e = ease(0.3, 0.2, 0.6, 0.8)
    expect(easeFromValueHandle('out', { t: 50, v: 150 }, seg, e).x1).toBe(1)
    expect(easeFromValueHandle('in', { t: 0, v: 150 }, seg, e).x2).toBe(0)
    const flat = { t0: 0, v0: 5, t1: 10, v1: 5 }
    expect(easeFromValueHandle('out', { t: 4, v: 99 }, flat, e)).toEqual({ ...e, x1: 0.4 })
    expect(easeFromValueHandle('out', { t: 15, v: 400 }, seg, e, true).y1).toBe(1)
    expect(easeFromValueHandle('in', { t: 15, v: -400 }, seg, e, true).y2).toBe(0)
  })
})

describe('speed graph handles', () => {
  it('read influence and speed like After Effects', () => {
    // 20 frames, value +100: average speed 5 per frame.
    const h = speedHandles(20, 100, ease(0.25, 0.5, 0.5, 0.75))
    expect(h.out.influence).toBe(0.25)
    expect(h.out.speed).toBeCloseTo(5 * (0.5 / 0.25), 9)
    expect(h.in.influence).toBe(0.5)
    expect(h.in.speed).toBeCloseTo(5 * (0.25 / 0.5), 9)
    // Negative changes give negative speeds (1-D velocity).
    expect(speedHandles(20, -100, ease(0.25, 0.5, 0.5, 0.75)).out.speed).toBeCloseTo(-10, 9)
  })

  it('round-trip through easeFromSpeedHandle', () => {
    const e = ease(0.3, 0.15, 0.55, 0.95)
    const T = 24
    const K = -80
    const h = speedHandles(T, K, e)
    const out = easeFromSpeedHandle('out', h.out, T, K, ease(0.5, 0.5, 0.5, 0.5))
    expect(out.x1).toBeCloseTo(0.3, 12)
    expect(out.y1).toBeCloseTo(0.15, 12)
    const inn = easeFromSpeedHandle('in', h.in, T, K, ease(0.5, 0.5, 0.5, 0.5))
    expect(inn.x2).toBeCloseTo(0.55, 12)
    expect(inn.y2).toBeCloseTo(0.95, 12)
  })

  it('changing the influence keeps the speed', () => {
    const e = ease(0.3, 0.15, 0.55, 0.95)
    const before = speedHandles(10, 50, e).out.speed
    const next = easeFromSpeedHandle('out', { influence: 0.6, speed: before }, 10, 50, e)
    expect(next.x1).toBe(0.6)
    expect(speedHandles(10, 50, next).out.speed).toBeCloseTo(before, 9)
  })

  it('limits influence to 0.1 %–100 %, keeps y without change and clamps spatial y', () => {
    const e = ease(0.3, 0.15, 0.55, 0.95)
    expect(easeFromSpeedHandle('out', { influence: 0, speed: 1 }, 10, 5, e).x1).toBe(MIN_INFLUENCE)
    expect(easeFromSpeedHandle('in', { influence: 3, speed: 1 }, 10, 5, e).x2).toBe(0)
    expect(easeFromSpeedHandle('out', { influence: 0.5, speed: 9 }, 10, 0, e).y1).toBe(0.15)
    expect(easeFromSpeedHandle('out', { influence: 0.5, speed: 999 }, 10, 5, e, true).y1).toBe(1)
    expect(easeFromSpeedHandle('in', { influence: 0.5, speed: 999 }, 10, 5, e, true).y2).toBe(0)
  })

  it('easeWithSpeed matches the other side of a key (continuous tangents)', () => {
    const prev = ease(0.2, 0.1, 0.6, 0.7)
    const next = ease(0.4, 0.3, 0.8, 0.9)
    const target = speedHandles(12, 40, next).out.speed
    const adjusted = easeWithSpeed('in', target, 30, 90, prev)
    expect(adjusted.x2).toBe(0.6)
    expect(speedHandles(30, 90, adjusted).in.speed).toBeCloseTo(target, 9)
    expect(sameSpeed(speedHandles(30, 90, adjusted).in.speed, target)).toBe(true)
    expect(sameSpeed(1, 1.5)).toBe(false)
    expect(sameSpeed(0, 0)).toBe(true)
    expect(sameSpeed(Number.POSITIVE_INFINITY, 1)).toBe(false)
  })
})

describe('spatial length', () => {
  it('is the chord for straight segments (zero tangents)', () => {
    expect(spatialLength([0, 0, 0], [30, 40, 0], [0, 0, 0], [0, 0, 0])).toBeCloseTo(50, 9)
  })

  it('follows the curve (quarter circle ≈ πr/2)', () => {
    const k = 0.5523 * 100
    const len = spatialLength([100, 0], [0, 100], [0, k], [k, 0])
    expect(len).toBeCloseTo((Math.PI * 100) / 2, 0)
  })

  it('is zero when nothing moves', () => {
    expect(spatialLength([5, 5], [5, 5], [0, 0], [0, 0])).toBeCloseTo(0, 9)
  })
})

describe('axes', () => {
  it('picks 1-2-5 steps', () => {
    expect(niceStep(100, 5)).toBe(20)
    expect(niceStep(100, 10)).toBe(10)
    expect(niceStep(7, 4)).toBe(2)
    expect(niceStep(0.37, 4)).toBe(0.1)
    expect(niceStep(0, 4)).toBe(1)
    expect(niceStep(Number.NaN, 4)).toBe(1)
  })

  it('lists ticks inside the range, with an exact zero', () => {
    const { step, values } = valueTicks(-12, 47, 200, 32)
    expect(step).toBe(10)
    expect(values).toEqual([-10, 0, 10, 20, 30, 40])
    // The densest nice step whose ticks stay at least the gap apart (148 px for 421 units).
    expect(valueTicks(-53, 368, 148).step).toBe(100)
    expect(valueTicks(-53, 368, 148, 36).step).toBe(200)
    expect(valueTicks(-0.3, 0.3, 100, 30).values).toContain(0)
    expect(valueTicks(5, 5, 100).values).toEqual([])
    expect(valueTicks(0, 1, 0).values).toEqual([])
  })

  it('knows the decimals of a step', () => {
    expect(stepDecimals(10)).toBe(0)
    expect(stepDecimals(1)).toBe(0)
    expect(stepDecimals(0.5)).toBe(1)
    expect(stepDecimals(0.02)).toBe(2)
    expect(stepDecimals(0)).toBe(0)
  })

  it('fits flat curves around their value', () => {
    expect(fitRange(0, 10)).toEqual([0, 10])
    expect(fitRange(50, 50)).toEqual([45, 55])
    expect(fitRange(0, 0)).toEqual([-1, 1])
    expect(fitRange(Infinity, -Infinity)).toEqual([-1, 1])
  })

  it('rounds dragged values to what a pixel can express', () => {
    expect(dragDecimals(2.5)).toBe(0)
    expect(dragDecimals(1)).toBe(0)
    expect(dragDecimals(0.37)).toBe(1)
    expect(dragDecimals(0.004)).toBe(3)
    expect(dragDecimals(1e-9)).toBe(4)
    expect(dragDecimals(0)).toBe(3)
  })
})

describe('hit testing', () => {
  it('measures distances to segments and polylines', () => {
    expect(segmentDistance(5, 3, 0, 0, 10, 0)).toBe(3)
    expect(segmentDistance(-4, 3, 0, 0, 10, 0)).toBe(5)
    expect(segmentDistance(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2, 12)
    expect(polylineDistance(5, 1, [0, 0, 10, 0, 10, 10])).toBe(1)
    expect(polylineDistance(11, 5, [0, 0, 10, 0, 10, 10])).toBe(1)
    expect(polylineDistance(3, 4, [0, 0])).toBe(5)
    expect(polylineDistance(3, 4, [])).toBe(Infinity)
  })
})

describe('random curves', () => {
  it('speed handles and value handles agree on the end slopes', () => {
    const next = rng(7)
    for (let n = 0; n < 200; n++) {
      const e = ease(0.02 + next() * 0.96, next() * 2 - 0.5, 0.02 + next() * 0.96, next() * 2 - 0.5)
      const T = 1 + next() * 60
      const K = (next() - 0.5) * 400
      const s = speedHandles(T, K, e)
      const h = valueHandles(0, 0, T, K, e)
      // The value handle's slope is the speed at the key.
      expect(s.out.speed).toBeCloseTo(h.out.v / h.out.t, 6)
      expect(s.in.speed).toBeCloseTo((K - h.in.v) / (T - h.in.t), 6)
    }
  })
})
