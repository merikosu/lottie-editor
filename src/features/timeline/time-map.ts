/**
 * Mapping between a composition's local time and root time.
 *
 * The timeline draws everything in root frames. Layers of the root composition use root time
 * directly; the content of a precomp instance maps through that instance
 * (`outer = inner · sr + st`, see @/lottie/time), recursively for nested precomps. Time remap
 * (`tm`) is not linear: its inverse is sampled when it only moves forward, and such rows are
 * shown for reference (not draggable).
 */
import { getAt, type NodePath } from '@/lottie/path'
import { findPrecomp } from '@/lottie/traverse'
import { precompInnerFrame } from '@/lottie/time'
import type { Animation, PrecompLayer } from '@/lottie/types'
import { isPrecompLayer } from '@/lottie/types'

export interface TimeMap {
  /** Local composition frame → root frame. */
  toRoot(t: number): number
  /** Root frame → local composition frame. */
  toLocal(frame: number): number
  /** Root frames per local frame (NaN when not linear). */
  scale: number
  /** False for time-remapped content: positions are approximate and editing by drag is off. */
  linear: boolean
}

export const ROOT_MAP: TimeMap = {
  toRoot: (t) => t,
  toLocal: (f) => f,
  scale: 1,
  linear: true,
}

/** root = offset + scale · local */
const linearCache = new Map<string, TimeMap>()

/** root = offset + scale · local (cached, so equal maps keep their identity across renders). */
export function linearMap(scale: number, offset: number): TimeMap {
  const s = scale === 0 || !Number.isFinite(scale) ? 1 : scale
  const key = `${s}:${offset}`
  const cached = linearCache.get(key)
  if (cached) return cached
  const map: TimeMap = {
    toRoot: (t) => offset + s * t,
    toLocal: (f) => (f - offset) / s,
    scale: s,
    linear: true,
  }
  if (linearCache.size > 5000) linearCache.clear()
  linearCache.set(key, map)
  return map
}

const MAX_SAMPLES = 4000

/**
 * Inverse of a time-remap curve sampled over the instance's visible range. Returns null when
 * the remap runs backwards (loops, reversals), where keys have no single position.
 */
function remapMap(parent: TimeMap, layer: PrecompLayer, fps: number): TimeMap | null {
  const start = Math.floor(Math.min(layer.ip, layer.op))
  const end = Math.ceil(Math.max(layer.ip, layer.op))
  const count = Math.max(2, end - start + 1)
  const step = count > MAX_SAMPLES ? (end - start) / (MAX_SAMPLES - 1) : 1
  const outer: number[] = []
  const inner: number[] = []
  for (let i = 0; i < Math.min(count, MAX_SAMPLES); i++) {
    const f = start + i * step
    outer.push(f)
    inner.push(precompInnerFrame(layer, f, fps))
  }
  for (let i = 1; i < inner.length; i++) if (inner[i] < inner[i - 1] - 1e-6) return null
  const n = inner.length
  const toOuter = (t: number): number => {
    if (t <= inner[0]) return outer[0] - (inner[0] - t) / Math.max(1e-6, slope(0))
    if (t >= inner[n - 1]) return outer[n - 1] + (t - inner[n - 1]) / Math.max(1e-6, slope(n - 2))
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (inner[mid] < t) lo = mid
      else hi = mid
    }
    const span = inner[hi] - inner[lo]
    return span > 1e-9 ? outer[lo] + ((t - inner[lo]) / span) * (outer[hi] - outer[lo]) : outer[lo]
  }
  function slope(i: number): number {
    const d = outer[i + 1] - outer[i]
    return d > 0 ? (inner[i + 1] - inner[i]) / d : 1
  }
  return {
    toRoot: (t) => parent.toRoot(toOuter(t)),
    toLocal: (f) => precompInnerFrame(layer, parent.toLocal(f), fps),
    scale: Number.NaN,
    linear: false,
  }
}

/**
 * Map of the content of precomp instance `layer`, given the map of the composition that
 * contains the instance. Null when the content cannot be placed in root time.
 */
const remapCache = new WeakMap<
  PrecompLayer,
  { parent: TimeMap; fps: number; map: TimeMap | null }
>()

export function instanceMap(
  parent: TimeMap | null,
  layer: PrecompLayer,
  fps: number,
): TimeMap | null {
  if (!parent) return null
  if (layer.tm) {
    // Sampling the remap curve is not free: reuse it while the layer and its parent map are unchanged.
    const cached = remapCache.get(layer)
    if (cached && cached.parent === parent && cached.fps === fps) return cached.map
    const map = remapMap(parent, layer, fps)
    remapCache.set(layer, { parent, fps, map })
    return map
  }
  const sr = layer.sr && layer.sr !== 0 ? layer.sr : 1
  const st = layer.st ?? 0
  if (parent.linear) return linearMap(parent.scale * sr, parent.toRoot(st))
  return {
    toRoot: (t) => parent.toRoot(t * sr + st),
    toLocal: (f) => (parent.toLocal(f) - st) / sr,
    scale: Number.NaN,
    linear: false,
  }
}

const firstMapsCache = new WeakMap<Animation, Map<number, TimeMap | null>>()

/**
 * For every precomp asset index: the map of its first instance, depth-first from the root
 * composition (used when an operation needs "the" root time of precomp content, e.g. pasting
 * keyframes at the playhead). Memoized per document.
 */
export function firstInstanceMaps(doc: Animation): Map<number, TimeMap | null> {
  const cached = firstMapsCache.get(doc)
  if (cached) return cached
  const maps = new Map<number, TimeMap | null>()
  const visit = (layers: readonly unknown[], map: TimeMap | null, chain: Set<string>) => {
    for (const l of layers) {
      const layer = l as PrecompLayer
      if (!layer || !isPrecompLayer(layer)) continue
      const found = findPrecomp(doc, layer.refId)
      if (!found || chain.has(found.asset.id) || maps.has(found.index)) continue
      const inner = instanceMap(map, layer, doc.fr)
      maps.set(found.index, inner)
      visit(found.asset.layers, inner, new Set([...chain, found.asset.id]))
    }
  }
  visit(doc.layers ?? [], ROOT_MAP, new Set())
  firstMapsCache.set(doc, maps)
  return maps
}

/** Map for a composition: root (assetIndex null) or the first instance of a precomp asset. */
export function compMap(doc: Animation, assetIndex: number | null): TimeMap | null {
  if (assetIndex === null) return ROOT_MAP
  return firstInstanceMaps(doc).get(assetIndex) ?? null
}

/**
 * Map of the content shown through a chain of precomp layers (outermost first, as in
 * @/features/layers/instances). Null when a link is not a precomp layer or cannot be placed.
 */
export function chainMap(doc: Animation, chain: readonly NodePath[]): TimeMap | null {
  let map: TimeMap | null = ROOT_MAP
  for (const path of chain) {
    const layer = getAt<PrecompLayer>(doc, path)
    if (!layer || !isPrecompLayer(layer)) return null
    map = instanceMap(map, layer, doc.fr)
  }
  return map
}
