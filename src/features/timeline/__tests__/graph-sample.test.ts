import { describe, expect, it } from 'vitest'
import testJson from '../../../../docs/test.json?raw'
import en from '@/i18n/locales/en'
import { compAssetIndexOf, getAt, layerPathOf, type NodePath } from '@/lottie/path'
import { evaluateArray, getKeyframes, type AnyProperty } from '@/lottie/property'
import type { Animation } from '@/lottie/types'
import { speedHandles, valueHandles } from '../graph/math'
import {
  buildGraphModel,
  displaySpeed,
  segmentSpeed,
  type GraphCurve,
  type GraphMode,
  type GraphModel,
} from '../graph/model'
import {
  channelChange,
  ColumnCache,
  curveGeometry,
  plainSampler,
  curveHandles,
  easeForHandleDrag,
  sideSpeed,
  speedEditable,
  valueEditable,
  type GraphViewport,
} from '../graph/sample'
import { compMap } from '../time-map'
import { graphDoc, P } from './graph.fixtures'

/** 10 px per frame; one axis unit per pixel, value 0 at y = 1000. */
const vp: GraphViewport = {
  width: 1000,
  x: (f) => f * 10,
  frame: (x) => x / 10,
  y: (n) => 1000 - n,
  n: (y) => 1000 - y,
}

function model(
  doc: Animation,
  paths: readonly (readonly (string | number)[])[],
  mode: GraphMode,
): GraphModel {
  return buildGraphModel(doc, paths, en, {
    mode,
    normalize: false,
    mapFor: (path: NodePath) => compMap(doc, compAssetIndexOf(layerPathOf(path) ?? path)),
  })
}

const curveOf = (m: GraphModel, label: string, dim: number | null = 0): GraphCurve =>
  m.curves.find((c) => c.prop.label === label && c.dim === dim)!

describe('value curves', () => {
  it('pass through their keys, stay flat outside them and follow the evaluator in between', () => {
    const doc = graphDoc()
    const m = model(doc, [P.opacity], 'value')
    const curve = m.curves[0]
    const geo = curveGeometry(curve, 'value', vp, m.fps, new ColumnCache(vp))
    expect(geo.keys).toEqual([
      { index: 0, x: 0, y: 1000 },
      { index: 1, x: 200, y: 900 },
      { index: 2, x: 400, y: 970 },
    ])
    const inside = geo.lines.filter((l) => !l.outside)
    expect(inside).toHaveLength(2)
    expect(inside[0].pts.slice(0, 2)).toEqual([0, 1000])
    expect(inside[0].pts.slice(-2)).toEqual([200, 900])
    const prop = getAt<AnyProperty>(doc, P.opacity)
    for (let i = 2; i < inside[1].pts.length - 2; i += 2) {
      const [x, y] = [inside[1].pts[i], inside[1].pts[i + 1]]
      expect(Number.isInteger(x)).toBe(true)
      expect(1000 - y).toBeCloseTo(evaluateArray(prop, x / 10)[0], 9)
    }
    const after = geo.lines.find((l) => l.outside)!
    expect(after.pts).toEqual([400, 970, 1001, 970])
  })

  it('draw holds as steps with a jump', () => {
    const m = model(graphDoc(), [P.rotation], 'value')
    const geo = curveGeometry(m.curves[0], 'value', vp, m.fps, new ColumnCache(vp))
    const hold = geo.lines.find((l) => l.hold)!
    expect(hold.pts).toEqual([150, 910, 300, 910])
    expect(geo.jumps).toEqual([[300, 910, 955]])
  })

  it('map precomp keys to root time', () => {
    const m = model(graphDoc(), [P.inner], 'value')
    const geo = curveGeometry(m.curves[0], 'value', vp, m.fps, new ColumnCache(vp))
    expect(geo.keys.map((k) => k.x)).toEqual([100, 500])
  })

  it('skip segments outside the view', () => {
    const narrow: GraphViewport = { ...vp, width: 100 }
    const m = model(graphDoc(), [P.opacity], 'value')
    const geo = curveGeometry(m.curves[0], 'value', narrow, m.fps, new ColumnCache(narrow))
    expect(geo.lines.filter((l) => !l.outside)).toHaveLength(1)
    expect(geo.keys.map((k) => k.index)).toEqual([0])
  })
})

describe('plain segment sampling', () => {
  it('equals the evaluator on every non-spatial segment (fixtures and docs/test.json)', () => {
    const docs = [graphDoc(), JSON.parse(testJson) as Animation]
    let checked = 0
    for (const doc of docs) {
      const paths: NodePath[] = []
      const visit = (value: unknown, path: NodePath) => {
        if (!value || typeof value !== 'object') return
        const k = (value as { k?: unknown }).k
        if (Array.isArray(k) && k.length > 1 && typeof (k[0] as { t?: unknown })?.t === 'number') {
          paths.push(path)
          return
        }
        for (const [key, child] of Object.entries(value))
          visit(child, [...path, Array.isArray(value) ? Number(key) : key])
      }
      visit(doc.layers, ['layers'])
      const m = model(doc, paths, 'value')
      for (const p of m.props) {
        for (const seg of p.segments) {
          if (seg.spatial || seg.hold) continue
          for (const dim of p.shown) {
            const sample = plainSampler(seg, dim)
            for (let i = 1; i < 12; i++) {
              const t = seg.t0 + ((seg.t1 - seg.t0) * i) / 12
              expect(sample(t)).toBe(evaluateArray(p.prop, t)[dim])
              checked++
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })
})

describe('speed curves', () => {
  it('sample the analytic speed, with the incoming and outgoing speed at each key', () => {
    const m = model(graphDoc(), [P.opacity], 'speed')
    const curve = m.curves[0]
    const p = curve.prop
    const geo = curveGeometry(curve, 'speed', vp, m.fps, new ColumnCache(vp))
    const seg = p.segments[1]
    const line = geo.lines.filter((l) => !l.outside)[1]
    for (let i = 2; i < line.pts.length - 2; i += 2) {
      const t = line.pts[i] / 10
      const expected = displaySpeed(p, segmentSpeed(seg, 0, (t - seg.t0) / (seg.t1 - seg.t0)), 30)
      expect(1000 - line.pts[i + 1]).toBeCloseTo(expected, 6)
    }
    const key = geo.keys[1]
    expect(1000 - key.y).toBeCloseTo(displaySpeed(p, sideSpeed(seg, 0, 'out'), 30), 6)
    expect(key.inY).toBeDefined()
    expect(1000 - key.inY!).toBeCloseTo(displaySpeed(p, sideSpeed(p.segments[0], 0, 'in'), 30), 6)
    expect(geo.jumps.some((j) => j[0] === 200)).toBe(true)
  })

  it('stay at zero on holds', () => {
    const m = model(graphDoc(), [P.rotation], 'speed')
    const geo = curveGeometry(m.curves[0], 'speed', vp, m.fps, new ColumnCache(vp))
    expect(geo.lines.find((l) => l.hold)!.pts).toEqual([150, 1000, 300, 1000])
  })
})

describe('handles', () => {
  it('are the bezier control points in the value graph', () => {
    const m = model(graphDoc(), [P.opacity], 'value')
    const curve = m.curves[0]
    const handles = curveHandles(curve, 'value', vp, m.fps, new Set([1]))
    expect(handles.map((h) => h.side)).toEqual(['in', 'out'])
    const seg0 = curve.prop.segments[0]
    const h0 = valueHandles(seg0.t0, 0, seg0.t1, 100, seg0.eases[0])
    expect(handles[0].x).toBeCloseTo(h0.in.t * 10, 9)
    expect(handles[0].y).toBeCloseTo(1000 - h0.in.v, 9)
    expect([handles[0].ax, handles[0].ay]).toEqual([200, 900])
  })

  it('are hidden on holds and curved motion paths, shown on straight ones', () => {
    const doc = graphDoc()
    const rotation = model(doc, [P.rotation], 'value').curves[0]
    expect(curveHandles(rotation, 'value', vp, 30, new Set([1])).map((h) => h.side)).toEqual(['in'])
    const position = model(doc, [P.position], 'value')
    const x = curveOf(position, 'Position', 0)
    expect(curveHandles(x, 'value', vp, 30, new Set([0]))).toEqual([])
    expect(curveHandles(x, 'value', vp, 30, new Set([1])).map((h) => h.side)).toEqual(['out'])
    expect(valueEditable(x.prop.segments[0])).toBe(false)
    expect(valueEditable(x.prop.segments[1])).toBe(true)
    // The speed graph edits the easing of every spatial segment.
    const speed = model(doc, [P.position], 'speed').curves[0]
    expect(curveHandles(speed, 'speed', vp, 30, new Set([0, 1])).map((h) => h.side)).toEqual([
      'out',
      'in',
      'out',
    ])
  })

  it('get a grabbable stub when they have no length', () => {
    const doc = graphDoc()
    const kfs = getKeyframes(getAt<AnyProperty>(doc, P.opacity))!
    kfs[0].o = { x: [0], y: [0] }
    const curve = model(doc, [P.opacity], 'value').curves[0]
    const [out] = curveHandles(curve, 'value', vp, 30, new Set([0]))
    expect(Math.hypot(out.x - out.ax, out.y - out.ay)).toBeCloseTo(14, 6)
  })

  it('show influence and speed in the speed graph', () => {
    const m = model(graphDoc(), [P.position], 'speed')
    const curve = m.curves[0]
    const seg = curve.prop.segments[0]
    const [out] = curveHandles(curve, 'speed', vp, 30, new Set([0]))
    const h = speedHandles(seg.t1 - seg.t0, seg.length, seg.eases[0]).out
    expect(out.x).toBeCloseTo((seg.t0 + h.influence * (seg.t1 - seg.t0)) * 10, 9)
    expect(1000 - out.y).toBeCloseTo(displaySpeed(curve.prop, h.speed, 30), 9)
    expect(out.y).toBe(out.ay)
    expect(channelChange(seg, null)).toBe(seg.length)
    expect(speedEditable(seg, null)).toBe(true)
  })

  it('dragged onto themselves keep the easing (value and speed graphs)', () => {
    const doc = graphDoc()
    const cases: [readonly (string | number)[], GraphMode][] = [
      [P.opacity, 'value'],
      [P.scale, 'value'],
      [P.opacity, 'speed'],
      [P.scale, 'speed'],
      [P.position, 'speed'],
      [P.inner, 'value'],
      [P.inner, 'speed'],
    ]
    let checked = 0
    for (const [path, mode] of cases) {
      const m = model(doc, [path], mode)
      for (const curve of m.curves) {
        const keys = new Set(curve.prop.kfs.map((_, i) => i))
        for (const h of curveHandles(curve, mode, vp, m.fps, keys)) {
          if (Math.hypot(h.x - h.ax, h.y - h.ay) <= 14.001) continue // stubs are not positions
          const ease = easeForHandleDrag(
            curve,
            mode,
            h.seg,
            h.side,
            vp.frame(h.x),
            vp.n(h.y),
            m.fps,
          )!
          const current = h.seg.eases[curve.dim ?? 0]
          if (h.side === 'out') {
            expect(ease.x1).toBeCloseTo(current.x1, 6)
            expect(ease.y1).toBeCloseTo(current.y1, 6)
          } else {
            expect(ease.x2).toBeCloseTo(current.x2, 6)
            expect(ease.y2).toBeCloseTo(current.y2, 6)
          }
          checked++
        }
      }
    }
    expect(checked).toBeGreaterThan(8)
  })

  it('clamp y on spatial segments (lottie-web mishandles over- and undershoot there)', () => {
    const m = model(graphDoc(), [P.position], 'speed')
    const curve = m.curves[0]
    const seg = curve.prop.segments[0]
    const ease = easeForHandleDrag(curve, 'speed', seg, 'out', vp.frame(50), 1e6, m.fps)!
    expect(ease.y1).toBe(1)
  })
})
