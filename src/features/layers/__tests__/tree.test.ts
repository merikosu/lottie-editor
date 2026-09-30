import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import { createFillShape, createGroupShape, createRectShape } from '@/lottie/create'
import { createAnimation } from '@/lottie/document'
import { moveLayers, moveShapes } from '@/lottie/layer-ops'
import type { Animation, GroupShape, Layer, ShapeItem } from '@/lottie/types'
import { dropTarget, type DragSource } from '../dnd'
import { nodeKeyOf, parentRowKey, pathOfNodeKey, remapKey, remapRecord } from '../keys'
import { ancestorRowKeys, buildTree, subtreeKeys } from '../tree-model'

const box = (
  nm: string,
  items: ShapeItem[] = [createRectShape({ w: 1, h: 1 }), createFillShape({ color: '#f00' })],
) => createGroupShape({ name: nm, items })

/**
 * root: [0] Ctrl (null, ind 10)            key ":10"
 *       [1] Art (shape, ind 11)            key ":11"  shapes: Outer{ Inner{rect,fill}, fill }, Loose rect
 *       [2] Instance (precomp comp_0, 12)  key ":12"
 * comp_0: [0] Inside (null, ind 1)         key "comp_0:1"
 */
function fixture(): Animation {
  const anim = createAnimation()
  anim.layers = [
    { ty: 3, ind: 10, nm: 'Ctrl', ip: 0, op: 90, st: 0, ks: {} },
    {
      ty: 4,
      ind: 11,
      nm: 'Art',
      ip: 0,
      op: 90,
      st: 0,
      ks: {},
      shapes: [
        box('Outer', [box('Inner'), createFillShape({ color: '#0f0', name: 'Paint' })]),
        createRectShape({ w: 1, h: 1, name: 'Loose' }),
      ],
    },
    { ty: 0, ind: 12, nm: 'Instance', refId: 'comp_0', ip: 0, op: 90, st: 0, ks: {} },
  ] as Layer[]
  anim.assets = [
    { id: 'comp_0', layers: [{ ty: 3, ind: 1, nm: 'Inside', ip: 0, op: 90, st: 0, ks: {} }] },
  ]
  return anim
}

const build = (doc: Animation, expanded: string[] = [], search = '') =>
  buildTree(doc, {
    expanded: Object.fromEntries(expanded.map((k) => [k, true as const])),
    search,
    t: en,
  })

describe('keys', () => {
  it('builds stable keys and resolves them back', () => {
    const doc = fixture()
    expect(nodeKeyOf(doc, ['layers', 1])).toBe(':11')
    expect(nodeKeyOf(doc, ['layers', 1, 'shapes', 0, 'it', 1])).toBe(':11|0.1')
    expect(nodeKeyOf(doc, ['assets', 0, 'layers', 0])).toBe('comp_0:1')
    expect(nodeKeyOf(doc, ['layers', 1, 'ks'])).toBeNull()
    expect(pathOfNodeKey(doc, ':11|0.1')).toEqual(['layers', 1, 'shapes', 0, 'it', 1])
    expect(pathOfNodeKey(doc, 'comp_0:1')).toEqual(['assets', 0, 'layers', 0])
    expect(pathOfNodeKey(doc, ':11|9')).toBeNull()
    expect(pathOfNodeKey(doc, ':99')).toBeNull()
  })

  it('falls back to indices for missing or duplicate inds and escapes asset ids', () => {
    const doc = createAnimation()
    doc.layers = [
      { ty: 3, ind: 1, ip: 0, op: 1, st: 0, ks: {} },
      { ty: 3, ind: 1, ip: 0, op: 1, st: 0, ks: {} },
      { ty: 3, ip: 0, op: 1, st: 0, ks: {} },
    ] as Layer[]
    doc.assets = [
      { id: 'a|b>c', layers: [{ ty: 3, ind: 2, ip: 0, op: 1, st: 0, ks: {} } as Layer] },
    ]
    expect(doc.layers.map((_, i) => nodeKeyOf(doc, ['layers', i]))).toEqual([':1', ':#1', ':#2'])
    expect(nodeKeyOf(doc, ['assets', 0, 'layers', 0])).toBe('a%7Cb%3Ec:2')
  })

  it('stays stable when layers are reordered and follows moved shape items', () => {
    const doc = fixture()
    const moved = produce(doc, (d) => {
      moveLayers(d as Animation, ['layers'], [1], 0)
    })
    expect(pathOfNodeKey(moved, ':11')).toEqual(['layers', 0])
    expect(remapKey(':11|0', doc, moved)).toBe(':11|0')

    const reordered = produce(doc, (d) => {
      moveShapes(d as Animation, [['layers', 1, 'shapes', 1]], ['layers', 1, 'shapes'], 0)
    })
    // "Outer" moved from index 0 to 1; its key follows it, and so do nested row keys.
    expect(remapKey(':11|0', doc, reordered)).toBe(':11|1')
    expect(remapKey(':11|0.0', doc, reordered)).toBe(':11|1.0')
    expect(remapKey(':12>comp_0:1', doc, reordered)).toBe(':12>comp_0:1')
    const record = { ':11|0': true as const, ':10': true as const }
    expect(remapRecord(record, doc, reordered)).toEqual({ ':11|1': true, ':10': true })
    expect(remapRecord({ ':10': true }, doc, reordered)).toEqual({ ':10': true })
  })

  it('finds parent row keys', () => {
    expect(parentRowKey(':11|0.1')).toBe(':11|0')
    expect(parentRowKey(':11|0')).toBe(':11')
    expect(parentRowKey(':11')).toBeNull()
    expect(parentRowKey(':12>comp_0:1')).toBe(':12')
    expect(parentRowKey(':12>comp_0:1|3')).toBe(':12>comp_0:1')
  })
})

describe('buildTree', () => {
  it('lists root layers collapsed by default', () => {
    const { rows } = build(fixture())
    expect(rows.map((r) => [r.key, r.name, r.depth, r.expandable, r.expanded])).toEqual([
      [':10', 'Ctrl', 0, false, false],
      [':11', 'Art', 0, true, false],
      [':12', 'Instance', 0, true, false],
    ])
    expect(rows[2].last).toBe(true)
  })

  it('expands shape layers (without group transforms) and precomps per instance', () => {
    const { rows, indexOf } = build(fixture(), [':11', ':11|0', ':12'])
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.name}`)).toEqual([
      'Ctrl',
      'Art',
      '  Outer',
      '    Inner',
      '    Paint',
      '  Loose',
      'Instance',
      '  Inside',
    ])
    const inside = rows[indexOf.get(':12>comp_0:1')!]
    expect(inside.path).toEqual(['assets', 0, 'layers', 0])
    expect(inside.instances).toEqual([['layers', 2]])
    expect(inside.parentKey).toBe(':12')
    const paint = rows[indexOf.get(':11|0.1')!]
    expect(paint.arrayPath).toEqual(['layers', 1, 'shapes', 0, 'it'])
    expect(paint.layerPath).toEqual(['layers', 1])
    expect(paint.last).toBe(true)
  })

  it('dims the content of hidden layers and groups', () => {
    const doc = produce(fixture(), (d) => {
      d.layers[1].hd = true
    })
    const { rows } = build(doc, [':11', ':11|0'])
    expect(rows.filter((r) => r.hiddenByParent).map((r) => r.name)).toEqual([
      'Outer',
      'Inner',
      'Paint',
      'Loose',
    ])
    expect(rows.find((r) => r.name === 'Art')!.hidden).toBe(true)
  })

  it('never expands a precomp that contains itself', () => {
    const doc = fixture()
    ;(doc.assets![0] as { layers: Layer[] }).layers.push({
      ty: 0,
      ind: 2,
      nm: 'Loop',
      refId: 'comp_0',
      ip: 0,
      op: 1,
      st: 0,
      ks: {},
    } as Layer)
    const { rows } = build(doc, [':12', ':12>comp_0:2', ':12>comp_0:2>comp_0:2'])
    const loop = rows.find((r) => r.name === 'Loop')!
    expect(loop.recursive).toBe(true)
    expect(loop.expandable).toBe(false)
    expect(rows).toHaveLength(5)
  })

  it('filters by name, keeping ancestors and highlighting matches', () => {
    const model = build(fixture(), [], 'in')
    expect(model.searching).toBe(true)
    expect(model.rows.map((r) => [r.name, r.match])).toEqual([
      ['Art', null],
      ['Outer', null],
      ['Inner', [0, 2]],
      ['Paint', [2, 4]],
      ['Instance', [0, 2]],
      ['Inside', [0, 2]],
    ])
    expect(model.matches).toBe(4)
    expect(build(fixture(), [], 'zzz').rows).toEqual([])
  })

  it('lets matched rows be expanded to show all their content while searching', () => {
    const { rows } = build(fixture(), [':11'], 'art')
    expect(rows.map((r) => r.name)).toEqual(['Art', 'Outer', 'Loose'])
  })

  it('lists the expandable rows of a subtree for recursive expansion', () => {
    const doc = fixture()
    const art = build(doc).rows.find((r) => r.name === 'Art')!
    expect(subtreeKeys(doc, art, en)).toEqual([':11', ':11|0', ':11|0.0'])
    const instance = build(doc).rows.find((r) => r.name === 'Instance')!
    expect(subtreeKeys(doc, instance, en)).toEqual([':12'])
    // Nested rows: the build must pass through their (collapsed) ancestors.
    const outer = build(doc, [':11']).rows.find((r) => r.name === 'Outer')!
    expect(subtreeKeys(doc, outer, en)).toEqual([':11|0', ':11|0.0'])
    // `:1` must not match `:11` (prefix + separator only).
    const ctrl = build(doc).rows.find((r) => r.name === 'Ctrl')!
    expect(subtreeKeys(doc, ctrl, en)).toEqual([])
  })

  it('finds the rows to expand to reveal a node', () => {
    const doc = fixture()
    expect(ancestorRowKeys(doc, ['layers', 1, 'shapes', 0, 'it', 1])).toEqual({
      keys: [':11', ':11|0'],
      rowKey: ':11|0.1',
      preferred: false,
    })
    expect(ancestorRowKeys(doc, ['assets', 0, 'layers', 0])).toEqual({
      keys: [':12'],
      rowKey: ':12>comp_0:1',
      preferred: false,
    })
    expect(ancestorRowKeys(doc, ['layers', 0])).toEqual({
      keys: [],
      rowKey: ':10',
      preferred: false,
    })
    const orphan = createAnimation()
    orphan.assets = [{ id: 'x', layers: [{ ty: 3, ind: 1, ip: 0, op: 1, st: 0, ks: {} } as Layer] }]
    expect(ancestorRowKeys(orphan, ['assets', 0, 'layers', 0])).toBeNull()
  })

  it('reveals precomp content through the preferred instance', () => {
    const doc = fixture()
    // A second instance of comp_0 below the first one.
    doc.layers.push({ ...(doc.layers[2] as Layer), ind: 13, nm: 'Instance 2' } as Layer)
    expect(ancestorRowKeys(doc, ['assets', 0, 'layers', 0])?.rowKey).toBe(':12>comp_0:1')
    expect(ancestorRowKeys(doc, ['assets', 0, 'layers', 0], [['layers', 3]])).toEqual({
      keys: [':13'],
      rowKey: ':13>comp_0:1',
      preferred: true,
    })
    // A preference that shows something else is ignored.
    const other = ancestorRowKeys(doc, ['assets', 0, 'layers', 0], [['layers', 1]])
    expect(other?.rowKey).toBe(':12>comp_0:1')
    expect(other?.preferred).toBe(false)
  })

  it('follows a preferred chain through nested precomps', () => {
    const doc = fixture()
    // comp_1 shows comp_0 twice; the root shows comp_1 twice (after the direct instance).
    doc.assets!.push({
      id: 'comp_1',
      layers: [
        { ty: 0, ind: 1, nm: 'Inner A', refId: 'comp_0', ip: 0, op: 90, st: 0, ks: {} },
        { ty: 0, ind: 2, nm: 'Inner B', refId: 'comp_0', ip: 0, op: 90, st: 5, ks: {} },
      ] as Layer[],
    })
    doc.layers = [
      ...doc.layers.slice(0, 2),
      { ty: 0, ind: 20, nm: 'Outer A', refId: 'comp_1', ip: 0, op: 90, st: 0, ks: {} } as Layer,
      { ty: 0, ind: 21, nm: 'Outer B', refId: 'comp_1', ip: 0, op: 90, st: 9, ks: {} } as Layer,
    ]
    // Without a preference: the first chain in tree order.
    expect(ancestorRowKeys(doc, ['assets', 0, 'layers', 0])?.rowKey).toBe(':20>comp_1:1>comp_0:1')
    // The full preferred chain wins over partial matches.
    const chain = [
      ['layers', 3],
      ['assets', 1, 'layers', 1],
    ]
    expect(ancestorRowKeys(doc, ['assets', 0, 'layers', 0], chain)).toEqual({
      keys: [':21', ':21>comp_1:2'],
      rowKey: ':21>comp_1:2>comp_0:1',
      preferred: true,
    })
    // Only the inner link preferred: the first outer instance, the preferred inner one.
    expect(
      ancestorRowKeys(doc, ['assets', 0, 'layers', 0], [['assets', 1, 'layers', 1]])?.rowKey,
    ).toBe(':20>comp_1:2>comp_0:1')
  })
})

const at = (row: number, fraction = 0.1, depth = 9) => ({ row, fraction, depth })

describe('dropTarget', () => {
  const doc = fixture()
  const { rows } = build(doc, [':11', ':11|0', ':12'])
  const layerSource: DragSource = {
    kind: 'layer',
    parentKey: null,
    compPath: ['layers'],
    paths: [['layers', 0]],
  }

  it('drops layers between root layers', () => {
    expect(dropTarget(doc, rows, layerSource, at(1))).toEqual({
      arrayPath: ['layers'],
      index: 1,
      indicator: { type: 'line', row: 1, depth: 0 },
    })
    // Bottom half of "Art" or anywhere in its content → after "Art" (before "Instance").
    for (const target of [at(1, 0.8), at(3), at(5, 0.9)]) {
      expect(dropTarget(doc, rows, layerSource, target)).toMatchObject({
        index: 2,
        indicator: { row: 6 },
      })
    }
    // Below the list → the end of the composition.
    expect(dropTarget(doc, rows, layerSource, at(40))).toMatchObject({
      index: 3,
      indicator: { row: 8 },
    })
  })

  it('keeps precomp layers inside their composition', () => {
    const inner: DragSource = {
      kind: 'layer',
      parentKey: ':12',
      compPath: ['assets', 0, 'layers'],
      paths: [['assets', 0, 'layers', 0]],
    }
    expect(dropTarget(doc, rows, inner, at(7))).toMatchObject({
      arrayPath: ['assets', 0, 'layers'],
      index: 0,
    })
    expect(dropTarget(doc, rows, inner, at(2))).toBeNull()
    expect(dropTarget(doc, rows, inner, at(6, 0.9))).toBeNull()
  })

  it('never splits a matte pair', () => {
    const matte = createAnimation()
    matte.layers = [
      { ty: 3, ind: 1, nm: 'A', ip: 0, op: 1, st: 0, ks: {} },
      { ty: 3, ind: 2, nm: 'Matte', td: 1, ip: 0, op: 1, st: 0, ks: {} },
      { ty: 3, ind: 3, nm: 'Art', tt: 1, ip: 0, op: 1, st: 0, ks: {} },
    ] as Layer[]
    const r = build(matte).rows
    expect(dropTarget(matte, r, layerSource, at(2))).toEqual({
      arrayPath: ['layers'],
      index: 1,
      indicator: { type: 'line', row: 1, depth: 0 },
    })
  })

  it('moves shapes before/after items, into groups and out of groups', () => {
    const source: DragSource = {
      kind: 'shape',
      layerRowKey: ':11',
      paths: [['layers', 1, 'shapes', 1]],
    }
    // Top half of "Inner" (a group): before it.
    expect(dropTarget(doc, rows, source, at(3, 0.1))).toMatchObject({
      arrayPath: ['layers', 1, 'shapes', 0, 'it'],
      index: 0,
      indicator: { type: 'line', row: 3, depth: 2 },
    })
    // Middle of a group row: into the group.
    expect(dropTarget(doc, rows, source, at(3, 0.5))).toMatchObject({
      arrayPath: ['layers', 1, 'shapes', 0, 'it', 0, 'it'],
      index: 0,
      indicator: { type: 'inside', row: 3 },
    })
    // Bottom half of the last item of "Outer": stays inside at depth 2, leaves with the pointer to the left.
    expect(dropTarget(doc, rows, source, at(4, 0.9, 2))).toMatchObject({
      arrayPath: ['layers', 1, 'shapes', 0, 'it'],
      index: 2,
    })
    expect(dropTarget(doc, rows, source, at(4, 0.9, 1))).toMatchObject({
      arrayPath: ['layers', 1, 'shapes'],
      index: 1,
      indicator: { type: 'line', row: 5, depth: 1 },
    })
    // The layer row: top of the layer's shapes.
    expect(dropTarget(doc, rows, source, at(1, 0.2))).toMatchObject({
      arrayPath: ['layers', 1, 'shapes'],
      index: 0,
    })
    // Outside the layer.
    expect(dropTarget(doc, rows, source, at(0))).toBeNull()
    expect(dropTarget(doc, rows, source, at(7))).toBeNull()
  })

  it('refuses to drop a group into itself', () => {
    const source: DragSource = {
      kind: 'shape',
      layerRowKey: ':11',
      paths: [['layers', 1, 'shapes', 0]],
    }
    expect(dropTarget(doc, rows, source, at(3, 0.5))).toBeNull()
    expect(dropTarget(doc, rows, source, at(2, 0.5))).toBeNull()
    expect(dropTarget(doc, rows, source, at(5, 0.9))).toMatchObject({
      arrayPath: ['layers', 1, 'shapes'],
      index: 2,
    })
  })

  it('works on the moved document (smoke test of the full flow)', () => {
    const source: DragSource = {
      kind: 'shape',
      layerRowKey: ':11',
      paths: [['layers', 1, 'shapes', 1]],
    }
    const target = dropTarget(doc, rows, source, at(3, 0.5))!
    const next = produce(doc, (d) => {
      moveShapes(d as Animation, source.paths, target.arrayPath, target.index)
    })
    const outer = (next.layers[1] as { shapes: GroupShape[] }).shapes[0]
    const inner = outer.it[0] as GroupShape
    expect(inner.it.map((i) => i.nm ?? i.ty)).toEqual(['Loose', 'rc', 'fl', 'Transform'])
  })
})
