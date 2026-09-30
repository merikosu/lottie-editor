import { describe, expect, it } from 'vitest'
import type { NodePath } from '@/lottie/path'
import type { Animation, Layer, ShapeItem } from '@/lottie/types'
import { instancesOf, keepOrder, resolvePick, sharedAssetOf } from '../lib/targets'

const group = (nm: string): ShapeItem =>
  ({ ty: 'gr', nm, it: [{ ty: 'tr' } as ShapeItem] }) as ShapeItem

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
      {
        id: 'logo',
        layers: [{ ...base, ty: 4, ind: 1, nm: 'Mark', shapes: [group('Part')] } as Layer],
      },
    ],
    layers: [
      { ...base, ty: 0, ind: 1, nm: 'Logo', refId: 'logo' } as Layer,
      { ...base, ty: 2, ind: 2, nm: 'Photo', refId: 'img' } as Layer,
      { ...base, ty: 2, ind: 3, nm: 'Photo copy', refId: 'img' } as Layer,
      { ...base, ty: 4, ind: 4, nm: 'Shapes', shapes: [group('A'), group('B')] } as Layer,
      { ...base, ty: 3, ind: 5, nm: 'Null' } as Layer,
      { ...base, ty: 0, ind: 6, nm: 'Logo again', refId: 'logo' } as Layer,
    ],
  } as Animation
}

// Innermost first, as nodePathsFromElement reports them.
const insideLogo: NodePath[] = [
  ['assets', 1, 'layers', 0, 'shapes', 0],
  ['assets', 1, 'layers', 0],
  ['layers', 0],
]
const insideShapes: NodePath[] = [
  ['layers', 3, 'shapes', 1],
  ['layers', 3],
]

describe('resolvePick', () => {
  it('picks the suggested element that contains the hit', () => {
    expect(resolvePick(makeDoc(), insideLogo, [{ path: ['layers', 0] }])).toEqual(['layers', 0])
  })

  it('picks the innermost suggested element when several contain the hit', () => {
    const suggested = [{ path: ['layers', 0] }, { path: ['assets', 1, 'layers', 0] }]
    expect(resolvePick(makeDoc(), insideLogo, suggested)).toEqual(['assets', 1, 'layers', 0])
  })

  it('without a suggestion, picks the layer that draws what was hit', () => {
    expect(resolvePick(makeDoc(), insideShapes, [])).toEqual(['layers', 3])
    expect(resolvePick(makeDoc(), insideLogo, [])).toEqual(['assets', 1, 'layers', 0])
  })

  it('deep picks the innermost replaceable node', () => {
    expect(resolvePick(makeDoc(), insideShapes, [], true)).toEqual(['layers', 3, 'shapes', 1])
    expect(resolvePick(makeDoc(), insideLogo, [{ path: ['layers', 0] }], true)).toEqual([
      'assets',
      1,
      'layers',
      0,
      'shapes',
      0,
    ])
  })

  it('ignores what cannot be replaced', () => {
    expect(resolvePick(makeDoc(), [['layers', 4]], [])).toBeNull()
    expect(resolvePick(makeDoc(), [], [])).toBeNull()
  })
})

describe('instances', () => {
  it('lists every layer showing the same image or composition, the target first', () => {
    const doc = makeDoc()
    expect(instancesOf(doc, ['layers', 2])).toEqual([
      ['layers', 2],
      ['layers', 1],
    ])
    expect(instancesOf(doc, ['layers', 0])).toEqual([
      ['layers', 0],
      ['layers', 5],
    ])
    expect(instancesOf(doc, ['layers', 3])).toEqual([['layers', 3]])
  })

  it('knows the shared asset of image and precomp layers only', () => {
    const doc = makeDoc()
    expect(sharedAssetOf(doc, ['layers', 1])).toBe('img')
    expect(sharedAssetOf(doc, ['layers', 0])).toBe('logo')
    expect(sharedAssetOf(doc, ['layers', 3])).toBeNull()
    expect(sharedAssetOf(doc, ['layers', 3, 'shapes', 0])).toBeNull()
  })
})

const items = (...keys: string[]) => keys.map((key) => ({ key }))
const keys = (list: { key: string }[]) => list.map((i) => i.key)

describe('keepOrder', () => {
  it('keeps the rows where they were when the ranking changes', () => {
    expect(keys(keepOrder(items('b', 'a', 'c'), items('a', 'b', 'c')))).toEqual(['a', 'b', 'c'])
  })

  it('adds new rows after the known ones and drops the ones that are gone', () => {
    expect(keys(keepOrder(items('new', 'c', 'a'), items('a', 'b', 'c')))).toEqual(['a', 'c', 'new'])
  })

  it('takes the new order as is without a previous list', () => {
    expect(keys(keepOrder(items('b', 'a'), []))).toEqual(['b', 'a'])
  })
})
