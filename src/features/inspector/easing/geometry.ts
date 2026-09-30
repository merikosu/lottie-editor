/**
 * Geometry helpers for easing curves (plot ranges, thumbnails).
 */
import type { BezierCurve } from '@/lottie/easing'

/** y of the bezier at parameter s (control values 0, y1, y2, 1). */
export function bezierY(s: number, y1: number, y2: number): number {
  const m = 1 - s
  return 3 * m * m * s * y1 + 3 * m * s * s * y2 + s * s * s
}

/** Value range covering the unit box, the handles and the curve, with a small margin. */
export function curveRange(curve: BezierCurve, marginRatio = 0.04): [number, number] {
  let lo = Math.min(0, curve[1], curve[3])
  let hi = Math.max(1, curve[1], curve[3])
  for (let i = 1; i < 32; i++) {
    const y = bezierY(i / 32, curve[1], curve[3])
    lo = Math.min(lo, y)
    hi = Math.max(hi, y)
  }
  const margin = (hi - lo) * marginRatio
  return [lo - margin, hi + margin]
}
