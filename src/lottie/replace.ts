/**
 * Remix: replace an element of an animation — a logo group, a shape layer, a precomp, an
 * image, a text or a solid layer — with vector shapes (e.g. an imported SVG) or an image,
 * keeping the element's animation. Everything mutates `anim` in place: call these functions
 * inside an `updateDoc` recipe (they also work on plain objects).
 *
 * Fitting: the new content is wrapped in one group whose transform maps the content box into
 * the old element's box (contain / cover / stretch, padding, extra scale and offset). The
 * imported geometry itself is never modified, so the UI can refit by editing that transform.
 *
 * Coordinates: a target's "own space" is the space its content is drawn in — a group's content
 * space (before the group's `tr`), a layer's space (before its `ks`). Frames are in the time of
 * the composition that contains the target layer.
 */
import type { RGBA } from '@/lib/color'
import {
  applyMatrix,
  applyMatrixToVector,
  BoundsAccumulator,
  composeMatrices,
  decomposeMatrix,
  groupTransform,
  IDENTITY_MATRIX,
  invertMatrix,
  isStaticTransform,
  layerContentBounds,
  matrixScale,
  multiplyMatrices,
  precompContentBounds,
  scalingMatrix,
  shapeContentMatrix,
  shapeItemsBounds,
  shapeToBezier,
  transformMatrix,
  translationMatrix,
  worldMatrix,
  type Box,
  type Matrix2D,
} from './bounds'
import { nextLayerInd } from './layers'
import {
  compAssetIndexOf,
  compPathOf,
  getAt,
  isLayerPath,
  isShapePath,
  layerPathOf,
  type NodePath,
} from './path'
import {
  evaluateScalar,
  evaluateTextDocument,
  evaluateVector,
  getKeyframes,
  isAnimated,
} from './property'
import { precompInnerFrame, precompOuterFrame } from './time'
import { findAsset, findPrecomp, forEachLayer, forEachProperty } from './traverse'
import type {
  Animation,
  BezierPath,
  FillShape,
  GradientFillShape,
  GradientStrokeShape,
  GroupShape,
  ImageAsset,
  Layer,
  Mask,
  PrecompAsset,
  PrecompLayer,
  ScalarProperty,
  ShapeItem,
  ShapeLayer,
  StrokeShape,
  TextData,
  Transform,
  TransformShape,
  VectorProperty,
} from './types'
import { isImageAsset, LayerType } from './types'
import { colorChannel, geometryDecimals } from './svg/build'

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

/** What a target path addresses. */
export type ReplaceTargetKind =
  'group' | 'shape-layer' | 'precomp-layer' | 'image-layer' | 'text-layer' | 'solid-layer'

export type FitMode = 'contain' | 'cover' | 'stretch'

/** Monochrome restyling. `undefined` keeps, `null` removes, a color replaces. */
export interface StyleOverride {
  fill?: RGBA | null
  stroke?: RGBA | null
  /** Stroke width in the target's own space units (strokes are added to filled shapes when `stroke` is a color). */
  strokeWidth?: number
  /**
   * When `stroke` is a color, also outline filled shapes that have no stroke (default true).
   * False only recolors the existing strokes, e.g. to paint a logo in one color.
   */
  outline?: boolean
}

/**
 * - `keep`: the new content's own colors
 * - `original`: the replaced content's dominant fill and stroke (color, opacity, gradient,
 *   width) applied to every new shape — e.g. a white logo with a blue outline stays so
 * - a `StyleOverride`: explicit colors
 */
export type ReplaceStyle = 'keep' | 'original' | StyleOverride

export interface FitAdjust {
  /** Multiplier on top of the fit (1 = as fitted). */
  scale?: number
  /** Offset in the target's own space units. */
  dx?: number
  dy?: number
}

export interface ReplaceOptions {
  /** Default `contain`. */
  fit?: FitMode
  /** Inset of the target box on each side, as a fraction of its size (0 … 0.45). Default 0. */
  padding?: number
  adjust?: FitAdjust
  /**
   * Frame at which the old element is measured (time of the composition containing the
   * target). Default: `representativeFrame` — the resting state (the bounds held longest).
   */
  frame?: number
  /** Default `keep`. */
  style?: ReplaceStyle
  /** Precomp targets: clone a precomp that other layers use too, so only this one changes. Default true. */
  detach?: boolean
  /** Name of the new group / layer. */
  name?: string
}

export type ReplaceWarning =
  /** The old element drew nothing measurable: the content is placed in a default box. */
  | 'empty-target'
  /** Styles or modifiers of enclosing groups also apply to the new content. */
  | 'inherited-styles'
  /** The replaced precomp content was animated; its inner animation is gone (the layer's own is kept). */
  | 'inner-animation-dropped'
  /** Text layer bounds are estimated (glyph metrics are unknown). */
  | 'approximate-bounds'
  /** The group's transform is animated: the image follows its state at the reference frame. */
  | 'group-transform-animated'
  /** A parent layer's opacity does not reach a parented layer: the image ignores it. */
  | 'parent-opacity-ignored'
  /** Masks / track mattes of the group's layer do not apply to the new image layer. */
  | 'layer-effects-not-applied'
  /** `style: 'original'` found no fill or stroke to copy; the content keeps its colors. */
  | 'no-original-style'
  /** `detach: false` on a precomp used elsewhere: every instance changes. */
  | 'shared-precomp'

export interface FitInfo {
  /** Reference frame used to measure the old element. */
  frame: number
  /** Old element bounds (own space) the content was fitted into. */
  targetBox: Box
  /** Content box that was fitted (content space). */
  contentBox: Box
  /** Wrapper transform values: content center, target center (+ offset), scale in percent. */
  anchor: [number, number]
  position: [number, number]
  scale: [number, number]
}

export interface ReplaceResult {
  /** New or changed nodes (the target first), e.g. for selection. */
  paths: NodePath[]
  warnings: ReplaceWarning[]
  fit: FitInfo
}

export interface ReplaceContent {
  shapes: ShapeItem[]
  /**
   * Box of the content to fit (content space), e.g. `SvgImportResult.bounds` for a tight fit or
   * `{ x: 0, y: 0, w: width, h: height }` to keep the artboard's margins. Default: the visual
   * bounds of `shapes` after restyling.
   */
  box?: Box
}

export interface ReplaceImage {
  /** Embedded image (`data:image/png;base64,…`). */
  dataUri: string
  w: number
  h: number
  name?: string
}

export type ReplaceErrorCode = 'invalid-target' | 'invalid-content' | 'missing-asset'

export class ReplaceError extends Error {
  readonly code: ReplaceErrorCode
  constructor(code: ReplaceErrorCode, message: string) {
    super(message)
    this.name = 'ReplaceError'
    this.code = code
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

const stat = <T>(k: T): { a: 0; k: T } => ({ a: 0, k })

/** Deep copy through JSON: works on immer drafts and guarantees no aliasing. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function round3(v: number): number {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) || !Number.isFinite(r) ? 0 : r
}

const PAINT_TYPES = new Set(['fl', 'st', 'gf', 'gs'])
const MODIFIER_TYPES = new Set(['tm', 'rp', 'rd', 'mm', 'op', 'pb', 'tw', 'zz'])
const GEOMETRY_TYPES = new Set(['sh', 'rc', 'el', 'sr'])

type PaintItem = FillShape | StrokeShape | GradientFillShape | GradientStrokeShape

const isPaint = (item: ShapeItem): item is PaintItem => PAINT_TYPES.has(item.ty)
const isFillPaint = (item: PaintItem): item is FillShape | GradientFillShape =>
  item.ty === 'fl' || item.ty === 'gf'

function identityTransform(): TransformShape {
  return {
    ty: 'tr',
    p: stat([0, 0]),
    a: stat([0, 0]),
    s: stat([100, 100]),
    r: stat(0),
    o: stat(100),
    sk: stat(0),
    sa: stat(0),
    nm: 'Transform',
  }
}

/** First free `image_N` id (the bodymovin naming). */
function nextImageId(anim: Animation): string {
  const taken = new Set((anim.assets ?? []).map((a) => a.id))
  for (let n = 0; ; n++) if (!taken.has(`image_${n}`)) return `image_${n}`
}

/** Unique asset id: `base`, else `base_2`, `base_3`… */
function uniqueAssetId(anim: Animation, base: string): string {
  const taken = new Set((anim.assets ?? []).map((a) => a.id))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`
}

function layersOf(anim: Animation, layerPath: NodePath): Layer[] {
  const layers = getAt<Layer[]>(anim, compPathOf(layerPath))
  return Array.isArray(layers) ? layers : []
}

/* -------------------------------------------------------------------------- */
/*                                   Targets                                  */
/* -------------------------------------------------------------------------- */

/** Kind of element a path addresses, or null when it cannot be replaced. */
export function replaceTargetKind(anim: Animation, path: NodePath): ReplaceTargetKind | null {
  if (isShapePath(path)) {
    const item = getAt<ShapeItem>(anim, path)
    return item && item.ty === 'gr' && Array.isArray(item.it) && layerPathOf(path) ? 'group' : null
  }
  if (!isLayerPath(path)) return null
  const layer = getAt<Layer>(anim, path)
  if (!layer || typeof layer !== 'object') return null
  // A damaged transform (not an object) cannot carry the new content's placement.
  const ks: unknown = layer.ks
  if (ks !== undefined && (typeof ks !== 'object' || ks === null || Array.isArray(ks))) return null
  switch (layer.ty) {
    case LayerType.Shape:
      return 'shape-layer'
    case LayerType.Precomp:
      return findPrecomp(anim, layer.refId) ? 'precomp-layer' : null
    case LayerType.Image:
      return 'image-layer'
    case LayerType.Text:
      return 'text-layer'
    case LayerType.Solid:
      return 'solid-layer'
    default:
      return null
  }
}

function requireKind(anim: Animation, path: NodePath): ReplaceTargetKind {
  const kind = replaceTargetKind(anim, path)
  if (!kind) throw new ReplaceError('invalid-target', `Nothing replaceable at ${path.join('/')}.`)
  return kind
}

/**
 * Bounds of what the target draws at `frame`, in its own space (strokes included). Precomps:
 * their visible content clipped to `w × h`, before the layer's masks; images: the asset box.
 */
export function targetBounds(anim: Animation, path: NodePath, frame: number): Box | null {
  const kind = replaceTargetKind(anim, path)
  if (!kind) return null
  switch (kind) {
    case 'group':
      return shapeItemsBounds(getAt<GroupShape>(anim, path)?.it, frame, { includeStroke: true })
    case 'shape-layer':
      return shapeItemsBounds(getAt<ShapeLayer>(anim, path)?.shapes, frame, { includeStroke: true })
    case 'precomp-layer':
      return precompContentBounds(anim, getAt<PrecompLayer>(anim, path) as PrecompLayer, frame, {
        includeStroke: true,
        emptyPrecomp: 'null',
      })
    case 'image-layer': {
      const layer = getAt<Layer>(anim, path) as { refId?: string }
      const asset = findAsset(anim, layer.refId)?.asset
      const w = asset && isImageAsset(asset) ? (asset.w ?? 0) : 0
      const h = asset && isImageAsset(asset) ? (asset.h ?? 0) : 0
      return w > 0 && h > 0 ? { x: 0, y: 0, w, h } : null
    }
    case 'solid-layer': {
      const layer = getAt<Layer>(anim, path) as { sw?: number; sh?: number }
      return (layer.sw ?? 0) > 0 && (layer.sh ?? 0) > 0
        ? { x: 0, y: 0, w: layer.sw as number, h: layer.sh as number }
        : null
    }
    case 'text-layer':
      return layerContentBounds(anim, path, frame)
  }
}

/* -------------------------------------------------------------------------- */
/*                               Reference frame                              */
/* -------------------------------------------------------------------------- */

/** First precomp layer (anywhere) that shows the composition `compId`. */
function firstInstance(anim: Animation, compId: string): NodePath | null {
  let found: NodePath | null = null
  forEachLayer(anim, (layer, path) => {
    if (layer.ty === LayerType.Precomp && (layer as PrecompLayer).refId === compId) {
      found = path
      return false
    }
  })
  return found
}

/** Frames of a composition (its own time) during which it is shown, via its first instance. */
function compVisibleRange(
  anim: Animation,
  assetIndex: number | null,
  depth = 0,
): [number, number] | null {
  if (assetIndex === null) return [anim.ip, anim.op]
  const asset = anim.assets?.[assetIndex]
  if (!asset || depth > 16) return null
  const instance = firstInstance(anim, asset.id)
  if (!instance) return null
  const layer = getAt<PrecompLayer>(anim, instance) as PrecompLayer
  const outer = compVisibleRange(anim, compAssetIndexOf(instance), depth + 1)
  const start = Math.max(layer.ip, outer ? outer[0] : layer.ip)
  const end = Math.min(layer.op, outer ? outer[1] : layer.op)
  if (!(end > start)) return null
  if (layer.tm) {
    let min = Infinity
    let max = -Infinity
    const n = Math.min(240, Math.max(2, Math.ceil(end - start)))
    for (let k = 0; k <= n; k++) {
      const f = precompInnerFrame(layer, start + ((end - start) * k) / n, anim.fr)
      min = Math.min(min, f)
      max = Math.max(max, f)
    }
    return [min, max + 1]
  }
  const a = precompInnerFrame(layer, start, anim.fr)
  const b = precompInnerFrame(layer, end, anim.fr)
  return [Math.min(a, b), Math.max(a, b)]
}

/** Frames (containing comp time) during which the target's layer can be visible. */
function frameRange(anim: Animation, path: NodePath): [number, number] {
  const layerPath = layerPathOf(path) as NodePath
  const layer = getAt<Layer>(anim, layerPath) as Layer
  const comp = compVisibleRange(anim, compAssetIndexOf(layerPath))
  const start = Math.max(layer.ip, comp ? comp[0] : layer.ip)
  const end = Math.min(layer.op, comp ? comp[1] : layer.op)
  return end > start ? [start, end] : [layer.ip, Math.max(layer.op, layer.ip + 1)]
}

function sampleFrames(start: number, end: number, max: number): number[] {
  const first = Math.ceil(start)
  const last = Math.ceil(end) - 1
  if (last < first) return [start]
  const step = Math.max(1, Math.ceil((last - first + 1) / Math.max(1, max)))
  const out: number[] = []
  for (let f = first; f <= last; f += step) out.push(f)
  return out
}

const area = (b: Box) => b.w * b.h

/**
 * The frame that shows the target in its resting state: bounds are sampled over the frames
 * where its layer is visible and the bounds held for the most samples win (earliest frame of
 * that state). Continuously changing content falls back to the median-sized sample. This avoids
 * measuring a logo mid-way through a scale-in or an outro.
 */
export function representativeFrame(
  anim: Animation,
  path: NodePath,
  maxSamples = 96,
): { frame: number; bounds: Box | null } {
  const kind = replaceTargetKind(anim, path)
  if (!kind) return { frame: 0, bounds: null }
  const layerPath = layerPathOf(path) as NodePath
  const layer = getAt<Layer>(anim, layerPath)
  const [start, end] = frameRange(anim, path)
  // Frames are compared by how the element APPEARS (its box carried to the root composition),
  // so a logo that scales/fades in rests at its full size, not at frame 0 where it is invisible
  // (a precomp's own content box never changes).
  const samples: { frame: number; box: Box; screen: Box }[] = []
  for (const frame of sampleFrames(start, end, maxSamples)) {
    const box = targetBounds(anim, path, frame)
    if (!box || box.w + box.h <= 0) continue
    if (layer && evaluateScalar(layer.ks?.o, frame, 100) <= 0.5) continue
    const inner = kind === 'group' ? shapeContentMatrix(anim, path, frame) : IDENTITY_MATRIX
    const root = toRoot(anim, layerPath, frame)
    const screen = root ? transformedBox(box, multiplyMatrices(root.matrix, inner)) : box
    if (screen.w + screen.h <= 1e-3) continue
    samples.push({ frame, box, screen })
  }
  if (samples.length === 0) {
    // Nothing visible anywhere: fall back to the content box at the start.
    const box = targetBounds(anim, path, Math.ceil(start))
    return { frame: Math.ceil(start), bounds: box && box.w + box.h > 0 ? box : null }
  }
  const clusters: { screen: Box; members: typeof samples }[] = []
  for (const s of samples) {
    const tol = Math.max(s.screen.w, s.screen.h) * 0.005 + 1e-9
    const near = clusters.find(
      (c) =>
        Math.abs(c.screen.x - s.screen.x) <= tol &&
        Math.abs(c.screen.y - s.screen.y) <= tol &&
        Math.abs(c.screen.w - s.screen.w) <= tol &&
        Math.abs(c.screen.h - s.screen.h) <= tol,
    )
    if (near) near.members.push(s)
    else clusters.push({ screen: s.screen, members: [s] })
  }
  let best = clusters[0]
  for (const c of clusters) if (c.members.length > best.members.length) best = c
  if (best.members.length === 1 && samples.length > 2) {
    // Always moving: take the median-sized appearance.
    const sorted = [...samples].sort((a, b) => area(a.screen) - area(b.screen))
    const median = sorted[Math.floor(sorted.length / 2)]
    return { frame: median.frame, bounds: median.box }
  }
  return { frame: best.members[0].frame, bounds: best.members[0].box }
}

/* -------------------------------------------------------------------------- */
/*                                    Fitting                                 */
/* -------------------------------------------------------------------------- */

function computeFit(frame: number, target: Box, content: Box, opts: ReplaceOptions): FitInfo {
  const pad = Math.min(0.45, Math.max(0, opts.padding ?? 0))
  const tw = target.w * (1 - 2 * pad)
  const th = target.h * (1 - 2 * pad)
  const eps = 1e-9
  let sx = 1
  let sy = 1
  const kx = content.w > eps && tw > eps ? tw / content.w : null
  const ky = content.h > eps && th > eps ? th / content.h : null
  if (kx !== null && ky !== null) {
    if (opts.fit === 'stretch') {
      sx = kx
      sy = ky
    } else {
      sx = sy = opts.fit === 'cover' ? Math.max(kx, ky) : Math.min(kx, ky)
    }
  } else if (kx !== null || ky !== null) {
    // A flat content or target (a line): scale by the dimension that exists.
    sx = sy = (kx ?? ky) as number
  }
  const extra = opts.adjust?.scale ?? 1
  const k = Number.isFinite(extra) && extra !== 0 ? extra : 1
  // Precision relative to each box, so content drawn in tiny units is not distorted by the
  // large scale applied to it.
  const ra = roundTo(geometryDecimals(Math.max(content.w, content.h)))
  const rp = roundTo(geometryDecimals(Math.max(target.w, target.h)))
  const rs = roundTo(geometryDecimals(Math.min(sx, sy) * k * 100))
  return {
    frame,
    targetBox: target,
    contentBox: content,
    anchor: [ra(content.x + content.w / 2), ra(content.y + content.h / 2)],
    position: [
      rp(target.x + target.w / 2 + (opts.adjust?.dx ?? 0)),
      rp(target.y + target.h / 2 + (opts.adjust?.dy ?? 0)),
    ],
    scale: [rs(sx * k * 100), rs(sy * k * 100)],
  }
}

function roundTo(digits: number): (v: number) => number {
  const f = 10 ** digits
  return (v) => {
    const r = Math.round(v * f) / f
    return Object.is(r, -0) || !Number.isFinite(r) ? 0 : r
  }
}

/** Content space → target space. */
function fitMatrix(fit: FitInfo): Matrix2D {
  return composeMatrices(
    translationMatrix(fit.position[0], fit.position[1]),
    scalingMatrix(fit.scale[0] / 100, fit.scale[1] / 100),
    translationMatrix(-fit.anchor[0], -fit.anchor[1]),
  )
}

function wrapperGroup(name: string, items: ShapeItem[], fit: FitInfo): GroupShape {
  const tr: TransformShape = {
    ty: 'tr',
    p: stat([...fit.position]),
    a: stat([...fit.anchor]),
    s: stat([...fit.scale]),
    r: stat(0),
    o: stat(100),
    sk: stat(0),
    sa: stat(0),
    nm: 'Transform',
  }
  return { ty: 'gr', nm: name, it: [...items, tr] }
}

/* -------------------------------------------------------------------------- */
/*                          Property value transforms                         */
/* -------------------------------------------------------------------------- */

/** Multiplies a scalar property (static or keyframed) by `k`. */
function scaleScalar(prop: ScalarProperty | undefined, k: number): void {
  if (!prop) return
  const kfs = getKeyframes<number[]>(prop)
  if (!kfs) {
    if (typeof prop.k === 'number') prop.k = round3(prop.k * k)
    else if (Array.isArray(prop.k))
      prop.k = (prop.k as unknown as number[]).map((v) => round3(v * k)) as unknown as number
    return
  }
  for (const kf of kfs) {
    if (Array.isArray(kf.s)) kf.s = kf.s.map((v) => round3(v * k))
    if (Array.isArray(kf.e)) kf.e = kf.e.map((v) => round3(v * k))
  }
}

/** Maps a 2D point property (gradient start / end) through `m`, including keyframes and tangents. */
function mapPointProperty(prop: VectorProperty | undefined, m: Matrix2D): void {
  if (!prop) return
  const map = (v: number[] | undefined) => {
    if (!Array.isArray(v) || v.length < 2) return v
    const [x, y] = applyMatrix(m, v[0], v[1])
    return [round3(x), round3(y), ...v.slice(2)]
  }
  const kfs = getKeyframes<number[]>(prop)
  if (!kfs) {
    prop.k = map(prop.k as number[]) as number[]
    return
  }
  for (const kf of kfs) {
    kf.s = map(kf.s)
    if (kf.e) kf.e = map(kf.e)
    for (const key of ['to', 'ti'] as const) {
      const t = kf[key]
      if (Array.isArray(t) && t.length >= 2) {
        const [x, y] = applyMatrixToVector(m, t[0], t[1])
        kf[key] = [round3(x), round3(y), ...t.slice(2)]
      }
    }
  }
}

/** A list of points (or no list at all: tangents may be missing). */
const isPointsOrNothing = (list: unknown) =>
  list === undefined || (Array.isArray(list) && list.every((pt) => Array.isArray(pt)))

/** A bezier path value with point lists (damaged paths are passed through unchanged). */
function isBezierValue(p: unknown): p is BezierPath {
  return (
    typeof p === 'object' &&
    p !== null &&
    Array.isArray((p as BezierPath).v) &&
    isPointsOrNothing((p as BezierPath).v) &&
    isPointsOrNothing((p as BezierPath).i) &&
    isPointsOrNothing((p as BezierPath).o)
  )
}

function mapBezier(p: BezierPath, m: Matrix2D): BezierPath {
  if (!isBezierValue(p)) return p
  const v = p.v.map(([x, y]) => applyMatrix(m, x, y).map(round3))
  const vec = (list: number[][]) =>
    list.map(([x, y]) => applyMatrixToVector(m, x ?? 0, y ?? 0).map(round3))
  return { c: p.c, v, i: vec(p.i ?? []), o: vec(p.o ?? []) }
}

/** Re-expresses masks drawn in one layer space in another (`m`: old space → new space). */
function mapMasks(masks: Mask[] | undefined, m: Matrix2D): void {
  if (!Array.isArray(masks)) return
  const k = matrixScale(m)
  for (const mask of masks) {
    const pt = mask.pt
    if (!pt) continue
    const kfs = getKeyframes<BezierPath[]>(pt)
    if (!kfs) pt.k = mapBezier(pt.k as BezierPath, m)
    else {
      for (const kf of kfs) {
        if (Array.isArray(kf.s)) kf.s = kf.s.map((p) => mapBezier(p, m))
        if (Array.isArray(kf.e)) kf.e = kf.e.map((p) => mapBezier(p, m))
      }
    }
    scaleScalar(mask.x, k)
  }
}

/* -------------------------------------------------------------------------- */
/*                            Style analysis ('original')                     */
/* -------------------------------------------------------------------------- */

export interface PaintSample {
  item: PaintItem
  /** Space of the style item → target own space. */
  matrix: Matrix2D
  /** Area painted (fills) or length stroked (strokes), in target space. */
  weight: number
}

export interface OriginalStyle {
  fill: PaintSample | null
  stroke: PaintSample | null
  /**
   * The element's second color: its second fill color, else its stroke color when that differs
   * from the fill. New content drawn in several colors keeps its details in it.
   */
  accent: PaintSample | null
}

/** Polyline approximation of a path (for areas and lengths). */
function flatten(p: BezierPath, steps = 8): number[][] {
  const pts: number[][] = []
  const n = p.v.length
  const segs = p.c ? n : n - 1
  if (n === 0) return pts
  pts.push(p.v[0])
  for (let k = 0; k < segs; k++) {
    const a = p.v[k]
    const b = p.v[(k + 1) % n]
    const c1 = [a[0] + (p.o[k]?.[0] ?? 0), a[1] + (p.o[k]?.[1] ?? 0)]
    const c2 = [b[0] + (p.i[(k + 1) % n]?.[0] ?? 0), b[1] + (p.i[(k + 1) % n]?.[1] ?? 0)]
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      const mt = 1 - t
      pts.push([
        mt * mt * mt * a[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * b[0],
        mt * mt * mt * a[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * b[1],
      ])
    }
  }
  return pts
}

function polygonArea(pts: number[][]): number {
  let sum = 0
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k]
    const b = pts[(k + 1) % pts.length]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(sum) / 2
}

function polylineLength(pts: number[][]): number {
  let sum = 0
  for (let k = 1; k < pts.length; k++)
    sum += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
  return sum
}

/** Paths drawn by `items[0 .. end)` (nested groups included), in target space. */
function pathsAbove(
  items: readonly ShapeItem[],
  end: number,
  m: Matrix2D,
  frame: number,
  out: BezierPath[],
  depth = 0,
): void {
  if (depth > 32) return
  for (let idx = 0; idx < end; idx++) {
    const item = items[idx]
    if (!item || item.hd === true) continue
    if (item.ty === 'gr') {
      const it = Array.isArray(item.it) ? item.it : []
      pathsAbove(
        it,
        it.length,
        multiplyMatrices(m, transformMatrix(groupTransform(item), frame)),
        frame,
        out,
        depth + 1,
      )
    } else if (GEOMETRY_TYPES.has(item.ty)) {
      const p = shapeToBezier(item, frame)
      if (p && p.v.length > 0) out.push(mapBezier(p, m))
    }
  }
}

function paintVisible(item: PaintItem, frame: number): boolean {
  if (item.hd === true) return false
  if (evaluateScalar(item.o, frame, 100) <= 0) return false
  return true
}

function paintWeight(item: PaintItem, paths: BezierPath[]): number {
  let w = 0
  for (const p of paths) {
    const pts = flatten(p)
    w += isFillPaint(item) ? polygonArea(pts) : polylineLength(pts)
  }
  return w
}

/** Collects the paints of shape items (and the paths each one paints) in target space. */
function collectPaints(
  items: readonly ShapeItem[],
  m: Matrix2D,
  frame: number,
  out: PaintSample[],
  depth = 0,
): void {
  if (!Array.isArray(items) || depth > 32) return
  items.forEach((item, idx) => {
    if (!item || item.hd === true) return
    if (item.ty === 'gr') {
      const it = Array.isArray(item.it) ? item.it : []
      collectPaints(
        it,
        multiplyMatrices(m, transformMatrix(groupTransform(item), frame)),
        frame,
        out,
        depth + 1,
      )
    } else if (isPaint(item) && paintVisible(item, frame)) {
      const paths: BezierPath[] = []
      pathsAbove(items, idx, m, frame, paths)
      const weight = paintWeight(item, paths)
      if (weight > 0) out.push({ item, matrix: m, weight })
    }
  })
}

/** Paint signature used to group equal-looking styles (color at the frame + opacity). */
function signature(sample: PaintSample, frame: number): string {
  const it = sample.item
  const o = Math.round(evaluateScalar(it.o, frame, 100))
  if (it.ty === 'fl' || it.ty === 'st') {
    const c = evaluateVector(it.c, frame, [0, 0, 0])
      .slice(0, 3)
      .map((v) => Math.round(v * 255))
    return `${it.ty === 'fl' ? 'f' : 's'}:${c.join(',')}:${o}`
  }
  return `${it.ty}:${JSON.stringify(evaluateVector(it.g.k, frame, []))}:${o}`
}

/** One sample per distinct paint (`key`), most used first (the heaviest sample of each). */
function ranked(samples: PaintSample[], key: (s: PaintSample) => string): PaintSample[] {
  const totals = new Map<string, { total: number; best: PaintSample }>()
  for (const s of samples) {
    const k = key(s)
    const entry = totals.get(k)
    if (!entry) totals.set(k, { total: s.weight, best: s })
    else {
      entry.total += s.weight
      if (s.weight > entry.best.weight) entry.best = s
    }
  }
  return [...totals.values()].sort((a, b) => b.total - a.total).map((e) => e.best)
}

function dominant(samples: PaintSample[], frame: number): PaintSample | null {
  return ranked(samples, (s) => signature(s, frame))[0] ?? null
}

/** Color of a paint at `frame`, whatever its kind and opacity (gradients: their stops). */
function colorKey(item: PaintItem, frame: number): string {
  if (item.ty === 'fl' || item.ty === 'st') {
    return evaluateVector(item.c, frame, [0, 0, 0])
      .slice(0, 3)
      .map((v) => Math.round(v * 255))
      .join(',')
  }
  return JSON.stringify(evaluateVector(item.g.k, frame, []))
}

/** Paints of enclosing groups / the layer that also apply to a group target (target space). */
function inheritedPaints(
  anim: Animation,
  groupPath: NodePath,
  frame: number,
  out: PaintSample[],
): boolean {
  const layerPath = layerPathOf(groupPath) as NodePath
  const own = shapeContentMatrix(anim, groupPath, frame)
  const toTarget = invertMatrix(own) ?? IDENTITY_MATRIX
  const targetPaths: BezierPath[] = []
  const group = getAt<GroupShape>(anim, groupPath) as GroupShape
  pathsAbove(group.it, group.it.length, IDENTITY_MATRIX, frame, targetPaths)
  let affected = false
  // Walk up: each ancestor list, styles/modifiers after the child index apply to the target.
  for (let n = groupPath.length; n > layerPath.length + 1; n -= 2) {
    const listPath = groupPath.slice(0, n - 1)
    const index = groupPath[n - 1] as number
    const list = getAt<ShapeItem[]>(anim, listPath)
    if (!Array.isArray(list)) continue
    const ownerPath = listPath.slice(0, -1)
    // Matrix of the list's space in layer space: the owning group's content matrix (identity for the layer).
    const listMatrix = isShapePath(ownerPath)
      ? shapeContentMatrix(anim, ownerPath, frame)
      : IDENTITY_MATRIX
    const m = multiplyMatrices(toTarget, listMatrix)
    for (let k = index + 1; k < list.length; k++) {
      const item = list[k]
      if (!item || item.hd === true) continue
      if (MODIFIER_TYPES.has(item.ty)) affected = true
      if (isPaint(item) && paintVisible(item, frame)) {
        affected = true
        out.push({ item, matrix: m, weight: paintWeight(item, targetPaths) })
      }
    }
  }
  return affected
}

/** Dominant fill and stroke of the content being replaced, at `frame`. */
export function analyseOriginalStyle(
  anim: Animation,
  path: NodePath,
  frame: number,
): OriginalStyle {
  const kind = replaceTargetKind(anim, path)
  const samples: PaintSample[] = []
  if (kind === 'group') {
    const g = getAt<GroupShape>(anim, path) as GroupShape
    collectPaints(g.it, IDENTITY_MATRIX, frame, samples)
    inheritedPaints(anim, path, frame, samples)
  } else if (kind === 'shape-layer') {
    collectPaints(
      (getAt<ShapeLayer>(anim, path) as ShapeLayer).shapes,
      IDENTITY_MATRIX,
      frame,
      samples,
    )
  } else if (kind === 'precomp-layer') {
    const layer = getAt<PrecompLayer>(anim, path) as PrecompLayer
    collectCompPaints(
      anim,
      layer.refId,
      precompInnerFrame(layer, frame, anim.fr),
      IDENTITY_MATRIX,
      samples,
      new Set(),
    )
  } else if (kind === 'text-layer') {
    textPaints(anim, getAt<Layer>(anim, path) as Layer, path, frame, IDENTITY_MATRIX, samples)
  }
  const fills = ranked(
    samples.filter((s) => isFillPaint(s.item)),
    (s) => signature(s, frame),
  )
  const fill = fills[0] ?? null
  const stroke = dominant(
    samples.filter((s) => !isFillPaint(s.item)),
    frame,
  )
  const differs = (s: PaintSample | null): s is PaintSample =>
    !!s && (!fill || colorKey(s.item, frame) !== colorKey(fill.item, frame))
  const accent = fills.slice(1).find(differs) ?? (differs(stroke) ? stroke : null)
  return { fill, stroke, accent }
}

/** Text layers contribute their fill / stroke colors (weighted by their estimated box). */
function textPaints(
  anim: Animation,
  layer: Layer,
  path: NodePath,
  frame: number,
  m: Matrix2D,
  out: PaintSample[],
): void {
  if (layer.ty !== LayerType.Text) return
  const doc = evaluateTextDocument((layer as { t?: TextData }).t, frame)
  const box = layerContentBounds(anim, path, frame)
  if (!doc || !box) return
  const weight = box.w * box.h * Math.abs(matrixScale(m)) ** 2
  if (Array.isArray(doc.fc) && doc.fc.length >= 3) {
    out.push({
      item: { ty: 'fl', c: stat([...doc.fc.slice(0, 3), 1]), o: stat(100), r: 1 },
      matrix: m,
      weight,
    })
  }
  if (Array.isArray(doc.sc) && doc.sc.length >= 3 && (doc.sw ?? 0) > 0) {
    out.push({
      item: {
        ty: 'st',
        c: stat([...doc.sc.slice(0, 3), 1]),
        o: stat(100),
        w: stat(doc.sw ?? 1),
        lc: 2,
        lj: 2,
      },
      matrix: m,
      weight,
    })
  }
}

function collectCompPaints(
  anim: Animation,
  compId: string,
  frame: number,
  m: Matrix2D,
  out: PaintSample[],
  visiting: Set<string>,
): void {
  const found = findPrecomp(anim, compId)
  if (!found || visiting.has(compId)) return
  visiting.add(compId)
  const layers = found.asset.layers ?? []
  layers.forEach((layer, index) => {
    if (!layer || layer.hd === true || layer.td || frame < layer.ip || frame >= layer.op) return
    const lm = multiplyMatrices(
      m,
      worldMatrix(anim, ['assets', found.index, 'layers', index], frame),
    )
    if (layer.ty === LayerType.Shape) collectPaints((layer as ShapeLayer).shapes, lm, frame, out)
    else if (layer.ty === LayerType.Text)
      textPaints(anim, layer, ['assets', found.index, 'layers', index], frame, lm, out)
    else if (layer.ty === LayerType.Precomp) {
      const pl = layer as PrecompLayer
      collectCompPaints(anim, pl.refId, precompInnerFrame(pl, frame, anim.fr), lm, out, visiting)
    }
  })
  visiting.delete(compId)
}

/* -------------------------------------------------------------------------- */
/*                                 Restyling                                  */
/* -------------------------------------------------------------------------- */

interface StrokeGeometry {
  w: ScalarProperty
  lc?: 1 | 2 | 3
  lj?: 1 | 2 | 3
  ml?: number
  ml2?: ScalarProperty
  d?: StrokeShape['d']
}

function strokeGeometry(item: StrokeShape | GradientStrokeShape): StrokeGeometry {
  const g: StrokeGeometry = { w: cloneJson(item.w) }
  if (item.lc !== undefined) g.lc = item.lc
  if (item.lj !== undefined) g.lj = item.lj
  if (item.ml !== undefined) g.ml = item.ml
  if (item.ml2 !== undefined) g.ml2 = cloneJson(item.ml2)
  if (item.d !== undefined) g.d = cloneJson(item.d)
  return g
}

/** A copy of a sampled paint expressed in the wrapper's content space (`toContent`: target → content). */
function samplePaintInContent(sample: PaintSample, toContent: Matrix2D): PaintItem {
  const item = cloneJson(sample.item)
  delete item.hd
  const m = multiplyMatrices(toContent, sample.matrix)
  if (item.ty === 'st' || item.ty === 'gs') {
    const k = matrixScale(m)
    scaleScalar(item.w, k)
    for (const d of item.d ?? []) scaleScalar(d.v, k)
  }
  if (item.ty === 'gf' || item.ty === 'gs') {
    mapPointProperty(item.s, m)
    mapPointProperty(item.e, m)
  }
  return item
}

/** Builds a fill from any paint (a stroke's color becomes a fill color). */
function asFill(source: PaintItem, rule: 1 | 2 | undefined): FillShape | GradientFillShape {
  if (source.ty === 'fl' || source.ty === 'gf') {
    const f = { ...source }
    if (rule) f.r = rule
    return f
  }
  if (source.ty === 'st')
    return { ty: 'fl', nm: 'Fill 1', c: source.c, o: source.o, r: rule ?? 1, bm: 0 }
  const g: GradientFillShape = {
    ty: 'gf',
    nm: 'Gradient Fill 1',
    o: source.o,
    g: source.g,
    s: source.s,
    e: source.e,
    t: source.t,
    r: rule ?? 1,
    bm: 0,
  }
  if (source.h) g.h = source.h
  if (source.a) g.a = source.a
  return g
}

/** Builds a stroke from any paint, with the given geometry (width, caps, joins, dashes). */
function asStroke(
  source: PaintItem,
  geometry: StrokeGeometry | null,
): StrokeShape | GradientStrokeShape {
  let base: StrokeShape | GradientStrokeShape
  if (source.ty === 'st' || source.ty === 'gs') base = { ...source }
  else if (source.ty === 'fl')
    base = { ty: 'st', nm: 'Stroke 1', c: source.c, o: source.o, w: stat(1), lc: 2, lj: 2, bm: 0 }
  else {
    const g: GradientStrokeShape = {
      ty: 'gs',
      nm: 'Gradient Stroke 1',
      o: source.o,
      g: source.g,
      s: source.s,
      e: source.e,
      t: source.t,
      w: stat(1),
      lc: 2,
      lj: 2,
      bm: 0,
    }
    if (source.h) g.h = source.h
    if (source.a) g.a = source.a
    base = g
  }
  if (!geometry) return base
  const out = { ...base, ...geometry }
  if (!geometry.d) delete out.d
  return out
}

function strokeVisible(sample: PaintSample | null, frame: number): boolean {
  if (!sample) return false
  const item = sample.item
  if (item.ty !== 'st' && item.ty !== 'gs') return false
  return evaluateScalar(item.w, frame, 0) > 0 && evaluateScalar(item.o, frame, 100) > 0
}

/**
 * Applies the original look to new content: filled shapes get the dominant fill (keeping their
 * fill rule) and, when the original had one, its outline; stroke-only shapes keep their own
 * stroke geometry (it defines them) recolored with the original's color. Content drawn in
 * several colors keeps its details: its main color (the largest area) takes the original's
 * fill, the other colors its accent — a white badge with a blue star rather than a blank badge.
 */
function applyOriginal(
  items: ShapeItem[],
  orig: OriginalStyle,
  toContent: Matrix2D,
  frame: number,
): boolean {
  const fillSrc = orig.fill ? samplePaintInContent(orig.fill, toContent) : null
  const strokeSrc = orig.stroke ? samplePaintInContent(orig.stroke, toContent) : null
  const accentSrc = orig.accent ? samplePaintInContent(orig.accent, toContent) : null
  const outline = strokeVisible(orig.stroke, frame)
  // Color used for recolored strokes: the visible original stroke, else the fill.
  const strokeColor = outline ? strokeSrc : (fillSrc ?? strokeSrc)
  const fillColor = fillSrc ?? strokeSrc
  // The content's main color: the fill color covering the largest area (static content).
  const contentPaints: PaintSample[] = []
  collectPaints(items, IDENTITY_MATRIX, 0, contentPaints)
  const contentFills = contentPaints.filter((p) => isFillPaint(p.item))
  const mainKey = contentFills.length
    ? colorKey(ranked(contentFills, (p) => colorKey(p.item, 0))[0].item, 0)
    : null
  /** A fill (or the paints of a list without one) in a secondary color of the content. */
  const isDetail = (fill: PaintItem | undefined) =>
    accentSrc !== null && mainKey !== null && (!fill || colorKey(fill, 0) !== mainKey)
  let applied = false

  const visit = (list: ShapeItem[], depth: number) => {
    if (depth > 64) return
    const paints = list.filter(isPaint)
    for (const item of list)
      if (item.ty === 'gr' && Array.isArray(item.it)) visit(item.it, depth + 1)
    if (paints.length === 0) return
    const fills = paints.filter(isFillPaint)
    const strokes = paints.filter((p): p is StrokeShape | GradientStrokeShape => !isFillPaint(p))
    const hadFill = fills.length > 0
    const hadStroke = strokes.length > 0
    const next: ShapeItem[] = []
    const detail = isDetail(fills[0])
    if (hadStroke && strokeColor) {
      const own = strokeGeometry(strokes[0])
      const geometry =
        hadFill && outline && strokeSrc && (strokeSrc.ty === 'st' || strokeSrc.ty === 'gs')
          ? strokeGeometry(strokeSrc)
          : own
      // A visible original outline stays the outline color; otherwise details use the accent.
      const color = !outline && detail && accentSrc ? accentSrc : strokeColor
      next.push(asStroke(cloneJson(color), geometry))
    } else if (!hadStroke && hadFill && strokeSrc) {
      next.push(cloneJson(strokeSrc))
    }
    const fillPaint = detail && accentSrc ? accentSrc : fillColor
    if (hadFill && fillPaint) next.push(asFill(cloneJson(fillPaint), (fills[0] as { r?: 1 | 2 }).r))
    const at = list.findIndex(isPaint)
    const kept: ShapeItem[] = list.filter((i) => !isPaint(i))
    kept.splice(Math.min(at, kept.length), 0, ...next)
    list.splice(0, list.length, ...kept)
    applied = true
  }
  visit(items, 0)
  if (!applied && (fillColor || strokeSrc)) {
    // Bare geometry (no paint at all): paint it once at the top level.
    const add: ShapeItem[] = []
    if (strokeSrc) add.push(cloneJson(strokeSrc))
    if (fillColor) add.push(asFill(cloneJson(fillColor), undefined))
    items.push(...add)
    applied = true
  }
  return applied
}

function colorItem(c: RGBA): { c: { a: 0; k: number[] }; o: { a: 0; k: number } } {
  return {
    c: stat([colorChannel(c.r), colorChannel(c.g), colorChannel(c.b), 1]),
    o: stat(round3(Math.min(1, Math.max(0, c.a)) * 100)),
  }
}

/** Explicit monochrome colors (and an optional stroke width in content units). */
function applyOverride(
  items: ShapeItem[],
  ov: StyleOverride,
  widthInContent: number | undefined,
): void {
  const visit = (list: ShapeItem[], depth: number) => {
    if (depth > 64) return
    for (const item of list)
      if (item.ty === 'gr' && Array.isArray(item.it)) visit(item.it, depth + 1)
    const paints = list.filter(isPaint)
    const hadFill = paints.some(isFillPaint)
    const hadStroke = paints.some((p) => !isFillPaint(p))
    const next: ShapeItem[] = []
    for (const p of paints) {
      if (isFillPaint(p)) {
        if (ov.fill === null) continue
        if (ov.fill === undefined) next.push(p)
        else
          next.push({
            ty: 'fl',
            nm: p.nm ?? 'Fill 1',
            ...colorItem(ov.fill),
            r: (p as { r?: 1 | 2 }).r ?? 1,
            bm: 0,
          })
      } else {
        if (ov.stroke === null) continue
        const geometry = strokeGeometry(p)
        if (widthInContent !== undefined) geometry.w = stat(round3(widthInContent))
        if (ov.stroke === undefined) next.push({ ...p, ...geometry })
        else
          next.push({
            ty: 'st',
            nm: p.nm ?? 'Stroke 1',
            ...colorItem(ov.stroke),
            ...geometry,
            bm: 0,
          })
      }
    }
    if (ov.stroke && ov.outline !== false && hadFill && !hadStroke) {
      next.unshift({
        ty: 'st',
        nm: 'Stroke 1',
        ...colorItem(ov.stroke),
        w: stat(round3(widthInContent ?? 1)),
        lc: 2,
        lj: 2,
        bm: 0,
      })
    }
    if (paints.length === 0 && next.length === 0) return
    const at = Math.max(0, list.findIndex(isPaint))
    const kept: ShapeItem[] = list.filter((i) => !isPaint(i))
    const insertAt =
      paints.length > 0
        ? Math.min(at, kept.length)
        : Math.max(0, kept.length - (kept[kept.length - 1]?.ty === 'tr' ? 1 : 0))
    kept.splice(insertAt, 0, ...next)
    list.splice(0, list.length, ...kept)
  }
  visit(items, 0)
}

/* -------------------------------------------------------------------------- */
/*                              Replace with shapes                           */
/* -------------------------------------------------------------------------- */

function defaultBox(anim: Animation, path: NodePath, kind: ReplaceTargetKind): Box {
  if (kind === 'precomp-layer') {
    const l = getAt<PrecompLayer>(anim, path) as PrecompLayer
    if ((l.w ?? 0) > 0 && (l.h ?? 0) > 0) return { x: 0, y: 0, w: l.w as number, h: l.h as number }
  }
  const s = Math.min(anim.w, anim.h) / 4
  return { x: -s / 2, y: -s / 2, w: s, h: s }
}

/** Contains keyframes anywhere (transforms, paths, colors…) or an expression. */
function isAnimatedContent(node: unknown): boolean {
  let animated = false
  forEachProperty(node, [], (prop) => {
    if (!animated && (isAnimated(prop) || (typeof prop.x === 'string' && prop.x.trim() !== '')))
      animated = true
  })
  return animated
}

/** Inner time range a precomp must cover for the layers showing it. */
function coverRange(
  anim: Animation,
  compId: string,
  oldLayers: readonly Layer[],
): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const l of oldLayers) {
    if (typeof l.ip === 'number') min = Math.min(min, l.ip)
    if (typeof l.op === 'number') max = Math.max(max, l.op)
  }
  forEachLayer(anim, (layer) => {
    if (layer.ty !== LayerType.Precomp || (layer as PrecompLayer).refId !== compId) return
    const pl = layer as PrecompLayer
    const n = pl.tm ? Math.min(240, Math.max(2, Math.ceil(pl.op - pl.ip))) : 1
    for (let k = 0; k <= n; k++) {
      const f = precompInnerFrame(pl, pl.ip + ((pl.op - pl.ip) * k) / n, anim.fr)
      min = Math.min(min, f)
      max = Math.max(max, f)
    }
  })
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, Math.max(1, anim.op)]
  return [Math.floor(min), Math.max(Math.ceil(max), Math.floor(min) + 1)]
}

function newShapeLayer(
  name: string,
  shapes: ShapeItem[],
  ip: number,
  op: number,
  ind: number,
): ShapeLayer {
  return {
    ddd: 0,
    ind,
    ty: 4,
    nm: name,
    sr: 1,
    ks: {
      o: stat(100),
      r: stat(0),
      p: stat([0, 0, 0]),
      a: stat([0, 0, 0]),
      s: stat([100, 100, 100]),
    },
    ao: 0,
    shapes,
    ip,
    op,
    st: 0,
    bm: 0,
  }
}

const TYPE_SPECIFIC_KEYS = ['refId', 'w', 'h', 'tm', 'shapes', 't', 'sc', 'sw', 'sh'] as const

/** A copy of a layer's common fields (timing, transform, parenting, mattes, masks, effects…). */
function commonLayerFields(layer: Layer): Record<string, unknown> {
  const copy = cloneJson(layer) as unknown as Record<string, unknown>
  for (const key of TYPE_SPECIFIC_KEYS) delete copy[key]
  return copy
}

function layerDisplayName(layer: Layer | undefined, fallback: string): string {
  return textOf(layer?.nm) || fallback
}

/** Visual bounds of content (strokes included), or an empty box. */
function measureBox(items: ShapeItem[]): Box {
  return (
    shapeItemsBounds(items, 0, { includeStroke: true }) ??
    shapeItemsBounds(items, 0) ?? { x: 0, y: 0, w: 0, h: 0 }
  )
}

/**
 * Replaces the target with vector shapes, keeping its animation:
 *  - shape group: keeps the group (and its `tr`), replaces its other items with the content;
 *  - shape layer: keeps the layer, replaces `shapes`;
 *  - precomp layer: replaces the composition's layers with one shape layer (a precomp that other
 *    layers use too is cloned first unless `detach: false`);
 *  - image / text / solid layer: becomes a shape layer with the same timing, transform,
 *    parenting, mattes, masks and effects.
 * The content is fitted into the old element's bounds at the reference frame.
 */
export function replaceWithShapes(
  anim: Animation,
  target: NodePath,
  content: ReplaceContent,
  opts: ReplaceOptions = {},
): ReplaceResult {
  const kind = requireKind(anim, target)
  if (!Array.isArray(content?.shapes) || content.shapes.length === 0) {
    throw new ReplaceError('invalid-content', 'There are no shapes to insert.')
  }
  const warnings = new Set<ReplaceWarning>()
  const rep = opts.frame === undefined ? representativeFrame(anim, target) : null
  const frame = opts.frame ?? rep?.frame ?? 0
  let targetBox = rep ? rep.bounds : targetBounds(anim, target, frame)
  if (!targetBox) {
    warnings.add('empty-target')
    targetBox = defaultBox(anim, target, kind)
  }
  if (kind === 'text-layer') warnings.add('approximate-bounds')

  const style = opts.style ?? 'keep'
  const original = style === 'original' ? analyseOriginalStyle(anim, target, frame) : null
  if (original && !original.fill && !original.stroke) warnings.add('no-original-style')

  // Restyle, then fit; when the box is derived from the content, refit once so strokes whose
  // width depends on the fit are measured too.
  const restyle = (fit: FitInfo): ShapeItem[] => {
    const items = cloneJson(content.shapes)
    const toContent = invertMatrix(fitMatrix(fit)) ?? IDENTITY_MATRIX
    if (original && (original.fill || original.stroke))
      applyOriginal(items, original, toContent, frame)
    else if (typeof style === 'object') {
      const width =
        style.strokeWidth !== undefined ? style.strokeWidth * matrixScale(toContent) : undefined
      applyOverride(items, style, width)
    }
    return items
  }
  let fit: FitInfo
  let items: ShapeItem[]
  if (content.box) {
    fit = computeFit(frame, targetBox, content.box, opts)
    items = restyle(fit)
  } else {
    // Strokes copied from the original keep their width in the target space, so the content box
    // depends on the fit: iterate to the fixed point (fast: the stroke share shrinks each pass).
    fit = computeFit(frame, targetBox, measureBox(cloneJson(content.shapes)), opts)
    for (let pass = 0; pass < 12; pass++) {
      const next = computeFit(frame, targetBox, measureBox(restyle(fit)), opts)
      const settled = next.scale.every(
        (v, i) => Math.abs(v - fit.scale[i]) <= 1e-4 * Math.abs(v) + 1e-6,
      )
      fit = next
      if (settled) break
    }
    items = restyle(fit)
  }
  const name = opts.name?.trim() || content.shapes[0]?.nm || 'Replacement'
  const wrapper = wrapperGroup(name, items, fit)
  const paths: NodePath[] = [target]

  switch (kind) {
    case 'group': {
      const group = getAt<GroupShape>(anim, target) as GroupShape
      const tr = groupTransform(group)
      group.it = [wrapper, tr ?? identityTransform()]
      paths.push([...target, 'it', 0])
      const probe: PaintSample[] = []
      if (inheritedPaints(anim, target, frame, probe)) warnings.add('inherited-styles')
      break
    }
    case 'shape-layer': {
      const layer = getAt<ShapeLayer>(anim, target) as ShapeLayer
      layer.shapes = [wrapper]
      paths.push([...target, 'shapes', 0])
      break
    }
    case 'precomp-layer': {
      const layer = getAt<PrecompLayer>(anim, target) as PrecompLayer
      let found = findPrecomp(anim, layer.refId)
      if (!found)
        throw new ReplaceError('missing-asset', `Composition "${layer.refId}" is missing.`)
      let usage = 0
      forEachLayer(anim, (l) => {
        if (l.ty === LayerType.Precomp && (l as PrecompLayer).refId === layer.refId) usage++
      })
      if (usage > 1) {
        if (opts.detach === false) warnings.add('shared-precomp')
        else {
          const clone = cloneJson(found.asset) as PrecompAsset
          clone.id = uniqueAssetId(anim, found.asset.id)
          if (found.asset.nm) clone.nm = `${found.asset.nm} (${name})`
          anim.assets = anim.assets ?? []
          anim.assets.push(clone)
          layer.refId = clone.id
          found = {
            asset: anim.assets[anim.assets.length - 1] as PrecompAsset,
            index: anim.assets.length - 1,
          }
          paths.push(['assets', found.index])
        }
      }
      const asset = found.asset
      const oldLayers = asset.layers ?? []
      if (
        oldLayers.some((l) =>
          isAnimatedContent(
            l.ty === LayerType.Precomp
              ? l
              : { ks: l.ks, shapes: (l as ShapeLayer).shapes, t: (l as { t?: unknown }).t },
          ),
        )
      ) {
        warnings.add('inner-animation-dropped')
      }
      const [ip, op] = coverRange(anim, asset.id, oldLayers)
      asset.layers = [newShapeLayer(name, [wrapper], ip, op, 1)]
      paths.push(
        ['assets', found.index, 'layers', 0],
        ['assets', found.index, 'layers', 0, 'shapes', 0],
      )
      break
    }
    case 'image-layer':
    case 'text-layer':
    case 'solid-layer': {
      const layers = layersOf(anim, target)
      const index = target[target.length - 1] as number
      const old = layers[index]
      const next = {
        ...commonLayerFields(old),
        ty: LayerType.Shape,
        shapes: [wrapper],
      } as unknown as ShapeLayer
      if (!next.nm) next.nm = layerDisplayName(old, name)
      layers[index] = next
      paths.push([...target, 'shapes', 0])
      break
    }
  }
  return { paths, warnings: [...warnings], fit }
}

/* -------------------------------------------------------------------------- */
/*                              Replace with image                            */
/* -------------------------------------------------------------------------- */

/**
 * Folds a static content → layer-space map F = T(p)·S(s)·T(−a) into a layer transform so that
 * ks' = ks · F (keyframes of anchor and scale are remapped, other properties stay untouched).
 */
function foldIntoTransform(ks: Transform, fit: FitInfo): Transform {
  const fsx = fit.scale[0] / 100
  const fsy = fit.scale[1] / 100
  const [fpx, fpy] = fit.position
  const [fax, fay] = fit.anchor
  const mapAnchor = (v: number[] | undefined): number[] | undefined => {
    if (!Array.isArray(v)) return v
    const ax = v[0] ?? 0
    const ay = v[1] ?? 0
    return [round3(fax + (ax - fpx) / fsx), round3(fay + (ay - fpy) / fsy), ...v.slice(2)]
  }
  const a = ks.a ?? stat([0, 0, 0])
  const akfs = getKeyframes<number[]>(a)
  if (!akfs) a.k = mapAnchor(a.k as number[]) as number[]
  else {
    for (const kf of akfs) {
      kf.s = mapAnchor(kf.s)
      if (kf.e) kf.e = mapAnchor(kf.e)
      for (const key of ['to', 'ti'] as const) {
        const t = kf[key]
        if (Array.isArray(t))
          kf[key] = [round3((t[0] ?? 0) / fsx), round3((t[1] ?? 0) / fsy), ...t.slice(2)]
      }
    }
  }
  ks.a = a
  const s = ks.s ?? stat([100, 100, 100])
  const mapScale = (v: number[] | undefined) =>
    Array.isArray(v)
      ? [round3((v[0] ?? 100) * fsx), round3((v[1] ?? v[0] ?? 100) * fsy), ...v.slice(2)]
      : v
  const skfs = getKeyframes<number[]>(s)
  if (!skfs) s.k = mapScale(s.k as number[]) as number[]
  else {
    for (const kf of skfs) {
      kf.s = mapScale(kf.s)
      if (kf.e) kf.e = mapScale(kf.e)
    }
  }
  ks.s = s
  return ks
}

function staticKs(m: Matrix2D, opacity: ScalarProperty | undefined): Transform {
  const d = decomposeMatrix(m)
  return {
    o: opacity ? cloneJson(opacity) : stat(100),
    r: stat(round3(d.rotation)),
    p: stat([round3(d.position[0]), round3(d.position[1]), 0]),
    a: stat([0, 0, 0]),
    s: stat([round3(d.scale[0]), round3(d.scale[1]), 100]),
    sk: stat(round3(d.skew)),
    sa: stat(0),
  }
}

/** Replaces a layer at `layerPath` by an image layer showing `assetId` fitted by `fit`. */
function swapLayerForImage(
  anim: Animation,
  layerPath: NodePath,
  assetId: string,
  fit: FitInfo,
  name: string,
): NodePath[] {
  const layers = layersOf(anim, layerPath)
  const index = layerPath[layerPath.length - 1] as number
  const old = layers[index]
  const F = fitMatrix(fit)
  const toImage = invertMatrix(F) ?? IDENTITY_MATRIX
  const base = commonLayerFields(old)
  mapMasks(base.masksProperties as Mask[] | undefined, toImage)
  const hasChildren = old.ind !== undefined && layers.some((l) => l !== old && l.parent === old.ind)
  if (!hasChildren) {
    const ks = foldIntoTransform(cloneJson(old.ks ?? {}), fit)
    layers[index] = {
      ...base,
      ty: LayerType.Image,
      refId: assetId,
      ks,
      nm: old.nm ?? name,
    } as unknown as Layer
    return [layerPath]
  }
  // Children follow the old transform: keep it on a null layer and parent the image to it.
  const ind = nextLayerInd(layers)
  const holder = {
    ddd: old.ddd ?? 0,
    ind: old.ind,
    ty: LayerType.Null,
    nm: `${old.nm ?? name} (transform)`,
    ks: cloneJson(old.ks ?? {}),
    ao: old.ao ?? 0,
    ip: old.ip,
    op: old.op,
    st: old.st,
    sr: old.sr ?? 1,
  } as Layer
  if (old.parent !== undefined) holder.parent = old.parent
  const image = {
    ...base,
    ty: LayerType.Image,
    refId: assetId,
    ind,
    parent: old.ind,
    ao: 0,
    ks: staticKs(F, old.ks?.o),
    nm: old.nm ?? name,
  } as unknown as Layer
  layers[index] = image
  layers.push(holder)
  // Track mattes that pointed at the old layer (by `tp`) now point at the image.
  for (const l of layers) if (l !== image && l.tp === old.ind) l.tp = ind
  return [layerPath, [...compPathOf(layerPath), layers.length - 1]]
}

/**
 * Replaces the target with an image (a new image asset with a unique id):
 *  - image layer: shows the new asset, the correcting fit folded into its anchor / scale;
 *  - shape / precomp / text / solid layer: an image layer takes its place in the stack with
 *    the same timing, transform chain, parenting, mattes and masks (a layer with children
 *    keeps its transform on a null the image is parented to);
 *  - shape group: an image layer is parented to the group's layer, placed with the group's
 *    transform (its state at the reference frame when animated: see the warning), and the
 *    group is removed.
 */
export function replaceWithImage(
  anim: Animation,
  target: NodePath,
  image: ReplaceImage,
  opts: ReplaceOptions = {},
): ReplaceResult {
  const kind = requireKind(anim, target)
  if (!image || typeof image.dataUri !== 'string' || !(image.w > 0) || !(image.h > 0)) {
    throw new ReplaceError('invalid-content', 'The image needs data and a positive size.')
  }
  const warnings = new Set<ReplaceWarning>()
  const rep = opts.frame === undefined ? representativeFrame(anim, target) : null
  const frame = opts.frame ?? rep?.frame ?? 0
  let targetBox = rep ? rep.bounds : targetBounds(anim, target, frame)
  if (!targetBox) {
    warnings.add('empty-target')
    targetBox = defaultBox(anim, target, kind)
  }
  if (kind === 'text-layer') warnings.add('approximate-bounds')
  const fit = computeFit(frame, targetBox, { x: 0, y: 0, w: image.w, h: image.h }, opts)
  const name = opts.name?.trim() || image.name?.trim() || 'Image'

  // Paths are computed before the asset is appended: asset indices of existing paths stay valid.
  const assetId = nextImageId(anim)
  const asset: ImageAsset = { id: assetId, w: image.w, h: image.h, u: '', p: image.dataUri, e: 1 }
  if (image.name) asset.nm = image.name
  anim.assets = anim.assets ?? []
  anim.assets.push(asset)
  const assetPath: NodePath = ['assets', anim.assets.length - 1]

  if (kind !== 'group') {
    const paths = swapLayerForImage(anim, target, assetId, fit, name)
    return { paths: [...paths, assetPath], warnings: [...warnings], fit }
  }

  // Group: an image layer parented to the group's layer, placed by the group's transform chain.
  const layerPath = layerPathOf(target) as NodePath
  const layers = layersOf(anim, layerPath)
  const layerIndex = layerPath[layerPath.length - 1] as number
  const layer = layers[layerIndex]
  let chainAnimated = false
  let opacity = 1
  for (let n = layerPath.length + 2; n <= target.length; n += 2) {
    const g = getAt<ShapeItem>(anim, target.slice(0, n))
    if (!g || g.ty !== 'gr') continue
    const tr = groupTransform(g)
    if (!isStaticTransform(tr)) chainAnimated = true
    opacity *= evaluateScalar(tr?.o, frame, 100) / 100
  }
  if (chainAnimated) warnings.add('group-transform-animated')
  if (layer.ks?.o && (isAnimated(layer.ks.o) || evaluateScalar(layer.ks.o, frame, 100) < 100))
    warnings.add('parent-opacity-ignored')
  if ((layer.masksProperties?.length ?? 0) > 0 || layer.tt)
    warnings.add('layer-effects-not-applied')
  if (layer.ind === undefined) layer.ind = nextLayerInd(layers)
  const m = multiplyMatrices(shapeContentMatrix(anim, target, frame), fitMatrix(fit))
  const ind = nextLayerInd(layers)
  const imageLayer = {
    ddd: 0,
    ind,
    ty: LayerType.Image,
    nm: name,
    refId: assetId,
    parent: layer.ind,
    sr: layer.sr ?? 1,
    ks: staticKs(m, stat(round3(opacity * 100))),
    ao: 0,
    ip: layer.ip,
    op: layer.op,
    st: layer.st,
    bm: 0,
  } as unknown as Layer
  // Remove the group from its list.
  const listPath = target.slice(0, -1)
  const list = getAt<ShapeItem[]>(anim, listPath)
  if (Array.isArray(list)) list.splice(target[target.length - 1] as number, 1)
  // Insert above the layer; above its matte source when it is matted by adjacency.
  let insertAt = layerIndex
  if (layer.tt && layer.tp === undefined && layerIndex > 0 && layers[layerIndex - 1]?.td)
    insertAt = layerIndex - 1
  layers.splice(insertAt, 0, imageLayer)
  const comp = compPathOf(layerPath)
  return {
    paths: [
      [...comp, insertAt],
      [...comp, layerIndex + (insertAt <= layerIndex ? 1 : 0)],
      assetPath,
    ],
    warnings: [...warnings],
    fit,
  }
}

/* -------------------------------------------------------------------------- */
/*                           Replaceable candidates                           */
/* -------------------------------------------------------------------------- */

/**
 * What a candidate looks like. A watermark (named so) is listed after logos and images: it is
 * worth customizing, but it is rarely the logo a user means to swap first.
 */
export type CandidateKind = 'logo' | 'image' | 'watermark' | 'text' | 'vector'

export type CandidateReason =
  /** The name looks like a logo / icon / brand mark. */
  | 'name'
  /** The name says it is a watermark. */
  | 'watermark'
  /** A precomp whose content is vector-only. */
  | 'vector-precomp'
  /** Small relative to the composition. */
  | 'compact'
  /** Many paths in a small area. */
  | 'detailed'
  /** Converted from Illustrator artwork ("… Outlines" / "Кривые …" layers). */
  | 'artwork'
  | 'image'
  | 'text'

export interface Candidate {
  path: NodePath
  target: ReplaceTargetKind
  kind: CandidateKind
  /** Display name (layer / group name, else the asset id or a kind label). */
  name: string
  /** Ranking score (higher is more likely what the user wants to swap). */
  score: number
  reasons: CandidateReason[]
  /** Representative frame (time of the composition containing the target). */
  frame: number
  /** Bounds at `frame` in the target's own space. */
  bounds: Box
  /** Same moment in root time, and the bounds in root composition space (null when unreachable). */
  rootFrame: number | null
  rootBounds: Box | null
  /** Image or precomp asset id, and how many layers use it. */
  assetId?: string
  usage?: number
}

const LOGO_NAME = /logo|лого|icon|иконк|brand|бренд|emblem|эмблем|mark|знак/i
/** Checked before LOGO_NAME ("watermark", "водяной знак" would match it too). */
const WATERMARK_NAME = /water\s*-?\s*mark|вот[еэ]р[км]|водян\S*\s*знак/i
/** After Effects names layers converted from Illustrator artwork "… Outlines" / "Кривые …". */
const ARTWORK_NAME = /outlines|кривые|контуры/i

/** A name as text (damaged files may hold numbers or objects there). */
function textOf(name: unknown): string {
  return typeof name === 'string' ? name.trim() : ''
}

/** How a name reads: a watermark, a logo, or neither. */
function nameKind(name: unknown): 'watermark' | 'logo' | null {
  if (typeof name !== 'string' || !name) return null
  if (WATERMARK_NAME.test(name)) return 'watermark'
  return LOGO_NAME.test(name) ? 'logo' : null
}

interface CompInfo {
  vector: boolean
  paths: number
  layers: number
  /** A layer is named like a logo. */
  named: boolean
  /** Contains layers converted from Illustrator artwork. */
  artwork: boolean
}

function countPaths(items: readonly ShapeItem[] | undefined, depth = 0): number {
  if (!Array.isArray(items) || depth > 32) return 0
  let n = 0
  for (const item of items) {
    if (!item || item.hd === true) continue
    if (item.ty === 'gr') n += countPaths(item.it, depth + 1)
    else if (GEOMETRY_TYPES.has(item.ty)) n++
  }
  return n
}

function compInfo(
  anim: Animation,
  compId: string,
  cache: Map<string, CompInfo>,
  visiting = new Set<string>(),
): CompInfo {
  const cached = cache.get(compId)
  if (cached) return cached
  const info: CompInfo = { vector: true, paths: 0, layers: 0, named: false, artwork: false }
  const found = findPrecomp(anim, compId)
  if (!found || visiting.has(compId)) return { ...info, vector: false }
  visiting.add(compId)
  info.named = nameKind(found.asset.nm) === 'logo'
  for (const layer of found.asset.layers ?? []) {
    if (!layer || layer.hd === true) continue
    info.layers++
    // A watermark inside does not make the whole composition a logo.
    if (nameKind(layer.nm) === 'logo') info.named = true
    if (ARTWORK_NAME.test(layer.nm ?? '')) info.artwork = true
    if (layer.ty === LayerType.Shape) info.paths += countPaths((layer as ShapeLayer).shapes)
    else if (layer.ty === LayerType.Precomp) {
      const inner = compInfo(anim, (layer as PrecompLayer).refId, cache, visiting)
      info.vector &&= inner.vector
      info.paths += inner.paths
      info.layers += inner.layers
      info.named ||= inner.named
      info.artwork ||= inner.artwork
    } else if (layer.ty !== LayerType.Null && layer.ty !== LayerType.Text) info.vector = false
  }
  visiting.delete(compId)
  cache.set(compId, info)
  return info
}

/** Matrix and frame mapping a layer's own space to the root composition (first instance chain). */
function toRoot(
  anim: Animation,
  layerPath: NodePath,
  frame: number,
): { matrix: Matrix2D; frame: number } | null {
  let m = worldMatrix(anim, layerPath, frame)
  let path = layerPath
  let f = frame
  for (let depth = 0; depth < 16; depth++) {
    const assetIndex = compAssetIndexOf(path)
    if (assetIndex === null) return { matrix: m, frame: f }
    const asset = anim.assets?.[assetIndex]
    const instance = asset ? firstInstance(anim, asset.id) : null
    if (!instance) return null
    const layer = getAt<PrecompLayer>(anim, instance) as PrecompLayer
    const outer = precompOuterFrame(layer, f)
    if (outer === null) return null
    f = outer
    m = multiplyMatrices(worldMatrix(anim, instance, f), m)
    path = instance
  }
  return null
}

function transformedBox(box: Box, m: Matrix2D): Box {
  const acc = new BoundsAccumulator()
  for (const [x, y] of [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ])
    acc.addPoint(...applyMatrix(m, x, y))
  return acc.toBox() ?? box
}

/** Where an element rests: its representative frame and bounds, and both in root terms. */
export interface ElementPlacement {
  /** Representative frame (time of the composition containing the element). */
  frame: number
  /** Bounds at `frame` in the element's own space. */
  bounds: Box
  /** Same moment in root time, and the bounds in root composition space (null when unreachable). */
  rootFrame: number | null
  rootBounds: Box | null
}

/**
 * Measures any replaceable element the way candidates are measured (e.g. an element the user
 * picked). Null when it cannot be replaced or draws nothing.
 */
export function measureElement(
  anim: Animation,
  path: NodePath,
  maxSamples = 24,
): ElementPlacement | null {
  const kind = replaceTargetKind(anim, path)
  if (!kind) return null
  const rep = representativeFrame(anim, path, maxSamples)
  if (!rep.bounds) return null
  const inner = kind === 'group' ? shapeContentMatrix(anim, path, rep.frame) : IDENTITY_MATRIX
  const root = toRoot(anim, layerPathOf(path) as NodePath, rep.frame)
  return {
    frame: rep.frame,
    bounds: rep.bounds,
    rootFrame: root ? root.frame : null,
    rootBounds: root ? transformedBox(rep.bounds, multiplyMatrices(root.matrix, inner)) : null,
  }
}

/**
 * Elements a "Customize" panel can offer to swap, logo-like first: precomps with compact
 * vector-only content (Illustrator artwork, logo names), shape layers / groups named like a logo
 * or packing many paths into a small area, image layers and text layers. Each comes with a
 * representative frame and bounds; an image or precomp used by several layers is listed once
 * (its best-placed instance, with `usage`).
 */
export function findReplaceableElements(
  anim: Animation,
  opts: { limit?: number } = {},
): Candidate[] {
  const limit = opts.limit ?? 50
  // A damaged file whose layers or assets are not lists has nothing to offer.
  if (!Array.isArray(anim.layers) || (anim.assets != null && !Array.isArray(anim.assets))) return []
  const compArea = Math.max(1, anim.w * anim.h)
  const cache = new Map<string, CompInfo>()
  const usage = new Map<string, number>()
  forEachLayer(anim, (layer) => {
    const ref = (layer as { refId?: string }).refId
    if (ref !== undefined) usage.set(ref, (usage.get(ref) ?? 0) + 1)
  })
  type Draft = Omit<Candidate, 'frame' | 'bounds' | 'rootFrame' | 'rootBounds'>
  const drafts: Draft[] = []
  const claimed = new Set<string>()

  forEachLayer(anim, (layer, path) => {
    if (!layer || layer.hd === true || layer.td) return
    const naming = nameKind(layer.nm)
    const nameMatch = naming === 'logo'
    const watermark = naming === 'watermark'
    const base = { path, name: textOf(layer.nm), reasons: [] as CandidateReason[] }
    switch (layer.ty) {
      case LayerType.Image: {
        const refId = (layer as { refId?: string }).refId
        const asset = findAsset(anim, refId)?.asset
        if (!asset || !isImageAsset(asset)) return
        drafts.push({
          ...base,
          name: base.name || asset.nm || asset.id,
          target: 'image-layer',
          kind: watermark ? 'watermark' : 'image',
          score: 60 + (nameMatch ? 30 : 0),
          reasons: nameMatch ? ['image', 'name'] : watermark ? ['image', 'watermark'] : ['image'],
          assetId: asset.id,
          usage: usage.get(asset.id) ?? 1,
        })
        return
      }
      case LayerType.Text:
        drafts.push({
          ...base,
          name: base.name || 'Text',
          target: 'text-layer',
          kind: 'text',
          score: 40 + (nameMatch ? 20 : 0),
          reasons: nameMatch ? ['text', 'name'] : ['text'],
        })
        return
      case LayerType.Precomp: {
        const refId = (layer as PrecompLayer).refId
        const info = compInfo(anim, refId, cache)
        if (!info.vector || info.paths === 0) return
        const reasons: CandidateReason[] = ['vector-precomp']
        let score = 30
        const marked = watermark || nameKind(findPrecomp(anim, refId)?.asset.nm) === 'watermark'
        if (marked) {
          score += 20
          reasons.push('watermark')
        } else if (nameMatch || info.named) {
          score += 50
          reasons.push('name')
        }
        if (info.artwork) {
          score += 15
          reasons.push('artwork')
        }
        if (info.paths >= 3) {
          score += 10
          reasons.push('detailed')
        }
        if (info.layers > 12) score -= 20
        // The same precomp placed many times is decoration (particles, splashes), not a logo.
        if ((usage.get(refId) ?? 1) > 2) score -= 25
        drafts.push({
          ...base,
          name: base.name || refId,
          target: 'precomp-layer',
          kind: marked ? 'watermark' : 'logo',
          score,
          reasons,
          assetId: refId,
          usage: usage.get(refId) ?? 1,
        })
        return
      }
      case LayerType.Shape: {
        const shapes = (layer as ShapeLayer).shapes
        const paths = countPaths(shapes)
        if (paths === 0) return
        const reasons: CandidateReason[] = []
        let score = 0
        if (watermark) {
          score += 20
          reasons.push('watermark')
        } else if (nameMatch) {
          score += 50
          reasons.push('name')
        }
        if (ARTWORK_NAME.test(layer.nm ?? '')) {
          score += 15
          reasons.push('artwork')
        }
        if (paths >= 3) {
          score += 10 + Math.min(10, paths / 2)
          reasons.push('detailed')
        }
        drafts.push({
          ...base,
          name: base.name || 'Shape Layer',
          target: 'shape-layer',
          kind: watermark ? 'watermark' : 'vector',
          score,
          reasons,
        })
        // Groups named like a logo (or a watermark) inside any shape layer.
        shapes.forEach((item, i) => {
          if (item?.ty !== 'gr' || item.hd === true || countPaths(item.it) === 0) return
          const groupNaming = nameKind(item.nm)
          if (!groupNaming) return
          drafts.push({
            path: [...path, 'shapes', i],
            name: textOf(item.nm) || 'Group',
            target: 'group',
            kind: groupNaming === 'watermark' ? 'watermark' : 'vector',
            score: groupNaming === 'watermark' ? 25 : 55,
            reasons: [groupNaming === 'watermark' ? 'watermark' : 'name'],
          })
        })
        return
      }
      default:
        return
    }
  })

  // Measure (representative frame, bounds, root placement) and apply compactness.
  const measured: Candidate[] = []
  for (const d of drafts) {
    const placement = measureElement(anim, d.path, 24)
    if (!placement) continue
    const { bounds, rootBounds } = placement
    const fraction = rootBounds ? area(rootBounds) / compArea : area(bounds) / compArea
    let score = d.score
    const reasons = [...d.reasons]
    if (fraction > 0 && fraction <= 0.25) {
      score += Math.round(30 * (1 - fraction / 0.25))
      reasons.push('compact')
    } else if (fraction > 0.6 && d.kind !== 'image' && d.kind !== 'text') score -= 30
    let kind = d.kind
    if (d.kind === 'vector' || d.kind === 'logo') kind = score >= 50 ? 'logo' : 'vector'
    // Vector candidates must look like something worth swapping.
    if (kind === 'vector' && score < 30) continue
    measured.push({ ...d, kind, score, reasons, ...placement })
  }

  // A logo precomp covers its content: do not list the layers inside it separately.
  for (const c of measured)
    if (c.target === 'precomp-layer' && (c.kind === 'logo' || c.kind === 'watermark') && c.assetId)
      claimed.add(c.assetId)
  const visible = measured.filter((c) => {
    const index = compAssetIndexOf(c.path)
    if (index === null) return true
    const id = anim.assets?.[index]?.id
    return !(id && claimed.has(id) && c.kind !== 'image' && c.kind !== 'text')
  })
  const order: Record<CandidateKind, number> = {
    logo: 0,
    image: 1,
    watermark: 2,
    text: 3,
    vector: 4,
  }
  visible.sort((a, b) => b.score - a.score)
  const seenAssets = new Set<string>()
  const unique = visible.filter((c) => {
    if (!c.assetId) return true
    if (seenAssets.has(c.assetId)) return false
    seenAssets.add(c.assetId)
    return true
  })
  unique.sort(
    (a, b) => order[a.kind] - order[b.kind] || b.score - a.score || area(b.bounds) - area(a.bounds),
  )
  return unique.slice(0, limit)
}
