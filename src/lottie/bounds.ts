/**
 * Geometry for the remix tools: 2D affine matrices, exact bezier bounds, bounds of shape
 * items and layer content, and layer → composition matrices (also used by the canvas gizmo).
 *
 * Conventions
 *  - Matrices are `[a, b, c, d, e, f]` like SVG / DOMMatrix: x' = a·x + c·y + e,
 *    y' = b·x + d·y + f. `multiplyMatrices(m1, m2)` is m1 · m2, i.e. m2 is applied first.
 *  - Lottie transforms (layer `ks`, group `tr`) compose exactly like lottie-web:
 *      translate(p) · rotate(r) · rotate(−sa) · skewX(−sk) · rotate(sa) · scale(s / 100) · translate(−a)
 *  - Bezier bounds are exact: control points are transformed first (affine maps keep beziers),
 *    then every cubic segment is measured through the roots of its derivative.
 *  - `frame` is always in the time of the composition that contains the layer (see time.ts).
 */
import { findLayerIndexByInd, isLayerActiveAt, parentChain } from './layers'
import { compPathOf, getAt, getLayer, isShapePath, layerPathOf, type NodePath } from './path'
import {
  evaluatePath,
  evaluatePosition,
  evaluateScalar,
  evaluateTextDocument,
  evaluateVector,
  getKeyframes,
  isAnimated,
} from './property'
import { precompInnerFrame } from './time'
import { findAsset, findPrecomp } from './traverse'
import type {
  Animation,
  BezierPath,
  EllipseShape,
  GroupShape,
  Layer,
  PositionProperty,
  PrecompLayer,
  RectShape,
  RepeaterShape,
  ShapeItem,
  StarShape,
  TextLayer,
  Transform,
  TransformShape,
  TrimShape,
} from './types'
import { isSplitPosition, LayerType } from './types'

/* -------------------------------------------------------------------------- */
/*                                   Matrices                                 */
/* -------------------------------------------------------------------------- */

/** Axis-aligned box. */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** 2D affine matrix `[a, b, c, d, e, f]` (SVG / DOMMatrix layout). */
export type Matrix2D = readonly [number, number, number, number, number, number]

export const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0]

/** m1 · m2: the result applies `m2` first, then `m1`. */
export function multiplyMatrices(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

/** Product of several matrices, left to right (the last one is applied first). */
export function composeMatrices(...ms: Matrix2D[]): Matrix2D {
  let out = IDENTITY_MATRIX
  for (const m of ms) out = multiplyMatrices(out, m)
  return out
}

/** Inverse matrix, or null when it is singular. */
export function invertMatrix(m: Matrix2D): Matrix2D | null {
  const det = m[0] * m[3] - m[1] * m[2]
  if (det === 0 || !Number.isFinite(det)) return null
  const a = m[3] / det
  const b = -m[1] / det
  const c = -m[2] / det
  const d = m[0] / det
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])]
}

export function applyMatrix(m: Matrix2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Applies only the linear part (for direction vectors and tangents). */
export function applyMatrixToVector(m: Matrix2D, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y]
}

export function translationMatrix(tx: number, ty: number): Matrix2D {
  return [1, 0, 0, 1, tx, ty]
}

export function scalingMatrix(sx: number, sy: number = sx): Matrix2D {
  return [sx, 0, 0, sy, 0, 0]
}

/** Exact sine/cosine for multiples of 90° (avoids 6e-17 noise in axis-aligned results). */
function sinCos(degrees: number): [number, number] {
  const q = degrees / 90
  if (Number.isInteger(q)) {
    const k = ((q % 4) + 4) % 4
    return [[0, 1, 0, -1][k], [1, 0, -1, 0][k]]
  }
  const rad = (degrees * Math.PI) / 180
  return [Math.sin(rad), Math.cos(rad)]
}

/** Rotation by `degrees`, clockwise on screen (y axis pointing down), like SVG `rotate()`. */
export function rotationMatrix(degrees: number): Matrix2D {
  if (!degrees) return IDENTITY_MATRIX
  const [sin, cos] = sinCos(degrees)
  return [cos, sin, -sin, cos, 0, 0]
}

export function skewXMatrix(degrees: number): Matrix2D {
  return [1, 0, Math.tan((degrees * Math.PI) / 180), 1, 0, 0]
}

export function skewYMatrix(degrees: number): Matrix2D {
  return [1, Math.tan((degrees * Math.PI) / 180), 0, 1, 0, 0]
}

/** Geometric mean scale √|det| of the linear part (stroke widths, distances). */
export function matrixScale(m: Matrix2D): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
}

/** Singular values [largest, smallest] of the linear part. */
export function matrixSingularValues(m: Matrix2D): [number, number] {
  const e = m[0] * m[0] + m[1] * m[1] + m[2] * m[2] + m[3] * m[3]
  const det = Math.abs(m[0] * m[3] - m[1] * m[2])
  const p = Math.sqrt(Math.max(0, e + 2 * det))
  const q = Math.sqrt(Math.max(0, e - 2 * det))
  return [(p + q) / 2, Math.abs(p - q) / 2]
}

export function isIdentityMatrix(m: Matrix2D, epsilon = 1e-9): boolean {
  return IDENTITY_MATRIX.every((v, i) => Math.abs(m[i] - v) <= epsilon)
}

/** Lottie transform values reproducing a matrix (anchor 0, skew axis 0). */
export interface DecomposedTransform {
  position: [number, number]
  /** Degrees. */
  rotation: number
  /** Percent; y is negative for mirrored matrices. */
  scale: [number, number]
  /** Degrees. */
  skew: number
}

/**
 * Decomposes a matrix into Lottie transform values such that
 * translate(p) · rotate(r) · skewX(−sk) · scale(s / 100) reproduces it exactly
 * (QR decomposition of the linear part).
 */
export function decomposeMatrix(m: Matrix2D): DecomposedTransform {
  const [a, b, c, d, e, f] = m
  const sx = Math.hypot(a, b)
  const rad = sx > 0 ? Math.atan2(b, a) : 0
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const shear = cos * c + sin * d
  const sy = -sin * c + cos * d
  const skew = sy !== 0 ? (-Math.atan(shear / sy) * 180) / Math.PI : 0
  return {
    position: [e, f],
    rotation: (rad * 180) / Math.PI,
    scale: [sx * 100, sy * 100],
    skew: Object.is(skew, -0) ? 0 : skew,
  }
}

/* -------------------------------------------------------------------------- */
/*                                    Boxes                                   */
/* -------------------------------------------------------------------------- */

/** Axis-aligned bounds accumulator. */
export class BoundsAccumulator {
  minX = Infinity
  minY = Infinity
  maxX = -Infinity
  maxY = -Infinity

  get empty(): boolean {
    return !(this.maxX >= this.minX && this.maxY >= this.minY)
  }

  addPoint(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < this.minX) this.minX = x
    if (x > this.maxX) this.maxX = x
    if (y < this.minY) this.minY = y
    if (y > this.maxY) this.maxY = y
  }

  addBox(box: Box | null | undefined): void {
    if (!box) return
    this.addPoint(box.x, box.y)
    this.addPoint(box.x + box.w, box.y + box.h)
  }

  toBox(): Box | null {
    return this.empty
      ? null
      : { x: this.minX, y: this.minY, w: this.maxX - this.minX, h: this.maxY - this.minY }
  }
}

export function unionBoxes(a: Box | null | undefined, b: Box | null | undefined): Box | null {
  if (!a) return b ?? null
  if (!b) return a
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/** Intersection of two boxes, or null when they do not overlap. */
export function intersectBoxes(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const r = Math.min(a.x + a.w, b.x + b.w)
  const btm = Math.min(a.y + a.h, b.y + b.h)
  return r >= x && btm >= y ? { x, y, w: r - x, h: btm - y } : null
}

/** Bounds of the four transformed corners (exact for rectangles such as images and solids). */
export function transformBox(box: Box, m: Matrix2D): Box {
  const acc = new BoundsAccumulator()
  for (const [x, y] of [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ]) {
    acc.addPoint(...applyMatrix(m, x, y))
  }
  return acc.toBox() ?? { x: m[4], y: m[5], w: 0, h: 0 }
}

export function expandBox(box: Box, d: number): Box {
  return { x: box.x - d, y: box.y - d, w: box.w + 2 * d, h: box.h + 2 * d }
}

export function boxCenter(box: Box): [number, number] {
  return [box.x + box.w / 2, box.y + box.h / 2]
}

/* -------------------------------------------------------------------------- */
/*                                Bezier bounds                               */
/* -------------------------------------------------------------------------- */

/** Extent [min, max] of a 1D cubic bezier over t ∈ [0, 1]. */
function cubicExtent(a: number, b: number, c: number, d: number): [number, number] {
  let min = Math.min(a, d)
  let max = Math.max(a, d)
  // Control values inside the end range: the curve stays inside its convex hull.
  if (b >= min && b <= max && c >= min && c <= max) return [min, max]
  const consider = (t: number) => {
    if (!(t > 0 && t < 1)) return
    const mt = 1 - t
    const v = mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d
    if (v < min) min = v
    if (v > max) max = v
  }
  // B'(t) / 3 = A·t² + B·t + C
  const qa = -a + 3 * b - 3 * c + d
  const qb = 2 * (a - 2 * b + c)
  const qc = b - a
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), 1e-300)
  if (Math.abs(qa) <= 1e-12 * scale) {
    if (Math.abs(qb) > 1e-12 * scale) consider(-qc / qb)
  } else {
    const disc = qb * qb - 4 * qa * qc
    if (disc >= 0) {
      const sq = Math.sqrt(disc)
      const q = -0.5 * (qb + (qb >= 0 ? sq : -sq))
      consider(q / qa)
      if (q !== 0) consider(qc / q)
    }
  }
  return [min, max]
}

/** Exact bounds of the cubic bezier p0 → p3 with control points p1, p2. */
export function cubicBounds(
  p0: readonly number[],
  p1: readonly number[],
  p2: readonly number[],
  p3: readonly number[],
): Box {
  const [x0, x1] = cubicExtent(p0[0], p1[0], p2[0], p3[0])
  const [y0, y1] = cubicExtent(p0[1], p1[1], p2[1], p3[1])
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function coord(v: readonly number[] | undefined, k: 0 | 1): number {
  const n = v?.[k]
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

function addBezierPath(acc: BoundsAccumulator, path: BezierPath, m: Matrix2D): void {
  const vs = Array.isArray(path?.v) ? path.v : []
  const n = vs.length
  if (n === 0) return
  const ins = Array.isArray(path.i) ? path.i : []
  const outs = Array.isArray(path.o) ? path.o : []
  const pts = vs.map((v) => applyMatrix(m, coord(v, 0), coord(v, 1)))
  const outPt = (k: number) =>
    applyMatrix(m, coord(vs[k], 0) + coord(outs[k], 0), coord(vs[k], 1) + coord(outs[k], 1))
  const inPt = (k: number) =>
    applyMatrix(m, coord(vs[k], 0) + coord(ins[k], 0), coord(vs[k], 1) + coord(ins[k], 1))
  const segment = (from: number, to: number) => {
    const b = cubicBounds(pts[from], outPt(from), inPt(to), pts[to])
    acc.addPoint(b.x, b.y)
    acc.addPoint(b.x + b.w, b.y + b.h)
  }
  if (n === 1) acc.addPoint(pts[0][0], pts[0][1])
  for (let k = 0; k < n - 1; k++) segment(k, k + 1)
  if (path.c && n > 1) segment(n - 1, 0)
}

/**
 * Exact bounds of a Lottie bezier path (tangents relative to their vertex), optionally
 * transformed by `matrix`. Open paths are measured as drawn (the fill closes them with a
 * straight line, which never leaves these bounds).
 */
export function pathBounds(path: BezierPath, matrix: Matrix2D = IDENTITY_MATRIX): Box | null {
  const acc = new BoundsAccumulator()
  addBezierPath(acc, path, matrix)
  return acc.toBox()
}

/* -------------------------------------------------------------------------- */
/*                        Shape geometry (as lottie-web)                      */
/* -------------------------------------------------------------------------- */

/** lottie-web's circle handle ratio (`roundCorner`). */
const ROUND_CORNER = 0.5519

/** Collects vertices given as absolute (v, out, in) triples, like lottie's `setTripleAt`. */
function tripleBuilder(closed: boolean) {
  const path: BezierPath = { v: [], i: [], o: [], c: closed }
  const add = (vx: number, vy: number, ox: number, oy: number, ix: number, iy: number) => {
    path.v.push([vx, vy])
    path.o.push([ox - vx, oy - vy])
    path.i.push([ix - vx, iy - vy])
  }
  return { path, add }
}

function rectPath(item: RectShape, frame: number): BezierPath {
  const [p0 = 0, p1 = 0] = evaluateVector(item.p, frame, [0, 0])
  const size = evaluateVector(item.s, frame, [0, 0])
  const v0 = (size[0] ?? 0) / 2
  const v1 = (size[1] ?? size[0] ?? 0) / 2
  const round = Math.min(v0, v1, evaluateScalar(item.r, frame, 0))
  const cp = round * (1 - ROUND_CORNER)
  const { path, add } = tripleBuilder(true)
  if (item.d === 2 || item.d === 1) {
    add(p0 + v0, p1 - v1 + round, p0 + v0, p1 - v1 + round, p0 + v0, p1 - v1 + cp)
    add(p0 + v0, p1 + v1 - round, p0 + v0, p1 + v1 - cp, p0 + v0, p1 + v1 - round)
    if (round !== 0) {
      add(p0 + v0 - round, p1 + v1, p0 + v0 - round, p1 + v1, p0 + v0 - cp, p1 + v1)
      add(p0 - v0 + round, p1 + v1, p0 - v0 + cp, p1 + v1, p0 - v0 + round, p1 + v1)
      add(p0 - v0, p1 + v1 - round, p0 - v0, p1 + v1 - round, p0 - v0, p1 + v1 - cp)
      add(p0 - v0, p1 - v1 + round, p0 - v0, p1 - v1 + cp, p0 - v0, p1 - v1 + round)
      add(p0 - v0 + round, p1 - v1, p0 - v0 + round, p1 - v1, p0 - v0 + cp, p1 - v1)
      add(p0 + v0 - round, p1 - v1, p0 + v0 - cp, p1 - v1, p0 + v0 - round, p1 - v1)
    } else {
      add(p0 - v0, p1 + v1, p0 - v0 + cp, p1 + v1, p0 - v0, p1 + v1)
      add(p0 - v0, p1 - v1, p0 - v0, p1 - v1 + cp, p0 - v0, p1 - v1)
    }
  } else {
    add(p0 + v0, p1 - v1 + round, p0 + v0, p1 - v1 + cp, p0 + v0, p1 - v1 + round)
    if (round !== 0) {
      add(p0 + v0 - round, p1 - v1, p0 + v0 - round, p1 - v1, p0 + v0 - cp, p1 - v1)
      add(p0 - v0 + round, p1 - v1, p0 - v0 + cp, p1 - v1, p0 - v0 + round, p1 - v1)
      add(p0 - v0, p1 - v1 + round, p0 - v0, p1 - v1 + round, p0 - v0, p1 - v1 + cp)
      add(p0 - v0, p1 + v1 - round, p0 - v0, p1 + v1 - cp, p0 - v0, p1 + v1 - round)
      add(p0 - v0 + round, p1 + v1, p0 - v0 + round, p1 + v1, p0 - v0 + cp, p1 + v1)
      add(p0 + v0 - round, p1 + v1, p0 + v0 - cp, p1 + v1, p0 + v0 - round, p1 + v1)
      add(p0 + v0, p1 + v1 - round, p0 + v0, p1 + v1 - round, p0 + v0, p1 + v1 - cp)
    } else {
      add(p0 - v0, p1 - v1, p0 - v0 + cp, p1 - v1, p0 - v0, p1 - v1)
      add(p0 - v0, p1 + v1, p0 - v0, p1 + v1 - cp, p0 - v0, p1 + v1)
      add(p0 + v0, p1 + v1, p0 + v0 - cp, p1 + v1, p0 + v0, p1 + v1)
    }
  }
  return path
}

function ellipsePath(item: EllipseShape, frame: number): BezierPath {
  const [p0 = 0, p1 = 0] = evaluateVector(item.p, frame, [0, 0])
  const size = evaluateVector(item.s, frame, [0, 0])
  const s0 = (size[0] ?? 0) / 2
  const s1 = (size[1] ?? size[0] ?? 0) / 2
  const x = (k: number) => (item.d !== 3 ? k : -k)
  const c = ROUND_CORNER
  const { path, add } = tripleBuilder(true)
  add(p0, p1 - s1, p0 + x(s0 * c), p1 - s1, p0 - x(s0 * c), p1 - s1)
  add(p0 + x(s0), p1, p0 + x(s0), p1 + s1 * c, p0 + x(s0), p1 - s1 * c)
  add(p0, p1 + s1, p0 - x(s0 * c), p1 + s1, p0 + x(s0 * c), p1 + s1)
  add(p0 - x(s0), p1, p0 - x(s0), p1 - s1 * c, p0 - x(s0), p1 + s1 * c)
  return path
}

function starPath(item: StarShape, frame: number): BezierPath {
  const [px = 0, py = 0] = evaluateVector(item.p, frame, [0, 0])
  const star = item.sy !== 2
  const points = Math.floor(evaluateScalar(item.pt, frame, 5))
  const count = Math.max(0, Math.min(10000, star ? points * 2 : points))
  const dir = item.d === 3 ? -1 : 1
  const outer = evaluateScalar(item.or, frame, 0)
  const inner = star ? evaluateScalar(item.ir, frame, 0) : outer
  const outerRound = evaluateScalar(item.os, frame, 0) / 100
  const innerRound = star ? evaluateScalar(item.is, frame, 0) / 100 : outerRound
  const angle = (Math.PI * 2) / Math.max(1, count)
  let current = -Math.PI / 2 + (evaluateScalar(item.r, frame, 0) * Math.PI) / 180
  const { path, add } = tripleBuilder(true)
  for (let n = 0; n < count; n++) {
    const long = !star || n % 2 === 0
    const rad = long ? outer : inner
    const roundness = long ? outerRound : innerRound
    const perim = star ? (2 * Math.PI * rad) / (count * 2) : (2 * Math.PI * rad) / (count * 4)
    let x = rad * Math.cos(current)
    let y = rad * Math.sin(current)
    const len = Math.sqrt(x * x + y * y)
    const ox = len === 0 ? 0 : y / len
    const oy = len === 0 ? 0 : -x / len
    x += px
    y += py
    const k = perim * roundness * dir
    add(x, y, x - ox * k, y - oy * k, x + ox * k, y + oy * k)
    current += angle * dir
  }
  return path
}

const isPointList = (list: unknown): list is number[][] =>
  Array.isArray(list) &&
  list.every((pt) => Array.isArray(pt) && typeof pt[0] === 'number' && typeof pt[1] === 'number')

/**
 * A path property's value at `frame`, or null when the property is damaged (points that are
 * not number pairs, keyframes mixing paths and numbers): such a path draws nothing measurable,
 * and measuring the rest of the file goes on.
 */
function evaluatePathSafely(
  ks: Parameters<typeof evaluatePath>[0],
  frame: number,
): BezierPath | null {
  let p: BezierPath | null
  try {
    p = evaluatePath(ks, frame)
  } catch {
    return null
  }
  if (!p || !isPointList(p.v)) return null
  if ((p.i !== undefined && !isPointList(p.i)) || (p.o !== undefined && !isPointList(p.o)))
    return null
  return p
}

/**
 * Geometry of a path-producing shape item at `frame` as a bezier path with relative tangents,
 * generated exactly like lottie-web (rect roundness, ellipse and star handles).
 */
export function shapeToBezier(item: ShapeItem, frame: number): BezierPath | null {
  switch (item.ty) {
    case 'sh':
      return evaluatePathSafely(item.ks, frame)
    case 'rc':
      return rectPath(item, frame)
    case 'el':
      return ellipsePath(item, frame)
    case 'sr':
      return starPath(item, frame)
    default:
      return null
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Transforms                                 */
/* -------------------------------------------------------------------------- */

/** The transform item of a group (its last `tr`). */
export function groupTransform(group: GroupShape): TransformShape | undefined {
  const items = Array.isArray(group.it) ? group.it : []
  for (let i = items.length - 1; i >= 0; i--)
    if (items[i]?.ty === 'tr') return items[i] as TransformShape
  return undefined
}

/**
 * Matrix of a layer `ks` or group `tr` at `frame`, in lottie-web's order. `extraRotation`
 * (degrees) is added to the rotation (auto-orient). 3D rotations around X/Y are ignored.
 */
export function transformMatrix(
  tr: Transform | undefined,
  frame: number,
  extraRotation = 0,
): Matrix2D {
  if (!tr) return rotationMatrix(extraRotation)
  const p = evaluatePosition(tr.p, frame)
  const a = evaluateVector(tr.a, frame, [0, 0])
  const s = evaluateVector(tr.s, frame, [100, 100])
  let r = tr.r
    ? evaluateScalar(tr.r, frame)
    : (tr.rz ? evaluateScalar(tr.rz, frame) : 0) +
      (tr.or ? (evaluateVector(tr.or, frame, [0, 0, 0])[2] ?? 0) : 0)
  r += extraRotation
  const sk = tr.sk ? evaluateScalar(tr.sk, frame) : 0
  const sa = tr.sa ? evaluateScalar(tr.sa, frame) : 0
  let m = translationMatrix(p[0] ?? 0, p[1] ?? 0)
  if (r) m = multiplyMatrices(m, rotationMatrix(r))
  if (sk) m = composeMatrices(m, rotationMatrix(-sa), skewXMatrix(-sk), rotationMatrix(sa))
  const sx = (s[0] ?? 100) / 100
  const sy = (s[1] ?? s[0] ?? 100) / 100
  if (sx !== 1 || sy !== 1) m = multiplyMatrices(m, scalingMatrix(sx, sy))
  const ax = a[0] ?? 0
  const ay = a[1] ?? 0
  return ax || ay ? multiplyMatrices(m, translationMatrix(-ax, -ay)) : m
}

/** Direction of motion (degrees) of an animated position, as lottie-web's auto-orient. */
function autoOrientAngle(p: PositionProperty | undefined, frame: number): number {
  if (!p) return 0
  const kfs = isSplitPosition(p) ? getKeyframes(p.x) : getKeyframes(p)
  if (!kfs || kfs.length === 0) return 0
  const first = kfs[0].t
  const last = kfs[kfs.length - 1].t
  let t1 = frame
  let t2 = frame - 0.01
  if (frame <= first) {
    t1 = first + 0.01
    t2 = first
  } else if (frame >= last) {
    t1 = last
    t2 = last - 0.05
  }
  const v1 = evaluatePosition(p, t1)
  const v2 = evaluatePosition(p, t2)
  const dx = (v1[0] ?? 0) - (v2[0] ?? 0)
  const dy = (v1[1] ?? 0) - (v2[1] ?? 0)
  return dx === 0 && dy === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI
}

/** Local matrix of a layer at `frame` (anchor, scale, skew, rotation, auto-orient, position). */
export function layerMatrix(layer: Layer, frame: number): Matrix2D {
  return transformMatrix(layer.ks, frame, layer.ao === 1 ? autoOrientAngle(layer.ks?.p, frame) : 0)
}

function worldMatrixIn(layers: readonly Layer[], layer: Layer, frame: number): Matrix2D {
  let m = layerMatrix(layer, frame)
  for (const parent of parentChain(layers, layer))
    m = multiplyMatrices(layerMatrix(parent, frame), m)
  return m
}

/**
 * Matrix from a layer's own space to the space of its composition at `frame`, through its
 * parents (same composition). Parents pass transforms, never opacity.
 */
export function worldMatrix(anim: Animation, layerPath: NodePath, frame: number): Matrix2D {
  const layer = getLayer(anim, layerPath)
  if (!layer) return IDENTITY_MATRIX
  const layers = getAt<Layer[]>(anim, compPathOf(layerPath))
  return worldMatrixIn(Array.isArray(layers) ? layers : [], layer, frame)
}

/**
 * Matrix from the content space of a shape group (the space of its `it` items) to the space
 * of its layer: the transforms of the enclosing groups, outermost first, then its own.
 * For a layer path (or `shapes` array items) this is the identity.
 */
export function shapeContentMatrix(anim: Animation, shapePath: NodePath, frame: number): Matrix2D {
  const layerPath = layerPathOf(shapePath)
  if (!layerPath) return IDENTITY_MATRIX
  let m = IDENTITY_MATRIX
  // Groups along the path: [...layer, 'shapes', i, 'it', j, 'it', k]
  for (let n = layerPath.length + 2; n <= shapePath.length; n += 2) {
    const prefix = shapePath.slice(0, n)
    if (!isShapePath(prefix)) break
    const item = getAt<ShapeItem>(anim, prefix)
    if (!item || item.ty !== 'gr') break
    m = multiplyMatrices(m, transformMatrix(groupTransform(item), frame))
  }
  return m
}

/** True when no property of the transform is keyframed. */
export function isStaticTransform(tr: Transform | undefined): boolean {
  if (!tr) return true
  const p = tr.p
  if (isSplitPosition(p)) {
    if (isAnimated(p.x) || isAnimated(p.y) || isAnimated(p.z)) return false
  } else if (isAnimated(p)) return false
  return ![tr.a, tr.s, tr.r, tr.o, tr.sk, tr.sa, tr.rx, tr.ry, tr.rz, tr.or].some((prop) =>
    isAnimated(prop),
  )
}

/* -------------------------------------------------------------------------- */
/*                              Shape item bounds                             */
/* -------------------------------------------------------------------------- */

export interface ShapeBoundsOptions {
  /** Grow every path by half the width of the strokes that paint it. */
  includeStroke?: boolean
  /** Matrix applied to the items (maps their space to the result's space). Default identity. */
  matrix?: Matrix2D
}

const MAX_DEPTH = 64
const MAX_COPIES = 1000

interface Reach {
  /** Half stroke width reaching outside the geometry along x / y (result space). */
  strokeX: number
  strokeY: number
  /** Growth from offset path / zig zag modifiers along x / y (result space). */
  growX: number
  growY: number
  /** A trim above removes everything. */
  trimmed: boolean
}

/**
 * Horizontal / vertical extent of a disk of radius `r` mapped by the linear part of `m`
 * (an ellipse): exact axis-aligned reach of a stroke under non-uniform scale or skew.
 */
function diskReach(m: Matrix2D, r: number): [number, number] {
  return [r * Math.hypot(m[0], m[2]), r * Math.hypot(m[1], m[3])]
}

interface Walk {
  frame: number
  includeStroke: boolean
  acc: BoundsAccumulator
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

function isTrimEmpty(item: TrimShape, frame: number): boolean {
  const s = clamp01(evaluateScalar(item.s, frame, 0) / 100)
  const e = clamp01(evaluateScalar(item.e, frame, 100) / 100)
  return Math.abs(s - e) < 1e-9
}

/** Matrices of the copies made by a repeater, reproducing lottie-web's accumulation. */
export function repeaterMatrices(rp: RepeaterShape, frame: number): Matrix2D[] {
  const copies = Math.min(MAX_COPIES, Math.ceil(evaluateScalar(rp.c, frame, 0)))
  if (!(copies > 0)) return []
  const tr: Transform = rp.tr ?? {}
  const p = evaluatePosition(tr.p, frame)
  const a = evaluateVector(tr.a, frame, [0, 0])
  const s = evaluateVector(tr.s, frame, [100, 100])
  const r = evaluateScalar(tr.r, frame, 0)
  const [px = 0, py = 0] = p
  const [ax = 0, ay = 0] = a
  const sx = (s[0] ?? 100) / 100
  const sy = (s[1] ?? s[0] ?? 100) / 100
  const aroundAnchor = (m: Matrix2D) =>
    composeMatrices(translationMatrix(ax, ay), m, translationMatrix(-ax, -ay))
  let pm = IDENTITY_MATRIX
  let rm = IDENTITY_MATRIX
  let sm = IDENTITY_MATRIX
  const apply = (perc: number, inverse: boolean) => {
    const dir = inverse ? -1 : 1
    const kx = sx + (1 - sx) * (1 - perc)
    const ky = sy + (1 - sy) * (1 - perc)
    pm = multiplyMatrices(translationMatrix(px * dir * perc, py * dir * perc), pm)
    rm = multiplyMatrices(aroundAnchor(rotationMatrix(r * dir * perc)), rm)
    sm = multiplyMatrices(
      aroundAnchor(scalingMatrix(inverse ? 1 / kx : kx, inverse ? 1 / ky : ky)),
      sm,
    )
  }
  const offset = Math.max(-MAX_COPIES, Math.min(MAX_COPIES, evaluateScalar(rp.o, frame, 0)))
  const whole = offset > 0 ? Math.floor(offset) : Math.ceil(offset)
  const frac = offset % 1
  if (offset > 0) {
    for (let i = 0; i < whole; i++) apply(1, false)
    if (frac) apply(frac, false)
  } else if (offset < 0) {
    for (let i = 0; i > whole; i--) apply(1, true)
    if (frac) apply(-frac, true)
  }
  const out: Matrix2D[] = []
  for (let k = 0; k < copies; k++) {
    if (k > 0) apply(1, false)
    out.push(composeMatrices(pm, sm, rm))
  }
  return out
}

/**
 * Walks `items[0 .. end)` backwards: styles and modifiers apply to the items above them
 * (lower indices), in the same group and in nested groups.
 */
function walkItems(
  items: readonly ShapeItem[],
  end: number,
  m: Matrix2D,
  inherited: Reach,
  walk: Walk,
  depth: number,
): void {
  if (depth > MAX_DEPTH) return
  const reach: Reach = { ...inherited }
  for (let idx = end - 1; idx >= 0; idx--) {
    const item = items[idx]
    // Hidden items render nothing (the editor also drops hidden groups and modifiers).
    if (!item || typeof item !== 'object' || item.hd === true) continue
    switch (item.ty) {
      case 'st':
      case 'gs': {
        // A stroke is drawn in the space of the level that declares it.
        const [rx, ry] = diskReach(m, Math.abs(evaluateScalar(item.w, walk.frame, 0)) / 2)
        reach.strokeX = Math.max(reach.strokeX, rx)
        reach.strokeY = Math.max(reach.strokeY, ry)
        break
      }
      case 'op':
      case 'zz': {
        const amount =
          item.ty === 'op'
            ? Math.max(0, evaluateScalar(item.a, walk.frame, 0))
            : Math.abs(evaluateScalar(item.s, walk.frame, 0))
        const [gx, gy] = diskReach(m, amount)
        reach.growX += gx
        reach.growY += gy
        break
      }
      case 'tm':
        if (isTrimEmpty(item, walk.frame)) reach.trimmed = true
        break
      case 'rp': {
        for (const copy of repeaterMatrices(item, walk.frame)) {
          walkItems(items, idx, multiplyMatrices(m, copy), reach, walk, depth + 1)
        }
        return
      }
      case 'gr': {
        const children = Array.isArray(item.it) ? item.it : []
        const gm = multiplyMatrices(m, transformMatrix(groupTransform(item), walk.frame))
        walkItems(children, children.length, gm, reach, walk, depth + 1)
        break
      }
      case 'sh':
      case 'rc':
      case 'el':
      case 'sr': {
        if (reach.trimmed) break
        const path = shapeToBezier(item, walk.frame)
        const box = path ? pathBounds(path, m) : null
        if (!box) break
        const dx = reach.growX + (walk.includeStroke ? reach.strokeX : 0)
        const dy = reach.growY + (walk.includeStroke ? reach.strokeY : 0)
        walk.acc.addBox(
          dx > 0 || dy > 0
            ? { x: box.x - dx, y: box.y - dy, w: box.w + 2 * dx, h: box.h + 2 * dy }
            : box,
        )
        break
      }
      default:
        break
    }
  }
}

/**
 * Bounds of shape items at `frame`, in the space that contains them (the layer's space for a
 * layer's `shapes`, the group's content space for a group's `it`), or null when nothing is drawn.
 * Paths are evaluated at the frame; `rc`/`el`/`sr` are generated like lottie-web; nested groups
 * apply their `tr`; hidden items are skipped; repeaters multiply their content; offset path and
 * zig zag grow it. Other modifiers (merge, round corners, pucker, twist) are not applied.
 * With `includeStroke`, paths grow by half the width of the strokes that paint them (mapped
 * exactly through non-uniform transforms; miter spikes and square caps are not counted).
 */
export function shapeItemsBounds(
  items: readonly ShapeItem[] | undefined,
  frame: number,
  opts: ShapeBoundsOptions = {},
): Box | null {
  if (!Array.isArray(items)) return null
  const walk: Walk = { frame, includeStroke: !!opts.includeStroke, acc: new BoundsAccumulator() }
  const reach: Reach = { strokeX: 0, strokeY: 0, growX: 0, growY: 0, trimmed: false }
  walkItems(items, items.length, opts.matrix ?? IDENTITY_MATRIX, reach, walk, 0)
  return walk.acc.toBox()
}

/* -------------------------------------------------------------------------- */
/*                               Layer content                                */
/* -------------------------------------------------------------------------- */

export interface ContentBoundsOptions {
  /** Grow shapes by half their stroke width. */
  includeStroke?: boolean
  /** Clip precomp content to the precomp layer's `w × h`, as players do. Default true. */
  clip?: boolean
  /** A precomp showing nothing measures as its `w × h` box (default) or as null. */
  emptyPrecomp?: 'box' | 'null'
}

const ETX = String.fromCharCode(3)

/** Approximate bounds of a text layer (glyph metrics are unknown without the font). */
function textBounds(anim: Animation, layer: TextLayer, frame: number): Box | null {
  const doc = evaluateTextDocument(layer.t, frame)
  if (!doc || typeof doc.t !== 'string') return null
  if (Array.isArray(doc.sz) && Array.isArray(doc.ps) && doc.sz.length >= 2 && doc.ps.length >= 2) {
    return { x: doc.ps[0], y: doc.ps[1], w: doc.sz[0], h: doc.sz[1] }
  }
  const size = typeof doc.s === 'number' && doc.s > 0 ? doc.s : 0
  // lottie-web breaks lines on "\r" and ETX (U+0003); "\n" is treated the same for the estimate.
  const lines = doc.t
    .split(ETX)
    .join('\r')
    .split(/\r\n|\r|\n/)
  const longest = Math.max(0, ...lines.map((l) => [...l].length))
  if (!size || longest === 0) return null
  const tracking = ((doc.tr ?? 0) / 1000) * size
  const width = longest * (size * 0.55 + tracking)
  const lineHeight = typeof doc.lh === 'number' && doc.lh > 0 ? doc.lh : size * 1.2
  const font = anim.fonts?.list?.find((f) => f.fName === doc.f)
  const ascent = ((font?.ascent ?? 75) / 100) * size
  const x = doc.j === 1 ? -width : doc.j === 2 ? -width / 2 : 0
  return { x, y: -ascent, w: width, h: ascent + (lines.length - 1) * lineHeight + size * 0.25 }
}

/** Visible area allowed by the layer's masks, when they restrict it predictably. */
function maskClip(layer: Layer, frame: number, m: Matrix2D): Box | null | undefined {
  const masks = Array.isArray(layer.masksProperties) ? layer.masksProperties : []
  const active = masks.filter((mask) => mask && mask.mode !== 'n')
  if (active.length === 0) return undefined
  // Only additive / intersecting, non-inverted masks give a simple bound.
  if (
    active.some(
      (mask) => mask.inv || (mask.mode !== undefined && mask.mode !== 'a' && mask.mode !== 'i'),
    )
  )
    return undefined
  let region: Box | null = null
  let started = false
  for (const mask of active) {
    const path = evaluatePathSafely(mask.pt, frame)
    let box = path ? pathBounds(path, m) : null
    const expansion = mask.x ? evaluateScalar(mask.x, frame, 0) : 0
    if (box && expansion > 0) box = expandBox(box, expansion * matrixScale(m))
    if (mask.mode === 'i' && started) region = region && box ? intersectBoxes(region, box) : null
    else region = unionBoxes(region, box)
    started = true
  }
  return region
}

function matteSourceIndex(layers: readonly Layer[], index: number): number {
  const layer = layers[index]
  if (typeof layer.tp === 'number') return findLayerIndexByInd(layers, layer.tp)
  return index > 0 && layers[index - 1]?.td ? index - 1 : -1
}

/** Rendered on its own at `frame`: not hidden, not a matte source, in range, not transparent. */
function isRendered(layer: Layer, frame: number): boolean {
  if (!layer || layer.hd === true || layer.td) return false
  if (!isLayerActiveAt(layer, frame)) return false
  return evaluateScalar(layer.ks?.o, frame, 100) > 0
}

interface ContentWalk {
  anim: Animation
  opts: ContentBoundsOptions
  /** Precomp ids being expanded (cycle guard). */
  visiting: Set<string>
}

/** Union of the rendered layers' bounds; each one is clipped to `clip` first (tighter than clipping the union). */
function layersBounds(
  layers: readonly Layer[],
  frame: number,
  m: Matrix2D,
  cw: ContentWalk,
  clip: Box | null = null,
): Box | null {
  const acc = new BoundsAccumulator()
  layers.forEach((layer, index) => {
    if (!isRendered(layer, frame)) return
    let box = contentBoundsIn(
      layer,
      frame,
      multiplyMatrices(m, worldMatrixIn(layers, layer, frame)),
      cw,
    )
    if (box && (layer.tt === 1 || layer.tt === 3)) {
      // Alpha / luma mattes only show the layer where the matte is.
      const mi = matteSourceIndex(layers, index)
      const matte = mi >= 0 ? layers[mi] : undefined
      if (matte && isLayerActiveAt(matte, frame) && matte.hd !== true) {
        const mb = contentBoundsIn(
          matte,
          frame,
          multiplyMatrices(m, worldMatrixIn(layers, matte, frame)),
          cw,
        )
        box = mb ? intersectBoxes(box, mb) : null
      }
    }
    if (box && clip) box = intersectBoxes(box, clip)
    acc.addBox(box)
  })
  return acc.toBox()
}

function precompBounds(
  layer: PrecompLayer,
  frame: number,
  m: Matrix2D,
  cw: ContentWalk,
): Box | null {
  const w = typeof layer.w === 'number' ? layer.w : 0
  const h = typeof layer.h === 'number' ? layer.h : 0
  const frameBox = w > 0 && h > 0 ? transformBox({ x: 0, y: 0, w, h }, m) : null
  const found = findPrecomp(cw.anim, layer.refId)
  let content: Box | null = null
  if (found && !cw.visiting.has(found.asset.id)) {
    cw.visiting.add(found.asset.id)
    const clip = cw.opts.clip !== false ? frameBox : null
    content = layersBounds(
      found.asset.layers ?? [],
      precompInnerFrame(layer, frame, cw.anim.fr),
      m,
      cw,
      clip,
    )
    cw.visiting.delete(found.asset.id)
  }
  return content ?? (cw.opts.emptyPrecomp === 'null' ? null : frameBox)
}

function contentBoundsIn(layer: Layer, frame: number, m: Matrix2D, cw: ContentWalk): Box | null {
  let box: Box | null = null
  switch (layer.ty) {
    case LayerType.Shape:
      box = shapeItemsBounds(layer.shapes, frame, {
        includeStroke: cw.opts.includeStroke,
        matrix: m,
      })
      break
    case LayerType.Solid:
      box =
        layer.sw > 0 && layer.sh > 0
          ? transformBox({ x: 0, y: 0, w: layer.sw, h: layer.sh }, m)
          : null
      break
    case LayerType.Image: {
      const asset = findAsset(cw.anim, layer.refId)?.asset as { w?: number; h?: number } | undefined
      box =
        asset && (asset.w ?? 0) > 0 && (asset.h ?? 0) > 0
          ? transformBox({ x: 0, y: 0, w: asset.w!, h: asset.h! }, m)
          : null
      break
    }
    case LayerType.Text: {
      const tb = textBounds(cw.anim, layer, frame)
      box = tb ? transformBox(tb, m) : null
      break
    }
    case LayerType.Precomp:
      box = precompBounds(layer, frame, m, cw)
      break
    default:
      box = null
  }
  if (!box) return null
  const clip = maskClip(layer, frame, m)
  if (clip === undefined) return box
  return clip ? intersectBoxes(box, clip) : null
}

/**
 * Bounds of what a layer draws at `frame`, in the layer's own space (before its transform):
 * shapes (exact); solids `sw × sh`; images their asset's `w × h`; text an approximation;
 * precomps the union of their visible layers (transformed, parented, time-mapped, alpha
 * mattes applied) clipped to `w × h`, or `(0, 0, w, h)` when nothing is visible. Additive
 * masks restrict the result. Null when the layer draws nothing (nulls, cameras, audio…).
 */
export function layerContentBounds(
  anim: Animation,
  layerPath: NodePath,
  frame: number,
  opts: ContentBoundsOptions = {},
): Box | null {
  const layer = getLayer(anim, layerPath)
  if (!layer) return null
  return contentBoundsIn(layer, frame, IDENTITY_MATRIX, { anim, opts, visiting: new Set() })
}

/**
 * What a precomp layer's composition shows at `frame` (time of the composition containing the
 * layer), in the layer's own space and before the layer's own masks: the union of the visible
 * inner layers, each clipped to `w × h` unless `clip: false`. Null when nothing is visible and
 * `emptyPrecomp: 'null'` (otherwise the `w × h` box).
 */
export function precompContentBounds(
  anim: Animation,
  layer: PrecompLayer,
  frame: number,
  opts: ContentBoundsOptions = {},
): Box | null {
  return precompBounds(layer, frame, IDENTITY_MATRIX, { anim, opts, visiting: new Set() })
}

/**
 * Union of the visible layers of a composition (`null` = root, otherwise a precomp asset id)
 * at a frame of that composition, in its coordinate space. Null when nothing is visible.
 */
export function compositionBounds(
  anim: Animation,
  compId: string | null,
  frame: number,
  opts: ContentBoundsOptions = {},
): Box | null {
  const layers = compId === null ? anim.layers : findPrecomp(anim, compId)?.asset.layers
  if (!Array.isArray(layers)) return null
  const visiting = new Set<string>(compId === null ? [] : [compId])
  return layersBounds(layers, frame, IDENTITY_MATRIX, { anim, opts, visiting })
}
