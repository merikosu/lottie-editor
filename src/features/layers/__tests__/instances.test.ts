import { beforeEach, describe, expect, it } from 'vitest'
import { createAnimation } from '@/lottie/document'
import type { Animation, Layer } from '@/lottie/types'
import { loadDocument } from '@/store/document'
import {
  chainKey,
  instanceChainFor,
  instanceChainOf,
  isInstanceChain,
  noteInstanceChain,
  noteInstancesInStack,
  resetInstanceChains,
} from '../instances'

const precomp = (ind: number, refId: string, st = 0): Layer =>
  ({ ty: 0, ind, nm: `P${ind}`, refId, ip: 0, op: 60, st, w: 100, h: 100, ks: {} }) as Layer
const shape = (ind: number): Layer =>
  ({ ty: 4, ind, nm: `S${ind}`, ip: 0, op: 60, st: 0, ks: {}, shapes: [] }) as Layer

/** Root: two instances of `outer`; `outer` holds two instances of `inner`. */
function doc(): Animation {
  const anim = createAnimation()
  anim.layers = [precomp(1, 'outer', 0), shape(2), precomp(3, 'outer', 30)]
  anim.assets = [
    { id: 'inner', layers: [shape(1)] },
    { id: 'outer', layers: [precomp(1, 'inner', 0), precomp(2, 'inner', 10)] },
  ] as Animation['assets']
  return anim
}

let anim: Animation

beforeEach(() => {
  resetInstanceChains()
  anim = doc()
  loadDocument(anim, { fileName: 'a.json', id: 'doc_a' })
})

describe('instance chains', () => {
  it('validates chains from the root composition', () => {
    expect(isInstanceChain(anim, [['layers', 2]], 'outer')).toBe(true)
    expect(
      isInstanceChain(
        anim,
        [
          ['layers', 2],
          ['assets', 1, 'layers', 1],
        ],
        'inner',
      ),
    ).toBe(true)
    // Not a precomp layer, wrong composition, or not starting at the root.
    expect(isInstanceChain(anim, [['layers', 1]], 'outer')).toBe(false)
    expect(isInstanceChain(anim, [['layers', 2]], 'inner')).toBe(false)
    expect(isInstanceChain(anim, [['assets', 1, 'layers', 1]], 'inner')).toBe(false)
    expect(isInstanceChain(anim, [], 'outer')).toBe(false)
  })

  it('remembers the chain for every composition along it', () => {
    expect(instanceChainOf(anim, 'outer')).toBeNull()
    noteInstanceChain(anim, [
      ['layers', 2],
      ['assets', 1, 'layers', 1],
    ])
    expect(instanceChainOf(anim, 'outer')).toEqual([['layers', 2]])
    expect(instanceChainOf(anim, 'inner')).toEqual([
      ['layers', 2],
      ['assets', 1, 'layers', 1],
    ])
    // Content paths resolve through their composition.
    expect(instanceChainFor(anim, ['assets', 0, 'layers', 0, 'shapes', 0])).toEqual([
      ['layers', 2],
      ['assets', 1, 'layers', 1],
    ])
    expect(instanceChainFor(anim, ['layers', 1])).toBeNull()
  })

  it('takes the precomp layers out of a hit stack', () => {
    noteInstancesInStack(anim, [
      ['layers', 0],
      ['assets', 1, 'layers', 1],
      ['assets', 0, 'layers', 0],
      ['assets', 0, 'layers', 0, 'shapes', 0],
    ])
    expect(chainKey(instanceChainOf(anim, 'inner') ?? [])).toBe('layers/0>assets/1/layers/1')
  })

  it('drops chains that no longer lead to the composition', () => {
    noteInstanceChain(anim, [['layers', 2]])
    const edited = { ...anim, layers: [anim.layers[1], anim.layers[0], anim.layers[2]] }
    // Still a precomp layer showing `outer` at that path: kept.
    expect(instanceChainOf(edited, 'outer')).toEqual([['layers', 2]])
    const removed = { ...anim, layers: [anim.layers[0], anim.layers[1]] }
    expect(instanceChainOf(removed, 'outer')).toBeNull()
  })

  it('forgets everything when another document opens', () => {
    noteInstanceChain(anim, [['layers', 2]])
    loadDocument(doc(), { fileName: 'b.json', id: 'doc_b' })
    expect(instanceChainOf(anim, 'outer')).toBeNull()
  })

  it('stops at the first path that breaks the chain', () => {
    noteInstanceChain(anim, [
      ['layers', 1],
      ['assets', 1, 'layers', 1],
    ])
    expect(instanceChainOf(anim, 'inner')).toBeNull()
    expect(instanceChainOf(anim, 'outer')).toBeNull()
  })
})
