/**
 * Working-copy model shared by the techniques: compositions, layers, shape items and every
 * animatable property with its value role (what the numbers mean) and coordinate space (which
 * transforms scale it on screen).
 *
 * Techniques mutate the working copy in place; this module only reads. The schema knowledge is
 * explicit (keys per shape type) so that unknown data is never touched: a property is only
 * rounded or simplified when its meaning is known.
 */
import { arr, isObj, num, type Json } from '../compat'
import { expressionReach, type ExpressionReach } from './expressions'

export type { Json }
export { arr, isObj, num }

/* -------------------------------------------------------------------------- */
/*                                 Document                                   */
/* -------------------------------------------------------------------------- */

export interface Comp {
  /** Asset id, or null for the root composition. */
  id: string | null
  /** The precomp asset object (null for the root). */
  asset: Json | null
  /** The object that owns `layers` (root document or asset). */
  owner: Json
}

/** Current layers of a composition (re-read every time: techniques replace arrays). */
export function compLayers(comp: Comp): Json[] {
  return arr(comp.owner.layers).filter(isObj)
}

export function setCompLayers(comp: Comp, layers: unknown[]): void {
  comp.owner.layers = layers
}

/** Root composition followed by every precomposition asset (asset order). */
export function listComps(doc: Json): Comp[] {
  const comps: Comp[] = [{ id: null, asset: null, owner: doc }]
  for (const asset of arr(doc.assets)) {
    if (isObj(asset) && Array.isArray(asset.layers)) {
      comps.push({
        id: typeof asset.id === 'string' ? asset.id : String(asset.id ?? ''),
        asset,
        owner: asset,
      })
    }
  }
  return comps
}

/** First precomposition with each id (lottie-web resolves duplicates to the first). */
export function compsById(comps: readonly Comp[]): Map<string, Comp> {
  const map = new Map<string, Comp>()
  for (const c of comps) if (c.id !== null && !map.has(c.id)) map.set(c.id, c)
  return map
}

/** Parsed Bodymovin version, or null when missing / malformed. */
export function parseVersion(v: unknown): [number, number, number] | null {
  if (typeof v !== 'string') return null
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** a < b for versions (a null version counts as the newest, as lottie-web does). */
export function versionBelow(
  v: [number, number, number] | null,
  min: [number, number, number],
): boolean {
  if (!v) return false
  for (let i = 0; i < 3; i++) {
    if (v[i] !== min[i]) return v[i] < min[i]
  }
  return false
}

/* -------------------------------------------------------------------------- */
/*                                 Properties                                 */
/* -------------------------------------------------------------------------- */

/**
 * A keyframe list: every entry an object with a numeric time. A list with a damaged entry (null,
 * a number, no time) is not one: nothing treats it as a property, so it is left as it is.
 */
export function isKeyframeList(k: unknown): k is Json[] {
  if (!Array.isArray(k) || k.length === 0) return false
  for (const kf of k) if (!isObj(kf) || typeof kf.t !== 'number') return false
  return true
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function isPointList(v: unknown): v is unknown[][] {
  return (
    Array.isArray(v) &&
    v.every((p) => Array.isArray(p) && p.length >= 2 && finite(p[0]) && finite(p[1]))
  )
}

/** A bezier path value: vertex and tangent lists of finite points, all of the same length. */
export function isPathValue(v: unknown): boolean {
  if (!isObj(v) || !isPointList(v.v) || !isPointList(v.i) || !isPointList(v.o)) return false
  return v.i.length === v.v.length && v.o.length === v.v.length
}

/** What a keyframe value is: numbers (a number or a list), a `[path]`, or damaged. */
function valueKind(v: unknown): 'numbers' | 'path' | null {
  if (finite(v)) return 'numbers'
  if (!Array.isArray(v)) return null
  if (v.length === 1 && isObj(v[0])) return isPathValue(v[0]) ? 'path' : null
  return v.every(finite) ? 'numbers' : null
}

/** One easing coordinate: a number, or one number per dimension. */
const isHandleCoordinate = (c: unknown) =>
  finite(c) || (Array.isArray(c) && c.length > 0 && c.every(finite))

/** Easing handle: `x` and `y` numbers or number lists (one per dimension). */
function isHandle(h: unknown): boolean {
  if (h === undefined) return true
  return isObj(h) && isHandleCoordinate(h.x) && isHandleCoordinate(h.y)
}

const isTangent = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(finite))

/**
 * Every keyframe can be evaluated: finite time, values, easing handles and spatial tangents.
 * Steps that evaluate curves (keyframe removal, rounding checked against the curve) leave
 * damaged properties alone instead of failing the whole file.
 */
export function isEvaluableKeyframes(kfs: readonly Json[]): boolean {
  // Every value of one property is of the same kind (a path never interpolates with numbers).
  let kind: 'numbers' | 'path' | null = null
  const sameKind = (v: unknown) => {
    if (v === undefined) return true
    const k = valueKind(v)
    if (!k || (kind && k !== kind)) return false
    kind = k
    return true
  }
  return kfs.every(
    (kf) =>
      finite(kf.t) &&
      sameKind(kf.s) &&
      sameKind(kf.e) &&
      isHandle(kf.i) &&
      isHandle(kf.o) &&
      isTangent(kf.to) &&
      isTangent(kf.ti),
  )
}

/** A property object: `{ k }` with keyframes, numbers, number arrays or a bezier path. */
export function isProperty(v: unknown): v is Json {
  if (!isObj(v) || !('k' in v)) return false
  const k = v.k
  if (typeof k === 'number') return true
  if (Array.isArray(k)) return k.length === 0 || typeof k[0] === 'number' || isKeyframeList(k)
  return isObj(k) && Array.isArray(k.v)
}

/** Same test as `isProperty` for an object already known to be one (no type narrowing). */
export function isPropertyObject(v: Json): boolean {
  return isProperty(v)
}

export function hasExpression(prop: Json): boolean {
  return typeof prop.x === 'string' && prop.x.trim().length > 0
}

/**
 * What the numbers of a property mean, which decides how much they may change:
 *  - coord: pixels in the property's coordinate space (positions, sizes, radii, widths)
 *  - path: bezier path (vertices and tangents are coordinates)
 *  - scale: percent scale (relative precision)
 *  - angle: degrees of a rotation-like value (rotation, skew, star rotation, highlight angle)
 *  - opacity: percent 0..100
 *  - color: 0..1 channels (0..255 in files older than 4.1.9 for fills and strokes)
 *  - gradient: flat gradient data (offsets and channels, 0..1)
 *  - percent: percent of a length or size (trim start/end, star roundness, highlight length)
 *  - trimOffset: degrees of a trim offset (360 = the whole path)
 *  - exact: discrete or time values that must not change (counts, time remap, unknown)
 */
export type PropRole =
  | 'coord'
  | 'path'
  | 'scale'
  | 'angle'
  | 'opacity'
  | 'color'
  | 'gradient'
  | 'percent'
  | 'trimOffset'
  | 'exact'

/** A coordinate space: the product of the transforms from it up to the root composition. */
export type Space =
  | { kind: 'layerOuter'; layer: Json; comp: Comp }
  | { kind: 'layerContent'; layer: Json; comp: Comp }
  | { kind: 'group'; parent: Space; group: Json }
  | { kind: 'repeat'; parent: Space; repeater: Json }

export interface PropertyVisit {
  prop: Json
  role: PropRole
  /** Space of the coordinates (for coord/path roles) or of the content it scales/rotates. */
  space: Space
  layer: Json
  comp: Comp
  /** Key of the property in its owner (e.g. 'p', 'ks', 'c'). */
  key: string
  owner: Json
  /** Fill / stroke color of a file older than 4.1.9: channels are 0..255. */
  legacyColor: boolean
  /** Errors multiply by this factor (repeater transform accumulated over copies). */
  gain: number
  /** Layer position with auto-orient: the direction of motion rotates the layer. */
  orients: boolean
  /** Part of a transform (layer `ks`, group `tr`, repeater `tr`): moves whole contents. */
  transform: boolean
}

export interface VisitOptions {
  /** Legacy color scale (files older than 4.1.9). */
  legacyColors: boolean
}

interface EmitFlags {
  /** Errors multiply by this factor. */
  gain?: number
  transform?: boolean
  orients?: boolean
}

type Emit = (
  prop: unknown,
  role: PropRole,
  key: string,
  owner: Json,
  space: Space,
  flags?: EmitFlags,
) => void

function visitTransform(
  tr: Json,
  outer: Space,
  content: Space,
  emit: Emit,
  orients = false,
  gain = 1,
): void {
  const t: EmitFlags = { gain, transform: true }
  // With auto-orient the position also rotates the layer (its direction of motion).
  const pos: EmitFlags = { ...t, orients }
  const p = tr.p
  if (isObj(p) && p.s === true) {
    for (const k of ['x', 'y', 'z']) emit(p[k], 'coord', k, p, outer, pos)
  } else emit(p, 'coord', 'p', tr, outer, pos)
  emit(tr.a, 'coord', 'a', tr, content, t)
  emit(tr.s, 'scale', 's', tr, content, t)
  for (const k of ['r', 'rx', 'ry', 'rz', 'sk', 'sa']) emit(tr[k], 'angle', k, tr, content, t)
  emit(tr.or, 'angle', 'or', tr, content, t)
  emit(tr.o, 'opacity', 'o', tr, content, t)
}

function visitDashes(d: unknown, space: Space, emit: Emit): void {
  for (const dash of arr(d)) if (isObj(dash)) emit(dash.v, 'coord', 'v', dash, space)
}

/**
 * Walks shape items: styles and geometry use the space of their group; a group's transform
 * position is in the parent space, its anchor (and its content) in its own space. Items above
 * a repeater are drawn in every copy, so their space includes the repeater's accumulation.
 */
function visitShapes(items: unknown, space: Space, emit: Emit): void {
  const list = arr(items).filter(isObj)
  // Repeaters apply to the items above them: walk top-down with the repeater spaces known.
  const spaces: Space[] = list.map(() => space)
  let current = space
  for (let i = list.length - 1; i >= 0; i--) {
    spaces[i] = current
    if (list[i].ty === 'rp') current = { kind: 'repeat', parent: current, repeater: list[i] }
  }
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    const s = spaces[i]
    switch (item.ty) {
      case 'gr': {
        // The group transform is its last `tr` (bodymovin writes exactly one, last).
        const tr = arr(item.it).findLast((c): c is Json => isObj(c) && c.ty === 'tr')
        const inner: Space = { kind: 'group', parent: s, group: item }
        if (tr) visitTransform(tr, s, inner, emit)
        visitShapes(
          arr(item.it).filter((c) => c !== tr),
          inner,
          emit,
        )
        break
      }
      case 'sh':
        emit(item.ks, 'path', 'ks', item, s)
        break
      case 'rc':
        emit(item.p, 'coord', 'p', item, s)
        emit(item.s, 'coord', 's', item, s)
        emit(item.r, 'coord', 'r', item, s)
        break
      case 'el':
        emit(item.p, 'coord', 'p', item, s)
        emit(item.s, 'coord', 's', item, s)
        break
      case 'sr':
        emit(item.p, 'coord', 'p', item, s)
        emit(item.or, 'coord', 'or', item, s)
        emit(item.ir, 'coord', 'ir', item, s)
        emit(item.os, 'percent', 'os', item, s)
        emit(item.is, 'percent', 'is', item, s)
        emit(item.r, 'angle', 'r', item, s)
        emit(item.pt, 'exact', 'pt', item, s)
        break
      case 'fl':
        emit(item.c, 'color', 'c', item, s)
        emit(item.o, 'opacity', 'o', item, s)
        break
      case 'st':
        emit(item.c, 'color', 'c', item, s)
        emit(item.o, 'opacity', 'o', item, s)
        emit(item.w, 'coord', 'w', item, s)
        visitDashes(item.d, s, emit)
        emit(item.ml2, 'exact', 'ml2', item, s)
        break
      case 'gf':
      case 'gs': {
        const g = item.g
        if (isObj(g)) emit(g.k, 'gradient', 'k', g, s)
        emit(item.s, 'coord', 's', item, s)
        emit(item.e, 'coord', 'e', item, s)
        emit(item.h, 'percent', 'h', item, s)
        emit(item.a, 'angle', 'a', item, s)
        emit(item.o, 'opacity', 'o', item, s)
        if (item.ty === 'gs') {
          emit(item.w, 'coord', 'w', item, s)
          visitDashes(item.d, s, emit)
          emit(item.ml2, 'exact', 'ml2', item, s)
        }
        break
      }
      case 'tm':
        emit(item.s, 'percent', 's', item, s)
        emit(item.e, 'percent', 'e', item, s)
        emit(item.o, 'trimOffset', 'o', item, s)
        break
      case 'rp': {
        emit(item.c, 'exact', 'c', item, s)
        emit(item.o, 'exact', 'o', item, s)
        const tr = item.tr
        if (isObj(tr)) {
          // Copy k is transformed k times: errors of the repeater transform accumulate.
          const copies = Math.max(1, Math.min(1000, Math.ceil(staticMax(item.c) ?? 1)))
          visitTransform(tr, s, s, emit, false, copies)
          emit(tr.so, 'opacity', 'so', tr, s, { transform: true })
          emit(tr.eo, 'opacity', 'eo', tr, s, { transform: true })
        }
        break
      }
      case 'rd':
        emit(item.r, 'coord', 'r', item, s)
        break
      case 'op':
        emit(item.a, 'coord', 'a', item, s)
        emit(item.ml, 'exact', 'ml', item, s)
        break
      case 'pb':
        emit(item.a, 'percent', 'a', item, s)
        break
      case 'tw':
        emit(item.a, 'angle', 'a', item, s)
        emit(item.c, 'coord', 'c', item, s)
        break
      case 'zz':
        emit(item.s, 'coord', 's', item, s)
        emit(item.r, 'exact', 'r', item, s)
        emit(item.pt, 'exact', 'pt', item, s)
        break
      default:
        break
    }
  }
}

/** Largest value a static or keyframed scalar property takes at its keyframes. */
function staticMax(prop: unknown): number | undefined {
  if (!isObj(prop)) return undefined
  const k = prop.k
  if (typeof k === 'number') return k
  if (Array.isArray(k) && typeof k[0] === 'number') return k[0]
  if (isKeyframeList(k)) {
    let max = -Infinity
    for (const kf of k) {
      const s = kf.s
      const v = Array.isArray(s) ? s[0] : s
      if (typeof v === 'number' && v > max) max = v
    }
    return Number.isFinite(max) ? max : undefined
  }
  return undefined
}

/**
 * Visits every animatable property of a layer whose meaning is known, with its role and space.
 * Text layers' text data and effect / layer-style values are not visited (they keep their
 * exact numbers).
 */
export function visitLayerProperties(
  layer: Json,
  comp: Comp,
  opts: VisitOptions,
  cb: (v: PropertyVisit) => void,
): void {
  const outer: Space = { kind: 'layerOuter', layer, comp }
  const content: Space = { kind: 'layerContent', layer, comp }
  const orients = layer.ao === 1
  const emit: Emit = (prop, role, key, owner, space, flags = {}) => {
    if (!isProperty(prop)) return
    const legacyColor =
      role === 'color' && opts.legacyColors && (owner.ty === 'fl' || owner.ty === 'st')
    cb({
      prop,
      role,
      space,
      layer,
      comp,
      key,
      owner,
      legacyColor,
      gain: flags.gain ?? 1,
      orients: flags.orients === true,
      transform: flags.transform === true,
    })
  }
  if (isObj(layer.ks)) visitTransform(layer.ks, outer, content, emit, orients)
  // Time remap is a time: kept exact, but visited so that keyframe rules (legacy) apply.
  emit(layer.tm, 'exact', 'tm', layer, outer)
  for (const mask of arr(layer.masksProperties)) {
    if (!isObj(mask)) continue
    emit(mask.pt, 'path', 'pt', mask, content)
    emit(mask.o, 'opacity', 'o', mask, content)
    emit(mask.x, 'coord', 'x', mask, content)
  }
  if (layer.ty === 4) visitShapes(layer.shapes, content, emit)
}

/** Every property of a layer, known or not (including effects and text), for structural steps. */
export function forEachPropertyDeep(
  layer: Json,
  cb: (prop: Json, isTextDocument: boolean) => void,
): void {
  const stack: unknown[] = []
  for (const key of Object.keys(layer)) {
    const v = layer[key]
    if (key === 't' && isObj(v)) {
      // Text data: `d` is the (always keyframed) text document; animators hold properties.
      if (isObj(v.d)) cb(v.d, true)
      for (const k of Object.keys(v)) if (k !== 'd' && typeof v[k] === 'object') stack.push(v[k])
      continue
    }
    if (typeof v === 'object' && v !== null) stack.push(v)
  }
  while (stack.length) {
    const v = stack.pop()
    if (Array.isArray(v)) {
      for (const c of v) if (typeof c === 'object' && c !== null) stack.push(c)
      continue
    }
    if (!isObj(v)) continue
    if (isProperty(v)) {
      cb(v, false)
      continue
    }
    for (const key of Object.keys(v)) {
      const c = v[key]
      if (typeof c === 'object' && c !== null) stack.push(c)
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                              Document context                              */
/* -------------------------------------------------------------------------- */

export interface DocContext {
  doc: Json
  version: [number, number, number] | null
  /** Fill / stroke colors are 0..255 (lottie-web divides them for files older than 4.1.9). */
  legacyColors: boolean
  /** Paths take `c` from the shape's `closed` / mask's `cl` (files older than 4.4.18). */
  legacyClosed: boolean
  /** Number of properties with expressions (anywhere, including effects and text). */
  expressions: number
  /** What those expressions can reach (see expressions.ts). */
  reach: ExpressionReach
  /** Properties bound to slots (themes). */
  slots: number
  /** Some layer uses a blend mode other than normal (lottie-web canvas keeps blend state). */
  blendModes: boolean
  threeD: boolean
}

export function buildContext(doc: Json): DocContext {
  const version = parseVersion(doc.v)
  const sources: string[] = []
  let slots = 0
  let blendModes = false
  let threeD = doc.ddd === 1
  for (const comp of listComps(doc)) {
    for (const layer of compLayers(comp)) {
      if (typeof layer.bm === 'number' && layer.bm !== 0) blendModes = true
      if (layer.ddd === 1 || layer.ty === 13) threeD = true
      forEachPropertyDeep(layer, (prop) => {
        if (hasExpression(prop)) sources.push(prop.x as string)
        if (typeof prop.sid === 'string') slots++
      })
    }
  }
  return {
    doc,
    version,
    legacyColors: versionBelow(version, [4, 1, 9]),
    legacyClosed: versionBelow(version, [4, 4, 18]),
    expressions: sources.length,
    reach: expressionReach(sources),
    slots,
    blendModes,
    threeD,
  }
}

/* -------------------------------------------------------------------------- */
/*                               Layer references                             */
/* -------------------------------------------------------------------------- */

/**
 * Layers that must stay because other layers depend on them: parents (`parent`), matte
 * sources by `tp`, the layer right above a matted layer without `tp` (adjacent matte), and
 * matte sources (`td`) themselves — removing a matte pair member orphans the other on some
 * players.
 */
export function protectedLayers(layers: readonly Json[]): Set<Json> {
  const keep = new Set<Json>()
  const byInd = new Map<number, Json[]>()
  for (const l of layers) {
    const ind = num(l.ind)
    if (ind === undefined) continue
    const list = byInd.get(ind)
    if (list) list.push(l)
    else byInd.set(ind, [l])
  }
  layers.forEach((l, i) => {
    const parent = num(l.parent)
    if (parent !== undefined) for (const p of byInd.get(parent) ?? []) keep.add(p)
    const tp = num(l.tp)
    if (tp !== undefined) for (const p of byInd.get(tp) ?? []) keep.add(p)
    if ((num(l.tt) ?? 0) > 0) {
      keep.add(l)
      if (i > 0) keep.add(layers[i - 1])
      // lottie-web's canvas renderer looks the source up by ind - 1.
      const ind = num(l.ind)
      if (ind !== undefined) for (const p of byInd.get(ind - 1) ?? []) keep.add(p)
    }
    if (l.td !== undefined && l.td !== 0) keep.add(l)
  })
  return keep
}
