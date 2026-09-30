import { describe, expect, it } from 'vitest'
import type { Animation, Layer, PrecompLayer } from '@/lottie/types'
import { compTimeFor } from '../time'

const shape = (ip = 0, op = 100): Layer => ({ ty: 4, ip, op, st: 0, ks: {}, shapes: [] })
const precomp = (refId: string, extra: Partial<PrecompLayer>): PrecompLayer => ({
  ty: 0,
  refId,
  ip: 0,
  op: 100,
  st: 0,
  ks: {},
  ...extra,
})

function doc(): Animation {
  return {
    fr: 30,
    ip: 0,
    op: 100,
    w: 100,
    h: 100,
    layers: [
      // Two instances of comp_a, visible at different times.
      precomp('comp_a', { nm: 'late', ip: 50, op: 80, st: 45 }),
      precomp('comp_a', { nm: 'early', ip: 10, op: 30, st: 4 }),
      shape(),
    ],
    assets: [
      { id: 'comp_a', layers: [shape(), precomp('comp_b', { st: 2, sr: 2 })] },
      { id: 'comp_b', layers: [shape()] },
      { id: 'unused', layers: [shape()] },
      { id: 'img', p: 'data:image/png;base64,' },
    ],
  }
}

describe('compTimeFor', () => {
  it('uses the playhead for root nodes', () => {
    const t = compTimeFor(doc(), ['layers', 2, 'shapes', 0], 42)
    expect(t.frame).toBe(42)
    expect(t.assetIndex).toBeNull()
    expect(t.toRoot(7)).toBe(7)
    expect(t.fromRoot(7)).toBe(7)
  })
  it('follows the instance visible at the playhead', () => {
    const d = doc()
    const early = compTimeFor(d, ['assets', 0, 'layers', 0], 20)
    expect(early.frame).toBe(16)
    expect(early.chain).toEqual([['layers', 1]])
    expect(early.instances).toBe(2)
    const late = compTimeFor(d, ['assets', 0, 'layers', 0], 60)
    expect(late.frame).toBe(15)
    expect(late.chain).toEqual([['layers', 0]])
    expect(late.toRoot(15)).toBe(60)
  })
  it('falls back to the first instance when none is visible', () => {
    const t = compTimeFor(doc(), ['assets', 0, 'layers', 0], 95)
    expect(t.chain).toEqual([['layers', 0]])
    expect(t.frame).toBe(50)
  })
  it('maps through nested precomps (with stretch)', () => {
    const t = compTimeFor(doc(), ['assets', 1, 'layers', 0], 20)
    // root 20 → comp_a (st 4) 16 → comp_b (st 2, sr 2) 7
    expect(t.frame).toBe(7)
    expect(t.chain).toEqual([
      ['layers', 1],
      ['assets', 0, 'layers', 1],
    ])
    expect(t.toRoot(7)).toBe(20)
    expect(t.fromRoot(20)).toBe(7)
  })
  it('flags unused compositions', () => {
    const t = compTimeFor(doc(), ['assets', 2, 'layers', 0], 33)
    expect(t.orphan).toBe(true)
    expect(t.frame).toBe(33)
    expect(t.toRoot(1)).toBeNull()
  })
  it('cannot invert time remapping', () => {
    const d = doc()
    ;(d.layers[1] as PrecompLayer).tm = { a: 0, k: 0.5 }
    const t = compTimeFor(d, ['assets', 0, 'layers', 0], 20)
    expect(t.remapped).toBe(true)
    expect(t.frame).toBe(15)
    expect(t.toRoot(15)).toBeNull()
  })
  it('survives cyclic precomps', () => {
    const d: Animation = {
      fr: 30,
      ip: 0,
      op: 10,
      w: 1,
      h: 1,
      layers: [],
      assets: [
        { id: 'a', layers: [precomp('b', {})] },
        { id: 'b', layers: [precomp('a', {})] },
      ],
    }
    const t = compTimeFor(d, ['assets', 0, 'layers', 0], 5)
    expect(t.orphan).toBe(true)
  })
})
