import { describe, expect, it } from 'vitest'
import { prepareAnimationData } from '@/player/prepare'
import { createAnimation } from '../document'
import {
  DEFAULT_FONT,
  compInfoAt,
  createEllipseShape,
  createFillShape,
  createGradientFillShape,
  createGroupShape,
  createImageAsset,
  createImageLayer,
  createNullLayer,
  createPrecompAsset,
  createPrecompLayer,
  createRectShape,
  createRepeaterShape,
  createRoundCornersShape,
  createShapeLayer,
  createSolidLayer,
  createStarShape,
  createStrokeShape,
  createTextLayer,
  createTrimPathsShape,
  ensureFont,
  nextNumberedName,
  toHexColor,
  toLottieColor,
  uniqueAssetId,
  type ShapeKind,
} from '../create'
import { pasteLayers, parseLayersClipboard } from '../layer-ops'
import type { Animation, GroupShape, Layer, PrecompLayer, ShapeLayer, TextLayer } from '../types'

const base = { ind: 3, ip: 0, op: 90 }

describe('colors', () => {
  it('converts hex and legacy arrays to Lottie colors', () => {
    expect(toLottieColor('#ff8000')).toEqual([1, 0.502, 0, 1])
    expect(toLottieColor([255, 0, 0])).toEqual([1, 0, 0, 1])
    expect(toLottieColor('nope')).toEqual([0, 0, 0, 1])
    expect(toHexColor([0, 0.5, 1, 1])).toBe('#0080ff')
    expect(toHexColor('#ABC')).toBe('#aabbcc')
  })
})

describe('createShapeLayer', () => {
  it.each<ShapeKind>(['rect', 'ellipse', 'star', 'polygon'])(
    'builds a complete %s layer',
    (kind) => {
      const layer = createShapeLayer({
        ...base,
        kind,
        w: 200,
        h: 100,
        color: '#336699',
        name: 'Shape 1',
        position: [256, 128],
      })
      expect(layer).toMatchObject({
        ty: 4,
        ind: 3,
        nm: 'Shape 1',
        ip: 0,
        op: 90,
        st: 0,
        sr: 1,
        ao: 0,
        ddd: 0,
        bm: 0,
      })
      expect(layer.ks.p).toEqual({ a: 0, k: [256, 128, 0] })
      expect(layer.ks.a).toEqual({ a: 0, k: [0, 0, 0] })
      expect(layer.ks.s).toEqual({ a: 0, k: [100, 100, 100] })
      const group = layer.shapes[0] as GroupShape
      expect(group.ty).toBe('gr')
      expect(group.nm).toBe('Shape 1')
      expect(group.it.map((i) => i.ty)).toEqual([
        kind === 'rect' ? 'rc' : kind === 'ellipse' ? 'el' : 'sr',
        'fl',
        'tr',
      ])
      expect(group.it[1]).toMatchObject({ c: { a: 0, k: [0.2, 0.4, 0.6, 1] }, o: { a: 0, k: 100 } })
    },
  )

  it('uses the smaller side as the diameter of stars and polygons', () => {
    const star = createShapeLayer({ ...base, kind: 'star', w: 200, h: 100, color: '#fff' })
      .shapes[0] as GroupShape
    expect(star.it[0]).toMatchObject({ sy: 1, or: { k: 50 }, ir: { k: 25 }, pt: { k: 5 } })
    const polygon = createStarShape({ kind: 'polygon', outerRadius: 40 })
    expect(polygon).toMatchObject({ sy: 2, pt: { k: 6 } })
    expect(polygon.ir).toBeUndefined()
  })

  it('creates content the render-copy normalizer does not need to repair', () => {
    const anim: Animation = createAnimation()
    anim.layers = [
      createShapeLayer({ ...base, kind: 'rect', w: 10, h: 10, color: '#fff' }),
      createSolidLayer({ ...base, ind: 4, w: 10, h: 10, color: '#fff' }),
      createNullLayer({ ...base, ind: 5 }),
    ]
    ;(anim.layers[0] as ShapeLayer).shapes.push(
      createGroupShape({
        items: [
          createEllipseShape({ w: 5, h: 5 }),
          createStrokeShape({ color: '#000' }),
          createGradientFillShape({ w: 5 }),
          createTrimPathsShape(),
          createRepeaterShape(),
          createRoundCornersShape(),
        ],
      }),
    )
    const prepared = prepareAnimationData(anim)
    expect(prepared.layers).toEqual(anim.layers)
  })
})

describe('shape items', () => {
  it('always ends groups with an identity transform', () => {
    const group = createGroupShape({
      name: 'G',
      items: [createRectShape({ w: 1, h: 1 }), { ty: 'tr' }],
    })
    expect(group.it.map((i) => i.ty)).toEqual(['rc', 'tr'])
    expect(group.np).toBe(1)
    expect(group.it[1]).toMatchObject({
      p: { k: [0, 0] },
      a: { k: [0, 0] },
      s: { k: [100, 100] },
      r: { k: 0 },
      o: { k: 100 },
    })
    expect(createGroupShape().it.map((i) => i.ty)).toEqual(['tr'])
  })

  it('fills required fields', () => {
    expect(createRectShape({ w: 4, h: 2 }).r).toEqual({ a: 0, k: 0 })
    expect(createStrokeShape({ color: '#000', width: 3 })).toMatchObject({
      w: { k: 3 },
      lc: 1,
      lj: 1,
      ml: 4,
      o: { k: 100 },
    })
    expect(createFillShape({ color: '#000', opacity: 40 }).o).toEqual({ a: 0, k: 40 })
    const gradient = createGradientFillShape({ w: 80, from: '#ff0000', to: '#0000ff' })
    expect(gradient.g).toEqual({ p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1] } })
    expect(gradient.s.k).toEqual([-40, 0])
    expect(gradient.e.k).toEqual([40, 0])
  })
})

describe('other layers', () => {
  it('centers solids on their anchor', () => {
    const solid = createSolidLayer({
      ...base,
      w: 512,
      h: 256.4,
      color: [1, 0, 0, 1],
      position: [256, 128],
      name: 'Solid 1',
    })
    expect(solid).toMatchObject({ ty: 1, sc: '#ff0000', sw: 512, sh: 256 })
    expect(solid.ks.a).toEqual({ a: 0, k: [256, 128, 0] })
  })

  it('creates text layers with a complete text document', () => {
    const text = createTextLayer({
      ...base,
      text: 'Hello\nworld',
      size: 40,
      color: '#ffffff',
      name: 'Text 1',
    })
    expect(text.ty).toBe(5)
    const doc = text.t.d.k[0]
    expect(doc.t).toBe(0)
    expect(doc.s).toMatchObject({
      t: 'Hello\rworld',
      s: 40,
      f: DEFAULT_FONT.fName,
      j: 2,
      lh: 48,
      fc: [1, 1, 1],
    })
    expect(text.t.m).toEqual({ g: 1, a: { a: 0, k: [0, 0] } })
    expect(text.t.a).toEqual([])
  })

  it('adds a font once', () => {
    const anim = createAnimation()
    expect(ensureFont(anim)).toBe(DEFAULT_FONT.fName)
    ensureFont(anim)
    expect(anim.fonts!.list).toEqual([DEFAULT_FONT])
    expect(anim.fonts!.list[0]).not.toBe(DEFAULT_FONT)
  })

  it('creates image layers and embedded assets', () => {
    const layer = createImageLayer('image_0', 200, 100, {
      ...base,
      name: 'photo',
      scale: 50,
      position: [10, 20],
    })
    expect(layer).toMatchObject({ ty: 2, refId: 'image_0', nm: 'photo', ind: 3 })
    expect(layer.ks.a).toEqual({ a: 0, k: [100, 50, 0] })
    expect(layer.ks.p).toEqual({ a: 0, k: [10, 20, 0] })
    expect(layer.ks.s).toEqual({ a: 0, k: [50, 50, 100] })
    expect(createImageLayer('x', 20, 10).ks.p).toEqual({ a: 0, k: [10, 5, 0] })
    expect(
      createImageAsset({
        id: 'image_0',
        dataUri: 'data:image/png;base64,AA',
        w: 20.4,
        h: 10,
        name: 'p',
      }),
    ).toEqual({
      id: 'image_0',
      w: 20,
      h: 10,
      u: '',
      p: 'data:image/png;base64,AA',
      e: 1,
      nm: 'p',
    })
  })
})

describe('precomps', () => {
  it('builds a precomp layer with an identity transform, in bodymovin key order', () => {
    const layer = createPrecompLayer({
      refId: 'comp_0',
      name: 'Pre-comp 1',
      ind: 4,
      w: 597,
      h: 938,
      ip: 12,
      op: 90,
      st: 12,
    })
    expect(Object.keys(layer)).toEqual([
      'ddd',
      'ind',
      'ty',
      'nm',
      'refId',
      'sr',
      'ks',
      'ao',
      'w',
      'h',
      'ip',
      'op',
      'st',
      'bm',
    ])
    expect(layer).toMatchObject({ ty: 0, refId: 'comp_0', w: 597, h: 938, ip: 12, op: 90, st: 12 })
    // Anchor and position at the center: the content keeps its coordinates.
    expect(layer.ks.a).toEqual({ a: 0, k: [298.5, 469, 0] })
    expect(layer.ks.p).toEqual({ a: 0, k: [298.5, 469, 0] })
    expect(layer.ks.s).toEqual({ a: 0, k: [100, 100, 100] })
    expect(layer.ks.r).toEqual({ a: 0, k: 0 })
    expect(layer.ks.o).toEqual({ a: 0, k: 100 })
    const unnamed = createPrecompLayer({ refId: 'x', ind: 1, w: 10, h: 10, ip: 0, op: 1 })
    expect('nm' in unnamed).toBe(false)
    expect(unnamed.st).toBe(0)
  })

  it('builds a precomp asset that players accept', () => {
    const inner = [createNullLayer({ ind: 1, ip: 0, op: 30 })]
    const asset = createPrecompAsset({ id: 'comp_0', name: 'Card', fr: 30, layers: inner })
    expect(asset).toEqual({ id: 'comp_0', nm: 'Card', fr: 30, layers: inner })
    expect('nm' in createPrecompAsset({ id: 'c', fr: 24, layers: [] })).toBe(false)
    const anim = createAnimation({ width: 200, height: 100, frames: 30 })
    anim.assets = [asset]
    anim.layers = [createPrecompLayer({ refId: 'comp_0', ind: 1, w: 200, h: 100, ip: 0, op: 30 })]
    const prepared = prepareAnimationData(anim)
    expect(prepared.layers[0]).toMatchObject({ ty: 0, refId: 'comp_0', w: 200, h: 100 })
  })
})

describe('document helpers', () => {
  it('numbers names like After Effects', () => {
    expect(nextNumberedName([], 'Rectangle')).toBe('Rectangle 1')
    expect(
      nextNumberedName(['Rectangle 1', 'Rectangle 7', 'Rectangle x', undefined], 'Rectangle'),
    ).toBe('Rectangle 8')
    expect(nextNumberedName(['Star (1) 2'], 'Star (1)')).toBe('Star (1) 3')
  })

  it('finds unused asset ids', () => {
    const anim = createAnimation()
    anim.assets = [
      { id: 'image_0', p: 'x' },
      { id: 'image_1', p: 'y' },
    ]
    expect(uniqueAssetId(anim)).toBe('image_2')
    expect(uniqueAssetId(anim, 'comp_')).toBe('comp_0')
  })

  it('numbers conflicting pasted asset ids', () => {
    const anim = createAnimation()
    anim.assets = [{ id: 'comp_0', layers: [] }]
    const payload = parseLayersClipboard({
      __lottieEditor: 'layers',
      layers: [{ ty: 0, refId: 'comp_0', ks: {}, ip: 0, op: 1 }],
      assets: [{ id: 'comp_0', layers: [{ ty: 3, ks: {}, ip: 0, op: 1 }] }],
    })!
    pasteLayers(anim, ['layers'], payload, 0)
    expect(anim.assets.map((a) => a.id)).toEqual(['comp_0', 'comp_1'])
    expect((anim.layers[0] as PrecompLayer).refId).toBe('comp_1')
  })

  it('describes the root and precomp compositions', () => {
    const anim = createAnimation({ width: 400, height: 300, frames: 120 })
    expect(compInfoAt(anim, ['layers'])).toEqual({ w: 400, h: 300, ip: 0, op: 120 })

    const inner: Layer[] = [createNullLayer({ ind: 1, ip: 5, op: 40 })]
    anim.assets = [
      { id: 'comp_0', layers: inner },
      { id: 'comp_1', layers: [] },
    ]
    anim.layers = [
      {
        ty: 0,
        refId: 'comp_0',
        w: 100,
        h: 50,
        ip: 10,
        op: 70,
        st: 10,
        sr: 2,
        ks: {},
      } as PrecompLayer,
    ]
    // Instance range 10..70 with start 10 and stretch 2 → precomp frames 0..30.
    expect(compInfoAt(anim, ['assets', 0, 'layers'])).toEqual({ w: 100, h: 50, ip: 0, op: 30 })
    // Unused precomp: document size, full duration.
    expect(compInfoAt(anim, ['assets', 1, 'layers'])).toEqual({ w: 400, h: 300, ip: 0, op: 120 })

    // Time-remapped instance: fall back to the precomp's own layer ranges.
    ;(anim.layers[0] as PrecompLayer).tm = { a: 0, k: 1 }
    expect(compInfoAt(anim, ['assets', 0, 'layers'])).toEqual({ w: 100, h: 50, ip: 5, op: 40 })
  })

  it('creates layers whose type guards line up', () => {
    const text: TextLayer = createTextLayer({ ...base, text: 'x' })
    const shape: ShapeLayer = createShapeLayer({ ...base, kind: 'rect', w: 1, h: 1, color: '#000' })
    expect([text.ty, shape.ty]).toEqual([5, 4])
  })
})
