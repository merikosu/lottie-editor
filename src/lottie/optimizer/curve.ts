/**
 * Sampling and comparing the evaluated curve of a keyframed property.
 *
 * Lossy steps (keyframe removal, rounding of keyframed values) are verified by evaluating the
 * property with the foundation evaluator (which mirrors lottie-web: per-dimension easing,
 * spatial bezier motion eased along the arc length, holds) at a dense set of times — every
 * keyframe time, a point just before each keyframe (holds jump there), and at least four points
 * per frame inside every segment — and checking that no component moved by more than its budget.
 * Players render sub-frames (60 Hz displays, time stretch), so integer frames are not enough.
 */
import { evaluateArray, evaluatePath, type AnyProperty } from '../property'
import type { BezierPath, ShapePathProperty } from '../types'
import { isKeyframeList, isObj, type Json } from './model'
import { budget } from './numbers'
import type { PropTolerance } from './tolerance'

/** Samples per frame inside keyframe segments. */
export const SAMPLES_PER_FRAME = 4
/**
 * Samples inside one segment at most: a segment of 1000+ frames (or a damaged time far in the
 * future) is sampled more sparsely instead of allocating millions of samples.
 */
const MAX_SEGMENT_SAMPLES = 4096

/** True when the property's values are bezier paths. */
export function isPathProperty(prop: Json): boolean {
  const k = prop.k
  if (isObj(k)) return Array.isArray(k.v)
  if (!isKeyframeList(k)) return false
  const s = k[0].s ?? k[0].e
  return Array.isArray(s) && isObj(s[0]) && Array.isArray((s[0] as Json).v)
}

/** Flattened vertex data of a path: v, then i, then o (x, y pairs). */
export function flatPath(p: BezierPath | null, out: number[] = []): number[] {
  if (!p) return out
  for (const key of ['v', 'i', 'o'] as const) {
    for (const pt of p[key] ?? []) {
      out.push(pt?.[0] ?? 0, pt?.[1] ?? 0)
    }
  }
  return out
}

/** Value of a property at `t` as a flat number list (paths flattened). */
export function valueAt(prop: Json, t: number, path: boolean): number[] {
  if (path) return flatPath(evaluatePath(prop as unknown as ShapePathProperty, t))
  return evaluateArray(prop as unknown as AnyProperty, t)
}

/** Sample times covering [first key, last key] of a keyframe list (sorted, unique). */
export function sampleTimes(kfs: readonly Json[]): number[] {
  const times: number[] = []
  const tOf = (i: number) => kfs[i].t as number
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = tOf(i)
    const b = tOf(i + 1)
    times.push(a)
    const span = b - a
    if (!(span > 0)) continue
    const n = Math.min(MAX_SEGMENT_SAMPLES, Math.max(4, Math.ceil(span * SAMPLES_PER_FRAME)))
    for (let j = 1; j < n; j++) times.push(a + (span * j) / n)
    // Just before the next key: catches jumps at the end of holds.
    times.push(b - Math.min(1e-3, span / (4 * n)))
  }
  times.push(tOf(kfs.length - 1))
  return times
}

/** Values of a property at the given times (flat, `dims` numbers per time). */
export interface Samples {
  times: number[]
  values: number[][]
}

export function sample(prop: Json, times: readonly number[], path: boolean): Samples {
  return { times: [...times], values: times.map((t) => valueAt(prop, t, path)) }
}

/** Index of the first sample time ≥ t (binary search). */
export function lowerBound(times: readonly number[], t: number): number {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Float noise allowance on top of a budget (relative). */
const NOISE = 1e-9

/** True when `b` is within the budget of `a`, component by component. */
export function within(a: readonly number[], b: readonly number[], tol: PropTolerance): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const d = Math.abs(x - b[i])
    if (!(d <= budget(x, tol) + NOISE * Math.max(1, Math.abs(x)))) return false
  }
  return true
}

/**
 * Largest share of the budget any component of `prop` uses at the reference sample times:
 * max |Δ| / budget (0 = identical, 1 = the whole budget). Infinity when a length differs.
 */
export function spentShare(prop: Json, ref: Samples, tol: PropTolerance, path: boolean): number {
  let worst = 0
  for (let i = 0; i < ref.times.length; i++) {
    const a = ref.values[i]
    const b = valueAt(prop, ref.times[i], path)
    if (a.length !== b.length) return Infinity
    for (let c = 0; c < a.length; c++) {
      const d = Math.abs(a[c] - b[c])
      if (d === 0) continue
      const allowed = budget(a[c], tol)
      worst = Math.max(worst, allowed > 0 ? d / allowed : Infinity)
    }
  }
  return worst
}

/**
 * True when `prop` (possibly modified) evaluates within `tol` of the reference samples at every
 * sample time in [from, to] (inclusive; the whole range when omitted).
 */
export function matchesSamples(
  prop: Json,
  ref: Samples,
  tol: PropTolerance,
  path: boolean,
  from = -Infinity,
  to = Infinity,
): boolean {
  const start = from === -Infinity ? 0 : lowerBound(ref.times, from)
  for (let i = start; i < ref.times.length && ref.times[i] <= to; i++) {
    if (!within(ref.values[i], valueAt(prop, ref.times[i], path), tol)) return false
  }
  return true
}
