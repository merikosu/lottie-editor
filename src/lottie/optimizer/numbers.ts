/**
 * Number rounding for smaller JSON: the shortest decimal within a budget.
 *
 * `n / 10^d` with an integer `n` is the double closest to that decimal, so JSON.stringify
 * prints exactly the chosen digits (no 0.30000000000000004 artefacts).
 */
import type { PropTolerance } from './tolerance'

const POW10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12]

/** Shortest decimal `r` with |r − v| ≤ q (v itself when none is shorter or q ≤ 0). */
export function roundWithin(v: number, q: number): number {
  if (!(q > 0) || !Number.isFinite(v) || Number.isInteger(v)) return v
  for (let d = 0; d < POW10.length; d++) {
    const m = POW10[d]
    const r = Math.round(v * m) / m
    if (Math.abs(r - v) <= q) {
      // A rounding that is not shorter than the original gains nothing.
      if (String(r).length >= String(v).length) return v
      return r === 0 ? 0 : r
    }
  }
  return v
}

/** Budget of one value under a tolerance (absolute, or relative to the value). */
export function budget(v: number, t: PropTolerance): number {
  return Math.max(t.abs, t.rel * Math.abs(v))
}

/** Rounds `v` within the tolerance. */
export function roundValue(v: number, t: PropTolerance): number {
  return roundWithin(v, budget(v, t))
}

/** Decimal digits printed for a number (0 for integers). */
export function decimals(v: number): number {
  const s = String(v)
  const dot = s.indexOf('.')
  if (dot < 0) return 0
  const e = s.indexOf('e')
  return (e < 0 ? s.length : e) - dot - 1
}
