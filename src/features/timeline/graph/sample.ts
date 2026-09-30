/**
 * Screen geometry of graph curves: polylines sampled per pixel column — values as the evaluator
 * computes them (motion paths through the evaluator itself, other segments through its easing
 * functions, which is the same math without the per-call lookups) and the analytic speed of each
 * segment — plus key points and bezier / influence handles. Pure: the view maps time and value to
 * pixels through a `GraphViewport`.
 */
import { cubicBezier } from '@/lottie/easing'
import {
  easeFromSpeedHandle,
  easeFromValueHandle,
  speedHandles,
  valueHandles,
  type Ease,
  type HandleSide,
} from './math'
import {
  displaySpeed,
  segmentSpeed,
  storedSpeed,
  valuesAt,
  type GraphCurve,
  type GraphMode,
  type GraphProp,
  type SegmentInfo,
} from './model'

/** Maps root frames and axis units (n) to pixels. */
export interface GraphViewport {
  width: number
  /** Root frame → x. */
  x(frame: number): number
  /** x → root frame. */
  frame(x: number): number
  /** Axis units → y. */
  y(n: number): number
  /** y → axis units. */
  n(y: number): number
}

export interface KeyPoint {
  index: number
  x: number
  y: number
  /** Speed graph: incoming speed when it differs from the outgoing one. */
  inY?: number
}

export interface CurveGeometry {
  curve: GraphCurve
  /** Polylines as flat [x0, y0, x1, y1, …]; `outside`: before the first / after the last key. */
  lines: { pts: number[]; outside: boolean; hold: boolean }[]
  /** Discontinuities drawn dotted: hold jumps and speed changes at keys ([x, y0, y1]). */
  jumps: [number, number, number][]
  keys: KeyPoint[]
}

/** Far-off coordinates are clamped so the canvas never receives huge numbers. */
const LIMIT = 1e5
const clampPx = (v: number) =>
  v > LIMIT ? LIMIT : v < -LIMIT ? -LIMIT : Number.isFinite(v) ? v : 0

/** Display value → axis units. */
export const toAxis = (c: GraphCurve, display: number) => (display - c.offset) / c.scale
/** Axis units → display value. */
export const fromAxis = (c: GraphCurve, n: number) => c.offset + n * c.scale

/** Root time of a local frame (NaN when the property cannot be placed). */
export function rootTime(p: GraphProp, local: number): number {
  return p.map ? p.map.toRoot(local) : Number.NaN
}

/** Per-draw cache of evaluated values by pixel column (one evaluation serves every dimension). */
export class ColumnCache {
  private readonly cache = new Map<GraphProp, Map<number, number[]>>()
  private readonly vp: GraphViewport

  constructor(vp: GraphViewport) {
    this.vp = vp
  }

  values(p: GraphProp, column: number): number[] {
    let byColumn = this.cache.get(p)
    if (!byColumn) {
      byColumn = new Map()
      this.cache.set(p, byColumn)
    }
    let v = byColumn.get(column)
    if (!v) {
      v = p.map ? valuesAt(p, p.map.toLocal(this.vp.frame(column))) : []
      byColumn.set(column, v)
    }
    return v
  }
}

/**
 * Value of one dimension inside a non-spatial segment at a local frame, exactly as the
 * evaluator computes it (@/lottie/property evaluateArray): the segment's cubic-bezier easing of
 * that dimension (same cached function), then a lerp from the start to the end value.
 */
export function plainSampler(seg: SegmentInfo, dim: number): (local: number) => number {
  const ease = seg.eases[dim] ?? seg.eases[0]
  const fn = cubicBezier(ease.x1, ease.y1, ease.x2, ease.y2)
  const a = seg.start[dim] ?? seg.end[dim] ?? 0
  const b = seg.end[dim] ?? a
  const duration = seg.t1 - seg.t0
  return (local) => a + (b - a) * fn(duration > 0 ? (local - seg.t0) / duration : 1)
}

function channelEase(seg: SegmentInfo, dim: number | null): Ease {
  return seg.eases[dim ?? 0] ?? seg.eases[0]
}

/** Change carried by a speed channel over a segment (K in math.ts). */
export function channelChange(seg: SegmentInfo, dim: number | null): number {
  return dim === null ? seg.length : (seg.end[dim] ?? 0) - (seg.start[dim] ?? 0)
}

/** Can this speed channel's handles be edited on this segment? */
export function speedEditable(seg: SegmentInfo, dim: number | null): boolean {
  if (seg.hold || !(seg.t1 > seg.t0)) return false
  return dim !== null || seg.spatial || seg.linked
}

/** Can this dimension's value-graph handles be edited on this segment? */
export function valueEditable(seg: SegmentInfo): boolean {
  return !seg.hold && !seg.curved && seg.t1 > seg.t0
}

/** Samples one curve for the current view. */
export function curveGeometry(
  curve: GraphCurve,
  mode: GraphMode,
  vp: GraphViewport,
  fps: number,
  columns: ColumnCache,
): CurveGeometry {
  const p = curve.prop
  const geo: CurveGeometry = { curve, lines: [], jumps: [], keys: [] }
  const map = p.map
  if (!map || p.kfs.length === 0) return geo
  const dim = curve.dim ?? 0
  const yOf = (display: number) => clampPx(vp.y(toAxis(curve, display)))
  const valueY = (stored: number) => yOf(stored * p.factor)
  const speedY = (seg: SegmentInfo, x: number) =>
    yOf(displaySpeed(p, segmentSpeed(seg, curve.dim, x), fps))
  const keyX = p.kfs.map((kf) => clampPx(vp.x(map.toRoot(kf.t))))
  const last = p.kfs.length - 1
  const w = vp.width

  // Flat before the first key and after the last one (lottie-web holds the end values).
  const firstY = mode === 'value' ? valueY(p.keyValues[0][dim] ?? 0) : yOf(0)
  const lastY = mode === 'value' ? valueY(p.keyValues[last][dim] ?? 0) : yOf(0)
  if (keyX[0] > 0)
    geo.lines.push({ pts: [-1, firstY, keyX[0], firstY], outside: true, hold: false })
  if (keyX[last] < w)
    geo.lines.push({ pts: [keyX[last], lastY, w + 1, lastY], outside: true, hold: false })

  for (const seg of p.segments) {
    const xa = keyX[seg.index]
    const xb = keyX[seg.index + 1]
    if (xb < -2 || xa > w + 2) continue
    const pts: number[] = []
    if (mode === 'value') {
      const y0 = valueY(seg.start[dim] ?? 0)
      const y1 = valueY(p.keyValues[seg.index + 1][dim] ?? 0)
      if (seg.hold || !(xb > xa)) {
        pts.push(xa, y0, xb, y0)
        if (Math.abs(y1 - y0) > 0.5) geo.jumps.push([xb, y0, y1])
        geo.lines.push({ pts, outside: false, hold: seg.hold })
        continue
      }
      pts.push(xa, y0)
      const from = Math.max(0, Math.ceil(xa))
      const to = Math.min(w, Math.floor(xb))
      // Motion paths go through the evaluator (arc length); plain segments use its easing
      // function directly, hoisted out of the per-column loop (same math, many times faster).
      const plain = seg.spatial ? null : plainSampler(seg, dim)
      for (let c = from; c <= to; c++) {
        if (c <= xa || c >= xb) continue
        const v = plain ? plain(map.toLocal(vp.frame(c))) : (columns.values(p, c)[dim] ?? 0)
        pts.push(c, valueY(v))
      }
      pts.push(xb, valueY(seg.end[dim] ?? 0))
      geo.lines.push({ pts, outside: false, hold: false })
      continue
    }
    // Speed graph.
    if (seg.hold || !(xb > xa)) {
      pts.push(xa, yOf(0), xb, yOf(0))
      geo.lines.push({ pts, outside: false, hold: seg.hold })
      continue
    }
    pts.push(xa, speedY(seg, 0))
    const from = Math.max(0, Math.ceil(xa))
    const to = Math.min(w, Math.floor(xb))
    const T = seg.t1 - seg.t0
    for (let c = from; c <= to; c++) {
      if (c <= xa || c >= xb) continue
      const local = map.toLocal(vp.frame(c))
      pts.push(c, speedY(seg, (local - seg.t0) / T))
    }
    pts.push(xb, speedY(seg, 1))
    geo.lines.push({ pts, outside: false, hold: false })
  }

  // Key points (and, in the speed graph, the jump between incoming and outgoing speed).
  for (let k = 0; k <= last; k++) {
    const x = keyX[k]
    if (x < -8 || x > w + 8) continue
    if (mode === 'value') {
      geo.keys.push({ index: k, x, y: valueY(p.keyValues[k][dim] ?? 0) })
      continue
    }
    const outSeg = p.segments[k]
    const inSeg = p.segments[k - 1]
    const out = outSeg
      ? outSeg.hold || !(outSeg.t1 > outSeg.t0)
        ? yOf(0)
        : speedY(outSeg, 0)
      : null
    const inn = inSeg ? (inSeg.hold || !(inSeg.t1 > inSeg.t0) ? yOf(0) : speedY(inSeg, 1)) : null
    const y = out ?? inn ?? yOf(0)
    const point: KeyPoint = { index: k, x, y }
    if (out !== null && inn !== null && Math.abs(out - inn) > 0.5) {
      point.inY = inn
      geo.jumps.push([x, inn, out])
    }
    geo.keys.push(point)
  }
  return geo
}

/* -------------------------------------------------------------------------- */
/*                                    Handles                                 */
/* -------------------------------------------------------------------------- */

export interface HandleGeometry {
  /** Key the handle belongs to. */
  key: number
  side: HandleSide
  /** Segment whose easing the handle edits. */
  seg: SegmentInfo
  /** Handle end (drawn position). */
  x: number
  y: number
  /** Anchor at the key. */
  ax: number
  ay: number
}

/** Shortest drawn handle: zero-length handles still get a grabbable stub. */
const MIN_HANDLE_PX = 14

function stub(
  ax: number,
  ay: number,
  x: number,
  y: number,
  dirX: number,
  dirY: number,
): [number, number] {
  if (Math.hypot(x - ax, y - ay) >= MIN_HANDLE_PX / 2) return [x, y]
  let dx = dirX - ax
  let dy = dirY - ay
  let len = Math.hypot(dx, dy)
  if (len < 1e-6) {
    dx = dirX >= ax ? 1 : -1
    dy = 0
    len = 1
  }
  return [ax + (dx / len) * MIN_HANDLE_PX, ay + (dy / len) * MIN_HANDLE_PX]
}

/** Handles of the keys `keys` on one curve. */
export function curveHandles(
  curve: GraphCurve,
  mode: GraphMode,
  vp: GraphViewport,
  fps: number,
  keys: ReadonlySet<number>,
): HandleGeometry[] {
  const p = curve.prop
  const map = p.map
  const out: HandleGeometry[] = []
  if (!map) return out
  const dim = curve.dim ?? 0
  const x = (local: number) => clampPx(vp.x(map.toRoot(local)))
  const yOf = (display: number) => clampPx(vp.y(toAxis(curve, display)))
  for (const k of keys) {
    const kf = p.kfs[k]
    if (!kf) continue
    const sides: [HandleSide, SegmentInfo | undefined][] = [
      ['in', p.segments[k - 1]],
      ['out', p.segments[k]],
    ]
    for (const [side, seg] of sides) {
      if (!seg) continue
      if (mode === 'value') {
        if (!valueEditable(seg)) continue
        const ease = channelEase(seg, dim)
        const v0 = seg.start[dim] ?? 0
        const v1 = seg.end[dim] ?? 0
        const h = valueHandles(seg.t0, v0, seg.t1, v1, ease)
        const own = side === 'out' ? h.out : h.in
        const other = side === 'out' ? h.in : h.out
        const ax = x(side === 'out' ? seg.t0 : seg.t1)
        const ay = yOf((side === 'out' ? v0 : v1) * p.factor)
        const [hx, hy] = stub(
          ax,
          ay,
          x(own.t),
          yOf(own.v * p.factor),
          x(other.t),
          yOf(other.v * p.factor),
        )
        out.push({ key: k, side, seg, x: hx, y: hy, ax, ay })
        continue
      }
      if (!speedEditable(seg, curve.dim)) continue
      const T = seg.t1 - seg.t0
      const handles = speedHandles(T, channelChange(seg, curve.dim), channelEase(seg, curve.dim))
      const h = side === 'out' ? handles.out : handles.in
      const ax = x(side === 'out' ? seg.t0 : seg.t1)
      const ay = yOf(displaySpeed(p, h.speed, fps))
      const t = side === 'out' ? seg.t0 + h.influence * T : seg.t1 - h.influence * T
      const into = side === 'out' ? ax + 1 : ax - 1
      const [hx, hy] = stub(ax, ay, x(t), ay, into, ay)
      out.push({ key: k, side, seg, x: hx, y: hy, ax, ay })
    }
  }
  return out
}

/**
 * Easing of a segment after dragging one of its handles to (frame, n) on `curve`.
 * Value graph: the bezier control point of that dimension. Speed graph: influence and speed.
 */
export function easeForHandleDrag(
  curve: GraphCurve,
  mode: GraphMode,
  seg: SegmentInfo,
  side: HandleSide,
  frame: number,
  n: number,
  fps: number,
): Ease | null {
  const p = curve.prop
  const map = p.map
  if (!map) return null
  const local = map.toLocal(frame)
  const display = curve.offset + n * curve.scale
  const clampY = seg.spatial
  if (mode === 'value') {
    const dim = curve.dim ?? 0
    return easeFromValueHandle(
      side,
      { t: local, v: display / p.factor },
      { t0: seg.t0, v0: seg.start[dim] ?? 0, t1: seg.t1, v1: seg.end[dim] ?? 0 },
      channelEase(seg, dim),
      clampY,
    )
  }
  const T = seg.t1 - seg.t0
  const influence = side === 'out' ? (local - seg.t0) / T : (seg.t1 - local) / T
  return easeFromSpeedHandle(
    side,
    { influence, speed: storedSpeed(p, display, fps) },
    T,
    channelChange(seg, curve.dim),
    channelEase(seg, curve.dim),
    clampY,
  )
}

/**
 * Speed of a channel at a key, from one side (stored units per local frame): what must match
 * on both sides for the curve to pass smoothly through the key.
 */
export function sideSpeed(
  seg: SegmentInfo,
  dim: number | null,
  side: HandleSide,
  ease: Ease = channelEase(seg, dim),
): number {
  const h = speedHandles(seg.t1 - seg.t0, channelChange(seg, dim), ease)
  return side === 'out' ? h.out.speed : h.in.speed
}

export { channelEase }
