import { describe, expect, it } from 'vitest'
import {
  applyMatrix,
  compositionBounds,
  composeMatrices,
  cubicBounds,
  decomposeMatrix,
  IDENTITY_MATRIX,
  invertMatrix,
  layerContentBounds,
  layerMatrix,
  matrixSingularValues,
  multiplyMatrices,
  pathBounds,
  repeaterMatrices,
  rotationMatrix,
  scalingMatrix,
  shapeContentMatrix,
  shapeItemsBounds,
  shapeToBezier,
  skewXMatrix,
  transformBox,
  transformMatrix,
  translationMatrix,
  worldMatrix,
  type Box,
  type Matrix2D,
} from '../bounds'
import type {
  Animation,
  BezierPath,
  GroupShape,
  Layer,
  ShapeItem,
  ShapeLayer,
  Transform,
} from '../types'
import { samplePath } from './fixtures/remix/helpers'

const s = <T>(k: T) => ({ a: 0 as const, k })

function expectBox(actual: Box | null, expected: Box, digits = 6) {
  expect(actual).not.toBeNull()
  expect(actual!.x).toBeCloseTo(expected.x, digits)
  expect(actual!.y).toBeCloseTo(expected.y, digits)
  expect(actual!.w).toBeCloseTo(expected.w, digits)
  expect(actual!.h).toBeCloseTo(expected.h, digits)
}

function expectMatrix(actual: Matrix2D, expected: Matrix2D, digits = 9) {
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], digits))
}

/** Deterministic pseudo-random numbers. */
function rng(seed: number) {
  let x = seed
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648
    return x / 2147483648
  }
}

const square = (x: number, y: number, size: number): BezierPath => ({
  v: [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
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
  c: true,
})

const sh = (path: BezierPath, extra: Partial<ShapeItem> = {}): ShapeItem =>
  ({ ty: 'sh', ks: s(path), ...extra }) as ShapeItem
const tr = (t: Partial<Transform> = {}): ShapeItem =>
  ({
    ty: 'tr',
    p: s([0, 0]),
    a: s([0, 0]),
    s: s([100, 100]),
    r: s(0),
    o: s(100),
    ...t,
  }) as ShapeItem
const group = (
  items: ShapeItem[],
  t: Partial<Transform> = {},
  extra: Partial<GroupShape> = {},
): GroupShape => ({ ty: 'gr', it: [...items, tr(t)], ...extra })
const stroke = (w: number): ShapeItem =>
  ({ ty: 'st', c: s([0, 0, 0, 1]), o: s(100), w: s(w) }) as ShapeItem
const fill = (): ShapeItem => ({ ty: 'fl', c: s([0, 0, 0, 1]), o: s(100) }) as ShapeItem

const baseLayer = { ip: 0, op: 100, st: 0, ks: {} }
const shapeLayer = (shapes: ShapeItem[], extra: Partial<ShapeLayer> = {}): ShapeLayer =>
  ({ ...baseLayer, ty: 4, shapes, ...extra }) as ShapeLayer
const anim = (layers: Layer[], assets: Animation['assets'] = []): Animation => ({
  v: '5.7.0',
  fr: 30,
  ip: 0,
  op: 100,
  w: 500,
  h: 500,
  layers,
  assets,
})

describe('matrices', () => {
  it('multiplies with the right-hand matrix applied first', () => {
    const m = multiplyMatrices(translationMatrix(10, 0), scalingMatrix(2))
    expect(applyMatrix(m, 1, 1)).toEqual([12, 2])
    expect(
      applyMatrix(
        composeMatrices(translationMatrix(1, 2), rotationMatrix(90), scalingMatrix(3)),
        1,
        0,
      ),
    ).toEqual([1, 5])
  })

  it('rotates clockwise on screen with exact quarter turns', () => {
    expect(rotationMatrix(90)).toEqual([0, 1, -1, 0, 0, 0])
    expect(rotationMatrix(-270)).toEqual([0, 1, -1, 0, 0, 0])
    expect(rotationMatrix(180)).toEqual([-1, 0, -0, -1, 0, 0])
    expect(applyMatrix(rotationMatrix(90), 1, 0)).toEqual([0, 1])
  })

  it('inverts matrices and rejects singular ones', () => {
    const m: Matrix2D = [2, 1, -1, 3, 5, -7]
    expectMatrix(multiplyMatrices(m, invertMatrix(m)!), IDENTITY_MATRIX)
    expect(invertMatrix([1, 2, 2, 4, 0, 0])).toBeNull()
  })

  it('decomposes any matrix into Lottie transform values that rebuild it', () => {
    const rand = rng(7)
    for (let n = 0; n < 200; n++) {
      const m: Matrix2D = [
        rand() * 4 - 2,
        rand() * 4 - 2,
        rand() * 4 - 2,
        rand() * 4 - 2,
        rand() * 100,
        rand() * 100,
      ]
      const d = decomposeMatrix(m)
      const rebuilt = transformMatrix(
        { p: s(d.position), r: s(d.rotation), s: s(d.scale), sk: s(d.skew), sa: s(0) },
        0,
      )
      expectMatrix(rebuilt, m, 7)
    }
  })

  it('computes singular values', () => {
    const [a, b] = matrixSingularValues(composeMatrices(rotationMatrix(33), scalingMatrix(3, 0.5)))
    expect(a).toBeCloseTo(3, 9)
    expect(b).toBeCloseTo(0.5, 9)
  })
})

describe('bezier bounds', () => {
  it('finds curve extremes through derivative roots', () => {
    expectBox(cubicBounds([0, 0], [0, 10], [10, 10], [10, 0]), { x: 0, y: 0, w: 10, h: 7.5 })
    // S-curve overshooting on both sides of x.
    const b = cubicBounds([0, 0], [20, 0], [-10, 10], [10, 10])
    const pts = samplePath(
      {
        v: [
          [0, 0],
          [10, 10],
        ],
        o: [
          [20, 0],
          [0, 0],
        ],
        i: [
          [0, 0],
          [-20, 0],
        ],
        c: false,
      },
      2000,
    )
    expect(b.x).toBeCloseTo(Math.min(...pts.map((p) => p[0])), 4)
    expect(b.x + b.w).toBeCloseTo(Math.max(...pts.map((p) => p[0])), 4)
  })

  it('is exact and tight for random cubics (vs dense sampling)', () => {
    const rand = rng(42)
    for (let n = 0; n < 300; n++) {
      const p = Array.from({ length: 4 }, () => [rand() * 200 - 100, rand() * 200 - 100])
      const b = cubicBounds(p[0], p[1], p[2], p[3])
      const path: BezierPath = {
        v: [p[0], p[3]],
        o: [
          [p[1][0] - p[0][0], p[1][1] - p[0][1]],
          [0, 0],
        ],
        i: [
          [0, 0],
          [p[2][0] - p[3][0], p[2][1] - p[3][1]],
        ],
        c: false,
      }
      const pts = samplePath(path, 4000)
      const minX = Math.min(...pts.map((q) => q[0]))
      const maxY = Math.max(...pts.map((q) => q[1]))
      // Tight: sampling can only find points inside, and gets within a hair of the exact extremes.
      expect(b.x).toBeLessThanOrEqual(minX + 1e-9)
      expect(minX - b.x).toBeLessThan(1e-3)
      expect(b.y + b.h).toBeGreaterThanOrEqual(maxY - 1e-9)
      expect(b.y + b.h - maxY).toBeLessThan(1e-3)
    }
  })

  it('measures open, closed and transformed paths', () => {
    expectBox(pathBounds(square(1, 2, 10)), { x: 1, y: 2, w: 10, h: 10 })
    const rotated = pathBounds(square(-5, -5, 10), rotationMatrix(45))!
    expectBox(rotated, {
      x: -5 * Math.SQRT2,
      y: -5 * Math.SQRT2,
      w: 10 * Math.SQRT2,
      h: 10 * Math.SQRT2,
    })
    // A closing curve only counts when the path is closed.
    const open: BezierPath = {
      v: [
        [0, 0],
        [10, 0],
      ],
      i: [
        [0, 20],
        [0, 0],
      ],
      o: [
        [0, 0],
        [0, 0],
      ],
      c: false,
    }
    expectBox(pathBounds(open), { x: 0, y: 0, w: 10, h: 0 })
    // Closing segment (10,0) → (0,0) with control (0,20): y = 60·(1−t)·t², max at t = 2/3.
    expectBox(pathBounds({ ...open, c: true }), { x: 0, y: 0, w: 10, h: 80 / 9 })
    expect(pathBounds({ v: [], i: [], o: [], c: false })).toBeNull()
    expectBox(pathBounds({ v: [[3, 4]], i: [[0, 0]], o: [[0, 0]], c: false }), {
      x: 3,
      y: 4,
      w: 0,
      h: 0,
    })
  })

  it('bounds transformed boxes by their corners', () => {
    expectBox(transformBox({ x: 0, y: 0, w: 10, h: 20 }, rotationMatrix(90)), {
      x: -20,
      y: 0,
      w: 20,
      h: 10,
    })
  })
})

describe('shape geometry (lottie-web parity)', () => {
  it('generates rectangles with roundness clamped to half the size', () => {
    const rc = { ty: 'rc', p: s([10, 20]), s: s([40, 20]), r: s(50) } as ShapeItem
    const path = shapeToBezier(rc, 0)!
    expect(path.v).toHaveLength(8)
    expectBox(pathBounds(path), { x: -10, y: 10, w: 40, h: 20 })
    const sharp = shapeToBezier({ ty: 'rc', p: s([0, 0]), s: s([4, 2]), r: s(0) } as ShapeItem, 0)!
    expect(sharp.v).toEqual([
      [2, -1],
      [-2, -1],
      [-2, 1],
      [2, 1],
    ])
  })

  it('generates ellipses through their extreme points', () => {
    const el = { ty: 'el', p: s([5, 5]), s: s([20, 10]) } as ShapeItem
    const path = shapeToBezier(el, 0)!
    expect(path.v).toEqual([
      [5, 0],
      [15, 5],
      [5, 10],
      [-5, 5],
    ])
    expectBox(pathBounds(path), { x: -5, y: 0, w: 20, h: 10 })
  })

  it('generates stars and polygons with lottie-web point placement', () => {
    const star = shapeToBezier(
      {
        ty: 'sr',
        sy: 1,
        p: s([0, 0]),
        or: s(10),
        os: s(0),
        ir: s(5),
        is: s(0),
        pt: s(5),
        r: s(0),
      } as ShapeItem,
      0,
    )!
    expect(star.v).toHaveLength(10)
    expect(star.v[0][0]).toBeCloseTo(0, 9)
    expect(star.v[0][1]).toBeCloseTo(-10, 9)
    expect(Math.hypot(...(star.v[1] as [number, number]))).toBeCloseTo(5, 9)
    const hex = shapeToBezier(
      { ty: 'sr', sy: 2, p: s([0, 0]), or: s(10), os: s(0), pt: s(6), r: s(0) } as ShapeItem,
      0,
    )!
    expect(hex.v).toHaveLength(6)
    for (const v of hex.v) expect(Math.hypot(v[0], v[1])).toBeCloseTo(10, 9)
  })

  it('evaluates animated paths at the frame', () => {
    const a = square(0, 0, 10)
    const b = square(0, 0, 20)
    const item = {
      ty: 'sh',
      ks: {
        a: 1,
        k: [
          { t: 0, s: [a], i: { x: 1, y: 1 }, o: { x: 0, y: 0 } },
          { t: 10, s: [b] },
        ],
      },
    } as ShapeItem
    expectBox(shapeItemsBounds([item], 5), { x: 0, y: 0, w: 15, h: 15 })
    expectBox(shapeItemsBounds([item], 20), { x: 0, y: 0, w: 20, h: 20 })
  })
})

describe('transforms', () => {
  it('composes like lottie-web: translate(p)·rotate(r)·rotate(-sa)·skewX(-sk)·rotate(sa)·scale(s)·translate(-a)', () => {
    const t: Transform = {
      p: s([100, 50]),
      a: s([10, 20]),
      s: s([200, 50]),
      r: s(30),
      sk: s(15),
      sa: s(40),
    }
    const expected = composeMatrices(
      translationMatrix(100, 50),
      rotationMatrix(30),
      rotationMatrix(-40),
      skewXMatrix(-15),
      rotationMatrix(40),
      scalingMatrix(2, 0.5),
      translationMatrix(-10, -20),
    )
    expectMatrix(transformMatrix(t, 0), expected)
    // Anchor maps to position.
    const [x, y] = applyMatrix(transformMatrix(t, 0), 10, 20)
    expect(x).toBeCloseTo(100, 9)
    expect(y).toBeCloseTo(50, 9)
  })

  it('supports split positions, defaults and 3D rotation fallbacks', () => {
    expectMatrix(transformMatrix(undefined, 0), IDENTITY_MATRIX)
    expectMatrix(transformMatrix({ p: { s: true, x: s(5), y: s(6) } }, 0), translationMatrix(5, 6))
    expectMatrix(transformMatrix({ rz: s(90) }, 0), rotationMatrix(90))
  })

  it('evaluates animated transforms and auto-orient', () => {
    const layer = shapeLayer([], {
      ao: 1,
      ks: {
        p: {
          a: 1,
          k: [
            { t: 0, s: [0, 0], i: { x: 1, y: 1 }, o: { x: 0, y: 0 } },
            { t: 10, s: [0, 100] },
          ],
        },
      },
    })
    const m = layerMatrix(layer, 5)
    // Moving straight down → rotated by 90°.
    expect(m[0]).toBeCloseTo(0, 6)
    expect(m[1]).toBeCloseTo(1, 6)
    expect(m[5]).toBeCloseTo(50, 6)
  })

  it('chains parents in the same composition', () => {
    const doc = anim([
      shapeLayer([], { ind: 1, ks: { p: s([100, 0]), r: s(90) } }),
      shapeLayer([], { ind: 2, parent: 1, ks: { p: s([10, 0]) } }),
    ])
    expect(applyMatrix(worldMatrix(doc, ['layers', 1], 0), 0, 0)).toEqual([100, 10])
  })

  it('computes the content matrix of nested groups', () => {
    const inner = group([sh(square(0, 0, 1))], { p: s([5, 0]) })
    const outer = group([inner], { s: s([200, 200]) })
    const doc = anim([shapeLayer([outer])])
    expect(
      applyMatrix(shapeContentMatrix(doc, ['layers', 0, 'shapes', 0, 'it', 0], 0), 1, 1),
    ).toEqual([12, 2])
    expect(applyMatrix(shapeContentMatrix(doc, ['layers', 0, 'shapes', 0], 0), 1, 1)).toEqual([
      2, 2,
    ])
    expect(shapeContentMatrix(doc, ['layers', 0], 0)).toEqual(IDENTITY_MATRIX)
  })
})

describe('shapeItemsBounds', () => {
  it('applies group transforms (anchor, scale, rotation) and skips hidden items', () => {
    const items = [
      group([sh(square(0, 0, 10))], { p: s([100, 100]), a: s([5, 5]), s: s([200, 200]), r: s(90) }),
      group([sh(square(0, 0, 1000))], {}, { hd: true }),
      sh(square(0, 0, 500), { hd: true }),
    ]
    expectBox(shapeItemsBounds(items, 0), { x: 90, y: 90, w: 20, h: 20 })
  })

  it('grows by half the stroke width only when asked, exactly under non-uniform scale', () => {
    const items = [group([sh(square(0, 0, 10)), stroke(4), fill()], { s: s([300, 100]) })]
    expectBox(shapeItemsBounds(items, 0), { x: 0, y: 0, w: 30, h: 10 })
    expectBox(shapeItemsBounds(items, 0, { includeStroke: true }), { x: -6, y: -2, w: 42, h: 14 })
  })

  it('applies parent-level strokes to nested paths with the parent scale', () => {
    const items = [group([sh(square(0, 0, 10))], { s: s([200, 200]) }), stroke(2)]
    expectBox(shapeItemsBounds(items, 0, { includeStroke: true }), { x: -1, y: -1, w: 22, h: 22 })
  })

  it('ignores content removed by an empty trim and grows offset paths', () => {
    const trim = { ty: 'tm', s: s(50), e: s(50), o: s(0) } as ShapeItem
    expect(shapeItemsBounds([sh(square(0, 0, 10)), trim], 0)).toBeNull()
    const offset = { ty: 'op', a: s(3) } as ShapeItem
    expectBox(shapeItemsBounds([sh(square(0, 0, 10)), offset], 0), { x: -3, y: -3, w: 16, h: 16 })
  })

  it('multiplies content through repeaters', () => {
    const rp = {
      ty: 'rp',
      c: s(3),
      o: s(0),
      m: 1,
      tr: { p: s([20, 0]), a: s([0, 0]), s: s([100, 100]), r: s(0), so: s(100), eo: s(100) },
    } as ShapeItem
    expectBox(shapeItemsBounds([sh(square(0, 0, 10)), rp], 0), { x: 0, y: 0, w: 50, h: 10 })
    expect(repeaterMatrices(rp as never, 0).map((m) => m[4])).toEqual([0, 20, 40])
    const offset = { ...rp, o: s(1) } as ShapeItem
    expect(repeaterMatrices(offset as never, 0).map((m) => m[4])).toEqual([20, 40, 60])
  })

  it('returns null for nothing drawn', () => {
    expect(shapeItemsBounds([], 0)).toBeNull()
    expect(shapeItemsBounds(undefined, 0)).toBeNull()
    expect(shapeItemsBounds([fill()], 0)).toBeNull()
  })
})

describe('layer content bounds', () => {
  const imageAsset = { id: 'img', w: 64, h: 32, p: 'data:image/png;base64,AAAA', e: 1 as const }

  it('measures shape, solid, image and text layers in their own space', () => {
    const doc = anim(
      [
        shapeLayer([sh(square(5, 5, 10))], { ks: { p: s([1000, 1000]) } }),
        { ...baseLayer, ty: 1, sc: '#ff0000', sw: 100, sh: 50 } as Layer,
        { ...baseLayer, ty: 2, refId: 'img' } as Layer,
        {
          ...baseLayer,
          ty: 5,
          t: { d: { k: [{ t: 0, s: { t: 'Hello', s: 20, f: 'Arial', j: 2 } }] } },
        } as Layer,
        { ...baseLayer, ty: 3 } as Layer,
      ],
      [imageAsset],
    )
    expectBox(layerContentBounds(doc, ['layers', 0], 0), { x: 5, y: 5, w: 10, h: 10 })
    expectBox(layerContentBounds(doc, ['layers', 1], 0), { x: 0, y: 0, w: 100, h: 50 })
    expectBox(layerContentBounds(doc, ['layers', 2], 0), { x: 0, y: 0, w: 64, h: 32 })
    const text = layerContentBounds(doc, ['layers', 3], 0)!
    expect(text.x).toBeCloseTo(-text.w / 2, 9)
    expect(text.y).toBeLessThan(0)
    expect(layerContentBounds(doc, ['layers', 4], 0)).toBeNull()
    expect(layerContentBounds(doc, ['layers', 9], 0)).toBeNull()
  })

  it('unions precomp layers with their transforms, parents and time mapping, clipped to w×h', () => {
    const inner = [
      shapeLayer([sh(square(0, 0, 10))], { ind: 1, ks: { p: s([100, 100]) } }),
      shapeLayer([sh(square(0, 0, 10))], { ind: 2, parent: 1, ks: { p: s([50, 0]) } }),
      // Only visible in inner frames 20..30.
      shapeLayer([sh(square(0, 0, 10))], { ind: 3, ip: 20, op: 30, ks: { p: s([0, 0]) } }),
      // Far outside the precomp box: clipped away.
      shapeLayer([sh(square(0, 0, 10))], { ind: 4, ks: { p: s([900, 900]) } }),
    ]
    const doc = anim(
      [{ ...baseLayer, ty: 0, refId: 'comp', w: 200, h: 200, st: -10 } as Layer],
      [{ id: 'comp', layers: inner }],
    )
    // Outer frame 5 → inner 15: layers 1, 2 (and 4 clipped).
    expectBox(layerContentBounds(doc, ['layers', 0], 5), { x: 100, y: 100, w: 60, h: 10 })
    // Outer frame 15 → inner 25: layer 3 too.
    expectBox(layerContentBounds(doc, ['layers', 0], 15), { x: 0, y: 0, w: 160, h: 110 })
    expectBox(layerContentBounds(doc, ['layers', 0], 15, { clip: false }), {
      x: 0,
      y: 0,
      w: 910,
      h: 910,
    })
    // Before the inner layers start (inner frame −5): nothing drawn → the precomp box.
    const late = anim(
      [{ ...baseLayer, ty: 0, refId: 'comp', w: 200, h: 200, st: 10 } as Layer],
      [{ id: 'comp', layers: inner }],
    )
    expectBox(layerContentBounds(late, ['layers', 0], 5), { x: 0, y: 0, w: 200, h: 200 })
    expectBox(compositionBounds(doc, 'comp', 25), { x: 0, y: 0, w: 910, h: 910 })
  })

  it('falls back to the precomp box when nothing is visible and survives cycles', () => {
    const doc = anim(
      [{ ...baseLayer, ty: 0, refId: 'a', w: 300, h: 100 } as Layer],
      [
        { id: 'a', layers: [{ ...baseLayer, ty: 0, refId: 'b', w: 10, h: 10 } as Layer] },
        { id: 'b', layers: [{ ...baseLayer, ty: 0, refId: 'a', w: 10, h: 10 } as Layer] },
      ],
    )
    expectBox(layerContentBounds(doc, ['layers', 0], 0), { x: 0, y: 0, w: 10, h: 10 })
    const empty = anim(
      [{ ...baseLayer, ty: 0, refId: 'e', w: 300, h: 100 } as Layer],
      [{ id: 'e', layers: [] }],
    )
    expectBox(layerContentBounds(empty, ['layers', 0], 0), { x: 0, y: 0, w: 300, h: 100 })
  })

  it('skips hidden, matte-source and transparent layers; applies alpha mattes and additive masks', () => {
    const doc = anim([
      shapeLayer([sh(square(0, 0, 10))], { hd: true }),
      shapeLayer([sh(square(0, 0, 50))], { td: 1 }),
      shapeLayer([sh(square(20, 20, 100))], { tt: 1 }),
      shapeLayer([sh(square(0, 0, 1000))], { ks: { o: s(0) } }),
      shapeLayer([sh(square(0, 0, 100))], {
        hasMask: true,
        masksProperties: [{ mode: 'a', pt: s(square(10, 10, 20)), o: s(100), x: s(0), inv: false }],
      }),
    ])
    // Matte: (20..120) ∩ (0..50) = 20..50; masked layer: 10..30.
    expectBox(compositionBounds(doc, null, 0), { x: 10, y: 10, w: 40, h: 40 })
    expectBox(layerContentBounds(doc, ['layers', 4], 0), { x: 10, y: 10, w: 20, h: 20 })
  })
})
