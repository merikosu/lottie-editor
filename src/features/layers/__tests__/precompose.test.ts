import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import {
  createFillShape,
  createGroupShape,
  createPrecompLayer,
  createRectShape,
} from '@/lottie/create'
import { createAnimation } from '@/lottie/document'
import { planPrecompose } from '@/lottie/layer-ops'
import type { Animation, Layer, PrecompAsset, PrecompLayer } from '@/lottie/types'
import { getDoc, loadDocument, selectNodes, undo, updateDoc, useDocument } from '@/store/document'
import {
  canPrecompose,
  canRelease,
  compositionName,
  defaultPrecompName,
  precomposeSelection,
  precomposeTargets,
  releaseSelection,
  releaseState,
} from '../precompose'
import { installLayersSync, isNodeLocked, isNodeSoloed, setLocked, setSolo } from '../state'

const box = (nm: string) =>
  createGroupShape({
    name: nm,
    items: [createRectShape({ w: 10, h: 10 }), createFillShape({ color: '#fff' })],
  })

function doc(): Animation {
  const anim = createAnimation({ name: 'Main', width: 512, height: 512, frames: 90 })
  anim.layers = [
    { ty: 4, ind: 1, nm: 'Ball', ip: 0, op: 90, st: 0, ks: {}, shapes: [box('G')] },
    { ty: 4, ind: 2, nm: 'Shadow', ip: 0, op: 90, st: 0, ks: {}, shapes: [box('G')] },
    {
      ...createPrecompLayer({ refId: 'comp_0', ind: 3, w: 512, h: 512, ip: 0, op: 90 }),
      nm: 'Pre-comp 1',
    },
  ] as Layer[]
  anim.assets = [
    {
      id: 'comp_0',
      nm: 'Pre-comp 1',
      layers: [
        { ty: 4, ind: 1, nm: 'Inner', ip: 0, op: 90, st: 0, ks: {}, shapes: [box('G')] },
      ] as Layer[],
    },
  ]
  return anim
}

let uninstall: () => void = () => {}

beforeEach(() => {
  loadDocument(doc(), { fileName: 'a.json', id: 'doc_precompose' })
  uninstall = installLayersSync()
})

afterEach(() => uninstall())

describe('precompose actions', () => {
  it('targets the selected layers of one composition', () => {
    selectNodes([])
    expect(precomposeTargets()).toBeNull()
    expect(canPrecompose()).toBe(false)
    selectNodes([
      ['layers', 0],
      ['layers', 1, 'shapes', 0],
    ])
    expect(precomposeTargets()).toEqual([['layers', 0]])
    selectNodes([
      ['layers', 0],
      ['assets', 0, 'layers', 0],
    ])
    expect(precomposeTargets()).toBeNull()
    selectNodes([['layers', 1, 'shapes', 0]])
    expect(canPrecompose()).toBe(false)
  })

  it('suggests After Effects names, numbered past existing compositions', () => {
    const anim = getDoc()!
    const one = planPrecompose(anim, [['layers', 0]])!
    expect(defaultPrecompName(anim, one, en)).toBe('Ball Comp 1')
    const two = planPrecompose(anim, [
      ['layers', 0],
      ['layers', 1],
    ])!
    expect(defaultPrecompName(anim, two, en)).toBe('Pre-comp 2')
    expect(compositionName(anim, ['layers'])).toBe('Main')
    expect(compositionName(anim, ['assets', 0, 'layers'])).toBe('Pre-comp 1')
  })

  it('precomposes as one undo step and selects the new layer', () => {
    selectNodes([
      ['layers', 0],
      ['layers', 1],
    ])
    const before = getDoc()
    const past = useDocument.getState().past.length
    expect(precomposeSelection({ name: '', mode: 'move', adjustDuration: false })).toBe(true)
    const state = useDocument.getState()
    expect(state.past).toHaveLength(past + 1)
    expect(state.past.at(-1)!.label).toBe('Precompose “Pre-comp 2”')
    expect(state.selection.nodes).toEqual([['layers', 0]])
    expect(state.doc!.layers.map((l) => l.nm)).toEqual(['Pre-comp 2', 'Pre-comp 1'])
    undo()
    expect(getDoc()).toEqual(before)
  })

  it('refuses "leave all attributes" where After Effects does', () => {
    selectNodes([['layers', 0]])
    expect(precomposeSelection({ name: 'X', mode: 'leave', adjustDuration: false })).toBe(false)
    expect(useDocument.getState().past).toHaveLength(0)
  })

  it('keeps locks and solo on the layers that move into the composition', () => {
    setLocked([['layers', 0]], true)
    setSolo([['layers', 1]], true)
    selectNodes([
      ['layers', 0],
      ['layers', 1],
    ])
    precomposeSelection({ name: 'Group', mode: 'move', adjustDuration: false })
    expect(isNodeLocked(['assets', 1, 'layers', 0])).toBe(true)
    expect(isNodeSoloed(['assets', 1, 'layers', 1])).toBe(true)
    expect(isNodeLocked(['assets', 1, 'layers', 1])).toBe(false)
  })
})

describe('release actions', () => {
  it('reports why selected precomp layers cannot be released', () => {
    selectNodes([['layers', 0]])
    expect(releaseState().targets).toEqual([])
    expect(canRelease()).toBe(false)
    selectNodes([['layers', 2]])
    expect(releaseState()).toEqual({ targets: [['layers', 2]], blocker: null })
    updateDoc('remap', (d) => {
      ;(d.layers[2] as PrecompLayer).tm = { a: 0, k: 0 }
    })
    expect(releaseState().blocker).toBe('time-remap')
    expect(canRelease()).toBe(true)
    const before = getDoc()
    expect(releaseSelection()).toBe(false)
    expect(getDoc()).toBe(before)
  })

  it('releases as one undo step, selects the released layers and keeps their locks', () => {
    setLocked([['assets', 0, 'layers', 0]], true)
    selectNodes([['layers', 2]])
    const past = useDocument.getState().past.length
    expect(releaseSelection()).toBe(true)
    const state = useDocument.getState()
    expect(state.past).toHaveLength(past + 1)
    expect(state.past.at(-1)!.label).toBe('Release precomp')
    expect(state.doc!.layers.map((l) => l.nm)).toEqual(['Ball', 'Shadow', 'Inner'])
    expect(state.doc!.assets as PrecompAsset[]).toEqual([])
    expect(state.selection.nodes).toEqual([['layers', 2]])
    expect(isNodeLocked(['layers', 2])).toBe(true)
  })
})
