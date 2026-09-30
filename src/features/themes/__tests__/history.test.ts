import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createAnimation } from '@/lottie/document'
import { jumpToHistory, loadDocument, redo, undo, updateDoc, useDocument } from '@/store/document'
import {
  commitDocAndPackage,
  commitPackage,
  installPackageHistory,
  resetPackageHistory,
} from '../history'

const uninstall = installPackageHistory()
afterAll(uninstall)

/** Undo/redo restore the package in a microtask. */
const settle = () => Promise.resolve()
const pkg = () => useDocument.getState().meta?.dotLottie as { n: number } | undefined

beforeEach(() => {
  resetPackageHistory()
  loadDocument(createAnimation({ name: 'Test' }), { fileName: 'test.json' })
})

describe('package history', () => {
  it('records a package change as its own undoable step', async () => {
    const revision = useDocument.getState().revision
    expect(commitPackage('Change theme value', { n: 1 })).toBe(true)
    const s = useDocument.getState()
    expect(pkg()).toEqual({ n: 1 })
    expect(s.revision).toBe(revision + 1)
    expect(s.past.map((e) => e.label)).toEqual(['Change theme value'])
    expect(s.past[0].id).toBeLessThan(0)
    expect(s.past[0].patches).toEqual([])
    // Same object: nothing to record.
    expect(commitPackage('Again', pkg())).toBe(false)

    undo()
    await settle()
    expect(pkg()).toBeUndefined()
    redo()
    await settle()
    expect(pkg()).toEqual({ n: 1 })
  })

  it('merges the updates of one gesture into one step', async () => {
    commitPackage('Change', { n: 1 }, { coalesceKey: 'g', final: false })
    commitPackage('Change', { n: 2 }, { coalesceKey: 'g', final: false })
    commitPackage('Change', { n: 3 }, { coalesceKey: 'g', final: true })
    commitPackage('Change', { n: 4 }, { coalesceKey: 'other' })
    expect(useDocument.getState().past).toHaveLength(2)
    undo()
    await settle()
    expect(pkg()).toEqual({ n: 3 })
    undo()
    await settle()
    expect(pkg()).toBeUndefined()
  })

  it('interleaves with document edits', async () => {
    commitPackage('A', { n: 1 })
    updateDoc('Rename', (d) => {
      d.nm = 'Renamed'
    })
    commitPackage('B', { n: 2 })
    jumpToHistory(0)
    await settle()
    expect(pkg()).toBeUndefined()
    expect(useDocument.getState().doc?.nm).toBe('Test')
    jumpToHistory(2)
    await settle()
    expect(pkg()).toEqual({ n: 1 })
    expect(useDocument.getState().doc?.nm).toBe('Renamed')
    jumpToHistory(3)
    await settle()
    expect(pkg()).toEqual({ n: 2 })
  })

  it('attaches a package change to a document edit: one step', async () => {
    commitPackage('Setup', { n: 1 })
    commitDocAndPackage(
      'Rename theme color',
      (d) => {
        d.nm = 'Renamed'
      },
      (before) => ({ n: (before as { n: number }).n + 1 }),
    )
    const s = useDocument.getState()
    expect(s.past.map((e) => e.label)).toEqual(['Setup', 'Rename theme color'])
    expect(s.past[1].id).toBeGreaterThan(0)
    expect(pkg()).toEqual({ n: 2 })
    undo()
    await settle()
    expect(pkg()).toEqual({ n: 1 })
    expect(useDocument.getState().doc?.nm).toBe('Test')
    redo()
    await settle()
    expect(pkg()).toEqual({ n: 2 })
    expect(useDocument.getState().doc?.nm).toBe('Renamed')
  })

  it('records the package alone when the document edit changes nothing', () => {
    const done = commitDocAndPackage(
      'Remove theme color',
      () => undefined,
      () => ({ n: 5 }),
    )
    expect(done).toBe(true)
    expect(useDocument.getState().past.map((e) => e.label)).toEqual(['Remove theme color'])
    expect(pkg()).toEqual({ n: 5 })
  })

  it('forgets steps of a discarded redo branch and of another document', async () => {
    commitPackage('A', { n: 1 })
    undo()
    await settle()
    updateDoc('Other', (d) => {
      d.nm = 'Other'
    })
    // The redo branch with the package change is gone: undo leaves the package alone.
    expect(useDocument.getState().future).toEqual([])
    undo()
    await settle()
    expect(pkg()).toBeUndefined()

    commitPackage('B', { n: 2 })
    loadDocument(createAnimation({ name: 'Next' }), { fileName: 'next.json', dotLottie: { n: 9 } })
    expect(pkg()).toEqual({ n: 9 })
    expect(commitPackage('C', { n: 10 })).toBe(true)
    undo()
    await settle()
    expect(pkg()).toEqual({ n: 9 })
  })

  it('does nothing without a document', () => {
    useDocument.setState({ doc: null, meta: null })
    expect(commitPackage('A', { n: 1 })).toBe(false)
    expect(
      commitDocAndPackage(
        'A',
        () => undefined,
        () => ({ n: 1 }),
      ),
    ).toBe(false)
  })
})
