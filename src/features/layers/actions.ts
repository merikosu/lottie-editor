/**
 * User actions on layers and shape items. Each one is a single undoable step with a
 * translated history label, and sets the selection that follows naturally (the duplicate,
 * the new layer, the moved items, …).
 */
import { toast } from '@/components/ui'
import { layerDisplayName, nodeDisplayName } from '@/components/lottie/labels'
import { layout } from '@/app/layout'
import { getT } from '@/i18n'
import { emit } from '@/lib/events'
import {
  compInfoAt,
  createEllipseShape,
  createFillShape,
  createGradientFillShape,
  createGroupShape,
  createImageAsset,
  createImageLayer,
  createNullLayer,
  createRectShape,
  createRepeaterShape,
  createRoundCornersShape,
  createShapeLayer,
  createSolidLayer,
  createStarShape,
  createStrokeShape,
  createTextLayer,
  createTrimPathsShape,
  ensureFont,
  nextNumberedName,
  uniqueAssetId,
  DEFAULT_FONT,
} from '@/lottie/create'
import {
  addShapeItem,
  arrangeLayers,
  arrangeShapes,
  canSetParent,
  deleteLayers,
  deleteShapes,
  duplicateLayers,
  duplicateShapes,
  groupShapes,
  insertLayers,
  layersAt,
  moveLayers,
  moveShapes,
  renameNode,
  setHidden,
  setParent,
  shapeTargets,
  ungroupBlocker,
  ungroupShapes,
  type ArrangeMode,
  type UngroupBlocker,
} from '@/lottie/layer-ops'
import { findLayerIndexByInd, layerKind, nextLayerInd, type LayerKind } from '@/lottie/layers'
import {
  ROOT_LAYERS,
  compPathOf,
  getAt,
  isLayerPath,
  isShapePath,
  layerPathOf,
  pathEquals,
  pathKey,
  shapeParentPath,
  type NodePath,
} from '@/lottie/path'
import { precompInnerFrame } from '@/lottie/time'
import type { Animation, Layer, PrecompLayer, ShapeItem } from '@/lottie/types'
import { isPrecompAsset } from '@/lottie/types'
import {
  EMPTY_SELECTION,
  getDoc,
  primaryNode,
  selectNodes,
  updateDoc,
  useDocument,
  type Selection,
} from '@/store/document'
import { usePlayback } from '@/store/playback'
import { setPrefs, usePrefs } from '@/store/prefs'
import { pickImageFile, readImageFile } from './image-file'
import { instanceChainFor, instanceChainOf } from './instances'
import { isNodeLocked, isNodeSoloed, requestReveal, setLocked, setSolo } from './state'

/** Fill color of new shapes when the user has not picked a color yet. */
const DEFAULT_COLOR = '#c4c4c4'

const selectionOf = (nodes: NodePath[]): Selection => ({ nodes, keyframes: [], property: null })

const last = (path: NodePath) => path[path.length - 1] as number

/** Object of a history label: "layer", "3 layers" (layers only) or "item", "3 items". */
export function countLabel(paths: readonly NodePath[], t = getT()): string {
  return paths.length > 0 && paths.every(isLayerPath)
    ? t.layers.count.layers(paths.length)
    : t.layers.count.items(paths.length)
}

/** New content uses the most recently picked color, like After Effects' fill swatch. */
function defaultColor(): string {
  return usePrefs.getState().recentColors[0] ?? DEFAULT_COLOR
}

/* -------------------------------------------------------------------------- */
/*                                  Selection                                 */
/* -------------------------------------------------------------------------- */

export interface NodeSelection {
  layers: NodePath[]
  shapes: NodePath[]
  /** Layers and shapes in selection order. */
  all: NodePath[]
  primary: NodePath | null
}

/** Selected layers and shape items (other selected paths are ignored). */
export function selectedNodes(sel: Selection = useDocument.getState().selection): NodeSelection {
  const all = sel.nodes.filter((p) => isLayerPath(p) || isShapePath(p))
  const primary = all.length ? all[all.length - 1] : null
  return { layers: all.filter(isLayerPath), shapes: all.filter(isShapePath), all, primary }
}

/**
 * Where new or pasted layers go: above the topmost selected layer of the primary node's
 * composition, or at the top of the root composition.
 */
export function insertionPoint(sel: Selection = useDocument.getState().selection): {
  compPath: NodePath
  index: number
} {
  const primary = primaryNode(sel)
  const layerPath = primary ? layerPathOf(primary) : null
  if (!layerPath) return { compPath: ROOT_LAYERS, index: 0 }
  const compPath = compPathOf(layerPath)
  let index = last(layerPath)
  for (const node of sel.nodes) {
    const lp = layerPathOf(node)
    if (lp && pathEquals(compPathOf(lp), compPath)) index = Math.min(index, last(lp))
  }
  return { compPath, index }
}

/* -------------------------------------------------------------------------- */
/*                            Structure: delete etc.                          */
/* -------------------------------------------------------------------------- */

/** Shapes whose layer is not itself in `layers` (deleting the layer covers them). */
function shapesOutside(shapes: NodePath[], layers: NodePath[]): NodePath[] {
  const layerKeys = new Set(layers.map(pathKey))
  return shapes.filter((s) => {
    const lp = layerPathOf(s)
    return !lp || !layerKeys.has(pathKey(lp))
  })
}

/** Precomp layers leading from the root composition to the composition `id`, outermost first. */
function instanceChain(doc: Animation, id: string, seen: string[] = []): PrecompLayer[] | null {
  if (seen.includes(id)) return null
  const isInstance = (l: Layer): l is PrecompLayer =>
    l?.ty === 0 && (l as PrecompLayer).refId === id
  const direct = doc.layers?.find(isInstance)
  if (direct) return [direct]
  for (const asset of doc.assets ?? []) {
    if (!isPrecompAsset(asset)) continue
    const instance = asset.layers.find(isInstance)
    const outer = instance ? instanceChain(doc, asset.id, [...seen, id]) : null
    if (instance && outer) return [...outer, instance]
  }
  return null
}

/**
 * The playhead in the time of the composition at `compPath`, seen through the precomp instance
 * the user works in (see instances.ts), else the first chain of precomp layers that shows it.
 */
export function playheadIn(doc: Animation, compPath: NodePath): number {
  let frame = usePlayback.getState().frame
  const id = compPath[0] === 'assets' ? doc.assets?.[compPath[1] as number]?.id : undefined
  if (id === undefined) return frame
  const working = instanceChainOf(doc, id)?.map((p) => getAt<PrecompLayer>(doc, p))
  const chain = working?.every((l): l is PrecompLayer => !!l) ? working : instanceChain(doc, id)
  for (const instance of chain ?? []) frame = precompInnerFrame(instance, frame, doc.fr)
  return frame
}

/**
 * Deletes layers and shape items. Children of deleted layers move up to the nearest remaining
 * ancestor and stay where they are on screen (animated parents are frozen at the playhead).
 */
export function deleteNodes(paths: NodePath[] = selectedNodes().all, label?: string): boolean {
  const doc = getDoc()
  const layers = paths.filter(isLayerPath)
  const shapes = shapesOutside(paths.filter(isShapePath), layers)
  if (!doc || layers.length + shapes.length === 0) return false
  return updateDoc(
    label ?? getT().layers.history.delete(countLabel([...layers, ...shapes])),
    (d) => {
      deleteShapes(d as Animation, shapes)
      deleteLayers(d as Animation, layers, { frameOf: (compPath) => playheadIn(doc, compPath) })
    },
    { selection: EMPTY_SELECTION },
  )
}

/** Duplicates the selected layers (or, when no layer is selected, the selected shape items). */
export function duplicateNodes(paths: NodePath[] = selectedNodes().all): boolean {
  const t = getT()
  const layers = paths.filter(isLayerPath)
  const shapes = layers.length ? [] : paths.filter(isShapePath)
  if (!layers.length && !shapes.length) return false
  let copies: NodePath[] = []
  return updateDoc(
    t.layers.history.duplicate(countLabel(layers.length ? layers : shapes, t)),
    (d) => {
      copies = layers.length
        ? duplicateLayers(d as Animation, layers, { suffix: t.layers.copySuffix })
        : duplicateShapes(d as Animation, shapes, { suffix: t.layers.copySuffix })
    },
    { selection: () => selectionOf(copies) },
  )
}

export function renameNodeTo(path: NodePath, name: string): boolean {
  return updateDoc(getT().layers.history.rename(countLabel([path])), (d) => {
    renameNode(d as Animation, path, name)
  })
}

/* -------------------------------------------------------------------------- */
/*                         Visibility, lock and solo                          */
/* -------------------------------------------------------------------------- */

function isHidden(doc: Animation, path: NodePath): boolean {
  return !!getAt<{ hd?: boolean }>(doc, path)?.hd
}

export function setNodesHidden(
  paths: NodePath[],
  hidden: boolean,
  opts: { coalesceKey?: string; final?: boolean } = {},
): boolean {
  const t = getT()
  const what = countLabel(paths, t)
  return updateDoc(
    hidden ? t.layers.history.hide(what) : t.layers.history.show(what),
    (d) => {
      setHidden(d as Animation, paths, hidden)
    },
    opts,
  )
}

/** Hides the nodes when any of them is visible, otherwise shows them all. */
export function toggleNodesHidden(paths: NodePath[] = selectedNodes().all): boolean {
  const doc = getDoc()
  if (!doc || !paths.length) return false
  return setNodesHidden(
    paths,
    paths.some((p) => !isHidden(doc, p)),
  )
}

export function toggleNodesLocked(paths: NodePath[] = selectedNodes().all): void {
  if (!paths.length) return
  setLocked(
    paths,
    paths.some((p) => !isNodeLocked(p)),
  )
}

export function toggleNodesSolo(paths: NodePath[] = selectedNodes().layers): void {
  const layers = paths.filter(isLayerPath)
  if (!layers.length) return
  setSolo(
    layers,
    layers.some((p) => !isNodeSoloed(p)),
  )
}

/* -------------------------------------------------------------------------- */
/*                              Order and moves                               */
/* -------------------------------------------------------------------------- */

export function canArrange(): boolean {
  const { layers, shapes } = selectedNodes()
  return layers.length > 0 || shapes.length > 0
}

/** Arrange ▸ Bring to front / forward / backward / to back (layers, or shape items). */
export function arrangeSelection(mode: ArrangeMode): boolean {
  const { layers, shapes } = selectedNodes()
  if (!layers.length && !shapes.length) return false
  const titles = getT().layers.commands
  const label = {
    front: titles.bringToFront,
    forward: titles.bringForward,
    backward: titles.sendBackward,
    back: titles.sendToBack,
  }[mode]
  let moved: NodePath[] = []
  return updateDoc(
    label,
    (d) => {
      moved = layers.length
        ? arrangeLayers(d as Animation, layers, mode)
        : arrangeShapes(d as Animation, shapes, mode)
    },
    // Keyframe references hold layer indices, which just changed.
    { selection: () => selectionOf(moved) },
  )
}

export function moveLayersTo(compPath: NodePath, indices: number[], toIndex: number): boolean {
  const t = getT()
  let moved: NodePath[] = []
  return updateDoc(
    t.layers.history.move(t.layers.count.layers(indices.length)),
    (d) => {
      moved = moveLayers(d as Animation, compPath, indices, toIndex)
    },
    { selection: () => selectionOf(moved) },
  )
}

export function moveShapesTo(paths: NodePath[], arrayPath: NodePath, index: number): boolean {
  const t = getT()
  let moved: NodePath[] = []
  return updateDoc(
    t.layers.history.move(t.layers.count.items(paths.length)),
    (d) => {
      moved = moveShapes(d as Animation, paths, arrayPath, index)
    },
    { selection: () => selectionOf(moved) },
  )
}

/* -------------------------------------------------------------------------- */
/*                               Group/ungroup                                */
/* -------------------------------------------------------------------------- */

/** The selected shape items can be grouped: they share one parent array. */
export function canGroupSelection(): boolean {
  const doc = getDoc()
  const { layers, shapes } = selectedNodes()
  if (!doc || layers.length || !shapes.length) return false
  const targets = shapeTargets(doc, shapes)
  return (
    targets.length > 0 && targets.every((p) => pathEquals(p.slice(0, -1), targets[0].slice(0, -1)))
  )
}

export function groupSelection(): boolean {
  const doc = getDoc()
  if (!doc || !canGroupSelection()) return false
  const t = getT()
  const targets = shapeTargets(doc, selectedNodes().shapes)
  const siblings = getAt<ShapeItem[]>(doc, targets[0].slice(0, -1)) ?? []
  const name = nextNumberedName(
    siblings.map((s) => s.nm),
    t.layers.defaultNames.group,
  )
  let group: NodePath | null = null
  return updateDoc(
    t.layers.history.group,
    (d) => {
      group = groupShapes(d as Animation, targets, { name })
    },
    { selection: () => selectionOf(group ? [group] : []) },
  )
}

/** Why the selected groups cannot be ungrouped (null when they can; 'not-group' without groups). */
export function ungroupState(): UngroupBlocker | null {
  const doc = getDoc()
  const groups = selectedNodes().shapes.filter((p) => getAt<ShapeItem>(doc, p)?.ty === 'gr')
  if (!doc || !groups.length) return 'not-group'
  const blockers = groups.map((p) => ungroupBlocker(doc, p))
  if (blockers.some((b) => b === null)) return null
  return blockers.includes('transform') ? 'transform' : 'styles'
}

export function ungroupSelection(): boolean {
  if (ungroupState() !== null) return false
  let released: NodePath[] = []
  return updateDoc(
    getT().layers.history.ungroup,
    (d) => {
      released = ungroupShapes(d as Animation, selectedNodes().shapes)
    },
    { selection: () => selectionOf(released) },
  )
}

/* -------------------------------------------------------------------------- */
/*                                  Parenting                                 */
/* -------------------------------------------------------------------------- */

/**
 * Sets the parent (by `ind`, null = none) of every given layer where that is valid. Layers stay
 * where they are on screen (After Effects): animated parents are matched at the playhead.
 */
export function setParentOf(paths: NodePath[], parentInd: number | null): boolean {
  const doc = getDoc()
  const layers = paths.filter(isLayerPath)
  if (!doc || !layers.length) return false
  const t = getT()
  return updateDoc(
    parentInd === null ? t.layers.history.clearParent : t.layers.history.setParent,
    (d) => {
      for (const p of layers) {
        const frame = playheadIn(doc, compPathOf(p))
        setParent(d as Animation, p, parentInd, { keepInPlace: true, frame })
      }
    },
  )
}

/** Layers of the composition that can parent all `paths` (same composition, no cycles). */
export interface ParentCandidate {
  ind: number
  /** Position in the composition (0 = top). */
  index: number
  name: string
  kind: LayerKind
  /** False when it would create a cycle (it is a child of one of the layers). */
  valid: boolean
}

/**
 * Layers of the composition that can parent all `paths` (same composition, no cycles). The
 * layers themselves are left out; their descendants are listed as invalid.
 */
export function parentCandidates(doc: Animation, paths: NodePath[]): ParentCandidate[] {
  const layers = paths.filter(isLayerPath)
  if (!layers.length) return []
  const compPath = compPathOf(layers[0])
  if (!layers.every((p) => pathEquals(compPathOf(p), compPath))) return []
  const comp = layersAt(doc, compPath) ?? []
  const own = new Set(layers.map(last))
  const t = getT()
  return comp.flatMap((layer, i) =>
    typeof layer.ind !== 'number' || own.has(i)
      ? []
      : [
          {
            ind: layer.ind,
            index: i,
            name: layerDisplayName(layer, i, t),
            kind: layerKind(layer),
            valid: layers.every((p) => canSetParent(comp, last(p), layer.ind as number)),
          },
        ],
  )
}

/** Selects the parent of the primary node: the parent layer, or the group/layer holding a shape. */
export function parentOf(doc: Animation, path: NodePath): NodePath | null {
  if (isShapePath(path)) return shapeParentPath(path)
  if (!isLayerPath(path)) return null
  const layer = getAt<Layer>(doc, path)
  const comp = layersAt(doc, compPathOf(path))
  if (!layer || !comp || typeof layer.parent !== 'number') return null
  const i = findLayerIndexByInd(comp, layer.parent)
  return i >= 0 ? [...compPathOf(path), i] : null
}

/** Children of a node: layers parented to it, or the items of a group. */
export function childrenOf(doc: Animation, path: NodePath): NodePath[] {
  if (isShapePath(path)) {
    const item = getAt<ShapeItem>(doc, path)
    if (item?.ty !== 'gr' || !Array.isArray(item.it)) return []
    return item.it.flatMap((c, i) => (c.ty === 'tr' ? [] : [[...path, 'it', i]]))
  }
  if (!isLayerPath(path)) return []
  const layer = getAt<Layer>(doc, path)
  const comp = layersAt(doc, compPathOf(path)) ?? []
  if (!layer || typeof layer.ind !== 'number') return []
  return comp.flatMap((l, i) => (l.parent === layer.ind ? [[...compPathOf(path), i]] : []))
}

export function selectParent(): void {
  const doc = getDoc()
  const primary = selectedNodes().primary
  const parent = doc && primary ? parentOf(doc, primary) : null
  if (parent) selectNodes([parent])
}

export function selectChildren(): void {
  const doc = getDoc()
  const primary = selectedNodes().primary
  const children = doc && primary ? childrenOf(doc, primary) : []
  if (children.length) selectNodes(children)
}

/**
 * Selects `paths`, keeping the current primary node primary when it is among them (the views
 * stay where they are instead of jumping to the last node).
 */
function selectKeepingPrimary(paths: NodePath[]): void {
  const primary = selectedNodes().primary
  const i = primary ? paths.findIndex((p) => pathEquals(p, primary)) : -1
  selectNodes(i < 0 ? paths : [...paths.slice(0, i), ...paths.slice(i + 1), paths[i]])
}

/** Selects every layer of the root composition. */
export function selectAllLayers(): void {
  const doc = getDoc()
  if (doc) selectKeepingPrimary((doc.layers ?? []).map((_, i) => [...ROOT_LAYERS, i]))
}

/**
 * ⌘A in the layer tree: every sibling of the primary node (the layers of its composition,
 * or the items of its group).
 */
export function selectAllSiblings(): void {
  const doc = getDoc()
  if (!doc) return
  const primary = selectedNodes().primary
  if (primary && isShapePath(primary)) {
    const base = primary.slice(0, -1)
    const arr = getAt<ShapeItem[]>(doc, base) ?? []
    selectKeepingPrimary(arr.flatMap((item, i) => (item?.ty === 'tr' ? [] : [[...base, i]])))
    return
  }
  const compPath = primary && isLayerPath(primary) ? compPathOf(primary) : ROOT_LAYERS
  const layers = layersAt(doc, compPath) ?? []
  selectKeepingPrimary(layers.map((_, i) => [...compPath, i]))
}

/* -------------------------------------------------------------------------- */
/*                                 New layers                                 */
/* -------------------------------------------------------------------------- */

export type NewLayerKind = 'rect' | 'ellipse' | 'star' | 'polygon' | 'text' | 'solid' | 'null'

/**
 * Adds a layer above the selection (or at the top), centered in its composition and spanning
 * its whole time range, and selects it.
 */
export function addLayer(kind: NewLayerKind): NodePath | null {
  const t = getT()
  const doc = getDoc()
  if (!doc) return null
  const { compPath, index } = insertionPoint()
  const layers = layersAt(doc, compPath)
  if (!layers) return null
  const info = compInfoAt(doc, compPath)
  const name = nextNumberedName(
    layers.map((l) => l.nm),
    t.layers.defaultNames[kind],
  )
  const base = {
    name,
    ind: nextLayerInd(layers),
    ip: info.ip,
    op: info.op,
    position: [info.w / 2, info.h / 2],
  }
  const color = defaultColor()
  const size = Math.max(8, Math.round(Math.min(info.w, info.h) * 0.4))
  let layer: Layer
  switch (kind) {
    case 'text': {
      const fontSize = Math.max(12, Math.round(Math.min(info.w, info.h) / 10))
      layer = createTextLayer({
        ...base,
        text: t.layers.defaultText,
        size: fontSize,
        color,
        fontName: DEFAULT_FONT.fName,
        // The baseline sits on the position: lower it to center the text optically.
        position: [info.w / 2, info.h / 2 + fontSize * 0.35],
      })
      break
    }
    case 'solid':
      layer = createSolidLayer({ ...base, w: info.w, h: info.h, color })
      break
    case 'null':
      layer = createNullLayer(base)
      break
    default:
      layer = createShapeLayer({
        ...base,
        kind,
        w: size,
        h: size,
        color,
        pathName: nextNumberedName([], pathNameOf(kind)),
        fillName: nextNumberedName([], t.layers.defaultNames.fill),
      })
  }
  let path: NodePath | null = null
  updateDoc(
    t.layers.history.addLayer(name),
    (d) => {
      if (kind === 'text') ensureFont(d as Animation, DEFAULT_FONT)
      path = insertLayers(d as Animation, compPath, [layer], index)[0] ?? null
    },
    { selection: () => selectionOf(path ? [path] : []) },
  )
  if (path && kind === 'text') focusTextOf(path)
  return path
}

function pathNameOf(kind: 'rect' | 'ellipse' | 'star' | 'polygon'): string {
  const names = getT().layers.defaultNames
  return {
    rect: names.rectPath,
    ellipse: names.ellipsePath,
    star: names.starPath,
    polygon: names.polygonPath,
  }[kind]
}

/** Lets the user type the new text right away (the inspector owns the text field). */
function focusTextOf(path: NodePath): void {
  setPrefs({ rightTab: 'properties' })
  requestAnimationFrame(() => emit('edit-text', { path }))
}

/** Picks (or takes) an image file, embeds it as an asset and adds an image layer for it. */
export async function addImageLayer(file?: File | null): Promise<NodePath | null> {
  const t = getT()
  const picked = file ?? (await pickImageFile())
  if (!picked || !getDoc()) return null
  let image: Awaited<ReturnType<typeof readImageFile>>
  try {
    image = await readImageFile(picked)
  } catch (err) {
    console.warn('Image layer: could not read the file', err)
    toast.error(t.layers.errors.imageRead, { description: t.layers.errors.imageReadHint })
    return null
  }
  const doc = getDoc()
  if (!doc) return null
  const { compPath, index } = insertionPoint()
  const layers = layersAt(doc, compPath)
  if (!layers) return null
  const info = compInfoAt(doc, compPath)
  // Large images are scaled down to fit the composition (the asset keeps its full size).
  const scale = Math.min(1, info.w / image.w, info.h / image.h) * 100
  let path: NodePath | null = null
  updateDoc(
    t.layers.history.addLayer(image.name),
    (d) => {
      const anim = d as Animation
      const id = uniqueAssetId(anim, 'image_')
      if (!Array.isArray(anim.assets)) anim.assets = []
      anim.assets.push(
        createImageAsset({ id, dataUri: image.dataUri, w: image.w, h: image.h, name: image.name }),
      )
      const layer = createImageLayer(id, image.w, image.h, {
        name: image.name,
        ind: nextLayerInd(layersAt(anim, compPath) ?? []),
        ip: info.ip,
        op: info.op,
        position: [info.w / 2, info.h / 2],
        scale: Math.round(scale * 100) / 100,
      })
      path = insertLayers(anim, compPath, [layer], index)[0] ?? null
    },
    { selection: () => selectionOf(path ? [path] : []) },
  )
  return path
}

/* -------------------------------------------------------------------------- */
/*                               Shape items                                  */
/* -------------------------------------------------------------------------- */

export type ShapeItemKind =
  | 'rect'
  | 'ellipse'
  | 'star'
  | 'polygon'
  | 'fill'
  | 'stroke'
  | 'gradientFill'
  | 'trimPaths'
  | 'repeater'
  | 'roundCorners'
  | 'group'

/** Shape layer or group receiving new shape items for the current selection, or null. */
export function shapeContainer(doc: Animation | null = getDoc(), sel?: Selection): NodePath | null {
  const primary = selectedNodes(sel).primary
  if (!doc || !primary) return null
  const node = getAt<Layer | ShapeItem>(doc, primary)
  if (!node) return null
  if (isLayerPath(primary)) return node.ty === 4 ? primary : null
  if (node.ty === 'gr') return primary
  return shapeParentPath(primary)
}

/** Center and size of the static geometry in a shape array (new items are placed on it). */
function contentFrame(
  items: readonly ShapeItem[],
): { center: [number, number]; size: number } | null {
  const xs: number[] = []
  const ys: number[] = []
  const add = (x: unknown, y: unknown, rx = 0, ry = 0) => {
    if (typeof x !== 'number' || typeof y !== 'number') return
    xs.push(x - rx, x + rx)
    ys.push(y - ry, y + ry)
  }
  for (const item of items) {
    const it = item as unknown as Record<string, { k?: unknown } | undefined>
    const p = it.p?.k
    const s = it.s?.k
    if ((item.ty === 'rc' || item.ty === 'el') && Array.isArray(p) && Array.isArray(s)) {
      add(p[0], p[1], Number(s[0]) / 2, Number(s[1]) / 2)
    } else if (item.ty === 'sr' && Array.isArray(p)) {
      const r = Number(it.or?.k)
      add(p[0], p[1], r || 0, r || 0)
    } else if (item.ty === 'sh') {
      const v = (it.ks?.k as { v?: unknown } | undefined)?.v
      if (Array.isArray(v)) for (const pt of v) if (Array.isArray(pt)) add(pt[0], pt[1])
    }
  }
  if (!xs.length) return null
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2],
    size: Math.max(maxX - minX, maxY - minY),
  }
}

/** Adds a new shape item to a shape layer or group (see `shapeInsertIndex` for placement). */
export function addShapeItemTo(container: NodePath, kind: ShapeItemKind): NodePath | null {
  const t = getT()
  const doc = getDoc()
  if (!doc) return null
  const node = getAt<Layer | ShapeItem>(doc, container)
  const items =
    (node as { shapes?: ShapeItem[]; it?: ShapeItem[] } | undefined)?.shapes ??
    (node as { it?: ShapeItem[] })?.it ??
    []
  const layerPath = layerPathOf(container)
  const info = compInfoAt(doc, layerPath ? compPathOf(layerPath) : ROOT_LAYERS)
  const frame = contentFrame(items)
  const size = Math.round(frame?.size || Math.min(info.w, info.h) * 0.4) || 100
  const position = frame?.center ?? [0, 0]
  const names = t.layers.defaultNames
  const baseName = {
    rect: names.rectPath,
    ellipse: names.ellipsePath,
    star: names.starPath,
    polygon: names.polygonPath,
    fill: names.fill,
    stroke: names.stroke,
    gradientFill: names.gradientFill,
    trimPaths: names.trimPaths,
    repeater: names.repeater,
    roundCorners: names.roundCorners,
    group: names.group,
  }[kind]
  const name = nextNumberedName(
    items.map((i) => i.nm),
    baseName,
  )
  const color = defaultColor()
  const item: ShapeItem = (() => {
    switch (kind) {
      case 'rect':
        return createRectShape({ w: size, h: size, position, name })
      case 'ellipse':
        return createEllipseShape({ w: size, h: size, position, name })
      case 'star':
      case 'polygon':
        return createStarShape({ kind, outerRadius: size / 2, position, name })
      case 'fill':
        return createFillShape({ color, name })
      case 'stroke':
        return createStrokeShape({ color, name, width: Math.max(1, Math.round(size / 50)) })
      case 'gradientFill':
        return createGradientFillShape({ w: size, center: position, name })
      case 'trimPaths':
        return createTrimPathsShape({ name })
      case 'repeater':
        return createRepeaterShape({ name, offset: size })
      case 'roundCorners':
        return createRoundCornersShape({ name, radius: Math.max(1, Math.round(size / 10)) })
      case 'group':
        return createGroupShape({ name })
    }
  })()
  let path: NodePath | null = null
  updateDoc(
    t.layers.history.addShapeItem(name),
    (d) => {
      path = addShapeItem(d as Animation, container, item)
    },
    { selection: () => selectionOf(path ? [path] : []) },
  )
  return path
}

/* -------------------------------------------------------------------------- */
/*                                Cross-feature                               */
/* -------------------------------------------------------------------------- */

/** Makes the layer tree visible: the Layers tab of an expanded left panel. */
function showLayerTree(): void {
  if (usePrefs.getState().leftTab !== 'layers') setPrefs({ leftTab: 'layers' })
  if (layout().isLeftCollapsed()) layout().toggleLeft()
}

/** Moves keyboard focus to the layer tree, showing it first (command palette, keyboard users). */
export function focusLayerTree(): void {
  showLayerTree()
  // The Layers tab may mount on this render: focus once it is in the document.
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>('[data-testid="layer-tree"]')
      ?.focus({ preventScroll: true }),
  )
}

/** Precomp instance to show shared content under: the one the user works in, if any. */
function workingInstance(path: NodePath): NodePath[] | undefined {
  const doc = getDoc()
  return (doc && instanceChainFor(doc, path)) || undefined
}

/** Shows the layer tree and starts renaming the node (F2, context menu, `rename-node`). */
export function beginRename(path: NodePath): void {
  showLayerTree()
  requestReveal(path, { rename: true, prefer: workingInstance(path) })
}

/** Shows the node in the layer tree: expands its ancestors and scrolls to it (`reveal-node`). */
export function revealInTree(path: NodePath): void {
  showLayerTree()
  requestReveal(path, { prefer: workingInstance(path) })
}

export function zoomToNode(path: NodePath): void {
  emit('zoom-to-node', { path })
}

export function showInJson(path: NodePath): void {
  emit('reveal-code', { path })
}

/** Label of a node for tooltips and menus. */
export function labelOf(doc: Animation, path: NodePath): string {
  return nodeDisplayName(doc, path, getT())
}
