import { describe, expect, it } from 'vitest'
import { createEffect } from '@/lottie/effects'
import type { Effect } from '@/lottie/types'
import { effectModel } from '../effects'

const s = (k: unknown) => ({ a: 0 as const, k }) as never

const summary = (effect: Effect) =>
  effectModel(effect, ['layers', 0, 'ef', 0]).params.map((p) => ({
    id: p.def?.id ?? null,
    ui: p.ui.kind,
    unused: p.unused,
  }))

describe('effectModel: unknown effects', () => {
  it('lists editable controls by type, with their value paths', () => {
    const effect: Effect = {
      ty: 30,
      nm: 'Twirl',
      ef: [
        { ty: 2, nm: 'Tint', v: s([0, 0, 0, 1]) },
        { ty: 0, nm: 'Amount', v: s(128) },
        { ty: 1, nm: 'Angle', v: s(135) },
        { ty: 3, nm: 'Center', v: s([0, 0]) },
        { ty: 3, nm: 'Center 3D', v: s([0, 0, 0]) },
        { ty: 4, nm: 'Flip', v: s(0) },
        { ty: 7, nm: 'Mode', v: s(1) },
        { ty: 10, nm: 'Source', v: s(0) },
        { ty: 11, nm: 'Mask', v: s(1) },
        { ty: 6, nm: 'Button', v: 0 as never },
      ],
    }
    const { def, params } = effectModel(effect, ['layers', 2, 'ef', 0])
    expect(def).toBeNull()
    expect(params.map((p) => [p.kind, p.ui.kind])).toEqual([
      ['color', 'color'],
      ['slider', 'number'],
      ['angle', 'angle'],
      ['point', 'point'],
      ['point', 'point'],
      ['checkbox', 'checkbox'],
      ['dropdown', 'number'],
      ['layer', 'layer'],
      ['mask', 'mask'],
    ])
    expect(params[0]).toMatchObject({
      name: 'Tint',
      path: ['layers', 2, 'ef', 0, 'ef', 0, 'v'],
      groups: [],
      def: null,
      unused: false,
    })
    expect(params[4].ui).toEqual({ kind: 'point', dims: 3 })
    // Built-in checkboxes are exported as menus: a menu value may be 0.
    expect(params[6].ui).toEqual({ kind: 'number', precision: 0, min: 0 })
  })

  it('flattens nested groups (whose type may look like a control) and skips values without a property', () => {
    const effect: Effect = {
      ty: 34,
      nm: 'Puppet',
      ef: [
        { ty: 7, nm: 'Engine', v: s(2) },
        {
          ty: 60,
          nm: 'arap',
          ef: [
            { ty: 6, nm: 'Outlines', v: 0 as never },
            { ty: 1, nm: 'Mesh', ef: [{ ty: 0, nm: 'Density', v: s(10) }] } as never,
          ],
        } as never,
      ],
    }
    const { params } = effectModel(effect, ['layers', 0, 'ef', 1])
    expect(params.map((p) => [p.name, p.path, p.groups])).toEqual([
      ['Engine', ['layers', 0, 'ef', 1, 'ef', 0, 'v'], []],
      ['Density', ['layers', 0, 'ef', 1, 'ef', 1, 'ef', 1, 'ef', 0, 'v'], ['arap', 'Mesh']],
    ])
  })

  it('skips values that fit no editor and handles effects without controls', () => {
    const effect: Effect = { ty: 30, ef: [{ ty: 2, nm: 'Broken', v: s([1, 0]) }] }
    expect(effectModel(effect, []).params).toEqual([])
    expect(effectModel({ ty: 29 }, []).params).toEqual([])
    const animated: Effect = {
      ty: 30,
      ef: [
        {
          ty: 0,
          nm: 'Amount',
          v: {
            a: 1,
            k: [
              { t: 0, s: [0] },
              { t: 10, s: [5] },
            ],
          } as never,
        },
      ],
    }
    expect(effectModel(animated, []).params[0].ui.kind).toBe('number')
  })
})

describe('effectModel: known effects', () => {
  it('uses the catalog for new effects', () => {
    expect(summary(createEffect('dropShadow'))).toEqual([
      { id: 'color', ui: 'color', unused: false },
      { id: 'opacity', ui: 'number', unused: false },
      { id: 'direction', ui: 'angle', unused: false },
      { id: 'distance', ui: 'number', unused: false },
      { id: 'softness', ui: 'number', unused: false },
      { id: 'shadowOnly', ui: 'checkbox', unused: false },
    ])
  })

  it('sets apart the parameters no player reads', () => {
    const fill = summary(createEffect('fill'))
    expect(fill.filter((p) => !p.unused).map((p) => p.id)).toEqual(['color', 'opacity'])
    expect(fill.filter((p) => p.unused)).toHaveLength(5)
    expect(summary(createEffect('stroke')).find((p) => p.id === 'path')?.ui).toBe('mask')
    expect(summary(createEffect('gaussianBlur')).map((p) => p.ui)).toEqual([
      'number',
      'menu',
      'checkbox',
    ])
  })

  it('treats extra controls of known effects as unused (players read the known ones)', () => {
    const tint: Effect = {
      ...createEffect('tint'),
      ef: [
        ...createEffect('tint').ef!,
        { ty: 6, nm: '', mn: 'ADBE Tint-0004', ix: 4, v: 0 as never },
        { ty: 7, nm: 'GPU Rendering', mn: 'ADBE Force CPU GPU', ix: 5, v: s(1) },
      ],
    }
    expect(summary(tint)).toEqual([
      { id: 'mapBlackTo', ui: 'color', unused: false },
      { id: 'mapWhiteTo', ui: 'color', unused: false },
      { id: 'amount', ui: 'number', unused: false },
      { id: null, ui: 'number', unused: true },
    ])
  })

  it('reads files from a localized After Effects by match name', () => {
    const shadow = createEffect('dropShadow')
    shadow.ef!.forEach((c, i) => (c.nm = `Параметр ${i}`))
    const { params } = effectModel(shadow, [])
    expect(params.map((p) => p.def?.id)).toEqual([
      'color',
      'opacity',
      'direction',
      'distance',
      'softness',
      'shadowOnly',
    ])
    expect(params[0].name).toBe('Параметр 0')
  })

  it('matches controls by position in files without match names', () => {
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
    expect(effectModel(shadow, []).params.map((p) => p.def?.id)).toEqual([
      'color',
      'opacity',
      'direction',
      'distance',
      'softness',
    ])
  })

  it('recognizes expression controls', () => {
    const checkbox = createEffect('checkboxControl')
    expect(summary(checkbox)).toEqual([{ id: 'checkbox', ui: 'checkbox', unused: false }])
    expect(summary(createEffect('layerControl'))).toEqual([
      { id: 'layer', ui: 'layer', unused: false },
    ])
  })
})
