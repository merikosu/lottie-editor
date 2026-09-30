/**
 * Stable keys for tree nodes.
 *
 * JSON paths change whenever layers are reordered, so editor-only state (expanded rows, locks,
 * solo) is keyed by something that survives edits:
 *  - layer:  `<compId>:<ind>` — compId is '' for the root composition or the precomp asset id;
 *            layers without a unique `ind` fall back to `<compId>:#<index>`;
 *  - shape:  `<layerKey>|<i>.<j>…` — indices along `shapes` / `it`;
 *  - row:    node keys of the precomp instances above the row joined with '>', then the
 *            row's own node key (the same precomp content appears once per instance).
 * Shape keys are index-based; `remapKey` follows moved shape items by object identity.
 */
import { getAt, isLayerPath, isShapePath, layerPathOf, pathKey, type NodePath } from '@/lottie/path'
import type { Animation, Layer, ShapeItem } from '@/lottie/types'

interface KeyIndex {
  /** Layer node key → layer path. */
  byKey: Map<string, NodePath>
  /** Layer path key → layer node key. */
  byPath: Map<string, string>
}

const cache = new WeakMap<Animation, KeyIndex>()

function compIds(doc: Animation): Array<{ id: string; layers: Layer[]; base: NodePath }> {
  const out = [
    { id: '', layers: Array.isArray(doc.layers) ? doc.layers : [], base: ['layers'] as NodePath },
  ]
  doc.assets?.forEach((asset, i) => {
    if (asset && Array.isArray((asset as { layers?: unknown }).layers)) {
      // Ids are arbitrary strings: escape them so '|' and '>' stay unambiguous separators.
      out.push({
        id: encodeURIComponent(String(asset.id)),
        layers: (asset as { layers: Layer[] }).layers,
        base: ['assets', i, 'layers'],
      })
    }
  })
  return out
}

/** Key index of a document (memoized per document identity). */
function keyIndex(doc: Animation): KeyIndex {
  let index = cache.get(doc)
  if (index) return index
  index = { byKey: new Map(), byPath: new Map() }
  for (const comp of compIds(doc)) {
    comp.layers.forEach((layer, i) => {
      let key = typeof layer?.ind === 'number' ? `${comp.id}:${layer.ind}` : ''
      if (!key || index!.byKey.has(key)) key = `${comp.id}:#${i}`
      const path = [...comp.base, i]
      index!.byKey.set(key, path)
      index!.byPath.set(pathKey(path), key)
    })
  }
  cache.set(doc, index)
  return index
}

/** Stable key of the layer or shape item at `path`, or null. */
export function nodeKeyOf(doc: Animation, path: NodePath): string | null {
  if (isLayerPath(path)) return keyIndex(doc).byPath.get(pathKey(path)) ?? null
  if (!isShapePath(path)) return null
  const layerPath = layerPathOf(path)
  const layerKey = layerPath ? keyIndex(doc).byPath.get(pathKey(layerPath)) : undefined
  if (!layerPath || layerKey === undefined) return null
  const indices: number[] = []
  for (let i = layerPath.length + 1; i < path.length; i += 2) indices.push(path[i] as number)
  return `${layerKey}|${indices.join('.')}`
}

function splitShapeKey(key: string): { layerKey: string; indices: number[] } | null {
  const bar = key.indexOf('|')
  if (bar < 0) return null
  const indices = key
    .slice(bar + 1)
    .split('.')
    .map(Number)
  return indices.every((n) => Number.isInteger(n) && n >= 0)
    ? { layerKey: key.slice(0, bar), indices }
    : null
}

function shapePath(layerPath: NodePath, indices: readonly number[]): NodePath {
  const path: (string | number)[] = [...layerPath]
  indices.forEach((i, k) => path.push(k === 0 ? 'shapes' : 'it', i))
  return path
}

/** Path of the node with the given node key in `doc`, or null when it does not resolve. */
export function pathOfNodeKey(doc: Animation, key: string): NodePath | null {
  const shape = splitShapeKey(key)
  const layerPath = keyIndex(doc).byKey.get(shape ? shape.layerKey : key)
  if (!layerPath) return null
  if (!shape) return layerPath
  const path = shapePath(layerPath, shape.indices)
  const item = getAt<ShapeItem>(doc, path)
  return item && typeof item === 'object' ? path : null
}

/** Node keys of the layer and groups containing a shape item (empty for layers). */
export function nodeKeyAncestors(nodeKey: string): string[] {
  const shape = splitShapeKey(nodeKey)
  if (!shape) return []
  const out = [shape.layerKey]
  for (let n = 1; n < shape.indices.length; n++)
    out.push(`${shape.layerKey}|${shape.indices.slice(0, n).join('.')}`)
  return out
}

/** Node key of the last segment of a row key. */
export function nodeKeyOfRow(rowKey: string): string {
  const i = rowKey.lastIndexOf('>')
  return i < 0 ? rowKey : rowKey.slice(i + 1)
}

/** Row key of the parent row (the instance row for a precomp's top-level layers), or null. */
export function parentRowKey(rowKey: string): string | null {
  const node = nodeKeyOfRow(rowKey)
  const prefix = rowKey.slice(0, rowKey.length - node.length)
  const shape = splitShapeKey(node)
  if (shape) {
    const parent =
      shape.indices.length > 1
        ? `${shape.layerKey}|${shape.indices.slice(0, -1).join('.')}`
        : shape.layerKey
    return prefix + parent
  }
  return prefix ? prefix.slice(0, -1) : null
}

function findIndices(
  items: ShapeItem[] | undefined,
  target: ShapeItem,
  trail: number[],
): number[] | null {
  if (!Array.isArray(items)) return null
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item === target) return [...trail, i]
    if (item?.ty === 'gr') {
      const found = findIndices(item.it, target, [...trail, i])
      if (found) return found
    }
  }
  return null
}

/**
 * Follows a node key from `prev` to `next`: layer keys are stable; shape items that moved are
 * found by identity (unchanged items keep their object across edits). Keys of items that were
 * modified in place stay as they are; keys that no longer resolve are returned unchanged.
 */
function remapNodeKey(key: string, prev: Animation, next: Animation): string {
  const shape = splitShapeKey(key)
  if (!shape) return key
  const prevLayer = keyIndex(prev).byKey.get(shape.layerKey)
  const nextLayer = keyIndex(next).byKey.get(shape.layerKey)
  if (!prevLayer || !nextLayer) return key
  const item = getAt<ShapeItem>(prev, shapePath(prevLayer, shape.indices))
  if (!item || typeof item !== 'object') return key
  if (getAt<ShapeItem>(next, shapePath(nextLayer, shape.indices)) === item) return key
  const found = findIndices(getAt<ShapeItem[]>(next, [...nextLayer, 'shapes']), item, [])
  return found ? `${shape.layerKey}|${found.join('.')}` : key
}

/** Follows every segment of a row key (or node key) from `prev` to `next`. */
export function remapKey(key: string, prev: Animation, next: Animation): string {
  if (!key.includes('|')) return key
  return key
    .split('>')
    .map((segment) => remapNodeKey(segment, prev, next))
    .join('>')
}

/** Remaps the keys of a record; returns the same object when nothing changed. */
export function remapRecord<V>(
  record: Record<string, V>,
  prev: Animation,
  next: Animation,
): Record<string, V> {
  let changed = false
  const out: Record<string, V> = {}
  for (const [key, value] of Object.entries(record)) {
    const mapped = remapKey(key, prev, next)
    if (mapped !== key) changed = true
    out[mapped] = value
  }
  return changed ? out : record
}
