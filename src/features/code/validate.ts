/**
 * Structural checks run before applying edited JSON to the document. They only block what
 * would break the editor or every player (layers without a transform, assets without ids…);
 * everything else is reported by the Issues panel after applying.
 */
import type { NodePath } from '@/lottie/path'

export type LottieShapeCode =
  | 'not-object'
  | 'no-layers'
  | 'no-dimensions'
  | 'layer-not-object'
  | 'layer-type'
  | 'layer-transform'
  | 'assets-not-array'
  | 'asset-not-object'
  | 'asset-id'
  | 'precomp-layers'
  | 'fonts-list'
  | 'markers-not-array'

export interface LottieShapeIssue {
  code: LottieShapeCode
  /** Where the problem is (used to jump to it in the editor). */
  path: NodePath
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function checkLayers(layers: unknown[], base: NodePath): LottieShapeIssue | null {
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    const path = [...base, i]
    if (!isObject(layer)) return { code: 'layer-not-object', path }
    if (!isNum(layer.ty))
      return { code: 'layer-type', path: 'ty' in layer ? [...path, 'ty'] : path }
    if (!isObject(layer.ks))
      return { code: 'layer-transform', path: 'ks' in layer ? [...path, 'ks'] : path }
  }
  return null
}

/** First blocking structural problem of a parsed document, or null when it can be applied. */
export function lottieShapeIssue(data: unknown): LottieShapeIssue | null {
  if (!isObject(data)) return { code: 'not-object', path: [] }
  if (!Array.isArray(data.layers))
    return { code: 'no-layers', path: 'layers' in data ? ['layers'] : [] }
  // Same rule as looksLikeLottie(): at least one of the defining numbers must be present.
  if (!isNum(data.w) && !isNum(data.h) && !isNum(data.fr) && !isNum(data.op))
    return { code: 'no-dimensions', path: [] }

  const rootIssue = checkLayers(data.layers, ['layers'])
  if (rootIssue) return rootIssue

  if (data.assets !== undefined) {
    if (!Array.isArray(data.assets)) return { code: 'assets-not-array', path: ['assets'] }
    for (let i = 0; i < data.assets.length; i++) {
      const asset: unknown = data.assets[i]
      const path = ['assets', i]
      if (!isObject(asset)) return { code: 'asset-not-object', path }
      if (typeof asset.id !== 'string' || !asset.id)
        return { code: 'asset-id', path: 'id' in asset ? [...path, 'id'] : path }
      if ('layers' in asset) {
        if (!Array.isArray(asset.layers))
          return { code: 'precomp-layers', path: [...path, 'layers'] }
        const issue = checkLayers(asset.layers, [...path, 'layers'])
        if (issue) return issue
      }
    }
  }

  if (data.fonts !== undefined && data.fonts !== null) {
    if (
      !isObject(data.fonts) ||
      (data.fonts.list !== undefined && !Array.isArray(data.fonts.list))
    ) {
      return { code: 'fonts-list', path: ['fonts'] }
    }
  }
  if (data.markers !== undefined && !Array.isArray(data.markers))
    return { code: 'markers-not-array', path: ['markers'] }
  return null
}
