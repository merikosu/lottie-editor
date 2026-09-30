/**
 * Traversal helpers over a Lottie document: compositions, layers, shape items and
 * animatable properties. All callbacks receive the JSON path of the visited node.
 */
import { compLayersPath, type NodePath } from './path'
import { isPropertyLike, type AnyProperty } from './property'
import type { Animation, Asset, GroupShape, Layer, PrecompAsset, ShapeItem } from './types'
import { isPrecompAsset } from './types'

export interface CompInfo {
  /** Asset index of the precomp, or null for the root composition. */
  assetIndex: number | null
  /** Asset id of the precomp, or null for the root composition. */
  id: string | null
  name: string
  layers: Layer[]
  /** Path of the `layers` array. */
  layersPath: NodePath
}

/** Root composition followed by every precomp asset (in asset order). */
export function listComps(anim: Animation): CompInfo[] {
  const comps: CompInfo[] = [
    {
      assetIndex: null,
      id: null,
      name: anim.nm ?? '',
      layers: anim.layers ?? [],
      layersPath: compLayersPath(null),
    },
  ]
  anim.assets?.forEach((asset, index) => {
    if (isPrecompAsset(asset)) {
      comps.push({
        assetIndex: index,
        id: asset.id,
        name: asset.nm ?? asset.id,
        layers: asset.layers,
        layersPath: compLayersPath(index),
      })
    }
  })
  return comps
}

/** Finds an asset by id. */
export function findAsset(
  anim: Animation,
  id: string | undefined,
): { asset: Asset; index: number } | null {
  if (id === undefined || !anim.assets) return null
  const index = anim.assets.findIndex((a) => a.id === id)
  return index >= 0 ? { asset: anim.assets[index], index } : null
}

export function findPrecomp(
  anim: Animation,
  id: string | undefined,
): { asset: PrecompAsset; index: number } | null {
  const found = findAsset(anim, id)
  return found && isPrecompAsset(found.asset) ? { asset: found.asset, index: found.index } : null
}

/**
 * Visits every layer of every composition. Return `false` from the callback to stop.
 */
export function forEachLayer(
  anim: Animation,
  cb: (layer: Layer, path: NodePath, comp: CompInfo) => void | false,
): void {
  for (const comp of listComps(anim)) {
    for (let i = 0; i < comp.layers.length; i++) {
      if (cb(comp.layers[i], [...comp.layersPath, i], comp) === false) return
    }
  }
}

/**
 * Visits shape items depth-first (groups before their children).
 * `basePath` is the path of the `shapes` (or `it`) array.
 * Return `false` to skip a group's children.
 */
export function forEachShape(
  items: ShapeItem[] | undefined,
  basePath: NodePath,
  cb: (item: ShapeItem, path: NodePath, parents: GroupShape[]) => void | false,
  parents: GroupShape[] = [],
): void {
  if (!Array.isArray(items)) return
  items.forEach((item, i) => {
    const path = [...basePath, i]
    const descend = cb(item, path, parents)
    if (descend !== false && item.ty === 'gr' && Array.isArray(item.it)) {
      forEachShape(item.it, [...path, 'it'], cb, [...parents, item])
    }
  })
}

/**
 * Generic depth-first walk over any JSON value.
 * Return `false` from the visitor to skip the children of the current node.
 */
export function walkJson(
  node: unknown,
  path: NodePath,
  visit: (value: unknown, path: NodePath) => void | false,
): void {
  if (visit(node, path) === false) return
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) walkJson(node[i], [...path, i], visit)
  } else if (node !== null && typeof node === 'object') {
    for (const key of Object.keys(node))
      walkJson((node as Record<string, unknown>)[key], [...path, key], visit)
  }
}

/**
 * Visits every animatable property under `node` (static or animated).
 * Properties are not descended into (they never contain other properties).
 */
export function forEachProperty(
  node: unknown,
  basePath: NodePath,
  cb: (prop: AnyProperty, path: NodePath) => void,
): void {
  walkJson(node, basePath, (value, path) => {
    if (path.length > basePath.length && isPropertyLike(value)) {
      cb(value, path)
      return false
    }
  })
}

/** Number of precomp layers referencing each asset id (images and precomps). */
export function assetUsage(anim: Animation): Map<string, number> {
  const usage = new Map<string, number>()
  forEachLayer(anim, (layer) => {
    const ref = (layer as { refId?: string }).refId
    if (ref !== undefined) usage.set(ref, (usage.get(ref) ?? 0) + 1)
  })
  return usage
}
