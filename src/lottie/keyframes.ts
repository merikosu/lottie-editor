/**
 * Keyframe editing operations.
 *
 * Every function here MUTATES the property it receives and is meant to be called inside
 * an immer recipe (`updateDoc(label, draft => ...)`). They keep the property structurally
 * valid for all players:
 *  - keyframes sorted by time, `a` flag in sync
 *  - every non-final, non-hold keyframe has `o`/`i` easing handles
 *  - legacy `e` end values are converted to the modern format before editing
 */
import { handlesForCurve, type BezierCurve } from './easing'
import {
  evaluateArray,
  evaluatePath,
  findSegment,
  getKeyframes,
  hasSpatialTangents,
  isAnimated,
  segmentEndValue,
  spatialLocate,
  type AnyProperty,
} from './property'
import { cubicBezier, handleComponent } from './easing'
import type { BezierPath, EasingHandle, Keyframe } from './types'

/** Two keyframes closer than this (in frames) are considered to be at the same time. */
export const KEY_TIME_EPSILON = 0.001

/** Default linear handles, as written by bodymovin. */
const LINEAR_OUT: EasingHandle = { x: 0.167, y: 0.167 }
const LINEAR_IN: EasingHandle = { x: 0.833, y: 0.833 }

type Value = number | number[] | BezierPath
type Kf = Keyframe<unknown>

/**
 * Deep copy that also works on immer drafts (structuredClone throws on Proxy objects).
 * Values in a Lottie document are always JSON-safe.
 */
function plainCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Text document keyframes (`t.d.k`) hold objects, never interpolate and carry no easing. */
function isTextDocumentKeyframes(kfs: readonly Kf[]): boolean {
  const s = kfs[0]?.s
  return (
    !!s &&
    typeof s === 'object' &&
    !Array.isArray(s) &&
    typeof (s as { t?: unknown }).t === 'string'
  )
}

function cloneHandle(h: EasingHandle): EasingHandle {
  return {
    x: Array.isArray(h.x) ? [...h.x] : h.x,
    y: Array.isArray(h.y) ? [...h.y] : h.y,
  }
}

function isPathValue(v: unknown): v is BezierPath {
  return (
    v !== null && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as BezierPath).v)
  )
}

/** Converts a value to its keyframe `s` form: numbers → [n], paths → [path]. */
export function toKeyframeValue(value: Value): unknown {
  if (typeof value === 'number') return [value]
  if (isPathValue(value)) return [value]
  return [...value]
}

/** Converts a value to its static `k` form, matching the property's previous static style. */
function toStaticValue(value: Value, scalar: boolean): unknown {
  if (isPathValue(value)) return value
  if (typeof value === 'number') return value
  if (scalar && value.length === 1) return value[0]
  return [...value]
}

/** Current value of a property at `frame` in a form suitable for keyframes/static values. */
export function valueAt(prop: AnyProperty, frame: number): Value {
  const k = prop.k
  const isPath =
    (k !== null &&
      typeof k === 'object' &&
      !Array.isArray(k) &&
      Array.isArray((k as BezierPath).v)) ||
    (Array.isArray(k) &&
      isPathValue((k[0] as Kf | undefined)?.s && ((k[0] as Kf).s as unknown[])[0]))
  if (isPath) {
    const p = evaluatePath(prop as never, frame)
    return p ? plainCopy(p) : { i: [], o: [], v: [], c: false }
  }
  const arr = evaluateArray(prop, frame)
  return arr.length === 1 ? arr[0] : arr
}

/** True if the property's static form is a scalar (e.g. rotation) rather than a vector. */
function isScalarProperty(prop: AnyProperty): boolean {
  if (!isAnimated(prop)) return typeof prop.k === 'number'
  const s = (prop.k as Kf[])[0]?.s
  return typeof s === 'number' || (Array.isArray(s) && s.length === 1 && typeof s[0] === 'number')
}

/* -------------------------------------------------------------------------- */
/*                                 Structure                                  */
/* -------------------------------------------------------------------------- */

/** Converts legacy keyframes (`e` end values) to the modern format in place. */
export function normalizeLegacyKeyframes(prop: AnyProperty): void {
  const kfs = getKeyframes(prop)
  if (!kfs || !kfs.some((kf) => kf.e !== undefined)) return
  for (let i = 0; i < kfs.length; i++) {
    const kf = kfs[i]
    const next = kfs[i + 1]
    if (next && next.s === undefined && kf.e !== undefined) next.s = plainCopy(kf.e)
    delete kf.e
  }
}

/** Ensures every non-final, non-hold keyframe has easing handles. */
export function ensureHandles(kfs: Kf[]): void {
  for (let i = 0; i < kfs.length - 1; i++) {
    const kf = kfs[i]
    if (kf.h === 1) continue
    if (!kf.o) kf.o = cloneHandle(kfs[i - 1]?.o ?? LINEAR_OUT)
    if (!kf.i) kf.i = cloneHandle(kfs[i - 1]?.i ?? LINEAR_IN)
  }
}

/** Sorts keyframes by time (stable) and syncs the `a` flag. */
function finalize(prop: AnyProperty, kfs: Kf[]): void {
  kfs.sort((a, b) => a.t - b.t)
  prop.k = kfs
  if (isTextDocumentKeyframes(kfs)) return
  ensureHandles(kfs)
  prop.a = 1
}

/** Index of the keyframe at `frame` (within `tolerance`), or -1. */
export function findKeyframeAt(
  prop: AnyProperty,
  frame: number,
  tolerance = KEY_TIME_EPSILON,
): number {
  const kfs = getKeyframes(prop)
  if (!kfs) return -1
  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < kfs.length; i++) {
    const d = Math.abs(kfs[i].t - frame)
    if (d <= tolerance && d < bestDist) {
      best = i
      bestDist = d
    }
  }
  return best
}

/** Keyframe times of a property (empty when static). */
export function keyframeTimes(prop: AnyProperty | null | undefined): number[] {
  return getKeyframes(prop)?.map((kf) => kf.t) ?? []
}

/* -------------------------------------------------------------------------- */
/*                               Static ⇄ animated                            */
/* -------------------------------------------------------------------------- */

/** Turns a static property into an animated one with a single keyframe at `frame`. */
export function makeAnimated(prop: AnyProperty, frame: number): void {
  if (isAnimated(prop)) return
  const value = valueAt(prop, frame)
  prop.k = [{ t: frame, s: toKeyframeValue(value) }]
  prop.a = 1
}

/** Turns an animated property into a static one, keeping its value at `frame`. */
export function makeStatic(prop: AnyProperty, frame: number): void {
  if (!isAnimated(prop)) return
  const scalar = isScalarProperty(prop)
  const value = valueAt(prop, frame)
  prop.k = toStaticValue(value, scalar)
  prop.a = 0
}

/* -------------------------------------------------------------------------- */
/*                                   Editing                                  */
/* -------------------------------------------------------------------------- */

/**
 * Splits a spatial segment at `frame` with de Casteljau so the motion path keeps its shape.
 * Returns the tangents for the new keyframe, or null when the segment is not spatial.
 */
function splitSpatialSegment(
  kfs: Kf[],
  seg: number,
  frame: number,
): { to: number[]; ti: number[] } | null {
  const kf = kfs[seg] as Keyframe<number[]>
  const next = kfs[seg + 1] as Keyframe<number[]> | undefined
  if (!next || kf.h === 1 || !hasSpatialTangents(kf)) return null
  const start = kf.s as number[]
  const end = (segmentEndValue(kf, next) as number[] | undefined) ?? start
  const duration = next.t - kf.t
  const x = duration > 0 ? (frame - kf.t) / duration : 0
  const ease = cubicBezier(
    handleComponent(kf.o?.x, 0, 0),
    handleComponent(kf.o?.y, 0, 0),
    handleComponent(kf.i?.x, 0, 1),
    handleComponent(kf.i?.y, 0, 1),
  )
  const { u } = spatialLocate(kf, start, end, ease(x))
  const dims = start.length
  const lerp = (a: number[], b: number[]) => a.map((v, d) => v + ((b[d] ?? v) - v) * u)
  const p0 = start
  const p3 = end
  const p1 = p0.map((v, d) => v + (kf.to?.[d] ?? 0))
  const p2 = p3.map((v, d) => v + (kf.ti?.[d] ?? 0))
  const p01 = lerp(p0, p1)
  const p12 = lerp(p1, p2)
  const p23 = lerp(p2, p3)
  const p012 = lerp(p01, p12)
  const p123 = lerp(p12, p23)
  const m = lerp(p012, p123)
  const sub = (a: number[], b: number[]) =>
    Array.from({ length: dims }, (_, d) => (a[d] ?? 0) - (b[d] ?? 0))
  kf.to = sub(p01, p0)
  kf.ti = sub(p012, m)
  return { to: sub(p123, m), ti: sub(p23, p3) }
}

/**
 * Inserts a keyframe at `frame` (replacing the value if one already exists there).
 * The new keyframe inherits the easing of the segment it splits.
 * Returns the index of the keyframe.
 */
export function insertKeyframe(prop: AnyProperty, frame: number, value?: Value): number {
  if (!isAnimated(prop)) {
    makeAnimated(prop, frame)
    const kfs = prop.k as Kf[]
    kfs[0].t = frame
    if (value !== undefined) kfs[0].s = toKeyframeValue(value)
    return 0
  }
  normalizeLegacyKeyframes(prop)
  const kfs = prop.k as Kf[]
  const existing = findKeyframeAt(prop, frame)
  if (existing >= 0) {
    if (value !== undefined) kfs[existing].s = toKeyframeValue(value)
    return existing
  }

  const current = valueAt(prop, frame)
  const seg = findSegment(kfs, frame)
  const kf: Kf = { t: frame, s: toKeyframeValue(value ?? current) }

  if (seg >= 0 && seg < kfs.length - 1) {
    // Splitting an existing segment: copy its easing (and hold state).
    const prev = kfs[seg]
    if (prev.h === 1) kf.h = 1
    if (prev.o) kf.o = cloneHandle(prev.o)
    if (prev.i) kf.i = cloneHandle(prev.i)
    const spatial = splitSpatialSegment(kfs, seg, frame)
    if (spatial) {
      kf.to = spatial.to
      kf.ti = spatial.ti
    }
  } else if (seg >= kfs.length - 1) {
    // Appending after the last keyframe: the old last one now starts a segment.
    const last = kfs[kfs.length - 1]
    const ref = kfs[kfs.length - 2]
    if (!last.o) last.o = cloneHandle(ref?.o ?? LINEAR_OUT)
    if (!last.i) last.i = cloneHandle(ref?.i ?? LINEAR_IN)
    if (hasSpatialTangents(kfs[0]) && !hasSpatialTangents(last)) {
      const dims = Array.isArray(last.s) ? (last.s as unknown[]).length : 2
      last.to = Array.from({ length: dims }, () => 0)
      last.ti = Array.from({ length: dims }, () => 0)
    }
  } else {
    // Prepending before the first keyframe.
    const first = kfs[0]
    kf.o = cloneHandle(first.o ?? LINEAR_OUT)
    kf.i = cloneHandle(first.i ?? LINEAR_IN)
    if (hasSpatialTangents(first)) {
      const dims = Array.isArray(kf.s) ? (kf.s as unknown[]).length : 2
      kf.to = Array.from({ length: dims }, () => 0)
      kf.ti = Array.from({ length: dims }, () => 0)
    }
  }

  kfs.push(kf)
  finalize(prop, kfs)
  return kfs.indexOf(kf)
}

/**
 * Sets the value of a property at `frame`:
 * static → replaces the value; animated → updates the keyframe at `frame` or inserts one
 * (After Effects-style auto-keying).
 */
export function setValueAtFrame(prop: AnyProperty, frame: number, value: Value): void {
  if (!isAnimated(prop)) {
    prop.k = toStaticValue(value, isScalarProperty(prop))
    return
  }
  insertKeyframe(prop, frame, value)
}

/** Sets the value of one keyframe. */
export function setKeyframeValue(prop: AnyProperty, index: number, value: Value): void {
  normalizeLegacyKeyframes(prop)
  const kfs = getKeyframes(prop)
  if (!kfs?.[index]) return
  kfs[index].s = toKeyframeValue(value)
}

/**
 * Removes keyframes by index. When no keyframe remains the property becomes static,
 * keeping the value of the first removed keyframe.
 */
export function removeKeyframes(prop: AnyProperty, indices: readonly number[]): void {
  normalizeLegacyKeyframes(prop)
  const kfs = getKeyframes(prop)
  if (!kfs || indices.length === 0) return
  const remove = new Set(indices)
  const fallback = kfs.find((_, i) => remove.has(i))?.s
  const kept = kfs.filter((_, i) => !remove.has(i))
  if (kept.length === 0) {
    const scalar = isScalarProperty(prop)
    const v = Array.isArray(fallback)
      ? isPathValue(fallback[0])
        ? fallback[0]
        : fallback
      : fallback
    prop.k = v === undefined ? 0 : toStaticValue(v as Value, scalar)
    prop.a = 0
    return
  }
  finalize(prop, kept)
}

/**
 * Moves keyframes by `delta` frames. Keyframes landing on the time of an unmoved keyframe
 * replace it. Returns the new indices of the moved keyframes (same order as `indices`).
 */
export function moveKeyframes(
  prop: AnyProperty,
  indices: readonly number[],
  delta: number,
): number[] {
  normalizeLegacyKeyframes(prop)
  const kfs = getKeyframes(prop)
  if (!kfs || indices.length === 0) return []
  const moved = indices.map((i) => kfs[i]).filter(Boolean)
  const movedSet = new Set(moved)
  for (const kf of moved) kf.t = Math.round((kf.t + delta) * 1000) / 1000
  const kept = kfs.filter(
    (kf) => movedSet.has(kf) || !moved.some((m) => Math.abs(m.t - kf.t) < KEY_TIME_EPSILON),
  )
  finalize(prop, kept)
  return moved.map((kf) => kept.indexOf(kf))
}

/** Sets the time of a single keyframe (same collision rules as moveKeyframes). */
export function setKeyframeTime(prop: AnyProperty, index: number, time: number): number {
  const kfs = getKeyframes(prop)
  if (!kfs?.[index]) return -1
  return moveKeyframes(prop, [index], time - kfs[index].t)[0] ?? -1
}

/**
 * Sets the easing of the segment starting at keyframe `index`.
 * `curve = null` turns the segment into a hold.
 */
export function setSegmentEasing(
  prop: AnyProperty,
  index: number,
  curve: BezierCurve | null,
): void {
  normalizeLegacyKeyframes(prop)
  const kfs = getKeyframes(prop)
  const kf = kfs?.[index]
  if (!kfs || !kf || index >= kfs.length - 1) return
  if (curve === null) {
    kf.h = 1
    return
  }
  delete kf.h
  const { o, i } = handlesForCurve(curve, kf)
  kf.o = o
  kf.i = i
}

/**
 * After Effects "Easy Ease" on a keyframe: flattens the velocity around it.
 * `in` affects the segment arriving at the keyframe, `out` the one leaving it.
 */
export function applyEasyEase(
  prop: AnyProperty,
  index: number,
  mode: 'both' | 'in' | 'out' = 'both',
): void {
  normalizeLegacyKeyframes(prop)
  const kfs = getKeyframes(prop)
  if (!kfs?.[index]) return
  const influence = 0.333
  if ((mode === 'both' || mode === 'out') && index < kfs.length - 1) {
    const kf = kfs[index]
    delete kf.h
    const current = handlesForCurve([influence, 0, 0.833, 0.833], kf)
    kf.o = current.o
    if (!kf.i) kf.i = current.i
  }
  if ((mode === 'both' || mode === 'in') && index > 0) {
    const prev = kfs[index - 1]
    delete prev.h
    const current = handlesForCurve([0.167, 0.167, 1 - influence, 1], prev)
    prev.i = current.i
    if (!prev.o) prev.o = current.o
  }
}

/** Shifts all keyframe times of a property by `delta`. */
export function offsetKeyframes(prop: AnyProperty, delta: number): void {
  const kfs = getKeyframes(prop)
  if (!kfs) return
  for (const kf of kfs) kf.t += delta
}

/** Scales all keyframe times of a property around `origin` by `factor`. */
export function scaleKeyframeTimes(prop: AnyProperty, factor: number, origin = 0): void {
  const kfs = getKeyframes(prop)
  if (!kfs) return
  for (const kf of kfs) kf.t = origin + (kf.t - origin) * factor
}
