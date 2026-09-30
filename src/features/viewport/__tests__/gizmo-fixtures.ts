/**
 * Shared fixtures for the gizmo math tests: documents, the model's world matrices (standing in
 * for the rendered SVG) and checks that an edit draws the node exactly as predicted.
 */
import { freeze, produce } from 'immer'
import { expect } from 'vitest'
import { chainKey } from '@/features/layers/instances'
import type { NodePath } from '@/lottie/path'
import type { Animation, Layer, ShapeItem, Transform } from '@/lottie/types'
import type { Rect } from '../lib/geometry'
import { applyToPoint, type Mat2D, type Point } from '../lib/matrix'
import {
  applyTransform,
  planTransform,
  type GizmoFrame,
  type TransformEdit,
  type TransformTarget,
} from '../lib/transform-edit'
import { nodePlacements } from '../lib/transforms'

export const stat = <T>(k: T) => ({ a: 0 as const, k })

export interface KsInit {
  a?: number[]
  p?: number[]
  s?: number[]
  r?: number
  sk?: number
  sa?: number
}

export function ks(init: KsInit = {}): Transform {
  return {
    a: stat(init.a ?? [0, 0, 0]),
    p: stat(init.p ?? [0, 0, 0]),
    s: stat(init.s ?? [100, 100, 100]),
    r: stat(init.r ?? 0),
    o: stat(100),
    ...(init.sk !== undefined ? { sk: stat(init.sk), sa: stat(init.sa ?? 0) } : {}),
  }
}

export function layer(extra: Partial<Layer> & { ty?: number } = {}): Layer {
  return { ty: 4, ip: 0, op: 100, st: 0, ks: ks(), shapes: [], ...extra } as Layer
}

export function tr(init: KsInit = {}): ShapeItem {
  return {
    ty: 'tr',
    ...ks({
      a: init.a ?? [0, 0],
      p: init.p ?? [0, 0],
      s: init.s ?? [100, 100],
      r: init.r,
      sk: init.sk,
      sa: init.sa,
    }),
  } as ShapeItem
}

export const rect: ShapeItem = {
  ty: 'rc',
  p: stat([0, 0]),
  s: stat([100, 60]),
  r: stat(0),
} as ShapeItem

export function group(items: ShapeItem[], transform = tr()): ShapeItem {
  return { ty: 'gr', it: [...items, transform] } as ShapeItem
}

export function anim(layers: Layer[], assets: Animation['assets'] = []): Animation {
  return freeze({ v: '5.7.0', fr: 30, ip: 0, op: 100, w: 512, h: 512, layers, assets }, true)
}

/** Deterministic pseudo-random numbers. */
export function random(seed: number) {
  let s = seed
  return (min: number, max: number) => {
    s = (s * 16807) % 2147483647
    return min + ((s - 1) / 2147483646) * (max - min)
  }
}

/** Content box of the fixtures' rectangle (100 × 60 around the origin). */
export const BOX: Rect = { x: -50, y: -30, width: 100, height: 60 }

export interface Setup {
  target: TransformTarget
  frame: GizmoFrame
  chain: string
  rootFrame: number
}

/** A gizmo on `path` in its `instance`-th occurrence, drawn from the document model. */
export function setup(
  doc: Animation,
  path: NodePath,
  rootFrame = 0,
  instance = 0,
  box: Rect = BOX,
): Setup {
  const placement = nodePlacements(doc, path, rootFrame)[instance]
  const chain = chainKey(placement.chain)
  const target = planTransform(doc, path, rootFrame, chain)
  if (!target) throw new Error('no target')
  return { target, frame: { box, world: placement.matrix }, chain, rootFrame }
}

/** The document after writing an edit. */
export function write(doc: Animation, s: Setup, edit: TransformEdit): Animation {
  return produce(doc, (d) => applyTransform(d, s.target, edit.values))
}

/** Content → artboard matrix of the same occurrence in another document. */
export function worldIn(doc: Animation, path: NodePath, s: Setup): Mat2D {
  const found = nodePlacements(doc, path, s.rootFrame).find((p) => chainKey(p.chain) === s.chain)
  if (!found) throw new Error('occurrence not found')
  return found.matrix
}

export const at = (m: Mat2D, p: Point) => applyToPoint(m, p.x, p.y)

export function expectNear(a: Point, b: Point, tolerance = 0.02, what = '') {
  const d = Math.hypot(a.x - b.x, a.y - b.y)
  if (!(d <= tolerance))
    throw new Error(
      `${what} (${a.x.toFixed(4)}, ${a.y.toFixed(4)}) ≠ (${b.x.toFixed(4)}, ${b.y.toFixed(4)})`,
    )
  expect(d).toBeLessThanOrEqual(tolerance)
}

/** The written document draws the node exactly where the edit said (box corners compared). */
export function expectDrawnAsPredicted(
  doc: Animation,
  path: NodePath,
  s: Setup,
  edit: TransformEdit,
  tolerance = 0.03,
): Animation {
  const next = write(doc, s, edit)
  const drawn = worldIn(next, path, s)
  const { box } = s.frame
  for (const [u, v] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0.5, 0.5],
  ]) {
    const p = { x: box.x + u * box.width, y: box.y + v * box.height }
    expectNear(at(drawn, p), at(edit.world, p), tolerance, `corner ${u},${v}`)
  }
  return next
}
