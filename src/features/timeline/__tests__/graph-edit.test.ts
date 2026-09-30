import { produce } from 'immer'
import { beforeEach, describe, expect, it } from 'vitest'
import { getAt, type NodePath } from '@/lottie/path'
import { evaluateArray, getKeyframes, type AnyProperty } from '@/lottie/property'
import type { Animation, Keyframe } from '@/lottie/types'
import {
  loadDocument,
  selectKeyframes,
  selectNodes,
  setSelection,
  updateDoc,
  useDocument,
} from '@/store/document'
import { hasPerDimEase, readEase, setKeyComponents, writeEase } from '../graph/edit'
import {
  asGraphSelection,
  graphPaths,
  keyedProperties,
  nodeProperties,
  pinGraph,
  setGraphLegend,
  useGraphState,
} from '../graph/state'
import { graphDoc, P } from './graph.fixtures'

const kf = (
  o: Keyframe<unknown>['o'],
  i: Keyframe<unknown>['i'],
  extra: Partial<Keyframe<unknown>> = {},
): Keyframe<unknown> => ({
  t: 0,
  s: [0, 0, 0],
  o,
  i,
  ...extra,
})

describe('writeEase', () => {
  it('keeps scalar easing scalar and drops the legacy easing name', () => {
    const k = kf({ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }, { n: '0p1_0p2_0p3_0p4' })
    writeEase(k, { x1: 0.5, y1: 0.25, x2: 0.75, y2: 1 }, null, 3)
    expect(k.o).toEqual({ x: 0.5, y: 0.25 })
    expect(k.i).toEqual({ x: 0.75, y: 1 })
    expect(k.n).toBeUndefined()
  })

  it('writes every component of per-dimension arrays for a shared easing', () => {
    const k = kf({ x: [0.1, 0.2, 0.3], y: [0, 0, 0] }, { x: [0.9, 0.9, 0.9], y: [1, 1, 1] })
    writeEase(k, { x1: 0.5, y1: 0.25, x2: 0.75, y2: 1 }, null, 3)
    expect(k.o).toEqual({ x: [0.5, 0.5, 0.5], y: [0.25, 0.25, 0.25] })
    expect(k.i).toEqual({ x: [0.75, 0.75, 0.75], y: [1, 1, 1] })
  })

  it('writes one dimension, creating complete arrays (lottie-web needs all four)', () => {
    const k = kf({ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 })
    writeEase(k, { x1: 0.5, y1: 0.25, x2: 0.75, y2: 1 }, 1, 2)
    expect(k.o).toEqual({ x: [0.1, 0.5], y: [0.2, 0.25] })
    expect(k.i).toEqual({ x: [0.8, 0.75], y: [0.9, 1] })
    expect(hasPerDimEase(k)).toBe(true)
    expect(readEase(k, 0)).toEqual({ x1: 0.1, y1: 0.2, x2: 0.8, y2: 0.9 })
    expect(readEase(k, 1)).toEqual({ x1: 0.5, y1: 0.25, x2: 0.75, y2: 1 })
  })

  it('repairs mixed scalar/array handles and rounds to four decimals', () => {
    const k = kf({ x: [0.1, 0.2], y: 0 }, { x: 0.9, y: [1, 1] })
    writeEase(k, { x1: 0.123456, y1: 1 / 3, x2: 0.7, y2: 1 }, null, 2)
    expect(k.o).toEqual({ x: [0.1235, 0.1235], y: [0.3333, 0.3333] })
    expect(k.i).toEqual({ x: [0.7, 0.7], y: [1, 1] })
  })

  it('creates missing handles', () => {
    const k: Keyframe<unknown> = { t: 0, s: [1] }
    writeEase(k, { x1: 0.2, y1: 0, x2: 0.8, y2: 1 }, null, 1)
    expect(k.o).toEqual({ x: 0.2, y: 0 })
    expect(k.i).toEqual({ x: 0.8, y: 1 })
  })

  it('changes what the evaluator computes, on an immer draft', () => {
    const prop: AnyProperty = {
      a: 1,
      k: [
        { t: 0, s: [0], o: { x: [0.5], y: [0] }, i: { x: [0.5], y: [1] } },
        { t: 10, s: [100] },
      ],
    }
    const next = produce(prop, (d) => {
      writeEase((d.k as Keyframe<unknown>[])[0], { x1: 0, y1: 0, x2: 1, y2: 1 }, null, 1)
    })
    expect(evaluateArray(next, 2.5)[0]).toBeCloseTo(25, 9)
    expect(evaluateArray(prop, 2.5)[0]).not.toBeCloseTo(25, 3)
  })
})

describe('setKeyComponents', () => {
  it('sets dimensions of the value, ignoring ones it does not have', () => {
    const k: Keyframe<unknown> = { t: 0, s: [1, 2, 3] }
    setKeyComponents(
      k,
      new Map([
        [1, 20],
        [5, 9],
      ]),
    )
    expect(k.s).toEqual([1, 20, 3])
    const scalar: Keyframe<unknown> = { t: 0, s: 4 as unknown as number[] }
    setKeyComponents(scalar, new Map([[0, 8]]))
    expect(scalar.s).toEqual([8])
  })
})

/* -------------------------------------------------------------------------- */
/*                                 Shown set                                  */
/* -------------------------------------------------------------------------- */

const keys = (paths: readonly NodePath[]) => paths.map((p) => p.join('/'))

describe('what the graph shows', () => {
  it('follows keyed properties first, then the selected nodes', () => {
    const doc = graphDoc()
    const none = { nodes: [], keyframes: [], property: null }
    expect(graphPaths(doc, none, null)).toEqual([])
    const layer = { nodes: [['layers', 0]], keyframes: [], property: null }
    expect(keys(nodeProperties(doc, layer))).toEqual(
      expect.arrayContaining([P.opacity.join('/'), P.position.join('/'), P.fill.join('/')]),
    )
    const shape = { nodes: [['layers', 0, 'shapes', 0, 'it', 1]], keyframes: [], property: null }
    expect(keys(graphPaths(doc, shape, null))).toEqual([P.fill.join('/')])
    const keyed = {
      nodes: [['layers', 0]],
      keyframes: [{ path: P.scale, index: 0 }],
      property: P.opacity,
    }
    expect(keys(keyedProperties(keyed))).toEqual([P.opacity.join('/'), P.scale.join('/')])
    expect(keys(graphPaths(doc, keyed, null))).toEqual([P.opacity.join('/'), P.scale.join('/')])
    const pinned = [{ path: P.rotation as NodePath, layer: '#1' }]
    expect(keys(graphPaths(doc, keyed, pinned))).toEqual([
      P.rotation.join('/'),
      P.opacity.join('/'),
      P.scale.join('/'),
    ])
  })
})

const doc = () => useDocument.getState().doc as Animation

describe('pinning', () => {
  beforeEach(() => {
    loadDocument(graphDoc(), { fileName: 'graph.json' })
    useGraphState.setState({ pinned: null, dims: null, hoverCurve: null, legend: {} })
  })

  it('keeps the shown set while the graph selects, and follows selections made elsewhere', () => {
    pinGraph(doc(), [P.opacity, P.rotation])
    asGraphSelection(() => selectKeyframes([{ path: P.opacity, index: 1 }]))
    useGraphState.setState({ dims: { [P.opacity.join('/')]: [0] } })
    expect(useGraphState.getState().pinned?.map((p) => p.path)).toEqual([P.opacity, P.rotation])
    expect(
      keys(graphPaths(doc(), useDocument.getState().selection, useGraphState.getState().pinned)),
    ).toEqual([P.opacity.join('/'), P.rotation.join('/')])
    selectNodes([['layers', 1]])
    expect(useGraphState.getState().pinned).toBeNull()
    expect(useGraphState.getState().dims).toBeNull()
  })

  it('pins once: a second pin does not replace the first', () => {
    pinGraph(doc(), [P.opacity])
    pinGraph(doc(), [P.scale])
    expect(useGraphState.getState().pinned?.map((p) => p.path)).toEqual([P.opacity])
  })

  it('keeps the pin through edits and undo, dropping properties that stop animating', () => {
    pinGraph(doc(), [P.opacity, P.rotation])
    updateDoc('static', (d) => {
      const r = getAt<AnyProperty>(d, P.rotation)!
      r.k = 0
      r.a = 0
    })
    expect(useGraphState.getState().pinned?.map((p) => p.path)).toEqual([P.opacity])
    // An edit that also changes the selection (e.g. a drag) keeps the pin.
    updateDoc(
      'move',
      (d) => {
        getKeyframes(getAt<AnyProperty>(d, P.opacity))![1].t = 21
      },
      { selection: { nodes: [], keyframes: [{ path: P.opacity, index: 1 }], property: null } },
    )
    expect(useGraphState.getState().pinned).not.toBeNull()
  })

  it('drops pins whose layer moved away (paths shift when layers are removed)', () => {
    pinGraph(doc(), [P.opacity])
    updateDoc('remove', (d) => {
      d.layers.splice(0, 1)
      // The next layer now sits at index 0 and animates its opacity too.
      d.layers[0].ks.o = {
        a: 1,
        k: [
          { t: 0, s: [0] },
          { t: 5, s: [100] },
        ],
      } as never
    })
    expect(useGraphState.getState().pinned).toBeNull()
  })

  it('forgets everything with another document', () => {
    pinGraph(doc(), [P.opacity])
    setGraphLegend({ a: ['--x'] })
    loadDocument(graphDoc(), { fileName: 'other.json' })
    expect(useGraphState.getState()).toMatchObject({ pinned: null, dims: null, legend: {} })
  })

  it('publishes the legend only when it changes', () => {
    setGraphLegend({ a: ['--x', '--y'] })
    const first = useGraphState.getState().legend
    setGraphLegend({ a: ['--x', '--y'] })
    expect(useGraphState.getState().legend).toBe(first)
    setGraphLegend({ a: ['--x'] })
    expect(useGraphState.getState().legend).not.toBe(first)
  })

  it('an external selection without changes does not unpin', () => {
    pinGraph(doc(), [P.opacity])
    setSelection((s) => s)
    expect(useGraphState.getState().pinned).not.toBeNull()
  })
})
