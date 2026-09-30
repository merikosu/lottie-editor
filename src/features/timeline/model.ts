/**
 * Timeline rows.
 *
 * Every layer gets a tree of its ANIMATED properties (static ones never appear in the
 * timeline): Transform, Contents (shape groups → items → properties), Masks, Text, Time remap,
 * Effects and a catch-all "Other" so no keyframe is ever hidden. Trees are memoized per layer
 * object, so structural sharing keeps edits cheap: only the edited layer is rebuilt.
 *
 * `flattenRows` turns the root composition (plus expanded precomp instances, mapped to root
 * time) into a flat, virtualizable list of rows with pixel offsets.
 */
import type { Dict } from '@/i18n'
import { layerDisplayName, shapeDisplayName } from '@/components/lottie/labels'
import { layerKind, type LayerKind } from '@/lottie/layers'
import { pathKey, type NodePath } from '@/lottie/path'
import { getKeyframes, isAnimated, isPropertyLike, type AnyProperty } from '@/lottie/property'
import { findPrecomp } from '@/lottie/traverse'
import { isTextDocumentKeys, layerAnimatedProperties, type KeyRef } from '@/lottie/timeline-ops'
import type { Animation, Effect, EffectValue, Layer, ShapeItem, Transform } from '@/lottie/types'
import { isPrecompLayer, isSplitPosition } from '@/lottie/types'
import { LAYER_ROW_H, PROP_ROW_H } from './geometry'
import { instanceMap, ROOT_MAP, type TimeMap } from './time-map'

export type PropLabel = keyof Dict['timeline']['props']

/** How a property's current value is shown in its row. */
export type ValueKind = 'number' | 'color' | 'gradient' | 'path' | 'text'

export interface PropMeta {
  value: ValueKind
  /** Unit suffix of the readout. */
  unit: '' | '%' | '°'
  /** Decimals of the readout. */
  precision: number
}

export interface PropNode {
  kind: 'property'
  /** Id relative to the layer (stable row key part). */
  id: string
  path: NodePath
  label: string
  /** Node selected together with the property's keys (the layer or the shape item). */
  owner: NodePath
  prop: AnyProperty
  meta: PropMeta
  /** Text document keys: hold-only, no easing. */
  textKeys: boolean
  /** Color stop count (gradients). */
  stops?: number
}

export interface GroupNode {
  kind: 'group'
  id: string
  label: string
  owner: NodePath
  children: TreeNode[]
  /** Every property below this group. */
  props: PropNode[]
  /** Shape item shown with its type icon. */
  shape?: { ty: string; sy?: number }
}

export type TreeNode = GroupNode | PropNode

export interface LayerModel {
  layer: Layer
  path: NodePath
  index: number
  kind: LayerKind
  name: string
  children: TreeNode[]
  /** Every animated property of the layer (summary keys, select all, time shifts). */
  props: PropNode[]
}

const NUMBER: PropMeta = { value: 'number', unit: '', precision: 1 }
const PERCENT: PropMeta = { value: 'number', unit: '%', precision: 0 }
const DEGREES: PropMeta = { value: 'number', unit: '°', precision: 1 }
const COLOR: PropMeta = { value: 'color', unit: '', precision: 0 }
const GRADIENT: PropMeta = { value: 'gradient', unit: '', precision: 0 }
const PATH: PropMeta = { value: 'path', unit: '', precision: 0 }
const TEXT: PropMeta = { value: 'text', unit: '', precision: 0 }

/** Text documents always hold keyframes; a single one is just the static text. */
export function isTimelineAnimated(prop: AnyProperty): boolean {
  if (!isAnimated(prop)) return false
  const kfs = getKeyframes(prop)!
  return !(isTextDocumentKeys(kfs) && kfs.length < 2)
}

interface Ctx {
  t: Dict
  layerPath: NodePath
  covered: Set<string>
}

const relId = (ctx: Ctx, path: NodePath) => pathKey(path.slice(ctx.layerPath.length))

function propNode(
  ctx: Ctx,
  path: NodePath,
  value: unknown,
  label: string,
  owner: NodePath,
  meta: PropMeta,
): PropNode | null {
  if (!isPropertyLike(value) || !isTimelineAnimated(value)) return null
  ctx.covered.add(pathKey(path))
  return {
    kind: 'property',
    id: relId(ctx, path),
    path,
    label,
    owner,
    prop: value,
    meta,
    textKeys: isTextDocumentKeys(getKeyframes(value)),
  }
}

function groupNode(
  ctx: Ctx,
  path: NodePath,
  label: string,
  owner: NodePath,
  children: (TreeNode | null)[],
  shape?: GroupNode['shape'],
  idSuffix = '',
): GroupNode | null {
  const kids = children.filter((c): c is TreeNode => c !== null)
  if (kids.length === 0) return null
  return {
    kind: 'group',
    id: relId(ctx, path) + idSuffix,
    label,
    owner,
    children: kids,
    props: kids.flatMap((c) => (c.kind === 'property' ? [c] : c.props)),
    shape,
  }
}

/* -------------------------------- Transform -------------------------------- */

const TRANSFORM_PROPS: [keyof Transform | 'so' | 'eo', PropLabel, PropMeta][] = [
  ['a', 'anchor', NUMBER],
  ['p', 'position', NUMBER],
  ['s', 'scale', PERCENT],
  ['r', 'rotation', DEGREES],
  ['rx', 'rotationX', DEGREES],
  ['ry', 'rotationY', DEGREES],
  ['rz', 'rotationZ', DEGREES],
  ['or', 'orientation', DEGREES],
  ['o', 'opacity', PERCENT],
  ['sk', 'skew', DEGREES],
  ['sa', 'skewAxis', DEGREES],
  ['so', 'startOpacity', PERCENT],
  ['eo', 'endOpacity', PERCENT],
]

function transformProps(
  ctx: Ctx,
  tr: Record<string, unknown> | undefined,
  base: NodePath,
  owner: NodePath,
): (TreeNode | null)[] {
  if (!tr || typeof tr !== 'object') return []
  const labels = ctx.t.timeline.props
  const out: (TreeNode | null)[] = []
  for (const [key, label, meta] of TRANSFORM_PROPS) {
    const value = tr[key]
    if (key === 'p' && isSplitPosition(value as Transform['p'])) {
      const split = value as Record<string, unknown>
      out.push(propNode(ctx, [...base, 'p', 'x'], split.x, labels.positionX, owner, NUMBER))
      out.push(propNode(ctx, [...base, 'p', 'y'], split.y, labels.positionY, owner, NUMBER))
      out.push(propNode(ctx, [...base, 'p', 'z'], split.z, labels.positionZ, owner, NUMBER))
      continue
    }
    out.push(propNode(ctx, [...base, key], value, labels[label], owner, meta))
  }
  return out
}

/* ---------------------------------- Shapes --------------------------------- */

const SHAPE_PROPS: Record<string, [string, PropLabel, PropMeta][]> = {
  rc: [
    ['p', 'position', NUMBER],
    ['s', 'size', NUMBER],
    ['r', 'roundness', NUMBER],
  ],
  el: [
    ['p', 'position', NUMBER],
    ['s', 'size', NUMBER],
  ],
  sr: [
    ['p', 'position', NUMBER],
    ['pt', 'points', NUMBER],
    ['r', 'rotation', DEGREES],
    ['ir', 'innerRadius', NUMBER],
    ['is', 'innerRoundness', PERCENT],
    ['or', 'outerRadius', NUMBER],
    ['os', 'outerRoundness', PERCENT],
  ],
  sh: [['ks', 'path', PATH]],
  fl: [
    ['c', 'color', COLOR],
    ['o', 'opacity', PERCENT],
  ],
  st: [
    ['c', 'color', COLOR],
    ['o', 'opacity', PERCENT],
    ['w', 'strokeWidth', NUMBER],
    ['ml2', 'miterLimit', NUMBER],
  ],
  gf: [
    ['s', 'startPoint', NUMBER],
    ['e', 'endPoint', NUMBER],
    ['h', 'highlightLength', PERCENT],
    ['a', 'highlightAngle', DEGREES],
    ['o', 'opacity', PERCENT],
  ],
  gs: [
    ['s', 'startPoint', NUMBER],
    ['e', 'endPoint', NUMBER],
    ['h', 'highlightLength', PERCENT],
    ['a', 'highlightAngle', DEGREES],
    ['o', 'opacity', PERCENT],
    ['w', 'strokeWidth', NUMBER],
    ['ml2', 'miterLimit', NUMBER],
  ],
  tm: [
    ['s', 'trimStart', PERCENT],
    ['e', 'trimEnd', PERCENT],
    ['o', 'trimOffset', DEGREES],
  ],
  rp: [
    ['c', 'copies', NUMBER],
    ['o', 'offset', NUMBER],
  ],
  rd: [['r', 'radius', NUMBER]],
  op: [
    ['a', 'amount', NUMBER],
    ['ml', 'miterLimit', NUMBER],
  ],
  pb: [['a', 'amount', PERCENT]],
  tw: [
    ['a', 'angle', DEGREES],
    ['c', 'center', NUMBER],
  ],
  zz: [
    ['r', 'size', NUMBER],
    ['s', 'ridges', NUMBER],
    ['pt', 'points', NUMBER],
  ],
}

const DASH_LABELS: Record<string, PropLabel> = { d: 'dash', g: 'gap', o: 'dashOffset' }

function shapeItemProps(ctx: Ctx, item: ShapeItem, path: NodePath): (TreeNode | null)[] {
  const labels = ctx.t.timeline.props
  const record = item as unknown as Record<string, unknown>
  const out: (TreeNode | null)[] = []
  if (item.ty === 'gf' || item.ty === 'gs') {
    const colors = propNode(ctx, [...path, 'g', 'k'], item.g?.k, labels.colors, path, GRADIENT)
    if (colors) colors.stops = item.g?.p
    out.push(colors)
  }
  for (const [key, label, meta] of SHAPE_PROPS[item.ty] ?? []) {
    out.push(propNode(ctx, [...path, key], record[key], labels[label], path, meta))
  }
  if ((item.ty === 'st' || item.ty === 'gs') && Array.isArray(item.d)) {
    const dashes = item.d.map((dash, i) =>
      propNode(
        ctx,
        [...path, 'd', i, 'v'],
        dash?.v,
        dash?.nm?.trim() || labels[DASH_LABELS[dash?.n] ?? 'dash'],
        path,
        NUMBER,
      ),
    )
    out.push(groupNode(ctx, [...path, 'd'], ctx.t.timeline.groups.dashes, path, dashes))
  }
  if (item.ty === 'rp') {
    const tr = transformProps(
      ctx,
      item.tr as unknown as Record<string, unknown>,
      [...path, 'tr'],
      path,
    )
    out.push(groupNode(ctx, [...path, 'tr'], ctx.t.timeline.groups.transform, path, tr))
  }
  return out
}

function shapeNodes(ctx: Ctx, items: unknown, base: NodePath): (TreeNode | null)[] {
  if (!Array.isArray(items)) return []
  return items.map((raw, i) => {
    const item = raw as ShapeItem
    if (!item || typeof item !== 'object') return null
    const path = [...base, i]
    const shape = { ty: item.ty, sy: (item as { sy?: number }).sy }
    if (item.ty === 'gr') {
      return groupNode(
        ctx,
        path,
        shapeDisplayName(item, ctx.t),
        path,
        shapeNodes(ctx, item.it, [...path, 'it']),
        shape,
      )
    }
    if (item.ty === 'tr') {
      // A group's transform belongs to the group: select the group with its keys.
      const owner = base.slice(0, -1)
      const tr = transformProps(ctx, item as unknown as Record<string, unknown>, path, owner)
      return groupNode(ctx, path, ctx.t.timeline.groups.transform, owner, tr, shape)
    }
    return groupNode(
      ctx,
      path,
      shapeDisplayName(item, ctx.t),
      path,
      shapeItemProps(ctx, item, path),
      shape,
    )
  })
}

/* ------------------------------ Masks, effects ----------------------------- */

function maskNodes(ctx: Ctx, layer: Layer, layerPath: NodePath): GroupNode | null {
  const masks = layer.masksProperties
  if (!Array.isArray(masks)) return null
  const { props, groups } = ctx.t.timeline
  const children = masks.map((mask, i) => {
    const path = [...layerPath, 'masksProperties', i]
    const record = mask as unknown as Record<string, unknown>
    return groupNode(ctx, path, mask?.nm?.trim() || groups.mask(i + 1), layerPath, [
      propNode(ctx, [...path, 'pt'], mask?.pt, props.maskPath, layerPath, PATH),
      propNode(ctx, [...path, 'o'], mask?.o, props.maskOpacity, layerPath, PERCENT),
      propNode(ctx, [...path, 'x'], mask?.x, props.maskExpansion, layerPath, NUMBER),
      propNode(ctx, [...path, 'f'], record?.f, props.maskFeather, layerPath, NUMBER),
    ])
  })
  return groupNode(ctx, [...layerPath, 'masksProperties'], groups.masks, layerPath, children)
}

/** Effect control types (bodymovin): 1 angle, 2 color, 5 group. */
function effectValueNodes(
  ctx: Ctx,
  values: unknown,
  base: NodePath,
  owner: NodePath,
): (TreeNode | null)[] {
  if (!Array.isArray(values)) return []
  return values.map((raw, j) => {
    const value = raw as EffectValue & { ef?: EffectValue[] }
    if (!value || typeof value !== 'object') return null
    const path = [...base, j]
    const label = value.nm?.trim() || `${j + 1}`
    if (value.ty === 5 && Array.isArray(value.ef)) {
      return groupNode(
        ctx,
        path,
        label,
        owner,
        effectValueNodes(ctx, value.ef, [...path, 'ef'], owner),
      )
    }
    const meta = value.ty === 2 ? COLOR : value.ty === 1 ? DEGREES : NUMBER
    return propNode(ctx, [...path, 'v'], value.v, label, owner, meta)
  })
}

function effectNodes(ctx: Ctx, layer: Layer, layerPath: NodePath): GroupNode | null {
  const effects = layer.ef
  if (!Array.isArray(effects)) return null
  const { groups } = ctx.t.timeline
  const children = effects.map((effect: Effect, i) => {
    const path = [...layerPath, 'ef', i]
    return groupNode(
      ctx,
      path,
      effect?.nm?.trim() || groups.effect(i + 1),
      layerPath,
      effectValueNodes(ctx, effect?.ef, [...path, 'ef'], layerPath),
    )
  })
  return groupNode(ctx, [...layerPath, 'ef'], groups.effects, layerPath, children)
}

/* ----------------------------------- Text ---------------------------------- */

const ANIMATOR_PROPS: [string, PropLabel, PropMeta][] = [
  ['a', 'anchor', NUMBER],
  ['p', 'position', NUMBER],
  ['s', 'scale', PERCENT],
  ['sk', 'skew', DEGREES],
  ['sa', 'skewAxis', DEGREES],
  ['r', 'rotation', DEGREES],
  ['rx', 'rotationX', DEGREES],
  ['ry', 'rotationY', DEGREES],
  ['o', 'opacity', PERCENT],
  ['fc', 'fillColor', COLOR],
  ['sc', 'strokeColor', COLOR],
  ['sw', 'strokeWidth', NUMBER],
  ['fh', 'fillHue', DEGREES],
  ['fs', 'fillSaturation', PERCENT],
  ['fb', 'fillBrightness', PERCENT],
  ['t', 'tracking', NUMBER],
  ['ls', 'lineSpacing', NUMBER],
]

const SELECTOR_PROPS: [string, PropLabel, PropMeta][] = [
  ['s', 'start', PERCENT],
  ['e', 'end', PERCENT],
  ['o', 'offset', PERCENT],
  ['a', 'amount', PERCENT],
  ['sm', 'smoothness', PERCENT],
  ['ne', 'easeLow', PERCENT],
  ['xe', 'easeHigh', PERCENT],
]

function textNodes(ctx: Ctx, layer: Layer, layerPath: NodePath): GroupNode | null {
  const text = (layer as { t?: Record<string, unknown> }).t
  if (!text || typeof text !== 'object' || layer.ty !== 5) return null
  const { props, groups } = ctx.t.timeline
  const base = [...layerPath, 't']
  const children: (TreeNode | null)[] = [
    propNode(ctx, [...base, 'd'], text.d, props.sourceText, layerPath, TEXT),
  ]
  if (Array.isArray(text.a)) {
    text.a.forEach((raw, i) => {
      const animator = raw as {
        nm?: string
        a?: Record<string, unknown>
        s?: Record<string, unknown>
      }
      const path = [...base, 'a', i]
      const own = ANIMATOR_PROPS.map(([key, label, meta]) =>
        propNode(ctx, [...path, 'a', key], animator?.a?.[key], props[label], layerPath, meta),
      )
      const selector = groupNode(
        ctx,
        [...path, 's'],
        groups.rangeSelector,
        layerPath,
        SELECTOR_PROPS.map(([key, label, meta]) =>
          propNode(ctx, [...path, 's', key], animator?.s?.[key], props[label], layerPath, meta),
        ),
      )
      children.push(
        groupNode(ctx, path, animator?.nm?.trim() || groups.animator(i + 1), layerPath, [
          ...own,
          selector,
        ]),
      )
    })
  }
  const more = text.m as { a?: unknown } | undefined
  children.push(
    groupNode(ctx, [...base, 'm'], groups.moreOptions, layerPath, [
      propNode(ctx, [...base, 'm', 'a'], more?.a, props.groupingAlignment, layerPath, NUMBER),
    ]),
  )
  const pathOptions = text.p as Record<string, unknown> | undefined
  children.push(
    groupNode(ctx, [...base, 'p'], groups.pathOptions, layerPath, [
      propNode(ctx, [...base, 'p', 'f'], pathOptions?.f, props.firstMargin, layerPath, NUMBER),
      propNode(ctx, [...base, 'p', 'l'], pathOptions?.l, props.lastMargin, layerPath, NUMBER),
    ]),
  )
  return groupNode(ctx, base, groups.text, layerPath, children)
}

/* ---------------------------------- Layers --------------------------------- */

function buildLayerModel(layer: Layer, path: NodePath, t: Dict): LayerModel {
  const ctx: Ctx = { t, layerPath: path, covered: new Set() }
  const { groups, props } = t.timeline
  const index = path[path.length - 1] as number
  const children: (TreeNode | null)[] = [
    groupNode(
      ctx,
      [...path, 'ks'],
      groups.transform,
      path,
      transformProps(ctx, layer.ks as Record<string, unknown>, [...path, 'ks'], path),
    ),
  ]
  if (layer.ty === 4) {
    children.push(
      groupNode(
        ctx,
        [...path, 'shapes'],
        groups.contents,
        path,
        shapeNodes(ctx, layer.shapes, [...path, 'shapes']),
      ),
    )
  }
  children.push(maskNodes(ctx, layer, path))
  children.push(textNodes(ctx, layer, path))
  if (isPrecompLayer(layer))
    children.push(propNode(ctx, [...path, 'tm'], layer.tm, props.timeRemap, path, NUMBER))
  children.push(effectNodes(ctx, layer, path))

  // Anything animated that the structure above does not know (layer styles, 3D, …).
  const other = layerAnimatedProperties(layer, path)
    .filter(({ path: p, prop }) => !ctx.covered.has(pathKey(p)) && isTimelineAnimated(prop))
    .map(({ path: p, prop }) =>
      propNode(ctx, p, prop, p.slice(path.length).join(' › '), path, NUMBER),
    )
  children.push(groupNode(ctx, path, groups.other, path, other, undefined, '#other'))

  const kids = children.filter((c): c is TreeNode => c !== null)
  return {
    layer,
    path,
    index,
    kind: layerKind(layer),
    name: layerDisplayName(layer, index, t),
    children: kids,
    props: kids.flatMap((c) => (c.kind === 'property' ? [c] : c.props)),
  }
}

const modelCache = new WeakMap<Layer, { key: string; t: Dict; model: LayerModel }>()

/** Animated-property tree of a layer (memoized per layer object, path and language). */
export function layerModel(layer: Layer, path: NodePath, t: Dict): LayerModel {
  const key = pathKey(path)
  const cached = modelCache.get(layer)
  if (cached && cached.key === key && cached.t === t) return cached.model
  const model = buildLayerModel(layer, path, t)
  modelCache.set(layer, { key, t, model })
  return model
}

/* -------------------------------- Summaries -------------------------------- */

/** Keys of several properties merged by time (collapsed rows show one dot per time). */
export interface SummaryKey {
  /** Local time (composition of the layer). */
  t: number
  refs: KeyRef[]
}

const summaryCache = new WeakMap<readonly PropNode[], SummaryKey[]>()

export function summaryKeys(props: readonly PropNode[]): SummaryKey[] {
  const cached = summaryCache.get(props)
  if (cached) return cached
  const all: { t: number; ref: KeyRef }[] = []
  for (const p of props) {
    getKeyframes(p.prop)?.forEach((kf, index) =>
      all.push({ t: kf.t, ref: { path: p.path, index } }),
    )
  }
  all.sort((a, b) => a.t - b.t)
  const out: SummaryKey[] = []
  for (const { t, ref } of all) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.t - t) < 1e-3) last.refs.push(ref)
    else out.push({ t, refs: [ref] })
  }
  summaryCache.set(props, out)
  return out
}

/* --------------------------------- Flatten --------------------------------- */

export type RowKind = 'layer' | 'group' | 'property'

export interface FlatRow {
  key: string
  kind: RowKind
  depth: number
  top: number
  height: number
  model: LayerModel
  node: TreeNode | null
  /** Local → root time of the row's composition (null: cannot be placed). */
  map: TimeMap | null
  /** Root-time range in which precomp ancestors show this content (null: always). */
  window: [number, number] | null
  expandable: boolean
  expanded: boolean
  /** Chain of precomp instances ("" for the root composition). */
  instance: string
  /** Precomp layers showing the row's composition, outermost first (empty for the root). */
  chain: readonly NodePath[]
  /** `chain` as a string (see chainKey in @/features/layers/instances). */
  chainKey: string
  /** Precomp asset index of the row's composition (null = root). */
  comp: number | null
}

export interface RowsResult {
  rows: FlatRow[]
  height: number
  byKey: Map<string, FlatRow>
}

const MAX_DEPTH = 6

/** Precomp layer paths of an instance chain as one string (same format as chainKey in layers). */
function instancesKey(instances: readonly NodePath[]): string {
  return instances.map(pathKey).join('>')
}

function intersect(
  a: [number, number] | null,
  b: [number, number] | null,
): [number, number] | null {
  if (!a) return b
  if (!b) return a
  return [Math.max(a[0], b[0]), Math.min(a[1], b[1])]
}

/**
 * Stable ids of the layers of a composition: `ind` when present and unique (survives
 * reordering and deleting other layers, so expanded rows stay with their layer), else the index.
 */
export function layerIds(layers: readonly Layer[]): string[] {
  const counts = new Map<number, number>()
  for (const l of layers)
    if (l && typeof l.ind === 'number') counts.set(l.ind, (counts.get(l.ind) ?? 0) + 1)
  return layers.map((l, i) =>
    l && typeof l.ind === 'number' && counts.get(l.ind) === 1 ? `i${l.ind}` : `n${i}`,
  )
}

/** Id of a composition in row keys (asset ids are escaped: they may contain any character). */
export function compId(assetId: string | null): string {
  return assetId === null ? 'root' : `c${encodeURIComponent(assetId)}`
}

/** Row key of a layer row: precomp instance chain, composition and layer id. */
export function layerRowKey(instance: string, comp: string, layerId: string): string {
  return `${instance}|${comp}:${layerId}`
}

/** Keys of every group below `nodes` (to reveal a layer's animated properties at once). */
export function groupKeys(layerKey: string, nodes: readonly TreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: readonly TreeNode[]) => {
    for (const node of list) {
      if (node.kind !== 'group') continue
      out.push(`${layerKey}#${node.id}`)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}

function sameWindow(a: [number, number] | null, b: [number, number] | null): boolean {
  return a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1])
}

function sameRow(a: FlatRow, b: Omit<FlatRow, 'top'>, top: number): boolean {
  return (
    a.top === top &&
    a.model === b.model &&
    a.node === b.node &&
    a.map === b.map &&
    a.expanded === b.expanded &&
    a.expandable === b.expandable &&
    a.depth === b.depth &&
    a.height === b.height &&
    a.chainKey === b.chainKey &&
    sameWindow(a.window, b.window)
  )
}

/**
 * Flattens the visible rows. Rows identical to those of `previous` keep their object identity,
 * so memoized row components only re-render when their own data changed.
 */
export function flattenRows(
  doc: Animation,
  t: Dict,
  expanded: Readonly<Record<string, boolean>>,
  previous?: RowsResult,
): RowsResult {
  const rows: FlatRow[] = []
  let top = 0
  const push = (row: Omit<FlatRow, 'top'>) => {
    const old = previous?.byKey.get(row.key)
    rows.push(old && sameRow(old, row, top) ? old : { ...row, top })
    top += row.height
  }

  const visitNodes = (
    nodes: readonly TreeNode[],
    depth: number,
    layerKey: string,
    base: Pick<FlatRow, 'model' | 'map' | 'window' | 'instance' | 'chain' | 'chainKey' | 'comp'>,
  ) => {
    for (const node of nodes) {
      const key = `${layerKey}#${node.id}`
      if (node.kind === 'property') {
        push({
          ...base,
          key,
          kind: 'property',
          depth,
          height: PROP_ROW_H,
          node,
          expandable: false,
          expanded: false,
        })
        continue
      }
      const open = !!expanded[key]
      push({
        ...base,
        key,
        kind: 'group',
        depth,
        height: PROP_ROW_H,
        node,
        expandable: true,
        expanded: open,
      })
      if (open) visitNodes(node.children, depth + 1, layerKey, base)
    }
  }

  const visitLayers = (
    layers: readonly Layer[],
    comp: number | null,
    compKey: string,
    basePath: NodePath,
    depth: number,
    map: TimeMap | null,
    window: [number, number] | null,
    instance: string,
    instances: readonly NodePath[],
    chain: ReadonlySet<string>,
  ) => {
    const ids = layerIds(layers)
    const chainKey = instancesKey(instances)
    layers.forEach((layer, i) => {
      if (!layer || typeof layer !== 'object') return
      const path = [...basePath, i]
      const model = layerModel(layer, path, t)
      const key = layerRowKey(instance, compKey, ids[i])
      const precomp = isPrecompLayer(layer) ? findPrecomp(doc, layer.refId) : null
      const nested =
        !!precomp &&
        precomp.asset.layers.length > 0 &&
        !chain.has(precomp.asset.id) &&
        depth < MAX_DEPTH
          ? precomp
          : null
      const expandable = model.children.length > 0 || nested !== null
      const open = expandable && !!expanded[key]
      const base = { model, map, window, instance, chain: instances, chainKey, comp }
      push({
        ...base,
        key,
        kind: 'layer',
        depth,
        height: LAYER_ROW_H,
        node: null,
        expandable,
        expanded: open,
      })
      if (!open) return
      visitNodes(model.children, depth + 1, key, base)
      if (nested && isPrecompLayer(layer)) {
        const inner = instanceMap(map, layer, doc.fr)
        const own: [number, number] | null = map
          ? [map.toRoot(layer.ip), map.toRoot(layer.op)]
          : null
        visitLayers(
          nested.asset.layers,
          nested.index,
          compId(nested.asset.id),
          ['assets', nested.index, 'layers'],
          depth + 1,
          inner,
          intersect(window, own),
          `${instance}>${compKey}:${ids[i]}`,
          [...instances, path],
          new Set([...chain, nested.asset.id]),
        )
      }
    })
  }

  visitLayers(
    doc.layers ?? [],
    null,
    compId(null),
    ['layers'],
    0,
    ROOT_MAP,
    null,
    '',
    [],
    new Set(),
  )
  return { rows, height: top, byKey: new Map(rows.map((r) => [r.key, r])) }
}

/** Keyframe times (root frames) of a row: its property keys or its collapsed summary. */
export function rowKeyTimes(row: FlatRow): number[] {
  if (!row.map) return []
  const map = row.map
  if (row.kind === 'property' && row.node?.kind === 'property') {
    return (getKeyframes(row.node.prop) ?? []).map((kf) => map.toRoot(kf.t))
  }
  if (row.expanded) return []
  const props =
    row.kind === 'layer' ? row.model.props : row.node?.kind === 'group' ? row.node.props : []
  return summaryKeys(props).map((s) => map.toRoot(s.t))
}
