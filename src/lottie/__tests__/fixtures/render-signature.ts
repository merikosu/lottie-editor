/**
 * Render signature: what a Lottie document draws at a frame, flattened to root space the way
 * lottie-web renders it — every path, solid, image and text box through parents and precomps
 * (world transforms, precomp time mapping, opacity, clips), with the track mattes, masks, visual
 * effects and blend modes that apply to it. Two documents render the same when their
 * signatures match, drawable by drawable, in order. Used by the precompose/release tests.
 */
import {
  applyMatrix,
  groupTransform,
  intersectBoxes,
  multiplyMatrices,
  repeaterMatrices,
  shapeToBezier,
  transformBox,
  transformMatrix,
  worldMatrix,
  type Box,
  type Matrix2D,
} from '../../bounds'
import { matteSourceIndex } from '../../layer-ops'
import { compLayersPath, type NodePath } from '../../path'
import { evaluateArray, evaluatePath, evaluateScalar, evaluateTextDocument } from '../../property'
import { precompInnerFrame } from '../../time'
import { findAsset, findPrecomp } from '../../traverse'
import type {
  Animation,
  Effect,
  Layer,
  Mask,
  PrecompLayer,
  ShapeItem,
  ShapeLayer,
  SolidLayer,
  TextLayer,
} from '../../types'

/**
 * What one drawn item looks like at a frame, in root space. Two documents render the same
 * (for lottie-web) when their drawables match in order.
 */
export interface Drawable {
  /** Leaf layer name and item index path (not unique: instances repeat content). */
  key: string
  /** Vertices and bezier handles (paths) or corners (solids, images, text box), root space. */
  points: number[]
  /** Own opacity times the opacity of every enclosing precomp (parents pass none). */
  alpha: number
  /** Bounds of the points clipped by the root and every enclosing precomp frame. */
  visible: Box | null
  /** Style values (fills, strokes, trims, solid color, text document…). */
  paint: unknown
  /** Track mattes applying to this item: [mode, drawables of the source] per level. */
  mattes: unknown[]
  /** Active masks applying to this item, in root space, per level. */
  masks: unknown[]
  /** Visual effects (evaluated values) applying to this item, per level. */
  effects: unknown[]
  /** Blend modes along the way (non-normal only). */
  blends: number[]
}

interface RenderCtx {
  anim: Animation
  m: Matrix2D
  alpha: number
  clips: Box[]
  mattes: unknown[]
  masks: unknown[]
  effects: unknown[]
  blends: number[]
}

const pointsOf = (m: Matrix2D, path: { v: number[][]; i: number[][]; o: number[][] }) => {
  const out: number[] = []
  path.v.forEach((v, k) => {
    out.push(...applyMatrix(m, v[0], v[1]))
    out.push(...applyMatrix(m, v[0] + (path.i[k]?.[0] ?? 0), v[1] + (path.i[k]?.[1] ?? 0)))
    out.push(...applyMatrix(m, v[0] + (path.o[k]?.[0] ?? 0), v[1] + (path.o[k]?.[1] ?? 0)))
  })
  return out
}

const corners = (m: Matrix2D, w: number, h: number) => [
  ...applyMatrix(m, 0, 0),
  ...applyMatrix(m, w, 0),
  ...applyMatrix(m, w, h),
  ...applyMatrix(m, 0, h),
]

function boundsOfPoints(points: number[]): Box | null {
  if (points.length < 2) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let k = 0; k < points.length; k += 2) {
    x0 = Math.min(x0, points[k])
    x1 = Math.max(x1, points[k])
    y0 = Math.min(y0, points[k + 1])
    y1 = Math.max(y1, points[k + 1])
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

function visibleBox(points: number[], clips: Box[]): Box | null {
  let result = boundsOfPoints(points)
  for (const clip of clips) result = result ? intersectBoxes(result, clip) : null
  return result
}

const isVisualEffect = (e: Effect) =>
  e.en !== 0 && !(e.ty === 5 && /^(ADBE .* Control|Pseudo\/.*)$/.test(e.mn ?? ''))

/** Shape paths (with the group transforms above them) and the style values of a shape layer. */
function shapeDrawables(
  items: ShapeItem[],
  t: number,
  m: Matrix2D,
  prefix: string,
  out: Array<{ key: string; points: number[] }>,
  paint: unknown[],
): void {
  items.forEach((item, k) => {
    if (!item || item.hd === true) return
    const key = `${prefix}${k}`
    switch (item.ty) {
      case 'gr': {
        const gm = multiplyMatrices(m, transformMatrix(groupTransform(item), t))
        shapeDrawables(item.it ?? [], t, gm, `${key}.`, out, paint)
        break
      }
      case 'sh':
      case 'rc':
      case 'el':
      case 'sr': {
        const path = shapeToBezier(item, t)
        if (path) out.push({ key, points: pointsOf(m, path) })
        break
      }
      case 'fl':
      case 'st':
        paint.push([
          key,
          item.ty,
          evaluateArray(item.c, t),
          evaluateScalar(item.o, t, 100),
          item.ty === 'st' ? evaluateScalar(item.w, t) : 0,
        ])
        break
      case 'gf':
      case 'gs':
        paint.push([key, item.ty, evaluateArray(item.g.k, t), evaluateScalar(item.o, t, 100)])
        break
      case 'tm':
        paint.push([key, 'tm', evaluateScalar(item.s, t), evaluateScalar(item.e, t)])
        break
      case 'rp':
        paint.push([key, 'rp', repeaterMatrices(item, t).length])
        break
      default:
        break
    }
  })
}

function drawLayer(
  layers: Layer[],
  compPath: NodePath,
  i: number,
  t: number,
  ctx: RenderCtx,
  out: Drawable[],
  asMatte = false,
): void {
  const { anim } = ctx
  const layer = layers[i]
  const wm = multiplyMatrices(ctx.m, worldMatrix(anim, [...compPath, i], t))
  const alpha = (ctx.alpha * evaluateScalar(layer.ks?.o, t, 100)) / 100
  let mattes = ctx.mattes
  if (layer.tt && !asMatte) {
    const si = matteSourceIndex(layers, i)
    let source: unknown = 'none'
    if (si >= 0) {
      const src = layers[si]
      if (t >= src.ip && t < src.op) {
        const sub: Drawable[] = []
        drawLayer(
          layers,
          compPath,
          si,
          t,
          { ...ctx, mattes: [], masks: [], effects: [], blends: [] },
          sub,
          true,
        )
        source = sub.map((d) => [d.key, d.points, d.alpha, d.paint])
      } else source = 'inactive'
    }
    mattes = [...mattes, [layer.tt, source]]
  }
  const activeMasks = (layer.masksProperties ?? []).filter((mk: Mask) => mk && mk.mode !== 'n')
  const masks = activeMasks.length
    ? [
        ...ctx.masks,
        activeMasks.map((mk) => {
          const path = evaluatePath(mk.pt, t)
          return [
            mk.mode ?? 'a',
            !!mk.inv,
            evaluateScalar(mk.o, t, 100),
            path ? pointsOf(wm, path) : [],
          ]
        }),
      ]
    : ctx.masks
  const visual = (layer.ef ?? []).filter(isVisualEffect)
  const effects = visual.length
    ? [
        ...ctx.effects,
        visual.map((e) => [e.ty, (e.ef ?? []).map((v) => evaluateArray(v.v ?? null, t))]),
      ]
    : ctx.effects
  const blends = layer.bm ? [...ctx.blends, layer.bm] : ctx.blends
  const push = (key: string, points: number[], paint: unknown) =>
    out.push({
      key,
      points,
      alpha,
      visible: visibleBox(points, ctx.clips),
      paint,
      mattes,
      masks,
      effects,
      blends,
    })
  const name = layer.nm ?? `#${i}`

  switch (layer.ty) {
    case 0: {
      const found = findPrecomp(anim, (layer as PrecompLayer).refId)
      if (!found) return
      const pl = layer as PrecompLayer
      const clip =
        (pl.w ?? 0) > 0 && (pl.h ?? 0) > 0
          ? transformBox({ x: 0, y: 0, w: pl.w!, h: pl.h! }, wm)
          : null
      drawLayers(
        found.asset.layers,
        compLayersPath(found.index),
        precompInnerFrame(pl, t, anim.fr),
        {
          ...ctx,
          m: wm,
          alpha,
          clips: clip ? [...ctx.clips, clip] : ctx.clips,
          mattes,
          masks,
          effects,
          blends,
        },
        out,
      )
      return
    }
    case 4: {
      const items: Array<{ key: string; points: number[] }> = []
      const paint: unknown[] = []
      shapeDrawables((layer as ShapeLayer).shapes ?? [], t, wm, '', items, paint)
      for (const item of items) push(`${name}/${item.key}`, item.points, paint)
      return
    }
    case 1: {
      const fill = layer as SolidLayer
      push(name, corners(wm, fill.sw, fill.sh), fill.sc)
      return
    }
    case 2: {
      const asset = findAsset(anim, (layer as { refId: string }).refId)?.asset as
        { w?: number; h?: number; id: string } | undefined
      push(name, corners(wm, asset?.w ?? 0, asset?.h ?? 0), asset?.id)
      return
    }
    case 5:
      push(name, corners(wm, 1, 1), evaluateTextDocument((layer as TextLayer).t, t))
      return
    default:
      return
  }
}

function drawLayers(
  layers: Layer[],
  compPath: NodePath,
  t: number,
  ctx: RenderCtx,
  out: Drawable[],
): void {
  layers.forEach((layer, i) => {
    if (!layer || layer.hd === true || layer.td) return
    if (!(t >= layer.ip && t < layer.op)) return
    drawLayer(layers, compPath, i, t, ctx, out)
  })
}

/** Everything the root composition draws at `frame`. */
export function renderSignature(anim: Animation, frame: number): Drawable[] {
  const out: Drawable[] = []
  drawLayers(
    anim.layers,
    ['layers'],
    frame,
    {
      anim,
      m: [1, 0, 0, 1, 0, 0],
      alpha: 1,
      clips: [{ x: 0, y: 0, w: anim.w, h: anim.h }],
      mattes: [],
      masks: [],
      effects: [],
      blends: [],
    },
    out,
  )
  return out
}

/** First difference between two JSON-like values (numbers within a relative tolerance). */
export function diffDeep(a: unknown, b: unknown, tol: number, at = ''): string | null {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a)) ? null : `${at}: ${a} ≠ ${b}`
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${at}: length ${a.length} ≠ ${b.length}`
    for (let k = 0; k < a.length; k++) {
      const d = diffDeep(a[k], b[k], tol, `${at}[${k}]`)
      if (d) return d
    }
    return null
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const fields = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of fields) {
      const d = diffDeep(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        tol,
        `${at}.${key}`,
      )
      if (d) return d
    }
    return null
  }
  return a === b ? null : `${at}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`
}

export interface RenderDiffOptions {
  tol?: number
  /** Compare clipped bounds (off when a release reveals clipped content on purpose). */
  visible?: boolean
}

/** First frame where `a` and `b` draw differently, with the difference, or null. */
export function renderDiff(
  a: Animation,
  b: Animation,
  frames: number[],
  { tol = 1e-6, visible = true }: RenderDiffOptions = {},
): string | null {
  for (const f of frames) {
    const x = renderSignature(a, f)
    const y = renderSignature(b, f)
    if (x.length !== y.length) return `frame ${f}: ${x.length} drawables ≠ ${y.length}`
    for (let k = 0; k < x.length; k++) {
      const p = visible ? x[k] : { ...x[k], visible: null }
      const q = visible ? y[k] : { ...y[k], visible: null }
      const d = diffDeep(p, q, tol, `#${k} ${x[k].key}`)
      if (d) return `frame ${f}: ${d}`
    }
  }
  return null
}

/** Whole frames of the root range plus half frames (lottie-web renders sub-frames). */
export function framesOf(anim: Animation, step = 1): number[] {
  const out: number[] = []
  for (let f = anim.ip; f < anim.op; f += step) out.push(f, f + 0.5)
  return out
}
