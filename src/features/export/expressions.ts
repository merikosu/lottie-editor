/**
 * Does the document use After Effects expressions? Expressions only run in the preview when the
 * user enabled them, and exports render what the preview shows, so the dialog says so.
 * Cached per layer object: edits replace only the layers they touch.
 */
import { hasExpression, isPropertyLike } from '@/lottie/property'
import type { Animation, Layer } from '@/lottie/types'
import { isPrecompAsset } from '@/lottie/types'

const cache = new WeakMap<object, boolean>()

function contains(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some(contains)
  if (isPropertyLike(node) && hasExpression(node)) return true
  for (const key in node) {
    const value = (node as Record<string, unknown>)[key]
    if (value !== null && typeof value === 'object' && contains(value)) return true
  }
  return false
}

function layerHasExpressions(layer: Layer): boolean {
  if (layer === null || typeof layer !== 'object') return false
  let result = cache.get(layer)
  if (result === undefined) {
    result = contains(layer)
    if (Object.isFrozen(layer)) cache.set(layer, result)
  }
  return result
}

export function documentHasExpressions(doc: Animation): boolean {
  if (doc.layers?.some(layerHasExpressions)) return true
  return (doc.assets ?? []).some((a) => isPrecompAsset(a) && a.layers.some(layerHasExpressions))
}
