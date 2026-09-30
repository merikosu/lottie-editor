import { beforeEach, describe, expect, it, vi } from 'vitest'
import { noteInstanceChain, resetInstanceChains } from '@/features/layers/instances'
import type { NodePath } from '@/lottie/path'
import type { Animation, Layer, ShapeItem } from '@/lottie/types'
import { loadDocument } from '@/store/document'
import { transformRect } from '../lib/geometry'
import { IDENTITY, scale } from '../lib/matrix'
import type { NodeInstance } from '../overlay'

vi.mock('../locks', () => ({ isLockedOnCanvas: () => false }))

const { isUsableGizmo, selectionGeometry, shownInstance } = await import('../overlay')

const stat = <T>(k: T) => ({ a: 0 as const, k })
const ks = (p: number[]) => ({
  a: stat([0, 0, 0]),
  p: stat(p),
  s: stat([100, 100, 100]),
  r: stat(0),
  o: stat(100),
})

/** A straight horizontal stroke: its geometry has no height. */
const line: ShapeItem = {
  ty: 'gr',
  it: [
    {
      ty: 'sh',
      ks: stat({
        i: [
          [0, 0],
          [0, 0],
        ],
        o: [
          [0, 0],
          [0, 0],
        ],
        v: [
          [-50, 0],
          [50, 0],
        ],
        c: false,
      }),
    },
    { ty: 'st', c: stat([1, 1, 1, 1]), o: stat(100), w: stat(4) },
    { ty: 'tr', p: stat([0, 0]), a: stat([0, 0]), s: stat([100, 100]), r: stat(0), o: stat(100) },
  ],
} as unknown as ShapeItem

const shapeLayer = (ind: number, p: number[], shapes: ShapeItem[]): Layer =>
  ({ ty: 4, ind, ip: 0, op: 60, st: 0, ks: ks(p), shapes }) as unknown as Layer
const precomp = (ind: number, p: number[]): Layer =>
  ({
    ty: 0,
    ind,
    refId: 'comp',
    ip: 0,
    op: 60,
    st: 0,
    w: 200,
    h: 200,
    ks: ks(p),
  }) as unknown as Layer

/** Two instances of a composition holding a line, and a line in the root. */
function doc(): Animation {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 512,
    h: 512,
    layers: [
      precomp(1, [100, 100, 0]),
      precomp(2, [300, 300, 0]),
      shapeLayer(3, [256, 400, 0], [line]),
    ],
    assets: [{ id: 'comp', layers: [shapeLayer(1, [100, 100, 0], [line])] }],
  } as unknown as Animation
}

const INNER: NodePath = ['assets', 0, 'layers', 0]

/** An instance of the inner layer as the overlay measures it (only its chain matters here). */
const drawn = (chain: string): NodeInstance => ({
  quad: transformRect({ x: 0, y: 0, width: 1, height: 1 }, IDENTITY),
  chain,
  box: { x: 0, y: 0, width: 1, height: 1 },
  matrix: IDENTITY,
})

let anim: Animation

beforeEach(() => {
  resetInstanceChains()
  anim = doc()
  loadDocument(anim, { fileName: 'a.json', id: 'doc_overlay' })
})

describe('shownInstance', () => {
  it('shows shared content in the instance the user works in when it is drawn', () => {
    noteInstanceChain(anim, [['layers', 1]])
    expect(shownInstance(anim, INNER, 0, [drawn('layers/0'), drawn('layers/1')])).toEqual([
      ['layers', 1],
    ])
  })

  it('falls back to the first instance drawn when that one is not (or none was picked)', () => {
    // Nothing picked yet: the first one in document order, whatever the drawing order.
    expect(shownInstance(anim, INNER, 0, [drawn('layers/1'), drawn('layers/0')])).toEqual([
      ['layers', 0],
    ])
    // The instance worked in is off screen now (out of range, hidden…).
    noteInstanceChain(anim, [['layers', 0]])
    expect(shownInstance(anim, INNER, 0, [drawn('layers/1')])).toEqual([['layers', 1]])
    expect(shownInstance(anim, INNER, 0, [])).toBeNull()
  })
})

describe('isUsableGizmo', () => {
  it('takes boxes with an extent and an invertible matrix, lines included', () => {
    expect(isUsableGizmo({ x: 0, y: 0, width: 10, height: 5 }, IDENTITY)).toBe(true)
    expect(isUsableGizmo({ x: 0, y: 0, width: 10, height: 0 }, IDENTITY)).toBe(true)
    expect(isUsableGizmo({ x: 0, y: 0, width: 0, height: 10 }, IDENTITY)).toBe(true)
    expect(isUsableGizmo({ x: 0, y: 0, width: 0, height: 0 }, IDENTITY)).toBe(false)
    expect(isUsableGizmo({ x: 0, y: 0, width: 10, height: 5 }, scale(IDENTITY, 1, 0))).toBe(false)
  })
})

describe('selectionGeometry (document model)', () => {
  it('gives a straight line a gizmo along its length', () => {
    const g = selectionGeometry(anim, [['layers', 2]], 0, null)
    expect(g.gizmo?.box).toEqual({ x: -50, y: 0, width: 100, height: 0 })
    expect(g.outlines.filter((o) => o.handles)).toHaveLength(1)
  })

  it('reports the instance shared content is shown and edited in', () => {
    noteInstanceChain(anim, [['layers', 1]])
    const g = selectionGeometry(anim, [INNER], 0, null)
    expect(g.shown).toEqual([{ path: INNER, chain: [['layers', 1]] }])
    expect(g.gizmo?.nodes[0].chain).toBe('layers/1')
  })
})
