/**
 * Re-parenting that keeps the layer in place (After Effects' default when a parent is picked).
 *
 * A layer's world transform is `P · L`, where `P` is its parent chain and `L` its own transform.
 * Changing the chain from `P` to `Q` without moving the layer on screen means replacing `L`
 * with `Q⁻¹ · P · L`. When `T = Q⁻¹ · P` is a similarity (move, rotate, uniform scale — the usual
 * nulls and rigs), it folds into the layer's own values exactly: position ↦ T(position)
 * (keyframes and motion-path tangents too), rotation + θ, scale × k. The fold is computed at
 * one frame (the playhead): parents that animate differently keep animating the child.
 */
import {
  IDENTITY_MATRIX,
  applyMatrix,
  applyMatrixToVector,
  invertMatrix,
  layerMatrix,
  multiplyMatrices,
  type Matrix2D,
} from '@/lottie/bounds'
import { parentChain } from '@/lottie/layers'
import { getKeyframes, isAnimated, type AnyProperty } from '@/lottie/property'
import type { Layer } from '@/lottie/types'
import { isSplitPosition } from '@/lottie/types'
import { setLayerParent } from './layer-edit'

const EPS = 1e-6

const round3 = (v: number) => {
  const r = Math.round(v * 1000) / 1000
  return Object.is(r, -0) ? 0 : r
}

/** 3D layers (and 3D rotations) cannot be folded with 2D matrices. */
function is3d(layer: Layer): boolean {
  const ks = layer.ks ?? {}
  return layer.ddd === 1 || !!ks.rx || !!ks.ry || !!ks.or
}

/** Parent chain transform of a layer (identity without parents), or null when it is 3D. */
function chainMatrix(
  layers: readonly Layer[],
  parent: Layer | undefined,
  frame: number,
): Matrix2D | null {
  if (!parent) return IDENTITY_MATRIX
  const chain = [parent, ...parentChain(layers, parent)]
  if (chain.some(is3d)) return null
  let m = IDENTITY_MATRIX
  for (const layer of chain) m = multiplyMatrices(layerMatrix(layer, frame), m)
  return m
}

/** A similarity x ↦ k·R(θ)·x + t, read from a matrix (null when it skews, mirrors or squashes). */
interface Similarity {
  k: number
  /** Degrees, clockwise on screen like Lottie's `r`. */
  theta: number
  m: Matrix2D
}

function similarityOf(m: Matrix2D): Similarity | null {
  const [a, b, c, d] = m
  const k = Math.hypot(a, b)
  if (!(k > EPS) || !Number.isFinite(k)) return null
  const tolerance = 1e-6 * Math.max(1, k)
  if (Math.abs(a - d) > tolerance || Math.abs(b + c) > tolerance) return null
  return { k, theta: (Math.atan2(b, a) * 180) / Math.PI, m }
}

function isIdentity(s: Similarity): boolean {
  const [, , , , e, f] = s.m
  return (
    Math.abs(s.k - 1) < EPS && Math.abs(s.theta) < EPS && Math.abs(e) < EPS && Math.abs(f) < EPS
  )
}

type NumberMap = (v: number[]) => number[]

const isNumbers = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === 'number')

/** Maps the numbers of a static or animated property in place (values, legacy end values, tangents). */
function mapNumbers(prop: AnyProperty, values: NumberMap, tangents?: NumberMap): void {
  const kfs = getKeyframes<unknown>(prop)
  if (!kfs) {
    if (typeof prop.k === 'number') prop.k = values([prop.k])[0]
    else if (isNumbers(prop.k)) prop.k = values([...prop.k])
    return
  }
  for (const kf of kfs) {
    for (const key of ['s', 'e'] as const) {
      const v = kf[key]
      if (typeof v === 'number') kf[key] = values([v])[0]
      else if (isNumbers(v)) kf[key] = values([...v])
    }
    if (tangents && isNumbers(kf.ti)) kf.ti = tangents([...kf.ti])
    if (tangents && isNumbers(kf.to)) kf.to = tangents([...kf.to])
  }
}

/**
 * Folds the similarity into the layer's own transform so it renders where it did before its
 * parents changed. Returns false (changing nothing) when the transform cannot absorb it.
 */
function foldInto(layer: Layer, s: Similarity): boolean {
  if (isIdentity(s)) return true
  const ks = (layer.ks ??= {})
  const p = ks.p
  const halfTurn = Math.abs(Math.abs(s.theta) - 180) < EPS
  const axisAligned = Math.abs(s.theta) < EPS || halfTurn
  const splitAnimated = isSplitPosition(p) && (isAnimated(p.x) || isAnimated(p.y))
  // Separated dimensions keyframe x and y on their own: a rotation would mix them.
  if (splitAnimated && !axisAligned) return false

  const point: NumberMap = (v) => {
    const [x, y] = applyMatrix(s.m, v[0] ?? 0, v[1] ?? 0)
    const out = [...v]
    out[0] = round3(x)
    out[1] = round3(y)
    return out
  }
  const linear: NumberMap = (v) => {
    const [x, y] = applyMatrixToVector(s.m, v[0] ?? 0, v[1] ?? 0)
    const out = [...v]
    out[0] = round3(x)
    out[1] = round3(y)
    return out
  }
  const positionAnimated = isSplitPosition(p) ? splitAnimated : isAnimated(p)

  if (!p) {
    ks.p = { a: 0, k: [round3(s.m[4]), round3(s.m[5]), 0] }
  } else if (isSplitPosition(p)) {
    if (splitAnimated) {
      // θ is 0 or 180°: each axis maps on its own (x ↦ ±k·x + e).
      const c = halfTurn ? -s.k : s.k
      mapNumbers(p.x, (v) => [round3(c * (v[0] ?? 0) + s.m[4])])
      mapNumbers(p.y, (v) => [round3(c * (v[0] ?? 0) + s.m[5])])
    } else {
      const x =
        typeof p.x.k === 'number'
          ? p.x.k
          : Array.isArray(p.x.k) && typeof p.x.k[0] === 'number'
            ? p.x.k[0]
            : 0
      const y =
        typeof p.y.k === 'number'
          ? p.y.k
          : Array.isArray(p.y.k) && typeof p.y.k[0] === 'number'
            ? p.y.k[0]
            : 0
      const [nx, ny] = point([x, y])
      p.x.k = nx
      p.y.k = ny
    }
  } else {
    mapNumbers(p, point, linear)
  }

  // Auto-orient derives the angle from the motion path, which already turned by θ.
  if (Math.abs(s.theta) > EPS && !(layer.ao === 1 && positionAnimated)) {
    ks.r ??= { a: 0, k: 0 }
    mapNumbers(ks.r, (v) => [round3((v[0] ?? 0) + s.theta)])
  }
  if (Math.abs(s.k - 1) > EPS) {
    ks.s ??= { a: 0, k: [100, 100, 100] }
    mapNumbers(ks.s, (v) => v.map((n, i) => (i < 2 ? round3(n * s.k) : n)))
  }
  return true
}

export type ReparentResult = 'unchanged' | 'kept-in-place' | 'moved'

/**
 * Sets (or clears, with null) the parent of `layers[index]` and compensates the layer's own
 * transform so it stays where it is at `frame` (composition time). Returns 'moved' when the
 * parent changed but the layer could not be kept in place (3D, skewed or non-uniformly scaled
 * parents, separated position dimensions under rotation) — it then follows the new parent.
 */
export function setParentKeepingPlace(
  layers: Layer[],
  index: number,
  parentIndex: number | null,
  frame: number,
): ReparentResult {
  const layer = layers[index]
  if (!layer) return 'unchanged'
  const before = layer.parent
  const oldParent = parentChain(layers, layer)[0]
  const oldChain = chainMatrix(layers, oldParent, frame)
  setLayerParent(layers, index, parentIndex)
  if (layer.parent === before) return 'unchanged'
  if (is3d(layer)) return 'moved'
  const newParent = parentChain(layers, layer)[0]
  const newChain = chainMatrix(layers, newParent, frame)
  const inverse = newChain && invertMatrix(newChain)
  if (!oldChain || !inverse) return 'moved'
  const similarity = similarityOf(multiplyMatrices(inverse, oldChain))
  return similarity && foldInto(layer, similarity) ? 'kept-in-place' : 'moved'
}
