import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import type { Animation, Layer, ShapeItem, ShapeLayer } from '@/lottie/types'
import { structureOf } from '../panel/useElements'

const shape = (nm: string) => ({ ty: 'gr', nm, it: [] }) as unknown as ShapeItem

function makeDoc(): Animation {
  const base = { ip: 0, op: 30, st: 0, ks: {} }
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 30,
    w: 100,
    h: 100,
    assets: [{ id: 'comp', layers: [{ ...base, ty: 4, ind: 1, shapes: [shape('A')] }] }],
    layers: [
      { ...base, ty: 4, ind: 1, nm: 'One', shapes: [shape('A'), shape('B')] } as Layer,
      { ...base, ty: 0, ind: 2, nm: 'Two', refId: 'comp' } as Layer,
    ],
  } as Animation
}

describe('structureOf', () => {
  it('stays the same through edits that keep every element in its place', () => {
    const doc = makeDoc()
    const renamed = produce(doc, (d) => {
      d.layers[0].nm = 'Renamed'
      ;(d.layers[0] as ShapeLayer).shapes[1].nm = 'Also renamed'
    })
    expect(structureOf(renamed)).toBe(structureOf(doc))
  })

  it('changes when a layer or a group is removed, added or moved', () => {
    const doc = makeDoc()
    const key = structureOf(doc)
    expect(structureOf(produce(doc, (d) => void d.layers.splice(0, 1)))).not.toBe(key)
    expect(structureOf(produce(doc, (d) => void d.layers.reverse()))).not.toBe(key)
    expect(
      structureOf(produce(doc, (d) => void (d.layers[0] as ShapeLayer).shapes.splice(0, 1))),
    ).not.toBe(key)
    const insideComp = produce(doc, (d) => {
      const comp = d.assets![0] as unknown as { layers: Layer[] }
      comp.layers.push({ ...comp.layers[0], ind: 2 })
    })
    expect(structureOf(insideComp)).not.toBe(key)
  })
})
