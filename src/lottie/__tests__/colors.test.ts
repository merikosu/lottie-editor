import { enablePatches, freeze, produce, produceWithPatches } from 'immer'
import { describe, expect, it } from 'vitest'
import {
  adjustColor,
  adjustColors,
  colorDistance,
  deltaE2000,
  documentPalette,
  encodeChannel,
  extractColorUsages,
  extractGradients,
  gradientToCss,
  groupColors,
  groupGradients,
  isInScope,
  isScanCached,
  isUsageModified,
  opacityAt,
  parseHexColor,
  readUsageColor,
  replaceColor,
  restoreColors,
  revertUsages,
  rgbToLab,
  scanColors,
  selectionScope,
  usagesOfColor,
  usesLegacyColorScale,
  type ColorUsage,
} from '../colors'
import { getAt } from '../path'
import type { Animation } from '../types'
// ?raw keeps the 145 KB fixture out of type inference.
import testJson from '../../../docs/test.json?raw'

enablePatches()

/* -------------------------------------------------------------------------- */
/*                                  Fixtures                                  */
/* -------------------------------------------------------------------------- */

type Json = Record<string, unknown>

const tr = () => ({
  ty: 'tr',
  p: { a: 0, k: [0, 0] },
  a: { a: 0, k: [0, 0] },
  s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 },
  o: { a: 0, k: 100 },
})
const fill = (k: unknown, nm = 'Fill'): Json => ({
  ty: 'fl',
  nm,
  c: { a: 0, k },
  o: { a: 0, k: 100 },
  r: 1,
})
const stroke = (k: unknown, nm = 'Stroke'): Json => ({
  ty: 'st',
  nm,
  c: { a: 0, k },
  o: { a: 0, k: 100 },
  w: { a: 0, k: 2 },
})
const group = (items: Json[], nm = 'Group'): Json => ({ ty: 'gr', nm, it: [...items, tr()] })
const gradient = (ty: 'gf' | 'gs', p: number, k: unknown, nm = 'Gradient'): Json => ({
  ty,
  nm,
  g: { p, k: { a: 0, k } },
  s: { a: 0, k: [0, 0] },
  e: { a: 0, k: [100, 0] },
  t: 1,
  o: { a: 0, k: 100 },
})
const shapeLayer = (shapes: Json[], nm = 'Shape', ind = 1): Json => ({
  ty: 4,
  nm,
  ind,
  ip: 0,
  op: 60,
  st: 0,
  ks: {},
  shapes,
})

function makeDoc(layers: Json[], extra: Json = {}): Animation {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    assets: [],
    layers,
    ...extra,
  } as unknown as Animation
}

const rgba = (r: number, g: number, b: number, a = 1) => ({ r: r / 255, g: g / 255, b: b / 255, a })
const at = (doc: unknown, path: readonly (string | number)[]) => getAt<unknown>(doc, path)
const hexes = (usages: ColorUsage[]) => usages.map((u) => u.hex)

/* -------------------------------------------------------------------------- */
/*                                 Primitives                                 */
/* -------------------------------------------------------------------------- */

describe('encodeChannel', () => {
  it('renders every 8-bit value exactly with floor (lottie-web) and round players', () => {
    for (let n = 0; n <= 255; n++) {
      const v = encodeChannel(n)
      expect(Math.floor(v * 255)).toBe(n)
      expect(Math.round(v * 255)).toBe(n)
      expect(String(v).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3)
    }
  })
  it('keeps clean ends and legacy integers', () => {
    expect(encodeChannel(0)).toBe(0)
    expect(encodeChannel(255)).toBe(1)
    expect(encodeChannel(107)).toBe(0.42)
    expect(encodeChannel(107, 255)).toBe(107)
    expect(encodeChannel(300, 255)).toBe(255)
  })
})

describe('usesLegacyColorScale', () => {
  it('mirrors lottie-web checkVersion for 4.1.9', () => {
    expect(usesLegacyColorScale({ v: '4.1.8' })).toBe(true)
    expect(usesLegacyColorScale({ v: '4.0.0' })).toBe(true)
    expect(usesLegacyColorScale({ v: '3.9.9' })).toBe(true)
    expect(usesLegacyColorScale({ v: '4.1.9' })).toBe(false)
    expect(usesLegacyColorScale({ v: '4.10.0' })).toBe(false)
    expect(usesLegacyColorScale({ v: '5.5.2' })).toBe(false)
  })
  it('treats missing or partial versions as modern', () => {
    expect(usesLegacyColorScale({})).toBe(false)
    expect(usesLegacyColorScale({ v: '' })).toBe(false)
    expect(usesLegacyColorScale({ v: '4.1' })).toBe(false)
    expect(usesLegacyColorScale({ v: 'beta' })).toBe(false)
  })
})

describe('parseHexColor', () => {
  it('parses short, long and alpha forms', () => {
    expect(parseHexColor('#F00')?.rgb8).toEqual([255, 0, 0])
    expect(parseHexColor('00ff00')?.rgb8).toEqual([0, 255, 0])
    expect(parseHexColor('#0000ff80')).toMatchObject({ rgb8: [0, 0, 255], alphaHex: '80' })
    expect(parseHexColor('#0000ff80')!.alpha).toBeCloseTo(128 / 255)
    expect(parseHexColor('red')).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/*                                 Extraction                                 */
/* -------------------------------------------------------------------------- */

describe('extractColorUsages: shapes', () => {
  it('finds fills and strokes at any group depth with their paths', () => {
    const doc = makeDoc([
      shapeLayer(
        [fill([1, 0, 0, 1]), group([group([stroke([0, 0, 1, 1])], 'Inner')], 'Outer')],
        'Ball',
      ),
    ])
    const usages = extractColorUsages(doc)
    expect(usages.map((u) => [u.kind, u.hex])).toEqual([
      ['fill', '#ff0000'],
      ['stroke', '#0000ff'],
    ])
    const s = usages[1]
    expect(s.path).toEqual(['layers', 0, 'shapes', 1, 'it', 0, 'it', 0, 'c'])
    expect(s.nodePath).toEqual(['layers', 0, 'shapes', 1, 'it', 0, 'it', 0])
    expect(s.layerPath).toEqual(['layers', 0])
    expect(s.animated).toBe(false)
    expect(s.alpha).toBe(1)
  })

  it('rounds to 8-bit for grouping and reports fill alpha as rendered (opaque)', () => {
    const doc = makeDoc([shapeLayer([fill([0.4196, 0.2902, 0.99607, 0.2])])])
    const [u] = extractColorUsages(doc)
    expect(u.hex).toBe('#6b4afe')
    expect(u.alpha).toBe(1)
    expect(u.color.r).toBeCloseTo(0.4196, 6)
  })

  it('finds every keyframe of an animated color', () => {
    const doc = makeDoc([
      shapeLayer([
        {
          ty: 'fl',
          c: {
            a: 1,
            k: [
              { t: 0, s: [1, 0, 0, 1], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
              { t: 10, s: [0, 1, 0, 1], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
              { t: 20, s: [1, 0, 0, 1] },
            ],
          },
          o: { a: 0, k: 100 },
        },
      ]),
    ])
    const usages = extractColorUsages(doc)
    expect(hexes(usages)).toEqual(['#ff0000', '#00ff00', '#ff0000'])
    expect(usages.map((u) => u.keyframeIndex)).toEqual([0, 1, 2])
    expect(usages.every((u) => u.animated)).toBe(true)
    // Keyframe detection is structural: a stale `a: 0` flag does not hide keyframes.
    const stale = makeDoc([
      shapeLayer([
        {
          ty: 'st',
          c: {
            a: 0,
            k: [
              { t: 0, s: [0, 0, 0] },
              { t: 5, s: [1, 1, 1] },
            ],
          },
        },
      ]),
    ])
    expect(extractColorUsages(stale)).toHaveLength(2)
  })

  it('links legacy end values to the keyframe that repeats them', () => {
    const doc = makeDoc([
      shapeLayer([
        {
          ty: 'fl',
          c: {
            a: 1,
            k: [
              { t: 0, s: [1, 0, 0, 1], e: [0, 1, 0, 1] },
              { t: 10, s: [0, 1, 0, 1], e: [0, 0, 1, 1] },
              { t: 20 },
            ],
          },
        },
      ]),
    ])
    const usages = extractColorUsages(doc)
    expect(usages.map((u) => [u.hex, u.keyframeIndex, !!u.end])).toEqual([
      ['#ff0000', 0, false],
      ['#00ff00', 1, false],
      ['#0000ff', 1, true],
    ])
    expect(usages[1].refs.map((r) => r.path.join('/'))).toEqual([
      'layers/0/shapes/0/c/k/1/s',
      'layers/0/shapes/0/c/k/0/e',
    ])
  })

  it('reads legacy 0–255 fill/stroke colors only in files older than 4.1.9', () => {
    const layers = [shapeLayer([fill([255, 0, 128, 255]), gradient('gf', 1, [0, 1, 0.5, 0])])]
    const legacy = extractColorUsages(makeDoc(layers, { v: '4.1.8' }))
    expect(legacy.map((u) => [u.kind, u.hex])).toEqual([
      ['fill', '#ff0080'],
      ['gradient', '#ff8000'], // gradients are never scaled
    ])
    expect(legacy[0].refs[0]).toMatchObject({ scale: 255 })
    // The same numbers in a modern file are clamped per channel, as lottie-web renders them.
    expect(extractColorUsages(makeDoc(layers, { v: '5.0.0' }))[0].hex).toBe('#ff00ff')
  })

  it('survives malformed shapes and layers', () => {
    const doc = makeDoc([
      null as unknown as Json,
      shapeLayer([
        null as unknown as Json,
        { ty: 'fl' },
        { ty: 'fl', c: { k: 'red' } },
        { ty: 'gr', it: null },
        fill([0, 0, 0]),
      ]),
      { ty: 4, shapes: 'nope' },
    ])
    expect(hexes(extractColorUsages(doc))).toEqual(['#000000'])
    expect(extractColorUsages({ ...makeDoc([]), assets: [null] } as unknown as Animation)).toEqual(
      [],
    )
  })
})

describe('extractColorUsages: gradients', () => {
  const k = [0, 1, 0, 0, 0.5, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0.5, 0.5, 1, 0]

  it('finds every color stop with its position and effective opacity', () => {
    const doc = makeDoc([shapeLayer([gradient('gf', 3, k)])])
    const usages = extractColorUsages(doc)
    expect(usages.map((u) => [u.hex, u.stopIndex, u.stopOffset, u.alpha, u.alphaEditable])).toEqual(
      [
        ['#ff0000', 0, 0, 1, true],
        ['#00ff00', 1, 0.5, 0.5, true],
        ['#0000ff', 2, 1, 0, true],
      ],
    )
    expect(usages[1].refs[0]).toMatchObject({ offset: 5, alphaIndex: 15, rawAlpha: 0.5 })
    expect(usages.every((u) => u.kind === 'gradient')).toBe(true)

    const [g] = extractGradients(doc)
    expect(g).toMatchObject({
      kind: 'fill',
      type: 'linear',
      path: ['layers', 0, 'shapes', 0, 'g'],
      animated: false,
    })
    expect(g.stops).toEqual(usages)
    expect(g.opacity).toEqual([
      { offset: 0, alpha: 1 },
      { offset: 0.5, alpha: 0.5 },
      { offset: 1, alpha: 0 },
    ])
  })

  it('interpolates opacity between stops that do not line up', () => {
    const doc = makeDoc([shapeLayer([gradient('gs', 2, [0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0.5, 1])])])
    const usages = extractColorUsages(doc)
    expect(usages.map((u) => [u.alpha, u.alphaEditable])).toEqual([
      [0, true],
      [1, false],
    ])
    expect(extractGradients(doc)[0].kind).toBe('stroke')
    expect(
      opacityAt(
        [
          { offset: 0, alpha: 0 },
          { offset: 0.5, alpha: 1 },
        ],
        0.25,
      ),
    ).toBeCloseTo(0.5)
  })

  it('treats gradients without opacity stops as opaque', () => {
    const doc = makeDoc([shapeLayer([gradient('gf', 2, [0, 1, 1, 1, 1, 0, 0, 0])])])
    expect(extractColorUsages(doc).map((u) => [u.alpha, u.alphaEditable])).toEqual([
      [1, false],
      [1, false],
    ])
  })

  it('finds keyframed gradients (one gradient per keyframe)', () => {
    const doc = makeDoc([
      shapeLayer([
        {
          ty: 'gf',
          t: 2,
          g: {
            p: 2,
            k: {
              a: 1,
              k: [
                { t: 0, s: [0, 1, 0, 0, 1, 0, 0, 1], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
                { t: 30, s: [0, 0, 1, 0, 1, 1, 1, 1] },
              ],
            },
          },
        },
      ]),
    ])
    const gradients = extractGradients(doc)
    expect(gradients.map((g) => [g.keyframeIndex, g.animated, g.type])).toEqual([
      [0, true, 'radial'],
      [1, true, 'radial'],
    ])
    expect(hexes(extractColorUsages(doc))).toEqual(['#ff0000', '#0000ff', '#00ff00', '#ffffff'])
  })

  it('ignores malformed gradients', () => {
    const doc = makeDoc([
      shapeLayer([
        { ty: 'gf', g: { k: { a: 0, k: [0, 1, 0, 0] } } },
        { ty: 'gf', g: { p: 3, k: { a: 0, k: [0, 1, 0, 0] } } },
        { ty: 'gf', g: { p: 1.5, k: { a: 0, k: [0, 1, 0, 0] } } },
        { ty: 'gs' },
      ]),
    ])
    expect(extractColorUsages(doc)).toEqual([])
    expect(extractGradients(doc)).toEqual([])
  })
})

describe('extractColorUsages: other sources', () => {
  it('reads solid layer hex colors', () => {
    const doc = makeDoc([
      { ty: 1, nm: 'Bg', sc: '#FF0000', sw: 10, sh: 10, ip: 0, op: 60, st: 0, ks: {} },
      { ty: 1, sc: '#0f08', sw: 10, sh: 10, ip: 0, op: 60, st: 0, ks: {} },
      { ty: 1, sc: 'tomato', sw: 10, sh: 10, ip: 0, op: 60, st: 0, ks: {} },
    ])
    const usages = extractColorUsages(doc)
    expect(usages.map((u) => [u.kind, u.hex, u.path.join('/')])).toEqual([
      ['solid', '#ff0000', 'layers/0/sc'],
      ['solid', '#00ff00', 'layers/1/sc'],
    ])
    expect(usages[1].alpha).toBeCloseTo(0x88 / 255)
  })

  it('reads text documents and text animators', () => {
    const textLayer = {
      ty: 5,
      nm: 'Title',
      ip: 0,
      op: 60,
      st: 0,
      ks: {},
      t: {
        d: {
          k: [
            { t: 0, s: { t: 'Hi', s: 20, f: 'Inter', fc: [1, 0, 0], sc: [0, 0, 1], sw: 2 } },
            { t: 30, s: { t: 'Hi', s: 20, f: 'Inter', fc: [0, 1, 0], sc: [0, 0, 1], sw: 0 } },
          ],
        },
        a: [
          {
            nm: 'Animator',
            s: {},
            a: { fc: { a: 0, k: [1, 1, 0, 1] }, sc: { a: 0, k: [0, 1, 1, 1] } },
          },
        ],
      },
    }
    const usages = extractColorUsages(makeDoc([textLayer]))
    expect(usages.map((u) => [u.kind, u.hex, u.keyframeIndex])).toEqual([
      ['text-fill', '#ff0000', 0],
      ['text-stroke', '#0000ff', 0],
      ['text-fill', '#00ff00', 1],
      // the second document has no stroke width: its stroke color is never drawn
      ['text-fill', '#ffff00', undefined],
      ['text-stroke', '#00ffff', undefined],
    ])
    expect(usages[0].animated).toBe(true)
    expect(usages[0].refs[0].path.join('/')).toBe('layers/0/t/d/k/0/s/fc')
    expect(new Set(usages.map((u) => u.id)).size).toBe(usages.length)
  })

  it('reads effect color controls (also in nested groups) and layer styles', () => {
    const layer = {
      ...shapeLayer([]),
      ef: [
        {
          ty: 21,
          nm: 'Fill',
          ef: [
            { ty: 10, nm: 'Layer', v: { a: 0, k: 0 } },
            { ty: 2, nm: 'Color', v: { a: 0, k: [1, 0.5, 0, 1] } },
            { ty: 5, nm: 'Group', ef: [{ ty: 2, nm: 'Nested', v: { a: 0, k: [0, 0, 0, 1] } }] },
            { ty: 0, nm: 'Opacity', v: { a: 0, k: 1 } },
          ],
        },
      ],
      sy: [
        { ty: 1, nm: 'Drop shadow', c: { a: 0, k: [0, 0, 0, 1] }, s: { a: 0, k: 5 } },
        { ty: 5, nm: 'Bevel', hc: { a: 0, k: [1, 1, 1, 1] }, sc: { a: 0, k: [0.2, 0.2, 0.2, 1] } },
      ],
    }
    const usages = extractColorUsages(makeDoc([layer]))
    expect(usages.map((u) => [u.kind, u.hex, u.path.join('/')])).toEqual([
      ['effect', '#ff8000', 'layers/0/ef/0/ef/1/v'],
      ['effect', '#000000', 'layers/0/ef/0/ef/2/ef/0/v'],
      ['style', '#000000', 'layers/0/sy/0/c'],
      ['style', '#ffffff', 'layers/0/sy/1/hc'],
      ['style', '#333333', 'layers/0/sy/1/sc'],
    ])
  })

  it('scans precomp assets', () => {
    const doc = makeDoc([{ ty: 0, refId: 'comp_0', ip: 0, op: 60, st: 0, ks: {} }], {
      assets: [{ id: 'comp_0', layers: [shapeLayer([group([fill([0, 0, 1])])])] }],
    })
    const [u] = extractColorUsages(doc)
    expect(u.path).toEqual(['assets', 0, 'layers', 0, 'shapes', 0, 'it', 0, 'c'])
    expect(u.layerPath).toEqual(['assets', 0, 'layers', 0])
  })

  it('reads slotted properties from their slot and writes both copies', () => {
    const doc = makeDoc(
      [shapeLayer([{ ty: 'fl', c: { a: 0, k: [0, 0, 0, 1], sid: 'brand' }, o: { a: 0, k: 100 } }])],
      {
        slots: { brand: { p: { a: 0, k: [1, 0, 0, 1] } } },
      },
    )
    const [u] = extractColorUsages(doc)
    expect(u.hex).toBe('#ff0000')
    expect(u.refs.map((r) => r.path.join('/'))).toEqual([
      'slots/brand/p/k',
      'layers/0/shapes/0/c/k',
    ])
    const next = produce(doc, (d) => {
      replaceColor(d, [u], rgba(0, 0, 255))
    })
    expect(at(next, ['slots', 'brand', 'p', 'k'])).toEqual([0, 0, 1, 1])
    expect(at(next, ['layers', 0, 'shapes', 0, 'c', 'k'])).toEqual([0, 0, 1, 1])
  })

  it('gives every usage a unique id', () => {
    const doc = JSON.parse(testJson) as Animation
    const usages = extractColorUsages(doc)
    expect(new Set(usages.map((u) => u.id)).size).toBe(usages.length)
  })
})

/* -------------------------------------------------------------------------- */
/*                              Real-world file                               */
/* -------------------------------------------------------------------------- */

describe('docs/test.json', () => {
  const doc = JSON.parse(testJson) as Animation

  it('finds all 68 fills, 43 strokes and 19 gradients', () => {
    const usages = extractColorUsages(doc)
    const count = (kind: string) => usages.filter((u) => u.kind === kind).length
    expect(count('fill')).toBe(68)
    expect(count('stroke')).toBe(43)
    const gradients = extractGradients(doc)
    expect(gradients).toHaveLength(19)
    expect(gradients.filter((g) => g.kind === 'fill')).toHaveLength(12)
    expect(gradients.filter((g) => g.kind === 'stroke')).toHaveLength(7)
    expect(count('gradient')).toBe(gradients.reduce((n, g) => n + g.stops.length, 0))
  })

  it('groups into 41 colors and 11 distinct gradients', () => {
    expect(groupColors(extractColorUsages(doc))).toHaveLength(41)
    const gradients = groupGradients(extractGradients(doc))
    expect(gradients).toHaveLength(11)
    expect(gradients[0].count).toBe(7)
  })

  it('recolors every usage of a color in one pass', () => {
    const frozen = freeze(structuredClone(doc), true)
    const before = usagesOfColor(extractColorUsages(frozen), '#0d6800')
    expect(before.length).toBe(21)
    const [next, patches] = produceWithPatches(frozen, (d) => {
      expect(replaceColor(d, '#0d6800', rgba(0x12, 0x34, 0x56))).toBe(21)
    })
    expect(patches.length).toBeGreaterThan(0)
    expect(usagesOfColor(extractColorUsages(next), '#0d6800')).toHaveLength(0)
    expect(usagesOfColor(extractColorUsages(next), '#123456')).toHaveLength(21)
  })
})

/* -------------------------------------------------------------------------- */
/*                                  Grouping                                  */
/* -------------------------------------------------------------------------- */

describe('groupColors', () => {
  const doc = makeDoc([
    shapeLayer([fill([1, 0, 0]), stroke([1, 0, 0]), fill([0, 0, 1])], 'A'),
    shapeLayer(
      [
        fill([0, 0, 1]),
        {
          ty: 'fl',
          c: {
            a: 1,
            k: [
              { t: 0, s: [0, 0, 1] },
              { t: 9, s: [0.5, 0.5, 0.5] },
            ],
          },
        },
        fill([0, 1, 0]),
      ],
      'B',
      2,
    ),
  ])

  it('groups by color with counts, kinds and layers', () => {
    const groups = groupColors(extractColorUsages(doc))
    expect(groups.map((g) => [g.hex, g.count])).toEqual([
      ['#0000ff', 3],
      ['#ff0000', 2],
      ['#808080', 1],
      ['#00ff00', 1],
    ])
    const blue = groups[0]
    expect(blue.kinds).toEqual(['fill'])
    expect(blue.animatedCount).toBe(1)
    expect(blue.layerCount).toBe(2)
    expect(blue.members).toEqual(['#0000ff'])
    expect(groups[1].kinds).toEqual(['fill', 'stroke'])
  })

  it('sorts by hue with neutrals last', () => {
    const groups = groupColors(extractColorUsages(doc), { sortBy: 'hue' })
    expect(groups.map((g) => g.hex)).toEqual(['#ff0000', '#00ff00', '#0000ff', '#808080'])
  })

  it('merges similar colors into the most used one', () => {
    const near = makeDoc([
      shapeLayer([
        fill([1, 0, 0]),
        fill([1, 0, 0]),
        fill([0.99607, 0, 0]),
        fill([0.9, 0.1, 0.1]),
        fill([0, 1, 0]),
      ]),
    ])
    const usages = extractColorUsages(near)
    expect(groupColors(usages)).toHaveLength(4)
    const merged = groupColors(usages, { mergeSimilar: 2 })
    expect(merged.map((g) => [g.hex, g.count, g.members])).toEqual([
      ['#ff0000', 3, ['#ff0000', '#fe0000']],
      ['#e61a1a', 1, ['#e61a1a']],
      ['#00ff00', 1, ['#00ff00']],
    ])
    // Usages stay in document order inside a merged group.
    expect(merged[0].usages.map((u) => u.path[3])).toEqual([0, 1, 2])
    expect(groupColors(usages, { mergeSimilar: 12 })[0].count).toBe(4)
  })

  it('samples the representative color even when a similar color comes first', () => {
    const near = makeDoc([shapeLayer([fill([0.99607, 0, 0]), fill([1, 0, 0]), fill([1, 0, 0])])])
    const [merged] = groupColors(extractColorUsages(near), { mergeSimilar: 2 })
    expect(merged.usages[0].hex).toBe('#fe0000')
    expect(merged.hex).toBe('#ff0000')
    expect(merged.sample.hex).toBe('#ff0000')
    expect(merged.sample).toBe(merged.usages[1])
    // Without merging every group samples its own first usage.
    for (const g of groupColors(extractColorUsages(near))) expect(g.sample).toBe(g.usages[0])
  })

  it('reports a shared alpha', () => {
    const doc2 = makeDoc([
      shapeLayer([gradient('gf', 2, [0, 1, 1, 1, 1, 1, 1, 1, 0, 0.5, 1, 0.5])]),
    ])
    const [white] = groupColors(extractColorUsages(doc2))
    expect(white.alpha).toBe(0.5)
    expect(white.color.a).toBe(0.5)
  })

  it('groups identical gradients', () => {
    const k = [0, 1, 0, 0, 1, 0, 0, 1]
    const doc2 = makeDoc([
      shapeLayer([
        gradient('gf', 2, k),
        gradient('gs', 2, k),
        gradient('gf', 2, [0, 1, 0, 0, 1, 0, 1, 0]),
      ]),
    ])
    const groups = groupGradients(extractGradients(doc2))
    expect(groups.map((g) => [g.count, g.kinds])).toEqual([
      [2, ['fill', 'stroke']],
      [1, ['fill']],
    ])
  })
})

/* -------------------------------------------------------------------------- */
/*                                  Replacing                                 */
/* -------------------------------------------------------------------------- */

describe('replaceColor', () => {
  it('writes floor-exact values, keeping arity and the alpha channel', () => {
    const doc = makeDoc([shapeLayer([fill([1, 0, 0, 0.5]), stroke([1, 0, 0])])])
    const next = produce(doc, (d) => {
      expect(replaceColor(d, '#ff0000', rgba(107, 74, 128, 0.2))).toBe(2)
    })
    expect(at(next, ['layers', 0, 'shapes', 0, 'c', 'k'])).toEqual([0.42, 0.291, 0.502, 0.5])
    expect(at(next, ['layers', 0, 'shapes', 1, 'c', 'k'])).toEqual([0.42, 0.291, 0.502])
    expect(hexes(extractColorUsages(next))).toEqual(['#6b4a80', '#6b4a80'])
  })

  it('keeps unchanged channels exactly', () => {
    const doc = makeDoc([shapeLayer([fill([0.4196, 0.2902, 0.5, 1])])])
    const next = produce(doc, (d) => {
      replaceColor(d, extractColorUsages(d), rgba(107, 74, 0))
    })
    expect(at(next, ['layers', 0, 'shapes', 0, 'c', 'k'])).toEqual([0.4196, 0.2902, 0, 1])
  })

  it('is a no-op when replacing a color with itself', () => {
    const doc = freeze(
      makeDoc([
        shapeLayer([fill([0.4196, 0.2902, 0.99607, 1]), gradient('gf', 1, [0, 0.1, 0.2, 0.3])]),
      ]),
      true,
    )
    const usages = extractColorUsages(doc)
    const [next, patches] = produceWithPatches(doc, (d) => {
      for (const u of usages) expect(replaceColor(d, [u], u.color)).toBe(0)
    })
    expect(patches).toEqual([])
    expect(next).toBe(doc)
  })

  it('restores the original numbers when a color goes back to its start value', () => {
    const doc = makeDoc([shapeLayer([fill([0.4196, 0.2902, 0.99607, 1])])])
    const usages = extractColorUsages(doc)
    const original = structuredClone(doc)
    let d = produce(doc, (draft) => void replaceColor(draft, usages, rgba(10, 20, 30)))
    expect(d).not.toEqual(original)
    d = produce(d, (draft) => void replaceColor(draft, usages, rgba(40, 50, 60)))
    d = produce(d, (draft) => void replaceColor(draft, usages, usages[0].color))
    expect(d).toEqual(original)
  })

  it('keeps legacy files in 0–255 and writes integers', () => {
    const doc = makeDoc([shapeLayer([fill([255, 0, 0, 255])])], { v: '4.0.0' })
    const next = produce(doc, (d) => void replaceColor(d, '#ff0000', rgba(1, 2, 3)))
    expect(at(next, ['layers', 0, 'shapes', 0, 'c', 'k'])).toEqual([1, 2, 3, 255])
  })

  it('writes solids as lowercase hex and keeps their alpha digits', () => {
    const doc = makeDoc([
      { ty: 1, sc: '#FF0000', sw: 1, sh: 1, ip: 0, op: 1, st: 0, ks: {} },
      { ty: 1, sc: '#ff000080', sw: 1, sh: 1, ip: 0, op: 1, st: 0, ks: {} },
    ])
    const next = produce(doc, (d) => void replaceColor(d, '#f00', rgba(0, 0x80, 0xff)))
    expect(at(next, ['layers', 0, 'sc'])).toBe('#0080ff')
    expect(at(next, ['layers', 1, 'sc'])).toBe('#0080ff80')
    // back to the start value: the original spelling comes back
    const usages = extractColorUsages(doc)
    const back = produce(next, (d) => void replaceColor(d, usages, rgba(255, 0, 0)))
    expect(at(back, ['layers', 0, 'sc'])).toBe('#FF0000')
  })

  it('replaces gradient stops without touching positions or opacity (unless asked)', () => {
    const k = [0, 1, 0, 0, 0.5, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0.5, 0.5, 1, 0]
    const doc = makeDoc([shapeLayer([gradient('gf', 3, k)])])
    const green = usagesOfColor(extractColorUsages(doc), '#00ff00')
    const next = produce(doc, (d) => void replaceColor(d, green, rgba(255, 255, 255, 0.2)))
    expect(at(next, ['layers', 0, 'shapes', 0, 'g', 'k', 'k'])).toEqual([
      0, 1, 0, 0, 0.5, 1, 1, 1, 1, 0, 0, 1, 0, 1, 0.5, 0.5, 1, 0,
    ])
    const withAlpha = produce(
      doc,
      (d) => void replaceColor(d, green, rgba(255, 255, 255, 0.2), { alpha: true }),
    )
    expect(at(withAlpha, ['layers', 0, 'shapes', 0, 'g', 'k', 'k'])).toEqual([
      0, 1, 0, 0, 0.5, 1, 1, 1, 1, 0, 0, 1, 0, 1, 0.5, 0.2, 1, 0,
    ])
  })

  it('replaces keyframes and the legacy end values that repeat them', () => {
    const doc = makeDoc([
      shapeLayer([
        {
          ty: 'fl',
          c: {
            a: 1,
            k: [
              { t: 0, s: [1, 0, 0, 1], e: [0, 1, 0, 1] },
              { t: 10, s: [0, 1, 0, 1], e: [1, 0, 0, 1] },
              { t: 20 },
            ],
          },
        },
      ]),
    ])
    const next = produce(doc, (d) => void replaceColor(d, '#00ff00', rgba(0, 0, 255)))
    expect(at(next, ['layers', 0, 'shapes', 0, 'c', 'k'])).toMatchObject([
      { s: [1, 0, 0, 1], e: [0, 0, 1, 1] },
      { s: [0, 0, 1, 1], e: [1, 0, 0, 1] },
      { t: 20 },
    ])
  })

  it('only touches the given usages', () => {
    const doc = makeDoc([shapeLayer([fill([1, 0, 0]), fill([1, 0, 0])])])
    const [first] = extractColorUsages(doc)
    const next = produce(doc, (d) => void replaceColor(d, [first], rgba(0, 0, 0)))
    expect(hexes(extractColorUsages(next))).toEqual(['#000000', '#ff0000'])
  })

  it('reads the live color of a usage after edits', () => {
    const doc = makeDoc([
      shapeLayer([fill([1, 0, 0]), gradient('gf', 1, [0, 0, 0, 1, 0, 0.5])]),
      { ty: 1, sc: '#00ff00', sw: 1, sh: 1, ip: 0, op: 1, st: 0, ks: {} },
    ])
    const usages = extractColorUsages(doc)
    const next = produce(
      doc,
      (d) => void replaceColor(d, usages, rgba(0, 0, 0, 0.25), { alpha: true }),
    )
    expect(usages.map((u) => readUsageColor(next, u))).toEqual([
      { r: 0, g: 0, b: 0, a: 1 },
      { r: 0, g: 0, b: 0, a: 0.25 },
      { r: 0, g: 0, b: 0, a: 1 },
    ])
    expect(readUsageColor(makeDoc([]), usages[0])).toBeNull()
  })

  it('skips refs that no longer resolve', () => {
    const doc = makeDoc([shapeLayer([fill([1, 0, 0])])])
    const usages = extractColorUsages(doc)
    const empty = makeDoc([])
    expect(replaceColor(empty, usages, rgba(0, 0, 0))).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/*                                 Adjustments                                */
/* -------------------------------------------------------------------------- */

const hex = (c: { r: number; g: number; b: number }) =>
  '#' +
  [c.r, c.g, c.b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')

describe('adjustColor', () => {
  const red = rgba(255, 0, 0)

  it('rotates hue, scales saturation and moves lightness', () => {
    expect(hex(adjustColor(red, { hue: 120 }))).toBe('#00ff00')
    expect(hex(adjustColor(red, { hue: -120 }))).toBe('#0000ff')
    expect(hex(adjustColor(red, { saturation: -100 }))).toBe('#808080')
    expect(hex(adjustColor(rgba(191, 64, 64), { saturation: 100 }))).toBe('#ff0000')
    expect(hex(adjustColor(red, { lightness: 100 }))).toBe('#ffffff')
    expect(hex(adjustColor(red, { lightness: -100 }))).toBe('#000000')
    expect(hex(adjustColor(red, { lightness: 50 }))).toBe('#ff8080')
  })

  it('keeps grays gray when saturating or rotating', () => {
    const gray = rgba(100, 100, 100)
    expect(hex(adjustColor(gray, { saturation: 100, hue: 90 }))).toBe('#646464')
  })

  it('inverts, converts to grayscale (keeping luminance) and tints', () => {
    expect(hex(adjustColor(rgba(255, 128, 0), { invert: true }))).toBe('#007fff')
    expect(hex(adjustColor(rgba(0, 255, 0), { grayscale: true }))).toBe('#dcdcdc')
    expect(hex(adjustColor(rgba(90, 90, 90), { grayscale: true }))).toBe('#5a5a5a')
    expect(
      hex(adjustColor(rgba(0, 0, 0), { tint: { color: rgba(255, 255, 255), amount: 0.5 } })),
    ).toBe('#808080')
  })

  it('keeps alpha and returns the same object for identity', () => {
    const c = rgba(1, 2, 3, 0.4)
    expect(adjustColor(c, {})).toBe(c)
    expect(adjustColor(c, { invert: true }).a).toBe(0.4)
  })
})

describe('adjustColors', () => {
  const doc = freeze(
    makeDoc([
      shapeLayer([
        fill([1, 0, 0]),
        gradient('gf', 2, [0, 0, 1, 0, 1, 0, 0, 1]),
        stroke([0.4196, 0.2902, 0.99607]),
      ]),
    ]),
    true,
  )

  it('adjusts every usage, gradients included', () => {
    const usages = extractColorUsages(doc)
    const next = produce(doc, (d) => void adjustColors(d, usages, { hue: 120 }))
    expect(hexes(extractColorUsages(next))).toEqual(['#00ff00', '#0000ff', '#ff0000', '#fe6b4a'])
  })

  it('is a no-op for the identity adjustment', () => {
    const [next, patches] = produceWithPatches(
      doc,
      (d) => void adjustColors(d, extractColorUsages(doc), {}),
    )
    expect(patches).toEqual([])
    expect(next).toBe(doc)
  })

  it('applies from the base colors, so a drag can re-apply and return to the start', () => {
    const usages = extractColorUsages(doc)
    let d = produce(doc, (draft) => void adjustColors(draft, usages, { hue: 30 }))
    d = produce(d, (draft) => void adjustColors(draft, usages, { hue: 60 }))
    const once = produce(doc, (draft) => void adjustColors(draft, usages, { hue: 60 }))
    expect(d).toEqual(once)
    d = produce(d, (draft) => void adjustColors(draft, usages, { hue: 0 }))
    expect(d).toEqual(doc)
  })
})

describe('revertUsages', () => {
  it('gives every usage back its own exact value after a shared recolor', () => {
    const doc = freeze(
      makeDoc([
        shapeLayer([
          fill([0.99607, 0.0012, 0]),
          fill([1, 0, 0, 1]),
          gradient('gf', 2, [0, 1, 0, 0, 1, 0, 0, 1, 0, 0.3333, 1, 1]),
          { ty: 'st', c: { a: 0, k: [255, 0, 0] }, o: { a: 0, k: 100 }, w: { a: 0, k: 1 } },
        ]),
        { ty: 1, nm: 'Bg', sc: '#FE0000Aa', sw: 1, sh: 1, ip: 0, op: 1, st: 0, ks: {} },
      ]),
      true,
    )
    const usages = extractColorUsages(doc)
    const recolored = produce(
      doc,
      (d) => void replaceColor(d, usages, rgba(10, 200, 30, 0.5), { alpha: true }),
    )
    expect(new Set(hexes(extractColorUsages(recolored)))).toEqual(new Set(['#0ac81e']))
    const [back, patches] = produceWithPatches(recolored, (d) => {
      expect(revertUsages(d, usages)).toBe(usages.length)
    })
    expect(patches.length).toBeGreaterThan(0)
    expect(back).toEqual(doc)
    // Reverting values that were never changed is a no-op.
    const [same, none] = produceWithPatches(doc, (d) => void revertUsages(d, usages))
    expect(none).toEqual([])
    expect(same).toBe(doc)
  })

  it('keeps the legacy 0–255 scale', () => {
    const doc = makeDoc([shapeLayer([fill([254, 1, 0, 255])])], { v: '4.0.0' })
    const usages = extractColorUsages(doc)
    const edited = produce(doc, (d) => void replaceColor(d, usages, rgba(1, 2, 3)))
    expect(at(edited, ['layers', 0, 'shapes', 0, 'c', 'k'])).toEqual([1, 2, 3, 255])
    const back = produce(edited, (d) => void revertUsages(d, usages))
    expect(at(back, ['layers', 0, 'shapes', 0, 'c', 'k'])).toEqual([254, 1, 0, 255])
  })
})

/* -------------------------------------------------------------------------- */
/*                                  Restoring                                 */
/* -------------------------------------------------------------------------- */

describe('restoreColors / isUsageModified', () => {
  const original = freeze(
    makeDoc([
      shapeLayer([fill([0.4196, 0.2902, 0.99607, 1])], 'A'),
      { ty: 1, nm: 'Bg', sc: '#FF0000', sw: 1, sh: 1, ip: 0, op: 1, st: 0, ks: {} },
    ]),
    true,
  )

  it('writes back the original numbers', () => {
    const edited = produce(
      original,
      (d) => void replaceColor(d, extractColorUsages(d), rgba(1, 2, 3)),
    )
    const usages = extractColorUsages(edited)
    expect(usages.every((u) => isUsageModified(edited, u, original))).toBe(true)
    const restored = produce(edited, (d) => {
      expect(restoreColors(d, usages, original)).toBe(2)
    })
    expect(restored).toEqual(original)
    expect(extractColorUsages(restored).some((u) => isUsageModified(restored, u, original))).toBe(
      false,
    )
  })

  it('skips usages whose layer or keyframe changed', () => {
    const renamed = produce(original, (d) => {
      d.layers[0].nm = 'Other'
      replaceColor(d, extractColorUsages(d), rgba(1, 2, 3))
    })
    const restored = produce(renamed, (d) => void restoreColors(d, extractColorUsages(d), original))
    // The renamed layer is not the same node any more; the solid layer is restored.
    expect(hexes(extractColorUsages(restored))).toEqual(['#010203', '#ff0000'])

    const animated = freeze(
      makeDoc([
        shapeLayer([
          {
            ty: 'fl',
            c: {
              a: 1,
              k: [
                { t: 0, s: [1, 0, 0] },
                { t: 9, s: [0, 0, 1] },
              ],
            },
          },
        ]),
      ]),
      true,
    )
    const moved = produce(animated, (d) => {
      const k = (d.layers[0] as unknown as { shapes: { c: { k: { t: number; s: number[] }[] } }[] })
        .shapes[0].c.k
      k[1].t = 12
      k[1].s = [0, 1, 0]
    })
    const back = produce(moved, (d) => void restoreColors(d, extractColorUsages(d), animated))
    expect(hexes(extractColorUsages(back))).toEqual(['#ff0000', '#00ff00'])
  })

  it('checks untouched layers without comparing values (structural sharing)', () => {
    const edited = produce(
      original,
      (d) => void replaceColor(d, [extractColorUsages(d)[1]], rgba(1, 2, 3)),
    )
    expect(edited.layers[0]).toBe(original.layers[0])
    const [fillUsage, solid] = extractColorUsages(edited)
    expect(isUsageModified(edited, fillUsage, original)).toBe(false)
    expect(isUsageModified(edited, solid, original)).toBe(true)
  })

  it('still compares slot values that live outside the layer', () => {
    const slotted = freeze(
      makeDoc(
        [shapeLayer([{ ty: 'fl', c: { sid: 'brand', a: 0, k: [0, 0, 1] }, o: { a: 0, k: 100 } }])],
        {
          slots: { brand: { p: { a: 0, k: [1, 0, 0] } } },
        },
      ),
      true,
    )
    const edited = produce(slotted, (d) => {
      ;(d as unknown as { slots: { brand: { p: { k: number[] } } } }).slots.brand.p.k = [0, 1, 0]
    })
    expect(edited.layers[0]).toBe(slotted.layers[0])
    const [usage] = extractColorUsages(edited)
    expect(isUsageModified(edited, usage, slotted)).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/*                                    Scope                                   */
/* -------------------------------------------------------------------------- */

describe('selectionScope', () => {
  const doc = makeDoc(
    [
      shapeLayer([group([fill([1, 0, 0])]), fill([0, 1, 0])], 'Shapes'),
      { ty: 0, nm: 'Pre', refId: 'outer', ip: 0, op: 60, st: 0, ks: {} },
    ],
    {
      assets: [
        { id: 'inner', layers: [shapeLayer([fill([0, 0, 1])])] },
        {
          id: 'outer',
          layers: [
            { ty: 0, refId: 'inner', ip: 0, op: 60, st: 0, ks: {} },
            { ty: 0, refId: 'outer', ip: 0, op: 60, st: 0, ks: {} },
          ],
        },
      ],
    },
  )

  it('covers selected shape items and groups', () => {
    const usages = extractColorUsages(doc)
    const scope = selectionScope(doc, [['layers', 0, 'shapes', 0]])
    expect(hexes(usages.filter((u) => isInScope(u.path, scope)))).toEqual(['#ff0000'])
  })

  it('follows precomp layers into their compositions (recursively, cycle safe)', () => {
    const usages = extractColorUsages(doc)
    const scope = selectionScope(doc, [['layers', 1]])
    expect(scope).toContainEqual(['assets', 1, 'layers'])
    expect(scope).toContainEqual(['assets', 0, 'layers'])
    expect(hexes(usages.filter((u) => isInScope(u.path, scope)))).toEqual(['#0000ff'])
  })
})

/* -------------------------------------------------------------------------- */
/*                               Perceptual color                             */
/* -------------------------------------------------------------------------- */

describe('deltaE2000', () => {
  // Reference pairs from Sharma, Wu & Dalal (2005).
  const pairs: [[number, number, number], [number, number, number], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [50, 3.1736, 0.5854], 1.0],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ]
  it.each(pairs)('%j vs %j = %d', (a, b, expected) => {
    expect(deltaE2000(a, b)).toBeCloseTo(expected, 3)
    expect(deltaE2000(b, a)).toBeCloseTo(expected, 3)
  })

  it('converts sRGB to Lab', () => {
    const [L, a, b] = rgbToLab({ r: 1, g: 1, b: 1 })
    expect(L).toBeCloseTo(100, 2)
    expect(a).toBeCloseTo(0, 2)
    expect(b).toBeCloseTo(0, 2)
    expect(rgbToLab({ r: 1, g: 0, b: 0 })[0]).toBeCloseTo(53.24, 1)
    expect(colorDistance({ r: 1, g: 0, b: 0 }, { r: 1, g: 0, b: 0 })).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/*                               Palette and CSS                              */
/* -------------------------------------------------------------------------- */

describe('documentPalette / gradientToCss / caching', () => {
  it('lists unique colors, most used first', () => {
    const doc = freeze(
      makeDoc([shapeLayer([fill([0, 0, 1]), fill([1, 0, 0]), stroke([1, 0, 0])])]),
      true,
    )
    expect(documentPalette(doc)).toEqual(['#ff0000', '#0000ff'])
    expect(documentPalette(doc)).toBe(documentPalette(doc))
  })

  it('builds CSS gradients with merged opacity stops', () => {
    const stops = [
      { offset: 0, color: { r: 1, g: 0, b: 0 } },
      { offset: 1, color: { r: 0, g: 0, b: 1 } },
    ]
    expect(gradientToCss(stops, [])).toBe('linear-gradient(90deg, #ff0000 0%, #0000ff 100%)')
    expect(gradientToCss(stops, [{ offset: 0.5, alpha: 0.5 }], 'radial')).toBe(
      'radial-gradient(circle, rgba(255, 0, 0, 0.5) 0%, rgba(128, 0, 128, 0.5) 50%, rgba(0, 0, 255, 0.5) 100%)',
    )
  })

  it('reuses scan results for unchanged layers of frozen documents', () => {
    const doc = freeze(
      makeDoc([shapeLayer([fill([1, 0, 0])], 'A'), shapeLayer([fill([0, 1, 0])], 'B', 2)]),
      true,
    )
    expect(isScanCached(doc)).toBe(false)
    const first = scanColors(doc)
    expect(isScanCached(doc)).toBe(true)
    expect(scanColors(doc)).toBe(first)
    const next = produce(doc, (d) => {
      d.layers[1].nm = 'Renamed'
    })
    expect(isScanCached(next)).toBe(false)
    const second = scanColors(next)
    expect(second).not.toBe(first)
    expect(second.colors[0]).toBe(first.colors[0])
    expect(second.colors[1]).not.toBe(first.colors[1])
    // Mutable (draft or plain) documents are never cached.
    const plain = makeDoc([shapeLayer([fill([1, 0, 0])])])
    scanColors(plain)
    expect(isScanCached(plain)).toBe(false)
  })
})
