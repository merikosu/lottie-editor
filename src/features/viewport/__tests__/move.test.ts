import { freeze, produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { getAt, pathKey, type NodePath } from '@/lottie/path'
import type { Animation, Layer, ShapeItem, Transform } from '@/lottie/types'
import {
  applyMove,
  hasMovingAncestor,
  moveOwner,
  movedPosition,
  planMove,
  transformPathOf,
} from '../lib/move'
import { anchorPoints } from '../lib/transforms'

/* -------------------------------------------------------------------------- */
/*                                   Fixtures                                 */
/* -------------------------------------------------------------------------- */

const stat = <T>(k: T) => ({ a: 0 as const, k })

function ks(partial: { a?: number[]; p?: number[]; s?: number[]; r?: number } = {}): Transform {
  return {
    a: stat(partial.a ?? [0, 0, 0]),
    p: stat(partial.p ?? [0, 0, 0]),
    s: stat(partial.s ?? [100, 100, 100]),
    r: stat(partial.r ?? 0),
    o: stat(100),
  }
}

function layer(extra: Partial<Layer> & { ty?: number } = {}): Layer {
  return { ty: 4, ip: 0, op: 100, st: 0, ks: ks(), shapes: [], ...extra } as Layer
}

function tr(partial: { a?: number[]; p?: number[]; s?: number[]; r?: number } = {}): ShapeItem {
  return {
    ty: 'tr',
    ...ks({
      a: partial.a ?? [0, 0],
      p: partial.p ?? [0, 0],
      s: partial.s ?? [100, 100],
      r: partial.r,
    }),
  } as ShapeItem
}

function group(items: ShapeItem[], transform = tr()): ShapeItem {
  return { ty: 'gr', it: [...items, transform] } as ShapeItem
}

const rect: ShapeItem = { ty: 'rc', p: stat([0, 0]), s: stat([10, 10]), r: stat(0) } as ShapeItem
const fill: ShapeItem = { ty: 'fl', c: stat([1, 0, 0, 1]), o: stat(100) } as ShapeItem

function anim(layers: Layer[], assets: Animation['assets'] = []): Animation {
  return freeze({ v: '5.7.0', fr: 30, ip: 0, op: 100, w: 512, h: 512, layers, assets }, true)
}

/** Plans a drag of `paths` by `delta` at `frame` and returns the edited document. */
function drag(
  doc: Animation,
  paths: NodePath[],
  delta: { x: number; y: number },
  frame = 0,
  hint?: NodePath[],
) {
  const targets = planMove(doc, paths, frame, { instanceHint: hint })
  const next = produce(doc, (d) => applyMove(d, targets, delta))
  return { targets, next }
}

/** World position of a node's anchor point (first placement). */
function anchorAt(doc: Animation, path: NodePath, frame = 0, index = 0) {
  const a = anchorPoints(doc, path, frame)[index]
  return { x: a.x, y: a.y }
}

const expectMovedBy = (
  before: { x: number; y: number },
  after: { x: number; y: number },
  dx: number,
  dy: number,
) => {
  // Positions are written rounded to 0.01 px.
  expect(after.x - before.x).toBeCloseTo(dx, 1)
  expect(after.y - before.y).toBeCloseTo(dy, 1)
}

/* -------------------------------------------------------------------------- */

describe('moveOwner', () => {
  const doc = anim([layer({ shapes: [group([rect, fill]), rect] as ShapeItem[] })])

  it('moves layers and groups themselves', () => {
    expect(moveOwner(doc, ['layers', 0])).toEqual(['layers', 0])
    expect(moveOwner(doc, ['layers', 0, 'shapes', 0])).toEqual(['layers', 0, 'shapes', 0])
  })

  it('moves the enclosing group (or layer) for items without a transform', () => {
    expect(moveOwner(doc, ['layers', 0, 'shapes', 0, 'it', 1])).toEqual(['layers', 0, 'shapes', 0])
    expect(moveOwner(doc, ['layers', 0, 'shapes', 1])).toEqual(['layers', 0])
  })

  it('returns null for missing nodes', () => {
    expect(moveOwner(doc, ['layers', 5])).toBeNull()
    expect(moveOwner(doc, ['layers', 0, 'shapes', 9])).toBeNull()
  })

  it('finds the transform to edit', () => {
    expect(transformPathOf(doc, ['layers', 0])).toEqual(['layers', 0, 'ks'])
    expect(transformPathOf(doc, ['layers', 0, 'shapes', 0])).toEqual([
      'layers',
      0,
      'shapes',
      0,
      'it',
      2,
    ])
  })
})

describe('planMove + applyMove', () => {
  it('moves a root layer by the delta', () => {
    const doc = anim([layer({ ks: ks({ p: [100, 50, 0] }) })])
    const { next, targets } = drag(doc, [['layers', 0]], { x: 12.345, y: -5 })
    expect(targets).toHaveLength(1)
    expect(getAt(next, ['layers', 0, 'ks', 'p', 'k'])).toEqual([112.35, 45, 0])
  })

  it('maps the delta through rotated and scaled parents (the anchor follows the pointer)', () => {
    let seed = 7
    const rnd = (min: number, max: number) => {
      seed = (seed * 16807) % 2147483647
      return min + ((seed - 1) / 2147483646) * (max - min)
    }
    for (let i = 0; i < 25; i++) {
      const parentKs = ks({
        a: [rnd(-50, 50), rnd(-50, 50), 0],
        p: [rnd(0, 512), rnd(0, 512), 0],
        s: [rnd(20, 300) * (rnd(0, 1) > 0.8 ? -1 : 1), rnd(20, 300), 100],
        r: rnd(-360, 360),
      })
      const grandKs = ks({
        p: [rnd(-100, 100), rnd(-100, 100), 0],
        s: [rnd(50, 150), rnd(50, 150), 100],
        r: rnd(-90, 90),
      })
      const doc = anim([
        layer({
          ind: 1,
          parent: 2,
          ks: ks({ p: [rnd(-100, 100), rnd(-100, 100), 0], a: [5, 5, 0] }),
        }),
        layer({ ind: 2, parent: 3, ty: 3, ks: parentKs }),
        layer({ ind: 3, ty: 3, ks: grandKs }),
      ])
      const before = anchorAt(doc, ['layers', 0])
      const delta = { x: rnd(-200, 200), y: rnd(-200, 200) }
      const { next } = drag(doc, [['layers', 0]], delta)
      expectMovedBy(before, anchorAt(next, ['layers', 0]), delta.x, delta.y)
    }
  })

  it('keys an animated position at the playhead, keeping the motion path', () => {
    const doc = anim([
      layer({
        ks: {
          ...ks(),
          p: {
            a: 1,
            k: [
              {
                t: 0,
                s: [0, 0, 0],
                o: { x: 0.3, y: 0 },
                i: { x: 0.7, y: 1 },
                to: [0, 0, 0],
                ti: [0, 0, 0],
              },
              { t: 20, s: [100, 0, 0] },
            ],
          },
        },
      }),
    ])
    const at10 = drag(doc, [['layers', 0]], { x: 0, y: 30 }, 10).next
    const kfs = getAt<{ t: number; s: number[] }[]>(at10, ['layers', 0, 'ks', 'p', 'k'])!
    expect(kfs.map((k) => k.t)).toEqual([0, 10, 20])
    expect(kfs[1].s[1]).toBeCloseTo(30, 5)
    // On an existing key the key itself changes.
    const at0 = drag(doc, [['layers', 0]], { x: 5, y: 0 }, 0).next
    const kfs0 = getAt<{ t: number; s: number[] }[]>(at0, ['layers', 0, 'ks', 'p', 'k'])!
    expect(kfs0).toHaveLength(2)
    expect(kfs0[0].s).toEqual([5, 0, 0])
  })

  it('edits separated dimensions and keeps the stored form of static scalars', () => {
    const doc = anim([
      layer({
        ks: {
          ...ks(),
          p: {
            s: true,
            x: { a: 0, k: [10] },
            y: {
              a: 1,
              k: [
                { t: 0, s: [0], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } },
                { t: 10, s: [100] },
              ],
            },
          },
        } as unknown as Transform,
      }),
    ])
    const next = drag(doc, [['layers', 0]], { x: 5, y: 5 }, 5).next
    expect(getAt(next, ['layers', 0, 'ks', 'p', 'x', 'k'])).toEqual([15])
    const y = getAt<{ t: number; s: number[] }[]>(next, ['layers', 0, 'ks', 'p', 'y', 'k'])!
    expect(y.map((k) => k.t)).toEqual([0, 5, 10])
    expect(y[1].s[0]).toBeCloseTo(55, 5)
    // A horizontal drag leaves the animated Y dimension alone (no key at the playhead).
    const horizontal = drag(doc, [['layers', 0]], { x: 7, y: 0 }, 3).next
    expect(getAt(horizontal, ['layers', 0, 'ks', 'p', 'x', 'k'])).toEqual([17])
    expect(getAt(horizontal, ['layers', 0, 'ks', 'p', 'y'])).toBe(
      getAt(doc, ['layers', 0, 'ks', 'p', 'y']),
    )
  })

  it('converts legacy keyframes (`e`) inside the recipe', () => {
    const doc = anim([
      layer({
        ks: {
          ...ks(),
          p: {
            a: 1,
            k: [
              { t: 0, s: [0, 0], e: [100, 0], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } },
              { t: 10 },
            ],
          },
        } as unknown as Transform,
      }),
    ])
    const next = drag(doc, [['layers', 0]], { x: 0, y: 10 }, 10).next
    const kfs = getAt<{ t: number; s: number[]; e?: unknown }[]>(next, [
      'layers',
      0,
      'ks',
      'p',
      'k',
    ])!
    expect(kfs.every((k) => k.e === undefined)).toBe(true)
    expect(kfs[1].s).toEqual([100, 10])
  })

  it('creates a missing position and keeps extra dimensions', () => {
    const noP = { ...ks() }
    delete noP.p
    const doc = anim([layer({ ks: noP }), layer({ ks: ks({ p: [1, 2, 30] }) })])
    const next = drag(
      doc,
      [
        ['layers', 0],
        ['layers', 1],
      ],
      { x: 4, y: 6 },
    ).next
    expect(getAt(next, ['layers', 0, 'ks', 'p', 'k'])).toEqual([4, 6])
    expect(getAt(next, ['layers', 1, 'ks', 'p', 'k'])).toEqual([5, 8, 30])
  })

  it('moves groups in their parent space', () => {
    const doc = anim([
      layer({
        ks: ks({ p: [256, 256, 0], r: 90, s: [200, 200, 100] }),
        shapes: [
          group([group([rect, fill], tr({ p: [10, 0], r: 45 }))], tr({ p: [5, 5], s: [50, 50] })),
        ] as ShapeItem[],
      }),
    ])
    const inner: NodePath = ['layers', 0, 'shapes', 0, 'it', 0]
    const before = anchorAt(doc, inner)
    const { next, targets } = drag(doc, [[...inner, 'it', 1]], { x: 20, y: -7 })
    expect(targets.map((t) => t.path)).toEqual([inner])
    expectMovedBy(before, anchorAt(next, inner), 20, -7)
  })

  it('does not move a node twice when something carrying it moves too', () => {
    const doc = anim([
      layer({ ind: 1, parent: 2, shapes: [group([rect])] as ShapeItem[] }),
      layer({ ind: 2, ty: 3 }),
    ])
    const plan = planMove(
      doc,
      [
        ['layers', 0],
        ['layers', 1],
        ['layers', 0, 'shapes', 0],
      ],
      0,
    )
    expect(plan.map((t) => t.path)).toEqual([['layers', 1]])
    const moving = new Set([pathKey(['layers', 0])])
    expect(hasMovingAncestor(doc, ['layers', 0, 'shapes', 0], moving)).toBe(true)
  })

  it('skips blocked nodes and singular parent spaces', () => {
    const doc = anim([
      layer({ ind: 1, parent: 2 }),
      layer({ ind: 2, ty: 3, ks: ks({ s: [0, 100, 100] }) }),
      layer(),
    ])
    expect(planMove(doc, [['layers', 0]], 0)).toHaveLength(0)
    expect(planMove(doc, [['layers', 2]], 0, { blocked: () => true })).toHaveLength(0)
  })
})

describe('precomps', () => {
  // Two instances of one composition: the second one is rotated and scaled.
  const doc = anim(
    [
      layer({ ty: 0, refId: 'c', w: 100, h: 100, ks: ks({ p: [100, 100, 0] }) } as Partial<Layer>),
      layer({
        ty: 0,
        refId: 'c',
        w: 100,
        h: 100,
        ks: ks({ p: [300, 300, 0], r: 90, s: [50, 50, 100] }),
      } as Partial<Layer>),
    ],
    [{ id: 'c', layers: [layer({ ks: ks({ p: [10, 10, 0] }) })] }],
  )
  const child: NodePath = ['assets', 0, 'layers', 0]

  it('moves a child in the instance under the pointer', () => {
    const before = anchorAt(doc, child, 0, 1)
    const { next } = drag(doc, [child], { x: 10, y: 0 }, 0, [['layers', 1], child])
    expectMovedBy(before, anchorAt(next, child, 0, 1), 10, 0)
  })

  it('uses the first visible instance without a hint', () => {
    const before = anchorAt(doc, child, 0, 0)
    const { next } = drag(doc, [child], { x: 0, y: 8 })
    expectMovedBy(before, anchorAt(next, child, 0, 0), 0, 8)
  })

  it('does not move children of a moving precomp layer', () => {
    expect(planMove(doc, [child, ['layers', 1]], 0).map((t) => t.path)).toEqual([['layers', 1]])
  })

  it('computes positions without touching the document', () => {
    const [target] = planMove(doc, [['layers', 0]], 0)
    expect(movedPosition(target, { x: 1, y: 2 })).toEqual([101, 102, 0])
    expect(getAt(doc, ['layers', 0, 'ks', 'p', 'k'])).toEqual([100, 100, 0])
  })
})
