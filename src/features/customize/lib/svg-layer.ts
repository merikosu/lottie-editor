/**
 * "Import SVG as layer": an imported SVG becomes a new shape layer, centered in the composition
 * and fitted to a fraction of it. The placement lives in the layer transform (anchor at the
 * drawing's center, scale to fit), so the imported geometry stays untouched and the layer is
 * ready to animate.
 */
import type { Box } from '@/lottie/bounds'
import type { ShapeItem, ShapeLayer } from '@/lottie/types'

export interface SvgLayerOptions {
  name: string
  ind: number
  ip: number
  op: number
  /** Size of the composition the layer goes into. */
  comp: { w: number; h: number }
  /** Part of the composition the drawing is fitted into (default 0.5). */
  fraction?: number
}

const stat = <T>(k: T): { a: 0; k: T } => ({ a: 0, k })
const round3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) || !Number.isFinite(r) ? 0 : r
}

/** Uniform scale that fits `box` into `fraction` of the composition (1 when it cannot be measured). */
export function fitScale(box: Box, comp: { w: number; h: number }, fraction = 0.5): number {
  const kx = box.w > 1e-9 ? (comp.w * fraction) / box.w : null
  const ky = box.h > 1e-9 ? (comp.h * fraction) / box.h : null
  const k = kx !== null && ky !== null ? Math.min(kx, ky) : (kx ?? ky ?? 1)
  return Number.isFinite(k) && k > 0 ? k : 1
}

/** A shape layer drawing `shapes` (measured by `bounds`), centered and fitted (see module comment). */
export function svgShapeLayer(
  shapes: readonly ShapeItem[],
  bounds: Box,
  opts: SvgLayerOptions,
): ShapeLayer {
  const k = fitScale(bounds, opts.comp, opts.fraction ?? 0.5) * 100
  return {
    ddd: 0,
    ind: opts.ind,
    ty: 4,
    nm: opts.name,
    sr: 1,
    ks: {
      o: stat(100),
      r: stat(0),
      p: stat([round3(opts.comp.w / 2), round3(opts.comp.h / 2), 0]),
      a: stat([round3(bounds.x + bounds.w / 2), round3(bounds.y + bounds.h / 2), 0]),
      s: stat([round3(k), round3(k), 100]),
    },
    ao: 0,
    shapes: JSON.parse(JSON.stringify(shapes)) as ShapeItem[],
    ip: opts.ip,
    op: opts.op,
    st: 0,
    bm: 0,
  }
}
