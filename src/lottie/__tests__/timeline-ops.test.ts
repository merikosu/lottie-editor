import { freeze, produce } from 'immer'
import { describe, expect, it } from 'vitest'
import testJson from '../../../docs/test.json?raw'
import { createAnimation } from '../document'
import { getAt, type NodePath } from '../path'
import { evaluateArray, evaluateTextDocument, getKeyframes, type AnyProperty } from '../property'
import {
  allKeyRefs,
  canPasteKeys,
  classifyProperty,
  copyKeyframes,
  deleteKeys,
  distributeKeys,
  duplicateKeys,
  easyEaseKeys,
  groupKeyRefs,
  isKeyframeClipboard,
  isSelectionHold,
  isTextDocumentKeys,
  layerAnimatedProperties,
  layerKeyframeTimes,
  moveKeys,
  normalizeLegacyKeys,
  pasteKeyframes,
  retimeKeys,
  reverseKeys,
  scaleKeys,
  segmentsOfSelection,
  setKeysEasing,
  shiftLayerTime,
  toggleKeysHold,
  trimLayerIn,
  trimLayerOut,
} from '../timeline-ops'
import type { Animation, Keyframe, Layer, ShapeLayer, TextLayer } from '../types'

/* -------------------------------------------------------------------------- */
/*                                  Fixtures                                  */
/* -------------------------------------------------------------------------- */

const ease = (ox = 0.333, oy = 0, ix = 0.667, iy = 1) => ({
  o: { x: ox, y: oy },
  i: { x: ix, y: iy },
})

function shapeLayer(): ShapeLayer {
  return {
    ty: 4,
    nm: 'Ball',
    ind: 1,
    ip: 0,
    op: 60,
    st: 0,
    ks: {
      o: {
        a: 1,
        k: [
          { t: 0, s: [0], ...ease() },
          { t: 20, s: [100] },
        ],
      },
      p: {
        a: 1,
        k: [
          { t: 0, s: [0, 0, 0], ...ease(), to: [10, 0, 0], ti: [0, -20, 0] },
          { t: 30, s: [100, 50, 0], ...ease(0.2, 0.1, 0.8, 0.9), to: [0, 0, 0], ti: [0, 0, 0] },
          { t: 50, s: [0, 100, 0] },
        ],
      },
      r: { a: 0, k: 0 },
      s: { a: 0, k: [100, 100, 100] },
      a: { a: 0, k: [0, 0, 0] },
    },
    shapes: [
      {
        ty: 'gr',
        it: [
          { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [50, 50] } },
          {
            ty: 'fl',
            c: {
              a: 1,
              k: [
                { t: 5, s: [1, 0, 0, 1], ...ease() },
                { t: 25, s: [0, 0, 1, 1] },
              ],
            },
            o: { a: 0, k: 100 },
          },
          {
            ty: 'tr',
            p: { a: 0, k: [0, 0] },
            a: { a: 0, k: [0, 0] },
            s: { a: 0, k: [100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
        ],
      },
    ],
    masksProperties: [
      {
        mode: 'a',
        pt: {
          a: 1,
          k: [
            { t: 10, s: [{ i: [[0, 0]], o: [[0, 0]], v: [[0, 0]], c: true }], ...ease() },
            { t: 40, s: [{ i: [[0, 0]], o: [[0, 0]], v: [[10, 10]], c: true }] },
          ],
        },
        o: { a: 0, k: 100 },
        x: { a: 0, k: 0 },
      },
    ],
  }
}

function textLayer(): TextLayer {
  return {
    ty: 5,
    nm: 'Title',
    ip: 0,
    op: 60,
    st: 0,
    ks: {},
    t: {
      d: {
        k: [
          { s: { t: 'Hello', s: 24, f: 'Inter' }, t: 0 },
          { s: { t: 'World', s: 24, f: 'Inter' }, t: 30 },
        ],
      },
    },
  }
}

function doc(layers: Layer[]): Animation {
  const anim = createAnimation({ frames: 60 })
  anim.layers = layers
  return anim
}

const P = (...segments: (string | number)[]): NodePath => segments
const kfsAt = (anim: Animation, path: NodePath) => getKeyframes(getAt<AnyProperty>(anim, path))!
const times = (anim: Animation, path: NodePath) => kfsAt(anim, path).map((k) => k.t)

/* -------------------------------------------------------------------------- */
/*                                 Layer time                                 */
/* -------------------------------------------------------------------------- */

describe('layer time', () => {
  it('lists every animated property of a layer', () => {
    const paths = layerAnimatedProperties(shapeLayer(), P('layers', 0)).map((p) => p.path.join('/'))
    expect(paths).toEqual([
      'layers/0/ks/o',
      'layers/0/ks/p',
      'layers/0/shapes/0/it/1/c',
      'layers/0/masksProperties/0/pt',
    ])
    expect(layerAnimatedProperties(textLayer()).map((p) => p.path.join('/'))).toEqual(['t/d'])
  })

  it('collects unique keyframe times', () => {
    expect(layerKeyframeTimes(shapeLayer())).toEqual([0, 5, 10, 20, 25, 30, 40, 50])
  })

  it('shifts in/out/start and every keyframe so the layer looks the same, later', () => {
    const original = shapeLayer()
    const layer = shapeLayer()
    shiftLayerTime(layer, 12)
    expect([layer.ip, layer.op, layer.st]).toEqual([12, 72, 12])
    for (const { path, prop } of layerAnimatedProperties(original)) {
      const moved = getAt<AnyProperty>(layer, path)!
      expect(getKeyframes(moved)!.map((k) => k.t)).toEqual(getKeyframes(prop)!.map((k) => k.t + 12))
    }
    for (const f of [0, 7.5, 18, 33]) {
      expect(evaluateArray(layer.ks.p as AnyProperty, f + 12)).toEqual(
        evaluateArray(original.ks.p as AnyProperty, f),
      )
    }
  })

  it('shifts text document keyframes and time remap too', () => {
    const text = textLayer()
    shiftLayerTime(text, -5)
    expect(text.t.d.k.map((k) => k.t)).toEqual([-5, 25])
    expect(evaluateTextDocument(text.t, 25)?.t).toBe('World')

    const precomp: Layer = {
      ty: 0,
      refId: 'comp_0',
      ip: 10,
      op: 40,
      st: 8,
      ks: {},
      tm: {
        a: 1,
        k: [
          { t: 10, s: [0], ...ease() },
          { t: 40, s: [1] },
        ],
      },
    }
    shiftLayerTime(precomp, 3)
    expect([precomp.ip, precomp.op, precomp.st]).toEqual([13, 43, 11])
    expect(getKeyframes(precomp.tm)!.map((k) => k.t)).toEqual([13, 43])
    // Time-remap VALUES (content seconds) are untouched.
    expect(getKeyframes<number[]>(precomp.tm)!.map((k) => k.s![0])).toEqual([0, 1])
  })

  it('ignores zero and invalid deltas', () => {
    const layer = shapeLayer()
    shiftLayerTime(layer, 0)
    shiftLayerTime(layer, Number.NaN)
    expect(layer).toEqual(shapeLayer())
  })

  it('treats a missing start time as 0', () => {
    const layer = { ...shapeLayer(), st: undefined as unknown as number }
    shiftLayerTime(layer, 4)
    expect(layer.st).toBe(4)
  })

  it('trims in/out points keeping a minimum duration', () => {
    const layer = shapeLayer()
    expect(trimLayerIn(layer, 20)).toBe(20)
    expect(trimLayerIn(layer, 70)).toBe(59)
    expect(trimLayerOut(layer, 10)).toBe(60)
    expect(trimLayerOut(layer, 80)).toBe(80)
    expect(trimLayerIn(layer, -10)).toBe(-10)
    // Keyframes are untouched by trimming.
    expect(getKeyframes(layer.ks.o)!.map((k) => k.t)).toEqual([0, 20])
  })

  it('shifts every layer of the real-world test file consistently', () => {
    const anim = JSON.parse(testJson) as Animation
    anim.layers.forEach((layer) => {
      const before = layerKeyframeTimes(layer)
      const { ip, op, st } = layer
      shiftLayerTime(layer, 7)
      expect(layerKeyframeTimes(layer)).toEqual(
        before.map((t) => Math.round((t + 7) * 1000) / 1000),
      )
      expect([layer.ip, layer.op, layer.st]).toEqual([ip + 7, op + 7, st + 7])
    })
  })
})

/* -------------------------------------------------------------------------- */
/*                                 Retiming keys                              */
/* -------------------------------------------------------------------------- */

describe('grouping refs', () => {
  it('groups by property, dedupes and sorts indices', () => {
    const groups = groupKeyRefs([
      { path: P('a'), index: 2 },
      { path: P('b'), index: 0 },
      { path: P('a'), index: 0 },
      { path: P('a'), index: 2 },
    ])
    expect(groups).toEqual([
      { path: P('a'), indices: [0, 2] },
      { path: P('b'), indices: [0] },
    ])
  })

  it('lists all keys of properties', () => {
    const anim = doc([shapeLayer()])
    expect(allKeyRefs(anim, [P('layers', 0, 'ks', 'o'), P('layers', 0, 'ks', 'r')])).toEqual([
      { path: P('layers', 0, 'ks', 'o'), index: 0 },
      { path: P('layers', 0, 'ks', 'o'), index: 1 },
    ])
  })
})

describe('retimeKeys', () => {
  it('replaces unmoved keys on collision and later moved keys win', () => {
    const prop: AnyProperty = {
      a: 1,
      k: [
        { t: 0, s: [0], ...ease() },
        { t: 10, s: [10], ...ease() },
        { t: 20, s: [20], ...ease() },
        { t: 30, s: [30] },
      ],
    }
    // Move keys 0 and 1 onto 10 and 20: key "20" is replaced, the moved ones survive.
    expect(retimeKeys(prop, [0, 1], (t) => t + 10)).toEqual([0, 1])
    const kfs = getKeyframes<number[]>(prop)!
    expect(kfs.map((k) => [k.t, k.s![0]])).toEqual([
      [10, 0],
      [20, 10],
      [30, 30],
    ])
    // Collapse everything onto one time: the last moved key wins.
    expect(retimeKeys(prop, [0, 1, 2], () => 5)).toEqual([0])
    expect(getKeyframes<number[]>(prop)!.map((k) => [k.t, k.s![0]])).toEqual([[5, 30]])
  })

  it('ignores invalid indices', () => {
    const prop: AnyProperty = {
      a: 1,
      k: [
        { t: 0, s: [0] },
        { t: 5, s: [1] },
      ],
    }
    expect(retimeKeys(prop, [9], (t) => t + 1)).toEqual([])
    expect(retimeKeys({ a: 0, k: 3 }, [0], (t) => t)).toEqual([])
  })
})

describe('moveKeys', () => {
  it('moves keys of several properties and returns the new refs', () => {
    const anim = doc([shapeLayer()])
    const o = P('layers', 0, 'ks', 'o')
    const c = P('layers', 0, 'shapes', 0, 'it', 1, 'c')
    const refs = moveKeys(
      anim,
      [
        { path: o, index: 0 },
        { path: c, index: 1 },
      ],
      25,
    )
    expect(times(anim, o)).toEqual([20, 25])
    expect(times(anim, c)).toEqual([5, 50])
    expect(refs).toEqual([
      { path: o, index: 1 },
      { path: c, index: 1 },
    ])
  })

  it('accepts a per-property delta (precomp time scale)', () => {
    const anim = doc([shapeLayer()])
    const o = P('layers', 0, 'ks', 'o')
    moveKeys(anim, [{ path: o, index: 1 }], (path) => (path === o ? 2.5 : 0))
    expect(times(anim, o)).toEqual([0, 22.5])
  })

  it('keeps easing handles on every segment', () => {
    const anim = doc([shapeLayer()])
    const o = P('layers', 0, 'ks', 'o')
    // The last key becomes the first one and now starts a segment.
    moveKeys(anim, [{ path: o, index: 1 }], -30)
    const kfs = kfsAt(anim, o)
    expect(kfs.map((k) => k.t)).toEqual([-10, 0])
    expect(kfs[0].o).toBeDefined()
    expect(kfs[0].i).toBeDefined()
  })

  it('converts legacy (e) keyframes before moving', () => {
    const anim = doc([shapeLayer()])
    anim.layers[0].ks.r = {
      a: 1,
      k: [{ t: 0, s: [0], e: [90], ...ease() }, { t: 10, s: [90], e: [0], ...ease() }, { t: 20 }],
    } as never
    const r = P('layers', 0, 'ks', 'r')
    moveKeys(anim, [{ path: r, index: 2 }], 5)
    const kfs = kfsAt(anim, r) as Keyframe<number[]>[]
    expect(kfs.map((k) => [k.t, k.s?.[0], k.e])).toEqual([
      [0, 0, undefined],
      [10, 90, undefined],
      [25, 0, undefined],
    ])
  })

  it('moves text document keys without adding easing handles or an `a` flag', () => {
    const anim = doc([textLayer()])
    const d = P('layers', 0, 't', 'd')
    moveKeys(anim, [{ path: d, index: 1 }], 10)
    const prop = getAt<AnyProperty>(anim, d)!
    expect(prop.a).toBeUndefined()
    expect(kfsAt(anim, d).map((k) => [k.t, 'o' in k])).toEqual([
      [0, false],
      [40, false],
    ])
    expect(isTextDocumentKeys(kfsAt(anim, d))).toBe(true)
  })

  it('is safe on frozen documents inside immer recipes, including legacy keyframes', () => {
    const anim = doc([shapeLayer()])
    anim.layers[0].ks.r = { a: 1, k: [{ t: 0, s: [0], e: [90], ...ease() }, { t: 10 }] } as never
    const base = freeze(anim, true)
    const r = P('layers', 0, 'ks', 'r')
    const next = produce(base, (draft) => {
      moveKeys(draft, [{ path: r, index: 1 }], 5)
      duplicateKeys(draft, [{ path: r, index: 0 }], 30)
      reverseKeys(draft, allKeyRefs(draft, [r]))
      setKeysEasing(draft, [{ path: r, index: 0 }], null)
    })
    expect(times(next, r)).toEqual([0, 15, 30])
    expect(times(base, r)).toEqual([0, 10])
  })
})

describe('duplicateKeys', () => {
  it('copies keys and keeps the originals', () => {
    const anim = doc([shapeLayer()])
    const o = P('layers', 0, 'ks', 'o')
    const refs = duplicateKeys(anim, allKeyRefs(anim, [o]), 40)
    expect(times(anim, o)).toEqual([0, 20, 40, 60])
    expect(refs).toEqual([
      { path: o, index: 2 },
      { path: o, index: 3 },
    ])
    // Copies are independent objects.
    const kfs = kfsAt(anim, o) as Keyframe<number[]>[]
    expect(kfs[2].s).not.toBe(kfs[0].s)
    expect(kfs[2].s).toEqual(kfs[0].s)
  })

  it('replaces keys at the target time, including originals when the delta is zero', () => {
    const anim = doc([shapeLayer()])
    const o = P('layers', 0, 'ks', 'o')
    duplicateKeys(anim, [{ path: o, index: 0 }], 20)
    expect((kfsAt(anim, o) as Keyframe<number[]>[]).map((k) => [k.t, k.s![0]])).toEqual([
      [0, 0],
      [20, 0],
    ])
    duplicateKeys(anim, [{ path: o, index: 0 }], 0)
    expect(times(anim, o)).toEqual([0, 20])
  })
})

describe('deleteKeys', () => {
  it('removes keys and makes a property static when none remain', () => {
    const anim = doc([shapeLayer()])
    const o = P('layers', 0, 'ks', 'o')
    const p = P('layers', 0, 'ks', 'p')
    deleteKeys(anim, [{ path: p, index: 1 }, ...allKeyRefs(anim, [o])])
    expect(getAt<AnyProperty>(anim, o)).toEqual({ a: 0, k: 0 })
    expect(times(anim, p)).toEqual([0, 50])
  })

  it('keeps one text document keyframe', () => {
    const anim = doc([textLayer()])
    const d = P('layers', 0, 't', 'd')
    deleteKeys(anim, allKeyRefs(anim, [d]))
    expect(times(anim, d)).toEqual([0])
    deleteKeys(anim, [{ path: P('missing'), index: 0 }])
  })
})

describe('scaleKeys', () => {
  it('scales around an origin with whole-frame rounding', () => {
    const anim = doc([shapeLayer()])
    const p = P('layers', 0, 'ks', 'p')
    const refs = scaleKeys(anim, allKeyRefs(anim, [p]), 0.5, 0)
    expect(times(anim, p)).toEqual([0, 15, 25])
    expect(refs.map((r) => r.index)).toEqual([0, 1, 2])
    scaleKeys(anim, allKeyRefs(anim, [p]), 2, 25)
    expect(times(anim, p)).toEqual([-25, 5, 25])
  })

  it('merges keys that collide after compressing (the later key wins)', () => {
    const anim = doc([shapeLayer()])
    const p = P('layers', 0, 'ks', 'p')
    scaleKeys(anim, allKeyRefs(anim, [p]), 0.01, 0)
    expect(times(anim, p)).toEqual([0, 1])
    expect((kfsAt(anim, p) as Keyframe<number[]>[])[0].s).toEqual([100, 50, 0])
  })

  it('can keep fractional times and ignores non-positive factors', () => {
    const anim = doc([shapeLayer()])
    const o = P('layers', 0, 'ks', 'o')
    scaleKeys(anim, allKeyRefs(anim, [o]), 1.25, 0, { round: false })
    expect(times(anim, o)).toEqual([0, 25])
    scaleKeys(anim, allKeyRefs(anim, [o]), 1 / 3, 0, { round: false })
    expect(times(anim, o)).toEqual([0, 8.333])
    const refs = allKeyRefs(anim, [o])
    expect(scaleKeys(anim, refs, 0, 0)).toEqual(refs)
    expect(scaleKeys(anim, refs, -1, 0)).toEqual(refs)
  })
})

describe('distributeKeys', () => {
  it('spreads distinct times evenly and keeps aligned keys aligned', () => {
    const anim = doc([shapeLayer()])
    const p = P('layers', 0, 'ks', 'p')
    const o = P('layers', 0, 'ks', 'o')
    // Times: p 0, 30, 50; o 0, 20 → distinct 0, 20, 30, 50 → 0, 16.667→17, 33.333→33, 50.
    distributeKeys(anim, [...allKeyRefs(anim, [p]), ...allKeyRefs(anim, [o])])
    expect(times(anim, p)).toEqual([0, 33, 50])
    expect(times(anim, o)).toEqual([0, 17])
  })

  it('keeps fractional spacing when there are more keys than frames', () => {
    const prop: AnyProperty = {
      a: 1,
      k: [
        { t: 0, s: [0] },
        { t: 0.2, s: [1] },
        { t: 0.3, s: [2] },
        { t: 2, s: [3] },
      ],
    }
    const anim = doc([shapeLayer()])
    anim.layers[0].ks.r = prop as never
    const r = P('layers', 0, 'ks', 'r')
    distributeKeys(anim, allKeyRefs(anim, [r]))
    expect(times(anim, r)).toEqual([0, 0.667, 1.333, 2])
  })

  it('needs at least three distinct times and works per composition', () => {
    const anim = doc([shapeLayer()])
    anim.assets = [{ id: 'comp_0', layers: [shapeLayer()] }]
    const rootO = P('layers', 0, 'ks', 'o')
    const innerP = P('assets', 0, 'layers', 0, 'ks', 'p')
    const refs = [...allKeyRefs(anim, [rootO]), ...allKeyRefs(anim, [innerP])]
    distributeKeys(anim, refs)
    // Root: only 2 distinct times → unchanged. Asset: 0, 30, 50 → 0, 25, 50.
    expect(times(anim, rootO)).toEqual([0, 20])
    expect(times(anim, innerP)).toEqual([0, 25, 50])
  })
})

/* -------------------------------------------------------------------------- */
/*                                   Reverse                                  */
/* -------------------------------------------------------------------------- */

const sample = (prop: AnyProperty, f: number) => evaluateArray(prop, f)

describe('reverseKeys', () => {
  it('plays eased scalars exactly backwards', () => {
    const anim = doc([shapeLayer()])
    anim.layers[0].ks.r = {
      a: 1,
      k: [
        { t: 0, s: [0], ...ease(0.8, 0, 0.9, 0.2) },
        { t: 12, s: [90], ...ease(0.1, 0.7, 0.3, 1) },
        { t: 40, s: [45] },
      ],
    } as never
    const r = P('layers', 0, 'ks', 'r')
    const original = structuredClone(getAt<AnyProperty>(anim, r)!)
    reverseKeys(anim, allKeyRefs(anim, [r]))
    const reversed = getAt<AnyProperty>(anim, r)!
    expect(times(anim, r)).toEqual([0, 28, 40])
    for (let f = 0; f <= 40; f += 0.5) {
      expect(sample(reversed, f)[0]).toBeCloseTo(sample(original, 40 - f)[0], 4)
    }
  })

  it('mirrors per-dimension easing arrays', () => {
    const anim = doc([shapeLayer()])
    anim.layers[0].ks.s = {
      a: 1,
      k: [
        {
          t: 10,
          s: [100, 100],
          o: { x: [0.9, 0.1], y: [0, 0.5] },
          i: { x: [0.2, 0.7], y: [1, 0.3] },
        },
        { t: 30, s: [50, 150] },
      ],
    } as never
    const s = P('layers', 0, 'ks', 's')
    const original = structuredClone(getAt<AnyProperty>(anim, s)!)
    reverseKeys(anim, allKeyRefs(anim, [s]))
    const reversed = getAt<AnyProperty>(anim, s)!
    for (let f = 10; f <= 30; f += 1) {
      const a = sample(reversed, f)
      const b = sample(original, 40 - f)
      expect(a[0]).toBeCloseTo(b[0], 4)
      expect(a[1]).toBeCloseTo(b[1], 4)
    }
  })

  it('reverses spatial motion paths', () => {
    const anim = doc([shapeLayer()])
    const p = P('layers', 0, 'ks', 'p')
    const original = structuredClone(getAt<AnyProperty>(anim, p)!)
    reverseKeys(anim, allKeyRefs(anim, [p]))
    const reversed = getAt<AnyProperty>(anim, p)!
    for (let f = 0; f <= 50; f += 2.5) {
      const a = sample(reversed, f)
      const b = sample(original, 50 - f)
      expect(a[0]).toBeCloseTo(b[0], 2)
      expect(a[1]).toBeCloseTo(b[1], 2)
    }
  })

  it('moves a hold to the start key of the mirrored segment', () => {
    const anim = doc([shapeLayer()])
    anim.layers[0].ks.r = {
      a: 1,
      k: [
        { t: 0, s: [0], h: 1, ...ease() },
        { t: 10, s: [90], ...ease() },
        { t: 30, s: [180] },
      ],
    } as never
    const r = P('layers', 0, 'ks', 'r')
    reverseKeys(anim, allKeyRefs(anim, [r]))
    const kfs = kfsAt(anim, r) as Keyframe<number[]>[]
    expect(kfs.map((k) => [k.t, k.s![0], k.h ?? 0])).toEqual([
      [0, 180, 0],
      [20, 90, 1],
      [30, 0, 0],
    ])
  })

  it('reverses only the selected span and leaves other keys in place', () => {
    const anim = doc([shapeLayer()])
    anim.layers[0].ks.r = {
      a: 1,
      k: [
        { t: 0, s: [0], ...ease() },
        { t: 10, s: [10], ...ease() },
        { t: 15, s: [15], ...ease() },
        { t: 30, s: [30] },
      ],
    } as never
    const r = P('layers', 0, 'ks', 'r')
    const refs = reverseKeys(
      anim,
      [1, 2, 3].map((index) => ({ path: r, index })),
    )
    const kfs = kfsAt(anim, r) as Keyframe<number[]>[]
    expect(kfs.map((k) => [k.t, k.s![0]])).toEqual([
      [0, 0],
      [10, 30],
      [25, 15],
      [30, 10],
    ])
    expect(refs.map((ref) => ref.index).sort()).toEqual([1, 2, 3])
    // The last key never carries segment data.
    expect(kfs[3].h).toBeUndefined()
  })

  it('reverses text documents by time only', () => {
    const anim = doc([textLayer()])
    const d = P('layers', 0, 't', 'd')
    reverseKeys(anim, allKeyRefs(anim, [d]))
    const kfs = kfsAt(anim, d) as Keyframe<{ t: string }>[]
    expect(kfs.map((k) => [k.t, k.s!.t])).toEqual([
      [0, 'World'],
      [30, 'Hello'],
    ])
    expect(kfs[0].o).toBeUndefined()
  })

  it('leaves single keys alone', () => {
    const anim = doc([shapeLayer()])
    const o = P('layers', 0, 'ks', 'o')
    expect(reverseKeys(anim, [{ path: o, index: 1 }])).toEqual([{ path: o, index: 1 }])
    expect(times(anim, o)).toEqual([0, 20])
  })
})

/* -------------------------------------------------------------------------- */
/*                                   Easing                                   */
/* -------------------------------------------------------------------------- */

describe('easing', () => {
  it('picks outgoing segments, and the incoming one for a lone last key', () => {
    expect(segmentsOfSelection(4, [0, 1])).toEqual([0, 1])
    expect(segmentsOfSelection(4, [3])).toEqual([2])
    expect(segmentsOfSelection(4, [2, 3])).toEqual([2])
    expect(segmentsOfSelection(1, [0])).toEqual([])
  })

  it('sets curves keeping the handle shape (scalar or per-dimension)', () => {
    const anim = doc([shapeLayer()])
    anim.layers[0].ks.s = {
      a: 1,
      k: [
        {
          t: 0,
          s: [100, 100],
          o: { x: [0.1, 0.1], y: [0, 0] },
          i: { x: [0.9, 0.9], y: [1, 1] },
          n: ['x', 'y'],
        },
        { t: 10, s: [50, 50] },
      ],
    } as never
    const s = P('layers', 0, 'ks', 's')
    setKeysEasing(anim, [{ path: s, index: 1 }], [0.42, 0, 0.58, 1])
    const kf = kfsAt(anim, s)[0]
    expect(kf.o).toEqual({ x: [0.42, 0.42], y: [0, 0] })
    expect(kf.i).toEqual({ x: [0.58, 0.58], y: [1, 1] })
    expect(kf.n).toBeUndefined()
  })

  it('makes holds (dropping spatial tangents lottie-web would follow) and releases them', () => {
    const anim = doc([shapeLayer()])
    const p = P('layers', 0, 'ks', 'p')
    const refs = [{ path: p, index: 0 }]
    expect(isSelectionHold(anim, refs)).toBe(false)
    expect(toggleKeysHold(anim, refs)).toBe(true)
    const kf = kfsAt(anim, p)[0]
    expect(kf.h).toBe(1)
    expect(kf.to).toBeUndefined()
    expect(isSelectionHold(anim, refs)).toBe(true)
    expect(toggleKeysHold(anim, refs)).toBe(false)
    expect(kfsAt(anim, p)[0].h).toBeUndefined()
    expect(kfsAt(anim, p)[0].o).toEqual({ x: 0.333, y: 0 })
    setKeysEasing(anim, refs, null)
    setKeysEasing(anim, refs, [0, 0, 1, 1])
    expect(kfsAt(anim, p)[0].h).toBeUndefined()
  })

  it('applies easy ease in/out/both', () => {
    const anim = doc([shapeLayer()])
    anim.layers[0].ks.r = {
      a: 1,
      k: [
        { t: 0, s: [0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
        { t: 10, s: [10], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
        { t: 20, s: [0] },
      ],
    } as never
    const r = P('layers', 0, 'ks', 'r')
    easyEaseKeys(anim, [{ path: r, index: 1 }], 'in')
    let kfs = kfsAt(anim, r)
    expect(kfs[0].i).toEqual({ x: 0.667, y: 1 })
    expect(kfs[1].o).toEqual({ x: 0, y: 0 })
    easyEaseKeys(anim, [{ path: r, index: 1 }], 'out')
    kfs = kfsAt(anim, r)
    expect(kfs[1].o).toEqual({ x: 0.333, y: 0 })
    easyEaseKeys(anim, [{ path: r, index: 0 }])
    expect(kfsAt(anim, r)[0].o).toEqual({ x: 0.333, y: 0 })
  })

  it('ignores text documents', () => {
    const anim = doc([textLayer()])
    const d = P('layers', 0, 't', 'd')
    setKeysEasing(anim, allKeyRefs(anim, [d]), null)
    easyEaseKeys(anim, allKeyRefs(anim, [d]))
    expect(toggleKeysHold(anim, allKeyRefs(anim, [d]))).toBe(true)
    expect(kfsAt(anim, d).every((k) => k.h === undefined && k.o === undefined)).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/*                               Copy and paste                               */
/* -------------------------------------------------------------------------- */

describe('property kinds', () => {
  it('classifies properties by value and place', () => {
    const anim = doc([shapeLayer(), textLayer()])
    ;(anim.layers[0] as ShapeLayer).shapes.push({
      ty: 'gf',
      g: { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1] } },
      s: { a: 0, k: [0, 0] },
      e: { a: 0, k: [1, 1] },
      t: 1,
      o: { a: 0, k: 100 },
    })
    expect(classifyProperty(anim, P('layers', 0, 'ks', 'o'))).toEqual({ kind: 'scalar', dims: 1 })
    expect(classifyProperty(anim, P('layers', 0, 'ks', 'p'))).toEqual({ kind: 'vector', dims: 3 })
    expect(classifyProperty(anim, P('layers', 0, 'shapes', 0, 'it', 1, 'c'))).toEqual({
      kind: 'color',
      dims: 4,
    })
    expect(classifyProperty(anim, P('layers', 0, 'shapes', 1, 'g', 'k'))).toEqual({
      kind: 'gradient',
      dims: 8,
    })
    expect(classifyProperty(anim, P('layers', 0, 'masksProperties', 0, 'pt')).kind).toBe('path')
    expect(classifyProperty(anim, P('layers', 1, 't', 'd')).kind).toBe('text')
    expect(classifyProperty(anim, P('layers', 9)).dims).toBe(0)
  })

  it('decides paste compatibility', () => {
    expect(canPasteKeys({ kind: 'scalar', dims: 1 }, { kind: 'scalar', dims: 1 })).toBe(true)
    expect(canPasteKeys({ kind: 'scalar', dims: 1 }, { kind: 'vector', dims: 2 })).toBe(false)
    expect(canPasteKeys({ kind: 'vector', dims: 2 }, { kind: 'vector', dims: 3 })).toBe(true)
    expect(canPasteKeys({ kind: 'vector', dims: 2 }, { kind: 'vector', dims: 4 })).toBe(false)
    expect(canPasteKeys({ kind: 'color', dims: 3 }, { kind: 'color', dims: 4 })).toBe(true)
    expect(canPasteKeys({ kind: 'gradient', dims: 8 }, { kind: 'gradient', dims: 12 })).toBe(false)
    expect(canPasteKeys({ kind: 'path', dims: 0 }, { kind: 'path', dims: 0 })).toBe(true)
  })
})

describe('copy / paste keyframes', () => {
  it('copies with relative timing and pastes back at the playhead', () => {
    const anim = doc([shapeLayer()])
    const o = P('layers', 0, 'ks', 'o')
    const c = P('layers', 0, 'shapes', 0, 'it', 1, 'c')
    const clip = copyKeyframes(anim, [{ path: o, index: 1 }, ...allKeyRefs(anim, [c])])!
    expect(isKeyframeClipboard(clip)).toBe(true)
    expect(isKeyframeClipboard(JSON.parse(JSON.stringify(clip)))).toBe(true)
    expect(clip.tracks.map((t) => [t.relPath.join('/'), t.keys.map((k) => k.t)])).toEqual([
      ['ks/o', [15]],
      ['shapes/0/it/1/c', [0, 20]],
    ])
    const refs = pasteKeyframes(anim, clip, { at: 40 })
    expect(times(anim, o)).toEqual([0, 20, 55])
    expect(times(anim, c)).toEqual([5, 25, 40, 60])
    expect(refs).toHaveLength(3)
    for (const ref of refs) expect(kfsAt(anim, ref.path)[ref.index]).toBeDefined()
  })

  it('pastes a single track onto a focused compatible property', () => {
    const anim = doc([shapeLayer()])
    const o = P('layers', 0, 'ks', 'o')
    const r = P('layers', 0, 'ks', 'r')
    const clip = copyKeyframes(anim, allKeyRefs(anim, [o]))!
    const refs = pasteKeyframes(anim, clip, { at: 10, targetProperty: r })
    // The static rotation became animated with the copied keys.
    expect(getAt<AnyProperty>(anim, r)!.a).toBe(1)
    expect((kfsAt(anim, r) as Keyframe<number[]>[]).map((k) => [k.t, k.s![0]])).toEqual([
      [10, 0],
      [30, 100],
    ])
    expect(refs.every((ref) => ref.path === r)).toBe(true)
    // An incompatible focused property falls back to the original one.
    pasteKeyframes(anim, clip, { at: 50, targetProperty: P('layers', 0, 'ks', 's') })
    expect(times(anim, o)).toEqual([0, 20, 50, 70])
  })

  it('pastes onto the same properties of another layer and adapts dimensions', () => {
    const anim = doc([shapeLayer(), shapeLayer()])
    anim.layers[1].ks.p = { a: 0, k: [5, 5] }
    const p = P('layers', 0, 'ks', 'p')
    const clip = copyKeyframes(anim, allKeyRefs(anim, [p]))!
    pasteKeyframes(anim, clip, { at: 0, targetLayer: P('layers', 1) })
    const kfs = kfsAt(anim, P('layers', 1, 'ks', 'p')) as Keyframe<number[]>[]
    expect(kfs.map((k) => k.s)).toEqual([
      [0, 0],
      [100, 50],
      [0, 100],
    ])
    expect(kfs[0].to).toEqual([10, 0])
    // Layer 0 is untouched.
    expect(times(anim, p)).toEqual([0, 30, 50])
  })

  it('replaces keys at pasted times and maps precomp time', () => {
    const anim = doc([shapeLayer()])
    anim.assets = [{ id: 'comp_0', layers: [shapeLayer()] }]
    const inner = P('assets', 0, 'layers', 0, 'ks', 'o')
    // Inner time t → root time 2t + 10 (st 10, stretch 2).
    const mapping = {
      toRoot: (_p: NodePath, t: number) => 2 * t + 10,
      toLocal: (_p: NodePath, f: number) => (f - 10) / 2,
    }
    const clip = copyKeyframes(anim, allKeyRefs(anim, [inner]), mapping)!
    expect(clip.tracks[0].keys.map((k) => k.t)).toEqual([0, 40])
    pasteKeyframes(anim, clip, { at: 10, ...mapping })
    expect(times(anim, inner)).toEqual([0, 20])
    pasteKeyframes(anim, clip, { at: 50, ...mapping })
    expect(times(anim, inner)).toEqual([0, 20, 40])
  })

  it('skips tracks without a compatible destination', () => {
    const anim = doc([shapeLayer()])
    const o = P('layers', 0, 'ks', 'o')
    const clip = copyKeyframes(anim, allKeyRefs(anim, [o]))!
    const other = doc([textLayer()])
    expect(pasteKeyframes(other, clip, { at: 0 })).toEqual([])
    expect(copyKeyframes(anim, [{ path: P('layers', 0, 'ks', 'r'), index: 0 }])).toBeNull()
  })

  it('copies legacy keyframes in the modern format without changing the document', () => {
    const anim = doc([shapeLayer()])
    anim.layers[0].ks.r = { a: 1, k: [{ t: 0, s: [0], e: [90], ...ease() }, { t: 10 }] } as never
    const r = P('layers', 0, 'ks', 'r')
    const clip = copyKeyframes(anim, allKeyRefs(anim, [r]))!
    expect(clip.tracks[0].keys.map((k) => [k.t, (k.s as number[])[0], k.e])).toEqual([
      [0, 0, undefined],
      [10, 90, undefined],
    ])
    expect(kfsAt(anim, r)[0].e).toEqual([90])
  })

  it('validates clipboard payloads', () => {
    expect(isKeyframeClipboard(null)).toBe(false)
    expect(isKeyframeClipboard({ __lottieEditor: 'layers', tracks: [] })).toBe(false)
    expect(
      isKeyframeClipboard({
        __lottieEditor: 'keyframes',
        tracks: [{ path: [], keys: [{ s: 1 }] }],
      }),
    ).toBe(false)
    expect(isKeyframeClipboard({ __lottieEditor: 'keyframes', tracks: [] })).toBe(true)
  })
})

describe('normalizeLegacyKeys', () => {
  it('resolves end values into the next key', () => {
    const prop: AnyProperty = {
      a: 1,
      k: [{ t: 0, s: [1], e: [2] }, { t: 5, s: [2], e: [3] }, { t: 9 }],
    }
    normalizeLegacyKeys(prop)
    expect(prop.k).toEqual([
      { t: 0, s: [1] },
      { t: 5, s: [2] },
      { t: 9, s: [3] },
    ])
  })
})
