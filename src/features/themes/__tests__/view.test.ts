import { describe, expect, it } from 'vitest'
import { listSlots } from '@/lottie/slots'
import type { Animation } from '@/lottie/types'
import type { ThemeInfo } from '../model'
import { colorsCss, slotView } from '../view'

const doc = {
  v: '5.12.2',
  fr: 30,
  ip: 0,
  op: 60,
  w: 100,
  h: 100,
  slots: {
    bg: { p: { a: 0, k: [1, 0, 0] } },
    anim: {
      p: {
        a: 1,
        k: [
          { t: 0, s: [0, 0, 1], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } },
          { t: 10, s: [0, 1, 0] },
        ],
      },
    },
  },
  layers: [
    {
      ty: 4,
      ind: 1,
      ip: 0,
      op: 60,
      st: 0,
      ks: { o: { a: 0, k: 100, sid: 'alpha' }, s: { a: 0, k: [100, 100], sid: 'size' } },
      shapes: [
        { ty: 'fl', c: { a: 0, k: [1, 0, 0], sid: 'bg' }, o: { a: 0, k: 100 } },
        {
          ty: 'st',
          c: { a: 0, k: [0, 0, 1], sid: 'anim' },
          o: { a: 0, k: 100 },
          w: { a: 0, k: 1 },
        },
        {
          ty: 'gf',
          t: 1,
          s: { a: 0, k: [0, 0] },
          e: { a: 0, k: [1, 0] },
          o: { a: 0, k: 100 },
          g: { p: 1, k: { a: 0, k: [0, 1, 1, 1] }, sid: 'grad' },
        },
      ],
    },
  ],
} as unknown as Animation

const slots = listSlots(doc)
const slot = (id: string) => slots.find((s) => s.id === id)!
const theme = (rules: ThemeInfo['rules']): ThemeInfo => ({ id: 'dark', name: 'Dark', rules })

describe('slotView', () => {
  it('shows default values for Default', () => {
    expect(slotView(slot('bg'), null, null)).toMatchObject({
      value: { type: 'color', color: { r: 1, g: 0, b: 0, a: 1 } },
      overridden: false,
      inherited: false,
    })
    expect(slotView(slot('anim'), null, null).value).toEqual({
      type: 'animated',
      colors: [
        { r: 0, g: 0, b: 1, a: 1 },
        { r: 0, g: 1, b: 0, a: 1 },
      ],
    })
    expect(slotView(slot('alpha'), null, null).value).toEqual({ type: 'number', value: 100 })
    expect(slotView(slot('size'), null, null).value).toEqual({ type: 'vector', value: [100, 100] })
    expect(slotView(slot('grad'), null, null).value).toEqual({ type: 'other', kind: 'gradient' })
  })

  it('shows theme values, or the inherited default', () => {
    const dark = theme([
      { id: 'bg', type: 'Color', value: [0, 0, 0] },
      { id: 'alpha', type: 'Scalar', value: 40 },
      { id: 'size', type: 'Vector', value: [50, 60] },
      { id: 'anim', type: 'Color', keyframes: [{ frame: 0, value: [1, 1, 1] }] },
    ])
    expect(slotView(slot('bg'), dark, null)).toMatchObject({
      value: { type: 'color', color: { r: 0, g: 0, b: 0, a: 1 } },
      overridden: true,
      inherited: false,
    })
    expect(slotView(slot('alpha'), dark, null).value).toEqual({ type: 'number', value: 40 })
    expect(slotView(slot('size'), dark, null).value).toEqual({ type: 'vector', value: [50, 60] })
    // One keyframe is a constant color; two or more are animated.
    expect(slotView(slot('anim'), dark, null).value).toEqual({
      type: 'color',
      color: { r: 1, g: 1, b: 1, a: 1 },
    })
    const animated = theme([
      {
        id: 'anim',
        type: 'Color',
        keyframes: [
          { frame: 0, value: [1, 1, 1] },
          { frame: 9, value: [0, 0, 0] },
        ],
      },
    ])
    expect(slotView(slot('anim'), animated, null).value).toEqual({
      type: 'animated',
      colors: [
        { r: 1, g: 1, b: 1, a: 1 },
        { r: 0, g: 0, b: 0, a: 1 },
      ],
    })
    expect(slotView(slot('grad'), dark, null)).toMatchObject({
      overridden: false,
      inherited: true,
      sameAsDefault: true,
    })
  })

  it('tells values that look like Default from the ones a theme changes', () => {
    const light = theme([
      // 0.9999 is still 255 in 8 bits: the same color.
      { id: 'bg', type: 'Color', value: [0.9999, 0, 0] },
      { id: 'alpha', type: 'Scalar', value: 100 },
      { id: 'size', type: 'Vector', value: [100, 101] },
    ])
    expect(slotView(slot('bg'), light, null).sameAsDefault).toBe(true)
    expect(slotView(slot('alpha'), light, null).sameAsDefault).toBe(true)
    expect(slotView(slot('size'), light, null).sameAsDefault).toBe(false)
    expect(slotView(slot('bg'), null, null).sameAsDefault).toBe(false)
  })

  it('ignores rules of the wrong type or for other animations', () => {
    const odd = theme([
      { id: 'bg', type: 'Scalar', value: 3 },
      { id: 'alpha', type: 'Scalar', value: 1, animations: ['other'] },
    ])
    expect(slotView(slot('bg'), odd, 'main')).toMatchObject({
      value: { type: 'color' },
      overridden: true,
      inherited: false,
    })
    expect(slotView(slot('alpha'), odd, 'main')).toMatchObject({
      value: { type: 'number', value: 100 },
      inherited: true,
    })
  })
})

describe('colorsCss', () => {
  it('lays colors side by side', () => {
    expect(colorsCss([])).toBe('transparent')
    expect(colorsCss([{ r: 1, g: 0, b: 0, a: 1 }])).toBe('rgb(255 0 0)')
    expect(
      colorsCss([
        { r: 1, g: 0, b: 0, a: 1 },
        { r: 0, g: 0, b: 1, a: 1 },
      ]),
    ).toBe('linear-gradient(90deg, rgb(255 0 0) 0% 50%, rgb(0 0 255) 50% 100%)')
  })
})
