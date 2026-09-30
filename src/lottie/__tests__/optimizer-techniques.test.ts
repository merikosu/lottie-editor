/**
 * Unit tests of the optimizer techniques, one by one, on synthetic documents built to hit their
 * edge cases (and the traps other players fall into). Every visual technique is also checked
 * with the scene-level verifier (`verifySemantic`) and the per-property harness.
 */
import { describe, expect, it } from 'vitest'
import { verifySemantic, describeMismatches } from '../optimizer/semantic'
import { expressionReach } from '../optimizer/expressions'
import { roundWithin } from '../optimizer/numbers'
import { simplifyProperty } from '../optimizer/techniques/keyframes'
import { roundProperty } from '../optimizer/techniques/precision'
import { simplifyPath } from '../optimizer/techniques/paths'
import { alwaysZero } from '../optimizer/techniques/structure'
import { isAnimatedImage } from '../optimizer/techniques/images'
import type { Animation } from '../types'
import {
  bakedAnimation,
  bezier,
  doc,
  ellipse,
  fill,
  group,
  imageAsset,
  imageLayer,
  kf,
  ks,
  legacyAnimation,
  nullLayer,
  p,
  path,
  precompAsset,
  precompLayer,
  rect,
  resetInd,
  shapeLayer,
  stroke,
  tr,
  type J,
} from './fixtures/optimizer/builders'
import { propertyDiff, runOnly, structureProblems } from './fixtures/optimizer/harness'

const layersOf = (a: Animation) => a.layers as unknown as J[]
const withExpr = (x: string) =>
  doc([shapeLayer([group([rect(), fill()])], { ks: ks({ r: p(0, { x }) }) })])
const hiddenWithExpr = (x: string) =>
  doc([
    shapeLayer([group([rect(), fill()])], { hd: true, nm: 'Controls' }),
    shapeLayer([group([rect(), fill()])], { ks: ks({ r: p(0, { x }) }) }),
  ])
const keysWithExpr = (x: string) =>
  doc([
    shapeLayer([group([rect(), fill()])], {
      ks: ks({
        r: kf([
          [0, 0],
          [10, 10],
          [20, 20],
        ]),
        o: p(100, { x }),
      }),
    }),
  ])
const decimals = (n: number) => (String(n).split('.')[1] ?? '').length
const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const sameContent = () => [shapeLayer([group([rect(), fill()])], { ind: 1 })]
const scaledShape = (scale: number) =>
  shapeLayer(
    [
      group([
        path(
          bezier([
            [10.123456, 20.987654],
            [80.555555, 20.444444],
            [45.321987, 70.111111],
          ]),
        ),
        fill(),
      ]),
    ],
    {
      ks: ks({ s: p([scale, scale, 100]) }),
    },
  )
const json = (v: unknown) => JSON.stringify(v)

function expectEquivalent(a: Animation, b: Animation, geometry = 1e-6): void {
  const r = verifySemantic(a, b, {
    tolerance: { geometry, opacity: 1e-6, color: 1e-6, other: 1e-6 },
  })
  expect(r.equivalent, describeMismatches(r.mismatches)).toBe(true)
}

/* -------------------------------------------------------------------------- */
/*                                   numbers                                  */
/* -------------------------------------------------------------------------- */

describe('roundWithin', () => {
  it('picks the shortest decimal within the budget', () => {
    expect(roundWithin(123.456, 0.025)).toBe(123.46)
    expect(roundWithin(123.41, 0.025)).toBe(123.4)
    expect(roundWithin(99.98, 0.025)).toBe(100)
    expect(roundWithin(0.8333333333, 0.0005)).toBe(0.833)
  })
  it('never changes integers or when the budget is zero', () => {
    expect(roundWithin(42, 0.5)).toBe(42)
    expect(roundWithin(1.23456, 0)).toBe(1.23456)
  })
  it('keeps the value when rounding is not shorter', () => {
    expect(roundWithin(0.1, 0.02)).toBe(0.1)
  })
  it('prints exactly the chosen digits and never -0', () => {
    expect(JSON.stringify(roundWithin(0.30000000000000004, 0.001))).toBe('0.3')
    expect(Object.is(roundWithin(-0.0001, 0.01), -0)).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/*                                 expressions                                */
/* -------------------------------------------------------------------------- */

describe('expressionReach', () => {
  it('flags only the accesses that matter', () => {
    expect(
      expressionReach(['wiggle(2, 30)', 'loopOut("cycle")', 'value * 2 + key(numKeys).value']),
    ).toEqual({
      count: 3,
      indexed: false,
      layers: false,
      keys: false,
      paths: false,
    })
    expect(expressionReach(['content("Group 1").transform.opacity']).indexed).toBe(true)
    expect(expressionReach(['thisLayer.content(2).opacity']).indexed).toBe(true)
    expect(expressionReach(['"ADBE Vector Group"']).indexed).toBe(true)
    expect(expressionReach(['thisComp.layer("Null").transform.position']).layers).toBe(true)
    expect(expressionReach(['index / thisComp.numLayers']).layers).toBe(true)
    expect(expressionReach(['thisLayer.parent.transform.scale']).layers).toBe(true)
    expect(expressionReach(['p = transform.position; p.key(1).value']).keys).toBe(true)
    expect(expressionReach(['content("Shape").path.points()']).paths).toBe(true)
    expect(expressionReach(["effect('Slider Control')(1)"])).toMatchObject({
      indexed: false,
      layers: false,
      keys: false,
    })
  })
})

/* -------------------------------------------------------------------------- */
/*                                   legacy                                   */
/* -------------------------------------------------------------------------- */

describe('legacy', () => {
  it('moves end values to the next keyframe and drops easing names without changing values', async () => {
    const before = legacyAnimation()
    const { animation: after, report } = await runOnly(before, ['legacy'])
    const pos = (layersOf(after)[0].ks as J).p as J
    const kfs = pos.k as J[]
    expect(kfs.every((k) => !('e' in k) && !('n' in k))).toBe(true)
    expect(kfs[kfs.length - 1].s).toEqual([400, 400, 0])
    expect(report.steps.find((s) => s.id === 'legacy')?.details).toEqual({
      endValues: 3,
      easingNames: 3,
    })
    expect(propertyDiff(before, after).max).toBe(0)
    expectEquivalent(before, after)
  })

  it('gives the last keyframe the value players read (the previous end value)', async () => {
    // The last key's own `e` is never read: after it, players show the previous `e`.
    const a = doc([
      shapeLayer([group([rect(), fill()])], {
        ks: ks({
          r: {
            a: 1,
            k: [
              { t: 0, s: [0], e: [90], i: { x: [1], y: [1] }, o: { x: [0], y: [0] } },
              { t: 10, e: [5] },
            ],
          },
        }),
      }),
    ])
    const { animation } = await runOnly(a, ['legacy'])
    const r = ((layersOf(animation)[0].ks as J).r as J).k as J[]
    expect(r[1]).toEqual({ t: 10, s: [90] })
    expect(propertyDiff(a, animation).max).toBe(0)
  })

  it('keeps an `e` when it is the only value a keyframe has', async () => {
    const a = doc([
      shapeLayer([group([rect(), fill()])], { ks: ks({ r: { a: 1, k: [{ t: 0, e: [90] }] } }) }),
    ])
    const { animation } = await runOnly(a, ['legacy'])
    expect(((layersOf(animation)[0].ks as J).r as J).k).toEqual([{ t: 0, e: [90] }])
  })
})

/* -------------------------------------------------------------------------- */
/*                                   hidden                                   */
/* -------------------------------------------------------------------------- */

describe('hidden', () => {
  it('removes hidden layers and shapes but keeps hidden parents and matte sources', async () => {
    resetInd()
    const parent = nullLayer({ hd: true, nm: 'Hidden parent' })
    const child = shapeLayer([group([rect(), fill()])], { parent: parent.ind, nm: 'Child' })
    const matte = shapeLayer([group([ellipse(), fill()])], { td: 1, hd: true, nm: 'Matte' })
    const target = shapeLayer([group([rect(), fill()])], { tt: 1, nm: 'Target' })
    const gone = shapeLayer([group([rect(), fill()])], { hd: true, nm: 'Gone' })
    const hiddenShape = shapeLayer([group([rect({ hd: true }), rect({ nm: 'Kept' }), fill()])], {
      nm: 'Shapes',
    })
    const a = doc([parent, child, matte, target, gone, hiddenShape])
    const { animation, report } = await runOnly(a, ['hidden'])
    const names = layersOf(animation).map((l) => l.nm)
    expect(names).toEqual(['Hidden parent', 'Child', 'Matte', 'Target', 'Shapes'])
    const items = ((layersOf(animation)[4].shapes as J[])[0].it as J[]).map((i) => i.nm)
    expect(items).toEqual(['Kept', 'Fill', 'Transform'])
    expect(report.steps.find((s) => s.id === 'hidden')?.details).toEqual({ layers: 1, shapes: 1 })
    expectEquivalent(a, animation)
  })

  it('removes hidden groups and modifiers with a warning (lottie-web alone draws them)', async () => {
    const a = doc([shapeLayer([group([rect(), fill()], { hd: true }), group([ellipse(), fill()])])])
    const { animation, report } = await runOnly(a, ['hidden'])
    expect((layersOf(animation)[0].shapes as J[]).length).toBe(1)
    expect(report.warnings.map((w) => w.code)).toContain('hiddenGroups')
  })

  it('removes a chain of hidden parents once their children are gone', async () => {
    resetInd()
    const top = nullLayer({ hd: true })
    const mid = nullLayer({ hd: true, parent: top.ind })
    const leaf = shapeLayer([group([rect(), fill()])], { hd: true, parent: mid.ind })
    const { animation } = await runOnly(doc([top, mid, leaf]), ['hidden'])
    expect(layersOf(animation)).toHaveLength(0)
  })

  it('does nothing when expressions reach other layers; value-only expressions do not block', async () => {
    const blocked = await runOnly(hiddenWithExpr('thisComp.layer("Controls").transform.rotation'), [
      'hidden',
    ])
    expect(layersOf(blocked.animation)).toHaveLength(2)
    expect(blocked.report.warnings.find((w) => w.code === 'expressions')?.count).toBe(1)
    const free = await runOnly(hiddenWithExpr('time * 10'), ['hidden'])
    expect(layersOf(free.animation)).toHaveLength(1)
  })
})

/* -------------------------------------------------------------------------- */
/*                              invisible / empty                             */
/* -------------------------------------------------------------------------- */

describe('alwaysZero', () => {
  it('handles static, keyframed, holds and ranges', () => {
    expect(alwaysZero(p(0), 0, 60)).toBe(true)
    expect(alwaysZero(p(5), 0, 60)).toBe(false)
    const fade = kf([
      [0, 0],
      [10, 0],
      [20, 100],
    ])
    expect(alwaysZero(fade, 0, 10)).toBe(true)
    expect(alwaysZero(fade, 0, 10.5)).toBe(false)
    expect(
      alwaysZero(
        kf(
          [
            [0, 0],
            [20, 100],
          ],
          { hold: true },
        ),
        0,
        20,
      ),
    ).toBe(true)
    expect(
      alwaysZero(
        kf([
          [0, 100],
          [5, 0],
        ]),
        5,
        60,
      ),
    ).toBe(true)
    expect(alwaysZero(p(0, { x: 'value' }), 0, 60)).toBe(false)
    expect(alwaysZero(p(0, { sid: 'opacity' }), 0, 60)).toBe(false)
  })
})

describe('invisible', () => {
  it('removes layers that are transparent whenever shown, and zero-opacity fills', async () => {
    resetInd()
    const always = shapeLayer([group([rect(), fill()])], { ks: ks({ o: p(0) }), nm: 'transparent' })
    const fadesOutside = shapeLayer([group([rect(), fill()])], {
      ks: ks({
        o: kf([
          [0, 0],
          [30, 0],
          [40, 100],
        ]),
      }),
      op: 30,
      nm: 'fades after out point',
    })
    const fadesIn = shapeLayer([group([rect(), fill()])], {
      ks: ks({
        o: kf([
          [0, 0],
          [30, 100],
        ]),
      }),
      nm: 'fades in',
    })
    const zeroFill = shapeLayer(
      [group([rect(), fill({ o: p(0), nm: 'Invisible fill' }), stroke()])],
      { nm: 'zero fill' },
    )
    const { animation, report } = await runOnly(doc([always, fadesOutside, fadesIn, zeroFill]), [
      'invisible',
    ])
    expect(layersOf(animation).map((l) => l.nm)).toEqual(['fades in', 'zero fill'])
    const items = ((layersOf(animation)[1].shapes as J[])[0].it as J[]).map((i) => i.nm)
    expect(items).not.toContain('Invisible fill')
    expect(report.steps.find((s) => s.id === 'invisible')?.details).toEqual({
      layers: 2,
      shapes: 1,
    })
  })

  it('keeps transparent parents and matte sources', async () => {
    resetInd()
    const parent = nullLayer({ ks: ks({ o: p(0) }) })
    const child = shapeLayer([group([rect(), fill()])], { parent: parent.ind })
    const matte = shapeLayer([group([rect(), fill()])], { td: 1, ks: ks({ o: p(0) }) })
    const target = shapeLayer([group([rect(), fill()])], { tt: 1 })
    const { animation } = await runOnly(doc([parent, child, matte, target]), ['invisible'])
    expect(layersOf(animation)).toHaveLength(4)
  })
})

describe('empty', () => {
  it('removes layers never on screen, empty groups, unused nulls; keeps parents', async () => {
    resetInd()
    const early = shapeLayer([group([rect(), fill()])], { ip: 100, op: 120, nm: 'after the end' })
    const reversed = shapeLayer([group([rect(), fill()])], { ip: 30, op: 30, nm: 'zero length' })
    const atEnd = shapeLayer([group([rect(), fill()])], {
      ip: 60,
      op: 70,
      nm: 'starts at op (shown on the last frame)',
    })
    const parent = nullLayer({ nm: 'parent null' })
    const lonely = nullLayer({ nm: 'unused null' })
    const child = shapeLayer([group([rect(), fill()]), group([fill()]), group([rect()])], {
      parent: parent.ind,
      nm: 'child',
    })
    const unstyled = shapeLayer([group([rect()])], { nm: 'paints nothing' })
    const a = doc([early, reversed, atEnd, parent, lonely, child, unstyled])
    const { animation, report } = await runOnly(a, ['empty'])
    expect(layersOf(animation).map((l) => l.nm)).toEqual([
      'starts at op (shown on the last frame)',
      'parent null',
      'child',
    ])
    expect((layersOf(animation)[2].shapes as J[]).length).toBe(1)
    // Two empty groups in "child", and the one group of "paints nothing" before the layer goes.
    expect(report.steps.find((s) => s.id === 'empty')?.details).toEqual({ layers: 4, groups: 3 })
    expectEquivalent(a, animation)
  })

  it('keeps groups whose geometry is painted by a style outside them', async () => {
    const a = doc([shapeLayer([group([rect()]), fill()])])
    const { animation } = await runOnly(a, ['empty'])
    expect((layersOf(animation)[0].shapes as J[]).length).toBe(2)
  })

  it('uses precomp time mapping for layers inside precompositions', async () => {
    resetInd()
    const inner = [
      shapeLayer([group([rect(), fill()])], { ip: 0, op: 10, nm: 'early' }),
      shapeLayer([group([rect(), fill()])], { ip: 50, op: 60, nm: 'late' }),
    ]
    // Shown from frame 0 to 30 with st = -40: inner time 40..70 → "early" is never shown.
    const a = doc([precompLayer('comp', { st: -40, op: 30 })], {
      assets: [precompAsset('comp', inner)],
    })
    const { animation } = await runOnly(a, ['empty'])
    const layers = ((animation.assets as unknown as J[])[0].layers as J[]).map((l) => l.nm)
    expect(layers).toEqual(['late'])
    expectEquivalent(a, animation)
  })

  it('treats time-remapped precompositions as always shown', async () => {
    resetInd()
    const inner = [shapeLayer([group([rect(), fill()])], { ip: 500, op: 510 })]
    const a = doc(
      [
        precompLayer('comp', {
          tm: kf([
            [0, 0],
            [59, 20],
          ]),
        }),
      ],
      { assets: [precompAsset('comp', inner)] },
    )
    const { animation } = await runOnly(a, ['empty'])
    expect(((animation.assets as unknown as J[])[0].layers as J[]).length).toBe(1)
  })
})

/* -------------------------------------------------------------------------- */
/*                                   assets                                   */
/* -------------------------------------------------------------------------- */

describe('unusedAssets / dedupeAssets', () => {
  it('removes unreachable precomps and images, keeps slot-bound ones', async () => {
    resetInd()
    const a = doc([precompLayer('used')], {
      assets: [
        precompAsset('used', [imageLayer('img_used')]),
        precompAsset('unused', [imageLayer('img_unused')]),
        imageAsset('img_used'),
        imageAsset('img_unused'),
        imageAsset('img_slot', undefined, { sid: 'logo' }),
      ],
    })
    const { animation } = await runOnly(a, ['unusedAssets'])
    expect((animation.assets as unknown as J[]).map((x) => x.id)).toEqual([
      'used',
      'img_used',
      'img_slot',
    ])
  })

  it('merges identical precompositions (repeatedly) and images, remapping every reference', async () => {
    resetInd()
    const a = doc(
      [precompLayer('outer1'), precompLayer('outer2'), imageLayer('i1'), imageLayer('i2')],
      {
        assets: [
          precompAsset('inner1', sameContent()),
          precompAsset('inner2', sameContent(), { nm: 'another name' }),
          // Same layer names: names are runtime keypaths, so only truly identical content merges.
          precompAsset('outer1', [precompLayer('inner1', { ind: 1, nm: 'Inner' })]),
          precompAsset('outer2', [precompLayer('inner2', { ind: 1, nm: 'Inner' })]),
          imageAsset('i1'),
          imageAsset('i2'),
        ],
      },
    )
    const { animation, report } = await runOnly(a, ['dedupeAssets'])
    expect((animation.assets as unknown as J[]).map((x) => x.id)).toEqual([
      'inner1',
      'outer1',
      'i1',
    ])
    expect(layersOf(animation).map((l) => l.refId)).toEqual(['outer1', 'outer1', 'i1', 'i1'])
    expect(report.steps.find((s) => s.id === 'dedupeAssets')?.details.assets).toBe(3)
    expect(structureProblems(animation)).toEqual([])
    expectEquivalent(a, animation)
  })
})

/* -------------------------------------------------------------------------- */
/*                                  staticize                                 */
/* -------------------------------------------------------------------------- */

describe('staticize', () => {
  it('turns constant and single-keyframe properties static, scalars unwrapped', async () => {
    const a = doc([
      shapeLayer(
        [
          group([
            rect(),
            fill({
              c: kf([
                [0, [1, 0, 0, 1]],
                [30, [1, 0, 0, 1]],
              ]),
            }),
          ]),
        ],
        {
          ks: ks({
            r: kf([
              [0, 45],
              [30, 45],
              [59, 45],
            ]),
            o: { a: 1, k: [{ t: 10, s: [50] }] },
            p: kf(
              [
                [0, [10, 10, 0]],
                [20, [10, 10, 0]],
              ],
              { to: [50, 0, 0], ti: [-50, 0, 0] },
            ),
          }),
        },
      ),
    ])
    const { animation, report } = await runOnly(a, ['staticize'])
    const t = layersOf(animation)[0].ks as J
    expect(t.r).toEqual({ a: 0, k: 45 })
    expect(t.o).toEqual({ a: 0, k: 50 })
    // Equal end points with tangents are a loop: not constant.
    expect(Array.isArray((t.p as J).k) && ((t.p as J).k as J[])[0].t).toBe(0)
    expect(report.warnings.map((w) => w.code)).toContain('singleKeyframes')
    expect(structureProblems(animation)).toEqual([])
  })

  it('leaves expressions and slots alone', async () => {
    const a = doc([
      shapeLayer([group([rect(), fill()])], {
        ks: ks({
          r: {
            ...kf([
              [0, 5],
              [9, 5],
            ]),
            x: 'value',
          },
          o: {
            ...kf([
              [0, 5],
              [9, 5],
            ]),
            sid: 'o',
          },
        }),
      }),
    ])
    const { animation } = await runOnly(a, ['staticize'])
    const t = layersOf(animation)[0].ks as J
    expect(((t.r as J).k as J[]).length).toBe(2)
    expect(((t.o as J).k as J[]).length).toBe(2)
  })
})

/* -------------------------------------------------------------------------- */
/*                                  keyframes                                 */
/* -------------------------------------------------------------------------- */

describe('simplifyProperty', () => {
  const exact = { abs: 0, rel: 0 }

  it('removes exactly collinear linear keyframes and constant runs (zero tolerance)', () => {
    const prop = kf([
      [0, 0],
      [10, 10],
      [20, 20],
      [30, 30],
      [40, 30],
      [50, 30],
      [60, 100],
    ])
    const before = structuredClone(prop)
    const r = simplifyProperty(prop, exact)
    expect((prop.k as J[]).map((k) => k.t)).toEqual([0, 30, 50, 60])
    expect(r.removed).toBe(3)
    expect(
      propertyDiff(
        doc([shapeLayer([], { ks: ks({ r: before }) })]),
        doc([shapeLayer([], { ks: ks({ r: prop }) })]),
      ).max,
    ).toBeLessThan(1e-9)
  })

  it('keeps easing-shaped keys under a zero tolerance and respects holds', () => {
    const eased = kf(
      [
        [0, 0],
        [10, 50],
        [20, 100],
      ],
      { o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } },
    )
    expect(simplifyProperty(eased, exact).removed).toBe(0)
    const hold = kf(
      [
        [0, 0],
        [10, 50],
        [20, 100],
      ],
      { hold: true },
    )
    expect(simplifyProperty(hold, exact).removed).toBe(0)
    const holdSame = kf(
      [
        [0, 5],
        [10, 5],
        [20, 100],
      ],
      { hold: true },
    )
    expect(simplifyProperty(holdSame, exact).removed).toBe(1)
  })

  it('drops repeated leading and trailing keys and becomes static when one remains', () => {
    const prop = kf([
      [0, 7],
      [10, 7],
      [20, 7],
    ])
    const r = simplifyProperty(prop, exact)
    expect(r.static).toBe(true)
    expect(prop.k).toBe(7)
    const lead = kf([
      [0, 3],
      [10, 3],
      [20, 9],
      [30, 9],
    ])
    simplifyProperty(lead, exact)
    expect((lead.k as J[]).map((k) => k.t)).toEqual([10, 20])
  })

  it('simplifies a baked eased curve within the budget and never beyond it', () => {
    const frames: [number, number][] = []
    for (let f = 0; f <= 120; f++) frames.push([f, 200 * Math.sin((f / 120) * Math.PI)])
    const prop = kf(frames)
    const ref = structuredClone(prop)
    const tol = { abs: 0.05, rel: 0 }
    simplifyProperty(prop, tol)
    const kept = (prop.k as J[]).length
    expect(kept).toBeLessThan(121)
    const d = propertyDiff(
      doc([shapeLayer([], { ks: ks({ r: ref }), op: 121 })], { op: 121 }),
      doc([shapeLayer([], { ks: ks({ r: prop }), op: 121 })], { op: 121 }),
    )
    expect(d.max).toBeLessThanOrEqual(0.05 + 1e-9)
  })

  it('keeps spatial motion paths exact when the tolerance is zero', () => {
    const prop = kf(
      [
        [0, [0, 0, 0]],
        [10, [100, 0, 0]],
        [20, [100, 100, 0]],
      ],
      { to: [30, 30, 0], ti: [-30, 30, 0] },
    )
    expect(simplifyProperty(prop, exact).removed).toBe(0)
  })

  it('gives the new first key an easing handle for legacy colors when a leading key goes', () => {
    const red = [255, 0, 0, 255]
    const prop: J = {
      a: 1,
      k: [
        { t: 0, s: red, o: { x: [0.2], y: [0.2] }, i: { x: [0.8], y: [0.8] } },
        { t: 10, s: red, h: 1 },
        { t: 20, s: [0, 0, 255, 255] },
      ],
    }
    simplifyProperty(prop, exact, true)
    const kfs = prop.k as J[]
    expect(kfs.map((k) => k.t)).toEqual([10, 20])
    expect(kfs[0].i).toEqual({ x: [0.8], y: [0.8] })
  })
})

describe('keyframes technique', () => {
  it('reduces a baked animation by an order of magnitude, within tolerance, structurally valid', async () => {
    const baked = bakedAnimation(600)
    const { animation, report } = await runOnly(baked, ['keyframes'])
    const step = report.steps.find((s) => s.id === 'keyframes')!
    expect(step.details.keyframes).toBeGreaterThan(1500)
    expect(report.after.raw).toBeLessThan(report.before.raw / 3)
    expect(structureProblems(animation)).toEqual([])
    const r = verifySemantic(baked, animation, { tolerance: { geometry: 0.05 } })
    expect(r.equivalent, describeMismatches(r.mismatches)).toBe(true)
  })

  it('does nothing when expressions may address other properties keys', async () => {
    const blocked = await runOnly(keysWithExpr('transform.rotation.key(2).value'), ['keyframes'])
    expect(blocked.report.steps.find((s) => s.id === 'keyframes')?.changes).toBe(0)
    // The expression's own keys (bare `key(n)`) are never touched: other properties may be.
    const own = await runOnly(keysWithExpr('key(1).value + numKeys'), ['keyframes'])
    expect(own.report.steps.find((s) => s.id === 'keyframes')?.details.keyframes).toBe(1)
  })
})

/* -------------------------------------------------------------------------- */
/*                                    paths                                   */
/* -------------------------------------------------------------------------- */

describe('simplifyPath', () => {
  it('merges duplicate vertices and removes straight-run vertices (exact)', () => {
    const prop = {
      a: 0,
      k: bezier([
        [0, 0],
        [50, 0],
        [100, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ]),
    }
    expect(simplifyPath(prop, 0).removed).toBe(2)
    expect((prop.k as J).v).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ])
  })

  it('never removes curve vertices, endpoints, or vertices at different fractions per keyframe', () => {
    const curved = {
      a: 0,
      k: bezier(
        [
          [0, 0],
          [50, 0],
          [100, 0],
        ],
        false,
        {
          i: [
            [0, 0],
            [-10, 5],
            [0, 0],
          ],
          o: [
            [0, 0],
            [10, -5],
            [0, 0],
          ],
        },
      ),
    }
    expect(simplifyPath(curved, 0).removed).toBe(0)
    const endpoints = {
      a: 0,
      k: bezier(
        [
          [0, 0],
          [100, 0],
        ],
        false,
      ),
    }
    expect(simplifyPath(endpoints, 0).removed).toBe(0)
    const moving = kf([
      [
        0,
        [
          bezier([
            [0, 0],
            [50, 0],
            [100, 0],
            [100, 100],
          ]),
        ],
      ],
      [
        10,
        [
          bezier([
            [0, 0],
            [20, 0],
            [100, 0],
            [100, 100],
          ]),
        ],
      ],
    ])
    expect(simplifyPath(moving, 0).removed).toBe(0)
    const sliding = kf([
      [
        0,
        [
          bezier([
            [0, 0],
            [50, 0],
            [100, 0],
            [100, 100],
          ]),
        ],
      ],
      [
        10,
        [
          bezier([
            [0, 0],
            [50, 50],
            [100, 100],
            [100, 200],
          ]),
        ],
      ],
    ])
    expect(simplifyPath(sliding, 0).removed).toBe(1)
  })

  it('skips layers with vertex-driven modifiers', async () => {
    const straight = bezier([
      [0, 0],
      [50, 0],
      [100, 0],
      [100, 100],
    ])
    const a = doc([
      shapeLayer([group([path(straight), { ty: 'rd', r: p(10), nm: 'Round' }, fill()])]),
    ])
    const { report } = await runOnly(a, ['paths'], { preset: 'safe' })
    expect(report.steps.find((s) => s.id === 'paths')?.changes).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/*                                  precision                                 */
/* -------------------------------------------------------------------------- */

describe('precision', () => {
  it('uses more decimals inside magnifying transforms', async () => {
    const { animation } = await runOnly(doc([scaledShape(100), scaledShape(1000)]), ['precision'])
    const v = (i: number) =>
      (((layersOf(animation)[i].shapes as J[])[0].it as J[])[0].ks as J).k as J
    const maxDecimals = (i: number) => Math.max(...(v(i).v as number[][]).flat().map(decimals))
    expect(maxDecimals(0)).toBeLessThan(maxDecimals(1))
  })

  it('keeps times, counts and unknown data exact', async () => {
    const a = doc([
      shapeLayer(
        [
          group([
            rect(),
            fill(),
            {
              ty: 'rp',
              c: p(3.0000001),
              o: p(0.5),
              m: 1,
              tr: {
                ty: 'tr',
                p: p([10, 0]),
                a: p([0, 0]),
                s: p([100, 100]),
                r: p(0),
                so: p(100),
                eo: p(100),
              },
              nm: 'Repeater',
            },
          ]),
        ],
        {
          ks: ks({
            r: kf([
              [0.123456, 10.123456],
              [29.987654, 20.987654],
            ]),
          }),
          ip: 0.333333,
          op: 59.777777,
        },
      ),
    ])
    const { animation } = await runOnly(a, ['precision'])
    const l = layersOf(animation)[0]
    expect(l.ip).toBe(0.333333)
    expect(l.op).toBe(59.777777)
    expect((((l.ks as J).r as J).k as J[]).map((k) => k.t)).toEqual([0.123456, 29.987654])
    const rp = ((l.shapes as J[])[0].it as J[])[2]
    expect((rp.c as J).k).toBe(3.0000001)
  })

  it('verifies keyframed rounding and falls back to finer steps on steep easing', () => {
    // A 5000 px move with a very steep easing: 2-decimal handles would move it by pixels.
    const prop = kf(
      [
        [0, [0, 0]],
        [30, [5000, 0]],
      ],
      { o: { x: [0.97654], y: [0.00123] }, i: { x: [0.03456], y: [0.99876] } },
    )
    const ref = structuredClone(prop)
    roundProperty(prop, { abs: 0.02, rel: 0 })
    const d = propertyDiff(
      doc([shapeLayer([], { ks: ks({ a: ref }) })]),
      doc([shapeLayer([], { ks: ks({ a: prop }) })]),
    )
    expect(d.max).toBeLessThanOrEqual(0.02 + 1e-9)
  })

  it('stays within the pixel tolerance on real geometry (semantic check)', async () => {
    const baked = bakedAnimation(120)
    const { animation } = await runOnly(baked, ['precision'], { pxTolerance: 0.1 })
    const r = verifySemantic(baked, animation, { tolerance: { geometry: 0.1 } })
    expect(r.equivalent, describeMismatches(r.mismatches)).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/*                                  defaults                                  */
/* -------------------------------------------------------------------------- */

describe('defaults', () => {
  it('removes defaults every player assumes, keeps the ones that matter', async () => {
    const a = doc([
      shapeLayer([group([rect(), ellipse(), fill(), stroke()])], {
        ks: ks({ p: p([0, 0, 0]) }),
        masksProperties: [],
        hasMask: false,
        ef: [],
      }),
    ])
    const { animation } = await runOnly(a, ['defaults'])
    const l = layersOf(animation)[0]
    for (const key of ['ddd', 'sr', 'ao', 'bm', 'masksProperties', 'hasMask', 'ef'])
      expect(l).not.toHaveProperty(key)
    for (const key of ['ty', 'ind', 'ip', 'op', 'st', 'ks', 'nm']) expect(l).toHaveProperty(key)
    // Identity layer transform: only what differs is kept (layer opacity 100 goes too).
    expect(Object.keys(l.ks as J)).toEqual([])
    const items = (l.shapes as J[])[0].it as J[]
    const [rc, el, fl, st, t] = items
    expect(rc.d).toBe(1) // lottie-web draws a rectangle without `d` counter-clockwise
    expect(el).not.toHaveProperty('d')
    expect(fl).not.toHaveProperty('r')
    expect(fl).not.toHaveProperty('hd')
    expect(st.lc).toBe(2)
    expect(st.lj).toBe(2)
    expect(t).toHaveProperty('o') // group opacity is required by lottie-web
    expect(Object.keys(t).sort()).toEqual(['nm', 'o', 'ty'])
    expect(a).not.toBe(animation)
    expectEquivalent(a, animation)
    expect(structureProblems(animation)).toEqual([])
  })

  it('keeps layer blend modes when another layer blends (lottie-web canvas keeps blend state)', async () => {
    const a = doc([
      shapeLayer([group([rect(), fill()])], { bm: 0 }),
      shapeLayer([group([rect(), fill()])], { bm: 1 }),
    ])
    const { animation } = await runOnly(a, ['defaults'])
    expect(layersOf(animation).map((l) => l.bm)).toEqual([0, 1])
  })

  it('removes unused easing (last keyframe, holds), zero tangents, compacts handles', async () => {
    const a = doc([
      shapeLayer([group([rect(), fill()])], {
        ks: ks({
          p: kf(
            [
              [0, [0, 0, 0]],
              [10, [100, 0, 0]],
            ],
            { to: [0, 0, 0], ti: [0, 0, 0] },
          ),
          r: kf(
            [
              [0, 0],
              [10, 90],
              [20, 90],
            ],
            { hold: true },
          ),
          o: kf([
            [0, 0],
            [10, 100],
          ]),
        }),
      }),
    ])
    const { animation } = await runOnly(a, ['defaults'])
    const t = layersOf(animation)[0].ks as J
    const pk = (t.p as J).k as J[]
    expect(pk[0]).not.toHaveProperty('to')
    expect(pk[0].o).toEqual({ x: 0.167, y: 0.167 })
    const ok = (t.o as J).k as J[]
    expect(ok[1]).toEqual({ t: 10, s: [100] })
    const rk = (t.r as J).k as J[]
    expect(rk[0]).toEqual({ t: 0, s: [0], h: 1 })
    expect(structureProblems(animation)).toEqual([])
    expectEquivalent(a, animation, 1e-4)
  })

  it('keeps spatial tangents with per-dimension easing and hold easing with tangents', async () => {
    const perDim = {
      o: { x: [0.1, 0.9], y: [0, 0] },
      i: { x: [0.9, 0.1], y: [1, 1] },
      to: [0, 0, 0],
      ti: [0, 0, 0],
    }
    const a = doc([
      shapeLayer([group([rect(), fill()])], {
        ks: ks({
          p: kf(
            [
              [0, [0, 0, 0]],
              [10, [100, 50, 0]],
            ],
            perDim,
          ),
        }),
      }),
    ])
    const { animation } = await runOnly(a, ['defaults'])
    const pk = ((layersOf(animation)[0].ks as J).p as J).k as J[]
    expect(pk[0].to).toEqual([0, 0, 0])
    expect(pk[0].o).toEqual({ x: [0.1, 0.9], y: [0, 0] })
  })

  it('keeps expression-only fields when an expression looks items up by index or match name', async () => {
    for (const x of [
      'content(1).transform.opacity',
      'thisLayer.content("ADBE Vector Group").opacity',
      'transform("Scale")',
    ]) {
      const a = doc([shapeLayer([group([rect(), fill()])], { ks: ks({ r: p(0, { x, ix: 10 }) }) })])
      const { animation } = await runOnly(a, ['defaults'])
      const g = (layersOf(animation)[0].shapes as J[])[0]
      expect(g).toHaveProperty('ix')
      expect(g).toHaveProperty('mn')
      expect(((layersOf(animation)[0].ks as J).r as J).ix).toBe(10)
      expect(Object.keys((g.it as J[])[2])).toContain('sk')
    }
  })

  it('removes them when expressions only use values and names (wiggle, effects, own keys)', async () => {
    const x = "var a = effect('Slider')(1); wiggle(a, 5) + key(numKeys).value"
    const a = doc([shapeLayer([group([rect(), fill()])], { ks: ks({ r: p(0, { x, ix: 10 }) }) })])
    const { animation } = await runOnly(a, ['defaults'])
    const g = (layersOf(animation)[0].shapes as J[])[0]
    expect(g).not.toHaveProperty('ix')
    expect(g).not.toHaveProperty('mn')
    // The property with the expression keeps its value and expression.
    expect((layersOf(animation)[0].ks as J).r).toEqual({ a: 0, k: 0, x })
  })

  it('keeps the first color keyframe easing of files older than 4.1.9', async () => {
    const e = { i: { x: [0.8], y: [0.8] }, o: { x: [0.2], y: [0.2] } }
    const c = {
      a: 1,
      k: [
        { t: 0, s: [255, 0, 0, 255], h: 1, ...e },
        { t: 10, s: [0, 0, 255, 255], h: 1, ...e },
        { t: 20, s: [0, 255, 0, 255] },
      ],
    }
    const a = doc([shapeLayer([group([rect(), fill({ c })])])], { v: '4.0.0' })
    const { animation } = await runOnly(a, ['defaults'])
    const keys = (((layersOf(animation)[0].shapes as J[])[0].it as J[])[1].c as J).k as J[]
    expect(keys[0]).toHaveProperty('i')
    expect(keys[1]).not.toHaveProperty('i')
  })
})

/* -------------------------------------------------------------------------- */
/*                                    names                                   */
/* -------------------------------------------------------------------------- */

describe('names', () => {
  it('strips by scope and warns', async () => {
    const a = doc([
      shapeLayer([group([rect(), fill({ cl: 'brand' })])], {
        nm: 'Keep me',
        cl: 'layer-class',
        masksProperties: [
          {
            mode: 'a',
            pt: p(
              bezier([
                [0, 0],
                [1, 0],
                [1, 1],
              ]),
            ),
            o: p(100),
            x: p(0),
            inv: false,
            nm: 'Mask 1',
            cl: true,
          },
        ],
        hasMask: true,
      }),
    ])
    const shapes = await runOnly(a, ['names'], { names: { scope: 'shapes', classes: false } })
    const l1 = layersOf(shapes.animation)[0]
    expect(l1.nm).toBe('Keep me')
    expect((l1.masksProperties as J[])[0].nm).toBe('Mask 1')
    expect(((l1.shapes as J[])[0] as J).nm).toBeUndefined()
    expect(shapes.report.warnings.map((w) => w.code)).toContain('namesStripped')
    const all = await runOnly(a, ['names'], { names: { scope: 'all', classes: true } })
    const l2 = layersOf(all.animation)[0]
    expect(l2.nm).toBeUndefined()
    expect(l2.cl).toBeUndefined()
    // The mask `cl` means "closed" in old files: never stripped.
    expect((l2.masksProperties as J[])[0].cl).toBe(true)
  })

  it('keeps stroke dash names (lottie-web defines them as properties; without them it throws)', async () => {
    const dashes = [
      { n: 'd', nm: 'dash', v: p(10) },
      { n: 'g', nm: 'gap', v: p(5) },
      { n: 'o', nm: 'offset', v: p(0) },
    ]
    const a = doc([shapeLayer([group([rect(), stroke({ d: dashes, nm: 'Stroke 1' })])])])
    const r = await runOnly(a, ['names'], { names: { scope: 'all', classes: true } })
    const st = (((layersOf(r.animation)[0].shapes as J[])[0] as J).it as J[])[1]
    expect(st.nm).toBeUndefined()
    expect((st.d as J[]).map((d) => d.nm)).toEqual(['dash', 'gap', 'offset'])
  })

  it('keeps names that expressions can look up', async () => {
    const lookups = await runOnly(withExpr('content("Group").transform.rotation'), ['names'], {
      names: { scope: 'shapes', classes: false },
    })
    expect((layersOf(lookups.animation)[0].shapes as J[])[0].nm).toBe('Group')
    const values = await runOnly(withExpr('wiggle(2, 10)'), ['names'], {
      names: { scope: 'shapes', classes: false },
    })
    expect((layersOf(values.animation)[0].shapes as J[])[0].nm).toBeUndefined()
    const layers = await runOnly(
      withExpr('thisComp.layer("Shape Layer").transform.rotation'),
      ['names'],
      { names: { scope: 'all', classes: false } },
    )
    expect(layersOf(layers.animation)[0].nm).toBe('Shape Layer')
  })
})

/* -------------------------------------------------------------------------- */
/*                                   images                                   */
/* -------------------------------------------------------------------------- */

describe('images (Node)', () => {
  it('reports that the technique needs a browser and keeps the images', async () => {
    resetInd()
    const a = doc([imageLayer('img')], { assets: [imageAsset('img')] })
    const { animation, report } = await runOnly(a, ['images'])
    expect(json(animation.assets)).toBe(json(a.assets))
    expect(report.warnings.map((w) => w.code)).toContain('imagesUnavailable')
  })

  it('recognizes animated PNG and WebP', () => {
    const apng = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0,
      0,
      0,
      8,
      ...bytes('acTL'),
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ])
    expect(isAnimatedImage(apng, 'image/png')).toBe(true)
    const webp = new Uint8Array([
      ...bytes('RIFF'),
      0,
      0,
      0,
      0,
      ...bytes('WEBPVP8X'),
      0,
      0,
      0,
      0,
      ...bytes('ANIM'),
    ])
    expect(isAnimatedImage(webp, 'image/webp')).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/*                                Shared checks                               */
/* -------------------------------------------------------------------------- */

describe('structure checks of the harness', () => {
  it('flags broken documents', () => {
    const broken = doc([shapeLayer([{ ty: 'gr', it: [rect(), fill()] }], { parent: 99 })])
    const problems = structureProblems(broken)
    expect(problems.some((x) => x.includes('group does not end'))).toBe(true)
    expect(problems.some((x) => x.includes('parent 99'))).toBe(true)
  })

  it('accepts the builders', () => {
    expect(structureProblems(doc([shapeLayer([group([rect(), fill()]), tr()])]))).toEqual([])
  })
})
