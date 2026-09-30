import { beforeEach, describe, expect, it } from 'vitest'
import { createEffect } from '@/lottie/effects'
import type { AnyProperty } from '@/lottie/property'
import type { Animation, Effect, Layer } from '@/lottie/types'
import {
  getDoc,
  loadDocument,
  selectKeyframes,
  setSelection,
  undo,
  useDocument,
} from '@/store/document'
import { holdKeyframes, toggleKeys, writeValue } from '../edit'
import {
  addEffect,
  canAddEffect,
  duplicateEffectAt,
  fixEffectAt,
  moveEffectTo,
  removeAllEffects,
  removeEffectAt,
  renameEffectAt,
  resetEffectAt,
  setEffectEnabledAt,
} from '../effects-actions'
import { useInspectorRequests } from '../state'

const layerPath = ['layers', 0]
const box = {
  inv: false,
  mode: 'a',
  pt: {
    a: 0,
    k: { i: [[0, 0]], o: [[0, 0]], v: [[0, 0]], c: true },
  },
}

const layer = (ind: number, extra: Partial<Layer> = {}) =>
  ({
    ty: 4,
    ind,
    nm: `Layer ${ind}`,
    ip: 0,
    op: 60,
    st: 0,
    shapes: [],
    ks: { a: { a: 0, k: [10, 20, 0] }, p: { a: 0, k: [50, 50, 0] } },
    ...extra,
  }) as Layer

function fixture(): Animation {
  return {
    v: '5.12.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers: [
      layer(1),
      layer(2, { masksProperties: [box as never] }),
      { ty: 13, ind: 3, nm: 'Camera', ip: 0, op: 60, st: 0, ks: {} } as unknown as Layer,
    ],
  }
}

const effects = (path = layerPath): Effect[] =>
  ((getDoc()!.layers[path[1] as number] as Layer).ef ?? []) as Effect[]
const names = (path = layerPath) => effects(path).map((e) => e.nm)
const ixs = (path = layerPath) => effects(path).map((e) => e.ix)
const history = () => useDocument.getState().past.length
const valueOf = (effect: Effect, i: number) => (effect.ef![i].v as { k: unknown }).k

beforeEach(() => {
  loadDocument(fixture(), { fileName: 'effects.json' })
})

describe('adding effects', () => {
  it('adds a named, numbered effect as one undo step and asks the inspector to reveal it', () => {
    const before = history()
    expect(addEffect([layerPath], 'dropShadow')).toBe(0)
    expect(addEffect([layerPath], 'dropShadow')).toBe(1)
    expect(names()).toEqual(['Drop Shadow', 'Drop Shadow 2'])
    expect(ixs()).toEqual([1, 2])
    expect(history()).toBe(before + 2)
    expect(useInspectorRequests.getState().revealEffect).toMatchObject({
      layer: 'layers/0',
      index: 1,
    })
    undo()
    expect(names()).toEqual(['Drop Shadow'])
  })

  it('pivots a new Transform effect at the layer anchor point', () => {
    addEffect([layerPath], 'transform')
    expect(valueOf(effects()[0], 0)).toEqual([10, 20])
    expect(valueOf(effects()[0], 1)).toEqual([10, 20])
  })

  it('adds to every selected layer that takes the effect in one step', () => {
    const before = history()
    addEffect([layerPath, ['layers', 1], ['layers', 2]], 'fill')
    expect(history()).toBe(before + 1)
    expect(names()).toEqual(['Fill'])
    expect(names(['layers', 1])).toEqual(['Fill'])
    // Cameras take no effects.
    expect((getDoc()!.layers[2] as Layer).ef).toBeUndefined()
  })

  it('only strokes layers with masks', () => {
    const doc = getDoc()
    expect(canAddEffect(doc, layerPath, 'stroke')).toBe(false)
    expect(canAddEffect(doc, ['layers', 1], 'stroke')).toBe(true)
    expect(canAddEffect(doc, ['layers', 2], 'fill')).toBe(false)
    expect(canAddEffect(doc, ['layers', 0, 'shapes', 0], 'fill')).toBe(false)
    expect(addEffect([layerPath], 'stroke')).toBe(-1)
    expect(addEffect([['layers', 1]], 'stroke')).toBe(0)
    const stroke = effects(['layers', 1])[0]
    expect((stroke.ef![0].v as { k: number }).k).toBe(1)
  })
})

describe('editing effects', () => {
  beforeEach(() => {
    for (const kind of ['fill', 'tint', 'gaussianBlur'] as const) addEffect([layerPath], kind)
  })

  it('moves, duplicates, renames and deletes, one undo step each, keeping ix consistent', () => {
    const before = history()
    moveEffectTo(layerPath, 0, 2)
    expect(names()).toEqual(['Tint', 'Gaussian Blur', 'Fill'])
    duplicateEffectAt(layerPath, 0)
    expect(names()).toEqual(['Tint', 'Tint 2', 'Gaussian Blur', 'Fill'])
    renameEffectAt(layerPath, 1, 'Warm')
    removeEffectAt(layerPath, 2)
    expect(names()).toEqual(['Tint', 'Warm', 'Fill'])
    expect(ixs()).toEqual([1, 2, 3])
    expect(history()).toBe(before + 4)
    undo()
    expect(names()).toEqual(['Tint', 'Warm', 'Gaussian Blur', 'Fill'])
  })

  it('keeps selected keyframes and the focused property on their effect', () => {
    const opacity = [...layerPath, 'ef', 0, 'ef', 6, 'v']
    const blur = [...layerPath, 'ef', 2, 'ef', 0, 'v']
    // Animate Fill opacity so a keyframe can be selected.
    toggleKeys('animate', [{ path: opacity, frame: 0 }], 'static')
    selectKeyframes([{ path: opacity, index: 0 }])
    setSelection((s) => ({ ...s, property: blur }))

    moveEffectTo(layerPath, 0, 2) // Fill → last
    let sel = useDocument.getState().selection
    expect(sel.keyframes).toEqual([{ path: [...layerPath, 'ef', 2, 'ef', 6, 'v'], index: 0 }])
    expect(sel.property).toEqual([...layerPath, 'ef', 1, 'ef', 0, 'v'])

    duplicateEffectAt(layerPath, 0) // Tint copy at 1: Blur and Fill shift down
    sel = useDocument.getState().selection
    expect(sel.keyframes[0].path).toEqual([...layerPath, 'ef', 3, 'ef', 6, 'v'])
    expect(sel.property).toEqual([...layerPath, 'ef', 2, 'ef', 0, 'v'])

    removeEffectAt(layerPath, 3) // Fill goes: its keyframe selection goes with it
    sel = useDocument.getState().selection
    expect(sel.keyframes).toEqual([])
    expect(sel.property).toEqual([...layerPath, 'ef', 2, 'ef', 0, 'v'])
  })

  it('turns effects off and on, resets and fixes them', () => {
    setEffectEnabledAt(layerPath, 1, false)
    expect(effects()[1].en).toBe(0)
    const amount = [...layerPath, 'ef', 1, 'ef', 2, 'v']
    toggleKeys('animate', [{ path: amount, frame: 10 }], 'static')
    resetEffectAt(layerPath, 1)
    expect(effects()[1].ef![2].v).toMatchObject({ a: 0, k: 100 })
    // A generic copy of a known effect gets its real type back.
    useDocument.setState((s) => {
      const doc = structuredClone(s.doc) as Animation
      ;(doc.layers[0] as Layer).ef![2].ty = 5
      return { doc }
    })
    fixEffectAt(layerPath, 2, 'setType')
    expect(effects()[2].ty).toBe(29)
  })

  it('removes all effects of the selected layers', () => {
    addEffect([['layers', 1]], 'tint')
    selectKeyframes([])
    setSelection((s) => ({ ...s, property: [...layerPath, 'ef', 0, 'ef', 2, 'v'] }))
    const before = history()
    removeAllEffects([layerPath, ['layers', 1]])
    expect(history()).toBe(before + 1)
    expect((getDoc()!.layers[0] as Layer).ef).toBeUndefined()
    expect((getDoc()!.layers[1] as Layer).ef).toBeUndefined()
    expect(useDocument.getState().selection.property).toBeNull()
  })
})

describe('discrete values', () => {
  it('holds every keyframe of checkbox and menu parameters', () => {
    addEffect([layerPath], 'gaussianBlur')
    const dims = [...layerPath, 'ef', 0, 'ef', 1, 'v']
    toggleKeys('animate', [{ path: dims, frame: 0 }], 'static', true)
    toggleKeys('add', [{ path: dims, frame: 20 }], 'animated', true)
    const keys = (effects()[0].ef![1].v as AnyProperty & { k: { h?: number }[] }).k
    expect(keys.map((k) => k.h)).toEqual([1, 1])
  })

  it('holdKeyframes leaves static values alone', () => {
    const p: AnyProperty = { a: 0, k: 1 }
    holdKeyframes(p)
    expect(p).toEqual({ a: 0, k: 1 })
    const animated: AnyProperty = {
      a: 1,
      k: [
        { t: 0, s: [1] },
        { t: 5, s: [2] },
      ],
    }
    writeValue(animated, 10, 3)
    holdKeyframes(animated)
    expect((animated.k as { h?: number }[]).every((k) => k.h === 1)).toBe(true)
  })

  it('creates effects the same way as the catalog', () => {
    addEffect([layerPath], 'dropShadow')
    const { ef: made } = effects()[0]
    expect(made).toEqual(createEffect('dropShadow').ef)
  })
})
