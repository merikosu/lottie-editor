/**
 * Helpers shared by the inspector sections.
 */
import type { NodePath, PathSegment } from '@/lottie/path'
import { isAnimated, type AnyProperty } from '@/lottie/property'
import type { PropTarget } from '../edit'
import type { CompTime } from '../model/time'

/** Targets for the property at `key` (relative path) under each base path. */
export function propTargets(
  bases: readonly NodePath[],
  key: PathSegment | readonly PathSegment[],
  times: readonly CompTime[],
  create?: () => AnyProperty,
): PropTarget[] {
  const rel: readonly PathSegment[] = Array.isArray(key) ? key : [key as PathSegment]
  return bases.map((base, i) => ({
    path: [...base, ...rel],
    frame: times[i]?.frame ?? times[0]?.frame ?? 0,
    toRoot: times[i]?.toRoot,
    create,
  }))
}

/** Factory for a missing static property. */
export function staticProperty(k: number | number[]): () => AnyProperty {
  return () => ({ a: 0, k: Array.isArray(k) ? [...k] : k })
}

/** True when the property is animated or its static value differs from `fallback`. */
export function isModified(prop: AnyProperty | null | undefined, fallback: number): boolean {
  if (!prop) return false
  if (isAnimated(prop)) return true
  const k = prop.k
  const v =
    typeof k === 'number' ? k : Array.isArray(k) && typeof k[0] === 'number' ? k[0] : fallback
  return Math.abs(v - fallback) > 1e-6
}

/** Picks a property from each node by key. */
export function pick<T>(
  nodes: readonly (T | undefined)[],
  get: (node: T) => AnyProperty | undefined,
): (AnyProperty | undefined)[] {
  return nodes.map((n) => (n ? get(n) : undefined))
}
