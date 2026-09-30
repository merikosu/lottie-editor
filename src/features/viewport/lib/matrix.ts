/**
 * Minimal 2D affine matrix math (same layout and conventions as DOMMatrix / SVG):
 *
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 *
 * Operations post-multiply like DOMMatrix (`translate(m, …)` = m × T), so a chain reads in the
 * same order as `new DOMMatrix().translate(…).rotate(…)`: the last operation is applied first.
 * Pure (no DOM), so it works in Node tests.
 */

export type Mat2D = readonly [number, number, number, number, number, number]

export interface Point {
  x: number
  y: number
}

export const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0]

const DEG = Math.PI / 180

/** m × n: the transform that applies `n` first, then `m`. */
export function multiply(m: Mat2D, n: Mat2D): Mat2D {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

export function translate(m: Mat2D, tx: number, ty: number): Mat2D {
  if (tx === 0 && ty === 0) return m
  return multiply(m, [1, 0, 0, 1, tx, ty])
}

/** Rotation in degrees; positive is clockwise on screen (y points down). */
export function rotate(m: Mat2D, degrees: number): Mat2D {
  if (degrees === 0) return m
  const cos = Math.cos(degrees * DEG)
  const sin = Math.sin(degrees * DEG)
  return multiply(m, [cos, sin, -sin, cos, 0, 0])
}

export function scale(m: Mat2D, sx: number, sy: number = sx): Mat2D {
  if (sx === 1 && sy === 1) return m
  return multiply(m, [sx, 0, 0, sy, 0, 0])
}

/** Horizontal skew in degrees (x' = x + tan(angle)·y), like DOMMatrix.skewX. */
export function skewX(m: Mat2D, degrees: number): Mat2D {
  if (degrees === 0) return m
  return multiply(m, [1, 0, Math.tan(degrees * DEG), 1, 0, 0])
}

export function applyToPoint(m: Mat2D, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
}

export function determinant(m: Mat2D): number {
  return m[0] * m[3] - m[1] * m[2]
}

/** Inverse matrix, or null when the matrix is singular (e.g. a layer scaled to 0). */
export function invert(m: Mat2D): Mat2D | null {
  const det = determinant(m)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  const [a, b, c, d, e, f] = m
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]
}

/** Converts anything with a/b/c/d/e/f (DOMMatrix, SVGMatrix) into a Mat2D. */
export function fromDomMatrix(m: {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}): Mat2D {
  return [m.a, m.b, m.c, m.d, m.e, m.f]
}

export function isFiniteMatrix(m: Mat2D): boolean {
  return m.every(Number.isFinite)
}
