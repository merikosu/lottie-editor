import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import type { Animation } from '@/lottie/types'
import { describeProperty } from '../describe'

const S = (k: number | number[]) => ({ a: 0 as const, k })

const doc = {
  fr: 30,
  ip: 0,
  op: 60,
  w: 100,
  h: 100,
  layers: [
    {
      ty: 4,
      ip: 0,
      op: 60,
      st: 0,
      ks: { p: { s: true, x: S(1), y: S(2) }, r: S(0), o: S(100) },
      masksProperties: [{ mode: 'a', pt: S(0), o: S(100), x: S(0) }],
      ef: [
        {
          ty: 5,
          nm: 'Controls',
          ef: [
            { ty: 0, nm: 'Amplitude', v: S(5) },
            { ty: 2, nm: 'Tint', v: S([1, 0, 0, 1]) },
          ],
        },
      ],
      shapes: [
        {
          ty: 'gr',
          it: [
            { ty: 'rc', s: S([10, 10]), p: S([0, 0]), r: S(0) },
            {
              ty: 'st',
              c: S([0, 0, 0, 1]),
              o: S(100),
              w: S(2),
              d: [
                { n: 'd', v: S(4) },
                { n: 'g', v: S(2) },
                { n: 'o', v: S(0) },
              ],
            },
            {
              ty: 'gf',
              g: { p: 2, k: S([0, 0, 0, 0, 1, 1, 1, 1]) },
              s: S([0, 0]),
              e: S([1, 0]),
              t: 1,
              o: S(100),
            },
            { ty: 'rp', c: S(3), o: S(0), tr: { p: S([0, 0]), so: S(100), eo: S(50) } },
            { ty: 'tr', p: S([0, 0]), s: S([100, 100]) },
          ],
        },
      ],
    },
    { ty: 0, refId: 'c', ip: 0, op: 60, st: 0, ks: {}, tm: S(0) },
    {
      ty: 5,
      ip: 0,
      op: 60,
      st: 0,
      ks: {},
      t: { d: { k: [{ t: 0, s: { t: 'a', s: 10, f: 'x' } }] } },
    },
  ],
} as unknown as Animation

const d = (...path: (string | number)[]) => describeProperty(doc, path, en)

describe('describeProperty', () => {
  it('names layer transform properties with units', () => {
    expect(d('layers', 0, 'ks', 'r')).toMatchObject({
      label: 'Rotation',
      unit: '°',
      kind: 'number',
    })
    expect(d('layers', 0, 'ks', 'o')).toMatchObject({ label: 'Opacity', unit: '%' })
    expect(d('layers', 0, 'ks', 'p', 'x')).toMatchObject({ label: 'X position' })
  })
  it('names shape item properties by type', () => {
    const g = ['layers', 0, 'shapes', 0, 'it'] as const
    expect(d(...g, 0, 's')).toMatchObject({ label: 'Size', unit: 'px', axes: ['W', 'H'] })
    expect(d(...g, 1, 'c')).toMatchObject({ label: 'Color', kind: 'color' })
    expect(d(...g, 1, 'w')).toMatchObject({ label: 'Width', unit: 'px' })
    expect(d(...g, 2, 's')).toMatchObject({ label: 'Start point' })
    expect(d(...g, 4, 's')).toMatchObject({ label: 'Scale', unit: '%' })
  })
  it('recognizes gradients, dashes, repeater transforms and masks', () => {
    const g = ['layers', 0, 'shapes', 0, 'it'] as const
    expect(d(...g, 2, 'g', 'k')).toMatchObject({ kind: 'gradient', label: 'Stops' })
    expect(d(...g, 1, 'd', 0, 'v')).toMatchObject({ label: 'Dash' })
    expect(d(...g, 1, 'd', 1, 'v')).toMatchObject({ label: 'Gap' })
    expect(d(...g, 1, 'd', 2, 'v')).toMatchObject({ label: 'Offset' })
    expect(d(...g, 3, 'tr', 'eo')).toMatchObject({ label: 'End opacity', unit: '%' })
    expect(d('layers', 0, 'masksProperties', 0, 'x')).toMatchObject({
      label: 'Expansion',
      unit: 'px',
    })
    expect(d('layers', 0, 'masksProperties', 0, 'pt')).toMatchObject({ kind: 'path' })
  })
  it('handles effects, time remap and text documents', () => {
    expect(d('layers', 0, 'ef', 0, 'ef', 0, 'v')).toMatchObject({
      label: 'Amplitude',
      kind: 'number',
    })
    expect(d('layers', 0, 'ef', 0, 'ef', 1, 'v')).toMatchObject({ label: 'Tint', kind: 'color' })
    expect(d('layers', 1, 'tm')).toMatchObject({ label: 'Time remap', unit: 's' })
    expect(d('layers', 2, 't', 'd')).toMatchObject({ kind: 'text' })
  })
  it('falls back to the JSON key', () => {
    expect(d('layers', 0, 'ks', 'unknown')).toMatchObject({ label: 'unknown', kind: 'number' })
  })
})
