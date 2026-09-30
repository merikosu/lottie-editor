/**
 * Number precision reduction for smaller files.
 *
 * Numbers with |v| <= 1 (colors, easing handles, gradient offsets) keep at least
 * `minSmallDecimals` decimals so colors and curves stay visually identical.
 */
export interface PrecisionOptions {
  /** Decimals for regular numbers (coordinates, times, sizes). */
  decimals: number
  /** Minimum decimals for numbers in [-1, 1]. Default 3. */
  minSmallDecimals?: number
}

function roundNumber(v: number, decimals: number, smallDecimals: number): number {
  if (!Number.isFinite(v) || Number.isInteger(v)) return v
  const d = Math.abs(v) <= 1 ? Math.max(decimals, smallDecimals) : decimals
  const f = 10 ** d
  const r = Math.round(v * f) / f
  return Object.is(r, -0) ? 0 : r
}

/** Returns a deep copy of `value` with all numbers rounded. */
export function roundNumbers<T>(value: T, opts: PrecisionOptions): T {
  const small = opts.minSmallDecimals ?? 3
  const walk = (v: unknown): unknown => {
    if (typeof v === 'number') return roundNumber(v, opts.decimals, small)
    if (Array.isArray(v)) return v.map(walk)
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, child] of Object.entries(v)) {
        // Data URIs and strings are left untouched; only numbers change.
        out[k] = walk(child)
      }
      return out
    }
    return v
  }
  return walk(value) as T
}
