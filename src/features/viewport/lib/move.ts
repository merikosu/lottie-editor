/**
 * Moving layers and shape groups by dragging them on the canvas (pure).
 *
 * A drag is a delta in root composition (artboard) pixels. A node's position lives in its
 * parent space (parent layers, precomp instance, enclosing groups), so the delta is mapped
 * through the inverse of that space's linear part and added to the position the node had when
 * the drag started (absolute, so a long drag never drifts). Positions are written at the
 * playhead: an animated position gets a keyframe there (After Effects auto-keying), a static
 * one changes its value.
 */
import { current, isDraft, type Draft } from 'immer'
import { setValueAtFrame } from '@/lottie/keyframes'
import { comparePaths, duplicateLayers, duplicateShapes } from '@/lottie/layer-ops'
import {
  getAt,
  isLayerPath,
  isShapePath,
  pathKey,
  shapeParentPath,
  type NodePath,
} from '@/lottie/path'
import { evaluatePosition, getKeyframes, isAnimated, type AnyProperty } from '@/lottie/property'
import type { Animation, Layer, PrecompLayer, ShapeItem, Transform } from '@/lottie/types'
import { isPrecompAsset, isSplitPosition, LayerType } from '@/lottie/types'
import { applyToPoint, invert, type Mat2D, type Point } from './matrix'
import { nodeParentPlacements, type Placement } from './transforms'

export interface MoveTarget {
  /** The layer or group that moves. */
  path: NodePath
  /** Its transform: the layer's `ks`, or the group's `tr` item. */
  transformPath: NodePath
  /** Playhead in the node's composition time (where keyframes are written). */
  frame: number
  /** Position when the drag started (x, y and any further dimensions), in the parent space. */
  start: number[]
  /** Root-space delta → parent-space delta (inverse of the parent space's linear part). */
  toParent: Mat2D
}

/** Positions are written with this precision (px); finer values only bloat the file. */
const PRECISION = 100
/** Nesting guard for precomps that (indirectly) contain themselves. */
const MAX_DEPTH = 24

/* -------------------------------------------------------------------------- */
/*                                   Planning                                 */
/* -------------------------------------------------------------------------- */

/**
 * The node a drag moves for a selected node: layers and groups move themselves; other shape
 * items (paths, fills, modifiers) have no transform and move the group that contains them, or
 * their layer.
 */
export function moveOwner(doc: Animation, path: NodePath): NodePath | null {
  let p = path
  while (isShapePath(p)) {
    const item = getAt<ShapeItem>(doc, p)
    if (!item) return null
    if (item.ty === 'gr') return p
    p = shapeParentPath(p)
  }
  return isLayerPath(p) && getAt<Layer>(doc, p) ? p : null
}

/** Path of the transform a move edits: the layer's `ks` or the group's `tr` item (null if absent). */
export function transformPathOf(doc: Animation, owner: NodePath): NodePath | null {
  if (isLayerPath(owner)) return getAt<Layer>(doc, owner)?.ks ? [...owner, 'ks'] : null
  const group = getAt<ShapeItem>(doc, owner)
  if (group?.ty !== 'gr' || !Array.isArray(group.it)) return null
  const index = group.it.findIndex((it) => it.ty === 'tr')
  return index >= 0 ? [...owner, 'it', index] : null
}

/** Paths of the layers (same composition) that parent `layerPath`, nearest first. */
function parentLayerPaths(doc: Animation, layerPath: NodePath): NodePath[] {
  const compPath = layerPath.slice(0, -1)
  const layers = getAt<Layer[]>(doc, compPath)
  const layer = getAt<Layer>(doc, layerPath)
  if (!Array.isArray(layers) || !layer) return []
  const out: NodePath[] = []
  const seen = new Set<number>([layerPath[layerPath.length - 1] as number])
  let parent = layer.parent
  while (parent !== undefined) {
    const index = layers.findIndex((l) => l.ind === parent)
    if (index < 0 || seen.has(index)) break
    seen.add(index)
    out.push([...compPath, index])
    parent = layers[index].parent
  }
  return out
}

/** Precomp layers (any composition) showing the composition that contains `layerPath`. */
function precompLayersShowing(doc: Animation, layerPath: NodePath): NodePath[] {
  if (layerPath[0] !== 'assets' || typeof layerPath[1] !== 'number') return []
  const asset = doc.assets?.[layerPath[1]]
  if (!asset || !isPrecompAsset(asset)) return []
  const out: NodePath[] = []
  const scan = (layers: Layer[] | undefined, base: NodePath) =>
    layers?.forEach((l, i) => {
      if (l.ty === LayerType.Precomp && (l as PrecompLayer).refId === asset.id)
        out.push([...base, i])
    })
  scan(doc.layers, ['layers'])
  doc.assets?.forEach((a, i) => {
    if (isPrecompAsset(a)) scan(a.layers, ['assets', i, 'layers'])
  })
  return out
}

/**
 * True when something that carries `owner` along also moves: an enclosing group, its layer,
 * a parent layer, or a precomp layer showing its composition (moving both would move it twice).
 */
export function hasMovingAncestor(
  doc: Animation,
  owner: NodePath,
  moving: ReadonlySet<string>,
): boolean {
  let p = owner
  while (isShapePath(p)) {
    p = shapeParentPath(p)
    if (moving.has(pathKey(p))) return true
  }
  const visit = (layerPath: NodePath, depth: number): boolean => {
    if (depth > MAX_DEPTH) return false
    for (const parent of parentLayerPaths(doc, layerPath)) {
      if (moving.has(pathKey(parent))) return true
    }
    // The layers of a precomp also move with the precomp layers showing it (and their parents).
    for (const precomp of precompLayersShowing(doc, layerPath)) {
      if (moving.has(pathKey(precomp)) || visit(precomp, depth + 1)) return true
    }
    return false
  }
  return isLayerPath(p) ? visit(p, 0) : false
}

/**
 * The occurrence a node is dragged in: the one whose precomp instances are all under the
 * pointer (`hint`, the hit stack), preferring visible ones.
 */
function pickPlacement(
  placements: readonly Placement[],
  hint: ReadonlySet<string>,
): Placement | null {
  const matching = placements.filter((p) => p.chain.every((c) => hint.has(pathKey(c))))
  return (
    matching.find((p) => p.visible) ??
    matching[0] ??
    placements.find((p) => p.visible) ??
    placements[0] ??
    null
  )
}

/** Inverse of a matrix's linear part (translation dropped), or null when it is singular. */
function inverseLinear(m: Mat2D): Mat2D | null {
  return invert([m[0], m[1], m[2], m[3], 0, 0])
}

/** Position of a transform at `frame` (a fresh array; [0, 0] when there is none). */
export function readPosition(t: Transform | undefined, frame: number): number[] {
  const p = evaluatePosition(t?.p, frame)
  const out = [p[0] ?? 0, p[1] ?? 0, ...p.slice(2)]
  return out.map((v) => (Number.isFinite(v) ? v : 0))
}

export interface MovePlanOptions {
  /** Paths under the pointer (the hit stack): selects the precomp instance a node is dragged in. */
  instanceHint?: readonly NodePath[]
  /** Nodes that must not move (e.g. locked in the layer panel). */
  blocked?: (path: NodePath) => boolean
}

/**
 * What a drag of the selected `paths` moves, at the root frame `rootFrame`: one target per
 * layer or group, without nodes that already move along with another target.
 */
export function planMove(
  doc: Animation,
  paths: readonly NodePath[],
  rootFrame: number,
  opts: MovePlanOptions = {},
): MoveTarget[] {
  const owners = new Map<string, NodePath>()
  for (const path of paths) {
    const owner = moveOwner(doc, path)
    if (owner && !opts.blocked?.(owner)) owners.set(pathKey(owner), owner)
  }
  const moving = new Set(owners.keys())
  const hint = new Set((opts.instanceHint ?? []).map(pathKey))
  const targets: MoveTarget[] = []
  for (const owner of owners.values()) {
    if (hasMovingAncestor(doc, owner, moving)) continue
    const transformPath = transformPathOf(doc, owner)
    const placement = pickPlacement(nodeParentPlacements(doc, owner, rootFrame), hint)
    const toParent = placement ? inverseLinear(placement.matrix) : null
    if (!transformPath || !placement || !toParent) continue
    const start = readPosition(getAt<Transform>(doc, transformPath), placement.frame)
    targets.push({ path: owner, transformPath, frame: placement.frame, start, toParent })
  }
  return targets
}

/* -------------------------------------------------------------------------- */
/*                                   Writing                                  */
/* -------------------------------------------------------------------------- */

const round = (v: number) => Math.round(v * PRECISION) / PRECISION

/** Position of a target after a root-space drag of `delta` (artboard pixels). */
export function movedPosition(target: MoveTarget, delta: Point): number[] {
  const local = applyToPoint(target.toParent, delta.x, delta.y)
  const [x, y, ...rest] = target.start
  return [round(x + local.x), round(y + local.y), ...rest]
}

/** Moves legacy `e` end values to the next keyframe's `s` (the foundation helper cannot run on drafts). */
function modernizeKeyframes(prop: AnyProperty): void {
  const kfs = getKeyframes(prop)
  if (!kfs || !kfs.some((kf) => kf.e !== undefined)) return
  for (let i = 0; i < kfs.length; i++) {
    const kf = kfs[i]
    const next = kfs[i + 1]
    if (next && next.s === undefined && kf.e !== undefined) {
      const e: unknown = isDraft(kf.e) ? current(kf.e as object) : kf.e
      next.s = JSON.parse(JSON.stringify(e)) as typeof next.s
    }
    delete kf.e
  }
}

function writeScalar(prop: AnyProperty, frame: number, value: number): void {
  modernizeKeyframes(prop)
  // A static scalar stored as a one-element array keeps that form.
  setValueAtFrame(prop, frame, !isAnimated(prop) && Array.isArray(prop.k) ? [value] : value)
}

/** Values closer than this are the same position (they are written rounded to 1/PRECISION). */
const SAME_VALUE = 0.5 / PRECISION

/** Writes a position at `frame` into a transform (inside an immer recipe). */
export function writePosition(t: Draft<Transform>, frame: number, value: number[]): void {
  const p = t.p
  if (!p) {
    t.p = { a: 0, k: [...value] }
    return
  }
  if (isSplitPosition(p)) {
    // Separated dimensions are edited one by one (After Effects): a dimension that does not
    // change gets no key, which would reshape its easing for nothing (a straight vertical drag
    // must not touch X Position).
    const before = readPosition(t as Transform, frame)
    if (Math.abs(before[0] - value[0]) > SAME_VALUE) writeScalar(p.x, frame, value[0])
    if (Math.abs(before[1] - value[1]) > SAME_VALUE) writeScalar(p.y, frame, value[1])
    return
  }
  modernizeKeyframes(p)
  setValueAtFrame(p, frame, [...value])
}

/* -------------------------------------------------------------------------- */
/*                               Duplicating (Alt)                            */
/* -------------------------------------------------------------------------- */

/** True when a drag of these targets can leave copies behind: only layers, or only groups. */
export function canDuplicateTargets(targets: readonly MoveTarget[]): boolean {
  return (
    targets.length > 0 &&
    (targets.every((t) => isLayerPath(t.path)) || targets.every((t) => isShapePath(t.path)))
  )
}

function retarget(t: MoveTarget, path: NodePath): MoveTarget {
  return { ...t, path, transformPath: [...path, ...t.transformPath.slice(t.path.length)] }
}

/**
 * Alt-drag: duplicates the dragged nodes (inside an immer recipe; copies go right above their
 * originals, like ⌘D) and returns the targets moved onto the copies, so the copies take the
 * move and the originals stay. Mixed layer/group selections are not duplicated (returns the
 * targets as they are).
 */
export function duplicateTargets(
  draft: Animation,
  targets: readonly MoveTarget[],
  suffix: string,
): MoveTarget[] {
  if (!canDuplicateTargets(targets)) return [...targets]
  // Copies of groups come back in document order: pair them with the targets in that order.
  const ordered = isLayerPath(targets[0].path)
    ? [...targets]
    : [...targets].sort((a, b) => comparePaths(a.path, b.path))
  const paths = ordered.map((t) => t.path)
  const copies = isLayerPath(targets[0].path)
    ? duplicateLayers(draft, paths, { suffix })
    : duplicateShapes(draft, paths, { suffix })
  return ordered.flatMap((t, i) => (copies[i] ? [retarget(t, copies[i])] : []))
}

/** Applies a drag delta to every target (inside an immer recipe). */
export function applyMove(
  draft: Draft<Animation>,
  targets: readonly MoveTarget[],
  delta: Point,
): void {
  for (const target of targets) {
    const t = getAt<Draft<Transform>>(draft, target.transformPath)
    if (t) writePosition(t, target.frame, movedPosition(target, delta))
  }
}
