import { beforeEach, describe, expect, it } from 'vitest'
import { createAnimation } from '@/lottie/document'
import {
  canRedo,
  canUndo,
  jumpToHistory,
  loadDocument,
  redo,
  replaceDoc,
  selectNodes,
  undo,
  updateDoc,
  useDocument,
} from '../document'

function doc() {
  return useDocument.getState().doc!
}

beforeEach(() => {
  const anim = createAnimation({ name: 'Test' })
  anim.layers.push({ ty: 3, nm: 'Null', ind: 1, ip: 0, op: 90, st: 0, ks: { o: { a: 0, k: 100 } } })
  loadDocument(anim, { fileName: 'test.json' })
})

describe('document history', () => {
  it('records undoable edits', () => {
    updateDoc('Rename', (d) => {
      d.nm = 'Renamed'
    })
    expect(doc().nm).toBe('Renamed')
    expect(canUndo()).toBe(true)
    undo()
    expect(doc().nm).toBe('Test')
    expect(canRedo()).toBe(true)
    redo()
    expect(doc().nm).toBe('Renamed')
  })

  it('ignores no-op edits', () => {
    const rev = useDocument.getState().revision
    expect(updateDoc('Nothing', () => {})).toBe(false)
    expect(useDocument.getState().revision).toBe(rev)
    expect(canUndo()).toBe(false)
  })

  it('coalesces a gesture into one entry', () => {
    for (let i = 1; i <= 5; i++) {
      updateDoc(
        'Opacity',
        (d) => {
          d.layers[0].ks.o!.k = 100 - i * 10
        },
        { coalesceKey: 'scrub-1' },
      )
    }
    expect(useDocument.getState().past.length).toBe(1)
    expect(doc().layers[0].ks.o!.k).toBe(50)
    undo()
    expect(doc().layers[0].ks.o!.k).toBe(100)
    redo()
    expect(doc().layers[0].ks.o!.k).toBe(50)
  })

  it('does not coalesce different gestures', () => {
    updateDoc('A', (d) => void (d.w = 100), { coalesceKey: 'g1' })
    updateDoc('B', (d) => void (d.w = 200), { coalesceKey: 'g2' })
    expect(useDocument.getState().past.length).toBe(2)
  })

  it('replaces the whole document cheaply and undoes it', () => {
    const before = doc()
    replaceDoc('Replace', { ...structuredClone(before), w: 999 })
    expect(doc().w).toBe(999)
    undo()
    expect(doc()).toBe(before)
  })

  it('jumps through history', () => {
    updateDoc('1', (d) => void (d.w = 1))
    updateDoc('2', (d) => void (d.w = 2))
    updateDoc('3', (d) => void (d.w = 3))
    jumpToHistory(1)
    expect(doc().w).toBe(1)
    jumpToHistory(3)
    expect(doc().w).toBe(3)
    jumpToHistory(0)
    expect(doc().w).toBe(512)
  })

  it('restores the selection with undo and prunes invalid paths', () => {
    selectNodes([['layers', 0]])
    updateDoc('Delete layer', (d) => void d.layers.splice(0, 1), {
      selection: { nodes: [], keyframes: [], property: null },
    })
    expect(useDocument.getState().selection.nodes).toEqual([])
    undo()
    expect(useDocument.getState().selection.nodes).toEqual([['layers', 0]])
  })

  it('keeps the document frozen', () => {
    expect(Object.isFrozen(doc())).toBe(true)
    updateDoc('Edit', (d) => void (d.h = 10))
    expect(Object.isFrozen(doc())).toBe(true)
    expect(Object.isFrozen(doc().layers[0])).toBe(true)
  })
})

describe('gesture coalescing', () => {
  it('merges an in-progress gesture regardless of time and closes it on the final update', () => {
    const realNow = Date.now
    let now = 1_000_000
    Date.now = () => now
    try {
      updateDoc('Drag', (d) => void (d.w = 600), { coalesceKey: 'drag-1', final: false })
      now += 10_000 // long pause while still dragging
      updateDoc('Drag', (d) => void (d.w = 700), { coalesceKey: 'drag-1', final: true })
      expect(useDocument.getState().past.length).toBe(1)
      now += 10_000
      updateDoc('Drag', (d) => void (d.w = 800), { coalesceKey: 'drag-1', final: true })
      expect(useDocument.getState().past.length).toBe(2)
    } finally {
      Date.now = realNow
    }
  })

  it('restores original and dirty state when loading a session', () => {
    const original = createAnimation({ name: 'Original' })
    loadDocument(createAnimation({ name: 'Edited' }), { fileName: 'x.json', original, dirty: true })
    const s = useDocument.getState()
    expect(s.original?.nm).toBe('Original')
    expect(s.revision).not.toBe(s.savedRevision)
  })
})
