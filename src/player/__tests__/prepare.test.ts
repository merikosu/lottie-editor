import { describe, expect, it } from 'vitest'
import { createAnimation } from '@/lottie/document'
import type { Animation, Layer } from '@/lottie/types'
import { nodePathsFromElement, pathFromNodeClass, prepareAnimationData } from '../prepare'

function docWith(layers: Layer[], extra: Partial<Animation> = {}): Animation {
  return { ...createAnimation(), layers, ...extra }
}

const shapeLayer = (shapes: unknown[]): Layer =>
  ({ ty: 4, ind: 1, ip: 0, op: 60, st: 0, ks: {}, shapes }) as unknown as Layer

describe('prepareAnimationData', () => {
  it('returns an unfrozen deep copy without shared references', () => {
    const shared = { a: 0, k: 50 }
    const doc = Object.freeze(
      docWith([{ ty: 3, ip: 0, op: 10, st: 0, ks: { o: shared, r: shared } } as Layer]),
    )
    const out = prepareAnimationData(doc)
    expect(out).not.toBe(doc)
    expect(Object.isFrozen(out)).toBe(false)
    expect(out.layers[0].ks.o).not.toBe(out.layers[0].ks.r)
  })

  it('converts single-keyframe properties to static values', () => {
    const doc = docWith([
      { ty: 3, ip: 0, op: 10, st: 0, ks: { r: { a: 1, k: [{ t: 0, s: [45] }] } } } as Layer,
    ])
    expect(prepareAnimationData(doc).layers[0].ks.r).toEqual({ a: 0, k: 45 })
  })

  it('fixes the animated flag, scalar s values, hold flags and mixed easing arrays', () => {
    const doc = docWith([
      {
        ty: 3,
        ip: 0,
        op: 10,
        st: 0,
        ks: {
          o: {
            a: 0,
            k: [
              { t: 0, s: 0, h: true, o: { x: [0.3], y: 0 }, i: { x: 0.7, y: [1] } },
              { t: 5, s: 100, o: { x: [0.3], y: 0 }, i: { x: 0.7, y: [1] }, n: 'ease' },
              { t: 10, s: 50 },
            ],
          },
          s: { a: 1, k: [100, 100] },
        },
      } as unknown as Layer,
    ])
    const ks = prepareAnimationData(doc).layers[0].ks
    const kfs = ks.o!.k as { s: number[]; h?: number; o: { x: unknown; y: unknown }; n?: string }[]
    expect(ks.o!.a).toBe(1)
    expect(kfs[0].s).toEqual([0])
    expect(kfs[0].h).toBe(1)
    expect(kfs[1].o).toEqual({ x: [0.3], y: [0] })
    expect(kfs[1].n).toBeUndefined()
    expect(ks.s!.a).toBe(0)
  })

  it('uses scalar clamped easing for spatial keyframes and drops tangents on holds', () => {
    const doc = docWith([
      {
        ty: 3,
        ip: 0,
        op: 10,
        st: 0,
        ks: {
          p: {
            a: 1,
            k: [
              {
                t: 0,
                s: [0, 0],
                o: { x: [0.3], y: [-0.5] },
                i: { x: [0.7], y: [1.4] },
                to: [1, 1],
                ti: [0, 0],
              },
              { t: 5, s: [10, 0], h: 1, to: [1, 0], ti: [0, 0] },
              { t: 10, s: [20, 0] },
            ],
          },
        },
      } as unknown as Layer,
    ])
    const kfs = prepareAnimationData(doc).layers[0].ks.p as unknown as {
      k: { o: unknown; i: unknown; to?: unknown }[]
    }
    expect(kfs.k[0].o).toEqual({ x: 0.3, y: 0 })
    expect(kfs.k[0].i).toEqual({ x: 0.7, y: 1 })
    expect(kfs.k[1].to).toBeUndefined()
  })

  it('repairs shapes: group transforms last, hidden groups removed, required fields', () => {
    const doc = docWith([
      shapeLayer([
        {
          ty: 'gr',
          it: [
            { ty: 'tr' },
            { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] } },
            { ty: 'fl' },
          ],
        },
        { ty: 'gr', hd: true, it: [] },
        { ty: 'gr', it: [{ ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [5, 5] } }] },
      ]),
    ])
    const shapes = (
      prepareAnimationData(doc).layers[0] as {
        shapes: { ty: string; it: { ty: string; r?: unknown; o?: unknown }[] }[]
      }
    ).shapes
    expect(shapes).toHaveLength(2)
    expect(shapes[0].it.map((i) => i.ty)).toEqual(['rc', 'fl', 'tr'])
    expect(shapes[0].it[0].r).toBeDefined()
    expect(shapes[0].it[1].o).toBeDefined()
    expect(shapes[1].it.map((i) => i.ty)).toEqual(['el', 'tr'])
  })

  it('turns cameras into nulls and completes masks', () => {
    const doc = docWith([
      { ty: 13, ip: 0, op: 10, st: 0, ks: {} } as unknown as Layer,
      {
        ty: 3,
        ip: 0,
        op: 10,
        st: 0,
        ks: {},
        masksProperties: [{ pt: { a: 0, k: { i: [], o: [], v: [], c: true } } }],
      } as unknown as Layer,
    ])
    const out = prepareAnimationData(doc)
    expect(out.layers[0].ty).toBe(3)
    expect(out.layers[1].hasMask).toBe(true)
    expect(out.layers[1].masksProperties![0]).toMatchObject({
      mode: 'a',
      inv: false,
      o: { k: 100 },
      x: { k: 0 },
    })
  })

  it('replaces unresolvable external images with placeholders', () => {
    const doc = docWith([], {
      assets: [{ id: 'img', w: 20, h: 10, u: 'images/', p: 'img_0.png', e: 0 }],
    })
    const asset = prepareAnimationData(doc).assets![0] as { p: string; e: number }
    expect(asset.e).toBe(1)
    expect(asset.p.startsWith('data:image/svg+xml')).toBe(true)
  })

  it('tags layers and shape groups with their document paths', () => {
    const doc = docWith([shapeLayer([{ ty: 'gr', it: [{ ty: 'tr' }] }])])
    const out = prepareAnimationData(doc, { tagNodes: true })
    expect(out.layers[0].cl).toBe('le-n_layers_0')
    expect((out.layers[0] as { shapes: { cl?: string }[] }).shapes[0].cl).toBe(
      'le-n_layers_0_shapes_0',
    )
    expect(pathFromNodeClass('le-n_assets_2_layers_1')).toEqual(['assets', 2, 'layers', 1])
    expect(pathFromNodeClass('foo')).toBeNull()
  })

  it('converts \\n line breaks in text documents', () => {
    const doc = docWith([
      {
        ty: 5,
        ip: 0,
        op: 10,
        st: 0,
        ks: {},
        t: { d: { k: [{ t: 0, s: { t: 'a\nb', s: 10, f: 'Arial' } }] } },
      } as unknown as Layer,
    ])
    const text = (
      prepareAnimationData(doc).layers[0] as { t: { d: { k: { s: { t: string } }[] } } }
    ).t.d.k[0].s.t
    expect(text).toBe('a\rb')
  })
})

describe('nodePathsFromElement', () => {
  it('is exported', () => {
    expect(typeof nodePathsFromElement).toBe('function')
  })
})

describe('solo', () => {
  it('hides other layers of the same composition in the render copy', () => {
    const doc = docWith([
      { ty: 3, ip: 0, op: 10, st: 0, ks: {} } as Layer,
      { ty: 3, ip: 0, op: 10, st: 0, ks: {} } as Layer,
      { ty: 3, ip: 0, op: 10, st: 0, ks: {} } as Layer,
    ])
    const out = prepareAnimationData(doc, { solo: [['layers', 1]] })
    expect(out.layers.map((l) => !!l.hd)).toEqual([true, false, true])
    expect(doc.layers[0].hd).toBeUndefined()
  })
})
