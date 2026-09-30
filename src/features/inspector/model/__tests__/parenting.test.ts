import { describe, expect, it } from 'vitest'
import { applyMatrix, worldMatrix, type Matrix2D } from '@/lottie/bounds'
import type { Animation, Layer, ShapeLayer } from '@/lottie/types'
import { setParentKeepingPlace } from '../parenting'

const linear = { o: { x: 0.167, y: 0.167 }, i: { x: 0.833, y: 0.833 } }

function layer(
  ind: number,
  ks: ShapeLayer['ks'] = {},
  extra: Partial<ShapeLayer> = {},
): ShapeLayer {
  return { ty: 4, ind, nm: `L${ind}`, ip: 0, op: 60, st: 0, ks, shapes: [], ...extra }
}

function anim(layers: Layer[]): Animation {
  return { v: '5.7.0', fr: 30, ip: 0, op: 60, w: 512, h: 512, layers } as Animation
}

/** Where a few points of the layer's own space land in the composition at `frame`. */
function placement(doc: Animation, index: number, frame: number): number[] {
  const m: Matrix2D = worldMatrix(doc, ['layers', index], frame)
  return [...applyMatrix(m, 0, 0), ...applyMatrix(m, 100, 0), ...applyMatrix(m, 0, 50)]
}

function expectClose(a: number[], b: number[], digits = 2) {
  expect(a.length).toBe(b.length)
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits))
}

const rig = (): Layer[] => [
  layer(1, { p: { a: 0, k: [100, 50, 0] } }),
  // A null that moves, rotates and scales uniformly.
  layer(2, {
    p: { a: 0, k: [300, 200, 0] },
    r: { a: 0, k: 30 },
    s: { a: 0, k: [150, 150, 100] },
    a: { a: 0, k: [10, 20, 0] },
  }),
  layer(
    3,
    { p: { a: 0, k: [-40, 60, 0] }, r: { a: 0, k: -75 }, s: { a: 0, k: [50, 50, 100] } },
    { parent: 2 },
  ),
]

describe('setParentKeepingPlace', () => {
  it('keeps the layer in place when it gets a parent', () => {
    const doc = anim(rig())
    const before = placement(doc, 0, 0)
    expect(setParentKeepingPlace(doc.layers, 0, 1, 0)).toBe('kept-in-place')
    expect(doc.layers[0].parent).toBe(2)
    expectClose(placement(doc, 0, 0), before)
  })

  it('keeps the layer in place when the parent is removed or changed along a chain', () => {
    const doc = anim(rig())
    doc.layers[0].parent = 3
    const before = placement(doc, 0, 0)
    expect(setParentKeepingPlace(doc.layers, 0, 1, 0)).toBe('kept-in-place')
    expectClose(placement(doc, 0, 0), before)
    expect(setParentKeepingPlace(doc.layers, 0, null, 0)).toBe('kept-in-place')
    expect(doc.layers[0].parent).toBeUndefined()
    expectClose(placement(doc, 0, 0), before)
  })

  it('maps every position keyframe and its motion-path tangents', () => {
    const layers = rig()
    layers[0].ks = {
      p: {
        a: 1,
        k: [
          { t: 0, s: [0, 0, 0], to: [10, 0, 0], ti: [0, -10, 0], ...linear },
          { t: 30, s: [200, 100, 0] },
        ],
      },
    }
    const doc = anim(layers)
    const frames = [0, 10, 20, 30]
    const before = frames.map((f) => placement(doc, 0, f))
    expect(setParentKeepingPlace(doc.layers, 0, 1, 0)).toBe('kept-in-place')
    // Static parents: the whole motion stays where it was.
    frames.forEach((f, i) => expectClose(placement(doc, 0, f), before[i]))
  })

  it('adds the rotation and scales the child', () => {
    const doc = anim(rig())
    setParentKeepingPlace(doc.layers, 0, 1, 0)
    const ks = doc.layers[0].ks
    expect(ks.r?.k).toBeCloseTo(-30, 3)
    const scale = ks.s?.k as number[]
    expect(scale[0]).toBeCloseTo(100 / 1.5, 2)
    expect(scale[2]).toBe(100)
  })

  it('does not rotate an auto-oriented layer that moves along a path', () => {
    const layers = rig()
    layers[0].ao = 1
    layers[0].ks = {
      p: {
        a: 1,
        k: [
          { t: 0, s: [0, 0, 0], ...linear },
          { t: 30, s: [200, 0, 0] },
        ],
      },
    }
    const doc = anim(layers)
    const before = placement(doc, 0, 10)
    expect(setParentKeepingPlace(doc.layers, 0, 1, 10)).toBe('kept-in-place')
    expect(doc.layers[0].ks.r).toBeUndefined()
    expectClose(placement(doc, 0, 10), before)
  })

  it('handles separated position dimensions', () => {
    const layers = rig()
    layers[0].ks = { p: { s: true, x: { a: 0, k: 100 }, y: { a: 0, k: 50 } } }
    const doc = anim(layers)
    const before = placement(doc, 0, 0)
    expect(setParentKeepingPlace(doc.layers, 0, 1, 0)).toBe('kept-in-place')
    expectClose(placement(doc, 0, 0), before)
  })

  it('follows the parent when animated separated dimensions would need a rotation', () => {
    const layers = rig()
    layers[0].ks = {
      p: {
        s: true,
        x: {
          a: 1,
          k: [
            { t: 0, s: [0], ...linear },
            { t: 30, s: [100] },
          ],
        },
        y: { a: 0, k: 50 },
      },
    }
    const doc = anim(layers)
    expect(setParentKeepingPlace(doc.layers, 0, 1, 0)).toBe('moved')
    expect(doc.layers[0].parent).toBe(2)
  })

  it('follows the parent when the chain is not a similarity', () => {
    const layers = rig()
    layers[1].ks.s = { a: 0, k: [200, 100, 100] }
    const doc = anim(layers)
    expect(setParentKeepingPlace(doc.layers, 0, 1, 0)).toBe('moved')
    expect(doc.layers[0].parent).toBe(2)
    expect(doc.layers[0].ks.p).toEqual({ a: 0, k: [100, 50, 0] })
  })

  it('does not fold into 3D layers', () => {
    const layers = rig()
    layers[0].ddd = 1
    const doc = anim(layers)
    expect(setParentKeepingPlace(doc.layers, 0, 1, 0)).toBe('moved')
  })

  it('refuses cycles and reports unchanged parents', () => {
    const doc = anim(rig())
    // Layer 2 is the parent of layer 3: 2 cannot become a child of 3.
    expect(setParentKeepingPlace(doc.layers, 1, 2, 0)).toBe('unchanged')
    expect(doc.layers[1].parent).toBeUndefined()
    expect(setParentKeepingPlace(doc.layers, 2, 1, 0)).toBe('unchanged')
  })

  it('treats negative uniform parent scale as a half turn', () => {
    const layers = rig()
    layers[1].ks.s = { a: 0, k: [-100, -100, 100] }
    const doc = anim(layers)
    const before = placement(doc, 0, 0)
    expect(setParentKeepingPlace(doc.layers, 0, 1, 0)).toBe('kept-in-place')
    expectClose(placement(doc, 0, 0), before)
  })
})
