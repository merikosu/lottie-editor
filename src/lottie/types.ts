/**
 * TypeScript model of the Lottie (bodymovin) JSON format.
 *
 * The editor treats the JSON itself as the source of truth: we never convert it into a
 * custom model, so unknown/unsupported fields survive a load → edit → export round trip.
 * These types describe the fields the editor understands; real files may carry more.
 *
 * Conventions (see lottie-web): colors are 0..1 floats, opacity/scale are 0..100,
 * rotation is in degrees, times are in frames.
 */

/* -------------------------------------------------------------------------- */
/*                                 Properties                                 */
/* -------------------------------------------------------------------------- */

/** Bezier easing handle. `x`/`y` are scalars or per-dimension arrays. */
export interface EasingHandle {
  x: number | number[]
  y: number | number[]
}

/**
 * A keyframe. The easing of the segment [this → next] is stored on *this* keyframe:
 * `o` = out tangent of this keyframe, `i` = in tangent of the next keyframe.
 */
export interface Keyframe<S = number[]> {
  /** Time in frames (layer-local, see time.ts). */
  t: number
  /** Value at this keyframe. */
  s?: S
  /** Legacy (bodymovin < 5.5) end value of the segment; equals the next keyframe's `s`. */
  e?: S
  i?: EasingHandle
  o?: EasingHandle
  /** Hold keyframe: value jumps at the next keyframe. */
  h?: 0 | 1
  /** Spatial in/out tangents (position-like properties), relative to the value. */
  ti?: number[]
  to?: number[]
  /** Legacy easing names. */
  n?: string | string[]
}

/** Generic animatable property: static when `k` is a value, animated when `k` is keyframes. */
export interface Property<V = number | number[]> {
  a?: 0 | 1
  k: V | Keyframe<V extends number ? number[] : V>[]
  /** After Effects expression source. */
  x?: string
  ix?: number
  /** Slot id (Lottie slots / dotLottie themes). */
  sid?: string
  /** Number of components (bodymovin writes this on some position properties). */
  l?: number
}

export type ScalarProperty = Property<number>
export type VectorProperty = Property<number[]>
export type ColorProperty = Property<number[]>

/** Position with separated dimensions (After Effects "Separate Dimensions"). */
export interface SplitVectorProperty {
  s: true
  x: ScalarProperty
  y: ScalarProperty
  z?: ScalarProperty
}

export type PositionProperty = VectorProperty | SplitVectorProperty

/** Bezier path. Tangents in `i`/`o` are relative to their vertex in `v`. */
export interface BezierPath {
  i: number[][]
  o: number[][]
  v: number[][]
  c: boolean
}

export interface ShapePathProperty {
  a?: 0 | 1
  k: BezierPath | Keyframe<BezierPath[]>[]
  x?: string
  ix?: number
  sid?: string
}

/** Gradient colors: `p` = number of color stops; `k` = flat [offset, r, g, b, ..., offset, alpha, ...]. */
export interface GradientColors {
  p: number
  k: Property<number[]>
}

/* -------------------------------------------------------------------------- */
/*                                  Transform                                 */
/* -------------------------------------------------------------------------- */

export interface Transform {
  /** Anchor point */
  a?: VectorProperty
  /** Position */
  p?: PositionProperty
  /** Scale (percent) */
  s?: VectorProperty
  /** Rotation (degrees) */
  r?: ScalarProperty
  /** Opacity (0..100) */
  o?: ScalarProperty
  /** Skew (degrees) */
  sk?: ScalarProperty
  /** Skew axis (degrees) */
  sa?: ScalarProperty
  /** 3D rotations/orientation */
  rx?: ScalarProperty
  ry?: ScalarProperty
  rz?: ScalarProperty
  or?: VectorProperty
}

/* -------------------------------------------------------------------------- */
/*                                   Shapes                                   */
/* -------------------------------------------------------------------------- */

export type ShapeType =
  | 'gr'
  | 'sh'
  | 'rc'
  | 'el'
  | 'sr'
  | 'fl'
  | 'st'
  | 'gf'
  | 'gs'
  | 'tr'
  | 'tm'
  | 'rp'
  | 'rd'
  | 'mm'
  | 'op'
  | 'pb'
  | 'tw'
  | 'zz'
  | 'no'

interface ShapeBase {
  nm?: string
  mn?: string
  hd?: boolean
  ix?: number
  cix?: number
  bm?: number
  cl?: string
  ln?: string
}

export interface GroupShape extends ShapeBase {
  ty: 'gr'
  it: ShapeItem[]
  np?: number
}

export interface PathShape extends ShapeBase {
  ty: 'sh'
  ks: ShapePathProperty
  /** Direction: 1 normal, 3 reversed */
  d?: number
}

export interface RectShape extends ShapeBase {
  ty: 'rc'
  p: VectorProperty
  s: VectorProperty
  /** Roundness */
  r: ScalarProperty
  d?: number
}

export interface EllipseShape extends ShapeBase {
  ty: 'el'
  p: VectorProperty
  s: VectorProperty
  d?: number
}

export interface StarShape extends ShapeBase {
  ty: 'sr'
  /** 1 = star, 2 = polygon */
  sy: 1 | 2
  p: VectorProperty
  /** Outer radius / roundness */
  or: ScalarProperty
  os: ScalarProperty
  /** Inner radius / roundness (stars only) */
  ir?: ScalarProperty
  is?: ScalarProperty
  /** Points */
  pt: ScalarProperty
  /** Rotation */
  r: ScalarProperty
  d?: number
}

export interface FillShape extends ShapeBase {
  ty: 'fl'
  c: ColorProperty
  o: ScalarProperty
  /** Fill rule: 1 non-zero, 2 even-odd */
  r?: 1 | 2
}

export interface StrokeDash {
  /** 'd' dash, 'g' gap, 'o' offset */
  n: 'd' | 'g' | 'o'
  nm?: string
  v: ScalarProperty
}

interface StrokeProps {
  w: ScalarProperty
  /** Line cap: 1 butt, 2 round, 3 square */
  lc?: 1 | 2 | 3
  /** Line join: 1 miter, 2 round, 3 bevel */
  lj?: 1 | 2 | 3
  ml?: number
  ml2?: ScalarProperty
  d?: StrokeDash[]
}

export interface StrokeShape extends ShapeBase, StrokeProps {
  ty: 'st'
  c: ColorProperty
  o: ScalarProperty
}

interface GradientProps {
  g: GradientColors
  /** Start / end points */
  s: VectorProperty
  e: VectorProperty
  /** 1 linear, 2 radial */
  t: 1 | 2
  /** Highlight length / angle (radial) */
  h?: ScalarProperty
  a?: ScalarProperty
  o: ScalarProperty
}

export interface GradientFillShape extends ShapeBase, GradientProps {
  ty: 'gf'
  r?: 1 | 2
}

export interface GradientStrokeShape extends ShapeBase, GradientProps, StrokeProps {
  ty: 'gs'
}

export interface TransformShape extends ShapeBase, Transform {
  ty: 'tr'
}

export interface TrimShape extends ShapeBase {
  ty: 'tm'
  s: ScalarProperty
  e: ScalarProperty
  o: ScalarProperty
  /** 1 simultaneously, 2 individually */
  m?: 1 | 2
}

export interface RepeaterShape extends ShapeBase {
  ty: 'rp'
  /** Copies */
  c: ScalarProperty
  /** Offset */
  o: ScalarProperty
  /** Composite: 1 above, 2 below */
  m?: 1 | 2
  tr: Transform & { ty?: 'tr'; so?: ScalarProperty; eo?: ScalarProperty }
}

export interface RoundCornersShape extends ShapeBase {
  ty: 'rd'
  r: ScalarProperty
}

export interface MergeShape extends ShapeBase {
  ty: 'mm'
  mm: number
}

export interface OffsetPathShape extends ShapeBase {
  ty: 'op'
  a: ScalarProperty
  lj?: 1 | 2 | 3
  ml?: ScalarProperty
}

export interface PuckerBloatShape extends ShapeBase {
  ty: 'pb'
  a: ScalarProperty
}

export interface TwistShape extends ShapeBase {
  ty: 'tw'
  a: ScalarProperty
  c: VectorProperty
}

export interface ZigZagShape extends ShapeBase {
  ty: 'zz'
  r: ScalarProperty
  s: ScalarProperty
  pt: ScalarProperty
}

export interface NoStyleShape extends ShapeBase {
  ty: 'no'
}

export type ShapeItem =
  | GroupShape
  | PathShape
  | RectShape
  | EllipseShape
  | StarShape
  | FillShape
  | StrokeShape
  | GradientFillShape
  | GradientStrokeShape
  | TransformShape
  | TrimShape
  | RepeaterShape
  | RoundCornersShape
  | MergeShape
  | OffsetPathShape
  | PuckerBloatShape
  | TwistShape
  | ZigZagShape
  | NoStyleShape

/* -------------------------------------------------------------------------- */
/*                                    Text                                    */
/* -------------------------------------------------------------------------- */

export interface TextDocument {
  /** Text content ("\r" separates lines) */
  t: string
  /** Font size */
  s: number
  /** Font name (matches fonts.list[].fName) */
  f: string
  /** Fill color (0..1) */
  fc?: number[]
  /** Stroke color / width / stroke over fill */
  sc?: number[]
  sw?: number
  of?: boolean
  /** Justify: 0 left, 1 right, 2 center, 3-6 justify variants */
  j?: number
  /** Tracking */
  tr?: number
  /** Line height */
  lh?: number
  /** Baseline shift */
  ls?: number
  /** Text box position / size (paragraph text) */
  ps?: number[]
  sz?: number[]
  /** All caps */
  ca?: 0 | 1
}

export interface TextData {
  d: { k: { s: TextDocument; t: number }[]; x?: string; sid?: string }
  p?: Record<string, unknown>
  m?: { g?: number; a?: VectorProperty }
  a?: unknown[]
}

export interface Font {
  fName: string
  fFamily: string
  fStyle?: string
  fWeight?: string
  ascent?: number
  fPath?: string
  fOrigin?: string
  origin?: number
}

/* -------------------------------------------------------------------------- */
/*                               Masks & effects                              */
/* -------------------------------------------------------------------------- */

/** a add, s subtract, i intersect, l lighten, d darken, f difference, n none */
export type MaskMode = 'a' | 's' | 'i' | 'l' | 'd' | 'f' | 'n'

export interface Mask {
  mode?: MaskMode
  pt: ShapePathProperty
  o?: ScalarProperty
  x?: ScalarProperty
  inv?: boolean
  nm?: string
  cl?: boolean
}

export interface EffectValue {
  ty: number
  nm?: string
  mn?: string
  ix?: number
  v?: Property
}

export interface Effect {
  ty: number
  nm?: string
  mn?: string
  ix?: number
  /** Enabled */
  en?: 0 | 1
  np?: number
  ef?: EffectValue[]
}

/* -------------------------------------------------------------------------- */
/*                                   Layers                                   */
/* -------------------------------------------------------------------------- */

export const LayerType = {
  Precomp: 0,
  Solid: 1,
  Image: 2,
  Null: 3,
  Shape: 4,
  Text: 5,
  Audio: 6,
  VideoPlaceholder: 7,
  ImageSequence: 8,
  Video: 9,
  ImagePlaceholder: 10,
  Guide: 11,
  Adjustment: 12,
  Camera: 13,
  Light: 14,
  Data: 15,
} as const

export type LayerTypeId = (typeof LayerType)[keyof typeof LayerType]

interface LayerBase {
  nm?: string
  mn?: string
  /** Layer index, unique within its composition; referenced by `parent`. */
  ind?: number
  parent?: number
  /** In / out points (composition time, frames) */
  ip: number
  op: number
  /** Start time (frames) */
  st: number
  /** Time stretch */
  sr?: number
  ks: Transform
  /** Auto-orient along path */
  ao?: 0 | 1
  /** Blend mode */
  bm?: number
  ddd?: 0 | 1
  /** Hidden */
  hd?: boolean
  /** Track matte type (1 alpha, 2 inverted alpha, 3 luma, 4 inverted luma) */
  tt?: number
  /** This layer is a track matte */
  td?: number
  /** Matte parent layer index (newer files) */
  tp?: number
  hasMask?: boolean
  masksProperties?: Mask[]
  ef?: Effect[]
  cl?: string
  ln?: string
  /** Collapse transform */
  ct?: 0 | 1
  /** Layer styles */
  sy?: unknown[]
}

export interface PrecompLayer extends LayerBase {
  ty: 0
  refId: string
  w?: number
  h?: number
  /** Time remap (seconds) */
  tm?: ScalarProperty
}

export interface SolidLayer extends LayerBase {
  ty: 1
  /** Solid color as hex string */
  sc: string
  sw: number
  sh: number
}

export interface ImageLayer extends LayerBase {
  ty: 2
  refId: string
}

export interface NullLayer extends LayerBase {
  ty: 3
}

export interface ShapeLayer extends LayerBase {
  ty: 4
  shapes: ShapeItem[]
}

export interface TextLayer extends LayerBase {
  ty: 5
  t: TextData
}

export interface OtherLayer extends LayerBase {
  ty: 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15
  refId?: string
}

export type Layer =
  PrecompLayer | SolidLayer | ImageLayer | NullLayer | ShapeLayer | TextLayer | OtherLayer

/* -------------------------------------------------------------------------- */
/*                                   Assets                                   */
/* -------------------------------------------------------------------------- */

export interface ImageAsset {
  id: string
  w?: number
  h?: number
  /** Directory / URL prefix */
  u?: string
  /** File name or data URI */
  p: string
  /** 1 when `p` is an embedded data URI */
  e?: 0 | 1
  nm?: string
  sid?: string
  /** 'seq' for image sequences */
  t?: string
}

export interface PrecompAsset {
  id: string
  layers: Layer[]
  nm?: string
  fr?: number
  xt?: number
}

export type Asset = ImageAsset | PrecompAsset

export interface Marker {
  /** Comment / name */
  cm: string
  /** Time (frames) */
  tm: number
  /** Duration (frames) */
  dr: number
}

/* -------------------------------------------------------------------------- */
/*                                  Animation                                 */
/* -------------------------------------------------------------------------- */

export interface Animation {
  /** Bodymovin version */
  v?: string
  /** Frame rate */
  fr: number
  /** In / out frame */
  ip: number
  op: number
  w: number
  h: number
  nm?: string
  ddd?: 0 | 1
  assets?: Asset[]
  layers: Layer[]
  markers?: Marker[]
  fonts?: { list: Font[] }
  chars?: unknown[]
  meta?: { g?: string; a?: string; k?: string | string[]; d?: string; tc?: string }
  slots?: Record<string, { p: unknown }>
  mb?: unknown
  props?: unknown
}

/* -------------------------------------------------------------------------- */
/*                                 Type guards                                */
/* -------------------------------------------------------------------------- */

export function isPrecompAsset(asset: Asset): asset is PrecompAsset {
  return Array.isArray((asset as PrecompAsset).layers)
}

export function isImageAsset(asset: Asset): asset is ImageAsset {
  return !isPrecompAsset(asset) && typeof (asset as ImageAsset).p === 'string'
}

export function isSplitPosition(p: PositionProperty | undefined): p is SplitVectorProperty {
  return !!p && (p as SplitVectorProperty).s === true
}

export function isShapeLayer(layer: Layer): layer is ShapeLayer {
  return layer.ty === LayerType.Shape
}

export function isPrecompLayer(layer: Layer): layer is PrecompLayer {
  return layer.ty === LayerType.Precomp
}

export function isTextLayer(layer: Layer): layer is TextLayer {
  return layer.ty === LayerType.Text
}

export function isImageLayer(layer: Layer): layer is ImageLayer {
  return layer.ty === LayerType.Image
}

export function isSolidLayer(layer: Layer): layer is SolidLayer {
  return layer.ty === LayerType.Solid
}
