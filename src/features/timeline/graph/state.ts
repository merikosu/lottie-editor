/**
 * What the graph editor shows, and its per-dimension point selection.
 *
 * The graph shows the properties of the selection: the focused property and every property
 * with selected keyframes, else the animated properties of the selected layers or shape items
 * (After Effects' "show selected / animated properties"). While the user works in the graph
 * (clicking keys, marquee, drags) the shown set is pinned, so selecting one key does not make
 * the other curves disappear; a selection made anywhere else unpins it. Document edits and
 * undo keep the pin, dropping properties that are gone.
 */
import { create } from 'zustand'
import {
  getAt,
  isLayerPath,
  isPathPrefix,
  layerPathOf,
  pathKey,
  type NodePath,
} from '@/lottie/path'
import { isAnimated, isPropertyLike } from '@/lottie/property'
import { layerAnimatedProperties } from '@/lottie/timeline-ops'
import type { Animation, Layer } from '@/lottie/types'
import { useDocument, type Selection } from '@/store/document'

interface Pin {
  path: NodePath
  /** The layer the path pointed to (`ind` or name): paths shift when layers are removed. */
  layer: string
}

export interface GraphState {
  /** Properties kept on screen while the graph changes the selection (null: follow it). */
  pinned: Pin[] | null
  /** Selected dimensions per property key (value graph points); absent: every shown dimension. */
  dims: Record<string, number[]> | null
  /** Curve highlighted from the legend or the canvas. */
  hoverCurve: string | null
  /** Curve colors (CSS custom properties) of each shown property, by property key. */
  legend: Record<string, string[]>
}

export const useGraphState = create<GraphState>()(() => ({
  pinned: null,
  dims: null,
  hoverCurve: null,
  legend: {},
}))

let graphSelecting = 0

/** Runs a selection change that originates in the graph (it keeps the shown set). */
export function asGraphSelection<T>(fn: () => T): T {
  graphSelecting++
  try {
    return fn()
  } finally {
    graphSelecting--
  }
}

function layerTag(doc: Animation, path: NodePath): string {
  const layerPath = layerPathOf(path)
  const layer = layerPath ? getAt<Layer>(doc, layerPath) : undefined
  if (!layer || typeof layer !== 'object') return ''
  return typeof layer.ind === 'number' ? `#${layer.ind}` : `@${layer.nm ?? ''}`
}

/** Pins the shown properties before the graph changes the selection (no-op when pinned). */
export function pinGraph(doc: Animation, paths: readonly NodePath[]): void {
  if (useGraphState.getState().pinned) return
  useGraphState.setState({ pinned: paths.map((path) => ({ path, layer: layerTag(doc, path) })) })
}

export function setGraphDims(dims: Record<string, number[]> | null): void {
  useGraphState.setState({ dims })
}

export function setHoverCurve(id: string | null): void {
  if (useGraphState.getState().hoverCurve !== id) useGraphState.setState({ hoverCurve: id })
}

/** Publishes the curve colors per property (skipped when unchanged: rows subscribe to it). */
export function setGraphLegend(legend: Record<string, string[]>): void {
  const current = useGraphState.getState().legend
  const keys = Object.keys(legend)
  const same =
    keys.length === Object.keys(current).length &&
    keys.every((k) => current[k]?.join() === legend[k].join())
  if (!same) useGraphState.setState({ legend })
}

/* -------------------------------------------------------------------------- */
/*                                  Derivation                                */
/* -------------------------------------------------------------------------- */

function uniq(paths: Iterable<NodePath>): NodePath[] {
  const out = new Map<string, NodePath>()
  for (const p of paths) if (!out.has(pathKey(p))) out.set(pathKey(p), p)
  return [...out.values()]
}

/** The focused property and the properties of the selected keyframes. */
export function keyedProperties(sel: Selection): NodePath[] {
  return uniq([...(sel.property ? [sel.property] : []), ...sel.keyframes.map((k) => k.path)])
}

/** Animated properties under the selected nodes (a layer: all of them; a shape item: its own). */
export function nodeProperties(doc: Animation, sel: Selection): NodePath[] {
  const out: NodePath[] = []
  for (const node of sel.nodes) {
    const layerPath = layerPathOf(node)
    const layer = layerPath ? getAt<Layer>(doc, layerPath) : undefined
    if (!layerPath || !layer || typeof layer !== 'object') continue
    for (const { path } of layerAnimatedProperties(layer, layerPath)) {
      if (isLayerPath(node) || isPathPrefix(node, path)) out.push(path)
    }
  }
  return uniq(out)
}

/** Property paths the graph shows for a selection and pin state. */
export function graphPaths(
  doc: Animation,
  sel: Selection,
  pinned: readonly Pin[] | null,
): NodePath[] {
  const keyed = keyedProperties(sel)
  if (pinned) return uniq([...pinned.map((p) => p.path), ...keyed])
  return keyed.length > 0 ? keyed : nodeProperties(doc, sel)
}

function stillThere(doc: Animation, pin: Pin): boolean {
  const prop = getAt<unknown>(doc, pin.path)
  return isPropertyLike(prop) && isAnimated(prop) && layerTag(doc, pin.path) === pin.layer
}

/* -------------------------------------------------------------------------- */
/*                                  Following                                 */
/* -------------------------------------------------------------------------- */

useDocument.subscribe(
  (s) => [s.doc, s.selection] as const,
  ([doc, sel], [prevDoc, prevSel]) => {
    const state = useGraphState.getState()
    if (sel !== prevSel && doc === prevDoc && graphSelecting === 0) {
      // A selection made elsewhere: follow it again.
      if (state.pinned || state.dims) useGraphState.setState({ pinned: null, dims: null })
      return
    }
    if (doc !== prevDoc && doc && state.pinned) {
      const kept = state.pinned.filter((p) => stillThere(doc, p))
      if (kept.length !== state.pinned.length)
        useGraphState.setState({ pinned: kept.length ? kept : null })
    }
  },
  { equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] },
)

// Another document starts with nothing pinned.
useDocument.subscribe(
  (s) => s.meta?.id,
  () => useGraphState.setState({ pinned: null, dims: null, hoverCurve: null, legend: {} }),
)
