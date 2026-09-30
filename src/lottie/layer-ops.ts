/**
 * Structural operations on layers and shape items: duplicate, delete, reorder, arrange, group,
 * rename, visibility, parenting and copy/paste.
 *
 * Every function MUTATES the animation it receives and is meant to run inside an immer recipe
 * (`updateDoc(label, (draft) => ...)`); plain objects work too. The operations keep documents
 * valid for every player:
 *  - `ind` stays unique per composition; `parent` and `tp` only reference layers of the same
 *    composition and never form cycles;
 *  - track mattes keep working. A matte target (`tt`) takes its matte from the layer whose
 *    `ind` equals its `tp`, or — in files without `tp` — from the layer directly above it.
 *    A source directly above its target forms a *block* that always moves as a unit, so
 *    position-based lookups (older players, lottie-web's canvas renderer) stay correct;
 *  - a group's transform (`tr`) stays its last item and is never moved, copied or deleted;
 *  - copied data is deep-cloned, never aliased.
 */
import { current, isDraft, original, type Draft } from 'immer'
import {
  intersectBoxes,
  invertMatrix,
  precompContentBounds,
  transformBox,
  worldMatrix,
} from './bounds'
import {
  compInfoAt,
  createGroupShape,
  createPrecompAsset,
  createPrecompLayer,
  uniqueAssetId,
} from './create'
import { nextLayerInd } from './layers'
import {
  compAssetIndexOf,
  compLayersPath as compLayersPathOf,
  compPathOf,
  getAt,
  isLayerPath,
  isPathPrefix,
  isShapePath,
  layerPathOf,
  pathEquals,
  pathKey,
  type NodePath,
} from './path'
import {
  evaluatePosition,
  evaluateScalar,
  evaluateVector,
  getKeyframes,
  isAnimated,
  isPropertyLike,
  type AnyProperty,
} from './property'
import { findAsset, findPrecomp, forEachLayer, listComps } from './traverse'
import type {
  Animation,
  Asset,
  EasingHandle,
  Font,
  GroupShape,
  Keyframe,
  Layer,
  NullLayer,
  PrecompLayer,
  ScalarProperty,
  ShapeItem,
  ShapeLayer,
  ShapeType,
  TextLayer,
  Transform,
  TransformShape,
} from './types'
import { changeFrameRate } from './timing'
import { isPrecompAsset, isPrecompLayer, isSplitPosition } from './types'

/* -------------------------------------------------------------------------- */
/*                                  Utilities                                 */
/* -------------------------------------------------------------------------- */

/** Plain snapshot of a (possibly draft) value: safe to read deeply and to clone. */
function snapshot<T>(value: T): T {
  return isDraft(value) ? (current(value as Draft<T>) as T) : value
}

/** Deep copy that never aliases document data (works on immer drafts). */
export function cloneNode<T>(value: T): T {
  return structuredClone(snapshot(value))
}

const lastIndex = (path: NodePath) => path[path.length - 1] as number

/** Orders paths in document order (numeric segments compare numerically). */
export function comparePaths(a: NodePath, b: NodePath): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i]
    const y = b[i]
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x) < String(y) ? -1 : 1
  }
  return a.length - b.length
}

function uniquePaths(paths: readonly NodePath[]): NodePath[] {
  const seen = new Set<string>()
  const out: NodePath[] = []
  for (const p of paths) {
    const key = pathKey(p)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(p)
    }
  }
  return out
}

/** Splits sorted indices into runs of consecutive values: [1,2,4] → [[1,2],[4]]. */
function toRuns(sorted: readonly number[]): number[][] {
  const runs: number[][] = []
  for (const i of sorted) {
    const run = runs[runs.length - 1]
    if (run && run[run.length - 1] === i - 1) run.push(i)
    else runs.push([i])
  }
  return runs
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Name for a copy: "Ball" → "Ball copy", then "Ball copy 2", "Ball copy 3", …
 * Copying a copy does not stack suffixes ("Ball copy" → "Ball copy 2").
 */
export function copyName(name: string, suffix: string, taken: ReadonlySet<string>): string {
  if (!suffix) return name
  const m = new RegExp(`^(.*)${escapeRegExp(suffix)}(?: \\d+)?$`).exec(name)
  const base = m ? m[1] : name
  const first = `${base}${suffix}`
  if (!taken.has(first)) return first
  for (let n = 2; ; n++) {
    const candidate = `${first} ${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/* -------------------------------------------------------------------------- */
/*                                Compositions                                */
/* -------------------------------------------------------------------------- */

/** Layers array at `compPath` (['layers'] or ['assets', i, 'layers']), or null. */
export function layersAt(anim: Animation, compPath: NodePath): Layer[] | null {
  const v = getAt<unknown>(anim, compPath)
  return Array.isArray(v) ? (v as Layer[]) : null
}

export interface CompSelection {
  compPath: NodePath
  /** Sorted, unique layer indices. */
  indices: number[]
}

/** Groups layer paths by composition (non-layer paths are ignored). */
export function groupLayersByComp(paths: readonly NodePath[]): CompSelection[] {
  const map = new Map<string, CompSelection>()
  for (const p of paths) {
    if (!isLayerPath(p)) continue
    const compPath = compPathOf(p)
    const key = pathKey(compPath)
    let entry = map.get(key)
    if (!entry) map.set(key, (entry = { compPath, indices: [] }))
    const i = lastIndex(p)
    if (!entry.indices.includes(i)) entry.indices.push(i)
  }
  for (const e of map.values()) e.indices.sort((a, b) => a - b)
  return [...map.values()]
}

/* -------------------------------------------------------------------------- */
/*                                Track mattes                                */
/* -------------------------------------------------------------------------- */

function indexByInd(layers: readonly Layer[]): Map<number, number> {
  const map = new Map<number, number>()
  layers.forEach((l, i) => {
    // lottie-web resolves an ind to the FIRST layer carrying it.
    if (typeof l?.ind === 'number' && !map.has(l.ind)) map.set(l.ind, i)
  })
  return map
}

/**
 * Index of the matte source of every layer (-1 when it has none), like lottie-web: the layer
 * whose `ind` equals `tp`, or the layer directly above when `tp` is absent.
 */
export function matteSources(layers: readonly Layer[]): number[] {
  let byInd: Map<number, number> | null = null
  return layers.map((layer, i) => {
    if (!layer?.tt) return -1
    if (layer.tp !== undefined) {
      if (typeof layer.tp !== 'number') return -1
      byInd ??= indexByInd(layers)
      return byInd.get(layer.tp) ?? -1
    }
    return i - 1
  })
}

/** Index of the matte source of `layers[index]`, or -1. */
export function matteSourceIndex(layers: readonly Layer[], index: number): number {
  return matteSources(layers)[index] ?? -1
}

/** Indices of the layers that use `layers[index]` as their track matte. */
export function matteTargetIndices(layers: readonly Layer[], index: number): number[] {
  const out: number[] = []
  matteSources(layers).forEach((s, j) => {
    if (s === index && j !== index) out.push(j)
  })
  return out
}

/**
 * Inclusive index ranges of layers that must stay together: a matte source directly above
 * its target (chains included). Every layer belongs to exactly one block.
 */
export function layerBlocks(layers: readonly Layer[]): Array<[number, number]> {
  const src = matteSources(layers)
  const blocks: Array<[number, number]> = []
  let start = 0
  for (let i = 1; i <= layers.length; i++) {
    if (i < layers.length && src[i] === i - 1) continue
    blocks.push([start, i - 1])
    start = i
  }
  return layers.length ? blocks : []
}

/** Moves an insertion index (0..length) out of the middle of a matte block, to the block's start. */
export function normalizeLayerInsertIndex(layers: readonly Layer[], index: number): number {
  const at = Math.max(0, Math.min(layers.length, Math.round(index)))
  for (const [s, e] of layerBlocks(layers)) if (s < at && at <= e) return s
  return at
}

/** Expands indices to whole matte blocks. */
function expandToBlocks(layers: readonly Layer[], indices: Iterable<number>): Set<number> {
  const wanted = new Set([...indices].filter((i) => i >= 0 && i < layers.length))
  const out = new Set<number>()
  for (const [s, e] of layerBlocks(layers)) {
    let hit = false
    for (let i = s; i <= e && !hit; i++) hit = wanted.has(i)
    if (hit) for (let i = s; i <= e; i++) out.add(i)
  }
  return out
}

/* -------------------------------------------------------------------------- */
/*                        Keeping children in place                           */
/* -------------------------------------------------------------------------- */

/**
 * 2D similarity x ↦ k·R(θ)·x + t: uniform scale k > 0 and a rotation θ in degrees, clockwise
 * on screen like Lottie's `r`. Parent chains made of such transforms (the usual nulls that move,
 * rotate and scale uniformly) can be folded into a child's own transform exactly.
 */
interface Similarity {
  k: number
  theta: number
  tx: number
  ty: number
}

const EPS = 1e-6
const IDENTITY: Similarity = { k: 1, theta: 0, tx: 0, ty: 0 }

const round3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? 0 : r
}

/** Rotates (x, y) by `theta` degrees the way lottie-web applies a layer's rotation. */
function rotate(theta: number, x: number, y: number): [number, number] {
  if (Math.abs(theta) < EPS) return [x, y]
  const rad = (theta * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return [x * c - y * s, x * s + y * c]
}

/** Angle in (-180, 180] (the same rotation as `theta`). */
function wrapAngle(theta: number): number {
  const t = ((((theta + 180) % 360) + 360) % 360) - 180
  return t === -180 ? 180 : t
}

/** `outer ∘ inner`: applies `inner` first. */
function compose(outer: Similarity, inner: Similarity): Similarity {
  const [x, y] = rotate(outer.theta, inner.tx, inner.ty)
  return {
    k: outer.k * inner.k,
    theta: wrapAngle(outer.theta + inner.theta),
    tx: outer.k * x + outer.tx,
    ty: outer.k * y + outer.ty,
  }
}

/** The similarity that undoes `m` (k > 0 for every similarity built here). */
function invertSimilarity(m: Similarity): Similarity {
  const k = 1 / m.k
  const [x, y] = rotate(-m.theta, m.tx, m.ty)
  return { k, theta: wrapAngle(-m.theta), tx: -k * x, ty: -k * y }
}

/** True for 3D transforms (the editor only folds 2D parent chains). */
function is3d(layer: Layer): boolean {
  const ks: Transform = layer.ks ?? {}
  return layer.ddd === 1 || !!ks.rx || !!ks.ry || !!ks.or
}

/**
 * A layer's own transform at `frame` (its space → its parent's space) as a similarity, or null
 * when it skews, scales non-uniformly or is 3D. lottie-web applies −anchor, scale, skew,
 * rotation, then position: W(x) = p + s·R(r)·(x − a).
 */
function layerSimilarity(layer: Layer, frame: number): Similarity | null {
  const ks: Transform = layer.ks ?? {}
  if (is3d(layer) || Math.abs(evaluateScalar(ks.sk, frame)) > EPS) return null
  const s = evaluateVector(ks.s, frame, [100, 100])
  const sx = (s[0] ?? 100) / 100
  const sy = (s[1] ?? s[0] ?? 100) / 100
  if (Math.abs(sx - sy) > EPS || Math.abs(sx) < EPS) return null
  // A negative uniform scale is a half turn: k·R(θ) = |k|·R(θ + 180).
  const k = Math.abs(sx)
  const theta = wrapAngle(evaluateScalar(ks.r, frame) + (sx < 0 ? 180 : 0))
  const p = evaluatePosition(ks.p, frame)
  const a = evaluateVector(ks.a, frame, [0, 0])
  const [ax, ay] = rotate(theta, a[0] ?? 0, a[1] ?? 0)
  return { k, theta, tx: (p[0] ?? 0) - k * ax, ty: (p[1] ?? 0) - k * ay }
}

/** Combined transform of a parent chain (direct parent first), or null when it is not foldable. */
function chainSimilarity(chain: readonly Layer[], frame: number): Similarity | null {
  let m = IDENTITY
  for (const layer of chain) {
    const s = layerSimilarity(layer, frame)
    if (!s) return null
    m = compose(s, m)
  }
  return m
}

type NumberMap = (v: number[]) => number[]

const isNumbers = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === 'number')

/** Maps the numbers of a static or animated property in place (values and legacy end values). */
function mapPropertyNumbers(prop: AnyProperty, values: NumberMap, tangents?: NumberMap): void {
  const kfs = getKeyframes<unknown>(prop)
  if (!kfs) {
    if (typeof prop.k === 'number') prop.k = values([prop.k])[0]
    else if (isNumbers(prop.k)) prop.k = values([...prop.k])
    return
  }
  for (const kf of kfs) {
    for (const key of ['s', 'e'] as const) {
      const v = kf[key]
      if (typeof v === 'number') kf[key] = values([v])[0]
      else if (isNumbers(v)) kf[key] = values([...v])
    }
    if (tangents && isNumbers(kf.ti)) kf.ti = tangents([...kf.ti])
    if (tangents && isNumbers(kf.to)) kf.to = tangents([...kf.to])
  }
}

/**
 * Folds the similarity `m` into a layer's own transform, so that the layer without the parents
 * `m` stands for renders exactly where it did with them: position ↦ m(position) (spatial
 * tangents rotate and scale), rotation + θ, scale × k. Returns false (changing nothing) when the
 * transform cannot absorb it: 3D layers, or separated position dimensions animated under a
 * rotation that mixes x and y.
 */
function foldIntoTransform(layer: Layer, m: Similarity): boolean {
  if (is3d(layer)) return false
  const identity =
    Math.abs(m.k - 1) < EPS &&
    Math.abs(m.theta) < EPS &&
    Math.abs(m.tx) < EPS &&
    Math.abs(m.ty) < EPS
  if (identity) return true
  if (!layer.ks) layer.ks = {}
  const ks = layer.ks
  const p = ks.p
  const halfTurns = Math.abs(m.theta) < EPS || Math.abs(Math.abs(m.theta) - 180) < EPS
  if (isSplitPosition(p) && !halfTurns && (isAnimated(p.x) || isAnimated(p.y))) return false

  const linear: NumberMap = (v) => {
    const [x, y] = rotate(m.theta, v[0] ?? 0, v[1] ?? 0)
    const out = [...v]
    out[0] = round3(m.k * x)
    out[1] = round3(m.k * y)
    return out
  }
  const point: NumberMap = (v) => {
    const [x, y] = rotate(m.theta, v[0] ?? 0, v[1] ?? 0)
    const out = [...v]
    out[0] = round3(m.k * x + m.tx)
    out[1] = round3(m.k * y + m.ty)
    return out
  }
  const positionAnimated = isSplitPosition(p) ? isAnimated(p.x) || isAnimated(p.y) : isAnimated(p)

  if (!p) {
    ks.p = { a: 0, k: [round3(m.tx), round3(m.ty), 0] }
  } else if (isSplitPosition(p)) {
    if (halfTurns) {
      // θ is 0 or 180°: each axis maps on its own (x ↦ ±k·x + tx).
      const c = Math.abs(m.theta) < EPS ? m.k : -m.k
      mapPropertyNumbers(p.x, (v) => [round3(c * (v[0] ?? 0) + m.tx)])
      mapPropertyNumbers(p.y, (v) => [round3(c * (v[0] ?? 0) + m.ty)])
    } else {
      const [x, y] = point([evaluateScalar(p.x, 0), evaluateScalar(p.y, 0)])
      p.x.k = x
      p.y.k = y
    }
  } else {
    mapPropertyNumbers(p, point, linear)
  }

  // Auto-orient derives the angle from the motion path, which already turned by θ.
  if (Math.abs(m.theta) > EPS && !(layer.ao === 1 && positionAnimated)) {
    if (!ks.r) ks.r = { a: 0, k: 0 }
    mapPropertyNumbers(ks.r, (v) => [round3((v[0] ?? 0) + m.theta)])
  }
  if (Math.abs(m.k - 1) > EPS) {
    if (!ks.s) ks.s = { a: 0, k: [100, 100, 100] }
    mapPropertyNumbers(ks.s, (v) => v.map((n, i) => (i < 2 ? round3(n * m.k) : n)))
  }
  return true
}

/* -------------------------------------------------------------------------- */
/*                                   Layers                                   */
/* -------------------------------------------------------------------------- */

export interface DuplicateOptions {
  /** Appended to the names of copies (localized, e.g. " copy"). Unnamed layers stay unnamed. */
  suffix?: string
}

/**
 * Duplicates layers. Copies are deep clones inserted directly above their originals, with new
 * unique `ind`s; `parent` and `tp` links between duplicated layers point to the copies. Matte
 * blocks are duplicated whole so every copied target has its own copied source.
 *
 * @returns paths of the copies of the requested layers, in the order of `paths`.
 */
export function duplicateLayers(
  anim: Animation,
  paths: readonly NodePath[],
  opts: DuplicateOptions = {},
): NodePath[] {
  const suffix = opts.suffix ?? ' copy'
  const result = new Map<string, NodePath>()
  for (const { compPath, indices } of groupLayersByComp(paths)) {
    const layers = layersAt(anim, compPath)
    if (!layers) continue
    const all = [...expandToBlocks(layers, indices)].sort((a, b) => a - b)
    if (!all.length) continue

    // New inds in document order: a source directly above its target keeps `ind - 1`, which
    // lottie-web's canvas renderer uses to find mattes in files without `tp`.
    let next = nextLayerInd(layers)
    const newInd = new Map<number, number>()
    const indMap = new Map<number, number>()
    for (const i of all) {
      newInd.set(i, next)
      const old = layers[i].ind
      if (typeof old === 'number' && !indMap.has(old)) indMap.set(old, next)
      next++
    }

    const taken = new Set(layers.map((l) => l.nm).filter((n): n is string => typeof n === 'string'))
    const copies = new Map<number, Layer>()
    for (const i of all) {
      const copy = cloneNode(layers[i])
      copy.ind = newInd.get(i)
      if (typeof copy.parent === 'number' && indMap.has(copy.parent))
        copy.parent = indMap.get(copy.parent)
      if (typeof copy.tp === 'number' && indMap.has(copy.tp)) copy.tp = indMap.get(copy.tp)
      if (typeof copy.nm === 'string') {
        copy.nm = copyName(copy.nm, suffix, taken)
        taken.add(copy.nm)
      }
      copies.set(i, copy)
    }

    // Insert each run of copies above its run of originals (last run first keeps indices valid).
    const runs = toRuns(all)
    for (let r = runs.length - 1; r >= 0; r--) {
      layers.splice(runs[r][0], 0, ...runs[r].map((i) => copies.get(i)!))
    }
    // Copies of a run starting at s land at s + (copies inserted by earlier runs).
    let shift = 0
    const copyIndex = new Map<number, number>()
    for (const run of runs) {
      for (const i of run) copyIndex.set(i, i + shift)
      shift += run.length
    }
    for (const i of indices) {
      if (copyIndex.has(i)) result.set(pathKey([...compPath, i]), [...compPath, copyIndex.get(i)!])
    }
  }
  return paths.map((p) => result.get(pathKey(p))).filter((p): p is NodePath => !!p)
}

export interface DeleteOptions {
  /**
   * Children of deleted layers move up to their nearest remaining ancestor and keep their place
   * on screen: the deleted parents' transforms are folded into theirs (default true). Without
   * it, children simply lose the link to a deleted parent.
   */
  keepChildrenInPlace?: boolean
  /**
   * Time (frames of the composition at `compPath`) at which ANIMATED transforms of deleted
   * parents are folded, like After Effects does at the current time. Static parents are folded
   * exactly at every time. Default 0.
   */
  frameOf?: (compPath: NodePath) => number
}

/**
 * Deletes layers.
 *  - Children of a deleted layer are re-linked to its nearest remaining ancestor (or unlinked)
 *    and keep their place on screen when the deleted chain moves, rotates and scales uniformly
 *    in 2D (see `DeleteOptions`); otherwise they only lose the link.
 *  - Layers matted by a deleted source lose their matte (`tt`/`tp`).
 *  - A matte source is deleted together with its target when no remaining layer uses it
 *    (an unused `td` layer is invisible and would silently matte whatever moves below it).
 *
 * @returns the (pre-deletion) paths of every removed layer, in document order.
 */
export function deleteLayers(
  anim: Animation,
  paths: readonly NodePath[],
  opts: DeleteOptions = {},
): NodePath[] {
  const removed: NodePath[] = []
  for (const { compPath, indices } of groupLayersByComp(paths)) {
    const layers = layersAt(anim, compPath)
    if (!layers) continue
    const src = matteSources(layers)
    const del = new Set(indices.filter((i) => i >= 0 && i < layers.length))
    if (!del.size) continue

    let grew = true
    while (grew) {
      grew = false
      for (const t of Array.from(del)) {
        const s = src[t]
        if (s < 0 || del.has(s) || !layers[s].td) continue
        if (!src.some((ss, j) => ss === s && !del.has(j))) {
          del.add(s)
          grew = true
        }
      }
    }

    const removedInds = new Set<number>()
    const remainingInds = new Set<number>()
    layers.forEach((l, i) => {
      if (typeof l.ind !== 'number') return
      if (del.has(i)) removedInds.add(l.ind)
      else remainingInds.add(l.ind)
    })
    const dangling = (ind: unknown) =>
      typeof ind === 'number' && removedInds.has(ind) && !remainingInds.has(ind)
    const byInd = indexByInd(layers)
    const keep = opts.keepChildrenInPlace !== false
    const frame = keep ? (opts.frameOf?.(compPath) ?? 0) : 0

    // Parents are resolved on the untouched layers first: children may be parents themselves.
    const relinks: Array<{ layer: Layer; parent: number | undefined; chain: Layer[] }> = []
    layers.forEach((layer, j) => {
      if (del.has(j) || !dangling(layer.parent)) return
      const chain: Layer[] = []
      const seen = new Set<number>()
      let ind: unknown = layer.parent
      while (dangling(ind)) {
        const i = byInd.get(ind as number)
        if (i === undefined || seen.has(i)) break
        seen.add(i)
        chain.push(layers[i])
        ind = layers[i].parent
      }
      const parent = keep && typeof ind === 'number' && remainingInds.has(ind) ? ind : undefined
      relinks.push({ layer, parent, chain })
    })
    for (const { layer, parent, chain } of relinks) {
      const m = keep
        ? chainSimilarity(
            chain.map((l) => snapshot(l)),
            frame,
          )
        : null
      if (m) foldIntoTransform(layer, m)
      if (parent === undefined) delete layer.parent
      else layer.parent = parent
    }

    layers.forEach((layer, j) => {
      if (del.has(j)) return
      if (layer.tt && src[j] >= 0 && del.has(src[j])) {
        delete layer.tt
        delete layer.tp
      } else if (layer.tp !== undefined && dangling(layer.tp)) {
        delete layer.tp
      }
    })

    const sorted = [...del].sort((a, b) => a - b)
    for (let k = sorted.length - 1; k >= 0; k--) layers.splice(sorted[k], 1)
    for (const i of sorted) removed.push([...compPath, i])
  }
  return removed
}

/** Rewrites a layers array in place to `next` (same items, new order), touching changed slots only. */
function reorderInPlace<T>(arr: T[], next: readonly T[]): void {
  for (let i = 0; i < next.length; i++) if (arr[i] !== next[i]) arr[i] = next[i]
}

/**
 * Moves layers within their composition. `toIndex` is an insertion index in the current order
 * (0 = top, length = bottom); drops inside a matte block snap to the block's start, and whole
 * blocks move together.
 *
 * @returns new paths of the requested layers (in the order of `fromIndices`).
 */
export function moveLayers(
  anim: Animation,
  compPath: NodePath,
  fromIndices: readonly number[],
  toIndex: number,
): NodePath[] {
  const layers = layersAt(anim, compPath)
  if (!layers) return []
  const moving = [...expandToBlocks(layers, fromIndices)].sort((a, b) => a - b)
  if (!moving.length) return []
  const target = normalizeLayerInsertIndex(layers, toIndex)
  const movingSet = new Set(moving)
  let pos = 0
  for (let i = 0; i < target; i++) if (!movingSet.has(i)) pos++
  const rest = layers.filter((_, i) => !movingSet.has(i))
  const moved = moving.map((i) => layers[i])
  reorderInPlace(layers, [...rest.slice(0, pos), ...moved, ...rest.slice(pos)])
  const newIndex = new Map(moving.map((i, k) => [i, pos + k]))
  return fromIndices.filter((i) => newIndex.has(i)).map((i) => [...compPath, newIndex.get(i)!])
}

export type ArrangeMode = 'front' | 'forward' | 'backward' | 'back'

/** New order of units (blocks) for an arrange operation; `selected[u]` marks moving units. */
function arrangeOrder(selected: readonly boolean[], mode: ArrangeMode): number[] {
  const order = selected.map((_, u) => u)
  const sel = (k: number) => selected[order[k]]
  const swap = (a: number, b: number) => ([order[a], order[b]] = [order[b], order[a]])
  switch (mode) {
    case 'front':
      return [...order.filter((u) => selected[u]), ...order.filter((u) => !selected[u])]
    case 'back':
      return [...order.filter((u) => !selected[u]), ...order.filter((u) => selected[u])]
    case 'forward':
      for (let k = 1; k < order.length; k++) if (sel(k) && !sel(k - 1)) swap(k - 1, k)
      return order
    case 'backward':
      for (let k = order.length - 2; k >= 0; k--) if (sel(k) && !sel(k + 1)) swap(k, k + 1)
      return order
  }
}

/**
 * Changes the stacking order of layers (per composition), like After Effects' Arrange:
 * front/back move the selection to the top/bottom, forward/backward by one position.
 * Matte blocks move as units.
 *
 * @returns new paths of the requested layers.
 */
export function arrangeLayers(
  anim: Animation,
  paths: readonly NodePath[],
  mode: ArrangeMode,
): NodePath[] {
  const out: NodePath[] = []
  for (const { compPath, indices } of groupLayersByComp(paths)) {
    const layers = layersAt(anim, compPath)
    if (!layers) continue
    const blocks = layerBlocks(layers)
    const wanted = new Set(indices)
    const selected = blocks.map(([s, e]) => {
      for (let i = s; i <= e; i++) if (wanted.has(i)) return true
      return false
    })
    const order = arrangeOrder(selected, mode)
    const newIndex = new Map<number, number>()
    const next: Layer[] = []
    for (const b of order) {
      for (let i = blocks[b][0]; i <= blocks[b][1]; i++) {
        newIndex.set(i, next.length)
        next.push(layers[i])
      }
    }
    reorderInPlace(layers, next)
    for (const i of indices) if (newIndex.has(i)) out.push([...compPath, newIndex.get(i)!])
  }
  return out
}

export const bringToFront = (anim: Animation, paths: readonly NodePath[]) =>
  arrangeLayers(anim, paths, 'front')
export const bringForward = (anim: Animation, paths: readonly NodePath[]) =>
  arrangeLayers(anim, paths, 'forward')
export const sendBackward = (anim: Animation, paths: readonly NodePath[]) =>
  arrangeLayers(anim, paths, 'backward')
export const sendToBack = (anim: Animation, paths: readonly NodePath[]) =>
  arrangeLayers(anim, paths, 'back')

/**
 * Inserts layers into a composition at `index` (moved out of matte blocks), as-is (callers
 * provide unique `ind`s). Returns their paths.
 */
export function insertLayers(
  anim: Animation,
  compPath: NodePath,
  newLayers: readonly Layer[],
  index: number,
): NodePath[] {
  const layers = layersAt(anim, compPath)
  if (!layers || !newLayers.length) return []
  const at = normalizeLayerInsertIndex(layers, index)
  layers.splice(at, 0, ...newLayers)
  return newLayers.map((_, k) => [...compPath, at + k])
}

/* ------------------------------ Parenting ---------------------------------- */

/**
 * True if `layers[childIndex]` may be parented to the layer with `parentInd` (null = no
 * parent): the parent exists in the same composition, is not the layer itself and is not one
 * of its descendants.
 */
export function canSetParent(
  layers: readonly Layer[],
  childIndex: number,
  parentInd: number | null,
): boolean {
  if (!layers[childIndex]) return false
  if (parentInd === null) return true
  const byInd = indexByInd(layers)
  let cursor = byInd.get(parentInd)
  if (cursor === undefined || cursor === childIndex) return false
  const seen = new Set<number>()
  while (cursor !== undefined && !seen.has(cursor)) {
    if (cursor === childIndex) return false
    seen.add(cursor)
    const parent: unknown = layers[cursor].parent
    cursor = typeof parent === 'number' ? byInd.get(parent) : undefined
  }
  return true
}

/** Parent chain of a layer starting at the layer with `ind` (direct parent first). */
function chainFrom(layers: readonly Layer[], ind: unknown): Layer[] {
  const byInd = indexByInd(layers)
  const chain: Layer[] = []
  const seen = new Set<number>()
  let cursor = typeof ind === 'number' ? byInd.get(ind) : undefined
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    chain.push(layers[cursor])
    const next: unknown = layers[cursor].parent
    cursor = typeof next === 'number' ? byInd.get(next) : undefined
  }
  return chain
}

export interface SetParentOptions {
  /**
   * Keep the layer where it is on screen (After Effects): the change of parent space is folded
   * into its own transform, exactly when both parent chains move, rotate and scale uniformly in
   * 2D. Otherwise (skew, non-uniform scale, 3D) the layer simply follows its new parent.
   */
  keepInPlace?: boolean
  /** Frame (time of the layer's composition) at which ANIMATED parents are matched. Default 0. */
  frame?: number
}

/** Sets (or clears with null) the parent of a layer. Returns false when invalid or unchanged. */
export function setParent(
  anim: Animation,
  layerPath: NodePath,
  parentInd: number | null,
  opts: SetParentOptions = {},
): boolean {
  if (!isLayerPath(layerPath)) return false
  const layers = layersAt(anim, compPathOf(layerPath))
  const i = lastIndex(layerPath)
  if (!layers?.[i] || !canSetParent(layers, i, parentInd)) return false
  const layer = layers[i]
  if ((layer.parent ?? null) === parentInd) return false
  if (opts.keepInPlace) {
    const frame = opts.frame ?? 0
    const before = chainSimilarity(chainFrom(layers, layer.parent).map(snapshot), frame)
    const after = chainSimilarity(chainFrom(layers, parentInd).map(snapshot), frame)
    // Screen = after ∘ own' must equal before ∘ own: own' = after⁻¹ ∘ before ∘ own.
    if (before && after) foldIntoTransform(layer, compose(invertSimilarity(after), before))
  }
  if (parentInd === null) delete layer.parent
  else layer.parent = parentInd
  return true
}

/* ------------------------------ Naming / visibility ------------------------ */

/** Renames a layer or shape item. Empty names are rejected (returns false). */
export function renameNode(anim: Animation, path: NodePath, name: string): boolean {
  const node = getAt<{ nm?: string }>(anim, path)
  const trimmed = name.trim()
  if (!node || typeof node !== 'object' || !trimmed || node.nm === trimmed) return false
  node.nm = trimmed
  return true
}

/**
 * Hides or shows layers and shape items (`hd`). Showing removes the key from layers (where
 * bodymovin omits it) and writes `false` on shape items (where it always writes it).
 * Group transforms are skipped. Returns the number of nodes changed.
 */
export function setHidden(anim: Animation, paths: readonly NodePath[], hidden: boolean): number {
  let changed = 0
  for (const p of uniquePaths(paths)) {
    const layer = isLayerPath(p)
    if (!layer && !isShapePath(p)) continue
    const node = getAt<{ hd?: boolean; ty?: unknown }>(anim, p)
    if (!node || typeof node !== 'object' || node.ty === 'tr') continue
    if (hidden) {
      if (node.hd === true) continue
      node.hd = true
    } else {
      if (!node.hd) continue
      if (layer) delete node.hd
      else node.hd = false
    }
    changed++
  }
  return changed
}

/* -------------------------------------------------------------------------- */
/*                                Shape items                                 */
/* -------------------------------------------------------------------------- */

const SHAPE_GEOMETRY = new Set<ShapeType>(['gr', 'sh', 'rc', 'el', 'sr'])
const SHAPE_STYLES = new Set<ShapeType>(['fl', 'st', 'gf', 'gs'])

/** True if the shape item draws geometry (paths or groups). */
export function isGeometryShape(item: Pick<ShapeItem, 'ty'>): boolean {
  return SHAPE_GEOMETRY.has(item.ty)
}

/** True if the shape item is a style (fill/stroke/gradient). */
export function isStyleShape(item: Pick<ShapeItem, 'ty'>): boolean {
  return SHAPE_STYLES.has(item.ty)
}

function shapeArrayAt(anim: Animation, arrayPath: NodePath): ShapeItem[] | null {
  const v = getAt<unknown>(anim, arrayPath)
  return Array.isArray(v) ? (v as ShapeItem[]) : null
}

/** Index before which nothing may be inserted in a shape array (a group's trailing transform). */
function shapeInsertLimit(items: readonly ShapeItem[]): number {
  return items.length > 0 && items[items.length - 1]?.ty === 'tr' ? items.length - 1 : items.length
}

/** Keeps a group's `np` (item count without the transform) in sync when bodymovin wrote it. */
function syncGroupCount(anim: Animation, arrayPath: NodePath): void {
  if (arrayPath[arrayPath.length - 1] !== 'it') return
  const group = getAt<GroupShape>(anim, arrayPath.slice(0, -1))
  if (group && group.ty === 'gr' && group.np !== undefined && Array.isArray(group.it)) {
    const count = group.it.filter((i) => i.ty !== 'tr').length
    if (group.np !== count) group.np = count
  }
}

/**
 * Shape paths that can be edited as a unit: existing items (not group transforms), without
 * duplicates and without descendants of other selected items, in document order.
 */
export function shapeTargets(anim: Animation, paths: readonly NodePath[]): NodePath[] {
  const valid = uniquePaths(paths).filter((p) => {
    if (!isShapePath(p)) return false
    const item = getAt<ShapeItem>(anim, p)
    return !!item && typeof item === 'object' && item.ty !== 'tr'
  })
  valid.sort(comparePaths)
  return valid.filter((p) => !valid.some((q) => q.length < p.length && isPathPrefix(q, p)))
}

/** Path of a shape array (layer `shapes` or a group's `it`) found by identity inside a layer. */
function locateArray(anim: Animation, layerPath: NodePath, target: unknown): NodePath | null {
  const layer = getAt<ShapeLayer>(anim, layerPath)
  if (!layer || !Array.isArray(layer.shapes)) return null
  if (layer.shapes === target) return [...layerPath, 'shapes']
  let found: NodePath | null = null
  const walk = (items: ShapeItem[], base: NodePath) => {
    for (let i = 0; i < items.length && !found; i++) {
      const item = items[i]
      if (item?.ty !== 'gr' || !Array.isArray(item.it)) continue
      if (item.it === target) found = [...base, i, 'it']
      else walk(item.it, [...base, i, 'it'])
    }
  }
  walk(layer.shapes, [...layerPath, 'shapes'])
  return found
}

/** Path of a shape item found by identity inside a layer. */
function locateShape(anim: Animation, layerPath: NodePath, target: unknown): NodePath | null {
  const layer = getAt<ShapeLayer>(anim, layerPath)
  if (!layer || !Array.isArray(layer.shapes)) return null
  let found: NodePath | null = null
  const walk = (items: ShapeItem[], base: NodePath) => {
    for (let i = 0; i < items.length && !found; i++) {
      const item = items[i]
      if (item === target) found = [...base, i]
      else if (item?.ty === 'gr' && Array.isArray(item.it)) walk(item.it, [...base, i, 'it'])
    }
  }
  walk(layer.shapes, [...layerPath, 'shapes'])
  return found
}

function groupByArray(
  paths: readonly NodePath[],
): Array<{ arrayPath: NodePath; indices: number[] }> {
  const map = new Map<string, { arrayPath: NodePath; indices: number[] }>()
  for (const p of paths) {
    const arrayPath = p.slice(0, -1)
    const key = pathKey(arrayPath)
    let entry = map.get(key)
    if (!entry) map.set(key, (entry = { arrayPath, indices: [] }))
    entry.indices.push(lastIndex(p))
  }
  for (const e of map.values()) e.indices.sort((a, b) => a - b)
  return [...map.values()]
}

/**
 * Duplicates shape items; each copy is inserted directly above its original.
 * @returns paths of the copies, in document order of the originals.
 */
export function duplicateShapes(
  anim: Animation,
  paths: readonly NodePath[],
  opts: DuplicateOptions = {},
): NodePath[] {
  const suffix = opts.suffix ?? ' copy'
  const targets = shapeTargets(anim, paths)
  const copies: Array<{ layerPath: NodePath; ref: ShapeItem }> = []
  // Inner arrays first: inserting into an outer array would shift the paths of inner ones.
  const groups = groupByArray(targets).sort((a, b) => comparePaths(b.arrayPath, a.arrayPath))
  for (const { arrayPath, indices } of groups) {
    const arr = shapeArrayAt(anim, arrayPath)
    const layerPath = layerPathOf(arrayPath)
    if (!arr || !layerPath) continue
    const taken = new Set(arr.map((s) => s.nm).filter((n): n is string => typeof n === 'string'))
    const made = new Map<number, ShapeItem>()
    const runs = toRuns(indices)
    for (let r = runs.length - 1; r >= 0; r--) {
      const clones = runs[r].map((i) => {
        const copy = cloneNode(arr[i])
        if (typeof copy.nm === 'string') {
          copy.nm = copyName(copy.nm, suffix, taken)
          taken.add(copy.nm)
        }
        made.set(i, copy)
        return copy
      })
      arr.splice(runs[r][0], 0, ...clones)
    }
    syncGroupCount(anim, arrayPath)
    for (const i of indices) copies.push({ layerPath, ref: made.get(i)! })
  }
  return copies
    .map((c) => locateShape(anim, c.layerPath, c.ref))
    .filter((p): p is NodePath => !!p)
    .sort(comparePaths)
}

/**
 * Deletes shape items (never a group's transform).
 * @returns the (pre-deletion) paths of the removed items, in document order.
 */
export function deleteShapes(anim: Animation, paths: readonly NodePath[]): NodePath[] {
  const targets = shapeTargets(anim, paths)
  // Reverse document order: removing later items never shifts the paths of earlier ones.
  for (let k = targets.length - 1; k >= 0; k--) {
    const p = targets[k]
    const arrayPath = p.slice(0, -1)
    const arr = shapeArrayAt(anim, arrayPath)
    if (!arr) continue
    arr.splice(lastIndex(p), 1)
    syncGroupCount(anim, arrayPath)
  }
  return targets
}

/**
 * True if the shape items at `paths` may be moved into the shape array at `targetArrayPath`:
 * same layer, and no group moves into itself or one of its descendants.
 */
export function canMoveShapes(paths: readonly NodePath[], targetArrayPath: NodePath): boolean {
  const last = targetArrayPath[targetArrayPath.length - 1]
  if (last !== 'shapes' && last !== 'it') return false
  const layerPath = layerPathOf(targetArrayPath)
  if (!layerPath || !paths.length) return false
  return paths.every(
    (p) =>
      isShapePath(p) && pathEquals(layerPathOf(p), layerPath) && !isPathPrefix(p, targetArrayPath),
  )
}

/**
 * Moves shape items into the shape array at `targetArrayPath` (the layer's `shapes` or a
 * group's `it`, within the same layer), inserting them before the item currently at `toIndex`
 * — never after a group's transform. Reordering within one array works the same way.
 *
 * @returns new paths of the moved items (in document order), or [] when the move is invalid.
 */
export function moveShapes(
  anim: Animation,
  paths: readonly NodePath[],
  targetArrayPath: NodePath,
  toIndex: number,
): NodePath[] {
  const targets = shapeTargets(anim, paths)
  const layerPath = layerPathOf(targetArrayPath)
  const target = shapeArrayAt(anim, targetArrayPath)
  if (!layerPath || !target || !targets.length || !canMoveShapes(targets, targetArrayPath))
    return []

  const refs = targets.map((p) => getAt<ShapeItem>(anim, p)!)
  const moving = new Set<unknown>(refs)
  // Insert before the first item that stays, at or after toIndex (the transform at the latest).
  let anchor: ShapeItem | undefined
  for (let i = Math.max(0, toIndex); i < target.length; i++) {
    if (!moving.has(target[i])) {
      anchor = target[i]
      break
    }
  }
  if (!anchor && target[target.length - 1]?.ty === 'tr') anchor = target[target.length - 1]

  for (let k = targets.length - 1; k >= 0; k--) {
    const p = targets[k]
    const arrayPath = p.slice(0, -1)
    shapeArrayAt(anim, arrayPath)?.splice(lastIndex(p), 1)
    syncGroupCount(anim, arrayPath)
  }
  const at = anchor ? target.indexOf(anchor) : target.length
  target.splice(at < 0 ? shapeInsertLimit(target) : at, 0, ...refs)

  const arrayPath = locateArray(anim, layerPath, target)
  if (!arrayPath) return []
  syncGroupCount(anim, arrayPath)
  return refs.map((ref) => locateShape(anim, layerPath, ref)).filter((p): p is NodePath => !!p)
}

/**
 * Changes the stacking order of shape items within their arrays (the group transform stays
 * last). @returns new paths of the items.
 */
export function arrangeShapes(
  anim: Animation,
  paths: readonly NodePath[],
  mode: ArrangeMode,
): NodePath[] {
  const out: NodePath[] = []
  const targets = shapeTargets(anim, paths)
  for (const { arrayPath, indices } of groupByArray(targets)) {
    const arr = shapeArrayAt(anim, arrayPath)
    if (!arr) continue
    const limit = shapeInsertLimit(arr)
    const units = arr.slice(0, limit)
    const wanted = new Set(indices)
    const order = arrangeOrder(
      units.map((_, i) => wanted.has(i)),
      mode,
    )
    reorderInPlace(arr, [...order.map((i) => units[i]), ...arr.slice(limit)])
    const newIndex = new Map(order.map((i, k) => [i, k]))
    for (const i of indices) if (newIndex.has(i)) out.push([...arrayPath, newIndex.get(i)!])
  }
  return out.sort(comparePaths)
}

/**
 * Wraps shape items of one array into a new group (identity transform) placed where the
 * topmost item was. Items keep their order. Returns the group's path, or null when the items
 * do not share the same parent array.
 */
export function groupShapes(
  anim: Animation,
  paths: readonly NodePath[],
  opts: { name?: string } = {},
): NodePath | null {
  const targets = shapeTargets(anim, paths)
  if (!targets.length) return null
  const arrayPath = targets[0].slice(0, -1)
  if (!targets.every((p) => pathEquals(p.slice(0, -1), arrayPath))) return null
  const arr = shapeArrayAt(anim, arrayPath)
  if (!arr) return null
  const indices = targets.map(lastIndex)
  const items = indices.map((i) => arr[i])
  for (let k = indices.length - 1; k >= 0; k--) arr.splice(indices[k], 1)
  arr.splice(indices[0], 0, createGroupShape({ name: opts.name, items }))
  syncGroupCount(anim, arrayPath)
  return [...arrayPath, indices[0]]
}

/** Why a group cannot be ungrouped without changing how the animation looks. */
export type UngroupBlocker = 'not-group' | 'transform' | 'styles'

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6

function staticNumbers(prop: AnyProperty | undefined, fallback: number[]): number[] | null {
  if (!prop) return fallback
  if (isAnimated(prop)) return null
  const k = prop.k
  if (typeof k === 'number') return [k]
  if (Array.isArray(k) && k.every((v) => typeof v === 'number')) return k as number[]
  return null
}

/** True if a group transform leaves its content untouched (static, p = a, 100% scale, …). */
export function isIdentityGroupTransform(tr: TransformShape | undefined): boolean {
  if (!tr) return true
  if (isSplitPosition(tr.p)) return false
  const p = staticNumbers(tr.p, [0, 0])
  const a = staticNumbers(tr.a, [0, 0])
  const s = staticNumbers(tr.s, [100, 100])
  const r = staticNumbers(tr.r, [0])
  const o = staticNumbers(tr.o, [100])
  const sk = staticNumbers(tr.sk, [0])
  if (!p || !a || !s || !r || !o || !sk) return false
  return (
    near(p[0] ?? 0, a[0] ?? 0) &&
    near(p[1] ?? 0, a[1] ?? 0) &&
    near(s[0] ?? 100, 100) &&
    near(s[1] ?? s[0] ?? 100, 100) &&
    near(r[0] ?? 0, 0) &&
    near(o[0] ?? 100, 100) &&
    near(sk[0] ?? 0, 0)
  )
}

/**
 * Checks whether the group at `path` can be ungrouped without changing the rendering:
 * - its transform must be an identity (the transform would otherwise have to be baked into
 *   every child), without group blend mode;
 * - its fills, strokes and modifiers would start applying to the shapes above the group in
 *   the parent array, so they are only allowed when there are none.
 * @returns null when ungrouping is safe.
 */
export function ungroupBlocker(anim: Animation, path: NodePath): UngroupBlocker | null {
  const group = isShapePath(path) ? getAt<ShapeItem>(anim, path) : undefined
  if (!group || group.ty !== 'gr' || !Array.isArray(group.it)) return 'not-group'
  const tr = group.it.find((i): i is TransformShape => i.ty === 'tr')
  if (!isIdentityGroupTransform(tr) || (group.bm ?? 0) !== 0) return 'transform'
  const affectsOthers = group.it.some((i) => i.ty !== 'tr' && !isGeometryShape(i))
  if (affectsOthers) {
    const arr = shapeArrayAt(anim, path.slice(0, -1)) ?? []
    if (arr.slice(0, lastIndex(path)).some(isGeometryShape)) return 'styles'
  }
  return null
}

/**
 * Replaces groups by their items (see `ungroupBlocker`; blocked groups are skipped). Items of a
 * hidden group become hidden.
 * @returns paths of the released items, in document order.
 */
export function ungroupShapes(anim: Animation, paths: readonly NodePath[]): NodePath[] {
  const released: Array<{ layerPath: NodePath; ref: ShapeItem }> = []
  const groups = uniquePaths(paths.filter(isShapePath)).sort(comparePaths)
  // Innermost/last first: releasing items never shifts the paths of groups processed later,
  // and nested groups are checked against their parent's content at that moment.
  for (let k = groups.length - 1; k >= 0; k--) {
    const p = groups[k]
    if (ungroupBlocker(anim, p) !== null) continue
    const layerPath = layerPathOf(p)
    const arrayPath = p.slice(0, -1)
    const arr = shapeArrayAt(anim, arrayPath)
    const group = getAt<GroupShape>(anim, p)
    if (!layerPath || !arr || !group || group.ty !== 'gr') continue
    const items = group.it.filter((i) => i.ty !== 'tr')
    if (group.hd) for (const item of items) item.hd = true
    arr.splice(lastIndex(p), 1, ...items)
    syncGroupCount(anim, arrayPath)
    for (const ref of items) released.push({ layerPath, ref })
  }
  return released
    .map((r) => locateShape(anim, r.layerPath, r.ref))
    .filter((p): p is NodePath => !!p)
    .sort(comparePaths)
}

/**
 * Conventional insertion index for a new shape item in a shape array:
 *  - geometry and groups on top (existing fills and strokes below apply to them);
 *  - strokes above the existing styles, fills below them;
 *  - modifiers (trim paths, repeater, …) at the end, where they affect everything above.
 */
export function shapeInsertIndex(items: readonly ShapeItem[], ty: ShapeType): number {
  const end = shapeInsertLimit(items)
  if (SHAPE_GEOMETRY.has(ty)) return 0
  if (SHAPE_STYLES.has(ty)) {
    let first = -1
    let last = -1
    for (let i = 0; i < end; i++) {
      if (!SHAPE_STYLES.has(items[i].ty)) continue
      if (first < 0) first = i
      last = i
    }
    if (ty === 'st' || ty === 'gs') return first >= 0 ? first : end
    return last >= 0 ? last + 1 : end
  }
  return end
}

/**
 * Adds a shape item to a shape layer or a group (at the conventional position, see
 * `shapeInsertIndex`). Returns its path, or null when `containerPath` is neither.
 */
export function addShapeItem(
  anim: Animation,
  containerPath: NodePath,
  item: ShapeItem,
): NodePath | null {
  const node = getAt<Layer | ShapeItem>(anim, containerPath)
  if (!node || typeof node !== 'object') return null
  let key: 'shapes' | 'it'
  if (isLayerPath(containerPath) && node.ty === 4) key = 'shapes'
  else if (isShapePath(containerPath) && node.ty === 'gr') key = 'it'
  else return null
  const holder = node as { shapes?: ShapeItem[]; it?: ShapeItem[] }
  if (!Array.isArray(holder[key])) holder[key] = []
  const arr = holder[key]!
  const index = shapeInsertIndex(arr, item.ty)
  arr.splice(index, 0, item)
  const arrayPath = [...containerPath, key]
  syncGroupCount(anim, arrayPath)
  return [...arrayPath, index]
}

/* -------------------------------------------------------------------------- */
/*                                 Copy/paste                                 */
/* -------------------------------------------------------------------------- */

/** Editor clipboard format for layers and shape items (JSON with the paste-registry marker). */
export interface LayersClipboard {
  __lottieEditor: 'layers'
  version: 1
  kind: 'layers' | 'shapes'
  /** Frame rate of the source document (times are pasted unchanged). */
  fr?: number
  /** Composition the layers come from: precomp asset id, or null for the root. */
  sourceComp?: string | null
  /** Editor session id of the source document. */
  sourceDoc?: string
  layers?: Layer[]
  shapes?: ShapeItem[]
  /** Assets referenced by the layers: precomps (recursively) and images. */
  assets?: Asset[]
  /** Fonts used by text layers (including inside precomps). */
  fonts?: Font[]
  /** Glyphs of those fonts when the source document uses glyph data. */
  chars?: unknown[]
}

/** Clipboard marker key (see commands/paste). */
const MARKER = '__lottieEditor'

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const refIdOf = (layer: Layer): string | undefined => {
  const ref = (layer as { refId?: unknown }).refId
  return typeof ref === 'string' ? ref : undefined
}

function fontNamesOf(layer: Layer, out: Set<string>): void {
  if (layer.ty !== 5) return
  for (const kf of (layer as TextLayer).t?.d?.k ?? []) {
    const f = kf?.s?.f
    if (typeof f === 'string') out.add(f)
  }
}

/** Assets referenced by `layers` (precomps recursively), in document asset order, and used fonts. */
function collectDependencies(
  anim: Animation,
  layers: readonly Layer[],
): { assets: Asset[]; fonts: Set<string> } {
  const assets = anim.assets ?? []
  const byId = new Map(assets.map((a) => [a.id, a]))
  const wanted = new Set<string>()
  const fonts = new Set<string>()
  const visit = (ls: readonly Layer[]) => {
    for (const l of ls) {
      fontNamesOf(l, fonts)
      const ref = refIdOf(l)
      if (ref === undefined || wanted.has(ref)) continue
      const asset = byId.get(ref)
      if (!asset) continue
      wanted.add(ref)
      if (isPrecompAsset(asset)) visit(asset.layers)
    }
  }
  visit(layers)
  return { assets: assets.filter((a) => wanted.has(a.id)), fonts }
}

/**
 * Builds the clipboard payload for layers of ONE composition (the composition of the last
 * path; layers of other compositions are ignored). Matte blocks and the matte sources of copied
 * targets are included so mattes survive the round trip; referenced precomps (recursively),
 * images, fonts and glyphs are embedded so the layers paste into any document.
 */
export function serializeLayers(
  anim: Animation,
  paths: readonly NodePath[],
  opts: { docId?: string } = {},
): LayersClipboard | null {
  const layerPaths = paths.filter(isLayerPath)
  if (!layerPaths.length) return null
  const compPath = compPathOf(layerPaths[layerPaths.length - 1])
  const layers = layersAt(anim, compPath)
  if (!layers) return null
  const indices = new Set(
    expandToBlocks(
      layers,
      layerPaths.filter((p) => pathEquals(compPathOf(p), compPath)).map(lastIndex),
    ),
  )
  const src = matteSources(layers)
  for (const i of indices) {
    // Matte sources referenced through `tp` may live anywhere in the composition (sources added
    // here are visited too, which follows chains of mattes).
    let s = src[i]
    while (s >= 0 && !indices.has(s)) {
      indices.add(s)
      s = src[s]
    }
  }
  if (!indices.size) return null
  const picked = [...indices].sort((a, b) => a - b).map((i) => cloneNode(layers[i]))
  const deps = collectDependencies(anim, picked)
  const fontList = anim.fonts?.list?.filter((f) => deps.fonts.has(f.fName)) ?? []
  const families = new Set(fontList.map((f) => f.fFamily))
  const chars = (anim.chars ?? []).filter((c) => isRecord(c) && families.has(c.fFamily as string))
  const assetIndex = compPath[0] === 'assets' ? (compPath[1] as number) : null
  const payload: LayersClipboard = {
    __lottieEditor: 'layers',
    version: 1,
    kind: 'layers',
    fr: anim.fr,
    sourceComp: assetIndex === null ? null : (anim.assets?.[assetIndex]?.id ?? null),
    layers: picked,
  }
  if (opts.docId) payload.sourceDoc = opts.docId
  if (deps.assets.length) payload.assets = deps.assets.map(cloneNode)
  if (fontList.length) payload.fonts = fontList.map(cloneNode)
  if (chars.length) payload.chars = chars.map(cloneNode)
  return payload
}

/**
 * Builds the clipboard payload for shape items of ONE layer (the layer of the last path).
 * Group transforms and descendants of other copied items are skipped.
 */
export function serializeShapes(
  anim: Animation,
  paths: readonly NodePath[],
): LayersClipboard | null {
  const shapePaths = paths.filter(isShapePath)
  if (!shapePaths.length) return null
  const layerPath = layerPathOf(shapePaths[shapePaths.length - 1])
  const targets = shapeTargets(anim, shapePaths).filter((p) =>
    pathEquals(layerPathOf(p), layerPath),
  )
  if (!targets.length) return null
  return {
    __lottieEditor: 'layers',
    version: 1,
    kind: 'shapes',
    fr: anim.fr,
    shapes: targets.map((p) => cloneNode(getAt<ShapeItem>(anim, p)!)),
  }
}

function isLayerLike(v: unknown): v is Layer {
  return (
    isRecord(v) &&
    typeof v.ty === 'number' &&
    isRecord(v.ks) &&
    typeof v.ip === 'number' &&
    Number.isFinite(v.ip) &&
    typeof v.op === 'number' &&
    Number.isFinite(v.op)
  )
}

function isShapeLike(v: unknown): v is ShapeItem {
  return isRecord(v) && typeof v.ty === 'string' && v.ty !== 'tr'
}

function isAssetLike(v: unknown): v is Asset {
  if (!isRecord(v) || typeof v.id !== 'string') return false
  return Array.isArray(v.layers) ? v.layers.every(isLayerLike) : typeof v.p === 'string'
}

/**
 * Validates untrusted clipboard JSON. Returns a normalized payload, or null when the JSON is
 * not an editor layers payload or holds nothing usable.
 */
export function parseLayersClipboard(json: unknown): LayersClipboard | null {
  if (!isRecord(json) || json[MARKER] !== 'layers') return null
  const kind = json.kind === 'shapes' ? 'shapes' : 'layers'
  const payload: LayersClipboard = { __lottieEditor: 'layers', version: 1, kind }
  if (typeof json.fr === 'number') payload.fr = json.fr
  if (typeof json.sourceComp === 'string' || json.sourceComp === null)
    payload.sourceComp = json.sourceComp
  if (typeof json.sourceDoc === 'string') payload.sourceDoc = json.sourceDoc
  if (kind === 'layers') {
    const layers = Array.isArray(json.layers) ? json.layers.filter(isLayerLike) : []
    if (!layers.length) return null
    payload.layers = layers.map((l) => ({ ...l, st: typeof l.st === 'number' ? l.st : 0 }))
    if (Array.isArray(json.assets)) payload.assets = json.assets.filter(isAssetLike)
    if (Array.isArray(json.fonts)) {
      payload.fonts = json.fonts.filter(
        (f): f is Font =>
          isRecord(f) && typeof f.fName === 'string' && typeof f.fFamily === 'string',
      )
    }
    if (Array.isArray(json.chars)) payload.chars = json.chars.filter(isRecord)
  } else {
    const shapes = Array.isArray(json.shapes) ? json.shapes.filter(isShapeLike) : []
    if (!shapes.length) return null
    payload.shapes = shapes
  }
  return payload
}

/** JSON with sorted keys, so structurally equal values compare equal as strings. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isRecord(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const assetKeyCache = new WeakMap<object, string>()

/** Content key of an asset (everything but its id). Frozen document assets are cached. */
function assetContentKey(asset: Asset): string {
  const cached = assetKeyCache.get(asset)
  if (cached !== undefined) return cached
  const rest: Record<string, unknown> = { ...asset }
  delete rest.id
  const key = stableStringify(rest)
  if (Object.isFrozen(asset)) assetKeyCache.set(asset, key)
  return key
}

/** Unused asset id derived from `id`: "comp_0" → "comp_1", "logo" → "logo_1". */
function uniqueIdLike(id: string, taken: ReadonlySet<string>): string {
  const m = /^(.*?)(\d+)$/.exec(id)
  const base = m ? m[1] : `${id}_`
  let n = m ? Number(m[2]) + 1 : 1
  while (taken.has(`${base}${n}`)) n++
  return `${base}${n}`
}

function remapRefId(layer: Layer, idMap: ReadonlyMap<string, string>): void {
  const ref = refIdOf(layer)
  if (ref !== undefined && idMap.has(ref)) (layer as { refId?: string }).refId = idMap.get(ref)
}

/**
 * Adds incoming assets to the document. Identical assets (same content, any id) are reused;
 * conflicting ids are renamed; references inside incoming precomps are remapped.
 * @returns incoming id → document id.
 */
function mergeAssets(anim: Animation, incoming: readonly Asset[]): Map<string, string> {
  const idMap = new Map<string, string>()
  if (!incoming.length) return idMap
  if (!Array.isArray(anim.assets)) anim.assets = []
  const docAssets = anim.assets
  const byIncomingId = new Map(incoming.map((a) => [a.id, a]))

  // Dependencies first, so a precomp's references are remapped before it is compared/added.
  const order: Asset[] = []
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (asset: Asset) => {
    if (state.has(asset.id)) return
    state.set(asset.id, 'visiting')
    if (isPrecompAsset(asset)) {
      for (const l of asset.layers) {
        const ref = refIdOf(l)
        const dep = ref !== undefined ? byIncomingId.get(ref) : undefined
        if (dep) visit(dep)
      }
    }
    state.set(asset.id, 'done')
    order.push(asset)
  }
  incoming.forEach(visit)

  const taken = new Set(docAssets.map((a) => a.id))
  for (const asset of order) {
    const copy = structuredClone(snapshot(asset))
    if (isPrecompAsset(copy)) copy.layers.forEach((l) => remapRefId(l, idMap))
    const key = assetContentKey(copy)
    const precomp = isPrecompAsset(copy)
    const size = precomp ? copy.layers.length : (copy as { p?: string }).p?.length
    const existing = docAssets
      .map((d) => snapshot(d))
      .filter((d) => isPrecompAsset(d) === precomp)
      // The same id first (copy/paste within a document), then a cheap size filter.
      .sort((a, b) => Number(b.id === copy.id) - Number(a.id === copy.id))
      .find(
        (d) =>
          (precomp
            ? (d as { layers: unknown[] }).layers.length
            : (d as { p?: string }).p?.length) === size && assetContentKey(d) === key,
      )
    if (existing) {
      idMap.set(asset.id, existing.id)
      continue
    }
    const id = taken.has(copy.id) ? uniqueIdLike(copy.id, taken) : copy.id
    taken.add(id)
    copy.id = id
    idMap.set(asset.id, id)
    docAssets.push(copy)
  }
  return idMap
}

function hasTextLayers(anim: Animation): boolean {
  if (anim.layers?.some((l) => l.ty === 5)) return true
  return (anim.assets ?? []).some((a) => isPrecompAsset(a) && a.layers.some((l) => l.ty === 5))
}

const sameGlyph = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  a.ch === b.ch && a.fFamily === b.fFamily && a.style === b.style && a.size === b.size

function mergeFonts(
  anim: Animation,
  fonts: readonly Font[] | undefined,
  chars: readonly unknown[] | undefined,
): void {
  // Glyph data switches lottie-web to glyph rendering for ALL text: only merge it into
  // documents that already use glyphs or have no text of their own.
  const adoptChars = !!chars?.length && (Array.isArray(anim.chars) || !hasTextLayers(anim))
  if (fonts?.length) {
    if (!anim.fonts || !Array.isArray(anim.fonts.list)) anim.fonts = { ...anim.fonts, list: [] }
    for (const f of fonts) {
      if (!anim.fonts.list.some((e) => e.fName === f.fName))
        anim.fonts.list.push(structuredClone(f))
    }
  }
  if (adoptChars && chars) {
    if (!Array.isArray(anim.chars)) anim.chars = []
    const list = anim.chars as Array<Record<string, unknown>>
    for (const c of chars) {
      if (isRecord(c) && !list.some((e) => sameGlyph(e, c))) list.push(structuredClone(c))
    }
  }
}

/** Precomp asset ids reachable from `assetId` through precomp layers, including itself. */
function reachableComps(anim: Animation, assetId: string): Set<string> {
  const byId = new Map((anim.assets ?? []).map((a) => [a.id, a]))
  const seen = new Set<string>()
  const stack = [assetId]
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const asset = byId.get(id)
    if (asset && isPrecompAsset(asset)) {
      for (const l of asset.layers) {
        const ref = l.ty === 0 ? refIdOf(l) : undefined
        if (ref !== undefined) stack.push(ref)
      }
    }
  }
  return seen
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * The payload with its times converted to the frame rate `fr`, keeping durations in seconds
 * (After Effects does the same when pasting between compositions of different frame rates):
 * in/out points, start times, keyframes and the contents of copied precomps. Returns the payload
 * itself when the rates match or the source rate is unknown.
 */
export function retimeClipboard(payload: LayersClipboard, fr: number): LayersClipboard {
  const from = payload.fr
  if (!from || !(from > 0) || !(fr > 0) || Math.abs(from - fr) < 1e-9) return payload
  // The timing module retimes whole documents: wrap the payload into a throwaway one.
  const layers: Layer[] =
    payload.kind === 'shapes'
      ? [{ ty: 4, ind: 1, ip: 0, op: 1, st: 0, ks: {}, shapes: payload.shapes ?? [] }]
      : (payload.layers ?? [])
  const doc: Animation = {
    fr: from,
    ip: Math.min(0, ...layers.map((l) => l.ip).filter(finite)),
    op: Math.max(1, ...layers.map((l) => l.op).filter(finite)),
    w: 0,
    h: 0,
    layers: cloneNode(layers),
    assets: cloneNode(payload.assets ?? []),
  }
  changeFrameRate(doc, fr, { keepDuration: true })
  if (payload.kind === 'shapes')
    return { ...payload, fr, shapes: (doc.layers[0] as ShapeLayer).shapes }
  return { ...payload, fr, layers: doc.layers, ...(payload.assets ? { assets: doc.assets } : null) }
}

export interface PasteOptions {
  /**
   * Keep `parent`/`tp` links to layers outside the pasted set when they exist in the target
   * composition (pasting back into the composition the layers were copied from).
   */
  keepOutsideLinks?: boolean
}

/**
 * Pastes clipboard layers into the composition at `compPath`, inserted at `index` (0 = top).
 * Times are converted to the document's frame rate (`retimeClipboard`), assets are merged
 * (deduplicated by content, conflicting ids renamed), fonts added, `ind`s reassigned, and
 * `parent`/`tp`/`refId` remapped. The payload is never aliased, so it can be pasted repeatedly.
 * Precomp layers that would make a composition contain itself are skipped (players would
 * recurse forever), so fewer paths than payload layers may be returned.
 * @returns paths of the pasted layers.
 */
export function pasteLayers(
  anim: Animation,
  compPath: NodePath,
  clipboard: LayersClipboard,
  index: number,
  opts: PasteOptions = {},
): NodePath[] {
  const layers = layersAt(anim, compPath)
  if (!layers || !clipboard.layers?.length) return []
  const payload = retimeClipboard(clipboard, anim.fr)
  const idMap = mergeAssets(anim, payload.assets ?? [])
  mergeFonts(anim, payload.fonts, payload.chars)

  const targetComp = compPath[0] === 'assets' ? anim.assets?.[compPath[1] as number]?.id : undefined
  const copies = (payload.layers ?? [])
    .map((l) => structuredClone(snapshot(l)))
    .filter((c) => {
      remapRefId(c, idMap)
      const ref = c.ty === 0 ? refIdOf(c) : undefined
      return (
        targetComp === undefined || ref === undefined || !reachableComps(anim, ref).has(targetComp)
      )
    })
  if (!copies.length) return []
  let next = nextLayerInd(layers)
  const indMap = new Map<number, number>()
  for (const c of copies) {
    const old = c.ind
    c.ind = next++
    if (typeof old === 'number' && !indMap.has(old)) indMap.set(old, c.ind)
  }
  const existing = new Set(
    layers.map((l) => l.ind).filter((i): i is number => typeof i === 'number'),
  )
  const outside = (ind: number) => !!opts.keepOutsideLinks && existing.has(ind)

  copies.forEach((c, k) => {
    if (c.parent !== undefined) {
      if (typeof c.parent === 'number' && indMap.has(c.parent)) c.parent = indMap.get(c.parent)
      else if (typeof c.parent !== 'number' || !outside(c.parent)) delete c.parent
    }
    if (c.tp !== undefined) {
      if (typeof c.tp === 'number' && indMap.has(c.tp)) c.tp = indMap.get(c.tp)
      else if (typeof c.tp !== 'number' || !outside(c.tp)) {
        delete c.tp
        delete c.tt
      }
    } else if (c.tt && k === 0) {
      // A position-based matte needs its source directly above; the first pasted layer has none.
      delete c.tt
    }
  })
  return insertLayers(anim, compPath, copies, index)
}

/**
 * Pastes shape items into the shape array at `arrayPath` at `index` (clamped before a group's
 * transform). Items are cloned. @returns their paths.
 */
export function pasteShapes(
  anim: Animation,
  arrayPath: NodePath,
  shapes: readonly ShapeItem[],
  index: number,
): NodePath[] {
  const arr = shapeArrayAt(anim, arrayPath)
  const items = shapes.filter((s) => s.ty !== 'tr').map((s) => structuredClone(snapshot(s)))
  if (!arr || !items.length) return []
  const at = Math.max(0, Math.min(Math.round(index), shapeInsertLimit(arr)))
  arr.splice(at, 0, ...items)
  syncGroupCount(anim, arrayPath)
  return items.map((_, k) => [...arrayPath, at + k])
}

/* -------------------------------------------------------------------------- */
/*                         Precompose / release precomp                       */
/* -------------------------------------------------------------------------- */

/*
 * Both operations keep the rendering identical at every frame (lottie-web semantics):
 *  - a precomp layer draws its composition at `inner = (outer − st) / sr`, clipped to `w × h`
 *    in the layer's own space, with the layer's transform and opacity applied to the whole;
 *  - parents pass their matrices only (never opacity) and work across in/out points and
 *    visibility; a parent must live in the same composition as its child;
 *  - track mattes pair a target (`tt`) with the layer whose `ind` is its `tp`, or with the layer
 *    directly above it (lottie-web's canvas renderer looks for `ind − 1` instead).
 *
 * Parenting across the new composition boundary cannot exist in Lottie, so it is preserved by
 * NULL COPIES that carry the same `ind`, name and transform (animation, auto-orient, 3D and
 * their own parents included): a parent that stays outside is copied into the new composition,
 * a moved layer that parents layers left outside leaves a copy behind. References (`parent`,
 * `tp`) keep working without renumbering, and expressions that name the parent still find it.
 */

const LINEAR_OUT_HANDLE: EasingHandle = { x: [0.167], y: [0.167] }
const LINEAR_IN_HANDLE: EasingHandle = { x: [0.833], y: [0.833] }

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The whole frame at or just below `t` (43.0000017 → 43, 42.9999999 → 43, 12.5 → 12). */
const wholeFrame = (t: number) => Math.floor(t + 1e-6)

/**
 * An `ind` above every ind, parent and matte reference of a composition: unlike `nextLayerInd`
 * it never revives a dangling reference (a child of a deleted layer would adopt the new one).
 */
function freshInd(layers: readonly Layer[]): number {
  let max = 0
  for (const l of layers) {
    for (const v of [l?.ind, l?.parent, l?.tp]) if (isFiniteNumber(v) && v > max) max = v
  }
  return Math.floor(max) + 1
}

/** Index of the layer `layer.parent` refers to (lottie-web: the first layer with that ind), or -1. */
function parentIndexIn(layers: readonly Layer[], byInd: ReadonlyMap<number, number>, i: number) {
  const parent: unknown = layers[i]?.parent
  return typeof parent === 'number' ? (byInd.get(parent) ?? -1) : -1
}

/** Indices of every ancestor of `layers[i]` (direct parent first), cycle-safe. */
function ancestorIndices(
  layers: readonly Layer[],
  byInd: ReadonlyMap<number, number>,
  i: number,
): number[] {
  const out: number[] = []
  const seen = new Set<number>([i])
  let p = parentIndexIn(layers, byInd, i)
  while (p >= 0 && !seen.has(p)) {
    seen.add(p)
    out.push(p)
    p = parentIndexIn(layers, byInd, p)
  }
  return out
}

/**
 * Expands a set of layers so every track matte pair is complete: the source of every target in
 * the set, and every target of every source in the set (a source serves all its targets).
 */
function matteClosure(layers: readonly Layer[], indices: Iterable<number>): Set<number> {
  const src = matteSources(layers)
  const targetsOf = new Map<number, number[]>()
  src.forEach((s, j) => {
    if (s < 0 || s === j) return
    const list = targetsOf.get(s)
    if (list) list.push(j)
    else targetsOf.set(s, [j])
  })
  const out = new Set<number>()
  const stack = [...indices]
  while (stack.length) {
    const i = stack.pop()!
    if (out.has(i) || !(i >= 0 && i < layers.length)) continue
    out.add(i)
    if (src[i] >= 0) stack.push(src[i])
    for (const t of targetsOf.get(i) ?? []) stack.push(t)
  }
  return out
}

/**
 * Null copies made by precompose (the objects themselves: immer keeps the identity of objects
 * added in a recipe, and undo/redo re-applies the same objects). Release uses it to tell a copy
 * from the layer it stands for when both are nulls; edited copies are new objects and fall back
 * to their position.
 */
const parentCopies = new WeakSet<object>()

/** The object a (possibly draft) layer is in the document. */
const baseOf = (layer: Layer): object => (isDraft(layer) ? original(layer) : layer) as object

/**
 * Invisible stand-in for `layer` as a parent: a null with the same `ind`, name, transform
 * (auto-orient, 3D) and parent, over the same time range.
 */
function parentProxy(layer: Layer): NullLayer {
  const src = snapshot(layer)
  const proxy: NullLayer = {
    ddd: src.ddd === 1 ? 1 : 0,
    ind: src.ind,
    ty: 3,
    nm: src.nm,
    sr: 1,
    ks: cloneNode(src.ks ?? {}),
    ao: src.ao === 1 ? 1 : 0,
    ip: src.ip,
    op: src.op,
    st: isFiniteNumber(src.st) ? src.st : 0,
    bm: 0,
  }
  if (typeof src.parent === 'number') proxy.parent = src.parent
  if (proxy.nm === undefined) delete proxy.nm
  if (proxy.ind === undefined) delete proxy.ind
  parentCopies.add(proxy)
  return proxy
}

/** Visits the keyframe lists of every animated property under `node` (layer content). */
function forEachKeyframeList(node: unknown, visit: (kfs: Keyframe<unknown>[]) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) forEachKeyframeList(child, visit)
    return
  }
  if (node === null || typeof node !== 'object') return
  if (isPropertyLike(node)) {
    const kfs = getKeyframes(node)
    if (kfs) visit(kfs)
    return
  }
  for (const key of Object.keys(node))
    forEachKeyframeList((node as Record<string, unknown>)[key], visit)
}

/**
 * Removes float noise (60.00000000000001 → 60) without touching real precision: After Effects
 * writes times such as 43.0000017514259, which must survive a shift and its inverse exactly.
 */
function denoise(v: number): number {
  const r = Math.round(v * 1e9) / 1e9
  return Math.abs(r - v) < 1e-11 ? (Object.is(r, -0) ? 0 : r) : v
}

/**
 * Maps every time of a layer through t ↦ t·scale + offset: in/out points, start time and the
 * keyframes of all its properties (transform, content, masks, effects, text, time remap —
 * remapped VALUES are times of the child composition and stay). `scale` also multiplies the
 * time stretch, so a nested precomp keeps showing the same frames. Exact (no rounding to
 * 1/1000 frame like document retiming): the precomp layer's own `st` is not rounded either.
 */
function retimeLayerTimes(layer: Layer, scale: number, offset: number): void {
  if (scale === 1 && offset === 0) return
  const map = (t: number) => denoise(t * scale + offset)
  if (isFiniteNumber(layer.ip)) layer.ip = map(layer.ip)
  if (isFiniteNumber(layer.op)) layer.op = map(layer.op)
  layer.st = map(isFiniteNumber(layer.st) ? layer.st : 0)
  if (scale !== 1) {
    const sr = isFiniteNumber(layer.sr) && layer.sr !== 0 ? layer.sr : 1
    layer.sr = denoise(sr * scale)
  }
  forEachKeyframeList(layer, (kfs) => {
    for (const kf of kfs) if (isFiniteNumber(kf.t)) kf.t = map(kf.t)
  })
}

/** True if a property anywhere in `node` carries an expression. */
function hasExpressionIn(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasExpressionIn)
  if (node === null || typeof node !== 'object') return false
  if (isPropertyLike(node))
    return typeof (node as { x?: unknown }).x === 'string' && !!(node as { x: string }).x.trim()
  return Object.values(node).some(hasExpressionIn)
}

/**
 * Size of the frame a composition is seen through: the document for the root; for a precomp,
 * the largest `w × h` among the layers that use it (each clips it to its own size, all in the
 * composition's coordinates), falling back to the document size.
 */
export function compFrameSize(anim: Animation, compPath: NodePath): { w: number; h: number } {
  const assetIndex = compAssetIndexOf([...compPath, 0])
  const id = assetIndex === null ? null : anim.assets?.[assetIndex]?.id
  if (id === null || id === undefined) return { w: anim.w, h: anim.h }
  let w = 0
  let h = 0
  forEachLayer(anim, (layer) => {
    if (layer.ty !== 0 || (layer as PrecompLayer).refId !== id) return
    const l = layer as PrecompLayer
    if (isFiniteNumber(l.w) && l.w > w) w = l.w
    if (isFiniteNumber(l.h) && l.h > h) h = l.h
  })
  return w > 0 && h > 0 ? { w, h } : { w: anim.w, h: anim.h }
}

/* --------------------------------- Precompose ------------------------------ */

/** How the selected layers go into the new composition (After Effects' two options). */
export type PrecomposeMode = 'move' | 'leave'

/**
 * Why "leave all attributes" is unavailable: it needs exactly one layer with a size of its own
 * (solid, image or precomp), like After Effects.
 */
export type LeaveBlocker = 'multiple' | 'kind' | 'size'

export interface PrecomposePlan {
  /** Composition the layers come from. */
  compPath: NodePath
  /** Indices of the selected layers. */
  selected: number[]
  /** Indices of the layers that move (document order): the selection and its matte partners. */
  moved: number[]
  /** Moved layers that were not selected: track matte sources and targets of selected layers. */
  matteAdded: number[]
  /** Layers staying outside that parent moved layers: copied into the new composition as nulls. */
  parentsCopied: number[]
  /** Moved layers that parent layers staying outside: a null copy of each stays behind. */
  parentsLeft: number[]
  /**
   * Layers between the moved ones that stay: they end up below the new composition, which takes
   * the place of the topmost moved layer.
   */
  between: number[]
  /** Frame span of the moved layers. */
  span: { ip: number; op: number }
  /** Frame range of the source composition. */
  compRange: { ip: number; op: number }
  /** Size of the new composition when attributes move (the source composition's frame). */
  size: { w: number; h: number }
  /** Why "leave all attributes" is unavailable, or null. */
  leave: LeaveBlocker | null
  /** Size of the new composition when the attributes stay (the layer's own size). */
  leaveSize: { w: number; h: number } | null
  /** Some moved layer has expressions (references to other layers may resolve differently). */
  expressions: boolean
  /**
   * Some moved layer has a blend mode: inside a composition it only blends with the layers of
   * that composition (After Effects, lottie-web's SVG renderer).
   */
  blendModes: boolean
}

/** The layer's own size when it has one (solid, image with a sized asset, precomp). */
function ownLayerSize(anim: Animation, layer: Layer): { w: number; h: number } | null {
  let w: unknown
  let h: unknown
  if (layer.ty === 1) {
    w = (layer as { sw?: unknown }).sw
    h = (layer as { sh?: unknown }).sh
  } else if (layer.ty === 2) {
    const asset = findAsset(anim, (layer as { refId?: string }).refId)?.asset as
      { w?: unknown; h?: unknown } | undefined
    w = asset?.w
    h = asset?.h
  } else if (layer.ty === 0) {
    w = (layer as PrecompLayer).w
    h = (layer as PrecompLayer).h
  }
  return isFiniteNumber(w) && isFiniteNumber(h) && w > 0 && h > 0 ? { w, h } : null
}

/**
 * What precomposing `paths` would do, without changing anything (for the dialog). The layers
 * must belong to one composition; returns null when there is nothing to precompose.
 * `scanExpressions: false` skips the (deep) search for expressions.
 */
export function planPrecompose(
  anim: Animation,
  paths: readonly NodePath[],
  { scanExpressions = true }: { scanExpressions?: boolean } = {},
): PrecomposePlan | null {
  const groups = groupLayersByComp(paths)
  if (groups.length !== 1) return null
  const { compPath, indices } = groups[0]
  const layers = layersAt(anim, compPath)
  if (!layers) return null
  const selected = indices.filter((i) => i >= 0 && i < layers.length && !!layers[i])
  if (!selected.length) return null

  const movedSet = matteClosure(layers, selected)
  const moved = [...movedSet].sort((a, b) => a - b)
  const byInd = indexByInd(layers)
  const copied = new Set<number>()
  const left = new Set<number>()
  layers.forEach((_, i) => {
    const inside = movedSet.has(i)
    for (const a of ancestorIndices(layers, byInd, i)) {
      // Every ancestor of a moved layer must exist inside, every ancestor of a staying layer
      // outside: the ones on the other side are represented by null copies.
      if (inside && !movedSet.has(a)) copied.add(a)
      if (!inside && movedSet.has(a)) left.add(a)
    }
  })

  let ip = Infinity
  let op = -Infinity
  for (const i of moved) {
    if (isFiniteNumber(layers[i].ip)) ip = Math.min(ip, layers[i].ip)
    if (isFiniteNumber(layers[i].op)) op = Math.max(op, layers[i].op)
  }
  const info = compInfoAt(anim, compPath)
  if (!(op > ip)) {
    ip = info.ip
    op = info.op
  }

  let leave: LeaveBlocker | null = null
  let leaveSize: { w: number; h: number } | null = null
  if (selected.length !== 1) leave = 'multiple'
  else {
    const layer = layers[selected[0]]
    if (layer.ty !== 0 && layer.ty !== 1 && layer.ty !== 2) leave = 'kind'
    else if (!(leaveSize = ownLayerSize(anim, layer))) leave = 'size'
  }

  return {
    compPath,
    selected,
    moved,
    matteAdded: moved.filter((i) => !selected.includes(i)),
    parentsCopied: [...copied].sort((a, b) => a - b),
    parentsLeft: [...left].sort((a, b) => a - b),
    between: layers.flatMap((_, i) =>
      i > moved[0] && i < moved[moved.length - 1] && !movedSet.has(i) ? [i] : [],
    ),
    span: { ip, op },
    compRange: { ip: info.ip, op: info.op },
    size: compFrameSize(anim, compPath),
    leave,
    leaveSize,
    expressions: scanExpressions && moved.some((i) => hasExpressionIn(layers[i])),
    blendModes: moved.some((i) => typeof layers[i].bm === 'number' && layers[i].bm !== 0),
  }
}

export interface PrecomposeOptions {
  /** Name of the new composition and of the precomp layer showing it. */
  name: string
  /**
   * 'move' (default): the layers move into the new composition with all their attributes.
   * 'leave': one layer's transform, masks, effects, matte, parent and in/out points stay on the
   * new precomp layer and the layer inside is reset (see `LeaveBlocker` for when it applies).
   */
  mode?: PrecomposeMode
  /**
   * Start the new composition at the first in point of the layers (their times shift so they
   * play at the same moments) and trim the precomp layer to their span. Otherwise the new
   * composition keeps the source composition's timing and the precomp layer spans all of it.
   */
  adjustDuration?: boolean
  /** Id of the new asset (default: the first free `comp_N`). */
  id?: string
}

/** Removes the keys that make a layer a matte, a parent's child or a masked/effected layer. */
function stripOuterAttributes(layer: Layer): void {
  for (const key of [
    'parent',
    'tt',
    'tp',
    'td',
    'hasMask',
    'masksProperties',
    'ef',
    'sy',
    'hd',
    'cl',
    'ln',
  ] as const)
    delete (layer as unknown as Record<string, unknown>)[key]
  layer.bm = 0
  layer.ao = 0
  layer.ddd = 0
}

/**
 * Precomposes layers of one composition (see `planPrecompose` for which layers move), as One
 * operation: the new precomp asset is appended to `assets`, and ONE precomp layer replaces the
 * layers, at the place of the topmost one. The rendering stays identical at every frame:
 *  - 'move': the layers keep everything; the new composition has the source composition's frame
 *    size and the precomp layer an identity transform, so nothing moves or gets clipped. Matte
 *    pairs move whole; parenting across the boundary is kept with null copies (see above).
 *  - 'leave': the precomp layer takes the layer's `ind`, transform, masks, effects, matte,
 *    parent, blend mode, visibility and in/out points; the composition has the layer's own size.
 *
 * @returns the path of the new precomp layer, or null when nothing was precomposed (layers of
 *   several compositions, or 'leave' for a layer that does not allow it).
 */
export function precomposeLayers(
  anim: Animation,
  paths: readonly NodePath[],
  opts: PrecomposeOptions,
): NodePath | null {
  const plan = planPrecompose(anim, paths, { scanExpressions: false })
  if (!plan) return null
  const layers = layersAt(anim, plan.compPath)
  if (!layers) return null
  const mode = opts.mode ?? 'move'
  if (mode === 'leave' && plan.leave !== null) return null
  const id = opts.id && !(anim.assets ?? []).some((a) => a.id === opts.id) ? opts.id : null
  const assetId = id ?? uniqueAssetId(anim, 'comp_')
  const name = opts.name.trim() || assetId
  const ind = freshInd(layers)

  if (mode === 'leave') {
    const index = plan.selected[0]
    const source = snapshot(layers[index])
    const inner = cloneNode(source)
    stripOuterAttributes(inner)
    inner.ks = {
      o: { a: 0, k: 100 },
      r: { a: 0, k: 0 },
      p: { a: 0, k: [0, 0, 0] },
      a: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [100, 100, 100] },
    }
    const size = plan.leaveSize!
    const start = opts.adjustDuration && isFiniteNumber(source.ip) ? wholeFrame(source.ip) : 0
    retimeLayerTimes(inner, 1, -start)
    const outer = createPrecompLayer({
      refId: assetId,
      name,
      ind: typeof source.ind === 'number' ? source.ind : ind,
      w: size.w,
      h: size.h,
      ip: source.ip,
      op: source.op,
      st: start,
    })
    // The attributes stay outside: they were evaluated in this composition's time and still are.
    const kept = outer as unknown as Record<string, unknown>
    const from = source as unknown as Record<string, unknown>
    kept.ks = cloneNode(source.ks ?? {})
    for (const key of ['ddd', 'ao', 'bm'] as const)
      if (from[key] !== undefined) kept[key] = from[key]
    for (const key of [
      'parent',
      'tt',
      'tp',
      'td',
      'hasMask',
      'masksProperties',
      'ef',
      'sy',
      'hd',
      'cl',
      'ln',
    ] as const) {
      if (from[key] !== undefined) kept[key] = cloneNode(from[key])
    }
    if (!Array.isArray(anim.assets)) anim.assets = []
    anim.assets.push(createPrecompAsset({ id: assetId, name, fr: anim.fr, layers: [inner] }))
    layers.splice(index, 1, outer)
    return [...plan.compPath, index]
  }

  // A whole-frame shift keeps keyframe times as they were written (the composition starts at
  // the first in point, or less than a frame after 0 when that is fractional).
  const shift = opts.adjustDuration ? wholeFrame(plan.span.ip) : 0
  // The layers themselves move (inside a recipe: their drafts, which finalize back to the
  // untouched originals — no copy of a large document).
  const content: Layer[] = [
    ...plan.moved.map((i) => layers[i]),
    ...plan.parentsCopied.map((i) => parentProxy(layers[i]) as Layer),
  ]
  // Copies left behind keep this composition's time: take them before the content shifts.
  const stayBehind = plan.parentsLeft.map((i) => parentProxy(layers[i]) as Layer)
  for (const layer of content) retimeLayerTimes(layer, 1, -shift)

  const precomp = createPrecompLayer({
    refId: assetId,
    name,
    ind,
    w: plan.size.w,
    h: plan.size.h,
    ip: opts.adjustDuration ? plan.span.ip : Math.min(plan.compRange.ip, plan.span.ip),
    op: opts.adjustDuration ? plan.span.op : Math.max(plan.compRange.op, plan.span.op),
    st: shift,
  })

  // Where the topmost moved layer was (every layer above it stays). Null copies left behind go
  // below the precomp layer: nulls draw nothing, and there they can never become the
  // position-based matte of a layer that stays.
  const at = plan.moved[0]
  for (let k = plan.moved.length - 1; k >= 0; k--) layers.splice(plan.moved[k], 1)
  layers.splice(at, 0, precomp, ...stayBehind)
  if (!Array.isArray(anim.assets)) anim.assets = []
  anim.assets.push(createPrecompAsset({ id: assetId, name, fr: anim.fr, layers: content }))
  return [...plan.compPath, at]
}

/* ---------------------------------- Release -------------------------------- */

/**
 * Why a precomp layer cannot be released without changing the animation:
 *  - 'not-precomp' / 'missing': not a precomp layer, or its composition does not exist;
 *  - 'recursive': the composition contains the one it would be released into;
 *  - 'time-remap': time remapping has no equivalent on the released layers;
 *  - 'stretch': a zero or negative time stretch (reversed playback);
 *  - 'matte': the layer is a track matte or uses one (it applies to the composition as a whole);
 *  - 'masks' / 'effects' / 'styles' / 'blend': they apply to the composition as a whole.
 */
export type ReleaseBlocker =
  | 'not-precomp'
  | 'missing'
  | 'recursive'
  | 'time-remap'
  | 'stretch'
  | 'matte'
  | 'masks'
  | 'effects'
  | 'styles'
  | 'blend'

/**
 * Effects that draw. Expression controls and pseudo effects (`ty` 5 groups named "… Control" or
 * "Pseudo/…") only hold values for expressions; disabled effects draw nothing either.
 */
function isVisualEffect(effect: unknown): boolean {
  if (effect === null || typeof effect !== 'object') return false
  const e = effect as { ty?: unknown; en?: unknown; mn?: unknown }
  if (e.en === 0) return false
  if (e.ty !== 5) return true
  const mn = typeof e.mn === 'string' ? e.mn : ''
  return !(/^ADBE .* Control$/.test(mn) || mn.startsWith('Pseudo/'))
}

/** Masks that change what is drawn (mode "none" masks do not). */
function hasActiveMasks(layer: Layer): boolean {
  const masks = Array.isArray(layer.masksProperties) ? layer.masksProperties : []
  return masks.some((m) => m && typeof m === 'object' && m.mode !== 'n')
}

/**
 * Checks whether the precomp layer at `path` can be released (see `ReleaseBlocker`).
 * @returns null when it can.
 */
export function releaseBlocker(anim: Animation, path: NodePath): ReleaseBlocker | null {
  const layer = isLayerPath(path) ? getAt<Layer>(anim, path) : undefined
  if (!layer || typeof layer !== 'object' || !isPrecompLayer(layer)) return 'not-precomp'
  const found = findPrecomp(anim, layer.refId)
  if (!found) return 'missing'
  const compId = compAssetIndexOf(path) === null ? null : anim.assets?.[path[1] as number]?.id
  if (compId && reachableComps(anim, found.asset.id).has(compId)) return 'recursive'
  if (layer.tm) return 'time-remap'
  if (layer.sr !== undefined && !(isFiniteNumber(layer.sr) && layer.sr > 0)) return 'stretch'
  if (layer.tt || layer.td) return 'matte'
  if (hasActiveMasks(layer)) return 'masks'
  if (Array.isArray(layer.ef) && layer.ef.some(isVisualEffect)) return 'effects'
  if (Array.isArray(layer.sy) && layer.sy.length > 0) return 'styles'
  if (typeof layer.bm === 'number' && layer.bm !== 0) return 'blend'
  return null
}

const nearly = (a: number, b: number) => Math.abs(a - b) < 1e-6

/**
 * True if a layer transform maps its content onto its parent's space unchanged at every frame:
 * static, 2D, anchor = position, 100% scale, no rotation or skew. Opacity is not considered.
 */
function isIdentityLayerTransform(layer: Layer): boolean {
  if (layer.ddd === 1) return false
  const ks: Transform = layer.ks ?? {}
  // An expression may move it whatever the static value says (the null carries it).
  const { o: _opacity, ...geometry } = ks
  if (hasExpressionIn(geometry)) return false
  const a = staticNumbers(ks.a, [0, 0])
  let p: number[] | null
  if (isSplitPosition(ks.p)) {
    const x = staticNumbers(ks.p.x, [0])
    const y = staticNumbers(ks.p.y, [0])
    p = x && y ? [x[0] ?? 0, y[0] ?? 0] : null
  } else p = staticNumbers(ks.p, [0, 0])
  const s = staticNumbers(ks.s, [100, 100])
  const r = staticNumbers(ks.r, [0])
  const sk = staticNumbers(ks.sk, [0])
  const rx = staticNumbers(ks.rx, [0])
  const ry = staticNumbers(ks.ry, [0])
  const rz = staticNumbers(ks.rz, [0])
  const or = staticNumbers(ks.or, [0, 0, 0])
  if (!a || !p || !s || !r || !sk || !rx || !ry || !rz || !or) return false
  return (
    nearly(p[0] ?? 0, a[0] ?? 0) &&
    nearly(p[1] ?? 0, a[1] ?? 0) &&
    nearly(s[0] ?? 100, 100) &&
    nearly(s[1] ?? s[0] ?? 100, 100) &&
    nearly(r[0] ?? 0, 0) &&
    nearly(sk[0] ?? 0, 0) &&
    nearly(rx[0] ?? 0, 0) &&
    nearly(ry[0] ?? 0, 0) &&
    nearly(rz[0] ?? 0, 0) &&
    or.every((v) => nearly(v, 0))
  )
}

/** Values of an opacity property at every keyframe time and whole frame of [from, to]. */
function sampleTimes(props: Array<AnyProperty | undefined>, from: number, to: number): number[] {
  const times = new Set<number>()
  for (let f = Math.ceil(from); f <= Math.floor(to); f++) times.add(f)
  times.add(from)
  times.add(to)
  for (const prop of props)
    for (const kf of getKeyframes(prop) ?? []) if (kf.t > from && kf.t < to) times.add(kf.t)
  return [...times].filter(isFiniteNumber).sort((x, y) => x - y)
}

/**
 * Multiplies a layer's opacity by the precomp's (`factor` = its opacity property, in the same
 * time base). Exact per layer; overlapping layers composite differently than the group did.
 */
function multiplyOpacity(layer: Layer, factor: ScalarProperty): void {
  if (!layer.ks) layer.ks = {}
  const own = layer.ks.o
  const factorKfs = getKeyframes(factor)
  if (!factorKfs) {
    const f = evaluateScalar(factor, 0, 100) / 100
    if (nearly(f, 1)) return
    if (!own) layer.ks.o = { a: 0, k: round3(100 * f) }
    else mapPropertyNumbers(own, (v) => v.map((n) => round3(n * f)))
    return
  }
  if (!own || !isAnimated(own)) {
    const f = evaluateScalar(own, 0, 100) / 100
    const copy = cloneNode(factor)
    mapPropertyNumbers(copy, (v) => v.map((n) => round3(n * f)))
    layer.ks.o = copy
    return
  }
  // Both animated: sample the product on every frame (and every keyframe) of the layer's range.
  const from = isFiniteNumber(layer.ip) ? layer.ip : factorKfs[0].t
  const to = isFiniteNumber(layer.op) ? layer.op : factorKfs[factorKfs.length - 1].t
  const times = sampleTimes([own, factor], from, to)
  const values = times.map((t) =>
    round3((evaluateScalar(own, t, 100) * evaluateScalar(factor, t, 100)) / 100),
  )
  const kfs: Keyframe<number[]>[] = []
  values.forEach((v, k) => {
    // Drop keys inside runs of equal values: the linear segments around them are flat anyway.
    if (k > 0 && k < values.length - 1 && v === values[k - 1] && v === values[k + 1]) return
    kfs.push({ t: denoise(times[k]), s: [v] })
  })
  for (let k = 0; k < kfs.length - 1; k++) {
    kfs[k].o = cloneNode(LINEAR_OUT_HANDLE)
    kfs[k].i = cloneNode(LINEAR_IN_HANDLE)
  }
  layer.ks.o = kfs.length > 1 ? { a: 1, k: kfs } : { a: 0, k: kfs[0]?.s?.[0] ?? 100 }
}

export interface ReleaseResult {
  /** Paths of the released layers, in document order. */
  layers: NodePath[]
  /**
   * Where each released layer comes from: [path of the layer in its composition before the
   * release, path of the released layer after it] (editor state such as locks can follow).
   */
  origins: Array<[NodePath, NodePath]>
  /** Paths of the nulls that carry precomp layers' transforms. */
  nulls: NodePath[]
  /** Precomp layers that were not released, with the reason. */
  skipped: Array<{ path: NodePath; reason: ReleaseBlocker }>
  /** Ids of compositions removed because nothing uses them anymore. */
  removedAssets: string[]
  /**
   * A precomp's opacity is now applied to each of its visible layers: where they overlap the
   * result differs from the composition's group opacity.
   */
  splitOpacity: boolean
  /**
   * Some released layer has a blend mode: it now blends with the layers below the precomp too
   * (a composition kept it to its own layers in After Effects and lottie-web's SVG renderer).
   */
  blendModes: boolean
}

/** Layers of a composition whose track matte source or parent is `i` (by index). */
function referencedBy(layers: readonly Layer[], kept: ReadonlySet<number>): Set<number> {
  const byInd = indexByInd(layers)
  const src = matteSources(layers)
  const needed = new Set<number>()
  const stack = [...kept]
  const seen = new Set<number>()
  while (stack.length) {
    const i = stack.pop()!
    if (seen.has(i)) continue
    seen.add(i)
    const p = parentIndexIn(layers, byInd, i)
    if (p >= 0) {
      needed.add(p)
      stack.push(p)
    }
    if (src[i] >= 0) {
      needed.add(src[i])
      stack.push(src[i])
    }
  }
  return needed
}

/** Opacity of a precomp layer that is not a constant 100%. */
function groupOpacity(layer: Layer): ScalarProperty | null {
  const o = layer.ks?.o
  if (!o) return null
  if (!isAnimated(o) && nearly(evaluateScalar(o, 0, 100), 100)) return null
  return o as ScalarProperty
}

/** Name, transform, auto-orient and 3D flag of a layer as a comparable string. */
function transformKey(layer: Layer): string {
  const l = snapshot(layer)
  return stableStringify([l.nm ?? null, l.ks ?? {}, l.ao ?? 0, l.ddd ?? 0])
}

/** Same name, transform, auto-orient and 3D flag (JSON-equal): one stands in for the other. */
function sameTransform(a: Layer, b: Layer): boolean {
  return transformKey(a) === transformKey(b)
}

/**
 * Releases ONE precomp layer at `index` of `layers` (the caller checked `releaseBlocker` and
 * made every layer of `layers` a draft). Reads everything first, then changes `layers` in place.
 *
 * When the precomp layer is an identity, null copies made by `precomposeLayers` fold back: a
 * released null standing for a layer of this composition (same `ind`, name and transform) is
 * dropped in favour of it, and a released layer takes the place of the null copy it left behind
 * here. Released layers keep their `ind`s when they are all free. So precomposing, then
 * releasing gives the original layers back.
 */
function releaseOne(
  anim: Animation,
  layers: Layer[],
  index: number,
  /** Nothing else uses the composition: its layers can move instead of being copied. */
  exclusive: boolean,
): {
  released: Layer[]
  /** Path of each released layer in its composition (before the release). */
  sources: NodePath[]
  nul: Layer | null
  splitOpacity: boolean
  blendModes: boolean
} {
  const precomp = snapshot(layers[index]) as PrecompLayer
  const found = findPrecomp(anim, precomp.refId)!
  const asset = found.asset
  const sr = isFiniteNumber(precomp.sr) ? precomp.sr : 1
  const st = isFiniteNumber(precomp.st) ? precomp.st : 0
  const from = isFiniteNumber(precomp.ip) ? precomp.ip : -Infinity
  const to = isFiniteNumber(precomp.op) ? precomp.op : Infinity

  const innerBase = (asset.layers ?? []).map(baseOf)
  const copies = exclusive
    ? [...(asset.layers ?? [])]
    : snapshot(asset.layers ?? []).map((l) => cloneNode(l))
  const inRange = copies.map((copy) => {
    retimeLayerTimes(copy, sr, st)
    const ip = Math.max(isFiniteNumber(copy.ip) ? copy.ip : -Infinity, from)
    const op = Math.min(isFiniteNumber(copy.op) ? copy.op : Infinity, to)
    if (!(op > ip)) return false
    if (Number.isFinite(ip)) copy.ip = ip
    if (Number.isFinite(op)) copy.op = op
    return true
  })
  // Layers never visible through this precomp go, unless kept layers need them as parents or
  // mattes: those keep their (mapped) time range, outside the precomp's, and are hidden when
  // they would draw.
  const needed = referencedBy(copies, new Set(copies.flatMap((_, k) => (inRange[k] ? [k] : []))))
  const keep = copies.map((_, k) => inRange[k] || needed.has(k))
  copies.forEach((copy, k) => {
    if (keep[k] && !inRange[k] && copy.ty !== 3 && !copy.td) copy.hd = true
  })

  // The transform goes to a null unless it changes nothing (then children take its parent).
  const identity = isIdentityLayerTransform(precomp) && !(precomp.ef?.length ?? 0)
  const byInd = indexByInd(layers)
  const innerByInd = indexByInd(copies)
  const outsideAt = (ind: unknown): number | undefined => {
    const j = isFiniteNumber(ind) ? byInd.get(ind) : undefined
    return j === undefined || j === index ? undefined : j
  }

  // Null copies fold back (identity only: otherwise the released layers move with a null). A
  // released layer and a layer here with the same ind, name and transform, whose parents will
  // be the same, stand for each other: a released null is dropped for the layer here (merged),
  // a null here is dropped for the released layer (absorbed). Chains may alternate between the
  // two, hence one fixpoint.
  const merged = new Set<number>()
  const absorbed = new Map<number, number>()
  // Null copies left behind by precompose sit right below the precomp layer.
  const leftBelow = new Set<number>()
  for (let j = index + 1; j < layers.length && layers[j]?.ty === 3; j++) leftBelow.add(j)
  if (identity) {
    const keepsInd = (ind: unknown) => {
      const k = isFiniteNumber(ind) ? innerByInd.get(ind) : undefined
      return k !== undefined && (merged.has(k) || absorbed.has(k))
    }
    const taken = new Set<number>()
    for (let changed = true; changed;) {
      changed = false
      copies.forEach((copy, k) => {
        if (!keep[k] || merged.has(k) || absorbed.has(k)) return
        const j = outsideAt(copy.ind)
        if (j === undefined || taken.has(j)) return
        const other = layers[j]
        if (!sameTransform(copy, other)) return
        const innerParent = isFiniteNumber(copy.parent) ? innerByInd.get(copy.parent) : undefined
        if (innerParent !== undefined && !keepsInd(copy.parent)) return
        if (other.parent !== (innerParent === undefined ? precomp.parent : copy.parent)) return
        const absorbable = other.ty === 3 && !(other.ef?.length ?? 0)
        // Two nulls: drop the copy precompose made (else the one left right below this layer).
        const outsideIsCopy = parentCopies.has(baseOf(other))
        const insideIsCopy = parentCopies.has(innerBase[k])
        const preferAbsorb = copy.ty !== 3 || outsideIsCopy || (!insideIsCopy && leftBelow.has(j))
        if (absorbable && preferAbsorb) absorbed.set(k, j)
        else if (copy.ty === 3) merged.add(k)
        else return
        taken.add(j)
        changed = true
      })
    }
  }

  // Inds: merged nulls resolve to the layer they stand for, absorbed layers keep theirs (the
  // null they replace goes). The others keep theirs when all are free here, otherwise they get
  // fresh consecutive ones (document order keeps `ind − 1` matte lookups working).
  const removed = new Set<number>([index, ...absorbed.values()])
  const takenInds = new Set<number>()
  layers.forEach((l, j) => {
    if (removed.has(j)) return
    for (const v of [l.ind, l.parent, l.tp]) if (isFiniteNumber(v)) takenInds.add(v)
  })
  let next = freshInd(layers)
  const nullInd = identity ? undefined : isFiniteNumber(precomp.ind) ? precomp.ind : next++
  if (nullInd !== undefined) takenInds.add(nullInd)
  const others = copies.flatMap((_, k) =>
    keep[k] && !merged.has(k) && !absorbed.has(k) ? [k] : [],
  )
  const ownInds = others.map((k) => copies[k].ind)
  const keepOwn = ownInds.every(
    (ind, n) => isFiniteNumber(ind) && !takenInds.has(ind) && ownInds.indexOf(ind) === n,
  )
  const indMap = new Map<number, number>()
  const mapInd = (old: unknown, ind: number) => {
    if (isFiniteNumber(old) && !indMap.has(old)) indMap.set(old, ind)
  }
  copies.forEach((copy, k) => {
    if (merged.has(k) || absorbed.has(k)) mapInd(copy.ind, copy.ind as number)
  })
  for (const k of others) {
    const old = copies[k].ind
    const ind = keepOwn ? (old as number) : next++
    copies[k].ind = ind
    mapInd(old, ind)
  }

  const rootParent = identity ? precomp.parent : nullInd
  const released = copies.filter((_, k) => keep[k] && !merged.has(k))
  const sources = copies.flatMap((_, k) =>
    keep[k] && !merged.has(k) ? [[...compLayersPathOf(found.index), k] as NodePath] : [],
  )
  released.forEach((copy, k) => {
    if (isFiniteNumber(copy.parent) && indMap.has(copy.parent))
      copy.parent = indMap.get(copy.parent)
    else if (isFiniteNumber(rootParent)) copy.parent = rootParent
    else delete copy.parent
    if (copy.tp !== undefined) {
      if (isFiniteNumber(copy.tp) && indMap.has(copy.tp)) copy.tp = indMap.get(copy.tp)
      else {
        delete copy.tp
        delete copy.tt
      }
    } else if (copy.tt && k === 0) {
      // A position-based matte needs a source above it in the precomp: this one never had one.
      delete copy.tt
    }
    if (precomp.hd === true) copy.hd = true
  })

  const opacity = groupOpacity(precomp)
  let visible = 0
  if (opacity) {
    for (const copy of released) {
      // Nulls draw nothing; a matte source's opacity is the matte's: the group opacity applies
      // to the matted result, i.e. to the target.
      if (copy.ty === 3 || copy.td) continue
      if (copy.hd !== true) visible++
      multiplyOpacity(copy, opacity)
    }
  }

  let nul: Layer | null = null
  if (!identity) {
    nul = parentProxy(precomp) as Layer
    nul.ind = nullInd
    // The opacity went to the released layers (parents never pass it on).
    if (nul.ks) nul.ks.o = { a: 0, k: 100 }
    // Expression controls stay reachable under the same layer name.
    if (Array.isArray(precomp.ef) && precomp.ef.length) nul.ef = cloneNode(precomp.ef)
  } else if (isFiniteNumber(precomp.ind) && byInd.get(precomp.ind) === index) {
    // Layers of this composition parented to the precomp layer follow its parent instead.
    layers.forEach((layer, j) => {
      if (removed.has(j) || layer.parent !== precomp.ind) return
      if (isFiniteNumber(precomp.parent)) layer.parent = precomp.parent
      else delete layer.parent
    })
  }

  const somethingBelow = layers
    .slice(index + 1)
    .some((l, j) => !removed.has(index + 1 + j) && l.ty !== 3 && !l.td && l.hd !== true)

  // The null goes above its layers (read first, like After Effects' new nulls), unless the
  // first released layer takes its matte from the layer above.
  const first = released[0]
  const nullBelow = !!first?.tt && first.tp === undefined
  const inserted = nul ? (nullBelow ? [...released, nul] : [nul, ...released]) : released
  // Last first, so the earlier indices stay valid.
  for (const j of [...removed].sort((a, b) => b - a)) {
    if (j === index) layers.splice(index, 1, ...inserted)
    else layers.splice(j, 1)
  }
  return {
    released,
    sources,
    nul,
    splitOpacity: !!opacity && visible > 1,
    // Blending with nothing below changes nothing.
    blendModes: somethingBelow && released.some((l) => !!l.bm && l.ty !== 3 && !l.td),
  }
}

/** Path of `target` (a layer object) in any composition of `anim`, found by identity. */
function locateLayer(anim: Animation, target: Layer): NodePath | null {
  for (const comp of listComps(anim)) {
    const i = comp.layers.indexOf(target)
    if (i >= 0) return [...comp.layersPath, i]
  }
  return null
}

/**
 * Releases precomp layers ("unprecompose"): each one is replaced, at its place, by the layers of
 * its composition, rendering exactly as before at every frame:
 *  - its transform (animation, parent, auto-orient) goes to a null with its name and `ind`
 *    that parents the released layers — unless it is an identity, then they take its parent;
 *    layers of the composition parented to the precomp layer keep following it;
 *  - times map through `outer = inner · sr + st` (in/out points, start times, stretch and every
 *    keyframe), in/out points are clipped to the precomp layer's, layers never visible through
 *    it are dropped;
 *  - opacity and visibility are applied to the released layers;
 *  - `ind`s are renumbered (consecutive, in document order), `parent`/`tp` links follow.
 * Compositions nothing uses anymore are removed from `assets`. Layers with a `releaseBlocker`
 * are skipped. The precomp's clip to `w × h` is gone: see `releaseRevealsContent`.
 */
export function releasePrecomps(anim: Animation, paths: readonly NodePath[]): ReleaseResult {
  const result: ReleaseResult = {
    layers: [],
    origins: [],
    nulls: [],
    skipped: [],
    removedAssets: [],
    splitOpacity: false,
    blendModes: false,
  }
  const releasedLayers: Layer[] = []
  const sources: NodePath[] = []
  const nulls: Layer[] = []
  const assetIds = new Set<string>()
  // Compositions used by one layer only go away with its release: their layers can move.
  const uses = new Map<string, number>()
  forEachLayer(anim, (layer) => {
    const ref = refIdOf(layer)
    if (ref !== undefined && layer.ty === 0) uses.set(ref, (uses.get(ref) ?? 0) + 1)
  })
  for (const { compPath, indices } of groupLayersByComp(paths)) {
    const layers = layersAt(anim, compPath)
    if (!layers) continue
    // Inside an immer recipe, an element that a splice shifted reads back as the frozen original
    // (immer tracks drafts by index): draft them all before anything moves. Releases may also
    // remove null copies above them, so each precomp layer is found again by identity.
    const targets = indices.map((i) => layers[i])
    for (let i = 0; i < layers.length; i++) void layers[i]
    for (let k = targets.length - 1; k >= 0; k--) {
      const index = layers.indexOf(targets[k])
      if (index < 0) continue
      const path = [...compPath, index]
      const reason = releaseBlocker(anim, path)
      if (reason) {
        if (reason !== 'not-precomp') result.skipped.unshift({ path, reason })
        continue
      }
      const refId = (layers[index] as PrecompLayer).refId
      assetIds.add(refId)
      const one = releaseOne(anim, layers, index, uses.get(refId) === 1)
      releasedLayers.push(...one.released)
      sources.push(...one.sources)
      if (one.nul) nulls.push(one.nul)
      if (one.splitOpacity) result.splitOpacity = true
      if (one.blendModes) result.blendModes = true
    }
  }

  // Unused compositions go last: removing an asset shifts the paths of the following ones.
  if (assetIds.size && Array.isArray(anim.assets)) {
    const used = new Set<string>()
    forEachLayer(anim, (layer) => {
      const ref = refIdOf(layer)
      if (ref !== undefined && assetIds.has(ref)) used.add(ref)
    })
    for (let i = anim.assets.length - 1; i >= 0; i--) {
      const id = anim.assets[i]?.id
      if (assetIds.has(id) && !used.has(id)) {
        anim.assets.splice(i, 1)
        result.removedAssets.unshift(id)
      }
    }
  }

  releasedLayers.forEach((l, k) => {
    const at = locateLayer(anim, l)
    if (at) result.origins.push([sources[k], at])
  })
  result.layers = result.origins.map(([, at]) => at).sort(comparePaths)
  result.nulls = nulls
    .map((l) => locateLayer(anim, l))
    .filter((p): p is NodePath => !!p)
    .sort(comparePaths)
  return result
}

/**
 * True if releasing the precomp layer at `path` would show content its composition clips away:
 * content outside its `w × h` frame that the enclosing frame (the canvas, or the composition
 * the layer is in) would show. Samples at most `samples` frames of its in/out range.
 */
export function releaseRevealsContent(
  anim: Animation,
  path: NodePath,
  opts: { samples?: number } = {},
): boolean {
  const layer = isLayerPath(path) ? getAt<Layer>(anim, path) : undefined
  if (!layer || !isPrecompLayer(layer) || layer.hd === true) return false
  const { w, h } = layer
  if (!isFiniteNumber(w) || !isFiniteNumber(h) || w <= 0 || h <= 0) return false
  const from = Math.ceil(layer.ip)
  const to = Math.ceil(layer.op) - 1
  if (!(to >= from)) return false
  const outer = compFrameSize(anim, compPathOf(path))
  const count = Math.max(1, Math.min(opts.samples ?? 90, to - from + 1))
  const tolerance = 0.5
  for (let k = 0; k < count; k++) {
    const frame = count === 1 ? from : Math.round(from + ((to - from) * k) / (count - 1))
    let box = precompContentBounds(anim, layer, frame, {
      clip: false,
      emptyPrecomp: 'null',
      includeStroke: true,
    })
    // What the enclosing frame shows, in the precomp layer's space (bounds of its preimage).
    const inverse = invertMatrix(worldMatrix(anim, path, frame))
    if (box && inverse) {
      box = intersectBoxes(box, transformBox({ x: 0, y: 0, w: outer.w, h: outer.h }, inverse))
    }
    if (
      box &&
      (box.x < -tolerance ||
        box.y < -tolerance ||
        box.x + box.w > w + tolerance ||
        box.y + box.h > h + tolerance)
    )
      return true
  }
  return false
}
