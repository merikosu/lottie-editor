/**
 * Document-level time operations: speed, duration, frame rate, trim, offset, reverse,
 * hold at end and ping-pong.
 *
 * Every function MUTATES the animation it receives; call them inside an immer recipe
 * (`updateDoc(label, draft => setSpeed(draft, 2))`) or on a private copy. They never use
 * `structuredClone` on document data (it throws on immer drafts); values are copied with
 * `plainCopy`, which reads through draft proxies.
 *
 * Time model (lottie-web, see time.ts):
 *  - root ip/op, layer ip/op/st, keyframe `t` and marker tm/dr are frames of the composition
 *    that contains them;
 *  - a precomp's content has its own time base, reached through `inner = (outer − st) / sr`,
 *    or `inner = tm(outer) · fr` with time remapping (`tm` values are SECONDS multiplied by
 *    the ROOT frame rate).
 *
 * The operations keep that mapping consistent, so precomp instances with `st` offsets, time
 * remaps and nested precomps play exactly as before — only faster, slower or reversed.
 * Expressions are code and are left untouched (see `countExpressions` to warn about them).
 *
 * Playing backwards (reverse, the second half of a ping-pong) and freezing (pause at end) show
 * LEFT LIMITS: at time t the result shows what the original showed just before the mirrored
 * (or frozen) time. Keyframes are evaluated right-continuously, and the mirror of such a step
 * is right-continuous again, so every switch keeps its exact mirrored time; for content that
 * switches on whole frames (holds, layers in and out, text) the whole frames come out in exact
 * reverse order and a pause holds the last frame shown.
 */
import { cubicBezier, handleComponent } from './easing'
import { precomposeRoot } from './canvas'
import {
  evaluateScalar,
  getKeyframes,
  isPropertyLike,
  spatialLocate,
  type AnyProperty,
} from './property'
import type {
  Animation,
  BezierPath,
  EasingHandle,
  Keyframe,
  Layer,
  PrecompAsset,
  PrecompLayer,
} from './types'
import { isPrecompAsset, isPrecompLayer } from './types'

/** Two times closer than this (in frames) are considered equal. */
export const TIME_EPSILON = 1e-4

type Kf = Keyframe<unknown>
type Json = Record<string, unknown>

/** Rounds a time to 1/1000 frame so repeated edits do not accumulate float noise. */
export function roundTime(t: number): number {
  const r = Math.round(t * 1000) / 1000
  return Object.is(r, -0) ? 0 : r
}

/** Rounds a stored value (easing handles, seconds, pixels) to 6 decimals. */
function roundValue(v: number): number {
  const r = Math.round(v * 1e6) / 1e6
  return Object.is(r, -0) ? 0 : r
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function assertPositive(value: number, what: string): void {
  if (!(value > 0) || !Number.isFinite(value))
    throw new RangeError(`${what} must be a positive number`)
}

/** Deep copy of JSON-like data. Unlike structuredClone it works on immer drafts. */
export function plainCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(plainCopy) as T
  if (value !== null && typeof value === 'object') {
    const out: Json = {}
    for (const key of Object.keys(value)) out[key] = plainCopy((value as Json)[key])
    return out as T
  }
  return value
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/* -------------------------------------------------------------------------- */
/*                                  Walking                                   */
/* -------------------------------------------------------------------------- */

type PropertyVisitor = (prop: AnyProperty) => void

/** Visits every animatable property under `node` without descending into properties. */
function walkProperties(node: unknown, visit: PropertyVisitor): void {
  if (Array.isArray(node)) {
    for (const child of node) visitNode(child, visit)
  } else if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node)) visitNode((node as Json)[key], visit)
  }
}

function visitNode(child: unknown, visit: PropertyVisitor): void {
  if (child === null || typeof child !== 'object') return
  if (!Array.isArray(child) && isPropertyLike(child)) {
    visit(child)
    return
  }
  walkProperties(child, visit)
}

/**
 * Visits the properties of a layer (transform, shapes, masks, effects, text, styles…).
 * The time remap of a precomp layer is skipped: its values need special handling.
 */
function walkLayerProperties(layer: Layer, visit: PropertyVisitor): void {
  const skipRemap = isPrecompLayer(layer)
  for (const key of Object.keys(layer)) {
    if (skipRemap && key === 'tm') continue
    visitNode((layer as unknown as Json)[key], visit)
  }
}

function precompAssets(anim: Animation): PrecompAsset[] {
  return (anim.assets ?? []).filter(isPrecompAsset)
}

/**
 * Animated slot values (`slots[id].p`) replace the properties that reference them, so their
 * keyframes need the same treatment. They follow the root composition's time (the common case;
 * a slot shared with precomps cannot follow two time bases).
 */
function forEachSlotProperty(anim: Animation, visit: PropertyVisitor): void {
  if (!anim.slots || typeof anim.slots !== 'object') return
  for (const slot of Object.values(anim.slots)) {
    const p = (slot as { p?: unknown } | null)?.p
    if (p !== null && typeof p === 'object' && !Array.isArray(p) && isPropertyLike(p)) visit(p)
  }
}

/** Number of properties driven by an expression (they are not retimed or reversed). */
export function countExpressions(anim: Animation): number {
  let count = 0
  const visit: PropertyVisitor = (prop) => {
    if (typeof prop.x === 'string' && prop.x.trim()) count++
  }
  const layers = [...(anim.layers ?? []), ...precompAssets(anim).flatMap((a) => a.layers ?? [])]
  for (const layer of layers) {
    walkProperties(layer, visit)
  }
  forEachSlotProperty(anim, visit)
  return count
}

/** True when the keyframes are text document keyframes ({ s: TextDocument, t }). */
function isTextDocumentKeyframes(kfs: readonly Kf[]): boolean {
  const s = kfs[0]?.s as { t?: unknown } | undefined
  return !!s && typeof s === 'object' && !Array.isArray(s) && typeof s.t === 'string'
}

/* -------------------------------------------------------------------------- */
/*                               Linear retiming                              */
/* -------------------------------------------------------------------------- */

/** t' = t · scale + offset */
interface Linear {
  scale: number
  offset: number
}

function mapTime(t: number, m: Linear): number {
  return roundTime(t * m.scale + m.offset)
}

/** Keyframes at the old root in/out point follow the (rounded) new one when possible. */
interface RangeSnap {
  oldIp: number
  oldOp: number
  ip: number
  op: number
}

function retimeKeyframes(prop: AnyProperty, m: Linear, snap: RangeSnap | null): void {
  const kfs = getKeyframes(prop)
  if (!kfs) return
  const original = kfs.map((kf) => kf.t)
  const next = original.map((t) => (isNum(t) ? mapTime(t, m) : t))
  if (snap) {
    for (let i = 0; i < next.length; i++) {
      const target =
        Math.abs(original[i] - snap.oldOp) < TIME_EPSILON
          ? snap.op
          : Math.abs(original[i] - snap.oldIp) < TIME_EPSILON
            ? snap.ip
            : null
      if (target === null) continue
      const prev = next[i - 1]
      const after = next[i + 1]
      if ((prev === undefined || prev <= target) && (after === undefined || after >= target))
        next[i] = target
    }
  }
  for (let i = 0; i < kfs.length; i++) {
    if (kfs[i].t !== next[i]) kfs[i].t = next[i]
  }
}

/** Applies `fn` to every value (static or keyframed) of a time-remap property. */
function mapRemapValues(tm: AnyProperty, fn: (seconds: number) => number): void {
  const map = (v: unknown): unknown => {
    if (isNum(v)) return fn(v)
    if (Array.isArray(v)) return v.map((x) => (isNum(x) ? fn(x) : x))
    return v
  }
  const kfs = getKeyframes(tm)
  if (!kfs) {
    tm.k = map(tm.k)
    return
  }
  for (const kf of kfs) {
    if (kf.s !== undefined) kf.s = map(kf.s)
    if (kf.e !== undefined) kf.e = map(kf.e)
  }
}

function retimeLayer(layer: Layer, m: Linear, remapScale: number, snap: RangeSnap | null): void {
  if (isNum(layer.ip)) layer.ip = mapTime(layer.ip, m)
  if (isNum(layer.op)) layer.op = mapTime(layer.op, m)
  const st = isNum(layer.st) ? layer.st : 0
  const mappedSt = mapTime(st, m)
  if (layer.st !== undefined || mappedSt !== 0) layer.st = mappedSt
  if (isPrecompLayer(layer) && layer.tm) {
    retimeKeyframes(layer.tm, m, snap)
    // Remapped times are seconds of the child content: they follow the content's speed.
    if (remapScale !== 1) mapRemapValues(layer.tm, (s) => roundValue(s * remapScale))
  }
  walkLayerProperties(layer, (prop) => retimeKeyframes(prop, m, snap))
}

interface RetimeOptions {
  /** Factor applied to time-remap values (seconds). */
  remapScale: number
  /** Round the root in/out points to whole frames. */
  roundRange: boolean
}

/**
 * Maps every time of the document through `m` (root composition) and scales precomp
 * contents by `m.scale` in their own time base. Precomp layers' `st` go through `m` too, so
 * `inner = (outer − st) / sr` scales by exactly `m.scale` — the content stays in sync.
 */
function retimeDocument(anim: Animation, m: Linear, opts: RetimeOptions): void {
  const oldIp = anim.ip
  const oldOp = anim.op
  let ip = mapTime(oldIp, m)
  let op = mapTime(oldOp, m)
  if (opts.roundRange) {
    ip = Math.round(ip)
    op = Math.max(ip + 1, Math.round(op))
  }
  anim.ip = ip
  anim.op = op
  const snap = opts.roundRange ? { oldIp, oldOp, ip, op } : null

  for (const layer of anim.layers ?? []) {
    const ip0 = layer.ip
    const op0 = layer.op
    retimeLayer(layer, m, opts.remapScale, snap)
    // Layers spanning the whole range keep doing so after the root range was rounded.
    if (isNum(ip0) && ip0 <= oldIp + TIME_EPSILON && layer.ip > ip) layer.ip = ip
    if (isNum(op0) && op0 >= oldOp - TIME_EPSILON && layer.op < op) layer.op = op
  }

  const inner: Linear = { scale: m.scale, offset: 0 }
  if (m.scale !== 1) {
    for (const asset of precompAssets(anim)) {
      for (const layer of asset.layers ?? []) retimeLayer(layer, inner, opts.remapScale, null)
    }
  }

  forEachSlotProperty(anim, (prop) => retimeKeyframes(prop, m, snap))

  for (const marker of anim.markers ?? []) {
    if (isNum(marker.tm)) marker.tm = mapTime(marker.tm, m)
    if (isNum(marker.dr)) marker.dr = roundTime(marker.dr * m.scale)
  }
}

/**
 * Scales every time value by `factor` around `origin` (a root-composition frame, default the
 * in point): factor 2 makes the animation twice as long. Precomp contents, time remaps and
 * markers follow. The root range is not rounded (see `setFrameCount` for whole frames).
 */
export function scaleTime(anim: Animation, factor: number, opts: { origin?: number } = {}): void {
  assertPositive(factor, 'Time factor')
  if (factor === 1) return
  const origin = opts.origin ?? anim.ip
  retimeDocument(
    anim,
    { scale: factor, offset: origin * (1 - factor) },
    { remapScale: factor, roundRange: false },
  )
}

/**
 * Moves everything in time by `delta` frames — root range, layers, keyframes and markers —
 * so the animation looks identical but its frames are renumbered (e.g. `-ip` starts it at 0).
 */
export function offsetTime(anim: Animation, delta: number): void {
  if (!Number.isFinite(delta) || delta === 0) return
  retimeDocument(anim, { scale: 1, offset: delta }, { remapScale: 1, roundRange: false })
}

/* -------------------------------------------------------------------------- */
/*                        Speed, duration and frame rate                      */
/* -------------------------------------------------------------------------- */

type Range = Pick<Animation, 'ip' | 'op'>

/** Whole number of frames the animation lasts after changing its speed (1 = unchanged). */
export function framesForSpeed(anim: Range, speed: number): number {
  assertPositive(speed, 'Speed')
  return Math.max(1, Math.round((anim.op - anim.ip) / speed))
}

/** Whole number of frames for a duration in seconds at the document frame rate. */
export function framesForDuration(anim: Pick<Animation, 'fr'>, seconds: number): number {
  assertPositive(seconds, 'Duration')
  return Math.max(1, Math.round(seconds * anim.fr))
}

/**
 * Retimes the animation so it lasts exactly `frames` frames (from the in point). All times
 * scale by the same factor, so the out point lands on a whole frame.
 */
export function setFrameCount(anim: Animation, frames: number): void {
  const current = anim.op - anim.ip
  if (!(current > 0)) return
  const target = Math.max(1, Math.round(frames))
  if (Math.abs(target - current) < TIME_EPSILON) return
  scaleTime(anim, target / current, { origin: anim.ip })
  anim.op = roundTime(anim.ip + target)
}

/**
 * Bakes a playback speed into the file: 2 plays twice as fast (half the frames), 0.5 twice
 * as slow. The frame rate is unchanged; keyframes may land on fractional frames.
 */
export function setSpeed(anim: Animation, speed: number): void {
  setFrameCount(anim, framesForSpeed(anim, speed))
}

/** Stretches or compresses the animation to last `seconds` (rounded to whole frames). */
export function setDuration(anim: Animation, seconds: number): void {
  setFrameCount(anim, framesForDuration(anim, seconds))
}

export interface FrameRatePlan {
  fr: number
  ip: number
  op: number
}

/** Root range after `changeFrameRate` (for previews; matches the operation exactly). */
export function planFrameRate(
  anim: Pick<Animation, 'fr' | 'ip' | 'op'>,
  fps: number,
  keepDuration: boolean,
): FrameRatePlan {
  assertPositive(fps, 'Frame rate')
  if (!keepDuration || Math.abs(fps - anim.fr) < 1e-9) return { fr: fps, ip: anim.ip, op: anim.op }
  const ratio = fps / anim.fr
  const ip = Math.round(roundTime(anim.ip * ratio))
  const op = Math.max(ip + 1, Math.round(roundTime(anim.op * ratio)))
  return { fr: fps, ip, op }
}

/**
 * Changes the frame rate.
 * - keepDuration: every time is retimed by newFps / oldFps so the animation lasts as long
 *   as before (the root range is rounded to whole frames);
 * - otherwise frame numbers stay and the animation plays faster or slower.
 * Time-remap values (seconds) are adjusted so precomps keep showing the same content frames.
 */
export function changeFrameRate(
  anim: Animation,
  fps: number,
  opts: { keepDuration: boolean },
): void {
  assertPositive(fps, 'Frame rate')
  const old = anim.fr
  if (Math.abs(fps - old) < 1e-9) return
  const ratio = fps / old
  if (opts.keepDuration) {
    retimeDocument(anim, { scale: ratio, offset: 0 }, { remapScale: 1, roundRange: true })
  } else {
    const remap = old / fps
    const scaleRemap = (layer: Layer) => {
      if (isPrecompLayer(layer) && layer.tm) mapRemapValues(layer.tm, (s) => roundValue(s * remap))
    }
    for (const layer of anim.layers ?? []) scaleRemap(layer)
    for (const asset of precompAssets(anim))
      for (const layer of asset.layers ?? []) scaleRemap(layer)
  }
  anim.fr = fps
  for (const asset of precompAssets(anim)) {
    // Informational in lottie-web, but keep it consistent with the new time base.
    if (isNum(asset.fr)) asset.fr = roundTime(asset.fr * ratio)
  }
}

/* -------------------------------------------------------------------------- */
/*                                    Trim                                    */
/* -------------------------------------------------------------------------- */

export interface TrimOptions {
  /** Move everything so the range starts at frame 0. */
  shiftToZero?: boolean
  /**
   * Markers name segments of the animation: drop those outside the range and clamp the ones
   * crossing its edges.
   */
  clipMarkers?: boolean
}

/**
 * Sets the root in/out points to [start, end) — non-destructive: layers and keyframes outside
 * the range are kept.
 */
export function trimToRange(
  anim: Animation,
  start: number,
  end: number,
  opts: TrimOptions = {},
): void {
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
    throw new RangeError('The trim range must end after it starts')
  }
  anim.ip = start
  anim.op = end
  if (opts.clipMarkers && anim.markers?.length) {
    const kept = anim.markers.filter(
      (m) => isNum(m.tm) && m.tm < end && m.tm + (isNum(m.dr) ? m.dr : 0) >= start,
    )
    for (const m of kept) {
      const from = Math.max(m.tm, start)
      const to = Math.min(m.tm + (isNum(m.dr) ? m.dr : 0), end)
      if (m.tm !== from) m.tm = from
      if (isNum(m.dr) && m.dr !== to - from) m.dr = roundTime(to - from)
    }
    if (kept.length !== anim.markers.length) anim.markers = kept
  }
  if (opts.shiftToZero && start !== 0) offsetTime(anim, -start)
}

/* -------------------------------------------------------------------------- */
/*                               Exact splitting                              */
/* -------------------------------------------------------------------------- */

const LINEAR_OUT: EasingHandle = { x: 0.167, y: 0.167 }
const LINEAR_IN: EasingHandle = { x: 0.833, y: 0.833 }

/**
 * Short span (frames) used where a value must reach one thing and then instantly be another,
 * which keyframes can only express with a zero-length segment (that some players divide by):
 * a mirrored interpolation arriving at a jump, the ping-pong turnaround, a frozen precomp
 * settling. Small enough to never contain a whole frame, large enough to survive keyframe
 * times rounded to 2 decimals.
 */
const MIRROR_GAP = 0.01

/**
 * Time remaps built here (ping-pong, frozen precomps) aim this far (frames) to the chosen side
 * of the exact content frame. Float error in the seconds they store (rounded to 1e-9 s, i.e.
 * ≤ 1.2e-7 frame up to 240 fps) could otherwise land a hair on the wrong side of a whole frame
 * and show the neighbouring frame of every layer or hold that switches there. Small enough
 * that the content itself is displaced by a negligible amount (1e-4 px at 100 px per frame).
 */
const REMAP_BIAS = 1e-6

/** Seconds of a content frame for a time remap (fine precision: see REMAP_BIAS). */
function remapSeconds(frame: number, fr: number): number {
  const r = Math.round((frame / fr) * 1e9) / 1e9
  return Object.is(r, -0) ? 0 : r
}

type Curve = [number, number, number, number]

interface CurveSplit {
  /** Eased progress (0..1, may overshoot) at the split point. */
  progress: number
  /** Easing of the left part, renormalized to 0..1 (null when it cannot be expressed). */
  left: Curve | null
}

/** Splits the easing curve cubic-bezier(x1, y1, x2, y2) at time fraction `u`. */
export function splitEasingCurve(curve: Curve, u: number): CurveSplit {
  const x1 = Math.min(1, Math.max(0, curve[0]))
  const x2 = Math.min(1, Math.max(0, curve[2]))
  const y1 = curve[1]
  const y2 = curve[3]
  // X(s) is monotonic for x1, x2 in [0, 1]: bisection is robust.
  const bx = (s: number) => 3 * (1 - s) * (1 - s) * s * x1 + 3 * (1 - s) * s * s * x2 + s * s * s
  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (bx(mid) < u) lo = mid
    else hi = mid
  }
  const s = (lo + hi) / 2
  const lerp = (a: number, b: number) => a + (b - a) * s
  const p01 = [lerp(0, x1), lerp(0, y1)]
  const p12 = [lerp(x1, x2), lerp(y1, y2)]
  const p23 = [lerp(x2, 1), lerp(y2, 1)]
  const p012 = [p01[0] + (p12[0] - p01[0]) * s, p01[1] + (p12[1] - p01[1]) * s]
  const p123 = [p12[0] + (p23[0] - p12[0]) * s, p12[1] + (p23[1] - p12[1]) * s]
  const end = [p012[0] + (p123[0] - p012[0]) * s, p012[1] + (p123[1] - p012[1]) * s]
  const progress = cubicBezier(x1, y1, x2, y2)(u)
  if (Math.abs(end[1]) < 1e-9 || end[0] < 1e-9) return { progress, left: null }
  return {
    progress,
    left: [p01[0] / end[0], p01[1] / end[1], p012[0] / end[0], p012[1] / end[1]],
  }
}

function curveOf(kf: Kf, dim: number): Curve {
  return [
    handleComponent(kf.o?.x, dim, 0),
    handleComponent(kf.o?.y, dim, 0),
    handleComponent(kf.i?.x, dim, 1),
    handleComponent(kf.i?.y, dim, 1),
  ]
}

function isPathValue(v: unknown): v is BezierPath {
  return (
    v !== null && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as BezierPath).v)
  )
}

function lerpNumbers(a: readonly number[], b: readonly number[], t: number): number[] {
  return a.map((v, i) => v + ((b[i] ?? v) - v) * t)
}

function lerpPathValue(a: BezierPath, b: BezierPath, t: number): BezierPath {
  const pts = (pa: number[][], pb: number[][]) => pa.map((p, i) => lerpNumbers(p, pb[i] ?? p, t))
  return { ...a, v: pts(a.v, b.v), i: pts(a.i, b.i), o: pts(a.o, b.o) }
}

function handleValue(like: number | number[] | undefined, values: number[]): number | number[] {
  return Array.isArray(like) ? values.map(roundValue) : roundValue(values[0])
}

/** Builds handles in the same scalar/array form as `like`. */
function handleLike(like: EasingHandle | undefined, xs: number[], ys: number[]): EasingHandle {
  return { x: handleValue(like?.x, xs), y: handleValue(like?.y, ys) }
}

/**
 * Splits the (non-hold) segment kf → next at time `t` without changing its motion: `kf` gets
 * the easing (and spatial tangents) of the left part and the returned keyframe holds the
 * exact value at `t`. Both keyframes must be plain objects.
 */
export function splitSegmentAt(kf: Kf, next: Kf, t: number): Kf {
  const duration = next.t - kf.t
  const u = duration > 0 ? (t - kf.t) / duration : 0
  const start = kf.s
  const end = next.s !== undefined ? next.s : kf.e
  const out: Kf = { t: roundTime(t) }

  const spatial =
    Array.isArray(kf.to) &&
    Array.isArray(kf.ti) &&
    Array.isArray(start) &&
    start.length >= 2 &&
    typeof start[0] === 'number'
  if (spatial) {
    const s0 = start as number[]
    const s3 = (end as number[] | undefined) ?? s0
    const split = splitEasingCurve(curveOf(kf, 0), u)
    // The evaluator caches arc lengths per keyframe object: measure on a throwaway copy, as
    // `kf` gets new tangents below and stays in the document.
    const located = spatialLocate({ ...kf } as Keyframe<number[]>, s0, s3, split.progress)
    const w = located.u
    const p1 = s0.map((v, d) => v + (kf.to?.[d] ?? 0))
    const p2 = s3.map((v, d) => v + (kf.ti?.[d] ?? 0))
    const lerp = (a: number[], b: number[]) => a.map((v, d) => v + ((b[d] ?? v) - v) * w)
    const p01 = lerp(s0, p1)
    const p12 = lerp(p1, p2)
    const p23 = lerp(p2, s3)
    const p012 = lerp(p01, p12)
    const mid = lerp(p012, lerp(p12, p23))
    out.s = mid.map(roundValue)
    kf.to = p01.map((v, d) => roundValue(v - s0[d]))
    kf.ti = p012.map((v, d) => roundValue(v - mid[d]))
    const left = split.left ?? [
      LINEAR_OUT.x as number,
      LINEAR_OUT.y as number,
      LINEAR_IN.x as number,
      LINEAR_IN.y as number,
    ]
    kf.o = handleLike(kf.o, [left[0]], [left[1]])
    kf.i = handleLike(kf.i, [left[2]], [left[3]])
    return out
  }

  if (Array.isArray(start) && isPathValue(start[0])) {
    const split = splitEasingCurve(curveOf(kf, 0), u)
    const b = Array.isArray(end) && isPathValue(end[0]) ? end[0] : start[0]
    out.s = [lerpPathValue(start[0], b, split.progress)]
    const left = split.left ?? [0.167, 0.167, 0.833, 0.833]
    kf.o = handleLike(kf.o, [left[0]], [left[1]])
    kf.i = handleLike(kf.i, [left[2]], [left[3]])
    return out
  }

  const a = Array.isArray(start) ? (start as number[]) : isNum(start) ? [start] : []
  const b = Array.isArray(end) ? (end as number[]) : isNum(end) ? [end] : a
  const perDimension =
    Array.isArray(kf.o?.x) ||
    Array.isArray(kf.o?.y) ||
    Array.isArray(kf.i?.x) ||
    Array.isArray(kf.i?.y)
  const dims = perDimension ? Math.max(1, a.length) : 1
  const splits = Array.from({ length: dims }, (_, d) => splitEasingCurve(curveOf(kf, d), u))
  out.s = a.map((v, d) => roundValue(v + ((b[d] ?? v) - v) * splits[perDimension ? d : 0].progress))
  const lefts = splits.map((s) => s.left ?? [0.167, 0.167, 0.833, 0.833])
  kf.o = handleLike(
    kf.o,
    lefts.map((l) => l[0]),
    lefts.map((l) => l[1]),
  )
  kf.i = handleLike(
    kf.i,
    lefts.map((l) => l[2]),
    lefts.map((l) => l[3]),
  )
  return out
}

/** Converts legacy keyframes (`e` end values) of a plain keyframe list to the modern form. */
function normalizeLegacy(kfs: Kf[]): void {
  if (!kfs.some((kf) => kf.e !== undefined)) return
  for (let i = 0; i < kfs.length; i++) {
    const kf = kfs[i]
    const next = kfs[i + 1]
    if (next && next.s === undefined && kf.e !== undefined) next.s = plainCopy(kf.e)
    delete kf.e
  }
}

/** Static form of a keyframe value: [n] → n, [path] → path, arrays stay arrays. */
function staticFormOf(value: unknown): unknown {
  if (Array.isArray(value) && value.length === 1 && (isNum(value[0]) || isPathValue(value[0])))
    return value[0]
  return value
}

/* -------------------------------------------------------------------------- */
/*                              Freeze after a time                           */
/* -------------------------------------------------------------------------- */

/**
 * Makes a property keep, from time `t` on, the value it had just before `t` (left limit),
 * without changing anything before `t`: the straddling segment is split exactly and later
 * keyframes are dropped. A property left with a single keyframe becomes static.
 */
export function freezeAfter(prop: AnyProperty, t: number): void {
  const original = getKeyframes(prop)
  if (!original || original.length === 0) return

  if (isTextDocumentKeyframes(original)) {
    // Text documents switch at their keyframes: keep those strictly before t (and the first).
    if (original.every((kf, i) => i === 0 || kf.t < t - TIME_EPSILON)) return
    prop.k = plainCopy(original.filter((kf, i) => i === 0 || kf.t < t - TIME_EPSILON))
    return
  }

  const kfs = plainCopy(original) as Kf[]
  normalizeLegacy(kfs)
  let last = -1
  for (let i = 0; i < kfs.length; i++) if (kfs[i].t < t - TIME_EPSILON) last = i
  if (last === kfs.length - 1) {
    if (original.some((kf) => kf.e !== undefined)) prop.k = kfs
    return
  }

  let out: Kf[]
  if (last === -1) {
    out = [kfs[0]]
  } else {
    const seg = kfs[last]
    const next = kfs[last + 1]
    if (seg.h === 1) out = kfs.slice(0, last + 1)
    else if (next.t <= t + TIME_EPSILON) out = kfs.slice(0, last + 2)
    else out = [...kfs.slice(0, last + 1), splitSegmentAt(seg, next, t)]
  }

  if (out.length === 1) {
    prop.k = staticFormOf(out[0].s)
    prop.a = 0
    return
  }
  prop.k = out
}

/* -------------------------------------------------------------------------- */
/*                                   Reverse                                  */
/* -------------------------------------------------------------------------- */

function flipHandleValue(v: number | number[]): number | number[] {
  return Array.isArray(v) ? v.map((x) => roundValue(1 - x)) : roundValue(1 - v)
}

function reflectHandle(h: EasingHandle | undefined, fallback: EasingHandle): EasingHandle {
  const src = h ?? fallback
  return { x: flipHandleValue(src.x), y: flipHandleValue(src.y) }
}

/** A keyframe's value and unknown fields, without timing/easing. */
function valueKey(kf: Kf, t: number): Kf {
  const out: Kf = { ...kf, t: roundTime(t) }
  // The same source keyframe can produce two keys (hold segments): never share values.
  if (kf.s !== undefined) out.s = plainCopy(kf.s)
  delete out.o
  delete out.i
  delete out.to
  delete out.ti
  delete out.h
  delete out.n
  delete out.e
  return out
}

/**
 * Mirrors a plain, modern keyframe list in time around `pivot`: the result at time t shows the
 * value the original had just BEFORE pivot − t (its left limit). The mirror of a step that is
 * right-continuous (as lottie evaluates keyframes) is right-continuous again, so continuous
 * motion plays exactly backwards and every jump keeps its exact mirrored time. For keys on whole
 * frames, the whole frames of frame-by-frame content come out in exact reverse order (frame g
 * shows frame pivot − 1 − g: the same convention as mirrored layer in/out points).
 * Easing curves are point-reflected (o ↔ i with 1 − x / 1 − y), spatial tangents swap (to ↔ ti),
 * and a hold of segment k becomes a hold starting at the mirrored END of the segment.
 */
export function mirrorKeyframes(kfs: readonly Kf[], pivot: number): Kf[] {
  const n = kfs.length
  if (n <= 1) return kfs.map((kf) => valueKey(kf, pivot - kf.t))
  const out: Kf[] = []
  // A hold (or the final key) repeating the value held just before it changes nothing.
  const push = (key: Kf, droppable: boolean) => {
    const prev = out[out.length - 1]
    if (droppable && prev?.h === 1 && jsonEqual(prev.s, key.s)) return
    out.push(key)
  }
  // Mirrored segments in playing order: segment j (kfs[j] → kfs[j + 1]) covers
  // [pivot − t(j + 1), pivot − t(j)).
  for (let j = n - 2; j >= 0; j--) {
    const seg = kfs[j]
    const end = kfs[j + 1]
    const t = pivot - end.t
    if (seg.h === 1) {
      // Just before t the value is still end.s, and at t it jumps to the held value.
      const prev = out[out.length - 1]
      if (prev?.h !== 1 && !jsonEqual(end.s, seg.s)) {
        if (prev) {
          // The interpolation before arrives at end.s exactly at t, where the key must already
          // hold the new value: it plays exactly up to a hair before t, then holds (a stacked key
          // pair would be exact but zero-length segments trip some players).
          const lead = Math.min(MIRROR_GAP, (t - prev.t) / 2)
          out.push({ ...splitSegmentAt(prev, { t, s: plainCopy(end.s) }, t - lead), h: 1 })
        } else {
          // Nothing before: a key has to set the value shown before the first jump.
          out.push({ ...valueKey(end, t - 1), h: 1 })
        }
      }
      push({ ...valueKey(seg, t), h: 1 }, true)
    } else {
      const key = valueKey(end, t)
      key.o = reflectHandle(seg.i, LINEAR_IN)
      key.i = reflectHandle(seg.o, LINEAR_OUT)
      if (Array.isArray(seg.to) && Array.isArray(seg.ti)) {
        key.to = [...seg.ti]
        key.ti = [...seg.to]
      }
      push(key, false)
    }
  }
  push(valueKey(kfs[0], pivot - kfs[0].t), true)
  return out
}

/** Text documents hold until the next keyframe: mirrored like holds (left limits). */
function mirrorTextKeyframes(kfs: readonly Kf[], pivot: number): Kf[] {
  const n = kfs.length
  if (n <= 1) return [...kfs]
  const last = kfs[n - 1]
  // Before the first mirrored switch the text is the one the original shows after its last key.
  const out: Kf[] = [{ ...last, t: roundTime(pivot - last.t - 1) }]
  for (let j = n - 2; j >= 0; j--) out.push({ ...kfs[j], t: roundTime(pivot - kfs[j + 1].t) })
  return out
}

function mirrorProperty(prop: AnyProperty, pivot: number): void {
  const original = getKeyframes(prop)
  if (!original || original.length === 0) return
  const kfs = plainCopy(original) as Kf[]
  if (isTextDocumentKeyframes(kfs)) {
    if (kfs.length > 1) prop.k = mirrorTextKeyframes(kfs, pivot)
    return
  }
  normalizeLegacy(kfs)
  prop.k = mirrorKeyframes(kfs, pivot)
}

/**
 * Mirror pivot of a precomp's content: maps the time span covered by its layers onto itself.
 */
function contentPivot(asset: PrecompAsset): number {
  let min = Infinity
  let max = -Infinity
  for (const layer of asset.layers ?? []) {
    if (isNum(layer.ip)) min = Math.min(min, layer.ip)
    if (isNum(layer.op)) max = Math.max(max, layer.op)
  }
  return Number.isFinite(min) && Number.isFinite(max) ? min + max : 0
}

function mirrorLayers(
  layers: Layer[],
  pivot: number,
  pivots: Map<string, number>,
  fr: number,
): void {
  for (const layer of layers) {
    const ip = layer.ip
    const op = layer.op
    if (isNum(ip) && isNum(op)) {
      // A lifetime [ip, op) becomes [pivot − op, pivot − ip): same duration, mirrored.
      layer.ip = roundTime(pivot - op)
      layer.op = roundTime(pivot - ip)
    }
    if (isPrecompLayer(layer)) {
      // The content is mirrored around P; inner' = P − inner(pivot − t') gives this st.
      const p = pivots.get(layer.refId) ?? 0
      const sr = layer.sr ? layer.sr : 1
      layer.st = roundTime(pivot - (isNum(layer.st) ? layer.st : 0) - p * sr)
      if (layer.tm) {
        mirrorProperty(layer.tm, pivot)
        mapRemapValues(layer.tm, (s) => roundValue(p / fr - s))
      }
    }
    walkLayerProperties(layer, (prop) => mirrorProperty(prop, pivot))
  }
}

/**
 * Reverses the animation in time: the last frame plays first. Keyframes are mirrored around
 * ip + op (so a loop keeps its loop point), easing and motion paths are reflected, layer
 * in/out points swap, markers are mirrored, and precomp contents are reversed in their own
 * time base with every instance's start time adjusted (no time remapping is added).
 */
export function reverseAnimation(anim: Animation): void {
  const pivot = anim.ip + anim.op
  const pivots = new Map<string, number>()
  for (const asset of precompAssets(anim)) pivots.set(asset.id, contentPivot(asset))
  mirrorLayers(anim.layers ?? [], pivot, pivots, anim.fr)
  for (const asset of precompAssets(anim))
    mirrorLayers(asset.layers ?? [], pivots.get(asset.id) ?? 0, pivots, anim.fr)
  forEachSlotProperty(anim, (prop) => mirrorProperty(prop, pivot))
  if (anim.markers?.length) {
    for (const marker of anim.markers) {
      const dr = isNum(marker.dr) ? marker.dr : 0
      if (isNum(marker.tm)) marker.tm = roundTime(pivot - marker.tm - dr)
    }
    anim.markers.sort((a, b) => a.tm - b.tm)
  }
}

/* -------------------------------------------------------------------------- */
/*                                Hold at end                                 */
/* -------------------------------------------------------------------------- */

/**
 * Whether a property may show, somewhere in [from, to), another value than just before `from`
 * (conservative: a key inside the window counts even if it repeats the value).
 */
function changesFrom(prop: AnyProperty, from: number, to: number): boolean {
  const kfs = getKeyframes(prop)
  if (!kfs || kfs.length < 2) return false
  const text = isTextDocumentKeyframes(kfs)
  for (let i = 0; i < kfs.length; i++) {
    const kf = kfs[i]
    const next = kfs[i + 1]
    if (kf.t > from + TIME_EPSILON && kf.t < to - TIME_EPSILON) return true
    if (!next) continue
    const hold = text || kf.h === 1
    // An interpolation still running at `from`.
    if (!hold && kf.t < from + TIME_EPSILON && next.t > from + TIME_EPSILON) return true
    // A jump exactly at `from`: the end of a hold, or keys stacked there.
    const stacked = Math.abs(next.t - kf.t) <= TIME_EPSILON
    if (Math.abs(next.t - from) <= TIME_EPSILON && (hold || stacked) && !jsonEqual(kf.s, next.s))
      return true
  }
  return false
}

function layerChangesFrom(layer: Layer, from: number, to: number): boolean {
  let found = false
  walkProperties(layer, (prop) => {
    if (!found && changesFrom(prop, from, to)) found = true
  })
  return found
}

/**
 * Does the content of a precomp show anything in its inner time range [from, to) that differs
 * from what it showed just before `from`? A layer starting or ending exactly at `from` counts:
 * the frozen picture is the one on screen just before.
 */
function contentChanges(
  anim: Animation,
  asset: PrecompAsset,
  from: number,
  to: number,
  depth: number,
): boolean {
  if (depth > 12) return true
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const inWindow = (t: number) => t > lo - TIME_EPSILON && t < hi - TIME_EPSILON
  const layers = asset.layers ?? []
  // Parents move their children even while they are out of their own in/out range.
  const parents = new Set(layers.map((l) => l.parent).filter(isNum))
  for (const layer of layers) {
    const ip = isNum(layer.ip) ? layer.ip : -Infinity
    const op = isNum(layer.op) ? layer.op : Infinity
    if (inWindow(ip) || inWindow(op)) return true
    // Not caught above: the layer covers the whole window, or none of it.
    const covers = ip <= lo && op >= hi
    if (!covers && !(isNum(layer.ind) && parents.has(layer.ind))) continue
    if (layerChangesFrom(layer, lo, hi)) return true
    if (covers && isPrecompLayer(layer) && !layer.tm) {
      // (A time remap was checked with the other properties: when steady, the content is too.)
      const child = precompAssets(anim).find((a) => a.id === layer.refId)
      const sr = layer.sr ? layer.sr : 1
      const st = isNum(layer.st) ? layer.st : 0
      if (child && contentChanges(anim, child, (lo - st) / sr, (hi - st) / sr, depth + 1))
        return true
    }
  }
  return false
}

export interface HoldResult {
  /** Frames added at the end. */
  frames: number
  /** Precomp layers that received a time remap to freeze their content. */
  remappedLayers: number
}

/**
 * Adds a pause at the end ("hold the last frame", a loop delay): the out point moves by
 * `seconds` and everything visible at the end stays frozen during the pause. Animation that
 * continued past the old out point (invisible until now) is cut at the end; precomps whose
 * content would keep moving get a time remap that holds their last frame.
 */
export function extendEnd(anim: Animation, seconds: number): HoldResult {
  assertPositive(seconds, 'Pause length')
  const frames = Math.max(1, Math.round(seconds * anim.fr))
  const end = anim.op
  const layers = anim.layers ?? []
  // Parents move their children even while they are out of their own in/out range.
  const parents = new Set(layers.map((l) => l.parent).filter(isNum))
  let remapped = 0
  for (const layer of layers) {
    if (!isNum(layer.ip) || !isNum(layer.op)) continue
    const isParent = isNum(layer.ind) && parents.has(layer.ind)
    const visibleAtEnd = layer.ip < end - TIME_EPSILON && layer.op >= end - TIME_EPSILON
    if (visibleAtEnd || isParent) walkProperties(layer, (prop) => freezeAfter(prop, end))
    if (layer.ip >= end - TIME_EPSILON) {
      // Never visible so far: keep it out of the pause (moving its animation along with it
      // unless it drives children, whose transforms must stay frozen).
      if (isParent) {
        layer.ip = roundTime(layer.ip + frames)
        layer.op = roundTime(layer.op + frames)
      } else {
        retimeLayer(layer, { scale: 1, offset: frames }, 1, null)
      }
      continue
    }
    if (!visibleAtEnd) continue
    layer.op = roundTime(layer.op + frames)
    if (!isPrecompLayer(layer)) continue
    if (layer.tm) {
      settleFrozenRemap(anim, layer, end)
    } else if (precompNeedsFreeze(anim, layer, end, frames)) {
      addFreezeRemap(layer, end, anim.fr)
      remapped++
    }
  }
  forEachSlotProperty(anim, (prop) => freezeAfter(prop, end))
  anim.op = roundTime(end + frames)
  return { frames, remappedLayers: remapped }
}

function precompNeedsFreeze(
  anim: Animation,
  layer: PrecompLayer,
  end: number,
  frames: number,
): boolean {
  const asset = precompAssets(anim).find((a) => a.id === layer.refId)
  if (!asset) return false
  const sr = layer.sr ? layer.sr : 1
  const st = isNum(layer.st) ? layer.st : 0
  return contentChanges(anim, asset, (end - st) / sr, (end + frames - st) / sr, 0)
}

const linearOut = (): EasingHandle => ({ x: [0.167], y: [0.167] })
const linearIn = (): EasingHandle => ({ x: [0.833], y: [0.833] })

/**
 * Time remap equivalent to the layer's st/sr up to `end`, then holding what was on screen just
 * before `end` (the content's left limit, like everything else frozen by the pause).
 */
function addFreezeRemap(layer: PrecompLayer, end: number, fr: number): void {
  const sr = layer.sr ? layer.sr : 1
  const st = isNum(layer.st) ? layer.st : 0
  const inner = (t: number) => (t - st) / sr
  const seconds = (frame: number) => remapSeconds(frame, fr)
  const start = Math.min(layer.ip, end - 1)
  // The ramp is biased past exact content frames; the last hair before `end` turns to the hold.
  const settle = Math.min(MIRROR_GAP, (end - start) / 2)
  const back = sr < 0 ? -1 : 1
  layer.tm = {
    a: 1,
    k: [
      {
        t: roundTime(start),
        s: [seconds(inner(start) + REMAP_BIAS)],
        o: linearOut(),
        i: linearIn(),
      },
      {
        t: roundTime(end - settle),
        s: [seconds(inner(end - settle) + REMAP_BIAS)],
        o: linearOut(),
        i: linearIn(),
      },
      { t: roundTime(end), s: [seconds(inner(end) - back * REMAP_BIAS)] },
    ],
  }
}

/**
 * A time remap frozen by the pause holds the content time reached at `end`. When that time
 * sits exactly on a content boundary (a layer ending there, a hold switching), the content
 * would show its next state during the pause: hold a hair before it instead, on the side the
 * remap came from.
 */
function settleFrozenRemap(anim: Animation, layer: PrecompLayer, end: number): void {
  const tm = layer.tm
  const asset = precompAssets(anim).find((a) => a.id === layer.refId)
  if (!tm || !asset) return
  const held = evaluateScalar(tm, end)
  const before = evaluateScalar(tm, end - 0.5)
  if (Math.abs(before - held) < 1e-9) return
  const frame = held * anim.fr
  if (!contentChanges(anim, asset, frame, frame + 0.001, 0)) return
  const nudged = remapSeconds(held * anim.fr + (before < held ? -1 : 1) * REMAP_BIAS, anim.fr)
  const kfs = getKeyframes(tm)
  if (!kfs) {
    tm.k = nudged
    return
  }
  const last = kfs[kfs.length - 1]
  kfs[kfs.length - 1] = { ...last, s: [nudged] }
}

/* -------------------------------------------------------------------------- */
/*                                  Ping-pong                                 */
/* -------------------------------------------------------------------------- */

export interface PingPongResult {
  /** Index of the precomp asset holding the original layers. */
  assetIndex: number
}

/**
 * Bakes a ping-pong loop: the animation plays forward, then backward (twice as long). The
 * root layers move into a precomp played through a triangular time remap, which is exact for
 * every feature (mattes, parenting, precomps, expressions reading `time`).
 *
 * The forward half shows exactly the original frames. The backward half is the original
 * mirrored around the old out point with the same convention as `reverseAnimation`: at time
 * t it shows what the original showed just BEFORE 2·op − t. Continuous motion therefore turns
 * around at the out point, and frame-by-frame content (holds, layers switching on whole
 * frames) plays its frames in reverse order: every drawing lasts as long on the way back,
 * the last one included (the turnaround shows the last frame, not an empty out point).
 */
export function pingPong(anim: Animation, opts: { name?: string } = {}): PingPongResult {
  const ip = anim.ip
  const op = anim.op
  const fr = anim.fr
  const { assetIndex, layer } = precomposeRoot(anim, { name: opts.name ?? 'Ping-pong' })
  // Content time is t on the way forward and 2·op − t on the way back: a hair after each
  // content frame forward, a hair before it backward (left limits). The switch between the two
  // happens within `gap` before the out point, where there is no whole frame.
  const start = roundTime(ip)
  const turn = roundTime(op - Math.min(MIRROR_GAP, (op - ip) / 2))
  const middle = roundTime(op)
  const end = roundTime(2 * op - ip)
  const forward = (t: number) => [remapSeconds(t + REMAP_BIAS, fr)]
  const backward = (t: number) => [remapSeconds(2 * op - t - REMAP_BIAS, fr)]
  const k: Keyframe<number[]>[] = [{ t: start, s: forward(start), o: linearOut(), i: linearIn() }]
  if (turn > start && turn < middle)
    k.push({ t: turn, s: forward(turn), o: linearOut(), i: linearIn() })
  k.push(
    { t: middle, s: backward(middle), o: linearOut(), i: linearIn() },
    { t: end, s: backward(end) },
  )
  layer.op = end
  layer.tm = { a: 1, k }
  anim.op = end
  return { assetIndex }
}
