/**
 * Timeline actions shared by commands, context menus and the keyboard. Each one is a single
 * undoable step with a translated history label.
 */
import { toast } from '@/components/ui'
import { getT } from '@/i18n'
import { layout } from '@/app/layout'
import { instanceChainFor } from '@/features/layers/instances'
import type { BezierCurve } from '@/lottie/easing'
import {
  addMarker,
  getMarkers,
  nextMarkerIndex,
  nextMarkerName,
  prevMarkerIndex,
} from '@/lottie/markers'
import {
  compAssetIndexOf,
  getAt,
  isLayerPath,
  isPathPrefix,
  layerPathOf,
  type NodePath,
} from '@/lottie/path'
import { getKeyframes } from '@/lottie/property'
import {
  allKeyRefs,
  copyKeyframes,
  deleteKeys,
  distributeKeys,
  easyEaseKeys,
  layerAnimatedProperties,
  moveKeys,
  pasteKeyframes,
  reverseKeys,
  setKeysEasing,
  shiftLayerTime,
  toggleKeysHold,
  trimLayerIn,
  trimLayerOut,
  type KeyframeClipboard,
  type KeyRef,
} from '@/lottie/timeline-ops'
import type { Animation, Layer } from '@/lottie/types'
import { getDoc, primaryNode, updateDoc, useDocument } from '@/store/document'
import { setFrame, usePlayback } from '@/store/playback'
import { getKeyClipboard, writeKeyClipboard } from './clipboard'
import { getGraphRuntime } from './graph/runtime'
import { flattenRows, groupKeys, layerModel, rowKeyTimes } from './model'
import { getTimelineRuntime } from './runtime'
import { selectionWithKeys, selectKeys } from './selection'
import {
  setTimelinePrefs,
  setTimelineView,
  setExpanded,
  useTimelinePrefs,
  useTimelineView,
  type GraphMode,
} from './store'
import { chainMap, compMap, type TimeMap } from './time-map'

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

export const hasDocument = () => getDoc() !== null
export const selectedKeys = (): KeyRef[] => useDocument.getState().selection.keyframes
export const hasSelectedKeys = () => useDocument.getState().selection.keyframes.length > 0

/**
 * Time map of the composition containing `path`: through the precomp instance the user works in
 * (canvas, layer tree or timeline — see @/features/layers/instances), else its first instance.
 */
export function mapForPath(doc: Animation, path: NodePath): TimeMap | null {
  const comp = compAssetIndexOf(layerPathOf(path) ?? path)
  if (comp === null) return compMap(doc, null)
  const chain = instanceChainFor(doc, path)
  return (chain && chainMap(doc, chain)) ?? compMap(doc, comp)
}

/** Local frame delta for a root-frame delta, for the property at `path`. */
export function localDelta(doc: Animation, path: NodePath, delta: number): number {
  const map = mapForPath(doc, path)
  return map?.linear && map.scale !== 0 ? delta / map.scale : delta
}

const playheadFrame = () => Math.round(usePlayback.getState().frame)

/* -------------------------------------------------------------------------- */
/*                                  Keyframes                                 */
/* -------------------------------------------------------------------------- */

export function deleteSelectedKeys(label = getT().timeline.history.deleteKeys): void {
  const refs = selectedKeys()
  if (refs.length === 0) return
  updateDoc(label, (d) => deleteKeys(d, refs), {
    selection: () => ({ ...useDocument.getState().selection, keyframes: [] }),
  })
}

export function copySelectedKeys(): boolean {
  const doc = getDoc()
  const refs = selectedKeys()
  if (!doc || refs.length === 0) return false
  const clip = copyKeyframes(doc, refs, {
    toRoot: (path, t) => mapForPath(doc, path)?.toRoot(t) ?? t,
  })
  if (!clip) return false
  // The in-memory copy always works; the system clipboard is a bonus (other tabs).
  void writeKeyClipboard(clip)
  return true
}

export function cutSelectedKeys(): void {
  if (copySelectedKeys()) deleteSelectedKeys(getT().timeline.history.cutKeys)
}

/**
 * Pastes keyframes at the playhead: onto the focused property (one copied track), onto the
 * same properties of the selected layer, or back onto the original properties.
 */
export function pasteKeys(clip: KeyframeClipboard | null = getKeyClipboard()): boolean {
  const doc = getDoc()
  if (!doc || !clip) return false
  const t = getT()
  const sel = useDocument.getState().selection
  const primary = primaryNode(sel)
  const targetLayer = primary ? (isLayerPath(primary) ? primary : layerPathOf(primary)) : null
  let refs: KeyRef[] = []
  updateDoc(
    t.timeline.history.pasteKeys,
    (d) => {
      refs = pasteKeyframes(d, clip, {
        at: playheadFrame(),
        targetProperty: sel.property,
        targetLayer,
        toLocal: (path, f) => mapForPath(doc, path)?.toLocal(f) ?? f,
      })
    },
    { selection: selectionWithKeys(() => refs) },
  )
  if (refs.length === 0) toast.error(t.timeline.errors.nothingToPaste)
  return refs.length > 0
}

function editKeys(label: string, fn: (d: Animation, refs: KeyRef[]) => void): void {
  const refs = selectedKeys()
  if (refs.length === 0) return
  updateDoc(label, (d) => fn(d, refs))
}

export function setSelectedEasing(curve: BezierCurve | null): void {
  editKeys(getT().timeline.history.easing, (d, refs) => setKeysEasing(d, refs, curve))
}

export function easyEaseSelected(mode: 'both' | 'in' | 'out'): void {
  editKeys(getT().timeline.history.easyEase, (d, refs) => easyEaseKeys(d, refs, mode))
}

export function toggleHoldSelected(): void {
  editKeys(getT().timeline.history.hold, (d, refs) => void toggleKeysHold(d, refs))
}

function retimeSelected(
  label: string,
  fn: (d: Animation, refs: KeyRef[]) => KeyRef[],
  coalesceKey?: string,
): void {
  const refs = selectedKeys()
  if (refs.length === 0) return
  const focus = useDocument.getState().selection.property
  let next: KeyRef[] = refs
  updateDoc(
    label,
    (d) => {
      next = fn(d, refs)
    },
    { coalesceKey, selection: selectionWithKeys(() => next, focus) },
  )
}

export function reverseSelected(): void {
  retimeSelected(getT().timeline.history.reverseKeys, reverseKeys)
}

export function distributeSelected(): void {
  retimeSelected(getT().timeline.history.distributeKeys, distributeKeys)
}

/** Moves the selected keys by whole root frames (repeated nudges merge into one undo step). */
export function nudgeSelected(delta: number): void {
  const doc = getDoc()
  if (!doc) return
  retimeSelected(
    getT().timeline.history.nudgeKeys,
    (d, refs) => moveKeys(d, refs, (path) => localDelta(doc, path, delta)),
    'timeline-nudge',
  )
}

/** Is the timeline the keyboard scope (so ⌘A selects keys instead of layers)? */
export const isTimelineFocused = () => useTimelineView.getState().focused

/** Properties "in scope": of the layers owning selected keys, of the selected nodes, or of every layer. */
function scopeProperties(doc: Animation): NodePath[] {
  const sel = useDocument.getState().selection
  const all = (layerPath: NodePath) => {
    const layer = getAt<Layer>(doc, layerPath)
    return layer ? layerAnimatedProperties(layer, layerPath).map((p) => p.path) : []
  }
  if (sel.keyframes.length > 0) {
    const layers = new Map<string, NodePath>()
    for (const k of sel.keyframes) {
      const lp = layerPathOf(k.path)
      if (lp) layers.set(lp.join('/'), lp)
    }
    return [...layers.values()].flatMap(all)
  }
  if (sel.nodes.length > 0) {
    return sel.nodes.flatMap((node) => {
      const lp = layerPathOf(node)
      if (!lp) return []
      const props = all(lp)
      return isLayerPath(node) ? props : props.filter((p) => isPathPrefix(node, p))
    })
  }
  const rows = getTimelineRuntime()?.rows().rows
  if (rows)
    return rows
      .filter((r) => r.kind === 'layer' && r.instance === '')
      .flatMap((r) => all(r.model.path))
  return (doc.layers ?? []).flatMap((_, i) => all(['layers', i]))
}

export function selectAllKeysInScope(): void {
  const doc = getDoc()
  if (!doc) return
  // The graph editor: every key of the curves it shows (keeping them on screen).
  if (useTimelinePrefs.getState().graph && getGraphRuntime()?.selectAll()) return
  selectKeys(allKeyRefs(doc, scopeProperties(doc)), 'replace')
}

/** Root times of keyframes to step through with J/K: the selection's scope or the visible rows. */
function navigationTimes(doc: Animation): number[] {
  const sel = useDocument.getState().selection
  const times: number[] = []
  const addProps = (paths: readonly NodePath[]) => {
    for (const path of paths) {
      const map = mapForPath(doc, path)
      if (!map) continue
      for (const kf of getKeyframes(getAt(doc, path) as never) ?? []) times.push(map.toRoot(kf.t))
    }
  }
  if (sel.keyframes.length > 0) {
    const props = new Map<string, NodePath>()
    for (const k of sel.keyframes) props.set(k.path.join('/'), k.path)
    addProps([...props.values()])
  } else if (sel.nodes.length > 0) {
    addProps(scopeProperties(doc))
  } else {
    const rows = getTimelineRuntime()?.rows().rows
    if (rows) for (const row of rows) times.push(...rowKeyTimes(row))
    else addProps(scopeProperties(doc))
  }
  return times
}

export function goToKeyframe(direction: 1 | -1): void {
  const doc = getDoc()
  if (!doc) return
  const frame = usePlayback.getState().frame
  let target: number | null = null
  for (const t of navigationTimes(doc)) {
    if (t < doc.ip - 1e-6 || t > doc.op) continue
    if (direction > 0 && t > frame + 1e-3 && (target === null || t < target)) target = t
    if (direction < 0 && t < frame - 1e-3 && (target === null || t > target)) target = t
  }
  if (target === null) return
  setFrame(target, { allowSubframe: !Number.isInteger(target) })
  getTimelineRuntime()?.ensureFrameVisible(target)
}

/* -------------------------------------------------------------------------- */
/*                                   Markers                                  */
/* -------------------------------------------------------------------------- */

/** Adds a marker ("Marker N") at a root frame (default: the playhead). Returns its index. */
export function addMarkerAt(frame = playheadFrame()): number {
  const t = getT()
  let index = -1
  updateDoc(t.timeline.history.addMarker, (d) => {
    index = addMarker(d, { tm: frame, cm: nextMarkerName(getMarkers(d), t.timeline.markerPrefix) })
  })
  return index
}

export function goToMarker(direction: 1 | -1): void {
  const doc = getDoc()
  if (!doc) return
  const markers = getMarkers(doc)
  const frame = usePlayback.getState().frame
  const index = direction > 0 ? nextMarkerIndex(markers, frame) : prevMarkerIndex(markers, frame)
  if (index < 0) return
  setFrame(markers[index].tm)
  getTimelineRuntime()?.ensureFrameVisible(markers[index].tm)
}

/* -------------------------------------------------------------------------- */
/*                                   Layers                                   */
/* -------------------------------------------------------------------------- */

export function selectedLayerPaths(): NodePath[] {
  return useDocument.getState().selection.nodes.filter(isLayerPath)
}

export const hasSelectedLayers = () => selectedLayerPaths().length > 0

type LayerTimeOp = 'moveIn' | 'moveOut' | 'trimIn' | 'trimOut'

/**
 * After Effects `[` / `]` (move the layer so its in/out point is at the playhead) and
 * Alt+`[` / Alt+`]` (trim the in/out point to the playhead). Out points are exclusive, so the
 * playhead frame stays the layer's last visible frame.
 */
export function layerTimeToPlayhead(
  op: LayerTimeOp,
  paths: readonly NodePath[] = selectedLayerPaths(),
): void {
  const doc = getDoc()
  if (!doc || paths.length === 0) return
  const t = getT().timeline.history
  const frame = playheadFrame()
  const label = op === 'trimIn' ? t.trimIn : op === 'trimOut' ? t.trimOut : t.moveLayer
  updateDoc(label, (d) => {
    for (const path of paths) {
      const layer = getAt<Layer>(d, path)
      const map = mapForPath(doc, path)
      if (!layer || !map) continue
      const local = Math.round(map.toLocal(frame) * 1000) / 1000
      const next = Math.round(map.toLocal(frame + 1) * 1000) / 1000
      if (op === 'moveIn') shiftLayerTime(layer, local - layer.ip)
      else if (op === 'moveOut') shiftLayerTime(layer, next - layer.op)
      else if (op === 'trimIn') trimLayerIn(layer, local)
      else trimLayerOut(layer, next)
    }
  })
}

/* -------------------------------------------------------------------------- */
/*                                Graph editor                                */
/* -------------------------------------------------------------------------- */

/** Shows or hides the graph editor (opening the timeline panel when it is collapsed). */
export function toggleGraph(show = !useTimelinePrefs.getState().graph): void {
  if (show && layout().isBottomCollapsed()) layout().toggleBottom()
  setTimelinePrefs({ graph: show })
}

/** Shows the value or the speed graph (opening the graph editor). */
export function showGraphMode(mode: GraphMode): void {
  toggleGraph(true)
  setTimelinePrefs({ graphMode: mode })
}

export function toggleGraphNormalize(): void {
  setTimelinePrefs({ graphNormalize: !useTimelinePrefs.getState().graphNormalize })
}

/** Fits the value axis to the curves again, or keeps the current range (auto-fit off). */
export function toggleGraphFit(): void {
  const graph = getGraphRuntime()
  if (useTimelineView.getState().graphFit && graph) {
    setTimelineView({ graphFit: false, graphRange: graph.fittedRange() })
  } else setTimelineView({ graphFit: true, graphRange: null })
}

/** Moves keyboard focus to the timeline rows, opening the panel when it is collapsed. */
export function focusTimeline(): void {
  if (layout().isBottomCollapsed()) layout().toggleBottom()
  // The panel may mount on this render: focus once it is in the document.
  requestAnimationFrame(() => getTimelineRuntime()?.focusRows())
}

/**
 * U: reveals every animated property of the selected layers (or of all layers); pressing it
 * again collapses them. Opens the timeline panel when it is collapsed.
 */
export function revealAnimatedProperties(): void {
  const doc = getDoc()
  if (!doc) return
  const t = getT()
  if (layout().isBottomCollapsed()) layout().toggleBottom()
  const selected = new Set(
    useDocument.getState().selection.nodes.map((n) => (layerPathOf(n) ?? n).join('/')),
  )
  const rows = getTimelineRuntime()?.rows().rows
  const targets: { key: string; path: NodePath; layer: Layer }[] = []
  if (rows) {
    for (const row of rows) {
      if (row.kind !== 'layer') continue
      if (selected.size ? selected.has(row.model.path.join('/')) : row.instance === '') {
        targets.push({ key: row.key, path: row.model.path, layer: row.model.layer })
      }
    }
  } else {
    for (const row of flattenRows(doc, t, {}).rows) {
      if (!selected.size || selected.has(row.model.path.join('/'))) {
        targets.push({ key: row.key, path: row.model.path, layer: row.model.layer })
      }
    }
  }
  const keys: string[] = []
  for (const { key, path, layer } of targets) {
    const model = layerModel(layer, path, t)
    if (model.children.length === 0) continue
    keys.push(key, ...groupKeys(key, model.children))
  }
  const { expanded } = useTimelineView.getState()
  const expand = !keys.every((k) => expanded[k])
  setExpanded(keys, expand)
  // Scroll the primary selected layer's properties into view once they render.
  const primary = primaryNode(useDocument.getState().selection)
  const primaryLayer = primary ? layerPathOf(primary) : null
  if (expand && primaryLayer) getTimelineRuntime()?.revealExpanded(primaryLayer)
}
