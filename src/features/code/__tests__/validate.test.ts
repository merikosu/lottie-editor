import { freeze } from 'immer'
import { describe, expect, it } from 'vitest'
import { reconcile } from '../reconcile'
import { lottieShapeIssue } from '../validate'

type Loose = Record<string, unknown>
interface LooseDoc {
  layers: (Loose & { ks: unknown })[]
  assets?: unknown[]
  [key: string]: unknown
}

const layer = (extra: Loose = {}): Loose & { ks: unknown } => ({
  ty: 4,
  ks: {},
  ip: 0,
  op: 10,
  st: 0,
  ...extra,
})
const doc = (extra: Loose = {}): LooseDoc => ({
  v: '5.7.0',
  fr: 30,
  ip: 0,
  op: 60,
  w: 100,
  h: 100,
  layers: [layer()],
  ...extra,
})

describe('lottieShapeIssue', () => {
  it('accepts valid documents', () => {
    expect(lottieShapeIssue(doc())).toBeNull()
    expect(
      lottieShapeIssue(
        doc({
          assets: [
            { id: 'img', p: 'a.png' },
            { id: 'c', layers: [layer()] },
          ],
          fonts: { list: [] },
          markers: [],
        }),
      ),
    ).toBeNull()
    expect(lottieShapeIssue({ layers: [], op: 10 })).toBeNull()
  })

  it('rejects non-Lottie JSON', () => {
    expect(lottieShapeIssue([])).toEqual({ code: 'not-object', path: [] })
    expect(lottieShapeIssue('x')).toEqual({ code: 'not-object', path: [] })
    expect(lottieShapeIssue({ w: 1 })).toEqual({ code: 'no-layers', path: [] })
    expect(lottieShapeIssue({ w: 1, layers: {} })).toEqual({ code: 'no-layers', path: ['layers'] })
    expect(lottieShapeIssue({ layers: [] })).toEqual({ code: 'no-dimensions', path: [] })
  })

  it('points at broken layers, including inside precomps', () => {
    expect(lottieShapeIssue(doc({ layers: [layer(), 3] }))).toEqual({
      code: 'layer-not-object',
      path: ['layers', 1],
    })
    expect(lottieShapeIssue(doc({ layers: [{ ks: {} }] }))).toEqual({
      code: 'layer-type',
      path: ['layers', 0],
    })
    expect(lottieShapeIssue(doc({ layers: [layer({ ty: '4' })] }))).toEqual({
      code: 'layer-type',
      path: ['layers', 0, 'ty'],
    })
    expect(lottieShapeIssue(doc({ layers: [{ ty: 4 }] }))).toEqual({
      code: 'layer-transform',
      path: ['layers', 0],
    })
    expect(lottieShapeIssue(doc({ layers: [layer({ ks: null })] }))).toEqual({
      code: 'layer-transform',
      path: ['layers', 0, 'ks'],
    })
    expect(lottieShapeIssue(doc({ assets: [{ id: 'c', layers: [layer(), { ty: 1 }] }] }))).toEqual({
      code: 'layer-transform',
      path: ['assets', 0, 'layers', 1],
    })
  })

  it('points at broken assets, fonts and markers', () => {
    expect(lottieShapeIssue(doc({ assets: {} }))).toEqual({
      code: 'assets-not-array',
      path: ['assets'],
    })
    expect(lottieShapeIssue(doc({ assets: [null] }))).toEqual({
      code: 'asset-not-object',
      path: ['assets', 0],
    })
    expect(lottieShapeIssue(doc({ assets: [{ p: 'x' }] }))).toEqual({
      code: 'asset-id',
      path: ['assets', 0],
    })
    expect(lottieShapeIssue(doc({ assets: [{ id: 3 }] }))).toEqual({
      code: 'asset-id',
      path: ['assets', 0, 'id'],
    })
    expect(lottieShapeIssue(doc({ assets: [{ id: 'c', layers: 3 }] }))).toEqual({
      code: 'precomp-layers',
      path: ['assets', 0, 'layers'],
    })
    expect(lottieShapeIssue(doc({ fonts: [] }))).toEqual({ code: 'fonts-list', path: ['fonts'] })
    expect(lottieShapeIssue(doc({ fonts: { list: {} } }))).toEqual({
      code: 'fonts-list',
      path: ['fonts'],
    })
    expect(lottieShapeIssue(doc({ markers: {} }))).toEqual({
      code: 'markers-not-array',
      path: ['markers'],
    })
  })
})

describe('reconcile', () => {
  it('returns the previous object when nothing changed', () => {
    const prev = freeze(doc(), true)
    expect(reconcile(prev, JSON.parse(JSON.stringify(prev)))).toBe(prev)
  })

  it('shares unchanged subtrees and replaces changed ones', () => {
    const prev = freeze(
      doc({ layers: [layer({ nm: 'a' }), layer({ nm: 'b' })], assets: [{ id: 'x', p: 'y' }] }),
      true,
    )
    const next = JSON.parse(JSON.stringify(prev)) as LooseDoc
    next.layers[1].nm = 'changed'
    const out = reconcile(prev, next)
    expect(out).not.toBe(prev)
    expect(out).toEqual(next)
    expect(out.layers[0]).toBe(prev.layers[0])
    expect(out.layers[1]).not.toBe(prev.layers[1])
    expect(out.layers[1].ks).toBe(prev.layers[1].ks)
    expect(out.assets).toBe(prev.assets)
  })

  it('treats reordered keys, added items and type changes as changes', () => {
    const prev = freeze({ a: 1, b: 2, list: [1, 2], v: { x: 1 } }, true)
    const reordered = reconcile(prev, { b: 2, a: 1, list: [1, 2], v: { x: 1 } })
    expect(reordered).not.toBe(prev)
    expect(Object.keys(reordered)).toEqual(['b', 'a', 'list', 'v'])
    expect(reordered.list).toBe(prev.list)
    const grown = reconcile(prev, { a: 1, b: 2, list: [1, 2, 3], v: [1] })
    expect(grown.list).toEqual([1, 2, 3])
    expect(grown.v).toEqual([1])
  })

  it('keeps "__proto__" as a plain key', () => {
    const next = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as Record<string, unknown>
    const out = reconcile({ a: 1 }, next)
    expect(Object.keys(out)).toEqual(['__proto__', 'a'])
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype)
  })

  it('handles NaN-like primitives and nulls', () => {
    expect(reconcile(null, null)).toBeNull()
    expect(reconcile({ a: null }, { a: 1 })).toEqual({ a: 1 })
    expect(reconcile(1, 'x')).toBe('x')
  })
})
