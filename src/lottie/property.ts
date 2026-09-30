/**
 * Reading animatable properties: static/animated detection and evaluation at a frame.
 *
 * `frame` is always expressed in the property's own time base, i.e. the time of the
 * composition that contains the layer (see time.ts). The interpolation mirrors lottie-web:
 *  - before the first keyframe → first value; at/after the last → last value
 *  - hold keyframes (h: 1) keep their value until the next keyframe
 *  - per-dimension bezier easing when `o`/`i` handles are arrays
 *  - spatial bezier (to/ti) for position-like values, eased along the arc length
 *  - legacy keyframes (`e` end values, bodymovin < 5.5)
 */
import { segmentEasing, cubicBezier, handleComponent } from './easing'
import type {
  BezierPath,
  Keyframe,
  PositionProperty,
  Property,
  ScalarProperty,
  ShapePathProperty,
  TextData,
  TextDocument,
  VectorProperty,
} from './types'
import { isSplitPosition } from './types'

/** Anything with a `k` that may hold keyframes (Property, ShapePathProperty, text document). */
export interface AnyProperty {
  a?: 0 | 1
  k: unknown
  x?: string
}

export function isKeyframe(v: unknown): v is Keyframe<unknown> {
  return v !== null && typeof v === 'object' && typeof (v as Keyframe).t === 'number'
}

/** True if the property holds keyframes (regardless of the possibly-stale `a` flag). */
export function isAnimated(prop: AnyProperty | null | undefined): boolean {
  if (!prop) return false
  const k = prop.k
  return Array.isArray(k) && k.length > 0 && isKeyframe(k[0])
}

/** Returns the keyframes of an animated property, or null when static. */
export function getKeyframes<S = unknown>(
  prop: AnyProperty | null | undefined,
): Keyframe<S>[] | null {
  return prop && isAnimated(prop) ? (prop.k as Keyframe<S>[]) : null
}

/** Heuristic: does this object look like an animatable property? */
export function isPropertyLike(v: unknown): v is AnyProperty {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  if (!('k' in o)) return false
  if (o.a === 0 || o.a === 1) return true
  // Some exporters omit `a`: accept numbers, number arrays, keyframes or bezier paths.
  const k = o.k
  if (typeof k === 'number') return true
  if (Array.isArray(k)) return k.length === 0 || typeof k[0] === 'number' || isKeyframe(k[0])
  return k !== null && typeof k === 'object' && Array.isArray((k as BezierPath).v)
}

export function hasExpression(prop: AnyProperty | null | undefined): boolean {
  return !!prop && typeof prop.x === 'string' && prop.x.trim().length > 0
}

/* -------------------------------------------------------------------------- */
/*                                 Evaluation                                 */
/* -------------------------------------------------------------------------- */

/** The value where a keyframe segment ends: next keyframe's `s`, or legacy `e`. */
export function segmentEndValue<S>(kf: Keyframe<S>, next: Keyframe<S> | undefined): S | undefined {
  return next?.s !== undefined ? next.s : kf.e
}

/** Value held at/after the last keyframe (legacy files store it in the previous `e`). */
function lastValue<S>(kfs: Keyframe<S>[]): S | undefined {
  const last = kfs[kfs.length - 1]
  if (last.s !== undefined) return last.s
  for (let i = kfs.length - 2; i >= 0; i--) {
    if (kfs[i].e !== undefined) return kfs[i].e
    if (kfs[i].s !== undefined) return kfs[i].s
  }
  return undefined
}

/** Index of the segment containing `frame`: kfs[i].t <= frame < kfs[i+1].t, or -1 / last. */
export function findSegment(kfs: Keyframe<unknown>[], frame: number): number {
  if (frame < kfs[0].t) return -1
  // Binary search for the last keyframe with t <= frame.
  let lo = 0
  let hi = kfs.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (kfs[mid].t <= frame) lo = mid
    else hi = mid - 1
  }
  return lo
}

function lerpArray(a: readonly number[], b: readonly number[], perc: number[] | number): number[] {
  const n = Math.max(a.length, b.length)
  const out: number[] = Array.from({ length: n }, () => 0)
  for (let d = 0; d < n; d++) {
    const p = typeof perc === 'number' ? perc : perc[d]
    const av = a[d] ?? b[d] ?? 0
    const bv = b[d] ?? av
    out[d] = av + (bv - av) * p
  }
  return out
}

function asArray(v: unknown): number[] {
  if (typeof v === 'number') return [v]
  if (Array.isArray(v)) return v as number[]
  return []
}

/* ------------------------------ Spatial bezier ----------------------------- */

const CURVE_SEGMENTS = 150

interface SpatialData {
  /** Inputs the samples were computed from; a mismatch means the keyframe was mutated. */
  signature: string
  points: number[][]
  lengths: number[]
  total: number
}

const spatialCache = new WeakMap<object, SpatialData>()

function spatialData(kf: Keyframe<number[]>, start: number[], end: number[]): SpatialData {
  const signature = `${start.join(',')}|${end.join(',')}|${(kf.to ?? []).join(',')}|${(kf.ti ?? []).join(',')}`
  const cached = spatialCache.get(kf)
  if (cached && cached.signature === signature) return cached
  const to = kf.to ?? []
  const ti = kf.ti ?? []
  const dims = start.length
  const points: number[][] = []
  const lengths: number[] = []
  let total = 0
  let prev: number[] | null = null
  for (let s = 0; s < CURVE_SEGMENTS; s++) {
    const t = s / (CURVE_SEGMENTS - 1)
    const mt = 1 - t
    const point: number[] = Array.from({ length: dims }, () => 0)
    for (let d = 0; d < dims; d++) {
      const p0 = start[d]
      const p3 = end[d] ?? p0
      const p1 = p0 + (to[d] ?? 0)
      const p2 = p3 + (ti[d] ?? 0)
      point[d] = mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
    }
    let len = 0
    if (prev) {
      let sum = 0
      for (let d = 0; d < dims; d++) sum += (point[d] - prev[d]) ** 2
      len = Math.sqrt(sum)
    }
    total += len
    points.push(point)
    lengths.push(len)
    prev = point
  }
  const data = { signature, points, lengths, total }
  spatialCache.set(kf, data)
  return data
}

/** True if the keyframe carries spatial tangents (position-like motion paths). */
export function hasSpatialTangents(kf: Keyframe<unknown>): boolean {
  return Array.isArray(kf.to) && Array.isArray(kf.ti)
}

/**
 * Locates the point at eased progress `perc` along a spatial segment.
 * Returns the point and the corresponding bezier parameter `u` (0..1).
 */
export function spatialLocate(
  kf: Keyframe<number[]>,
  start: number[],
  end: number[],
  perc: number,
): { point: number[]; u: number } {
  const { points, lengths, total } = spatialData(kf, start, end)
  const distance = total * perc
  const last = points.length - 1
  if (distance <= 0 || total === 0) return { point: [...points[0]], u: 0 }
  let added = 0
  for (let j = 0; j < last; j++) {
    const segLen = lengths[j + 1]
    if (distance >= added && distance < added + segLen) {
      const sp = segLen === 0 ? 0 : (distance - added) / segLen
      return { point: lerpArray(points[j], points[j + 1], sp), u: (j + sp) / last }
    }
    added += segLen
  }
  return { point: [...points[last]], u: 1 }
}

function spatialPoint(
  kf: Keyframe<number[]>,
  start: number[],
  end: number[],
  perc: number,
): number[] {
  return spatialLocate(kf, start, end, perc).point
}

/* -------------------------------- Evaluators ------------------------------- */

/** Evaluates a numeric/vector property. Scalars are returned as 1-element arrays. */
export function evaluateArray(prop: AnyProperty | null | undefined, frame: number): number[] {
  if (!prop) return []
  const kfs = getKeyframes<number[]>(prop)
  if (!kfs) return asArray(prop.k)

  const i = findSegment(kfs, frame)
  if (i < 0) return asArray(kfs[0].s ?? kfs[0].e)
  if (i >= kfs.length - 1) return asArray(lastValue(kfs))

  const kf = kfs[i]
  const next = kfs[i + 1]
  const start = asArray(kf.s)
  if (kf.h === 1) return start
  const end = asArray(segmentEndValue(kf, next))
  const duration = next.t - kf.t
  const x = duration > 0 ? (frame - kf.t) / duration : 1

  if (hasSpatialTangents(kf) && start.length >= 2) {
    const ease = cubicBezier(
      handleComponent(kf.o?.x, 0, 0),
      handleComponent(kf.o?.y, 0, 0),
      handleComponent(kf.i?.x, 0, 1),
      handleComponent(kf.i?.y, 0, 1),
    )
    return spatialPoint(kf as Keyframe<number[]>, start, end, ease(x))
  }

  const dims = Math.max(start.length, end.length)
  const perc: number[] = Array.from({ length: dims }, () => 0)
  for (let d = 0; d < dims; d++) perc[d] = segmentEasing(kf, d)(x)
  return lerpArray(start, end, perc)
}

/** Evaluates a scalar property (rotation, opacity, ...). */
export function evaluateScalar(
  prop: ScalarProperty | AnyProperty | null | undefined,
  frame: number,
  fallback = 0,
): number {
  const v = evaluateArray(prop, frame)
  return v.length > 0 && Number.isFinite(v[0]) ? v[0] : fallback
}

export function evaluateVector(
  prop: VectorProperty | null | undefined,
  frame: number,
  fallback: number[] = [],
): number[] {
  const v = evaluateArray(prop, frame)
  return v.length > 0 ? v : fallback
}

/** Evaluates a position, including separated dimensions. */
export function evaluatePosition(p: PositionProperty | null | undefined, frame: number): number[] {
  if (!p) return [0, 0]
  if (isSplitPosition(p)) {
    const out = [evaluateScalar(p.x, frame), evaluateScalar(p.y, frame)]
    if (p.z) out.push(evaluateScalar(p.z, frame))
    return out
  }
  return evaluateVector(p, frame, [0, 0])
}

function firstPath(kf: Keyframe<BezierPath[]>): BezierPath | null {
  return (kf.s ?? kf.e)?.[0] ?? null
}

function lerpPath(a: BezierPath, b: BezierPath, perc: number): BezierPath {
  // Damaged files may miss arrays or contain non-array points: interpolate what is valid.
  const lerpPts = (pa: unknown, pb: unknown) => {
    if (!Array.isArray(pa)) return []
    const other = Array.isArray(pb) ? pb : []
    return pa.map((pt, idx) => {
      const p = Array.isArray(pt) ? (pt as number[]) : []
      const q = Array.isArray(other[idx]) ? (other[idx] as number[]) : p
      return lerpArray(p, q, perc)
    })
  }
  return { c: !!a.c, v: lerpPts(a.v, b.v), i: lerpPts(a.i, b.i), o: lerpPts(a.o, b.o) }
}

/** Evaluates a bezier path property (shape paths, mask paths). */
export function evaluatePath(
  prop: ShapePathProperty | null | undefined,
  frame: number,
): BezierPath | null {
  if (!prop) return null
  const kfs = getKeyframes<BezierPath[]>(prop)
  if (!kfs) return (prop.k as BezierPath) ?? null

  const i = findSegment(kfs, frame)
  if (i < 0) return firstPath(kfs[0])
  if (i >= kfs.length - 1) return lastValue(kfs)?.[0] ?? null
  const kf = kfs[i]
  const start = Array.isArray(kf.s) ? kf.s[0] : undefined
  if (!start || typeof start !== 'object') return null
  if (kf.h === 1) return start
  const endValue = segmentEndValue(kf, kfs[i + 1])
  const end = (
    Array.isArray(endValue) && endValue[0] && typeof endValue[0] === 'object' ? endValue[0] : start
  ) as BezierPath
  const duration = kfs[i + 1].t - kf.t
  const x = duration > 0 ? (frame - kf.t) / duration : 1
  return lerpPath(start, end, segmentEasing(kf, 0)(x))
}

/** Text documents never interpolate: the latest keyframe at or before `frame` wins. */
export function evaluateTextDocument(
  text: TextData | null | undefined,
  frame: number,
): TextDocument | null {
  const kfs = text?.d?.k
  if (!Array.isArray(kfs) || kfs.length === 0) return null
  let doc = kfs[0].s
  for (const kf of kfs) {
    if (kf.t <= frame) doc = kf.s
    else break
  }
  return doc ?? null
}

/** Static value of a property: `k` when static, otherwise the first keyframe's value. */
export function staticValue(prop: AnyProperty | null | undefined): unknown {
  if (!prop) return undefined
  const kfs = getKeyframes(prop)
  if (!kfs) return prop.k
  return kfs[0].s ?? kfs[0].e
}

/** Number of dimensions of a property's value (1 for scalars). */
export function dimensionsOf(prop: AnyProperty | null | undefined): number {
  const v = staticValue(prop)
  if (typeof v === 'number') return 1
  if (Array.isArray(v)) return v.length
  return 0
}

export type { Property }
