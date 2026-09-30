import { describe, expect, it } from 'vitest'
import { evaluateScalar } from '@/lottie/property'
import { precompInnerFrame } from '@/lottie/time'
import type { Keyframe, Layer, PrecompLayer, ShapeLayer, TextLayer } from '@/lottie/types'
import {
  canSetTrackMatte,
  disableTimeRemap,
  enableTimeRemap,
  matteSourceIndex,
  matteTargets,
  moveLayerInTime,
  parentCandidates,
  setLayerParent,
  setLayerStretch,
  setTrackMatte,
} from '../layer-edit'

const linear = { o: { x: 0.167, y: 0.167 }, i: { x: 0.833, y: 0.833 } }

function shapeLayer(ind: number, extra: Partial<ShapeLayer> = {}): ShapeLayer {
  return { ty: 4, ind, nm: `L${ind}`, ip: 0, op: 60, st: 0, ks: {}, shapes: [], ...extra }
}

function times(prop: { k: unknown }): number[] {
  return (prop.k as Keyframe<unknown>[]).map((k) => k.t)
}

describe('moveLayerInTime', () => {
  it('moves in/out/start and every owned keyframe', () => {
    const layer = shapeLayer(1, {
      ip: 10,
      op: 50,
      ks: {
        o: {
          a: 1,
          k: [
            { t: 10, s: [0], ...linear },
            { t: 20, s: [100] },
          ],
        },
      },
      shapes: [
        {
          ty: 'gr',
          it: [
            {
              ty: 'fl',
              c: {
                a: 1,
                k: [
                  { t: 12, s: [1, 0, 0, 1], ...linear },
                  { t: 30, s: [0, 0, 1, 1] },
                ],
              },
              o: { a: 0, k: 100 },
            },
          ],
        },
      ],
      masksProperties: [
        {
          mode: 'a',
          pt: { a: 0, k: { i: [], o: [], v: [], c: true } },
          o: {
            a: 1,
            k: [
              { t: 15, s: [0], ...linear },
              { t: 25, s: [100] },
            ],
          },
        },
      ],
    })
    moveLayerInTime(layer, 5)
    expect([layer.ip, layer.op, layer.st]).toEqual([15, 55, 5])
    expect(times(layer.ks.o!)).toEqual([15, 25])
    const group = layer.shapes[0] as { it: { c: { k: unknown } }[] }
    expect(times(group.it[0].c)).toEqual([17, 35])
    expect(times(layer.masksProperties![0].o!)).toEqual([20, 30])
  })
  it('moves text document keyframes', () => {
    const layer: TextLayer = {
      ty: 5,
      ip: 0,
      op: 30,
      st: 0,
      ks: {},
      t: {
        d: {
          k: [
            { t: 0, s: { t: 'a', s: 1, f: 'x' } },
            { t: 10, s: { t: 'b', s: 1, f: 'x' } },
          ],
        },
      },
    }
    moveLayerInTime(layer, -3)
    expect(layer.t.d.k.map((k) => k.t)).toEqual([-3, 7])
  })
  it('is a no-op for zero or invalid deltas', () => {
    const layer = shapeLayer(1)
    moveLayerInTime(layer, 0)
    moveLayerInTime(layer, Number.NaN)
    expect([layer.ip, layer.op, layer.st]).toEqual([0, 60, 0])
  })
})

describe('setLayerStretch', () => {
  it('scales in/out and keyframes around the start time', () => {
    const layer: PrecompLayer = {
      ty: 0,
      refId: 'c',
      ip: 10,
      op: 40,
      st: 10,
      ks: {
        r: {
          a: 1,
          k: [
            { t: 10, s: [0], ...linear },
            { t: 20, s: [90] },
          ],
        },
      },
    }
    setLayerStretch(layer, 2)
    expect([layer.ip, layer.op, layer.sr]).toEqual([10, 70, 2])
    expect(times(layer.ks.r!)).toEqual([10, 30])
    setLayerStretch(layer, 1)
    expect([layer.ip, layer.op, layer.sr]).toEqual([10, 40, 1])
    expect(times(layer.ks.r!)).toEqual([10, 20])
  })
  it('keeps the content timing consistent for precomps', () => {
    const layer: PrecompLayer = { ty: 0, refId: 'c', ip: 0, op: 30, st: 0, ks: {} }
    setLayerStretch(layer, 0.5)
    // Content frame 30 now plays at comp frame 15.
    expect(precompInnerFrame(layer, 15, 30)).toBe(30)
    expect(layer.op).toBe(15)
  })
  it('ignores invalid values', () => {
    const layer = shapeLayer(1)
    setLayerStretch(layer, 0)
    setLayerStretch(layer, -1)
    expect(layer.sr).toBeUndefined()
  })
})

describe('time remap', () => {
  it('adds keys that keep the content timing', () => {
    const layer: PrecompLayer = { ty: 0, refId: 'c', ip: 12, op: 72, st: 6, sr: 1, ks: {} }
    const fps = 30
    const before = [12, 30, 50, 71].map((f) => precompInnerFrame(layer, f, fps))
    enableTimeRemap(layer, fps)
    expect(layer.tm?.a).toBe(1)
    const after = [12, 30, 50, 71].map((f) => precompInnerFrame(layer, f, fps))
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i], 2))
    expect(evaluateScalar(layer.tm, 12)).toBeCloseTo(0.2)
  })
  it('respects stretch', () => {
    const layer: PrecompLayer = { ty: 0, refId: 'c', ip: 0, op: 60, st: 0, sr: 2, ks: {} }
    enableTimeRemap(layer, 30)
    expect(precompInnerFrame(layer, 40, 30)).toBeCloseTo(20, 2)
  })
  it('does not replace an existing remap and can be removed', () => {
    const tm = { a: 0 as const, k: 1 }
    const layer: PrecompLayer = { ty: 0, refId: 'c', ip: 0, op: 60, st: 0, ks: {}, tm }
    enableTimeRemap(layer, 30)
    expect(layer.tm).toBe(tm)
    disableTimeRemap(layer)
    expect(layer.tm).toBeUndefined()
  })
})

/** 0 ← 1 ← 2 (2 is the child of 1, which is the child of 0), plus an unrelated layer. */
function chain(): Layer[] {
  return [shapeLayer(1), shapeLayer(2, { parent: 1 }), shapeLayer(3, { parent: 2 }), shapeLayer(4)]
}

describe('parenting', () => {
  it('excludes the layer itself and its descendants', () => {
    expect(parentCandidates(chain(), 0)).toEqual([3])
    expect(parentCandidates(chain(), 2)).toEqual([0, 1, 3])
    expect(parentCandidates(chain(), 9)).toEqual([])
  })
  it('sets and clears parents', () => {
    const layers = chain()
    setLayerParent(layers, 3, 2)
    expect(layers[3].parent).toBe(3)
    setLayerParent(layers, 3, null)
    expect(layers[3].parent).toBeUndefined()
  })
  it('refuses cycles', () => {
    const layers = chain()
    setLayerParent(layers, 0, 2)
    expect(layers[0].parent).toBeUndefined()
    setLayerParent(layers, 1, 1)
    expect(layers[1].parent).toBe(1)
  })
  it('gives the parent an index when missing', () => {
    const layers: Layer[] = [shapeLayer(5), { ...shapeLayer(0), ind: undefined }]
    setLayerParent(layers, 0, 1)
    expect(layers[1].ind).toBe(6)
    expect(layers[0].parent).toBe(6)
  })
})

describe('track mattes', () => {
  it('finds the source above (td) or by tp', () => {
    const layers: Layer[] = [
      shapeLayer(1, { td: 1 }),
      shapeLayer(2, { tt: 1 }),
      shapeLayer(3),
      shapeLayer(4, { tt: 3, tp: 3 }),
    ]
    expect(matteSourceIndex(layers, 1)).toBe(0)
    expect(matteSourceIndex(layers, 3)).toBe(2)
    expect(matteSourceIndex(layers, 2)).toBe(-1)
    expect(matteTargets(layers, 0)).toEqual([1])
    expect(matteTargets(layers, 2)).toEqual([])
  })
  it('sets a matte using the layer above', () => {
    const layers: Layer[] = [shapeLayer(1), shapeLayer(2)]
    expect(canSetTrackMatte(layers, 0)).toBe(false)
    expect(canSetTrackMatte(layers, 1)).toBe(true)
    setTrackMatte(layers, 1, 3)
    expect(layers[1].tt).toBe(3)
    expect(layers[0].td).toBe(1)
    // Changing the mode keeps the source.
    setTrackMatte(layers, 1, 2)
    expect(layers[1].tt).toBe(2)
    expect(layers[0].td).toBe(1)
  })
  it('removing the matte hides the former source', () => {
    const layers: Layer[] = [shapeLayer(1, { td: 1 }), shapeLayer(2, { tt: 1 })]
    setTrackMatte(layers, 1, 0)
    expect(layers[1].tt).toBeUndefined()
    expect(layers[0].td).toBeUndefined()
    expect(layers[0].hd).toBe(true)
  })
  it('keeps a source that is still used by another layer', () => {
    const layers: Layer[] = [
      shapeLayer(1, { td: 1 }),
      shapeLayer(2, { tt: 1 }),
      shapeLayer(3, { tt: 1, tp: 1 }),
    ]
    setTrackMatte(layers, 1, 0)
    expect(layers[0].td).toBe(1)
    expect(layers[0].hd).toBeUndefined()
  })
  it('does nothing for the top layer without tp', () => {
    const layers: Layer[] = [shapeLayer(1)]
    setTrackMatte(layers, 0, 1)
    expect(layers[0].tt).toBeUndefined()
  })
})
