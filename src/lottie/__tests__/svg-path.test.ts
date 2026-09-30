import { describe, expect, it } from 'vitest'
import { rotationMatrix, type Matrix2D } from '../bounds'
import { parsePathData, svgPathToBeziers } from '../svg/path-data'
import type { BezierPath } from '../types'
import { samplePath, segmentPoint } from './fixtures/remix/helpers'

const one = (d: string): BezierPath => {
  const paths = svgPathToBeziers(d)
  expect(paths).toHaveLength(1)
  return paths[0]
}

const zeros = (n: number) => Array.from({ length: n }, () => [0, 0])

function expectPoints(actual: number[][], expected: number[][], digits = 9) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(expected[i][0], digits)
    expect(p[1]).toBeCloseTo(expected[i][1], digits)
  })
}

/** Max |distance to center − r| over sampled points. */
function circleError(p: BezierPath, cx: number, cy: number, r: number): number {
  return Math.max(...samplePath(p).map(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - r)))
}

describe('path data: lines and moves', () => {
  it('parses absolute M L H V Z', () => {
    const p = one('M10 20 L30 40 H50 V60 Z')
    expectPoints(p.v, [
      [10, 20],
      [30, 40],
      [50, 40],
      [50, 60],
    ])
    expect(p.c).toBe(true)
    expect(p.i).toEqual(zeros(4))
    expect(p.o).toEqual(zeros(4))
  })

  it('parses the relative forms to the same geometry', () => {
    expect(one('m10 20 l20 20 h20 v20 z')).toEqual(one('M10 20 L30 40 H50 V60 Z'))
  })

  it('treats extra pairs after a move-to as line-tos (absolute and relative)', () => {
    expectPoints(one('M10 20 30 40 50 40').v, [
      [10, 20],
      [30, 40],
      [50, 40],
    ])
    expectPoints(one('m10 20 20 20 20 0').v, [
      [10, 20],
      [30, 40],
      [50, 40],
    ])
  })

  it('repeats commands implicitly, with or without commas', () => {
    expectPoints(one('M0,0 L1,1,2,2 3,3').v, [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ])
    expectPoints(one('M0 0h1 2v3 4').v, [
      [0, 0],
      [1, 0],
      [3, 0],
      [3, 3],
      [3, 7],
    ])
  })

  it('reads compact numbers: 1.5.5, 1-2, exponents', () => {
    expectPoints(one('M1.5.5L-2-3l1e1-1E-1').v, [
      [1.5, 0.5],
      [-2, -3],
      [8, -3.1],
    ])
    expectPoints(one('M.5-.5l+2e+1-0.5e1').v, [
      [0.5, -0.5],
      [20.5, -5.5],
    ])
  })

  it('treats a first relative m as absolute and later m relative to the current point', () => {
    const paths = svgPathToBeziers('m5 5 l1 0 m2 2 l1 0')
    expect(paths).toHaveLength(2)
    expectPoints(paths[0].v, [
      [5, 5],
      [6, 5],
    ])
    expectPoints(paths[1].v, [
      [8, 7],
      [9, 7],
    ])
  })

  it('starts a new subpath at the closed subpath start when drawing continues after Z', () => {
    const paths = svgPathToBeziers('M10 10 l10 0 l0 10 z l5 5')
    expect(paths).toHaveLength(2)
    expect(paths[0].c).toBe(true)
    expectPoints(paths[1].v, [
      [10, 10],
      [15, 15],
    ])
    expect(paths[1].c).toBe(false)
    // m after z is relative to the start point of the closed subpath.
    expectPoints(svgPathToBeziers('M10 10 L20 10 Z m5 5 l1 1')[1].v, [
      [15, 15],
      [16, 16],
    ])
  })

  it('merges a closing vertex that duplicates the first one', () => {
    const p = one('M0 0 L10 0 L10 10 L0 0 Z')
    expect(p.v).toHaveLength(3)
    expect(p.c).toBe(true)
  })

  it('keeps the incoming tangent when merging a curved closing vertex', () => {
    const p = one('M0 0 C0 -5 10 -5 10 0 C10 5 0 5 0 0 Z')
    expect(p.v).toHaveLength(2)
    expect(p.i[0]).toEqual([0, 5])
    expect(p.o[0]).toEqual([0, -5])
    expect(p.i[1]).toEqual([0, -5])
    expect(p.o[1]).toEqual([0, 5])
  })

  it('keeps an explicitly returning but unclosed subpath open', () => {
    const p = one('M0 0 L10 0 L0 0')
    expect(p.v).toHaveLength(3)
    expect(p.c).toBe(false)
  })

  it('splits multiple subpaths and drops lone move-tos', () => {
    expect(svgPathToBeziers('M0 0 L1 1 M5 5 L6 6 M9 9')).toHaveLength(2)
    expect(svgPathToBeziers('M0 0 Z')).toHaveLength(0)
    expect(svgPathToBeziers('')).toHaveLength(0)
  })
})

describe('path data: curves', () => {
  it('stores cubic control points as tangents relative to their vertex', () => {
    const p = one('M0 0 C10 0 20 10 20 20')
    expectPoints(p.v, [
      [0, 0],
      [20, 20],
    ])
    expect(p.o[0]).toEqual([10, 0])
    expect(p.i[1]).toEqual([0, -10])
    expect(p.i[0]).toEqual([0, 0])
    expect(p.o[1]).toEqual([0, 0])
    expect(one('m0 0 c10 0 20 10 20 20')).toEqual(p)
  })

  it('reflects the previous cubic control point for S / s', () => {
    const p = one('M0 0 C0 10 10 10 10 0 S20 -10 20 0')
    expect(p.o[1]).toEqual([0, -10])
    expect(p.i[2]).toEqual([0, -10])
    expect(one('M0 0 C0 10 10 10 10 0 s10 -10 10 0')).toEqual(p)
  })

  it('uses the current point as the first control point for S without a previous cubic', () => {
    const p = one('M0 0 S10 10 20 0')
    expect(p.o[0]).toEqual([0, 0])
    expect(p.i[1]).toEqual([-10, 10])
    // A line between resets the reflection.
    const q = one('M0 0 C0 10 10 10 10 0 L20 0 S30 10 40 0')
    expect(q.o[2]).toEqual([0, 0])
  })

  it('elevates quadratics exactly', () => {
    const p = one('M0 0 Q10 10 20 0')
    for (let s = 0; s <= 10; s++) {
      const t = s / 10
      const [x, y] = segmentPoint(p, 0, t)
      const qx = 2 * (1 - t) * t * 10 + t * t * 20
      const qy = 2 * (1 - t) * t * 10
      expect(x).toBeCloseTo(qx, 10)
      expect(y).toBeCloseTo(qy, 10)
    }
  })

  it('reflects the quadratic control point for T / t, also after another T', () => {
    const p = one('M0 0 Q10 10 20 0 T40 0 T60 0')
    // Second segment control = reflection of (10,10) about (20,0) = (30,-10): midpoint (30,-5).
    const [mx, my] = segmentPoint(p, 1, 0.5)
    expect(mx).toBeCloseTo(30, 10)
    expect(my).toBeCloseTo(-5, 10)
    // Third segment control = reflection of (30,-10) about (40,0) = (50,10): midpoint (50,5).
    const [nx, ny] = segmentPoint(p, 2, 0.5)
    expect(nx).toBeCloseTo(50, 10)
    expect(ny).toBeCloseTo(5, 10)
    expect(one('m0 0 q10 10 20 0 t20 0 t20 0')).toEqual(p)
  })

  it('uses the current point as control for T without a previous quadratic (a straight segment)', () => {
    const p = one('M0 0 L10 0 T20 10')
    // Quadratic with its control at the start point: on the chord, parametrized non-uniformly.
    for (const t of [0.25, 0.5, 0.75]) {
      const [x, y] = segmentPoint(p, 1, t)
      expect(y).toBeCloseTo(x - 10, 10)
    }
    expect(segmentPoint(p, 1, 0.5)[0]).toBeCloseTo(12.5, 10)
  })
})

const onCircle = (p: BezierPath) => Math.min(circleError(p, 50, 0, 50), circleError(p, 0, 50, 50))

function pathLength(p: BezierPath): number {
  const pts = samplePath(p, 200)
  let sum = 0
  for (let k = 1; k < pts.length; k++)
    sum += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
  return sum
}

const sq = (q: number[]) => q[0] * q[0] + q[1] * q[1]

describe('path data: arcs', () => {
  it('converts a semicircle with sweep = 1 (clockwise on screen, through the top)', () => {
    const p = one('M0 0 A50 50 0 0 1 100 0')
    expect(p.v).toHaveLength(3)
    expectPoints(
      [p.v[0], p.v[2]],
      [
        [0, 0],
        [100, 0],
      ],
    )
    expect(p.v[1][0]).toBeCloseTo(50, 9)
    expect(p.v[1][1]).toBeCloseTo(-50, 9)
    expect(circleError(p, 50, 0, 50)).toBeLessThan(0.02)
  })

  it('goes through the bottom with sweep = 0', () => {
    const p = one('M0 0 A50 50 0 0 0 100 0')
    expect(p.v[1][1]).toBeCloseTo(50, 9)
    expect(circleError(p, 50, 0, 50)).toBeLessThan(0.02)
  })

  it('picks the large arc and splits it into ≤ 90° pieces', () => {
    // Circle of radius 50 through (0,0) and (50,50): centers (50,0) or (0,50).
    const small = one('M0 0 A50 50 0 0 1 50 50')
    const large = one('M0 0 A50 50 0 1 1 50 50')
    expect(small.v).toHaveLength(2)
    expect(large.v).toHaveLength(4)
    // Large + sweep 1 goes the long way clockwise around (0,50)... check both lie on a circle.
    expect(onCircle(small)).toBeLessThan(0.02)
    expect(onCircle(large)).toBeLessThan(0.02)
    // Arc lengths: 90° vs 270° of a radius-50 circle.
    expect(pathLength(small)).toBeCloseTo((Math.PI / 2) * 50, 0)
    expect(pathLength(large)).toBeCloseTo(((3 * Math.PI) / 2) * 50, 0)
  })

  it('scales radii that are too small up to fit (λ correction)', () => {
    const p = one('M0 0 A1 1 0 0 1 100 0')
    expect(circleError(p, 50, 0, 50)).toBeLessThan(0.02)
  })

  it('draws a straight line for a zero radius and nothing for equal end points', () => {
    const line = one('M0 0 A0 10 0 0 1 100 0')
    expectPoints(line.v, [
      [0, 0],
      [100, 0],
    ])
    expect(line.o).toEqual(zeros(2))
    expect(svgPathToBeziers('M10 10 A5 5 0 0 1 10 10')).toHaveLength(0)
    // Negative radii are used as absolute values.
    expect(circleError(one('M0 0 A-50 -50 0 0 1 100 0'), 50, 0, 50)).toBeLessThan(0.02)
  })

  it('reads glued arc flags (a1 1 0 0110 10)', () => {
    expect(one('M0 0a50 50 0 01100 0')).toEqual(one('M0 0 A50 50 0 0 1 100 0'))
    expect(one('M0 0a50,50,0,0,1,100,0')).toEqual(one('M0 0 A50 50 0 0 1 100 0'))
  })

  it('handles rotated elliptical arcs (points satisfy the rotated ellipse)', () => {
    const rx = 40
    const ry = 20
    const rot = 30
    const p = one(`M0 0 a${rx} ${ry} ${rot} 1 1 50 0`)
    expect(p.v[0]).toEqual([0, 0])
    expect(p.v[p.v.length - 1][0]).toBeCloseTo(50, 9)
    // Undo rotation and radii: the points must lie on one unit circle.
    const inv: Matrix2D = rotationMatrix(-rot)
    const unit = samplePath(p).map(([x, y]) => {
      const ux = inv[0] * x + inv[2] * y
      const uy = inv[1] * x + inv[3] * y
      return [ux / rx, uy / ry]
    })
    // Circumcenter of three points, then check all distances are 1.
    const [a, b, c] = [unit[0], unit[Math.floor(unit.length / 2)], unit[unit.length - 1]]
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]))
    const ux = (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d
    const uy = (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d
    const err = Math.max(...unit.map((q) => Math.abs(Math.hypot(q[0] - ux, q[1] - uy) - 1)))
    expect(err).toBeLessThan(0.001)
  })

  it('lands exactly on the requested end point', () => {
    const p = one('M0 0 A33.3 17.7 12 1 0 71.1 -13.3')
    const last = p.v[p.v.length - 1]
    expect(last[0]).toBe(71.1)
    expect(last[1]).toBe(-13.3)
  })

  it('draws a full circle from two arcs', () => {
    const p = one('M50 0 A50 50 0 1 1 -50 0 A50 50 0 1 1 50 0 Z')
    expect(p.c).toBe(true)
    expect(p.v).toHaveLength(4)
    expect(circleError(p, 0, 0, 50)).toBeLessThan(0.02)
  })
})

describe('path data: errors and transforms', () => {
  it('keeps everything before a malformed command, like browsers', () => {
    const r = parsePathData('M0 0 L10 10 L20')
    expect(r.error).toBe(true)
    expect(r.subpaths).toHaveLength(1)
    expect(r.subpaths[0].vertices).toHaveLength(2)
    const bad = parsePathData('M0 0 L10 10 X20 20')
    expect(bad.error).toBe(true)
    expect(bad.subpaths[0].vertices).toHaveLength(2)
  })

  it('requires a leading move-to', () => {
    const r = parsePathData('L10 10 L20 20')
    expect(r.error).toBe(true)
    expect(r.subpaths).toHaveLength(0)
  })

  it('rejects numbers after Z and bad arc flags', () => {
    expect(parsePathData('M0 0 L1 1 Z 5 5').error).toBe(true)
    const arc = parsePathData('M0 0 L5 5 A5 5 0 2 1 10 10')
    expect(arc.error).toBe(true)
    expect(arc.subpaths[0].vertices).toHaveLength(2)
  })

  it('accepts whitespace variety and trailing separators', () => {
    expect(parsePathData('\n\tM 0,0\r\nL 1 , 1\n').error).toBe(false)
  })

  it('applies an affine matrix to vertices and tangents (exact for beziers)', () => {
    const m: Matrix2D = [2, 0, 0, 3, 10, 20]
    const [p] = svgPathToBeziers('M0 0 C10 0 20 10 20 20', m)
    expect(p.v).toEqual([
      [10, 20],
      [50, 80],
    ])
    expect(p.o[0]).toEqual([20, 0])
    expect(p.i[1]).toEqual([0, -30])
  })
})
