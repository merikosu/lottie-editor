import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { getAt, type NodePath } from '@/lottie/path'
import { forEachLayer } from '@/lottie/traverse'
import type {
  Animation,
  Layer,
  PrecompAsset,
  PrecompLayer,
  ShapeLayer,
  TextLayer,
} from '@/lottie/types'
import { importLottieAsLayer, importPayload } from '../lib/import-lottie'

const stat = <T>(k: T) => ({ a: 0 as const, k })

function shapeLayer(ind: number, nm: string, extra: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    ty: 4,
    ind,
    nm,
    ip: 0,
    op: 60,
    st: 0,
    ks: { p: stat([0, 0, 0]) },
    shapes: [],
    ...extra,
  }
}

function target(): Animation {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 90,
    w: 400,
    h: 300,
    layers: [shapeLayer(1, 'Background'), shapeLayer(2, 'Title')],
    assets: [
      { id: 'comp_0', layers: [shapeLayer(1, 'Target inner')] },
      { id: 'image_0', w: 10, h: 10, u: '', p: 'data:image/png;base64,AAAA', e: 1 },
    ],
    fonts: { list: [{ fName: 'Inter-Regular', fFamily: 'Inter', fStyle: 'Regular' }] },
  } as Animation
}

function source(): Animation {
  const moving = shapeLayer(1, 'Moving', {
    ip: 0,
    op: 120,
    ks: {
      p: {
        a: 1,
        k: [
          { t: 0, s: [0, 0, 0], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } },
          { t: 60, s: [100, 0, 0] },
        ],
      },
    },
  })
  const text: TextLayer = {
    ty: 5,
    ind: 3,
    nm: 'Label',
    ip: 0,
    op: 120,
    st: 0,
    ks: {},
    t: { d: { k: [{ t: 0, s: { t: 'Hi', f: 'Roboto-Bold', s: 24 } }] } },
  } as unknown as TextLayer
  return {
    v: '5.9.0',
    fr: 60,
    ip: 0,
    op: 120,
    w: 800,
    h: 800,
    layers: [
      moving,
      {
        ty: 0,
        ind: 2,
        nm: 'Nested',
        refId: 'comp_0',
        ip: 0,
        op: 120,
        st: 0,
        ks: {},
      } as PrecompLayer,
      text,
    ],
    assets: [
      // Same id as a target asset, different content: must be renamed.
      { id: 'comp_0', layers: [shapeLayer(1, 'Source inner', { op: 120 })] },
      // Identical to the target's image: reused.
      { id: 'image_0', w: 10, h: 10, u: '', p: 'data:image/png;base64,AAAA', e: 1 },
    ],
    fonts: { list: [{ fName: 'Roboto-Bold', fFamily: 'Roboto', fStyle: 'Bold' }] },
  } as Animation
}

function run(anim: Animation, src: Animation, compPath: NodePath = ['layers'], index = 0) {
  let path: NodePath | null = null
  const next = produce(anim, (d) => {
    path = importLottieAsLayer(d as Animation, src, { compPath, index, name: 'Imported' })
  })
  return { next, path: path as NodePath | null }
}

describe('importPayload', () => {
  it('wraps the root layers into a new composition shown by one precomp layer', () => {
    const payload = importPayload(source(), { w: 400, h: 300 }, 'Logo')
    expect(payload.kind).toBe('layers')
    expect(payload.fr).toBe(60)
    expect(payload.layers).toHaveLength(1)
    const layer = payload.layers![0] as PrecompLayer
    const comp = payload.assets!.find((a) => a.id === layer.refId) as PrecompAsset
    expect(comp.nm).toBe('Logo')
    expect(comp.layers.map((l) => l.nm)).toEqual(['Moving', 'Nested', 'Label'])
    // A new id that does not clash with the source's own assets.
    expect(layer.refId).not.toBe('comp_0')
    expect(layer.w).toBe(800)
    expect(layer.h).toBe(800)
  })

  it('centers the layer and scales a larger source down to fit', () => {
    const layer = importPayload(source(), { w: 400, h: 300 }, 'Logo').layers![0]
    expect(layer.ks.p).toEqual(stat([200, 150, 0]))
    expect(layer.ks.a).toEqual(stat([400, 400, 0]))
    expect(layer.ks.s).toEqual(stat([37.5, 37.5, 100]))
  })

  it('keeps a smaller source at 100%', () => {
    const small = { ...source(), w: 100, h: 50 }
    expect(importPayload(small, { w: 400, h: 300 }, 'x').layers![0].ks.s).toEqual(
      stat([100, 100, 100]),
    )
  })

  it('shows the source in point at the layer in point', () => {
    const late = { ...source(), ip: 30, op: 90 }
    const layer = importPayload(late, { w: 400, h: 300 }, 'x').layers![0]
    expect(layer.ip).toBe(0)
    expect(layer.op).toBe(60)
    expect(layer.st).toBe(-30)
  })

  it('does not alias the source', () => {
    const src = source()
    const payload = importPayload(src, { w: 400, h: 300 }, 'x')
    const refId = (payload.layers![0] as PrecompLayer).refId
    const comp = payload.assets!.find((a) => a.id === refId) as PrecompAsset
    ;(comp.layers[0] as ShapeLayer).nm = 'changed'
    expect(src.layers[0].nm).toBe('Moving')
  })
})

describe('importLottieAsLayer', () => {
  it('inserts a precomp layer at the top of the root composition', () => {
    const { next, path } = run(target(), source())
    expect(path).toEqual(['layers', 0])
    const layer = getAt<PrecompLayer>(next, path!)!
    expect(layer.ty).toBe(0)
    expect(layer.nm).toBe('Imported')
    expect(next.layers.map((l) => l.nm)).toEqual(['Imported', 'Background', 'Title'])
    // Unique layer index.
    expect(new Set(next.layers.map((l) => l.ind)).size).toBe(3)
  })

  it('merges assets: conflicting ids are renamed and references follow, identical assets are reused', () => {
    const { next, path } = run(target(), source())
    const layer = getAt<PrecompLayer>(next, path!)!
    const ids = next.assets!.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    // The target's own comp_0 is untouched.
    const own = next.assets!.find((a) => a.id === 'comp_0') as PrecompAsset
    expect(own.layers[0].nm).toBe('Target inner')
    // The imported composition refers to the renamed copy of the source's comp_0.
    const imported = next.assets!.find((a) => a.id === layer.refId) as PrecompAsset
    const nested = imported.layers.find((l) => l.nm === 'Nested') as PrecompLayer
    expect(nested.refId).not.toBe('comp_0')
    const nestedComp = next.assets!.find((a) => a.id === nested.refId) as PrecompAsset
    expect(nestedComp.layers[0].nm).toBe('Source inner')
    // The identical image is not duplicated.
    expect(next.assets!.filter((a) => 'p' in a)).toHaveLength(1)
  })

  it('converts times to the document frame rate, keeping durations', () => {
    const { next, path } = run(target(), source())
    const layer = getAt<PrecompLayer>(next, path!)!
    expect(layer.op - layer.ip).toBe(60) // 120 frames at 60 fps = 2 s = 60 frames at 30 fps
    const comp = next.assets!.find((a) => a.id === layer.refId) as PrecompAsset
    const moving = comp.layers.find((l) => l.nm === 'Moving') as ShapeLayer
    const kfs = (moving.ks.p as { k: { t: number }[] }).k
    expect(kfs.map((k) => k.t)).toEqual([0, 30])
  })

  it('merges fonts', () => {
    const { next } = run(target(), source())
    expect(next.fonts!.list.map((f) => f.fName).sort()).toEqual(['Inter-Regular', 'Roboto-Bold'])
  })

  it('starts at the first frame of a precomp composition and keeps its layers valid', () => {
    const anim = target()
    // Show comp_0 from frame 10 of its own time.
    anim.layers.push({
      ty: 0,
      ind: 3,
      nm: 'Holder',
      refId: 'comp_0',
      ip: 0,
      op: 90,
      st: -10,
      ks: {},
    } as PrecompLayer)
    const { next, path } = run(anim, source(), ['assets', 0, 'layers'], 1)
    expect(path).toEqual(['assets', 0, 'layers', 1])
    const layer = getAt<Layer>(next, path!)!
    expect(layer.ip).toBe(10)
    expect(layer.st).toBe(10)
    expect(layer.op).toBe(70)
  })

  it('never makes a composition contain itself', () => {
    // Importing into a precomp that the import would reference cannot happen with fresh ids.
    const { next } = run(target(), source(), ['assets', 0, 'layers'])
    let cycles = 0
    forEachLayer(next, (l, p) => {
      if (l.ty === 0 && p[0] === 'assets') {
        const own = next.assets![p[1] as number].id
        if ((l as PrecompLayer).refId === own) cycles++
      }
    })
    expect(cycles).toBe(0)
  })
})
