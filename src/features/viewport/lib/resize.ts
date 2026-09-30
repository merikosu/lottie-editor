/**
 * Resizing a layer or group by a gizmo handle (pure; see transform-edit.ts for the model).
 *
 * The dragged handle follows the pointer in the node's content space (through the inverse of
 * its world matrix when the drag started), so it tracks the pointer exactly under any rotation,
 * skew, flip or parent. The scale changes along the node's own axes, about a pivot:
 *
 *   opposite  the opposite handle: the opposite edge stays where it is             default
 *   anchor    the anchor point for layers (their pivot marker); the box center     Alt
 *             for groups (their anchor is not shown and rarely where the content is).
 *             On an axis where the anchor lies on the dragged edge the center stands in.
 *
 * With `uniform` (Shift) a corner scales both axes by one factor, taken from the pointer's
 * projection on the pivot → handle diagonal; an edge handle scales the other axis along.
 * Crossing the pivot flips the node (negative scale), like design tools do.
 */
import { isShapePath } from '@/lottie/path'
import { boundsOfPoints, transformRect, type Rect } from './geometry'
import { HANDLE_UV, type HandleId } from './gizmo'
import { applyToPoint, invert, type Point } from './matrix'
import type { SnapGuide, SnapLines } from './snap'
import {
  finishEdit,
  linear,
  safeScale,
  type GizmoFrame,
  type TransformEdit,
  type TransformTarget,
} from './transform-edit'

export type ResizePivot = 'opposite' | 'anchor'

export interface ResizeOptions {
  pivot: ResizePivot
  /** Keep the proportions (Shift). */
  uniform: boolean
  /** Shortest a side can get (artboard units, e.g. one screen pixel): it never collapses. */
  minSize?: number
  /**
   * Lines the moving edges snap to within `threshold` (artboard units). Only while the box's
   * sides are horizontal and vertical on the artboard.
   */
  snap?: { lines: SnapLines; threshold: number } | null
}

export interface ResizeResult extends TransformEdit {
  /** Snapping guides (artboard coordinates). */
  guides: { x: SnapGuide | null; y: SnapGuide | null }
}

/** A pivot closer than this to the dragged handle (fraction of the box) cannot scale it. */
const DEGENERATE_PIVOT = 0.02
/** Lines closer than this are the same line (their guides merge). */
const SAME_LINE = 1e-3

export type Axis = 'x' | 'y'

/** Pivot (content coordinates) of a resize by `handle`. */
export function resizePivot(
  target: TransformTarget,
  frame: GizmoFrame,
  handle: HandleId,
  pivot: ResizePivot,
): Point {
  const [u, v] = HANDLE_UV[handle]
  const { box } = frame
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  if (pivot === 'anchor') {
    if (isShapePath(target.path)) return center
    const a = target.anchor
    // An anchor on the dragged edge's line cannot scale that axis: the center stands in there.
    const flatX = u !== 0.5 && Math.abs(box.x + u * box.width - a.x) < box.width * DEGENERATE_PIVOT
    const flatY =
      v !== 0.5 && Math.abs(box.y + v * box.height - a.y) < box.height * DEGENERATE_PIVOT
    return { x: flatX ? center.x : a.x, y: flatY ? center.y : a.y }
  }
  return { x: box.x + (1 - u) * box.width, y: box.y + (1 - v) * box.height }
}

/** Keeps |k| · length ≥ minSize (the sign, and so a flip, is kept). */
function clampFactor(k: number, length: number, minSize: number): number {
  if (!(length > 0) || !(minSize > 0)) return k
  const min = minSize / length
  if (Math.abs(k) >= min) return k
  return k < 0 ? -min : min
}

/**
 * The artboard axis each content axis runs along, when the box's sides are horizontal and
 * vertical on the artboard (no rotation other than quarter turns, no skew); null otherwise.
 */
export function artboardAxes(world: readonly number[]): { x: Axis; y: Axis } | null {
  const [a, b, c, d] = world
  const scaleOf = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d), 1e-12)
  const eps = scaleOf * 1e-9
  if (Math.abs(b) <= eps && Math.abs(c) <= eps) return { x: 'x', y: 'y' }
  if (Math.abs(a) <= eps && Math.abs(d) <= eps) return { x: 'y', y: 'x' }
  return null
}

/** The line within `threshold` of `value` closest to it. */
function nearestLine(
  lines: SnapLines,
  axis: Axis,
  value: number,
  threshold: number,
): number | null {
  let best: number | null = null
  for (const line of lines[axis]) {
    const d = Math.abs(line.at - value)
    if (d <= threshold && (best === null || d < Math.abs(best - value))) best = line.at
  }
  return best
}

/** Scale factors of a resize along the box's own axes, and the lines its edges snapped to. */
export interface ResizeFactors {
  kx: number
  ky: number
  /** Artboard lines the dragged edges snapped to, per artboard axis. */
  snappedAt: Partial<Record<Axis, number>>
}

/**
 * Factors of a resize of the gizmo drawn on `frame` by dragging `handle` by `delta` (artboard
 * units: the pointer's travel since the press) about the pivot `c` (frame content coordinates).
 * Null when the box cannot be resized (singular, or the drag gives no finite factor).
 */
export function resizeFactors(
  frame: GizmoFrame,
  handle: HandleId,
  c: Point,
  delta: Point,
  opts: Omit<ResizeOptions, 'pivot'>,
): ResizeFactors | null {
  const [u, v] = HANDLE_UV[handle]
  const { box, world } = frame
  const h = { x: box.x + u * box.width, y: box.y + v * box.height }
  const inverse = invert(world)
  if (!inverse) return null

  // Where the handle is dragged to: on the artboard, then in content space.
  const hw = applyToPoint(world, h.x, h.y)
  const cw = applyToPoint(world, c.x, c.y)
  const goal = { x: hw.x + delta.x, y: hw.y + delta.y }
  const q = applyToPoint(inverse, goal.x, goal.y)
  const moves = { x: u !== 0.5, y: v !== 0.5 }
  let kx = moves.x ? (q.x - c.x) / (h.x - c.x) : 1
  let ky = moves.y ? (q.y - c.y) / (h.y - c.y) : 1
  if (opts.uniform) {
    if (moves.x && moves.y) {
      // The point of the pivot → handle diagonal closest to the pointer (on the artboard).
      const dx = hw.x - cw.x
      const dy = hw.y - cw.y
      const len2 = dx * dx + dy * dy
      const k = len2 > 0 ? ((goal.x - cw.x) * dx + (goal.y - cw.y) * dy) / len2 : 1
      kx = k
      ky = k
    } else if (moves.x) ky = kx
    else kx = ky
  }
  if (!Number.isFinite(kx) || !Number.isFinite(ky)) return null

  // Snapping: the dragged edges stick to lines. On an axis-aligned box the artboard position of
  // an edge moving along content axis i is cw + k · (hw − cw) on the artboard axis it maps to.
  const axes = opts.snap ? artboardAxes(world) : null
  const snappedAt: Partial<Record<Axis, number>> = {}
  if (opts.snap && axes) {
    const { lines, threshold } = opts.snap
    const candidates: { content: Axis; at: number; k: number; distance: number }[] = []
    for (const content of ['x', 'y'] as const) {
      if (!moves[content]) continue
      const axis = axes[content]
      const span = hw[axis] - cw[axis]
      if (Math.abs(span) < 1e-9) continue
      const k = content === 'x' ? kx : ky
      const edge = cw[axis] + k * span
      const at = nearestLine(lines, axis, edge, threshold)
      if (at !== null)
        candidates.push({ content, at, k: (at - cw[axis]) / span, distance: Math.abs(at - edge) })
    }
    if (opts.uniform) {
      // One factor for both axes: the closest line wins.
      const best = candidates.sort((a, b) => a.distance - b.distance)[0]
      if (best) {
        kx = best.k
        ky = best.k
        snappedAt[axes[best.content]] = best.at
      }
    } else {
      for (const cand of candidates) {
        if (cand.content === 'x') kx = cand.k
        else ky = cand.k
        snappedAt[axes[cand.content]] = cand.at
      }
    }
  }

  // A side never gets shorter than minSize on the artboard (a snapped edge that would is freed).
  const m = linear(world)
  const lengthX = Math.hypot(m[0], m[1]) * box.width
  const lengthY = Math.hypot(m[2], m[3]) * box.height
  const minSize = opts.minSize ?? 0
  const before = { kx, ky }
  if (opts.uniform) {
    const k = clampFactor(clampFactor(kx, lengthX, minSize), lengthY, minSize)
    kx = k
    ky = k
  } else {
    kx = clampFactor(kx, lengthX, minSize)
    ky = clampFactor(ky, lengthY, minSize)
  }
  if (kx !== before.kx || ky !== before.ky) {
    delete snappedAt.x
    delete snappedAt.y
  }
  return { kx, ky, snappedAt }
}

/**
 * Resizes the target by dragging `handle` by `delta` (artboard units: the pointer's travel since
 * the press). Returns the values to write and how the node is drawn afterwards.
 */
export function resizeNode(
  target: TransformTarget,
  frame: GizmoFrame,
  handle: HandleId,
  delta: Point,
  opts: ResizeOptions,
): ResizeResult {
  const c = resizePivot(target, frame, handle, opts.pivot)
  const factors = resizeFactors(frame, handle, c, delta, opts)
  if (!factors) {
    const edit = finishEdit(target, frame, [1, 0, 0, 1, 0, 0], c, {}, target.scale, target.rotation)
    return { ...edit, guides: { x: null, y: null } }
  }
  const { kx, ky } = factors
  // Written values are rounded: the factors actually applied follow from them.
  const s0 = target.scale
  const sx = kx === 1 ? s0[0] : safeScale(s0[0] * kx)
  const sy = ky === 1 ? s0[1] : safeScale(s0[1] * ky)
  const ex = s0[0] !== 0 ? sx / s0[0] : 1
  const ey = s0[1] !== 0 ? sy / s0[1] : 1
  const scale = [sx, sy, ...s0.slice(2)]
  const values = ex === 1 && ey === 1 ? {} : { scale }
  const edit = finishEdit(target, frame, [ex, 0, 0, ey, 0, 0], c, values, scale, target.rotation)
  const bounds = boundsOfPoints(transformRect(frame.box, edit.world))
  return { ...edit, guides: snapGuides(opts.snap?.lines, factors.snappedAt, bounds) }
}

/**
 * Guides for the snapped edges: each spans what it snapped to (every line at that position)
 * and the resized box (`bounds`, artboard coordinates).
 */
export function snapGuides(
  lines: SnapLines | undefined,
  snappedAt: Partial<Record<Axis, number>>,
  bounds: Rect | null,
): ResizeResult['guides'] {
  const guides: ResizeResult['guides'] = { x: null, y: null }
  if (!lines || !bounds) return guides
  for (const axis of ['x', 'y'] as const) {
    const at = snappedAt[axis]
    if (at === undefined) continue
    let from = axis === 'x' ? bounds.y : bounds.x
    let to = axis === 'x' ? bounds.y + bounds.height : bounds.x + bounds.width
    for (const line of lines[axis]) {
      if (Math.abs(line.at - at) > SAME_LINE) continue
      from = Math.min(from, line.from)
      to = Math.max(to, line.to)
    }
    guides[axis] = { at, from, to }
  }
  return guides
}
