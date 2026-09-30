/**
 * `precision`: every number of a known property is shortened to the fewest decimals that keep
 * it within its budget (see tolerance.ts): coordinates by the magnification of their space,
 * angles and scales through the composition extent, colors and opacity by perceptual steps.
 * Times, counts and unknown data keep their exact values.
 *
 * Static values are rounded directly (the error of each number is bounded by construction).
 * Keyframed properties are rounded as a whole — values, spatial tangents and easing handles —
 * and the resulting curve is verified against the curve before rounding at dense sample times;
 * when easing rounding amplifies too much (steep curves, large moves), finer steps are tried.
 * Without spatial tangents and easing overshoot every frame is a convex combination of two key
 * values, so rounding only the values is safe without sampling: large properties (paths) take
 * that path directly, and it is the fallback when handle rounding does not verify.
 * The budget is what keyframe / path simplification left of the property's (`tc.spent`).
 */
import { isPathProperty, matchesSamples, sample, sampleTimes } from '../curve'
import {
  compLayers,
  isEvaluableKeyframes,
  isKeyframeList,
  isObj,
  listComps,
  visitLayerProperties,
  type Json,
} from '../model'
import { roundValue, roundWithin } from '../numbers'
import { SpaceScales } from '../scale'
import { EXACT, isExact, share, toleranceModel, type PropTolerance } from '../tolerance'
import { throwIfAborted, type TechniqueContext, type TechniqueDetails } from './context'

/**
 * A bezier curve point moves by at most δv + 0.75·δt when vertices move by δv and tangents by δt
 * (control points are vertex + tangent): a budget q per number keeps the curve within 1.75 q.
 */
const PATH_FACTOR = 1.75

interface Counter {
  numbers: number
}

function roundArray(arr: unknown[], t: PropTolerance, c: Counter): void {
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (typeof v === 'number') {
      const r = roundValue(v, t)
      if (r !== v) {
        arr[i] = r
        c.numbers++
      }
    } else if (Array.isArray(v)) roundArray(v, t, c)
  }
}

function roundPath(p: unknown, q: number, c: Counter): void {
  if (!isObj(p)) return
  const t: PropTolerance = { abs: q, rel: 0 }
  for (const key of ['v', 'i', 'o'])
    if (Array.isArray(p[key])) roundArray(p[key] as unknown[], t, c)
}

/** Rounds a keyframe value (`s` / `e`): numbers, number arrays or `[path]`. */
function roundKeyValue(
  kf: Json,
  key: 's' | 'e',
  t: PropTolerance,
  path: boolean,
  c: Counter,
): void {
  const v = kf[key]
  if (v === undefined) return
  if (path) {
    for (const p of Array.isArray(v) ? v : []) roundPath(p, t.abs / PATH_FACTOR, c)
    return
  }
  if (typeof v === 'number') {
    const r = roundValue(v, t)
    if (r !== v) {
      kf[key] = r
      c.numbers++
    }
  } else if (Array.isArray(v)) roundArray(v, t, c)
}

function roundHandle(h: unknown, q: number, c: Counter): void {
  if (!isObj(h)) return
  for (const axis of ['x', 'y']) {
    const v = h[axis]
    if (typeof v === 'number') {
      const r = roundWithin(v, q)
      if (r !== v) {
        h[axis] = r
        c.numbers++
      }
    } else if (Array.isArray(v)) roundArray(v, { abs: q, rel: 0 }, c)
  }
}

/** Rounds every number of a keyframe list (times excluded). */
function roundKeyframes(
  kfs: Json[],
  t: PropTolerance,
  handleStep: number,
  path: boolean,
  c: Counter,
): void {
  const spatial = kfs.some((kf) => Array.isArray(kf.to) || Array.isArray(kf.ti))
  // Spatial motion: the path control points are value + tangent (same bound as bezier paths).
  const vt: PropTolerance = spatial ? { abs: t.abs / PATH_FACTOR, rel: t.rel / PATH_FACTOR } : t
  for (const kf of kfs) {
    roundKeyValue(kf, 's', vt, path, c)
    roundKeyValue(kf, 'e', vt, path, c)
    for (const key of ['to', 'ti'])
      if (Array.isArray(kf[key])) roundArray(kf[key] as unknown[], vt, c)
    roundHandle(kf.o, handleStep, c)
    roundHandle(kf.i, handleStep, c)
  }
}

/** Attempts for keyframed properties: [value budget factor, easing handle step]. */
const ATTEMPTS: [number, number][] = [
  [1, 0.005],
  [1, 0.0005],
  [0.1, 0.00005],
]

/** Rounds one property within `tol`; returns the number of numbers changed. */
export function roundProperty(prop: Json, tol: PropTolerance): number {
  const c: Counter = { numbers: 0 }
  const path = isPathProperty(prop)
  const k = prop.k
  if (!isKeyframeList(k)) {
    if (path) roundPath(k, tol.abs / PATH_FACTOR, c)
    else if (typeof k === 'number') {
      const r = roundValue(k, tol)
      if (r !== k) {
        prop.k = r
        c.numbers++
      }
    } else if (Array.isArray(k)) roundArray(k, tol, c)
    return c.numbers
  }
  // A damaged keyframe cannot be checked against the curve: the property stays as it is.
  if (!isEvaluableKeyframes(k)) return 0
  const spatial = k.some((kf) => Array.isArray(kf.to) || Array.isArray(kf.ti))
  // Without spatial tangents and easing overshoot, a value is always a convex combination of
  // two keyframe values: rounding only the values (easing untouched) keeps every frame within
  // the budget — no sampling needed. Large properties (paths) take that path directly.
  const convex = !spatial && k.every((kf) => withinUnit(kf.o) && withinUnit(kf.i))
  const large = path || k.length > 400 || (Array.isArray(k[0].s) && k[0].s.length > 8)
  if (convex && large) return roundValuesOnly(k, tol, path)
  const original = JSON.stringify(k)
  const ref = sample(prop, sampleTimes(k), path)
  for (const [factor, handleStep] of ATTEMPTS) {
    const kfs = JSON.parse(original) as Json[]
    const attempt: Counter = { numbers: 0 }
    roundKeyframes(kfs, { abs: tol.abs * factor, rel: tol.rel * factor }, handleStep, path, attempt)
    if (attempt.numbers === 0) return 0
    const test: Json = { ...prop, k: kfs }
    if (matchesSamples(test, ref, tol, path)) {
      prop.k = kfs
      return attempt.numbers
    }
  }
  return convex ? roundValuesOnly(k, tol, path) : 0
}

/** Easing handle whose y components stay in [0, 1] (the eased fraction cannot overshoot). */
function withinUnit(h: unknown): boolean {
  if (!isObj(h)) return true
  const y = h.y
  const ys = Array.isArray(y) ? y : [y]
  return ys.every((v) => typeof v !== 'number' || (v >= 0 && v <= 1))
}

/** Rounds keyframe values (not times, not easing) within the budget, in place. */
function roundValuesOnly(kfs: Json[], tol: PropTolerance, path: boolean): number {
  const c: Counter = { numbers: 0 }
  for (const kf of kfs) {
    roundKeyValue(kf, 's', tol, path, c)
    roundKeyValue(kf, 'e', tol, path, c)
  }
  return c.numbers
}

export function precision(tc: TechniqueContext): TechniqueDetails {
  if (!(tc.options.pxTolerance > 0)) return { numbers: 0 }
  const scales = new SpaceScales(tc.doc)
  const model = toleranceModel(tc.doc, scales, tc.options.pxTolerance)
  let numbers = 0
  let properties = 0
  for (const comp of listComps(tc.doc)) {
    throwIfAborted(tc.signal)
    for (const layer of compLayers(comp)) {
      visitLayerProperties(layer, comp, { legacyColors: tc.info.legacyColors }, (v) => {
        if (v.role === 'exact' || typeof v.prop.sid === 'string') return
        // Whatever keyframe / path simplification left of the property's budget.
        const left = Math.max(0, 1 - (tc.spent.get(v.prop) ?? 0))
        const tol = share(model.of(v), left)
        if (isExact(tol) || tol === EXACT) return
        const n = roundProperty(v.prop, tol)
        if (n) {
          numbers += n
          properties++
        }
      })
    }
  }
  return { numbers, properties }
}
