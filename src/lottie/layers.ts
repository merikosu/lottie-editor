/**
 * Layer helpers: classification, naming, parenting and visibility.
 */
import type { Animation, Layer } from './types'
import { LayerType } from './types'

export type LayerKind =
  | 'precomp'
  | 'solid'
  | 'image'
  | 'null'
  | 'shape'
  | 'text'
  | 'audio'
  | 'camera'
  | 'adjustment'
  | 'other'

export function layerKind(layer: Pick<Layer, 'ty'>): LayerKind {
  switch (layer.ty) {
    case LayerType.Precomp:
      return 'precomp'
    case LayerType.Solid:
      return 'solid'
    case LayerType.Image:
    case LayerType.ImageSequence:
    case LayerType.ImagePlaceholder:
      return 'image'
    case LayerType.Null:
      return 'null'
    case LayerType.Shape:
      return 'shape'
    case LayerType.Text:
      return 'text'
    case LayerType.Audio:
      return 'audio'
    case LayerType.Camera:
      return 'camera'
    case LayerType.Adjustment:
      return 'adjustment'
    default:
      return 'other'
  }
}

/** Name shown in the UI; falls back to "<Kind> <n>" when the layer is unnamed. */
export function layerLabel(layer: Layer, index: number, kindLabel: string): string {
  const name = layer.nm?.trim()
  return name ? name : `${kindLabel} ${index + 1}`
}

export function findLayerByInd(
  layers: readonly Layer[],
  ind: number | undefined,
): Layer | undefined {
  if (ind === undefined) return undefined
  return layers.find((l) => l.ind === ind)
}

export function findLayerIndexByInd(layers: readonly Layer[], ind: number | undefined): number {
  if (ind === undefined) return -1
  return layers.findIndex((l) => l.ind === ind)
}

/** Parent chain from the direct parent up to the root; stops on cycles. */
export function parentChain(layers: readonly Layer[], layer: Layer): Layer[] {
  const chain: Layer[] = []
  const seen = new Set<Layer>([layer])
  let current = findLayerByInd(layers, layer.parent)
  while (current && !seen.has(current)) {
    chain.push(current)
    seen.add(current)
    current = findLayerByInd(layers, current.parent)
  }
  return chain
}

/** Next free `ind` in a composition. */
export function nextLayerInd(layers: readonly Layer[]): number {
  let max = 0
  for (const l of layers) if (typeof l.ind === 'number' && l.ind > max) max = l.ind
  return max + 1
}

/** True if the layer is within its in/out range at `frame` (composition time). */
export function isLayerActiveAt(layer: Layer, frame: number): boolean {
  return frame >= layer.ip && frame < layer.op
}

/** Layers that use `layer` as their parent (by `ind`). */
export function childLayers(layers: readonly Layer[], layer: Layer): Layer[] {
  if (layer.ind === undefined) return []
  return layers.filter((l) => l.parent === layer.ind)
}

/** Is this layer used as a track matte for the layer below it? */
export function isMatteSource(layer: Layer): boolean {
  return layer.td !== undefined && layer.td !== 0
}

/** Total number of layers across all compositions. */
export function countLayers(anim: Animation): number {
  let n = anim.layers?.length ?? 0
  for (const a of anim.assets ?? [])
    if ('layers' in a && Array.isArray(a.layers)) n += a.layers.length
  return n
}
