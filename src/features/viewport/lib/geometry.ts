/**
 * Rectangles and quads used by the viewport (bounds, outlines, zoom-to-selection).
 */
import { applyToPoint, type Mat2D, type Point } from './matrix'

export type { Point }

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Four corners in order: top-left, top-right, bottom-right, bottom-left (of the source rect). */
export type Quad = readonly [Point, Point, Point, Point]

/** Transforms the corners of `rect` through `m` (a rotated/skewed rect becomes a general quad). */
export function transformRect(rect: Rect, m: Mat2D): Quad {
  const { x, y, width: w, height: h } = rect
  return [
    applyToPoint(m, x, y),
    applyToPoint(m, x + w, y),
    applyToPoint(m, x + w, y + h),
    applyToPoint(m, x, y + h),
  ]
}

/** Axis-aligned bounding box of a set of points (null for an empty list). */
export function boundsOfPoints(points: readonly Point[]): Rect | null {
  if (points.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  if (minX === Infinity) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function isEmptyRect(r: Rect | null | undefined): boolean {
  return !r || !(r.width > 0) || !(r.height > 0)
}

/** True when the quad's edges are horizontal/vertical (lets outlines snap to the pixel grid). */
export function isAxisAlignedQuad(q: Quad, epsilon = 0.01): boolean {
  const [a, b, c, d] = q
  const horizontalFirst = Math.abs(a.y - b.y) < epsilon && Math.abs(c.y - d.y) < epsilon
  const verticalFirst = Math.abs(a.x - d.x) < epsilon && Math.abs(b.x - c.x) < epsilon
  const verticalSecond = Math.abs(a.x - b.x) < epsilon && Math.abs(c.x - d.x) < epsilon
  const horizontalSecond = Math.abs(a.y - d.y) < epsilon && Math.abs(b.y - c.y) < epsilon
  return (horizontalFirst && verticalFirst) || (verticalSecond && horizontalSecond)
}

/** Normalized rectangle spanned by two corner points (any drag direction). */
export function rectFromPoints(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/** Extent of points projected on an axis. */
function project(points: readonly Point[], axis: Point): readonly [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    const d = p.x * axis.x + p.y * axis.y
    if (d < min) min = d
    if (d > max) max = d
  }
  return [min, max]
}

/**
 * True when a (convex) quad and an axis-aligned rectangle overlap, touching included.
 * Separating axis test: the rect's two axes plus the normals of the quad's edges.
 */
export function quadIntersectsRect(q: Quad, r: Rect): boolean {
  const corners: Point[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ]
  const axes: Point[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ]
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const nx = -(b.y - a.y)
    const ny = b.x - a.x
    if (nx !== 0 || ny !== 0) axes.push({ x: nx, y: ny })
  }
  for (const axis of axes) {
    const [qMin, qMax] = project(q, axis)
    const [rMin, rMax] = project(corners, axis)
    if (qMax < rMin || rMax < qMin) return false
  }
  return true
}

/** SVG `points` attribute for a quad. */
export function quadToPoints(q: Quad): string {
  return q.map((p) => `${round2(p.x)},${round2(p.y)}`).join(' ')
}

/**
 * Snaps an axis-aligned quad so a 1px stroke lands on whole device pixels (crisp hairlines).
 * `dpr` is the device pixel ratio; the stroke is centered on the path.
 */
export function snapQuad(q: Quad, dpr: number): Quad {
  const unit = 1 / dpr
  const offset = unit / 2
  // A 1 CSS px stroke covers `dpr` device pixels: centered on a device-pixel boundary when dpr is even.
  const half = Math.round(dpr) % 2 === 0 ? 0 : offset
  const s = (v: number) => Math.round(v * dpr) / dpr + half
  return q.map((p) => ({ x: s(p.x), y: s(p.y) })) as unknown as Quad
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
