/**
 * Flattened, virtualizable model of the layer tree.
 *
 * Hierarchy: composition layers (top = first) → shape items of shape layers (groups nest;
 * group transforms are not listed) and the layers of the composition a precomp layer uses
 * (repeated under every instance; a precomp that contains itself is never expanded).
 * Parenting (`parent`) is not hierarchy here; rows show it as an indicator.
 */
import { layerDisplayName, shapeDisplayName } from '@/components/lottie/labels'
import type { Dict } from '@/i18n'
import { pathKey, type NodePath } from '@/lottie/path'
import { findPrecomp } from '@/lottie/traverse'
import type { Animation, Layer, ShapeItem } from '@/lottie/types'
import { nodeKeyOf, parentRowKey } from './keys'

export interface TreeRow {
  /** Unique, stable row key (see keys.ts). */
  key: string
  /** Stable key of the node itself (locks, solo). */
  nodeKey: string
  path: NodePath
  kind: 'layer' | 'shape'
  depth: number
  parentKey: string | null
  /** Index in the array holding the node. */
  index: number
  /** Array holding the node: a composition's layers or a shape array. */
  arrayPath: NodePath
  /** Layer the node belongs to (itself for layer rows). */
  layerPath: NodePath
  /** Precomp instance layers above this row, outermost first. */
  instances: readonly NodePath[]
  name: string
  node: Layer | ShapeItem
  expandable: boolean
  expanded: boolean
  /** Hidden itself (`hd`). */
  hidden: boolean
  /** Inside a hidden layer, group or precomp instance. */
  hiddenByParent: boolean
  /** Matched substring of `name` while searching. */
  match: readonly [number, number] | null
  /** Last listed child of its parent. */
  last: boolean
  /** Position among listed siblings (1-based) and their count, for assistive technology. */
  posInSet: number
  setSize: number
  /** Precomp layer whose composition contains one of its ancestors. */
  recursive: boolean
}

export interface TreeModel {
  rows: TreeRow[]
  /** Row key → row index. */
  indexOf: Map<string, number>
  /** Number of rows matching the search (0 without a search). */
  matches: number
  /** The search filtered the rows. */
  searching: boolean
}

export interface BuildOptions {
  expanded: Readonly<Record<string, true>>
  search: string
  t: Dict
}

/** Safety cap: huge precomp fan-outs must not freeze the UI while searching. */
const MAX_ROWS = 20_000

interface Ctx {
  depth: number
  parentKey: string | null
  /** Row key prefix of the precomp instance chain ('' at the root). */
  prefix: string
  instances: NodePath[]
  hiddenByParent: boolean
  /** Precomp asset ids above (cycle guard). */
  assets: string[]
  /** Filter rows by the search query. */
  filter: boolean
}

function matchRange(name: string, query: string): readonly [number, number] | null {
  const i = name.toLocaleLowerCase().indexOf(query)
  return i >= 0 ? [i, i + query.length] : null
}

/** Flattens sibling subtrees, numbering the siblings and marking the last one. */
function finish(siblings: TreeRow[][]): TreeRow[] {
  const own = siblings.filter((s) => s.length > 0)
  own.forEach((subtree, i) => {
    subtree[0].posInSet = i + 1
    subtree[0].setSize = own.length
  })
  if (own.length) own[own.length - 1][0].last = true
  return own.flat()
}

const NO_CHILDREN = (): TreeRow[] => []

export function buildTree(doc: Animation, { expanded, search, t }: BuildOptions): TreeModel {
  const query = search.trim().toLocaleLowerCase()
  const searching = query.length > 0
  let matches = 0
  let budget = MAX_ROWS

  function visitShapes(
    items: ShapeItem[],
    arrayPath: NodePath,
    layerPath: NodePath,
    parentNodeKey: string,
    sep: string,
    ctx: Ctx,
  ): TreeRow[] {
    const siblings: TreeRow[][] = []
    items.forEach((item, i) => {
      if (!item || typeof item !== 'object' || item.ty === 'tr' || budget <= 0) return
      const path = [...arrayPath, i]
      const nodeKey = `${parentNodeKey}${sep}${i}`
      const key = ctx.prefix + nodeKey
      const name = shapeDisplayName(item, t)
      const hidden = !!item.hd
      const isGroup = item.ty === 'gr' && Array.isArray(item.it)
      const expandable = isGroup && item.it.some((c) => c && c.ty !== 'tr')
      const childCtx: Ctx = {
        ...ctx,
        depth: ctx.depth + 1,
        parentKey: key,
        hiddenByParent: ctx.hiddenByParent || hidden,
      }
      const children = (filter: boolean) =>
        isGroup
          ? visitShapes(item.it, [...path, 'it'], layerPath, nodeKey, '.', { ...childCtx, filter })
          : []
      let childRows: TreeRow[] = []
      if (expandable && ctx.filter) childRows = children(true)
      if (expandable && !childRows.length && expanded[key]) childRows = children(false)
      const match = ctx.filter ? matchRange(name, query) : null
      if (ctx.filter && !match && !childRows.length) return
      if (match) matches++
      budget--
      const row: TreeRow = {
        key,
        nodeKey,
        path,
        kind: 'shape',
        depth: ctx.depth,
        parentKey: ctx.parentKey,
        index: i,
        arrayPath,
        layerPath,
        instances: ctx.instances,
        name,
        node: item,
        expandable,
        expanded: childRows.length > 0,
        hidden,
        hiddenByParent: ctx.hiddenByParent,
        match,
        last: false,
        posInSet: 0,
        setSize: 0,
        recursive: false,
      }
      siblings.push([row, ...childRows])
    })
    return finish(siblings)
  }

  function visitLayers(layers: Layer[], compPath: NodePath, ctx: Ctx): TreeRow[] {
    const siblings: TreeRow[][] = []
    layers.forEach((layer, i) => {
      if (!layer || typeof layer !== 'object' || budget <= 0) return
      const path = [...compPath, i]
      const nodeKey = nodeKeyOf(doc, path) ?? pathKey(path)
      const key = ctx.prefix + nodeKey
      const name = layerDisplayName(layer, i, t)
      const hidden = !!layer.hd
      const childCtx: Ctx = {
        ...ctx,
        depth: ctx.depth + 1,
        parentKey: key,
        hiddenByParent: ctx.hiddenByParent || hidden,
      }

      let expandable = false
      let recursive = false
      let children: (filter: boolean) => TreeRow[] = NO_CHILDREN
      if (layer.ty === 4) {
        const shapes = (layer as { shapes?: ShapeItem[] }).shapes
        expandable = Array.isArray(shapes) && shapes.some((s) => s && s.ty !== 'tr')
        children = (filter) =>
          visitShapes(shapes ?? [], [...path, 'shapes'], path, nodeKey, '|', {
            ...childCtx,
            filter,
          })
      } else if (layer.ty === 0) {
        const found = findPrecomp(doc, (layer as { refId?: string }).refId)
        if (found && ctx.assets.includes(found.asset.id)) recursive = true
        else if (found) {
          expandable = found.asset.layers.length > 0
          const inner: Ctx = {
            ...childCtx,
            prefix: `${key}>`,
            instances: [...ctx.instances, path],
            assets: [...ctx.assets, found.asset.id],
          }
          children = (filter) =>
            visitLayers(found.asset.layers, ['assets', found.index, 'layers'], { ...inner, filter })
        }
      }

      let childRows: TreeRow[] = []
      if (expandable && ctx.filter) childRows = children(true)
      if (expandable && !childRows.length && expanded[key]) childRows = children(false)
      const match = ctx.filter ? matchRange(name, query) : null
      if (ctx.filter && !match && !childRows.length) return
      if (match) matches++
      budget--
      const row: TreeRow = {
        key,
        nodeKey,
        path,
        kind: 'layer',
        depth: ctx.depth,
        parentKey: ctx.parentKey,
        index: i,
        arrayPath: compPath,
        layerPath: path,
        instances: ctx.instances,
        name,
        node: layer,
        expandable,
        expanded: childRows.length > 0,
        hidden,
        hiddenByParent: ctx.hiddenByParent,
        match,
        last: false,
        posInSet: 0,
        setSize: 0,
        recursive,
      }
      siblings.push([row, ...childRows])
    })
    return finish(siblings)
  }

  const rows = visitLayers(Array.isArray(doc.layers) ? doc.layers : [], ['layers'], {
    depth: 0,
    parentKey: null,
    prefix: '',
    instances: [],
    hiddenByParent: false,
    assets: [],
    filter: searching,
  })
  const indexOf = new Map<string, number>()
  rows.forEach((row, i) => indexOf.set(row.key, i))
  return { rows, indexOf, matches, searching }
}

/**
 * Keys of every expandable row in the subtree of `row` (itself included), for recursive
 * expand/collapse. Builds the subtree fully expanded (bounded by the row budget).
 */
export function subtreeKeys(doc: Animation, row: TreeRow, t: Dict): string[] {
  const within = (key: string) =>
    key === row.key || (key.startsWith(row.key) && '|.>'.includes(key.charAt(row.key.length)))
  // The row's ancestors must be open too, or the build never reaches the subtree.
  const ancestors = new Set<string>()
  for (let key = parentRowKey(row.key); key !== null; key = parentRowKey(key)) ancestors.add(key)
  const expanded = new Proxy({} as Record<string, true>, {
    get: (_, key) =>
      typeof key === 'string' && (within(key) || ancestors.has(key)) ? true : undefined,
  })
  return buildTree(doc, { expanded, search: '', t })
    .rows.filter((r) => r.expandable && within(r.key))
    .map((r) => r.key)
}

const samePath = (a: NodePath, b: NodePath) =>
  a === b || (a.length === b.length && a.every((s, i) => s === b[i]))

/** Rows that render identically (paths compared by value, nodes by identity). */
function sameRow(a: TreeRow, b: TreeRow): boolean {
  return (
    a.node === b.node &&
    a.name === b.name &&
    a.index === b.index &&
    a.depth === b.depth &&
    a.expanded === b.expanded &&
    a.expandable === b.expandable &&
    a.hidden === b.hidden &&
    a.hiddenByParent === b.hiddenByParent &&
    a.last === b.last &&
    a.posInSet === b.posInSet &&
    a.setSize === b.setSize &&
    a.recursive === b.recursive &&
    a.parentKey === b.parentKey &&
    a.match?.[0] === b.match?.[0] &&
    a.match?.[1] === b.match?.[1] &&
    samePath(a.path, b.path) &&
    samePath(a.arrayPath, b.arrayPath) &&
    samePath(a.layerPath, b.layerPath) &&
    a.instances.length === b.instances.length &&
    a.instances.every((p, i) => samePath(p, b.instances[i]))
  )
}

/**
 * Returns a `buildTree` that reuses the row objects of its previous build when they did not
 * change, so memoized rows skip rendering on unrelated edits (e.g. while scrubbing a value).
 */
export function createTreeBuilder(): (doc: Animation, opts: BuildOptions) => TreeModel {
  let previous = new Map<string, TreeRow>()
  return (doc, opts) => {
    const model = buildTree(doc, opts)
    const rows = model.rows
    for (let i = 0; i < rows.length; i++) {
      const old = previous.get(rows[i].key)
      if (old && sameRow(old, rows[i])) rows[i] = old
    }
    previous = new Map(rows.map((r) => [r.key, r]))
    return model
  }
}

/**
 * Row keys to expand so that the node at `path` becomes visible: the chain of its tree
 * ancestors, going through a precomp instance for precomp content — through `prefer` when
 * possible (e.g. the precomp layers the node was selected through), else the first in tree
 * order. `preferred` tells whether `prefer` chose the instance. Returns null when the node is
 * not reachable from the root composition.
 */
export function ancestorRowKeys(
  doc: Animation,
  path: NodePath,
  prefer: readonly NodePath[] = [],
): { keys: string[]; rowKey: string; preferred: boolean } | null {
  const preferred = new Set(prefer.map(pathKey))
  // Precomp content: the instance chain leading to the node's composition with the most
  // preferred links (the first one in tree order on a tie).
  const compChain = (
    assetIndex: number | null,
    seen: string[],
  ): { prefix: string; keys: string[]; score: number } | null => {
    if (assetIndex === null) return { prefix: '', keys: [], score: 0 }
    const asset = doc.assets?.[assetIndex]
    if (!asset || seen.includes(asset.id)) return null
    // Instances in the root first, then inside other precomps.
    const comps: Array<{ layers: Layer[]; index: number | null }> = [
      { layers: doc.layers ?? [], index: null },
    ]
    doc.assets?.forEach((a, i) => {
      if (a && Array.isArray((a as { layers?: unknown }).layers))
        comps.push({ layers: (a as { layers: Layer[] }).layers, index: i })
    })
    let best: { prefix: string; keys: string[]; score: number } | null = null
    for (const comp of comps) {
      for (let i = 0; i < comp.layers.length; i++) {
        const l = comp.layers[i]
        if (l?.ty !== 0 || (l as { refId?: string }).refId !== asset.id) continue
        const outer = compChain(comp.index, [...seen, asset.id])
        if (!outer) continue
        const instancePath =
          comp.index === null ? ['layers', i] : ['assets', comp.index, 'layers', i]
        const instanceKey = outer.prefix + (nodeKeyOf(doc, instancePath) ?? pathKey(instancePath))
        const score = outer.score + (preferred.has(pathKey(instancePath)) ? 1 : 0)
        if (!best || score > best.score)
          best = { prefix: `${instanceKey}>`, keys: [...outer.keys, instanceKey], score }
      }
    }
    return best
  }

  const layerEnd = path[0] === 'assets' ? 4 : 2
  if (path.length < layerEnd) return null
  const layerPath = path.slice(0, layerEnd)
  const chain = compChain(path[0] === 'assets' ? (path[1] as number) : null, [])
  const layerKey = nodeKeyOf(doc, layerPath)
  if (!chain || !layerKey) return null
  const keys = [...chain.keys]
  let rowKey = chain.prefix + layerKey
  // Shape ancestors: every group between the layer and the node.
  for (let i = layerEnd + 2; i <= path.length; i += 2) {
    keys.push(rowKey)
    const nodeKey = nodeKeyOf(doc, path.slice(0, i))
    if (!nodeKey) return null
    rowKey = chain.prefix + nodeKey
  }
  return { keys, rowKey, preferred: chain.score > 0 }
}
