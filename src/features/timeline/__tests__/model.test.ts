import { describe, expect, it } from 'vitest'
import testJson from '../../../../docs/test.json?raw'
import en from '@/i18n/locales/en'
import ru from '@/i18n/locales/ru'
import { createAnimation } from '@/lottie/document'
import type { Animation, Layer, ShapeLayer, TextLayer } from '@/lottie/types'
import bounce from '@/samples/bounce.json'
import { LAYER_ROW_H, PROP_ROW_H } from '../geometry'
import {
  compId,
  flattenRows,
  groupKeys,
  layerIds,
  layerModel,
  layerRowKey,
  rowKeyTimes,
  summaryKeys,
  type GroupNode,
  type PropNode,
  type TreeNode,
} from '../model'

const ease = { o: { x: 0.33, y: 0 }, i: { x: 0.67, y: 1 } }
const anim = (a: number, b: number, t0 = 0, t1 = 10) => ({
  a: 1 as const,
  k: [
    { t: t0, s: [a], ...ease },
    { t: t1, s: [b] },
  ],
})
const bounceDoc = () => structuredClone(bounce) as unknown as Animation

/** Tree as "label > label" lines for readable assertions. */
function outline(nodes: readonly TreeNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.label}`,
    ...(n.kind === 'group' ? outline(n.children, depth + 1) : []),
  ])
}

describe('layer models', () => {
  it('lists only animated properties, grouped like After Effects', () => {
    const doc = bounceDoc()
    const ball = layerModel(doc.layers[0], ['layers', 0], en)
    expect(ball.name).toBe('Ball')
    expect(outline(ball.children)).toEqual(['Transform', '  Position', '  Scale'])
    expect(ball.props.map((p) => p.path.join('/'))).toEqual(['layers/0/ks/p', 'layers/0/ks/s'])
    const ground = layerModel(doc.layers[2], ['layers', 2], en)
    expect(ground.children).toEqual([])
  })

  it('is memoized per layer object and language', () => {
    const doc = bounceDoc()
    const a = layerModel(doc.layers[0], ['layers', 0], en)
    expect(layerModel(doc.layers[0], ['layers', 0], en)).toBe(a)
    expect(layerModel(doc.layers[0], ['layers', 0], ru)).not.toBe(a)
    expect(layerModel(doc.layers[0], ['layers', 0], ru).children[0].label).toBe('Трансформация')
    expect(layerModel({ ...doc.layers[0] }, ['layers', 0], en)).not.toBe(a)
  })

  it('walks shapes: groups, items, group transforms, gradients, dashes and repeaters', () => {
    const layer: ShapeLayer = {
      ty: 4,
      ip: 0,
      op: 60,
      st: 0,
      ks: { p: { s: true, x: anim(0, 10), y: { a: 0, k: 5 } } },
      shapes: [
        {
          ty: 'gr',
          nm: 'Blob',
          it: [
            { ty: 'el', p: { a: 0, k: [0, 0] }, s: anim(10, 20) as never },
            {
              ty: 'st',
              c: { a: 0, k: [1, 1, 1, 1] },
              o: { a: 0, k: 100 },
              w: anim(1, 4),
              d: [
                { n: 'd', v: anim(2, 6) },
                { n: 'o', v: { a: 0, k: 0 } },
              ],
            },
            {
              ty: 'gf',
              g: {
                p: 2,
                k: {
                  a: 1,
                  k: [
                    { t: 0, s: [0, 1, 0, 0, 1, 0, 0, 1], ...ease },
                    { t: 9, s: [0, 0, 0, 1, 1, 1, 1, 1] },
                  ],
                },
              },
              s: { a: 0, k: [0, 0] },
              e: { a: 0, k: [1, 1] },
              t: 1,
              o: { a: 0, k: 100 },
            },
            { ty: 'tr', p: anim(0, 5) as never, o: { a: 0, k: 100 } },
          ],
        },
        { ty: 'rp', c: anim(1, 5), o: { a: 0, k: 0 }, tr: { r: anim(0, 90) } },
        { ty: 'rc', p: { a: 0, k: [0, 0] }, s: { a: 0, k: [1, 1] }, r: { a: 0, k: 0 } },
      ],
    }
    const model = layerModel(layer, ['layers', 0], en)
    expect(outline(model.children)).toEqual([
      'Transform',
      '  X position',
      'Contents',
      '  Blob',
      '    Ellipse',
      '      Size',
      '    Stroke',
      '      Stroke width',
      '      Dashes',
      '        Dash',
      '    Gradient fill',
      '      Colors',
      '    Transform',
      '      Position',
      '  Repeater',
      '    Copies',
      '    Transform',
      '      Rotation',
    ])
    const contents = model.children[1] as GroupNode
    const blob = contents.children[0] as GroupNode
    const colors = (blob.children[2] as GroupNode).children[0] as PropNode
    expect(colors.meta.value).toBe('gradient')
    expect(colors.stops).toBe(2)
    // A group's transform belongs to the group; items own their properties.
    expect(((blob.children[3] as GroupNode).children[0] as PropNode).owner).toEqual([
      'layers',
      0,
      'shapes',
      0,
    ])
    expect(((blob.children[0] as GroupNode).children[0] as PropNode).owner).toEqual([
      'layers',
      0,
      'shapes',
      0,
      'it',
      0,
    ])
    expect(
      model.children[0].kind === 'group' && (model.children[0].children[0] as PropNode).owner,
    ).toEqual(['layers', 0])
  })

  it('walks masks, effects, time remap and anything else', () => {
    const layer = {
      ty: 0,
      refId: 'x',
      ip: 0,
      op: 60,
      st: 0,
      ks: {},
      tm: anim(0, 1),
      masksProperties: [
        {
          nm: 'Hole',
          mode: 'a',
          pt: { a: 0, k: { i: [], o: [], v: [], c: true } },
          o: anim(0, 100),
          x: { a: 0, k: 0 },
        },
      ],
      ef: [
        {
          ty: 5,
          nm: 'Glow',
          ef: [
            { ty: 0, nm: 'Radius', v: anim(0, 30) },
            { ty: 2, nm: 'Tint', v: { a: 0, k: [1, 0, 0, 1] } },
          ],
        },
      ],
      sy: [{ ty: 1, c: anim(0, 1) }],
    } as unknown as Layer
    const model = layerModel(layer, ['layers', 0], en)
    expect(outline(model.children)).toEqual([
      'Masks',
      '  Hole',
      '    Mask opacity',
      'Time remap',
      'Effects',
      '  Glow',
      '    Radius',
      'Other',
      '  sy › 0 › c',
    ])
    expect(model.props).toHaveLength(4)
  })

  it('walks text: source text (only when it changes), animators and selectors', () => {
    const doc: TextLayer['t']['d'] = {
      k: [
        { s: { t: 'Hi', s: 20, f: 'Inter' }, t: 0 },
        { s: { t: 'Bye', s: 20, f: 'Inter' }, t: 30 },
      ],
    }
    const layer: TextLayer = {
      ty: 5,
      ip: 0,
      op: 60,
      st: 0,
      ks: {},
      t: {
        d: doc,
        a: [
          { nm: 'Fade', a: { o: anim(0, 100) }, s: { s: anim(0, 100), e: { a: 0, k: 100 } } },
        ] as unknown[],
      },
    }
    const model = layerModel(layer, ['layers', 0], en)
    expect(outline(model.children)).toEqual([
      'Text',
      '  Source text',
      '  Fade',
      '    Opacity',
      '    Range selector',
      '      Start',
    ])
    const source = (model.children[0] as GroupNode).children[0] as PropNode
    expect(source.textKeys).toBe(true)
    // A single text keyframe is just static text.
    const single = { ...layer, t: { d: { k: [doc.k[0]] } } }
    expect(layerModel(single, ['layers', 0], en).children).toEqual([])
  })
})

describe('summary keys', () => {
  it('merges keys of several properties by time', () => {
    const doc = bounceDoc()
    const ball = layerModel(doc.layers[0], ['layers', 0], en)
    const summary = summaryKeys(ball.props)
    expect(summary.map((s) => s.t)).toEqual([0, 22, 28, 34, 44, 60])
    expect(summary[2].refs).toEqual([
      { path: ['layers', 0, 'ks', 'p'], index: 1 },
      { path: ['layers', 0, 'ks', 's'], index: 2 },
    ])
    expect(summaryKeys(ball.props)).toBe(summary)
  })
})

describe('flattenRows', () => {
  it('lists root layers, and expanded groups below their layer', () => {
    const doc = bounceDoc()
    const collapsed = flattenRows(doc, en, {})
    expect(collapsed.rows.map((r) => r.key)).toEqual(['|root:i1', '|root:i2', '|root:i3'])
    expect(collapsed.height).toBe(3 * LAYER_ROW_H)
    expect(collapsed.rows.map((r) => r.expandable)).toEqual([true, true, false])

    const key = layerRowKey('', compId(null), 'i1')
    const ball = layerModel(doc.layers[0], ['layers', 0], en)
    const expanded = Object.fromEntries(
      [key, ...groupKeys(key, ball.children)].map((k) => [k, true]),
    )
    const rows = flattenRows(doc, en, expanded)
    expect(rows.rows.map((r) => `${r.kind}:${r.key}:${r.top}`)).toEqual([
      'layer:|root:i1:0',
      'group:|root:i1#ks:28',
      'property:|root:i1#ks/p:52',
      'property:|root:i1#ks/s:76',
      'layer:|root:i2:100',
      'layer:|root:i3:128',
    ])
    expect(rows.height).toBe(3 * LAYER_ROW_H + 3 * PROP_ROW_H)
    expect(rows.byKey.get('|root:i1#ks/p')?.depth).toBe(2)
  })

  it('keys rows by layer ind so expansion survives reordering', () => {
    expect(layerIds([{ ind: 3 }, { ind: 3 }, {}, { ind: 9 }] as Layer[])).toEqual([
      'n0',
      'n1',
      'n2',
      'i9',
    ])
    expect(compId('a#b|c')).toBe('ca%23b%7Cc')
    const doc = bounceDoc()
    const expanded = { '|root:i2': true }
    const before = flattenRows(doc, en, expanded)
    expect(before.rows.filter((r) => r.expanded).map((r) => r.model.name)).toEqual(['Shadow'])
    // Delete the first layer: Shadow moves to index 0 and stays expanded.
    const after = flattenRows({ ...doc, layers: doc.layers.slice(1) }, en, expanded)
    expect(after.rows.filter((r) => r.expanded).map((r) => r.model.name)).toEqual(['Shadow'])
  })

  it('reuses unchanged rows across flattens', () => {
    const doc = bounceDoc()
    const first = flattenRows(doc, en, {})
    const next = {
      ...doc,
      layers: [doc.layers[0], { ...doc.layers[1], nm: 'Shade' }, doc.layers[2]],
    }
    const second = flattenRows(next, en, {}, first)
    expect(second.rows[0]).toBe(first.rows[0])
    expect(second.rows[1]).not.toBe(first.rows[1])
    expect(second.rows[2]).toBe(first.rows[2])
  })

  it('expands precomp instances through their time map and window', () => {
    const doc = JSON.parse(testJson) as Animation
    const key = layerRowKey('', compId(null), 'i7')
    const rows = flattenRows(doc, en, { [key]: true })
    const child = rows.rows[7]
    expect(child.key).toBe('>root:i7|ccomp_0:i1')
    expect(child.depth).toBe(1)
    expect(child.comp).toBe(0)
    // Instance: st 75, visible 77–97 in root time.
    expect(child.map!.toRoot(0)).toBe(75)
    expect(child.window).toEqual([77, 97])
    expect(rowKeyTimes(child).every((t) => t >= 75)).toBe(true)
    // The precomp layers showing the row (the working-instance chain of canvas/tree/timeline).
    expect(child.chain).toEqual([['layers', 6]])
    expect(child.chainKey).toBe('layers/6')
    expect(rows.rows[0].chain).toEqual([])
    expect(rows.rows[0].chainKey).toBe('')
  })

  it('does not reuse precomp content rows whose instance moved', () => {
    const doc = JSON.parse(testJson) as Animation
    const expanded = { [layerRowKey('', compId(null), 'i13')]: true }
    const first = flattenRows(doc, en, expanded)
    const before = first.rows.find((r) => r.key === '>root:i13|ccomp_0:i1')!
    expect(before.chainKey).toBe('layers/12')
    // Move the instance one step up: same content layer object and row key, new chain.
    const layers = [...doc.layers]
    ;[layers[11], layers[12]] = [layers[12], layers[11]]
    const second = flattenRows({ ...doc, layers }, en, expanded, first)
    const after = second.rows.find((r) => r.key === '>root:i13|ccomp_0:i1')!
    expect(after).not.toBe(before)
    expect(after.chainKey).toBe('layers/11')
  })

  it('skips self-referencing precomps and empty compositions', () => {
    const doc = createAnimation()
    doc.assets = [{ id: 'loop', layers: [{ ty: 0, refId: 'loop', ip: 0, op: 10, st: 0, ks: {} }] }]
    doc.layers = [{ ty: 0, refId: 'loop', ip: 0, op: 10, st: 0, ks: {} }]
    const rows = flattenRows(doc, en, { '|root:n0': true, '>root:n0|cloop:n0': true })
    expect(rows.rows.map((r) => r.key)).toEqual(['|root:n0', '>root:n0|cloop:n0'])
    expect(rows.rows[1].expandable).toBe(false)
  })
})

describe('rowKeyTimes', () => {
  it('returns root times of keys (property rows) or summaries (collapsed rows)', () => {
    const doc = bounceDoc()
    const rows = flattenRows(doc, en, {})
    expect(rowKeyTimes(rows.rows[1])).toEqual([0, 28, 60])
    expect(rowKeyTimes(rows.rows[2])).toEqual([])
  })
})
