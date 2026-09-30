import { describe, expect, it } from 'vitest'
import type { Animation, Layer, ShapeItem, ShapeLayer } from '@/lottie/types'
import { removeElement } from '../lib/remove'

const tr = {
  ty: 'tr',
  p: { a: 0, k: [0, 0] },
  a: { a: 0, k: [0, 0] },
  s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 },
  o: { a: 0, k: 100 },
}
const group = (nm: string): ShapeItem =>
  ({
    ty: 'gr',
    nm,
    it: [
      { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [10, 10] }, r: { a: 0, k: 0 } },
      { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } },
      tr,
    ],
  }) as unknown as ShapeItem

function makeDoc(): Animation {
  const base = { ip: 0, op: 30, st: 0, ks: {} }
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    assets: [
      { id: 'img', w: 10, h: 10, u: '', p: 'data:image/png;base64,AAAA', e: 1 },
      { id: 'shared', w: 10, h: 10, u: '', p: 'data:image/png;base64,BBBB', e: 1 },
      { id: 'comp', layers: [{ ...base, ty: 4, ind: 1, nm: 'Inner', shapes: [group('Dot')] }] },
    ],
    layers: [
      { ...base, ty: 2, ind: 1, nm: 'Watermark', refId: 'img' } as Layer,
      { ...base, ty: 2, ind: 2, nm: 'Photo A', refId: 'shared' } as Layer,
      { ...base, ty: 2, ind: 3, nm: 'Photo B', refId: 'shared' } as Layer,
      { ...base, ty: 0, ind: 4, nm: 'Logo', refId: 'comp', w: 100, h: 100 } as Layer,
      { ...base, ty: 4, ind: 5, nm: 'Badge', shapes: [group('Mark'), group('Frame')] } as Layer,
    ],
  } as Animation
}

describe('removeElement', () => {
  it('removes an image layer and the picture nothing shows any more', () => {
    const doc = makeDoc()
    expect(removeElement(doc, ['layers', 0])).toBe(true)
    expect(doc.layers.map((l) => l.nm)).toEqual(['Photo A', 'Photo B', 'Logo', 'Badge'])
    expect(doc.assets?.map((a) => a.id)).toEqual(['shared', 'comp'])
  })

  it('keeps a picture another layer still shows', () => {
    const doc = makeDoc()
    expect(removeElement(doc, ['layers', 1])).toBe(true)
    expect(doc.assets?.map((a) => a.id)).toEqual(['img', 'shared', 'comp'])
  })

  it('removes a composition layer and the composition nothing shows any more', () => {
    const doc = makeDoc()
    expect(removeElement(doc, ['layers', 3])).toBe(true)
    expect(doc.layers.some((l) => l.nm === 'Logo')).toBe(false)
    expect(doc.assets?.map((a) => a.id)).toEqual(['img', 'shared'])
  })

  it('keeps a composition another layer still shows', () => {
    const doc = makeDoc()
    doc.layers.push({ ...doc.layers[3], ind: 9, nm: 'Logo again' })
    expect(removeElement(doc, ['layers', 3])).toBe(true)
    expect(doc.assets?.some((a) => a.id === 'comp')).toBe(true)
  })

  it('removes a shape group from its layer', () => {
    const doc = makeDoc()
    expect(removeElement(doc, ['layers', 4, 'shapes', 0])).toBe(true)
    const badge = doc.layers[4] as ShapeLayer
    expect(badge.shapes.map((s) => s.nm)).toEqual(['Frame'])
  })

  it('does nothing where there is nothing to remove', () => {
    const doc = makeDoc()
    expect(removeElement(doc, ['layers', 9])).toBe(false)
    expect(removeElement(doc, ['layers', 4, 'shapes', 0, 'it', 2])).toBe(false)
    expect(doc.layers).toHaveLength(5)
  })
})
