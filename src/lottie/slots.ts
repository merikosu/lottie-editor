/**
 * Lottie slots and dotLottie themes.
 *
 * Slots (Lottie 1.0, lottie-web ≥ 5.11): a property carries `sid` and the root `slots`
 * dictionary holds the value that replaces it, `slots[sid].p`. lottie-web applies it with
 * `Object.assign(property, slots[sid].p)` (SlotManager, for every animatable property, image
 * assets and text documents); ThorVG, the core of the dotLottie players, does the same. Players
 * without slot support (lottie-ios, lottie-android) draw the property's own value, so the editor
 * keeps every inline copy equal to the slot value: binding, editing and unbinding never change
 * what any player shows.
 *
 * Themes (dotLottie 2, `t/<id>.json`) are lists of rules `{ id: <sid>, type, value | keyframes }`.
 * A player applying a theme turns each rule into a slot value (dotlottie-rs `theme.rs`); rules
 * for slots the animation does not have are ignored and slots without a rule keep their value.
 * The conversion below mirrors dotlottie-rs exactly (Color drops alpha, Vector/Position keep two
 * dimensions, a keyframe's `inTangent`/`outTangent` become that keyframe's `i`/`o`, a keyframe
 * without `inTangent` interpolates linearly as in ThorVG) and then normalizes the values the
 * way lottie-web needs them for the preview (keyframe values as arrays, consistent easing
 * handles, a lone keyframe as a static value).
 *
 * Everything here is pure: document edits mutate an immer draft (use inside `updateDoc`), theme
 * data is never mutated (new objects are returned).
 */
import { current, isDraft } from 'immer'
import type { RGBA } from '@/lib/color'
import { encodeChannel, to8, usesLegacyColorScale, type ColorUsage } from './colors'
import {
  getAt,
  isLayerPath,
  layerPathOf,
  pathKey,
  setAt,
  type NodePath,
  type PathSegment,
} from './path'
import { isKeyframe } from './property'
import type { Animation } from './types'

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

/** What a slot holds (the dotLottie theme rule types, plus paths and unknown values). */
export type SlotKind =
  'color' | 'scalar' | 'vector' | 'position' | 'gradient' | 'image' | 'text' | 'path' | 'unknown'

/** What a slotted object is in the animation (labels, kind detection). */
export type SlotRole =
  | 'fill-color'
  | 'stroke-color'
  | 'text-color'
  | 'effect-color'
  | 'style-color'
  | 'gradient'
  | 'opacity'
  | 'stroke-width'
  | 'rotation'
  | 'scalar'
  | 'position'
  | 'anchor'
  | 'scale'
  | 'size'
  | 'text'
  | 'image'
  | 'path'
  | 'other'

/** One object that carries a `sid`. */
export interface SlotRef {
  /** Path of the object with the `sid` (a property, a gradient, a text document, an image asset). */
  path: NodePath
  role: SlotRole
  /** Layer that contains it (null for image assets). */
  layerPath: NodePath | null
  /** Shape item that contains it (fill, stroke…), otherwise the layer (null for image assets). */
  nodePath: NodePath | null
}

export interface SlotInfo {
  id: string
  kind: SlotKind
  /** Defined in the root `slots` dictionary (otherwise only `sid`s exist and each keeps its value). */
  defined: boolean
  /**
   * The value players use by default: `slots[id].p`, or the first reference when the dictionary
   * has no entry. Null when neither exists.
   */
  value: Record<string, unknown> | null
  /** Objects bound to the slot, in document order. */
  refs: SlotRef[]
  /** The default value is keyframed. */
  animated: boolean
}

/** dotLottie theme rule types (dotLottie 2 spec, dotlottie-rs). */
export type ThemeRuleType =
  'Color' | 'Scalar' | 'Vector' | 'Position' | 'Gradient' | 'Image' | 'Text'

export const THEME_RULE_TYPES: readonly ThemeRuleType[] = [
  'Color',
  'Scalar',
  'Vector',
  'Position',
  'Gradient',
  'Image',
  'Text',
]

/** Easing handle of a theme keyframe (same format as Lottie's `i`/`o`). */
export interface ThemeTangent {
  x: number | number[]
  y: number | number[]
}

export interface ThemeKeyframe {
  frame: number
  value: unknown
  inTangent?: ThemeTangent
  outTangent?: ThemeTangent
  hold?: boolean
  /** Position only: spatial tangents. */
  valueInTangent?: number[]
  valueOutTangent?: number[]
}

/** One rule of a theme (`t/<id>.json` → `rules[]`). Unknown fields are kept as they are. */
export interface ThemeRule {
  /** Slot id (case-sensitive). */
  id: string
  type: string
  /** Animation ids the rule is limited to (all animations when absent). */
  animations?: string[]
  value?: unknown
  keyframes?: ThemeKeyframe[]
  expression?: string
  [key: string]: unknown
}

/* -------------------------------------------------------------------------- */
/*                                Small helpers                               */
/* -------------------------------------------------------------------------- */

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

function isNumberArray(v: unknown, min = 1): v is number[] {
  return Array.isArray(v) && v.length >= min && v.every(isNum)
}

function isColorArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length >= 3 && isNum(v[0]) && isNum(v[1]) && isNum(v[2])
}

/** Plain (non-draft) view of a document for reading inside or outside immer recipes. */
function snapshot<T extends object>(value: T): T {
  return isDraft(value) ? (current(value as never) as T) : value
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Property-like: an object with `k` (static value, keyframes or a bezier path). */
function isPropertyObject(v: unknown): v is Obj & { k: unknown } {
  if (!isObj(v) || !('k' in v)) return false
  if (v.a === 0 || v.a === 1) return true
  const k = v.k
  if (typeof k === 'number') return true
  if (Array.isArray(k)) return k.length === 0 || isNum(k[0]) || isKeyframe(k[0])
  return isObj(k) && Array.isArray(k.v)
}

/** The value a property shows before its first keyframe (static value, or the first `s`). */
function firstValue(prop: Obj | null): unknown {
  if (!prop) return undefined
  const k = prop.k
  const head: unknown = Array.isArray(k) ? k[0] : undefined
  if (isObj(head) && isKeyframe(head)) return head.s ?? head.e
  return k
}

function isKeyframed(prop: Obj | null): boolean {
  const k = prop?.k
  return Array.isArray(k) && k.length > 0 && isKeyframe(k[0])
}

/* -------------------------------------------------------------------------- */
/*                                  Discovery                                 */
/* -------------------------------------------------------------------------- */

interface RawRef {
  sid: string
  path: NodePath
}

/**
 * Collects the objects with a `sid` under `node`. Properties never contain other properties,
 * so the walk stops at them (keyframes and path data are never visited).
 */
function collectSids(node: unknown, path: NodePath, out: RawRef[], depth: number): void {
  if (depth > 200) return
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) collectSids(node[i], [...path, i], out, depth + 1)
    return
  }
  if (!isObj(node)) return
  if (typeof node.sid === 'string' && node.sid) out.push({ sid: node.sid, path })
  if (isPropertyObject(node)) return
  for (const key of Object.keys(node)) {
    const child = node[key]
    if (child !== null && typeof child === 'object')
      collectSids(child, [...path, key], out, depth + 1)
  }
}

const TRANSFORM_ROLES: Record<string, SlotRole> = {
  o: 'opacity',
  p: 'position',
  a: 'anchor',
  s: 'scale',
  r: 'rotation',
  rz: 'rotation',
  rx: 'rotation',
  ry: 'rotation',
  sk: 'scalar',
  sa: 'rotation',
  so: 'opacity',
  eo: 'opacity',
}

/** What the object at `path` is, from its key and its parent (shape item type, effect…). */
export function slotRole(root: unknown, path: NodePath): SlotRole {
  const n = path.length
  const key = path[n - 1]
  const parentPath = path.slice(0, -1)
  const parent = getAt<unknown>(root, parentPath)
  const node = getAt<unknown>(root, path)

  if (n === 2 && path[0] === 'assets') return 'image'
  if (key === 'd' && path[n - 2] === 't') return 'text'
  if (isObj(parent) && (parent.ty === 'gf' || parent.ty === 'gs') && key === 'g') return 'gradient'
  if (key === 'k' && path[n - 2] === 'g') return 'gradient'
  if (isObj(node) && isObj(node.k) && Array.isArray(node.k.v)) return 'path'
  if (key === 'pt' && path[n - 3] === 'masksProperties') return 'path'

  // Layer transform, shape group transform, repeater transform.
  if (path[n - 2] === 'ks' || path[n - 2] === 'tr' || (isObj(parent) && parent.ty === 'tr'))
    return TRANSFORM_ROLES[String(key)] ?? 'other'

  if (isObj(parent)) {
    switch (parent.ty) {
      case 'fl':
        return key === 'c' ? 'fill-color' : key === 'o' ? 'opacity' : 'other'
      case 'st':
        if (key === 'c') return 'stroke-color'
        if (key === 'w') return 'stroke-width'
        return key === 'o' ? 'opacity' : 'other'
      case 'gf':
      case 'gs':
        if (key === 's' || key === 'e') return 'position'
        if (key === 'w') return 'stroke-width'
        if (key === 'o') return 'opacity'
        return key === 'h' || key === 'a' ? 'scalar' : 'other'
      case 'rc':
        return key === 's' ? 'size' : key === 'p' ? 'position' : key === 'r' ? 'scalar' : 'other'
      case 'el':
        return key === 's' ? 'size' : key === 'p' ? 'position' : 'other'
      case 'sr':
        return key === 'p' ? 'position' : key === 'r' ? 'rotation' : 'scalar'
      case 'tm':
      case 'rd':
      case 'op':
      case 'pb':
      case 'zz':
      case 'tw':
        return 'scalar'
      case 'rp':
        return 'scalar'
      case 'sh':
        return key === 'ks' ? 'path' : 'other'
    }
  }

  // Effect values: ef[i].ef[j].v (color control = ty 2).
  if (key === 'v' && isObj(parent) && path[n - 3] === 'ef') {
    if (parent.ty === 2) return 'effect-color'
    if (parent.ty === 3) return 'position'
    return 'scalar'
  }
  // Text animator properties: t.a[j].a.<key>.
  if (path[n - 2] === 'a' && path[n - 4] === 'a' && path[n - 5] === 't') {
    if (key === 'fc' || key === 'sc') return 'text-color'
    if (key === 'o' || key === 'fo' || key === 'so') return 'opacity'
    if (key === 'p') return 'position'
    if (key === 'a') return 'anchor'
    if (key === 's') return 'scale'
    if (key === 'r' || key === 'rx' || key === 'ry' || key === 'rz') return 'rotation'
    return 'scalar'
  }
  // Layer styles: sy[i].<key>.
  if (path[n - 3] === 'sy') {
    if (key === 'c' || key === 'hc' || key === 'sc') return 'style-color'
    return 'scalar'
  }
  if (path[n - 3] === 'masksProperties') return key === 'o' ? 'opacity' : 'scalar'
  return 'other'
}

const COLOR_ROLES: ReadonlySet<SlotRole> = new Set([
  'fill-color',
  'stroke-color',
  'text-color',
  'effect-color',
  'style-color',
])

/** Kind of a value by its shape (for slots without references). Mirrors dotlottie-rs's guess. */
export function kindOfValue(p: unknown): SlotKind {
  if (!isObj(p)) return 'unknown'
  if ('w' in p || 'h' in p || 'u' in p || (typeof p.p === 'string' && !('k' in p))) return 'image'
  if (isNum(p.p) && isObj(p.k)) return 'gradient'
  const k = p.k
  if (isObj(k) && Array.isArray(k.v)) return 'path'
  const head: unknown = Array.isArray(k) ? k[0] : undefined
  const sample = isObj(head) && isKeyframe(head) ? head.s : k
  if (isNum(sample)) return 'scalar'
  if (isObj(sample)) return typeof sample.t === 'string' ? 'text' : 'unknown'
  if (Array.isArray(sample)) {
    // Keyframed bezier paths hold `[path]` values.
    if (sample.length > 0 && isObj(sample[0])) return 'path'
    if (!sample.every(isNum)) return 'unknown'
    if (sample.length === 1) return 'scalar'
    if (sample.length === 2) return 'vector'
    if (sample.length === 3 || sample.length === 4) return 'color'
  }
  return 'unknown'
}

/** Kind of a slot from the role of the objects bound to it. */
function kindOfRole(role: SlotRole): SlotKind | null {
  if (COLOR_ROLES.has(role)) return 'color'
  switch (role) {
    case 'gradient':
      return 'gradient'
    case 'opacity':
    case 'stroke-width':
    case 'rotation':
    case 'scalar':
      return 'scalar'
    case 'position':
    case 'anchor':
      return 'position'
    case 'scale':
    case 'size':
      return 'vector'
    case 'text':
      return 'text'
    case 'image':
      return 'image'
    case 'path':
      return 'path'
    default:
      return null
  }
}

interface LayerEntry {
  key: string
  refs: RawRef[]
}

// Frozen documents share unchanged layers between versions: their scan results are reused.
const layerCache = new WeakMap<object, LayerEntry>()
const slotsCache = new WeakMap<object, SlotInfo[]>()

function layerRefs(layer: unknown, layerPath: NodePath): RawRef[] {
  const key = pathKey(layerPath)
  // Frozen layers never change: their results are reused (also by drafts' snapshots, whose
  // untouched layers are the frozen originals).
  const frozen = isObj(layer) && Object.isFrozen(layer)
  if (frozen) {
    const hit = layerCache.get(layer)
    if (hit && hit.key === key) return hit.refs
  }
  const refs: RawRef[] = []
  collectSids(layer, layerPath, refs, 0)
  if (frozen) layerCache.set(layer, { key, refs })
  return refs
}

function nodePathOf(path: NodePath, layerPath: NodePath | null): NodePath | null {
  if (!layerPath) return null
  // The innermost shape item on the path ([…'shapes'|'it', i]), else the layer.
  for (let i = path.length - 2; i >= layerPath.length; i--) {
    if ((path[i] === 'shapes' || path[i] === 'it') && typeof path[i + 1] === 'number')
      return path.slice(0, i + 2)
  }
  return layerPath
}

/**
 * Every slot of the document: the entries of the root `slots` dictionary (in their order), then
 * any `sid` that has no entry, in document order. Cached for frozen documents.
 */
export function listSlots(anim: Animation): SlotInfo[] {
  const cacheable = Object.isFrozen(anim)
  if (cacheable) {
    const hit = slotsCache.get(anim)
    if (hit) return hit
  }
  const raw: RawRef[] = []
  if (Array.isArray(anim.layers)) {
    anim.layers.forEach((layer, i) => raw.push(...layerRefs(layer, ['layers', i])))
  }
  if (Array.isArray(anim.assets)) {
    anim.assets.forEach((asset, index) => {
      if (!isObj(asset)) return
      if (Array.isArray(asset.layers)) {
        asset.layers.forEach((layer, i) =>
          raw.push(...layerRefs(layer, ['assets', index, 'layers', i])),
        )
      } else if (typeof asset.sid === 'string' && asset.sid) {
        raw.push({ sid: asset.sid, path: ['assets', index] })
      }
    })
  }

  const dict = isObj(anim.slots) ? anim.slots : {}
  const byId = new Map<string, SlotRef[]>()
  for (const id of Object.keys(dict)) byId.set(id, [])
  for (const r of raw) {
    const layerPath = r.path[0] === 'assets' && r.path.length === 2 ? null : layerPathOf(r.path)
    const ref: SlotRef = {
      path: r.path,
      role: slotRole(anim, r.path),
      layerPath,
      nodePath: nodePathOf(r.path, layerPath),
    }
    const list = byId.get(r.sid)
    if (list) list.push(ref)
    else byId.set(r.sid, [ref])
  }

  const slots: SlotInfo[] = []
  for (const [id, refs] of byId) {
    const entry = dict[id]
    const defined = isObj(entry) && isObj(entry.p)
    const value = defined
      ? (entry.p as Obj)
      : refs.length
        ? (getAt<Obj>(anim, refs[0].path) ?? null)
        : null
    let kind: SlotKind | null = null
    for (const ref of refs) {
      kind = kindOfRole(ref.role)
      if (kind) break
    }
    slots.push({
      id,
      kind: kind ?? kindOfValue(value),
      defined,
      value,
      refs,
      animated: isKeyframed(value),
    })
  }
  if (cacheable) slotsCache.set(anim, slots)
  return slots
}

export function findSlot(anim: Animation, id: string): SlotInfo | undefined {
  return listSlots(anim).find((s) => s.id === id)
}

/** Every slot id the document uses (dictionary entries and `sid`s). */
export function slotIds(anim: Animation): Set<string> {
  return new Set(listSlots(anim).map((s) => s.id))
}

/* -------------------------------------------------------------------------- */
/*                                   Values                                   */
/* -------------------------------------------------------------------------- */

/** Normalized (0..1) color of a color array; 0..255 arrays (very old files) are scaled down. */
function arrayToColor(arr: readonly number[], scale: 1 | 255 = 1): RGBA {
  return {
    r: clamp01(arr[0] / scale),
    g: clamp01(arr[1] / scale),
    b: clamp01(arr[2] / scale),
    a: 1,
  }
}

/**
 * Static color of a color slot (null when it is keyframed, missing or not a color). Players
 * ignore the fourth component of fill/stroke colors, so `a` is always 1.
 */
export function slotColor(slot: Pick<SlotInfo, 'value'>): RGBA | null {
  const v = slot.value
  if (!v || isKeyframed(v)) return null
  return isColorArray(v.k) ? arrayToColor(v.k) : null
}

/** Colors of a keyframed color slot, in keyframe order (for swatches of animated values). */
export function slotKeyframeColors(slot: Pick<SlotInfo, 'value'>): RGBA[] {
  const v = slot.value
  if (!v || !isKeyframed(v)) return []
  const out: RGBA[] = []
  for (const kf of v.k as unknown[]) {
    if (isObj(kf) && isColorArray(kf.s)) out.push(arrayToColor(kf.s))
  }
  return out
}

/** Static number of a scalar slot (null when keyframed or not a number). */
export function slotScalar(slot: Pick<SlotInfo, 'value'>): number | null {
  const v = slot.value
  if (!v || isKeyframed(v)) return null
  const k = v.k
  if (isNum(k)) return k
  return isNumberArray(k) && k.length === 1 ? k[0] : null
}

/** Static vector of a vector/position slot (null when keyframed or not numbers). */
export function slotVector(slot: Pick<SlotInfo, 'value'>): number[] | null {
  const v = slot.value
  if (!v || isKeyframed(v)) return null
  return isNumberArray(v.k, 2) ? [...v.k] : null
}

/* -------------------------------------------------------------------------- */
/*                                  Slot ids                                  */
/* -------------------------------------------------------------------------- */

export const SLOT_ID_MAX_LENGTH = 64

/**
 * Slot ids are what developers pass to `setSlots()`/theme rules, so they are kept printable:
 * no control characters, no leading or trailing spaces, at most 64 characters.
 */
export function isValidSlotId(id: string): boolean {
  if (id.length === 0 || id.length > SLOT_ID_MAX_LENGTH || id !== id.trim()) return false
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) return false
  }
  return true
}

/** `base`, or `base_2`, `base_3`… — the first id the document does not use. */
export function uniqueSlotId(anim: Animation, base: string): string {
  const used = slotIds(snapshot(anim))
  const stem = base.trim().slice(0, SLOT_ID_MAX_LENGTH - 4) || 'color'
  if (!used.has(stem)) return stem
  for (let n = 2; ; n++) {
    const candidate = `${stem}_${n}`
    if (!used.has(candidate)) return candidate
  }
}

/** Next free `color_<n>` id (1-based, never reusing a number the document has). */
export function nextColorSlotId(anim: Animation): string {
  const used = slotIds(snapshot(anim))
  for (let n = 1; ; n++) {
    const id = `color_${n}`
    if (!used.has(id)) return id
  }
}

/* -------------------------------------------------------------------------- */
/*                                   Binding                                  */
/* -------------------------------------------------------------------------- */

/** Why a color usage cannot become part of a color slot. */
export type BindSkipReason = 'animated' | 'gradient' | 'solid' | 'text' | 'other'

export interface BindPlan {
  /** Paths of the color properties that can be bound (unique). */
  paths: NodePath[]
  /** Usages that cannot be bound, by reason. */
  skipped: Partial<Record<BindSkipReason, number>>
  /** Slot ids the bindable properties already use (every one of them when `allBound`). */
  boundTo: string[]
  /** Every bindable property already uses the same slot. */
  allBound: boolean
}

/**
 * Which of `usages` can be bound to one color slot. Only static color properties qualify: a
 * slot replaces the whole property, so a keyframe value or a gradient stop cannot be themed on
 * its own, solid layer colors are not properties, and text documents are text slots.
 */
export function planColorBinding(anim: Animation, usages: readonly ColorUsage[]): BindPlan {
  const doc = snapshot(anim)
  const skipped: BindPlan['skipped'] = {}
  const skip = (reason: BindSkipReason) => (skipped[reason] = (skipped[reason] ?? 0) + 1)
  const seen = new Set<string>()
  const paths: NodePath[] = []
  const bound = new Set<string>()
  let unbound = 0
  for (const u of usages) {
    if (u.kind === 'solid') {
      skip('solid')
      continue
    }
    if (u.stopIndex !== undefined) {
      skip('gradient')
      continue
    }
    // Text document colors live inside the document (`t.d`): only a whole text slot fits.
    if (u.path[u.path.length - 1] === 'd' && u.path[u.path.length - 2] === 't') {
      skip('text')
      continue
    }
    const prop = getAt<unknown>(doc, u.path)
    if (!isPropertyObject(prop)) {
      skip('other')
      continue
    }
    // A property already bound to a slot shows the slot's value (lottie-web, colors.ts): its
    // own `k` may be keyframed while the slot is static, and the other way round.
    const sid = typeof prop.sid === 'string' ? prop.sid : null
    const entry = sid ? doc.slots?.[sid] : undefined
    const slotValue = isObj(entry) ? entry.p : null
    const effective = isPropertyObject(slotValue) ? slotValue : prop
    if (u.keyframeIndex !== undefined || isKeyframed(effective) || !isColorArray(effective.k)) {
      skip(u.keyframeIndex !== undefined || isKeyframed(effective) ? 'animated' : 'other')
      continue
    }
    const key = pathKey(u.path)
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(u.path)
    if (sid) bound.add(sid)
    else unbound++
  }
  return {
    paths,
    skipped,
    boundTo: [...bound],
    allBound: paths.length > 0 && unbound === 0 && bound.size === 1,
  }
}

/** Color array as the slot stores it: 0..1, same number of components as the property. */
function slotColorArray(arr: readonly number[], legacy: boolean): number[] {
  if (!legacy) return [...arr]
  const out = arr.slice(0, 3).map((v) => v / 255)
  if (arr.length > 3) out.push(arr[3] > 1 ? arr[3] / 255 : arr[3])
  return out
}

/** True when a property keeps colors in 0..255 (fill/stroke of files older than 4.1.9). */
function usesLegacyScale(anim: Animation, path: NodePath): boolean {
  if (!usesLegacyColorScale(anim)) return false
  const parent = getAt<unknown>(anim, path.slice(0, -1))
  return (
    isObj(parent) && (parent.ty === 'fl' || parent.ty === 'st') && path[path.length - 1] === 'c'
  )
}

export interface BindResult {
  id: string
  /** Number of properties bound. */
  bound: number
}

/**
 * Binds the static color properties among `usages` to a new color slot `id` (see
 * `planColorBinding`): each gets `sid: id` and `slots[id]` takes the color they show, so nothing
 * changes on screen; `color` (0..1) gives all of them another color instead. Mutates `draft`;
 * returns null when nothing can be bound or `id` is invalid or taken.
 */
export function bindColorSlot(
  draft: Animation,
  usages: readonly ColorUsage[],
  id: string,
  color?: RGBA,
): BindResult | null {
  if (!isValidSlotId(id)) return null
  const doc = snapshot(draft)
  if (slotIds(doc).has(id)) return null
  const plan = planColorBinding(doc, usages)
  if (plan.paths.length === 0) return null

  // The value is the color the first property shows now: the slot it was bound to, or its own
  // (0..255 in very old files; slots are always 0..1).
  const first = plan.paths[0]
  const firstProp = getAt<Obj>(doc, first)!
  const firstSid = typeof firstProp.sid === 'string' ? firstProp.sid : null
  const firstSlot = firstSid ? getAt<unknown>(doc, ['slots', firstSid, 'p']) : undefined
  let value = isPropertyObject(firstSlot)
    ? [...(firstSlot.k as number[])]
    : slotColorArray(firstProp.k as number[], usesLegacyScale(doc, first))
  if (color) value = encodeColor(color, value.length >= 4 ? 4 : 3, value[3])
  const shown = color ?? arrayToColor(value)

  for (const path of plan.paths) {
    const prop = getAt<Obj>(draft, path)
    if (!prop) continue
    prop.sid = id
    // Inline copies follow the slot, so players without slot support draw the same color.
    writeInlineColor(draft, path, shown, doc)
  }
  const slots = (draft.slots ??= {}) as Record<string, { p: unknown }>
  slots[id] = { p: { a: 0, k: value } }
  return { id, bound: plan.paths.length }
}

/** 0..1 color as stored numbers: 8-bit exact for players that floor and players that round. */
function encodeColor(color: RGBA, length: number, alpha?: number): number[] {
  const out = [to8(color.r), to8(color.g), to8(color.b)].map((c) => encodeChannel(c))
  if (length >= 4) out.push(isNum(alpha) ? alpha : 1)
  return out
}

/** Number of components and alpha of a color value (3 components or 4 with alpha 1 otherwise). */
function colorShape(value: unknown): { length: 3 | 4; alpha: number } {
  if (!isColorArray(value)) return { length: 4, alpha: 1 }
  return value.length >= 4 && isNum(value[3])
    ? { length: 4, alpha: value[3] }
    : { length: value.length >= 4 ? 4 : 3, alpha: 1 }
}

/**
 * Writes a static color into a color property unless it already shows that 8-bit color
 * (exact stored numbers are kept then). Keeps its number of components, its alpha and its
 * scale. Returns true when it changed.
 */
function writeInlineColor(draft: Animation, path: NodePath, color: RGBA, doc: Animation): boolean {
  const prop = getAt<Obj>(draft, path)
  if (!prop) return false
  // `doc` is a plain view taken once by the caller: a snapshot per property would make binding
  // hundreds of properties quadratic.
  const legacy = usesLegacyScale(doc, path)
  const scale = legacy ? 255 : 1
  const rgb8 = [to8(color.r), to8(color.g), to8(color.b)]
  const k = prop.k
  if (!isKeyframed(prop) && isColorArray(k) && rgb8.every((c, i) => to8(k[i] / scale) === c))
    return false
  const shape = colorShape(firstValue(prop))
  const next = rgb8.map((c) => encodeChannel(c, scale))
  if (shape.length === 4) next.push(shape.alpha)
  prop.a = 0
  prop.k = next
  return true
}

/* -------------------------------------------------------------------------- */
/*                               Editing values                               */
/* -------------------------------------------------------------------------- */

/**
 * Gives a color slot a static color: `slots[id].p` and every inline copy (so each player shows
 * it). Keyframed values become static. Mutates `draft`; returns false when nothing changed.
 */
export function setSlotColor(draft: Animation, id: string, color: RGBA): boolean {
  const doc = snapshot(draft)
  const slot = findSlot(doc, id)
  if (!slot) return false
  let changed = false
  const stored = slot.defined ? slot.value : null
  const shape = colorShape(firstValue(stored))
  const value = encodeColor(color, stored ? shape.length : 3, shape.alpha)
  if (
    !stored ||
    isKeyframed(stored) ||
    !isColorArray(stored.k) ||
    stored.k.length !== value.length ||
    !value.every((v, i) => (stored.k as number[])[i] === v)
  ) {
    writeSlotValue(draft, id, { a: 0, k: value })
    changed = true
  }
  for (const ref of slot.refs) {
    if (COLOR_ROLES.has(ref.role) && writeInlineColor(draft, ref.path, color, doc)) changed = true
  }
  return changed
}

/**
 * Gives a scalar, vector or position slot a static value (slot and inline copies). Mutates
 * `draft`; returns false when nothing changed.
 */
export function setSlotStaticValue(
  draft: Animation,
  id: string,
  value: number | number[],
): boolean {
  const doc = snapshot(draft)
  const slot = findSlot(doc, id)
  if (!slot) return false
  const next = typeof value === 'number' ? value : [...value]
  const nextJson = JSON.stringify(next)
  let changed = false
  const stored = slot.defined ? slot.value : null
  if (!stored || isKeyframed(stored) || JSON.stringify(stored.k) !== nextJson) {
    writeSlotValue(draft, id, { a: 0, k: clone(next) })
    changed = true
  }
  for (const ref of slot.refs) {
    const prop = getAt<Obj>(draft, ref.path)
    if (!prop || !isPropertyObject(getAt(doc, ref.path))) continue
    if (!isKeyframed(prop) && JSON.stringify(prop.k) === nextJson) continue
    prop.a = 0
    prop.k = clone(next)
    changed = true
  }
  return changed
}

/** Replaces `a`/`k` of `slots[id].p` (other fields such as an expression are kept). */
function writeSlotValue(draft: Animation, id: string, value: { a: 0 | 1; k: unknown }): void {
  const slots = (draft.slots ??= {}) as Record<string, { p: unknown }>
  const entry = slots[id]
  if (isObj(entry) && isObj(entry.p)) {
    const p = entry.p
    p.a = value.a
    p.k = value.k
  } else {
    slots[id] = { p: { a: value.a, k: value.k } }
  }
}

/* -------------------------------------------------------------------------- */
/*                              Rename and remove                             */
/* -------------------------------------------------------------------------- */

/**
 * Renames a slot: the dictionary key (its position kept) and every `sid`. Mutates `draft`;
 * returns false when `to` is invalid or already used.
 */
export function renameSlot(draft: Animation, from: string, to: string): boolean {
  if (from === to || !isValidSlotId(to)) return false
  const doc = snapshot(draft)
  const slot = findSlot(doc, from)
  if (!slot || slotIds(doc).has(to)) return false
  if (isObj(draft.slots) && from in draft.slots) {
    const next: Record<string, { p: unknown }> = {}
    for (const key of Object.keys(draft.slots)) {
      next[key === from ? to : key] = draft.slots[key]
    }
    draft.slots = next
  }
  for (const ref of slot.refs) setAt(draft, [...ref.path, 'sid'], to)
  return true
}

/**
 * Removes a slot: every bound object gets the slot's value as its own and loses its `sid`, and
 * the dictionary entry is deleted — the animation looks the same everywhere afterwards. Mutates
 * `draft`; returns the number of objects that were unbound (−1 when the slot does not exist).
 */
export function removeSlot(draft: Animation, id: string): number {
  const doc = snapshot(draft)
  const slot = findSlot(doc, id)
  if (!slot) return -1
  const p = slot.defined ? slot.value : null
  for (const ref of slot.refs) {
    const target = getAt<Obj>(draft, ref.path)
    if (!target) continue
    if (p) bakeValue(draft, ref, p, doc)
    delete target.sid
  }
  if (isObj(draft.slots) && id in draft.slots) {
    delete draft.slots[id]
    if (Object.keys(draft.slots).length === 0) delete draft.slots
  }
  return slot.refs.length
}

/** Writes a slot value into a bound object the way players apply it (`Object.assign`). */
function bakeValue(draft: Animation, ref: SlotRef, p: Obj, doc: Animation): void {
  const target = getAt<Obj>(draft, ref.path)
  if (!target) return
  const value = clone(p)
  if (ref.role === 'fill-color' || ref.role === 'stroke-color') {
    // Very old files keep fill/stroke colors in 0..255 (slots are always 0..1).
    if (usesLegacyScale(doc, ref.path)) scaleColors(value, 255)
  }
  for (const [key, v] of Object.entries(value)) {
    if (key === 'sid') continue
    if (JSON.stringify(target[key]) !== JSON.stringify(v)) target[key] = v
  }
}

/** Multiplies the RGB components of a color property's values (static or keyframed). */
function scaleColors(prop: Obj, factor: number): void {
  const scale = (arr: unknown) => {
    if (!isColorArray(arr)) return
    for (let i = 0; i < 3; i++) arr[i] = arr[i] * factor
  }
  if (isKeyframed(prop)) {
    for (const kf of prop.k as unknown[]) {
      if (!isObj(kf)) continue
      scale(kf.s)
      scale(kf.e)
    }
  } else scale(prop.k)
}

/* -------------------------------------------------------------------------- */
/*                          Keeping copies in step                            */
/* -------------------------------------------------------------------------- */

/** Keys a bound object shares with its slot value (what `Object.assign(obj, slots[sid].p)` sets). */
function sharedKeys(role: SlotRole, node: Obj): string[] {
  if (role === 'image') return ['p', 'u', 'e', 'w', 'h']
  if (role === 'text') return ['k']
  // A gradient bound on `g` (ThorVG's convention) carries the stop count too.
  if (role === 'gradient' && isNum(node.p) && isObj(node.k)) return ['p', 'k']
  return ['a', 'k']
}

/** Color values reduced to what renders (RGB, 0..1) so 3/4 components or 0..255 compare equal. */
function renderedColors(value: unknown, scale: number): unknown {
  const rgb = (v: unknown) => (isColorArray(v) ? v.slice(0, 3).map((c) => to8(c / scale)) : v)
  if (!isObj(value)) return value
  const k = value.k
  if (Array.isArray(k) && k.length > 0 && isKeyframe(k[0])) {
    return (k as unknown[]).map((kf) =>
      isObj(kf) ? { ...kf, s: rgb(kf.s), e: kf.e === undefined ? undefined : rgb(kf.e) } : kf,
    )
  }
  return rgb(k)
}

function pick(node: Obj, keys: readonly string[]): Obj {
  const out: Obj = {}
  for (const key of keys) if (node[key] !== undefined) out[key] = node[key]
  return out
}

/**
 * Which slots an edit touched, from its immer patches: `'slot'` when a dictionary value
 * changed, else the path of the bound object that changed. Null when a patch replaced the whole
 * document (a JSON edit): nothing can be told then.
 */
export function touchedSlots(
  doc: Animation,
  patches: readonly { path: readonly PathSegment[] }[],
): Map<string, 'slot' | NodePath> | null {
  const touched = new Map<string, 'slot' | NodePath>()
  for (const patch of patches) {
    const path = patch.path
    if (path.length === 0) return null
    if (path[0] === 'slots') {
      if (typeof path[1] === 'string') touched.set(path[1], 'slot')
      else return null
      continue
    }
    // The innermost object with a `sid` on the patch's path (a property, a gradient, a text
    // document or an image asset) is the copy that changed.
    for (let n = path.length; n >= 1; n--) {
      const prefix = path.slice(0, n)
      const node = getAt<unknown>(doc, prefix)
      if (isObj(node) && typeof node.sid === 'string' && node.sid) {
        if (!touched.has(node.sid)) touched.set(node.sid, prefix)
        break
      }
      if (n <= 2 || isLayerPath(prefix)) break
    }
  }
  return touched
}

/**
 * Makes every copy of a slot agree again after one of them was edited: `from` is `'slot'` (the
 * dictionary value is the truth) or the path of the edited bound object. Editors that write a
 * property's own value would otherwise leave lottie-web (which draws `slots[sid].p`) showing
 * the old one. Mutates `draft`; returns true when something changed.
 */
export function syncSlotCopies(draft: Animation, id: string, from: 'slot' | NodePath): boolean {
  const doc = snapshot(draft)
  const slot = findSlot(doc, id)
  if (!slot) return false
  const colors = slot.kind === 'color'
  const scaleOf = (path: NodePath) => (colors && usesLegacyScale(doc, path) ? 255 : 1)
  const source =
    from === 'slot'
      ? slot.defined
        ? { node: slot.value!, role: slot.refs[0]?.role ?? 'other', scale: 1 }
        : null
      : (() => {
          const node = getAt<unknown>(doc, from)
          const ref = slot.refs.find((r) => pathKey(r.path) === pathKey(from))
          return isObj(node) && ref ? { node, role: ref.role, scale: scaleOf(from) } : null
        })()
  if (!source) return false
  const keys = sharedKeys(source.role, source.node)
  const truth = pick(source.node, keys)
  const same = (value: Obj, scale: number) =>
    JSON.stringify(colors ? renderedColors(value, scale) : value) ===
    JSON.stringify(colors ? renderedColors(truth, source.scale) : truth)
  const convert = (scale: number): Obj => {
    const value = clone(truth)
    if (colors && scale !== source.scale) scaleColors(value, scale / source.scale)
    return value
  }
  let changed = false
  // The dictionary value (only when the slot has one: sid-only slots keep their copies).
  if (from !== 'slot' && slot.defined && slot.value && !same(pick(slot.value, keys), 1)) {
    const entry = getAt<Obj>(draft, ['slots', id])
    if (entry) {
      entry.p = { ...(isObj(entry.p) ? entry.p : {}), ...convert(1) }
      changed = true
    }
  }
  for (const ref of slot.refs) {
    if (from !== 'slot' && pathKey(ref.path) === pathKey(from)) continue
    const node = getAt<Obj>(doc, ref.path)
    if (!node || sharedKeys(ref.role, node).join() !== keys.join()) continue
    const scale = scaleOf(ref.path)
    if (same(pick(node, keys), scale)) continue
    const target = getAt<Obj>(draft, ref.path)
    if (!target) continue
    Object.assign(target, convert(scale))
    changed = true
  }
  return changed
}

/* -------------------------------------------------------------------------- */
/*                                Theme rules                                 */
/* -------------------------------------------------------------------------- */

/** Rule type used for slots of a kind (null for kinds themes cannot hold, e.g. paths). */
export function ruleTypeOf(kind: SlotKind): ThemeRuleType | null {
  switch (kind) {
    case 'color':
      return 'Color'
    case 'scalar':
      return 'Scalar'
    case 'vector':
      return 'Vector'
    case 'position':
      return 'Position'
    case 'gradient':
      return 'Gradient'
    case 'image':
      return 'Image'
    case 'text':
      return 'Text'
    default:
      return null
  }
}

/**
 * Rules of a theme file (`{ rules: [...] }`); entries without a string `id` and `type` are left
 * out (they are kept in the file itself, see `upsertThemeRule`).
 */
export function readThemeRules(data: unknown): ThemeRule[] {
  if (!isObj(data) || !Array.isArray(data.rules)) return []
  return data.rules.filter(
    (r): r is ThemeRule => isObj(r) && typeof r.id === 'string' && typeof r.type === 'string',
  )
}

/** True when a rule applies to the animation (`animations` absent, or listing it). */
export function ruleAppliesTo(rule: ThemeRule, animationId: string | null): boolean {
  if (!Array.isArray(rule.animations)) return true
  return animationId !== null && rule.animations.includes(animationId)
}

/** The rule a player would use for a slot: the last applicable one wins (dotlottie-rs). */
export function findThemeRule(
  rules: readonly ThemeRule[],
  slotId: string,
  animationId: string | null,
): ThemeRule | undefined {
  let found: ThemeRule | undefined
  for (const r of rules) if (r.id === slotId && ruleAppliesTo(r, animationId)) found = r
  return found
}

/** Static color of a Color rule (null when keyframed, driven by an expression or invalid). */
export function ruleColor(rule: ThemeRule): RGBA | null {
  if (rule.type !== 'Color' || Array.isArray(rule.keyframes) || typeof rule.expression === 'string')
    return null
  return isColorArray(rule.value) ? arrayToColor(rule.value) : null
}

/** Colors of a keyframed Color rule. */
export function ruleKeyframeColors(rule: ThemeRule): RGBA[] {
  if (rule.type !== 'Color' || !Array.isArray(rule.keyframes)) return []
  return rule.keyframes
    .filter((k) => isObj(k) && isColorArray(k.value))
    .map((k) => arrayToColor(k.value as number[]))
}

/** Static number of a Scalar rule. */
export function ruleScalar(rule: ThemeRule): number | null {
  if (
    rule.type !== 'Scalar' ||
    Array.isArray(rule.keyframes) ||
    typeof rule.expression === 'string'
  )
    return null
  if (isNum(rule.value)) return rule.value
  return isNumberArray(rule.value) && rule.value.length === 1 ? rule.value[0] : null
}

/** Static vector of a Vector or Position rule. */
export function ruleVector(rule: ThemeRule): number[] | null {
  if (
    (rule.type !== 'Vector' && rule.type !== 'Position') ||
    Array.isArray(rule.keyframes) ||
    typeof rule.expression === 'string'
  )
    return null
  return isNumberArray(rule.value, 2) ? [...rule.value] : null
}

/** True when the rule changes over time (keyframes or an expression). */
export function isDynamicRule(rule: ThemeRule): boolean {
  return Array.isArray(rule.keyframes) || typeof rule.expression === 'string'
}

/** A Color rule with a static value: `[r, g, b]` exact to 8 bits (dotLottie colors are RGB). */
export function colorRule(slotId: string, color: RGBA): ThemeRule {
  return { id: slotId, type: 'Color', value: encodeColor(color, 3) }
}

export function scalarRule(slotId: string, value: number): ThemeRule {
  return { id: slotId, type: 'Scalar', value }
}

export function vectorRule(
  slotId: string,
  value: number[],
  type: 'Vector' | 'Position',
): ThemeRule {
  return { id: slotId, type, value: value.slice(0, type === 'Vector' ? 2 : 3) }
}

/** Theme keyframes of a keyframed Lottie property: the inverse of `ruleProperty`. */
function themeKeyframes(
  kfs: readonly unknown[],
  map: (s: unknown) => unknown | null,
  spatial: boolean,
): ThemeKeyframe[] | null {
  const out: ThemeKeyframe[] = []
  let previousEnd: unknown = undefined
  for (const raw of kfs) {
    if (!isObj(raw) || !isNum(raw.t)) return null
    // Legacy files keep a segment's end value in `e` instead of the next keyframe's `s`.
    const value = map(raw.s ?? previousEnd)
    previousEnd = raw.e
    if (value === null) return null
    const kf: ThemeKeyframe = { frame: raw.t, value }
    const i = tangent(raw.i)
    const o = tangent(raw.o)
    if (i) kf.inTangent = i
    if (o) kf.outTangent = o
    if (raw.h === 1) kf.hold = true
    if (spatial && isNumberArray(raw.ti)) kf.valueInTangent = [...raw.ti]
    if (spatial && isNumberArray(raw.to)) kf.valueOutTangent = [...raw.to]
    out.push(kf)
  }
  return out.length ? out : null
}

/**
 * The rule that keeps a slot at its default value. Players apply a theme over the values shown
 * before (dotlottie-rs sets the theme's slots, it does not reset the others first), so a theme
 * needs a rule for every slot to look the same whichever theme was shown before. Null for kinds
 * this module does not convert back (gradients, images, text, paths).
 */
export function defaultRule(slot: SlotInfo): ThemeRule | null {
  const v = slot.value
  if (!v) return null
  let type: ThemeRuleType
  let map: (s: unknown) => unknown | null
  switch (slot.kind) {
    case 'color':
      type = 'Color'
      map = mapColor
      break
    case 'scalar':
      type = 'Scalar'
      map = mapScalar
      break
    case 'vector':
      type = 'Vector'
      map = mapVector2
      break
    case 'position':
      type = 'Position'
      map = mapVector2
      break
    default:
      return null
  }
  if (isKeyframed(v)) {
    const keyframes = themeKeyframes(v.k as unknown[], map, type === 'Position')
    return keyframes ? { id: slot.id, type, keyframes } : null
  }
  const value = map(v.k)
  return value === null ? null : { id: slot.id, type, value }
}

/**
 * Theme data with `rule` in place of the rule the animation uses for its slot (or appended).
 * Other rules, unknown fields and the rule's own extra fields (e.g. its `animations` filter)
 * are kept. Returns a new object; `data` is not changed.
 */
export function upsertThemeRule(data: unknown, rule: ThemeRule, animationId: string | null): Obj {
  const base: Obj = isObj(data) ? { ...data } : {}
  const rules: unknown[] = Array.isArray(base.rules) ? [...base.rules] : []
  let index = -1
  rules.forEach((r, i) => {
    if (
      isObj(r) &&
      r.id === rule.id &&
      typeof r.type === 'string' &&
      ruleAppliesTo(r as ThemeRule, animationId)
    )
      index = i
  })
  if (index >= 0) {
    const old = rules[index] as ThemeRule
    // The new value replaces keyframes and expressions (a rule has one of them).
    const merged: ThemeRule = { ...old, ...rule }
    if (!('keyframes' in rule)) delete merged.keyframes
    if (!('expression' in rule)) delete merged.expression
    if (!('value' in rule)) delete merged.value
    if (Array.isArray(old.animations)) merged.animations = old.animations
    rules[index] = merged
  } else {
    rules.push({ ...rule })
  }
  base.rules = rules
  return base
}

/**
 * Theme data without the rules the animation uses for `slotId`. Returns `data` itself when there
 * was nothing to remove.
 */
export function removeThemeRule(
  data: unknown,
  slotId: string,
  animationId: string | null,
): unknown {
  if (!isObj(data) || !Array.isArray(data.rules)) return data
  const rules = data.rules.filter(
    (r) => !(isObj(r) && r.id === slotId && ruleAppliesTo(r as ThemeRule, animationId)),
  )
  return rules.length === data.rules.length ? data : { ...data, rules }
}

/**
 * Theme data with rules for `from` renamed to `to`. With `keepOriginal` (other animations of the
 * package still use `from`), the renamed copies are added and the originals stay.
 */
export function renameThemeRules(
  data: unknown,
  from: string,
  to: string,
  animationId: string | null,
  keepOriginal = false,
): unknown {
  if (!isObj(data) || !Array.isArray(data.rules)) return data
  let changed = false
  const rules: unknown[] = []
  for (const r of data.rules) {
    if (isObj(r) && r.id === from && ruleAppliesTo(r as ThemeRule, animationId)) {
      changed = true
      if (keepOriginal) rules.push(r)
      rules.push({ ...r, id: to })
    } else rules.push(r)
  }
  return changed ? { ...data, rules } : data
}

/* -------------------------------------------------------------------------- */
/*                            Theme → slot values                             */
/* -------------------------------------------------------------------------- */

const LINEAR_OUT = { x: 0, y: 0 }
const LINEAR_IN = { x: 1, y: 1 }

const isHandleComponent = (c: unknown): c is number | number[] => isNum(c) || isNumberArray(c)

function tangent(v: unknown): { x: number | number[]; y: number | number[] } | null {
  if (!isObj(v)) return null
  return isHandleComponent(v.x) && isHandleComponent(v.y) ? { x: v.x, y: v.y } : null
}

/** lottie-web needs all four handle components as arrays when any is one (else NaN). */
function consistentHandles(
  o: { x: number | number[]; y: number | number[] },
  i: { x: number | number[]; y: number | number[] },
): { o: typeof o; i: typeof i } {
  const parts = [o.x, o.y, i.x, i.y]
  if (!parts.some(Array.isArray)) return { o, i }
  const length = Math.max(...parts.map((p) => (Array.isArray(p) ? p.length : 1)))
  const arr = (p: number | number[]) => {
    const src = Array.isArray(p) ? p : [p]
    return Array.from({ length }, (_, d) => src[d] ?? src[0] ?? 0)
  }
  return { o: { x: arr(o.x), y: arr(o.y) }, i: { x: arr(i.x), y: arr(i.y) } }
}

type ValueMap = (value: unknown) => unknown | null

/**
 * Converts a rule's value or keyframes into a Lottie property (`{ a, k }`), with `map` turning a
 * theme value into a Lottie value (`s` is always an array, as lottie-web expects).
 */
function ruleProperty(
  rule: ThemeRule,
  map: ValueMap,
  fallback: unknown,
  spatial: boolean,
  expressions: boolean,
): Obj {
  const out: Obj = {}
  const kfs = Array.isArray(rule.keyframes) ? rule.keyframes.filter(isObj) : null
  if (kfs && kfs.length > 0) {
    const list: Obj[] = []
    for (const kf of kfs) {
      const s = map(kf.value)
      if (s === null || !isNum(kf.frame)) continue
      const item: Obj = { t: kf.frame, s: Array.isArray(s) ? s : [s] }
      // dotlottie-rs writes the keyframe's own tangents as its `i`/`o`; ThorVG eases a segment
      // only when its first keyframe has `i` (linear otherwise).
      const i = tangent(kf.inTangent)
      const o = tangent(kf.outTangent)
      if (i) {
        const h = consistentHandles(o ?? LINEAR_OUT, i)
        item.o = h.o
        item.i = h.i
      } else {
        item.o = { ...LINEAR_OUT }
        item.i = { ...LINEAR_IN }
      }
      if (kf.hold === true) item.h = 1
      if (spatial) {
        if (isNumberArray(kf.valueInTangent)) item.ti = kf.valueInTangent.slice(0, 2)
        if (isNumberArray(kf.valueOutTangent)) item.to = kf.valueOutTangent.slice(0, 2)
      }
      list.push(item)
    }
    if (list.length >= 2) {
      out.a = 1
      out.k = list
    } else {
      // A lone keyframe is a static value (lottie-web fails on single-keyframe properties).
      const s = list[0]?.s as unknown[] | undefined
      out.a = 0
      out.k = s ? (s.length === 1 ? s[0] : s) : fallback
    }
  } else {
    const v = rule.value !== undefined ? map(rule.value) : null
    out.a = 0
    out.k = v ?? fallback
  }
  if (expressions && typeof rule.expression === 'string') out.x = rule.expression
  return out
}

const mapColor: ValueMap = (v) => (isColorArray(v) ? [v[0], v[1], v[2]] : null)
const mapScalar: ValueMap = (v) => (isNum(v) ? v : isNumberArray(v) && v.length === 1 ? v[0] : null)
const mapVector2: ValueMap = (v) => (isNumberArray(v, 2) ? [v[0], v[1]] : null)

interface GradientStopValue {
  offset: number
  color: number[]
}

function gradientStops(v: unknown): GradientStopValue[] | null {
  if (!Array.isArray(v)) return null
  const stops: GradientStopValue[] = []
  for (const s of v) {
    if (!isObj(s) || !isNum(s.offset) || !isColorArray(s.color)) return null
    stops.push({ offset: s.offset, color: s.color as number[] })
  }
  return stops
}

/** dotLottie gradient stops → Lottie gradient data (colors, then the opacity block). */
export function gradientStopsToLottie(stops: readonly GradientStopValue[]): number[] {
  const colors: number[] = []
  const alphas: number[] = []
  for (const s of stops) {
    colors.push(s.offset, s.color[0], s.color[1], s.color[2])
    alphas.push(s.offset, isNum(s.color[3]) ? s.color[3] : 1)
  }
  // dotlottie-rs reads four components per stop and always writes the opacity block.
  return [...colors, ...alphas]
}

const TEXT_FIELDS: Record<string, string> = {
  text: 't',
  fontName: 'f',
  fontSize: 's',
  fillColor: 'fc',
  strokeColor: 'sc',
  strokeWidth: 'sw',
  strokeOverFill: 'of',
  lineHeight: 'lh',
  tracking: 'tr',
  baselineShift: 'ls',
  wrapSize: 'sz',
  wrapPosition: 'ps',
}
const JUSTIFY = [
  'Left',
  'Right',
  'Center',
  'JustifyLastLeft',
  'JustifyLastRight',
  'JustifyLastCenter',
  'JustifyLastFull',
]
const CAPS = ['Regular', 'AllCaps', 'SmallCaps']

/** dotLottie text document → Lottie text document fields (only the fields it sets). */
export function textValueToDocument(v: unknown): Obj | null {
  if (!isObj(v)) return null
  const out: Obj = {}
  for (const [from, to] of Object.entries(TEXT_FIELDS)) if (v[from] !== undefined) out[to] = v[from]
  if (typeof v.justify === 'string' && JUSTIFY.includes(v.justify))
    out.j = JUSTIFY.indexOf(v.justify)
  if (typeof v.textCaps === 'string' && CAPS.includes(v.textCaps)) out.ca = CAPS.indexOf(v.textCaps)
  return out
}

export interface ThemeToSlotsOptions {
  /** Include rule expressions (`x`). lottie-web runs them only when expressions are enabled. */
  expressions?: boolean
  /** Resolves an Image rule's bare file name (a file of the package, `i/<name>`) to a URL. */
  resolveImage?: (src: string) => string | undefined
  /** The document's slots, to shape text and gradient values like the originals. */
  slots?: readonly SlotInfo[]
}

/**
 * The slot values a player sets when it applies `rules` to the animation `animationId`
 * (`{ [sid]: { p } }`, ready to merge into the root `slots`). Rules of unknown types or with
 * unusable values are skipped, like dotlottie-rs skips them.
 */
export function themeToSlots(
  rules: readonly ThemeRule[],
  animationId: string | null,
  opts: ThemeToSlotsOptions = {},
): Record<string, { p: unknown }> {
  const out: Record<string, { p: unknown }> = {}
  const expressions = opts.expressions ?? true
  const infoOf = (id: string) => opts.slots?.find((s) => s.id === id)
  for (const rule of rules) {
    if (!ruleAppliesTo(rule, animationId)) continue
    const info = infoOf(rule.id)
    // A rule of the wrong type would write, say, a color into an opacity: players reject it.
    if (info && !ruleFitsKind(rule.type, info.kind)) continue
    const p = buildSlot(rule, expressions, opts, info)
    if (p) out[rule.id] = { p }
  }
  return out
}

/** True when a rule of `type` can drive a slot of `kind` (unknown kinds accept anything). */
export function ruleFitsKind(type: string, kind: SlotKind): boolean {
  if (kind === 'unknown') return true
  switch (type) {
    case 'Color':
      return kind === 'color'
    case 'Scalar':
      return kind === 'scalar'
    // The Lottie spec lets vector slots drive positions of the same dimension, and back.
    case 'Vector':
    case 'Position':
      return kind === 'vector' || kind === 'position'
    case 'Gradient':
      return kind === 'gradient'
    case 'Image':
      return kind === 'image'
    case 'Text':
      return kind === 'text'
    default:
      return false
  }
}

function buildSlot(
  rule: ThemeRule,
  expressions: boolean,
  opts: ThemeToSlotsOptions,
  info: SlotInfo | undefined,
): Obj | null {
  switch (rule.type) {
    case 'Color':
      return ruleProperty(rule, mapColor, [0, 0, 0], false, expressions)
    case 'Scalar':
      return ruleProperty(rule, mapScalar, 0, false, expressions)
    case 'Vector':
      return ruleProperty(rule, mapVector2, [0, 0], false, expressions)
    case 'Position':
      return ruleProperty(rule, mapVector2, [0, 0], true, expressions)
    case 'Gradient': {
      const first = gradientStops(
        Array.isArray(rule.keyframes) && rule.keyframes.length
          ? rule.keyframes[0]?.value
          : rule.value,
      )
      const count = first?.length ?? 0
      const k = ruleProperty(
        rule,
        (v) => {
          const stops = gradientStops(v)
          return stops ? gradientStopsToLottie(stops) : null
        },
        [],
        false,
        expressions,
      )
      return { p: count, k }
    }
    case 'Image': {
      if (!isObj(rule.value) || typeof rule.value.src !== 'string') return null
      const src = rule.value.src
      let p: string | undefined
      if (src.startsWith('data:') || /^https?:\/\//i.test(src)) p = src
      else p = opts.resolveImage?.(src)
      if (!p) return null
      const image: Obj = { u: '', p, e: p.startsWith('data:') ? 1 : 0 }
      if (
        isNum(rule.value.width) &&
        isNum(rule.value.height) &&
        rule.value.width > 0 &&
        rule.value.height > 0
      ) {
        image.w = rule.value.width
        image.h = rule.value.height
      }
      return image
    }
    case 'Text': {
      // Merged over the document's own text so fonts and sizes the rule leaves out survive
      // (lottie-web cannot draw a text document without a font).
      const base =
        info?.value && isKeyframed(info.value)
          ? ((info.value.k as Obj[])[0]?.s as Obj | undefined)
          : undefined
      const frames: { frame: number; value: unknown }[] = Array.isArray(rule.keyframes)
        ? rule.keyframes.filter((k) => isObj(k) && isNum(k.frame))
        : rule.value !== undefined
          ? [{ frame: 0, value: rule.value }]
          : []
      const k: Obj[] = []
      for (const f of frames) {
        const doc = textValueToDocument(f.value)
        if (doc) k.push({ t: f.frame, s: { ...(base ? clone(base) : {}), ...doc } })
      }
      if (!k.length) return null
      const p: Obj = { k }
      if (expressions && typeof rule.expression === 'string') p.x = rule.expression
      return p
    }
    default:
      return null
  }
}

/* -------------------------------------------------------------------------- */
/*                             Applying a theme                               */
/* -------------------------------------------------------------------------- */

interface ThemedEntry {
  key: string
  result: Animation
}

const themedCache = new WeakMap<object, ThemedEntry>()

/** Copy-on-write of the objects along `path` in `root` (a shallow copy of the root). */
function writablePath(root: Obj, path: NodePath): Obj | null {
  let node: Obj | unknown[] = root
  for (const seg of path) {
    const child: unknown = (node as Record<string | number, unknown>)[seg]
    if (child === null || typeof child !== 'object') return null
    const copy = Array.isArray(child) ? [...child] : { ...(child as Obj) }
    ;(node as Record<string | number, unknown>)[seg] = copy
    node = copy
  }
  return isObj(node) ? node : null
}

/**
 * The animation as a player shows it with the theme applied: the theme's slot values merged
 * into the root `slots`. Gradient slots bound to the gradient object itself (`g`, the ThorVG
 * convention that lottie-web does not follow) are written into those gradients directly.
 * Unchanged subtrees are shared with `doc`, and the result is cached per document and rules,
 * so an unchanged preview keeps its identity. Returns `doc` when `rules` is null or changes
 * nothing.
 */
export function applyTheme(
  doc: Animation,
  rules: readonly ThemeRule[] | null,
  animationId: string | null,
  opts: Omit<ThemeToSlotsOptions, 'slots'> = {},
): Animation {
  if (!rules || rules.length === 0) return doc
  const key = `${animationId ?? ''}\u0000${opts.expressions === false ? 0 : 1}\u0000${JSON.stringify(rules)}`
  const hit = themedCache.get(doc)
  if (hit && hit.key === key) return hit.result
  const slots = listSlots(doc)
  const values = themeToSlots(rules, animationId, { ...opts, slots })
  // Rules for slots this animation does not have change nothing (players ignore them).
  const ids = Object.keys(values).filter((id) => slots.some((s) => s.id === id))
  let result: Animation = doc
  if (ids.length > 0) {
    const out = { ...doc } as Animation & Obj
    out.slots = { ...(isObj(doc.slots) ? doc.slots : {}), ...values }
    for (const id of ids) {
      const info = slots.find((s) => s.id === id)
      if (info?.kind !== 'gradient') continue
      const p = values[id].p as Obj
      let inner = false
      for (const ref of info.refs) {
        if (ref.path[ref.path.length - 1] !== 'g') {
          inner = true
          continue
        }
        // `g` itself carries the sid (ThorVG's convention): lottie-web never looks it up, so
        // the gradient is written in place, as `Object.assign(g, p)` would.
        const target = writablePath(out, ref.path)
        if (target) {
          target.p = p.p
          target.k = clone(p.k)
        }
      }
      // lottie-web applies slots to `g.k`, which takes the inner `{ a, k }` property.
      if (inner) (out.slots as Record<string, { p: unknown }>)[id] = { p: p.k }
    }
    result = out
  }
  themedCache.set(doc, { key, result })
  return result
}

/**
 * A copy of the animation with the theme written into the slots and every inline copy: players
 * without slot support (lottie-ios, lottie-android, older lottie-web) show the themed colors
 * too. Used to export one theme as a plain Lottie JSON.
 */
export function bakeTheme(
  doc: Animation,
  rules: readonly ThemeRule[],
  animationId: string | null,
): Animation {
  const copy = clone(doc)
  const slots = listSlots(copy)
  const values = themeToSlots(rules, animationId, { slots, expressions: true })
  const ids = Object.keys(values).filter((id) => slots.some((s) => s.id === id))
  if (!ids.length) return copy
  copy.slots = { ...(isObj(copy.slots) ? copy.slots : {}) }
  for (const id of ids) {
    const info = slots.find((s) => s.id === id)
    const p = values[id].p as Obj
    const isGradient = info?.kind === 'gradient'
    // The dictionary stores what the `sid` objects receive (gradients bound on `g.k` take `k`).
    const onInner = isGradient && info.refs.some((r) => r.path[r.path.length - 1] === 'k')
    copy.slots[id] = { p: onInner ? p.k : p }
    for (const ref of info?.refs ?? []) {
      const inner = isGradient && ref.path[ref.path.length - 1] === 'k'
      bakeValue(copy, ref, clone(inner ? (p.k as Obj) : p), copy)
    }
  }
  return copy
}
