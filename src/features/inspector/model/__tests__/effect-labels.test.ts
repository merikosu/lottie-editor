import { describe, expect, it } from 'vitest'
import { getT } from '@/i18n'
import { createEffect } from '@/lottie/effects'
import type { Effect } from '@/lottie/types'
import { effectParamLabel, effectTypeLabel, namedAfterType } from '../effect-labels'

const t = getT()

describe('effect labels', () => {
  it('names effect types from the catalog, else from the type number', () => {
    expect(effectTypeLabel(createEffect('dropShadow'), t)).toBe('Drop shadow')
    expect(effectTypeLabel({ ty: 5, mn: 'ADBE Slider Control' }, t)).toBe('Slider control')
    expect(effectTypeLabel({ ty: 34, mn: 'ADBE FreePin3' }, t)).toBe('Puppet')
    expect(effectTypeLabel({ ty: 99 }, t)).toBeNull()
  })

  it('knows when a name only repeats the type', () => {
    const shadow = createEffect('dropShadow')
    const type = effectTypeLabel(shadow, t)
    expect(namedAfterType('Drop Shadow', shadow, type, t)).toBe(true)
    expect(namedAfterType('Drop Shadow 3', shadow, type, t)).toBe(true)
    expect(namedAfterType('Gaussian Blur2', createEffect('gaussianBlur'), 'Gaussian blur', t)).toBe(
      true,
    )
    expect(namedAfterType('Glow', shadow, type, t)).toBe(false)
    expect(namedAfterType('Тень', shadow, type, t)).toBe(false)
  })

  it('labels controls by match name', () => {
    const shadow: Effect = createEffect('dropShadow')
    shadow.ef!.forEach((c) => (c.nm = 'Параметр'))
    expect(effectParamLabel(shadow, 0, t)).toBe('Color')
    expect(effectParamLabel(shadow, 1, t)).toBe('Opacity')
    expect(effectParamLabel(shadow, 9, t)).toBeNull()
    expect(effectParamLabel({ ty: 34, ef: [] }, 0, t)).toBeNull()
  })
})
