// @vitest-environment jsdom
import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import {
  applyMatrix,
  layerMatrix,
  shapeContentMatrix,
  shapeItemsBounds,
  transformBox,
  worldMatrix,
  type Box,
} from '../bounds'
import { getAt, pathKey, type NodePath } from '../path'
import {
  findReplaceableElements,
  measureElement,
  replaceTargetKind,
  replaceWithImage,
  replaceWithShapes,
  representativeFrame,
  ReplaceError,
  targetBounds,
} from '../replace'
import { importSvg } from '../svg'
import type {
  Animation,
  BezierPath,
  FillShape,
  GradientFillShape,
  GroupShape,
  ImageAsset,
  Layer,
  PrecompAsset,
  ShapeItem,
  ShapeLayer,
  StrokeShape,
  Transform,
} from '../types'
import { docText, documentProblems, findAliases, findItems } from './fixtures/remix/helpers'

/* ------------------------------- Fixtures -------------------------------- */

const s = <T>(k: T) => ({ a: 0 as const, k })
const kf = (t: number, v: number[]) => ({
  t,
  s: v,
  i: { x: [0.5], y: [1] },
  o: { x: [0.5], y: [0] },
})

const WHITE = [1, 1, 1]
const BLUE = [10 / 255, 152 / 255, 253 / 255]
const BLACK = [0, 0, 0]

function rectPath(x: number, y: number, w: number, h: number): BezierPath {
  return {
    v: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
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
  }
}

const sh = (p: BezierPath): ShapeItem => ({ ty: 'sh', ks: s(p) })
const fill = (c: number[], o = 100): ShapeItem => ({ ty: 'fl', c: s([...c, 1]), o: s(o), r: 1 })
const stroke = (c: number[], w: number): ShapeItem => ({
  ty: 'st',
  c: s([...c, 1]),
  o: s(100),
  w: s(w),
  lc: 2,
  lj: 2,
})
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
const group = (nm: string, items: ShapeItem[], t: Partial<Transform> = {}): GroupShape => ({
  ty: 'gr',
  nm,
  it: [...items, tr(t)],
})

const layerBase = { ip: 0, op: 100, st: 0, sr: 1, ddd: 0 as const, ao: 0 as const }

function makeDoc(): Animation {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 100,
    w: 400,
    h: 400,
    nm: 'test',
    assets: [
      { id: 'img', w: 100, h: 50, u: '', p: 'data:image/png;base64,AAAA', e: 1 },
      {
        id: 'comp_logo',
        nm: 'Logo comp',
        layers: [
          {
            ...layerBase,
            ind: 1,
            ty: 4,
            nm: 'Mark',
            ks: { p: s([100, 100]), a: s([0, 0]), s: s([100, 100]) },
            shapes: [
              group('Circle', [sh(rectPath(-20, -20, 40, 40)), stroke(BLUE, 4), fill(WHITE)]),
            ],
          },
        ],
      },
    ],
    layers: [
      {
        ...layerBase,
        ind: 1,
        ty: 4,
        nm: 'Badge',
        ks: { p: s([200, 200]), a: s([0, 0]), s: s([100, 100]) },
        shapes: [
          group(
            'Logo',
            [sh(rectPath(0, 0, 60, 30)), sh(rectPath(10, 5, 20, 20)), stroke(BLUE, 4), fill(WHITE)],
            { p: { a: 1, k: [kf(0, [0, 0]), kf(50, [30, 0])] } },
          ),
          group('Background', [sh(rectPath(-100, -100, 200, 200)), fill(BLACK)]),
        ],
      },
      {
        ...layerBase,
        ind: 2,
        ty: 0,
        nm: 'Brand',
        refId: 'comp_logo',
        w: 200,
        h: 200,
        ks: {
          p: { a: 1, k: [kf(0, [0, 0, 0]), kf(60, [100, 50, 0])] },
          s: { a: 1, k: [kf(0, [50, 50, 100]), kf(60, [100, 100, 100])] },
        },
      },
      {
        ...layerBase,
        ind: 3,
        ty: 2,
        nm: 'Photo',
        refId: 'img',
        parent: 1,
        ks: { p: s([50, 50]), a: s([50, 25]), s: s([200, 200]) },
      },
      {
        ...layerBase,
        ind: 4,
        ty: 5,
        nm: 'Title',
        ks: { p: s([20, 380]) },
        t: { d: { k: [{ t: 0, s: { t: 'Hello', s: 40, f: 'Arial', fc: [1, 0, 0], j: 0 } }] } },
      },
      { ...layerBase, ind: 5, ty: 1, nm: 'Backdrop', sc: '#ffffff', sw: 400, sh: 400, ks: {} },
      {
        ...layerBase,
        ind: 6,
        ty: 0,
        nm: 'Brand copy',
        refId: 'comp_logo',
        w: 200,
        h: 200,
        ks: { p: s([300, 300]) },
      },
    ],
  } as Animation
}

/** New content: a red 100×50 block and a green 2px line under it. */
function content(): ShapeItem[] {
  const line: BezierPath = {
    v: [
      [0, 60],
      [100, 60],
    ],
    i: [
      [0, 0],
      [0, 0],
    ],
    o: [
      [0, 0],
      [0, 0],
    ],
    c: false,
  }
  return [
    group('New logo', [
      group('Block', [sh(rectPath(0, 0, 100, 50)), fill([1, 0, 0])]),
      group('Line', [sh(line), stroke([0, 1, 0], 2)]),
    ]),
  ]
}

const at = <T>(anim: Animation, path: NodePath) => getAt<T>(anim, path) as T
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Asserts `inner` is centered in `outer`, inside it, and touches it on at least one axis. */
function expectContained(inner: Box, outer: Box, tol = 0.02) {
  expect(inner.x + inner.w / 2).toBeCloseTo(outer.x + outer.w / 2, 1)
  expect(inner.y + inner.h / 2).toBeCloseTo(outer.y + outer.h / 2, 1)
  expect(inner.w).toBeLessThanOrEqual(outer.w + tol)
  expect(inner.h).toBeLessThanOrEqual(outer.h + tol)
  expect(Math.min(Math.abs(inner.w - outer.w), Math.abs(inner.h - outer.h))).toBeLessThan(tol)
}

const hex = (c: number[]) =>
  '#' +
  c
    .slice(0, 3)
    .map((v) =>
      Math.floor(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')

/* --------------------------------- Tests --------------------------------- */

describe('replace targets', () => {
  it('classifies paths', () => {
    const doc = makeDoc()
    expect(replaceTargetKind(doc, ['layers', 0])).toBe('shape-layer')
    expect(replaceTargetKind(doc, ['layers', 0, 'shapes', 0])).toBe('group')
    expect(replaceTargetKind(doc, ['layers', 0, 'shapes', 0, 'it', 0])).toBeNull()
    expect(replaceTargetKind(doc, ['layers', 1])).toBe('precomp-layer')
    expect(replaceTargetKind(doc, ['layers', 2])).toBe('image-layer')
    expect(replaceTargetKind(doc, ['layers', 3])).toBe('text-layer')
    expect(replaceTargetKind(doc, ['layers', 4])).toBe('solid-layer')
    expect(replaceTargetKind(doc, ['layers', 99])).toBeNull()
    expect(replaceTargetKind(doc, ['assets', 1, 'layers', 0])).toBe('shape-layer')
    expect(replaceTargetKind(doc, ['layers', 0, 'ks'])).toBeNull()
  })

  it('throws coded errors for invalid targets and content', () => {
    const doc = makeDoc()
    expect(() => replaceWithShapes(doc, ['layers', 0, 'ks'], { shapes: content() })).toThrow(
      ReplaceError,
    )
    try {
      replaceWithShapes(doc, ['layers', 0], { shapes: [] })
    } catch (e) {
      expect((e as ReplaceError).code).toBe('invalid-content')
    }
    expect(() => replaceWithImage(doc, ['layers', 0], { dataUri: 'x', w: 0, h: 10 })).toThrow(
      ReplaceError,
    )
  })
})

describe('replaceWithShapes: group', () => {
  it('keeps the group transform (and its animation), fits the content into the old bounds', () => {
    const doc = makeDoc()
    const path: NodePath = ['layers', 0, 'shapes', 0]
    const before = clone(at<GroupShape>(doc, path))
    const oldBox = targetBounds(doc, path, 0)!
    const r = replaceWithShapes(doc, path, { shapes: content() })
    const g = at<GroupShape>(doc, path)
    expect(g.nm).toBe('Logo')
    expect(g.it).toHaveLength(2)
    expect(g.it[1]).toEqual(before.it[before.it.length - 1])
    expect(r.paths).toEqual([path, [...path, 'it', 0]])
    expect(r.fit.targetBox).toEqual(oldBox)
    expectContained(targetBounds(doc, path, 0)!, oldBox)
    expect(r.warnings).toEqual([])
    expect(documentProblems(doc)).toEqual([])
    expect(findAliases(doc)).toEqual([])
  })

  it('warns when enclosing groups style the new content too', () => {
    const doc = makeDoc()
    const layer = at<ShapeLayer>(doc, ['layers', 0])
    layer.shapes = [group('Outer', [group('Inner', [sh(rectPath(0, 0, 10, 10))]), fill([0, 1, 0])])]
    const r = replaceWithShapes(doc, ['layers', 0, 'shapes', 0, 'it', 0], { shapes: content() })
    expect(r.warnings).toContain('inherited-styles')
  })
})

/** Fits a 200×100 block into a 100×100 square group. */
const runFit = (opts: Parameters<typeof replaceWithShapes>[3], box?: Box) => {
  const doc = makeDoc()
  // Target: a 100×100 square group.
  at<ShapeLayer>(doc, ['layers', 0]).shapes = [
    group('Square', [sh(rectPath(0, 0, 100, 100)), fill(WHITE)]),
  ]
  const shapes = [group('Wide', [sh(rectPath(0, 0, 200, 100)), fill([1, 0, 0])])]
  const r = replaceWithShapes(doc, ['layers', 0, 'shapes', 0], { shapes, box }, opts)
  return { r, box: targetBounds(doc, ['layers', 0, 'shapes', 0], 0)! }
}

describe('fitting', () => {
  it('contains by default, keeping the aspect ratio', () => {
    const { r, box } = runFit({})
    expect(r.fit.scale).toEqual([50, 50])
    expect(box).toEqual({ x: 0, y: 25, w: 100, h: 50 })
  })

  it('covers and stretches', () => {
    expect(runFit({ fit: 'cover' }).box).toEqual({ x: -50, y: 0, w: 200, h: 100 })
    const stretch = runFit({ fit: 'stretch' })
    expect(stretch.r.fit.scale).toEqual([50, 100])
    expect(stretch.box).toEqual({ x: 0, y: 0, w: 100, h: 100 })
  })

  it('applies padding, extra scale and offset around the center', () => {
    expect(runFit({ padding: 0.1 }).box).toEqual({ x: 10, y: 30, w: 80, h: 40 })
    const adjusted = runFit({ adjust: { scale: 0.5, dx: 10, dy: -5 } })
    expect(adjusted.box).toEqual({ x: 35, y: 32.5, w: 50, h: 25 })
    expect(adjusted.r.fit.anchor).toEqual([100, 50])
    expect(adjusted.r.fit.position).toEqual([60, 45])
  })

  it('fits a given box (e.g. the SVG artboard with its margins) instead of the content bounds', () => {
    const { box } = runFit({}, { x: -100, y: -100, w: 400, h: 300 })
    // Artboard 400×300 → 100×75, the 200×100 content inside it becomes 50×25.
    expect(box.w).toBeCloseTo(50, 6)
    expect(box.h).toBeCloseTo(25, 6)
  })

  it('keeps imported geometry intact: only the wrapper transform scales it', () => {
    const doc = makeDoc()
    const shapes = content()
    replaceWithShapes(doc, ['layers', 0], { shapes })
    const wrapper = at<ShapeLayer>(doc, ['layers', 0]).shapes[0] as GroupShape
    expect(wrapper.it.slice(0, -1)).toEqual(shapes)
    // The caller's objects are never inserted (no aliasing).
    expect(wrapper.it[0]).not.toBe(shapes[0])
  })
})

describe('replaceWithShapes: layers', () => {
  it('shape layer: keeps the layer and its transform, replaces the shapes', () => {
    const doc = makeDoc()
    const ks = clone(at<ShapeLayer>(doc, ['layers', 0]).ks)
    const oldBox = targetBounds(doc, ['layers', 0], 0)!
    const r = replaceWithShapes(doc, ['layers', 0], { shapes: content() }, { name: 'Remixed' })
    const layer = at<ShapeLayer>(doc, ['layers', 0])
    expect(layer.ks).toEqual(ks)
    expect(layer.shapes).toHaveLength(1)
    expect(layer.shapes[0].nm).toBe('Remixed')
    expect(r.paths).toEqual([
      ['layers', 0],
      ['layers', 0, 'shapes', 0],
    ])
    expectContained(targetBounds(doc, ['layers', 0], 0)!, oldBox)
  })

  it('precomp: replaces the composition content, keeps the layer motion, detaches shared comps', () => {
    const doc = makeDoc()
    const ks = clone(at<Layer>(doc, ['layers', 1]).ks)
    const oldBox = targetBounds(doc, ['layers', 1], 0)!
    const assetCount = doc.assets!.length
    const r = replaceWithShapes(doc, ['layers', 1], { shapes: content() })
    const layer = at<Layer & { refId: string }>(doc, ['layers', 1])
    expect(layer.ks).toEqual(ks)
    // comp_logo is also used by "Brand copy": this layer gets its own clone.
    expect(layer.refId).toBe('comp_logo_2')
    expect(doc.assets).toHaveLength(assetCount + 1)
    const original = doc.assets![1] as PrecompAsset
    expect(original.layers[0].nm).toBe('Mark')
    const detached = doc.assets![assetCount] as PrecompAsset
    expect(detached.layers).toHaveLength(1)
    expect(detached.layers[0]).toMatchObject({ ty: 4, ind: 1, ip: 0, op: 100, st: 0 })
    expect(r.paths).toEqual([
      ['layers', 1],
      ['assets', assetCount],
      ['assets', assetCount, 'layers', 0],
      ['assets', assetCount, 'layers', 0, 'shapes', 0],
    ])
    expectContained(targetBounds(doc, ['layers', 1], 0)!, oldBox)
    expect(documentProblems(doc)).toEqual([])
    expect(findAliases(doc)).toEqual([])
  })

  it('precomp with detach: false changes every instance, with a warning', () => {
    const doc = makeDoc()
    const r = replaceWithShapes(doc, ['layers', 1], { shapes: content() }, { detach: false })
    expect(r.warnings).toContain('shared-precomp')
    expect(at<Layer & { refId: string }>(doc, ['layers', 1]).refId).toBe('comp_logo')
    expect((doc.assets![1] as PrecompAsset).layers[0].nm).toBe('New logo')
  })

  it('precomp: warns when the replaced content was animated', () => {
    const doc = makeDoc()
    const inner = (doc.assets![1] as PrecompAsset).layers[0]
    inner.ks.r = { a: 1, k: [kf(0, [0]), kf(10, [90])] }
    const r = replaceWithShapes(doc, ['layers', 5], { shapes: content() })
    expect(r.warnings).toContain('inner-animation-dropped')
  })

  it('precomp: the new layer covers the time the precomp is shown (st offsets, stretch)', () => {
    const doc = makeDoc()
    const layer = at<Layer>(doc, ['layers', 5])
    layer.st = -40
    layer.ip = 0
    layer.op = 100
    layer.sr = 2
    replaceWithShapes(doc, ['layers', 5], { shapes: content() })
    const asset = doc.assets!.find(
      (a) => a.id === (layer as { refId?: string }).refId,
    ) as PrecompAsset
    // Inner frames: (0 + 40) / 2 = 20 … (100 + 40) / 2 = 70, and the old layer's 0 … 100.
    expect(asset.layers[0]).toMatchObject({ ip: 0, op: 100 })
  })

  it('image layer: becomes a shape layer with the same ind, parent, timing and transform', () => {
    const doc = makeDoc()
    const before = clone(at<Layer>(doc, ['layers', 2]))
    const r = replaceWithShapes(doc, ['layers', 2], { shapes: content() })
    const layer = at<ShapeLayer>(doc, ['layers', 2])
    expect(layer.ty).toBe(4)
    expect(layer).toMatchObject({
      ind: 3,
      parent: 1,
      ip: 0,
      op: 100,
      st: 0,
      nm: 'Photo',
      ks: before.ks,
    })
    expect('refId' in layer).toBe(false)
    expectContained(targetBounds(doc, ['layers', 2], 0)!, { x: 0, y: 0, w: 100, h: 50 })
    expect(r.warnings).toEqual([])
  })

  it('text and solid layers become shape layers (text bounds are estimated)', () => {
    const doc = makeDoc()
    expect(replaceWithShapes(doc, ['layers', 3], { shapes: content() }).warnings).toContain(
      'approximate-bounds',
    )
    expect(at<Layer>(doc, ['layers', 3]).ty).toBe(4)
    expect('t' in at<Layer>(doc, ['layers', 3])).toBe(false)
    replaceWithShapes(doc, ['layers', 4], { shapes: content() })
    const solid = at<ShapeLayer>(doc, ['layers', 4])
    expect(solid.ty).toBe(4)
    expect('sc' in solid || 'sw' in solid).toBe(false)
    expectContained(targetBounds(doc, ['layers', 4], 0)!, { x: 0, y: 0, w: 400, h: 400 })
    expect(documentProblems(doc)).toEqual([])
  })

  it('works on immer drafts and never mutates the frozen base document', () => {
    const base = produce(makeDoc(), () => {})
    const snapshot = JSON.stringify(base)
    const shapes = content()
    const next = produce(base, (draft) => {
      replaceWithShapes(draft as Animation, ['layers', 1], { shapes }, { style: 'original' })
      replaceWithImage(draft as Animation, ['layers', 2], {
        dataUri: 'data:image/png;base64,BBBB',
        w: 20,
        h: 20,
      })
    })
    expect(JSON.stringify(base)).toBe(snapshot)
    expect(next).not.toBe(base)
    expect(documentProblems(next)).toEqual([])
    expect(findAliases(next)).toEqual([])
    expect(Object.isFrozen(shapes[0])).toBe(false)
  })
})

describe('styles', () => {
  it("'original' copies the dominant fill and outline; the outline keeps its visual width", () => {
    const doc = makeDoc()
    const path: NodePath = ['layers', 0, 'shapes', 0]
    const r = replaceWithShapes(doc, path, { shapes: content() }, { style: 'original' })
    const wrapper = at<GroupShape>(doc, [...path, 'it', 0])
    const k = r.fit.scale[0] / 100
    const block = findItems([wrapper], 'gr').find((g) => g.nm === 'Block')!
    const fl = block.it.find((i): i is FillShape => i.ty === 'fl')!
    const st = block.it.find((i): i is StrokeShape => i.ty === 'st')!
    expect(hex(fl.c.k as number[])).toBe('#ffffff')
    expect(hex(st.c.k as number[])).toBe('#0a98fd')
    // 4 px in the target space → 4 / k in the content space.
    expect((st.w.k as number) * k).toBeCloseTo(4, 2)
    // The stroke-only line keeps its own width, recolored with the original outline color.
    const line = findItems([wrapper], 'gr').find((g) => g.nm === 'Line')!
    const lineStroke = line.it.find((i): i is StrokeShape => i.ty === 'st')!
    expect(lineStroke.w.k).toBe(2)
    expect(hex(lineStroke.c.k as number[])).toBe('#0a98fd')
    expect(line.it.some((i) => i.ty === 'fl')).toBe(false)
    // Stroke on top of fill, transform last.
    expect(block.it.map((i) => i.ty)).toEqual(['sh', 'st', 'fl', 'tr'])
  })

  it("'original' keeps the new shapes' fill rule and copies gradients in the right place", () => {
    const doc = makeDoc()
    const gf: GradientFillShape = {
      ty: 'gf',
      o: s(100),
      r: 1,
      g: { p: 2, k: s([0, 1, 0, 0, 1, 0, 0, 1]) },
      s: s([0, 0]),
      e: s([100, 0]),
      t: 1,
    }
    at<ShapeLayer>(doc, ['layers', 0]).shapes = [group('Grad', [sh(rectPath(0, 0, 100, 100)), gf])]
    const shapes = [
      group('Holes', [sh(rectPath(0, 0, 50, 50)), { ...(fill([1, 1, 0]) as FillShape), r: 2 }]),
    ]
    const r = replaceWithShapes(doc, ['layers', 0, 'shapes', 0], { shapes }, { style: 'original' })
    const wrapper = at<GroupShape>(doc, ['layers', 0, 'shapes', 0, 'it', 0])
    const copied = findItems([wrapper], 'gf')[0]
    expect(copied.r).toBe(2)
    // Mapped back through the wrapper transform, the gradient lands on the original points.
    const m = shapeContentMatrix(doc, ['layers', 0, 'shapes', 0, 'it', 0], 0)
    expect(applyMatrix(m, ...(copied.s.k as [number, number]))).toEqual([0, 0])
    expect(applyMatrix(m, ...(copied.e.k as [number, number]))).toEqual([100, 0])
    expect(r.warnings).toEqual([])
  })

  it("'original' uses the precomp content's paints; warns when there are none", () => {
    const doc = makeDoc()
    replaceWithShapes(doc, ['layers', 1], { shapes: content() }, { style: 'original' })
    const asset = doc.assets!.find((a) => a.id === 'comp_logo_2') as PrecompAsset
    const fills = findItems((asset.layers[0] as ShapeLayer).shapes, 'fl').map((f) =>
      hex(f.c.k as number[]),
    )
    expect(fills).toEqual(['#ffffff'])
    const bare = makeDoc()
    at<ShapeLayer>(bare, ['layers', 0]).shapes = [sh(rectPath(0, 0, 10, 10))]
    expect(
      replaceWithShapes(bare, ['layers', 0], { shapes: content() }, { style: 'original' }).warnings,
    ).toContain('no-original-style')
  })

  it('explicit colors: recolor fills, remove strokes, add outlines with a width in target units', () => {
    const doc = makeDoc()
    replaceWithShapes(
      doc,
      ['layers', 0],
      { shapes: content() },
      { style: { fill: { r: 1, g: 1, b: 1, a: 0.5 }, stroke: null } },
    )
    const shapes = at<ShapeLayer>(doc, ['layers', 0]).shapes
    expect(findItems(shapes, 'st')).toHaveLength(0)
    const fl = findItems(shapes, 'fl')
    expect(fl).toHaveLength(1)
    expect(fl[0].c.k).toEqual([1, 1, 1, 1])
    expect(fl[0].o.k).toBe(50)

    const doc2 = makeDoc()
    const r = replaceWithShapes(
      doc2,
      ['layers', 0],
      { shapes: content() },
      { style: { stroke: { r: 0, g: 0, b: 1, a: 1 }, strokeWidth: 3 } },
    )
    const k = r.fit.scale[0] / 100
    const strokes = findItems(at<ShapeLayer>(doc2, ['layers', 0]).shapes, 'st')
    expect(strokes).toHaveLength(2)
    for (const st of strokes) {
      expect(st.c.k).toEqual([0, 0, 1, 1])
      expect((st.w.k as number) * k).toBeCloseTo(3, 2)
    }
    // Fills untouched.
    expect(
      hex(findItems(at<ShapeLayer>(doc2, ['layers', 0]).shapes, 'fl')[0].c.k as number[]),
    ).toBe('#ff0000')
  })

  it('explicit colors with outline: false only recolor existing strokes (one-color logos)', () => {
    const doc = makeDoc()
    const color = { r: 1, g: 128 / 255, b: 0, a: 1 }
    replaceWithShapes(
      doc,
      ['layers', 0],
      { shapes: content() },
      { style: { fill: color, stroke: color, outline: false } },
    )
    const shapes = at<ShapeLayer>(doc, ['layers', 0]).shapes
    const block = findItems(shapes, 'gr').find((g) => g.nm === 'Block')!
    // The filled block gets no new outline; the stroked line keeps its width, recolored.
    expect(block.it.some((i) => i.ty === 'st')).toBe(false)
    const strokes = findItems(shapes, 'st')
    expect(strokes).toHaveLength(1)
    expect(strokes[0].w.k).toBe(2)
    for (const item of [...findItems(shapes, 'fl'), ...strokes]) {
      expect(hex(item.c.k as number[])).toBe('#ff8000')
    }
  })

  it("'original' keeps details of several-color content in the element's second color", () => {
    const doc = makeDoc()
    // The original: white fill (large) + blue fill (small detail).
    at<ShapeLayer>(doc, ['layers', 0]).shapes = [
      group('Base', [sh(rectPath(0, 0, 100, 100)), fill(WHITE)]),
      group('Detail', [sh(rectPath(10, 10, 10, 10)), fill(BLUE)]),
    ]
    const shapes = [
      group('Dot', [sh(rectPath(40, 40, 20, 20)), fill([1, 1, 0])]),
      group('Badge', [sh(rectPath(0, 0, 100, 100)), fill([1, 0, 0])]),
    ]
    replaceWithShapes(doc, ['layers', 0], { shapes }, { style: 'original' })
    const out = at<ShapeLayer>(doc, ['layers', 0]).shapes
    const color = (name: string) =>
      hex(
        findItems(
          findItems(out, 'gr').filter((g) => g.nm === name),
          'fl',
        )[0].c.k as number[],
      )
    expect(color('Badge')).toBe('#ffffff')
    expect(color('Dot')).toBe('#0a98fd')

    // A single-color original has no second color: everything takes its fill (a silhouette).
    const mono = makeDoc()
    at<ShapeLayer>(mono, ['layers', 0]).shapes = [
      group('Base', [sh(rectPath(0, 0, 100, 100)), fill(WHITE)]),
    ]
    replaceWithShapes(mono, ['layers', 0], { shapes: clone(shapes) }, { style: 'original' })
    const monoFills = findItems(at<ShapeLayer>(mono, ['layers', 0]).shapes, 'fl')
    expect(new Set(monoFills.map((f) => hex(f.c.k as number[])))).toEqual(new Set(['#ffffff']))
  })

  it("fits the restyled content: a thick 'original' outline stays inside the old box", () => {
    const doc = makeDoc()
    at<ShapeLayer>(doc, ['layers', 0]).shapes = [
      group('Square', [sh(rectPath(0, 0, 100, 100)), stroke(BLUE, 20), fill(WHITE)]),
    ]
    const oldBox = targetBounds(doc, ['layers', 0], 0)!
    expect(oldBox).toEqual({ x: -10, y: -10, w: 120, h: 120 })
    replaceWithShapes(
      doc,
      ['layers', 0],
      { shapes: [group('Box', [sh(rectPath(0, 0, 10, 10)), fill([1, 0, 0])])] },
      { style: 'original' },
    )
    const box = targetBounds(doc, ['layers', 0], 0)!
    expect(box.x).toBeCloseTo(-10, 1)
    expect(box.w).toBeCloseTo(120, 1)
  })
})

describe('representative frame', () => {
  it('uses the resting state, not a scale-in or an outro', () => {
    const doc = makeDoc()
    const scale = {
      a: 1 as const,
      k: [kf(0, [0, 0]), kf(10, [100, 100]), kf(80, [100, 100]), kf(99, [300, 300])],
    }
    at<ShapeLayer>(doc, ['layers', 0]).shapes = [
      group('Pop', [sh(rectPath(-10, -10, 20, 20)), fill(WHITE)], { s: scale }),
    ]
    const rep = representativeFrame(doc, ['layers', 0])
    expect(rep.frame).toBeGreaterThanOrEqual(10)
    expect(rep.frame).toBeLessThanOrEqual(80)
    expect(rep.bounds).toEqual({ x: -10, y: -10, w: 20, h: 20 })
    const r = replaceWithShapes(doc, ['layers', 0], { shapes: content() })
    expect(r.fit.frame).toBe(rep.frame)
  })

  it('is the first visible frame for static content and respects the layer in point', () => {
    const doc = makeDoc()
    at<Layer>(doc, ['layers', 0]).ip = 12
    expect(representativeFrame(doc, ['layers', 0]).frame).toBe(12)
  })

  it('maps layers inside precomps through the instance timing', () => {
    const doc = makeDoc()
    // Brand copy shows comp_logo from outer frame 0 with st = 30 → inner frames −30…70.
    for (const l of doc.layers) if ((l as { refId?: string }).refId === 'comp_logo') l.st = 30
    const inner = (doc.assets![1] as PrecompAsset).layers[0]
    inner.ip = -50
    const { frame } = representativeFrame(doc, ['assets', 1, 'layers', 0])
    // Inner frames −30…70 are visible. The instance scales in until outer frame 60 (inner 30), so
    // the element rests at its full on-screen size from about inner frame 28 on — that moment is
    // chosen rather than the half-size start.
    expect(frame).toBeGreaterThanOrEqual(25)
    expect(frame).toBeLessThanOrEqual(70)
  })

  it('honours an explicit frame', () => {
    const doc = makeDoc()
    const r = replaceWithShapes(
      doc,
      ['layers', 0, 'shapes', 0],
      { shapes: content() },
      { frame: 50 },
    )
    expect(r.fit.frame).toBe(50)
  })
})

const image = { dataUri: 'data:image/png;base64,QUJD', w: 200, h: 100, name: 'logo.png' }

/** World-space box of what an image layer draws. */
function imageWorldBox(doc: Animation, path: NodePath, frame = 0): Box {
  const layer = at<Layer & { refId: string }>(doc, path)
  const asset = doc.assets!.find((a) => a.id === layer.refId) as ImageAsset
  return transformBox({ x: 0, y: 0, w: asset.w!, h: asset.h! }, worldMatrix(doc, path, frame))
}

describe('replaceWithImage', () => {
  it('image layer: new asset, same layer, fit folded into anchor and scale', () => {
    const doc = makeDoc()
    const oldWorld = imageWorldBox(doc, ['layers', 2])
    const r = replaceWithImage(doc, ['layers', 2], { ...image, w: 100, h: 100 })
    const layer = at<Layer & { refId: string }>(doc, ['layers', 2])
    expect(layer.refId).toBe('image_0')
    expect(layer).toMatchObject({ ind: 3, parent: 1, ty: 2 })
    expect(doc.assets!.at(-1)).toMatchObject({
      id: 'image_0',
      w: 100,
      h: 100,
      e: 1,
      p: image.dataUri,
      nm: 'logo.png',
    })
    expect(r.paths).toEqual([
      ['layers', 2],
      ['assets', 2],
    ])
    expectContained(imageWorldBox(doc, ['layers', 2]), oldWorld, 0.05)
    // The original image asset stays (other layers may use it).
    expect(doc.assets!.some((a) => a.id === 'img')).toBe(true)
  })

  it('keeps animated anchor / scale keyframes working', () => {
    const doc = makeDoc()
    at<Layer>(doc, ['layers', 2]).ks.s = {
      a: 1,
      k: [kf(0, [100, 100, 100]), kf(50, [200, 200, 100])],
    }
    const oldWorld = [0, 25, 50].map((f) => imageWorldBox(doc, ['layers', 2], f))
    replaceWithImage(doc, ['layers', 2], { ...image, w: 50, h: 25 })
    ;[0, 25, 50].forEach((f, i) =>
      expectContained(imageWorldBox(doc, ['layers', 2], f), oldWorld[i], 0.05),
    )
  })

  it('shape layer: an image layer takes its place with the same ind and parenting', () => {
    const doc = makeDoc()
    const layerBox = targetBounds(doc, ['layers', 0], 0)!
    const oldWorld = transformBox(layerBox, worldMatrix(doc, ['layers', 0], 0))
    // "Photo" is parented to "Badge" (ind 1): the Badge transform must survive on a null.
    const r = replaceWithImage(doc, ['layers', 0], image)
    const img = at<Layer & { refId: string }>(doc, ['layers', 0])
    expect(img.ty).toBe(2)
    const holder = doc.layers.at(-1)!
    expect(holder).toMatchObject({ ty: 3, ind: 1 })
    expect(img.parent).toBe(1)
    expect(at<Layer>(doc, ['layers', 2]).parent).toBe(1)
    expect(r.paths).toEqual([
      ['layers', 0],
      ['layers', 6],
      ['assets', 2],
    ])
    expectContained(imageWorldBox(doc, ['layers', 0]), oldWorld, 0.05)
    expect(documentProblems(doc)).toEqual([])
  })

  it('layers without children are swapped in place; masks follow the new layer space', () => {
    const doc = makeDoc()
    const layer = at<Layer>(doc, ['layers', 3])
    layer.hasMask = true
    layer.masksProperties = [
      { mode: 'a', pt: s(rectPath(0, -40, 100, 50)), o: s(100), x: s(0), inv: false },
    ]
    const maskWorldBefore = transformBox(
      { x: 0, y: -40, w: 100, h: 50 },
      worldMatrix(doc, ['layers', 3], 0),
    )
    const r = replaceWithImage(doc, ['layers', 3], image)
    expect(r.warnings).toContain('approximate-bounds')
    const img = at<Layer>(doc, ['layers', 3])
    expect(img).toMatchObject({ ty: 2, ind: 4 })
    const pt = img.masksProperties![0].pt.k as BezierPath
    const xs = pt.v.map((v) => v[0])
    const ys = pt.v.map((v) => v[1])
    const local = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    }
    const maskWorldAfter = transformBox(local, worldMatrix(doc, ['layers', 3], 0))
    expect(maskWorldAfter.x).toBeCloseTo(maskWorldBefore.x, 1)
    expect(maskWorldAfter.y).toBeCloseTo(maskWorldBefore.y, 1)
    expect(maskWorldAfter.w).toBeCloseTo(maskWorldBefore.w, 1)
  })

  it('precomp layer: replaced by an image layer at the same stack position', () => {
    const doc = makeDoc()
    const oldBox = transformBox(
      targetBounds(doc, ['layers', 5], 0)!,
      worldMatrix(doc, ['layers', 5], 0),
    )
    replaceWithImage(doc, ['layers', 5], image)
    const img = at<Layer>(doc, ['layers', 5])
    expect(img).toMatchObject({ ty: 2, ind: 6, nm: 'Brand copy' })
    expect('w' in img || 'tm' in img).toBe(false)
    expect((img as { refId?: string }).refId).toBe('image_0')
    expectContained(imageWorldBox(doc, ['layers', 5]), oldBox, 0.05)
  })

  it('group: an image layer parented to the shape layer replaces the group', () => {
    const doc = makeDoc()
    const path: NodePath = ['layers', 0, 'shapes', 0]
    const frame = 10
    const m = multiplyMatrix(
      worldMatrix(doc, ['layers', 0], frame),
      shapeContentMatrix(doc, path, frame),
    )
    const oldWorld = transformBox(targetBounds(doc, path, frame)!, m)
    const r = replaceWithImage(doc, path, image, { frame })
    expect(r.warnings).toContain('group-transform-animated')
    const img = at<Layer>(doc, ['layers', 0])
    expect(img).toMatchObject({ ty: 2, parent: 1, ip: 0, op: 100 })
    expect(at<ShapeLayer>(doc, ['layers', 1]).nm).toBe('Badge')
    expect(at<ShapeLayer>(doc, ['layers', 1]).shapes.map((g) => g.nm)).toEqual(['Background'])
    expect(r.paths).toEqual([
      ['layers', 0],
      ['layers', 1],
      ['assets', 2],
    ])
    expectContained(imageWorldBox(doc, ['layers', 0], frame), oldWorld, 0.05)
    expect(documentProblems(doc)).toEqual([])
  })

  it('creates unique image ids', () => {
    const doc = makeDoc()
    replaceWithImage(doc, ['layers', 2], image)
    replaceWithImage(doc, ['layers', 4], image)
    expect(doc.assets!.map((a) => a.id)).toEqual(['img', 'comp_logo', 'image_0', 'image_1'])
  })
})

function multiplyMatrix(a: readonly number[], b: readonly number[]) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ] as const
}

/** Kind of the candidate a small group named `nm` becomes (null: not suggested). */
function kindOfGroupNamed(nm: string) {
  const doc = makeDoc()
  at<ShapeLayer>(doc, ['layers', 0]).shapes.push(
    group(nm, [sh(rectPath(0, 0, 5, 5)), sh(rectPath(8, 0, 5, 5)), fill(WHITE)]),
  )
  return findReplaceableElements(doc).find((c) => c.name === nm)?.kind ?? null
}

describe('findReplaceableElements', () => {
  it('ranks logo-like elements first and describes each candidate', () => {
    const doc = makeDoc()
    const list = findReplaceableElements(doc)
    const byName = new Map(list.map((c) => [c.name, c]))
    expect(list[0].kind).toBe('logo')
    expect(byName.get('Photo')).toMatchObject({
      kind: 'image',
      target: 'image-layer',
      assetId: 'img',
      usage: 1,
    })
    expect(byName.get('Title')).toMatchObject({ kind: 'text', target: 'text-layer' })
    const brand = byName.get('Brand')!
    expect(brand).toMatchObject({
      kind: 'logo',
      target: 'precomp-layer',
      assetId: 'comp_logo',
      usage: 2,
    })
    expect(brand.reasons).toContain('vector-precomp')
    expect(brand.rootBounds).not.toBeNull()
    expect(brand.rootFrame).toBe(brand.frame)
    // Layers inside a logo precomp are covered by it.
    expect(list.some((c) => c.path[0] === 'assets')).toBe(false)
    // Solids are never candidates; the big black background layer is not a logo.
    expect(byName.has('Backdrop')).toBe(false)
    const kinds = list.map((c) => c.kind)
    expect(kinds.indexOf('image')).toBeGreaterThan(kinds.lastIndexOf('logo'))
  })

  it('finds groups and shape layers named like a logo', () => {
    const doc = makeDoc()
    at<ShapeLayer>(doc, ['layers', 0]).shapes.push(
      group('Company logo', [sh(rectPath(0, 0, 5, 5)), fill(WHITE)]),
    )
    const list = findReplaceableElements(doc)
    const logo = list.find((c) => c.name === 'Company logo')!
    expect(logo).toMatchObject({ target: 'group', kind: 'logo', path: ['layers', 0, 'shapes', 2] })
    expect(logo.reasons).toContain('name')
  })

  it('lists watermarks after logos and images, whatever their score', () => {
    const doc = makeDoc()
    const layers = doc.layers
    const badge = at<ShapeLayer>(doc, ['layers', 0])
    // A small, detailed shape layer named like a watermark would outrank the logos on points.
    layers.unshift({
      ...badge,
      ind: 20,
      nm: 'Watermark',
      shapes: [
        group('Letters', [
          sh(rectPath(0, 0, 4, 4)),
          sh(rectPath(6, 0, 4, 4)),
          sh(rectPath(12, 0, 4, 4)),
          fill(WHITE),
        ]),
      ],
    } as Layer)
    const list = findReplaceableElements(doc)
    const kinds = list.map((c) => c.kind)
    const watermark = list.find((c) => c.name === 'Watermark')!
    expect(watermark).toMatchObject({ kind: 'watermark', target: 'shape-layer' })
    expect(watermark.reasons).toContain('watermark')
    expect(kinds.indexOf('watermark')).toBeGreaterThan(kinds.lastIndexOf('logo'))
    expect(kinds.indexOf('watermark')).toBeGreaterThan(kinds.lastIndexOf('image'))
    expect(list[0].kind).toBe('logo')
  })

  it('tells watermark names from logo names and ordinary words', () => {
    const named = kindOfGroupNamed
    expect(named('watermark')).toBe('watermark')
    expect(named('Water-mark 2')).toBe('watermark')
    expect(named('Водяной знак')).toBe('watermark')
    expect(named('моя вотерка')).toBe('watermark')
    expect(named('Logo mark')).toBe('logo')
    expect(named('Знак бренда')).toBe('logo')
    // Water splashes are not a watermark (and not a logo either).
    expect(named('водяные капли')).toBeNull()
  })

  it('measureElement places any element like a candidate', () => {
    const doc = makeDoc()
    for (const c of findReplaceableElements(doc)) {
      const m = measureElement(doc, c.path)!
      expect(m).toEqual({
        frame: c.frame,
        bounds: c.bounds,
        rootFrame: c.rootFrame,
        rootBounds: c.rootBounds,
      })
    }
    // A layer inside a logo precomp is not a candidate, but can be measured in root space.
    const inner = measureElement(doc, ['assets', 1, 'layers', 0])
    expect(inner?.rootBounds).not.toBeNull()
    expect(measureElement(doc, ['layers', 99])).toBeNull()
  })
})

describe('damaged documents', () => {
  it('names that are not text, damaged transforms and paths do not stop the search', () => {
    const doc = makeDoc()
    const badge = at<ShapeLayer>(doc, ['layers', 0])
    const photo = doc.layers.findIndex((l) => l.nm === 'Photo')
    ;(doc.layers[photo] as unknown as { nm: unknown }).nm = 42
    // A path whose points are not number pairs draws nothing measurable.
    badge.shapes.push(
      group('Broken', [
        { ty: 'sh', ks: { a: 0, k: { c: true, v: [null, [1]], i: 5, o: [] } } } as never,
        fill(WHITE),
      ]),
    )
    // A transform that is not an object cannot carry new content.
    ;(at<Layer>(doc, ['layers', 1]) as unknown as { ks: unknown }).ks = 7
    const list = findReplaceableElements(doc)
    expect(list.length).toBeGreaterThan(0)
    // A name that is not text is no name: the image's own name is shown instead.
    expect(list.find((c) => pathKey(c.path) === pathKey(['layers', photo]))?.name).toBe('img')
    expect(replaceTargetKind(doc, ['layers', 1])).toBeNull()
    expect(list.some((c) => pathKey(c.path) === pathKey(['layers', 1]))).toBe(false)
    expect(() => replaceWithShapes(doc, ['layers', 1], { shapes: content() })).toThrow(ReplaceError)
    // The group with the broken path is still measured by its other content (or skipped).
    expect(() => measureElement(doc, ['layers', 0])).not.toThrow()
  })

  it('assets that are not a list: nothing to suggest, no crash', () => {
    const doc = makeDoc()
    ;(doc as unknown as { assets: unknown }).assets = 5
    expect(findReplaceableElements(doc)).toEqual([])
  })
})

describe('edge cases', () => {
  it('time-remapped precomps: the new layer covers every inner frame the remap reaches', () => {
    const doc = makeDoc()
    const layer = at<Layer & { tm?: unknown }>(doc, ['layers', 5])
    // Remap 0 → 5 s (frame 150) over the layer, far beyond the old inner layer (0…100).
    layer.tm = { a: 1, k: [kf(0, [0]), kf(99, [5])] }
    replaceWithShapes(doc, ['layers', 5], { shapes: content() })
    const refId = (layer as { refId?: string }).refId
    const asset = doc.assets!.find((a) => a.id === refId) as PrecompAsset
    expect(asset.layers[0].ip).toBeLessThanOrEqual(0)
    expect(asset.layers[0].op).toBeGreaterThanOrEqual(150)
  })

  it('replaces layers inside precomps (asset layer paths)', () => {
    const doc = makeDoc()
    const path: NodePath = ['assets', 1, 'layers', 0]
    const oldBox = targetBounds(doc, path, 0)!
    const r = replaceWithShapes(doc, path, { shapes: content() })
    expect(r.paths).toEqual([path, [...path, 'shapes', 0]])
    expectContained(targetBounds(doc, path, 0)!, oldBox)
    // Its motion (ks) is kept.
    expect(at<ShapeLayer>(doc, path).ks.p).toEqual(s([100, 100]))
  })

  it('re-points track mattes (tp) and keeps children when an image replaces a parent layer', () => {
    const doc = makeDoc()
    // Layer 2 ("Photo", ind 3) is parented to "Badge" (ind 1); make it use Badge as matte too.
    at<Layer>(doc, ['layers', 2]).tp = 1
    at<Layer>(doc, ['layers', 2]).tt = 1
    at<Layer>(doc, ['layers', 0]).td = 1
    replaceWithImage(doc, ['layers', 0], image)
    const img = at<Layer>(doc, ['layers', 0])
    const holder = doc.layers.at(-1)!
    expect(holder).toMatchObject({ ty: 3, ind: 1 })
    expect(img.td).toBe(1)
    // The matte reference follows the image; the parent reference stays on the transform holder.
    expect(at<Layer>(doc, ['layers', 2])).toMatchObject({ tp: img.ind, parent: 1 })
    expect(documentProblems(doc)).toEqual([])
  })

  it('inserts the image of a group above the matte source of a matted layer', () => {
    const doc = makeDoc()
    doc.layers.splice(0, 0, {
      ...layerBase,
      ind: 9,
      ty: 4,
      nm: 'Matte',
      td: 1,
      ks: {},
      shapes: [group('M', [sh(rectPath(0, 0, 50, 50)), fill(WHITE)])],
    } as Layer)
    at<Layer>(doc, ['layers', 1]).tt = 1
    const r = replaceWithImage(doc, ['layers', 1, 'shapes', 0], image)
    expect(r.warnings).toContain('layer-effects-not-applied')
    expect(doc.layers.map((l) => l.nm).slice(0, 3)).toEqual(['logo.png', 'Matte', 'Badge'])
    expect(r.paths[0]).toEqual(['layers', 0])
    expect(r.paths[1]).toEqual(['layers', 2])
  })

  it('handles 500 logo-like layers quickly', () => {
    const layers: Layer[] = Array.from(
      { length: 500 },
      (_, i) =>
        ({
          ...layerBase,
          ind: i + 1,
          ty: 4,
          nm: `Logo ${i}`,
          op: 300,
          ks: { p: { a: 1, k: [kf(0, [0, 0]), kf(300, [100, 100])] } },
          shapes: [
            group('Logo mark', [
              sh(rectPath(i, 0, 10, 10)),
              sh(rectPath(i, 20, 10, 10)),
              sh(rectPath(i, 40, 10, 10)),
              fill(WHITE),
            ]),
          ],
        }) as Layer,
    )
    const doc: Animation = {
      v: '5.7.0',
      fr: 60,
      ip: 0,
      op: 300,
      w: 1000,
      h: 1000,
      layers,
      assets: [],
    }
    let t0 = performance.now()
    expect(findReplaceableElements(doc)).toHaveLength(50)
    expect(performance.now() - t0).toBeLessThan(4000)
    t0 = performance.now()
    replaceWithShapes(doc, ['layers', 250], { shapes: content() }, { style: 'original' })
    expect(performance.now() - t0).toBeLessThan(500)
  })
})

/* --------------------------- The real wallet flag -------------------------- */

const walletText = docText('wallet_flag.json')

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32 58 C10 42 4 30 4 20 A14 14 0 0 1 32 14 A14 14 0 0 1 60 20 C60 30 54 42 32 58 Z" fill="#e11d48"/>
  <circle cx="44" cy="22" r="5" fill="#fda4af"/></svg>`

/** The wallet document and the path of its logo precomp layer. */
function loadWallet() {
  const doc = JSON.parse(walletText!) as Animation
  const index = doc.layers.findIndex((l) => l.nm === 'пикчи для флага')
  return { doc, path: ['layers', index] as NodePath }
}

describe.skipIf(!walletText)('docs/wallet_flag.json', () => {
  it('finds the wallet precomp first, then the watermark', () => {
    const { doc, path } = loadWallet()
    const list = findReplaceableElements(doc)
    // The logo a user means to swap comes first (a file dropped on Customize replaces it).
    expect(list.map((c) => [c.name, c.kind])).toEqual([
      ['пикчи для флага', 'logo'],
      ['моя вотерка', 'watermark'],
    ])
    const wallet = list[0]
    expect(wallet).toMatchObject({ path, assetId: 'comp_0', usage: 1, frame: 0 })
    expect(wallet.reasons).toEqual(expect.arrayContaining(['vector-precomp', 'artwork', 'compact']))
    expect(list[1].reasons).toContain('watermark')
    // The flag itself (matte, gradient precomp) is not offered as a logo.
    expect(list.some((c) => c.name === 'grad wallet' || c.name === 'base 2')).toBe(false)
  })

  it("replaces the wallet with an SVG logo: motion kept, bounds kept, 'original' colors, valid", () => {
    const { doc, path } = loadWallet()
    const layerBefore = clone(at<Layer>(doc, path))
    const rep = representativeFrame(doc, path)
    const oldBox = rep.bounds!
    const svg = importSvg(LOGO_SVG, { name: 'heart.svg' })
    const r = replaceWithShapes(
      doc,
      path,
      { shapes: svg.shapes, box: svg.bounds },
      { style: 'original' },
    )

    // The precomp layer (motion: position, rotation, scale keyframes) is untouched.
    expect(at<Layer>(doc, path)).toEqual(layerBefore)
    // comp_0 is used once: replaced in place, no new asset.
    expect(doc.assets!.map((a) => a.id)).toEqual(['comp_0', 'comp_1'])
    const comp = doc.assets![0] as PrecompAsset
    expect(comp.layers).toHaveLength(1)
    expect(comp.layers[0]).toMatchObject({ ty: 4, nm: 'heart.svg', ip: 0 })
    expect(comp.layers[0].op).toBeGreaterThanOrEqual(179)
    // New bounds ≈ old bounds (contain), at several frames.
    for (const f of [0, 60, 120, 178]) expectContained(targetBounds(doc, path, f)!, oldBox, 0.05)
    // 'original' style: the heart (the logo's main color) gets the white fill, its highlight
    // the wallet's second color (#0A98FD), and both the wallet's outline.
    const shapes = (comp.layers[0] as ShapeLayer).shapes
    const fills = findItems(shapes, 'fl')
    const strokes = findItems(shapes, 'st')
    expect(fills.length).toBe(2)
    expect(fills.map((f) => hex(f.c.k as number[])).sort()).toEqual(['#0a98fd', '#ffffff'])
    expect(strokes.length).toBe(2)
    expect(new Set(strokes.map((f) => hex(f.c.k as number[])))).toEqual(new Set(['#0a98fd']))
    // Valid document: groups end with tr, unique ids, no aliasing.
    expect(documentProblems(doc)).toEqual([])
    expect(findAliases(doc)).toEqual([])
    expect(r.paths[0]).toEqual(path)
    expect(r.warnings).toEqual([])
  })

  it('replaces the wallet with an image of another aspect ratio', () => {
    const { doc, path } = loadWallet()
    const world = (f: number) =>
      transformBox(representativeFrame(doc, path).bounds!, worldMatrix(doc, path, f))
    const before = [0, 90].map(world)
    replaceWithImage(doc, path, { dataUri: 'data:image/png;base64,QUJD', w: 300, h: 100 })
    const img = at<Layer & { refId: string }>(doc, path)
    expect(img.ty).toBe(2)
    const box = (f: number) =>
      transformBox({ x: 0, y: 0, w: 300, h: 100 }, worldMatrix(doc, path, f))
    // Rotation keyframes make the world boxes approximate: compare centers and widths.
    ;[0, 90].forEach((f, i) => {
      const b = box(f)
      expect(b.x + b.w / 2).toBeCloseTo(before[i].x + before[i].w / 2, 0)
      expect(b.y + b.h / 2).toBeCloseTo(before[i].y + before[i].h / 2, 0)
    })
    expect(documentProblems(doc)).toEqual([])
  })

  it('keeps the flag gradient precomp and its matte untouched', () => {
    const { doc, path } = loadWallet()
    const flag = clone(doc.assets![1])
    const matte = clone(doc.layers.filter((l) => l.td || l.tt))
    replaceWithShapes(doc, path, { shapes: importSvg(LOGO_SVG).shapes })
    expect(doc.assets![1]).toEqual(flag)
    expect(doc.layers.filter((l) => l.td || l.tt)).toEqual(matte)
    expect(layerMatrix(doc.layers[0], 0)).toBeDefined()
  })

  it('bounds of the replaced content follow the shapes exactly', () => {
    const { doc, path } = loadWallet()
    replaceWithShapes(doc, path, { shapes: importSvg(LOGO_SVG).shapes })
    const comp = doc.assets![0] as PrecompAsset
    const layerBox = shapeItemsBounds((comp.layers[0] as ShapeLayer).shapes, 0, {
      includeStroke: true,
    })
    expect(layerBox).toEqual(targetBounds(doc, path, 0))
  })
})
