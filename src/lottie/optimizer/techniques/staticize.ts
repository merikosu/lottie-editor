/**
 * `staticize`: keyframed properties that never change become static values.
 *
 * A property whose keyframes all hold the same value (and whose motion path does not loop away
 * and back, i.e. no spatial tangents) evaluates to that value at every frame. A property with a
 * single keyframe is constant too (lottie-web even fails to play those). Properties driven by
 * expressions (which may read keyframes) or bound to slots are left alone.
 */
import {
  compLayers,
  hasExpression,
  isKeyframeList,
  isObj,
  listComps,
  visitLayerProperties,
  type Json,
} from '../model'
import type { TechniqueContext, TechniqueDetails } from './context'

/** Structural equality of keyframe values (numbers, arrays, bezier paths). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' || typeof b === 'number') return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false
    return true
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a)
    if (ka.length !== Object.keys(b).length) return false
    for (const k of ka) if (!sameValue(a[k], b[k])) return false
    return true
  }
  return false
}

const isZeroVector = (v: unknown) =>
  !Array.isArray(v) || v.every((x) => typeof x !== 'number' || x === 0)

/** Static `k` form of a keyframe value: numbers and paths are unwrapped from their array. */
export function staticForm(s: unknown): unknown {
  if (Array.isArray(s) && s.length === 1 && (typeof s[0] === 'number' || isObj(s[0]))) return s[0]
  return s
}

/** The constant value of a keyframed property, or undefined when it changes. */
export function constantValue(prop: Json): unknown {
  const kfs = prop.k
  if (!isKeyframeList(kfs)) return undefined
  const first = kfs[0].s !== undefined ? kfs[0].s : kfs[0].e
  if (first === undefined) return undefined
  for (const kf of kfs) {
    if (kf.s !== undefined && !sameValue(kf.s, first)) return undefined
    if (kf.e !== undefined && !sameValue(kf.e, first)) return undefined
    // Equal end points with spatial tangents describe a loop, not a constant (a single
    // keyframe has no segment, so its tangents are never used).
    if (kfs.length > 1 && (!isZeroVector(kf.to) || !isZeroVector(kf.ti))) return undefined
  }
  return first
}

export function staticize(tc: TechniqueContext): TechniqueDetails {
  let properties = 0
  let single = 0
  for (const comp of listComps(tc.doc)) {
    for (const layer of compLayers(comp)) {
      visitLayerProperties(layer, comp, { legacyColors: tc.info.legacyColors }, ({ prop }) => {
        if (hasExpression(prop) || typeof prop.sid === 'string' || !isKeyframeList(prop.k)) return
        const value = constantValue(prop)
        if (value === undefined) return
        if (prop.k.length === 1) single++
        prop.k = staticForm(value)
        if ('a' in prop) prop.a = 0
        properties++
      })
    }
  }
  if (single) tc.warn('singleKeyframes', single)
  return { properties }
}
