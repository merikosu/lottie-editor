/**
 * Maps the playhead (a root composition frame) to the time base of any node.
 *
 * Keyframes are stored in the time of the composition that contains the layer. For nodes in
 * a precomp we walk the chain of precomp layers from the root down to that composition and
 * map the frame through each instance (`precompInnerFrame`). A composition may be used by
 * several layers; we follow the instance visible at the playhead (the one the user sees on
 * the canvas), falling back to the first one.
 */
import { compAssetIndexOf, layerPathOf, type NodePath } from '@/lottie/path'
import { precompInnerFrame, precompOuterFrame } from '@/lottie/time'
import type { Animation, PrecompLayer } from '@/lottie/types'
import { isPrecompAsset, isPrecompLayer } from '@/lottie/types'

interface Instance {
  layer: PrecompLayer
  path: NodePath
  /** Asset id of the composition containing the instance layer (null = root). */
  parentId: string | null
}

const instanceCache = new WeakMap<Animation, Map<string, Instance[]>>()

/** Precomp layers referencing each composition id (memoized per document). */
function instancesById(doc: Animation): Map<string, Instance[]> {
  const cached = instanceCache.get(doc)
  if (cached) return cached
  const map = new Map<string, Instance[]>()
  const visit = (layers: unknown, base: NodePath, parentId: string | null) => {
    if (!Array.isArray(layers)) return
    layers.forEach((layer, i) => {
      if (layer && isPrecompLayer(layer) && typeof layer.refId === 'string') {
        const list = map.get(layer.refId) ?? []
        list.push({ layer, path: [...base, i], parentId })
        map.set(layer.refId, list)
      }
    })
  }
  visit(doc.layers, ['layers'], null)
  doc.assets?.forEach((asset, index) => {
    if (isPrecompAsset(asset)) visit(asset.layers, ['assets', index, 'layers'], asset.id)
  })
  instanceCache.set(doc, map)
  return map
}

export interface CompTime {
  /** Playhead position in the node's composition time (keyframe time base). */
  frame: number
  /** Asset index of the containing precomp; null for the root composition. */
  assetIndex: number | null
  /** Instance layers used for the mapping, outermost first (empty for the root). */
  chain: NodePath[]
  /** Layers that use the node's composition directly (0 for the root). */
  instances: number
  /** The composition is not used by any layer: times cannot be mapped to the playhead. */
  orphan: boolean
  /** Some instance in the chain uses time remapping (local → root is not invertible). */
  remapped: boolean
  /** Local (composition) time → root frame; null when it cannot be inverted. */
  toRoot: (t: number) => number | null
  /** Root frame → local (composition) time. */
  fromRoot: (f: number) => number
}

const identity = (f: number) => f

function rootTime(frame: number): CompTime {
  return {
    frame,
    assetIndex: null,
    chain: [],
    instances: 0,
    orphan: false,
    remapped: false,
    toRoot: identity,
    fromRoot: identity,
  }
}

/**
 * Resolves the instance chain (outermost first) leading to composition `id`, choosing at each
 * level the instance visible at the playhead. Returns null when the composition is unused
 * or only reachable through a cycle.
 */
function resolveChain(
  doc: Animation,
  id: string,
  rootFrame: number,
  visiting: Set<string>,
): { chain: Instance[]; frame: number } | null {
  const candidates = instancesById(doc).get(id)
  if (!candidates?.length || visiting.has(id)) return null
  visiting.add(id)
  let fallback: { chain: Instance[]; frame: number } | null = null
  for (const candidate of candidates) {
    let parent: { chain: Instance[]; frame: number } | null
    if (candidate.parentId === null) parent = { chain: [], frame: rootFrame }
    else parent = resolveChain(doc, candidate.parentId, rootFrame, visiting)
    if (!parent) continue
    const resolved = {
      chain: [...parent.chain, candidate],
      frame: precompInnerFrame(candidate.layer, parent.frame, doc.fr),
    }
    const { ip, op } = candidate.layer
    if (parent.frame >= ip && parent.frame < op) {
      visiting.delete(id)
      return resolved
    }
    fallback ??= resolved
  }
  visiting.delete(id)
  return fallback
}

/** Time context of the node at `path` for a root-composition frame. */
export function compTimeFor(doc: Animation, path: NodePath, rootFrame: number): CompTime {
  const layerPath = layerPathOf(path)
  const assetIndex = layerPath ? compAssetIndexOf(layerPath) : null
  if (assetIndex === null) return rootTime(rootFrame)
  const asset = doc.assets?.[assetIndex]
  if (!asset || !isPrecompAsset(asset)) return rootTime(rootFrame)

  const instances = instancesById(doc).get(asset.id)?.length ?? 0
  const resolved = resolveChain(doc, asset.id, rootFrame, new Set())
  if (!resolved) {
    return { ...rootTime(rootFrame), assetIndex, instances, orphan: true, toRoot: () => null }
  }
  const layers = resolved.chain.map((c) => c.layer)
  const remapped = layers.some((l) => !!l.tm)
  const fps = doc.fr
  return {
    frame: resolved.frame,
    assetIndex,
    chain: resolved.chain.map((c) => c.path),
    instances,
    orphan: false,
    remapped,
    toRoot: (t) => {
      let f: number | null = t
      for (let i = layers.length - 1; i >= 0 && f !== null; i--) f = precompOuterFrame(layers[i], f)
      return f
    },
    fromRoot: (f) => layers.reduce((frame, layer) => precompInnerFrame(layer, frame, fps), f),
  }
}
