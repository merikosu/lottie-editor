import { describe, expect, it } from 'vitest'
import testJson from '../../../../docs/test.json?raw'
import { createAnimation } from '@/lottie/document'
import { precompInnerFrame } from '@/lottie/time'
import type { Animation, PrecompLayer } from '@/lottie/types'
import { chainMap, compMap, firstInstanceMaps, instanceMap, linearMap, ROOT_MAP } from '../time-map'

function precomp(over: Partial<PrecompLayer> = {}): PrecompLayer {
  return { ty: 0, refId: 'comp_0', ip: 10, op: 50, st: 8, ks: {}, ...over }
}

describe('linear maps', () => {
  it('maps both ways and keeps identity for equal maps', () => {
    const map = linearMap(2, 10)
    expect(map.toRoot(5)).toBe(20)
    expect(map.toLocal(20)).toBe(5)
    expect(linearMap(2, 10)).toBe(map)
    expect(linearMap(0, 3).scale).toBe(1)
  })
})

describe('instanceMap', () => {
  it('follows start time and stretch (inner = (outer − st) / sr)', () => {
    const layer = precomp({ st: 8, sr: 2 })
    const map = instanceMap(ROOT_MAP, layer, 30)!
    for (const outer of [10, 17, 33]) {
      const inner = precompInnerFrame(layer, outer, 30)
      expect(map.toRoot(inner)).toBeCloseTo(outer, 9)
      expect(map.toLocal(outer)).toBeCloseTo(inner, 9)
    }
    expect(map.linear).toBe(true)
    expect(map.scale).toBe(2)
  })

  it('composes nested instances', () => {
    const outer = instanceMap(ROOT_MAP, precomp({ st: 5 }), 30)!
    const inner = instanceMap(outer, precomp({ st: 3, sr: 0.5 }), 30)!
    // root = 5 + (3 + 0.5 · t)
    expect(inner.toRoot(10)).toBeCloseTo(13, 9)
    expect(inner.toLocal(13)).toBeCloseTo(10, 9)
    expect(inner.scale).toBe(0.5)
  })

  it('inverts a forward time remap by sampling (read-only)', () => {
    // tm: 0 s at frame 10 → 1 s at frame 40 (30 fps): inner = (outer − 10) · 1 at 30 fps.
    const layer = precomp({
      ip: 10,
      op: 40,
      tm: {
        a: 1,
        k: [
          { t: 10, s: [0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
          { t: 40, s: [1] },
        ],
      },
    })
    const map = instanceMap(ROOT_MAP, layer, 30)!
    expect(map.linear).toBe(false)
    expect(map.toRoot(0)).toBeCloseTo(10, 6)
    expect(map.toRoot(15)).toBeCloseTo(25, 6)
    expect(map.toLocal(25)).toBeCloseTo(15, 6)
    // Cached while the layer object is unchanged.
    expect(instanceMap(ROOT_MAP, layer, 30)).toBe(map)
  })

  it('gives up on remaps that run backwards', () => {
    const layer = precomp({
      ip: 0,
      op: 30,
      tm: {
        a: 1,
        k: [
          { t: 0, s: [1], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
          { t: 30, s: [0] },
        ],
      },
    })
    expect(instanceMap(ROOT_MAP, layer, 30)).toBeNull()
    expect(instanceMap(null, precomp(), 30)).toBeNull()
  })
})

describe('first instance maps', () => {
  it('maps every precomp of the real-world file through its first instance', () => {
    const doc = JSON.parse(testJson) as Animation
    const maps = firstInstanceMaps(doc)
    // comp_0 is used 8 times; the first instance (layer 6) starts at st = 75.
    const map = maps.get(0)!
    expect(map.toRoot(0)).toBe(75)
    expect(compMap(doc, 0)).toBe(map)
    expect(compMap(doc, null)).toBe(ROOT_MAP)
    expect(firstInstanceMaps(doc)).toBe(maps)
  })

  it('ignores unused comps and survives reference cycles', () => {
    const doc = createAnimation()
    doc.assets = [
      { id: 'a', layers: [precomp({ refId: 'b', st: 2 })] },
      { id: 'b', layers: [precomp({ refId: 'a', st: 3 })] },
      { id: 'unused', layers: [] },
    ]
    doc.layers = [precomp({ refId: 'a', st: 10 })]
    const maps = firstInstanceMaps(doc)
    expect(maps.get(0)!.toRoot(0)).toBe(10)
    expect(maps.get(1)!.toRoot(0)).toBe(12)
    expect(maps.has(2)).toBe(false)
    expect(compMap(doc, 2)).toBeNull()
  })
})

describe('chainMap', () => {
  it('maps precomp content through a given instance chain', () => {
    const doc = JSON.parse(testJson) as Animation
    // comp_0 through its 7th instance (layers[12], st 9) instead of the first one (st 75).
    const map = chainMap(doc, [['layers', 12]])!
    expect(map.toRoot(0)).toBe(9)
    expect(map.toLocal(29)).toBe(20)
    expect(chainMap(doc, [])).toBe(ROOT_MAP)
    // Not a precomp layer: no map.
    expect(chainMap(doc, [['layers', 0]])).toBeNull()
  })

  it('composes nested links', () => {
    const doc = createAnimation()
    doc.assets = [
      { id: 'inner', layers: [] },
      { id: 'outer', layers: [precomp({ refId: 'inner', st: 3 })] },
    ]
    doc.layers = [precomp({ refId: 'outer', st: 10 })]
    const map = chainMap(doc, [
      ['layers', 0],
      ['assets', 1, 'layers', 0],
    ])!
    expect(map.toRoot(0)).toBe(13)
  })
})
