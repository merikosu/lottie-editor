/**
 * A still of one frame: a copy of the animation that shows a single frame and nothing else.
 *
 * Every property keeps the value it has at that frame (no keyframes left), content that is not
 * on screen is dropped, and each precomp is baked at the time its instance shows. The result is
 * a small, valid Lottie of any length (1 frame by default), for example a sticker made from a
 * frame of an animation.
 *
 * Time semantics follow lottie-web (see time.ts): keyframe times are in the containing
 * composition's time, a layer is visible while ip ≤ t < op, and a precomp shows its content at
 * `tm ? tm(t)·fr : (t − st) / sr`.
 */
import { makeStatic } from './keyframes'
import {
  evaluateArray,
  evaluateScalar,
  evaluateTextDocument,
  getKeyframes,
  isPropertyLike,
  type AnyProperty,
} from './property'
import type { Animation, Asset, Layer, PrecompAsset, TextLayer } from './types'
import { isPrecompAsset, isPrecompLayer, isSplitPosition, isTextLayer } from './types'

export interface StillOptions {
  /** Length of the still in frames (at the animation's frame rate). Default 1. */
  frames?: number
}

export interface StillResult {
  anim: Animation
  /** Properties whose expression was dropped (the still shows their keyframed value). */
  expressions: number
  /** 3D layers whose auto-orientation could not be kept. */
  lostAutoOrient: number
}

/** Guards against self-referencing precomps in damaged files. */
const MAX_DEPTH = 32

type Json = Record<string, unknown>

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Visits every property under `node` (not descending into properties). */
function forEachProperty(node: unknown, visit: (prop: AnyProperty, key: string) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) forEachProperty(child, visit)
    return
  }
  if (node === null || typeof node !== 'object') return
  for (const [key, child] of Object.entries(node as Json)) {
    if (child === null || typeof child !== 'object') continue
    if (!Array.isArray(child) && isPropertyLike(child)) visit(child, key)
    else forEachProperty(child, visit)
  }
}

/**
 * Rotation (degrees) lottie-web adds for auto-orientation at comp frame `t`: the direction of
 * travel, sampled like lottie-web does (a hundredth of a frame back, or along the first/last
 * segment outside the keyframes).
 */
export function autoOrientAngle(layer: Layer, t: number): number {
  const p = layer.ks?.p
  if (!p) return 0
  let v1: number[]
  let v2: number[]
  if (isSplitPosition(p)) {
    const kx = getKeyframes(p.x)
    const ky = getKeyframes(p.y)
    if (!kx || !ky) return 0
    const at = (f: number) => [evaluateScalar(p.x, f), evaluateScalar(p.y, f)]
    if (t <= kx[0].t) {
      v1 = [evaluateScalar(p.x, kx[0].t + 0.01), evaluateScalar(p.y, ky[0].t + 0.01)]
      v2 = [evaluateScalar(p.x, kx[0].t), evaluateScalar(p.y, ky[0].t)]
    } else if (t >= kx[kx.length - 1].t) {
      const lx = kx[kx.length - 1].t
      const ly = ky[ky.length - 1].t
      v1 = [evaluateScalar(p.x, lx), evaluateScalar(p.y, ly)]
      v2 = [evaluateScalar(p.x, lx - 0.01), evaluateScalar(p.y, ly - 0.01)]
    } else {
      v1 = at(t)
      v2 = at(t - 0.01)
    }
  } else {
    const kfs = getKeyframes(p)
    if (!kfs) return 0
    const at = (f: number) => evaluateArray(p, f)
    const first = kfs[0].t
    const last = kfs[kfs.length - 1].t
    if (t <= first) {
      v1 = at(first + 0.01)
      v2 = at(first)
    } else if (t >= last) {
      v1 = at(last)
      v2 = at(last - 0.05)
    } else {
      v1 = at(t)
      v2 = at(t - 0.01)
    }
  }
  const dx = (v1[0] ?? 0) - (v2[0] ?? 0)
  const dy = (v1[1] ?? 0) - (v2[1] ?? 0)
  return (Math.atan2(dy, dx) * 180) / Math.PI
}

/** Index of the layer used as the track matte of `layers[i]` (-1: none). */
function matteSourceIndex(layers: readonly Layer[], i: number): number {
  const layer = layers[i]
  if (!layer.tt) return -1
  if (isNum(layer.tp)) return layers.findIndex((l) => l.ind === layer.tp)
  return i > 0 && layers[i - 1].td ? i - 1 : -1
}

/** Frame inside a precomp for comp frame `t` (lottie-web, including its time-remap quirk). */
function innerFrame(layer: Layer & { tm?: AnyProperty }, t: number, fps: number): number {
  if (layer.tm) {
    const frame = evaluateScalar(layer.tm, t) * fps
    // lottie-web steps back one frame when the remap lands exactly on the layer's out point.
    return frame === layer.op ? layer.op - 1 : frame
  }
  const sr = layer.sr ? layer.sr : 1
  return (t - (isNum(layer.st) ? layer.st : 0)) / sr
}

interface Needed {
  /** Layers that draw at frame `t`, with the mattes they use. */
  drawn: Set<number>
  /** Drawn layers and the parents moving them. */
  kept: Set<number>
}

/** Layers needed to draw a composition at frame `t`: visible ones, their mattes and parents. */
function neededLayers(layers: readonly Layer[], t: number): Needed {
  const byInd = new Map<number, number>()
  layers.forEach((l, i) => {
    if (isNum(l.ind)) byInd.set(l.ind, i)
  })
  const drawn = new Set<number>()
  const addDrawn = (i: number) => {
    if (i < 0 || drawn.has(i)) return
    drawn.add(i)
    addDrawn(matteSourceIndex(layers, i))
  }
  layers.forEach((l, i) => {
    // A matte source is drawn only as the matte of the layer it belongs to.
    if (!l.td && l.ip <= t && t < l.op) addDrawn(i)
  })
  const kept = new Set<number>()
  const keep = (i: number) => {
    if (i < 0 || kept.has(i)) return
    kept.add(i)
    // Parents move their children even while out of their own in/out range.
    const parent = layers[i].parent
    if (isNum(parent)) keep(byInd.get(parent) ?? -1)
  }
  for (const i of drawn) keep(i)
  return { drawn, kept }
}

/** Keys that only matter to a layer that draws something. */
const CONTENT_KEYS = [
  'shapes',
  't',
  'refId',
  'w',
  'h',
  'sc',
  'sw',
  'sh',
  'tm',
  'masksProperties',
  'hasMask',
  'ef',
  'sy',
  'tt',
  'tp',
  'td',
  'bm',
]

/** A layer kept only to move its children becomes a null: same transform, no content. */
function asNull(layer: Layer): void {
  const json = layer as unknown as Json
  for (const key of CONTENT_KEYS) delete json[key]
  json.ty = 3
}

interface Baker {
  fps: number
  frames: number
  source: Map<string, PrecompAsset>
  versions: Map<string, string>
  baked: PrecompAsset[]
  usedIds: Set<string>
  expressions: number
  lostAutoOrient: number
}

function uniqueId(baker: Baker, base: string): string {
  if (!baker.usedIds.has(base)) return base
  for (let n = 2; ; n++) {
    const id = `${base}_${n}`
    if (!baker.usedIds.has(id)) return id
  }
}

/** Id of the precomp `refId` baked at inner frame `t` (baked on first use). */
function bakedPrecomp(baker: Baker, refId: string, t: number, depth: number): string | null {
  const asset = baker.source.get(refId)
  if (!asset || depth > MAX_DEPTH) return null
  const key = `${refId}@${Math.round(t * 1e6) / 1e6}`
  const known = baker.versions.get(key)
  if (known) return known
  // The first version keeps the precomp's id; others get a suffix.
  const firstUse = ![...baker.versions.keys()].some((k) => k.startsWith(`${refId}@`))
  const id = firstUse ? refId : uniqueId(baker, refId)
  baker.usedIds.add(id)
  baker.versions.set(key, id)
  const copy = clone(asset)
  copy.id = id
  baker.baked.push(copy)
  copy.layers = bakeLayers(baker, copy.layers ?? [], t, depth + 1)
  return id
}

/** Freezes one property at comp frame `t`. */
function freezeProperty(baker: Baker, prop: AnyProperty, t: number): void {
  if (typeof prop.x === 'string') {
    if (prop.x.trim()) baker.expressions++
    delete prop.x
  }
  makeStatic(prop, t)
}

function freezeTextDocument(layer: TextLayer, t: number): void {
  const d = layer.t?.d
  if (!d || !Array.isArray(d.k) || d.k.length === 0) return
  const doc = evaluateTextDocument(layer.t, t)
  if (doc) d.k = [{ s: doc, t: 0 }]
}

function bakeLayer(baker: Baker, layer: Layer, t: number, visible: boolean, depth: number): void {
  // Auto-orientation turns with the motion, which is about to become static: keep its angle.
  // lottie-web applies it right after the rotation, about the same axis: it adds to `r`, or to
  // `rz` for a 3D layer that is not tilted.
  if (layer.ao === 1) {
    const ks = layer.ks ?? (layer.ks = {})
    const angle = autoOrientAngle(layer, t)
    if (!ks.rx) {
      ks.r = { a: 0, k: evaluateScalar(ks.r, t) + angle }
    } else {
      const flat =
        [ks.rx, ks.ry].every((p) => evaluateScalar(p, t) === 0) &&
        (ks.or ? evaluateArray(ks.or, t) : []).every((v) => v === 0)
      if (flat) ks.rz = { a: 0, k: evaluateScalar(ks.rz, t) + angle }
      else if (angle !== 0) baker.lostAutoOrient++
    }
    delete layer.ao
  }

  if (isPrecompLayer(layer)) {
    const id = bakedPrecomp(baker, layer.refId, innerFrame(layer, t, baker.fps), depth)
    if (id) layer.refId = id
    delete layer.tm
  }
  if (isTextLayer(layer)) freezeTextDocument(layer, t)
  forEachProperty(layer, (prop, key) => {
    // Text documents keep their keyframe form (handled above).
    if (key === 'd' && isTextLayer(layer) && prop === (layer.t?.d as unknown)) return
    freezeProperty(baker, prop, t)
  })

  // Visible layers span the whole still; the others (parents, mattes) never show.
  layer.ip = visible ? 0 : baker.frames
  layer.op = visible ? baker.frames : baker.frames + 1
  layer.st = 0
  delete layer.sr
}

function bakeLayers(baker: Baker, layers: Layer[], t: number, depth: number): Layer[] {
  const { drawn, kept } = neededLayers(layers, t)
  const out: Layer[] = []
  layers.forEach((layer, i) => {
    if (!kept.has(i)) return
    if (!drawn.has(i)) asNull(layer)
    const visible = drawn.has(i) && layer.ip <= t && t < layer.op
    bakeLayer(baker, layer, t, visible, depth)
    out.push(layer)
  })
  return out
}

/** Refs of image layers in the given layer lists. */
function imageRefs(lists: readonly Layer[][]): Set<string> {
  const refs = new Set<string>()
  for (const layers of lists) {
    for (const layer of layers) {
      if (layer.ty === 2 && typeof layer.refId === 'string') refs.add(layer.refId)
    }
  }
  return refs
}

/**
 * Builds a still of root frame `frame`: a new animation (the source is not modified) that
 * shows exactly that frame for `frames` frames, without keyframes.
 */
export function stillFrame(source: Animation, frame: number, opts: StillOptions = {}): StillResult {
  const anim = clone(source)
  const frames = Math.max(1, Math.round(opts.frames ?? 1))
  const assets: Asset[] = anim.assets ?? []
  const baker: Baker = {
    fps: anim.fr,
    frames,
    source: new Map(assets.filter(isPrecompAsset).map((a) => [a.id, a])),
    versions: new Map(),
    baked: [],
    usedIds: new Set(assets.map((a) => a.id)),
    expressions: 0,
    lostAutoOrient: 0,
  }
  // Ids of the original precomps are free again: their baked versions replace them.
  for (const id of baker.source.keys()) baker.usedIds.delete(id)

  anim.layers = bakeLayers(baker, anim.layers ?? [], frame, 0)

  // Slot values replace the properties that use them; they follow the root time.
  if (anim.slots && typeof anim.slots === 'object') {
    for (const slot of Object.values(anim.slots as Record<string, { p?: unknown }>)) {
      if (slot?.p && isPropertyLike(slot.p)) freezeProperty(baker, slot.p, frame)
    }
  }

  const used = imageRefs([anim.layers, ...baker.baked.map((a) => a.layers)])
  const others = assets.filter((a) => !isPrecompAsset(a) && (!('p' in a) || used.has(a.id)))
  anim.assets = [...others, ...baker.baked]
  anim.ip = 0
  anim.op = frames
  delete anim.markers
  return { anim, expressions: baker.expressions, lostAutoOrient: baker.lostAutoOrient }
}
