import { beforeEach, describe, expect, it } from 'vitest'
import type { AnyProperty } from '@/lottie/property'
import type { Animation } from '@/lottie/types'
import { getDoc, loadDocument, undo, useDocument } from '@/store/document'
import {
  editProperties,
  keyStatus,
  neighbourKeys,
  propertyAt,
  readValue,
  removeAnimation,
  toggleKeys,
  writeValue,
  type PropTarget,
} from '../edit'

const linear = { o: { x: [0.167], y: [0.167] }, i: { x: [0.833], y: [0.833] } }

function fixture(): Animation {
  return {
    v: '5.12.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers: [
      {
        ty: 4,
        ip: 0,
        op: 60,
        st: 0,
        shapes: [],
        ks: {
          o: { a: 0, k: 100 },
          r: {
            a: 1,
            k: [
              { t: 0, s: [0], ...linear },
              { t: 20, s: [90] },
            ],
          },
          s: { a: 0, k: [100, 100, 100] },
          // Some exporters store static scalars as one-element arrays.
          sa: { a: 0, k: [0] as unknown as number },
        },
      },
      {
        ty: 4,
        ip: 0,
        op: 60,
        st: 0,
        shapes: [],
        ks: {
          // Legacy keyframes: the end value lives in `e`.
          p: {
            a: 1,
            k: [
              { t: 0, s: [0, 0], e: [100, 50], o: { x: 0.2, y: 0.2 }, i: { x: 0.8, y: 0.8 } },
              { t: 10 },
            ],
          },
        },
      },
    ],
  }
}

const target = (
  path: (string | number)[],
  frame: number,
  create?: () => AnyProperty,
): PropTarget => ({
  path,
  frame,
  create,
})
const prop = (path: (string | number)[]) => propertyAt(getDoc(), path)
const keys = (path: (string | number)[]) => (prop(path)?.k ?? []) as { t: number; s: number[] }[]

beforeEach(() => {
  loadDocument(fixture(), { fileName: 'test.json' })
})

describe('keyStatus / neighbourKeys', () => {
  it('reports static, animated and key states', () => {
    const r = ['layers', 0, 'ks', 'r']
    const o = ['layers', 0, 'ks', 'o']
    expect(keyStatus([prop(o)], [target(o, 5)])).toBe('static')
    expect(keyStatus([prop(r)], [target(r, 5)])).toBe('animated')
    expect(keyStatus([prop(r)], [target(r, 20)])).toBe('key')
    // Multi-selection: key only when every target has one.
    expect(keyStatus([prop(r), prop(o)], [target(r, 20), target(o, 20)])).toBe('animated')
  })
  it('finds neighbouring keys and maps them to root frames', () => {
    const r = ['layers', 0, 'ks', 'r']
    expect(neighbourKeys([prop(r)], [target(r, 10)])).toEqual({ prev: 0, next: 20 })
    expect(neighbourKeys([prop(r)], [target(r, 20)])).toEqual({ prev: 0, next: null })
    const shifted = { ...target(r, 10), toRoot: (t: number) => t + 100 }
    expect(neighbourKeys([prop(r)], [shifted])).toEqual({ prev: 100, next: 120 })
  })
})

describe('toggleKeys', () => {
  it('animates a static property, adds keys, then removes them', () => {
    const o = ['layers', 0, 'ks', 'o']
    toggleKeys('animate', [target(o, 10)], 'static')
    expect(prop(o)?.k).toEqual([{ t: 10, s: [100] }])
    toggleKeys('add', [target(o, 30)], 'animated')
    expect(keys(o).map((k) => k.t)).toEqual([10, 30])
    toggleKeys('remove', [target(o, 30)], 'key')
    toggleKeys('remove', [target(o, 10)], 'key')
    // Removing the last key leaves the property static with that value.
    expect(prop(o)).toMatchObject({ a: 0, k: 100 })
  })
  it('creates missing optional properties', () => {
    const sk = ['layers', 0, 'ks', 'sk']
    toggleKeys('animate', [target(sk, 0, () => ({ a: 0, k: 0 }))], 'static')
    expect(prop(sk)?.k).toEqual([{ t: 0, s: [0] }])
  })
  it('is one undo step for several targets', () => {
    const before = useDocument.getState().past.length
    toggleKeys(
      'animate',
      [target(['layers', 0, 'ks', 'o'], 0), target(['layers', 0, 'ks', 's'], 0)],
      'static',
    )
    expect(useDocument.getState().past.length).toBe(before + 1)
    undo()
    expect(prop(['layers', 0, 'ks', 'o'])?.k).toBe(100)
  })
})

describe('editProperties / writeValue', () => {
  it('auto-keys animated properties at the target frame', () => {
    const r = ['layers', 0, 'ks', 'r']
    editProperties('edit', [target(r, 10)], (p, t) => writeValue(p, t.frame, 45))
    expect(keys(r).map((k) => [k.t, k.s[0]])).toEqual([
      [0, 0],
      [10, 45],
      [20, 90],
    ])
  })
  it('keeps the array form of static scalars', () => {
    const sa = ['layers', 0, 'ks', 'sa']
    editProperties('edit', [target(sa, 0)], (p, t) => writeValue(p, t.frame, 12))
    expect(prop(sa)?.k).toEqual([12])
  })
  it('reads missing properties as the fallback', () => {
    expect(readValue(undefined, 0, [1, 2])).toEqual([1, 2])
    expect(readValue(prop(['layers', 0, 'ks', 's']), 0, [0])).toEqual([100, 100, 100])
  })
  it('edits legacy keyframes inside the recipe without throwing', () => {
    const p = ['layers', 1, 'ks', 'p']
    expect(() =>
      editProperties('edit', [target(p, 10)], (pr, t) => writeValue(pr, t.frame, [7, 7])),
    ).not.toThrow()
    const kfs = prop(p)?.k as { t: number; s?: number[]; e?: unknown }[]
    expect(kfs.map((k) => k.t)).toEqual([0, 10])
    expect(kfs[1].s).toEqual([7, 7])
    expect(kfs.some((k) => k.e !== undefined)).toBe(false)
  })
  it('reports which target is edited', () => {
    const seen: number[] = []
    editProperties(
      'edit',
      [target(['layers', 0, 'ks', 'o'], 0), target(['layers', 0, 'ks', 'r'], 0)],
      (_p, _t, i) => {
        seen.push(i)
      },
    )
    expect(seen).toEqual([0, 1])
  })
})

describe('removeAnimation', () => {
  it('keeps the value at the playhead', () => {
    const r = ['layers', 0, 'ks', 'r']
    removeAnimation('remove', [target(r, 10)])
    expect(prop(r)?.a).toBe(0)
    expect(prop(r)?.k as number).toBeCloseTo(45, 0)
  })
  it('never creates missing properties', () => {
    removeAnimation('remove', [target(['layers', 0, 'ks', 'sk'], 0, () => ({ a: 0, k: 0 }))])
    expect(prop(['layers', 0, 'ks', 'sk'])).toBeNull()
  })
})
