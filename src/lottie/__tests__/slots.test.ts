import { enablePatches, freeze, produce, produceWithPatches } from 'immer'
import { describe, expect, it } from 'vitest'
import { extractColorUsages, type ColorUsage } from '../colors'
import { base64ToBytes, readDotLottie } from '../dotlottie'
import { getAt } from '../path'
import { evaluateArray } from '../property'
import {
  applyTheme,
  bakeTheme,
  bindColorSlot,
  colorRule,
  defaultRule,
  findSlot,
  findThemeRule,
  gradientStopsToLottie,
  isValidSlotId,
  kindOfValue,
  listSlots,
  nextColorSlotId,
  planColorBinding,
  readThemeRules,
  removeSlot,
  removeThemeRule,
  renameSlot,
  renameThemeRules,
  ruleAppliesTo,
  ruleColor,
  ruleFitsKind,
  ruleScalar,
  ruleVector,
  scalarRule,
  setSlotColor,
  setSlotStaticValue,
  slotColor,
  syncSlotCopies,
  slotKeyframeColors,
  slotScalar,
  textValueToDocument,
  themeToSlots,
  touchedSlots,
  uniqueSlotId,
  upsertThemeRule,
  type ThemeRule,
} from '../slots'
import type { Animation } from '../types'
import { MULTI_ANIM_THEME, MULTI_THEMES } from './fixtures/themes/fixtures'

enablePatches()

/* -------------------------------------------------------------------------- */
/*                                  Fixtures                                  */
/* -------------------------------------------------------------------------- */

type Json = Record<string, unknown>

const transform = (): Json => ({
  a: { a: 0, k: [0, 0] },
  p: { a: 0, k: [50, 50] },
  s: { a: 0, k: [100, 100] },
  r: { a: 0, k: 0 },
  o: { a: 0, k: 100 },
})
const groupTr = (): Json => ({ ty: 'tr', ...transform() })
const rect = (): Json => ({
  ty: 'rc',
  nm: 'Rect',
  p: { a: 0, k: [0, 0] },
  s: { a: 0, k: [20, 20] },
  r: { a: 0, k: 0 },
})
const fill = (k: unknown, extra: Json = {}, nm = 'Fill'): Json => ({
  ty: 'fl',
  nm,
  c: { a: 0, k, ...extra },
  o: { a: 0, k: 100 },
  r: 1,
})
const stroke = (k: unknown, extra: Json = {}): Json => ({
  ty: 'st',
  nm: 'Stroke',
  c: { a: 0, k, ...extra },
  o: { a: 0, k: 100 },
  w: { a: 0, k: 2 },
  lc: 2,
  lj: 2,
})
const group = (items: Json[], nm = 'Group'): Json => ({ ty: 'gr', nm, it: [...items, groupTr()] })
const shapeLayer = (nm: string, shapes: Json[], extra: Json = {}): Json => ({
  ty: 4,
  nm,
  ind: 1,
  ip: 0,
  op: 60,
  st: 0,
  ks: transform(),
  shapes,
  ...extra,
})
const anim = (extra: Json = {}): Animation =>
  ({ v: '5.12.2', fr: 30, ip: 0, op: 60, w: 100, h: 100, layers: [], ...extra }) as Animation

const RED = [1, 0, 0, 1]
const BLUE = [0, 0, 1, 1]
const rgba = (r: number, g: number, b: number) => ({ r, g, b, a: 1 })

/** The property as lottie-web renders it: `Object.assign(prop, slots[sid].p)` (SlotManager). */
function shown(doc: Animation, path: (string | number)[]): Json {
  const prop = getAt<Json>(doc, path)!
  const sid = typeof prop.sid === 'string' ? prop.sid : null
  const slot = sid ? (doc.slots?.[sid]?.p as Json | undefined) : undefined
  return slot ? { ...prop, ...slot } : prop
}
const shownColor = (doc: Animation, path: (string | number)[], frame = 0) =>
  evaluateArray(shown(doc, path) as never, frame)
    .slice(0, 3)
    .map((v) => Math.round(v * 255))

/** A document with a fill, a stroke, a gradient, a solid, text and an effect in 2 compositions. */
function richDoc(): Animation {
  const gradient: Json = {
    ty: 'gf',
    nm: 'Gradient',
    t: 1,
    s: { a: 0, k: [0, 0] },
    e: { a: 0, k: [10, 0] },
    o: { a: 0, k: 100 },
    g: { p: 2, k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1] } },
  }
  return anim({
    layers: [
      shapeLayer('Ball', [group([rect(), fill(RED), stroke(RED)], 'Circle'), gradient]),
      {
        ty: 1,
        nm: 'Solid',
        ind: 2,
        ip: 0,
        op: 60,
        st: 0,
        ks: transform(),
        sc: '#ff0000',
        sw: 10,
        sh: 10,
      },
      {
        ty: 5,
        nm: 'Title',
        ind: 3,
        ip: 0,
        op: 60,
        st: 0,
        ks: transform(),
        t: { d: { k: [{ t: 0, s: { t: 'Hi', f: 'Arial', s: 20, fc: [1, 0, 0] } }] } },
      },
      shapeLayer('Tint', [rect(), fill(BLUE)], {
        ind: 4,
        ef: [{ ty: 20, nm: 'Tint', ef: [{ ty: 2, nm: 'Map', v: { a: 0, k: RED } }] }],
      }),
      { ty: 0, nm: 'Precomp', ind: 5, refId: 'comp_1', ip: 0, op: 60, st: 0, ks: transform() },
    ],
    assets: [
      {
        id: 'comp_1',
        layers: [shapeLayer('Inner', [rect(), fill([1, 0, 0])])],
      },
    ],
  })
}

const usagesOf = (doc: Animation, hex: string): ColorUsage[] =>
  extractColorUsages(doc).filter((u) => u.hex === hex)

/* -------------------------------------------------------------------------- */
/*                                  Discovery                                 */
/* -------------------------------------------------------------------------- */

describe('listSlots', () => {
  it('finds every kind of slotted object, dictionary entries first', () => {
    const doc = freeze(
      anim({
        slots: {
          bg: { p: { a: 0, k: [0, 0, 0] } },
          unused: { p: { a: 0, k: 50 } },
        },
        layers: [
          shapeLayer(
            'Card',
            [
              group(
                [
                  rect(),
                  fill([1, 1, 1], { sid: 'bg' }),
                  stroke([0, 0, 0], { sid: 'line' }),
                  {
                    ty: 'gf',
                    t: 1,
                    s: { a: 0, k: [0, 0] },
                    e: { a: 0, k: [1, 0] },
                    o: { a: 0, k: 100, sid: 'alpha' },
                    g: { p: 2, k: { a: 0, k: [0, 1, 1, 1, 1, 0, 0, 0] }, sid: 'grad' },
                  },
                ],
                'Box',
              ),
            ],
            { ks: { ...transform(), p: { a: 0, k: [1, 2], sid: 'pos' } } },
          ),
          {
            ty: 5,
            nm: 'Label',
            ind: 2,
            ip: 0,
            op: 60,
            st: 0,
            ks: transform(),
            t: { d: { k: [{ t: 0, s: { t: 'A', f: 'Arial', s: 10 } }], sid: 'label' } },
          },
        ],
        assets: [
          { id: 'img', w: 10, h: 10, u: '', p: 'data:image/png;base64,AAAA', e: 1, sid: 'logo' },
          { id: 'comp', layers: [shapeLayer('Inner', [fill([1, 1, 1], { sid: 'bg' })])] },
        ],
      }),
      true,
    )
    const slots = listSlots(doc)
    expect(slots.map((s) => [s.id, s.kind, s.defined, s.refs.length])).toEqual([
      ['bg', 'color', true, 2],
      ['unused', 'scalar', true, 0],
      // Then document order (the layer's `ks` comes before its `shapes`).
      ['pos', 'position', false, 1],
      ['line', 'color', false, 1],
      ['alpha', 'scalar', false, 1],
      ['grad', 'gradient', false, 1],
      ['label', 'text', false, 1],
      ['logo', 'image', false, 1],
    ])
    const bg = findSlot(doc, 'bg')!
    expect(bg.refs[0]).toEqual({
      path: ['layers', 0, 'shapes', 0, 'it', 1, 'c'],
      role: 'fill-color',
      layerPath: ['layers', 0],
      nodePath: ['layers', 0, 'shapes', 0, 'it', 1],
    })
    // The precomp usage belongs to the precomp's layer.
    expect(bg.refs[1].layerPath).toEqual(['assets', 1, 'layers', 0])
    expect(findSlot(doc, 'line')!.refs[0].role).toBe('stroke-color')
    expect(findSlot(doc, 'pos')!.refs[0].role).toBe('position')
    expect(findSlot(doc, 'logo')!.refs[0]).toMatchObject({ path: ['assets', 0], layerPath: null })
    // Values: the dictionary entry, else the first bound object.
    expect(slotColor(bg)).toEqual(rgba(0, 0, 0))
    expect(slotColor(findSlot(doc, 'line')!)).toEqual(rgba(0, 0, 0))
    expect(slotScalar(findSlot(doc, 'unused')!)).toBe(50)
    // Frozen documents are cached.
    expect(listSlots(doc)).toBe(slots)
  })

  it('finds slots in effects, text animators and layer styles', () => {
    const doc = anim({
      layers: [
        shapeLayer('L', [], {
          ef: [{ ty: 20, ef: [{ ty: 2, v: { a: 0, k: RED, sid: 'fx' } }] }],
          sy: [{ ty: 1, c: { a: 0, k: RED, sid: 'shadow' } }],
        }),
        {
          ty: 5,
          ind: 2,
          ip: 0,
          op: 60,
          st: 0,
          ks: transform(),
          t: {
            d: { k: [{ t: 0, s: { t: 'A', f: 'Arial', s: 10 } }] },
            a: [{ a: { fc: { a: 0, k: RED, sid: 'anim' } } }],
          },
        },
      ],
    })
    const roles = Object.fromEntries(listSlots(doc).map((s) => [s.id, [s.kind, s.refs[0].role]]))
    expect(roles).toEqual({
      fx: ['color', 'effect-color'],
      shadow: ['color', 'style-color'],
      anim: ['color', 'text-color'],
    })
  })

  it('reuses the scan of unchanged layers after an edit', () => {
    const doc = freeze(richDoc(), true)
    const bound = produce(doc, (d) => {
      bindColorSlot(d, usagesOf(doc, '#ff0000'), 'brand')
    })
    const edited = produce(bound, (d) => {
      d.layers[1].nm = 'Renamed'
    })
    expect(listSlots(edited).map((s) => s.refs.length)).toEqual(
      listSlots(bound).map((s) => s.refs.length),
    )
  })

  it('reads the real Lottie Creator export', () => {
    const file = readDotLottie(base64ToBytes(MULTI_THEMES))
    const doc = file.animations[0].data
    const slots = listSlots(doc)
    expect(slots.map((s) => [s.id, s.kind, s.animated])).toEqual([
      ['bg_color', 'color', true],
      ['check_color', 'color', false],
    ])
    expect(slotKeyframeColors(slots[0])).toHaveLength(2)
    expect(slotColor(slots[1])).toEqual(rgba(1, 1, 1))
  })
})

describe('kindOfValue', () => {
  it('guesses kinds like dotlottie-rs', () => {
    expect(kindOfValue({ a: 0, k: [1, 0, 0] })).toBe('color')
    expect(kindOfValue({ a: 0, k: [1, 0, 0, 1] })).toBe('color')
    expect(kindOfValue({ a: 0, k: [10, 20] })).toBe('vector')
    expect(kindOfValue({ a: 0, k: 5 })).toBe('scalar')
    expect(kindOfValue({ a: 1, k: [{ t: 0, s: [5] }] })).toBe('scalar')
    expect(kindOfValue({ p: 2, k: { a: 0, k: [] } })).toBe('gradient')
    expect(kindOfValue({ w: 10, h: 10, p: 'a.png' })).toBe('image')
    expect(kindOfValue({ k: [{ t: 0, s: { t: 'Hi' } }] })).toBe('text')
    expect(kindOfValue({ a: 0, k: { v: [], i: [], o: [], c: true } })).toBe('path')
    expect(kindOfValue(null)).toBe('unknown')
  })
})

/* -------------------------------------------------------------------------- */
/*                                    Ids                                     */
/* -------------------------------------------------------------------------- */

describe('slot ids', () => {
  it('validates printable ids', () => {
    expect(isValidSlotId('bg_color')).toBe(true)
    expect(isValidSlotId('Фон')).toBe(true)
    expect(isValidSlotId('')).toBe(false)
    expect(isValidSlotId(' padded')).toBe(false)
    expect(isValidSlotId('tab\there')).toBe(false)
    expect(isValidSlotId('x'.repeat(65))).toBe(false)
  })

  it('makes unique ids', () => {
    const doc = anim({ slots: { color_1: { p: { a: 0, k: 1 } }, brand: { p: { a: 0, k: 1 } } } })
    expect(nextColorSlotId(doc)).toBe('color_2')
    expect(uniqueSlotId(doc, 'brand')).toBe('brand_2')
    expect(uniqueSlotId(doc, 'accent')).toBe('accent')
  })
})

/* -------------------------------------------------------------------------- */
/*                                  Binding                                   */
/* -------------------------------------------------------------------------- */

describe('planColorBinding', () => {
  it('keeps static color properties and explains the rest', () => {
    const doc = richDoc()
    const plan = planColorBinding(doc, usagesOf(doc, '#ff0000'))
    expect(plan.paths).toEqual([
      ['layers', 0, 'shapes', 0, 'it', 1, 'c'],
      ['layers', 0, 'shapes', 0, 'it', 2, 'c'],
      ['layers', 3, 'ef', 0, 'ef', 0, 'v'],
      ['assets', 0, 'layers', 0, 'shapes', 1, 'c'],
    ])
    expect(plan.skipped).toEqual({ gradient: 1, solid: 1, text: 1 })
    expect(plan.allBound).toBe(false)
  })

  it('skips keyframed colors', () => {
    const doc = anim({
      layers: [
        shapeLayer('L', [
          {
            ty: 'fl',
            c: {
              a: 1,
              k: [
                { t: 0, s: RED, o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
                { t: 10, s: BLUE },
              ],
            },
            o: { a: 0, k: 100 },
          },
        ]),
      ],
    })
    const plan = planColorBinding(doc, usagesOf(doc, '#ff0000'))
    expect(plan.paths).toEqual([])
    expect(plan.skipped).toEqual({ animated: 1 })
  })

  it('reports colors already bound to one slot', () => {
    const doc = freeze(richDoc(), true)
    const bound = produce(doc, (d) => {
      bindColorSlot(d, usagesOf(doc, '#ff0000'), 'brand')
    })
    const plan = planColorBinding(bound, usagesOf(bound, '#ff0000'))
    expect(plan).toMatchObject({ allBound: true, boundTo: ['brand'] })
  })
})

describe('bindColorSlot', () => {
  it('binds without changing what any player shows', () => {
    const doc = freeze(richDoc(), true)
    const before = extractColorUsages(doc).map((u) => [u.id, u.hex])
    const [next, patches] = produceWithPatches(doc, (d) => {
      expect(bindColorSlot(d, usagesOf(doc, '#ff0000'), 'brand')).toEqual({
        id: 'brand',
        bound: 4,
      })
    })
    expect(patches.length).toBeGreaterThan(0)
    expect(next.slots).toEqual({ brand: { p: { a: 0, k: [1, 0, 0, 1] } } })
    const paths = planColorBinding(doc, usagesOf(doc, '#ff0000')).paths
    for (const path of paths) {
      expect(getAt(next, [...path, 'sid'])).toBe('brand')
      expect(shownColor(next, [...path])).toEqual([255, 0, 0])
    }
    // Inline copies keep their exact numbers (3 or 4 components).
    expect(getAt(next, ['assets', 0, 'layers', 0, 'shapes', 1, 'c', 'k'])).toEqual([1, 0, 0])
    expect(extractColorUsages(next).map((u) => [u.id, u.hex])).toEqual(before)
    expect(listSlots(next)[0]).toMatchObject({ id: 'brand', kind: 'color', defined: true })
  })

  it('can give the bound colors a new value (slot and inline copies)', () => {
    const doc = freeze(richDoc(), true)
    const next = produce(doc, (d) => {
      bindColorSlot(d, usagesOf(doc, '#ff0000'), 'brand', rgba(0, 0.5, 1))
    })
    const value = next.slots!.brand.p as Json
    expect(value.k).toEqual([0, 0.502, 1, 1])
    // 0.502 · 255 = 128.01: 128 for players that floor (lottie-web) and players that round.
    expect(Math.floor(0.502 * 255)).toBe(128)
    expect(getAt(next, ['layers', 0, 'shapes', 0, 'it', 1, 'c', 'k'])).toEqual([0, 0.502, 1, 1])
    expect(getAt(next, ['assets', 0, 'layers', 0, 'shapes', 1, 'c', 'k'])).toEqual([0, 0.502, 1])
  })

  it('stores 0..1 slot values for files older than 4.1.9 (0..255 inline colors)', () => {
    const doc = freeze(
      anim({ v: '4.0.0', layers: [shapeLayer('L', [rect(), fill([255, 0, 0, 1])])] }),
      true,
    )
    const next = produce(doc, (d) => {
      bindColorSlot(d, usagesOf(doc, '#ff0000'), 'brand')
    })
    expect(next.slots!.brand.p).toEqual({ a: 0, k: [1, 0, 0, 1] })
    expect(getAt(next, ['layers', 0, 'shapes', 1, 'c', 'k'])).toEqual([255, 0, 0, 1])
    const recolored = produce(next, (d) => {
      setSlotColor(d, 'brand', rgba(0, 1, 0))
    })
    expect(getAt(recolored, ['layers', 0, 'shapes', 1, 'c', 'k'])).toEqual([0, 255, 0, 1])
    expect(recolored.slots!.brand.p).toEqual({ a: 0, k: [0, 1, 0, 1] })
  })

  it('refuses invalid or taken ids and empty plans', () => {
    const doc = freeze(richDoc(), true)
    const bound = produce(doc, (d) => {
      bindColorSlot(d, usagesOf(doc, '#ff0000'), 'brand')
    })
    produce(bound, (d) => {
      expect(bindColorSlot(d, usagesOf(bound, '#0000ff'), 'brand')).toBeNull()
      expect(bindColorSlot(d, usagesOf(bound, '#0000ff'), ' spaced')).toBeNull()
      expect(bindColorSlot(d, [], 'other')).toBeNull()
    })
  })

  it('moves properties from another slot', () => {
    const doc = freeze(
      anim({
        slots: { old: { p: { a: 0, k: [1, 0, 0] } } },
        layers: [
          shapeLayer('A', [rect(), fill([1, 0, 0], { sid: 'old' })]),
          shapeLayer('B', [rect(), fill([1, 0, 0])]),
        ],
      }),
      true,
    )
    const next = produce(doc, (d) => {
      bindColorSlot(d, usagesOf(doc, '#ff0000'), 'brand')
    })
    expect(getAt(next, ['layers', 0, 'shapes', 1, 'c', 'sid'])).toBe('brand')
    expect(getAt(next, ['layers', 1, 'shapes', 1, 'c', 'sid'])).toBe('brand')
    // The old slot stays (it may be used by themes or code) and now has no references.
    expect(findSlot(next, 'old')!.refs).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/*                                  Editing                                   */
/* -------------------------------------------------------------------------- */

function boundDoc(): Animation {
  const doc = freeze(richDoc(), true)
  return produce(doc, (d) => {
    bindColorSlot(d, usagesOf(doc, '#ff0000'), 'brand')
  })
}

describe('setSlotColor', () => {
  it('writes the slot and every inline copy, in every composition', () => {
    const doc = boundDoc()
    const next = produce(doc, (d) => {
      expect(setSlotColor(d, 'brand', rgba(0, 1, 0))).toBe(true)
    })
    expect(next.slots!.brand.p).toEqual({ a: 0, k: [0, 1, 0, 1] })
    for (const ref of findSlot(next, 'brand')!.refs) {
      expect(shownColor(next, [...ref.path])).toEqual([0, 255, 0])
      // Players without slot support read the inline copy.
      expect(evaluateArray(getAt(next, ref.path) as never, 0).slice(0, 3)).toEqual([0, 1, 0])
    }
    // Colors not in the slot are untouched.
    expect(getAt(next, ['layers', 1, 'sc'])).toBe('#ff0000')
  })

  it('changes nothing when the color is the same', () => {
    const doc = boundDoc()
    const [, patches] = produceWithPatches(doc, (d) => {
      expect(setSlotColor(d, 'brand', rgba(1, 0, 0))).toBe(false)
    })
    expect(patches).toEqual([])
  })

  it('makes a keyframed slot static', () => {
    const doc = anim({
      slots: {
        bg: {
          p: {
            a: 1,
            k: [
              { t: 0, s: [1, 0, 0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
              { t: 10, s: [0, 0, 1] },
            ],
          },
        },
      },
      layers: [shapeLayer('L', [rect(), fill([1, 0, 0], { sid: 'bg' })])],
    })
    const next = produce(doc, (d) => {
      setSlotColor(d, 'bg', rgba(0, 1, 0))
    })
    expect(next.slots!.bg.p).toEqual({ a: 0, k: [0, 1, 0] })
    expect(shownColor(next, ['layers', 0, 'shapes', 1, 'c'], 5)).toEqual([0, 255, 0])
  })

  it('creates the dictionary entry for sid-only slots', () => {
    const doc = anim({ layers: [shapeLayer('L', [rect(), fill([1, 0, 0, 1], { sid: 'bg' })])] })
    const next = produce(doc, (d) => {
      setSlotColor(d, 'bg', rgba(0, 0, 1))
    })
    expect(next.slots).toEqual({ bg: { p: { a: 0, k: [0, 0, 1] } } })
    expect(getAt(next, ['layers', 0, 'shapes', 1, 'c', 'k'])).toEqual([0, 0, 1, 1])
  })
})

describe('setSlotStaticValue', () => {
  it('writes scalar slots and their properties', () => {
    const doc = anim({
      slots: { alpha: { p: { a: 0, k: 100 } } },
      layers: [
        shapeLayer('L', [
          rect(),
          { ty: 'fl', c: { a: 0, k: RED }, o: { a: 0, k: 100, sid: 'alpha' } },
        ]),
      ],
    })
    const next = produce(doc, (d) => {
      expect(setSlotStaticValue(d, 'alpha', 40)).toBe(true)
    })
    expect(next.slots!.alpha.p).toEqual({ a: 0, k: 40 })
    expect(getAt(next, ['layers', 0, 'shapes', 1, 'o', 'k'])).toBe(40)
    produce(next, (d) => {
      expect(setSlotStaticValue(d, 'alpha', 40)).toBe(false)
    })
  })
})

describe('renameSlot', () => {
  it('renames the dictionary key in place and every sid', () => {
    const doc = anim({
      slots: { a: { p: { a: 0, k: 1 } }, bg: { p: { a: 0, k: RED } }, z: { p: { a: 0, k: 2 } } },
      layers: [shapeLayer('L', [rect(), fill(RED, { sid: 'bg' }), stroke(RED, { sid: 'bg' })])],
    })
    const next = produce(doc, (d) => {
      expect(renameSlot(d, 'bg', 'background')).toBe(true)
    })
    expect(Object.keys(next.slots!)).toEqual(['a', 'background', 'z'])
    expect(getAt(next, ['layers', 0, 'shapes', 1, 'c', 'sid'])).toBe('background')
    expect(getAt(next, ['layers', 0, 'shapes', 2, 'c', 'sid'])).toBe('background')
  })

  it('refuses taken, invalid and unknown ids', () => {
    const doc = anim({ slots: { a: { p: { a: 0, k: 1 } }, b: { p: { a: 0, k: 1 } } } })
    produce(doc, (d) => {
      expect(renameSlot(d, 'a', 'b')).toBe(false)
      expect(renameSlot(d, 'a', '')).toBe(false)
      expect(renameSlot(d, 'missing', 'c')).toBe(false)
      expect(renameSlot(d, 'a', 'a')).toBe(false)
    })
  })
})

describe('removeSlot', () => {
  it('bakes the slot value into every bound object (the picture stays the same)', () => {
    const doc = anim({
      slots: {
        bg: {
          p: {
            a: 1,
            k: [
              { t: 0, s: [0, 1, 0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
              { t: 10, s: [0, 0, 1] },
            ],
          },
        },
        keep: { p: { a: 0, k: 5 } },
      },
      layers: [
        shapeLayer('L', [rect(), fill([1, 0, 0], { sid: 'bg' }), stroke([0, 1, 0], { sid: 'bg' })]),
      ],
    })
    const frames = [0, 3, 7, 10]
    const paths = [
      ['layers', 0, 'shapes', 1, 'c'],
      ['layers', 0, 'shapes', 2, 'c'],
    ]
    const before = paths.map((p) => frames.map((f) => shownColor(doc, p, f)))
    const next = produce(doc, (d) => {
      expect(removeSlot(d, 'bg')).toBe(2)
    })
    expect(next.slots).toEqual({ keep: { p: { a: 0, k: 5 } } })
    expect(getAt(next, ['layers', 0, 'shapes', 1, 'c', 'sid'])).toBeUndefined()
    expect(paths.map((p) => frames.map((f) => shownColor(next, p, f)))).toEqual(before)
  })

  it('drops an empty dictionary and keeps sid-only values', () => {
    const doc = anim({
      slots: { bg: { p: { a: 0, k: [0, 0, 1] } } },
      layers: [
        shapeLayer('L', [rect(), fill([0, 0, 1], { sid: 'bg' }), fill([1, 0, 0], { sid: 'x' })]),
      ],
    })
    let next = produce(doc, (d) => {
      removeSlot(d, 'bg')
    })
    expect('slots' in next).toBe(false)
    next = produce(next, (d) => {
      expect(removeSlot(d, 'x')).toBe(1)
      expect(removeSlot(d, 'missing')).toBe(-1)
    })
    expect(getAt(next, ['layers', 0, 'shapes', 2, 'c'])).toEqual({ a: 0, k: [1, 0, 0] })
  })

  it('writes 0..255 colors back into very old files', () => {
    const doc = anim({
      v: '4.0.0',
      slots: { bg: { p: { a: 0, k: [0, 1, 0, 1] } } },
      layers: [shapeLayer('L', [rect(), fill([255, 0, 0, 1], { sid: 'bg' })])],
    })
    const next = produce(doc, (d) => {
      removeSlot(d, 'bg')
    })
    expect(getAt(next, ['layers', 0, 'shapes', 1, 'c', 'k'])).toEqual([0, 255, 0, 1])
  })
})

/* -------------------------------------------------------------------------- */
/*                                  Sync                                      */
/* -------------------------------------------------------------------------- */

describe('touchedSlots / syncSlotCopies', () => {
  it('tells which slot copies an edit changed', () => {
    const doc = boundDoc()
    const [, patches] = produceWithPatches(doc, (d) => {
      ;(getAt(d, ['layers', 0, 'shapes', 0, 'it', 1, 'c']) as Json).k = [0, 1, 0, 1]
      d.layers[1].nm = 'Renamed'
    })
    expect(touchedSlots(doc, patches)).toEqual(
      new Map([['brand', ['layers', 0, 'shapes', 0, 'it', 1, 'c']]]),
    )
    const [, slotPatches] = produceWithPatches(doc, (d) => {
      d.slots!.brand.p = { a: 0, k: [0, 0, 0] }
    })
    expect(touchedSlots(doc, slotPatches)).toEqual(new Map([['brand', 'slot']]))
    expect(touchedSlots(doc, [{ path: [] }])).toBeNull()
  })

  it('copies the edited property into the slot and the other copies', () => {
    const doc = boundDoc()
    const edited = produce(doc, (d) => {
      ;(getAt(d, ['layers', 0, 'shapes', 0, 'it', 1, 'c']) as Json).k = [0, 1, 0, 1]
    })
    const synced = produce(edited, (d) => {
      expect(syncSlotCopies(d, 'brand', ['layers', 0, 'shapes', 0, 'it', 1, 'c'])).toBe(true)
    })
    for (const ref of findSlot(synced, 'brand')!.refs)
      expect(shownColor(synced, [...ref.path])).toEqual([0, 255, 0])
    expect(synced.slots!.brand.p).toEqual({ a: 0, k: [0, 1, 0, 1] })
    // Consistent copies: nothing to do (3 vs 4 components do not count).
    produce(synced, (d) => {
      expect(syncSlotCopies(d, 'brand', 'slot')).toBe(false)
    })
  })

  it('converts 0..255 colors of very old files both ways', () => {
    const doc = anim({
      v: '4.0.0',
      slots: { bg: { p: { a: 0, k: [1, 0, 0, 1] } } },
      layers: [
        shapeLayer('A', [rect(), fill([255, 0, 0, 1], { sid: 'bg' })]),
        shapeLayer('B', [rect(), fill([255, 0, 0, 1], { sid: 'bg' })]),
      ],
    })
    const edited = produce(doc, (d) => {
      ;(getAt(d, ['layers', 0, 'shapes', 1, 'c']) as Json).k = [0, 0, 255, 1]
      syncSlotCopies(d, 'bg', ['layers', 0, 'shapes', 1, 'c'])
    })
    expect(edited.slots!.bg.p).toEqual({ a: 0, k: [0, 0, 1, 1] })
    expect(getAt(edited, ['layers', 1, 'shapes', 1, 'c', 'k'])).toEqual([0, 0, 255, 1])
  })

  it('syncs gradients bound on `g` with their stop count', () => {
    const doc = anim({
      slots: { grad: { p: { p: 2, k: { a: 0, k: [0, 1, 1, 1, 1, 0, 0, 0] } } } },
      layers: [shapeLayer('L', [rect(), gradientFill('g')])],
    })
    const synced = produce(doc, (d) => {
      d.slots!.grad.p = { p: 1, k: { a: 0, k: [0, 1, 0, 0] } }
      syncSlotCopies(d, 'grad', 'slot')
    })
    expect(getAt(synced, ['layers', 0, 'shapes', 1, 'g'])).toEqual({
      p: 1,
      k: { a: 0, k: [0, 1, 0, 0] },
      sid: 'grad',
    })
  })
})

/* -------------------------------------------------------------------------- */
/*                                Theme rules                                 */
/* -------------------------------------------------------------------------- */

describe('theme rules', () => {
  const rules: ThemeRule[] = [
    { id: 'bg', type: 'Color', value: [0, 0, 0] },
    { id: 'bg', type: 'Color', value: [1, 1, 1], animations: ['other'] },
    { id: 'size', type: 'Scalar', value: 12 },
    { id: 'pos', type: 'Position', value: [1, 2, 3] },
  ]

  it('reads rules tolerantly', () => {
    expect(readThemeRules({ rules: [...rules, { id: 1 }, null, 'x'] })).toEqual(rules)
    expect(readThemeRules(null)).toEqual([])
    expect(readThemeRules({ rules: 'nope' })).toEqual([])
  })

  it('scopes rules by animation; the last applicable rule wins', () => {
    expect(ruleAppliesTo(rules[1], 'other')).toBe(true)
    expect(ruleAppliesTo(rules[1], 'main')).toBe(false)
    expect(ruleAppliesTo(rules[1], null)).toBe(false)
    expect(findThemeRule(rules, 'bg', 'main')).toBe(rules[0])
    expect(findThemeRule(rules, 'bg', 'other')).toBe(rules[1])
    expect(findThemeRule(rules, 'nope', 'main')).toBeUndefined()
  })

  it('reads static values', () => {
    expect(ruleColor(rules[0])).toEqual(rgba(0, 0, 0))
    expect(ruleColor({ id: 'x', type: 'Color', keyframes: [] })).toBeNull()
    expect(ruleColor({ id: 'x', type: 'Color', value: [1, 0, 0], expression: 'x' })).toBeNull()
    expect(ruleScalar(rules[2])).toBe(12)
    expect(ruleVector(rules[3])).toEqual([1, 2, 3])
  })

  it('writes 8-bit exact RGB color rules', () => {
    const rule = colorRule('bg', rgba(0x33 / 255, 0x66 / 255, 0.2))
    expect(rule).toEqual({ id: 'bg', type: 'Color', value: [0.2, 0.4, 0.2] })
    for (let n = 0; n < 256; n++) {
      const v = (colorRule('x', rgba(n / 255, 0, 0)).value as number[])[0]
      expect(Math.floor(v * 255)).toBe(n)
      expect(Math.round(v * 255)).toBe(n)
    }
  })

  it('upserts rules and keeps everything else', () => {
    const data = { rules: [...rules, { id: 'junk' }], extra: true }
    const next = upsertThemeRule(data, colorRule('bg', rgba(1, 0, 0)), 'main')
    expect(next.extra).toBe(true)
    expect(readThemeRules(next)).toEqual([
      { id: 'bg', type: 'Color', value: [1, 0, 0] },
      rules[1],
      rules[2],
      rules[3],
    ])
    expect((next.rules as unknown[])[4]).toEqual({ id: 'junk' })
    // `data` itself is not changed.
    expect(data.rules[0]).toBe(rules[0])
    // A rule limited to the animation keeps its filter; a new slot is appended.
    const other = upsertThemeRule(data, colorRule('bg', rgba(0, 1, 0)), 'other')
    expect(readThemeRules(other)[1]).toEqual({
      id: 'bg',
      type: 'Color',
      value: [0, 1, 0],
      animations: ['other'],
    })
    const added = upsertThemeRule({}, scalarRule('w', 3), null)
    expect(added).toEqual({ rules: [{ id: 'w', type: 'Scalar', value: 3 }] })
  })

  it('replaces keyframes and expressions with a static value', () => {
    const data = {
      rules: [
        { id: 'bg', type: 'Color', keyframes: [{ frame: 0, value: [1, 0, 0] }], expression: 'e' },
      ],
    }
    expect(readThemeRules(upsertThemeRule(data, colorRule('bg', rgba(0, 0, 1)), null))).toEqual([
      { id: 'bg', type: 'Color', value: [0, 0, 1] },
    ])
  })

  it('removes and renames rules', () => {
    const data = { rules }
    expect(readThemeRules(removeThemeRule(data, 'bg', 'main'))).toEqual(rules.slice(1))
    expect(removeThemeRule(data, 'missing', 'main')).toBe(data)
    expect(readThemeRules(renameThemeRules(data, 'bg', 'back', 'main')).map((r) => r.id)).toEqual([
      'back',
      'bg',
      'size',
      'pos',
    ])
    expect(
      readThemeRules(renameThemeRules(data, 'bg', 'back', 'main', true)).map((r) => r.id),
    ).toEqual(['bg', 'back', 'bg', 'size', 'pos'])
    expect(renameThemeRules(data, 'none', 'x', 'main')).toBe(data)
  })

  it('matches rule types to slot kinds', () => {
    expect(ruleFitsKind('Color', 'color')).toBe(true)
    expect(ruleFitsKind('Color', 'scalar')).toBe(false)
    expect(ruleFitsKind('Vector', 'position')).toBe(true)
    expect(ruleFitsKind('Position', 'vector')).toBe(true)
    expect(ruleFitsKind('Gradient', 'unknown')).toBe(true)
    expect(ruleFitsKind('Bogus', 'color')).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/*                             Theme → slot values                            */
/* -------------------------------------------------------------------------- */

const docWith = (slots: Record<string, unknown>, layers: unknown[] = []) =>
  anim({ slots: slots as Animation['slots'], layers: layers as Animation['layers'] })

describe('defaultRule', () => {
  it('writes static values as they are (exact numbers)', () => {
    const doc = docWith(
      {
        c: { p: { a: 0, k: [0.529411764706, 0.77, 0.09, 1] } },
        s: { p: { a: 0, k: 40 } },
        v: { p: { a: 0, k: [100, 50] } },
      },
      [
        shapeLayer(
          'L',
          [
            rect(),
            { ty: 'fl', c: { a: 0, k: [0, 0, 0], sid: 'c' }, o: { a: 0, k: 100, sid: 's' } },
          ],
          { ks: { ...transform(), s: { a: 0, k: [100, 100], sid: 'v' } } },
        ),
      ],
    )
    expect(defaultRule(findSlot(doc, 'c')!)).toEqual({
      id: 'c',
      type: 'Color',
      value: [0.529411764706, 0.77, 0.09],
    })
    expect(defaultRule(findSlot(doc, 's')!)).toEqual({ id: 's', type: 'Scalar', value: 40 })
    expect(defaultRule(findSlot(doc, 'v')!)).toEqual({ id: 'v', type: 'Vector', value: [100, 50] })
  })

  it('writes keyframes that convert back to the same property', () => {
    const k = [
      { t: 0, s: [1, 0, 0], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } },
      { t: 12, s: [0, 0, 1], h: 1, o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
      { t: 30, s: [0, 1, 0] },
    ]
    const doc = docWith({ c: { p: { a: 1, k } } }, [
      shapeLayer('L', [rect(), fill([1, 0, 0], { sid: 'c' })]),
    ])
    const rule = defaultRule(findSlot(doc, 'c')!)!
    expect(rule.keyframes).toEqual([
      { frame: 0, value: [1, 0, 0], inTangent: { x: 0.7, y: 1 }, outTangent: { x: 0.3, y: 0 } },
      {
        frame: 12,
        value: [0, 0, 1],
        inTangent: { x: 1, y: 1 },
        outTangent: { x: 0, y: 0 },
        hold: true,
      },
      { frame: 30, value: [0, 1, 0] },
    ])
    // Applying the rule gives the property back, frame for frame.
    const back = themeToSlots([rule], null).c.p
    for (const f of [0, 5, 11, 12, 20, 30]) {
      expect(evaluateArray(back as never, f)).toEqual(evaluateArray({ a: 1, k } as never, f))
    }
  })

  it('keeps spatial tangents of positions and reads legacy end values', () => {
    const doc = docWith(
      {
        p: {
          p: {
            a: 1,
            k: [
              {
                t: 0,
                s: [0, 0],
                e: [100, 0],
                to: [10, 0],
                ti: [-10, 0],
                o: { x: 0, y: 0 },
                i: { x: 1, y: 1 },
              },
              { t: 10 },
            ],
          },
        },
      },
      [shapeLayer('L', [], { ks: { ...transform(), p: { a: 0, k: [0, 0], sid: 'p' } } })],
    )
    const rule = defaultRule(findSlot(doc, 'p')!)!
    expect(rule.type).toBe('Position')
    expect(rule.keyframes?.[0]).toMatchObject({
      valueOutTangent: [10, 0],
      valueInTangent: [-10, 0],
    })
    expect(rule.keyframes?.[1]).toEqual({ frame: 10, value: [100, 0] })
  })

  it('has no rule for values themes cannot hold here', () => {
    const doc = docWith({ g: { p: { p: 1, k: { a: 0, k: [0, 1, 1, 1] } } } })
    expect(defaultRule(findSlot(doc, 'g')!)).toBeNull()
  })
})

describe('themeToSlots', () => {
  it('converts static rules like dotlottie-rs (RGB colors, 2D vectors)', () => {
    const slots = themeToSlots(
      [
        { id: 'c', type: 'Color', value: [0.1, 0.2, 0.3, 0.5] },
        { id: 's', type: 'Scalar', value: 42 },
        { id: 'v', type: 'Vector', value: [10, 20, 30] },
        { id: 'p', type: 'Position', value: [1, 2] },
        { id: 'missing', type: 'Color' },
        { id: 'bad', type: 'Nope', value: 1 },
      ],
      'main',
    )
    expect(slots).toEqual({
      c: { p: { a: 0, k: [0.1, 0.2, 0.3] } },
      s: { p: { a: 0, k: 42 } },
      v: { p: { a: 0, k: [10, 20] } },
      p: { p: { a: 0, k: [1, 2] } },
      // dotlottie-rs falls back to black without a value.
      missing: { p: { a: 0, k: [0, 0, 0] } },
    })
  })

  it('maps keyframes with their own tangents; no in-tangent means linear', () => {
    const slots = themeToSlots(
      [
        {
          id: 'c',
          type: 'Color',
          keyframes: [
            {
              frame: 0,
              value: [1, 0, 0],
              outTangent: { x: 0.3, y: 0 },
              inTangent: { x: 0.7, y: 1 },
            },
            { frame: 20, value: [0, 0, 1], outTangent: { x: 0, y: 0 } },
            { frame: 40, value: [0, 1, 0], hold: true },
          ],
        },
        {
          id: 's',
          type: 'Scalar',
          keyframes: [
            { frame: 0, value: 1, inTangent: { x: [0.5], y: [1] } },
            { frame: 10, value: [2] },
          ],
        },
      ],
      null,
    )
    expect(slots.c.p).toEqual({
      a: 1,
      k: [
        { t: 0, s: [1, 0, 0], o: { x: 0.3, y: 0 }, i: { x: 0.7, y: 1 } },
        { t: 20, s: [0, 0, 1], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
        { t: 40, s: [0, 1, 0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 }, h: 1 },
      ],
    })
    // Scalars are arrays in keyframes; mixed handle shapes become arrays (lottie-web needs it).
    expect(slots.s.p).toEqual({
      a: 1,
      k: [
        { t: 0, s: [1], o: { x: [0], y: [0] }, i: { x: [0.5], y: [1] } },
        { t: 10, s: [2], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
      ],
    })
    // The eased value lottie-web computes at the middle of the first segment.
    const mid = evaluateArray(slots.c.p as never, 10)
    expect(mid[0]).toBeGreaterThan(0)
    expect(mid[0]).toBeLessThan(1)
  })

  it('turns a lone keyframe into a static value and keeps position tangents', () => {
    const slots = themeToSlots(
      [
        { id: 'one', type: 'Color', keyframes: [{ frame: 0, value: [1, 1, 1] }] },
        {
          id: 'p',
          type: 'Position',
          keyframes: [
            { frame: 0, value: [0, 0], valueOutTangent: [10, 0, 0], inTangent: { x: 1, y: 1 } },
            { frame: 10, value: [100, 0], valueInTangent: [-10, 0] },
          ],
        },
      ],
      null,
    )
    expect(slots.one.p).toEqual({ a: 0, k: [1, 1, 1] })
    const kfs = (slots.p.p as { k: Json[] }).k
    expect(kfs[0].to).toEqual([10, 0])
    expect(kfs[1].ti).toEqual([-10, 0])
  })

  it('converts gradients, images and text', () => {
    const slots = themeToSlots(
      [
        {
          id: 'g',
          type: 'Gradient',
          value: [
            { offset: 0, color: [1, 0, 0] },
            { offset: 1, color: [0, 0, 1, 0.5] },
          ],
        },
        {
          id: 'img',
          type: 'Image',
          value: { src: 'data:image/png;base64,AA', width: 4, height: 2 },
        },
        { id: 'url', type: 'Image', value: { src: 'https://x.test/a.png' } },
        { id: 'file', type: 'Image', value: { src: 'logo.png' } },
        { id: 'lost', type: 'Image', value: { src: 'gone.png' } },
        { id: 't', type: 'Text', value: { text: 'Hola', fillColor: [1, 0, 0], justify: 'Center' } },
      ],
      null,
      { resolveImage: (src) => (src === 'logo.png' ? 'data:image/png;base64,BB' : undefined) },
    )
    expect(slots.g.p).toEqual({
      p: 2,
      k: { a: 0, k: [0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0.5] },
    })
    expect(slots.img.p).toEqual({ u: '', p: 'data:image/png;base64,AA', e: 1, w: 4, h: 2 })
    expect(slots.url.p).toEqual({ u: '', p: 'https://x.test/a.png', e: 0 })
    expect(slots.file.p).toEqual({ u: '', p: 'data:image/png;base64,BB', e: 1 })
    expect(slots.lost).toBeUndefined()
    expect(slots.t.p).toEqual({ k: [{ t: 0, s: { t: 'Hola', fc: [1, 0, 0], j: 2 } }] })
  })

  it('merges text rules over the original document and skips mismatched types', () => {
    const doc = anim({
      layers: [
        {
          ty: 5,
          ind: 1,
          ip: 0,
          op: 60,
          st: 0,
          ks: transform(),
          t: {
            d: { k: [{ t: 0, s: { t: 'A', f: 'Arial', s: 10, fc: [0, 0, 0] } }], sid: 'label' },
          },
        },
      ],
    })
    const slots = themeToSlots(
      [
        { id: 'label', type: 'Text', value: { text: 'B' } },
        { id: 'label', type: 'Color', value: [1, 0, 0] },
      ],
      null,
      { slots: listSlots(doc) },
    )
    // The Color rule for a text slot is skipped; the Text rule keeps the font.
    expect(slots.label.p).toEqual({
      k: [{ t: 0, s: { t: 'B', f: 'Arial', s: 10, fc: [0, 0, 0] } }],
    })
  })

  it('honours animation filters and the expression option', () => {
    const rules: ThemeRule[] = [
      { id: 'a', type: 'Scalar', value: 1, animations: ['one'] },
      { id: 'b', type: 'Scalar', value: 2, expression: 'var $bm_rt = 3' },
    ]
    expect(Object.keys(themeToSlots(rules, 'two'))).toEqual(['b'])
    expect(themeToSlots(rules, 'one').b.p).toEqual({ a: 0, k: 2, x: 'var $bm_rt = 3' })
    expect(themeToSlots(rules, 'one', { expressions: false }).b.p).toEqual({ a: 0, k: 2 })
  })

  it('builds dotLottie gradient data with an opacity block', () => {
    expect(gradientStopsToLottie([{ offset: 0.5, color: [1, 1, 1] }])).toEqual([
      0.5, 1, 1, 1, 0.5, 1,
    ])
  })

  it('reads dotLottie text documents', () => {
    expect(textValueToDocument({ text: 'x', textCaps: 'AllCaps', justify: 'Nope' })).toEqual({
      t: 'x',
      ca: 1,
    })
    expect(textValueToDocument(null)).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/*                               Applying themes                              */
/* -------------------------------------------------------------------------- */

/** A gradient fill whose `sid` sits on `g` (ThorVG) or on `g.k` (lottie-web). */
const gradientFill = (sidOn: 'g' | 'k'): Json => ({
  ty: 'gf',
  t: 1,
  s: { a: 0, k: [0, 0] },
  e: { a: 0, k: [1, 0] },
  o: { a: 0, k: 100 },
  g:
    sidOn === 'g'
      ? { p: 2, k: { a: 0, k: [0, 1, 1, 1, 1, 0, 0, 0] }, sid: 'grad' }
      : { p: 2, k: { a: 0, k: [0, 1, 1, 1, 1, 0, 0, 0], sid: 'gradK' } },
})

describe('applyTheme', () => {
  it('merges the theme into the slots of a copy (the document is untouched)', () => {
    const doc = freeze(boundDoc(), true)
    const rules = [colorRule('brand', rgba(0, 0, 1))]
    const themed = applyTheme(doc, rules, 'main')
    expect(themed).not.toBe(doc)
    expect(themed.layers).toBe(doc.layers)
    expect(themed.slots!.brand.p).toEqual({ a: 0, k: [0, 0, 1] })
    expect(doc.slots!.brand.p).toEqual({ a: 0, k: [1, 0, 0, 1] })
    for (const ref of findSlot(doc, 'brand')!.refs)
      expect(shownColor(themed, [...ref.path])).toEqual([0, 0, 255])
    // Same inputs, same object: the preview does not reload.
    expect(applyTheme(doc, [colorRule('brand', rgba(0, 0, 1))], 'main')).toBe(themed)
    expect(applyTheme(doc, null, 'main')).toBe(doc)
    expect(applyTheme(doc, [], 'main')).toBe(doc)
  })

  it('writes gradients bound on `g` in place and gives `g.k` slots the inner property', () => {
    const doc = freeze(
      anim({ layers: [shapeLayer('L', [rect(), gradientFill('g'), gradientFill('k')])] }),
      true,
    )
    const stops = [
      { offset: 0, color: [1, 0, 0, 1] },
      { offset: 1, color: [0, 1, 0, 1] },
    ]
    const themed = applyTheme(
      doc,
      [
        { id: 'grad', type: 'Gradient', value: stops },
        { id: 'gradK', type: 'Gradient', value: stops },
      ],
      null,
    )
    const data = [0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1]
    // As `Object.assign(g, p)`: the sid stays.
    expect(getAt(themed, ['layers', 0, 'shapes', 1, 'g'])).toEqual({
      p: 2,
      k: { a: 0, k: data },
      sid: 'grad',
    })
    expect(themed.slots!.gradK.p).toEqual({ a: 0, k: data })
    // The frozen document was copied, not changed.
    expect(getAt(doc, ['layers', 0, 'shapes', 1, 'g', 'k', 'k'])).toEqual([0, 1, 1, 1, 1, 0, 0, 0])
    expect(themed.layers[0]).not.toBe(doc.layers[0])
  })

  it('previews every theme of the real multi-theme file', () => {
    const file = readDotLottie(base64ToBytes(MULTI_THEMES))
    const doc = freeze(file.animations[0].data, true)
    expect(file.themes.map((t) => t.id)).toEqual([
      'dark',
      'sky',
      'light',
      'animated_light',
      'animated_dark',
      'animated_sky',
    ])
    const bg = ['assets', 0, 'layers', 1, 'shapes', 0, 'it', 1, 'c']
    const check = ['assets', 0, 'layers', 0, 'shapes', 0, 'it', 1, 'c']
    const theme = (id: string) =>
      applyTheme(doc, readThemeRules(file.themes.find((t) => t.id === id)!.data), file.activeId)
    // Default: the animated slot of the file.
    expect(shownColor(doc, bg, 0)).toEqual([58, 134, 255])
    expect(shownColor(theme('dark'), bg, 45)).toEqual([0, 0, 0])
    expect(shownColor(theme('light'), check, 0)).toEqual([2, 2, 2])
    // Keyframed theme: from blue at frame 0 to black at frame 89, linear in between.
    const animated = theme('animated_dark')
    expect(shownColor(animated, bg, 0)).toEqual([58, 134, 255])
    expect(shownColor(animated, bg, 89)).toEqual([0, 0, 0])
    const half = shownColor(animated, bg, 44.5)
    expect(half[2]).toBeGreaterThan(120)
    expect(half[2]).toBeLessThan(135)
    // A one-keyframe rule is a static value (lottie-web cannot play a single keyframe).
    expect(animated.slots!.check_color.p).toEqual({ a: 0, k: [1, 1, 1] })
  })

  it('applies shared slot ids of a multi-animation package to each animation', () => {
    const file = readDotLottie(base64ToBytes(MULTI_ANIM_THEME))
    const red = readThemeRules(file.themes.find((t) => t.id === 'red')!.data)
    for (const a of file.animations) {
      const themed = applyTheme(freeze(a.data, true), red, a.id)
      const ref = findSlot(themed, 'color')!.refs[0]
      expect(shownColor(themed, [...ref.path])).toEqual([255, 0, 0])
    }
  })
})

describe('bakeTheme', () => {
  it('writes the theme into slots and inline copies of a copy', () => {
    const doc = freeze(boundDoc(), true)
    const baked = bakeTheme(doc, [colorRule('brand', rgba(0, 1, 0))], null)
    for (const ref of findSlot(baked, 'brand')!.refs) {
      expect(shownColor(baked, [...ref.path])).toEqual([0, 255, 0])
      expect(evaluateArray(getAt(baked, ref.path) as never, 0).slice(0, 3)).toEqual([0, 1, 0])
    }
    expect(doc.slots!.brand.p).toEqual({ a: 0, k: [1, 0, 0, 1] })
    // Rules for other slots change nothing.
    expect(bakeTheme(doc, [colorRule('nope', rgba(0, 0, 0))], null)).toEqual(doc)
  })

  it('keeps 0..255 inline colors in very old files', () => {
    const doc = anim({
      v: '4.0.0',
      slots: { bg: { p: { a: 0, k: [1, 0, 0, 1] } } },
      layers: [shapeLayer('L', [rect(), fill([255, 0, 0, 1], { sid: 'bg' })])],
    })
    const baked = bakeTheme(doc, [colorRule('bg', rgba(0, 0, 1))], null)
    expect(getAt(baked, ['layers', 0, 'shapes', 1, 'c', 'k'])).toEqual([0, 0, 255])
    expect(baked.slots!.bg.p).toEqual({ a: 0, k: [0, 0, 1] })
  })
})
