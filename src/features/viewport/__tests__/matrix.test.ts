import { describe, expect, it } from 'vitest'
import {
  IDENTITY,
  applyToPoint,
  determinant,
  fromDomMatrix,
  invert,
  isFiniteMatrix,
  multiply,
  rotate,
  scale,
  skewX,
  translate,
  type Mat2D,
} from '../lib/matrix'
import {
  boundsOfPoints,
  isAxisAlignedQuad,
  isEmptyRect,
  quadIntersectsRect,
  quadToPoints,
  rectFromPoints,
  snapQuad,
  transformRect,
} from '../lib/geometry'

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps)
const closePoint = (p: { x: number; y: number }, x: number, y: number, eps = 1e-9) => {
  close(p.x, x, eps)
  close(p.y, y, eps)
}

describe('matrix', () => {
  it('identity leaves points unchanged', () => {
    closePoint(applyToPoint(IDENTITY, 3, -4), 3, -4)
  })

  it('translate / scale / rotate compose like DOMMatrix (last call applies first)', () => {
    // new DOMMatrix().translate(10, 20).scale(2) maps (1, 1) → (12, 22)
    const m = scale(translate(IDENTITY, 10, 20), 2)
    closePoint(applyToPoint(m, 1, 1), 12, 22)
    // rotate(90) is clockwise on screen: (1, 0) → (0, 1)
    closePoint(applyToPoint(rotate(IDENTITY, 90), 1, 0), 0, 1)
    // translate then rotate: rotation happens first
    closePoint(applyToPoint(rotate(translate(IDENTITY, 5, 0), 90), 1, 0), 5, 1)
  })

  it('skewX shears x by tan(angle)·y', () => {
    closePoint(applyToPoint(skewX(IDENTITY, 45), 0, 2), 2, 2)
    closePoint(applyToPoint(skewX(IDENTITY, -45), 1, 1), 0, 1)
  })

  it('non-uniform scale uses sy', () => {
    closePoint(applyToPoint(scale(IDENTITY, 2, 3), 1, 1), 2, 3)
    closePoint(applyToPoint(scale(IDENTITY, 2), 1, 1), 2, 2)
  })

  it('multiply applies the right-hand matrix first', () => {
    const t = translate(IDENTITY, 10, 0)
    const r = rotate(IDENTITY, 90)
    closePoint(applyToPoint(multiply(t, r), 1, 0), 10, 1)
    closePoint(applyToPoint(multiply(r, t), 1, 0), 0, 11)
  })

  it('invert round-trips and rejects singular matrices', () => {
    const m = translate(rotate(scale(IDENTITY, 2, 0.5), 33), 7, -3)
    const inv = invert(m)!
    const p = applyToPoint(m, 12.5, -8)
    closePoint(applyToPoint(inv, p.x, p.y), 12.5, -8, 1e-9)
    expect(invert(scale(IDENTITY, 0, 1))).toBeNull()
    expect(invert([NaN, 0, 0, 1, 0, 0])).toBeNull()
    close(determinant(scale(IDENTITY, 2, 3)), 6)
  })

  it('no-op operations return the same matrix instance', () => {
    const m: Mat2D = [2, 0, 0, 2, 1, 1]
    expect(translate(m, 0, 0)).toBe(m)
    expect(rotate(m, 0)).toBe(m)
    expect(scale(m, 1, 1)).toBe(m)
    expect(skewX(m, 0)).toBe(m)
  })

  it('converts DOM matrices and checks finiteness', () => {
    expect(fromDomMatrix({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 })).toEqual([1, 2, 3, 4, 5, 6])
    expect(isFiniteMatrix([1, 0, 0, 1, Infinity, 0])).toBe(false)
    expect(isFiniteMatrix(IDENTITY)).toBe(true)
  })
})

describe('geometry', () => {
  it('transforms rect corners in order', () => {
    const q = transformRect({ x: 0, y: 0, width: 10, height: 5 }, translate(IDENTITY, 1, 1))
    expect(q.map((p) => [p.x, p.y])).toEqual([
      [1, 1],
      [11, 1],
      [11, 6],
      [1, 6],
    ])
  })

  it('rotated rects produce non-axis-aligned quads', () => {
    const q = transformRect({ x: -5, y: -5, width: 10, height: 10 }, rotate(IDENTITY, 30))
    expect(isAxisAlignedQuad(q)).toBe(false)
    close(Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y), 10, 1e-9)
    const q90 = transformRect({ x: 0, y: 0, width: 10, height: 4 }, rotate(IDENTITY, 90))
    expect(isAxisAlignedQuad(q90)).toBe(true)
  })

  it('computes bounds, ignoring non-finite points', () => {
    expect(boundsOfPoints([])).toBeNull()
    expect(
      boundsOfPoints([
        { x: 3, y: 4 },
        { x: -1, y: 10 },
        { x: NaN, y: 0 },
      ]),
    ).toEqual({ x: -1, y: 4, width: 4, height: 6 })
  })

  it('detects empty rects', () => {
    expect(isEmptyRect(null)).toBe(true)
    expect(isEmptyRect({ x: 0, y: 0, width: 0, height: 5 })).toBe(true)
    expect(isEmptyRect({ x: 0, y: 0, width: 1, height: 1 })).toBe(false)
  })

  it('snaps hairlines to device pixels', () => {
    const q = transformRect({ x: 10.3, y: 20.7, width: 5, height: 5 }, IDENTITY)
    // dpr 1: centered on half pixels
    expect(snapQuad(q, 1)[0]).toEqual({ x: 10.5, y: 21.5 })
    // dpr 2: whole CSS pixels are device-pixel boundaries
    expect(snapQuad(q, 2)[0]).toEqual({ x: 10.5, y: 20.5 })
  })

  it('normalizes drag rectangles in any direction', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 4, y: 2 })).toEqual({
      x: 4,
      y: 2,
      width: 6,
      height: 18,
    })
  })

  it('intersects quads with rectangles (separating axis test)', () => {
    const square = transformRect({ x: 0, y: 0, width: 10, height: 10 }, IDENTITY)
    expect(quadIntersectsRect(square, { x: 5, y: 5, width: 20, height: 20 })).toBe(true)
    expect(quadIntersectsRect(square, { x: 11, y: 0, width: 5, height: 5 })).toBe(false)
    expect(quadIntersectsRect(square, { x: 10, y: 10, width: 5, height: 5 })).toBe(true) // touching
    expect(quadIntersectsRect(square, { x: 2, y: 2, width: 1, height: 1 })).toBe(true) // inside
    expect(quadIntersectsRect(square, { x: -5, y: -5, width: 30, height: 30 })).toBe(true) // contains
    // A diamond (45° square) whose bounding box overlaps the rect but whose shape does not.
    const diamond = transformRect(
      { x: -5, y: -5, width: 10, height: 10 },
      translate(rotate(IDENTITY, 45), 0, 0),
    )
    expect(quadIntersectsRect(diamond, { x: 4, y: 4, width: 3, height: 3 })).toBe(false)
    expect(quadIntersectsRect(diamond, { x: 0, y: 0, width: 1, height: 1 })).toBe(true)
  })

  it('formats points for SVG', () => {
    const q = transformRect({ x: 0, y: 0, width: 1.23456, height: 1 }, IDENTITY)
    expect(quadToPoints(q)).toBe('0,0 1.23,0 1.23,1 0,1')
  })
})
