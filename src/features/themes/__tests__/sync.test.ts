import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getAt } from '@/lottie/path'
import type { Animation } from '@/lottie/types'
import { loadDocument, redo, undo, updateDoc, useDocument } from '@/store/document'
import { installSlotSync } from '../sync'

const uninstall = installSlotSync()
afterAll(uninstall)
const settle = () => Promise.resolve()
const doc = () => useDocument.getState().doc!

function layer(nm: string, fill: Record<string, unknown>): Record<string, unknown> {
  return {
    ty: 4,
    nm,
    ind: 1,
    ip: 0,
    op: 60,
    st: 0,
    ks: { o: { a: 0, k: 100 } },
    shapes: [{ ty: 'fl', c: fill, o: { a: 0, k: 100 } }],
  }
}

beforeEach(() => {
  loadDocument(
    {
      v: '5.12.2',
      fr: 30,
      ip: 0,
      op: 60,
      w: 100,
      h: 100,
      slots: { brand: { p: { a: 0, k: [1, 0, 0] } } },
      layers: [
        layer('A', { a: 0, k: [1, 0, 0, 1], sid: 'brand' }),
        layer('B', { a: 0, k: [1, 0, 0, 1], sid: 'brand' }),
        layer('C', { a: 0, k: [0, 0, 1, 1] }),
      ],
    } as unknown as Animation,
    { fileName: 'sync.json' },
  )
})

const color = (i: number) => getAt(doc(), ['layers', i, 'shapes', 0, 'c', 'k'])

describe('slot sync', () => {
  it('brings the slot and the other copies in line with an edited property (one step)', async () => {
    // What the inspector does: write the property's own value.
    updateDoc('Change fill', (d) => {
      const c = getAt<{ k: number[] }>(d, ['layers', 0, 'shapes', 0, 'c'])!
      c.k = [0, 1, 0, 1]
    })
    await settle()
    expect(doc().slots?.brand.p).toEqual({ a: 0, k: [0, 1, 0, 1] })
    expect(color(1)).toEqual([0, 1, 0, 1])
    expect(color(2)).toEqual([0, 0, 1, 1])
    expect(useDocument.getState().past.map((e) => e.label)).toEqual(['Change fill'])
    undo()
    expect(doc().slots?.brand.p).toEqual({ a: 0, k: [1, 0, 0] })
    expect(color(0)).toEqual([1, 0, 0, 1])
    expect(color(1)).toEqual([1, 0, 0, 1])
    redo()
    await settle()
    expect(color(1)).toEqual([0, 1, 0, 1])
    expect(useDocument.getState().past).toHaveLength(1)
  })

  it('syncs every edit that landed in the same tick, not only the last one', async () => {
    updateDoc('Change fill', (d) => {
      getAt<{ k: number[] }>(d, ['layers', 0, 'shapes', 0, 'c'])!.k = [0, 1, 0, 1]
    })
    // A second, unrelated edit before the sync ran (a command that writes twice, a script).
    updateDoc('Rename', (d) => {
      d.layers[2].nm = 'Renamed'
    })
    await settle()
    expect(doc().slots?.brand.p).toEqual({ a: 0, k: [0, 1, 0, 1] })
    expect(color(1)).toEqual([0, 1, 0, 1])
    expect(useDocument.getState().past.map((e) => e.label)).toEqual(['Change fill', 'Rename'])
  })

  it('follows the slot value when that is what changed (JSON editor, other tools)', async () => {
    updateDoc('Edit slot', (d) => {
      d.slots!.brand.p = { a: 0, k: [0, 0, 0] }
    })
    await settle()
    expect(color(0)).toEqual([0, 0, 0])
    expect(color(1)).toEqual([0, 0, 0])
  })

  it('merges every update of a gesture and ignores consistent edits', async () => {
    for (const [i, g] of [0.2, 0.4, 0.6].entries()) {
      updateDoc(
        'Change fill',
        (d) => {
          getAt<{ k: number[] }>(d, ['layers', 1, 'shapes', 0, 'c'])!.k = [0, g, 0, 1]
        },
        { coalesceKey: 'drag', final: i === 2 },
      )
      await settle()
    }
    expect(useDocument.getState().past).toHaveLength(1)
    expect(color(0)).toEqual([0, 0.6, 0, 1])
    expect(doc().slots?.brand.p).toEqual({ a: 0, k: [0, 0.6, 0, 1] })
    // Renaming a layer touches no slot.
    const patches = useDocument.getState().past[0].patches.length
    updateDoc('Rename', (d) => {
      d.layers[0].nm = 'Renamed'
    })
    await settle()
    expect(useDocument.getState().past[1].patches).toHaveLength(1)
    expect(useDocument.getState().past[0].patches).toHaveLength(patches)
  })
})
