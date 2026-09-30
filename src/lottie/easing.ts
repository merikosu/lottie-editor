/**
 * Cubic-bezier easing (same algorithm as lottie-web's BezierFactory / gre/bezier-easing),
 * plus the easing presets offered in the UI.
 */
import type { EasingHandle, Keyframe } from './types'

const NEWTON_ITERATIONS = 4
const NEWTON_MIN_SLOPE = 0.001
const SUBDIVISION_PRECISION = 1e-7
const SUBDIVISION_MAX_ITERATIONS = 10
const SPLINE_TABLE_SIZE = 11
const SAMPLE_STEP = 1 / (SPLINE_TABLE_SIZE - 1)

const A = (a1: number, a2: number) => 1 - 3 * a2 + 3 * a1
const B = (a1: number, a2: number) => 3 * a2 - 6 * a1
const C = (a1: number) => 3 * a1
const calcBezier = (t: number, a1: number, a2: number) =>
  ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t
const getSlope = (t: number, a1: number, a2: number) =>
  3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1)

export type EasingFn = (x: number) => number

const cache = new Map<string, EasingFn>()

/** Returns the easing function for cubic-bezier(x1, y1, x2, y2). x1/x2 are clamped to [0, 1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFn {
  const key = `${x1},${y1},${x2},${y2}`
  const cached = cache.get(key)
  if (cached) return cached

  const mX1 = Math.min(1, Math.max(0, x1))
  const mX2 = Math.min(1, Math.max(0, x2))
  let fn: EasingFn

  if (mX1 === y1 && mX2 === y2) {
    fn = (x) => x
  } else {
    const samples = new Float32Array(SPLINE_TABLE_SIZE)
    for (let i = 0; i < SPLINE_TABLE_SIZE; i++) samples[i] = calcBezier(i * SAMPLE_STEP, mX1, mX2)

    const binarySubdivide = (aX: number, aA: number, aB: number) => {
      let currentX: number
      let currentT: number
      let i = 0
      let a = aA
      let b = aB
      do {
        currentT = a + (b - a) / 2
        currentX = calcBezier(currentT, mX1, mX2) - aX
        if (currentX > 0) b = currentT
        else a = currentT
      } while (Math.abs(currentX) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS)
      return currentT
    }

    const newtonRaphson = (aX: number, guess: number) => {
      let t = guess
      for (let i = 0; i < NEWTON_ITERATIONS; i++) {
        const slope = getSlope(t, mX1, mX2)
        if (slope === 0) return t
        t -= (calcBezier(t, mX1, mX2) - aX) / slope
      }
      return t
    }

    const getTForX = (aX: number) => {
      let intervalStart = 0
      let current = 1
      const last = SPLINE_TABLE_SIZE - 1
      for (; current !== last && samples[current] <= aX; current++) intervalStart += SAMPLE_STEP
      current--
      const dist = (aX - samples[current]) / (samples[current + 1] - samples[current])
      const guess = intervalStart + dist * SAMPLE_STEP
      const slope = getSlope(guess, mX1, mX2)
      if (slope >= NEWTON_MIN_SLOPE) return newtonRaphson(aX, guess)
      if (slope === 0) return guess
      return binarySubdivide(aX, intervalStart, intervalStart + SAMPLE_STEP)
    }

    fn = (x) => {
      if (x <= 0) return 0
      if (x >= 1) return 1
      return calcBezier(getTForX(x), y1, y2)
    }
  }

  if (cache.size > 2000) cache.clear()
  cache.set(key, fn)
  return fn
}

/** Picks the component `dim` of a handle value (scalar or per-dimension array). */
export function handleComponent(
  v: number | number[] | undefined,
  dim: number,
  fallback: number,
): number {
  if (v === undefined) return fallback
  if (Array.isArray(v)) return v[dim] ?? v[0] ?? fallback
  return v
}

/** Easing function of the segment that starts at keyframe `kf`, for dimension `dim`. */
export function segmentEasing(kf: Keyframe<unknown>, dim = 0): EasingFn {
  const x1 = handleComponent(kf.o?.x, dim, 0)
  const y1 = handleComponent(kf.o?.y, dim, 0)
  const x2 = handleComponent(kf.i?.x, dim, 1)
  const y2 = handleComponent(kf.i?.y, dim, 1)
  return cubicBezier(x1, y1, x2, y2)
}

/* -------------------------------------------------------------------------- */
/*                                   Presets                                  */
/* -------------------------------------------------------------------------- */

/** A segment easing as cubic-bezier control points [x1, y1, x2, y2]. */
export type BezierCurve = [number, number, number, number]

export interface EasingPreset {
  id: string
  /** Control points; `null` means hold (step). */
  curve: BezierCurve | null
}

export const EASING_PRESETS: EasingPreset[] = [
  { id: 'linear', curve: [0, 0, 1, 1] },
  { id: 'easyEase', curve: [0.333, 0, 0.667, 1] },
  { id: 'easeIn', curve: [0.42, 0, 1, 1] },
  { id: 'easeOut', curve: [0, 0, 0.58, 1] },
  { id: 'easeInOut', curve: [0.42, 0, 0.58, 1] },
  { id: 'easeInCubic', curve: [0.32, 0, 0.67, 0] },
  { id: 'easeOutCubic', curve: [0.33, 1, 0.68, 1] },
  { id: 'easeInOutCubic', curve: [0.65, 0, 0.35, 1] },
  { id: 'easeInExpo', curve: [0.7, 0, 0.84, 0] },
  { id: 'easeOutExpo', curve: [0.16, 1, 0.3, 1] },
  { id: 'easeInOutExpo', curve: [0.87, 0, 0.13, 1] },
  { id: 'easeInBack', curve: [0.36, 0, 0.66, -0.56] },
  { id: 'easeOutBack', curve: [0.34, 1.56, 0.64, 1] },
  { id: 'easeInOutBack', curve: [0.68, -0.6, 0.32, 1.6] },
  { id: 'hold', curve: null },
]

/** Reads the curve of the segment starting at `kf` (first dimension). */
export function curveOfKeyframe(kf: Keyframe<unknown>): BezierCurve | null {
  if (kf.h === 1) return null
  return [
    handleComponent(kf.o?.x, 0, 0),
    handleComponent(kf.o?.y, 0, 0),
    handleComponent(kf.i?.x, 0, 1),
    handleComponent(kf.i?.y, 0, 1),
  ]
}

/** Finds the preset matching a curve (within tolerance). */
export function matchPreset(curve: BezierCurve | null, epsilon = 0.01): EasingPreset | undefined {
  if (curve === null) return EASING_PRESETS.find((p) => p.curve === null)
  const isLinear =
    Math.abs(curve[0] - curve[1]) < epsilon && Math.abs(curve[2] - curve[3]) < epsilon
  if (isLinear) return EASING_PRESETS[0]
  return EASING_PRESETS.find(
    (p) => p.curve !== null && p.curve.every((v, i) => Math.abs(v - curve[i]) < epsilon),
  )
}

/**
 * Builds `o`/`i` handles for a curve, preserving the shape (scalar vs per-dimension array)
 * of the existing handles so files stay consistent with their exporter's conventions.
 */
function shapeLike(v: number | number[] | undefined, value: number): number | number[] {
  return Array.isArray(v) ? v.map(() => value) : value
}

export function handlesForCurve(
  curve: BezierCurve,
  existing?: { o?: EasingHandle; i?: EasingHandle },
): { o: EasingHandle; i: EasingHandle } {
  return {
    o: { x: shapeLike(existing?.o?.x, curve[0]), y: shapeLike(existing?.o?.y, curve[1]) },
    i: { x: shapeLike(existing?.i?.x, curve[2]), y: shapeLike(existing?.i?.y, curve[3]) },
  }
}
