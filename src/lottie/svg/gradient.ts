/**
 * SVG `linearGradient` / `radialGradient` → Lottie gradient data.
 *
 * `href` chains are followed for attributes and stops; `gradientUnits` (objectBoundingBox or
 * userSpaceOnUse) and `gradientTransform` are mapped through the element's transform into the
 * output space. Linear gradients stay exact under any affine map (the end point is placed so
 * the isolines keep their orientation); radial gradients are exact under similarity transforms.
 * Elliptical radial gradients (non-uniform map) are exact in their own space (`ownSpace`: the
 * caller paints them in a group carrying that transform), otherwise approximated.
 */
import type { RGBA } from '@/lib/color'
import {
  applyMatrix,
  applyMatrixToVector,
  composeMatrices,
  IDENTITY_MATRIX,
  matrixSingularValues,
  scalingMatrix,
  translationMatrix,
  type Box,
  type Matrix2D,
} from '../bounds'
import { parseFraction, parseLength } from './scan'
import type { ComputedStyle } from './style'
import { paintColor } from './style'
import { parseTransform } from './transform'

export interface GradientStop {
  offset: number
  /** Stop color; `a` includes `stop-opacity`. */
  color: RGBA
}

export interface ResolvedGradient {
  kind: 'linear' | 'radial'
  element: Element
  units: 'objectBoundingBox' | 'userSpaceOnUse'
  transform: Matrix2D
  spread: 'pad' | 'reflect' | 'repeat'
  stops: GradientStop[]
  /** Attribute value from the first gradient of the `href` chain that sets it. */
  attr: (name: string) => string | null
}

const GRADIENT_TAGS = new Set(['linearGradient', 'radialGradient'])

export function isGradientElement(el: Element | null | undefined): boolean {
  return !!el && GRADIENT_TAGS.has(el.localName)
}

export function hrefOf(el: Element): string | null {
  return (
    el.getAttribute('href') ??
    el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ??
    el.getAttribute('xlink:href')
  )
}

/** Id referenced by a local `href="#id"`, or null. */
export function localRef(el: Element): string | null {
  const href = hrefOf(el)?.trim()
  return href && href.startsWith('#') && href.length > 1 ? href.slice(1) : null
}

/**
 * Resolves a gradient element with its `href` chain (cycle-safe). `stopStyle` computes the
 * style of a `<stop>` (stop-color / stop-opacity may come from CSS).
 */
export function resolveGradient(
  el: Element,
  lookup: (id: string) => Element | null,
  stopStyle: (stop: Element) => ComputedStyle,
): ResolvedGradient | null {
  if (!isGradientElement(el)) return null
  const chain: Element[] = []
  let cur: Element | null = el
  while (cur && isGradientElement(cur) && !chain.includes(cur) && chain.length < 32) {
    chain.push(cur)
    const ref = localRef(cur)
    cur = ref ? lookup(ref) : null
  }
  const attr = (name: string): string | null => {
    for (const g of chain) {
      const v = g.getAttribute(name)
      if (v !== null && v.trim() !== '') return v
    }
    return null
  }
  const stopsOwner = chain.find((g) => Array.from(g.children).some((c) => c.localName === 'stop'))
  const stops: GradientStop[] = []
  let prev = 0
  for (const stop of stopsOwner ? Array.from(stopsOwner.children) : []) {
    if (stop.localName !== 'stop') continue
    const style = stopStyle(stop)
    const raw = parseFraction(stop.getAttribute('offset')) ?? 0
    // Offsets are clamped to [0, 1] and can never decrease.
    const offset = Math.max(prev, Math.min(1, Math.max(0, raw)))
    prev = offset
    const c = paintColor(style.stopColor, style) ?? { r: 0, g: 0, b: 0, a: 1 }
    stops.push({ offset, color: { ...c, a: c.a * style.stopOpacity } })
  }
  const units = attr('gradientUnits') === 'userSpaceOnUse' ? 'userSpaceOnUse' : 'objectBoundingBox'
  const spreadAttr = attr('spreadMethod')
  const spread = spreadAttr === 'reflect' || spreadAttr === 'repeat' ? spreadAttr : 'pad'
  return {
    kind: el.localName === 'radialGradient' ? 'radial' : 'linear',
    element: el,
    units,
    transform: parseTransform(attr('gradientTransform')) ?? IDENTITY_MATRIX,
    spread,
    stops,
    attr,
  }
}

export type LottieGradientPaint =
  | {
      kind: 'gradient'
      /** 1 linear, 2 radial */
      t: 1 | 2
      s: [number, number]
      e: [number, number]
      /** Radial highlight length (percent) and angle (degrees). */
      h: number
      a: number
      /** Number of color stops (`g.p`). */
      count: number
      /** Flat Lottie gradient array: color stops, then opacity stops when any is translucent. */
      data: number[]
      /** The conversion is not exact (see `SvgWarningCode` `gradient`). */
      approximate: boolean
      /**
       * Set for elliptical radial gradients converted exactly (`ownSpace`): `s`/`e` are in a
       * space where the gradient is circular, and this maps that space to the output. Paths
       * painted by it must be expressed in that space (a group with this transform).
       */
      space?: Matrix2D
    }
  | { kind: 'solid'; color: RGBA }

export interface GradientOptions {
  /**
   * Radial gradients under a non-uniform map (elliptical) are returned exactly in their own
   * space (see `space`) instead of being approximated with a mean radius.
   */
  ownSpace?: boolean
}

/**
 * Converts a gradient to Lottie data for an element whose geometry has bounding box `bbox`
 * (user space) and whose user space maps to the output by `ctm`. Returns null when nothing
 * is painted (no stops, empty bounding box with objectBoundingBox units, degenerate map).
 */
export function gradientToLottie(
  g: ResolvedGradient,
  bbox: Box | null,
  ctm: Matrix2D,
  viewport: { w: number; h: number },
  opts: GradientOptions = {},
): LottieGradientPaint | null {
  if (g.stops.length === 0) return null
  const last = g.stops[g.stops.length - 1]
  if (g.stops.length === 1) return { kind: 'solid', color: last.color }
  const bboxUnits = g.units === 'objectBoundingBox'
  if (bboxUnits && (!bbox || !(bbox.w > 0) || !(bbox.h > 0))) return null
  const space =
    bboxUnits && bbox
      ? composeMatrices(
          ctm,
          translationMatrix(bbox.x, bbox.y),
          scalingMatrix(bbox.w, bbox.h),
          g.transform,
        )
      : composeMatrices(ctm, g.transform)
  const diag = Math.sqrt((viewport.w ** 2 + viewport.h ** 2) / 2)
  const coord = (name: string, fallback: number, base: number): number => {
    const v = g.attr(name)
    const n = v === null ? null : bboxUnits ? parseFraction(v) : parseLength(v, base)
    return n ?? fallback
  }
  let approximate = g.spread !== 'pad'
  const count = g.stops.length
  const data: number[] = []
  for (const s of g.stops) data.push(s.offset, s.color.r, s.color.g, s.color.b)
  if (g.stops.some((s) => s.color.a < 1 - 1e-6))
    for (const s of g.stops) data.push(s.offset, s.color.a)

  if (g.kind === 'linear') {
    const x1 = coord('x1', 0, viewport.w)
    const y1 = coord('y1', 0, viewport.h)
    const x2 = coord('x2', bboxUnits ? 1 : viewport.w, viewport.w)
    const y2 = coord('y2', 0, viewport.h)
    if (x1 === x2 && y1 === y2) return { kind: 'solid', color: last.color }
    const [sx, sy] = applyMatrix(space, x1, y1)
    const [px, py] = applyMatrix(space, x2, y2)
    // Isolines are perpendicular to (x2-x1, y2-y1) in gradient space; keep their mapped
    // direction and place the end point on the t = 1 isoline along their normal.
    const [dx, dy] = applyMatrixToVector(space, -(y2 - y1), x2 - x1)
    const gx = -dy
    const gy = dx
    const len2 = gx * gx + gy * gy
    if (!(len2 > 0)) return null
    const k = ((px - sx) * gx + (py - sy) * gy) / len2
    return {
      kind: 'gradient',
      t: 1,
      s: [sx, sy],
      e: [sx + gx * k, sy + gy * k],
      h: 0,
      a: 0,
      count,
      data,
      approximate,
    }
  }

  const cx = coord('cx', bboxUnits ? 0.5 : viewport.w / 2, viewport.w)
  const cy = coord('cy', bboxUnits ? 0.5 : viewport.h / 2, viewport.h)
  const r = coord('r', bboxUnits ? 0.5 : diag / 2, diag)
  const fx = coord('fx', cx, viewport.w)
  const fy = coord('fy', cy, viewport.h)
  const fr = coord('fr', 0, diag)
  if (!(r > 0)) return { kind: 'solid', color: last.color }
  if (fr > 0) approximate = true
  const [big, small] = matrixSingularValues(space)
  if (!(small > 0)) return null
  const k = Math.sqrt(big * small)
  let map = space
  let own: Matrix2D | undefined
  if (big / small > 1.001) {
    if (opts.ownSpace) {
      // Circular in "gradient space × k" (k keeps coordinates at output magnitudes for rounding).
      map = scalingMatrix(k)
      own = composeMatrices(space, scalingMatrix(1 / k))
    } else approximate = true
  }
  const radius = r * k
  const [s0, s1] = applyMatrix(map, cx, cy)
  const [ux, uy] = applyMatrixToVector(map, 1, 0)
  const ulen = Math.hypot(ux, uy)
  const dirX = ulen > 0 ? ux / ulen : 1
  const dirY = ulen > 0 ? uy / ulen : 0
  const [f0, f1] = applyMatrix(map, fx, fy)
  const fd = Math.hypot(f0 - s0, f1 - s1)
  let h = 0
  let a = 0
  if (fd > radius * 1e-6) {
    // SVG 1.1 moves a focal point outside the circle onto its edge; Lottie caps at 99 %.
    h = Math.min(99, (fd / radius) * 100)
    a = ((Math.atan2(f1 - s1, f0 - s0) - Math.atan2(dirY, dirX)) * 180) / Math.PI
    if (a > 180) a -= 360
    else if (a <= -180) a += 360
  }
  const result: LottieGradientPaint = {
    kind: 'gradient',
    t: 2,
    s: [s0, s1],
    e: [s0 + dirX * radius, s1 + dirY * radius],
    h,
    a,
    count,
    data,
    approximate,
  }
  if (own) result.space = own
  return result
}
