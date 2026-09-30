/**
 * Human-readable names for document nodes (layers, shape items, properties), used by the
 * tree, timeline, history labels, issues and the command palette.
 */
import type { Dict } from '@/i18n'
import { layerKind } from '@/lottie/layers'
import { getAt, isLayerPath, isShapePath, layerPathOf, type NodePath } from '@/lottie/path'
import type { Animation, Layer, ShapeItem } from '@/lottie/types'

/** Real files sometimes store names as numbers (or other junk): always yield a trimmed string. */
function nameOf(nm: unknown): string {
  if (typeof nm === 'string') return nm.trim()
  if (typeof nm === 'number' && Number.isFinite(nm)) return String(nm)
  return ''
}

export function layerDisplayName(layer: Layer, index: number, t: Dict): string {
  return nameOf(layer.nm) || `${t.common.layerKinds[layerKind(layer)]} ${index + 1}`
}

export function shapeDisplayName(item: ShapeItem, t: Dict): string {
  const name = nameOf(item.nm)
  if (name) return name
  if (item.ty === 'sr' && item.sy === 2) return t.common.polygon
  const types = t.common.shapeTypes as Record<string, string>
  return Object.hasOwn(types, item.ty) ? types[item.ty] : t.common.shapeTypes.unknown
}

/** Display name of the node at `path` (layer or shape item); falls back to the last key. */
export function nodeDisplayName(doc: Animation, path: NodePath, t: Dict): string {
  if (isLayerPath(path)) {
    const layer = getAt<Layer>(doc, path)
    return layer ? layerDisplayName(layer, path[path.length - 1] as number, t) : ''
  }
  if (isShapePath(path)) {
    const item = getAt<ShapeItem>(doc, path)
    return item ? shapeDisplayName(item, t) : ''
  }
  return String(path[path.length - 1] ?? '')
}

/** "Layer › Group › Fill" breadcrumb for a node path. */
export function nodeBreadcrumb(doc: Animation, path: NodePath, t: Dict): string[] {
  const layerPath = layerPathOf(path)
  if (!layerPath) return [nodeDisplayName(doc, path, t)]
  const parts = [nodeDisplayName(doc, layerPath, t)]
  for (let i = layerPath.length + 2; i <= path.length; i += 2) {
    const sub = path.slice(0, i)
    if (isShapePath(sub)) parts.push(nodeDisplayName(doc, sub, t))
  }
  return parts
}
