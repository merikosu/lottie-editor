import { describe, expect, it } from 'vitest'
import testJson from '../../../../docs/test.json?raw'
import en from '@/i18n/locales/en'
import { compAssetIndexOf, getAt, layerPathOf, type NodePath } from '@/lottie/path'
import { evaluateArray, getKeyframes, type AnyProperty } from '@/lottie/property'
import type { Animation, Layer } from '@/lottie/types'
import bounce from '@/samples/bounce.json'
import {
  AXIS_COLORS,
  buildGraphModel,
  CURVE_COLORS,
  displaySpeed,
  MAX_GRAPH_PROPS,
  propPrefix,
  robustRange,
  segmentSpeed,
  segmentsOf,
  speedChannels,
  storedSpeed,
  type GraphModel,
  type GraphModelOptions,
} from '../graph/model'
import { compMap } from '../time-map'
import { graphDoc, P } from './graph.fixtures'

const mapFor = (doc: Animation) => (path: NodePath) =>
  compMap(doc, compAssetIndexOf(layerPathOf(path) ?? path))

function build(
  doc: Animation,
  paths: readonly (readonly (string | number)[])[],
  opts: Partial<GraphModelOptions> = {},
): GraphModel {
  return buildGraphModel(doc, paths, en, {
    mode: 'value',
    normalize: false,
    mapFor: mapFor(doc),
    ...opts,
  })
}

const ids = (m: GraphModel) =>
  m.curves.map((c) => `${c.prop.label}${c.dimLabel ? ` ${c.dimLabel}` : ''}`)

describe('value graph curves', () => {
  it('draws one curve per shown dimension: no z on 2-D layers, no alpha on colors', () => {
    const doc = graphDoc()
    const m = build(doc, [P.position, P.scale, P.opacity, P.fill])
    expect(ids(m)).toEqual([
      'Position X',
      'Position Y',
      'Scale X',
      'Scale Y',
      'Opacity',
      'Color R',
      'Color G',
      'Color B',
    ])
    const position = m.curves[0].prop
    expect(position.dims).toBe(3)
    expect(position.shown).toEqual([0, 1])
    expect(m.curves[0].color).toBe(AXIS_COLORS[0])
    expect(m.curves[1].color).toBe(AXIS_COLORS[1])
    expect(m.curves[4].color).toBe(CURVE_COLORS[0])
    const fill = m.curves[5].prop
    expect(fill.factor).toBe(255)
    expect(fill.precision).toBe(0)
    expect(m.curves[5].max).toBeCloseTo(255, 9)
  })

  it('keeps a varying z and the z of 3-D layers', () => {
    const doc = graphDoc()
    ;(doc.layers[0] as Layer).ddd = 1
    expect(build(doc, [P.position]).curves.map((c) => c.dimLabel)).toEqual(['X', 'Y', 'Z'])
    const moved = graphDoc()
    const kfs = getKeyframes<number[]>(getAt<AnyProperty>(moved, P.position))!
    kfs[2].s = [300, 300, 50]
    expect(build(moved, [P.position]).curves).toHaveLength(3)
  })

  it('colors split position axes like vector dimensions', () => {
    const m = build(graphDoc(), [P.splitX])
    expect(m.curves).toHaveLength(1)
    expect(m.curves[0].color).toBe(AXIS_COLORS[0])
    expect(m.curves[0].dimLabel).toBe('')
  })

  it('orders properties like the document, whatever order they were asked in', () => {
    const doc = graphDoc()
    const m = build(doc, [P.inner, P.fill, P.opacity, P.rotation, P.position, P.splitX])
    expect(m.props.map((p) => p.label)).toEqual([
      'Position',
      'Rotation',
      'Opacity',
      'Color',
      'X position',
      'Rotation',
    ])
    expect(m.props.map((p) => p.owner)).toEqual(['Ball', 'Ball', 'Ball', 'Ball', 'Null', 'Inner'])
  })

  it('names what a property belongs to: shape item, effect, mask', () => {
    const doc = graphDoc()
    const ball = doc.layers[0] as unknown as { ef?: unknown[]; masksProperties?: unknown[] }
    ball.ef = [
      {
        ty: 5,
        nm: 'Controls',
        ef: [
          {
            ty: 0,
            nm: 'Slider',
            v: {
              a: 1,
              k: [
                { t: 0, s: [0], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } },
                { t: 9, s: [5] },
              ],
            },
          },
        ],
      },
    ]
    ball.masksProperties = [
      {
        mode: 'a',
        o: {
          a: 1,
          k: [
            { t: 0, s: [0], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } },
            { t: 9, s: [100] },
          ],
        },
      },
    ]
    const m = build(doc, [
      P.fill,
      P.opacity,
      ['layers', 0, 'ef', 0, 'ef', 0, 'v'],
      ['layers', 0, 'masksProperties', 0, 'o'],
    ])
    const byLabel = (label: string) => m.props.find((p) => p.label === label)!
    expect(byLabel('Color').context).toBe(en.common.shapeTypes.fl)
    expect(byLabel('Opacity').context).toBe('')
    expect(byLabel('Slider').context).toBe('Controls')
    expect(byLabel('Mask opacity').context).toBe('Mask 1')
    expect(propPrefix(byLabel('Color'), false)).toBe(en.common.shapeTypes.fl)
    expect(propPrefix(byLabel('Color'), true)).toBe(`Ball › ${en.common.shapeTypes.fl}`)
    expect(propPrefix(byLabel('Opacity'), false)).toBe('')
  })

  it('counts properties without curves and ignores static ones', () => {
    const doc = graphDoc()
    const m = build(doc, [P.path, ['layers', 0, 'ks', 'a'], ['layers', 9, 'ks', 'o']])
    expect(m.curves).toEqual([])
    expect(m.unsupported).toBe(1)
  })

  it('shows at most MAX_GRAPH_PROPS properties', () => {
    const doc = graphDoc()
    const template = doc.layers[1]
    doc.layers = Array.from({ length: 40 }, (_, i) => ({
      ...structuredClone(template),
      ind: i + 1,
    }))
    const paths = doc.layers.map((_, i) => ['layers', i, 'ks', 'r'])
    expect(build(doc, paths).props).toHaveLength(MAX_GRAPH_PROPS)
  })

  it('knows which properties can be edited here', () => {
    const doc = graphDoc()
    expect(build(doc, [P.opacity]).props[0].editable).toBe(true)
    const locked = build(doc, [P.opacity], { isLocked: () => true })
    expect(locked.props[0].editable).toBe(false)
    const unplaced = build(doc, [P.opacity], { mapFor: () => null })
    expect(unplaced.props[0].editable).toBe(false)
  })

  it('covers the overshoot of the easing in its extent', () => {
    const doc = graphDoc()
    const kfs = getKeyframes(getAt<AnyProperty>(doc, P.opacity))!
    kfs[0].i = { x: [0.6], y: [1.6] }
    const [curve] = build(doc, [P.opacity]).curves
    expect(curve.max).toBeGreaterThan(100)
    expect(curve.min).toBe(0)
  })

  it('normalizes every curve to 0..1 (flat curves in the middle)', () => {
    const m = build(graphDoc(), [P.position, P.opacity], { normalize: true })
    expect(m.min).toBeCloseTo(0, 9)
    expect(m.max).toBeCloseTo(1, 9)
    for (const c of m.curves) {
      expect((c.min - c.offset) / c.scale).toBeCloseTo(0, 9)
      expect((c.max - c.offset) / c.scale).toBeCloseTo(1, 9)
    }
    const doc = graphDoc()
    for (const kf of getKeyframes<number[]>(getAt<AnyProperty>(doc, P.opacity))!) kf.s = [40]
    const [flat] = build(doc, [P.opacity], { normalize: true }).curves
    expect((40 - flat.offset) / flat.scale).toBeCloseTo(0.5, 9)
    expect(flat.scale).toBe(40)
    const shared = build(graphDoc(), [P.position, P.opacity])
    expect(shared.curves.every((c) => c.offset === 0 && c.scale === 1)).toBe(true)
    expect(shared.min).toBe(0)
    expect(shared.max).toBeGreaterThanOrEqual(300)
  })
})

describe('segments', () => {
  it('mirror the evaluator: spatial, curved, hold, legacy end values', () => {
    const doc = graphDoc()
    const m = build(doc, [P.position, P.rotation, P.legacy, P.scale])
    const [position, scale, rotation, legacy] = m.props
    expect(m.props.map((p) => p.label)).toEqual(['Position', 'Scale', 'Rotation', 'Rotation'])
    expect(position.segments.map((s) => [s.spatial, s.curved])).toEqual([
      [true, true],
      [true, false],
    ])
    expect(position.segments[1].length).toBeCloseTo(180, 6)
    expect(position.segments[0].length).toBeGreaterThan(Math.hypot(200, 20))
    expect(position.spatial).toBe(true)
    expect(rotation.segments.map((s) => s.hold)).toEqual([false, true, false])
    expect(scale.linked).toBe(false)
    expect(scale.segments[0].eases[0]).toEqual({ x1: 0.1, y1: 0, x2: 0.9, y2: 1 })
    expect(scale.segments[0].eases[1]).toEqual({ x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.8 })
    expect(legacy.label).toBe('Rotation')
    expect(legacy.keyValues).toEqual([[0], [180], [90]])
    expect(legacy.segments.map((s) => s.end)).toEqual([[180], [90]])
  })

  it('spatial segments use one easing for every dimension, like the evaluator', () => {
    const segs = segmentsOf(
      [
        {
          t: 0,
          s: [0, 0],
          to: [1, 1],
          ti: [0, 0],
          o: { x: [0.2, 0.9], y: [0, 0] },
          i: { x: [0.8, 0.1], y: [1, 1] },
        },
        { t: 10, s: [10, 10] },
      ],
      2,
    )
    expect(segs[0].eases[1]).toEqual(segs[0].eases[0])
    expect(segs[0].linked).toBe(true)
  })

  it('treat a hold with tangents as a hold (the evaluator checks hold first)', () => {
    const segs = segmentsOf(
      [
        { t: 0, s: [0, 0], to: [5, 5], ti: [0, 0], h: 1 },
        { t: 10, s: [10, 10] },
      ],
      2,
    )
    expect(segs[0].hold).toBe(true)
    expect(segs[0].spatial).toBe(false)
  })
})

describe('speed graph', () => {
  it('draws one curve per independent easing', () => {
    const doc = graphDoc()
    const m = build(doc, [P.position, P.scale, P.opacity, P.fill], { mode: 'speed' })
    const byLabel = (label: string) => m.curves.filter((c) => c.prop.label === label)
    expect(byLabel('Position').map((c) => c.dim)).toEqual([null])
    expect(byLabel('Scale').map((c) => c.dim)).toEqual([0, 1])
    expect(byLabel('Opacity').map((c) => c.dim)).toEqual([0])
    expect(byLabel('Color').map((c) => c.dim)).toEqual([null])
    expect(speedChannels(m.props[0])).toEqual([null])
    // Speed curves always include zero, so the baseline is visible.
    for (const c of m.curves) expect(c.min).toBeLessThanOrEqual(0)
  })

  it('matches the derivative of the evaluated values (1-D, per dimension, motion paths, legacy)', () => {
    const doc = graphDoc()
    const m = build(doc, [P.position, P.scale, P.opacity, P.fill, P.legacy, P.rotation])
    const h = 1e-4
    let checked = 0
    for (const p of m.props) {
      for (const seg of p.segments) {
        if (seg.hold) continue
        const T = seg.t1 - seg.t0
        for (let i = 1; i < 20; i++) {
          const x = i / 20
          const t = seg.t0 + x * T
          const a = evaluateArray(p.prop, t - h)
          const b = evaluateArray(p.prop, t + h)
          const velocity = a.map((v, d) => (b[d] - v) / (2 * h))
          for (const dim of p.spatial || p.linked ? [null] : p.shown) {
            if (p.dims === 1 && dim === null) continue
            const analytic = segmentSpeed(seg, dim, x)
            const numeric = dim === null ? Math.hypot(...velocity) : velocity[dim]
            const tolerance = Math.max(1e-3, Math.abs(numeric) * 0.01)
            expect(Math.abs(analytic - numeric)).toBeLessThan(tolerance)
            checked++
          }
          if (p.dims === 1) {
            expect(segmentSpeed(seg, 0, x)).toBeCloseTo(velocity[0], 3)
            checked++
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(150)
  })

  it('fits the typical speeds, letting rare spikes run off-screen', () => {
    const calm = Array.from({ length: 200 }, (_, i) => Math.sin(i / 10) * 100)
    expect(robustRange(calm)).toEqual([Math.min(...calm), Math.max(...calm)])
    const spiky = [...calm, 5000, 5100, -4000]
    const [lo, hi] = robustRange(spiky)
    expect(hi).toBeLessThan(400)
    expect(lo).toBeGreaterThan(-400)
    // Mostly zero with a few moves: those moves are the curve, never cut.
    expect(robustRange([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50])).toEqual([
      0, 50,
    ])
    expect(robustRange([])).toEqual([0, 0])
    expect(robustRange([Number.NaN, 3])).toEqual([0, 3])
  })

  it('a one-frame jump does not flatten the other speed curves', () => {
    const doc = graphDoc()
    const kfs = getKeyframes(getAt<AnyProperty>(doc, P.opacity))!
    // 0 → 100 in one frame, then a slow drift over 60 frames.
    kfs.splice(
      0,
      kfs.length,
      { t: 0, s: [0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
      { t: 1, s: [100], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
      { t: 61, s: [40] },
    )
    const [curve] = build(doc, [P.opacity], { mode: 'speed' }).curves
    // The drift is 1 %/frame = 30 %/s; the jump is 3000 %/s.
    expect(curve.min).toBeLessThan(-29)
    expect(curve.min).toBeGreaterThan(-200)
    expect(curve.max).toBeLessThan(200)
  })

  it('is zero on holds', () => {
    const m = build(graphDoc(), [P.rotation], { mode: 'speed' })
    const hold = m.props[0].segments[1]
    expect(segmentSpeed(hold, 0, 0.5)).toBe(0)
  })

  it('converts speeds to units per root second (precomp stretch) and back', () => {
    const doc = graphDoc()
    const m = build(doc, [P.inner], { mode: 'speed' })
    const p = m.props[0]
    expect(p.map?.toRoot(0)).toBe(10)
    expect(p.map?.toRoot(20)).toBe(50)
    // 360° over 20 local frames = 18°/frame; the precomp plays at half speed (sr 2), 30 fps.
    expect(displaySpeed(p, 18, 30)).toBeCloseTo(270, 9)
    expect(storedSpeed(p, 270, 30)).toBeCloseTo(18, 9)
    const colors = build(doc, [P.fill], { mode: 'speed' }).props[0]
    expect(displaySpeed(colors, 1, 30)).toBeCloseTo(255 * 30, 9)
    expect(storedSpeed(colors, 255 * 30, 30)).toBeCloseTo(1, 9)
  })
})

describe('real files', () => {
  it('builds curves for every animated number of docs/test.json and the bounce sample', () => {
    for (const source of [
      JSON.parse(testJson) as Animation,
      structuredClone(bounce) as unknown as Animation,
    ]) {
      const paths: NodePath[] = []
      const visit = (value: unknown, path: NodePath) => {
        if (!value || typeof value !== 'object') return
        const k = (value as { k?: unknown }).k
        if (Array.isArray(k) && k.length > 1 && typeof (k[0] as { t?: unknown })?.t === 'number') {
          paths.push(path)
        }
        for (const [key, child] of Object.entries(value)) {
          visit(child, [...path, Array.isArray(value) ? Number(key) : key])
        }
      }
      visit(source.layers, ['layers'])
      visit(source.assets, ['assets'])
      for (const mode of ['value', 'speed'] as const) {
        const m = build(source, paths, { mode })
        expect(m.curves.length).toBeGreaterThan(0)
        for (const c of m.curves) {
          expect(Number.isFinite(c.min)).toBe(true)
          expect(Number.isFinite(c.max)).toBe(true)
        }
      }
    }
  })

  it('bounce: the ball moves straight (one speed curve) and squashes with linked scale', () => {
    const doc = structuredClone(bounce) as unknown as Animation
    const position = ['layers', 0, 'ks', 'p']
    const scale = ['layers', 0, 'ks', 's']
    const m = build(doc, [position, scale], { mode: 'speed' })
    expect(m.curves.map((c) => [c.prop.label, c.dim])).toEqual([
      ['Position', null],
      ['Scale', null],
    ])
    expect(m.props[0].segments.every((s) => s.spatial && !s.curved)).toBe(true)
    const values = build(doc, [position, scale])
    expect(values.curves.map((c) => c.dimLabel)).toEqual(['X', 'Y', 'X', 'Y'])
  })
})
