/**
 * Scene-level semantic equivalence: do two documents draw the same thing at every frame?
 *
 * `buildScene(anim, frame)` evaluates a document the way a renderer does — composition order,
 * layer ranges, parenting, precomposition time mapping and clipping, mattes, masks, shape style
 * scopes, group transforms and opacity — without rasterizing: it produces the ordered list of
 * paint operations with their world-space geometry (composition pixels), opacity, colors and
 * parameters. `verifySemantic(a, b)` compares the scenes of two documents frame by frame within
 * tolerances. It is deliberately independent of the document's structure: removing a hidden
 * layer, an empty group or a redundant keyframe leaves the scene unchanged, while any visible
 * difference (a moved vertex, a changed color, a missing shape) shows up.
 *
 * Semantics follow After Effects as the editor previews it: hidden items (including groups and
 * modifiers, which lottie-web alone ignores) are not drawn; modifiers and effects are compared
 * by their evaluated parameters, not applied.
 */
import {
  applyMatrix,
  groupTransform,
  IDENTITY_MATRIX,
  layerMatrix,
  matrixSingularValues,
  multiplyMatrices,
  shapeToBezier,
  transformMatrix,
  type Matrix2D,
} from '../bounds'
import { evaluateArray, evaluatePath, evaluateScalar, evaluateTextDocument } from '../property'
import { precompInnerFrame } from '../time'
import type {
  Animation,
  BezierPath,
  Layer,
  PrecompLayer,
  ShapeItem,
  TextLayer,
  Transform,
} from '../types'
import { arr, isObj, num, parseVersion, versionBelow, type Json } from './model'
import type { SemanticMismatch, SemanticReport, SemanticTolerance } from './types'

/* -------------------------------------------------------------------------- */
/*                                    Scene                                   */
/* -------------------------------------------------------------------------- */

export interface ScenePath {
  closed: boolean
  /** World control points per vertex: v, v + i, v + o (x, y each). */
  points: number[]
}

export interface SceneMask {
  key: string
  opacity: number
  /** World geometry of the mask path and the expansion (world px). */
  path: ScenePath | null
  expansion: number
}

export interface SceneOp {
  kind: string
  /** Human-readable origin (for mismatch messages). */
  where: string
  /** Discrete parameters that must be identical (types, rules, caps, counts, text, images). */
  key: string
  opacity: number
  /** Geometry of the painted paths (world px). */
  paths: ScenePath[]
  /** Other world-space lengths (stroke width, dashes, gradient points, image corners), px. */
  lengths: number[]
  /** Color channels 0..1 (fill / stroke color, gradient data). */
  colors: number[]
  /** Everything else (modifier parameters, effect values…), in their own units. */
  other: number[]
  masks: SceneMask[]
  matte: { mode: number; ops: SceneOp[] } | null
  /** Precomposition clip rectangles (world corners). */
  clips: number[]
}

interface Env {
  anim: Animation
  fps: number
  assets: Map<string, Json>
  legacyColors: boolean
  legacyClosed: boolean
  ignoreImageData: boolean
  visiting: Set<string>
}

const STYLES = new Set(['fl', 'st', 'gf', 'gs'])
const GEOMETRY = new Set(['sh', 'rc', 'el', 'sr'])
const MODIFIERS = new Set(['tm', 'rp', 'rd', 'mm', 'op', 'pb', 'tw', 'zz'])

/** Linear scale of a matrix (geometric mean of the singular values). */
function matScale(m: Matrix2D): number {
  const [a, b] = matrixSingularValues(m)
  return Math.sqrt(Math.abs(a * b))
}

function worldPath(p: BezierPath | null, m: Matrix2D, closedFallback: boolean): ScenePath | null {
  if (!p || !Array.isArray(p.v) || p.v.length === 0) return null
  const points: number[] = []
  for (let k = 0; k < p.v.length; k++) {
    const v = p.v[k] ?? [0, 0]
    const i = p.i?.[k] ?? [0, 0]
    const o = p.o?.[k] ?? [0, 0]
    const vx = v[0] ?? 0
    const vy = v[1] ?? 0
    points.push(...applyMatrix(m, vx, vy))
    points.push(...applyMatrix(m, vx + (i[0] ?? 0), vy + (i[1] ?? 0)))
    points.push(...applyMatrix(m, vx + (o[0] ?? 0), vy + (o[1] ?? 0)))
  }
  const closed = typeof p.c === 'boolean' ? p.c : closedFallback
  return { closed, points }
}

function rectCorners(m: Matrix2D, w: number, h: number): number[] {
  return [
    ...applyMatrix(m, 0, 0),
    ...applyMatrix(m, w, 0),
    ...applyMatrix(m, w, h),
    ...applyMatrix(m, 0, h),
  ]
}

function evalNums(prop: unknown, frame: number): number[] {
  return isObj(prop) ? evaluateArray(prop as never, frame) : []
}

/** Parameters of a modifier at a frame: [type key, numbers]. */
function modifierParams(item: Json, frame: number): { key: string; nums: number[] } {
  const nums: number[] = []
  const add = (...props: unknown[]) => {
    for (const p of props) nums.push(...evalNums(p, frame))
  }
  switch (item.ty) {
    case 'tm':
      add(item.s, item.e, item.o)
      return { key: `tm${String(item.m ?? 1)}`, nums }
    case 'rp': {
      add(item.c, item.o)
      const tr = isObj(item.tr) ? item.tr : {}
      add(tr.p, tr.a, tr.s, tr.r, tr.so, tr.eo)
      return { key: `rp${String(item.m ?? 1)}`, nums }
    }
    case 'rd':
      add(item.r)
      return { key: 'rd', nums }
    case 'mm':
      return { key: `mm${String(item.mm ?? 1)}`, nums }
    case 'op':
      add(item.a, item.ml)
      return { key: `op${String(item.lj ?? 1)}`, nums }
    case 'pb':
      add(item.a)
      return { key: 'pb', nums }
    case 'tw':
      add(item.a, item.c)
      return { key: 'tw', nums }
    case 'zz':
      add(item.s, item.r, item.pt)
      return { key: 'zz', nums }
    default:
      return { key: String(item.ty), nums }
  }
}

interface Geo {
  path: ScenePath
  mods: string
  modNums: number[]
}

/**
 * Geometry painted by a style at `end` in `items`: every path above it, in nested groups too,
 * with the modifiers that apply to it (the ones below it in its group and enclosing groups).
 */
function collectGeometry(
  items: readonly Json[],
  end: number,
  m: Matrix2D,
  frame: number,
  env: Env,
  outerMods: { key: string; nums: number[] }[],
  out: Geo[],
  depth: number,
): void {
  if (depth > 64) return
  // Modifiers at index j apply to items above j in this group.
  const modsAt: { key: string; nums: number[] }[][] = []
  let running: { key: string; nums: number[] }[] = []
  for (let j = end - 1; j >= 0; j--) {
    modsAt[j] = running
    const it = items[j]
    if (it && it.hd !== true && MODIFIERS.has(String(it.ty)))
      running = [modifierParams(it, frame), ...running]
  }
  for (let j = 0; j < end; j++) {
    const it = items[j]
    if (!it || it.hd === true) continue
    const mods = [...(modsAt[j] ?? []), ...outerMods]
    if (GEOMETRY.has(String(it.ty))) {
      const p = worldPath(
        shapeToBezier(it as unknown as ShapeItem, frame),
        m,
        env.legacyClosed && it.closed === true,
      )
      if (p)
        out.push({
          path: p,
          mods: mods.map((x) => x.key).join(','),
          modNums: mods.flatMap((x) => x.nums),
        })
    } else if (it.ty === 'gr') {
      const children = arr(it.it).filter(isObj)
      const gm = multiplyMatrices(
        m,
        transformMatrix(groupTransform(it as never) as Transform | undefined, frame),
      )
      collectGeometry(children, children.length, gm, frame, env, mods, out, depth + 1)
    }
  }
}

function styleOp(
  item: Json,
  frame: number,
  m: Matrix2D,
  opacity: number,
  geo: Geo[],
  env: Env,
  where: string,
): SceneOp {
  const o = (evaluateScalar(item.o as never, frame, 100) / 100) * opacity
  const scale = matScale(m)
  const lengths: number[] = []
  const colors: number[] = []
  const other: number[] = []
  let key = `${String(item.ty)}|bm${String(item.bm ?? 0)}`
  if (item.ty === 'fl' || item.ty === 'st') {
    const c = evalNums(item.c, frame).slice(0, 3)
    colors.push(...c.map((v) => (env.legacyColors ? v / 255 : v)))
  }
  if (item.ty === 'fl' || item.ty === 'gf') key += `|r${String(item.r ?? 1)}`
  if (item.ty === 'st' || item.ty === 'gs') {
    key += `|lc${String(item.lc ?? 2)}|lj${String(item.lj ?? 2)}`
    lengths.push(evaluateScalar(item.w as never, frame, 0) * scale)
    if ('ml' in item) other.push(num(item.ml) ?? 0)
    if ('ml2' in item) other.push(evaluateScalar(item.ml2 as never, frame, 0))
    const dashes = arr(item.d).filter(isObj)
    key += `|d${dashes.map((d) => String(d.n)).join('')}`
    for (const d of dashes) lengths.push(evaluateScalar(d.v as never, frame, 0) * scale)
  }
  if (item.ty === 'gf' || item.ty === 'gs') {
    const g = isObj(item.g) ? item.g : {}
    key += `|t${String(item.t ?? 1)}|p${String(g.p ?? 0)}`
    const s = evalNums(item.s, frame)
    const e = evalNums(item.e, frame)
    lengths.push(...applyMatrix(m, s[0] ?? 0, s[1] ?? 0), ...applyMatrix(m, e[0] ?? 0, e[1] ?? 0))
    colors.push(...evalNums(g.k, frame))
    if (item.t === 2)
      other.push(
        evaluateScalar(item.h as never, frame, 0),
        evaluateScalar(item.a as never, frame, 0),
      )
  }
  // Vertex counts are not part of the key: simplified paths are compared by shape distance.
  key += `|n${geo.length}|${geo.map((g) => `${g.path.closed ? 'c' : 'o'}:${g.mods}`).join(';')}`
  for (const g of geo) other.push(...g.modNums)
  return {
    kind: String(item.ty),
    where,
    key,
    opacity: o,
    paths: geo.map((g) => g.path),
    lengths,
    colors,
    other,
    masks: [],
    matte: null,
    clips: [],
  }
}

/** Paint operations of shape items (bottom to top). */
function shapeOps(
  items: readonly Json[],
  frame: number,
  m: Matrix2D,
  opacity: number,
  env: Env,
  where: string,
  out: SceneOp[],
  depth: number,
): void {
  if (depth > 64) return
  for (let s = items.length - 1; s >= 0; s--) {
    const it = items[s]
    if (!it || it.hd === true) continue
    if (STYLES.has(String(it.ty))) {
      const geo: Geo[] = []
      collectGeometry(items, s, m, frame, env, [], geo, depth)
      if (geo.length) out.push(styleOp(it, frame, m, opacity, geo, env, `${where}/${s}`))
    } else if (it.ty === 'gr') {
      const tr = groupTransform(it as never) as Transform | undefined
      const gm = multiplyMatrices(m, transformMatrix(tr, frame))
      const go = tr?.o ? evaluateScalar(tr.o, frame, 100) / 100 : 1
      shapeOps(
        arr(it.it).filter(isObj),
        frame,
        gm,
        opacity * go,
        env,
        `${where}/${s}`,
        out,
        depth + 1,
      )
    }
  }
}

function parentMatrix(layers: readonly Json[], layer: Json, frame: number): Matrix2D {
  let m: Matrix2D = IDENTITY_MATRIX
  const seen = new Set<Json>([layer])
  let parentInd = num(layer.parent)
  while (parentInd !== undefined) {
    const parent = layers.find((l) => l.ind === parentInd)
    if (!parent || seen.has(parent)) break
    seen.add(parent)
    m = multiplyMatrices(layerMatrix(parent as unknown as Layer, frame), m)
    parentInd = num(parent.parent)
  }
  return m
}

/** Keys that only name or index things (never drawn). */
const NAME_KEYS = new Set(['nm', 'mn', 'ix', 'cix', 'np', 'cl', 'ln'])

/**
 * Evaluates an arbitrary subtree (effects, layer styles, text animators): properties become
 * their values at `frame`, everything else its structure. Keyframe storage (legacy `e`, easing
 * names) and names do not matter, only what the subtree evaluates to.
 */
function evalTree(node: unknown, frame: number, key: string[], nums: number[], depth = 0): void {
  if (depth > 32) return
  if (Array.isArray(node)) {
    key.push(`[${node.length}`)
    for (const x of node) evalTree(x, frame, key, nums, depth + 1)
    key.push(']')
    return
  }
  if (isObj(node)) {
    if ('k' in node && (isObj(node.k) || Array.isArray(node.k) || typeof node.k === 'number')) {
      key.push(typeof node.x === 'string' ? 'Px' : 'P')
      nums.push(...evalNums(node, frame))
      return
    }
    key.push('{')
    for (const k of Object.keys(node).sort()) {
      if (NAME_KEYS.has(k)) continue
      key.push(k)
      evalTree(node[k], frame, key, nums, depth + 1)
    }
    key.push('}')
    return
  }
  if (typeof node === 'number') nums.push(node)
  else key.push(JSON.stringify(node) ?? '')
}

function effectSignature(layer: Json, frame: number): { key: string; nums: number[] } {
  const nums: number[] = []
  const key: string[] = []
  if (arr(layer.ef).length) evalTree(layer.ef, frame, key, nums)
  if (arr(layer.sy).length) evalTree(layer.sy, frame, key, nums)
  return { key: key.join(''), nums }
}

function isDrawnLayer(layer: Json, frame: number): boolean {
  if (layer.hd === true) return false
  const ip = num(layer.ip) ?? -Infinity
  const op = num(layer.op) ?? Infinity
  if (!(frame >= ip && frame < op)) return false
  // Null, audio, camera, data and unknown layers draw nothing.
  return layer.ty === 0 || layer.ty === 1 || layer.ty === 2 || layer.ty === 4 || layer.ty === 5
}

function matteSource(layers: readonly Json[], i: number): number {
  const layer = layers[i]
  if (typeof layer.tp === 'number') return layers.findIndex((l) => l.ind === layer.tp)
  return i - 1
}

/** Paint operations of one layer (its content with masks, matte, effects and blend). */
function layerOps(
  layers: readonly Json[],
  i: number,
  frame: number,
  m: Matrix2D,
  env: Env,
  where: string,
  depth: number,
  asMatte = false,
): SceneOp[] {
  const layer = layers[i]
  if (!layer || depth > 32) return []
  if (!asMatte && layer.td !== undefined && layer.td !== 0) return []
  if (!isDrawnLayer(layer, frame)) return []
  const lm = multiplyMatrices(
    m,
    multiplyMatrices(
      parentMatrix(layers, layer, frame),
      layerMatrix(layer as unknown as Layer, frame),
    ),
  )
  const opacity =
    evaluateScalar(isObj(layer.ks) ? (layer.ks.o as never) : undefined, frame, 100) / 100
  if (!(opacity > 1e-6)) return []
  const here = `${where}/L${String(layer.ind ?? i)}(${String(layer.nm ?? '')})`
  let ops: SceneOp[] = []
  switch (layer.ty) {
    case 4:
      shapeOps(arr(layer.shapes).filter(isObj), frame, lm, opacity, env, here, ops, 0)
      break
    case 1: {
      const w = num(layer.sw) ?? 0
      const h = num(layer.sh) ?? 0
      ops.push(
        plainOp(
          'solid',
          here,
          `sc${String(layer.sc ?? '').toLowerCase()}`,
          opacity,
          rectCorners(lm, w, h),
        ),
      )
      break
    }
    case 2: {
      const asset = env.assets.get(String(layer.refId))
      const w = num(asset?.w) ?? 0
      const h = num(asset?.h) ?? 0
      const data = env.ignoreImageData
        ? ''
        : `${String(asset?.u ?? '')}${String(asset?.p ?? '').length}:${hash(String(asset?.p ?? ''))}`
      ops.push(plainOp('image', here, `img${w}x${h}${data}`, opacity, rectCorners(lm, w, h)))
      break
    }
    case 5: {
      const t = (layer as unknown as TextLayer).t
      const doc = evaluateTextDocument(t, frame)
      const parts: string[] = []
      const nums: number[] = []
      evalTree([t?.a ?? null, t?.p ?? null, t?.m ?? null], frame, parts, nums)
      const op = plainOp(
        'text',
        here,
        `text${JSON.stringify(doc)}|${parts.join('')}`,
        opacity,
        rectCorners(lm, 100, 100),
      )
      op.other.push(...nums)
      ops.push(op)
      break
    }
    case 0: {
      const refId = String(layer.refId)
      const asset = env.assets.get(refId)
      if (!asset || env.visiting.has(refId)) break
      env.visiting.add(refId)
      const inner = precompInnerFrame(layer as unknown as PrecompLayer, frame, env.fps)
      const innerLayers = arr(asset.layers).filter(isObj)
      for (let j = innerLayers.length - 1; j >= 0; j--)
        ops.push(...layerOps(innerLayers, j, inner, lm, env, here, depth + 1))
      env.visiting.delete(refId)
      const clip = rectCorners(lm, num(layer.w) ?? 0, num(layer.h) ?? 0)
      for (const op of ops) {
        op.opacity *= opacity
        op.clips.push(...clip)
      }
      break
    }
  }
  // Masks, effects and blend mode apply to everything the layer paints.
  const masks: SceneMask[] = []
  if (layer.hasMask !== false) {
    for (const mask of arr(layer.masksProperties)) {
      if (!isObj(mask)) continue
      const path = worldPath(
        evaluatePath(mask.pt as never, frame),
        lm,
        env.legacyClosed && mask.cl === true,
      )
      masks.push({
        key: `${String(mask.mode ?? 'a')}${mask.inv === true ? 'i' : ''}`,
        opacity: evaluateScalar(mask.o as never, frame, 100) / 100,
        path,
        expansion: evaluateScalar(mask.x as never, frame, 0) * matScale(lm),
      })
    }
  }
  const fx = effectSignature(layer, frame)
  let matte: SceneOp['matte'] = null
  const tt = num(layer.tt) ?? 0
  if (tt > 0) {
    const src = matteSource(layers, i)
    matte = {
      mode: tt,
      ops: src >= 0 ? layerOps(layers, src, frame, m, env, `${here}/matte`, depth + 1, true) : [],
    }
  }
  const bm = String(layer.bm ?? 0)
  ops = ops.filter((op) => op.opacity > 1e-6)
  for (const op of ops) {
    op.key += `|L:bm${bm}|fx${fx.key}`
    op.other.push(...fx.nums)
    if (masks.length) op.masks.push(...masks)
    if (matte && !op.matte) op.matte = matte
    else if (matte && op.matte)
      op.matte = { mode: matte.mode, ops: [...matte.ops, ...op.matte.ops] }
  }
  return ops
}

function plainOp(
  kind: string,
  where: string,
  key: string,
  opacity: number,
  corners: number[],
): SceneOp {
  return {
    kind,
    where,
    key: `${kind}|${key}`,
    opacity,
    paths: [],
    lengths: corners,
    colors: [],
    other: [],
    masks: [],
    matte: null,
    clips: [],
  }
}

/** Small string hash (FNV-1a) for image identity. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

export interface SceneOptions {
  /** Compare embedded images by display size only (their pixels were re-encoded). */
  ignoreImageData?: boolean
}

function makeEnv(anim: Animation, opts: SceneOptions): Env {
  const doc = anim as unknown as Json
  const assets = new Map<string, Json>()
  for (const a of arr(doc.assets))
    if (isObj(a) && typeof a.id === 'string' && !assets.has(a.id)) assets.set(a.id, a)
  const version = parseVersion(doc.v)
  return {
    anim,
    fps: num(doc.fr) ?? 30,
    assets,
    legacyColors: versionBelow(version, [4, 1, 9]),
    legacyClosed: versionBelow(version, [4, 4, 18]),
    ignoreImageData: !!opts.ignoreImageData,
    visiting: new Set(),
  }
}

/** The paint operations of the root composition at `frame`, bottom to top. */
export function buildScene(anim: Animation, frame: number, opts: SceneOptions = {}): SceneOp[] {
  const env = makeEnv(anim, opts)
  const layers = arr((anim as unknown as Json).layers).filter(isObj)
  const ops: SceneOp[] = []
  for (let i = layers.length - 1; i >= 0; i--)
    ops.push(...layerOps(layers, i, frame, IDENTITY_MATRIX, env, '', 0))
  return ops
}

/* -------------------------------------------------------------------------- */
/*                                 Comparison                                 */
/* -------------------------------------------------------------------------- */

export const DEFAULT_SEMANTIC_TOLERANCE: SemanticTolerance = {
  geometry: 0.1,
  opacity: 0.005,
  color: 0.005,
  other: 0.01,
}

interface Acc {
  report: SemanticReport
  tol: SemanticTolerance
  frame: number
  limit: number
}

function mismatch(acc: Acc, kind: string, detail: string, error?: number): void {
  acc.report.equivalent = false
  if (acc.report.mismatches.length < acc.limit)
    acc.report.mismatches.push({
      frame: acc.frame,
      kind,
      detail,
      ...(error !== undefined ? { error } : {}),
    })
}

function maxAbsDiff(a: readonly number[], b: readonly number[]): number {
  let m = 0
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}

/** Points along a world path (8 per segment) for shape-distance comparison. */
function polyline(p: ScenePath): number[] {
  const pts = p.points
  const n = pts.length / 6
  const out: number[] = []
  const segs = p.closed ? n : n - 1
  for (let k = 0; k < segs; k++) {
    const a = k * 6
    const b = ((k + 1) % n) * 6
    const x0 = pts[a]
    const y0 = pts[a + 1]
    const x1 = pts[a + 4]
    const y1 = pts[a + 5]
    const x2 = pts[b + 2]
    const y2 = pts[b + 3]
    const x3 = pts[b]
    const y3 = pts[b + 1]
    for (let s = 0; s < 8; s++) {
      const t = s / 8
      const mt = 1 - t
      out.push(
        mt * mt * mt * x0 + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
        mt * mt * mt * y0 + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
      )
    }
  }
  if (!p.closed && n > 0) out.push(pts[(n - 1) * 6], pts[(n - 1) * 6 + 1])
  return out
}

function segDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Largest distance from the points of `a` to the polyline `b` (grid-accelerated). */
function oneSided(a: readonly number[], b: readonly number[], cell: number): number {
  const grid = new Map<string, number[]>()
  const segCount = b.length / 2 - 1
  for (let s = 0; s < segCount; s++) {
    const x0 = Math.floor(Math.min(b[2 * s], b[2 * s + 2]) / cell)
    const x1 = Math.floor(Math.max(b[2 * s], b[2 * s + 2]) / cell)
    const y0 = Math.floor(Math.min(b[2 * s + 1], b[2 * s + 3]) / cell)
    const y1 = Math.floor(Math.max(b[2 * s + 1], b[2 * s + 3]) / cell)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) continue
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++) {
        const k = `${gx},${gy}`
        const list = grid.get(k)
        if (list) list.push(s)
        else grid.set(k, [s])
      }
  }
  let worst = 0
  for (let p = 0; p < a.length; p += 2) {
    const px = a[p]
    const py = a[p + 1]
    const gx = Math.floor(px / cell)
    const gy = Math.floor(py / cell)
    let best = Infinity
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        for (const s of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          best = Math.min(
            best,
            segDistance(px, py, b[2 * s], b[2 * s + 1], b[2 * s + 2], b[2 * s + 3]),
          )
        }
      }
    // Nothing nearby: at least one cell away.
    worst = Math.max(worst, Number.isFinite(best) ? best : cell)
  }
  return worst
}

/** Deviation between two world paths: point-wise when the vertex counts match, else shape distance. */
function pathDeviation(a: ScenePath, b: ScenePath, tol: number): number {
  if (a.closed !== b.closed) return Infinity
  if (a.points.length === b.points.length) return maxAbsDiff(a.points, b.points)
  const pa = polyline(a)
  const pb = polyline(b)
  const cell = Math.max(tol * 4, 0.5)
  return Math.max(oneSided(pa, pb, cell), oneSided(pb, pa, cell))
}

function compareNums(
  acc: Acc,
  kind: 'geometry' | 'color' | 'other',
  a: readonly number[],
  b: readonly number[],
  where: string,
): void {
  if (a.length !== b.length) {
    mismatch(acc, 'structure', `${where}: ${kind} count ${a.length} ≠ ${b.length}`)
    return
  }
  const d = maxAbsDiff(a, b)
  const r = acc.report
  if (kind === 'geometry') r.maxGeometry = Math.max(r.maxGeometry, d)
  else if (kind === 'color') r.maxColor = Math.max(r.maxColor, d)
  else r.maxOther = Math.max(r.maxOther, d)
  const limit =
    kind === 'geometry' ? acc.tol.geometry : kind === 'color' ? acc.tol.color : acc.tol.other
  if (d > limit) mismatch(acc, kind, where, d)
}

function compareOps(acc: Acc, a: readonly SceneOp[], b: readonly SceneOp[], where: string): void {
  if (a.length !== b.length) {
    const ka = a
      .map((o) => o.where)
      .slice(0, 6)
      .join(', ')
    const kb = b
      .map((o) => o.where)
      .slice(0, 6)
      .join(', ')
    mismatch(
      acc,
      'structure',
      `${where}: ${a.length} paint operations ≠ ${b.length} [${ka}] vs [${kb}]`,
    )
    return
  }
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    const at = `${where}${x.where}`
    if (x.key !== y.key || x.paths.length !== y.paths.length) {
      mismatch(acc, 'structure', `${at}: ${x.key.slice(0, 160)} ≠ ${y.key.slice(0, 160)}`)
      continue
    }
    const dOpacity = Math.abs(x.opacity - y.opacity)
    acc.report.maxOpacity = Math.max(acc.report.maxOpacity, dOpacity)
    if (dOpacity > acc.tol.opacity) mismatch(acc, 'opacity', at, dOpacity)
    for (let p = 0; p < x.paths.length; p++) {
      const d = pathDeviation(x.paths[p], y.paths[p], acc.tol.geometry)
      acc.report.maxGeometry = Math.max(acc.report.maxGeometry, d)
      if (d > acc.tol.geometry) mismatch(acc, 'geometry', `${at} path ${p}`, d)
    }
    compareNums(acc, 'geometry', x.lengths, y.lengths, `${at} lengths`)
    compareNums(acc, 'color', x.colors, y.colors, `${at} colors`)
    compareNums(acc, 'other', x.other, y.other, `${at} parameters`)
    compareNums(acc, 'geometry', x.clips, y.clips, `${at} clip`)
    if (x.masks.length !== y.masks.length)
      mismatch(acc, 'structure', `${at}: ${x.masks.length} masks ≠ ${y.masks.length}`)
    else {
      x.masks.forEach((m, k) => {
        const n = y.masks[k]
        if (m.key !== n.key || !m.path !== !n.path) {
          mismatch(acc, 'structure', `${at} mask ${k}`)
          return
        }
        const dm = Math.abs(m.opacity - n.opacity)
        acc.report.maxOpacity = Math.max(acc.report.maxOpacity, dm)
        if (dm > acc.tol.opacity) mismatch(acc, 'opacity', `${at} mask ${k}`, dm)
        if (m.path && n.path) {
          const d = pathDeviation(m.path, n.path, acc.tol.geometry)
          acc.report.maxGeometry = Math.max(acc.report.maxGeometry, d)
          if (d > acc.tol.geometry) mismatch(acc, 'geometry', `${at} mask ${k}`, d)
        }
        compareNums(acc, 'geometry', [m.expansion], [n.expansion], `${at} mask ${k} expansion`)
      })
    }
    if (!x.matte !== !y.matte) mismatch(acc, 'structure', `${at}: matte presence differs`)
    else if (x.matte && y.matte) {
      if (x.matte.mode !== y.matte.mode) mismatch(acc, 'structure', `${at}: matte mode`)
      else compareOps(acc, x.matte.ops, y.matte.ops, `${at} matte:`)
    }
  }
}

export interface VerifySemanticOptions {
  /** Frames to compare (root composition time). Default: every frame and half frame (capped). */
  frames?: number[]
  /** Upper bound on the number of frames when `frames` is not given (default 240). */
  maxFrames?: number
  tolerance?: Partial<SemanticTolerance>
  /** Compare images by display size only. */
  ignoreImageData?: boolean
  /** Mismatches kept in the report (default 20). */
  limit?: number
}

/** Frames to compare: integer and half frames of [ip, op], evenly thinned to `max`. */
export function semanticFrames(anim: Animation, max = 240): number[] {
  const ip = num(anim.ip) ?? 0
  const op = num(anim.op) ?? ip + 1
  const all: number[] = []
  for (let f = ip; f <= op; f += 0.5) all.push(f)
  if (all.length <= max) return all
  const out: number[] = []
  for (let i = 0; i < max; i++) out.push(all[Math.round((i * (all.length - 1)) / (max - 1))])
  return [...new Set(out)]
}

/**
 * Compares what two documents draw at every sampled frame. `equivalent` is true when both
 * scenes have the same paint operations (kinds, order, discrete parameters) and every number
 * is within the tolerances (geometry in composition pixels).
 */
export function verifySemantic(
  a: Animation,
  b: Animation,
  opts: VerifySemanticOptions = {},
): SemanticReport {
  const tol = { ...DEFAULT_SEMANTIC_TOLERANCE, ...opts.tolerance }
  const frames = opts.frames ?? semanticFrames(a, opts.maxFrames)
  const report: SemanticReport = {
    equivalent: true,
    frames: frames.length,
    maxGeometry: 0,
    maxOpacity: 0,
    maxColor: 0,
    maxOther: 0,
    mismatches: [],
  }
  const acc: Acc = { report, tol, frame: 0, limit: opts.limit ?? 20 }
  const sceneOpts = { ignoreImageData: opts.ignoreImageData }
  for (const frame of frames) {
    acc.frame = frame
    compareOps(acc, buildScene(a, frame, sceneOpts), buildScene(b, frame, sceneOpts), '')
  }
  return report
}

/** Mismatches as readable lines (tests, logs). */
export function describeMismatches(list: readonly SemanticMismatch[]): string {
  return list
    .map(
      (m) =>
        `@${m.frame} ${m.kind}: ${m.detail}${m.error !== undefined ? ` (${m.error.toFixed(4)})` : ''}`,
    )
    .join('\n')
}
