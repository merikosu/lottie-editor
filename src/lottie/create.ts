/**
 * Factories for new Lottie content: layers, shape items, assets and fonts.
 *
 * Everything returned is a fresh, complete, bodymovin-like object that every player accepts
 * as-is (see the research notes' render-copy normalization checklist): static properties carry
 * `a: 0`, groups end with their transform, rectangles have a roundness, fills and strokes have
 * a color and an opacity, text documents reference a font listed in `fonts.list`.
 *
 * Factories never read or mutate a document except the explicit helpers at the bottom
 * (`ensureFont`, `uniqueAssetId`, `compInfoAt`, ...).
 */
import { hexToRgba, lottieToRgba, rgbaToHex } from '@/lib/color'
import { forEachLayer } from './traverse'
import { compAssetIndexOf, getAt, type NodePath } from './path'
import { precompInnerFrame } from './time'
import type {
  Animation,
  EllipseShape,
  FillShape,
  Font,
  GradientFillShape,
  GroupShape,
  ImageAsset,
  ImageLayer,
  Layer,
  NullLayer,
  PrecompAsset,
  PrecompLayer,
  RectShape,
  RepeaterShape,
  RoundCornersShape,
  ShapeItem,
  ShapeLayer,
  SolidLayer,
  StarShape,
  StrokeShape,
  TextDocument,
  TextLayer,
  Transform,
  TransformShape,
  TrimShape,
} from './types'

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

/** A color as a hex string (#rgb, #rrggbb) or a Lottie 0..1 array. */
export type ColorInput = string | readonly number[]

const round = (v: number, decimals = 3) => {
  const f = 10 ** decimals
  const r = Math.round(v * f) / f
  return Object.is(r, -0) ? 0 : r
}

/** Static property value. */
function stat<T>(k: T): { a: 0; k: T } {
  return { a: 0, k }
}

/** Lottie color array [r, g, b, 1] (0..1, 4 decimals) from any color input. */
export function toLottieColor(color: ColorInput): number[] {
  const rgba =
    typeof color === 'string'
      ? (hexToRgba(color) ?? { r: 0, g: 0, b: 0, a: 1 })
      : lottieToRgba(color)
  return [round(rgba.r, 4), round(rgba.g, 4), round(rgba.b, 4), 1]
}

/** Lowercase #rrggbb from any color input (solid layers store hex strings). */
export function toHexColor(color: ColorInput): string {
  return typeof color === 'string'
    ? rgbaToHex(hexToRgba(color) ?? { r: 0, g: 0, b: 0, a: 1 })
    : rgbaToHex(lottieToRgba(color))
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * "<base> N" where N is one higher than the highest existing "<base> N" (1 when none), the way
 * After Effects numbers new layers and shape items.
 */
export function nextNumberedName(names: Iterable<string | undefined>, base: string): string {
  const re = new RegExp(`^${escapeRegExp(base)} (\\d+)$`)
  let max = 0
  for (const name of names) {
    const m = name ? re.exec(name) : null
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${base} ${max + 1}`
}

/* -------------------------------------------------------------------------- */
/*                                Shape items                                 */
/* -------------------------------------------------------------------------- */

/** Identity group transform (`tr`); always the last item of a group. */
export function createShapeTransform(): TransformShape {
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

export interface GroupOptions {
  name?: string
  /** Items placed in the group, in order (the transform is appended automatically). */
  items?: ShapeItem[]
}

/** Shape group with an identity transform as its last item. */
export function createGroupShape({ name, items = [] }: GroupOptions = {}): GroupShape {
  const content = items.filter((item) => item.ty !== 'tr')
  const group: GroupShape = {
    ty: 'gr',
    it: [...content, createShapeTransform()],
    np: content.length,
    cix: 2,
    bm: 0,
  }
  if (name) group.nm = name
  return group
}

export interface SizeOptions {
  w: number
  h: number
  /** Center relative to the group (default [0, 0]). */
  position?: readonly number[]
  name?: string
}

/** Rectangle path generator (`rc`), centered on `position`. */
export function createRectShape({
  w,
  h,
  position = [0, 0],
  name,
  roundness = 0,
}: SizeOptions & { roundness?: number }): RectShape {
  const shape: RectShape = {
    ty: 'rc',
    d: 1,
    s: stat([round(w), round(h)]),
    p: stat([position[0] ?? 0, position[1] ?? 0]),
    r: stat(roundness),
  }
  if (name) shape.nm = name
  return shape
}

/** Ellipse path generator (`el`), centered on `position`. */
export function createEllipseShape({ w, h, position = [0, 0], name }: SizeOptions): EllipseShape {
  const shape: EllipseShape = {
    ty: 'el',
    d: 1,
    s: stat([round(w), round(h)]),
    p: stat([position[0] ?? 0, position[1] ?? 0]),
  }
  if (name) shape.nm = name
  return shape
}

export interface StarOptions {
  kind: 'star' | 'polygon'
  outerRadius: number
  /** Inner radius of stars (default: half the outer radius). */
  innerRadius?: number
  /** Number of points (default 5 for stars, 6 for polygons). */
  points?: number
  position?: readonly number[]
  name?: string
}

/** Star or polygon path generator (`sr`). Polygons carry no inner radius/roundness. */
export function createStarShape({
  kind,
  outerRadius,
  innerRadius,
  points,
  position = [0, 0],
  name,
}: StarOptions): StarShape {
  const isStar = kind === 'star'
  const shape: StarShape = {
    ty: 'sr',
    sy: isStar ? 1 : 2,
    d: 1,
    pt: stat(points ?? (isStar ? 5 : 6)),
    p: stat([position[0] ?? 0, position[1] ?? 0]),
    r: stat(0),
    or: stat(round(outerRadius)),
    os: stat(0),
  }
  if (isStar) {
    shape.ir = stat(round(innerRadius ?? outerRadius / 2))
    shape.is = stat(0)
  }
  if (name) shape.nm = name
  return shape
}

export interface FillOptions {
  color: ColorInput
  /** 0..100 */
  opacity?: number
  name?: string
}

/** Solid fill (`fl`), non-zero winding. */
export function createFillShape({ color, opacity = 100, name }: FillOptions): FillShape {
  const shape: FillShape = {
    ty: 'fl',
    c: stat(toLottieColor(color)),
    o: stat(opacity),
    r: 1,
    bm: 0,
  }
  if (name) shape.nm = name
  return shape
}

export interface StrokeOptions extends FillOptions {
  width?: number
}

/** Stroke (`st`) with After Effects' default butt cap / miter join. */
export function createStrokeShape({
  color,
  width = 4,
  opacity = 100,
  name,
}: StrokeOptions): StrokeShape {
  const shape: StrokeShape = {
    ty: 'st',
    c: stat(toLottieColor(color)),
    o: stat(opacity),
    w: stat(width),
    lc: 1,
    lj: 1,
    ml: 4,
    bm: 0,
  }
  if (name) shape.nm = name
  return shape
}

export interface GradientOptions {
  /** Horizontal extent of the gradient (start = center − w/2, end = center + w/2). */
  w?: number
  /** Middle of the gradient line (default [0, 0]). */
  center?: readonly number[]
  /** Colors of the two stops (default white → black). */
  from?: ColorInput
  to?: ColorInput
  name?: string
}

/** Horizontal linear gradient fill (`gf`) across the given width, two opaque stops. */
export function createGradientFillShape({
  w = 100,
  center = [0, 0],
  from = '#ffffff',
  to = '#000000',
  name,
}: GradientOptions = {}): GradientFillShape {
  const a = toLottieColor(from)
  const b = toLottieColor(to)
  const cx = center[0] ?? 0
  const cy = round(center[1] ?? 0)
  const shape: GradientFillShape = {
    ty: 'gf',
    o: stat(100),
    r: 1,
    bm: 0,
    g: { p: 2, k: stat([0, a[0], a[1], a[2], 1, b[0], b[1], b[2]]) },
    s: stat([round(cx - w / 2), cy]),
    e: stat([round(cx + w / 2), cy]),
    t: 1,
  }
  if (name) shape.nm = name
  return shape
}

/** Trim paths (`tm`) showing the whole path. */
export function createTrimPathsShape({ name }: { name?: string } = {}): TrimShape {
  const shape: TrimShape = { ty: 'tm', s: stat(0), e: stat(100), o: stat(0), m: 1 }
  if (name) shape.nm = name
  return shape
}

/** Repeater (`rp`): 3 copies offset horizontally, like After Effects' default. */
export function createRepeaterShape({
  name,
  offset = 100,
}: { name?: string; offset?: number } = {}): RepeaterShape {
  const shape: RepeaterShape = {
    ty: 'rp',
    c: stat(3),
    o: stat(0),
    m: 1,
    tr: {
      ty: 'tr',
      p: stat([offset, 0]),
      a: stat([0, 0]),
      s: stat([100, 100]),
      r: stat(0),
      so: stat(100),
      eo: stat(100),
    },
  }
  if (name) shape.nm = name
  return shape
}

/** Round corners (`rd`). */
export function createRoundCornersShape({
  radius = 10,
  name,
}: { radius?: number; name?: string } = {}): RoundCornersShape {
  const shape: RoundCornersShape = { ty: 'rd', r: stat(radius) }
  if (name) shape.nm = name
  return shape
}

/* -------------------------------------------------------------------------- */
/*                                   Layers                                   */
/* -------------------------------------------------------------------------- */

export interface LayerBaseOptions {
  name?: string
  /** Unique layer index in the target composition (see `nextLayerInd`). */
  ind: number
  /** In/out points in composition frames. */
  ip: number
  op: number
  /** Position in composition pixels (default [0, 0]). */
  position?: readonly number[]
}

function layerTransform(
  position: readonly number[] = [0, 0],
  anchor: readonly number[] = [0, 0],
  scale = 100,
): Transform {
  return {
    o: stat(100),
    r: stat(0),
    p: stat([round(position[0] ?? 0), round(position[1] ?? 0), 0]),
    a: stat([round(anchor[0] ?? 0), round(anchor[1] ?? 0), 0]),
    s: stat([round(scale), round(scale), 100]),
  }
}

/** Fields shared by every layer, in bodymovin's key order. */
function baseLayer<T extends Layer['ty']>(ty: T, o: LayerBaseOptions, ks: Transform) {
  const layer = {
    ddd: 0 as const,
    ind: o.ind,
    ty,
    nm: o.name,
    sr: 1,
    ks,
    ao: 0 as const,
    ip: o.ip,
    op: o.op,
    st: 0,
    bm: 0,
  }
  if (layer.nm === undefined) delete (layer as { nm?: string }).nm
  return layer
}

export type ShapeKind = 'rect' | 'ellipse' | 'star' | 'polygon'

/** Path generator for a basic shape kind, centered on the origin. */
export function createPathGenerator(
  kind: ShapeKind,
  w: number,
  h: number,
  name?: string,
): ShapeItem {
  const r = Math.min(w, h) / 2
  switch (kind) {
    case 'rect':
      return createRectShape({ w, h, name })
    case 'ellipse':
      return createEllipseShape({ w, h, name })
    case 'star':
      return createStarShape({ kind: 'star', outerRadius: r, innerRadius: r / 2, name })
    case 'polygon':
      return createStarShape({ kind: 'polygon', outerRadius: r, name })
  }
}

export interface ShapeLayerOptions extends LayerBaseOptions {
  kind: ShapeKind
  /** Size of the shape (stars and polygons use the smaller side as diameter). */
  w: number
  h: number
  color: ColorInput
  /** Names of the group, path and fill (default: layer name / none). */
  groupName?: string
  pathName?: string
  fillName?: string
}

/**
 * Shape layer holding one group with a path generator and a fill. The shape is centered on
 * the layer's origin, so `position` is the shape's center and rotation/scale pivot around it.
 */
export function createShapeLayer(o: ShapeLayerOptions): ShapeLayer {
  const group = createGroupShape({
    name: o.groupName ?? o.name,
    items: [
      createPathGenerator(o.kind, o.w, o.h, o.pathName),
      createFillShape({ color: o.color, name: o.fillName }),
    ],
  })
  return { ...baseLayer(4, o, layerTransform(o.position)), shapes: [group] }
}

/** Shape layer with the given items (used to paste shape items where there is no shape layer). */
export function createEmptyShapeLayer(o: LayerBaseOptions & { shapes?: ShapeItem[] }): ShapeLayer {
  return { ...baseLayer(4, o, layerTransform(o.position)), shapes: o.shapes ?? [] }
}

export interface SolidLayerOptions extends LayerBaseOptions {
  w: number
  h: number
  color: ColorInput
}

/** Solid color layer; the anchor is the solid's center so `position` centers it. */
export function createSolidLayer(o: SolidLayerOptions): SolidLayer {
  const w = Math.max(1, Math.round(o.w))
  const h = Math.max(1, Math.round(o.h))
  return {
    ...baseLayer(1, o, layerTransform(o.position, [w / 2, h / 2])),
    sc: toHexColor(o.color),
    sw: w,
    sh: h,
  }
}

/** Null layer (invisible; used as a parent). */
export function createNullLayer(o: LayerBaseOptions): NullLayer {
  return baseLayer(3, o, layerTransform(o.position))
}

export interface PrecompLayerOptions extends Omit<LayerBaseOptions, 'position'> {
  /** Id of the precomp asset the layer shows. */
  refId: string
  /** Size of the composition: players clip the precomp's content to `w × h`. */
  w: number
  h: number
  /** Start time: the content plays at `inner = outer − st` (default 0). */
  st?: number
}

/**
 * Precomp layer with an identity transform: anchor and position both at the center of the
 * composition (After Effects' default), so the content keeps its coordinates. Keys follow
 * bodymovin's order for precomp layers.
 */
export function createPrecompLayer(o: PrecompLayerOptions): PrecompLayer {
  const center = [o.w / 2, o.h / 2]
  const layer: PrecompLayer = {
    ddd: 0,
    ind: o.ind,
    ty: 0,
    nm: o.name,
    refId: o.refId,
    sr: 1,
    ks: layerTransform(center, center),
    ao: 0,
    w: o.w,
    h: o.h,
    ip: o.ip,
    op: o.op,
    st: o.st ?? 0,
    bm: 0,
  }
  if (layer.nm === undefined) delete layer.nm
  return layer
}

/** Precomp asset (a composition used by precomp layers) at the document's frame rate. */
export function createPrecompAsset(o: {
  id: string
  name?: string
  fr: number
  layers: Layer[]
}): PrecompAsset {
  const asset: PrecompAsset = { id: o.id, nm: o.name, fr: o.fr, layers: o.layers }
  if (asset.nm === undefined) delete asset.nm
  return asset
}

/**
 * Default font for new text layers. It is not embedded: players render it with the system's
 * Inter when installed, otherwise with the generic sans-serif fallback in `fFamily`.
 */
export const DEFAULT_FONT: Font = {
  fName: 'Inter-Regular',
  fFamily: 'Inter, sans-serif',
  fStyle: 'Regular',
  ascent: 72.7,
}

export interface TextLayerOptions extends LayerBaseOptions {
  text: string
  /** Font name (`fName` of an entry in `fonts.list`); default DEFAULT_FONT. */
  fontName?: string
  size?: number
  color?: ColorInput
  /** 0 left, 1 right, 2 center (default). */
  justify?: 0 | 1 | 2
}

/**
 * Point text layer. The text baseline sits on the layer's origin, so callers usually shift
 * `position` down by about a third of the size to center the text optically.
 * Remember to `ensureFont` the font in the document.
 */
export function createTextLayer(o: TextLayerOptions): TextLayer {
  const size = o.size ?? 48
  const color = toLottieColor(o.color ?? '#ffffff')
  const doc: TextDocument = {
    s: size,
    f: o.fontName ?? DEFAULT_FONT.fName,
    t: o.text.replace(/\r\n|\n/g, '\r'),
    ca: 0,
    j: o.justify ?? 2,
    tr: 0,
    lh: round(size * 1.2, 2),
    ls: 0,
    fc: color.slice(0, 3),
  }
  return {
    ...baseLayer(5, o, layerTransform(o.position)),
    t: { d: { k: [{ s: doc, t: 0 }] }, p: {}, m: { g: 1, a: stat([0, 0]) }, a: [] },
  }
}

export interface ImageLayerOptions extends Partial<LayerBaseOptions> {
  /** Uniform scale in percent (default 100). */
  scale?: number
}

/**
 * Image layer showing the asset `assetId` (natural size `w`×`h`). The anchor is the image's
 * center; `position` defaults to that center (i.e. the image's top-left at the origin).
 */
export function createImageLayer(
  assetId: string,
  w: number,
  h: number,
  opts: ImageLayerOptions = {},
): ImageLayer {
  const o: LayerBaseOptions = {
    ind: opts.ind ?? 1,
    ip: opts.ip ?? 0,
    op: opts.op ?? 1,
    name: opts.name,
    position: opts.position,
  }
  const center = [w / 2, h / 2]
  return {
    ...baseLayer(2, o, layerTransform(opts.position ?? center, center, opts.scale ?? 100)),
    refId: assetId,
  }
}

export interface ImageAssetOptions {
  id: string
  /** Data URI (embedded) of the image. */
  dataUri: string
  w: number
  h: number
  name?: string
}

/** Embedded image asset. */
export function createImageAsset({ id, dataUri, w, h, name }: ImageAssetOptions): ImageAsset {
  const asset: ImageAsset = { id, w: Math.round(w), h: Math.round(h), u: '', p: dataUri, e: 1 }
  if (name) asset.nm = name
  return asset
}

/* -------------------------------------------------------------------------- */
/*                              Document helpers                              */
/* -------------------------------------------------------------------------- */

/** Adds `font` to `fonts.list` unless a font with the same `fName` exists. Returns the fName. */
export function ensureFont(anim: Animation, font: Font = DEFAULT_FONT): string {
  if (!anim.fonts || !Array.isArray(anim.fonts.list)) anim.fonts = { ...anim.fonts, list: [] }
  if (!anim.fonts.list.some((f) => f.fName === font.fName)) anim.fonts.list.push({ ...font })
  return font.fName
}

/** Asset id `<prefix><n>` not used by any asset of the document (smallest n ≥ 0). */
export function uniqueAssetId(anim: Animation, prefix = 'image_'): string {
  const taken = new Set((anim.assets ?? []).map((a) => a.id))
  for (let n = 0; ; n++) {
    const id = `${prefix}${n}`
    if (!taken.has(id)) return id
  }
}

export interface CompInfo {
  w: number
  h: number
  /** Frame range of the composition's own timeline. */
  ip: number
  op: number
}

/**
 * Size and time range of the composition whose layers live at `compPath` (['layers'] or
 * ['assets', i, 'layers']). Precomp assets store neither, so they come from the first layer
 * that uses the precomp (its clip size and in/out range mapped into the precomp's time),
 * falling back to the document size and the union of the precomp's layer ranges.
 */
export function compInfoAt(anim: Animation, compPath: NodePath): CompInfo {
  const root: CompInfo = { w: anim.w, h: anim.h, ip: anim.ip, op: anim.op }
  const assetIndex = compAssetIndexOf([...compPath, 0])
  if (assetIndex === null) return root
  const asset = anim.assets?.[assetIndex]
  if (!asset || !('layers' in asset)) return root

  let instance: PrecompLayer | null = null
  forEachLayer(anim, (layer) => {
    if (layer.ty === 0 && (layer as PrecompLayer).refId === asset.id) {
      instance = layer as PrecompLayer
      return false
    }
  })
  const found = instance as PrecompLayer | null
  const w = found?.w ?? anim.w
  const h = found?.h ?? anim.h
  if (found && !found.tm) {
    const a = precompInnerFrame(found, found.ip, anim.fr)
    const b = precompInnerFrame(found, found.op, anim.fr)
    const ip = Math.round(Math.min(a, b))
    const op = Math.round(Math.max(a, b))
    if (op > ip) return { w, h, ip, op }
  }
  const layers = getAt<Layer[]>(anim, compPath) ?? []
  if (layers.length) {
    const ip = Math.min(...layers.map((l) => l.ip))
    const op = Math.max(...layers.map((l) => l.op))
    if (Number.isFinite(ip) && Number.isFinite(op) && op > ip) return { w, h, ip, op }
  }
  return { w, h, ip: 0, op: Math.max(1, anim.op - anim.ip) }
}
