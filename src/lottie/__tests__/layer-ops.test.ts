import { enablePatches, freeze, produce, produceWithPatches } from 'immer'
import { describe, expect, it } from 'vitest'
import { createAnimation } from '../document'
import {
  addShapeItem,
  arrangeLayers,
  arrangeShapes,
  canMoveShapes,
  canSetParent,
  comparePaths,
  copyName,
  deleteLayers,
  deleteShapes,
  duplicateLayers,
  duplicateShapes,
  groupShapes,
  insertLayers,
  isIdentityGroupTransform,
  layerBlocks,
  matteSourceIndex,
  matteTargetIndices,
  moveLayers,
  moveShapes,
  normalizeLayerInsertIndex,
  parseLayersClipboard,
  pasteLayers,
  pasteShapes,
  renameNode,
  retimeClipboard,
  serializeLayers,
  serializeShapes,
  setHidden,
  setParent,
  shapeInsertIndex,
  ungroupBlocker,
  ungroupShapes,
} from '../layer-ops'
import {
  createFillShape,
  createGroupShape,
  createRectShape,
  createStrokeShape,
  createTrimPathsShape,
} from '../create'
import type { NodePath } from '../path'
import { evaluatePosition, evaluateScalar, evaluateVector } from '../property'
import type {
  Animation,
  GroupShape,
  Layer,
  PrecompLayer,
  ShapeItem,
  ShapeLayer,
  TextLayer,
} from '../types'

enablePatches()

/* --------------------------------- Fixtures -------------------------------- */

function nullLayer(ind: number, nm?: string, extra: Partial<Layer> = {}): Layer {
  const layer = {
    ty: 3,
    ind,
    ip: 0,
    op: 60,
    st: 0,
    ks: { o: { a: 0, k: 100 }, p: { a: 0, k: [ind, ind, 0] } },
    ...extra,
  } as Layer
  if (nm !== undefined) layer.nm = nm
  return layer
}

function shapeLayer(ind: number, nm: string, shapes: ShapeItem[]): ShapeLayer {
  return { ty: 4, ind, nm, ip: 0, op: 60, st: 0, ks: {}, shapes }
}

function precompLayer(ind: number, refId: string, nm = refId): PrecompLayer {
  return { ty: 0, ind, nm, refId, ip: 0, op: 60, st: 0, ks: {}, w: 100, h: 100 }
}

function doc(layers: Layer[], extra: Partial<Animation> = {}): Animation {
  return { ...createAnimation({ name: 'Test' }), layers, ...extra }
}

const names = (layers: Layer[]) => layers.map((l) => l.nm)
const inds = (layers: Layer[]) => layers.map((l) => l.ind)
const tys = (items: ShapeItem[]) => items.map((i) => i.ty)
const shapesOf = (anim: Animation, i = 0) => (anim.layers[i] as ShapeLayer).shapes

/** Group [rect, fill, tr] named `nm`. */
function box(nm: string): GroupShape {
  return createGroupShape({
    name: nm,
    items: [createRectShape({ w: 10, h: 10 }), createFillShape({ color: '#ff0000' })],
  })
}

/* ---------------------------------- Mattes --------------------------------- */

describe('track mattes', () => {
  it('finds position-based and tp-based matte sources like lottie-web', () => {
    const layers = [
      nullLayer(1, 'src', { td: 1 }),
      nullLayer(2, 'target', { tt: 1 }),
      nullLayer(3, 'plain'),
      nullLayer(4, 'tp-target', { tt: 2, tp: 1 }),
      nullLayer(5, 'bad-tp', { tt: 1, tp: 99 }),
    ]
    expect(matteSourceIndex(layers, 1)).toBe(0)
    expect(matteSourceIndex(layers, 3)).toBe(0)
    expect(matteSourceIndex(layers, 4)).toBe(-1)
    expect(matteSourceIndex(layers, 2)).toBe(-1)
    expect(matteTargetIndices(layers, 0)).toEqual([1, 3])
  })

  it('groups adjacent source/target pairs (and chains) into blocks', () => {
    const layers = [
      nullLayer(1),
      nullLayer(2, 'src', { td: 1 }),
      nullLayer(3, 'target', { tt: 1 }),
      nullLayer(4, 'far', { tt: 1, tp: 1 }),
    ]
    expect(layerBlocks(layers)).toEqual([
      [0, 0],
      [1, 2],
      [3, 3],
    ])
    expect(normalizeLayerInsertIndex(layers, 2)).toBe(1)
    expect(normalizeLayerInsertIndex(layers, 3)).toBe(3)
    expect(normalizeLayerInsertIndex(layers, 99)).toBe(4)
    expect(layerBlocks([])).toEqual([])
  })
})

/* -------------------------------- Duplicate -------------------------------- */

describe('duplicateLayers', () => {
  it('inserts a deep copy above the original with a new unique ind and a copy name', () => {
    const anim = doc([nullLayer(1, 'A'), nullLayer(2, 'B')])
    const paths = duplicateLayers(anim, [['layers', 1]], { suffix: ' copy' })
    expect(paths).toEqual([['layers', 1]])
    expect(names(anim.layers)).toEqual(['A', 'B copy', 'B'])
    expect(inds(anim.layers)).toEqual([1, 3, 2])
    expect(anim.layers[1].ks).not.toBe(anim.layers[2].ks)
    expect(anim.layers[1].ks.p).not.toBe(anim.layers[2].ks.p)
  })

  it('duplicates several layers, each above its original', () => {
    const anim = doc([nullLayer(1, 'A'), nullLayer(2, 'B'), nullLayer(3, 'C'), nullLayer(4, 'D')])
    const paths = duplicateLayers(anim, [
      ['layers', 3],
      ['layers', 0],
      ['layers', 1],
    ])
    expect(names(anim.layers)).toEqual(['A copy', 'B copy', 'A', 'B', 'C', 'D copy', 'D'])
    expect(paths).toEqual([
      ['layers', 5],
      ['layers', 0],
      ['layers', 1],
    ])
    expect(new Set(inds(anim.layers)).size).toBe(7)
  })

  it('numbers copies and does not stack suffixes', () => {
    expect(copyName('Ball', ' copy', new Set())).toBe('Ball copy')
    expect(copyName('Ball', ' copy', new Set(['Ball copy']))).toBe('Ball copy 2')
    expect(copyName('Ball copy', ' copy', new Set(['Ball copy']))).toBe('Ball copy 2')
    expect(copyName('Ball copy 2', ' copy', new Set(['Ball copy', 'Ball copy 2']))).toBe(
      'Ball copy 3',
    )
    expect(copyName('Мяч', ' копия', new Set())).toBe('Мяч копия')
    expect(copyName('Ball', '', new Set())).toBe('Ball')
  })

  it('keeps unnamed layers unnamed', () => {
    const anim = doc([nullLayer(1)])
    duplicateLayers(anim, [['layers', 0]])
    expect(anim.layers[0].nm).toBeUndefined()
  })

  it('remaps parents inside the duplicated set and keeps outside parents', () => {
    const anim = doc([
      nullLayer(1, 'child', { parent: 2 }),
      nullLayer(2, 'parent'),
      nullLayer(3, 'other', { parent: 2 }),
    ])
    duplicateLayers(anim, [
      ['layers', 0],
      ['layers', 1],
    ])
    // [child copy, parent copy, child, parent, other]
    const [childCopy, parentCopy, child] = anim.layers
    expect(childCopy.parent).toBe(parentCopy.ind)
    expect(child.parent).toBe(2)
    expect(anim.layers[4].parent).toBe(2)

    const anim2 = doc([nullLayer(1, 'child', { parent: 2 }), nullLayer(2, 'parent')])
    duplicateLayers(anim2, [['layers', 0]])
    expect(anim2.layers[0].parent).toBe(2)
  })

  it('duplicates the matte source with its target, keeping them adjacent', () => {
    const anim = doc([
      nullLayer(1, 'bg'),
      nullLayer(2, 'matte', { td: 1 }),
      nullLayer(3, 'art', { tt: 1 }),
    ])
    const paths = duplicateLayers(anim, [['layers', 2]])
    expect(names(anim.layers)).toEqual(['bg', 'matte copy', 'art copy', 'matte', 'art'])
    expect(paths).toEqual([['layers', 2]])
    // Canvas renderer looks up `ind - 1` for position-based mattes.
    expect(anim.layers[2].ind! - 1).toBe(anim.layers[1].ind)
    expect(matteSourceIndex(anim.layers, 2)).toBe(1)
    expect(matteSourceIndex(anim.layers, 4)).toBe(3)
  })

  it('remaps tp to the copied source', () => {
    const anim = doc([nullLayer(5, 'matte', { td: 1 }), nullLayer(9, 'art', { tt: 1, tp: 5 })])
    duplicateLayers(anim, [['layers', 0]])
    const [matteCopy, artCopy, , art] = anim.layers
    expect(artCopy.tp).toBe(matteCopy.ind)
    expect(art.tp).toBe(5)
  })

  it('shares a distant tp matte source instead of copying it', () => {
    const anim = doc([
      nullLayer(1, 'matte', { td: 1 }),
      nullLayer(2, 'x'),
      nullLayer(3, 'art', { tt: 1, tp: 1 }),
    ])
    duplicateLayers(anim, [['layers', 2]])
    expect(names(anim.layers)).toEqual(['matte', 'x', 'art copy', 'art'])
    expect(anim.layers[2].tp).toBe(1)
  })

  it('duplicates layers inside precomps', () => {
    const anim = doc([precompLayer(1, 'comp_0')], {
      assets: [{ id: 'comp_0', layers: [nullLayer(1, 'inner')] }],
    })
    const paths = duplicateLayers(anim, [['assets', 0, 'layers', 0]])
    expect(paths).toEqual([['assets', 0, 'layers', 0]])
    const inner = (anim.assets![0] as { layers: Layer[] }).layers
    expect(names(inner)).toEqual(['inner copy', 'inner'])
    expect(inds(inner)).toEqual([2, 1])
  })

  it('works on frozen immer drafts without aliasing', () => {
    const base = freeze(doc([nullLayer(1, 'A')]), true)
    const next = produce(base, (d) => {
      duplicateLayers(d as Animation, [['layers', 0]])
    })
    expect(names(next.layers)).toEqual(['A copy', 'A'])
    expect(next.layers[0].ks).not.toBe(next.layers[1].ks)
    expect(next.layers[1]).toBe(base.layers[0])
  })
})

/* ---------------------------------- Delete --------------------------------- */

describe('deleteLayers', () => {
  it('removes layers and clears dangling parents', () => {
    const anim = doc([
      nullLayer(1, 'child', { parent: 2 }),
      nullLayer(2, 'parent'),
      nullLayer(3, 'x'),
    ])
    const removed = deleteLayers(anim, [['layers', 1]])
    expect(removed).toEqual([['layers', 1]])
    expect(names(anim.layers)).toEqual(['child', 'x'])
    expect(anim.layers[0].parent).toBeUndefined()
  })

  it('keeps a parent link when another layer still carries that ind', () => {
    const anim = doc([
      nullLayer(1, 'child', { parent: 2 }),
      nullLayer(2, 'dup a'),
      nullLayer(2, 'dup b'),
    ])
    deleteLayers(anim, [['layers', 1]])
    expect(anim.layers[0].parent).toBe(2)
  })

  it('removes the matte from targets of a deleted source', () => {
    const anim = doc([
      nullLayer(1, 'matte', { td: 1 }),
      nullLayer(2, 'art', { tt: 1 }),
      nullLayer(3, 'tp', { tt: 3, tp: 1 }),
    ])
    deleteLayers(anim, [['layers', 0]])
    expect(anim.layers.map((l) => [l.tt, l.tp])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ])
  })

  it('deletes a dedicated matte source together with its target', () => {
    const anim = doc([
      nullLayer(1, 'bg'),
      nullLayer(2, 'matte', { td: 1 }),
      nullLayer(3, 'art', { tt: 1 }),
    ])
    const removed = deleteLayers(anim, [['layers', 2]])
    expect(removed).toEqual([
      ['layers', 1],
      ['layers', 2],
    ])
    expect(names(anim.layers)).toEqual(['bg'])
  })

  it('keeps a matte source still used by another target', () => {
    const anim = doc([
      nullLayer(1, 'matte', { td: 1 }),
      nullLayer(2, 'a', { tt: 1, tp: 1 }),
      nullLayer(3, 'b', { tt: 1, tp: 1 }),
    ])
    deleteLayers(anim, [['layers', 1]])
    expect(names(anim.layers)).toEqual(['matte', 'b'])
    expect(anim.layers[1].tp).toBe(1)
    expect(matteSourceIndex(anim.layers, 1)).toBe(0)
  })

  it('handles several compositions at once', () => {
    const anim = doc([nullLayer(1, 'root a'), nullLayer(2, 'root b')], {
      assets: [{ id: 'comp_0', layers: [nullLayer(1, 'in a'), nullLayer(2, 'in b')] }],
    })
    deleteLayers(anim, [
      ['layers', 0],
      ['assets', 0, 'layers', 1],
    ])
    expect(names(anim.layers)).toEqual(['root b'])
    expect(names((anim.assets![0] as { layers: Layer[] }).layers)).toEqual(['in a'])
  })
})

/* ------------------------- Delete: children stay in place ------------------------ */

type Affine = [number, number, number, number, number, number]

/** Independent evaluation of a layer's 2D matrix: x ↦ p + R(r)·S·(x − a) (no skew). */
function layerMatrix(layer: Layer, frame: number): Affine {
  const ks = layer.ks ?? {}
  const p = evaluatePosition(ks.p, frame)
  const a = evaluateVector(ks.a, frame, [0, 0])
  const s = evaluateVector(ks.s, frame, [100, 100])
  const r = (evaluateScalar(ks.r, frame) * Math.PI) / 180
  const sx = s[0] / 100
  const sy = (s[1] ?? s[0]) / 100
  const [A, B, C, D] = [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy]
  return [A, B, C, D, p[0] - (A * a[0] + C * a[1]), p[1] - (B * a[0] + D * a[1])]
}

/** Where the point `pt` of `layers[index]` lands on screen at `frame` (parents included). */
function worldPoint(layers: Layer[], index: number, frame: number, pt: number[]): number[] {
  let q = pt
  let layer: Layer | undefined = layers[index]
  const seen = new Set<Layer>()
  while (layer && !seen.has(layer)) {
    seen.add(layer)
    const m = layerMatrix(layer, frame)
    q = [m[0] * q[0] + m[2] * q[1] + m[4], m[1] * q[0] + m[3] * q[1] + m[5]]
    const parent: number | undefined = layer.parent
    layer = parent === undefined ? undefined : layers.find((l) => l.ind === parent)
  }
  return q
}

const SAMPLES = [
  [0, 0],
  [40, -25],
  [-13, 70],
]

/**
 * World positions of sample points of the named layer at the given frames. Evaluated on a copy:
 * the evaluator caches spatial curves per keyframe object, and these tests mutate in place.
 */
function footprint(anim: Animation, name: string, frames: number[]): number[][] {
  const layers = structuredClone(anim.layers)
  const index = layers.findIndex((l) => l.nm === name)
  return frames.flatMap((f) => SAMPLES.map((pt) => worldPoint(layers, index, f, pt)))
}

function expectClose(a: number[][], b: number[][], digits = 2): void {
  expect(a.length).toBe(b.length)
  a.forEach((pa, i) => pa.forEach((v, d) => expect(v).toBeCloseTo(b[i][d], digits)))
}

const kf = (t: number, s: number[], extra: Record<string, unknown> = {}) => ({
  t,
  s,
  o: { x: [0.33], y: [0] },
  i: { x: [0.67], y: [1] },
  ...extra,
})

/** Child with animated position (spatial tangents), rotation and non-uniform scale. */
function animatedChild(parent: number): Layer {
  return nullLayer(1, 'child', {
    parent,
    ks: {
      p: {
        a: 1,
        k: [kf(0, [10, 20, 0], { to: [15, 0, 0], ti: [-5, -10, 0] }), { t: 30, s: [60, 90, 0] }],
      },
      a: { a: 0, k: [5, 5, 0] },
      r: { a: 1, k: [kf(0, [0]), { t: 30, s: [45] }] },
      s: { a: 1, k: [kf(0, [100, 50, 100]), { t: 30, s: [150, 120, 100] }] },
    },
  })
}

describe('deleteLayers keeps children in place', () => {
  const FRAMES = [0, 7.5, 15, 30]

  it('folds a static parent (move, rotate, uniform scale, anchor) into its children', () => {
    const anim = doc([
      animatedChild(2),
      nullLayer(2, 'parent', {
        ks: {
          p: { a: 0, k: [200, 150, 0] },
          a: { a: 0, k: [30, -10, 0] },
          r: { a: 0, k: 30 },
          s: { a: 0, k: [80, 80, 100] },
        },
      }),
    ])
    const before = footprint(anim, 'child', FRAMES)
    deleteLayers(anim, [['layers', 1]])
    expect(anim.layers[0].parent).toBeUndefined()
    expectClose(footprint(anim, 'child', FRAMES), before)
  })

  it('moves children up to the nearest remaining ancestor and keeps its animation', () => {
    const anim = doc([
      animatedChild(2),
      nullLayer(2, 'middle', {
        parent: 3,
        ks: { p: { a: 0, k: [50, 0, 0] }, r: { a: 0, k: -90 }, s: { a: 0, k: [200, 200, 100] } },
      }),
      nullLayer(3, 'root', {
        ks: {
          p: { a: 1, k: [kf(0, [0, 0, 0]), { t: 30, s: [100, 40, 0] }] },
          r: { a: 1, k: [kf(0, [0]), { t: 30, s: [180] }] },
        },
      }),
    ])
    const before = footprint(anim, 'child', FRAMES)
    deleteLayers(anim, [['layers', 1]])
    expect(anim.layers[0].parent).toBe(3)
    // Exact at every frame: the animated grandparent still drives the child.
    expectClose(footprint(anim, 'child', FRAMES), before)
  })

  it('folds several deleted generations at once', () => {
    const anim = doc([
      animatedChild(2),
      nullLayer(2, 'a', { parent: 3, ks: { p: { a: 0, k: [10, 10, 0] }, r: { a: 0, k: 15 } } }),
      nullLayer(3, 'b', {
        parent: 4,
        ks: { p: { a: 0, k: [-40, 5, 0] }, s: { a: 0, k: [50, 50] } },
      }),
      nullLayer(4, 'c', { ks: { p: { a: 0, k: [100, 100, 0] } } }),
    ])
    const before = footprint(anim, 'child', FRAMES)
    deleteLayers(anim, sel(1, 2))
    expect(anim.layers.map((l) => l.nm)).toEqual(['child', 'c'])
    expect(anim.layers[0].parent).toBe(4)
    expectClose(footprint(anim, 'child', FRAMES), before)
  })

  it('freezes an animated deleted parent at the given frame', () => {
    const anim = doc([
      animatedChild(2),
      nullLayer(2, 'parent', {
        ks: { p: { a: 1, k: [kf(0, [0, 0, 0]), { t: 30, s: [300, 0, 0] }] } },
      }),
    ])
    const at15 = footprint(anim, 'child', [15])
    deleteLayers(anim, [['layers', 1]], { frameOf: () => 15 })
    expectClose(footprint(anim, 'child', [15]), at15)
  })

  it('handles mirrored parents (negative uniform scale)', () => {
    const anim = doc([
      animatedChild(2),
      nullLayer(2, 'parent', {
        ks: { p: { a: 0, k: [120, 80, 0] }, s: { a: 0, k: [-100, -100, 100] } },
      }),
    ])
    const before = footprint(anim, 'child', FRAMES)
    deleteLayers(anim, [['layers', 1]])
    expectClose(footprint(anim, 'child', FRAMES), before)
  })

  it('keeps legacy keyframes (end values) and separated dimensions consistent', () => {
    const anim = doc([
      nullLayer(1, 'legacy', {
        parent: 3,
        ks: { p: { a: 1, k: [{ t: 0, s: [0, 0, 0], e: [100, 0, 0] }, { t: 30 }] } },
      }),
      nullLayer(2, 'split', {
        parent: 3,
        ks: {
          p: { s: true, x: { a: 1, k: [kf(0, [0]), { t: 30, s: [80] }] }, y: { a: 0, k: 10 } },
        },
      }),
      nullLayer(3, 'parent', { ks: { p: { a: 0, k: [7, 9, 0] }, s: { a: 0, k: [50, 50, 100] } } }),
    ])
    const legacy = footprint(anim, 'legacy', [0, 15, 29])
    const split = footprint(anim, 'split', [0, 15, 30])
    deleteLayers(anim, [['layers', 2]])
    expectClose(footprint(anim, 'split', [0, 15, 30]), split)
    // Legacy segments interpolate towards `e`: both ends were mapped.
    const p = anim.layers[0].ks.p as { k: Array<{ s?: number[]; e?: number[] }> }
    expect(p.k[0].s).toEqual([7, 9, 0])
    expect(p.k[0].e).toEqual([57, 9, 0])
    expectClose(footprint(anim, 'legacy', [0, 15, 29]), legacy)
  })

  it('leaves children alone when the parent cannot be folded', () => {
    const skewed = nullLayer(2, 'skewed', {
      ks: { p: { a: 0, k: [10, 10, 0] }, s: { a: 0, k: [100, 50, 100] } },
    })
    const anim = doc([animatedChild(2), skewed])
    const child = structuredClone(anim.layers[0])
    deleteLayers(anim, [['layers', 1]])
    expect(anim.layers[0].ks).toEqual(child.ks)
    expect(anim.layers[0].parent).toBeUndefined()
  })

  it('does not fold animated separated dimensions under a rotation', () => {
    const anim = doc([
      nullLayer(1, 'split', {
        parent: 2,
        ks: {
          p: { s: true, x: { a: 1, k: [kf(0, [0]), { t: 30, s: [80] }] }, y: { a: 0, k: 10 } },
        },
      }),
      nullLayer(2, 'parent', { ks: { r: { a: 0, k: 45 } } }),
    ])
    const ks = structuredClone(anim.layers[0].ks)
    deleteLayers(anim, [['layers', 1]])
    expect(anim.layers[0].ks).toEqual(ks)
  })

  it('does not rotate auto-oriented children that move (their path turns instead)', () => {
    const anim = doc([
      nullLayer(1, 'car', {
        parent: 2,
        ao: 1,
        ks: { p: { a: 1, k: [kf(0, [0, 0, 0]), { t: 30, s: [100, 0, 0] }] }, r: { a: 0, k: 5 } },
      }),
      nullLayer(2, 'parent', { ks: { r: { a: 0, k: 90 } } }),
    ])
    deleteLayers(anim, [['layers', 1]])
    const ks = anim.layers[0].ks
    expect(ks.r).toEqual({ a: 0, k: 5 })
    expect((ks.p as { k: Array<{ s: number[] }> }).k[1].s).toEqual([0, 100, 0])
  })

  it('can simply unlink children', () => {
    const anim = doc([
      animatedChild(2),
      nullLayer(2, 'parent', { parent: 3, ks: { p: { a: 0, k: [50, 50, 0] } } }),
      nullLayer(3, 'root'),
    ])
    const ks = structuredClone(anim.layers[0].ks)
    deleteLayers(anim, [['layers', 1]], { keepChildrenInPlace: false })
    expect(anim.layers[0].ks).toEqual(ks)
    expect(anim.layers[0].parent).toBeUndefined()
  })

  it('works on frozen drafts and produces no patches for unrelated layers', () => {
    const base = freeze(
      doc([
        nullLayer(1, 'other'),
        animatedChild(3),
        nullLayer(3, 'parent', { ks: { p: { a: 0, k: [1, 2, 0] } } }),
      ]),
      true,
    )
    const [next, patches] = produceWithPatches(base, (d) => {
      deleteLayers(d as Animation, [['layers', 2]])
    })
    expect(next.layers[0]).toBe(base.layers[0])
    expect(patches.every((p) => p.path[1] !== 0)).toBe(true)
  })
})

/* -------------------------------- Reordering ------------------------------- */

const five = () => doc(['A', 'B', 'C', 'D', 'E'].map((n, i) => nullLayer(i + 1, n)))
const six = () => doc(['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => nullLayer(i + 1, n)))
const sel = (...i: number[]) => i.map((n) => ['layers', n] as NodePath)
const chain = () =>
  doc([
    nullLayer(1, 'A', { parent: 2 }),
    nullLayer(2, 'B', { parent: 3 }),
    nullLayer(3, 'C'),
    nullLayer(4, 'D'),
  ])

describe('moveLayers', () => {
  it('moves layers to an insertion index and returns their new paths', () => {
    const anim = five()
    expect(moveLayers(anim, ['layers'], [0], 3)).toEqual([['layers', 2]])
    expect(names(anim.layers)).toEqual(['B', 'C', 'A', 'D', 'E'])
    const anim2 = five()
    expect(moveLayers(anim2, ['layers'], [1, 3], 0)).toEqual([
      ['layers', 0],
      ['layers', 1],
    ])
    expect(names(anim2.layers)).toEqual(['B', 'D', 'A', 'C', 'E'])
    const anim3 = five()
    moveLayers(anim3, ['layers'], [0], 5)
    expect(names(anim3.layers)).toEqual(['B', 'C', 'D', 'E', 'A'])
  })

  it('moves matte pairs as a unit and never splits a pair', () => {
    const anim = doc([
      nullLayer(1, 'A'),
      nullLayer(2, 'matte', { td: 1 }),
      nullLayer(3, 'art', { tt: 1 }),
      nullLayer(4, 'D'),
    ])
    moveLayers(anim, ['layers'], [2], 4)
    expect(names(anim.layers)).toEqual(['A', 'D', 'matte', 'art'])
    const anim2 = doc([
      nullLayer(1, 'matte', { td: 1 }),
      nullLayer(2, 'art', { tt: 1 }),
      nullLayer(3, 'C'),
    ])
    moveLayers(anim2, ['layers'], [2], 1)
    expect(names(anim2.layers)).toEqual(['C', 'matte', 'art'])
  })

  it('produces no patches for a no-op move', () => {
    const base = freeze(five(), true)
    const [, patches] = produceWithPatches(base, (d) => {
      moveLayers(d as Animation, ['layers'], [1], 1)
    })
    expect(patches).toEqual([])
  })
})

describe('arrangeLayers', () => {
  it('brings to front / sends to back keeping relative order', () => {
    const a = six()
    expect(arrangeLayers(a, sel(2, 4), 'front')).toEqual(sel(0, 1))
    expect(names(a.layers)).toEqual(['C', 'E', 'A', 'B', 'D', 'F'])
    const b = six()
    expect(arrangeLayers(b, sel(0, 2), 'back')).toEqual(sel(4, 5))
    expect(names(b.layers)).toEqual(['B', 'D', 'E', 'F', 'A', 'C'])
  })

  it('moves forward / backward by one position', () => {
    const a = six()
    expect(arrangeLayers(a, sel(2, 3), 'forward')).toEqual(sel(1, 2))
    expect(names(a.layers)).toEqual(['A', 'C', 'D', 'B', 'E', 'F'])
    const b = six()
    arrangeLayers(b, sel(0, 1), 'forward')
    expect(names(b.layers)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    const c = six()
    expect(arrangeLayers(c, sel(1, 4), 'backward')).toEqual(sel(2, 5))
    expect(names(c.layers)).toEqual(['A', 'C', 'B', 'D', 'F', 'E'])
  })

  it('treats matte pairs as one unit', () => {
    const anim = doc([
      nullLayer(1, 'A'),
      nullLayer(2, 'matte', { td: 1 }),
      nullLayer(3, 'art', { tt: 1 }),
    ])
    arrangeLayers(anim, [['layers', 2]], 'forward')
    expect(names(anim.layers)).toEqual(['matte', 'art', 'A'])
    arrangeLayers(anim, [['layers', 1]], 'back')
    expect(names(anim.layers)).toEqual(['A', 'matte', 'art'])
  })
})

describe('insertLayers', () => {
  it('never inserts between a matte source and its target', () => {
    const anim = doc([nullLayer(1, 'matte', { td: 1 }), nullLayer(2, 'art', { tt: 1 })])
    expect(insertLayers(anim, ['layers'], [nullLayer(3, 'new')], 1)).toEqual([['layers', 0]])
    expect(names(anim.layers)).toEqual(['new', 'matte', 'art'])
  })
})

/* -------------------------------- Parenting -------------------------------- */

describe('setParent', () => {
  it('rejects self, unknown parents and cycles', () => {
    const { layers } = chain()
    expect(canSetParent(layers, 2, 3)).toBe(false)
    expect(canSetParent(layers, 2, 1)).toBe(false)
    expect(canSetParent(layers, 2, 99)).toBe(false)
    expect(canSetParent(layers, 2, 4)).toBe(true)
    expect(canSetParent(layers, 0, null)).toBe(true)
  })

  it('sets and clears parents', () => {
    const anim = chain()
    expect(setParent(anim, ['layers', 3], 3)).toBe(true)
    expect(anim.layers[3].parent).toBe(3)
    expect(setParent(anim, ['layers', 3], 3)).toBe(false)
    expect(setParent(anim, ['layers', 2], 1)).toBe(false)
    expect(setParent(anim, ['layers', 0], null)).toBe(true)
    expect(anim.layers[0].parent).toBeUndefined()
    expect(setParent(anim, ['layers', 0], null)).toBe(false)
  })
})

/** child (animated), two static parents with different spaces, one animated parent. */
const reparentScene = () =>
  doc([
    animatedChild(2),
    nullLayer(2, 'p1', {
      ks: {
        p: { a: 0, k: [200, 150, 0] },
        a: { a: 0, k: [30, -10, 0] },
        r: { a: 0, k: 30 },
        s: { a: 0, k: [80, 80, 100] },
      },
    }),
    nullLayer(3, 'p2', {
      parent: 2,
      ks: { p: { a: 0, k: [-40, 60, 0] }, r: { a: 0, k: -75 }, s: { a: 0, k: [-150, -150, 100] } },
    }),
    nullLayer(4, 'moving', {
      ks: {
        p: { a: 1, k: [kf(0, [0, 0, 0]), { t: 30, s: [300, 50, 0] }] },
        r: { a: 1, k: [kf(0, [0]), { t: 30, s: [90] }] },
      },
    }),
    nullLayer(5, 'skewed', { ks: { p: { a: 0, k: [10, 10, 0] }, s: { a: 0, k: [100, 50, 100] } } }),
  ])

describe('setParent keeps the layer in place', () => {
  const FRAMES = [0, 7.5, 15, 30]

  it('moves between static parents without moving on screen (any frame)', () => {
    const anim = reparentScene()
    const before = footprint(anim, 'child', FRAMES)
    expect(setParent(anim, ['layers', 0], 3, { keepInPlace: true })).toBe(true)
    expect(anim.layers[0].parent).toBe(3)
    expectClose(footprint(anim, 'child', FRAMES), before)
  })

  it('unparents and parents again in place', () => {
    const anim = reparentScene()
    const before = footprint(anim, 'child', FRAMES)
    setParent(anim, ['layers', 0], null, { keepInPlace: true })
    expect(anim.layers[0].parent).toBeUndefined()
    expectClose(footprint(anim, 'child', FRAMES), before)
    setParent(anim, ['layers', 0], 2, { keepInPlace: true })
    expectClose(footprint(anim, 'child', FRAMES), before)
    // Back where it started, up to rounding.
    expect(evaluatePosition(anim.layers[0].ks.p, 0)[0]).toBeCloseTo(10, 2)
  })

  it('matches an animated parent at the given frame', () => {
    const anim = reparentScene()
    const at15 = footprint(anim, 'child', [15])
    setParent(anim, ['layers', 0], 4, { keepInPlace: true, frame: 15 })
    expect(anim.layers[0].parent).toBe(4)
    expectClose(footprint(anim, 'child', [15]), at15)
  })

  it('falls back to a plain link when a parent space cannot be folded', () => {
    const anim = reparentScene()
    const p = structuredClone(anim.layers[0].ks.p)
    expect(setParent(anim, ['layers', 0], 5, { keepInPlace: true })).toBe(true)
    expect(anim.layers[0].parent).toBe(5)
    expect(anim.layers[0].ks.p).toEqual(p)
  })

  it('only links by default', () => {
    const anim = reparentScene()
    const p = structuredClone(anim.layers[0].ks.p)
    setParent(anim, ['layers', 0], 3)
    expect(anim.layers[0].ks.p).toEqual(p)
  })

  it('works on frozen drafts', () => {
    const base = freeze(reparentScene(), true)
    const before = footprint(base, 'child', FRAMES)
    const next = produce(base, (d) => {
      setParent(d as Animation, ['layers', 0], 3, { keepInPlace: true })
    })
    expect(next.layers[1]).toBe(base.layers[1])
    expectClose(footprint(next, 'child', FRAMES), before)
  })
})

/* ---------------------------- Rename / visibility --------------------------- */

describe('renameNode / setHidden', () => {
  it('renames layers and shapes, rejecting empty names', () => {
    const anim = doc([shapeLayer(1, 'L', [box('G')])])
    expect(renameNode(anim, ['layers', 0], '  New  ')).toBe(true)
    expect(anim.layers[0].nm).toBe('New')
    expect(renameNode(anim, ['layers', 0, 'shapes', 0], 'Group')).toBe(true)
    expect(shapesOf(anim)[0].nm).toBe('Group')
    expect(renameNode(anim, ['layers', 0], '   ')).toBe(false)
    expect(renameNode(anim, ['layers', 7], 'x')).toBe(false)
  })

  it('hides and shows with the conventional hd forms', () => {
    const anim = doc([shapeLayer(1, 'L', [box('G')])])
    const layer: NodePath = ['layers', 0]
    const group: NodePath = ['layers', 0, 'shapes', 0]
    const tr: NodePath = ['layers', 0, 'shapes', 0, 'it', 2]
    expect(setHidden(anim, [layer, group, tr], true)).toBe(2)
    expect(anim.layers[0].hd).toBe(true)
    expect(shapesOf(anim)[0].hd).toBe(true)
    expect((shapesOf(anim)[0] as GroupShape).it[2].hd).toBeUndefined()
    expect(setHidden(anim, [layer, group], false)).toBe(2)
    expect('hd' in anim.layers[0]).toBe(false)
    expect(shapesOf(anim)[0].hd).toBe(false)
    expect(setHidden(anim, [layer], false)).toBe(0)
  })
})

/* -------------------------------- Shape items ------------------------------- */

describe('shape items', () => {
  it('duplicates items above their originals and never the group transform', () => {
    const anim = doc([shapeLayer(1, 'L', [box('A'), box('B')])])
    const paths = duplicateShapes(
      anim,
      [
        ['layers', 0, 'shapes', 1],
        ['layers', 0, 'shapes', 0, 'it', 2],
      ],
      { suffix: ' copy' },
    )
    expect(shapesOf(anim).map((s) => s.nm)).toEqual(['A', 'B copy', 'B'])
    expect(paths).toEqual([['layers', 0, 'shapes', 1]])
    expect(shapesOf(anim)[1]).not.toBe(shapesOf(anim)[2])
    expect((shapesOf(anim)[1] as GroupShape).it[0]).not.toBe(
      (shapesOf(anim)[2] as GroupShape).it[0],
    )
  })

  it('duplicates in nested and outer arrays at once, returning correct paths', () => {
    const anim = doc([shapeLayer(1, 'L', [box('A'), box('B')])])
    const paths = duplicateShapes(anim, [
      ['layers', 0, 'shapes', 0],
      ['layers', 0, 'shapes', 1, 'it', 1],
    ])
    expect(shapesOf(anim).map((s) => s.nm)).toEqual(['A copy', 'A', 'B'])
    const b = shapesOf(anim)[2] as GroupShape
    expect(tys(b.it)).toEqual(['rc', 'fl', 'fl', 'tr'])
    expect(b.np).toBe(3)
    expect(paths).toEqual([
      ['layers', 0, 'shapes', 0],
      ['layers', 0, 'shapes', 2, 'it', 1],
    ])
  })

  it('deletes items (never transforms), nested selections included', () => {
    const anim = doc([shapeLayer(1, 'L', [box('A'), box('B')])])
    const removed = deleteShapes(anim, [
      ['layers', 0, 'shapes', 0, 'it', 1],
      ['layers', 0, 'shapes', 0],
      ['layers', 0, 'shapes', 1, 'it', 2],
      ['layers', 0, 'shapes', 1, 'it', 0],
    ])
    expect(removed).toEqual([
      ['layers', 0, 'shapes', 0],
      ['layers', 0, 'shapes', 1, 'it', 0],
    ])
    expect(shapesOf(anim).map((s) => s.nm)).toEqual(['B'])
    expect(tys((shapesOf(anim)[0] as GroupShape).it)).toEqual(['fl', 'tr'])
    expect((shapesOf(anim)[0] as GroupShape).np).toBe(1)
  })

  it('reorders items within an array, keeping the transform last', () => {
    const anim = doc([shapeLayer(1, 'L', [box('A')])])
    const group: NodePath = ['layers', 0, 'shapes', 0]
    const out = moveShapes(anim, [[...group, 'it', 0]], [...group, 'it'], 3)
    expect(tys((shapesOf(anim)[0] as GroupShape).it)).toEqual(['fl', 'rc', 'tr'])
    expect(out).toEqual([[...group, 'it', 1]])
  })

  it('moves items into and out of groups', () => {
    const anim = doc([
      shapeLayer(1, 'L', [createRectShape({ w: 1, h: 1, name: 'loose' }), box('G')]),
    ])
    // into the group (which shifts up once the loose item leaves)
    const into = moveShapes(anim, [['layers', 0, 'shapes', 0]], ['layers', 0, 'shapes', 1, 'it'], 0)
    expect(into).toEqual([['layers', 0, 'shapes', 0, 'it', 0]])
    expect(tys((shapesOf(anim)[0] as GroupShape).it)).toEqual(['rc', 'rc', 'fl', 'tr'])
    expect((shapesOf(anim)[0] as GroupShape).np).toBe(3)
    // back out, below the group
    const out = moveShapes(anim, [['layers', 0, 'shapes', 0, 'it', 0]], ['layers', 0, 'shapes'], 1)
    expect(out).toEqual([['layers', 0, 'shapes', 1]])
    expect(shapesOf(anim)[1].nm).toBe('loose')
  })

  it('refuses to move a group into itself or across layers', () => {
    const anim = doc([shapeLayer(1, 'L', [box('A')]), shapeLayer(2, 'M', [box('B')])])
    expect(canMoveShapes([['layers', 0, 'shapes', 0]], ['layers', 0, 'shapes', 0, 'it'])).toBe(
      false,
    )
    expect(canMoveShapes([['layers', 0, 'shapes', 0]], ['layers', 1, 'shapes'])).toBe(false)
    expect(canMoveShapes([['layers', 0, 'shapes', 0]], ['layers', 0, 'shapes'])).toBe(true)
    expect(
      moveShapes(anim, [['layers', 0, 'shapes', 0]], ['layers', 0, 'shapes', 0, 'it'], 0),
    ).toEqual([])
    expect(shapesOf(anim).map((s) => s.nm)).toEqual(['A'])
  })

  it('arranges items but never moves the transform', () => {
    const anim = doc([shapeLayer(1, 'L', [box('G')])])
    const g: NodePath = ['layers', 0, 'shapes', 0]
    expect(arrangeShapes(anim, [[...g, 'it', 1]], 'front')).toEqual([[...g, 'it', 0]])
    expect(tys((shapesOf(anim)[0] as GroupShape).it)).toEqual(['fl', 'rc', 'tr'])
    arrangeShapes(anim, [[...g, 'it', 0]], 'back')
    expect(tys((shapesOf(anim)[0] as GroupShape).it)).toEqual(['rc', 'fl', 'tr'])
  })

  it('groups items of one array into a group with an identity transform', () => {
    const anim = doc([shapeLayer(1, 'L', [box('A'), box('B'), box('C')])])
    const path = groupShapes(
      anim,
      [
        ['layers', 0, 'shapes', 2],
        ['layers', 0, 'shapes', 1],
      ],
      { name: 'Group 1' },
    )
    expect(path).toEqual(['layers', 0, 'shapes', 1])
    const group = shapesOf(anim)[1] as GroupShape
    expect(group.nm).toBe('Group 1')
    expect(group.it.map((i) => i.nm ?? i.ty)).toEqual(['B', 'C', 'Transform'])
    expect(isIdentityGroupTransform(group.it[2] as never)).toBe(true)
    expect(group.np).toBe(2)
    expect(
      groupShapes(anim, [
        ['layers', 0, 'shapes', 0],
        ['layers', 0, 'shapes', 1, 'it', 0],
      ]),
    ).toBeNull()
  })

  it('ungroups only when that keeps the rendering', () => {
    const plain = createGroupShape({ name: 'plain', items: [createRectShape({ w: 1, h: 1 })] })
    const styled = box('styled')
    const moved = box('moved')
    ;(moved.it[2] as { p: unknown }).p = { a: 0, k: [5, 0] }
    const anim = doc([shapeLayer(1, 'L', [plain, styled, moved])])
    expect(ungroupBlocker(anim, ['layers', 0, 'shapes', 0])).toBeNull()
    expect(ungroupBlocker(anim, ['layers', 0, 'shapes', 1])).toBe('styles')
    expect(ungroupBlocker(anim, ['layers', 0, 'shapes', 2])).toBe('transform')
    expect(ungroupBlocker(anim, ['layers', 0])).toBe('not-group')

    const out = ungroupShapes(anim, [
      ['layers', 0, 'shapes', 0],
      ['layers', 0, 'shapes', 1],
    ])
    expect(out).toEqual([['layers', 0, 'shapes', 0]])
    expect(tys(shapesOf(anim))).toEqual(['rc', 'gr', 'gr'])
  })

  it('ungroups a styled group when nothing above it could be affected, keeping hidden state', () => {
    const g = box('top')
    g.hd = true
    const anim = doc([shapeLayer(1, 'L', [g, box('below')])])
    expect(ungroupBlocker(anim, ['layers', 0, 'shapes', 0])).toBeNull()
    const out = ungroupShapes(anim, [['layers', 0, 'shapes', 0]])
    expect(out).toEqual([
      ['layers', 0, 'shapes', 0],
      ['layers', 0, 'shapes', 1],
    ])
    expect(tys(shapesOf(anim))).toEqual(['rc', 'fl', 'gr'])
    expect(
      shapesOf(anim)
        .slice(0, 2)
        .every((s) => s.hd === true),
    ).toBe(true)
  })

  it('treats animated or skewed transforms as non-identity', () => {
    expect(isIdentityGroupTransform(undefined)).toBe(true)
    expect(
      isIdentityGroupTransform({ ty: 'tr', p: { a: 0, k: [3, 4] }, a: { a: 0, k: [3, 4] } }),
    ).toBe(true)
    expect(isIdentityGroupTransform({ ty: 'tr', o: { a: 0, k: 50 } })).toBe(false)
    expect(isIdentityGroupTransform({ ty: 'tr', sk: { a: 0, k: 10 } })).toBe(false)
    expect(
      isIdentityGroupTransform({
        ty: 'tr',
        r: {
          a: 1,
          k: [
            { t: 0, s: [0] },
            { t: 10, s: [0] },
          ],
        },
      }),
    ).toBe(false)
  })

  it('adds new items at conventional positions', () => {
    const items: ShapeItem[] = [
      createRectShape({ w: 1, h: 1 }),
      createFillShape({ color: '#fff' }),
      { ty: 'tr' },
    ]
    expect(shapeInsertIndex(items, 'el')).toBe(0)
    expect(shapeInsertIndex(items, 'st')).toBe(1)
    expect(shapeInsertIndex(items, 'fl')).toBe(2)
    expect(shapeInsertIndex(items, 'tm')).toBe(2)
    expect(shapeInsertIndex([createRectShape({ w: 1, h: 1 })], 'st')).toBe(1)

    const anim = doc([shapeLayer(1, 'L', [box('G')]), nullLayer(2)])
    expect(
      addShapeItem(anim, ['layers', 0, 'shapes', 0], createStrokeShape({ color: '#000' })),
    ).toEqual(['layers', 0, 'shapes', 0, 'it', 1])
    expect(addShapeItem(anim, ['layers', 0], createTrimPathsShape())).toEqual([
      'layers',
      0,
      'shapes',
      1,
    ])
    expect(tys((shapesOf(anim)[0] as GroupShape).it)).toEqual(['rc', 'st', 'fl', 'tr'])
    expect((shapesOf(anim)[0] as GroupShape).np).toBe(3)
    expect(addShapeItem(anim, ['layers', 1], createTrimPathsShape())).toBeNull()
  })
})

/* -------------------------------- Clipboard -------------------------------- */

describe('copy / paste', () => {
  const imageAsset = {
    id: 'image_0',
    w: 10,
    h: 10,
    u: '',
    p: 'data:image/png;base64,AAAA',
    e: 1 as const,
  }

  function source(): Animation {
    const text: TextLayer = {
      ty: 5,
      ind: 1,
      nm: 'Title',
      ip: 0,
      op: 60,
      st: 0,
      ks: {},
      t: { d: { k: [{ t: 0, s: { t: 'Hi', s: 20, f: 'Font-A' } }] } },
    }
    return doc(
      [
        nullLayer(1, 'ctrl'),
        precompLayer(2, 'comp_outer', 'Outer'),
        {
          ty: 2,
          ind: 3,
          nm: 'Pic',
          refId: 'image_0',
          ip: 0,
          op: 60,
          st: 0,
          ks: {},
          parent: 1,
        } as Layer,
      ],
      {
        assets: [
          imageAsset,
          { id: 'comp_inner', layers: [text] },
          { id: 'comp_outer', layers: [precompLayer(1, 'comp_inner', 'Inner')] },
          { id: 'unused', layers: [nullLayer(1)] },
        ],
        fonts: {
          list: [
            { fName: 'Font-A', fFamily: 'A' },
            { fName: 'Font-B', fFamily: 'B' },
          ],
        },
      },
    )
  }

  it('serializes layers with referenced assets (recursively) and fonts', () => {
    const payload = serializeLayers(
      source(),
      [
        ['layers', 1],
        ['layers', 2],
      ],
      { docId: 'doc_1' },
    )!
    expect(JSON.stringify(payload)).toContain('"__lottieEditor":"layers"')
    expect(payload.kind).toBe('layers')
    expect(payload.sourceComp).toBeNull()
    expect(payload.sourceDoc).toBe('doc_1')
    expect(names(payload.layers!)).toEqual(['Outer', 'Pic'])
    expect(payload.assets!.map((a) => a.id)).toEqual(['image_0', 'comp_inner', 'comp_outer'])
    expect(payload.fonts!.map((f) => f.fName)).toEqual(['Font-A'])
    // A JSON round trip (system clipboard) is lossless.
    expect(parseLayersClipboard(JSON.parse(JSON.stringify(payload)))).toEqual(payload)
  })

  it('includes matte partners when copying', () => {
    const anim = doc([
      nullLayer(1, 'matte', { td: 1 }),
      nullLayer(2, 'art', { tt: 1 }),
      nullLayer(3, 'x'),
    ])
    expect(names(serializeLayers(anim, [['layers', 1]])!.layers!)).toEqual(['matte', 'art'])
    const tp = doc([
      nullLayer(1, 'matte', { td: 1 }),
      nullLayer(2, 'x'),
      nullLayer(3, 'art', { tt: 1, tp: 1 }),
    ])
    expect(names(serializeLayers(tp, [['layers', 2]])!.layers!)).toEqual(['matte', 'art'])
  })

  it('pastes into another document: new inds, remapped refs, merged assets and fonts', () => {
    const payload = serializeLayers(source(), [
      ['layers', 0],
      ['layers', 1],
      ['layers', 2],
    ])!
    const target = doc([nullLayer(1, 'existing')], {
      assets: [{ id: 'comp_outer', layers: [nullLayer(1, 'different')] }],
    })
    const paths = pasteLayers(target, ['layers'], payload, 0)
    expect(paths).toEqual([
      ['layers', 0],
      ['layers', 1],
      ['layers', 2],
    ])
    expect(names(target.layers)).toEqual(['ctrl', 'Outer', 'Pic', 'existing'])
    expect(inds(target.layers)).toEqual([2, 3, 4, 1])
    // parent remapped to the pasted "ctrl"
    expect(target.layers[2].parent).toBe(2)
    // conflicting id renamed, nested reference remapped
    const ids = target.assets!.map((a) => a.id)
    expect(ids).toEqual(['comp_outer', 'image_0', 'comp_inner', 'comp_outer_1'])
    expect((target.layers[1] as PrecompLayer).refId).toBe('comp_outer_1')
    const outer = target.assets![3] as { layers: PrecompLayer[] }
    expect(outer.layers[0].refId).toBe('comp_inner')
    expect(target.fonts!.list.map((f) => f.fName)).toEqual(['Font-A'])
  })

  it('reuses identical assets and never aliases pasted data', () => {
    const src = source()
    const payload = serializeLayers(src, [['layers', 1]])!
    const first = pasteLayers(src, ['layers'], payload, 0, { keepOutsideLinks: true })
    const second = pasteLayers(src, ['layers'], payload, 0, { keepOutsideLinks: true })
    expect(first).toEqual([['layers', 0]])
    expect(second).toEqual([['layers', 0]])
    expect(src.assets!.length).toBe(4)
    expect((src.layers[0] as PrecompLayer).refId).toBe('comp_outer')
    expect(src.layers[0]).not.toBe(src.layers[1])
    expect(src.layers[0].ks).not.toBe(payload.layers![0].ks)
    expect(new Set(inds(src.layers)).size).toBe(src.layers.length)
  })

  it('keeps outside parents only when pasting back into the source composition', () => {
    const src = source()
    const payload = serializeLayers(src, [['layers', 2]])!
    const same = structuredClone(src)
    pasteLayers(same, ['layers'], payload, 0, { keepOutsideLinks: true })
    expect(same.layers[0].parent).toBe(1)
    const other = structuredClone(src)
    pasteLayers(other, ['layers'], payload, 0)
    expect(other.layers[0].parent).toBeUndefined()
  })

  it('keeps pasted matte pairs working and drops orphaned mattes', () => {
    const anim = doc([nullLayer(1, 'matte', { td: 1 }), nullLayer(7, 'art', { tt: 1, tp: 1 })])
    const payload = serializeLayers(anim, [['layers', 1]])!
    const target = doc([nullLayer(1, 'a'), nullLayer(2, 'b')])
    pasteLayers(target, ['layers'], payload, 1)
    expect(names(target.layers)).toEqual(['a', 'matte', 'art', 'b'])
    expect(target.layers[2].tp).toBe(target.layers[1].ind)
    expect(matteSourceIndex(target.layers, 2)).toBe(1)

    const orphan = parseLayersClipboard({
      __lottieEditor: 'layers',
      kind: 'layers',
      layers: [nullLayer(1, 'o', { tt: 1 })],
    })!
    const t2 = doc([nullLayer(1, 'a')])
    pasteLayers(t2, ['layers'], orphan, 1)
    expect(t2.layers[1].tt).toBeUndefined()
  })

  it('does not adopt glyph data into documents that render text with fonts', () => {
    const payload = parseLayersClipboard({
      __lottieEditor: 'layers',
      layers: [nullLayer(1)],
      fonts: [{ fName: 'G', fFamily: 'G' }],
      chars: [{ ch: 'a', fFamily: 'G', style: 'Regular', size: 10 }],
    })!
    const withText = doc([
      { ty: 5, ind: 1, ip: 0, op: 1, st: 0, ks: {}, t: { d: { k: [] } } } as Layer,
    ])
    pasteLayers(withText, ['layers'], payload, 0)
    expect(withText.chars).toBeUndefined()
    const empty = doc([])
    pasteLayers(empty, ['layers'], payload, 0)
    expect(empty.chars).toHaveLength(1)
  })

  it('validates untrusted clipboard JSON', () => {
    expect(parseLayersClipboard(null)).toBeNull()
    expect(parseLayersClipboard({ __lottieEditor: 'keyframes' })).toBeNull()
    expect(parseLayersClipboard({ __lottieEditor: 'layers', layers: [{ ty: 'x' }] })).toBeNull()
    const parsed = parseLayersClipboard({
      __lottieEditor: 'layers',
      layers: [{ ty: 3, ks: {}, ip: 0, op: 10 }, { nope: true }],
      assets: [{ id: 'a', layers: [] }, { id: 5 }],
    })!
    expect(parsed.layers).toHaveLength(1)
    expect(parsed.layers![0].st).toBe(0)
    expect(parsed.assets!.map((a) => a.id)).toEqual(['a'])
    expect(
      parseLayersClipboard({ __lottieEditor: 'layers', kind: 'shapes', shapes: [{ ty: 'tr' }] }),
    ).toBeNull()
  })

  it('copies and pastes shape items before the group transform', () => {
    const anim = doc([shapeLayer(1, 'L', [box('A'), box('B')])])
    const payload = serializeShapes(anim, [
      ['layers', 0, 'shapes', 1],
      ['layers', 0, 'shapes', 1, 'it', 0],
      ['layers', 0, 'shapes', 0, 'it', 2],
    ])!
    expect(payload.kind).toBe('shapes')
    expect(payload.shapes!.map((s) => s.nm)).toEqual(['B'])
    const paths = pasteShapes(anim, ['layers', 0, 'shapes', 0, 'it'], payload.shapes!, 99)
    expect(paths).toEqual([['layers', 0, 'shapes', 0, 'it', 2]])
    const a = shapesOf(anim)[0] as GroupShape
    expect(tys(a.it)).toEqual(['rc', 'fl', 'gr', 'tr'])
    expect(a.it[2]).not.toBe(payload.shapes![0])
    expect(a.np).toBe(3)
  })
})

describe('comparePaths', () => {
  it('orders paths in document order', () => {
    const paths: NodePath[] = [
      ['layers', 10],
      ['layers', 2, 'shapes', 1],
      ['layers', 2],
      ['layers', 2, 'shapes', 0, 'it', 3],
    ]
    expect([...paths].sort(comparePaths)).toEqual([
      ['layers', 2],
      ['layers', 2, 'shapes', 0, 'it', 3],
      ['layers', 2, 'shapes', 1],
      ['layers', 10],
    ])
  })
})

/** Eased scalar keyframe. */
const scalarKey = (t: number, v: number) => ({
  t,
  s: [v],
  o: { x: [0.3], y: [0] },
  i: { x: [0.7], y: [1] },
})

describe('retimeClipboard', () => {
  const key = scalarKey
  const payload = (): Parameters<typeof retimeClipboard>[0] => ({
    __lottieEditor: 'layers',
    version: 1,
    kind: 'layers',
    fr: 30,
    layers: [
      {
        ...nullLayer(1, 'moving', {
          ip: 10,
          op: 40,
          st: 5,
          ks: { o: { a: 1, k: [key(10, 0), { t: 40, s: [100] }] } },
        }),
      },
      precompLayer(2, 'comp_a'),
    ],
    assets: [
      {
        id: 'comp_a',
        layers: [
          nullLayer(1, 'inner', {
            ip: 0,
            op: 30,
            ks: { r: { a: 1, k: [key(0, 0), { t: 30, s: [90] }] } },
          }),
        ],
      },
    ],
  })

  it('keeps durations in seconds when the frame rates differ (layers, keys, precomp content)', () => {
    const out = retimeClipboard(payload(), 60)
    expect(out.fr).toBe(60)
    const [moving, instance] = out.layers as Layer[]
    expect([moving.ip, moving.op, moving.st]).toEqual([20, 80, 10])
    const opacity = (moving.ks as { o: { k: { t: number }[] } }).o
    expect(opacity.k.map((k) => k.t)).toEqual([20, 80])
    expect([instance.ip, instance.op]).toEqual([0, 120])
    const inner = (out.assets as { layers: Layer[] }[])[0].layers[0]
    expect([inner.ip, inner.op]).toEqual([0, 60])
    expect((inner.ks as { r: { k: { t: number }[] } }).r.k.map((k) => k.t)).toEqual([0, 60])
  })

  it('returns the payload itself for the same or an unknown rate, and never mutates it', () => {
    const p = payload()
    expect(retimeClipboard(p, 30)).toBe(p)
    expect(retimeClipboard({ ...p, fr: undefined }, 60).fr).toBeUndefined()
    const before = JSON.stringify(p)
    retimeClipboard(p, 24)
    expect(JSON.stringify(p)).toBe(before)
  })

  it('retimes shape payloads (keys of copied items)', () => {
    const shapes: ShapeItem[] = [
      {
        ...createRectShape({ w: 10, h: 10 }),
        s: { a: 1, k: [key(0, 5), { t: 15, s: [20] }] },
      } as ShapeItem,
    ]
    const out = retimeClipboard(
      { __lottieEditor: 'layers', version: 1, kind: 'shapes', fr: 30, shapes },
      15,
    )
    const size = (out.shapes as unknown as { s: { k: { t: number }[] } }[])[0].s
    expect(size.k.map((k) => k.t)).toEqual([0, 7.5])
  })

  it('pastes a 30 fps copy into a 60 fps document at the same speed', () => {
    const anim = doc([nullLayer(1, 'existing')], { fr: 60, op: 120 })
    const [path] = pasteLayers(anim, ['layers'], payload(), 0)
    const pasted = anim.layers[path[1] as number]
    expect([pasted.ip, pasted.op]).toEqual([20, 80])
  })
})

describe('paste cycle guard', () => {
  it('never pastes a composition into itself (directly or through nesting)', () => {
    const anim = doc([precompLayer(1, 'outer', 'Outer')], {
      assets: [
        { id: 'inner', layers: [nullLayer(1, 'leaf')] },
        { id: 'outer', layers: [precompLayer(1, 'inner', 'Inner')] },
      ],
    })
    const payload = serializeLayers(anim, [['layers', 0]])!
    // Into "inner": Outer → inner would contain itself.
    expect(pasteLayers(anim, ['assets', 0, 'layers'], payload, 0)).toEqual([])
    // Into "outer": Outer instance inside outer.
    expect(pasteLayers(anim, ['assets', 1, 'layers'], payload, 0)).toEqual([])
    // Into the root: fine.
    expect(pasteLayers(anim, ['layers'], payload, 0)).toEqual([['layers', 0]])
    const mixed = parseLayersClipboard({
      __lottieEditor: 'layers',
      layers: [nullLayer(5, 'plain'), precompLayer(6, 'inner', 'Self')],
    })!
    expect(pasteLayers(anim, ['assets', 0, 'layers'], mixed, 0)).toEqual([
      ['assets', 0, 'layers', 0],
    ])
    expect(names((anim.assets![0] as { layers: Layer[] }).layers)).toEqual(['plain', 'leaf'])
  })
})
