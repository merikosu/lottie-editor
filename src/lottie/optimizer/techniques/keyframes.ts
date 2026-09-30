/**
 * `keyframes`: removes keyframes the curve does not need.
 *
 * For every keyframed property with a known meaning, keyframes are removed greedily (longest
 * run first, found by exponential + binary search) when the curve without them stays within the
 * property's budget of the ORIGINAL curve at every sample time (see curve.ts). Kept keyframes
 * keep their times, values, holds and spatial tangents; the merged segment keeps the out-easing
 * of its first keyframe and either the in-easing of the last removed segment or its own. Leading
 * and trailing keyframes that only repeat their neighbour are dropped too, and a property left
 * with one keyframe becomes static.
 *
 * Budget: up to `keyframeTolerance` × half of the property's tolerance; the share actually used
 * is recorded (`tc.spent`) and precision rounds with the rest.
 * With a zero tolerance only exact redundancy goes (constant runs, collinear linear runs).
 * Skipped: properties with their own expression, files whose expressions read other properties'
 * keys (`position.key(2)`), slots, discrete values (counts, time remap), legacy `e` keyframes
 * (run `legacy` first).
 */
import {
  lowerBound,
  isPathProperty,
  matchesSamples,
  sample,
  sampleTimes,
  spentShare,
  within,
  valueAt,
  type Samples,
} from '../curve'
import {
  compLayers,
  hasExpression,
  isEvaluableKeyframes,
  isKeyframeList,
  isObj,
  listComps,
  visitLayerProperties,
  type Json,
} from '../model'
import { maySimplifyKeys } from '../expressions'
import { SpaceScales } from '../scale'
import { staticForm } from './staticize'
import { share, toleranceModel, type PropTolerance } from '../tolerance'
import { throwIfAborted, type TechniqueContext, type TechniqueDetails } from './context'

/**
 * Share of the property budget this step may spend (× keyframeTolerance). It records what it
 * actually used; precision rounds with the rest.
 */
export const KEYFRAMES_SHARE = 0.5

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

const LINEAR_IN = { x: [0.833], y: [0.833] }

/** Candidate start keyframes for the merged segment a → b. */
function mergeVariants(kfs: readonly Json[], a: number, b: number): Json[] {
  const start = kfs[a]
  if (b === a + 1) return [start]
  const last = kfs[b - 1]
  const out: Json[] = []
  if (last.h !== 1 && isObj(last.i)) {
    const v: Json = { ...start, i: last.i }
    if (Array.isArray(start.to) && Array.isArray(last.ti)) v.ti = last.ti
    out.push(v)
  }
  out.push({ ...start })
  return out
}

function times(kfs: readonly Json[]): number[] | null {
  const out: number[] = []
  for (const kf of kfs) {
    const t = kf.t
    if (typeof t !== 'number' || !Number.isFinite(t)) return null
    if (out.length && t < out[out.length - 1]) return null
    out.push(t)
  }
  return out
}

interface SimplifyResult {
  removed: number
  /** The property became static. */
  static: boolean
  /** Largest deviation from the original curve, as a share of `tol` (0 when nothing changed). */
  spent: number
}

/**
 * Simplifies one keyframed property in place within `tol` of its current curve. `firstIn`:
 * the first keyframe must keep an `i` handle (fill / stroke colors of files older than 4.1.9).
 */
export function simplifyProperty(prop: Json, tol: PropTolerance, firstIn = false): SimplifyResult {
  const kfs = prop.k
  if (!isKeyframeList(kfs) || kfs.length < 2) return { removed: 0, static: false, spent: 0 }
  if (kfs.some((kf) => 'e' in kf || kf.s === undefined) || !isEvaluableKeyframes(kfs))
    return { removed: 0, static: false, spent: 0 }
  const t = times(kfs)
  if (!t) return { removed: 0, static: false, spent: 0 }
  const path = isPathProperty(prop)
  const ref: Samples = sample(prop, sampleTimes(kfs), path)
  const n = kfs.length

  const tryMerge = (a: number, b: number): Json | null => {
    for (const variant of mergeVariants(kfs, a, b)) {
      const test: Json = { k: [variant, kfs[b]] }
      if (matchesSamples(test, ref, tol, path, t[a], t[b])) return variant
    }
    return null
  }

  // Interior: greedy longest valid run from each kept keyframe.
  const out: Json[] = []
  let a = 0
  while (a < n - 1) {
    let best = a + 1
    let bestVariant: Json = kfs[a]
    let step = 1
    let bad = -1
    for (;;) {
      const b = Math.min(n - 1, a + 1 + step)
      if (b <= best) break
      const v = tryMerge(a, b)
      if (v) {
        best = b
        bestVariant = v
        if (b === n - 1) break
        step *= 2
      } else {
        bad = b
        break
      }
    }
    // Binary search between the last valid and the first invalid end.
    let lo = best
    let hi = bad
    while (hi > lo + 1) {
      const mid = (lo + hi) >> 1
      const v = tryMerge(a, mid)
      if (v) {
        lo = mid
        bestVariant = v
      } else hi = mid
    }
    out.push(bestVariant === kfs[a] ? kfs[a] : clone(bestVariant))
    a = lo
  }
  out.push(kfs[n - 1])
  let removed = n - out.length

  // Leading keyframes that only repeat the next value (the value before a key is its own).
  const holdsValue = (value: unknown, from: number, to: number): boolean => {
    const v = valueOfKey(value, path)
    if (!v) return false
    const start = lowerBound(ref.times, from)
    for (let i = start; i < ref.times.length && ref.times[i] <= to; i++)
      if (!within(ref.values[i], v, tol)) return false
    return true
  }
  while (out.length > 1 && holdsValue(out[1].s, out[0].t as number, out[1].t as number)) {
    const dropped = out.shift()!
    removed++
    // lottie-web (files older than 4.1.9) tells keyframed colors by the first key's `i`.
    if (firstIn && out.length > 1 && !isObj(out[0].i))
      out[0].i = clone(isObj(dropped.i) ? dropped.i : LINEAR_IN)
  }
  // Trailing keyframes: after the last key its value holds, so a last key that the previous
  // value already matches (through the whole last segment) is not needed.
  while (
    out.length > 1 &&
    holdsValue(
      out[out.length - 2].s,
      out[out.length - 2].t as number,
      out[out.length - 1].t as number,
    )
  ) {
    out.pop()
    removed++
  }

  if (out.length === 1) {
    prop.k = staticForm(out[0].s)
    if ('a' in prop) prop.a = 0
  } else if (removed) prop.k = out
  const spent = removed ? spentShare(prop, ref, tol, path) : 0
  return { removed, static: out.length === 1, spent }
}

/** The flat value of a keyframe `s`. */
function valueOfKey(s: unknown, path: boolean): number[] | null {
  if (path) {
    const p = Array.isArray(s) ? s[0] : null
    if (!isObj(p)) return null
    return valueAt({ k: p }, 0, true)
  }
  if (typeof s === 'number') return [s]
  if (Array.isArray(s) && s.every((x) => typeof x === 'number')) return s as number[]
  return null
}

export function keyframes(tc: TechniqueContext): TechniqueDetails {
  // Expressions can read other properties' keys by index (`position.key(2)`, `.numKeys`).
  if (!maySimplifyKeys(tc.info.reach)) return { keyframes: 0, properties: 0 }
  const scales = new SpaceScales(tc.doc)
  const model = toleranceModel(tc.doc, scales, tc.options.pxTolerance)
  const part = KEYFRAMES_SHARE * Math.max(0, tc.options.keyframeTolerance)
  let removed = 0
  let properties = 0
  let statics = 0
  for (const comp of listComps(tc.doc)) {
    throwIfAborted(tc.signal)
    for (const layer of compLayers(comp)) {
      visitLayerProperties(layer, comp, { legacyColors: tc.info.legacyColors }, (v) => {
        const prop = v.prop
        if (v.role === 'exact' || hasExpression(prop) || typeof prop.sid === 'string') return
        if (!isKeyframeList(prop.k) || prop.k.length < 2) return
        const full = model.of(v)
        const r = simplifyProperty(prop, share(full, Math.min(1, part)), v.legacyColor)
        if (r.removed) {
          removed += r.removed
          properties++
          // What was actually used, as a share of the whole budget (precision gets the rest).
          tc.spent.set(prop, Math.min(1, r.spent * Math.min(1, part)))
        }
        if (r.static) statics++
      })
    }
  }
  return { keyframes: removed, properties, static: statics }
}
