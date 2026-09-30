/**
 * Graph editor model: the curves to draw for a set of property paths, with everything the view
 * needs per segment (easing of each dimension, spatial arc length, key values) resolved once
 * per document change. Pure (no DOM): drawing samples the values on the fly (see sample.ts).
 *
 * Value graph: one curve per shown dimension. Speed graph: one curve per independent easing —
 * a 1-D property's velocity; the speed along the motion of a spatial or linked multi-dimension
 * property (|dv⃗/dt|, the arc length for motion paths); one velocity curve per dimension when the
 * dimensions ease independently (per-dimension `o`/`i` arrays that differ).
 */
import { shapeDisplayName } from '@/components/lottie/labels'
import type { Dict } from '@/i18n'
import { getAt, layerPathOf, pathEquals, pathKey, type NodePath } from '@/lottie/path'
import { evaluateArray, getKeyframes, segmentEndValue, type AnyProperty } from '@/lottie/property'
import type { Animation, Keyframe, Layer, ShapeItem } from '@/lottie/types'
import { isTimelineAnimated, layerModel, type PropNode } from '../model'
import type { GraphMode } from '../store'
import type { TimeMap } from '../time-map'
import { readEase } from './edit'
import { distance, easeSlope, spatialLength, type Ease } from './math'

export type { GraphMode }

/** One segment (keyframe `index` → `index + 1`) of a property, in local time. */
export interface SegmentInfo {
  /** Start key: it holds the segment's easing. */
  index: number
  t0: number
  t1: number
  hold: boolean
  /** The evaluator moves along a spatial bezier (`to`/`ti` on a vector value). */
  spatial: boolean
  /** Spatial with non-zero tangents: dimensions are not cubics in time (no value handles). */
  curved: boolean
  start: number[]
  end: number[]
  /** Easing per dimension (spatial segments: the first component for all, like the evaluator). */
  eases: Ease[]
  /** Distance travelled: arc length (spatial) or straight distance of the whole value. */
  length: number
  /** Every dimension eases the same way. */
  linked: boolean
}

export type GraphKind = 'number' | 'color'

export interface GraphProp {
  path: NodePath
  key: string
  /** Property label ("Position"). */
  label: string
  /** What the property belongs to inside its layer ("Fill", "Mask 1"); empty for the layer's own. */
  context: string
  /** Layer the property belongs to. */
  owner: string
  kind: GraphKind
  prop: AnyProperty
  kfs: Keyframe<unknown>[]
  dims: number
  /** Dimensions drawn in the value graph (no z on 2-D layers, no alpha on colors). */
  shown: number[]
  unit: '' | '%' | '°'
  precision: number
  /** Display units per stored unit (colors are shown 0–255). */
  factor: number
  /** Local → root time of the property's composition (null: cannot be placed). */
  map: TimeMap | null
  /** Keys can be dragged and eased here (placed in root time, not locked). */
  editable: boolean
  /** Value at each key (legacy end values resolved). */
  keyValues: number[][]
  segments: SegmentInfo[]
  /** Any segment moves along a spatial bezier. */
  spatial: boolean
  /** Every animated segment eases all its dimensions the same way. */
  linked: boolean
}

export interface GraphCurve {
  id: string
  prop: GraphProp
  /**
   * Value graph: the dimension. Speed graph: the dimension of a per-dimension velocity (1-D
   * properties use 0), or null for the speed along a multi-dimension property's motion.
   */
  dim: number | null
  /** Short name shown with the property ("X", "R"), empty for one-curve properties. */
  dimLabel: string
  /** CSS custom property of the curve color. */
  color: string
  /** Normalized mode: n = (display − offset) / scale. Shared axis: offset 0, scale 1. */
  offset: number
  scale: number
  /** Extent of the curve in display units. */
  min: number
  max: number
}

export interface GraphModel {
  mode: GraphMode
  normalize: boolean
  props: GraphProp[]
  curves: GraphCurve[]
  /** Extent of every curve in axis units (n). */
  min: number
  max: number
  /** Properties that were asked for but have no curves (paths, text, gradient colors). */
  unsupported: number
  fps: number
}

/** Dimension colors: x red-ish, y green-ish, z blue-ish (layer label tokens, theme aware). */
export const AXIS_COLORS = [
  '--le-label-solid',
  '--le-label-image',
  '--le-label-other',
  '--le-label-text',
] as const

/** Colors of single-curve properties, in order of appearance. */
export const CURVE_COLORS = [
  '--le-label-text',
  '--le-label-precomp',
  '--le-label-other',
  '--le-label-image',
  '--le-label-solid',
  '--le-label-shape',
] as const

const AXIS_LABELS = ['X', 'Y', 'Z', 'W']
const COLOR_LABELS = ['R', 'G', 'B', 'A']

/** Most properties the graph shows at once (keeps drawing cheap on huge selections). */
export const MAX_GRAPH_PROPS = 32

function asNumbers(v: unknown): number[] {
  if (typeof v === 'number') return [v]
  if (!Array.isArray(v)) return []
  return v.map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : 0))
}

/** Value of key `k` (the last key of legacy files lives in the previous key's `e`). */
function keyValue(kfs: readonly Keyframe<unknown>[], k: number): number[] {
  const own = asNumbers(kfs[k].s)
  if (own.length > 0) return own
  for (let i = k - 1; i >= 0; i--) {
    const e = asNumbers(kfs[i].e)
    if (e.length > 0) return e
    const s = asNumbers(kfs[i].s)
    if (s.length > 0) return s
  }
  return []
}

const sameEase = (a: Ease, b: Ease) =>
  a.x1 === b.x1 && a.y1 === b.y1 && a.x2 === b.x2 && a.y2 === b.y2

const isZero = (v: readonly number[] | undefined) => !v || v.every((c) => c === 0)

/** Segments of a keyframed numeric property, mirroring the evaluator's branches. */
export function segmentsOf(kfs: readonly Keyframe<unknown>[], dims: number): SegmentInfo[] {
  const out: SegmentInfo[] = []
  for (let i = 0; i < kfs.length - 1; i++) {
    const kf = kfs[i]
    const next = kfs[i + 1]
    const start = asNumbers(kf.s)
    const end = asNumbers(segmentEndValue(kf, next))
    const hold = kf.h === 1
    const spatial = !hold && Array.isArray(kf.to) && Array.isArray(kf.ti) && start.length >= 2
    const count = Math.max(1, dims)
    const eases = Array.from({ length: count }, (_, d) => readEase(kf, spatial ? 0 : d))
    const length = spatial
      ? spatialLength(start, end.length ? end : start, kf.to ?? [], kf.ti ?? [])
      : distance(start, end.length ? end : start)
    out.push({
      index: i,
      t0: kf.t,
      t1: next.t,
      hold,
      spatial,
      curved: spatial && !(isZero(kf.to) && isZero(kf.ti)),
      start,
      end: end.length ? end : start,
      eases,
      length,
      linked: spatial || eases.every((e) => sameEase(e, eases[0])),
    })
  }
  return out
}

/** Transform vectors whose z is unused on 2-D layers. */
function isTransformVector(path: NodePath): boolean {
  const key = path[path.length - 1]
  const parent = path[path.length - 2]
  return (parent === 'ks' || parent === 'tr') && (key === 'a' || key === 'p' || key === 's')
}

function shownDims(
  dims: number,
  kind: GraphKind,
  path: NodePath,
  layer: Layer,
  keyValues: readonly number[][],
): number[] {
  if (dims <= 1) return [0]
  if (kind === 'color') return Array.from({ length: Math.min(dims, 3) }, (_, d) => d)
  const all = Array.from({ length: dims }, (_, d) => d)
  if (dims === 3 && layer.ddd !== 1 && isTransformVector(path)) {
    const z = keyValues.map((v) => v[2] ?? 0)
    if (z.every((v) => v === z[0])) return [0, 1]
  }
  return all
}

/** Axis color of a split position component (…/p/x, …/p/y, …/p/z). */
function splitAxis(path: NodePath): number {
  const key = path[path.length - 1]
  if (path[path.length - 2] !== 'p') return -1
  return key === 'x' ? 0 : key === 'y' ? 1 : key === 'z' ? 2 : -1
}

export interface GraphModelOptions {
  mode: GraphMode
  normalize: boolean
  /** Time map of the composition holding a property (the precomp instance worked in). */
  mapFor: (path: NodePath) => TimeMap | null
  /** Locked layers keep their keys where they are. */
  isLocked?: (path: NodePath) => boolean
}

function findPropNode(
  doc: Animation,
  path: NodePath,
  t: Dict,
): { node: PropNode; name: string; context: string } | null {
  const layerPath = layerPathOf(path)
  const layer = layerPath ? getAt<Layer>(doc, layerPath) : undefined
  if (!layerPath || !layer || typeof layer !== 'object') return null
  const model = layerModel(layer, layerPath, t)
  const node = model.props.find((p) => pathEquals(p.path, path))
  return node ? { node, name: model.name, context: contextOf(doc, node, layerPath, t) } : null
}

function named(value: unknown): string {
  const nm = (value as { nm?: unknown } | undefined)?.nm
  return typeof nm === 'string' ? nm.trim() : ''
}

/** The shape item, effect, mask or text animator a property belongs to (named like the rows). */
function contextOf(doc: Animation, node: PropNode, layerPath: NodePath, t: Dict): string {
  const rel = node.path.slice(layerPath.length)
  const index = typeof rel[1] === 'number' ? rel[1] : -1
  const { groups } = t.timeline
  if (rel[0] === 'shapes') {
    const item = getAt<ShapeItem>(doc, node.owner)
    return item && typeof item === 'object' && 'ty' in item ? shapeDisplayName(item, t) : ''
  }
  if (rel[0] === 'ef' && index >= 0)
    return named(getAt(doc, [...layerPath, 'ef', index])) || groups.effect(index + 1)
  if (rel[0] === 'masksProperties' && index >= 0)
    return named(getAt(doc, [...layerPath, 'masksProperties', index])) || groups.mask(index + 1)
  if (rel[0] === 't' && rel[1] === 'a' && typeof rel[2] === 'number')
    return named(getAt(doc, [...layerPath, 't', 'a', rel[2]])) || groups.animator(rel[2] + 1)
  return ''
}

interface PropCacheEntry {
  key: string
  label: string
  context: string
  owner: string
  map: TimeMap | null
  editable: boolean
  ddd: unknown
  result: GraphProp
}

/**
 * Graph properties by property object: structural sharing keeps untouched properties, so a drag
 * only rebuilds the property it edits.
 */
const propCache = new WeakMap<object, PropCacheEntry>()

/** Builds one graph property, or null when the path has no curves to draw. */
function graphProp(
  doc: Animation,
  path: NodePath,
  t: Dict,
  opts: GraphModelOptions,
): GraphProp | 'unsupported' | null {
  const found = findPropNode(doc, path, t)
  if (!found) return null
  const { node, name, context } = found
  if (!isTimelineAnimated(node.prop)) return null
  const kind = node.meta.value
  if (kind !== 'number' && kind !== 'color') return 'unsupported'
  const map = opts.mapFor(path)
  const editable = !!map?.linear && !(opts.isLocked?.(path) ?? false)
  const layer = getAt<Layer>(doc, layerPathOf(path) ?? [])!
  const key = pathKey(path)
  const cached = propCache.get(node.prop)
  if (
    cached &&
    cached.key === key &&
    cached.label === node.label &&
    cached.context === context &&
    cached.owner === name &&
    cached.map === map &&
    cached.editable === editable &&
    cached.ddd === layer.ddd
  ) {
    return cached.result
  }
  const kfs = getKeyframes(node.prop) ?? []
  if (kfs.length === 0) return null
  const keyValues = kfs.map((_, k) => keyValue(kfs, k))
  const dims = Math.min(
    4,
    keyValues.reduce((n, v) => Math.max(n, v.length), 1),
  )
  if (keyValues.every((v) => v.length === 0)) return 'unsupported'
  const segments = segmentsOf(kfs, dims)
  const result: GraphProp = {
    path,
    key: pathKey(path),
    label: node.label,
    context,
    owner: name,
    kind,
    prop: node.prop,
    kfs,
    dims,
    shown: shownDims(dims, kind, path, layer, keyValues),
    unit: node.meta.unit,
    precision: kind === 'color' ? 0 : node.meta.precision,
    factor: kind === 'color' ? 255 : 1,
    map,
    editable,
    keyValues,
    segments,
    spatial: segments.some((s) => s.spatial),
    linked: segments.every((s) => s.hold || s.linked),
  }
  propCache.set(node.prop, {
    key,
    label: node.label,
    context,
    owner: name,
    map,
    editable,
    ddd: layer.ddd,
    result,
  })
  return result
}

/**
 * Where a property sits, for the legend and readouts: the layer (when several layers are shown)
 * and the shape item, effect or mask holding it.
 */
export function propPrefix(p: GraphProp, withLayer: boolean): string {
  return [withLayer ? p.owner : '', p.context].filter(Boolean).join(' › ')
}

/** Speed channels of a property: see the file header. */
export function speedChannels(p: GraphProp): (number | null)[] {
  if (p.dims <= 1) return [0]
  if (p.spatial || p.linked) return [null]
  return p.shown
}

/* -------------------------------------------------------------------------- */
/*                               Values and speeds                            */
/* -------------------------------------------------------------------------- */

/** Root frames per local frame (1 when the map is not linear: speeds are then approximate). */
function timeScale(p: GraphProp): number {
  const s = p.map?.scale
  return s && Number.isFinite(s) && s !== 0 ? s : 1
}

/**
 * Speed of a channel inside a segment at progress `x` (0..1), in stored units per local frame.
 * `dim` null: the speed along the motion (signed: negative while an overshooting easing runs
 * backwards); for dimensions easing independently, the length of the velocity vector.
 */
export function segmentSpeed(seg: SegmentInfo, dim: number | null, x: number): number {
  const T = seg.t1 - seg.t0
  if (seg.hold || !(T > 0)) return 0
  if (dim !== null) {
    const d = seg.end[dim] ?? 0
    return ((d - (seg.start[dim] ?? 0)) * easeSlope(seg.eases[dim] ?? seg.eases[0], x)) / T
  }
  if (seg.spatial || seg.linked) return (seg.length * easeSlope(seg.eases[0], x)) / T
  let sum = 0
  for (let d = 0; d < seg.start.length; d++) {
    const v = (((seg.end[d] ?? 0) - seg.start[d]) * easeSlope(seg.eases[d], x)) / T
    sum += v * v
  }
  return Math.sqrt(sum)
}

/** Converts a local-frame speed (stored units) to display units per second of root time. */
export function displaySpeed(p: GraphProp, speed: number, fps: number): number {
  return (speed / timeScale(p)) * fps * p.factor
}

/** Converts a display speed (units per root second) back to stored units per local frame. */
export function storedSpeed(p: GraphProp, speed: number, fps: number): number {
  return fps > 0 ? (speed * timeScale(p)) / fps / p.factor : 0
}

/** Values of a property at a local frame (stored units), as the evaluator computes them. */
export function valuesAt(p: GraphProp, local: number): number[] {
  return evaluateArray(p.prop, local)
}

const SAMPLES = 24

/** Largest speed worth fitting in view: zero-length handles make it (nearly) infinite. */
function speedCap(seg: SegmentInfo, dim: number | null): number {
  const T = seg.t1 - seg.t0
  const change = dim === null ? seg.length : Math.abs((seg.end[dim] ?? 0) - (seg.start[dim] ?? 0))
  return T > 0 ? (Math.max(change, 1e-6) / T) * 50 : 0
}

const extentCache = new WeakMap<GraphProp, Map<string, [number, number]>>()

/** Extent of a curve in display units, sampled like it is drawn (memoized per property). */
function curveExtent(
  p: GraphProp,
  dim: number | null,
  mode: GraphMode,
  fps: number,
): [number, number] {
  let byCurve = extentCache.get(p)
  if (!byCurve) {
    byCurve = new Map()
    extentCache.set(p, byCurve)
  }
  const key = `${mode}|${dim}|${fps}`
  let extent = byCurve.get(key)
  if (!extent) {
    extent = sampleExtent(p, dim, mode, fps)
    byCurve.set(key, extent)
  }
  return extent
}

function sampleExtent(
  p: GraphProp,
  dim: number | null,
  mode: GraphMode,
  fps: number,
): [number, number] {
  let min = Infinity
  let max = -Infinity
  const add = (v: number) => {
    if (!Number.isFinite(v)) return
    if (v < min) min = v
    if (v > max) max = v
  }
  if (mode === 'value') {
    const d = dim ?? 0
    for (const v of p.keyValues) add((v[d] ?? 0) * p.factor)
    for (const seg of p.segments) {
      if (seg.hold || !(seg.t1 > seg.t0)) continue
      for (let i = 1; i < SAMPLES; i++) {
        add((valuesAt(p, seg.t0 + ((seg.t1 - seg.t0) * i) / SAMPLES)[d] ?? 0) * p.factor)
      }
    }
    return [min, max]
  }
  // Speeds are sampled in proportion to time, so a lone spike (a value jumping within a frame
  // or two) cannot flatten every other curve: see robustRange.
  const samples: number[] = [0]
  for (const seg of p.segments) {
    const T = seg.t1 - seg.t0
    if (seg.hold || !(T > 0)) continue
    const cap = speedCap(seg, dim)
    const count = Math.max(4, Math.min(240, Math.round(T * 4)))
    for (let i = 0; i <= count; i++) {
      const s = segmentSpeed(seg, dim, i / count)
      samples.push(displaySpeed(p, Math.max(-cap, Math.min(cap, s)), fps))
    }
  }
  return robustRange(samples)
}

/**
 * Range of speed samples that leaves out rare extremes: speeds beyond three times the typical
 * magnitude (98th percentile of |speed|) run off-screen instead of flattening the curve.
 */
export function robustRange(samples: number[]): [number, number] {
  const values = samples.filter(Number.isFinite)
  if (values.length === 0) return [0, 0]
  const magnitudes = values.map(Math.abs).sort((a, b) => a - b)
  const typical = magnitudes[Math.floor(0.98 * (magnitudes.length - 1))]
  let lo = 0
  let hi = 0
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (typical > 0) {
    hi = Math.min(hi, typical * 3)
    lo = Math.max(lo, -typical * 3)
  }
  return [lo, hi]
}

/* -------------------------------------------------------------------------- */
/*                                    Build                                   */
/* -------------------------------------------------------------------------- */

/** Document order of a property: its layer's path, then its place among the layer's properties. */
function orderKey(doc: Animation, path: NodePath, t: Dict): [string, number] {
  const layerPath = layerPathOf(path) ?? path
  const layer = getAt<Layer>(doc, layerPath)
  const props = layer ? layerModel(layer, layerPath, t).props : []
  const index = props.findIndex((p) => pathEquals(p.path, path))
  // Root layers before precomp content; numeric segments compare numerically.
  const sortable = layerPath
    .map((seg) => (typeof seg === 'number' ? String(seg).padStart(6, '0') : seg))
    .join('/')
  return [`${layerPath[0] === 'layers' ? 0 : 1}/${sortable}`, index]
}

/** Builds the curves of the graph for `paths` (deduplicated, in document order). */
export function buildGraphModel(
  doc: Animation,
  paths: readonly NodePath[],
  t: Dict,
  opts: GraphModelOptions,
): GraphModel {
  const unique = new Map<string, NodePath>()
  for (const p of paths) unique.set(pathKey(p), p)
  const ordered = [...unique.values()]
    .map((path) => ({ path, order: orderKey(doc, path, t) }))
    .sort((a, b) =>
      a.order[0] === b.order[0] ? a.order[1] - b.order[1] : a.order[0] < b.order[0] ? -1 : 1,
    )
  const props: GraphProp[] = []
  let unsupported = 0
  for (const { path } of ordered) {
    const p = graphProp(doc, path, t, opts)
    if (p === 'unsupported') unsupported++
    else if (p && props.length < MAX_GRAPH_PROPS) props.push(p)
  }

  const curves: GraphCurve[] = []
  let single = 0
  for (const p of props) {
    const channels = opts.mode === 'value' ? p.shown : speedChannels(p)
    const axis = splitAxis(p.path)
    const oneCurve = channels.length === 1 && (p.dims <= 1 || channels[0] === null)
    const color = oneCurve
      ? axis >= 0
        ? AXIS_COLORS[axis]
        : CURVE_COLORS[single++ % CURVE_COLORS.length]
      : null
    for (const dim of channels) {
      const [min, max] = curveExtent(p, dim, opts.mode, doc.fr)
      curves.push({
        id: `${p.key}|${dim ?? 'speed'}`,
        prop: p,
        dim,
        dimLabel:
          oneCurve || dim === null ? '' : (p.kind === 'color' ? COLOR_LABELS : AXIS_LABELS)[dim],
        color: color ?? AXIS_COLORS[dim ?? 0],
        offset: 0,
        scale: 1,
        min,
        max,
      })
    }
  }

  let min = Infinity
  let max = -Infinity
  for (const c of curves) {
    if (!(c.max >= c.min)) continue
    if (opts.normalize) {
      if (c.max - c.min > 1e-9) {
        c.offset = c.min
        c.scale = c.max - c.min
      } else {
        // A flat curve sits in the middle; a drag of the full height changes it by about its value.
        c.scale = Math.max(1, Math.abs(c.min))
        c.offset = c.min - c.scale / 2
      }
    }
    const lo = (c.min - c.offset) / c.scale
    const hi = (c.max - c.offset) / c.scale
    min = Math.min(min, lo)
    max = Math.max(max, hi)
  }
  return {
    mode: opts.mode,
    normalize: opts.normalize,
    props,
    curves,
    min,
    max,
    unsupported,
    fps: doc.fr,
  }
}
