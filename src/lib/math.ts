export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Round to a number of decimals, avoiding `-0` and float noise like 0.30000000000000004. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return value
  const f = 10 ** decimals
  const r = Math.round(value * f) / f
  return Object.is(r, -0) ? 0 : r
}

export function approxEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Snap `value` to the closest multiple of `step`. */
export function snap(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value
}
