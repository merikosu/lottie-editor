/**
 * Canvas (artboard) operations: resize with an anchor, scale the content to a new size,
 * precompose the root, and fit the canvas to the visible content.
 *
 * Mutating functions change the animation they receive (use them inside an immer recipe or
 * on a copy). Bounds are computed on any document (prefer the frozen store document: reading
 * through immer drafts is much slower) and are conservative: they may be a little larger than
 * the rendered pixels, never smaller.
 */
import {
  evaluatePath,
  evaluatePosition,
  evaluateScalar,
  evaluateTextDocument,
  evaluateVector,
  getKeyframes,
} from './property'
import { precompInnerFrame } from './time'
import type {
  Animation,
  Effect,
  EllipseShape,
  GroupShape,
  Keyframe,
  Layer,
  Mask,
  PathShape,
  PositionProperty,
  PrecompAsset,
  PrecompLayer,
  RectShape,
  RepeaterShape,
  ScalarProperty,
  ShapeItem,
  StarShape,
  StrokeShape,
  GradientStrokeShape,
  TextLayer,
  Transform,
  TrimShape,
  VectorProperty,
} from './types'
import { LayerType, isImageAsset, isPrecompAsset, isPrecompLayer, isSplitPosition } from './types'
import type { NodePath } from './path'

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function round(v: number, decimals = 3): number {
  const f = 10 ** decimals
  const r = Math.round(v * f) / f
  return Object.is(r, -0) ? 0 : r
}

/* -------------------------------------------------------------------------- */
/*                                   Anchors                                  */
/* -------------------------------------------------------------------------- */

export type Anchor =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'

/** The nine anchors in reading order (a 3 × 3 grid). */
export const ANCHORS: readonly Anchor[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
]

/** Horizontal/vertical position of an anchor: 0 (left/top), 0.5 (center) or 1 (right/bottom). */
export function anchorFactors(anchor: Anchor): { x: number; y: number } {
  const index = Math.max(0, ANCHORS.indexOf(anchor))
  return { x: (index % 3) / 2, y: Math.floor(index / 3) / 2 }
}

/* -------------------------------------------------------------------------- */
/*                                Moving content                              */
/* -------------------------------------------------------------------------- */

function shiftVector(v: unknown, dx: number, dy: number): unknown {
  if (!Array.isArray(v) || !isNum(v[0])) return v
  const out = [...v] as number[]
  out[0] = round(out[0] + dx)
  out[1] = round((isNum(out[1]) ? out[1] : 0) + dy)
  return out
}

function shiftScalar(v: unknown, d: number): unknown {
  if (isNum(v)) return round(v + d)
  if (Array.isArray(v) && isNum(v[0])) return [round(v[0] + d), ...v.slice(1)]
  return v
}

/**
 * Replaces the keyframes with shifted copies. New objects matter: the evaluator caches motion
 * paths per keyframe object, so values must never change inside an object it has seen.
 */
function shiftKeyframes(
  kfs: Keyframe<unknown>[],
  shift: (v: unknown) => unknown,
): Keyframe<unknown>[] {
  return kfs.map((kf) => {
    const next = { ...kf }
    if (kf.s !== undefined) next.s = shift(kf.s)
    if (kf.e !== undefined) next.e = shift(kf.e)
    return next
  })
}

function offsetVectorProperty(prop: VectorProperty, dx: number, dy: number): void {
  const kfs = getKeyframes(prop)
  if (!kfs) {
    prop.k = shiftVector(prop.k, dx, dy) as number[]
    return
  }
  prop.k = shiftKeyframes(kfs, (v) => shiftVector(v, dx, dy)) as never
}

function offsetScalarProperty(prop: ScalarProperty, d: number): void {
  const kfs = getKeyframes(prop)
  if (!kfs) {
    prop.k = shiftScalar(prop.k, d) as number
    return
  }
  prop.k = shiftKeyframes(kfs, (v) => shiftScalar(v, d)) as never
}

/** Moves a position property (static, animated or split into X/Y) by (dx, dy). */
export function offsetPosition(ks: Transform, dx: number, dy: number): void {
  const p = ks.p as PositionProperty | undefined
  if (!p) {
    ks.p = { a: 0, k: [round(dx), round(dy), 0] }
  } else if (isSplitPosition(p)) {
    offsetScalarProperty(p.x, dx)
    offsetScalarProperty(p.y, dy)
  } else {
    offsetVectorProperty(p, dx, dy)
  }
}

/** Index set of layers that exist in a composition (parent references to others are void). */
function layerInds(layers: readonly Layer[]): Set<number> {
  return new Set(layers.map((l) => l.ind).filter(isNum))
}

/** True if the layer's parent exists in the same composition (it then moves with it). */
function hasParent(layer: Layer, inds: Set<number>): boolean {
  return isNum(layer.parent) && layer.parent !== layer.ind && inds.has(layer.parent)
}

/**
 * Moves the whole content of the root composition by (dx, dy) pixels: every root layer
 * without a parent gets its position offset (children follow their parents). Camera layers
 * also move their point of interest, which is in composition space.
 */
export function translateContent(anim: Animation, dx: number, dy: number): void {
  if (!dx && !dy) return
  const layers = anim.layers ?? []
  const inds = layerInds(layers)
  for (const layer of layers) {
    if (hasParent(layer, inds)) continue
    if (!layer.ks) layer.ks = {}
    offsetPosition(layer.ks, dx, dy)
    if (layer.ty === LayerType.Camera && layer.ks.a) offsetVectorProperty(layer.ks.a, dx, dy)
  }
}

/* -------------------------------------------------------------------------- */
/*                                 Precompose                                 */
/* -------------------------------------------------------------------------- */

/** First free asset id of the form `${prefix}${n}` (bodymovin uses comp_0, comp_1, …). */
export function uniqueAssetId(anim: Animation, prefix = 'comp_'): string {
  const used = new Set((anim.assets ?? []).map((a) => a.id))
  let n = 0
  while (used.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

/**
 * Moves every root layer into a new precomp asset (same size as the canvas) and replaces
 * them with a single precomp layer that shows it 1:1. Parenting, mattes and timing are
 * untouched (the layer has st = 0, so inner time = root time).
 */
export function precomposeRoot(
  anim: Animation,
  opts: { name: string },
): { assetIndex: number; layer: PrecompLayer } {
  const id = uniqueAssetId(anim)
  const asset: PrecompAsset = { id, nm: opts.name, fr: anim.fr, layers: anim.layers ?? [] }
  if (!Array.isArray(anim.assets)) anim.assets = []
  anim.assets.push(asset)
  const w = anim.w
  const h = anim.h
  const layer: PrecompLayer = {
    ddd: 0,
    ind: 1,
    ty: 0,
    nm: opts.name,
    refId: id,
    sr: 1,
    ks: {
      o: { a: 0, k: 100 },
      r: { a: 0, k: 0 },
      p: { a: 0, k: [round(w / 2), round(h / 2), 0] },
      a: { a: 0, k: [round(w / 2), round(h / 2), 0] },
      s: { a: 0, k: [100, 100, 100] },
    },
    ao: 0,
    w,
    h,
    ip: anim.ip,
    op: anim.op,
    st: 0,
    bm: 0,
  }
  anim.layers = [layer]
  return { assetIndex: anim.assets.length - 1, layer: anim.layers[0] as PrecompLayer }
}

/** Rewrites a path into the root composition after `precomposeRoot` moved it to an asset. */
export function pathAfterPrecompose(path: NodePath, assetIndex: number): NodePath {
  return path[0] === 'layers' ? ['assets', assetIndex, ...path] : path
}

/* -------------------------------------------------------------------------- */
/*                                   Resize                                   */
/* -------------------------------------------------------------------------- */

export type ResizeMode = 'resize' | 'scale'

export interface ResizePlan {
  mode: ResizeMode
  width: number
  height: number
  /** Content offset in pixels (after scaling). */
  dx: number
  dy: number
  /** Uniform content scale (1 when resizing the canvas only). */
  scale: number
}

/**
 * Where the content ends up for a resize, without changing anything (for previews).
 * - resize: the old canvas is placed in the new one at `anchor`;
 * - scale: the content is scaled uniformly to fit and placed at `anchor` (center by default).
 */
export function planResize(
  from: { w: number; h: number },
  width: number,
  height: number,
  opts: { mode: ResizeMode; anchor?: Anchor },
): ResizePlan {
  const f = anchorFactors(opts.anchor ?? 'center')
  if (opts.mode === 'scale') {
    const scale = Math.min(width / from.w, height / from.h)
    return {
      mode: 'scale',
      width,
      height,
      scale,
      dx: round((width - from.w * scale) * f.x),
      dy: round((height - from.h * scale) * f.y),
    }
  }
  return {
    mode: 'resize',
    width,
    height,
    scale: 1,
    dx: round((width - from.w) * f.x),
    dy: round((height - from.h) * f.y),
  }
}

export interface ResizeOptions {
  mode: ResizeMode
  anchor?: Anchor
  /** Name of the precomp created by 'scale' mode. */
  name?: string
}

export interface ResizeResult extends ResizePlan {
  /** Asset index of the precomp created by 'scale' mode (null when none was created). */
  precompAssetIndex: number | null
}

/** A root that is a single, statically transformed precomp layer can be scaled in place. */
function scalableRootLayer(anim: Animation): PrecompLayer | null {
  const layers = anim.layers ?? []
  if (layers.length !== 1) return null
  const layer = layers[0]
  if (!isPrecompLayer(layer) || isNum(layer.parent) || layer.ao === 1) return null
  const ks = layer.ks ?? {}
  const props = [ks.p, ks.s, ks.a, ks.r]
  for (const p of props) {
    if (!p) continue
    if (isSplitPosition(p as PositionProperty)) return null
    const prop = p as { k: unknown; x?: string }
    if (getKeyframes(prop) || (typeof prop.x === 'string' && prop.x.trim())) return null
  }
  return layer
}

/** True when 'scale' mode has to precompose the root layers (they are then grouped). */
export function scaleNeedsPrecomp(anim: Animation): boolean {
  return scalableRootLayer(anim) === null
}

function staticVector(prop: VectorProperty | undefined, fallback: number[]): number[] {
  const k = prop?.k
  if (Array.isArray(k) && isNum(k[0])) return k as number[]
  if (isNum(k)) return [k, k]
  return fallback
}

/**
 * Changes the canvas size.
 * - 'resize': content keeps its size and moves with the anchor (the canvas grows or crops);
 * - 'scale': content is scaled uniformly to fit the new size and placed at the anchor. The
 *   root layers are precomposed into one scaled precomp layer (robust with mattes, parents
 *   and expressions); a root that already is a single static precomp layer is scaled in place
 *   instead of nesting another precomp.
 */
export function resizeCanvas(
  anim: Animation,
  width: number,
  height: number,
  opts: ResizeOptions,
): ResizeResult {
  if (!(width > 0) || !(height > 0)) throw new RangeError('The canvas size must be positive')
  const w = Math.round(width)
  const h = Math.round(height)
  const plan = planResize({ w: anim.w, h: anim.h }, w, h, opts)
  let precompAssetIndex: number | null = null

  if (plan.mode === 'resize') {
    translateContent(anim, plan.dx, plan.dy)
  } else if (Math.abs(plan.scale - 1) > 1e-9 || plan.dx || plan.dy) {
    const s = plan.scale
    let layer = scalableRootLayer(anim)
    if (!layer) {
      const result = precomposeRoot(anim, { name: opts.name ?? 'Scaled content' })
      layer = result.layer
      precompAssetIndex = result.assetIndex
    }
    // Content point x maps to s·x + (dx, dy): apply that to the layer's position and scale.
    // A uniform scale commutes with the layer's rotation/skew, so this is exact.
    const ks = (layer.ks ??= {})
    const p = staticVector(ks.p as VectorProperty | undefined, [0, 0, 0])
    const sc = staticVector(ks.s, [100, 100, 100])
    ks.p = {
      ...(ks.p as VectorProperty | undefined),
      a: 0,
      k: [round(p[0] * s + plan.dx), round((p[1] ?? 0) * s + plan.dy), ...p.slice(2)],
    }
    ks.s = {
      ...ks.s,
      a: 0,
      k: [round(sc[0] * s, 4), round((sc[1] ?? sc[0]) * s, 4), ...sc.slice(2)],
    }
  }

  anim.w = w
  anim.h = h
  return { ...plan, width: w, height: h, precompAssetIndex }
}

/* -------------------------------------------------------------------------- */
/*                                   Geometry                                 */
/* -------------------------------------------------------------------------- */

/** 2D affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
type Mat = readonly [number, number, number, number, number, number]

const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ]
}

const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y]
const scale = (x: number, y: number): Mat => [x, 0, 0, y, 0, 0]
function rotate(deg: number): Mat {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [c, s, -s, c, 0, 0]
}
const skewX = (deg: number): Mat => [1, 0, Math.tan((deg * Math.PI) / 180), 1, 0, 0]

/** Largest scale factor of a matrix (to convert layer-space distances to world space). */
function maxScale(m: Mat): number {
  return Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]))
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Axis-aligned bounds accumulator. */
class Box {
  minX = Infinity
  minY = Infinity
  maxX = -Infinity
  maxY = -Infinity

  get empty(): boolean {
    return !(this.maxX >= this.minX && this.maxY >= this.minY)
  }

  add(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < this.minX) this.minX = x
    if (y < this.minY) this.minY = y
    if (x > this.maxX) this.maxX = x
    if (y > this.maxY) this.maxY = y
  }

  /** Adds the local rectangle [x0, y0, x1, y1] transformed by `m`. */
  addRect(m: Mat, x0: number, y0: number, x1: number, y1: number): void {
    for (const [x, y] of [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ]) {
      this.add(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
    }
  }

  union(other: Box): void {
    if (other.empty) return
    this.add(other.minX, other.minY)
    this.add(other.maxX, other.maxY)
  }

  intersect(other: Box): void {
    if (other.empty) {
      this.clear()
      return
    }
    this.minX = Math.max(this.minX, other.minX)
    this.minY = Math.max(this.minY, other.minY)
    this.maxX = Math.min(this.maxX, other.maxX)
    this.maxY = Math.min(this.maxY, other.maxY)
    if (this.empty) this.clear()
  }

  expand(d: number): void {
    if (this.empty || !(d > 0)) return
    this.minX -= d
    this.minY -= d
    this.maxX += d
    this.maxY += d
  }

  clear(): void {
    this.minX = Infinity
    this.minY = Infinity
    this.maxX = -Infinity
    this.maxY = -Infinity
  }

  toRect(): Rect | null {
    if (this.empty) return null
    return {
      x: this.minX,
      y: this.minY,
      width: this.maxX - this.minX,
      height: this.maxY - this.minY,
    }
  }
}

/** Local bounds [x0, y0, x1, y1]. */
type Local = [number, number, number, number]

/* ------------------------------- Transforms ------------------------------- */

/** Direction of motion (degrees) of an animated position, for auto-oriented layers. */
function motionAngle(p: PositionProperty | undefined, frame: number): number {
  if (!p) return 0
  const a = evaluatePosition(p, frame - 0.05)
  const b = evaluatePosition(p, frame + 0.05)
  const dx = (b[0] ?? 0) - (a[0] ?? 0)
  const dy = (b[1] ?? 0) - (a[1] ?? 0)
  return dx === 0 && dy === 0 ? 0 : (Math.atan2(dy, dx) * 180) / Math.PI
}

/**
 * Matrix of a layer or group transform at `frame`, matching lottie-web:
 * T(p) · R(r) · R(−sa) · SkewX(−sk) · R(sa) · S(s/100) · T(−a). 3D rotations around X/Y
 * only shrink the projection and are ignored (conservative).
 */
function transformMatrix(tr: Transform | undefined, frame: number, autoOrient = false): Mat {
  if (!tr) return IDENTITY
  const p = evaluatePosition(tr.p, frame)
  const a = evaluateVector(tr.a, frame, [0, 0])
  const s = evaluateVector(tr.s, frame, [100, 100])
  let r = tr.r ? evaluateScalar(tr.r, frame) : tr.rz ? evaluateScalar(tr.rz, frame) : 0
  if (tr.or) r += evaluateVector(tr.or, frame, [0, 0, 0])[2] ?? 0
  if (autoOrient) r += motionAngle(tr.p, frame)
  const sk = tr.sk ? evaluateScalar(tr.sk, frame) : 0
  let m = translate(p[0] ?? 0, p[1] ?? 0)
  if (r) m = mul(m, rotate(r))
  if (sk) {
    const sa = tr.sa ? evaluateScalar(tr.sa, frame) : 0
    m = mul(mul(mul(m, rotate(-sa)), skewX(-sk)), rotate(sa))
  }
  m = mul(m, scale((s[0] ?? 100) / 100, (s[1] ?? s[0] ?? 100) / 100))
  const ax = a[0] ?? 0
  const ay = a[1] ?? 0
  return ax || ay ? mul(m, translate(-ax, -ay)) : m
}

/* ---------------------------------- Shapes --------------------------------- */

type Pt = readonly [number, number]
/** Absolute cubic bezier segment: start, out handle, in handle, end. */
type Segment = readonly [Pt, Pt, Pt, Pt]

const MODIFIERS = new Set(['gr', 'tr', 'tm', 'rp', 'rd', 'mm', 'op', 'pb', 'tw', 'zz'])
const GEOMETRY = new Set(['rc', 'el', 'sr', 'sh'])

/** lottie-web honours `hd` on shapes and styles, not on groups or modifiers. */
function isHidden(item: ShapeItem): boolean {
  return item.hd === true && !MODIFIERS.has(item.ty)
}

/** Visible part of a path under Trim Paths, as lottie-web computes it (length fractions). */
interface Trim {
  start: number
  end: number
  /** Trims several shapes as one sequence (m = 2): not measured per shape. */
  sequential: boolean
}

interface ShapeContext {
  /** Some fill or stroke applies at this level (paths without paint render nothing). */
  paint: boolean
  /** Distance the paint reaches outside the geometry (half stroke width, miters). */
  stroke: number
  /** Growth from offset path / zig zag modifiers. */
  grow: number
  /** Relative growth from pucker & bloat. */
  bloat: number
  /** Trims from enclosing groups that apply to everything at this level. */
  trims: Trim[]
}

function strokeReach(item: StrokeShape | GradientStrokeShape, frame: number): number {
  const half = Math.abs(evaluateScalar(item.w, frame, 0)) / 2
  let factor = 1
  if (item.lj === 1) {
    const ml = isNum(item.ml) ? item.ml : item.ml2 ? evaluateScalar(item.ml2, frame, 4) : 4
    factor = Math.min(Math.max(ml, 1), 10)
  }
  if (item.lc === 3) factor = Math.max(factor, Math.SQRT2)
  return half * factor
}

function clamp01(v: number): number {
  return v > 1 ? 1 : v < 0 ? 0 : v
}

function trimOf(item: TrimShape, frame: number, sequential: boolean): Trim {
  let offset = (evaluateScalar(item.o, frame, 0) % 360) / 360
  if (offset < 0) offset += 1
  let start = clamp01(evaluateScalar(item.s, frame, 0) / 100) + offset
  let end = clamp01(evaluateScalar(item.e, frame, 100) / 100) + offset
  if (start > end) [start, end] = [end, start]
  return { start: Math.round(start * 1e4) / 1e4, end: Math.round(end * 1e4) / 1e4, sequential }
}

/** Visible length fractions of a trimmed path; null means the whole path. */
function trimIntervals({ start: s, end: e }: Trim): [number, number][] | null {
  if (e === s) return []
  if ((e === 1 && s === 0) || (e === 0 && s === 1)) return null
  if (e <= 1) return [[s, e]]
  if (s >= 1) return [[s - 1, e - 1]]
  return [
    [s, 1],
    [0, e - 1],
  ]
}

function countGeometry(items: readonly ShapeItem[]): number {
  let n = 0
  for (const item of items) {
    if (!item || isHidden(item)) continue
    if (GEOMETRY.has(item.ty)) n++
    else if (item.ty === 'gr') n += countGeometry(item.it ?? [])
  }
  return n
}

/* -------------------------- Paths as lottie-web builds them -------------------------- */

/** lottie-web's circle handle ratio. */
const KAPPA = 0.5519

interface AbsPath {
  v: Pt[]
  i: Pt[]
  o: Pt[]
  c: boolean
}

function pathBuilder(closed: boolean) {
  const path: AbsPath = { v: [], i: [], o: [], c: closed }
  // Same argument order as lottie-web's setTripleAt: vertex, out handle, in handle.
  const add = (vx: number, vy: number, ox: number, oy: number, ix: number, iy: number) => {
    path.v.push([vx, vy])
    path.o.push([ox, oy])
    path.i.push([ix, iy])
  }
  return { path, add }
}

function rectPath(item: RectShape, frame: number): AbsPath {
  const [p0, p1] = evaluateVector(item.p, frame, [0, 0])
  const size = evaluateVector(item.s, frame, [0, 0])
  const v0 = (size[0] ?? 0) / 2
  const v1 = (size[1] ?? size[0] ?? 0) / 2
  const radius = Math.min(v0, v1, evaluateScalar(item.r, frame, 0))
  const cp = radius * (1 - KAPPA)
  const { path, add } = pathBuilder(true)
  if (item.d === 2 || item.d === 1) {
    add(p0 + v0, p1 - v1 + radius, p0 + v0, p1 - v1 + radius, p0 + v0, p1 - v1 + cp)
    add(p0 + v0, p1 + v1 - radius, p0 + v0, p1 + v1 - cp, p0 + v0, p1 + v1 - radius)
    if (radius !== 0) {
      add(p0 + v0 - radius, p1 + v1, p0 + v0 - radius, p1 + v1, p0 + v0 - cp, p1 + v1)
      add(p0 - v0 + radius, p1 + v1, p0 - v0 + cp, p1 + v1, p0 - v0 + radius, p1 + v1)
      add(p0 - v0, p1 + v1 - radius, p0 - v0, p1 + v1 - radius, p0 - v0, p1 + v1 - cp)
      add(p0 - v0, p1 - v1 + radius, p0 - v0, p1 - v1 + cp, p0 - v0, p1 - v1 + radius)
      add(p0 - v0 + radius, p1 - v1, p0 - v0 + radius, p1 - v1, p0 - v0 + cp, p1 - v1)
      add(p0 + v0 - radius, p1 - v1, p0 + v0 - cp, p1 - v1, p0 + v0 - radius, p1 - v1)
    } else {
      add(p0 - v0, p1 + v1, p0 - v0 + cp, p1 + v1, p0 - v0, p1 + v1)
      add(p0 - v0, p1 - v1, p0 - v0, p1 - v1 + cp, p0 - v0, p1 - v1)
    }
  } else {
    add(p0 + v0, p1 - v1 + radius, p0 + v0, p1 - v1 + cp, p0 + v0, p1 - v1 + radius)
    if (radius !== 0) {
      add(p0 + v0 - radius, p1 - v1, p0 + v0 - radius, p1 - v1, p0 + v0 - cp, p1 - v1)
      add(p0 - v0 + radius, p1 - v1, p0 - v0 + cp, p1 - v1, p0 - v0 + radius, p1 - v1)
      add(p0 - v0, p1 - v1 + radius, p0 - v0, p1 - v1 + radius, p0 - v0, p1 - v1 + cp)
      add(p0 - v0, p1 + v1 - radius, p0 - v0, p1 + v1 - cp, p0 - v0, p1 + v1 - radius)
      add(p0 - v0 + radius, p1 + v1, p0 - v0 + radius, p1 + v1, p0 - v0 + cp, p1 + v1)
      add(p0 + v0 - radius, p1 + v1, p0 + v0 - cp, p1 + v1, p0 + v0 - radius, p1 + v1)
      add(p0 + v0, p1 + v1 - radius, p0 + v0, p1 + v1 - radius, p0 + v0, p1 + v1 - cp)
    } else {
      add(p0 - v0, p1 - v1, p0 - v0 + cp, p1 - v1, p0 - v0, p1 - v1)
      add(p0 - v0, p1 + v1, p0 - v0, p1 + v1 - cp, p0 - v0, p1 + v1)
      add(p0 + v0, p1 + v1, p0 + v0 - cp, p1 + v1, p0 + v0, p1 + v1)
    }
  }
  return path
}

function ellipsePath(item: EllipseShape, frame: number): AbsPath {
  const [p0, p1] = evaluateVector(item.p, frame, [0, 0])
  const size = evaluateVector(item.s, frame, [0, 0])
  const s0 = (size[0] ?? 0) / 2
  const s1 = (size[1] ?? size[0] ?? 0) / 2
  const cw = item.d !== 3
  const x = (k: number) => (cw ? k : -k)
  return {
    c: true,
    v: [
      [p0, p1 - s1],
      [p0 + x(s0), p1],
      [p0, p1 + s1],
      [p0 - x(s0), p1],
    ],
    i: [
      [p0 - x(s0 * KAPPA), p1 - s1],
      [p0 + x(s0), p1 - s1 * KAPPA],
      [p0 + x(s0 * KAPPA), p1 + s1],
      [p0 - x(s0), p1 + s1 * KAPPA],
    ],
    o: [
      [p0 + x(s0 * KAPPA), p1 - s1],
      [p0 + x(s0), p1 + s1 * KAPPA],
      [p0 - x(s0 * KAPPA), p1 + s1],
      [p0 - x(s0), p1 - s1 * KAPPA],
    ],
  }
}

function starPath(item: StarShape, frame: number): AbsPath {
  const [px, py] = evaluateVector(item.p, frame, [0, 0])
  const star = item.sy !== 2
  const points = Math.floor(evaluateScalar(item.pt, frame, 5))
  const count = star ? points * 2 : points
  const dir = item.d === 3 ? -1 : 1
  const outer = evaluateScalar(item.or, frame, 0)
  const inner = star && item.ir ? evaluateScalar(item.ir, frame, 0) : outer
  const outerRound = evaluateScalar(item.os, frame, 0) / 100
  const innerRound = star && item.is ? evaluateScalar(item.is, frame, 0) / 100 : outerRound
  const angle = (Math.PI * 2) / Math.max(1, count)
  let current = -Math.PI / 2 + (evaluateScalar(item.r, frame, 0) * Math.PI) / 180
  const { path, add } = pathBuilder(true)
  for (let n = 0; n < count; n++) {
    const long = !star || n % 2 === 0
    const rad = long ? outer : inner
    const roundness = long ? outerRound : innerRound
    const perim = star ? (2 * Math.PI * rad) / (count * 2) : (2 * Math.PI * rad) / (count * 4)
    const x = rad * Math.cos(current)
    const y = rad * Math.sin(current)
    const len = Math.hypot(x, y)
    const ox = len === 0 ? 0 : y / len
    const oy = len === 0 ? 0 : -x / len
    const k = perim * roundness * dir
    add(x + px, y + py, x + px - ox * k, y + py - oy * k, x + px + ox * k, y + py + oy * k)
    current += angle * dir
  }
  return path
}

function shapePath(item: PathShape, frame: number): AbsPath | null {
  const p = evaluatePath(item.ks, frame)
  if (!p || !Array.isArray(p.v) || p.v.length === 0) return null
  const v = p.v.map((pt) => [pt[0] ?? 0, pt[1] ?? 0] as Pt)
  const rel = (list: number[][] | undefined, k: number): Pt => {
    const d = list?.[k]
    return [v[k][0] + (d?.[0] ?? 0), v[k][1] + (d?.[1] ?? 0)]
  }
  return { v, i: v.map((_, k) => rel(p.i, k)), o: v.map((_, k) => rel(p.o, k)), c: !!p.c }
}

function geometryPath(item: ShapeItem, frame: number): AbsPath | null {
  switch (item.ty) {
    case 'rc':
      return rectPath(item, frame)
    case 'el':
      return ellipsePath(item, frame)
    case 'sr':
      return starPath(item, frame)
    case 'sh':
      return shapePath(item, frame)
    default:
      return null
  }
}

function segmentsOf(path: AbsPath): Segment[] {
  const { v, i, o } = path
  if (v.length === 1) return [[v[0], v[0], v[0], v[0]]]
  const out: Segment[] = []
  for (let k = 0; k < v.length - 1; k++) out.push([v[k], o[k], i[k + 1], v[k + 1]])
  if (path.c && v.length > 1) out.push([v[v.length - 1], o[v.length - 1], i[0], v[0]])
  return out
}

/* ------------------------------ Bezier helpers ------------------------------ */

function bezier(a: number, b: number, c: number, d: number, t: number): number {
  const mt = 1 - t
  return mt * mt * mt * a + 3 * mt * mt * t * b + 3 * mt * t * t * c + t * t * t * d
}

/** Exact [min, max] of one coordinate of a cubic bezier (roots of the derivative). */
function cubicRange(a: number, b: number, c: number, d: number): [number, number] {
  let lo = Math.min(a, d)
  let hi = Math.max(a, d)
  // The curve can only leave [a, d] if a handle does.
  if (b >= lo && b <= hi && c >= lo && c <= hi) return [lo, hi]
  const qa = -a + 3 * b - 3 * c + d
  const qb = 2 * (a - 2 * b + c)
  const qc = b - a
  const check = (t: number) => {
    if (!(t > 0 && t < 1)) return
    const v = bezier(a, b, c, d, t)
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (Math.abs(qa) < 1e-12) {
    if (Math.abs(qb) > 1e-12) check(-qc / qb)
  } else {
    const disc = qb * qb - 4 * qa * qc
    if (disc >= 0) {
      const r = Math.sqrt(disc)
      check((-qb + r) / (2 * qa))
      check((-qb - r) / (2 * qa))
    }
  }
  return [lo, hi]
}

function transformPoint(m: Mat, p: Pt): Pt {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]
}

/** Adds the exact bounds of a segment transformed by `m` (affine maps keep beziers). */
function addSegment(box: Box, m: Mat, seg: Segment): void {
  const [p0, p1, p2, p3] = seg.map((p) => transformPoint(m, p))
  const [x0, x1] = cubicRange(p0[0], p1[0], p2[0], p3[0])
  const [y0, y1] = cubicRange(p0[1], p1[1], p2[1], p3[1])
  box.add(x0, y0)
  box.add(x1, y1)
}

const LENGTH_STEPS = 16

/** Cumulative arc length table of a segment (in its own coordinate space). */
function measure(seg: Segment): Float64Array {
  const table = new Float64Array(LENGTH_STEPS + 1)
  let prev = seg[0]
  for (let k = 1; k <= LENGTH_STEPS; k++) {
    const t = k / LENGTH_STEPS
    const pt: Pt = [
      bezier(seg[0][0], seg[1][0], seg[2][0], seg[3][0], t),
      bezier(seg[0][1], seg[1][1], seg[2][1], seg[3][1], t),
    ]
    table[k] = table[k - 1] + Math.hypot(pt[0] - prev[0], pt[1] - prev[1])
    prev = pt
  }
  return table
}

/** Bezier parameter at arc length `len` along a measured segment. */
function paramAt(table: Float64Array, len: number): number {
  const total = table[LENGTH_STEPS]
  if (len <= 0 || total <= 0) return 0
  if (len >= total) return 1
  let k = 1
  while (k < LENGTH_STEPS && table[k] < len) k++
  const span = table[k] - table[k - 1]
  const f = span > 0 ? (len - table[k - 1]) / span : 0
  return (k - 1 + f) / LENGTH_STEPS
}

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** Part [t0, t1] of a segment (de Casteljau). */
function subSegment(seg: Segment, t0: number, t1: number): Segment {
  const split = (s: Segment, t: number): [Segment, Segment] => {
    const p01 = lerpPt(s[0], s[1], t)
    const p12 = lerpPt(s[1], s[2], t)
    const p23 = lerpPt(s[2], s[3], t)
    const p012 = lerpPt(p01, p12, t)
    const p123 = lerpPt(p12, p23, t)
    const mid = lerpPt(p012, p123, t)
    return [
      [s[0], p01, p012, mid],
      [mid, p123, p23, s[3]],
    ]
  }
  const head = t1 < 1 ? split(seg, t1)[0] : seg
  return t0 > 0 && t1 > 0 ? split(head, t0 / t1)[1] : head
}

/** Adds the visible (trimmed) part of a path, trimming by fractions of its own length. */
function addTrimmedPath(box: Box, m: Mat, segments: Segment[], trim: Trim): void {
  const intervals = trimIntervals(trim)
  if (intervals === null) {
    for (const seg of segments) addSegment(box, m, seg)
    return
  }
  const tables = segments.map(measure)
  const total = tables.reduce((sum, t) => sum + t[LENGTH_STEPS], 0)
  if (!(total > 0)) {
    if (intervals.length) for (const seg of segments) addSegment(box, m, seg)
    return
  }
  for (const [a, b] of intervals) {
    const from = a * total
    const to = b * total
    if (!(to > from)) continue
    let offset = 0
    segments.forEach((seg, k) => {
      const len = tables[k][LENGTH_STEPS]
      const s0 = Math.max(from, offset)
      const s1 = Math.min(to, offset + len)
      if (s1 >= s0 && len > 0) {
        addSegment(
          box,
          m,
          subSegment(seg, paramAt(tables[k], s0 - offset), paramAt(tables[k], s1 - offset)),
        )
      }
      offset += len
    })
  }
}

function groupTransform(group: GroupShape): Transform | undefined {
  const items = group.it ?? []
  for (let i = items.length - 1; i >= 0; i--)
    if (items[i]?.ty === 'tr') return items[i] as Transform
  return undefined
}

/** Transform of repeater copy `n` (approximation of lottie-web's cumulative matrices). */
function repeaterCopy(rp: RepeaterShape, n: number, frame: number): Mat {
  const tr = rp.tr ?? {}
  const p = evaluatePosition(tr.p, frame)
  const a = evaluateVector(tr.a, frame, [0, 0])
  const s = evaluateVector(tr.s, frame, [100, 100])
  const r = tr.r ? evaluateScalar(tr.r, frame) : 0
  const sx = Math.sign(s[0] ?? 100) * Math.abs((s[0] ?? 100) / 100) ** n
  const sy = Math.sign(s[1] ?? 100) * Math.abs((s[1] ?? s[0] ?? 100) / 100) ** n
  let m = translate((p[0] ?? 0) * n + (a[0] ?? 0), (p[1] ?? 0) * n + (a[1] ?? 0))
  m = mul(m, rotate(r * n))
  m = mul(m, scale(Number.isFinite(sx) ? sx : 1, Number.isFinite(sy) ? sy : 1))
  return mul(m, translate(-(a[0] ?? 0), -(a[1] ?? 0)))
}

const MAX_REPEATER_COPIES = 64

function shapesBounds(
  items: ShapeItem[] | undefined,
  frame: number,
  m: Mat,
  box: Box,
  inherited: ShapeContext,
  depth: number,
): void {
  if (!Array.isArray(items) || depth > 48) return
  const ctx: ShapeContext = { ...inherited }
  let repeaterAt = -1
  // Trims modify the shapes above them (lower indices), including nested groups.
  const localTrims: { index: number; trim: Trim }[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item || isHidden(item)) continue
    switch (item.ty) {
      case 'fl':
      case 'gf':
        if (evaluateScalar(item.o, frame, 100) > 0) ctx.paint = true
        break
      case 'st':
      case 'gs':
        if (evaluateScalar(item.o, frame, 100) > 0) {
          ctx.paint = true
          ctx.stroke = Math.max(ctx.stroke, strokeReach(item, frame))
        }
        break
      case 'op':
        ctx.grow += Math.max(0, evaluateScalar(item.a, frame, 0))
        break
      case 'zz':
        ctx.grow += Math.abs(evaluateScalar(item.s, frame, 0))
        break
      case 'pb':
        ctx.bloat = Math.max(ctx.bloat, Math.abs(evaluateScalar(item.a, frame, 0)) / 100)
        break
      case 'rp':
        repeaterAt = i
        break
      case 'tm':
        localTrims.push({
          index: i,
          trim: trimOf(item, frame, item.m === 2 && countGeometry(items.slice(0, i)) > 1),
        })
        break
    }
  }
  const trimsFor = (index: number) => [
    ...inherited.trims,
    ...localTrims.filter((t) => t.index > index).map((t) => t.trim),
  ]

  const emit = (from: number, to: number, mm: Mat) => {
    for (let i = from; i < to; i++) {
      const item = items[i]
      if (!item || isHidden(item)) continue
      if (item.ty === 'gr') {
        const tr = groupTransform(item)
        if (tr?.o && evaluateScalar(tr.o, frame, 100) <= 0) continue
        const child = { ...ctx, trims: trimsFor(i) }
        shapesBounds(
          item.it,
          frame,
          tr ? mul(mm, transformMatrix(tr, frame)) : mm,
          box,
          child,
          depth + 1,
        )
        continue
      }
      if (!ctx.paint || !GEOMETRY.has(item.ty)) continue
      const path = geometryPath(item, frame)
      if (!path) continue
      const segments = segmentsOf(path)
      const geo = new Box()
      const trims = trimsFor(i)
      // One simple trim is measured exactly; stacked or sequential trims keep the whole path
      // (always a superset of what is drawn).
      if (trims.length === 1 && !trims[0].sequential) addTrimmedPath(geo, mm, segments, trims[0])
      else for (const seg of segments) addSegment(geo, mm, seg)
      if (geo.empty) continue
      if (ctx.bloat > 0) {
        const gx = ((geo.maxX - geo.minX) / 2) * ctx.bloat
        const gy = ((geo.maxY - geo.minY) / 2) * ctx.bloat
        geo.add(geo.minX - gx, geo.minY - gy)
        geo.add(geo.maxX + gx, geo.maxY + gy)
      }
      geo.expand((ctx.stroke + ctx.grow) * maxScale(mm))
      box.union(geo)
    }
  }

  if (repeaterAt >= 0) {
    const rp = items[repeaterAt] as RepeaterShape
    const copies = Math.min(
      MAX_REPEATER_COPIES,
      Math.ceil(Math.max(0, evaluateScalar(rp.c, frame, 0))),
    )
    const offset = rp.o ? evaluateScalar(rp.o, frame, 0) : 0
    for (let k = 0; k < copies; k++)
      emit(0, repeaterAt, mul(m, repeaterCopy(rp, k + offset, frame)))
    emit(repeaterAt + 1, items.length, m)
  } else {
    emit(0, items.length, m)
  }
}

/* ----------------------------------- Text ---------------------------------- */

function textBounds(layer: TextLayer, frame: number): Local | null {
  const doc = evaluateTextDocument(layer.t, frame)
  if (!doc || typeof doc.t !== 'string' || !doc.t) return null
  const size = Math.abs(doc.s || 0)
  if (!size) return null
  // lottie-web breaks lines on \r and ETX only.
  // oxlint-disable-next-line no-control-regex -- ETX (U+0003) is a line break in text documents
  const lines = doc.t.split(/\r|\u0003/)
  const lineHeight = Math.abs(doc.lh || size * 1.2)
  const tracking = Math.max(0, ((doc.tr ?? 0) / 1000) * size)
  const longest = Math.max(...lines.map((l) => l.length))
  // Generous average advance: wide glyphs and unknown fonts must not be cropped.
  const width = longest * (size * 0.72 + tracking)
  let local: Local
  if (Array.isArray(doc.sz) && doc.sz.length >= 2) {
    const ps = Array.isArray(doc.ps) ? doc.ps : [0, 0]
    local = [
      ps[0],
      ps[1],
      ps[0] + doc.sz[0],
      ps[1] + Math.max(doc.sz[1], lines.length * lineHeight),
    ]
  } else {
    const shift = -(doc.ls ?? 0)
    const y0 = -size * 1.05 + shift
    const y1 = (lines.length - 1) * lineHeight + size * 0.4 + shift
    if (doc.j === 1) local = [-width, y0, 0, y1]
    else if (doc.j === 2) local = [-width / 2, y0, width / 2, y1]
    else local = [0, y0, width, y1]
  }
  let pad = size * 0.1 + (doc.sw ? Math.abs(doc.sw) / 2 : 0)
  // Animators can move and scale glyphs: grow by their current offsets.
  for (const animator of (layer.t?.a ?? []) as {
    a?: { p?: VectorProperty; s?: VectorProperty }
  }[]) {
    const p = animator?.a?.p ? evaluateVector(animator.a.p, frame, [0, 0]) : [0, 0]
    pad += Math.hypot(p[0] ?? 0, p[1] ?? 0)
    if (animator?.a?.s) {
      const s = evaluateVector(animator.a.s, frame, [100, 100])
      pad += size * Math.max(0, Math.max(Math.abs(s[0] ?? 100), Math.abs(s[1] ?? 100)) / 100 - 1)
    }
  }
  return [local[0] - pad, local[1] - pad, local[2] + pad, local[3] + pad]
}

/* ------------------------------ Masks, effects ----------------------------- */

/** Visible area allowed by the masks (only when they all add up), in world space. */
function maskBox(layer: Layer, frame: number, m: Mat): Box | null {
  // lottie-web builds masks only when `hasMask` is set; otherwise they do not clip.
  const masks = (layer.hasMask ? layer.masksProperties : undefined) as Mask[] | undefined
  if (!Array.isArray(masks) || masks.length === 0) return null
  const active = masks.filter((mask) => (mask.mode ?? 'a') !== 'n')
  if (active.length === 0) return null
  if (active.some((mask) => (mask.mode ?? 'a') !== 'a' || mask.inv)) return null
  const box = new Box()
  for (const mask of active) {
    if (mask.o && evaluateScalar(mask.o, frame, 100) <= 0) continue
    const path = evaluatePath(mask.pt, frame)
    if (!path?.v?.length) continue
    const grow = mask.x ? Math.max(0, evaluateScalar(mask.x, frame, 0)) : 0
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    path.v.forEach((v, i) => {
      for (const d of [[0, 0], path.i?.[i], path.o?.[i]]) {
        if (!d) continue
        x0 = Math.min(x0, v[0] + d[0])
        y0 = Math.min(y0, v[1] + d[1])
        x1 = Math.max(x1, v[0] + d[0])
        y1 = Math.max(y1, v[1] + d[1])
      }
    })
    if (x1 >= x0) box.addRect(m, x0 - grow, y0 - grow, x1 + grow, y1 + grow)
  }
  return box
}

function effectValue(effect: Effect, index: number, frame: number): number {
  const v = effect.ef?.[index]?.v
  return v ? evaluateScalar(v as ScalarProperty, frame, 0) : 0
}

/**
 * Grows a layer's box for its visible effects, in order (each effect filters the result of
 * the previous one). `m` maps layer space (where SVG filters work) to world space.
 */
function applyEffects(box: Box, layer: Layer, frame: number, m: Mat): void {
  const k = maxScale(m)
  for (const effect of layer.ef ?? []) {
    if (!effect || effect.en === 0 || box.empty) continue
    if (effect.ty === 25) {
      // Drop shadow: a copy offset by distance at (direction − 90°), blurred with
      // stdDeviation = softness / 4 (≈ 3σ visible).
      const distance = effectValue(effect, 3, frame)
      const angle = ((effectValue(effect, 2, frame) - 90) * Math.PI) / 180
      const lx = distance * Math.cos(angle)
      const ly = distance * Math.sin(angle)
      const dx = m[0] * lx + m[2] * ly
      const dy = m[1] * lx + m[3] * ly
      const blur = Math.abs(effectValue(effect, 4, frame)) * 0.75 * k
      const shadow = new Box()
      shadow.add(box.minX + dx - blur, box.minY + dy - blur)
      shadow.add(box.maxX + dx + blur, box.maxY + dy + blur)
      box.union(shadow)
    } else if (effect.ty === 29) {
      // Gaussian blur: σ = 0.3 · blurriness; dimensions 2 = horizontal, 3 = vertical only.
      const blur = Math.abs(effectValue(effect, 0, frame)) * 0.9 * k
      const dims = effectValue(effect, 1, frame)
      const bx = dims === 3 ? 0 : blur
      const by = dims === 2 ? 0 : blur
      box.add(box.minX - bx, box.minY - by)
      box.add(box.maxX + bx, box.maxY + by)
    }
  }
}

/* ---------------------------------- Layers --------------------------------- */

interface Scene {
  anim: Animation
  precomps: Map<string, PrecompAsset>
  images: Map<string, { w: number; h: number }>
}

function sceneOf(anim: Animation): Scene {
  const precomps = new Map<string, PrecompAsset>()
  const images = new Map<string, { w: number; h: number }>()
  for (const asset of anim.assets ?? []) {
    if (isPrecompAsset(asset)) precomps.set(asset.id, asset)
    else if (isImageAsset(asset)) images.set(asset.id, { w: asset.w ?? 0, h: asset.h ?? 0 })
  }
  return { anim, precomps, images }
}

const RENDERED_TYPES = new Set<number>([
  LayerType.Precomp,
  LayerType.Solid,
  LayerType.Image,
  LayerType.Shape,
  LayerType.Text,
  LayerType.ImageSequence,
])

function inRange(layer: Layer, frame: number): boolean {
  return isNum(layer.ip) && isNum(layer.op) ? frame >= layer.ip && frame < layer.op : true
}

/** World matrices of a composition's layers at one frame (parent chains resolved once). */
class Hierarchy {
  private readonly cache = new Map<Layer, Mat>()
  private readonly byInd = new Map<number, Layer>()
  private readonly frame: number
  private readonly world: Mat

  constructor(layers: readonly Layer[], frame: number, world: Mat) {
    this.frame = frame
    this.world = world
    for (const layer of layers) if (isNum(layer.ind)) this.byInd.set(layer.ind, layer)
  }

  matrix(layer: Layer, depth = 0): Mat {
    const cached = this.cache.get(layer)
    if (cached) return cached
    const local = transformMatrix(layer.ks, this.frame, layer.ao === 1)
    const parent =
      isNum(layer.parent) && layer.parent !== layer.ind ? this.byInd.get(layer.parent) : undefined
    const result =
      parent && depth < 32 ? mul(this.matrix(parent, depth + 1), local) : mul(this.world, local)
    this.cache.set(layer, result)
    return result
  }
}

/** Adds the rendered content of one layer (no visibility checks) to `box`. */
function layerContent(
  scene: Scene,
  layer: Layer,
  frame: number,
  m: Mat,
  box: Box,
  depth: number,
): void {
  switch (layer.ty) {
    case LayerType.Shape:
      shapesBounds(
        (layer as { shapes?: ShapeItem[] }).shapes,
        frame,
        m,
        box,
        { paint: false, stroke: 0, grow: 0, bloat: 0, trims: [] },
        0,
      )
      break
    case LayerType.Solid: {
      const solid = layer as { sw?: number; sh?: number }
      if (isNum(solid.sw) && isNum(solid.sh)) box.addRect(m, 0, 0, solid.sw, solid.sh)
      break
    }
    case LayerType.Image:
    case LayerType.ImageSequence: {
      const image = scene.images.get((layer as { refId?: string }).refId ?? '')
      if (image && image.w > 0 && image.h > 0) box.addRect(m, 0, 0, image.w, image.h)
      break
    }
    case LayerType.Text: {
      const local = textBounds(layer as TextLayer, frame)
      if (local) box.addRect(m, local[0], local[1], local[2], local[3])
      break
    }
    case LayerType.Precomp: {
      const precomp = layer as PrecompLayer
      const asset = scene.precomps.get(precomp.refId)
      if (!asset || depth > 12) break
      const inner = precompInnerFrame(precomp, frame, scene.anim.fr)
      const content = new Box()
      compositionBounds(scene, asset.layers ?? [], inner, m, content, depth + 1)
      // lottie-web clips a precomp to its layer size.
      if (isNum(precomp.w) && isNum(precomp.h) && precomp.w > 0 && precomp.h > 0) {
        const clip = new Box()
        clip.addRect(m, 0, 0, precomp.w, precomp.h)
        content.intersect(clip)
      }
      box.union(content)
      break
    }
  }
}

/** Track matte source of the layer at `index` (tp reference or the layer above). */
function matteSource(layers: readonly Layer[], index: number): Layer | undefined {
  const target = layers[index]
  if (isNum(target.tp)) return layers.find((l) => l.ind === target.tp)
  const above = layers[index - 1]
  return above && above.td ? above : undefined
}

function compositionBounds(
  scene: Scene,
  layers: readonly Layer[],
  frame: number,
  world: Mat,
  box: Box,
  depth: number,
): void {
  const hierarchy = new Hierarchy(layers, frame, world)
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (!layer || layer.hd || layer.td || !RENDERED_TYPES.has(layer.ty) || !inRange(layer, frame))
      continue
    if (evaluateScalar(layer.ks?.o, frame, 100) <= 0) continue
    const m = hierarchy.matrix(layer)
    const own = new Box()
    layerContent(scene, layer, frame, m, own, depth)
    if (own.empty) continue
    const masks = maskBox(layer, frame, m)
    if (masks) own.intersect(masks)
    // Alpha/luma mattes (not inverted) only let the matte's area through.
    if (layer.tt === 1 || layer.tt === 3) {
      const source = matteSource(layers, i)
      const matte = new Box()
      if (source && !source.hd && inRange(source, frame)) {
        layerContent(scene, source, frame, hierarchy.matrix(source), matte, depth)
      }
      own.intersect(matte)
    }
    applyEffects(own, layer, frame, m)
    box.union(own)
  }
}

/* --------------------------------- Sampling -------------------------------- */

/** Accumulates the content bounds of the root composition over several frames. */
export interface BoundsSampler {
  /** Adds the content visible at `frame` (a root composition frame). */
  sample(frame: number): void
  /** Union of everything sampled so far (null when nothing is visible). */
  bounds(): Rect | null
}

export function createBoundsSampler(anim: Animation): BoundsSampler {
  const scene = sceneOf(anim)
  const box = new Box()
  return {
    sample(frame) {
      compositionBounds(scene, anim.layers ?? [], frame, IDENTITY, box, 0)
    },
    bounds: () => box.toRect(),
  }
}

/** Rough cost of evaluating one frame (number of layers and shape items). */
function countShapes(items: unknown): number {
  if (!Array.isArray(items)) return 0
  let n = 0
  for (const item of items as ShapeItem[]) {
    n++
    if (item?.ty === 'gr') n += countShapes(item.it)
  }
  return n
}

export function frameCost(anim: Animation): number {
  let cost = 0
  const layers = [
    ...(anim.layers ?? []),
    ...(anim.assets ?? []).filter(isPrecompAsset).flatMap((a) => a.layers ?? []),
  ]
  for (const layer of layers) cost += 1 + countShapes((layer as { shapes?: unknown }).shapes)
  return Math.max(1, cost)
}

/**
 * Frames to sample for the content bounds: every frame of the root range, or an even
 * subset for heavy documents (`budget` ≈ total evaluated items).
 */
export function boundsFrames(anim: Animation, budget = 400_000): number[] {
  const first = Math.ceil(anim.ip)
  const last = Math.max(first, Math.ceil(anim.op) - 1)
  const count = last - first + 1
  const max = Math.max(24, Math.floor(budget / frameCost(anim)))
  if (count <= max) return Array.from({ length: count }, (_, i) => first + i)
  const frames = new Set<number>()
  for (let i = 0; i < max; i++) frames.add(Math.round(first + (i * (last - first)) / (max - 1)))
  return [...frames]
}

/** Union of the visible content over the given frames (all frames by default). */
export function contentBounds(
  anim: Animation,
  frames: readonly number[] = boundsFrames(anim),
): Rect | null {
  const sampler = createBoundsSampler(anim)
  for (const frame of frames) sampler.sample(frame)
  return sampler.bounds()
}

/* ----------------------------------- Fit ----------------------------------- */

export interface FitOptions {
  /** Empty space kept around the content, in pixels. */
  padding?: number
  /** Ignore content outside the current canvas (it was never visible). Default true. */
  clipToCanvas?: boolean
  /** Precomputed content bounds (see createBoundsSampler); computed when omitted. */
  bounds?: Rect | null
}

export interface FitPlan {
  /** New canvas size. */
  width: number
  height: number
  /** Offset applied to the content. */
  dx: number
  dy: number
  /** False when the canvas already fits. */
  changed: boolean
}

/** Antialiasing margin added around the measured content before rounding. */
const SAFETY_MARGIN = 1

/** Canvas that fits `bounds` (+ padding), in whole pixels. Null when there is no content. */
export function planFit(
  anim: Pick<Animation, 'w' | 'h'>,
  bounds: Rect | null,
  opts: Omit<FitOptions, 'bounds'> = {},
): FitPlan | null {
  if (!bounds) return null
  let x0 = bounds.x - SAFETY_MARGIN
  let y0 = bounds.y - SAFETY_MARGIN
  let x1 = bounds.x + bounds.width + SAFETY_MARGIN
  let y1 = bounds.y + bounds.height + SAFETY_MARGIN
  if (opts.clipToCanvas !== false) {
    x0 = Math.max(x0, 0)
    y0 = Math.max(y0, 0)
    x1 = Math.min(x1, anim.w)
    y1 = Math.min(y1, anim.h)
  }
  if (!(x1 - x0 > 0) || !(y1 - y0 > 0)) return null
  const pad = Math.max(0, opts.padding ?? 0)
  x0 = Math.floor(x0 - pad + 1e-6)
  y0 = Math.floor(y0 - pad + 1e-6)
  x1 = Math.ceil(x1 + pad - 1e-6)
  y1 = Math.ceil(y1 + pad - 1e-6)
  const width = Math.max(1, x1 - x0)
  const height = Math.max(1, y1 - y0)
  return {
    width,
    height,
    dx: -x0,
    dy: -y0,
    changed: x0 !== 0 || y0 !== 0 || width !== anim.w || height !== anim.h,
  }
}

/**
 * Crops (or grows) the canvas to the content visible over the whole animation, plus
 * padding, and moves the content accordingly. Returns null when nothing is visible.
 */
export function fitCanvasToContent(anim: Animation, opts: FitOptions = {}): FitPlan | null {
  const bounds = opts.bounds !== undefined ? opts.bounds : contentBounds(anim)
  const plan = planFit(anim, bounds, opts)
  if (!plan || !plan.changed) return plan
  translateContent(anim, plan.dx, plan.dy)
  anim.w = plan.width
  anim.h = plan.height
  return plan
}
