import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { detectFeatures, TARGETS, type FeatureId } from '../compat'
import {
  ADDABLE_EFFECTS,
  EFFECT_DEFS,
  applyEffectFix,
  canHaveEffects,
  createEffect,
  duplicateEffect,
  effectContext,
  effectDefOf,
  effectFeature,
  effectIndexMaps,
  effectIssues,
  effectSupport,
  insertEffect,
  matchParams,
  moveEffect,
  paramDefault,
  remapEffectPath,
  removeEffect,
  renameEffect,
  rendersInPreview,
  resetEffect,
  setEffectEnabled,
  uniqueEffectName,
  type EffectKind,
} from '../effects'
import type { Animation, Effect, Layer } from '../types'
import { validate } from '../validate'
import testJson from '../../../docs/test.json?raw'
import walletJson from '../../../docs/wallet_flag.json?raw'
import { doc, layer, type J } from './insights.fixtures'

/* -------------------------------------------------------------------------- */
/*                      Real After Effects + Bodymovin exports                  */
/* -------------------------------------------------------------------------- */
// Copied verbatim from the snapshot tests of lottie-android (ShadowPosition1.json,
// FillBlur.json, cubo_livre.json, truecosmos.json) and a lottie-web issue file
// (streetby_test_loading.json); keyframed values were replaced by static ones.

const AE_DROP_SHADOW = {
  ty: 25,
  nm: 'Drop Shadow 2',
  np: 8,
  mn: 'ADBE Drop Shadow',
  ix: 1,
  en: 1,
  ef: [
    {
      ty: 2,
      nm: 'Shadow Color',
      mn: 'ADBE Drop Shadow-0001',
      ix: 1,
      v: { a: 0, k: [0.035661824048, 0, 1, 1], ix: 1 },
    },
    { ty: 0, nm: 'Opacity', mn: 'ADBE Drop Shadow-0002', ix: 2, v: { a: 0, k: 255, ix: 2 } },
    { ty: 0, nm: 'Direction', mn: 'ADBE Drop Shadow-0003', ix: 3, v: { a: 0, k: 135, ix: 3 } },
    { ty: 0, nm: 'Distance', mn: 'ADBE Drop Shadow-0004', ix: 4, v: { a: 0, k: 142, ix: 4 } },
    { ty: 0, nm: 'Softness', mn: 'ADBE Drop Shadow-0005', ix: 5, v: { a: 0, k: 0, ix: 5 } },
    { ty: 7, nm: 'Shadow Only', mn: 'ADBE Drop Shadow-0006', ix: 6, v: { a: 0, k: 0, ix: 6 } },
  ],
}

const AE_GAUSSIAN_BLUR = {
  ty: 29,
  nm: 'Gaussian Blur2',
  np: 5,
  mn: 'ADBE Gaussian Blur 2',
  ix: 1,
  en: 1,
  ef: [
    {
      ty: 0,
      nm: 'Blurriness',
      mn: 'ADBE Gaussian Blur 2-0001',
      ix: 1,
      v: { a: 0, k: 120.7, ix: 1 },
    },
    {
      ty: 7,
      nm: 'Blur Dimensions',
      mn: 'ADBE Gaussian Blur 2-0002',
      ix: 2,
      v: { a: 0, k: 1, ix: 2 },
    },
    {
      ty: 7,
      nm: 'Repeat Edge Pixels',
      mn: 'ADBE Gaussian Blur 2-0003',
      ix: 3,
      v: { a: 0, k: 0, ix: 3 },
    },
  ],
}

const AE_FILL = {
  ty: 21,
  nm: 'Fill',
  np: 9,
  mn: 'ADBE Fill',
  ix: 1,
  en: 1,
  ef: [
    { ty: 10, nm: 'Fill Mask', mn: 'ADBE Fill-0001', ix: 1, v: { a: 0, k: 0, ix: 1 } },
    { ty: 7, nm: 'All Masks', mn: 'ADBE Fill-0007', ix: 2, v: { a: 0, k: 0, ix: 2 } },
    { ty: 2, nm: 'Color', mn: 'ADBE Fill-0002', ix: 3, v: { a: 0, k: [0.2, 0.2, 0.2, 1], ix: 3 } },
    { ty: 7, nm: 'Invert', mn: 'ADBE Fill-0006', ix: 4, v: { a: 0, k: 0, ix: 4 } },
    { ty: 0, nm: 'Horizontal Feather', mn: 'ADBE Fill-0003', ix: 5, v: { a: 0, k: 0, ix: 5 } },
    { ty: 0, nm: 'Vertical Feather', mn: 'ADBE Fill-0004', ix: 6, v: { a: 0, k: 0, ix: 6 } },
    { ty: 0, nm: 'Opacity', mn: 'ADBE Fill-0005', ix: 7, v: { a: 0, k: 1, ix: 7 } },
  ],
}

const AE_TINT = {
  ty: 20,
  nm: 'Tint',
  np: 7,
  mn: 'ADBE Tint',
  ix: 1,
  en: 1,
  ef: [
    {
      ty: 2,
      nm: 'Map Black To',
      mn: 'ADBE Tint-0001',
      ix: 1,
      v: { a: 0, k: [0.94, 0.43, 0.15, 1], ix: 1 },
    },
    {
      ty: 2,
      nm: 'Map White To',
      mn: 'ADBE Tint-0002',
      ix: 2,
      v: { a: 0, k: [0.94, 0.43, 0.15, 1], ix: 2 },
    },
    { ty: 0, nm: 'Amount to Tint', mn: 'ADBE Tint-0003', ix: 3, v: { a: 0, k: 100, ix: 3 } },
    { ty: 6, nm: '', mn: 'ADBE Tint-0004', ix: 4, v: 0 },
    { ty: 7, nm: 'GPU Rendering', mn: 'ADBE Force CPU GPU', ix: 5, v: { a: 0, k: 1, ix: 5 } },
  ],
}

const AE_STROKE = {
  ty: 22,
  nm: 'Stroke',
  mn: 'ADBE Stroke',
  ix: 1,
  en: 1,
  ef: [
    { ty: 10, nm: 'Path', mn: 'ADBE Stroke-0001', ix: 1, v: { a: 0, k: 1, ix: 1 } },
    { ty: 7, nm: 'All Masks', mn: 'ADBE Stroke-0010', ix: 2, v: { a: 0, k: 1, ix: 2 } },
    { ty: 7, nm: 'Stroke Sequentially', mn: 'ADBE Stroke-0011', ix: 3, v: { a: 0, k: 1, ix: 3 } },
    {
      ty: 2,
      nm: 'Color',
      mn: 'ADBE Stroke-0002',
      ix: 4,
      v: { a: 0, k: [0, 0.6, 0.745, 1], ix: 4 },
    },
    { ty: 0, nm: 'Brush Size', mn: 'ADBE Stroke-0003', ix: 5, v: { a: 0, k: 2, ix: 5 } },
    { ty: 0, nm: 'Brush Hardness', mn: 'ADBE Stroke-0004', ix: 6, v: { a: 0, k: 0.75, ix: 6 } },
    { ty: 0, nm: 'Opacity', mn: 'ADBE Stroke-0005', ix: 7, v: { a: 0, k: 1, ix: 7 } },
    { ty: 0, nm: 'Start', mn: 'ADBE Stroke-0008', ix: 8, v: { a: 0, k: 0, ix: 8 } },
    { ty: 0, nm: 'End', mn: 'ADBE Stroke-0009', ix: 9, v: { a: 0, k: 100, ix: 9 } },
    { ty: 7, nm: 'Spacing', mn: 'ADBE Stroke-0006', ix: 10, v: { a: 0, k: 15, ix: 10 } },
    { ty: 7, nm: 'Paint Style', mn: 'ADBE Stroke-0007', ix: 11, v: { a: 0, k: 1, ix: 11 } },
  ],
}

type Control = { ty: number; nm?: string; mn?: string; ix?: number; v?: unknown }

/** The fields every player reads, per control. */
const signature = (e: { ef?: Control[] }) =>
  (e.ef ?? []).map((c) => ({ ty: c.ty, nm: c.nm, mn: c.mn, ix: c.ix }))

const asEffect = (e: unknown) => JSON.parse(JSON.stringify(e)) as Effect
const s = (k: unknown) => ({ a: 0, k }) as never
/** Stored value of control `i`. */
const kOf = (e: Effect, i: number) => (e.ef![i].v as { k: unknown }).k

/* ------------------------------ Test helpers ------------------------------ */

const namedList = (...names: string[]) => names.map((nm) => ({ ty: 25, nm }) as Effect)

/** Effect features `compat.ts` detects for a document with this one effect. */
const detected = (effect: J): FeatureId[] =>
  [...detectFeatures(doc([layer(1, { ef: [effect] })])).keys()].filter(
    (id) => id.startsWith('fx.') && id !== 'fx.any',
  )

const codes = (effect: Effect, masks = 0) =>
  effectIssues(effect, {
    masksProperties: Array.from({ length: masks }, () => ({}) as never),
  }).map((i) => i.code)

function withValue(effect: Effect, i: number, k: unknown): Effect {
  ;(effect.ef![i].v as { k: unknown }).k = k
  return effect
}

/** A stroke of one mask (All masks off). */
const strokeOfMask = (path: number) => withValue(withValue(createEffect('stroke'), 1, 0), 0, path)

function applyFix(effect: Effect, f: Parameters<typeof applyEffectFix>[2], masks = 0) {
  let changed = false
  const next = produce(layerWith(effect), (d) => {
    ;(d as Layer).masksProperties = Array.from({ length: masks }, () => ({}) as never)
    changed = applyEffectFix(d as Layer, 0, f, { center: [0, 0], masks })
  })
  return { effect: next.ef![0], changed }
}

/* -------------------------------------------------------------------------- */
/*                                  Factories                                 */
/* -------------------------------------------------------------------------- */

describe('createEffect', () => {
  it.each([
    ['dropShadow', AE_DROP_SHADOW],
    ['gaussianBlur', AE_GAUSSIAN_BLUR],
    ['fill', AE_FILL],
    ['stroke', AE_STROKE],
  ] as const)('builds %s exactly like After Effects + Bodymovin', (kind, exported) => {
    const effect = createEffect(kind)
    expect(effect.ty).toBe(exported.ty)
    expect(effect.mn).toBe(exported.mn)
    expect(signature(effect)).toEqual(signature(exported))
    if ('np' in exported) expect(effect.np).toBe(exported.np)
  })

  it('builds Tint like the export, without the button-only and GPU controls', () => {
    const effect = createEffect('tint')
    expect(signature(effect)).toEqual(signature(AE_TINT).slice(0, 3))
    expect(effect.np).toBe(6)
  })

  it.each(ADDABLE_EFFECTS)('writes %s in Bodymovin key order (ThorVG needs ty first)', (kind) => {
    const effect = createEffect(kind, { ix: 3 })
    expect(Object.keys(effect)).toEqual(['ty', 'nm', 'np', 'mn', 'ix', 'en', 'ef'])
    expect(effect.en).toBe(1)
    expect(effect.ix).toBe(3)
    effect.ef?.forEach((c, i) => {
      expect(Object.keys(c)).toEqual(['ty', 'nm', 'mn', 'ix', 'v'])
      expect(c.ix).toBe(i + 1)
      expect(Object.keys(c.v as object)).toEqual(['a', 'k', 'ix'])
      expect((c.v as { ix: number }).ix).toBe(i + 1)
      expect((c.v as { a: number }).a).toBe(0)
    })
    // Plain JSON: survives serialization unchanged.
    expect(JSON.parse(JSON.stringify(effect))).toEqual(effect)
  })

  it.each(ADDABLE_EFFECTS)('%s has np = controls + 2 (After Effects numProperties)', (kind) => {
    const def = EFFECT_DEFS[kind]
    // Tint has a button-only control (no value) that Bodymovin exports without a value.
    expect(def.np).toBe(def.params.length + 2 + (kind === 'tint' ? 1 : 0))
  })

  const reads: Record<string, { color?: number[]; number?: number[]; point?: number[] }> = {
    // Indices lottie-web's SVG filters read (lottie.js SVGEffects).
    fill: { color: [2], number: [6] },
    tint: { color: [0, 1], number: [2] },
    tritone: { color: [0, 1, 2] },
    dropShadow: { color: [0], number: [1, 2, 3, 4] },
    gaussianBlur: { number: [0, 1, 2] },
    stroke: { color: [3], number: [0, 1, 4, 6, 7, 8, 9, 10] },
    transform: { point: [0, 1], number: [2, 3, 4, 5, 6, 7, 8] },
  }

  it.each(ADDABLE_EFFECTS)('%s has the value types lottie-web reads by position', (kind) => {
    const effect = createEffect(kind, { context: { center: [50, 40], masks: 1 } })
    const r = reads[kind]
    for (const i of r.color ?? []) {
      expect(kOf(effect, i)).toHaveLength(4)
      expect((kOf(effect, i) as number[]).every((c) => c >= 0 && c <= 1)).toBe(true)
    }
    for (const i of r.number ?? []) expect(typeof kOf(effect, i)).toBe('number')
    for (const i of r.point ?? []) expect(kOf(effect, i)).toEqual([50, 40])
  })

  it('uses the English control names lottie-android and lottie-ios look up', () => {
    const names = createEffect('dropShadow').ef?.map((c) => c.nm)
    expect(names).toEqual([
      'Shadow Color',
      'Opacity',
      'Direction',
      'Distance',
      'Softness',
      'Shadow Only',
    ])
  })

  it('has defaults that render right away', () => {
    const shadow = createEffect('dropShadow')
    expect(kOf(shadow, 1)).toBeGreaterThan(0) // opacity
    expect(kOf(shadow, 3)).toBeGreaterThan(0) // distance
    expect(kOf(createEffect('gaussianBlur'), 0)).toBeGreaterThan(0)
    expect(kOf(createEffect('fill'), 6)).toBe(1)
    expect(kOf(createEffect('tint'), 2)).toBe(100)
  })

  it('points the stroke at the masks without ever selecting a missing one', () => {
    const withMasks = createEffect('stroke', { context: { center: [0, 0], masks: 2 } })
    const without = createEffect('stroke', { context: { center: [0, 0], masks: 0 } })
    expect(kOf(withMasks, 0)).toBe(1)
    expect(kOf(without, 0)).toBe(0)
    // "All masks" on: lottie-web never looks a single mask up.
    expect(kOf(withMasks, 1)).toBe(1)
    expect(kOf(without, 1)).toBe(1)
  })

  it('pivots the Transform effect at the layer center (identity by default)', () => {
    const effect = createEffect('transform', { context: { center: [256, 128], masks: 0 } })
    expect(kOf(effect, 0)).toEqual([256, 128])
    expect(kOf(effect, 1)).toEqual([256, 128])
    expect([2, 3, 4, 5, 6, 7, 8].map((i) => kOf(effect, i))).toEqual([1, 100, 100, 0, 0, 0, 100])
  })

  it('takes a name', () => {
    expect(createEffect('fill', { name: 'Заливка 2' }).nm).toBe('Заливка 2')
    expect(createEffect('fill').nm).toBe('Fill')
  })

  it('creates effects the validator has nothing to say about', () => {
    const effects = ADDABLE_EFFECTS.map((kind, i) => createEffect(kind, { ix: i + 1 }))
    const issues = validate(doc([layer(1, { ef: effects })]))
    expect(issues.filter((i) => i.code.startsWith('effect.'))).toEqual([])
  })

  it('returns fresh default values', () => {
    const p = EFFECT_DEFS.dropShadow.params[0]
    const a = paramDefault(p) as number[]
    a[0] = 9
    expect(paramDefault(p)).toEqual([0, 0, 0, 1])
  })
})

describe('effectDefOf', () => {
  it('finds effects by match name, else by type', () => {
    expect(effectDefOf({ ty: 25, mn: 'ADBE Drop Shadow' })?.kind).toBe('dropShadow')
    expect(effectDefOf({ ty: 25 })?.kind).toBe('dropShadow')
    expect(effectDefOf({ ty: 29, mn: 'Something else' })?.kind).toBe('gaussianBlur')
    // Generic effects need a match name.
    expect(effectDefOf({ ty: 5 })).toBeNull()
    expect(effectDefOf({ ty: 5, mn: 'ADBE Slider Control' })?.kind).toBe('sliderControl')
    expect(effectDefOf({ ty: 5, mn: 'ADBE Gaussian Blur 2' })?.kind).toBe('gaussianBlur')
    expect(effectDefOf({ ty: 34, mn: 'ADBE FreePin3' })).toBeNull()
    expect(effectDefOf(null)).toBeNull()
  })
})

describe('matchParams', () => {
  it('matches by match name, skipping controls without a value or unknown to the catalog', () => {
    const tint = asEffect(AE_TINT)
    const ids = matchParams(tint, EFFECT_DEFS.tint).map((p) => p?.id ?? null)
    expect(ids).toEqual(['mapBlackTo', 'mapWhiteTo', 'amount', null, null])
  })

  it('matches by position when the file has no match names (players read positions)', () => {
    const shadow: Effect = {
      ty: 25,
      ef: [
        { ty: 2, v: s([0, 0, 0, 1]) },
        { ty: 0, v: s(128) },
        { ty: 1, v: s(135) },
        { ty: 0, v: s(10) },
        { ty: 0, v: s(7) },
      ],
    }
    const ids = matchParams(shadow, EFFECT_DEFS.dropShadow).map((p) => p?.id)
    expect(ids).toEqual(['color', 'opacity', 'direction', 'distance', 'softness'])
  })

  it('rejects a parameter whose value does not fit (odd exporters)', () => {
    // A color stored where the stroke's mask index belongs.
    const stroke: Effect = {
      ty: 22,
      ef: [{ ty: 2, nm: 'Color', mn: 'ADBE Stroke-0001', v: s([1, 0.5, 0, 1]) }],
    }
    expect(matchParams(stroke, EFFECT_DEFS.stroke)).toEqual([null])
  })

  it('handles missing and broken control lists', () => {
    expect(matchParams({ ty: 25 }, EFFECT_DEFS.dropShadow)).toEqual([])
    expect(matchParams({ ty: 25, ef: [null as never] }, EFFECT_DEFS.dropShadow)).toEqual([null])
  })
})

describe('uniqueEffectName', () => {
  it('numbers names like After Effects', () => {
    expect(uniqueEffectName([], 'Drop Shadow')).toBe('Drop Shadow')
    expect(uniqueEffectName(namedList('Drop Shadow'), 'Drop Shadow')).toBe('Drop Shadow 2')
    expect(uniqueEffectName(namedList('Drop Shadow', 'Drop Shadow 4'), 'Drop Shadow')).toBe(
      'Drop Shadow 5',
    )
    expect(uniqueEffectName(namedList('Fill'), 'Drop Shadow')).toBe('Drop Shadow')
  })

  it('continues a numbered name', () => {
    expect(uniqueEffectName(namedList('Blur', 'Blur 2'), 'Blur 2')).toBe('Blur 3')
    expect(uniqueEffectName(namedList(' Blur '), 'Blur')).toBe('Blur 2')
    expect(uniqueEffectName(namedList('a+b'), 'a+b')).toBe('a+b 2')
  })
})

/* -------------------------------------------------------------------------- */
/*                             Structural editing                             */
/* -------------------------------------------------------------------------- */

function layerWith(...effects: Effect[]): Layer {
  return layer(1, { ef: effects }) as unknown as Layer
}

const named = (nm: string, ix = 1): Effect => ({ ...createEffect('fill', { ix }), nm })
const names = (l: Layer) => (l.ef ?? []).map((e) => e.nm)
const ixs = (l: Layer) => (l.ef ?? []).map((e) => e.ix)

describe('structural edits (on immer drafts)', () => {
  it('inserts effects and keeps ix = position + 1', () => {
    const base = layer(1) as unknown as Layer
    const next = produce(base, (draft) => {
      expect(insertEffect(draft as Layer, named('A'))).toBe(0)
      expect(insertEffect(draft as Layer, named('C'))).toBe(1)
      expect(insertEffect(draft as Layer, named('B'), 1)).toBe(1)
      expect(insertEffect(draft as Layer, named('Z'), 99)).toBe(3)
    })
    expect(names(next)).toEqual(['A', 'B', 'C', 'Z'])
    expect(ixs(next)).toEqual([1, 2, 3, 4])
    expect(base.ef).toBeUndefined()
  })

  it('removes effects and drops the empty list', () => {
    const base = layerWith(named('A', 1), named('B', 2))
    const one = produce(base, (d) => void removeEffect(d as Layer, 0))
    expect(names(one)).toEqual(['B'])
    expect(ixs(one)).toEqual([1])
    const none = produce(one, (d) => void removeEffect(d as Layer, 0))
    expect(none.ef).toBeUndefined()
    expect(produce(base, (d) => void removeEffect(d as Layer, 5))).toBe(base)
  })

  it('moves effects', () => {
    const base = layerWith(named('A', 1), named('B', 2), named('C', 3))
    const down = produce(base, (d) => void moveEffect(d as Layer, 0, 2))
    expect(names(down)).toEqual(['B', 'C', 'A'])
    expect(ixs(down)).toEqual([1, 2, 3])
    const up = produce(base, (d) => void moveEffect(d as Layer, 2, 0))
    expect(names(up)).toEqual(['C', 'A', 'B'])
    // Clamped target; no-ops leave the document untouched.
    expect(names(produce(base, (d) => void moveEffect(d as Layer, 0, 10)))).toEqual(['B', 'C', 'A'])
    expect(produce(base, (d) => void moveEffect(d as Layer, 1, 1))).toBe(base)
    expect(produce(base, (d) => void moveEffect(d as Layer, 7, 0))).toBe(base)
  })

  it('duplicates a draft effect as an independent deep copy', () => {
    const animated = createEffect('dropShadow', { ix: 1 })
    ;(animated.ef![3].v as { k: unknown }).k = [
      { t: 0, s: [0], o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } },
      { t: 30, s: [40] },
    ]
    ;(animated.ef![3].v as { x?: string }).x = 'value * 2'
    ;(animated.ef![0].v as { sid?: string }).sid = 'shadow'
    const base = layerWith(animated, named('Other', 2))
    let at = -1
    const next = produce(base, (d) => {
      at = duplicateEffect(d as Layer, 0)
    })
    expect(at).toBe(1)
    expect(names(next)).toEqual(['Drop Shadow', 'Drop Shadow 2', 'Other'])
    expect(ixs(next)).toEqual([1, 2, 3])
    const [a, b] = next.ef!
    expect(b.ef).toEqual(a.ef)
    expect(b.ef).not.toBe(a.ef)
    expect(b.ef![3].v).not.toBe(a.ef![3].v)
    // Editing the copy leaves the original alone.
    const edited = produce(next, (d) => {
      ;(d.ef![1].ef![3].v as { k: { s: number[] }[] }).k[1].s = [99]
    })
    expect((edited.ef![0].ef![3].v as { k: { s: number[] }[] }).k[1].s).toEqual([40])
    expect(produce(base, (d) => void duplicateEffect(d as Layer, 9))).toBe(base)
  })

  it('duplicates with a given name', () => {
    const next = produce(layerWith(named('A')), (d) => void duplicateEffect(d as Layer, 0, 'Copy'))
    expect(names(next)).toEqual(['A', 'Copy'])
  })

  it('renames, ignoring blank names', () => {
    const base = layerWith(named('A'))
    expect(names(produce(base, (d) => void renameEffect(d as Layer, 0, '  Glow  ')))).toEqual([
      'Glow',
    ])
    expect(produce(base, (d) => void renameEffect(d as Layer, 0, '   '))).toBe(base)
    expect(produce(base, (d) => void renameEffect(d as Layer, 3, 'X'))).toBe(base)
  })

  it('enables and disables', () => {
    const base = layerWith(named('A'))
    const off = produce(base, (d) => void setEffectEnabled(d as Layer, 0, false))
    expect(off.ef![0].en).toBe(0)
    expect(produce(off, (d) => void setEffectEnabled(d as Layer, 0, false))).toBe(off)
    expect(produce(off, (d) => void setEffectEnabled(d as Layer, 0, true)).ef![0].en).toBe(1)
  })
})

describe('resetEffect', () => {
  it('restores defaults, keeping expressions, slot ids and unknown controls', () => {
    const tint = asEffect(AE_TINT)
    ;(tint.ef![0].v as { sid?: string }).sid = 'black'
    ;(tint.ef![1].v as { x?: string }).x = 'thisComp.layer(1)'
    ;(tint.ef![2].v as { k: unknown; a: number }).k = [
      { t: 0, s: [0] },
      { t: 10, s: [50] },
    ]
    ;(tint.ef![2].v as { a: number }).a = 1
    const next = produce(layerWith(tint), (d) => void resetEffect(d as Layer, 0))
    const ef = next.ef![0].ef!
    expect(ef[0].v).toEqual({ a: 0, k: [0, 0, 0, 1], ix: 1, sid: 'black' })
    expect(ef[1].v).toEqual({ a: 0, k: [1, 1, 1, 1], ix: 2, x: 'thisComp.layer(1)' })
    expect(ef[2].v).toEqual({ a: 0, k: 100, ix: 3 })
    // The button-only and GPU controls are not the catalog's business.
    expect(ef[3]).toEqual(AE_TINT.ef[3])
    expect(ef[4]).toEqual(AE_TINT.ef[4])
  })

  it('uses the layer context and reports no-ops', () => {
    const base = layerWith(createEffect('transform', { context: { center: [1, 2], masks: 0 } }))
    const next = produce(base, (d) => void resetEffect(d as Layer, 0, { center: [5, 6], masks: 0 }))
    expect((next.ef![0].ef![0].v as { k: unknown }).k).toEqual([5, 6])
    let changed = true
    produce(next, (d) => {
      changed = resetEffect(d as Layer, 0, { center: [5, 6], masks: 0 })
    })
    expect(changed).toBe(false)
  })

  it('refuses unknown effects', () => {
    const puppet = { ty: 34, mn: 'ADBE FreePin3', ef: [{ ty: 0, v: s(20) }] } as Effect
    let changed = true
    produce(layerWith(puppet), (d) => {
      changed = resetEffect(d as Layer, 0)
    })
    expect(changed).toBe(false)
  })
})

describe('remapEffectPath', () => {
  const layerPath = ['assets', 0, 'layers', 2]
  const at = (i: number, ...rest: (string | number)[]) => [...layerPath, 'ef', i, ...rest]

  it('follows removals, insertions and moves', () => {
    const p = at(2, 'ef', 1, 'v')
    expect(remapEffectPath(p, layerPath, effectIndexMaps.remove(2))).toBeNull()
    expect(remapEffectPath(p, layerPath, effectIndexMaps.remove(0))).toEqual(at(1, 'ef', 1, 'v'))
    expect(remapEffectPath(p, layerPath, effectIndexMaps.remove(3))).toBe(p)
    expect(remapEffectPath(p, layerPath, effectIndexMaps.insert(1))).toEqual(at(3, 'ef', 1, 'v'))
    expect(remapEffectPath(p, layerPath, effectIndexMaps.insert(3))).toBe(p)
    expect(remapEffectPath(p, layerPath, effectIndexMaps.move(2, 0))).toEqual(at(0, 'ef', 1, 'v'))
    expect(remapEffectPath(p, layerPath, effectIndexMaps.move(0, 2))).toEqual(at(1, 'ef', 1, 'v'))
    expect(remapEffectPath(p, layerPath, effectIndexMaps.move(3, 1))).toEqual(at(3, 'ef', 1, 'v'))
  })

  it('leaves other paths alone', () => {
    const map = effectIndexMaps.remove(0)
    const other = ['assets', 0, 'layers', 3, 'ef', 0, 'ef', 0, 'v']
    expect(remapEffectPath(other, layerPath, map)).toBe(other)
    const list = [...layerPath, 'ef']
    expect(remapEffectPath(list, layerPath, map)).toBe(list)
    const transform = [...layerPath, 'ks', 'o']
    expect(remapEffectPath(transform, layerPath, map)).toBe(transform)
  })

  it('maps every index consistently for a move', () => {
    const order = ['A', 'B', 'C', 'D', 'E']
    for (let from = 0; from < order.length; from++) {
      for (let to = 0; to < order.length; to++) {
        const moved = [...order]
        const [x] = moved.splice(from, 1)
        moved.splice(to, 0, x)
        const map = effectIndexMaps.move(from, to)
        order.forEach((name, i) => expect(moved[map(i) as number]).toBe(name))
      }
    }
  })
})

/* -------------------------------------------------------------------------- */
/*                                   Support                                  */
/* -------------------------------------------------------------------------- */

describe('effectFeature', () => {
  it.each([20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 34, 35, 99])(
    'agrees with compat.ts for ty %i',
    (ty) => {
      const effect = { ty, ef: [] }
      expect([effectFeature(effect)]).toEqual(detected(effect))
    },
  )

  it('tells expression controls from visual effects saved as generic effects', () => {
    expect(effectFeature({ ty: 5, mn: 'ADBE Slider Control' })).toBe('fx.expressionControls')
    expect(effectFeature({ ty: 5, mn: 'Pseudo/MDS Elastic Controller' })).toBe(
      'fx.expressionControls',
    )
    expect(effectFeature({ ty: 5 })).toBe('fx.expressionControls')
    expect(effectFeature({ ty: 5, mn: 'ADBE Bulge' })).toBe('fx.skottieOnly')
    expect(effectFeature({ ty: 5, mn: 'ADBE Gaussian Blur 2' })).toBe('fx.skottieOnly')
    expect(effectFeature({ ty: 5, mn: 'ADBE Simple Choker' })).toBe('fx.unknown')
  })

  it('reports support per general-purpose player', () => {
    const support = effectSupport({ ty: 25, mn: 'ADBE Drop Shadow' })
    expect(support.feature).toBe('fx.dropShadow')
    expect(support.players.map((p) => p.player)).toEqual([...TARGETS.all])
    expect(support.players.find((p) => p.player === 'web-svg')?.level).toBe('y')
    expect(support.players.find((p) => p.player === 'web-canvas')?.level).toBe('n')
    expect(support.level).toBe('n')
    expect(effectSupport({ ty: 5, mn: 'ADBE Slider Control' }).level).toBe('y')
  })

  it('knows what the preview renders', () => {
    for (const kind of ADDABLE_EFFECTS) expect(rendersInPreview(createEffect(kind))).toBe(true)
    expect(rendersInPreview({ ty: 5 })).toBe(false)
    expect(rendersInPreview({ ty: 34 })).toBe(false)
  })
})

describe('effectIssues', () => {
  it('finds nothing wrong with new effects', () => {
    for (const kind of ADDABLE_EFFECTS) {
      if (kind === 'stroke') continue
      expect(codes(createEffect(kind))).toEqual([])
    }
    expect(codes(createEffect('stroke', { context: { center: [0, 0], masks: 1 } }), 1)).toEqual([])
  })

  it('flags effects without controls (lottie-web cannot load them)', () => {
    expect(codes({ ty: 25, en: 1 })).toEqual(['noControls'])
  })

  it('flags strokes of missing masks and strokes without masks', () => {
    expect(codes(strokeOfMask(0), 1)).toEqual(['missingMask'])
    expect(codes(strokeOfMask(2), 1)).toEqual(['missingMask'])
    expect(codes(strokeOfMask(1), 1)).toEqual([])
    expect(codes(createEffect('stroke'), 0)).toEqual(['noMasks'])
    expect(effectIssues(strokeOfMask(0), {})[0]).toEqual({
      code: 'missingMask',
      severity: 'error',
      fix: 'strokeAllMasks',
    })
  })

  it('flags disabled effects that web players still draw', () => {
    expect(codes({ ...createEffect('dropShadow'), en: 0 })).toEqual(['disabledStillRendered'])
    expect(codes({ ...createEffect('sliderControl'), en: 0 })).toEqual([])
  })

  it('flags effects dotLottie players skip for lack of an enabled flag', () => {
    const { en: _en, ...shadow } = createEffect('dropShadow')
    expect(codes(shadow as Effect)).toEqual(['enabledMissing'])
    const { en: _en2, ...transform } = createEffect('transform')
    expect(codes(transform as Effect)).toEqual([])
  })

  it('flags known effects saved as generic ones, with a fix only when positions line up', () => {
    const generic = { ...asEffect(AE_GAUSSIAN_BLUR), ty: 5 }
    expect(effectIssues(generic, {})).toEqual([
      { code: 'genericType', severity: 'warning', fix: 'setType' },
    ])
    const shuffled = { ...generic, ef: [...generic.ef!].reverse() }
    expect(effectIssues(shuffled, {})).toEqual([
      { code: 'genericType', severity: 'warning', fix: undefined },
    ])
  })

  it('flags drop shadows exported from a localized After Effects', () => {
    const russian = asEffect(AE_DROP_SHADOW)
    const ru = [
      'Цвет тени',
      'Непрозрачность',
      'Направление',
      'Расстояние',
      'Мягкость',
      'Только тень',
    ]
    russian.ef!.forEach((c, i) => (c.nm = ru[i]))
    expect(codes(russian)).toEqual(['localizedNames'])
    expect(codes(asEffect(AE_DROP_SHADOW))).toEqual([])
    // Players that look names up only render drop shadows with ty 25.
    expect(codes({ ...russian, ty: 5 })).toEqual(['genericType'])
  })
})

describe('applyEffectFix', () => {
  it('adds the controls of known effects, or an empty list', () => {
    expect(applyFix({ ty: 25, nm: 'Shadow', en: 1 }, 'addControls').effect.ef).toEqual(
      createEffect('dropShadow').ef,
    )
    expect(applyFix({ ty: 34, en: 1 }, 'addControls').effect.ef).toEqual([])
    expect(applyFix(createEffect('fill'), 'addControls').changed).toBe(false)
  })

  it('enables, retypes, renames and strokes all masks', () => {
    const { en: _en, ...shadow } = createEffect('dropShadow')
    expect(applyFix(shadow as Effect, 'enable').effect.en).toBe(1)
    expect(applyFix({ ...asEffect(AE_GAUSSIAN_BLUR), ty: 5 }, 'setType').effect.ty).toBe(29)
    const shuffled = asEffect(AE_GAUSSIAN_BLUR)
    shuffled.ef!.reverse()
    expect(applyFix({ ...shuffled, ty: 5 }, 'setType').changed).toBe(false)
    const russian = asEffect(AE_DROP_SHADOW)
    russian.ef![0].nm = 'Цвет тени'
    const renamed = applyFix(russian, 'englishNames').effect
    expect(renamed.ef!.map((c) => c.nm)).toEqual(AE_DROP_SHADOW.ef.map((c) => c.nm))
    expect(effectIssues(renamed, {})).toEqual([])
    const stroke = createEffect('stroke')
    ;(stroke.ef![1].v as { k: number }).k = 0
    const fixed = applyFix(stroke, 'strokeAllMasks', 1).effect
    expect((fixed.ef![1].v as { k: number }).k).toBe(1)
    expect(effectIssues(fixed, { masksProperties: [{} as never] })).toEqual([])
  })
})

/* -------------------------------------------------------------------------- */
/*                                   Context                                  */
/* -------------------------------------------------------------------------- */

describe('effectContext', () => {
  const anim = doc(
    [
      layer(1, { ty: 1, sw: 200, sh: 100, sc: '#ff0000' }),
      layer(2, { ty: 0, refId: 'comp', w: 300, h: 150 }),
      layer(3, { ty: 2, refId: 'img' }),
      layer(4, { masksProperties: [{}, {}] }),
      layer(5, {
        ks: {
          a: {
            a: 1,
            k: [
              { t: 0, s: [12.34567, 8] },
              { t: 10, s: [0, 0] },
            ],
          },
        },
      }),
    ],
    {
      assets: [
        { id: 'comp', layers: [] },
        { id: 'img', w: 64, h: 32, p: 'x.png', u: '' },
      ],
    },
  ) as Animation

  it('centers on the layer source, or on the anchor point', () => {
    expect(effectContext(anim, ['layers', 0]).center).toEqual([100, 50])
    expect(effectContext(anim, ['layers', 1]).center).toEqual([150, 75])
    expect(effectContext(anim, ['layers', 2]).center).toEqual([32, 16])
    expect(effectContext(anim, ['layers', 4]).center).toEqual([12.346, 8])
    expect(effectContext(anim, ['layers', 9])).toEqual({ center: [0, 0], masks: 0 })
  })

  it('counts masks', () => {
    expect(effectContext(anim, ['layers', 3]).masks).toBe(2)
    expect(effectContext(anim, ['layers', 0]).masks).toBe(0)
  })

  it('knows which layers take effects', () => {
    expect(canHaveEffects({ ty: 4 })).toBe(true)
    expect(canHaveEffects({ ty: 3 })).toBe(true)
    expect(canHaveEffects({ ty: 13 } as never)).toBe(false)
    expect(canHaveEffects({ ty: 6 } as never)).toBe(false)
    expect(canHaveEffects(null)).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/*                              Real-world files                              */
/* -------------------------------------------------------------------------- */

describe('real-world files', () => {
  it('reads the pseudo effect of docs/test.json as expression controls', () => {
    const effect = (JSON.parse(testJson) as Animation).layers[17].ef![0]
    expect(effect.mn).toBe('Pseudo/MDS Elastic Controller')
    expect(effectDefOf(effect)).toBeNull()
    expect(effectFeature(effect)).toBe('fx.expressionControls')
    expect(effectIssues(effect, {})).toEqual([])
  })

  it('reads the Russian puppet effect of docs/wallet_flag.json as unsupported', () => {
    const effect = (JSON.parse(walletJson) as Animation).layers[9].ef![0]
    expect(effect.nm).toBe('Марионетка')
    expect(effectFeature(effect)).toBe('fx.unknown')
    expect(effectSupport(effect).players.every((p) => p.level === 'n')).toBe(true)
  })

  it.each(Object.keys(EFFECT_DEFS) as EffectKind[])('%s round-trips its own defaults', (kind) => {
    const effect = createEffect(kind, { context: { center: [3, 4], masks: 1 } })
    const matched = matchParams(effect, EFFECT_DEFS[kind])
    expect(matched.map((p) => p?.id)).toEqual(EFFECT_DEFS[kind].params.map((p) => p.id))
  })
})
