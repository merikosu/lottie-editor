import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import { createFillShape, createGroupShape, createRectShape } from '@/lottie/create'
import { createAnimation } from '@/lottie/document'
import { arrangeLayers, moveShapes } from '@/lottie/layer-ops'
import type { Animation, Layer } from '@/lottie/types'
import { loadDocument, updateDoc, useDocument } from '@/store/document'
import { useUi } from '@/store/ui'
import {
  collapseSubtrees,
  installLayersSync,
  isNodeLocked,
  isNodeSoloed,
  setExpanded,
  setLocked,
  setSearch,
  setSolo,
  useLayersView,
} from '../state'
import { createTreeBuilder } from '../tree-model'

const box = (nm: string) =>
  createGroupShape({
    name: nm,
    items: [createRectShape({ w: 1, h: 1 }), createFillShape({ color: '#fff' })],
  })

function doc(): Animation {
  const anim = createAnimation()
  anim.layers = [
    { ty: 3, ind: 1, nm: 'A', ip: 0, op: 60, st: 0, ks: {} },
    { ty: 4, ind: 2, nm: 'B', ip: 0, op: 60, st: 0, ks: {}, shapes: [box('G1'), box('G2')] },
    { ty: 3, ind: 3, nm: 'C', ip: 0, op: 60, st: 0, ks: {} },
  ] as Layer[]
  return anim
}

let uninstall: () => void = () => {}

beforeEach(() => {
  loadDocument(doc(), { fileName: 'a.json', id: 'doc_a' })
  uninstall = installLayersSync()
})

afterEach(() => uninstall())

describe('layers view state', () => {
  it('locks nodes and their content', () => {
    setLocked([['layers', 1]], true)
    expect(isNodeLocked(['layers', 1])).toBe(true)
    expect(isNodeLocked(['layers', 1, 'shapes', 0, 'it', 1])).toBe(true)
    expect(isNodeLocked(['layers', 0])).toBe(false)
    setLocked([['layers', 1]], false)
    expect(isNodeLocked(['layers', 1])).toBe(false)
  })

  it('keeps lock and solo on the same layers when they are reordered', () => {
    setLocked([['layers', 1]], true)
    setSolo([['layers', 2]], true)
    expect(useUi.getState().soloNodes).toEqual([['layers', 2]])
    updateDoc('Arrange', (d) => {
      arrangeLayers(d as Animation, [['layers', 2]], 'front')
    })
    // C moved to the top: [C, A, B]
    expect(useUi.getState().soloNodes).toEqual([['layers', 0]])
    expect(isNodeSoloed(['layers', 0])).toBe(true)
    expect(isNodeLocked(['layers', 2])).toBe(true)
    expect(isNodeLocked(['layers', 1])).toBe(false)
  })

  it('follows moved shape items with expansion and locks', () => {
    setExpanded([':2', ':2|0'], true)
    setLocked([['layers', 1, 'shapes', 0]], true)
    updateDoc('Move', (d) => {
      moveShapes(d as Animation, [['layers', 1, 'shapes', 1]], ['layers', 1, 'shapes'], 0)
    })
    // G1 moved from index 0 to 1.
    expect(useLayersView.getState().expanded).toEqual({ ':2': true, ':2|1': true })
    expect(isNodeLocked(['layers', 1, 'shapes', 1])).toBe(true)
    expect(isNodeLocked(['layers', 1, 'shapes', 0])).toBe(false)
  })

  it('ignores shape items for solo and clears it for a new document', () => {
    setSolo(
      [
        ['layers', 1, 'shapes', 0],
        ['layers', 0],
      ],
      true,
    )
    expect(useUi.getState().soloNodes).toEqual([['layers', 0]])
    setSearch('b')
    loadDocument(doc(), { fileName: 'b.json', id: 'doc_b' })
    expect(useUi.getState().soloNodes).toEqual([])
    expect(useLayersView.getState().search).toBe('')
    expect(useLayersView.getState().solo).toEqual({})
  })

  it('collapses whole subtrees without touching similar keys', () => {
    setExpanded([':2', ':2|0', ':2|1', ':20', ':1'], true)
    collapseSubtrees([':2'])
    expect(useLayersView.getState().expanded).toEqual({ ':20': true, ':1': true })
  })

  it('never writes editor-only state into the document', () => {
    const before = JSON.stringify(useDocument.getState().doc)
    setLocked([['layers', 0]], true)
    setSolo([['layers', 0]], true)
    expect(JSON.stringify(useDocument.getState().doc)).toBe(before)
    expect(useDocument.getState().past).toHaveLength(0)
  })
})

describe('createTreeBuilder', () => {
  it('reuses unchanged rows between builds', () => {
    const build = createTreeBuilder()
    const opts = { expanded: { ':2': true as const }, search: '', t: en }
    const first = build(useDocument.getState().doc!, opts)
    updateDoc('Rename', (d) => {
      d.layers[0].nm = 'A2'
    })
    const second = build(useDocument.getState().doc!, opts)
    expect(second.rows[0]).not.toBe(first.rows[0])
    expect(second.rows[0].name).toBe('A2')
    expect(second.rows.slice(1)).toEqual(first.rows.slice(1))
    second.rows.slice(1).forEach((row, i) => expect(row).toBe(first.rows[i + 1]))
  })

  it('numbers siblings for assistive technology', () => {
    const { rows } = createTreeBuilder()(useDocument.getState().doc!, {
      expanded: { ':2': true },
      search: '',
      t: en,
    })
    expect(rows.map((r) => [r.name, r.posInSet, r.setSize])).toEqual([
      ['A', 1, 3],
      ['B', 2, 3],
      ['G1', 1, 2],
      ['G2', 2, 2],
      ['C', 3, 3],
    ])
  })
})
