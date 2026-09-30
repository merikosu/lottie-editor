import { describe, expect, it } from 'vitest'
import {
  ANCHORS,
  anchorFactors,
  boundsFrames,
  contentBounds,
  createBoundsSampler,
  fitCanvasToContent,
  pathAfterPrecompose,
  planFit,
  planResize,
  precomposeRoot,
  resizeCanvas,
  translateContent,
  uniqueAssetId,
  type Rect,
} from '../canvas'
import { evaluatePosition } from '../property'
import type { Animation, Layer, ShapeItem, VectorProperty } from '../types'
import { frames, loadBounce, loadTestJson, snapshot, snapshotDiff } from './docops.fixtures'

/* -------------------------------------------------------------------------- */
/*                                  Builders                                  */
/* -------------------------------------------------------------------------- */

const fill = (): ShapeItem => ({ ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } })
const stroke = (w: number, extra: Partial<ShapeItem> = {}): ShapeItem =>
  ({
    ty: 'st',
    c: { a: 0, k: [0, 0, 0, 1] },
    o: { a: 0, k: 100 },
    w: { a: 0, k: w },
    lj: 2,
    lc: 2,
    ...extra,
  }) as ShapeItem
const rectItem = (x: number, y: number, w: number, h: number): ShapeItem => ({
  ty: 'rc',
  p: { a: 0, k: [x, y] },
  s: { a: 0, k: [w, h] },
  r: { a: 0, k: 0 },
})

function shapeLayer(shapes: ShapeItem[], ks: Layer['ks'] = {}, extra: Partial<Layer> = {}): Layer {
  return { ty: 4, ind: 1, ip: 0, op: 30, st: 0, ks, shapes, ...extra } as Layer
}

function doc(layers: Layer[], extra: Partial<Animation> = {}): Animation {
  return { v: '5.7.0', fr: 30, ip: 0, op: 30, w: 200, h: 100, layers, assets: [], ...extra }
}

function expectRect(r: Rect | null, x: number, y: number, w: number, h: number, digits = 3) {
  expect(r).not.toBeNull()
  expect(r!.x).toBeCloseTo(x, digits)
  expect(r!.y).toBeCloseTo(y, digits)
  expect(r!.width).toBeCloseTo(w, digits)
  expect(r!.height).toBeCloseTo(h, digits)
}

const staticP = (x: number, y: number): VectorProperty => ({ a: 0, k: [x, y, 0] })

function ring(trims: ShapeItem[]) {
  return contentBounds(
    doc([
      shapeLayer([
        { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, d: 1 },
        stroke(2),
        ...trims,
      ]),
    ]),
  )
}

function trim(s: number, e: number, o = 0, m: 1 | 2 = 1): ShapeItem {
  return { ty: 'tm', s: { a: 0, k: s }, e: { a: 0, k: e }, o: { a: 0, k: o }, m } as ShapeItem
}

/* -------------------------------------------------------------------------- */

describe('anchors', () => {
  it('maps the 3 × 3 grid to factors', () => {
    expect(ANCHORS).toHaveLength(9)
    expect(anchorFactors('top-left')).toEqual({ x: 0, y: 0 })
    expect(anchorFactors('top')).toEqual({ x: 0.5, y: 0 })
    expect(anchorFactors('center')).toEqual({ x: 0.5, y: 0.5 })
    expect(anchorFactors('right')).toEqual({ x: 1, y: 0.5 })
    expect(anchorFactors('bottom-left')).toEqual({ x: 0, y: 1 })
    expect(anchorFactors('bottom-right')).toEqual({ x: 1, y: 1 })
  })
})

describe('planResize', () => {
  it('places the old canvas at the anchor when resizing', () => {
    expect(
      planResize({ w: 100, h: 100 }, 300, 200, { mode: 'resize', anchor: 'center' }),
    ).toMatchObject({ dx: 100, dy: 50, scale: 1 })
    expect(
      planResize({ w: 100, h: 100 }, 300, 200, { mode: 'resize', anchor: 'top-left' }),
    ).toMatchObject({ dx: 0, dy: 0 })
    expect(
      planResize({ w: 100, h: 100 }, 50, 60, { mode: 'resize', anchor: 'bottom-right' }),
    ).toMatchObject({ dx: -50, dy: -40 })
  })

  it('fits the content uniformly when scaling', () => {
    expect(planResize({ w: 512, h: 512 }, 1080, 1080, { mode: 'scale' })).toMatchObject({
      scale: 1080 / 512,
      dx: 0,
      dy: 0,
    })
    expect(planResize({ w: 200, h: 100 }, 100, 100, { mode: 'scale' })).toMatchObject({
      scale: 0.5,
      dx: 0,
      dy: 25,
    })
    expect(
      planResize({ w: 200, h: 100 }, 100, 100, { mode: 'scale', anchor: 'top' }),
    ).toMatchObject({ scale: 0.5, dy: 0 })
  })
})

describe('translateContent', () => {
  it('moves static, animated, split and missing positions of unparented layers', () => {
    const anim = doc([
      shapeLayer([], { p: staticP(10, 20) }, { ind: 1 }),
      shapeLayer(
        [],
        {
          p: {
            a: 1,
            k: [
              {
                t: 0,
                s: [0, 0, 0],
                e: [5, 5, 0],
                o: { x: 0.2, y: 0.2 },
                i: { x: 0.8, y: 0.8 },
                to: [1, 1, 0],
                ti: [2, 2, 0],
              },
              { t: 10, s: [5, 5, 0] },
            ],
          },
        },
        { ind: 2 },
      ),
      shapeLayer(
        [],
        {
          p: {
            s: true,
            x: { a: 0, k: 7 },
            y: {
              a: 1,
              k: [
                { t: 0, s: [1], o: { x: [0.2], y: [0.2] }, i: { x: [0.8], y: [0.8] } },
                { t: 5, s: [2] },
              ],
            },
          },
        },
        { ind: 3 },
      ),
      shapeLayer([], {}, { ind: 4 }),
      shapeLayer([], { p: staticP(1, 1) }, { ind: 5, parent: 1 }),
      shapeLayer([], { p: staticP(1, 1) }, { ind: 6, parent: 99 }),
    ])
    translateContent(anim, 100, -10)
    const [a, b, c, d, child, orphan] = anim.layers
    expect(a.ks.p).toEqual({ a: 0, k: [110, 10, 0] })
    const bk = (b.ks.p as VectorProperty).k as { s: number[]; e?: number[]; to?: number[] }[]
    expect(bk[0].s).toEqual([100, -10, 0])
    expect(bk[0].e).toEqual([105, -5, 0])
    expect(bk[0].to).toEqual([1, 1, 0])
    expect(bk[1].s).toEqual([105, -5, 0])
    expect(c.ks.p).toMatchObject({ s: true, x: { k: 107 } })
    expect(evaluatePosition(c.ks.p, 5)).toEqual([107, -8])
    expect(d.ks.p).toEqual({ a: 0, k: [100, -10, 0] })
    expect(child.ks.p).toEqual(staticP(1, 1))
    expect(orphan.ks.p).toEqual({ a: 0, k: [101, -9, 0] })
  })

  it('moves the point of interest of cameras', () => {
    const anim = doc([
      { ty: 13, ind: 1, ip: 0, op: 30, st: 0, ks: { p: staticP(0, 0), a: staticP(5, 5) } } as Layer,
    ])
    translateContent(anim, 10, 10)
    expect(anim.layers[0].ks.a).toEqual(staticP(15, 15))
  })
})

describe('precomposeRoot', () => {
  it('moves the root layers into a new asset shown 1:1', () => {
    const anim = loadBounce()
    anim.assets = [{ id: 'comp_0', layers: [] }]
    const before = structuredClone(anim)
    const { assetIndex, layer } = precomposeRoot(anim, { name: 'Group' })
    expect(uniqueAssetId(anim)).toBe('comp_2')
    expect(anim.assets![assetIndex]).toMatchObject({
      id: 'comp_1',
      nm: 'Group',
      layers: before.layers,
    })
    expect(anim.layers).toHaveLength(1)
    expect(layer).toMatchObject({ ty: 0, refId: 'comp_1', w: 512, h: 512, ip: 0, op: 60, st: 0 })
    for (const t of frames(0.5, 60, 1)) {
      expect(snapshotDiff(snapshot(before, t), snapshot(anim, t), 1e-6, '0>')).toBeNull()
    }
    expect(contentBounds(anim)).toEqual(contentBounds(before))
  })

  it('rewrites selection paths', () => {
    expect(pathAfterPrecompose(['layers', 2, 'ks', 'p'], 4)).toEqual([
      'assets',
      4,
      'layers',
      2,
      'ks',
      'p',
    ])
    expect(pathAfterPrecompose(['assets', 0, 'layers', 1], 4)).toEqual(['assets', 0, 'layers', 1])
  })
})

describe('resizeCanvas', () => {
  it('resizes the canvas and moves the content with the anchor', () => {
    const anim = loadBounce()
    const before = contentBounds(anim)!
    const result = resizeCanvas(anim, 600, 400, { mode: 'resize', anchor: 'bottom' })
    expect(result).toMatchObject({
      width: 600,
      height: 400,
      dx: 44,
      dy: -112,
      precompAssetIndex: null,
    })
    expect([anim.w, anim.h]).toEqual([600, 400])
    expectRect(contentBounds(anim), before.x + 44, before.y - 112, before.width, before.height)
  })

  it('scales the content into a precomp and keeps it scaling in place afterwards', () => {
    const anim = loadBounce()
    const before = contentBounds(anim)!
    const result = resizeCanvas(anim, 1024, 768, { mode: 'scale', name: 'Scaled content' })
    expect(result.scale).toBe(1.5)
    expect(result.precompAssetIndex).toBe(0)
    expect(anim.layers).toHaveLength(1)
    expect(anim.layers[0]).toMatchObject({ ty: 0, nm: 'Scaled content', w: 512, h: 512 })
    // 512 × 1.5 = 768: centered horizontally → 128 px on each side.
    expectRect(
      contentBounds(anim),
      before.x * 1.5 + 128,
      before.y * 1.5,
      before.width * 1.5,
      before.height * 1.5,
      2,
    )

    const again = resizeCanvas(anim, 512, 384, { mode: 'scale' })
    expect(again.precompAssetIndex).toBeNull()
    expect(anim.assets).toHaveLength(1)
    expect((anim.layers[0].ks.s as VectorProperty).k).toEqual([75, 75, 100])
    expectRect(
      contentBounds(anim),
      before.x * 0.75 + 64,
      before.y * 0.75,
      before.width * 0.75,
      before.height * 0.75,
      2,
    )
  })

  it('does nothing when scaling to the same size', () => {
    const anim = loadBounce()
    const copy = structuredClone(anim)
    resizeCanvas(anim, 512, 512, { mode: 'scale' })
    expect(anim).toEqual(copy)
  })

  it('rejects empty sizes', () => {
    expect(() => resizeCanvas(loadBounce(), 0, 10, { mode: 'resize' })).toThrow(RangeError)
  })
})

describe('contentBounds', () => {
  it('measures rectangles, ellipses and strokes', () => {
    expectRect(contentBounds(doc([shapeLayer([rectItem(50, 40, 20, 10), fill()])])), 40, 35, 20, 10)
    expectRect(
      contentBounds(doc([shapeLayer([rectItem(50, 40, 20, 10), stroke(4)])])),
      38,
      33,
      24,
      14,
    )
    const ellipse: ShapeItem = { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [30, 30] } }
    expectRect(
      contentBounds(doc([shapeLayer([ellipse, fill()], { p: staticP(100, 50) })])),
      85,
      35,
      30,
      30,
    )
  })

  it('ignores geometry without paint, hidden items and invisible layers', () => {
    expect(contentBounds(doc([shapeLayer([rectItem(0, 0, 10, 10)])]))).toBeNull()
    expect(
      contentBounds(doc([shapeLayer([{ ...rectItem(0, 0, 10, 10), hd: true }, fill()])])),
    ).toBeNull()
    expect(
      contentBounds(doc([shapeLayer([rectItem(0, 0, 10, 10), fill()], {}, { hd: true })])),
    ).toBeNull()
    expect(
      contentBounds(doc([shapeLayer([rectItem(0, 0, 10, 10), fill()], { o: { a: 0, k: 0 } })])),
    ).toBeNull()
    expect(
      contentBounds(doc([shapeLayer([rectItem(0, 0, 10, 10), fill()], {}, { ip: 40, op: 50 })])),
    ).toBeNull()
  })

  it('applies layer and group transforms (anchor, scale, rotation) and parents', () => {
    const rotated = shapeLayer([rectItem(0, 0, 40, 20), fill()], {
      p: staticP(100, 50),
      r: { a: 0, k: 90 },
    })
    expectRect(contentBounds(doc([rotated])), 90, 30, 20, 40)
    const anchored = shapeLayer([rectItem(10, 10, 20, 20), fill()], {
      a: staticP(10, 10),
      p: staticP(50, 50),
      s: { a: 0, k: [200, 50, 100] },
    })
    expectRect(contentBounds(doc([anchored])), 30, 45, 40, 10)
    const group: ShapeItem = {
      ty: 'gr',
      it: [
        rectItem(0, 0, 10, 10),
        fill(),
        {
          ty: 'tr',
          p: { a: 0, k: [20, 30] },
          a: { a: 0, k: [0, 0] },
          s: { a: 0, k: [300, 100] },
          r: { a: 0, k: 0 },
          o: { a: 0, k: 100 },
        },
      ],
    } as ShapeItem
    expectRect(contentBounds(doc([shapeLayer([group])])), 5, 25, 30, 10)
    const parent = { ty: 3, ind: 7, ip: 0, op: 30, st: 0, ks: { p: staticP(100, 0) } } as Layer
    const child = shapeLayer(
      [rectItem(0, 0, 10, 10), fill()],
      { p: staticP(5, 5) },
      { ind: 8, parent: 7 },
    )
    expectRect(contentBounds(doc([parent, child])), 100, 0, 10, 10)
  })

  it('unions every frame of an animation', () => {
    const moving = shapeLayer([rectItem(0, 0, 10, 10), fill()], {
      p: {
        a: 1,
        k: [
          { t: 0, s: [10, 10, 0], o: { x: 0.5, y: 0.5 }, i: { x: 0.5, y: 0.5 } },
          { t: 29, s: [110, 60, 0] },
        ],
      },
    })
    expectRect(contentBounds(doc([moving])), 5, 5, 110, 60)
    expectRect(contentBounds(doc([moving]), [0]), 5, 5, 10, 10)
  })

  it('measures paths by their control points, stars and repeaters', () => {
    const path: ShapeItem = {
      ty: 'sh',
      ks: {
        a: 0,
        k: {
          c: true,
          v: [
            [0, 0],
            [100, 0],
            [50, 50],
          ],
          i: [
            [0, 0],
            [0, 0],
            [0, 0],
          ],
          o: [
            [0, -20],
            [0, 0],
            [0, 0],
          ],
        },
      },
    }
    // Exact curve extremum: 3·(2/3)²·(1/3)·(−20) = −8.89 (the handle itself reaches −20).
    expectRect(contentBounds(doc([shapeLayer([path, fill()])])), 0, -80 / 9, 100, 50 + 80 / 9)
    const star: ShapeItem = {
      ty: 'sr',
      sy: 1,
      p: { a: 0, k: [50, 50] },
      or: { a: 0, k: 20 },
      os: { a: 0, k: 0 },
      ir: { a: 0, k: 10 },
      is: { a: 0, k: 0 },
      pt: { a: 0, k: 5 },
      r: { a: 0, k: 0 },
    }
    // Exact star vertices: outer points at −90° + k·72° → x = 50 ± 20·cos 18°, y from 30 to 50 + 20·sin 54°.
    const c18 = 20 * Math.cos(Math.PI / 10)
    expectRect(
      contentBounds(doc([shapeLayer([star, fill()])])),
      50 - c18,
      30,
      2 * c18,
      20 + 20 * Math.sin((54 * Math.PI) / 180),
    )
    const repeater: ShapeItem = {
      ty: 'rp',
      c: { a: 0, k: 3 },
      o: { a: 0, k: 0 },
      m: 1,
      tr: {
        p: { a: 0, k: [20, 0] },
        a: { a: 0, k: [0, 0] },
        s: { a: 0, k: [100, 100] },
        r: { a: 0, k: 0 },
        so: { a: 0, k: 100 },
        eo: { a: 0, k: 100 },
      },
    } as ShapeItem
    expectRect(
      contentBounds(doc([shapeLayer([rectItem(0, 0, 10, 10), fill(), repeater])])),
      -5,
      -5,
      50,
      10,
    )
  })

  it('clips to masks, track mattes and precomp sizes', () => {
    const masked = shapeLayer(
      [rectItem(50, 50, 100, 100), fill()],
      {},
      {
        hasMask: true,
        masksProperties: [
          {
            mode: 'a',
            pt: {
              a: 0,
              k: {
                c: true,
                v: [
                  [10, 10],
                  [30, 10],
                  [30, 30],
                  [10, 30],
                ],
                i: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
                o: [
                  [0, 0],
                  [0, 0],
                  [0, 0],
                  [0, 0],
                ],
              },
            },
            o: { a: 0, k: 100 },
            x: { a: 0, k: 0 },
          },
        ],
      },
    )
    expectRect(contentBounds(doc([masked])), 10, 10, 20, 20)

    const matte = shapeLayer([rectItem(20, 20, 10, 10), fill()], {}, { ind: 1, td: 1 })
    const target = shapeLayer([rectItem(50, 50, 100, 100), fill()], {}, { ind: 2, tt: 1 })
    expectRect(contentBounds(doc([matte, target])), 15, 15, 10, 10)
    const inverted = shapeLayer([rectItem(50, 50, 100, 100), fill()], {}, { ind: 2, tt: 2 })
    expectRect(contentBounds(doc([matte, inverted])), 0, 0, 100, 100)

    const precomp: Layer = {
      ty: 0,
      ind: 1,
      refId: 'inner',
      ip: 0,
      op: 30,
      st: 0,
      w: 50,
      h: 50,
      ks: { p: staticP(100, 0) },
    } as Layer
    const anim = doc([precomp], {
      assets: [{ id: 'inner', layers: [shapeLayer([rectItem(40, 40, 40, 40), fill()])] }],
    })
    expectRect(contentBounds(anim), 120, 20, 30, 30)
  })

  it('follows the precomp time mapping', () => {
    const inner = shapeLayer([rectItem(0, 0, 10, 10), fill()], {}, { ip: 0, op: 5 })
    const precomp: Layer = {
      ty: 0,
      ind: 1,
      refId: 'inner',
      ip: 0,
      op: 30,
      st: 20,
      w: 100,
      h: 100,
      ks: {},
    } as Layer
    const anim = doc([precomp], { assets: [{ id: 'inner', layers: [inner] }] })
    expect(contentBounds(anim, [10])).toBeNull()
    expectRect(contentBounds(anim, [21]), 0, 0, 5, 5)
  })

  it('estimates text, solids and images', () => {
    const solid = {
      ty: 1,
      ind: 1,
      ip: 0,
      op: 30,
      st: 0,
      ks: { p: staticP(10, 10) },
      sc: '#ff0000',
      sw: 30,
      sh: 20,
    } as Layer
    expectRect(contentBounds(doc([solid])), 10, 10, 30, 20)
    const image = { ty: 2, ind: 1, refId: 'img', ip: 0, op: 30, st: 0, ks: {} } as Layer
    expectRect(
      contentBounds(doc([image], { assets: [{ id: 'img', w: 64, h: 32, p: 'a.png', u: '' }] })),
      0,
      0,
      64,
      32,
    )
    const text = {
      ty: 5,
      ind: 1,
      ip: 0,
      op: 30,
      st: 0,
      ks: { p: staticP(20, 50) },
      t: { d: { k: [{ t: 0, s: { t: 'Hello', s: 20, f: 'Arial', j: 2 } }] } },
    } as Layer
    const r = contentBounds(doc([text]))!
    // Centered around x = 20, baseline at y = 50: covers the glyph box with margin.
    expect(r.x).toBeLessThan(20 - 5 * 20 * 0.3)
    expect(r.x + r.width).toBeGreaterThan(20 + 5 * 20 * 0.3)
    expect(r.y).toBeLessThan(50 - 20 * 0.7)
    expect(r.y + r.height).toBeGreaterThan(50 + 20 * 0.2)
  })

  it('measures only the visible part of trimmed paths', () => {
    // lottie-web draws ellipses clockwise from the top: the first quarter is top → right.
    expectRect(ring([trim(0, 25)]), -1, -51, 52, 52)
    // Offset by 90°: right → bottom.
    expectRect(ring([trim(0, 25, 90)]), -1, -1, 52, 52)
    // Wrapping around the start through the offset (lottie clamps start/end to 0–100% first):
    // the last and first eighths. κ-circles and sampled arc length: close, not exact.
    expectRect(
      ring([trim(0, 25, 315)]),
      -Math.SQRT1_2 * 50 - 1,
      -51,
      Math.SQRT2 * 50 + 2,
      51 - Math.SQRT1_2 * 50 + 1,
      1,
    )
    expectRect(
      ring([trim(87.5, 112.5)]),
      -Math.SQRT1_2 * 50 - 1,
      -51,
      Math.SQRT1_2 * 50 + 2,
      51 - Math.SQRT1_2 * 50 + 1,
      1,
    )
    expect(ring([trim(40, 40)])).toBeNull()
    // Stacked trims keep the whole path (a superset of what is drawn).
    expectRect(ring([trim(0, 25), trim(0, 50)]), -51, -51, 102, 102)
  })

  it('keeps the whole paths for sequential trims over several shapes', () => {
    const shapes: ShapeItem[] = [
      { ty: 'el', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, d: 1 },
      { ty: 'el', p: { a: 0, k: [200, 0] }, s: { a: 0, k: [100, 100] }, d: 1 },
      stroke(2),
      { ty: 'tm', s: { a: 0, k: 0 }, e: { a: 0, k: 10 }, o: { a: 0, k: 0 }, m: 2 } as ShapeItem,
    ]
    expectRect(contentBounds(doc([shapeLayer(shapes)])), -51, -51, 302, 102)
  })

  it('offsets drop shadows in their direction', () => {
    // Direction 180° points down; softness 0.
    const shadow = {
      ty: 25,
      en: 1,
      ef: [{}, {}, { v: { a: 0, k: 180 } }, { v: { a: 0, k: 10 } }, { v: { a: 0, k: 0 } }],
    }
    const layer = shapeLayer([rectItem(50, 50, 20, 20), fill()], {}, { ef: [shadow as never] })
    expectRect(contentBounds(doc([layer])), 40, 40, 20, 30)
  })

  it('grows for drop shadows and blurs', () => {
    const blurred = shapeLayer(
      [rectItem(50, 50, 20, 20), fill()],
      {},
      { ef: [{ ty: 29, en: 1, ef: [{ ty: 0, v: { a: 0, k: 10 } }] }] },
    )
    expectRect(contentBounds(doc([blurred])), 31, 31, 38, 38)
  })

  it('samples every frame of small documents and a subset of heavy ones', () => {
    expect(boundsFrames(loadBounce())).toHaveLength(60)
    expect(boundsFrames(loadBounce(), 100).length).toBeLessThan(60)
    const sampler = createBoundsSampler(loadBounce())
    expect(sampler.bounds()).toBeNull()
    sampler.sample(0)
    expect(sampler.bounds()).not.toBeNull()
  })

  it('keeps the test file content inside its canvas', () => {
    const r = contentBounds(loadTestJson())!
    expect(r.width).toBeGreaterThan(50)
    expect(r.height).toBeGreaterThan(50)
  })
})

describe('fitCanvasToContent', () => {
  it('crops to the content with padding and moves it', () => {
    const anim = doc([shapeLayer([rectItem(50, 40, 20, 10), fill()], { p: staticP(0, 0) })])
    const plan = fitCanvasToContent(anim, { padding: 5 })
    // 1 px safety margin + 5 px padding around [40, 35]–[60, 45].
    expect(plan).toEqual({ width: 32, height: 22, dx: -34, dy: -29, changed: true })
    expect([anim.w, anim.h]).toEqual([32, 22])
    expectRect(contentBounds(anim), 6, 6, 20, 10)
  })

  it('keeps content outside the canvas out unless asked', () => {
    const layer = shapeLayer([rectItem(190, 50, 40, 20), fill()])
    expect(planFit({ w: 200, h: 100 }, contentBounds(doc([layer])))).toMatchObject({
      width: 31,
      dx: -169,
    })
    expect(
      planFit({ w: 200, h: 100 }, contentBounds(doc([layer])), { clipToCanvas: false }),
    ).toMatchObject({ width: 42, dx: -169 })
  })

  it('reports when there is nothing to fit or it already fits', () => {
    expect(fitCanvasToContent(doc([]))).toBeNull()
    const full = doc([shapeLayer([rectItem(100, 50, 200, 100), fill()])])
    expect(fitCanvasToContent(full)).toMatchObject({ changed: false, width: 200, height: 100 })
    expect(full.w).toBe(200)
  })

  it('crops the bouncing ball without cutting it', () => {
    const anim = loadBounce()
    const before = contentBounds(anim)!
    const plan = fitCanvasToContent(anim)!
    expect(plan).toMatchObject({ changed: true, width: 322, height: 387 })
    const after = contentBounds(anim)!
    expectRect(after, 1, 1, before.width, before.height)
    expect(after.x + after.width).toBeLessThanOrEqual(anim.w)
    expect(after.y + after.height).toBeLessThanOrEqual(anim.h)
  })

  it('crops the test file and keeps every frame inside', () => {
    const anim = loadTestJson()
    const before = contentBounds(anim)!
    // Measured on lottie-web's rendering: painted pixel columns 9–494, rows 8–509.
    expect(before.x).toBeLessThan(10)
    expect(before.x + before.width).toBeGreaterThan(494)
    expect(before.y).toBeLessThan(9)
    expect(before.y + before.height).toBeGreaterThan(509)
    const plan = fitCanvasToContent(anim)!
    expect(plan.changed).toBe(true)
    expect(plan.width).toBeLessThan(512)
    const after = contentBounds(anim)!
    expect(after.x).toBeGreaterThanOrEqual(0)
    expect(after.x + after.width).toBeLessThanOrEqual(anim.w)
    expect(after.y + after.height).toBeLessThanOrEqual(anim.h)
  })
})
