/**
 * Precompose / release precomp (layer-ops): structure, time mapping, parenting, mattes, and
 * RENDER EQUIVALENCE — every drawn path, solid, image and text is compared in root space (world
 * transforms through parents and precomps, time mapping, opacity, clips, mattes, masks, visual
 * effects) at sampled frames before and after, on synthetic cases and on real-world files.
 */
import { enablePatches, freeze, produceWithPatches, applyPatches } from 'immer'
import { describe, expect, it } from 'vitest'
import testJsonText from '../../../docs/test.json?raw'
import walletJsonText from '../../../docs/wallet_flag.json?raw'
import { createFillShape, createGroupShape, createPrecompLayer, createRectShape } from '../create'
import { createAnimation } from '../document'
import {
  compFrameSize,
  planPrecompose,
  precomposeLayers,
  releaseBlocker,
  releasePrecomps,
  releaseRevealsContent,
  type PrecomposeOptions,
} from '../layer-ops'
import type { NodePath } from '../path'
import { getKeyframes } from '../property'
import type {
  Animation,
  Effect,
  Layer,
  NullLayer,
  PrecompAsset,
  PrecompLayer,
  ShapeLayer,
  SolidLayer,
  Transform,
} from '../types'
import { framesOf, renderDiff, renderSignature } from './fixtures/render-signature'

enablePatches()

/* -------------------------------------------------------------------------- */
/*                                  Fixtures                                  */
/* -------------------------------------------------------------------------- */

const s = <T>(k: T) => ({ a: 0 as const, k })

/** Eased keyframes (the last one bare, like bodymovin). */
function keys(frames: Array<[number, number[]]>) {
  return {
    a: 1 as const,
    k: frames.map(([t, v], n) =>
      n < frames.length - 1
        ? { t, s: v, o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } }
        : { t, s: v },
    ),
  }
}

function box(nm: string, color = '#ff0000', w = 40, h = 30) {
  return createGroupShape({
    name: nm,
    items: [createRectShape({ w, h }), createFillShape({ color })],
  })
}

function shape(ind: number, nm: string, ks: Transform = {}, extra: Partial<ShapeLayer> = {}) {
  return {
    ddd: 0,
    ind,
    ty: 4,
    nm,
    sr: 1,
    ks: { o: s(100), r: s(0), p: s([100, 100, 0]), a: s([0, 0, 0]), s: s([100, 100, 100]), ...ks },
    ao: 0,
    shapes: [box(`${nm} box`)],
    ip: 0,
    op: 60,
    st: 0,
    bm: 0,
    ...extra,
  } as ShapeLayer
}

function nul(ind: number, nm: string, ks: Transform = {}, extra: Partial<NullLayer> = {}): Layer {
  return {
    ddd: 0,
    ind,
    ty: 3,
    nm,
    sr: 1,
    ks: { o: s(100), r: s(0), p: s([0, 0, 0]), a: s([0, 0, 0]), s: s([100, 100, 100]), ...ks },
    ao: 0,
    ip: 0,
    op: 60,
    st: 0,
    bm: 0,
    ...extra,
  } as Layer
}

function solid(ind: number, nm: string, extra: Partial<SolidLayer> = {}): SolidLayer {
  return {
    ddd: 0,
    ind,
    ty: 1,
    nm,
    sr: 1,
    ks: { o: s(100), r: s(0), p: s([200, 150, 0]), a: s([40, 30, 0]), s: s([100, 100, 100]) },
    ao: 0,
    sc: '#3366ff',
    sw: 80,
    sh: 60,
    ip: 0,
    op: 60,
    st: 0,
    bm: 0,
    ...extra,
  }
}

function doc(layers: Layer[], extra: Partial<Animation> = {}): Animation {
  return {
    ...createAnimation({ name: 'Test', width: 400, height: 300, fps: 30, frames: 60 }),
    layers,
    ...extra,
  }
}

/**
 * Runs a mutating operation like the store does: on a frozen document, through immer. A frozen
 * input (the result of a previous edit) is used as it is, keeping object identities.
 */
function edit<R>(anim: Animation, op: (draft: Animation) => R): { next: Animation; result: R } {
  const base = Object.isFrozen(anim) ? anim : freeze(structuredClone(anim), true)
  let result!: R
  const [next, patches, inverse] = produceWithPatches(base, (d) => {
    result = op(d as Animation)
  })
  // Undo restores the original exactly.
  expect(applyPatches(next, inverse)).toEqual(base)
  expect(applyPatches(base, patches)).toEqual(next)
  return { next: next as Animation, result }
}

const precompose = (anim: Animation, paths: NodePath[], opts: Partial<PrecomposeOptions> = {}) =>
  edit(anim, (d) => precomposeLayers(d, paths, { name: 'Pre-comp 1', ...opts }))

const release = (anim: Animation, paths: NodePath[]) => edit(anim, (d) => releasePrecomps(d, paths))

const names = (layers: Layer[]) => layers.map((l) => l.nm)
const lastAsset = (anim: Animation) => anim.assets![anim.assets!.length - 1] as PrecompAsset

/** A layer with a rotating, moving, scaling animation (non-trivial world matrices). */
const busy = (ind: number, nm: string, extra: Partial<ShapeLayer> = {}) =>
  shape(
    ind,
    nm,
    {
      p: keys([
        [0, [60, 80, 0]],
        [30, [260, 140, 0]],
        [59, [120, 220, 0]],
      ]),
      r: keys([
        [0, [0]],
        [59, [270]],
      ]),
      s: keys([
        [10, [100, 100, 100]],
        [40, [60, 140, 100]],
      ]),
      a: s([10, 5, 0]),
      o: keys([
        [0, [100]],
        [50, [40]],
      ]),
    },
    extra,
  )

/* ---------------------------- Shared documents ----------------------------- */

/** Four layers, one of them busy. */
const fourLayers = () =>
  doc([
    shape(1, 'Top', { p: s([50, 50, 0]) }),
    busy(2, 'Busy'),
    shape(3, 'Middle', { p: s([300, 200, 0]) }),
    shape(4, 'Bottom', { p: s([200, 150, 0]) }),
  ])

/** A solid with animated transform, masks, an effect, a blend mode and timing. */
const richCard = () =>
  solid(3, 'Card', {
    ks: {
      o: keys([
        [0, [100]],
        [59, [30]],
      ]),
      r: keys([
        [0, [0]],
        [59, [200]],
      ]),
      p: keys([
        [0, [100, 80, 0]],
        [59, [300, 220, 0]],
      ]),
      a: s([40, 30, 0]),
      s: keys([
        [0, [100, 100, 100]],
        [59, [50, 170, 100]],
      ]),
      sk: s(10),
      sa: s(20),
    },
    hasMask: true,
    masksProperties: [
      {
        mode: 'a',
        inv: false,
        o: s(100),
        x: s(0),
        pt: keys([
          [0, [0]],
          [59, [0]],
        ]) as never,
      },
    ],
    ef: [{ ty: 25, nm: 'Drop Shadow', en: 1, ef: [{ ty: 0, v: s(0.5) }] }],
    bm: 3,
    ip: 6,
    op: 50,
    st: 2,
  })

/** Parenting across the boundary both ways (for round trips). */
const rigDoc = () => {
  const anim = doc([
    shape(1, 'Top', { p: s([50, 50, 0]) }),
    busy(2, 'Busy', { ip: 4, op: 56 }),
    shape(
      3,
      'Middle',
      {
        p: keys([
          [10, [300, 200, 0]],
          [50, [80, 40, 0]],
        ]),
      },
      { ip: 8 },
    ),
    nul(4, 'Rig', {
      r: keys([
        [0, [0]],
        [59, [90]],
      ]),
      p: s([200, 150, 0]),
    }),
    shape(5, 'Bottom', { p: s([200, 150, 0]) }),
  ])
  anim.layers[1].parent = 4 // parent outside the selection
  anim.layers[0].parent = 3 // child of a moved layer, staying outside
  return anim
}

const testDoc = () => JSON.parse(testJsonText) as Animation
const walletDoc = () => JSON.parse(walletJsonText) as Animation
const layersOf = (...indices: number[]): NodePath[] => indices.map((i) => ['layers', i])

/* -------------------------------------------------------------------------- */
/*                                 Precompose                                 */
/* -------------------------------------------------------------------------- */

describe('precomposeLayers — move all attributes', () => {
  it('replaces the layers by one precomp layer at the topmost one, rendering the same', () => {
    const anim = fourLayers()
    const { next, result } = precompose(anim, [
      ['layers', 2],
      ['layers', 1],
    ])
    expect(result).toEqual(['layers', 1])
    expect(names(next.layers)).toEqual(['Top', 'Pre-comp 1', 'Bottom'])
    const layer = next.layers[1] as PrecompLayer
    expect(layer).toMatchObject({ ty: 0, refId: 'comp_0', w: 400, h: 300, ip: 0, op: 60, st: 0 })
    expect(layer.ind).toBe(5)
    // Identity transform, After Effects-style (anchor = position = center).
    expect(layer.ks.a!.k).toEqual([200, 150, 0])
    expect(layer.ks.p).toEqual({ a: 0, k: [200, 150, 0] })
    const asset = lastAsset(next)
    expect(asset).toMatchObject({ id: 'comp_0', nm: 'Pre-comp 1', fr: 30 })
    expect(names(asset.layers)).toEqual(['Busy', 'Middle'])
    // The layers keep their inds, times and keyframes.
    expect(asset.layers.map((l) => l.ind)).toEqual([2, 3])
    expect(asset.layers[0]).toEqual(anim.layers[1])
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('names and ids: the given name, a free comp_N id (or the requested one)', () => {
    const anim = fourLayers()
    anim.assets = [{ id: 'comp_0', layers: [] }]
    const a = precompose(anim, [['layers', 0]], { name: '  Card  ' }).next
    expect(lastAsset(a).id).toBe('comp_1')
    expect(lastAsset(a).nm).toBe('Card')
    expect(a.layers[0].nm).toBe('Card')
    const b = precompose(anim, [['layers', 0]], { id: 'my_comp' }).next
    expect(lastAsset(b).id).toBe('my_comp')
    const c = precompose(anim, [['layers', 0]], { id: 'comp_0' }).next
    expect(lastAsset(c).id).toBe('comp_1')
  })

  it('refuses layers of several compositions and empty selections', () => {
    const anim = fourLayers()
    anim.assets = [{ id: 'x', layers: [shape(1, 'Inner')] }]
    expect(
      planPrecompose(anim, [
        ['layers', 0],
        ['assets', 0, 'layers', 0],
      ]),
    ).toBeNull()
    expect(planPrecompose(anim, [])).toBeNull()
    expect(planPrecompose(anim, [['layers', 9]])).toBeNull()
    expect(
      precompose(anim, [
        ['layers', 0],
        ['assets', 0, 'layers', 0],
      ]).result,
    ).toBeNull()
  })

  it('adjusts the duration: the composition starts at the first in point', () => {
    const anim = fourLayers()
    anim.layers[1] = busy(2, 'Busy', { ip: 12, op: 50, st: 4 })
    anim.layers[2] = shape(
      3,
      'Middle',
      {
        p: keys([
          [20, [0, 0, 0]],
          [45, [300, 200, 0]],
        ]),
      },
      { ip: 20, op: 58 },
    )
    const { next } = precompose(
      anim,
      [
        ['layers', 1],
        ['layers', 2],
      ],
      { adjustDuration: true },
    )
    const layer = next.layers[1] as PrecompLayer
    expect(layer).toMatchObject({ ip: 12, op: 58, st: 12 })
    const [busyIn, middleIn] = lastAsset(next).layers
    expect(busyIn).toMatchObject({ ip: 0, op: 38, st: -8 })
    expect(middleIn).toMatchObject({ ip: 8, op: 46, st: -12 })
    expect(getKeyframes(middleIn.ks.p as never)!.map((k) => k.t)).toEqual([8, 33])
    expect(getKeyframes(busyIn.ks.r)!.map((k) => k.t)).toEqual([-12, 47])
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('without adjusting, the precomp layer spans the composition and the layers', () => {
    const anim = fourLayers()
    anim.layers[1] = busy(2, 'Busy', { ip: -10, op: 30 })
    const { next } = precompose(anim, [['layers', 1]])
    expect(next.layers[1]).toMatchObject({ ip: -10, op: 60, st: 0 })
  })

  it('keeps parenting inside the selection as it is', () => {
    const anim = fourLayers()
    anim.layers.splice(
      3,
      0,
      nul(5, 'Rig', {
        r: keys([
          [0, [0]],
          [59, [90]],
        ]),
        p: s([200, 150, 0]),
      }),
    )
    anim.layers[0].parent = 5
    anim.layers[2].parent = 5
    const selection: NodePath[] = [
      ['layers', 0],
      ['layers', 1],
      ['layers', 2],
      ['layers', 3],
    ]
    const plan = planPrecompose(anim, selection)!
    expect(plan).toMatchObject({ parentsCopied: [], parentsLeft: [], between: [] })
    const { next } = precompose(anim, selection)
    const asset = lastAsset(next)
    expect(names(asset.layers)).toEqual(['Top', 'Busy', 'Middle', 'Rig'])
    expect(asset.layers.map((l) => l.parent)).toEqual([5, undefined, 5, undefined])
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('reports layers between the selected ones (they end up below the new composition)', () => {
    const anim = fourLayers()
    const plan = planPrecompose(anim, [
      ['layers', 0],
      ['layers', 2],
    ])!
    expect(plan.between).toEqual([1])
    const { next } = precompose(anim, [
      ['layers', 0],
      ['layers', 2],
    ])
    expect(names(next.layers)).toEqual(['Pre-comp 1', 'Busy', 'Bottom'])
    expect(names(lastAsset(next).layers)).toEqual(['Top', 'Middle'])
  })

  it('copies a parent that stays outside into the composition as a null', () => {
    const anim = fourLayers()
    const rig = nul(7, 'Rig', {
      p: keys([
        [0, [100, 100, 0]],
        [40, [300, 200, 0]],
      ]),
      r: keys([
        [0, [0]],
        [59, [-120]],
      ]),
      s: keys([
        [0, [100, 100, 100]],
        [59, [150, 80, 100]],
      ]),
      sk: s(12),
      sa: s(30),
    })
    anim.layers.push(rig)
    anim.layers[1].parent = 7
    const plan = planPrecompose(anim, [['layers', 1]])!
    expect(plan.parentsCopied).toEqual([4])
    const { next } = precompose(anim, [['layers', 1]])
    const asset = lastAsset(next)
    expect(names(asset.layers)).toEqual(['Busy', 'Rig'])
    const copy = asset.layers[1] as NullLayer
    expect(copy).toMatchObject({ ty: 3, ind: 7, nm: 'Rig' })
    expect(copy.ks).toEqual(rig.ks)
    expect(asset.layers[0].parent).toBe(7)
    // The original stays where it was.
    expect(next.layers.find((l) => l.nm === 'Rig')).toEqual(rig)
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('copies whole parent chains (auto-orient and 3D included), shifted with the content', () => {
    const anim = fourLayers()
    anim.layers.push(
      nul(
        7,
        'Orbit',
        {
          p: {
            a: 1,
            k: [
              {
                t: 0,
                s: [100, 100, 0],
                to: [50, -40, 0],
                ti: [-30, 0, 0],
                o: { x: 0.3, y: 0 },
                i: { x: 0.7, y: 1 },
              },
              { t: 50, s: [300, 180, 0] },
            ],
          },
        },
        { ao: 1, parent: 8 },
      ),
      nul(8, 'World', {
        r: keys([
          [0, [10]],
          [59, [40]],
        ]),
        p: s([20, 10, 0]),
      }),
    )
    anim.layers[1].parent = 7
    anim.layers[1].ip = 5
    const { next } = precompose(anim, [['layers', 1]], { adjustDuration: true })
    const asset = lastAsset(next)
    expect(names(asset.layers)).toEqual(['Busy', 'Orbit', 'World'])
    expect(asset.layers[1]).toMatchObject({ ty: 3, ind: 7, ao: 1, parent: 8 })
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('leaves a null copy of a moved parent for the layers that stay', () => {
    const anim = fourLayers()
    anim.layers[1].parent = undefined
    anim.layers[0].parent = 2 // "Top" follows "Busy"
    anim.layers[3].parent = 2
    const plan = planPrecompose(anim, [
      ['layers', 1],
      ['layers', 2],
    ])!
    expect(plan.parentsLeft).toEqual([1])
    const { next } = precompose(anim, [
      ['layers', 1],
      ['layers', 2],
    ])
    expect(names(next.layers)).toEqual(['Top', 'Pre-comp 1', 'Busy', 'Bottom'])
    const stay = next.layers[2] as NullLayer
    expect(stay).toMatchObject({ ty: 3, ind: 2, nm: 'Busy' })
    expect(stay.ks).toEqual(anim.layers[1].ks)
    expect(next.layers[0].parent).toBe(2)
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('handles chains crossing the boundary both ways', () => {
    // Moved "Busy" ← outside "Link" ← moved "Middle": Link goes in as a null, Busy stays as one.
    const anim = fourLayers()
    anim.layers.push(
      nul(
        9,
        'Link',
        {
          r: keys([
            [0, [0]],
            [59, [45]],
          ]),
          p: s([10, 20, 0]),
        },
        { parent: 2 },
      ),
    )
    anim.layers[2].parent = 9
    const plan = planPrecompose(anim, [
      ['layers', 1],
      ['layers', 2],
    ])!
    expect(plan.parentsCopied).toEqual([4])
    expect(plan.parentsLeft).toEqual([1])
    const { next } = precompose(anim, [
      ['layers', 1],
      ['layers', 2],
    ])
    expect(names(lastAsset(next).layers)).toEqual(['Busy', 'Middle', 'Link'])
    expect(names(next.layers)).toEqual(['Top', 'Pre-comp 1', 'Busy', 'Bottom', 'Link'])
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('moves track matte pairs whole (position-based and tp-based), keeping ind − 1', () => {
    const matteSource = (ind: number, nm: string) =>
      shape(
        ind,
        nm,
        {
          p: keys([
            [0, [80, 80, 0]],
            [59, [320, 220, 0]],
          ]),
        },
        { td: 1 },
      )
    const anim = doc([
      shape(1, 'Top'),
      matteSource(2, 'Matte'),
      busy(3, 'Target', { tt: 1 }),
      busy(4, 'Far target', { tt: 2, tp: 2 }),
      shape(5, 'Bottom', { p: s([250, 200, 0]) }),
    ])
    // Selecting one target brings its source, and the source brings its other target.
    const plan = planPrecompose(anim, [['layers', 2]])!
    expect(plan.moved).toEqual([1, 2, 3])
    expect(plan.matteAdded).toEqual([1, 3])
    const { next } = precompose(anim, [['layers', 2]])
    expect(names(next.layers)).toEqual(['Top', 'Pre-comp 1', 'Bottom'])
    const inner = lastAsset(next).layers
    expect(names(inner)).toEqual(['Matte', 'Target', 'Far target'])
    expect(inner[1].ind! - 1).toBe(inner[0].ind)
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
    // Selecting the source alone moves all of it too.
    expect(planPrecompose(anim, [['layers', 1]])!.moved).toEqual([1, 2, 3])
  })

  it('nested: precomposes inside a precomp used by instances of different sizes and times', () => {
    const inner = [busy(1, 'A'), shape(2, 'B', { p: s([380, 50, 0]) }), shape(3, 'C')]
    const anim = doc(
      [
        {
          ...createPrecompLayer({ refId: 'box', ind: 1, w: 300, h: 200, ip: 0, op: 60, st: 5 }),
          nm: 'Small',
        },
        {
          ...createPrecompLayer({ refId: 'box', ind: 2, w: 420, h: 260, ip: 10, op: 60, st: -3 }),
          nm: 'Large',
          ks: {
            ...createPrecompLayer({ refId: 'box', ind: 2, w: 420, h: 260, ip: 10, op: 60 }).ks,
            r: s(30),
          },
        },
      ],
      { assets: [{ id: 'box', nm: 'Box', layers: inner }] },
    )
    expect(compFrameSize(anim, ['assets', 0, 'layers'])).toEqual({ w: 420, h: 260 })
    const { next, result } = precompose(anim, [
      ['assets', 0, 'layers', 0],
      ['assets', 0, 'layers', 1],
    ])
    expect(result).toEqual(['assets', 0, 'layers', 0])
    expect(next.assets![0]).toMatchObject({ id: 'box' })
    expect((next.assets![0] as PrecompAsset).layers[0]).toMatchObject({
      ty: 0,
      w: 420,
      h: 260,
      refId: 'comp_0',
    })
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('keeps masks, effects, blend modes and hidden layers on the moved layers', () => {
    const masked = busy(2, 'Masked', {
      hasMask: true,
      masksProperties: [
        {
          mode: 'a',
          inv: false,
          o: s(100),
          x: s(0),
          pt: s({
            c: true,
            v: [
              [0, 0],
              [30, 0],
              [30, 30],
            ],
            i: [
              [0, 0],
              [0, 0],
              [0, 0],
            ],
            o: [
              [0, 0],
              [0, 0],
              [0, 0],
            ],
          }),
        },
      ],
      ef: [
        {
          ty: 25,
          nm: 'Drop Shadow',
          en: 1,
          ef: [
            {
              ty: 2,
              v: keys([
                [0, [0, 0, 0, 1]],
                [50, [1, 0, 0, 1]],
              ]),
            },
          ],
        },
      ],
    })
    const anim = doc([shape(1, 'Top'), masked, shape(3, 'Hidden', {}, { hd: true })])
    const { next } = precompose(
      anim,
      [
        ['layers', 1],
        ['layers', 2],
      ],
      { adjustDuration: true },
    )
    expect(lastAsset(next).layers[1].hd).toBe(true)
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('reports expressions and what the dialog needs', () => {
    const anim = fourLayers()
    ;(anim.layers[1].ks.r as { x?: string }).x = 'time * 90'
    const plan = planPrecompose(anim, [['layers', 1]])!
    expect(plan).toMatchObject({
      selected: [1],
      moved: [1],
      expressions: true,
      size: { w: 400, h: 300 },
      span: { ip: 0, op: 60 },
      compRange: { ip: 0, op: 60 },
      leave: 'kind',
      leaveSize: null,
    })
    expect(planPrecompose(anim, [['layers', 0]])!.expressions).toBe(false)
    expect(
      planPrecompose(anim, [
        ['layers', 0],
        ['layers', 1],
      ])!.leave,
    ).toBe('multiple')
  })
})

describe('precomposeLayers — leave all attributes', () => {
  it('keeps the transform, masks, effects, blend and timing on the precomp layer', () => {
    const card = richCard()
    card.masksProperties = [
      {
        mode: 'a',
        inv: false,
        o: s(80),
        x: s(0),
        pt: s({
          c: true,
          v: [
            [0, 0],
            [60, 0],
            [60, 50],
            [0, 50],
          ],
          i: [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
          ],
          o: [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
          ],
        }),
      },
    ]
    const anim = doc([
      shape(1, 'Top'),
      nul(2, 'Rig', {
        r: keys([
          [0, [0]],
          [59, [60]],
        ]),
        p: s([10, 10, 0]),
      }),
      card,
      shape(4, 'Child'),
    ])
    card.parent = 2
    anim.layers[3].parent = 3
    const plan = planPrecompose(anim, [['layers', 2]])!
    expect(plan.leave).toBeNull()
    expect(plan.leaveSize).toEqual({ w: 80, h: 60 })
    const { next, result } = precompose(anim, [['layers', 2]], {
      mode: 'leave',
      name: 'Card Comp 1',
    })
    expect(result).toEqual(['layers', 2])
    const outer = next.layers[2] as PrecompLayer
    expect(outer).toMatchObject({
      ty: 0,
      ind: 3,
      parent: 2,
      w: 80,
      h: 60,
      ip: 6,
      op: 50,
      st: 0,
      bm: 3,
      refId: 'comp_0',
    })
    expect(outer.ks).toEqual(card.ks)
    expect(outer.masksProperties).toEqual(card.masksProperties)
    expect(outer.ef).toEqual(card.ef)
    const inner = lastAsset(next).layers
    expect(inner).toHaveLength(1)
    expect(inner[0]).toMatchObject({ ty: 1, ind: 3, ip: 6, op: 50, st: 2, bm: 0, sw: 80, sh: 60 })
    expect(inner[0].parent).toBeUndefined()
    expect(inner[0].masksProperties).toBeUndefined()
    expect(inner[0].ef).toBeUndefined()
    expect(inner[0].ks.p).toEqual({ a: 0, k: [0, 0, 0] })
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('keeps track mattes working on the precomp layer (target and source)', () => {
    const anim = doc([
      solid(1, 'Matte', {
        td: 1,
        ks: {
          o: s(100),
          p: keys([
            [0, [100, 100, 0]],
            [59, [300, 200, 0]],
          ]),
          a: s([40, 30, 0]),
        },
      }),
      solid(2, 'Target', { tt: 1 }),
      solid(3, 'Other', { tt: 2, tp: 1 }),
    ])
    const a = precompose(anim, [['layers', 1]], { mode: 'leave' }).next
    expect(a.layers[1]).toMatchObject({ ty: 0, tt: 1, ind: 2 })
    expect(renderDiff(anim, a, framesOf(anim))).toBeNull()
    const b = precompose(anim, [['layers', 0]], { mode: 'leave' }).next
    expect(b.layers[0]).toMatchObject({ ty: 0, td: 1, ind: 1 })
    expect(renderDiff(anim, b, framesOf(anim))).toBeNull()
  })

  it('adjusts the duration of the new composition to the layer', () => {
    const anim = doc([richCard()])
    anim.layers[0].masksProperties = undefined
    anim.layers[0].hasMask = undefined
    const { next } = precompose(anim, [['layers', 0]], { mode: 'leave', adjustDuration: true })
    expect(next.layers[0]).toMatchObject({ ip: 6, op: 50, st: 6 })
    expect(lastAsset(next).layers[0]).toMatchObject({ ip: 0, op: 44, st: -4 })
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('works for images and precomps (time remap and stretch stay inside)', () => {
    const image: Layer = {
      ddd: 0,
      ind: 1,
      ty: 2,
      nm: 'Photo',
      refId: 'img',
      sr: 1,
      ao: 0,
      ip: 0,
      op: 60,
      st: 0,
      bm: 0,
      ks: {
        p: keys([
          [0, [0, 0, 0]],
          [59, [200, 100, 0]],
        ]),
        s: s([50, 50, 100]),
      },
    } as Layer
    const precomp = {
      ...createPrecompLayer({ refId: 'inner', ind: 2, w: 120, h: 90, ip: 0, op: 60, st: 7 }),
      nm: 'Nested',
      sr: 0.5,
      ks: {
        p: s([200, 150, 0]),
        a: s([60, 45, 0]),
        r: keys([
          [0, [0]],
          [59, [90]],
        ]),
      },
      tm: keys([
        [0, [0]],
        [59, [1.5]],
      ]),
    } as PrecompLayer
    const anim = doc([image, precomp], {
      assets: [
        { id: 'img', w: 64, h: 48, u: '', p: 'data:image/png;base64,AAAA', e: 1 },
        { id: 'inner', layers: [busy(1, 'Deep')] },
      ],
    })
    expect(planPrecompose(anim, [['layers', 0]])!.leaveSize).toEqual({ w: 64, h: 48 })
    const a = precompose(anim, [['layers', 0]], { mode: 'leave' }).next
    expect(renderDiff(anim, a, framesOf(anim))).toBeNull()
    const b = precompose(anim, [['layers', 1]], { mode: 'leave', adjustDuration: true }).next
    const inner = lastAsset(b).layers[0] as PrecompLayer
    expect(inner).toMatchObject({ sr: 0.5, w: 120, h: 90 })
    expect(inner.tm).toBeDefined()
    expect(b.layers[1]).toMatchObject({ w: 120, h: 90 })
    expect(renderDiff(anim, b, framesOf(anim))).toBeNull()
  })

  it('is only offered for one solid, image or precomp with a size', () => {
    const anim = doc(
      [
        shape(1, 'Shape'),
        { ddd: 0, ind: 2, ty: 2, refId: 'nosize', ks: {}, ip: 0, op: 60, st: 0 } as Layer,
        solid(3, 'Solid'),
        nul(4, 'Null'),
      ],
      { assets: [{ id: 'nosize', u: '', p: 'x.png' }] },
    )
    expect(planPrecompose(anim, [['layers', 0]])!.leave).toBe('kind')
    expect(planPrecompose(anim, [['layers', 1]])!.leave).toBe('size')
    expect(planPrecompose(anim, [['layers', 3]])!.leave).toBe('kind')
    expect(
      planPrecompose(anim, [
        ['layers', 2],
        ['layers', 3],
      ])!.leave,
    ).toBe('multiple')
    expect(precompose(anim, [['layers', 0]], { mode: 'leave' }).result).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/*                                   Release                                  */
/* -------------------------------------------------------------------------- */

function precompDoc(
  inner: Layer[],
  layer: Partial<PrecompLayer> = {},
  extra: { before?: Layer[]; after?: Layer[] } = {},
): Animation {
  const base = createPrecompLayer({ refId: 'inner', ind: 10, w: 400, h: 300, ip: 0, op: 60 })
  return doc(
    [...(extra.before ?? []), { ...base, nm: 'Group', ...layer }, ...(extra.after ?? [])],
    {
      assets: [{ id: 'inner', nm: 'Inner', layers: inner }],
    },
  )
}

describe('releasePrecomps', () => {
  it('puts the layers back without a null when the precomp layer changes nothing', () => {
    const anim = precompDoc([busy(1, 'A'), shape(2, 'B')], {}, { before: [shape(20, 'Top')] })
    const { next, result } = release(anim, [['layers', 1]])
    expect(names(next.layers)).toEqual(['Top', 'A', 'B'])
    expect(next.layers.map((l) => l.ind)).toEqual([20, 1, 2])
    expect(result).toMatchObject({
      nulls: [],
      skipped: [],
      removedAssets: ['inner'],
      splitOpacity: false,
    })
    expect(result.layers).toEqual([
      ['layers', 1],
      ['layers', 2],
    ])
    expect(result.origins).toEqual([
      [
        ['assets', 0, 'layers', 0],
        ['layers', 1],
      ],
      [
        ['assets', 0, 'layers', 1],
        ['layers', 2],
      ],
    ])
    expect(next.assets).toEqual([])
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('moves a transform to a null with the precomp layer name and ind', () => {
    const anim = precompDoc(
      [busy(1, 'A'), shape(2, 'B', {}, { parent: 1 })],
      {
        ks: {
          o: s(100),
          p: keys([
            [0, [150, 120, 0]],
            [59, [260, 180, 0]],
          ]),
          a: s([200, 150, 0]),
          r: keys([
            [0, [0]],
            [59, [-90]],
          ]),
          s: s([80, 120, 100]),
          sk: s(15),
        },
        ao: 0,
        parent: 30,
      },
      {
        after: [
          shape(31, 'Child', {}, { parent: 10 }),
          nul(30, 'Rig', {
            p: keys([
              [0, [0, 0, 0]],
              [59, [40, 20, 0]],
            ]),
          }),
        ],
      },
    )
    const { next, result } = release(anim, [['layers', 0]])
    expect(names(next.layers)).toEqual(['Group', 'A', 'B', 'Child', 'Rig'])
    const holder = next.layers[0] as NullLayer
    expect(holder).toMatchObject({ ty: 3, ind: 10, parent: 30 })
    expect(holder.ks.r).toEqual(anim.layers[0].ks.r)
    expect(next.layers[1].parent).toBe(10)
    expect(next.layers[2].parent).toBe(next.layers[1].ind)
    expect(next.layers[3].parent).toBe(10)
    expect(result.nulls).toEqual([['layers', 0]])
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('maps times through st and sr (nested precomps and time remaps too)', () => {
    const deep: PrecompLayer = {
      ...createPrecompLayer({ refId: 'deep', ind: 3, w: 400, h: 300, ip: 2, op: 70, st: 6 }),
      sr: 1.5,
      nm: 'Deep',
    }
    const remapped: PrecompLayer = {
      ...createPrecompLayer({ refId: 'deep', ind: 4, w: 400, h: 300, ip: 0, op: 80 }),
      nm: 'Remapped',
      tm: keys([
        [5, [0.2]],
        [40, [1.4]],
      ]),
    }
    for (const [sr, st] of [
      [2, 12],
      [0.5, -7],
      [1, 25],
    ]) {
      const anim = precompDoc(
        [
          busy(1, 'A', { ip: 3, op: 45 }),
          shape(2, 'B', {
            o: keys([
              [4, [0]],
              [30, [100]],
            ]),
          }),
          deep,
          remapped,
        ],
        {
          sr,
          st,
          ip: 5,
          op: 60,
        },
      )
      anim.assets!.push({ id: 'deep', layers: [busy(1, 'Deepest')] })
      anim.op = 120
      const { next } = release(anim, [['layers', 0]])
      const a = next.layers.find((l) => l.nm === 'A')!
      expect(a.ip).toBeCloseTo(Math.max(5, 3 * sr + st))
      expect(a.op).toBeCloseTo(Math.min(60, 45 * sr + st))
      const d = next.layers.find((l) => l.nm === 'Deep')!
      expect(d.sr).toBeCloseTo(1.5 * sr)
      expect(d.st).toBeCloseTo(6 * sr + st)
      expect(renderDiff(anim, next, framesOf(anim, 1))).toBeNull()
    }
  })

  it('applies the opacity to the released layers', () => {
    // Static group opacity, one layer: exact.
    const one = precompDoc([busy(1, 'A')], { ks: { ...precompDoc([]).layers[0].ks, o: s(40) } })
    const r1 = release(one, [['layers', 0]])
    expect(r1.result.splitOpacity).toBe(false)
    expect(renderDiff(one, r1.next, framesOf(one))).toBeNull()
    // Animated group opacity × static and × animated layer opacity, several layers.
    const several = precompDoc(
      [shape(1, 'Static', { o: s(50) }), busy(2, 'Animated'), nul(3, 'Rig'), shape(4, 'Plain')],
      {
        ks: {
          ...precompDoc([]).layers[0].ks,
          o: keys([
            [0, [100]],
            [30, [20]],
            [59, [70]],
          ]),
        },
      },
    )
    const r2 = release(several, [['layers', 0]])
    expect(r2.result.splitOpacity).toBe(true)
    expect(r2.next.layers.find((l) => l.nm === 'Rig')!.ks.o).toEqual(s(100))
    // Products of two eased curves are sampled per frame: exact on whole frames.
    expect(
      renderDiff(several, r2.next, framesOf(several).filter(Number.isInteger), { tol: 1e-5 }),
    ).toBeNull()
    expect(renderDiff(several, r2.next, framesOf(several), { tol: 2e-3 })).toBeNull()
  })

  it('hides the released layers of a hidden precomp layer', () => {
    const anim = precompDoc([busy(1, 'A'), shape(2, 'B')], { hd: true })
    const { next } = release(anim, [['layers', 0]])
    expect(next.layers.every((l) => l.hd === true)).toBe(true)
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('keeps track mattes inside working (position-based, tp and ind − 1)', () => {
    const anim = precompDoc(
      [
        shape(
          5,
          'Matte',
          {
            p: keys([
              [0, [60, 60, 0]],
              [59, [300, 200, 0]],
            ]),
          },
          { td: 1 },
        ),
        busy(6, 'Target', { tt: 1 }),
        busy(7, 'Far', { tt: 3, tp: 5 }),
        shape(8, 'Plain'),
      ],
      {},
      { before: [shape(5, 'Clash')] },
    )
    const { next } = release(anim, [['layers', 1]])
    const layers = next.layers
    expect(names(layers)).toEqual(['Clash', 'Matte', 'Target', 'Far', 'Plain'])
    // "5" is taken by "Clash": the released layers are renumbered, consecutively.
    expect(layers.slice(1).map((l) => l.ind)).toEqual([11, 12, 13, 14])
    expect(layers[3].tp).toBe(11)
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('clips in/out points and drops layers never visible through the precomp', () => {
    const anim = precompDoc(
      [
        shape(1, 'Early', {}, { ip: 0, op: 10 }),
        shape(2, 'Partly', {}, { ip: 5, op: 50 }),
        busy(3, 'Parent needed', { ip: 50, op: 60 }),
        shape(4, 'Child', {}, { parent: 3, ip: 20, op: 40 }),
      ],
      { ip: 15, op: 45 },
    )
    const { next } = release(anim, [['layers', 0]])
    expect(names(next.layers)).toEqual(['Partly', 'Parent needed', 'Child'])
    expect(next.layers[0]).toMatchObject({ ip: 15, op: 45 })
    // Never visible here but still a parent: kept, hidden, with its own time range.
    expect(next.layers[1]).toMatchObject({ hd: true, ip: 50, op: 60 })
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('removes the composition only when nothing else uses it', () => {
    const shared = precompDoc(
      [busy(1, 'A')],
      {},
      {
        after: [
          {
            ...createPrecompLayer({ refId: 'inner', ind: 11, w: 400, h: 300, ip: 0, op: 60 }),
            nm: 'Other',
          },
        ],
      },
    )
    const r1 = release(shared, [['layers', 0]])
    expect(r1.result.removedAssets).toEqual([])
    expect(r1.next.assets).toHaveLength(1)
    expect(renderDiff(shared, r1.next, framesOf(shared))).toBeNull()
    // Both instances at once: gone.
    const r2 = release(shared, [
      ['layers', 0],
      ['layers', 1],
    ])
    expect(r2.result.removedAssets).toEqual(['inner'])
    expect(names(r2.next.layers)).toEqual(['A', 'A'])
    expect(renderDiff(shared, r2.next, framesOf(shared))).toBeNull()
  })

  it('finds released layers after earlier assets were removed (paths shift)', () => {
    const anim = doc(
      [
        {
          ...createPrecompLayer({ refId: 'outer', ind: 1, w: 400, h: 300, ip: 0, op: 60 }),
          nm: 'Outer',
        },
      ],
      {
        assets: [
          { id: 'gone', layers: [busy(1, 'G')] },
          {
            id: 'outer',
            layers: [
              {
                ...createPrecompLayer({ refId: 'gone', ind: 1, w: 400, h: 300, ip: 0, op: 60 }),
                nm: 'Nested',
              },
              shape(2, 'Keep'),
            ],
          },
        ],
      },
    )
    const { next, result } = release(anim, [['assets', 1, 'layers', 0]])
    expect(result.removedAssets).toEqual(['gone'])
    expect(result.layers).toEqual([['assets', 0, 'layers', 0]])
    expect((next.assets![0] as PrecompAsset).layers[0].nm).toBe('G')
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('releases several precomp layers of one composition in one go', () => {
    const anim = doc(
      [
        {
          ...createPrecompLayer({ refId: 'a', ind: 1, w: 400, h: 300, ip: 0, op: 60 }),
          nm: 'PA',
          ks: { p: s([220, 150, 0]), a: s([200, 150, 0]) },
        },
        shape(2, 'Between', {}, { parent: 1 }),
        { ...createPrecompLayer({ refId: 'b', ind: 3, w: 400, h: 300, ip: 0, op: 60 }), nm: 'PB' },
        shape(4, 'Child of PB', {}, { parent: 3 }),
      ],
      {
        assets: [
          { id: 'a', layers: [busy(1, 'A1'), shape(2, 'A2')] },
          { id: 'b', layers: [busy(1, 'B1')] },
        ],
      },
    )
    const { next, result } = release(anim, [
      ['layers', 0],
      ['layers', 2],
    ])
    expect(names(next.layers)).toEqual(['PA', 'A1', 'A2', 'Between', 'B1', 'Child of PB'])
    expect(result.nulls).toEqual([['layers', 0]])
    expect(next.layers[5].parent).toBeUndefined()
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('refuses what cannot be released without changing the animation', () => {
    const base = precompDoc([busy(1, 'A')])
    const blocked = (layer: Partial<PrecompLayer>, extra: Partial<Animation> = {}) => {
      const anim = precompDoc([busy(1, 'A')], layer)
      Object.assign(anim, extra)
      return releaseBlocker(anim, ['layers', 0])
    }
    expect(releaseBlocker(base, ['layers', 0])).toBeNull()
    expect(releaseBlocker(doc([shape(1, 'S')]), ['layers', 0])).toBe('not-precomp')
    expect(blocked({ refId: 'nope' })).toBe('missing')
    expect(blocked({ tm: s(0) })).toBe('time-remap')
    expect(blocked({ sr: -1 })).toBe('stretch')
    expect(blocked({ sr: 0 })).toBe('stretch')
    expect(blocked({ tt: 1 })).toBe('matte')
    expect(blocked({ td: 1 })).toBe('matte')
    const pt = s({ c: true, v: [[0, 0]], i: [[0, 0]], o: [[0, 0]] })
    expect(blocked({ masksProperties: [{ mode: 'a', pt }] })).toBe('masks')
    expect(blocked({ masksProperties: [{ mode: 'n', pt }] })).toBeNull()
    expect(blocked({ ef: [{ ty: 29, en: 1 }] })).toBe('effects')
    expect(blocked({ ef: [{ ty: 29, en: 0 }] })).toBeNull()
    expect(blocked({ ef: [{ ty: 5, mn: 'ADBE Slider Control', en: 1 }] })).toBeNull()
    expect(blocked({ ef: [{ ty: 5, mn: 'Pseudo/MDS Elastic Controller', en: 1 }] })).toBeNull()
    expect(blocked({ ef: [{ ty: 5, mn: 'ADBE Tile', en: 1 }] })).toBe('effects')
    expect(blocked({ sy: [{ ty: 1 }] })).toBe('styles')
    expect(blocked({ bm: 1 })).toBe('blend')
    // A composition containing the one it would be released into.
    const loop = doc([], {
      assets: [
        {
          id: 'a',
          layers: [{ ...createPrecompLayer({ refId: 'b', ind: 1, w: 10, h: 10, ip: 0, op: 60 }) }],
        },
        {
          id: 'b',
          layers: [{ ...createPrecompLayer({ refId: 'a', ind: 1, w: 10, h: 10, ip: 0, op: 60 }) }],
        },
      ],
    })
    expect(releaseBlocker(loop, ['assets', 0, 'layers', 0])).toBe('recursive')
    const { next, result } = release(precompDoc([busy(1, 'A')], { tm: s(0) }), [['layers', 0]])
    expect(result.skipped).toEqual([{ path: ['layers', 0], reason: 'time-remap' }])
    expect(next.layers).toHaveLength(1)
  })

  it('keeps a transform driven by an expression on a null', () => {
    const base = precompDoc([]).layers[0].ks
    const anim = precompDoc([busy(1, 'A')], { ks: { ...base, r: { a: 0, k: 0, x: 'time * 90' } } })
    const { next, result } = release(anim, [['layers', 0]])
    expect(result.nulls).toEqual([['layers', 0]])
    expect((next.layers[0].ks.r as { x?: string }).x).toBe('time * 90')
    expect(next.layers[1].parent).toBe(10)
  })

  it('keeps expression controls on the null (the layer name still resolves)', () => {
    const ef: Effect[] = [
      {
        ty: 5,
        nm: 'Speed',
        mn: 'ADBE Slider Control',
        en: 1,
        ef: [{ ty: 0, nm: 'Slider', v: s(3) }],
      },
    ]
    const anim = precompDoc([busy(1, 'A')], { ef })
    const { next } = release(anim, [['layers', 0]])
    expect(next.layers[0]).toMatchObject({ ty: 3, nm: 'Group', ind: 10, ef })
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
  })

  it('detects content that the composition clipped and the canvas would show', () => {
    const inside = precompDoc([shape(1, 'In', { p: s([200, 150, 0]) })])
    expect(releaseRevealsContent(inside, ['layers', 0])).toBe(false)
    const wander = () =>
      shape(1, 'Wanders', {
        p: keys([
          [0, [200, 150, 0]],
          [59, [380, 150, 0]],
        ]),
      })
    // A canvas-sized composition: what it clips, the canvas clips too.
    expect(releaseRevealsContent(precompDoc([wander()]), ['layers', 0])).toBe(false)
    const offCanvas = precompDoc([
      shape(1, 'Far', {
        p: keys([
          [0, [200, 150, 0]],
          [59, [900, 150, 0]],
        ]),
      }),
    ])
    expect(releaseRevealsContent(offCanvas, ['layers', 0])).toBe(false)
    // A narrower one: the part between its edge and the canvas edge shows up.
    expect(releaseRevealsContent(precompDoc([wander()], { w: 300 }), ['layers', 0])).toBe(true)
    // Moved right by 100: its frame covers the canvas' right part, the left part shows up.
    const shifted = precompDoc([shape(1, 'Left', { p: s([20, 150, 0]) })], {
      ks: { a: s([200, 150, 0]), p: s([300, 150, 0]) },
    })
    expect(releaseRevealsContent(shifted, ['layers', 0])).toBe(false)
    const shiftedBack = precompDoc([shape(1, 'Left', { p: s([20, 150, 0]) })], {
      ks: { a: s([200, 150, 0]), p: s([100, 150, 0]) },
    })
    expect(releaseRevealsContent(shiftedBack, ['layers', 0])).toBe(false)
    const narrowShifted = precompDoc([shape(1, 'Edge', { p: s([10, 150, 0]) })], {
      w: 300,
      ks: { a: s([150, 150, 0]), p: s([250, 150, 0]) },
    })
    expect(releaseRevealsContent(narrowShifted, ['layers', 0])).toBe(true)
    expect(releaseRevealsContent(precompDoc([wander()], { hd: true, w: 300 }), ['layers', 0])).toBe(
      false,
    )
    expect(releaseRevealsContent(inside, ['layers', 5])).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/*                                 Round trips                                */
/* -------------------------------------------------------------------------- */

describe('precompose, then release', () => {
  it.each([false, true])('gives the original document back (adjust duration: %s)', (adjust) => {
    const anim = rigDoc()
    const a = precompose(
      anim,
      [
        ['layers', 1],
        ['layers', 2],
      ],
      { adjustDuration: adjust },
    ).next
    expect(renderDiff(anim, a, framesOf(anim))).toBeNull()
    const pathOfPrecomp: NodePath = ['layers', a.layers.findIndex((l) => l.ty === 0)]
    const b = release(a, [pathOfPrecomp])
    expect(b.result.nulls).toEqual([])
    expect(b.next).toEqual(anim)
  })

  it('after a reload (copies no longer known) it still renders the same, without extra layers', () => {
    for (const adjustDuration of [false, true]) {
      const anim = rigDoc()
      const a = precompose(
        anim,
        [
          ['layers', 1],
          ['layers', 2],
        ],
        { adjustDuration },
      ).next
      const reloaded = JSON.parse(JSON.stringify(a)) as Animation
      const b = release(reloaded, [['layers', reloaded.layers.findIndex((l) => l.ty === 0)]]).next
      expect(renderDiff(anim, b, framesOf(anim))).toBeNull()
      expect(b.layers.map((l) => l.nm).sort()).toEqual(anim.layers.map((l) => l.nm).sort())
      expect(b.assets).toEqual([])
    }
  })

  it('also for matte pairs and chains crossing the boundary both ways', () => {
    const anim = rigDoc()
    anim.layers.splice(
      1,
      0,
      shape(
        6,
        'Matte',
        {
          p: keys([
            [0, [60, 60, 0]],
            [59, [300, 200, 0]],
          ]),
        },
        { td: 1 },
      ),
    )
    anim.layers[2].tt = 1
    anim.layers.push(
      nul(
        9,
        'Link',
        {
          r: keys([
            [0, [0]],
            [59, [45]],
          ]),
        },
        { parent: 2 },
      ),
    )
    anim.layers[3].parent = 9
    const a = precompose(anim, [
      ['layers', 2],
      ['layers', 3],
    ]).next
    expect(renderDiff(anim, a, framesOf(anim))).toBeNull()
    const b = release(a, [['layers', a.layers.findIndex((l) => l.ty === 0)]]).next
    expect(b).toEqual(anim)
  })
})

/* -------------------------------------------------------------------------- */
/*                              Real-world files                              */
/* -------------------------------------------------------------------------- */

// Each case compares the rendering of every frame of a real file several times: seconds locally,
// more on shared CI machines.
describe('real-world documents', { timeout: 30_000 }, () => {
  it.each([
    ['a child of a parent chain', [0]],
    ['a rig of four layers', [14, 15, 16, 17]],
    ['the null parenting everything', [18]],
    ['eight precomp instances with st offsets', [6, 7, 8, 9, 10, 11, 12, 13]],
    ['every layer', Array.from({ length: 21 }, (_, i) => i)],
  ])('docs/test.json: precomposing %s renders the same', (_, indices) => {
    const anim = testDoc()
    for (const adjustDuration of [false, true]) {
      const { next } = precompose(anim, layersOf(...indices), { adjustDuration })
      expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
      const back = release(next, [['layers', next.layers.findIndex((l) => l.nm === 'Pre-comp 1')]])
      expect(renderDiff(anim, back.next, framesOf(anim))).toBeNull()
      expect(back.next).toEqual(anim)
    }
  })

  it('docs/test.json: releasing the eight precomp instances renders the same', () => {
    const anim = testDoc()
    const paths = layersOf(6, 7, 8, 9, 10, 11, 12, 13)
    const reveals = paths.some((p) => releaseRevealsContent(anim, p))
    const { next, result } = release(anim, paths)
    expect(result.skipped).toEqual([])
    expect(result.removedAssets).toEqual(['comp_0'])
    expect(result.nulls).toHaveLength(8)
    expect(renderDiff(anim, next, framesOf(anim), { visible: !reveals })).toBeNull()
  })

  it('docs/wallet_flag.json: a matte source that parents layers', () => {
    const anim = walletDoc()
    // The matted precomp brings its matte ("base 2"), which parents seven layers staying here.
    const plan = planPrecompose(anim, layersOf(10))!
    expect(plan.moved).toEqual([9, 10])
    expect(plan.parentsLeft).toEqual([9])
    const { next } = precompose(anim, layersOf(10))
    expect(renderDiff(anim, next, framesOf(anim))).toBeNull()
    const back = release(next, [['layers', next.layers.findIndex((l) => l.nm === 'Pre-comp 1')]])
    expect(back.next).toEqual(anim)
    // The matted precomp itself cannot be released; the plain one can.
    expect(releaseBlocker(anim, ['layers', 10])).toBe('matte')
    expect(releaseBlocker(anim, ['layers', 8])).toBeNull()
    const released = release(anim, layersOf(8))
    const reveals = releaseRevealsContent(anim, ['layers', 8])
    expect(renderDiff(anim, released.next, framesOf(anim), { visible: !reveals })).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/*                         The harness itself is sensitive                    */
/* -------------------------------------------------------------------------- */

describe('render signature (sanity)', () => {
  it('sees what the real-world file draws', () => {
    const anim = testDoc()
    expect(renderDiff(anim, testDoc(), framesOf(anim))).toBeNull()
    const counts = [0, 20, 80, 110].map((f) => renderSignature(anim, f).length)
    expect(Math.min(...counts)).toBeGreaterThan(5)
  })

  it('detects a keyframe one frame off, a missing parent, a lost clip and a matte change', () => {
    const anim = testDoc()
    const frames = framesOf(anim)
    const shifted = testDoc()
    const kf = getKeyframes((shifted.layers[18].ks.s as never) ?? null)!
    kf[1].t += 1
    expect(renderDiff(anim, shifted, frames)).not.toBeNull()

    // Precomposing a child without keeping its parent chain would move it.
    const naive = structuredClone(precompose(anim, [['layers', 0]]).next)
    const content = lastAsset(naive).layers
    content.splice(1)
    delete content[0].parent
    expect(renderDiff(anim, naive, frames)).not.toBeNull()

    const clipped = precompDoc([shape(1, 'Wide', { p: s([380, 150, 0]) })], { w: 300 })
    const unclipped = structuredClone(clipped)
    ;(unclipped.layers[0] as PrecompLayer).w = 400
    expect(renderDiff(clipped, unclipped, framesOf(clipped))).not.toBeNull()
    expect(renderDiff(clipped, unclipped, framesOf(clipped), { visible: false })).toBeNull()

    const matted = doc([shape(1, 'M', {}, { td: 1 }), shape(2, 'T', {}, { tt: 1 })])
    const inverted = structuredClone(matted)
    inverted.layers[1].tt = 2
    expect(renderDiff(matted, inverted, framesOf(matted))).not.toBeNull()
  })
})
