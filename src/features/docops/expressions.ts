/**
 * Expression count of a document, memoized per layer object: thanks to structural sharing an
 * edit only re-walks the layers it touched, so this is cheap on every store update.
 */
import { countExpressions } from '@/lottie/timing'
import type { Animation, Layer } from '@/lottie/types'
import { isPrecompAsset } from '@/lottie/types'

const perLayer = new WeakMap<Layer, number>()

function layerCount(layer: Layer): number {
  let n = perLayer.get(layer)
  if (n === undefined) {
    n = countExpressions({ layers: [layer] } as unknown as Animation)
    perLayer.set(layer, n)
  }
  return n
}

export function expressionCount(doc: Animation): number {
  let n = 0
  for (const layer of doc.layers ?? []) n += layerCount(layer)
  for (const asset of doc.assets ?? []) {
    if (isPrecompAsset(asset)) for (const layer of asset.layers ?? []) n += layerCount(layer)
  }
  return n
}
