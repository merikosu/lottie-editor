import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAt } from '@/lottie/path'
import type { Animation, Layer } from '@/lottie/types'
import { loadDocument, selectKeyframes, updateDoc, useDocument } from '@/store/document'
import { play, usePlayback } from '@/store/playback'

let locked = false
vi.mock('../locks', () => ({ isLockedOnCanvas: () => locked }))

const { MoveGesture } = await import('../move-gesture')

const stat = <T>(k: T) => ({ a: 0 as const, k })

const layer = (p: number[]) =>
  ({
    ty: 4,
    ip: 0,
    op: 60,
    st: 0,
    shapes: [],
    ks: { a: stat([0, 0, 0]), p: stat(p), s: stat([100, 100, 100]), r: stat(0), o: stat(100) },
  }) as Layer

/** Group `G<x>` whose transform is at (x, 0). */
const group = (x: number) => ({
  ty: 'gr',
  nm: `G${x}`,
  it: [
    { ty: 'tr', p: stat([x, 0]), a: stat([0, 0]), s: stat([100, 100]), r: stat(0), o: stat(100) },
  ],
})

function doc(): Animation {
  return {
    v: '5.7.0',
    fr: 30,
    ip: 0,
    op: 60,
    w: 512,
    h: 512,
    layers: [layer([100, 100, 0]), layer([200, 200, 0])],
  }
}

const position = (i: number) => getAt(useDocument.getState().doc, ['layers', i, 'ks', 'p', 'k'])
const history = () => useDocument.getState().past.map((e) => e.label)

beforeEach(() => {
  locked = false
  loadDocument(doc(), { fileName: 'a.json' })
})

describe('MoveGesture', () => {
  it('previews without editing, then commits one undo step on release', () => {
    const g = new MoveGesture()
    expect(
      g.begin(
        [
          ['layers', 0],
          ['layers', 1],
        ],
        { x: 10, y: 10 },
        [],
        null,
      ),
    ).toBe(true)
    let preview: Animation | null = null
    for (let i = 1; i <= 20; i++) preview = g.update({ x: 10 + i, y: 10 + i * 2 }, false) ?? preview
    expect(getAt(preview, ['layers', 0, 'ks', 'p', 'k'])).toEqual([120, 140, 0])
    // The document is untouched until the drag ends.
    expect(position(0)).toEqual([100, 100, 0])
    expect(g.overlay?.offset).toEqual({ x: 20, y: 40 })
    g.finish()
    expect(position(0)).toEqual([120, 140, 0])
    expect(position(1)).toEqual([220, 240, 0])
    expect(history()).toEqual(['Move 2 layers'])
    expect(g.active).toBe(false)
  })

  it('reads out the position of one node, the offset of several', () => {
    const one = new MoveGesture()
    one.begin([['layers', 0]], { x: 0, y: 0 }, [], null)
    one.update({ x: 12.5, y: -4 }, false)
    expect(one.readout).toEqual({ kind: 'position', x: 112.5, y: 96 })
    one.cancel()
    expect(one.readout).toBeNull()
    const two = new MoveGesture()
    two.begin(
      [
        ['layers', 0],
        ['layers', 1],
      ],
      { x: 0, y: 0 },
      [],
      null,
    )
    two.update({ x: 3, y: 7 }, false)
    expect(two.readout).toEqual({ kind: 'offset', dx: 3, dy: 7 })
    two.cancel()
  })

  it('snaps to the artboard within the threshold', () => {
    const g = new MoveGesture()
    // No SVG: the selection is the layer's anchor point (100, 100); 256 is the artboard center.
    g.begin([['layers', 0]], { x: 0, y: 0 }, [], null)
    g.update({ x: 153, y: 0 }, false, 5)
    expect(g.readout).toEqual({ kind: 'position', x: 256, y: 100 })
    expect(g.overlay?.guides.x?.at).toBe(256)
    g.update({ x: 153, y: 0 }, false, null)
    expect(g.readout).toEqual({ kind: 'position', x: 253, y: 100 })
    g.cancel()
  })

  it('Alt leaves the originals and moves copies: one undo step, copies selected', () => {
    const g = new MoveGesture()
    g.begin([['layers', 1]], { x: 0, y: 0 }, [], null)
    const copy = g.update({ x: 10, y: 5 }, false, null, true)
    // The copy goes right above its original and takes the move.
    expect(copy?.layers.length).toBe(3)
    expect(getAt(copy, ['layers', 1, 'ks', 'p', 'k'])).toEqual([210, 205, 0])
    expect(getAt(copy, ['layers', 2, 'ks', 'p', 'k'])).toEqual([200, 200, 0])
    // Alt released mid-drag: a plain move again (same offset).
    const plain = g.update({ x: 10, y: 5 }, false, null, false)
    expect(plain?.layers.length).toBe(2)
    expect(g.duplicating).toBe(false)
    g.update({ x: 10, y: 5 }, false, null, true)
    g.finish()
    const d = useDocument.getState().doc
    expect(d?.layers.length).toBe(3)
    expect(d?.layers[1].ind).not.toBe(d?.layers[2].ind)
    expect(position(2)).toEqual([200, 200, 0])
    expect(history()).toEqual(['Duplicate layer'])
    expect(useDocument.getState().selection.nodes).toEqual([['layers', 1]])
  })

  it('Alt-drags groups: copies inside the same layer', () => {
    const shapeDoc = doc()
    ;(shapeDoc.layers[0] as unknown as { shapes: unknown[] }).shapes = [group(1), group(2)]
    loadDocument(shapeDoc, { fileName: 'g.json' })
    const g = new MoveGesture()
    g.begin(
      [
        ['layers', 0, 'shapes', 0],
        ['layers', 0, 'shapes', 1],
      ],
      { x: 0, y: 0 },
      [],
      null,
    )
    g.update({ x: 4, y: 0 }, false, null, true)
    g.finish()
    const shapes = getAt<{ nm: string; it: { p: { k: number[] } }[] }[]>(
      useDocument.getState().doc,
      ['layers', 0, 'shapes'],
    )
    // Like ⌘D: a run of items is copied above the run; each copy takes its original's move.
    expect(shapes?.map((s) => s.nm)).toEqual(['G1 copy', 'G2 copy', 'G1', 'G2'])
    expect(shapes?.map((s) => s.it[0].p.k[0])).toEqual([5, 6, 1, 2])
    expect(history()).toEqual(['Duplicate 2 groups'])
  })

  it('keeps selected keyframes on the same keys when a move adds a key', () => {
    const animated = doc()
    animated.layers[0].ks.p = {
      a: 1,
      k: [
        { t: 0, s: [100, 100, 0] },
        { t: 30, s: [300, 100, 0] },
      ],
    } as Layer['ks']['p']
    loadDocument(animated, { fileName: 'k.json' })
    usePlayback.setState({ frame: 10 })
    selectKeyframes([{ path: ['layers', 0, 'ks', 'p'], index: 1 }])
    const g = new MoveGesture()
    g.begin([['layers', 0]], { x: 0, y: 0 }, [], null)
    g.update({ x: 0, y: 20 }, false)
    g.finish()
    const keys = getAt<{ t: number }[]>(useDocument.getState().doc, ['layers', 0, 'ks', 'p', 'k'])
    expect(keys?.map((k) => k.t)).toEqual([0, 10, 30])
    // The key at frame 30 is now index 2.
    expect(useDocument.getState().selection.keyframes).toEqual([
      { path: ['layers', 0, 'ks', 'p'], index: 2 },
    ])
    usePlayback.setState({ frame: 0 })
  })

  it('locks to the dominant axis', () => {
    const g = new MoveGesture()
    g.begin([['layers', 0]], { x: 0, y: 0 }, [], null)
    g.update({ x: 30, y: 12 }, true)
    g.finish()
    expect(position(0)).toEqual([130, 100, 0])
  })

  it('cancels without touching the document or the history', () => {
    const g = new MoveGesture()
    g.begin([['layers', 0]], { x: 0, y: 0 }, [], null)
    g.update({ x: 30, y: 12 }, false)
    g.cancel()
    g.finish()
    expect(position(0)).toEqual([100, 100, 0])
    expect(history()).toEqual([])
  })

  it('records nothing for a drag that ends where it started', () => {
    const g = new MoveGesture()
    g.begin([['layers', 0]], { x: 0, y: 0 }, [], null)
    g.update({ x: 5, y: 5 }, false)
    g.update({ x: 0, y: 0 }, false)
    g.finish()
    expect(history()).toEqual([])
  })

  it('is void when the document changes during the drag', () => {
    const g = new MoveGesture()
    g.begin([['layers', 0]], { x: 0, y: 0 }, [], null)
    g.update({ x: 5, y: 5 }, false)
    updateDoc('Rename', (d) => {
      d.layers[1].nm = 'B'
    })
    g.finish()
    expect(position(0)).toEqual([100, 100, 0])
    expect(history()).toEqual(['Rename'])
  })

  it('does not start on locked nodes, and stops playback', () => {
    locked = true
    expect(new MoveGesture().begin([['layers', 0]], { x: 0, y: 0 }, [], null)).toBe(false)
    locked = false
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => {})
    play()
    expect(usePlayback.getState().playing).toBe(true)
    expect(new MoveGesture().begin([['layers', 0]], { x: 0, y: 0 }, [], null)).toBe(true)
    expect(usePlayback.getState().playing).toBe(false)
    vi.unstubAllGlobals()
  })
})
