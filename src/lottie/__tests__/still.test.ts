import { describe, expect, it } from 'vitest'
import testJsonText from '../../../docs/test.json?raw'
import walletJsonText from '../../../docs/wallet_flag.json?raw'
import { SAMPLES } from '../../samples'
import { createAnimation } from '../document'
import { isAnimated, isPropertyLike, type AnyProperty } from '../property'
import { autoOrientAngle, stillFrame } from '../still'
import type { Animation, Layer, PrecompAsset, PrecompLayer } from '../types'
import { isPrecompAsset } from '../types'
import { diffDeep, renderSignature } from './fixtures/render-signature'

const testDoc = () => JSON.parse(testJsonText) as Animation
const walletDoc = () => JSON.parse(walletJsonText) as Animation

/** Drawables without asset ids (a still renames the precomps it bakes). */
const drawing = (anim: Animation, f: number) =>
  renderSignature(anim, f).map((d) => ({ ...d, key: d.key.replace(/assets\/\d+/g, '') }))

/** The still draws exactly what the source draws at `frame` (asset ids aside). */
function expectSameDrawing(source: Animation, frame: number, still: Animation): void {
  const expected = drawing(source, frame)
  for (const f of [0, 0.5]) {
    const actual = drawing(still, f)
    expect(actual.length, `frame ${frame}: drawables`).toBe(expected.length)
    const diff = diffDeep(expected, actual, 1e-6)
    expect(diff, `frame ${frame} vs still at ${f}`).toBeNull()
  }
}

function animatedProperties(anim: Animation): string[] {
  const out: string[] = []
  const walk = (node: unknown, path: string) => {
    if (node === null || typeof node !== 'object') return
    if (!Array.isArray(node) && isPropertyLike(node)) {
      // Text documents always hold keyframes: one is a still.
      const text = path.endsWith('/t/d')
      if (isAnimated(node) && !(text && (node.k as unknown[]).length === 1)) out.push(path)
      return
    }
    for (const [key, child] of Object.entries(node)) walk(child, `${path}/${key}`)
  }
  walk(anim, '')
  return out
}

// Loosely typed on purpose: the same helpers build scalar, vector and position properties.
const staticProp = (k: unknown) => ({ a: 0, k }) as never

function shapeLayer(ind: number, nm: string, extra: Partial<Layer> = {}): Layer {
  return {
    ty: 4,
    ind,
    nm,
    ip: 0,
    op: 60,
    st: 0,
    ks: {
      p: staticProp([100, 100]),
      a: staticProp([0, 0]),
      s: staticProp([100, 100]),
      r: staticProp(0),
      o: staticProp(100),
    },
    shapes: [
      {
        ty: 'gr',
        nm: 'Box',
        it: [
          { ty: 'rc', p: staticProp([0, 0]), s: staticProp([40, 20]), r: staticProp(0) },
          { ty: 'fl', c: staticProp([1, 0, 0, 1]), o: staticProp(100) },
          { ty: 'tr', p: staticProp([0, 0]), a: staticProp([0, 0]), s: staticProp([100, 100]) },
        ],
      },
    ],
    ...extra,
  } as Layer
}

const moving = (from: number[], to: number[], t0 = 0, t1 = 60) =>
  ({
    a: 1,
    k: [
      { t: t0, s: from, o: { x: 0.33, y: 0 }, i: { x: 0.67, y: 1 } },
      { t: t1, s: to },
    ],
  }) as never

describe('stillFrame: real files render the chosen frame', () => {
  it.each([0, 17, 45, 90, 133, 178])('docs/test.json at frame %s', (frame) => {
    const source = testDoc()
    const { anim } = stillFrame(source, frame)
    expectSameDrawing(source, frame, anim)
    expect(animatedProperties(anim)).toEqual([])
    expect(anim.ip).toBe(0)
    expect(anim.op).toBe(1)
  })

  it.each([0, 24, 60, 119])('docs/wallet_flag.json at frame %s', (frame) => {
    const source = walletDoc()
    const { anim } = stillFrame(source, frame)
    expectSameDrawing(source, frame, anim)
    expect(animatedProperties(anim)).toEqual([])
  })

  for (const sample of SAMPLES) {
    it(`sample "${sample.id}" at a third and at two thirds`, async () => {
      const source = await sample.load()
      for (const frame of [
        Math.round(source.ip + (source.op - source.ip) / 3),
        Math.round(source.ip + ((source.op - source.ip) * 2) / 3),
      ]) {
        const { anim } = stillFrame(source, frame)
        expectSameDrawing(source, frame, anim)
        expect(animatedProperties(anim)).toEqual([])
      }
    })
  }

  it('bakes each precomp instance at its own time (docs/test.json: 8 instances, st offsets)', () => {
    const source = testDoc()
    const { anim } = stillFrame(source, 90)
    const precomps = (anim.assets ?? []).filter(isPrecompAsset)
    const refs = new Set(
      anim.layers.filter((l) => l.ty === 0).map((l) => (l as PrecompLayer).refId),
    )
    // Every precomp layer points at a baked asset, and every baked asset is used.
    for (const ref of refs) expect(precomps.some((a) => a.id === ref)).toBe(true)
    expect(precomps.map((a) => a.id).sort()).toEqual([...refs].sort())
    expect(precomps.length).toBeGreaterThan(1)
  })

  it('does not modify the source', () => {
    const source = testDoc()
    const before = JSON.stringify(source)
    stillFrame(source, 50)
    expect(JSON.stringify(source)).toBe(before)
  })

  it('is much smaller than the animation it comes from', () => {
    const source = testDoc()
    const { anim } = stillFrame(source, 90)
    expect(JSON.stringify(anim).length).toBeLessThan(JSON.stringify(source).length * 0.6)
  })
})

const textDoc = (text: string) => ({
  t: text,
  s: 20,
  f: 'Inter',
  fc: [0, 0, 0],
  j: 0,
  tr: 0,
  lh: 24,
})

describe('stillFrame: structure', () => {
  it('holds the frame for the requested length', () => {
    const source = createAnimation({ fps: 30, frames: 60 })
    source.layers = [
      shapeLayer(1, 'Box', { ks: { ...shapeLayer(1, 'x').ks, p: moving([0, 0], [300, 0]) } }),
    ]
    const { anim } = stillFrame(source, 30, { frames: 90 })
    expect(anim.op).toBe(90)
    expect(anim.layers[0].ip).toBe(0)
    expect(anim.layers[0].op).toBe(90)
    expect(anim.layers[0].ks.p).toEqual({ a: 0, k: [150, 0] })
  })

  it('drops layers that are not on screen, keeps invisible parents as nulls', () => {
    const source = createAnimation({ frames: 60 })
    source.layers = [
      shapeLayer(1, 'Later', { ip: 40, op: 60 }),
      shapeLayer(2, 'Child'),
      shapeLayer(3, 'Parent out of range', { ip: 50, op: 60 }),
    ]
    source.layers[1].parent = 3
    const { anim } = stillFrame(source, 10)
    expect(anim.layers.map((l) => l.nm)).toEqual(['Child', 'Parent out of range'])
    const parent = anim.layers[1]
    expect(parent.ty).toBe(3)
    expect('shapes' in parent).toBe(false)
    // Never on screen within the still.
    expect(parent.ip).toBeGreaterThanOrEqual(anim.op)
    expectSameDrawing(source, 10, anim)
  })

  it('keeps the track matte of a visible layer, even when the matte is out of range', () => {
    const source = createAnimation({ frames: 60 })
    source.layers = [
      shapeLayer(1, 'Matte', { td: 1, ip: 30, op: 60 }),
      shapeLayer(2, 'Matted', { tt: 1 }),
      shapeLayer(3, 'Unused matte', { td: 1 }),
      shapeLayer(4, 'Hidden matted', { tt: 1, ip: 40, op: 60 }),
    ]
    const { anim } = stillFrame(source, 10)
    expect(anim.layers.map((l) => l.nm)).toEqual(['Matte', 'Matted'])
    expect(anim.layers[0].ip).toBeGreaterThanOrEqual(anim.op)
    expectSameDrawing(source, 10, anim)
  })

  it('follows a time remap', () => {
    const inner: PrecompAsset = {
      id: 'comp',
      layers: [
        shapeLayer(1, 'Inner', { ks: { ...shapeLayer(1, 'x').ks, p: moving([0, 0], [600, 0]) } }),
      ],
    }
    const source = createAnimation({ fps: 30, frames: 60 })
    source.assets = [inner]
    source.layers = [
      {
        ty: 0,
        ind: 1,
        nm: 'Remapped',
        refId: 'comp',
        w: 512,
        h: 512,
        ip: 0,
        op: 60,
        st: 0,
        ks: shapeLayer(1, 'x').ks,
        // Holds inner second 1 (frame 30) from frame 10 on.
        tm: {
          a: 1,
          k: [
            { t: 0, s: [0], h: 1 },
            { t: 10, s: [1] },
          ],
        },
      } as PrecompLayer,
    ]
    const { anim } = stillFrame(source, 20)
    expectSameDrawing(source, 20, anim)
    const layer = anim.layers[0] as PrecompLayer
    expect(layer.tm).toBeUndefined()
    const baked = anim.assets?.find((a) => a.id === layer.refId) as PrecompAsset
    expect(baked.layers[0].ks.p).toEqual({ a: 0, k: [300, 0] })
  })

  it('keeps the orientation of auto-oriented layers', () => {
    const source = createAnimation({ frames: 60 })
    source.layers = [
      shapeLayer(1, 'Arrow', {
        ao: 1,
        ks: { ...shapeLayer(1, 'x').ks, p: moving([0, 0], [100, 100]), r: staticProp(10) },
      }),
    ]
    const angle = autoOrientAngle(source.layers[0], 30)
    expect(angle).toBeCloseTo(45, 3)
    const { anim } = stillFrame(source, 30)
    expect(anim.layers[0].ao).toBeUndefined()
    expect((anim.layers[0].ks.r as AnyProperty).k).toBeCloseTo(55, 3)
  })

  it('drops expressions and counts them', () => {
    const source = createAnimation({ frames: 60 })
    source.layers = [shapeLayer(1, 'Wiggle')]
    ;(source.layers[0].ks.p as AnyProperty).x = 'wiggle(2, 30)'
    const { anim, expressions } = stillFrame(source, 0)
    expect(expressions).toBe(1)
    expect((anim.layers[0].ks.p as AnyProperty).x).toBeUndefined()
  })

  it('keeps only the images still in use', () => {
    const source = createAnimation({ frames: 60 })
    source.assets = [
      { id: 'img_used', w: 10, h: 10, p: 'a.png', u: '' },
      { id: 'img_unused', w: 10, h: 10, p: 'b.png', u: '' },
    ]
    source.layers = [
      {
        ty: 2,
        ind: 1,
        nm: 'Used',
        refId: 'img_used',
        ip: 0,
        op: 60,
        st: 0,
        ks: shapeLayer(1, 'x').ks,
      },
      {
        ty: 2,
        ind: 2,
        nm: 'Later',
        refId: 'img_unused',
        ip: 30,
        op: 60,
        st: 0,
        ks: shapeLayer(1, 'x').ks,
      },
    ] as Layer[]
    const { anim } = stillFrame(source, 10)
    expect(anim.assets?.map((a) => a.id)).toEqual(['img_used'])
  })

  it('freezes text documents at the frame', () => {
    const source = createAnimation({ frames: 60 })
    source.layers = [
      {
        ty: 5,
        ind: 1,
        nm: 'Title',
        ip: 0,
        op: 60,
        st: 0,
        ks: shapeLayer(1, 'x').ks,
        t: {
          d: {
            k: [
              { s: textDoc('One'), t: 0 },
              { s: textDoc('Two'), t: 30 },
            ],
          },
          p: {},
          m: { g: 1, a: staticProp([0, 0]) },
          a: [],
        },
      } as unknown as Layer,
    ]
    const { anim } = stillFrame(source, 40)
    const d = (anim.layers[0] as unknown as { t: { d: { k: { s: { t: string }; t: number }[] } } })
      .t.d
    expect(d.k).toHaveLength(1)
    expect(d.k[0].s.t).toBe('Two')
    expect(d.k[0].t).toBe(0)
  })
})
