/**
 * Rotating a layer or group with the gizmo (pure; see transform-edit.ts for the model).
 *
 * The angle is measured in the frame the rotation property turns (the node's content through
 * F = R(r) · Skew · S(s), relative to the pivot), not on screen: the content point that was
 * under the pointer stays on the line from the pivot to the pointer, and the direction matches
 * what the user sees under flipped parents, flipped nodes, non-uniform parent scale and 3D.
 *
 * The pivot is the anchor point (the rotation property turns about it; nothing else changes),
 * or the box center (Alt; the position moves the center back).
 */
import { applyToPoint, invert, multiply, rotate, IDENTITY, type Point } from './matrix'
import {
  finishEdit,
  roundValue,
  type GizmoFrame,
  type TransformEdit,
  type TransformTarget,
} from './transform-edit'

export type RotatePivot = 'anchor' | 'center'

/** Shift snaps the rotation to multiples of this (degrees). */
export const ROTATION_SNAP = 15

/** Pivot (content coordinates) of a rotation. */
export function rotatePivot(target: TransformTarget, frame: GizmoFrame, pivot: RotatePivot): Point {
  if (pivot === 'anchor') return target.anchor
  const { box } = frame
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Angle (degrees) of an artboard point around the content-space pivot, in the frame the
 * rotation turns. Null at the pivot itself (no direction) or when the node is singular.
 */
export function rotationAngle(
  target: TransformTarget,
  frame: GizmoFrame,
  pivot: Point,
  point: Point,
): number | null {
  const inverse = invert(frame.world)
  if (!inverse) return null
  const q = applyToPoint(inverse, point.x, point.y)
  const v = applyToPoint(target.inPlane, q.x - pivot.x, q.y - pivot.y)
  if (!(Math.hypot(v.x, v.y) > 1e-9)) return null
  return (Math.atan2(v.y, v.x) * 180) / Math.PI
}

/**
 * The angle equal to `raw` modulo 360 closest to `previous`: a drag that goes around the
 * pivot keeps adding up (two turns = 720°) instead of jumping at ±180°.
 */
export function unwrapAngle(previous: number, raw: number): number {
  return raw + Math.round((previous - raw) / 360) * 360
}

/**
 * Rotates the target by `delta` degrees (unwrapped) about `pivot`. `snap` (Shift) rounds the
 * resulting rotation to multiples of 15°.
 */
export function rotateNode(
  target: TransformTarget,
  frame: GizmoFrame,
  pivot: RotatePivot,
  delta: number,
  snap: boolean,
): TransformEdit {
  const c = rotatePivot(target, frame, pivot)
  const r0 = target.rotation
  const raw = r0 + delta
  const rotation = snap ? Math.round(raw / ROTATION_SNAP) * ROTATION_SNAP : roundValue(raw)
  const applied = rotation - r0
  const f = target.inPlane
  const inverse = invert(f)
  if (!inverse || applied === 0 || !Number.isFinite(applied))
    return finishEdit(target, frame, IDENTITY, c, {}, target.scale, r0)
  // E = F⁻¹ · R(Δ) · F: the rotation of the frame, expressed in content space.
  const e = multiply(inverse, multiply(rotate(IDENTITY, applied), f))
  return finishEdit(target, frame, e, c, { rotation }, target.scale, rotation)
}
