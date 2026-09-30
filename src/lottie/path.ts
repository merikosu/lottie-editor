/**
 * JSON paths into a Lottie document, e.g. ['layers', 3, 'ks', 'p'] or
 * ['assets', 1, 'layers', 0, 'shapes', 2, 'it', 1].
 *
 * Paths are the editor's universal address for nodes (layers, shape items, properties,
 * keyframes). They are plain arrays so they can be stored in selection/history and
 * compared cheaply via `pathKey`.
 */
import type { Animation, Layer, ShapeItem } from './types'

export type PathSegment = string | number
export type NodePath = readonly PathSegment[]

/** Stable string key for a path: ['layers', 3, 'ks'] → "layers/3/ks". */
export function pathKey(path: NodePath): string {
  return path.join('/')
}

/** Inverse of `pathKey`. Numeric segments become numbers (Lottie keys are never numeric). */
export function pathFromKey(key: string): NodePath {
  if (!key) return []
  return key.split('/').map((s) => (/^\d+$/.test(s) ? Number(s) : s))
}

export function pathEquals(
  a: NodePath | null | undefined,
  b: NodePath | null | undefined,
): boolean {
  if (!a || !b) return a === b
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** True if `prefix` is a (non-strict) prefix of `path`. */
export function isPathPrefix(prefix: NodePath, path: NodePath): boolean {
  if (prefix.length > path.length) return false
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== path[i]) return false
  return true
}

/** Reads the value at `path`, or undefined if any segment is missing. */
export function getAt<T = unknown>(root: unknown, path: NodePath): T | undefined {
  let node: unknown = root
  for (const seg of path) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<PathSegment, unknown>)[seg]
  }
  return node as T | undefined
}

/**
 * Writes `value` at `path` (mutating; use inside immer recipes).
 * Missing intermediate containers are created as objects/arrays based on the next segment.
 */
export function setAt(root: unknown, path: NodePath, value: unknown): void {
  if (path.length === 0) throw new Error('setAt: empty path')
  let node = root as Record<PathSegment, unknown>
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]
    let next = node[seg]
    if (next === null || typeof next !== 'object') {
      next = typeof path[i + 1] === 'number' ? [] : {}
      node[seg] = next
    }
    node = next as Record<PathSegment, unknown>
  }
  node[path[path.length - 1]] = value
}

/** Deletes the key/element at `path` (arrays are spliced). */
export function deleteAt(root: unknown, path: NodePath): void {
  if (path.length === 0) return
  const parent = getAt<Record<PathSegment, unknown> | unknown[]>(root, path.slice(0, -1))
  const last = path[path.length - 1]
  if (Array.isArray(parent) && typeof last === 'number') parent.splice(last, 1)
  else if (parent && typeof parent === 'object')
    delete (parent as Record<PathSegment, unknown>)[last]
}

/* -------------------------------------------------------------------------- */
/*                               Node addressing                              */
/* -------------------------------------------------------------------------- */

/** Path of the root composition's layer array. */
export const ROOT_LAYERS: NodePath = ['layers']

/** Path to the layers array of a composition: root (null) or a precomp asset index. */
export function compLayersPath(assetIndex: number | null): NodePath {
  return assetIndex === null ? ROOT_LAYERS : ['assets', assetIndex, 'layers']
}

/** True if the path addresses a layer: [...'layers', index]. */
export function isLayerPath(path: NodePath): boolean {
  const n = path.length
  return n >= 2 && path[n - 2] === 'layers' && typeof path[n - 1] === 'number'
}

/**
 * Extracts the innermost layer path contained in `path`:
 * ['assets', 1, 'layers', 2, 'shapes', 0] → ['assets', 1, 'layers', 2]
 */
export function layerPathOf(path: NodePath): NodePath | null {
  for (let i = path.length - 2; i >= 0; i--) {
    if (path[i] === 'layers' && typeof path[i + 1] === 'number') return path.slice(0, i + 2)
  }
  return null
}

/** Path of the composition layers array that contains the layer at `layerPath`. */
export function compPathOf(layerPath: NodePath): NodePath {
  return layerPath.slice(0, -1)
}

/** Asset index of the composition containing a layer path, or null for the root composition. */
export function compAssetIndexOf(layerPath: NodePath): number | null {
  return layerPath[0] === 'assets' && typeof layerPath[1] === 'number' ? layerPath[1] : null
}

/** True if the path addresses a shape item: [...('shapes' | 'it'), index]. */
export function isShapePath(path: NodePath): boolean {
  const n = path.length
  return (
    n >= 2 && (path[n - 2] === 'shapes' || path[n - 2] === 'it') && typeof path[n - 1] === 'number'
  )
}

export function getLayer(anim: Animation, layerPath: NodePath): Layer | undefined {
  return isLayerPath(layerPath) ? getAt<Layer>(anim, layerPath) : undefined
}

export function getShape(anim: Animation, shapePath: NodePath): ShapeItem | undefined {
  return isShapePath(shapePath) ? getAt<ShapeItem>(anim, shapePath) : undefined
}

export type NodeKind = 'layer' | 'shape' | 'other'

export function nodeKind(path: NodePath): NodeKind {
  if (isLayerPath(path)) return 'layer'
  if (isShapePath(path)) return 'shape'
  return 'other'
}

/** Parent node path of a shape item (the layer or the group containing it). */
export function shapeParentPath(shapePath: NodePath): NodePath {
  // [..., 'shapes', i] → layer path; [..., 'it', i] → group path
  return shapePath.slice(0, -2)
}
