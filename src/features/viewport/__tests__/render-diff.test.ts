import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { createAnimation } from '@/lottie/document'
import type { Animation, Layer } from '@/lottie/types'
import { rendersSame } from '../lib/render-diff'

function doc(): Animation {
  const anim = createAnimation()
  anim.layers = [
    {
      ty: 4,
      ind: 1,
      nm: 'Shape',
      ip: 0,
      op: 60,
      st: 0,
      ks: { p: { a: 0, k: [10, 20, 0] }, o: { a: 0, k: 100 } },
      shapes: [{ ty: 'gr', nm: 'Group', it: [{ ty: 'tr', nm: 'Transform' }] }],
    },
    { ty: 3, ind: 2, nm: 'Null', ip: 0, op: 60, st: 0, ks: {} },
  ] as Layer[]
  anim.markers = [{ cm: 'Intro', tm: 0, dr: 10 }]
  return anim
}

const edit = (base: Animation, recipe: (d: Animation) => void) =>
  produce(base, (d) => void recipe(d as Animation))

describe('rendersSame', () => {
  it('ignores renames of layers and shape items', () => {
    const base = doc()
    expect(
      rendersSame(
        base,
        edit(base, (d) => void (d.layers[0].nm = 'Renamed')),
        false,
      ),
    ).toBe(true)
    const group = edit(base, (d) => {
      const shape = d.layers[0] as Layer & { shapes: { nm?: string }[] }
      shape.shapes[0].nm = 'Box'
    })
    expect(rendersSame(base, group, false)).toBe(true)
  })

  it('treats names as visual when expressions run', () => {
    const base = doc()
    expect(
      rendersSame(
        base,
        edit(base, (d) => void (d.layers[0].nm = 'Renamed')),
        true,
      ),
    ).toBe(false)
  })

  it('ignores markers and metadata at the root only', () => {
    const base = doc()
    expect(
      rendersSame(
        base,
        edit(base, (d) => void (d.markers![0].tm = 30)),
        false,
      ),
    ).toBe(true)
    expect(
      rendersSame(
        base,
        edit(base, (d) => void d.markers!.push({ cm: 'B', tm: 5, dr: 0 })),
        false,
      ),
    ).toBe(true)
    expect(
      rendersSame(
        base,
        edit(base, (d) => void delete d.markers),
        false,
      ),
    ).toBe(true)
  })

  it('detects visual changes', () => {
    const base = doc()
    const moved = edit(base, (d) => void ((d.layers[0].ks.p as { k: number[] }).k[0] = 11))
    expect(rendersSame(base, moved, false)).toBe(false)
    expect(
      rendersSame(
        base,
        edit(base, (d) => void (d.layers[1].hd = true)),
        false,
      ),
    ).toBe(false)
    expect(
      rendersSame(
        base,
        edit(base, (d) => void d.layers.pop()),
        false,
      ),
    ).toBe(false)
    expect(
      rendersSame(
        base,
        edit(base, (d) => void (d.w = 256)),
        false,
      ),
    ).toBe(false)
    // A layer field named like a root-only one is still compared.
    const layerMeta = edit(base, (d) => {
      ;(d.layers[1] as Layer & { markers?: number }).markers = 1
    })
    expect(rendersSame(base, layerMeta, false)).toBe(false)
  })

  it('compares equal content of rewritten documents', () => {
    const base = doc()
    const copy = JSON.parse(JSON.stringify(base)) as Animation
    expect(rendersSame(base, copy, false)).toBe(true)
    copy.layers[0].nm = 'Other'
    expect(rendersSame(base, copy, false)).toBe(true)
  })

  it('treats a missing key like an undefined one', () => {
    const base = doc()
    const withUndefined = { ...base, extra: undefined } as Animation
    expect(rendersSame(base, withUndefined, false)).toBe(true)
    expect(rendersSame(withUndefined, base, false)).toBe(true)
  })

  it('gives up (reload) on huge rewrites', () => {
    const big = createAnimation()
    big.layers = Array.from(
      { length: 30_000 },
      (_, i) => ({ ty: 3, ind: i + 1, ip: 0, op: 1, st: 0, ks: {} }) as Layer,
    )
    const copy = JSON.parse(JSON.stringify(big)) as Animation
    expect(rendersSame(big, copy, false)).toBe(false)
  })
})
