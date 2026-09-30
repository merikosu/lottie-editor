/**
 * Graph editor math (pure, unit-tested).
 *
 * A Lottie segment k → k+1 eases with cubic-bezier(x1, y1, x2, y2) = (o.x, o.y, i.x, i.y) of
 * keyframe k. For a non-spatial dimension the value is v(t) = v0 + Δ·E((t − t0) / T): the same
 * cubic, affinely mapped into (time, value) space, so its inner control points ARE the value
 * graph's bezier handles. Speed is K·E′(x) / T, where K is the change carried by the channel:
 * Δ of one dimension, the straight distance |Δ⃗| of linked dimensions, or the arc length of a
 * spatial motion path (what lottie-web moves along). After Effects expresses the same easing
 * as influence (x1, 1 − x2) and speed (the slope at each end), which the speed graph edits.
 */

/** Easing of one segment: cubic-bezier(x1, y1, x2, y2) = (o.x, o.y, i.x, i.y). */
export interface Ease {
  x1: number
  y1: number
  x2: number
  y2: number
}

export const LINEAR_EASE: Ease = { x1: 0, y1: 0, x2: 1, y2: 1 }

/** Smallest influence After Effects allows (0.1 %): keeps speed handles finite and grabbable. */
export const MIN_INFLUENCE = 0.001

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Bernstein cubic with P0 = 0 and P3 = 1. */
function cubic(s: number, p1: number, p2: number): number {
  const m = 1 - s
  return 3 * m * m * s * p1 + 3 * m * s * s * p2 + s * s * s
}

/** d/ds of `cubic`. */
function cubicSlope(s: number, p1: number, p2: number): number {
  const m = 1 - s
  return 3 * m * m * p1 + 6 * m * s * (p2 - p1) + 3 * s * s * (1 - p2)
}

/** True when the evaluator (and lottie-web) take the linear shortcut for this easing. */
export function isLinearEase(e: Ease): boolean {
  return clamp01(e.x1) === e.y1 && clamp01(e.x2) === e.y2
}

/**
 * Bezier parameter s at which the easing's time coordinate equals `x`. x1/x2 are clamped to
 * [0, 1] like the evaluator does, which keeps the time coordinate monotonic.
 */
export function easeParam(x: number, x1: number, x2: number): number {
  if (!(x > 0)) return 0
  if (x >= 1) return 1
  const a = clamp01(x1)
  const b = clamp01(x2)
  let s = x
  for (let i = 0; i < 8; i++) {
    const err = cubic(s, a, b) - x
    if (Math.abs(err) < 1e-12) return s
    const d = cubicSlope(s, a, b)
    if (d < 1e-6) break
    const next = s - err / d
    if (!(next > 0 && next < 1)) break
    s = next
  }
  // Newton stalled (flat spot or left the interval): bisect, the curve is monotonic.
  let lo = 0
  let hi = 1
  for (let i = 0; i < 64; i++) {
    s = (lo + hi) / 2
    const v = cubic(s, a, b)
    if (Math.abs(v - x) < 1e-13) break
    if (v < x) lo = s
    else hi = s
  }
  return s
}

/** Eased progress E(x) (the exact curve lottie-web approximates with its spline table). */
export function easeAt(e: Ease, x: number): number {
  if (!(x > 0)) return 0
  if (x >= 1) return 1
  if (isLinearEase(e)) return x
  return cubic(easeParam(x, e.x1, e.x2), e.y1, e.y2)
}

/**
 * Slope dE/dx of the easing at `x`. Where a handle has zero length both derivatives vanish at
 * that end; the limit is taken just inside the curve.
 */
export function easeSlope(e: Ease, x: number): number {
  if (isLinearEase(e)) return 1
  const a = clamp01(e.x1)
  const b = clamp01(e.x2)
  let s = easeParam(clamp01(x), a, b)
  let dx = cubicSlope(s, a, b)
  if (dx < 1e-9) {
    s = s < 1e-4 ? 1e-4 : s > 1 - 1e-4 ? 1 - 1e-4 : s + 1e-4
    dx = cubicSlope(s, a, b)
    if (dx < 1e-12) return 0
  }
  return cubicSlope(s, e.y1, e.y2) / dx
}

/* -------------------------------------------------------------------------- */
/*                             Value graph handles                            */
/* -------------------------------------------------------------------------- */

/** A point in (local time, value) space. */
export interface GraphPoint {
  t: number
  v: number
}

export type HandleSide = 'out' | 'in'

/**
 * Inner control points of a segment's value curve: the out handle of the start key and the
 * in handle of the end key.
 */
export function valueHandles(
  t0: number,
  v0: number,
  t1: number,
  v1: number,
  e: Ease,
): { out: GraphPoint; in: GraphPoint } {
  const T = t1 - t0
  const D = v1 - v0
  return {
    out: { t: t0 + clamp01(e.x1) * T, v: v0 + e.y1 * D },
    in: { t: t0 + clamp01(e.x2) * T, v: v0 + e.y2 * D },
  }
}

/**
 * The easing after dragging a value-graph handle to `p`. Time stays inside the segment (x in
 * [0, 1]); on a flat segment (no value change) no y can change the curve, so y is kept.
 * `clampY` keeps y in [0, 1] (spatial segments: lottie-web mishandles over/undershoot there).
 */
export function easeFromValueHandle(
  side: HandleSide,
  p: GraphPoint,
  seg: { t0: number; v0: number; t1: number; v1: number },
  e: Ease,
  clampY = false,
): Ease {
  const T = seg.t1 - seg.t0
  const D = seg.v1 - seg.v0
  const x = T > 0 ? clamp01((p.t - seg.t0) / T) : side === 'out' ? e.x1 : e.x2
  let y = Math.abs(D) > 1e-9 ? (p.v - seg.v0) / D : side === 'out' ? e.y1 : e.y2
  if (clampY) y = clamp01(y)
  return side === 'out' ? { ...e, x1: x, y1: y } : { ...e, x2: x, y2: y }
}

/* -------------------------------------------------------------------------- */
/*                         Speed graph (influence/speed)                      */
/* -------------------------------------------------------------------------- */

/** After Effects style handle of one side of a segment. */
export interface SpeedHandle {
  /** Share of the segment the handle reaches into (0..1). */
  influence: number
  /** Speed at the key, in channel units per local frame. */
  speed: number
}

/**
 * Speed at the ends of a segment of duration `T` whose channel changes by `K`, with the
 * handles' influence. Speed at an end is the slope of the easing there: y1 / x1 and
 * (1 − y2) / (1 − x2) times the average speed K / T.
 */
export function speedHandles(T: number, K: number, e: Ease): { out: SpeedHandle; in: SpeedHandle } {
  const avg = T > 0 ? K / T : 0
  return {
    out: { influence: clamp01(e.x1), speed: avg * easeSlope(e, 0) },
    in: { influence: 1 - clamp01(e.x2), speed: avg * easeSlope(e, 1) },
  }
}

/**
 * The easing after moving one side's speed handle to `h`. Influence is kept within
 * [MIN_INFLUENCE, 1]; the speed sets y. A channel that does not change (K = 0) has zero speed
 * whatever the easing, so only the influence moves.
 */
export function easeFromSpeedHandle(
  side: HandleSide,
  h: SpeedHandle,
  T: number,
  K: number,
  e: Ease,
  clampY = false,
): Ease {
  const u = Math.min(1, Math.max(MIN_INFLUENCE, h.influence))
  const canSpeed = Math.abs(K) > 1e-9 && T > 0 && Number.isFinite(h.speed)
  if (side === 'out') {
    let y1 = canSpeed ? (h.speed * u * T) / K : e.y1
    if (clampY) y1 = clamp01(y1)
    return { ...e, x1: u, y1 }
  }
  let y2 = canSpeed ? 1 - (h.speed * u * T) / K : e.y2
  if (clampY) y2 = clamp01(y2)
  return { ...e, x2: 1 - u, y2 }
}

/**
 * The easing of one side changed to reach `speed` at the key while keeping its influence
 * (used to keep a key's tangents continuous when the other side is dragged).
 */
export function easeWithSpeed(
  side: HandleSide,
  speed: number,
  T: number,
  K: number,
  e: Ease,
  clampY = false,
): Ease {
  const influence = side === 'out' ? clamp01(e.x1) : 1 - clamp01(e.x2)
  return easeFromSpeedHandle(side, { influence, speed }, T, K, e, clampY)
}

/** Are two speeds at a key the same (continuous tangents)? Relative to the larger speed. */
export function sameSpeed(a: number, b: number, reference = 0): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(reference), 1e-9)
  return Math.abs(a - b) <= scale * 0.02 + 1e-9
}

/* -------------------------------------------------------------------------- */
/*                                Spatial paths                               */
/* -------------------------------------------------------------------------- */

/**
 * Arc length of a spatial segment (P0 = start, P1 = start + to, P2 = end + ti, P3 = end) as the
 * evaluator and lottie-web measure it: a polyline through `samples` evenly spaced parameters.
 */
export function spatialLength(
  start: readonly number[],
  end: readonly number[],
  to: readonly number[],
  ti: readonly number[],
  samples = 150,
): number {
  const dims = start.length
  let total = 0
  let prev: number[] | null = null
  const point: number[] = Array.from({ length: dims }, () => 0)
  for (let s = 0; s < samples; s++) {
    const u = s / (samples - 1)
    const m = 1 - u
    for (let d = 0; d < dims; d++) {
      const p0 = start[d]
      const p3 = end[d] ?? p0
      const p1 = p0 + (to[d] ?? 0)
      const p2 = p3 + (ti[d] ?? 0)
      point[d] = m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3
    }
    if (prev) {
      let sum = 0
      for (let d = 0; d < dims; d++) sum += (point[d] - prev[d]) ** 2
      total += Math.sqrt(sum)
      for (let d = 0; d < dims; d++) prev[d] = point[d]
    } else prev = [...point]
  }
  return total
}

/** Euclidean length of a vector difference. */
export function distance(a: readonly number[], b: readonly number[]): number {
  let sum = 0
  const n = Math.max(a.length, b.length)
  for (let d = 0; d < n; d++) sum += ((b[d] ?? a[d] ?? 0) - (a[d] ?? b[d] ?? 0)) ** 2
  return Math.sqrt(sum)
}

/* -------------------------------------------------------------------------- */
/*                               Axes and fitting                             */
/* -------------------------------------------------------------------------- */

/** A "nice" step (1, 2 or 5 × 10ⁿ) that splits `span` into at most `maxTicks` parts. */
export function niceStep(span: number, maxTicks: number): number {
  if (!(span > 0) || !Number.isFinite(span) || !(maxTicks >= 1)) return 1
  const raw = span / maxTicks
  const power = 10 ** Math.floor(Math.log10(raw))
  const f = raw / power
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nice * power
}

/** Value-axis ticks for [min, max] drawn over `heightPx`: the densest nice step `minGapPx` apart. */
export function valueTicks(
  min: number,
  max: number,
  heightPx: number,
  minGapPx = 28,
): { step: number; values: number[] } {
  const span = max - min
  if (!(span > 0) || !(heightPx > 0)) return { step: 1, values: [] }
  const step = niceStep((span * minGapPx) / heightPx, 1)
  const values: number[] = []
  const first = Math.ceil(min / step - 1e-9)
  for (let i = first; i * step <= max + step * 1e-9 && values.length < 200; i++) {
    const v = i * step
    values.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  }
  return { step, values }
}

/** Decimals worth showing for ticks spaced `step` apart. */
export function stepDecimals(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0
  return Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)))
}

/**
 * The value range to show for data spanning [min, max]: a flat curve (or a single value) gets
 * a small range around it so it sits in the middle instead of filling the view.
 */
export function fitRange(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return [-1, 1]
  if (max - min < 1e-9) {
    const r = Math.max(1, Math.abs(min) * 0.1)
    return [min - r, max + r]
  }
  return [min, max]
}

/** Decimals worth keeping when a value moves by `unitsPerPx` for each pixel dragged. */
export function dragDecimals(unitsPerPx: number): number {
  if (!(unitsPerPx > 0) || !Number.isFinite(unitsPerPx)) return 3
  return Math.min(4, Math.max(0, Math.ceil(-Math.log10(unitsPerPx) - 1e-9)))
}

/* -------------------------------------------------------------------------- */
/*                                  Hit testing                               */
/* -------------------------------------------------------------------------- */

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
export function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const u = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy))
}

/** Distance from a point to a polyline given as flat [x0, y0, x1, y1, …] coordinates. */
export function polylineDistance(px: number, py: number, pts: ArrayLike<number>): number {
  if (pts.length < 2) return Infinity
  if (pts.length < 4) return Math.hypot(px - pts[0], py - pts[1])
  let best = Infinity
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const d = segmentDistance(px, py, pts[i], pts[i + 1], pts[i + 2], pts[i + 3])
    if (d < best) best = d
  }
  return best
}
