/**
 * Scaling and rotating several layers and groups together, about their selection box (pure;
 * see transform-edit.ts for the single-node model this builds on).
 *
 * The group edit is a map E of the artboard about a pivot C: a resize scales along the artboard
 * axes, E = diag(kx, ky), about the opposite handle (Alt: the box center); a rotation turns,
 * E = R(Δ), about the box center. Each node takes its share with its own properties:
 *
 *  - its content-space map Wᵢ⁻¹ · E · Wᵢ when those properties can express it: any uniform
 *    resize; a non-uniform one of a node whose sides run along the artboard axes; any rotation
 *    of a node drawn without distortion (parents that only move, turn, flip or scale evenly);
 *  - otherwise the closest change that never skews it: its own axes scale by as much as E
 *    stretches them on the artboard, or it turns by Δ (the other way when drawn mirrored).
 *
 * In both cases the node's center follows E exactly (an artboard offset brings it there), so the
 * arrangement of the selection always scales or turns as one.
 */
import { boundsOfPoints, transformRect, type Rect } from './geometry'
import type { HandleId } from './gizmo'
import { HANDLE_UV } from './gizmo'
import {
  applyToPoint,
  determinant,
  IDENTITY,
  invert,
  multiply,
  rotate,
  type Mat2D,
  type Point,
} from './matrix'
import { resizeFactors, snapGuides, type ResizeOptions, type ResizeResult } from './resize'
import {
  finishEdit,
  linear,
  roundValue,
  safeScale,
  type GizmoFrame,
  type TransformEdit,
  type TransformTarget,
} from './transform-edit'

/** One node of a group edit: what it edits and how it is drawn when the gesture starts. */
export interface GroupMember {
  target: TransformTarget
  frame: GizmoFrame
}

export interface GroupEdit {
  /** Each member's edit, in order. */
  edits: TransformEdit[]
  /** The selection box's content (artboard) → artboard after the edit: E about the pivot. */
  world: Mat2D
  /** The pivot on the artboard. */
  pivot: Point
  guides: ResizeResult['guides']
}

export type GroupResizePivot = 'opposite' | 'center'

/** Shift turns a group in steps of this many degrees. */
export const GROUP_ROTATION_SNAP = 15

const EPSILON = 1e-9

/** The point of a member that follows E exactly: its box center (its anchor when it has no box). */
function memberCenter(frame: GizmoFrame): Point {
  const { box } = frame
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** E about `c` as a matrix (x → c + e·(x − c)). */
function about(e: Mat2D, c: Point): Mat2D {
  const shifted = applyToPoint(e, c.x, c.y)
  return [e[0], e[1], e[2], e[3], c.x - shifted.x, c.y - shifted.y]
}

/** The offset that brings a member's center where E takes it. */
function centerOffset(frame: GizmoFrame, e: Mat2D): { center: Point; offset: Point } {
  const center = memberCenter(frame)
  const now = applyToPoint(frame.world, center.x, center.y)
  const next = applyToPoint(e, now.x, now.y)
  return { center, offset: { x: next.x - now.x, y: next.y - now.y } }
}

/**
 * A member's share of a resize by (kx, ky) along the artboard axes: its content-space factors
 * when E maps its axes onto themselves, otherwise how much E stretches each of its axes.
 */
function memberFactors(frame: GizmoFrame, kx: number, ky: number): [number, number] {
  const w = linear(frame.world)
  const inverse = invert(w)
  if (!inverse) return [1, 1]
  const d = multiply(inverse, multiply([kx, 0, 0, ky, 0, 0], w))
  const size = Math.max(Math.abs(d[0]), Math.abs(d[3]), 1)
  if (Math.abs(d[1]) <= size * 1e-9 && Math.abs(d[2]) <= size * 1e-9) return [d[0], d[3]]
  const stretch = (x: number, y: number) =>
    Math.hypot(kx * x, ky * y) / Math.max(Math.hypot(x, y), EPSILON)
  let fx = stretch(w[0], w[1]) * (d[0] < 0 ? -1 : 1)
  const fy = stretch(w[2], w[3]) * (d[3] < 0 ? -1 : 1)
  // A mirrored group mirrors the node too.
  if (kx * ky < 0 && fx * fy > 0) fx = -fx
  return [fx, fy]
}

function resizeMember(member: GroupMember, e: Mat2D): TransformEdit {
  const { target, frame } = member
  const [fx, fy] = memberFactors(frame, e[0], e[3])
  const s0 = target.scale
  const sx = Math.abs(fx - 1) < EPSILON ? s0[0] : safeScale(s0[0] * fx)
  const sy = Math.abs(fy - 1) < EPSILON ? s0[1] : safeScale(s0[1] * fy)
  const ex = s0[0] !== 0 ? sx / s0[0] : 1
  const ey = s0[1] !== 0 ? sy / s0[1] : 1
  const scale = [sx, sy, ...s0.slice(2)]
  const values = ex === 1 && ey === 1 ? {} : { scale }
  const { center, offset } = centerOffset(frame, e)
  return finishEdit(
    target,
    frame,
    [ex, 0, 0, ey, 0, 0],
    center,
    values,
    scale,
    target.rotation,
    offset,
  )
}

function rotateMember(member: GroupMember, e: Mat2D, delta: number): TransformEdit {
  const { target, frame } = member
  const f = target.inPlane
  const inverse = invert(f)
  const { center, offset } = centerOffset(frame, e)
  if (!inverse)
    return finishEdit(target, frame, IDENTITY, center, {}, target.scale, target.rotation, offset)
  // The rotation frame as drawn: mirrored frames turn the other way for the same look.
  const drawn = multiply(linear(frame.world), inverse)
  const turn = determinant(drawn) < 0 ? -delta : delta
  const rotation = roundValue(target.rotation + turn)
  const applied = rotation - target.rotation
  const local = multiply(inverse, multiply(rotate(IDENTITY, applied), f))
  const values = applied === 0 ? {} : { rotation }
  return finishEdit(target, frame, local, center, values, target.scale, rotation, offset)
}

/** Pivot of a group resize (artboard): the opposite handle, or the box center (Alt). */
export function groupResizePivot(box: Rect, handle: HandleId, pivot: GroupResizePivot): Point {
  const [u, v] = HANDLE_UV[handle]
  if (pivot === 'center') return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  return { x: box.x + (1 - u) * box.width, y: box.y + (1 - v) * box.height }
}

/**
 * Resizes the members together by dragging a handle of their selection box `box` (artboard) by
 * `delta` (the pointer's travel since the press).
 */
export function groupResize(
  members: readonly GroupMember[],
  box: Rect,
  handle: HandleId,
  delta: Point,
  opts: Omit<ResizeOptions, 'pivot'> & { pivot: GroupResizePivot },
): GroupEdit {
  const frame: GizmoFrame = { box, world: IDENTITY }
  const c = groupResizePivot(box, handle, opts.pivot)
  const factors = resizeFactors(frame, handle, c, delta, opts)
  const kx = factors?.kx ?? 1
  const ky = factors?.ky ?? 1
  const e = about([kx, 0, 0, ky, 0, 0], c)
  const bounds = boundsOfPoints(transformRect(box, e))
  return {
    edits: members.map((m) => resizeMember(m, e)),
    world: e,
    pivot: c,
    guides: snapGuides(opts.snap?.lines, factors?.snappedAt ?? {}, bounds),
  }
}

/** Center of a selection box (artboard): what a group turns about. */
export function groupRotatePivot(box: Rect): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Angle (degrees) of an artboard point around the box center; null at the center itself. */
export function groupRotationAngle(box: Rect, point: Point): number | null {
  const c = groupRotatePivot(box)
  const dx = point.x - c.x
  const dy = point.y - c.y
  if (!(Math.hypot(dx, dy) > EPSILON)) return null
  return (Math.atan2(dy, dx) * 180) / Math.PI
}

/**
 * Turns the members together by `delta` degrees (unwrapped) about the center of their selection
 * box. `snap` (Shift) turns in 15° steps.
 */
export function groupRotate(
  members: readonly GroupMember[],
  box: Rect,
  delta: number,
  snap: boolean,
): GroupEdit & { angle: number } {
  const c = groupRotatePivot(box)
  const angle = snap ? Math.round(delta / GROUP_ROTATION_SNAP) * GROUP_ROTATION_SNAP : delta
  const e = about(rotate(IDENTITY, angle), c)
  return {
    edits: members.map((m) => rotateMember(m, e, angle)),
    world: e,
    pivot: c,
    guides: { x: null, y: null },
    angle,
  }
}
