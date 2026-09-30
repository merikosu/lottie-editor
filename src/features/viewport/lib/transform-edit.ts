/**
 * Scaling and rotating a layer or shape group with the canvas gizmo (pure).
 *
 * Every gizmo edit is an affine map E of the node's content space about a pivot C (content
 * coordinates): afterwards the node is drawn as W0 ∘ E, where W0 maps its content to the
 * artboard when the drag started. Only the node's own transform changes:
 *
 *   resize   E = T(C) · diag(k) · T(−C)              scale     s' = s ⊙ k
 *   rotate   E = T(C) · F⁻¹ · R(Δ) · F · T(−C)        rotation  r' = r + Δ
 *
 * where F = R(r) · Skew · S(s) is the part of the transform below its rotation (content → the
 * frame the rotation property turns). Changing s or r alone turns the content about the anchor
 * point a; the position then brings the pivot back (linear parts only, P: parent space → artboard):
 *
 *   p' = p + P⁻¹ · W0 · (E − I) · (a − C)
 *
 * Working in content space through W0 keeps this exact under rotated, scaled, skewed or flipped
 * parents, 3D layers and precomp instances without decomposing any of them: W0 comes from the
 * rendered SVG (or from the document with the Canvas renderer), and only P is taken from the
 * document, for the position.
 */
import type { Draft } from 'immer'
import { chainKey } from '@/features/layers/instances'
import { setValueAtFrame } from '@/lottie/keyframes'
import { getAt, isLayerPath, type NodePath } from '@/lottie/path'
import { evaluateScalar, evaluateVector, isAnimated, type AnyProperty } from '@/lottie/property'
import type { Animation, Transform } from '@/lottie/types'
import type { Rect } from './geometry'
import {
  applyToPoint,
  IDENTITY,
  invert,
  multiply,
  rotate,
  scale,
  skewX,
  type Mat2D,
  type Point,
} from './matrix'
import { readPosition, transformPathOf, writePosition } from './move'
import { nodeParentPlacements, type Placement } from './transforms'

/** The node a gizmo edits, with its transform when the gesture started. */
export interface TransformTarget {
  /** The layer or group. */
  path: NodePath
  /** Its transform: the layer's `ks`, or the group's `tr` item. */
  transformPath: NodePath
  /** Playhead in the node's composition time (where keys are written). */
  frame: number
  /** Layers keep x, y, z in scale and position; groups x, y. */
  dims: 2 | 3
  /** The rotation property: `rz` for 3D layers (lottie-web ignores `r` there), else `r`. */
  rotationKey: 'r' | 'rz'
  position: number[]
  /** Scale in percent, at least x and y (z kept as it is). */
  scale: number[]
  /** Rotation in degrees. */
  rotation: number
  /** Anchor point (content coordinates). */
  anchor: Point
  /** F = R(r) · Skew · S(s): content (relative to a pivot) → the frame the rotation turns. */
  inPlane: Mat2D
  /** Artboard delta → parent-space delta (inverse of the parent space's linear part). */
  toParent: Mat2D
}

/** Where a gizmo is drawn: the node's content box and its content → artboard matrix (W0). */
export interface GizmoFrame {
  box: Rect
  world: Mat2D
}

/** Values to write at the playhead; absent ones do not change. */
export interface TransformValues {
  scale?: number[]
  rotation?: number
  position?: number[]
}

/** Result of a gizmo edit: what to write and how the node is drawn afterwards. */
export interface TransformEdit {
  values: TransformValues
  /** Content → artboard after the edit. */
  world: Mat2D
  /** Scale and rotation after the edit (readouts). */
  scale: number[]
  rotation: number
  /** The pivot (content coordinates). */
  pivot: Point
}

/** Positions are written with this precision (px), like canvas drags. */
const POSITION_PRECISION = 100
/** Scale (%) and rotation (°) are written with this precision. */
const VALUE_PRECISION = 100
/** Smallest scale written (%): zero would make the node (and its gizmo) singular. */
const MIN_SCALE = 1 / VALUE_PRECISION

export const roundPosition = (v: number) => Math.round(v * POSITION_PRECISION) / POSITION_PRECISION
export const roundValue = (v: number) => Math.round(v * VALUE_PRECISION) / VALUE_PRECISION

const num = (v: number | undefined, fallback: number) =>
  v !== undefined && Number.isFinite(v) ? v : fallback

/** Linear part of a matrix (translation dropped). */
export function linear(m: Mat2D): Mat2D {
  return [m[0], m[1], m[2], m[3], 0, 0]
}

/* -------------------------------------------------------------------------- */
/*                                   Planning                                 */
/* -------------------------------------------------------------------------- */

/** The instance edited: the one drawn through `chain`, else a visible one. */
function pickPlacement(placements: readonly Placement[], chain: string | null): Placement | null {
  return (
    (chain !== null ? placements.find((p) => chainKey(p.chain) === chain) : undefined) ??
    placements.find((p) => p.visible) ??
    placements[0] ??
    null
  )
}

/** F = R(r) · Skew · S(s), as lottie-web composes them (see transforms.ts). */
export function inPlaneMatrix(
  rotation: number,
  scalePercent: readonly number[],
  skew = 0,
  skewAxis = 0,
): Mat2D {
  let m = rotate(IDENTITY, rotation)
  if (skew !== 0) m = rotate(skewX(rotate(m, -skewAxis), -skew), skewAxis)
  return scale(m, num(scalePercent[0], 100) / 100, num(scalePercent[1], 100) / 100)
}

/**
 * The transform a gizmo edits for `owner` (a layer or group) at the root frame `rootFrame`, in
 * the precomp instance `chain` (chain key of the instance drawn with the gizmo; null: any).
 * Null when the node has no transform or its parent space is singular.
 */
export function planTransform(
  doc: Animation,
  owner: NodePath,
  rootFrame: number,
  chain: string | null = null,
): TransformTarget | null {
  const transformPath = transformPathOf(doc, owner)
  const t = transformPath ? getAt<Transform>(doc, transformPath) : undefined
  if (!transformPath || !t) return null
  const placement = pickPlacement(nodeParentPlacements(doc, owner, rootFrame), chain)
  const toParent = placement ? invert(linear(placement.matrix)) : null
  if (!placement || !toParent) return null
  const frame = placement.frame
  const layer = isLayerPath(owner)
  const threeD = !!t.rx
  const s = evaluateVector(t.s, frame, layer ? [100, 100, 100] : [100, 100])
  const scalePercent = [num(s[0], 100), num(s[1] ?? s[0], 100), ...s.slice(2)]
  const rotation = num(evaluateScalar(threeD ? t.rz : t.r, frame), 0)
  const a = evaluateVector(t.a, frame, [0, 0])
  return {
    path: owner,
    transformPath,
    frame,
    dims: layer ? 3 : 2,
    rotationKey: threeD ? 'rz' : 'r',
    position: readPosition(t, frame),
    scale: scalePercent,
    rotation,
    anchor: { x: num(a[0], 0), y: num(a[1], 0) },
    inPlane: inPlaneMatrix(
      rotation,
      scalePercent,
      num(evaluateScalar(t.sk, frame), 0),
      num(evaluateScalar(t.sa, frame), 0),
    ),
    toParent,
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Editing                                   */
/* -------------------------------------------------------------------------- */

/** Values closer than this are unchanged (they are written rounded). */
const SAME_POSITION = 0.5 / POSITION_PRECISION

/**
 * Completes an edit given by the linear part `e` of E about the pivot `c`: the position that
 * keeps the pivot in place (when it is not the anchor point) and the node's new world matrix.
 * `offset` (artboard units) moves the node afterwards: W' = T(offset) · W0 · E.
 */
export function finishEdit(
  target: TransformTarget,
  frame: GizmoFrame,
  e: Mat2D,
  c: Point,
  values: TransformValues,
  scaleAfter: number[],
  rotationAfter: number,
  offset: Point = { x: 0, y: 0 },
): TransformEdit {
  const a = target.anchor
  // (E − I) · (a − C), to the artboard through W0, then to the parent space.
  const moved = applyToPoint(e, a.x - c.x, a.y - c.y)
  const local = { x: moved.x - (a.x - c.x), y: moved.y - (a.y - c.y) }
  const onArtboard = applyToPoint(linear(frame.world), local.x, local.y)
  const d = applyToPoint(target.toParent, onArtboard.x + offset.x, onArtboard.y + offset.y)
  const out: TransformValues = { ...values }
  if (Math.abs(d.x) > SAME_POSITION || Math.abs(d.y) > SAME_POSITION) {
    const [x, y, ...rest] = target.position
    out.position = [roundPosition(x + d.x), roundPosition(y + d.y), ...rest]
  }
  // E about C: x → C + e·(x − C).
  const shifted = applyToPoint(e, c.x, c.y)
  const about: Mat2D = [e[0], e[1], e[2], e[3], c.x - shifted.x, c.y - shifted.y]
  const world = multiply(frame.world, about)
  return {
    values: out,
    world: [world[0], world[1], world[2], world[3], world[4] + offset.x, world[5] + offset.y],
    scale: scaleAfter,
    rotation: rotationAfter,
    pivot: c,
  }
}

/** Writes a scalar keeping a static value's one-element array form (like the inspector). */
function writeScalar(prop: AnyProperty, frame: number, value: number): void {
  setValueAtFrame(prop, frame, !isAnimated(prop) && Array.isArray(prop.k) ? [value] : value)
}

/**
 * Writes gizmo values at the target's frame into its transform (inside an immer recipe): static
 * properties change, animated ones get a key at the playhead (After Effects auto-keying).
 * Missing scale or rotation properties are created; separated positions stay separated.
 */
export function writeTransform(
  t: Draft<Transform>,
  target: TransformTarget,
  values: TransformValues,
): void {
  if (values.scale) {
    if (!t.s) t.s = { a: 0, k: target.dims === 3 ? [100, 100, 100] : [100, 100] }
    setValueAtFrame(t.s, target.frame, [...values.scale])
  }
  if (values.rotation !== undefined) {
    const key = target.rotationKey
    const prop = t[key] ?? (t[key] = { a: 0, k: 0 })
    writeScalar(prop, target.frame, values.rotation)
  }
  if (values.position) writePosition(t, target.frame, values.position)
}

/** Applies gizmo values to the target inside an immer recipe on the whole document. */
export function applyTransform(
  draft: Draft<Animation>,
  target: TransformTarget,
  values: TransformValues,
): void {
  const t = getAt<Draft<Transform>>(draft, target.transformPath)
  if (t) writeTransform(t, target, values)
}

/** Keeps a scale away from zero after rounding (sign kept; 0 counts as positive). */
export function safeScale(v: number): number {
  const r = roundValue(v)
  if (Math.abs(r) >= MIN_SCALE) return r
  return v < 0 ? -MIN_SCALE : MIN_SCALE
}
