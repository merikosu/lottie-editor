/**
 * Tiny Lottie (bodymovin 5.x) builder used to generate the built-in samples.
 * Produces plain JSON in the shape After Effects exports, so the samples exercise the same
 * code paths as real files (keyframe easing arrays, spatial tangents, groups with `tr`, …).
 */

/* ---------------------------------- Numbers --------------------------------- */

/** Rounds to 3 decimals (keeps the files small). */
export const r3 = (n) => Math.round(n * 1000) / 1000

const roundDeep = (v) => (Array.isArray(v) ? v.map(roundDeep) : typeof v === 'number' ? r3(v) : v)

/** '#4C7DFF' → [0.298, 0.49, 1, 1] */
export function hex(color, alpha = 1) {
  const h = color.replace('#', '')
  const n = parseInt(h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha].map(r3)
}

/* ---------------------------------- Easing ---------------------------------- */

/** CSS-style cubic-bezier control points. */
export const ease = {
  linear: [0, 0, 1, 1],
  inOut: [0.42, 0, 0.58, 1],
  // After Effects "Easy Ease"
  easy: [0.333, 0, 0.667, 1],
  out: [0.16, 1, 0.3, 1],
  outCubic: [0.33, 1, 0.68, 1],
  in: [0.5, 0, 0.75, 0],
  inOutCubic: [0.65, 0, 0.35, 1],
  standard: [0.4, 0, 0.2, 1],
  outBack: [0.34, 1.56, 0.64, 1],
  outBackSoft: [0.3, 1.35, 0.6, 1],
}

/* -------------------------------- Properties -------------------------------- */

const asArray = (v) => (Array.isArray(v) ? v : [v])

/** Static property. */
export const st = (k) => ({ a: 0, k: roundDeep(k) })

/**
 * Animated property from [frame, value, easing?] triples. The easing of a key applies to the
 * segment that starts at it (Lottie semantics). `dims` controls the easing handle arrays.
 */
export function anim(keys, { spatial = false } = {}) {
  const k = keys.map(([t, value, curve = ease.easy], i) => {
    const s = roundDeep(asArray(value))
    const key = { t, s }
    if (i < keys.length - 1) {
      const [x1, y1, x2, y2] = curve
      if (spatial) {
        key.o = { x: x1, y: y1 }
        key.i = { x: x2, y: y2 }
        key.to = [0, 0, 0]
        key.ti = [0, 0, 0]
      } else {
        const n = s.length
        key.o = { x: Array(n).fill(x1), y: Array(n).fill(y1) }
        key.i = { x: Array(n).fill(x2), y: Array(n).fill(y2) }
      }
    }
    return key
  })
  return { a: 1, k }
}

/** Property that is either static (plain value) or already built with anim(). */
const prop = (v) => (v && typeof v === 'object' && !Array.isArray(v) && 'k' in v ? v : st(v))

/* --------------------------------- Transform -------------------------------- */

/** Layer transform (`ks`). Values may be static or anim(...). */
export function transform({
  a = [0, 0, 0],
  p = [0, 0, 0],
  s = [100, 100, 100],
  r = 0,
  o = 100,
} = {}) {
  return { o: prop(o), r: prop(r), p: prop(p), a: prop(a), s: prop(s) }
}

/** Shape group transform (`ty: 'tr'`). */
export function groupTransform({ a = [0, 0], p = [0, 0], s = [100, 100], r = 0, o = 100 } = {}) {
  return {
    ty: 'tr',
    p: prop(p),
    a: prop(a),
    s: prop(s),
    r: prop(r),
    o: prop(o),
    sk: st(0),
    sa: st(0),
    nm: 'Transform',
  }
}

/* ---------------------------------- Shapes ---------------------------------- */

export function group(nm, items, tr = {}) {
  return {
    ty: 'gr',
    it: [...items, groupTransform(tr)],
    nm,
    np: items.length,
    cix: 2,
    bm: 0,
    ix: 1,
    mn: 'ADBE Vector Group',
    hd: false,
  }
}

export function ellipse(size, p = [0, 0], nm = 'Ellipse Path') {
  return {
    d: 1,
    ty: 'el',
    s: prop(size),
    p: prop(p),
    nm,
    mn: 'ADBE Vector Shape - Ellipse',
    hd: false,
  }
}

export function rect(size, p = [0, 0], radius = 0, nm = 'Rectangle Path') {
  return {
    d: 1,
    ty: 'rc',
    s: prop(size),
    p: prop(p),
    r: prop(radius),
    nm,
    mn: 'ADBE Vector Shape - Rect',
    hd: false,
  }
}

/** Bezier path from absolute vertices and relative tangents. */
export function bezier(v, i, o, c = true) {
  return { i: roundDeep(i), o: roundDeep(o), v: roundDeep(v), c }
}

export function path(shape, nm = 'Path') {
  const ks = shape && 'k' in shape ? shape : { a: 0, k: shape }
  return { ind: 0, ty: 'sh', ix: 1, ks, nm, mn: 'ADBE Vector Shape - Group', hd: false }
}

/** Morphing path: [frame, bezier, easing?] triples. */
export function pathAnim(keys) {
  return {
    a: 1,
    k: keys.map(([t, shape, curve = ease.easy], idx) => {
      const key = { t, s: [shape] }
      if (idx < keys.length - 1) {
        key.o = { x: curve[0], y: curve[1] }
        key.i = { x: curve[2], y: curve[3] }
      }
      return key
    }),
  }
}

export function fill(color, o = 100, nm = 'Fill') {
  return {
    ty: 'fl',
    c: prop(color),
    o: prop(o),
    r: 1,
    bm: 0,
    nm,
    mn: 'ADBE Vector Graphic - Fill',
    hd: false,
  }
}

export function stroke(color, w, { o = 100, lc = 2, lj = 2, dashes, nm = 'Stroke' } = {}) {
  const out = {
    ty: 'st',
    c: prop(color),
    o: prop(o),
    w: prop(w),
    lc,
    lj,
    ml: 4,
    bm: 0,
    nm,
    mn: 'ADBE Vector Graphic - Stroke',
    hd: false,
  }
  if (dashes) out.d = dashes
  return out
}

/** Gradient stops: [[offset, '#hex', alpha?], …] → Lottie flat color (+ alpha) array. */
function gradientStops(stops) {
  const colors = stops.flatMap(([offset, color]) => [offset, ...hex(color).slice(0, 3)])
  const hasAlpha = stops.some(([, , alpha]) => alpha !== undefined && alpha !== 1)
  const alphas = hasAlpha ? stops.flatMap(([offset, , alpha = 1]) => [offset, alpha]) : []
  return [...colors, ...alphas].map(r3)
}

export function gradientFill({ stops, s, e, type = 1, o = 100, h, a, nm = 'Gradient Fill' }) {
  const out = {
    ty: 'gf',
    o: prop(o),
    r: 1,
    bm: 0,
    g: { p: stops.length, k: st(gradientStops(stops)) },
    s: prop(s),
    e: prop(e),
    t: type,
    nm,
    mn: 'ADBE Vector Graphic - G-Fill',
    hd: false,
  }
  if (type === 2) {
    out.h = prop(h ?? 0)
    out.a = prop(a ?? 0)
  }
  return out
}

export function trim({ s = 0, e = 100, o = 0, m = 1, nm = 'Trim Paths' } = {}) {
  return {
    ty: 'tm',
    s: prop(s),
    e: prop(e),
    o: prop(o),
    m,
    ix: 2,
    nm,
    mn: 'ADBE Vector Filter - Trim',
    hd: false,
  }
}

export function repeater({
  copies,
  offset = 0,
  p = [0, 0],
  r = 0,
  s = [100, 100],
  so = 100,
  eo = 100,
  nm = 'Repeater',
}) {
  return {
    ty: 'rp',
    c: prop(copies),
    o: prop(offset),
    m: 1,
    ix: 3,
    tr: {
      ty: 'tr',
      p: prop(p),
      a: st([0, 0]),
      s: prop(s),
      r: prop(r),
      so: prop(so),
      eo: prop(eo),
      nm: 'Transform',
    },
    nm,
    mn: 'ADBE Vector Filter - Repeater',
    hd: false,
  }
}

/* ---------------------------------- Layers ---------------------------------- */

const layerBase = ({ nm, ind, ip, op, ks, parent, st: start = 0 }) => {
  const base = { ddd: 0, ind, nm, sr: 1, ks, ao: 0, ip, op, st: start, bm: 0 }
  if (parent !== undefined) base.parent = parent
  return base
}

export function shapeLayer({ nm, ind, ip = 0, op, ks = transform(), shapes, parent }) {
  return { ...layerBase({ nm, ind, ip, op, ks, parent }), ty: 4, shapes }
}

export function nullLayer({ nm, ind, ip = 0, op, ks = transform(), parent }) {
  return { ...layerBase({ nm, ind, ip, op, ks, parent }), ty: 3 }
}

export function precompLayer({
  nm,
  ind,
  refId,
  w,
  h,
  ip = 0,
  op,
  st: start = 0,
  ks = transform(),
  parent,
}) {
  return { ...layerBase({ nm, ind, ip, op, ks, parent, st: start }), ty: 0, refId, w, h }
}

/** Text layer with hold keyframes of text documents: [[frame, text], …]. */
export function textLayer({
  nm,
  ind,
  ip = 0,
  op,
  ks = transform(),
  parent,
  keys,
  font,
  size,
  color,
  justify = 0,
  tracking = 0,
}) {
  return {
    ...layerBase({ nm, ind, ip, op, ks, parent }),
    ty: 5,
    t: {
      d: {
        k: keys.map(([t, text]) => ({
          s: {
            s: size,
            f: font,
            t: text,
            ca: 0,
            j: justify,
            tr: tracking,
            lh: r3(size * 1.2),
            ls: 0,
            fc: hex(color).slice(0, 3),
          },
          t,
        })),
      },
      p: {},
      m: { g: 1, a: st([0, 0]) },
      a: [],
    },
  }
}

/* -------------------------------- Composition ------------------------------- */

export function composition({ nm, w, h, fr, op, layers, assets = [], fonts, markers = [] }) {
  const out = { v: '5.12.2', fr, ip: 0, op, w, h, nm, ddd: 0, assets, layers, markers }
  if (fonts) out.fonts = { list: fonts }
  return out
}
