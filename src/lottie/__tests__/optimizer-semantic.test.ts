/**
 * The scene-level verifier must be sharp: every visible change is caught (otherwise the
 * equivalence tests prove nothing), while changes that draw the same scene pass.
 */
import { describe, expect, it } from 'vitest'
import { buildScene, verifySemantic } from '../optimizer/semantic'
import type { Animation } from '../types'
import {
  bezier,
  doc,
  ellipse,
  fill,
  group,
  imageAsset,
  imageLayer,
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
  type J,
} from './fixtures/optimizer/builders'

const TOL = { geometry: 0.1, opacity: 0.005, color: 0.005, other: 0.01 }

function base(): Animation {
  resetInd()
  const parent = nullLayer({
    nm: 'Parent',
    ks: ks({
      r: kf([
        [0, 0],
        [59, 90],
      ]),
    }),
  })
  const hiddenLayer = shapeLayer([group([rect(), fill()])], { hd: true, nm: 'Hidden' })
  const matte = shapeLayer([group([ellipse({ s: p([200, 200]) }), fill()])], { td: 1, nm: 'Matte' })
  const target = shapeLayer(
    [
      group([
        path(
          bezier([
            [0, 0],
            [50, 0],
            [100, 0],
            [100, 100],
            [0, 100],
          ]),
        ),
        fill({ c: p([0.2, 0.4, 0.6, 1]) }),
      ]),
      group(
        [
          rect({
            s: kf([
              [0, [10, 10]],
              [30, [80, 40]],
            ]),
          }),
          fill(),
        ],
        {},
        {
          o: kf([
            [0, 100],
            [59, 20],
          ]),
        },
      ),
    ],
    {
      tt: 1,
      parent: parent.ind,
      nm: 'Target',
      masksProperties: [
        {
          mode: 'a',
          inv: false,
          pt: p(
            bezier([
              [-50, -50],
              [150, -50],
              [150, 150],
              [-50, 150],
            ]),
          ),
          o: p(100),
          x: p(0),
        },
      ],
      hasMask: true,
    },
  )
  const inner = [shapeLayer([group([ellipse(), fill()])], { ind: 1, nm: 'Inner' })]
  const comp = precompLayer('comp', { nm: 'Precomp', st: 5 })
  const image = imageLayer('img', { nm: 'Image' })
  return doc([parent, hiddenLayer, matte, target, comp, image], {
    assets: [precompAsset('comp', inner), imageAsset('img')],
  })
}

const clone = (a: Animation) => JSON.parse(JSON.stringify(a)) as Animation
const L = (a: Animation, nm: string) => (a.layers as unknown as J[]).find((l) => l.nm === nm)!
const shapes = (layer: J) => layer.shapes as J[]
const items = (g: J) => g.it as J[]

const changeImage = (b: Animation) => (((b.assets as unknown as J[])[1].p as string) += 'AA')

function differs(change: (a: Animation) => void, opts = {}): boolean {
  const a = base()
  const b = clone(a)
  change(b)
  return !verifySemantic(a, b, { tolerance: TOL, ...opts }).equivalent
}

describe('verifySemantic catches visible changes', () => {
  it('a path vertex moved by 0.2 px', () => {
    expect(
      differs(
        (b) =>
          ((((items(shapes(L(b, 'Target'))[0])[0].ks as J).k as J).v as number[][])[3][0] += 0.2),
      ),
    ).toBe(true)
  })
  it('a color channel changed by 0.01', () => {
    expect(
      differs((b) => (((items(shapes(L(b, 'Target'))[0])[1].c as J).k as number[])[1] += 0.01)),
    ).toBe(true)
  })
  it('a group opacity keyframe changed', () => {
    expect(
      differs(
        (b) => ((((items(shapes(L(b, 'Target'))[1])[2].o as J).k as J[])[1].s as number[])[0] = 30),
      ),
    ).toBe(true)
  })
  it('a keyframe moved in time', () => {
    expect(
      differs((b) => (((items(shapes(L(b, 'Target'))[1])[0].s as J).k as J[])[1].t = 29)),
    ).toBe(true)
  })
  it('a visible layer removed', () => {
    expect(
      differs(
        (b) => (b.layers = (b.layers as unknown as J[]).filter((l) => l.nm !== 'Image') as never),
      ),
    ).toBe(true)
  })
  it('two layers swapped', () => {
    expect(differs((b) => b.layers.push(...b.layers.splice(4, 1)))).toBe(true)
  })
  it('the matte mode changed', () => {
    expect(differs((b) => (L(b, 'Target').tt = 2))).toBe(true)
  })
  it('the matte source content changed', () => {
    expect(differs((b) => ((items(shapes(L(b, 'Matte'))[0])[0].s as J).k = [210, 200]))).toBe(true)
  })
  it('a mask changed', () => {
    expect(differs((b) => ((L(b, 'Target').masksProperties as J[])[0].inv = true))).toBe(true)
  })
  it('the parent animation changed', () => {
    expect(differs((b) => ((((L(b, 'Parent').ks as J).r as J).k as J[])[1].s = [91]))).toBe(true)
  })
  it('a precomp start time changed (time mapping)', () => {
    expect(differs((b) => (L(b, 'Precomp').st = 6), { frames: [10] })).toBe(false)
    const a = base()
    const inner = ((a.assets as unknown as J[])[0].layers as J[])[0]
    ;(inner.ks as J).p = kf([
      [0, [0, 0, 0]],
      [59, [100, 0, 0]],
    ])
    const b = clone(a)
    L(b, 'Precomp').st = 6
    expect(verifySemantic(a, b, { tolerance: TOL }).equivalent).toBe(false)
  })
  it('a rectangle drawn in the other direction (trim paths would differ)', () => {
    expect(differs((b) => delete items(shapes(L(b, 'Target'))[1])[0].d)).toBe(true)
  })
  it('image pixels changed, unless images are compared by size', () => {
    expect(differs(changeImage)).toBe(true)
    expect(differs(changeImage, { ignoreImageData: true })).toBe(false)
  })
})

describe('verifySemantic accepts invisible changes', () => {
  it('hidden layer removed', () => {
    expect(
      differs(
        (b) => (b.layers = (b.layers as unknown as J[]).filter((l) => l.nm !== 'Hidden') as never),
      ),
    ).toBe(false)
  })
  it('empty group added, names and indices stripped', () => {
    expect(
      differs((b) => {
        shapes(L(b, 'Target')).push({ ty: 'gr', it: [{ ty: 'tr', o: p(100) }] })
        for (const g of shapes(L(b, 'Target'))) {
          delete g.nm
          delete g.mn
          delete g.ix
        }
      }),
    ).toBe(false)
  })
  it('a straight-run vertex removed', () => {
    expect(
      differs((b) => {
        const k = (items(shapes(L(b, 'Target'))[0])[0].ks as J).k as J
        for (const key of ['v', 'i', 'o']) (k[key] as number[][]).splice(1, 1)
      }),
    ).toBe(false)
  })
})

describe('buildScene', () => {
  it('produces paint operations bottom to top with world geometry', () => {
    // Frame 0: the precomposition starts at 5, its content is not shown yet.
    expect(buildScene(base(), 0).map((op) => op.kind)).toEqual(['image', 'fl', 'fl'])
    const scene = buildScene(base(), 10)
    expect(scene.map((op) => op.kind)).toEqual(['image', 'fl', 'fl', 'fl'])
    const first = buildScene(base(), 0)
    const target = first[2]
    expect(target.matte?.ops.length).toBe(1)
    expect(target.masks.length).toBe(1)
    // Parent position (256, 256) + layer position (256, 256): the first vertex lands at 512, 512.
    expect(target.paths[0].points.slice(0, 2)).toEqual([512, 512])
  })
})
