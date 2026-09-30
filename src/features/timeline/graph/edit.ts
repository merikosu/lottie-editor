/**
 * Keyframe writes of the graph editor. Like @/lottie/keyframes they MUTATE what they receive and
 * are meant for `updateDoc` recipes; values are plain JSON so they are draft-safe.
 *
 * lottie-web constraints honoured here (see research/lottie-semantics.md §2):
 *  - per-dimension easing needs all four of o.x, o.y, i.x, i.y as arrays of the same length
 *    (mixing a scalar with an array freezes the value);
 *  - the legacy easing name `n` is a global cache key for spatial easings: it is dropped.
 */
import { handleComponent } from '@/lottie/easing'
import type { EasingHandle, Keyframe } from '@/lottie/types'
import { roundTo } from '@/lib/math'
import type { Ease } from './math'

type Kf = Keyframe<unknown>

/** Decimals kept for easing values (bodymovin writes three). */
const EASE_DECIMALS = 4

/** The easing of the segment starting at `kf` for dimension `dim` (the evaluator's reading). */
export function readEase(kf: Kf, dim = 0): Ease {
  return {
    x1: handleComponent(kf.o?.x, dim, 0),
    y1: handleComponent(kf.o?.y, dim, 0),
    x2: handleComponent(kf.i?.x, dim, 1),
    y2: handleComponent(kf.i?.y, dim, 1),
  }
}

/** Does the keyframe store one easing per dimension (arrays of two or more components)? */
export function hasPerDimEase(kf: Kf): boolean {
  return [kf.o?.x, kf.o?.y, kf.i?.x, kf.i?.y].some((v) => Array.isArray(v) && v.length > 1)
}

/**
 * Writes a segment's easing into its start keyframe. `dim` null writes the shared easing (every
 * component when the keyframe uses arrays); a number writes that dimension only, turning the
 * handles into per-dimension arrays of `dims` components.
 */
export function writeEase(kf: Kf, ease: Ease, dim: number | null, dims: number): void {
  delete kf.n
  const values = [ease.x1, ease.y1, ease.x2, ease.y2].map((v) => roundTo(v, EASE_DECIMALS))
  const current = [kf.o?.x, kf.o?.y, kf.i?.x, kf.i?.y]
  const fallbacks = [0.167, 0.167, 0.833, 0.833]
  const arrays = current.some(Array.isArray)
  let next: (number | number[])[]
  if (dim === null) {
    const len = Math.max(1, ...current.map((v) => (Array.isArray(v) ? v.length : 1)))
    next = values.map((v) => (arrays ? Array.from({ length: len }, () => v) : v))
  } else {
    const len = Math.max(dims, dim + 1, ...current.map((v) => (Array.isArray(v) ? v.length : 1)))
    next = current.map((v, f) => {
      const arr = Array.from({ length: len }, (_, d) => handleComponent(v, d, fallbacks[f]))
      arr[dim] = values[f]
      return arr
    })
  }
  const o: EasingHandle = { x: next[0], y: next[1] }
  const i: EasingHandle = { x: next[2], y: next[3] }
  kf.o = o
  kf.i = i
}

/** Sets components of a keyframe value (`s`), creating the array form when needed. */
export function setKeyComponents(kf: Kf, values: ReadonlyMap<number, number>): void {
  const s = kf.s
  const arr = Array.isArray(s) ? (s as unknown[]) : typeof s === 'number' ? [s] : null
  if (!arr) return
  for (const [d, v] of values) {
    if (d < arr.length && typeof arr[d] === 'number') arr[d] = v
  }
  if (!Array.isArray(s)) kf.s = arr
}
