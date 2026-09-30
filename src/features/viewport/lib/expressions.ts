/**
 * Detecting After Effects expressions in a document (pure).
 *
 * Expressions are strings in a property's `x` field (text documents included). The scan is
 * cached per layer object: edits replace only the layers they touch (structural sharing), so
 * re-checking after an edit only walks the changed layers.
 */
import { hasExpression, isPropertyLike } from '@/lottie/property'
import type { Animation, Layer } from '@/lottie/types'
import { isPrecompAsset } from '@/lottie/types'

const layerCache = new WeakMap<object, boolean>()

function containsExpression(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false
  if (Array.isArray(node)) {
    for (const item of node) if (containsExpression(item)) return true
    return false
  }
  if (isPropertyLike(node) && hasExpression(node)) return true
  for (const key in node) {
    const value = (node as Record<string, unknown>)[key]
    if (value !== null && typeof value === 'object' && containsExpression(value)) return true
  }
  return false
}

/** True if the layer (transform, content, masks, effects, text) uses an expression. */
export function layerHasExpressions(layer: Layer): boolean {
  if (layer === null || typeof layer !== 'object') return false
  const cached = layerCache.get(layer)
  if (cached !== undefined) return cached
  const result = containsExpression(layer)
  layerCache.set(layer, result)
  return result
}

/** True if any layer of any composition uses an expression. */
export function documentHasExpressions(doc: Animation | null | undefined): boolean {
  if (!doc) return false
  if (Array.isArray(doc.layers) && doc.layers.some(layerHasExpressions)) return true
  for (const asset of doc.assets ?? []) {
    if (isPrecompAsset(asset) && asset.layers.some(layerHasExpressions)) return true
  }
  return false
}
