/**
 * SVG `transform` attribute and CSS `transform` property parsing into a 2D affine matrix.
 * Supports matrix, translate, scale, rotate(a [cx cy]), skewX, skewY and the CSS variants
 * (translateX/Y, scaleX/Y, skew, rotateZ, translate3d/scale3d/matrix3d reduced to 2D) with
 * units (px, deg, rad, grad, turn).
 */
import {
  IDENTITY_MATRIX,
  composeMatrices,
  multiplyMatrices,
  rotationMatrix,
  scalingMatrix,
  skewXMatrix,
  skewYMatrix,
  translationMatrix,
  type Matrix2D,
} from '../bounds'

const FUNCTION_RE = /([a-zA-Z][a-zA-Z0-9]*)\s*\(([^()]*)\)/y
const ARG_RE = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:deg|rad|grad|turn|px|%)?/giy

type Arg = { n: number; unit: string }

function parseArgs(body: string): Arg[] | null {
  const out: Arg[] = []
  let pos = 0
  const skip = () => {
    while (pos < body.length && /[\s,]/.test(body[pos])) pos++
  }
  skip()
  while (pos < body.length) {
    ARG_RE.lastIndex = pos
    const m = ARG_RE.exec(body)
    if (!m) return null
    const unitMatch = /(deg|rad|grad|turn|px|%)$/i.exec(m[0])
    const unit = unitMatch ? unitMatch[1].toLowerCase() : ''
    const n = Number(unit ? m[0].slice(0, -unit.length) : m[0])
    if (!Number.isFinite(n)) return null
    out.push({ n, unit })
    pos += m[0].length
    skip()
  }
  return out
}

function degrees(arg: Arg): number | null {
  switch (arg.unit) {
    case '':
    case 'deg':
      return arg.n
    case 'rad':
      return (arg.n * 180) / Math.PI
    case 'grad':
      return arg.n * 0.9
    case 'turn':
      return arg.n * 360
    default:
      return null
  }
}

function length(arg: Arg | undefined): number | null {
  if (!arg) return null
  return arg.unit === '' || arg.unit === 'px' ? arg.n : null
}

const tan = (deg: number) => Math.tan((deg * Math.PI) / 180)

function functionMatrix(name: string, args: Arg[]): Matrix2D | null {
  const n = args.length
  const plain = args.map((a) => a.n)
  switch (name.toLowerCase()) {
    case 'matrix':
      return n === 6 ? (plain as unknown as Matrix2D) : null
    case 'matrix3d':
      // Column-major 4×4: the 2D part is m11 m12 m21 m22 m41 m42.
      return n === 16 ? [plain[0], plain[1], plain[4], plain[5], plain[12], plain[13]] : null
    case 'translate':
    case 'translate3d': {
      const tx = length(args[0])
      const ty = n > 1 ? length(args[1]) : 0
      if (tx === null || ty === null || n > (name.length > 9 ? 3 : 2)) return null
      return translationMatrix(tx, ty)
    }
    case 'translatex': {
      const tx = length(args[0])
      return n === 1 && tx !== null ? translationMatrix(tx, 0) : null
    }
    case 'translatey': {
      const ty = length(args[0])
      return n === 1 && ty !== null ? translationMatrix(0, ty) : null
    }
    case 'scale':
    case 'scale3d':
      if (n < 1 || n > (name.length > 5 ? 3 : 2)) return null
      return scalingMatrix(plain[0], n > 1 ? plain[1] : plain[0])
    case 'scalex':
      return n === 1 ? scalingMatrix(plain[0], 1) : null
    case 'scaley':
      return n === 1 ? scalingMatrix(1, plain[0]) : null
    case 'rotate':
    case 'rotatez': {
      if (n !== 1 && n !== 3) return null
      const a = degrees(args[0])
      if (a === null) return null
      if (n === 1) return rotationMatrix(a)
      const cx = length(args[1])
      const cy = length(args[2])
      if (cx === null || cy === null) return null
      return composeMatrices(
        translationMatrix(cx, cy),
        rotationMatrix(a),
        translationMatrix(-cx, -cy),
      )
    }
    case 'skewx': {
      const a = n === 1 ? degrees(args[0]) : null
      return a === null ? null : skewXMatrix(a)
    }
    case 'skewy': {
      const a = n === 1 ? degrees(args[0]) : null
      return a === null ? null : skewYMatrix(a)
    }
    case 'skew': {
      if (n < 1 || n > 2) return null
      const ax = degrees(args[0])
      const ay = n > 1 ? degrees(args[1]) : 0
      if (ax === null || ay === null) return null
      return [1, tan(ay), tan(ax), 1, 0, 0]
    }
    default:
      return null
  }
}

/**
 * Parses a transform list (`translate(10 20) rotate(45)`, CSS `rotate(0.25turn)`…) into one
 * matrix (functions compose left to right, so the last one applies first). Returns null for
 * an invalid list — SVG then ignores the whole attribute — and identity for `none`/empty.
 */
export function parseTransform(value: string | null | undefined): Matrix2D | null {
  if (value === null || value === undefined) return IDENTITY_MATRIX
  const text = value.trim()
  if (text === '' || text.toLowerCase() === 'none') return IDENTITY_MATRIX
  let m = IDENTITY_MATRIX
  let pos = 0
  while (pos < text.length) {
    while (pos < text.length && /[\s,]/.test(text[pos])) pos++
    if (pos >= text.length) break
    FUNCTION_RE.lastIndex = pos
    const fn = FUNCTION_RE.exec(text)
    if (!fn) return null
    const args = parseArgs(fn[2])
    const fm = args ? functionMatrix(fn[1], args) : null
    if (!fm || fm.some((v) => !Number.isFinite(v))) return null
    m = multiplyMatrices(m, fm)
    pos += fn[0].length
  }
  return m
}
