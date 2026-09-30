/**
 * SVG path data → cubic bezier subpaths.
 *
 * Every command is supported (M m L l H h V v C c S s Q q T t A a Z z) with implicit repeats
 * (extra pairs after M are line-tos), compact numbers (`M1.5.5`, `1-2`, `1e-3`) and glued arc
 * flags (`a1 1 0 0110 10`). Quadratics are elevated to cubics exactly; arcs are converted with
 * the endpoint → center parameterization of the SVG spec (F.6.5), split into ≤ 90° pieces.
 * Malformed data is handled like browsers do: everything before the bad command is kept.
 */
import { applyMatrix, IDENTITY_MATRIX, type Matrix2D } from '../bounds'
import type { BezierPath } from '../types'
import { NumberScanner } from './scan'

/** A vertex with ABSOLUTE in/out control points (equal to the vertex when there is no tangent). */
export interface AbsVertex {
  x: number
  y: number
  ix: number
  iy: number
  ox: number
  oy: number
}

export interface AbsSubpath {
  vertices: AbsVertex[]
  closed: boolean
}

const vertex = (x: number, y: number): AbsVertex => ({ x, y, ix: x, iy: y, ox: x, oy: y })

function samePoint(ax: number, ay: number, bx: number, by: number): boolean {
  const eps = 1e-7 * Math.max(1, Math.abs(ax), Math.abs(ay), Math.abs(bx), Math.abs(by))
  return Math.abs(ax - bx) <= eps && Math.abs(ay - by) <= eps
}

/**
 * Accumulates subpaths from pen commands. Drawing after `close()` starts a new subpath at the
 * start point of the closed one, as the SVG spec requires.
 */
export class PathBuilder {
  readonly subpaths: AbsSubpath[] = []
  private current: AbsSubpath | null = null
  private startX = 0
  private startY = 0

  moveTo(x: number, y: number): void {
    this.current = { vertices: [vertex(x, y)], closed: false }
    this.subpaths.push(this.current)
    this.startX = x
    this.startY = y
  }

  private open(): AbsSubpath {
    if (!this.current) this.moveTo(this.startX, this.startY)
    return this.current as AbsSubpath
  }

  lineTo(x: number, y: number): void {
    this.open().vertices.push(vertex(x, y))
  }

  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const sp = this.open()
    const last = sp.vertices[sp.vertices.length - 1]
    last.ox = c1x
    last.oy = c1y
    sp.vertices.push({ x, y, ix: c2x, iy: c2y, ox: x, oy: y })
  }

  /** Closes the current subpath, merging a final vertex that duplicates the first one. */
  close(): void {
    const sp = this.current
    if (!sp) return
    const vs = sp.vertices
    if (vs.length > 1) {
      const first = vs[0]
      const last = vs[vs.length - 1]
      if (samePoint(first.x, first.y, last.x, last.y)) {
        // The closing segment has zero length: its incoming tangent belongs to the first vertex.
        first.ix = last.ix
        first.iy = last.iy
        vs.pop()
      }
    }
    sp.closed = true
    this.current = null
  }

  /** Subpaths that draw something (a lone move-to draws nothing). */
  result(): AbsSubpath[] {
    return this.subpaths.filter((sp) => sp.vertices.length > 1)
  }
}

/* -------------------------------------------------------------------------- */
/*                                     Arcs                                   */
/* -------------------------------------------------------------------------- */

const vectorAngle = (ux: number, uy: number, vx: number, vy: number) =>
  Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)

/**
 * Appends an SVG elliptical arc from (x1, y1) to (x2, y2) as cubic beziers (≤ 90° each).
 * Out-of-range radii are handled per the spec: zero radius → straight line, too small → scaled up.
 */
export function arcTo(
  b: PathBuilder,
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): void {
  if (x1 === x2 && y1 === y2) return
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx === 0 || ry === 0) {
    b.lineTo(x2, y2)
    return
  }
  const phi = (((rotationDeg % 360) + 360) % 360) * (Math.PI / 180)
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx2 = (x1 - x2) / 2
  const dy2 = (y1 - y2) / 2
  const x1p = cos * dx2 + sin * dy2
  const y1p = -sin * dx2 + cos * dy2
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    const k = Math.sqrt(lambda)
    rx *= k
    ry *= k
  }
  const rx2 = rx * rx
  const ry2 = ry * ry
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p
  const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, den === 0 ? 0 : num / den))
  const cxp = (coef * rx * y1p) / ry
  const cyp = (-coef * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
  const ux = (x1p - cxp) / rx
  const uy = (y1p - cyp) / ry
  const vx = (-x1p - cxp) / rx
  const vy = (-y1p - cyp) / ry
  const theta1 = vectorAngle(1, 0, ux, uy)
  let delta = vectorAngle(ux, uy, vx, vy)
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  else if (sweep && delta < 0) delta += 2 * Math.PI
  const segments = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9))
  const step = delta / segments
  const k = (4 / 3) * Math.tan(step / 4)
  const map = (px: number, py: number): [number, number] => [
    cx + rx * px * cos - ry * py * sin,
    cy + rx * px * sin + ry * py * cos,
  ]
  let t1 = theta1
  for (let s = 0; s < segments; s++) {
    const t2 = t1 + step
    const c1 = Math.cos(t1)
    const s1 = Math.sin(t1)
    const c2 = Math.cos(t2)
    const s2 = Math.sin(t2)
    const [ax, ay] = map(c1 - k * s1, s1 + k * c1)
    const [bx, by] = map(c2 + k * s2, s2 - k * c2)
    // Land exactly on the requested end point (no accumulated drift).
    const [ex, ey] = s === segments - 1 ? [x2, y2] : map(c2, s2)
    b.cubicTo(ax, ay, bx, by, ex, ey)
    t1 = t2
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Parsing                                  */
/* -------------------------------------------------------------------------- */

const COMMANDS = 'MmZzLlHhVvCcSsQqTtAa'

export interface PathDataResult {
  subpaths: AbsSubpath[]
  /** True when the data was malformed (everything before the error is kept). */
  error: boolean
}

/** Parses SVG path data into absolute cubic subpaths (user space, untransformed). */
export function parsePathData(d: string | null | undefined): PathDataResult {
  const b = new PathBuilder()
  if (!d) return { subpaths: [], error: false }
  const s = new NumberScanner(d)
  let cmd = ''
  let x = 0
  let y = 0
  let startX = 0
  let startY = 0
  // Reflection state for S/s (cubic) and T/t (quadratic).
  let lastKind: '' | 'C' | 'Q' = ''
  let ctrlX = 0
  let ctrlY = 0
  let error = false
  let first = true

  const nums = (count: number): number[] | null => {
    const out: number[] = []
    for (let n = 0; n < count; n++) {
      const v = s.number()
      if (v === null) return null
      out.push(v)
    }
    return out
  }

  for (;;) {
    s.skipWhitespace()
    if (s.pos >= s.text.length) break
    const ch = s.text[s.pos]
    if (COMMANDS.includes(ch)) {
      cmd = ch
      s.pos++
    } else if (ch === ',' && cmd && cmd !== 'Z' && cmd !== 'z') {
      // A comma between two argument groups of the same command.
      s.pos++
      continue
    } else if (!cmd || cmd === 'Z' || cmd === 'z' || !s.atNumber()) {
      error = true
      break
    } else if (cmd === 'M') {
      cmd = 'L'
    } else if (cmd === 'm') {
      cmd = 'l'
    }
    if (first && cmd !== 'M' && cmd !== 'm') {
      error = true
      break
    }
    first = false
    const rel = cmd === cmd.toLowerCase()
    const ox = rel ? x : 0
    const oy = rel ? y : 0
    let kind: '' | 'C' | 'Q' = ''
    switch (cmd) {
      case 'M':
      case 'm': {
        const a = nums(2)
        if (!a) {
          error = true
          break
        }
        x = ox + a[0]
        y = oy + a[1]
        startX = x
        startY = y
        b.moveTo(x, y)
        break
      }
      case 'Z':
      case 'z':
        b.close()
        x = startX
        y = startY
        break
      case 'L':
      case 'l': {
        const a = nums(2)
        if (!a) {
          error = true
          break
        }
        x = ox + a[0]
        y = oy + a[1]
        b.lineTo(x, y)
        break
      }
      case 'H':
      case 'h': {
        const a = nums(1)
        if (!a) {
          error = true
          break
        }
        x = ox + a[0]
        b.lineTo(x, y)
        break
      }
      case 'V':
      case 'v': {
        const a = nums(1)
        if (!a) {
          error = true
          break
        }
        y = oy + a[0]
        b.lineTo(x, y)
        break
      }
      case 'C':
      case 'c': {
        const a = nums(6)
        if (!a) {
          error = true
          break
        }
        ctrlX = ox + a[2]
        ctrlY = oy + a[3]
        b.cubicTo(ox + a[0], oy + a[1], ctrlX, ctrlY, ox + a[4], oy + a[5])
        x = ox + a[4]
        y = oy + a[5]
        kind = 'C'
        break
      }
      case 'S':
      case 's': {
        const a = nums(4)
        if (!a) {
          error = true
          break
        }
        const c1x = lastKind === 'C' ? 2 * x - ctrlX : x
        const c1y = lastKind === 'C' ? 2 * y - ctrlY : y
        ctrlX = ox + a[0]
        ctrlY = oy + a[1]
        b.cubicTo(c1x, c1y, ctrlX, ctrlY, ox + a[2], oy + a[3])
        x = ox + a[2]
        y = oy + a[3]
        kind = 'C'
        break
      }
      case 'Q':
      case 'q': {
        const a = nums(4)
        if (!a) {
          error = true
          break
        }
        ctrlX = ox + a[0]
        ctrlY = oy + a[1]
        const ex = ox + a[2]
        const ey = oy + a[3]
        quadTo(b, x, y, ctrlX, ctrlY, ex, ey)
        x = ex
        y = ey
        kind = 'Q'
        break
      }
      case 'T':
      case 't': {
        const a = nums(2)
        if (!a) {
          error = true
          break
        }
        ctrlX = lastKind === 'Q' ? 2 * x - ctrlX : x
        ctrlY = lastKind === 'Q' ? 2 * y - ctrlY : y
        const ex = ox + a[0]
        const ey = oy + a[1]
        quadTo(b, x, y, ctrlX, ctrlY, ex, ey)
        x = ex
        y = ey
        kind = 'Q'
        break
      }
      case 'A':
      case 'a': {
        const r = nums(3)
        const largeArc = r ? s.flag() : null
        const sweep = largeArc !== null ? s.flag() : null
        const end = sweep !== null ? nums(2) : null
        if (!r || largeArc === null || sweep === null || !end) {
          error = true
          break
        }
        const ex = ox + end[0]
        const ey = oy + end[1]
        arcTo(b, x, y, r[0], r[1], r[2], largeArc === 1, sweep === 1, ex, ey)
        x = ex
        y = ey
        break
      }
      default:
        error = true
    }
    if (error) break
    lastKind = kind
  }
  return { subpaths: b.result(), error }
}

/** Quadratic bezier elevated to a cubic (exact). */
function quadTo(
  b: PathBuilder,
  x0: number,
  y0: number,
  qx: number,
  qy: number,
  x: number,
  y: number,
): void {
  b.cubicTo(
    x0 + (2 / 3) * (qx - x0),
    y0 + (2 / 3) * (qy - y0),
    x + (2 / 3) * (qx - x),
    y + (2 / 3) * (qy - y),
    x,
    y,
  )
}

/* -------------------------------------------------------------------------- */
/*                               Lottie conversion                            */
/* -------------------------------------------------------------------------- */

/**
 * Converts an absolute subpath into a Lottie bezier (tangents relative to their vertex),
 * transforming vertices and control points by `m` (exact for affine maps).
 */
export function subpathToBezier(sp: AbsSubpath, m: Matrix2D = IDENTITY_MATRIX): BezierPath {
  const path: BezierPath = { v: [], i: [], o: [], c: sp.closed }
  for (const vx of sp.vertices) {
    const [x, y] = applyMatrix(m, vx.x, vx.y)
    const [ix, iy] = applyMatrix(m, vx.ix, vx.iy)
    const [ox, oy] = applyMatrix(m, vx.ox, vx.oy)
    path.v.push([x, y])
    path.i.push([ix - x, iy - y])
    path.o.push([ox - x, oy - y])
  }
  return path
}

/**
 * Converts SVG path data into Lottie bezier paths (one per subpath), optionally transformed.
 * Numbers are not rounded.
 */
export function svgPathToBeziers(d: string, matrix: Matrix2D = IDENTITY_MATRIX): BezierPath[] {
  return parsePathData(d).subpaths.map((sp) => subpathToBezier(sp, matrix))
}
