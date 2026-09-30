import { describe, expect, it } from 'vitest'
import type { Animation, Layer } from '@/lottie/types'
import { documentHasExpressions, layerHasExpressions } from '../lib/expressions'

const stat = (k: unknown) => ({ a: 0, k })

function doc(layers: unknown[], assets: unknown[] = []): Animation {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers,
    assets,
  } as unknown as Animation
}

const plain = {
  ty: 4,
  ip: 0,
  op: 60,
  st: 0,
  ks: { p: stat([0, 0]), o: stat(100) },
  shapes: [],
} as unknown as Layer

describe('expressions', () => {
  it('finds none in plain documents', () => {
    expect(documentHasExpressions(doc([plain]))).toBe(false)
    expect(documentHasExpressions(null)).toBe(false)
    expect(documentHasExpressions(doc([]))).toBe(false)
  })

  it('finds transform expressions', () => {
    const layer = {
      ...plain,
      ks: { p: { a: 0, k: [0, 0], x: 'wiggle(2, 10)' } },
    } as unknown as Layer
    expect(layerHasExpressions(layer)).toBe(true)
    expect(documentHasExpressions(doc([plain, layer]))).toBe(true)
  })

  it('finds expressions deep in shapes, effects and text documents', () => {
    const shape = {
      ...plain,
      shapes: [
        { ty: 'gr', it: [{ ty: 'fl', c: { a: 0, k: [1, 0, 0, 1], x: 'thisComp.layer(1)' } }] },
      ],
    } as unknown as Layer
    const effect = {
      ...plain,
      ef: [{ ty: 5, ef: [{ ty: 0, v: { a: 0, k: 1, x: 'time' } }] }],
    } as unknown as Layer
    const text = {
      ty: 5,
      ip: 0,
      op: 60,
      st: 0,
      ks: {},
      t: { d: { k: [{ t: 0, s: { t: 'Hi', s: 12, f: 'Arial' } }], x: 'text.sourceText' } },
    } as unknown as Layer
    expect(layerHasExpressions(shape)).toBe(true)
    expect(layerHasExpressions(effect)).toBe(true)
    expect(layerHasExpressions(text)).toBe(true)
  })

  it('ignores empty expression strings and non-property x fields', () => {
    const blank = { ...plain, ks: { p: { a: 0, k: [0, 0], x: '   ' } } } as unknown as Layer
    const unrelated = {
      ...plain,
      ks: { p: stat([0, 0]) },
      meta: { x: 'not a property' },
    } as unknown as Layer
    expect(layerHasExpressions(blank)).toBe(false)
    expect(layerHasExpressions(unrelated)).toBe(false)
  })

  it('checks precomp assets', () => {
    const inner = { ...plain, ks: { r: { a: 0, k: 0, x: 'time*90' } } }
    expect(
      documentHasExpressions(
        doc(
          [plain],
          [
            { id: 'c', layers: [inner] },
            { id: 'img', p: 'a.png' },
          ],
        ),
      ),
    ).toBe(true)
  })

  it('caches results per layer object', () => {
    const layer = { ...plain, ks: { p: { a: 0, k: [0, 0], x: 'value' } } } as unknown as Layer
    expect(layerHasExpressions(layer)).toBe(true)
    // Mutating a cached (normally frozen) layer does not change the answer: identity is the key.
    ;(layer.ks.p as { x?: string }).x = undefined
    expect(layerHasExpressions(layer)).toBe(true)
    expect(layerHasExpressions({ ...layer })).toBe(false)
  })
})
