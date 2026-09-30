/**
 * Builders for the Lottie shape items produced by the SVG importer. Geometry is rounded to
 * 3 decimals; colors use 6 decimals rounded UP so lottie-web's `floor(c · 255)` gives back the
 * exact 8-bit value of the source color.
 */
import type { RGBA } from '@/lib/color'
import { decomposeMatrix, type Matrix2D } from '../bounds'
import type {
  BezierPath,
  FillShape,
  GradientFillShape,
  GradientStrokeShape,
  GroupShape,
  PathShape,
  RectShape,
  ShapeItem,
  StrokeDash,
  StrokeShape,
  TransformShape,
} from '../types'

/** Rounds to 3 decimals (no negative zero). Used for percentages and angles. */
export function round3(v: number): number {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) || !Number.isFinite(r) ? 0 : r
}

/** Decimals kept for coordinates and lengths: 3, more for tiny artboards (see below). */
let geometryDigits = 3

/**
 * Decimals that keep coordinates within 1/10 000 of an artboard of `size` units: 3 for
 * anything from 10 units up (icons, logos), more for SVGs drawn in tiny units (viewBox 0 0 1 1).
 */
export function geometryDecimals(size: number): number {
  return Math.min(8, Math.max(3, Math.ceil(4 - Math.log10(size > 0 ? size : 1))))
}

/** Runs `fn` (synchronously) with coordinates rounded to `digits` decimals. */
export function withGeometryDecimals<T>(digits: number, fn: () => T): T {
  const previous = geometryDigits
  geometryDigits = digits
  try {
    return fn()
  } finally {
    geometryDigits = previous
  }
}

/** Rounds a coordinate or length to the current geometry precision. */
export function roundGeom(v: number): number {
  const f = 10 ** geometryDigits
  const r = Math.round(v * f) / f
  return Object.is(r, -0) || !Number.isFinite(r) ? 0 : r
}

/** Color channel 0..1 encoded so that `floor(c · 255)` and `round(c · 255)` restore 8-bit values. */
export function colorChannel(v: number): number {
  if (!(v > 0)) return 0
  if (v >= 1) return 1
  return Math.min(1, Math.max(0, Math.ceil(v * 1e6 - 1e-6) / 1e6))
}

/** Lottie color `[r, g, b, 1]` (fill/stroke colors ignore alpha: it goes into opacity). */
export function lottieColor(c: RGBA): number[] {
  return [colorChannel(c.r), colorChannel(c.g), colorChannel(c.b), 1]
}

const stat = <T>(k: T): { a: 0; k: T } => ({ a: 0, k })

/** Opacity 0..1 → Lottie 0..100. */
const pct = (v: number) => round3(Math.max(0, Math.min(1, v)) * 100)

const roundPoints = (list: number[][]) => list.map(([x, y]) => [roundGeom(x), roundGeom(y)])

export function roundPath(p: BezierPath): BezierPath {
  return { i: roundPoints(p.i), o: roundPoints(p.o), v: roundPoints(p.v), c: p.c }
}

/** Group transform: identity, or the exact Lottie values of an affine `matrix`. */
export function makeTransform(opacity = 1, matrix?: Matrix2D): TransformShape {
  const d = matrix ? decomposeMatrix(matrix) : null
  return {
    ty: 'tr',
    p: stat(d ? [roundGeom(d.position[0]), roundGeom(d.position[1])] : [0, 0]),
    a: stat([0, 0]),
    s: stat(d ? [round3(d.scale[0]), round3(d.scale[1])] : [100, 100]),
    r: stat(d ? round3(d.rotation) : 0),
    o: stat(pct(opacity)),
    sk: stat(d ? round3(d.skew) : 0),
    sa: stat(0),
    nm: 'Transform',
  }
}

export function makeGroup(
  name: string,
  items: ShapeItem[],
  opacity = 1,
  blendMode = 0,
  matrix?: Matrix2D,
): GroupShape {
  const group: GroupShape = { ty: 'gr', nm: name, it: [...items, makeTransform(opacity, matrix)] }
  if (blendMode) group.bm = blendMode
  return group
}

export function makePath(path: BezierPath, name: string): PathShape {
  return { ty: 'sh', nm: name, ks: stat(roundPath(path)), d: 1 }
}

/** Axis-aligned rectangle (`rc`): center, size, corner radius. */
export function makeRect(
  center: [number, number],
  size: [number, number],
  radius: number,
  name: string,
): RectShape {
  return {
    ty: 'rc',
    nm: name,
    d: 1,
    p: stat([roundGeom(center[0]), roundGeom(center[1])]),
    s: stat([roundGeom(size[0]), roundGeom(size[1])]),
    r: stat(roundGeom(radius)),
  }
}

export type LineCapName = 'butt' | 'round' | 'square'
export type LineJoinName = 'miter' | 'round' | 'bevel'

const CAP: Record<LineCapName, 1 | 2 | 3> = { butt: 1, round: 2, square: 3 }
const JOIN: Record<LineJoinName, 1 | 2 | 3> = { miter: 1, round: 2, bevel: 3 }

export interface StrokeStyle {
  /** Output units. */
  width: number
  cap: LineCapName
  join: LineJoinName
  miterLimit: number
  /** Dash pattern and offset in output units (null = solid). */
  dashes: number[] | null
  dashOffset: number
}

function strokeProps(s: StrokeStyle) {
  const props: {
    w: { a: 0; k: number }
    lc: 1 | 2 | 3
    lj: 1 | 2 | 3
    ml: number
    d?: StrokeDash[]
  } = {
    w: stat(roundGeom(s.width)),
    lc: CAP[s.cap],
    lj: JOIN[s.join],
    ml: round3(s.miterLimit),
  }
  if (s.dashes && s.dashes.length > 0) {
    // Names must be unique per stroke (bodymovin: dash, gap, dash2, gap2…): lottie-web's full
    // build defines one getter per name and throws on a repeated one, dropping the whole layer.
    const d: StrokeDash[] = s.dashes.map((v, n) => {
      const suffix = n < 2 ? '' : String(Math.floor(n / 2) + 1)
      return n % 2 === 0
        ? { n: 'd', nm: `dash${suffix}`, v: stat(roundGeom(v)) }
        : { n: 'g', nm: `gap${suffix}`, v: stat(roundGeom(v)) }
    })
    d.push({ n: 'o', nm: 'offset', v: stat(roundGeom(s.dashOffset)) })
    props.d = d
  }
  return props
}

export function makeFill(
  color: RGBA,
  opacity: number,
  evenOdd: boolean,
  name = 'Fill 1',
): FillShape {
  return {
    ty: 'fl',
    nm: name,
    c: stat(lottieColor(color)),
    o: stat(pct(opacity * color.a)),
    r: evenOdd ? 2 : 1,
    bm: 0,
  }
}

export function makeStroke(
  color: RGBA,
  opacity: number,
  style: StrokeStyle,
  name = 'Stroke 1',
): StrokeShape {
  return {
    ty: 'st',
    nm: name,
    c: stat(lottieColor(color)),
    o: stat(pct(opacity * color.a)),
    ...strokeProps(style),
    bm: 0,
  }
}

export interface GradientData {
  t: 1 | 2
  s: [number, number]
  e: [number, number]
  h: number
  a: number
  count: number
  data: number[]
}

function gradientProps(g: GradientData, opacity: number) {
  const data = g.data.map((v, n) => {
    // Offsets and alphas keep 3 decimals; color channels use the 8-bit-safe encoding.
    const colorPart = n < g.count * 4
    return colorPart && n % 4 !== 0 ? colorChannel(v) : Math.round(v * 1000) / 1000
  })
  const props: {
    o: { a: 0; k: number }
    g: { p: number; k: { a: 0; k: number[] } }
    s: { a: 0; k: number[] }
    e: { a: 0; k: number[] }
    t: 1 | 2
    h?: { a: 0; k: number }
    a?: { a: 0; k: number }
  } = {
    o: stat(pct(opacity)),
    g: { p: g.count, k: stat(data) },
    s: stat([roundGeom(g.s[0]), roundGeom(g.s[1])]),
    e: stat([roundGeom(g.e[0]), roundGeom(g.e[1])]),
    t: g.t,
  }
  if (g.t === 2) {
    props.h = stat(round3(g.h))
    props.a = stat(round3(g.a))
  }
  return props
}

export function makeGradientFill(
  g: GradientData,
  opacity: number,
  evenOdd: boolean,
  name = 'Gradient Fill 1',
): GradientFillShape {
  return { ty: 'gf', nm: name, ...gradientProps(g, opacity), r: evenOdd ? 2 : 1, bm: 0 }
}

export function makeGradientStroke(
  g: GradientData,
  opacity: number,
  style: StrokeStyle,
  name = 'Gradient Stroke 1',
): GradientStrokeShape {
  return { ty: 'gs', nm: name, ...gradientProps(g, opacity), ...strokeProps(style), bm: 0 }
}
