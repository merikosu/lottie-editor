/**
 * Timeline editing operations: moving and trimming layers in time, and editing keyframe
 * selections (move, duplicate, delete, scale, reverse, distribute, easing, copy/paste).
 *
 * Every function MUTATES the document or layer it receives and is safe to call on immer
 * drafts (values are copied with JSON cloning: `structuredClone` cannot clone draft proxies).
 * Time semantics follow lottie-web (see time.ts): a layer's `ip`/`op`/`st` and the keyframe
 * times of its properties are all in the time of the composition that contains the layer.
 */
import { handlesForCurve, type BezierCurve } from './easing'
import { applyEasyEase, ensureHandles, KEY_TIME_EPSILON, removeKeyframes } from './keyframes'
import { getAt, type NodePath, type PathSegment } from './path'
import {
  dimensionsOf,
  getKeyframes,
  isAnimated,
  isPropertyLike,
  type AnyProperty,
} from './property'
import { forEachProperty } from './traverse'
import type { Animation, BezierPath, EasingHandle, Keyframe, Layer } from './types'

/** Reference to one keyframe: the property path and the index in its `k` array. */
export interface KeyRef {
  path: NodePath
  index: number
}

type Kf = Keyframe<unknown>

const round3 = (v: number) => Math.round(v * 1000) / 1000
const LINEAR_OUT: EasingHandle = { x: 0.167, y: 0.167 }
const LINEAR_IN: EasingHandle = { x: 0.833, y: 0.833 }

/** Deep copy that also works on immer drafts. Keyframe data is plain JSON. */
function cloneJson<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function propAt(anim: Animation, path: NodePath): AnyProperty | undefined {
  const value = getAt<unknown>(anim, path)
  return isPropertyLike(value) ? value : undefined
}

/** The property at `path` with legacy keyframes converted, or null when it is not animated. */
function animatedAt(anim: Animation, path: NodePath): { prop: AnyProperty; kfs: Kf[] } | null {
  const prop = propAt(anim, path)
  if (!prop) return null
  normalizeLegacyKeys(prop)
  const kfs = getKeyframes(prop)
  return kfs ? { prop, kfs } : null
}

/**
 * Converts legacy keyframes (bodymovin < 5.5: end values in `e`, last keyframe `{t}` only)
 * to the modern format in place. Same result as keyframes.normalizeLegacyKeyframes, but
 * draft-safe; running it first makes the keyframes.ts helpers skip their own conversion.
 */
export function normalizeLegacyKeys(prop: AnyProperty): void {
  const kfs = getKeyframes(prop)
  if (!kfs || !kfs.some((kf) => kf.e !== undefined)) return
  for (let i = 0; i < kfs.length; i++) {
    const kf = kfs[i]
    const next = kfs[i + 1]
    if (next && next.s === undefined && kf.e !== undefined) next.s = cloneJson(kf.e)
    delete kf.e
  }
}

/** Text document keyframes (`t.d.k`) hold whole documents, not numbers or paths. */
export function isTextDocumentKeys(kfs: readonly Kf[] | null | undefined): boolean {
  const s = kfs?.[0]?.s
  return s !== null && typeof s === 'object' && !Array.isArray(s)
}

/**
 * Stores sorted keyframes back into the property. Text documents are hold-only and never
 * get easing handles or an `a` flag; everything else gets the usual structural guarantees.
 */
function commitKeys(prop: AnyProperty, kfs: Kf[]): void {
  kfs.sort((a, b) => a.t - b.t)
  prop.k = kfs
  if (isTextDocumentKeys(kfs)) return
  ensureHandles(kfs)
  prop.a = 1
}

/** Groups refs by property (deduplicated, indices ascending), in first-seen order. */
export function groupKeyRefs(refs: readonly KeyRef[]): { path: NodePath; indices: number[] }[] {
  const groups = new Map<string, { path: NodePath; indices: Set<number> }>()
  for (const ref of refs) {
    const key = ref.path.join('/')
    let group = groups.get(key)
    if (!group) {
      group = { path: ref.path, indices: new Set() }
      groups.set(key, group)
    }
    group.indices.add(ref.index)
  }
  return [...groups.values()].map((g) => ({
    path: g.path,
    indices: [...g.indices].sort((a, b) => a - b),
  }))
}

/** All keyframe refs of the given properties (static properties contribute nothing). */
export function allKeyRefs(anim: Animation, paths: readonly NodePath[]): KeyRef[] {
  const refs: KeyRef[] = []
  for (const path of paths) {
    const kfs = getKeyframes(propAt(anim, path))
    kfs?.forEach((_, index) => refs.push({ path, index }))
  }
  return refs
}

/* -------------------------------------------------------------------------- */
/*                                 Layer time                                 */
/* -------------------------------------------------------------------------- */

/** Animated properties of a layer (transform, shapes, masks, effects, text, time remap, …). */
export function layerAnimatedProperties(
  layer: Layer,
  basePath: NodePath = [],
): { path: NodePath; prop: AnyProperty }[] {
  const out: { path: NodePath; prop: AnyProperty }[] = []
  forEachProperty(layer, basePath, (prop, path) => {
    if (isAnimated(prop)) out.push({ path, prop })
  })
  return out
}

/** Sorted, de-duplicated keyframe times of every property of a layer. */
export function layerKeyframeTimes(layer: Layer): number[] {
  const times: number[] = []
  for (const { prop } of layerAnimatedProperties(layer)) {
    for (const kf of getKeyframes(prop) ?? []) times.push(kf.t)
  }
  times.sort((a, b) => a - b)
  return times.filter((t, i) => i === 0 || t - times[i - 1] > KEY_TIME_EPSILON)
}

/**
 * Moves a layer in time by `delta` frames: in/out points, start time and the keyframes of
 * all its properties (incl. text document keys and time remap) shift together, so the layer
 * looks the same, only later/earlier. A precomp's own content is not touched (its time follows
 * `st`).
 */
export function shiftLayerTime(layer: Layer, delta: number): void {
  if (!delta || !Number.isFinite(delta)) return
  layer.ip = round3(layer.ip + delta)
  layer.op = round3(layer.op + delta)
  layer.st = round3((layer.st ?? 0) + delta)
  for (const { prop } of layerAnimatedProperties(layer)) {
    for (const kf of getKeyframes(prop) ?? []) kf.t = round3(kf.t + delta)
  }
}

/** Sets the in point, keeping at least `minDuration` frames before the out point. Returns it. */
export function trimLayerIn(layer: Layer, ip: number, minDuration = 1): number {
  const next = round3(Math.min(ip, layer.op - minDuration))
  layer.ip = next
  return next
}

/** Sets the out point, keeping at least `minDuration` frames after the in point. Returns it. */
export function trimLayerOut(layer: Layer, op: number, minDuration = 1): number {
  const next = round3(Math.max(op, layer.ip + minDuration))
  layer.op = next
  return next
}

/* -------------------------------------------------------------------------- */
/*                                Retiming keys                               */
/* -------------------------------------------------------------------------- */

/**
 * Re-times keyframes `indices` of a property with `mapTime`. Unmoved keyframes at a new time
 * are replaced (After Effects / Lottie Creator behaviour); when several moved keyframes land on
 * the same time the later one wins. Returns the new indices of the surviving moved keyframes.
 */
export function retimeKeys(
  prop: AnyProperty,
  indices: readonly number[],
  mapTime: (t: number, index: number) => number,
): number[] {
  normalizeLegacyKeys(prop)
  const kfs = getKeyframes(prop)
  if (!kfs || indices.length === 0) return []
  const selected = new Set(indices.filter((i) => i >= 0 && i < kfs.length))
  if (selected.size === 0) return []

  const moved: Kf[] = []
  for (const i of [...selected].sort((a, b) => a - b)) {
    const kf = kfs[i]
    kf.t = round3(mapTime(kf.t, i))
    moved.push(kf)
  }
  // Later moved keys win collisions among themselves.
  const survivors: Kf[] = []
  for (const kf of moved) {
    const clash = survivors.findIndex((s) => Math.abs(s.t - kf.t) < KEY_TIME_EPSILON)
    if (clash >= 0) survivors.splice(clash, 1)
    survivors.push(kf)
  }
  const survivorSet = new Set(survivors)
  const kept = kfs.filter((kf, i) => {
    if (selected.has(i)) return survivorSet.has(kf)
    return !survivors.some((m) => Math.abs(m.t - kf.t) < KEY_TIME_EPSILON)
  })
  commitKeys(prop, kept)
  return survivors.map((kf) => kept.indexOf(kf)).sort((a, b) => a - b)
}

type DeltaFor = number | ((path: NodePath) => number)

const deltaOf = (delta: DeltaFor, path: NodePath) =>
  typeof delta === 'function' ? delta(path) : delta

/** Moves keyframes by `delta` frames (per property when a function). Returns the new refs. */
export function moveKeys(anim: Animation, refs: readonly KeyRef[], delta: DeltaFor): KeyRef[] {
  const out: KeyRef[] = []
  for (const { path, indices } of groupKeyRefs(refs)) {
    const prop = propAt(anim, path)
    if (!prop) continue
    const d = deltaOf(delta, path)
    for (const index of retimeKeys(prop, indices, (t) => t + d)) out.push({ path, index })
  }
  return out
}

/**
 * Copies keyframes `delta` frames away from the originals (Alt-drag). Copies replace any key
 * at their time, including an original. Returns the refs of the copies.
 */
export function duplicateKeys(anim: Animation, refs: readonly KeyRef[], delta: DeltaFor): KeyRef[] {
  const out: KeyRef[] = []
  for (const { path, indices } of groupKeyRefs(refs)) {
    const found = animatedAt(anim, path)
    if (!found) continue
    const { prop, kfs } = found
    const d = deltaOf(delta, path)
    const copies = indices
      .filter((i) => i < kfs.length)
      .map((i) => ({ ...cloneJson(kfs[i]), t: round3(kfs[i].t + d) }))
    const kept = kfs.filter((kf) => !copies.some((c) => Math.abs(c.t - kf.t) < KEY_TIME_EPSILON))
    const all = [...kept, ...copies]
    commitKeys(prop, all)
    for (const copy of copies) out.push({ path, index: all.indexOf(copy) })
  }
  return out
}

/**
 * Deletes keyframes. A property losing all its keyframes becomes static with the value of
 * the first deleted key; text documents always keep at least one keyframe.
 */
export function deleteKeys(anim: Animation, refs: readonly KeyRef[]): void {
  for (const { path, indices } of groupKeyRefs(refs)) {
    const found = animatedAt(anim, path)
    if (!found) continue
    const { prop, kfs } = found
    if (isTextDocumentKeys(kfs)) {
      const remove = new Set(indices)
      let kept = kfs.filter((_, i) => !remove.has(i))
      if (kept.length === 0) kept = [kfs[0]]
      prop.k = kept
      continue
    }
    removeKeyframes(prop, indices)
  }
}

/**
 * Scales the timing of keyframes around `origin` (e.g. the opposite end of the selection).
 * With `round` (default) times snap to whole frames. Factor must be positive.
 */
export function scaleKeys(
  anim: Animation,
  refs: readonly KeyRef[],
  factor: number,
  origin: DeltaFor,
  opts: { round?: boolean } = {},
): KeyRef[] {
  if (!(factor > 0) || !Number.isFinite(factor)) return [...refs]
  const round = opts.round ?? true
  const out: KeyRef[] = []
  for (const { path, indices } of groupKeyRefs(refs)) {
    const prop = propAt(anim, path)
    if (!prop) continue
    const o = deltaOf(origin, path)
    const map = (t: number) => {
      const next = o + (t - o) * factor
      return round ? Math.round(next) : next
    }
    for (const index of retimeKeys(prop, indices, map)) out.push({ path, index })
  }
  return out
}

/** Composition a property belongs to: 'root' or the precomp asset index. */
function compKeyOf(path: NodePath): string {
  return path[0] === 'assets' && typeof path[1] === 'number' ? `asset:${path[1]}` : 'root'
}

/**
 * Spreads the selected keyframes evenly between the first and last selected time. Keys that
 * share a time move together (so aligned keys of different properties stay aligned). Works
 * per composition, because times of different compositions are not comparable.
 * Times snap to whole frames when there is room for it.
 */
export function distributeKeys(anim: Animation, refs: readonly KeyRef[]): KeyRef[] {
  const byComp = new Map<string, KeyRef[]>()
  for (const ref of refs) {
    const key = compKeyOf(ref.path)
    byComp.set(key, [...(byComp.get(key) ?? []), ref])
  }
  const out: KeyRef[] = []
  for (const compRefs of byComp.values()) {
    const groups = groupKeyRefs(compRefs)
    const times: number[] = []
    for (const { path, indices } of groups) {
      const kfs = getKeyframes(propAt(anim, path))
      for (const i of indices) if (kfs?.[i]) times.push(kfs[i].t)
    }
    times.sort((a, b) => a - b)
    const distinct = times.filter((t, i) => i === 0 || t - times[i - 1] > KEY_TIME_EPSILON)
    if (distinct.length < 3) {
      out.push(...compRefs)
      continue
    }
    const first = distinct[0]
    const step = (distinct[distinct.length - 1] - first) / (distinct.length - 1)
    const whole = step >= 1
    const target = (t: number) => {
      const rank = distinct.findIndex((d) => Math.abs(d - t) <= KEY_TIME_EPSILON)
      const next = first + step * Math.max(0, rank)
      return whole ? Math.round(next) : next
    }
    for (const { path, indices } of groups) {
      const prop = propAt(anim, path)
      if (!prop) continue
      for (const index of retimeKeys(prop, indices, target)) out.push({ path, index })
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*                                   Reverse                                  */
/* -------------------------------------------------------------------------- */

const mirror = (v: number | number[]): number | number[] =>
  Array.isArray(v) ? v.map((c) => 1 - c) : 1 - v

function mirrorHandle(h: EasingHandle | undefined, fallback: EasingHandle): EasingHandle {
  const src = h ?? fallback
  return { x: mirror(src.x), y: mirror(src.y) }
}

/** Per-key view of the segment model: what leaves a key and what arrives at it. */
interface KeySides {
  out: { o?: EasingHandle; i?: EasingHandle; hold: boolean; to?: number[] }
  in: { o?: EasingHandle; i?: EasingHandle; hold: boolean; ti?: number[] }
}

/**
 * Reverses the timing of the selected keyframes within their span: t' = first + last − t.
 * Values travel with their keys; easing is mirrored so the animation plays exactly backwards
 * (out ↔ in handles, 1 − x / 1 − y), spatial tangents swap sides and a hold segment becomes a
 * hold on the mirrored segment's start key (After Effects "Time-Reverse Keyframes").
 * Works per property. Returns the new refs.
 */
export function reverseKeys(anim: Animation, refs: readonly KeyRef[]): KeyRef[] {
  const out: KeyRef[] = []
  for (const { path, indices } of groupKeyRefs(refs)) {
    const found = animatedAt(anim, path)
    if (!found) continue
    const { prop, kfs } = found
    const valid = indices.filter((i) => i < kfs.length)
    if (valid.length < 2) {
      valid.forEach((index) => out.push({ path, index }))
      continue
    }
    const text = isTextDocumentKeys(kfs)
    const selected = new Set(valid.map((i) => kfs[i]))
    const times = valid.map((i) => kfs[i].t)
    const span = Math.min(...times) + Math.max(...times)

    // Read the per-key sides BEFORE anything moves.
    const sides = new Map<Kf, KeySides>()
    kfs.forEach((kf, i) => {
      const prev = kfs[i - 1]
      sides.set(kf, {
        out: { o: kf.o, i: kf.i, hold: kf.h === 1, to: kf.to },
        in: { o: prev?.o, i: prev?.i, hold: prev?.h === 1, ti: prev?.ti },
      })
    })
    const newSides = new Map<Kf, KeySides>()
    for (const kf of kfs) {
      const s = sides.get(kf)!
      if (!selected.has(kf)) {
        newSides.set(kf, s)
        continue
      }
      // Reversing time turns what arrived at a key into what leaves it, and vice versa.
      newSides.set(kf, {
        out: {
          o: s.in.i ? mirrorHandle(s.in.i, LINEAR_IN) : undefined,
          i: s.in.o ? mirrorHandle(s.in.o, LINEAR_OUT) : undefined,
          hold: s.in.hold,
          to: s.in.ti,
        },
        in: {
          o: s.out.i ? mirrorHandle(s.out.i, LINEAR_IN) : undefined,
          i: s.out.o ? mirrorHandle(s.out.o, LINEAR_OUT) : undefined,
          hold: s.out.hold,
          ti: s.out.to,
        },
      })
    }

    for (const kf of selected) kf.t = round3(span - kf.t)
    const movedTimes = [...selected].map((kf) => kf.t)
    const kept = kfs.filter(
      (kf) => selected.has(kf) || !movedTimes.some((t) => Math.abs(t - kf.t) < KEY_TIME_EPSILON),
    )
    kept.sort((a, b) => a.t - b.t)

    if (!text) {
      const spatial = kept.some((kf) => Array.isArray(kf.to) || Array.isArray(kf.ti))
      for (let i = 0; i < kept.length; i++) {
        const a = kept[i]
        const b = kept[i + 1]
        delete a.n
        if (!b) {
          delete a.h
          delete a.to
          delete a.ti
          continue
        }
        const sa = newSides.get(a)!.out
        const sb = newSides.get(b)!.in
        // The segment a → b: `o` comes from a's outgoing side, `i` from b's incoming side.
        a.o = cloneJson(sa.o ?? sb.o ?? a.o ?? LINEAR_OUT)
        a.i = cloneJson(sb.i ?? sa.i ?? a.i ?? LINEAR_IN)
        if (sa.hold) a.h = 1
        else delete a.h
        if (spatial && !sa.hold) {
          const dims = Array.isArray(a.s) ? (a.s as unknown[]).length : 2
          a.to = cloneJson(sa.to ?? Array.from({ length: dims }, () => 0))
          a.ti = cloneJson(sb.ti ?? Array.from({ length: dims }, () => 0))
        } else {
          delete a.to
          delete a.ti
        }
      }
    }
    commitKeys(prop, kept)
    for (const kf of selected) {
      const index = kept.indexOf(kf)
      if (index >= 0) out.push({ path, index })
    }
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*                                   Easing                                   */
/* -------------------------------------------------------------------------- */

/**
 * Segments (start key indices) affected by an easing change on the selected keys: each
 * key's outgoing segment; a selected last key (without its predecessor) affects the incoming
 * one, so choosing an easing on the final key still does something visible.
 */
export function segmentsOfSelection(count: number, indices: readonly number[]): number[] {
  const selected = new Set(indices)
  const segments = new Set<number>()
  for (const i of selected) {
    if (i < count - 1) segments.add(i)
    else if (i === count - 1 && i > 0 && !selected.has(i - 1)) segments.add(i - 1)
  }
  return [...segments].sort((a, b) => a - b)
}

/** Sets the easing (or hold with `curve = null`) of the selection's segments. */
export function setKeysEasing(
  anim: Animation,
  refs: readonly KeyRef[],
  curve: BezierCurve | null,
): void {
  for (const { path, indices } of groupKeyRefs(refs)) {
    const found = animatedAt(anim, path)
    if (!found || isTextDocumentKeys(found.kfs)) continue
    const { kfs } = found
    for (const s of segmentsOfSelection(kfs.length, indices)) {
      const kf = kfs[s]
      delete kf.n
      if (curve === null) {
        kf.h = 1
        // lottie-web ignores hold on segments with spatial tangents.
        delete kf.to
        delete kf.ti
        if (!kf.o) kf.o = { ...LINEAR_OUT }
        if (!kf.i) kf.i = { ...LINEAR_IN }
      } else {
        delete kf.h
        const { o, i } = handlesForCurve(curve, kf)
        kf.o = o
        kf.i = i
      }
    }
  }
}

/** After Effects Easy Ease (F9 / ⇧F9 / ⌘⇧F9) on every selected keyframe. */
export function easyEaseKeys(
  anim: Animation,
  refs: readonly KeyRef[],
  mode: 'both' | 'in' | 'out' = 'both',
): void {
  for (const { path, indices } of groupKeyRefs(refs)) {
    const found = animatedAt(anim, path)
    if (!found || isTextDocumentKeys(found.kfs)) continue
    const { prop, kfs } = found
    for (const i of indices) {
      if (i >= kfs.length) continue
      delete kfs[i].n
      if (i > 0) delete kfs[i - 1].n
      applyEasyEase(prop, i, mode)
    }
  }
}

/** True when every segment the selection affects is a hold. */
export function isSelectionHold(anim: Animation, refs: readonly KeyRef[]): boolean {
  let any = false
  for (const { path, indices } of groupKeyRefs(refs)) {
    const kfs = getKeyframes(propAt(anim, path))
    if (!kfs || isTextDocumentKeys(kfs)) continue
    for (const s of segmentsOfSelection(kfs.length, indices)) {
      any = true
      if (kfs[s].h !== 1) return false
    }
  }
  return any
}

/** Toggles hold on the selection's segments. Returns the new state (true = hold). */
export function toggleKeysHold(anim: Animation, refs: readonly KeyRef[]): boolean {
  const hold = !isSelectionHold(anim, refs)
  if (hold) {
    setKeysEasing(anim, refs, null)
    return true
  }
  for (const { path, indices } of groupKeyRefs(refs)) {
    const found = animatedAt(anim, path)
    if (!found || isTextDocumentKeys(found.kfs)) continue
    const { kfs } = found
    for (const s of segmentsOfSelection(kfs.length, indices)) {
      // Releasing a hold restores the handles that were kept on the key.
      delete kfs[s].h
      if (!kfs[s].o) kfs[s].o = { ...LINEAR_OUT }
      if (!kfs[s].i) kfs[s].i = { ...LINEAR_IN }
    }
  }
  return false
}

/* -------------------------------------------------------------------------- */
/*                          Property kinds (paste targets)                     */
/* -------------------------------------------------------------------------- */

export type PropKind = 'scalar' | 'vector' | 'color' | 'gradient' | 'path' | 'text'

function isBezierPath(v: unknown): v is BezierPath {
  return (
    v !== null && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as BezierPath).v)
  )
}

/** Classifies a property by its value and its place in the document. */
export function classifyProperty(
  anim: Animation,
  path: NodePath,
): { kind: PropKind; dims: number } {
  const prop = propAt(anim, path)
  if (!prop) return { kind: 'scalar', dims: 0 }
  const kfs = getKeyframes(prop)
  if (isTextDocumentKeys(kfs)) return { kind: 'text', dims: 0 }
  const sample = kfs ? (kfs[0].s as unknown[] | undefined)?.[0] : prop.k
  if (isBezierPath(sample) || isBezierPath(prop.k)) return { kind: 'path', dims: 0 }
  const dims = dimensionsOf(prop)
  const n = path.length
  const key = path[n - 1]
  if (key === 'k' && path[n - 2] === 'g') return { kind: 'gradient', dims }
  const parent = getAt<Record<string, unknown>>(anim, path.slice(0, -1))
  if (key === 'c' && (parent?.ty === 'fl' || parent?.ty === 'st')) return { kind: 'color', dims }
  if ((key === 'fc' || key === 'sc') && path[n - 2] === 'a') return { kind: 'color', dims }
  if (key === 'v' && parent?.ty === 2) return { kind: 'color', dims }
  return { kind: dims <= 1 ? 'scalar' : 'vector', dims }
}

/** Can keyframes copied from a property of kind `from` be pasted onto one of kind `to`? */
export function canPasteKeys(
  from: { kind: PropKind; dims: number },
  to: { kind: PropKind; dims: number },
): boolean {
  if (from.kind !== to.kind) return false
  switch (from.kind) {
    case 'scalar':
    case 'path':
    case 'text':
      return true
    case 'gradient':
      return from.dims === to.dims
    case 'vector':
      // 2-D and 3-D vectors (e.g. position with or without z) interoperate.
      return Math.abs(from.dims - to.dims) <= 1 && Math.min(from.dims, to.dims) >= 2
    case 'color':
      // RGB and RGBA.
      return Math.min(from.dims, to.dims) >= 3
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Clipboard                                 */
/* -------------------------------------------------------------------------- */

export const KEYFRAME_CLIPBOARD_KIND = 'keyframes'

export interface KeyframeClipTrack {
  /** Source property path: paste goes back onto the same property when it still fits. */
  path: PathSegment[]
  /** Path of the source property relative to its layer (to paste onto another layer). */
  relPath: PathSegment[]
  kind: PropKind
  dims: number
  /** Keyframes with `t` relative to the earliest copied keyframe (root frames). */
  keys: Keyframe<unknown>[]
}

export interface KeyframeClipboard {
  __lottieEditor: 'keyframes'
  version: 1
  tracks: KeyframeClipTrack[]
}

/** Maps a local time of the property at `path` to root time and back (precomp children). */
export interface TimeMapping {
  toRoot?: (path: NodePath, t: number) => number
  toLocal?: (path: NodePath, frame: number) => number
}

function layerPrefixLength(path: NodePath): number {
  for (let i = path.length - 2; i >= 0; i--) {
    if (path[i] === 'layers' && typeof path[i + 1] === 'number') return i + 2
  }
  return 0
}

/** Builds a clipboard payload for the selected keyframes (null when nothing is copyable). */
export function copyKeyframes(
  anim: Animation,
  refs: readonly KeyRef[],
  mapping: TimeMapping = {},
): KeyframeClipboard | null {
  const toRoot = mapping.toRoot ?? ((_p: NodePath, t: number) => t)
  const picked: { path: NodePath; keys: Kf[]; rootTimes: number[] }[] = []
  for (const { path, indices } of groupKeyRefs(refs)) {
    const prop = propAt(anim, path)
    if (!prop || !isAnimated(prop)) continue
    // Work on a copy: legacy end values are resolved without touching the document.
    const copy = cloneJson({ k: prop.k }) as AnyProperty
    normalizeLegacyKeys(copy)
    const kfs = getKeyframes(copy)!
    const keys = indices.filter((i) => i < kfs.length).map((i) => kfs[i])
    if (keys.length === 0) continue
    picked.push({ path, keys, rootTimes: keys.map((k) => toRoot(path, k.t)) })
  }
  if (picked.length === 0) return null
  const base = Math.min(...picked.flatMap((p) => p.rootTimes))
  return {
    // oxlint-disable-next-line no-underscore-dangle -- clipboard marker defined by the foundation
    __lottieEditor: 'keyframes',
    version: 1,
    tracks: picked.map(({ path, keys, rootTimes }) => {
      const { kind, dims } = classifyProperty(anim, path)
      return {
        path: [...path],
        relPath: path.slice(layerPrefixLength(path)),
        kind,
        dims,
        keys: keys.map((kf, i) => ({ ...kf, t: round3(rootTimes[i] - base) })),
      }
    }),
  }
}

/** Structural check for a pasted payload (it may come from another tab or app version). */
export function isKeyframeClipboard(value: unknown): value is KeyframeClipboard {
  if (value === null || typeof value !== 'object') return false
  const v = value as Partial<KeyframeClipboard>
  return (
    v['__lottieEditor'] === KEYFRAME_CLIPBOARD_KIND &&
    Array.isArray(v.tracks) &&
    v.tracks.every(
      (t) =>
        t &&
        Array.isArray(t.path) &&
        Array.isArray(t.keys) &&
        t.keys.every((k) => k !== null && typeof k === 'object' && typeof (k as Kf).t === 'number'),
    )
  )
}

function resizeArray(v: unknown, dims: number): unknown {
  if (!Array.isArray(v) || v.length === 0 || typeof v[0] !== 'number' || dims <= 0) return v
  return Array.from({ length: dims }, (_, i) => (v[i] as number | undefined) ?? (i === 3 ? 1 : 0))
}

const scalarHandle = (h: EasingHandle): EasingHandle => ({
  x: Array.isArray(h.x) ? (h.x[0] ?? 0) : h.x,
  y: Array.isArray(h.y) ? (h.y[0] ?? 0) : h.y,
})

/** Adapts a copied keyframe to the dimensions of the destination property. */
function adaptKey(kf: Kf, fromDims: number, toDims: number): Kf {
  if (fromDims === toDims || toDims <= 0) return kf
  const next: Kf = { ...kf, s: resizeArray(kf.s, toDims) }
  if (kf.e !== undefined) next.e = resizeArray(kf.e, toDims)
  if (kf.to) next.to = resizeArray(kf.to, toDims) as number[]
  if (kf.ti) next.ti = resizeArray(kf.ti, toDims) as number[]
  // Per-dimension easing arrays no longer match: fall back to one curve for all dimensions.
  if (kf.o) next.o = scalarHandle(kf.o)
  if (kf.i) next.i = scalarHandle(kf.i)
  return next
}

export interface PasteOptions extends TimeMapping {
  /** Root frame for the earliest pasted keyframe (usually the playhead). */
  at: number
  /** A focused property: a single copied track is pasted onto it when compatible. */
  targetProperty?: NodePath | null
  /** A selected layer: tracks are pasted onto the same properties of that layer. */
  targetLayer?: NodePath | null
}

/**
 * Pastes keyframes at `at`, preserving their relative timing. Destination per track: the
 * focused property (single track), the same property of the target layer, or the original
 * property. Incompatible or missing destinations are skipped. Keys already at a pasted time
 * are replaced; static destinations become animated. Returns refs of the pasted keys.
 */
export function pasteKeyframes(
  anim: Animation,
  clip: KeyframeClipboard,
  opts: PasteOptions,
): KeyRef[] {
  const toLocal = opts.toLocal ?? ((_p: NodePath, f: number) => f)
  const out: KeyRef[] = []
  const used = new Set<string>()

  const fits = (path: NodePath | null | undefined, track: KeyframeClipTrack): path is NodePath => {
    if (!path || !propAt(anim, path)) return false
    return canPasteKeys(track, classifyProperty(anim, path))
  }

  for (const track of clip.tracks) {
    const candidates: (NodePath | null | undefined)[] = []
    if (clip.tracks.length === 1) candidates.push(opts.targetProperty)
    if (opts.targetLayer && Array.isArray(track.relPath))
      candidates.push([...opts.targetLayer, ...track.relPath])
    candidates.push(track.path)
    const dest = candidates.find((c) => fits(c, track) && !used.has(c.join('/')))
    if (!dest) continue
    used.add(dest.join('/'))

    const prop = propAt(anim, dest)!
    normalizeLegacyKeys(prop)
    const { dims } = classifyProperty(anim, dest)
    const existing = getKeyframes(prop) ?? []
    const keys = track.keys.map((kf) => {
      const copy = adaptKey(cloneJson(kf), track.dims, dims)
      delete copy.n
      copy.t = round3(toLocal(dest, opts.at + kf.t))
      return copy
    })
    const kept = existing.filter((kf) => !keys.some((k) => Math.abs(k.t - kf.t) < KEY_TIME_EPSILON))
    const all = [...kept, ...keys]
    commitKeys(prop, all)
    for (const key of keys) out.push({ path: dest, index: all.indexOf(key) })
  }
  return out
}
