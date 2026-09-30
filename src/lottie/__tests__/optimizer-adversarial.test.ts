/**
 * Adversarial documents: the constructions where a naive optimizer changes the animation or
 * crashes. Every case runs the full presets and must stay structurally valid and draw the same
 * scene within the preset's tolerance.
 */
import { describe, expect, it } from 'vitest'
import { optimizeAnimation } from '../optimizer/pipeline'
import { describeMismatches, verifySemantic } from '../optimizer/semantic'
import type { PresetId } from '../optimizer/types'
import type { Animation } from '../types'
import {
  bezier,
  doc,
  ellipse,
  fill,
  group,
  kf,
  ks,
  nullLayer,
  p,
  path,
  precompAsset,
  precompLayer,
  rect,
  resetInd,
  shapeLayer,
  stroke,
  type J,
} from './fixtures/optimizer/builders'
import { structureProblems } from './fixtures/optimizer/harness'

const TOLERANCE: Record<PresetId, { geometry: number; color: number; opacity: number }> = {
  safe: { geometry: 2e-3, color: 1e-6, opacity: 1e-6 },
  balanced: { geometry: 0.06, color: 0.0021, opacity: 0.0011 },
  maximum: { geometry: 0.24, color: 0.0041, opacity: 0.0041 },
}

async function survives(
  anim: Animation,
  presets: PresetId[] = ['safe', 'balanced', 'maximum'],
): Promise<Animation[]> {
  const out: Animation[] = []
  for (const preset of presets) {
    const { animation, report } = await optimizeAnimation(anim, preset)
    expect(report.after.raw).toBeLessThanOrEqual(report.before.raw)
    expect(structureProblems(animation)).toEqual([])
    const r = verifySemantic(anim, animation, { tolerance: TOLERANCE[preset] })
    expect(r.equivalent, `${preset}: ${describeMismatches(r.mismatches)}`).toBe(true)
    out.push(animation)
  }
  return out
}

const L = (a: Animation, i = 0) => (a.layers as unknown as J[])[i]
const keyValues = (list: J[]) => list.map((k) => [k.t, k.s, k.to ?? null, k.ti ?? null])

describe('adversarial documents', () => {
  it('precomposition shown at 1000 % keeps the precision its content needs', async () => {
    resetInd()
    const fine = path(
      bezier([
        [0.123456, 0.654321],
        [10.111111, 0.987654],
        [5.555555, 9.999999],
      ]),
    )
    const a = doc([precompLayer('big', { ks: ks({ s: p([1000, 1000, 100]) }) })], {
      assets: [
        precompAsset('big', [
          shapeLayer([group([fine, fill()])], { ind: 1, ks: ks({ p: p([0, 0, 0]) }) }),
        ]),
      ],
    })
    await survives(a)
  })

  it('time-remapped and time-stretched precompositions', async () => {
    resetInd()
    const inner = [
      shapeLayer(
        [
          group([
            rect({
              s: kf([
                [0, [10, 10]],
                [10, [20, 20]],
                [20, [30, 30]],
                [40, [80, 80]],
              ]),
            }),
            fill(),
          ]),
        ],
        { ind: 1, op: 200 },
      ),
    ]
    const a = doc(
      [
        precompLayer('c', {
          tm: kf([
            [0, 0],
            [30, 2],
            [59, 0.5],
          ]),
        }),
        precompLayer('c', { sr: 0.5, st: -7, ks: ks({ p: p([100, 100, 0]) }) }),
      ],
      { assets: [precompAsset('c', inner)] },
    )
    await survives(a)
  })

  it('repeater with many scaled copies (errors accumulate per copy)', async () => {
    const rp = {
      ty: 'rp',
      c: p(24),
      o: p(0),
      m: 1,
      tr: {
        ty: 'tr',
        p: p([10.123456, 0.987654]),
        a: p([0, 0]),
        s: p([95.4321, 95.4321]),
        r: p(15.12345),
        so: p(100),
        eo: p(30),
      },
      nm: 'Repeater',
    }
    await survives(doc([shapeLayer([group([rect({ s: p([20.12345, 20.98765]) }), fill(), rp])])]))
  })

  it('auto-oriented layer: the motion direction survives', async () => {
    const pos = kf(
      [
        [0, [100, 100, 0]],
        [10, [100.02, 100.01, 0]],
        [20, [300.123456, 180.654321, 0]],
      ],
      { to: [0.5, 0.2, 0], ti: [-0.5, -0.2, 0] },
    )
    const [, balanced] = await survives(
      doc([shapeLayer([group([rect(), fill()])], { ao: 1, ks: ks({ p: pos }) })]),
    )
    // Positions and motion tangents keep their exact values: rounding would rotate the layer.
    const keys = ((L(balanced).ks as J).p as J).k as J[]
    expect(keyValues(keys).slice(0, 2)).toEqual(keyValues(pos.k as J[]).slice(0, 2))
    expect(keys[2].s).toEqual((pos.k as J[])[2].s)
  })

  it('hold keyframes with spatial tangents (lottie-web moves along them) and equal key times', async () => {
    const pos: J = {
      a: 1,
      k: [
        {
          t: 0,
          s: [0, 0, 0],
          h: 1,
          o: { x: 0.3, y: 0 },
          i: { x: 0.7, y: 1 },
          to: [50, 0, 0],
          ti: [0, 50, 0],
        },
        { t: 10, s: [100, 100, 0], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } },
        { t: 10, s: [200, 100, 0], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } },
        { t: 30, s: [200, 300, 0] },
      ],
    }
    const [safe] = await survives(
      doc([shapeLayer([group([rect(), fill()])], { ks: ks({ p: pos }) })]),
    )
    const k0 = (((L(safe).ks as J).p as J).k as J[])[0]
    expect(k0.o).toBeDefined()
    expect(k0.to).toEqual([50, 0, 0])
  })

  it('precomposition cycles do not hang', async () => {
    resetInd()
    const a = doc([precompLayer('a')], {
      assets: [
        precompAsset('a', [
          precompLayer('b', { ind: 1 }),
          shapeLayer([group([ellipse(), fill()])], { ind: 2 }),
        ]),
        precompAsset('b', [precompLayer('a', { ind: 1 })]),
      ],
    })
    const { report } = await optimizeAnimation(a, 'maximum')
    expect(report.after.raw).toBeLessThanOrEqual(report.before.raw)
  })

  it('malformed data does not crash and is left alone', async () => {
    const weird = doc([
      shapeLayer([
        { ty: 'gr', nm: 'no items' },
        {
          ty: 'sh',
          ks: {
            a: 1,
            k: [
              { t: 5, s: [] },
              { t: 0, s: [] },
            ],
          },
        },
        { ty: 'fl' },
        group([rect({ s: { a: 0, k: 'abc' } }), fill()]),
      ]),
      { ty: 4, ip: 0, op: 60, st: 0, nm: 'no ks, no shapes' },
      shapeLayer([group([rect(), fill()])], {
        nm: 'unsorted',
        ks: ks({
          r: {
            a: 1,
            k: [
              { t: 20, s: [10] },
              { t: 10, s: [0] },
              { t: 30, s: [5] },
            ],
          },
        }),
      }),
    ] as J[])
    for (const preset of ['safe', 'balanced', 'maximum'] as PresetId[]) {
      await expect(optimizeAnimation(weird, preset)).resolves.toHaveProperty('json')
    }
    const { animation } = await optimizeAnimation(weird, 'maximum')
    // Unsorted keyframes are not simplified.
    const unsorted = (animation.layers as unknown as J[]).find((l) => l.nm === 'unsorted')!
    expect((((unsorted.ks as J).r as J).k as J[]).map((key) => key.t)).toEqual([20, 10, 30])
  })

  it('damaged keyframes are left as they are instead of failing the whole file', async () => {
    resetInd()
    const square = bezier([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
    const damaged = {
      // A null entry and a number among the keyframes.
      entries: { a: 1, k: [{ t: 0, s: [0] }, null, 3, { t: 20, s: [90] }] },
      // Values the curve cannot be evaluated with.
      values: {
        a: 1,
        k: [
          { t: 0, s: null },
          { t: 10, s: [5, 'x'] },
          { t: 20, s: [9] },
        ],
      },
      // A path keyframe followed by a number list.
      mixed: {
        a: 1,
        k: [
          { t: 0, s: [square] },
          { t: 10, s: [1, 2] },
        ],
      },
      // A time far in the future (sampling it frame by frame would never end).
      far: {
        a: 1,
        k: [
          { t: 0, s: [0, 0], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } },
          { t: 1e9, s: [100, 100] },
        ],
      },
    }
    const anim = doc([
      shapeLayer([group([path(damaged.mixed), fill()])], {
        nm: 'damaged',
        ks: ks({ r: damaged.entries, o: damaged.values, p: damaged.far }),
      }),
    ] as J[])
    const before = JSON.parse(JSON.stringify(anim)) as Animation
    for (const preset of ['safe', 'balanced', 'maximum'] as PresetId[]) {
      const { animation } = await optimizeAnimation(anim, preset)
      const layer = L(animation)
      const t = layer.ks as J
      // Damaged properties come out exactly as they went in (the rest is still optimized).
      expect(t.r).toEqual((L(before).ks as J).r)
      expect(t.o).toEqual((L(before).ks as J).o)
      const shape = ((layer.shapes as J[])[0].it as J[])[0]
      expect(shape.ks).toEqual(damaged.mixed)
    }
  })

  it('duplicate layer indices, parents and mattes', async () => {
    resetInd()
    const parentA = nullLayer({
      ind: 5,
      nm: 'P1',
      ks: ks({
        r: kf([
          [0, 0],
          [59, 45],
        ]),
      }),
    })
    const parentB = nullLayer({ ind: 5, nm: 'P2 (same ind)' })
    const child = shapeLayer([group([rect(), fill()])], { parent: 5, ind: 6 })
    const matte = shapeLayer([group([ellipse({ s: p([300, 300]) }), fill()])], { td: 1, ind: 7 })
    const target = shapeLayer([group([rect({ s: p([400, 400]) }), fill({ c: p([0, 1, 0, 1]) })])], {
      tt: 2,
      tp: 7,
      ind: 8,
    })
    const a = doc([parentA, parentB, child, matte, target])
    const [, , maximum] = await survives(a)
    expect((maximum.layers as unknown as J[]).map((l) => l.ind)).toEqual([5, 5, 6, 7, 8])
  })

  it('3D layers keep their transforms', async () => {
    const t = ks({
      rx: p(0),
      ry: p(0),
      rz: p(0),
      or: p([0, 0, 0]),
      a: p([0, 0, 0]),
      p: p([256, 256, 0]),
    })
    const [, balanced] = await survives(
      doc([shapeLayer([group([rect(), fill()])], { ddd: 1, ks: t })], { ddd: 1 }),
    )
    const out = L(balanced).ks as J
    for (const key of ['rx', 'ry', 'rz', 'or', 'a']) expect(out).toHaveProperty(key)
  })

  it('slot-bound properties are never touched', async () => {
    const color = { a: 0, k: [0.123456789, 0.5, 0.5, 1], sid: 'brand' }
    const [, , maximum] = await survives(
      doc([
        shapeLayer([
          group([rect(), fill({ c: color }), stroke({ w: { a: 0, k: 3.33333, sid: 'w' } })]),
        ]),
      ]),
    )
    const items = ((L(maximum).shapes as J[])[0].it as J[]).map((i) => i as J)
    expect(items[1].c).toEqual(color)
    expect((items[2].w as J).k).toBe(3.33333)
  })

  it('legacy 0–255 colors (files older than 4.1.9)', async () => {
    const c = kf([
      [0, [255, 127.5, 0.5, 255]],
      [30, [12.3456, 200.9876, 100.1234, 255]],
    ])
    await survives(doc([shapeLayer([group([rect(), fill({ c })])])], { v: '4.0.0' }))
  })

  it('trim paths over a path whose straight-run vertices are removed', async () => {
    const straight = bezier(
      [
        [0, 0],
        [25, 0],
        [50, 0],
        [75, 0],
        [100, 0],
        [100, 100],
      ],
      false,
    )
    const trim = {
      ty: 'tm',
      s: kf([
        [0, 0],
        [30, 50],
      ]),
      e: p(80),
      o: p(0),
      m: 1,
      nm: 'Trim',
    }
    const [safe] = await survives(doc([shapeLayer([group([path(straight), stroke(), trim])])]))
    const v = ((((L(safe).shapes as J[])[0].it as J[])[0].ks as J).k as J).v as number[][]
    expect(v).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
    ])
  })

  it('opacity animated between invisible stretches is kept', async () => {
    const o = kf([
      [0, 0],
      [10, 0],
      [10.5, 100],
      [11, 0],
      [60, 0],
    ])
    const a = doc([shapeLayer([group([rect(), fill()])], { ks: ks({ o }) })])
    const [, balanced] = await survives(a)
    expect(balanced.layers).toHaveLength(1)
  })
})
