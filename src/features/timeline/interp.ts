/**
 * Interpolation shapes of keyframes and segments (for glyphs and easing thumbnails).
 */
import type { BezierCurve } from '@/lottie/easing'
import type { EasingHandle, Keyframe } from '@/lottie/types'

export type Interp = 'linear' | 'eased' | 'hold'

const onDiagonal = (h: EasingHandle | undefined) => {
  if (!h) return true
  const xs = Array.isArray(h.x) ? h.x : [h.x]
  const ys = Array.isArray(h.y) ? h.y : [h.y]
  return xs.every((x, i) => Math.abs(x - (ys[i] ?? ys[0] ?? x)) < 0.02)
}

/** Interpolation of the segment that starts at `kf`, seen from its `side`. */
function segmentSide(kf: Keyframe<unknown>, side: 'out' | 'in'): Interp {
  if (kf.h === 1) return 'hold'
  return onDiagonal(side === 'out' ? kf.o : kf.i) ? 'linear' : 'eased'
}

/** Glyph sides of keyframe `index`: [arriving, leaving]. The first/last key mirror their only side. */
export function keySides(
  kfs: readonly Keyframe<unknown>[],
  index: number,
  textKeys = false,
): [Interp, Interp] {
  if (textKeys) return ['hold', 'hold']
  const kf = kfs[index]
  const prev = kfs[index - 1]
  const out = index < kfs.length - 1 ? segmentSide(kf, 'out') : null
  const inn = prev ? segmentSide(prev, 'in') : null
  return [inn ?? out ?? 'linear', out ?? inn ?? 'linear']
}

/** SVG path of a cubic-bezier easing inside a w×h box (hold = a step). */
export function easingPath(curve: BezierCurve | null, w: number, h: number): string {
  if (!curve) return `M0 ${h} H${w * 0.72} V0 H${w}`
  const [x1, y1, x2, y2] = curve
  const y = (v: number) => h - v * h
  return `M0 ${h} C${x1 * w} ${y(y1)} ${x2 * w} ${y(y2)} ${w} 0`
}

const first = (v: number | number[] | undefined, fallback: number) =>
  Array.isArray(v) ? (v[0] ?? fallback) : (v ?? fallback)

/** The curve of the segment that starts at `kf` (first dimension); null for hold. */
export function curveOf(kf: Keyframe<unknown>): BezierCurve | null {
  if (kf.h === 1) return null
  return [first(kf.o?.x, 0), first(kf.o?.y, 0), first(kf.i?.x, 1), first(kf.i?.y, 1)]
}
